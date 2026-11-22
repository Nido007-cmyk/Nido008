/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeRuntime.ts — el tiempo de ejecución del ejecutor de
 * avisos de E8 en el proceso principal: configura la agenda de
 * disparo con la custodia del SO, arranca el reloj y sirve los
 * retornos a la vida (arranque, desbloqueo, vuelta de
 * suspensión) con su pasada de recuperación.
 *
 * La agenda se cifra con safeStorage: en Linux su backend
 * puede degradar a `basic_text`, y la agenda se escribe igual,
 * con ese nivel declarado (decisión 5 de E8-DECISIONES): la
 * fila del ejecutor en Ajustes enseña el nivel real por
 * `noticeAgendaCustody()` (paso 6). Si safeStorage no está
 * disponible, el sellado falla y la agenda queda sin escribir:
 * la base sigue mandando y la reconciliación lo refleja.
 *
 * Con la bóveda bloqueada el reloj sigue corriendo desde la
 * agenda (esa es su razón de ser): al vencer una entrada la
 * anota en la lista `pending` de la propia agenda, sin leer la
 * base ni enseñar texto alguno. Al desbloquear, la pasada de
 * recuperación presenta todo lo debido. El despacho con la app
 * abierta (paso 4) y la notificación del sistema (paso 6)
 * extienden este mismo camino de despertar.
 */

import { app, powerMonitor, safeStorage } from "electron";
import { join } from "node:path";
import {
  configureNoticeAgenda,
  readNoticeAgenda,
  setAgendaPending,
  type NoticeAgendaCipher,
} from "../../src/agent/memory/noticeAgenda.js";
import { runCatchUpPass } from "../../src/agent/memory/noticeCatchUp.js";
import { NoticeClock } from "../../src/agent/memory/noticeClock.js";
import {
  composeOsPayload,
  runDispatchPass,
  runPrePass,
  summarizeCatchUp,
  type DispatchTexts,
} from "../../src/agent/memory/noticeDispatcher.js";
import {
  getNotice,
  reconcileNoticeAgenda,
  setNoticeRuntimePoke,
  type Notice,
  type NoticeKind,
} from "../../src/agent/memory/noticeStore.js";
import { notifyNow } from "../../src/notify/notifications.js";

/**
 * La cifra de la agenda, en los dos peldaños de la decisión 5
 * (vía A firmada): con almacén de secretos del SO, el cifrado
 * de `safeStorage`; sin él (Linux que degrada a `basic_text`,
 * donde `encryptString` lanza y no hay cifrado que ofrecer),
 * el nivel básico declarado: la agenda viaja codificada con
 * su marca de nivel, sin fingir cifrado. La vía B (no
 * escribir la agenda en ese sistema) quedó descartada en la
 * decisión: la agenda guarda solo horas, y ese es el dato
 * cuyo nivel menor el diseño aceptó y declaró. Sin esta
 * caída, un Linux sin almacén se quedaba sin disparo a la
 * hora en silencio (lo cazó T-22 en la VM firmada).
 */
export const BASIC_AGENDA_PREFIX = "basic:";

export const safeStorageCipher: NoticeAgendaCipher = {
  seal(plain: string): string {
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("basic");
      return safeStorage.encryptString(plain).toString("base64");
    } catch {
      return BASIC_AGENDA_PREFIX + Buffer.from(plain, "utf8").toString("base64");
    }
  },
  unseal(sealed: string): string | null {
    if (sealed.startsWith(BASIC_AGENDA_PREFIX)) {
      try {
        const payload = sealed.slice(BASIC_AGENDA_PREFIX.length);
        const plain = Buffer.from(payload, "base64").toString("utf8");
        // La codificación básica es laxa al decodificar: lo
        // que no vuelve a codificarse idéntico no era una
        // agenda de este nivel y no abre.
        if (Buffer.from(plain, "utf8").toString("base64") !== payload) return null;
        return plain;
      } catch {
        return null;
      }
    }
    try {
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    } catch {
      return null;
    }
  },
};

/**
 * El nivel de custodia real de la agenda en esta máquina, para
 * la fila del ejecutor de Ajustes: el backend de safeStorage
 * (`dpapi` en Windows vía el proveedor del SO, el nombre del
 * keyring en Linux, `basic_text` si degradó a básico) o
 * `unavailable` si ni siquiera hay backend que nombrar.
 */
