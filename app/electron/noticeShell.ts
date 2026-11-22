/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * E8 (paso 6): la carcasa de los avisos — las dos piezas de
 * Electron que el ejecutor consume, en el proceso principal y
 * sobre la carcasa de E1 (E8-APERTURA §5):
 *
 * - `Tray`: el icono residente, que existe SOLO con el permiso
 *   de residente encendido (decisión 1, vía A: la bandeja es la
 *   casa del residente, no un adorno de la app abierta). Su
 *   menú lleva, en orden: el estado como texto no accionable
 *   (solo horas y números: el menú es superficie del SO, fuera
 *   del cifrado, y hereda la disciplina de la agenda), las tres
 *   acciones del diseño (chat nuevo, emergencia, abrir) y
 *   Salir al final, separado: la puerta de revocación del
 *   residente.
 * - `Notification`: el canal del SO del despacho. Se registra
 *   como sumidero de `setOsNotificationSink` (la costura del
 *   paso 4); su clic enseña la ventana y emite
 *   `nido:notices-show` hacia la vista de Avisos (decisión 2:
 *   el «Ver»); sus botones, donde la plataforma los deja,
 *   actúan sobre la cola por la dependencia que services
 *   inyecta. En Linux las acciones viven en el aviso interno,
 *   como la decisión dejó firmado.
 *
 * El residente es este mismo proceso principal con la ventana
 * oculta: shell.ts consulta `residentEnabledSync()` al cerrar
 * la ventana y en `window-all-closed`. El arranque con el
 * sistema se escribe en su fuente real (el fichero de
 * autostart en Linux; `setLoginItemSettings` en Windows y
 * macOS) y el estado que Ajustes enseña se lee de esa misma
 * fuente (T-18), nunca del interruptor guardado.
 */
import { app, Menu, Notification, Tray, nativeImage } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  setOsNotificationSink,
  type OsNotificationPayload,
} from "../../src/notify/notifications.js";
import { getMainWindow, showMainWindow } from "./shell.js";

// ---------------------------------------------------------------------
// Los textos, desde los locales (los sirve services).
// ---------------------------------------------------------------------
export interface TrayTexts {
  /** «Próximo aviso: {when}» — when ya viene compuesto. */
  statusNext: string;
  /** «Un temporizador termina a las {time}». */
  statusTimer: string;
  /** «{count} avisos sin atender». */
  statusUnattended: string;
  /** Sin nada programado ni pendiente. */
  statusNone: string;
  whenToday: string;
  whenTomorrow: string;
  whenDate: string;
  newChat: string;
  emergency: string;
  open: string;
  quit: string;
  /** Las etiquetas de los botones de la notificación, por id de acción. */
  actionLabels: Record<string, string>;
}

/** La hora de un instante, HH:MM en la zona de la persona. */
export function timeLabel(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * «hoy a las 9:00», «mañana a las 9:00», «el 12/03 a las 9:00»:
 * el cuándo del estado de la bandeja, solo horas y números.
 */
export function whenLabel(at: number, now: number, texts: TrayTexts): string {
  const day = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const time = timeLabel(at);
  if (day(at) === day(now)) return texts.whenToday.replace("{time}", time);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(at) === day(tomorrow.getTime())) return texts.whenTomorrow.replace("{time}", time);
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return texts.whenDate
    .replace("{date}", `${p(d.getDate())}/${p(d.getMonth() + 1)}`)
    .replace("{time}", time);
}

export interface TrayStatusInput {
  /** El próximo disparo de la agenda (cualquier familia), o null. */
  nextFireAt: number | null;
  /** El fin del temporizador armado más próximo, o null. */
  nearestTimerEnd: number | null;
  /** Avisos disparados y sin descartar. */
  unattended: number;
  now: number;
}

/**
 * Las líneas de estado del menú, en el orden de la decisión 1.
 * Función pura: solo horas y números entran en sus plantillas;
 * ningún texto ni nombre de la bóveda puede salir por aquí.
 */
