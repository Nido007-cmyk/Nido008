/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * notifications.ts — el programador real de avisos de E8.
 *
 * Hasta E7 esto fue la costura S-1: programar devolvía `false`
 * siempre porque no existía ejecutor. La sustitución llega por
 * pasos (2 a 4 de E8, en la forma exacta de la apertura): este
 * paso arma los recordatorios sobre la cola de avisos de la
 * base cifrada (noticeStore, la única escritura), con su espejo
 * en la agenda de disparo, y el reloj de producción del paso 3
 * los dispara a su hora. Programar devuelve `true` solo si el
 * aviso quedó armado en la base; si la base no está disponible
 * (bóveda bloqueada o sin abrir), devuelve `false` y el
 * llamante cae a su aviso verdadero, como con la costura. Nada
 * se finge programado.
 *
 * El recordatorio de la vía rápida vive en el almacén en
 * memoria con su id propio: el aviso se enlaza estampando
 * `body.reminderId`, y si el handler de herramientas ya armó el
 * aviso del mismo recordatorio (mismo texto, misma hora local
 * y mismo ritmo), se enlaza ese en vez de duplicarlo.
 */

import {
  armNotice,
  disarmByRef,
  disarmNotice,
  disarmReminderByLink,
  disarmTimerByLink,
  listArmed,
  stampReminderLink,
  toBaseLocal,
} from "../agent/memory/noticeStore.js";

function bodyField(body: unknown, field: string): unknown {
  if (body && typeof body === "object") {
    return (body as Record<string, unknown>)[field];
  }
  return undefined;
}

export async function scheduleReminderNotification(
  id: string,
  text: string,
  when: Date,
  repeat?: "day" | "week" | "month" | "year" | null,
): Promise<boolean> {
  try {
    const baseLocal = toBaseLocal(when);
    const wantedRepeat = repeat ?? null;
    const existing = (await listArmed()).find(
      (n) =>
        n.kind === "reminder" &&
        n.baseLocal === baseLocal &&
        n.repeat === wantedRepeat &&
        bodyField(n.body, "text") === text,
    );
    if (existing) {
      if (bodyField(existing.body, "reminderId") !== id) {
        await stampReminderLink(existing.id, id);
      }
      return true;
    }
    await armNotice({
      kind: "reminder",
      body: { text, reminderId: id },
      baseLocal,
      repeat: wantedRepeat,
    });
    return true;
  } catch {
    // Sin base disponible no hay aviso: el llamante lo dice.
    return false;
  }
}

export async function cancelReminderNotification(id: string): Promise<void> {
  try {
    await disarmReminderByLink(id);
    // El mismo id puede ser un temporizador de la vía rápida:
    // su aviso es de kind `timer` y se desarma por su enlace.
    await disarmTimerByLink(id);
  } catch {
    // Cancelar nunca lanza: si la base no está, no hay aviso
    // armado que este id pudiera haber creado en esta sesión.
  }
}

/**
 * E8 (paso 5): el temporizador de la vía rápida se arma como
 * aviso de kind `timer` con su fin absoluto (`endsAt`), no
 * como un recordatorio más: su trato al vencer es el de §6
 * (anunciado como vencido, fila `fired` persistente, despacho
 * reforzado). El enlace es `body.timerId`, en el mismo espacio
 * de ids del almacén en memoria. Devuelve `true` solo si quedó
 * armado; sin base, `false`, como el resto del programador.
 */
export async function scheduleTimerNotification(
  id: string,
  text: string,
  endsAt: Date,
): Promise<boolean> {
  try {
    const existing = (await listArmed()).find(
      (n) => n.kind === "timer" && bodyField(n.body, "timerId") === id,
    );
    if (existing) return true;
    await armNotice({
      kind: "timer",
      body: { text, timerId: id },
      baseLocal: toBaseLocal(endsAt),
      endsAt: endsAt.getTime(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelTimerNotification(id: string): Promise<void> {
  try {
    await disarmTimerByLink(id);
  } catch {
    // Como el resto de cancelaciones: nunca lanza.
  }
}

/**
 * E8 (paso 8): el aviso de una tarea programada es de kind
 * `task` con `refId` = el id de la tarea y el título y el
 * cuerpo que la superficie compuso. Armar con `at` nulo o ya
 * pasado desarma el que hubiera y devuelve `false`: no hay
 * próxima ejecución que anunciar. Con hora futura, sustituye
 * al armado anterior de la misma tarea (una tarea, un aviso).
 * Devuelve `true` solo si quedó armado; sin base, `false`.
 */
export async function scheduleTaskNotification(
  taskId: string,
  title: string,
  body: string,
  at: Date | null,
): Promise<boolean> {
  try {
    if (!at || at.getTime() <= Date.now()) {
      await disarmByRef("task", taskId);
      return false;
    }
    const baseLocal = toBaseLocal(at);
    const existing = (await listArmed()).find((n) => n.kind === "task" && n.refId === taskId);
    if (existing) {
      if (existing.baseLocal === baseLocal) return true;
      await disarmNotice(existing.id);
    }
    await armNotice({
      kind: "task",
      refId: taskId,
      body: { title, body },
      baseLocal,
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelTaskNotification(taskId: string): Promise<void> {
  try {
    await disarmByRef("task", taskId);
  } catch {
    // Cancelar nunca lanza.
  }
}

/**
 * E8 (paso 9, §9): ¿puede la confirmación prometer el aviso
 * del sistema a su hora? Solo con el residente encendido: es
 * lo que mantiene a NIDO vivo en la bandeja al cerrar la
 * ventana. Sin residente, la verdad es la otra frase («te
 * avisaré al abrir NIDO»): el aviso queda armado en la cola,
 * pero con la app cerrada no hay proceso que lo dispare.
 * Hasta el volteo de esta costura (pasos 2 a 4) programar
 * devolvía siempre false y la promesa nunca se hacía; con el
 * programador real, armar no basta para prometer: hace falta
 * el residente. Lo cazó la foto de cierre (handlersLangParidad
 * esperaba la frase de al abrir en su entorno sin residente).
 */
export async function osNoticeWillFire(): Promise<boolean> {
  try {
    const { getNoticesResident } = await import("../models/settings.js");
    return (await getNoticesResident()) === true;
  } catch {
    return false;
  }
}

/**
 * El canal del SO inmediato: la carcasa (paso 6) registra aquí
 * su sumidero real (la Notification de Electron con sus
 * acciones); el despacho y cualquier aviso del momento pasan
 * por `notifyNow`. Sin sumidero registrado, es un no-op
 * silencioso, como en el móvil cuando el sistema no da
 * permiso: el canal interno ya guardó el aviso, que es el
 * canal garantizado.
 */
export interface OsNotificationPayload {
  title: string;
  body: string;
  noticeId?: string;
  kind?: string;
  actions?: string[];
}

type OsNotificationSink = (payload: OsNotificationPayload) => Promise<void> | void;

let osSink: OsNotificationSink | null = null;

export function setOsNotificationSink(fn: OsNotificationSink | null): void {
  osSink = fn;
}

export async function notifyNow(payload: OsNotificationPayload): Promise<void> {
  try {
    await osSink?.(payload);
  } catch {
    // El canal del SO nunca tumba a quien avisa.
  }
}