export function noticeAgendaCustody(): string {
  try {
    return safeStorage.getSelectedStorageBackend() ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

let clock: NoticeClock | null = null;
let vaultOpen: () => boolean = () => false;
let textsProvider: () => DispatchTexts = () => fallbackTexts;
let showTextProvider: () => Promise<boolean> = async () => true;

const KIND_FALLBACK: Record<NoticeKind, string> = {
  reminder: "Recordatorio",
  event: "Evento",
  timer: "Temporizador",
  birthday: "Cumpleaños",
  task: "Tarea",
};
const fallbackTexts: DispatchTexts = {
  kindTitle: (k) => KIND_FALLBACK[k],
  genericBody: () => "Tienes un aviso de NIDO",
  summaryTitle: () => "Avisos mientras no estabas",
  summaryBody: (n) => `${n} avisos mientras no estabas`,
};

const TIMER_REINFORCE_MS = 2 * 60_000;
const reinforcementTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * La segunda llamada del temporizador vencido: a los 2
 * minutos se re-lee la fila y solo se repite si sigue en
 * `fired` (nadie lo descartó). Una sola repetición por
 * temporizador; el temporizador de refuerzo no retiene el
 * proceso.
 */
function scheduleTimerReinforcement(fired: Notice[], texts: DispatchTexts, withText: boolean): void {
  for (const n of fired) {
    if (reinforcementTimers.has(n.id)) continue;
    const handle = setTimeout(() => {
      reinforcementTimers.delete(n.id);
      void (async () => {
        const row = await getNotice(n.id).catch(() => null);
        if (row && row.state === "fired") {
          await notifyNow(composeOsPayload(row, withText, texts));
        }
      })();
    }, TIMER_REINFORCE_MS);
    if (typeof handle === "object" && "unref" in handle) handle.unref();
    reinforcementTimers.set(n.id, handle);
  }
}

/**
 * Los textos del despacho desde las cadenas de la app (la
 * sección noticesDispatch de los locales, en el idioma de la
 * persona). Los sirve services, que conoce el idioma; aquí
 * solo se da la forma.
 */
export function dispatchTextsFromStrings(strings: unknown): DispatchTexts {
  const d = (strings as { noticesDispatch?: Record<string, string> })?.noticesDispatch ?? {};
  const fill = (tpl: string, n: number): string => tpl.replace("{count}", String(n));
  return {
    kindTitle: (k) => d[`${k}Title`] ?? KIND_FALLBACK[k],
    genericBody: (k) => d[`generic${k[0].toUpperCase()}${k.slice(1)}`] ?? "Tienes un aviso de NIDO",
    summaryTitle: (n) => fill(d.summaryTitle ?? "Avisos mientras no estabas", n),
    summaryBody: (n) => fill(d.summaryBody ?? "{count} avisos mientras no estabas", n),
    birthdayAge: (name, age) =>
      (d.birthdayAge ?? "{name} cumple {count} años")
        .replace("{name}", name)
        .replace("{count}", String(age)),
  };
}

/**
 * El camino de despertar del reloj y de cada retorno a la
 * vida: con la bóveda abierta, reconciliación, el despacho de
 * lo que acaba de vencer (a su hora) y la pasada de
 * recuperación de lo demás, con su resumen único al canal del
 * SO; con la bloqueada, anotar en la agenda lo vencido como
 * pendiente de presentar. Nunca lanza.
 */
export async function noticeReturnToLife(): Promise<void> {
  try {
    if (!vaultOpen()) {
      const agenda = await readNoticeAgenda();
      const now = Date.now();
      const dueIds = agenda.entries
        .filter((e) => e.nextFireAt <= now)
        .map((e) => e.id);
      if (dueIds.length > 0) {
        await setAgendaPending([...new Set([...agenda.pending, ...dueIds])]);
      }
      return;
    }
    await reconcileNoticeAgenda();
    const texts = textsProvider();
    const showText = await showTextProvider().catch(() => true);
    const now = Date.now();
    const dispatched = await runDispatchPass(now, {
      vaultOpen: true,
      showText,
      texts,
      osSink: (p) => notifyNow(p),
    });
    const caught = await runCatchUpPass(now, () => undefined);
    for (const p of summarizeCatchUp(caught.presented, showText, texts)) {
      await notifyNow(p);
    }
    // E8 (paso 7): el previo derivado del cumpleaños, si su
    // instante llegó y el principal aún está por venir.
    await runPrePass(now, {
      vaultOpen: true,
      showText,
      texts,
      osSink: (p) => notifyNow(p),
    });
    // E8 (paso 5): el temporizador vencido reclama atención
    // reforzada (§5.3): una segunda notificación a los 2
    // minutos si nadie lo ha descartado, y nada más.
    scheduleTimerReinforcement(
      [
        ...dispatched.fired.filter((n) => n.kind === "timer"),
        ...caught.presented.filter((i) => i.treatment === "timer-expired").map((i) => i.notice),
      ],
      texts,
      showText,
    );
    await setAgendaPending([]);
  } catch {
    // El ejecutor nunca tumba al principal: la siguiente
    // pasada (desbloqueo, rearme, reanudación) lo repone.
  }
}

/**
 * Arranca el ejecutor: agenda configurada bajo el userData,
 * reloj en marcha y gancho de la cola registrado. Se llama
 * una vez desde installServices; el reloj corre también con
 * la bóveda bloqueada, leyendo solo la agenda.
 */
export function startNoticeRuntime(deps: {
  isVaultOpen: () => boolean;
  texts?: () => DispatchTexts;
  showText?: () => Promise<boolean>;
}): void {
  if (clock) return;
  vaultOpen = deps.isVaultOpen;
  if (deps.texts) textsProvider = deps.texts;
  if (deps.showText) showTextProvider = deps.showText;
  configureNoticeAgenda({
    filePath: join(app.getPath("userData"), "notice-agenda.bin"),
    cipher: safeStorageCipher,
  });
  clock = new NoticeClock({
    now: () => Date.now(),
    monotonic: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    nextDueAt: async () => {
      const agenda = await readNoticeAgenda();
      if (agenda.entries.length === 0) return null;
      return Math.min(...agenda.entries.map((e) => e.nextFireAt));
    },
    onWake: async () => {
      await noticeReturnToLife();
    },
  });
  setNoticeRuntimePoke(() => {
    void clock?.recalculate();
  });
  // El gancho de energía es opcional: si la plataforma (o un
  // doble de Electron en una batería) no lo expone, el reloj
  // sigue sin él; el ejecutor nunca tumba al principal por un
  // gancho que falta.
  try {
    powerMonitor.on("resume", () => {
      void noticeReturnToLife().then(() => clock?.recalculate());
    });
  } catch {
    // Sin powerMonitor: los retornos a la vida llegan por el
    // arranque y el desbloqueo, que ya están cableados.
  }
  clock.start();
  void noticeReturnToLife();
}

/** Al desbloquear la bóveda: la pasada presenta lo debido. */
export async function noticeVaultUnlocked(): Promise<void> {
  await noticeReturnToLife();
  await clock?.recalculate();
}