export function composeTrayStatus(input: TrayStatusInput, texts: TrayTexts): string[] {
  const lines: string[] = [];
  if (input.nextFireAt !== null) {
    lines.push(texts.statusNext.replace("{when}", whenLabel(input.nextFireAt, input.now, texts)));
  }
  if (input.nearestTimerEnd !== null) {
    lines.push(texts.statusTimer.replace("{time}", timeLabel(input.nearestTimerEnd)));
  }
  if (input.unattended > 0) {
    lines.push(texts.statusUnattended.replace("{count}", String(input.unattended)));
  }
  if (lines.length === 0) lines.push(texts.statusNone);
  return lines;
}

/**
 * Los textos de la bandeja desde las cadenas de la app (la
 * sección noticesTray de los locales; las etiquetas de los
 * botones salen de la vista de Avisos, que ya las tiene).
 */
export function trayTextsFromStrings(strings: unknown): TrayTexts {
  const root = (strings ?? {}) as {
    noticesTray?: Record<string, string>;
    noticesView?: Record<string, string>;
  };
  const t = root.noticesTray ?? {};
  const v = root.noticesView ?? {};
  return {
    statusNext: t.statusNext ?? "Próximo aviso: {when}",
    statusTimer: t.statusTimer ?? "Un temporizador termina a las {time}",
    statusUnattended: t.statusUnattended ?? "{count} avisos sin atender",
    statusNone: t.statusNone ?? "Sin avisos próximos",
    whenToday: t.whenToday ?? "hoy a las {time}",
    whenTomorrow: t.whenTomorrow ?? "mañana a las {time}",
    whenDate: t.whenDate ?? "el {date} a las {time}",
    newChat: t.newChat ?? "Chat nuevo",
    emergency: t.emergency ?? "Emergencia",
    open: t.open ?? "Abrir NIDO",
    quit: t.quit ?? "Salir",
    actionLabels: {
      done: v.done ?? "Hecho",
      snooze: v.snooze ?? "Posponer",
      discard: v.discard ?? "Descartar",
      pause: v.pause ?? "Pausar",
      resume: v.resume ?? "Reanudar",
    },
  };
}

// ---------------------------------------------------------------------
// El arranque con el sistema (Linux: su fichero; su estado, el fichero).
// ---------------------------------------------------------------------
export function autostartFilePath(home: string = homedir()): string {
  return join(home, ".config", "autostart", "nido-pc.desktop");
}

export function desktopEntryContents(execLine: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=NIDO PC",
    "Comment=NIDO PC",
    `Exec=${execLine}`,
    "X-GNOME-Autostart-enabled=true",
    "NoDisplay=false",
    "",
  ].join("\n");
}

/** La línea de ejecución del arranque: el binario instalado; en desarrollo, Electron con la app. */
export function autostartExecLine(): string {
  const exe = process.execPath;
  if (app.isPackaged) return `"${exe}"`;
  return `"${exe}" "${app.getAppPath()}"`;
}

export function applyAutostart(on: boolean): void {
  if (process.platform === "linux") {
    const file = autostartFilePath();
    if (on) {
      mkdirSync(join(homedir(), ".config", "autostart"), { recursive: true });
      writeFileSync(file, desktopEntryContents(autostartExecLine()), "utf8");
    } else {
      rmSync(file, { force: true });
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on });
}

/** El estado real del arranque, leído de su fuente (T-18). */
export function autostartEnabledNow(): boolean {
  if (process.platform === "linux") return existsSync(autostartFilePath());
  return app.getLoginItemSettings().openAtLogin;
}

// ---------------------------------------------------------------------
// El residente: la caché síncrona que la carcasa consulta.
// ---------------------------------------------------------------------
let residentCache = false;
export function residentEnabledSync(): boolean {
  return residentCache;
}
export function setResidentCache(on: boolean): void {
  residentCache = on;
}

// ---------------------------------------------------------------------
// La instalación: bandeja, sumidero del SO y navegación.
// ---------------------------------------------------------------------
export interface NoticeShellDeps {
  texts: () => TrayTexts;
  /** Lo que la bandeja enseña: la agenda (horas) y el contador de sin atender. */
  status: () => Promise<TrayStatusInput>;
  /** Un botón de la notificación del SO actuó sobre un aviso. */
  onNotificationAction: (noticeId: string, action: string) => Promise<void>;
}

let deps: NoticeShellDeps | null = null;
let tray: Tray | null = null;
let menuTimer: ReturnType<typeof setInterval> | null = null;

function navigate(target: "notices" | "chat-new" | "emergency"): void {
  showMainWindow();
  const win = getMainWindow();
  if (win) win.webContents.send("nido:notices-show", { target });
}

async function rebuildTrayMenu(): Promise<void> {
  if (!tray || !deps) return;
  const texts = deps.texts();
  const status = await deps.status().catch(() => null);
  const lines = status ? composeTrayStatus(status, texts) : [texts.statusNone];
  const items: Electron.MenuItemConstructorOptions[] = [
    ...lines.map((label) => ({ label, enabled: false })),
    { type: "separator" as const },
    { label: texts.newChat, click: () => navigate("chat-new") },
    { label: texts.emergency, click: () => navigate("emergency") },
    { label: texts.open, click: () => showMainWindow() },
    { type: "separator" as const },
    { label: texts.quit, click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  if (status && status.unattended > 0) {
    tray.setToolTip(`NIDO PC · ${status.unattended}`);
  } else {
    tray.setToolTip("NIDO PC");
  }
}

function ensureTray(): void {
  if (tray || !deps) return;
  const iconPath = join(process.env.VITE_PUBLIC ?? "", "app-icon.png");
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip("NIDO PC");
  tray.on("click", () => showMainWindow());
  void rebuildTrayMenu();
  // El estado del menú se refresca con el tiempo: un menú
  // construido una vez enseñaría la hora de un aviso ya
  // disparado como si siguiera próximo.
  menuTimer = setInterval(() => void rebuildTrayMenu(), 60_000);
  if (typeof menuTimer === "object" && "unref" in menuTimer) menuTimer.unref();
}

function destroyTray(): void {
  if (menuTimer) {
    clearInterval(menuTimer);
    menuTimer = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Enseña una notificación del sistema. Su clic es el «Ver» de
 * la decisión 2: ventana visible y la vista de Avisos. Sus
 * botones actúan sobre la cola donde la plataforma los deja;
 * donde no, el aviso interno lleva las acciones.
 */
export function showOsNotification(payload: OsNotificationPayload): void {
  try {
    if (!Notification.isSupported()) return;
    const texts = deps?.texts();
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      actions: (payload.actions ?? [])
        .filter((a) => a !== "view")
        .map((a) => ({ type: "button" as const, text: texts?.actionLabels[a] ?? a })),
    });
    notification.on("click", () => navigate("notices"));
    notification.on("action", (_event, index) => {
      const action = (payload.actions ?? []).filter((a) => a !== "view")[index];
      if (action && payload.noticeId && deps) {
        void deps.onNotificationAction(payload.noticeId, action);
      }
    });
    notification.show();
  } catch {
    // El canal del SO nunca tumba el despacho: el aviso ya
    // quedó persistido en el canal interno.
  }
}

/**
 * Instala la carcasa de avisos: registra el sumidero del SO y
 * obedece el ajuste de residente ya guardado. Lo llama
 * services al arrancar, tras cargar las preferencias.
 */
export function installNoticeShell(d: NoticeShellDeps, residentOn: boolean): void {
  deps = d;
  setResidentCache(residentOn);
  setOsNotificationSink((payload) => showOsNotification(payload));
  if (residentOn) ensureTray();
}

/** Relee el ajuste de residente tras un cambio en Ajustes. */
export function applyResidentSetting(on: boolean): void {
  setResidentCache(on);
  if (on) ensureTray();
  else destroyTray();
  if (on) void rebuildTrayMenu();
}

/** Refresca el menú tras un cambio de la agenda o del contador. */
export function refreshTrayMenu(): void {
  if (tray) void rebuildTrayMenu();
}
