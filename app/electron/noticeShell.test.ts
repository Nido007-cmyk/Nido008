/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * E8 (paso 6): la batería de la carcasa de avisos, con dobles
 * de Electron (la pierna de entorno real — Xvfb, bus propio y
 * dunst — es la prueba de humo del paso, registrada aparte):
 *
 * 1. El estado del menú de la bandeja se compone solo con
 *    horas y números (decisión 1): próximo aviso, fin del
 *    temporizador, contador de sin atender, y su línea de
 *    vacío.
 * 2. El menú lleva el orden firmado: estado no accionable,
 *    las tres acciones, Salir al final separado.
 * 3. La bandeja existe solo con el residente encendido, y la
 *    caché que la carcasa consulta lo refleja.
 * 4. El sumidero del SO enseña la notificación y su clic
 *    emite nido:notices-show hacia la vista de Avisos.
 * 5. T-18 (pierna Linux): el arranque con el sistema escribe
 *    su fichero de autostart y el estado enseñado se lee del
 *    fichero, no del interruptor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const harness = vi.hoisted(() => ({
  trays: [] as Array<{
    menu: Array<{ label?: string; enabled?: boolean; type?: string }> | null;
    tooltip: string;
    destroyed: boolean;
    clickHandlers: Array<() => void>;
  }>,
  notifications: [] as Array<{
    title: string;
    body: string;
    actions: Array<{ type: string; text: string }>;
    shown: boolean;
    handlers: Map<string, (...args: never[]) => void>;
  }>,
  sent: [] as Array<{ channel: string; payload: unknown }>,
  quitCalls: 0,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/nido/app",
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: () => undefined,
    quit: () => {
      harness.quitCalls++;
    },
  },
  Menu: { buildFromTemplate: (items: unknown) => items },
  Tray: class {
    menu: Array<{ label?: string; enabled?: boolean; type?: string }> | null = null;
    tooltip = "";
    destroyed = false;
    clickHandlers: Array<() => void> = [];
    constructor() {
      harness.trays.push(this as never);
    }
    setContextMenu(menu: never) {
      this.menu = menu as never;
    }
    setToolTip(t: string) {
      this.tooltip = t;
    }
    on(_e: string, cb: () => void) {
      this.clickHandlers.push(cb);
    }
    destroy() {
      this.destroyed = true;
    }
  },
  Notification: class {
    static isSupported = () => true;
    title: string;
    body: string;
    actions: Array<{ type: string; text: string }>;
    shown = false;
    handlers = new Map<string, (...args: never[]) => void>();
    constructor(opts: { title: string; body: string; actions?: Array<{ type: string; text: string }> }) {
      this.title = opts.title;
      this.body = opts.body;
      this.actions = opts.actions ?? [];
      harness.notifications.push(this as never);
    }
    on(e: string, cb: (...args: never[]) => void) {
      this.handlers.set(e, cb);
    }
    show() {
      this.shown = true;
    }
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => false }),
    createEmpty: () => ({ isEmpty: () => true }),
  },
}));

const fakeWin = {
  webContents: {
    send: (channel: string, payload: unknown) => harness.sent.push({ channel, payload }),
  },
  isMinimized: () => false,
  restore: () => undefined,
  show: () => undefined,
  focus: () => undefined,
};
vi.mock("./shell.ts", () => ({
  getMainWindow: () => fakeWin,
  showMainWindow: () => undefined,
}));

import {
  applyAutostart,
  applyResidentSetting,
  autostartEnabledNow,
  autostartFilePath,
  composeTrayStatus,
  desktopEntryContents,
  installNoticeShell,
  residentEnabledSync,
  trayTextsFromStrings,
  type TrayTexts,
} from "./noticeShell.js";
import { notifyNow } from "../../src/notify/notifications.js";

const TEXTS: TrayTexts = trayTextsFromStrings({
  noticesTray: {
    statusNext: "Próximo aviso: {when}",
    statusTimer: "Un temporizador termina a las {time}",
    statusUnattended: "{count} avisos sin atender",
    statusNone: "Sin avisos próximos",
    whenToday: "hoy a las {time}",
    whenTomorrow: "mañana a las {time}",
    whenDate: "el {date} a las {time}",
    newChat: "Chat nuevo",
    emergency: "Emergencia",
    open: "Abrir NIDO",
    quit: "Salir",
  },
  noticesView: { done: "Hecho", snooze: "Posponer", discard: "Descartar", pause: "Pausar", resume: "Reanudar" },
});

const NOW = new Date(2026, 2, 2, 10, 0, 0).getTime();
const deps = {
  texts: () => TEXTS,
  status: async () => ({
    nextFireAt: new Date(2026, 2, 2, 18, 30, 0).getTime(),
    nearestTimerEnd: new Date(2026, 2, 2, 10, 15, 0).getTime(),
    unattended: 2,
    now: NOW,
  }),
  onNotificationAction: async () => undefined,
};

beforeEach(() => {
  harness.trays.length = 0;
  harness.notifications.length = 0;
  harness.sent.length = 0;
  harness.quitCalls = 0;
});

describe("E8 paso 6: la carcasa de avisos", () => {
  it("el estado del menú solo lleva horas y números, en su orden", () => {
    const lines = composeTrayStatus(
      {
        nextFireAt: new Date(2026, 2, 3, 9, 0, 0).getTime(),
        nearestTimerEnd: new Date(2026, 2, 2, 10, 15, 0).getTime(),
        unattended: 2,
        now: NOW,
      },
      TEXTS,
    );
    expect(lines).toEqual([
      "Próximo aviso: mañana a las 09:00",
      "Un temporizador termina a las 10:15",
      "2 avisos sin atender",
    ]);
    expect(composeTrayStatus({ nextFireAt: null, nearestTimerEnd: null, unattended: 0, now: NOW }, TEXTS)).toEqual([
      "Sin avisos próximos",
    ]);
  });

  it("la bandeja existe solo con el residente, con su menú firmado, y la caché lo refleja", async () => {
    installNoticeShell(deps, false);
    expect(residentEnabledSync()).toBe(false);
    expect(harness.trays).toHaveLength(0);
    applyResidentSetting(true);
    expect(residentEnabledSync()).toBe(true);
    expect(harness.trays).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    const menu = harness.trays[0].menu ?? [];
    const labels = menu.map((i) => i.label ?? i.type ?? "");
    expect(labels[0]).toBe("Próximo aviso: hoy a las 18:30");
    expect(menu[0].enabled).toBe(false);
    expect(labels).toContain("Chat nuevo");
    expect(labels).toContain("Emergencia");
    expect(labels).toContain("Abrir NIDO");
    expect(labels[labels.length - 1]).toBe("Salir");
    applyResidentSetting(false);
    expect(residentEnabledSync()).toBe(false);
    expect(harness.trays[0].destroyed).toBe(true);
  });

  it("el sumidero del SO enseña la notificación y su clic lleva a la vista de Avisos", async () => {
    installNoticeShell(deps, false);
    await notifyNow({ title: "Recordatorio", body: "Regar las plantas", noticeId: "n1", kind: "reminder", actions: ["done", "snooze", "view"] });
    expect(harness.notifications).toHaveLength(1);
    const n = harness.notifications[0];
    expect(n.shown).toBe(true);
    expect(n.title).toBe("Recordatorio");
    // El botón «Ver» no va como botón: es el propio clic.
    expect(n.actions.map((a) => a.text)).toEqual(["Hecho", "Posponer"]);
    n.handlers.get("click")?.();
    expect(harness.sent).toEqual([{ channel: "nido:notices-show", payload: { target: "notices" } }]);
  });

  it("T-18 (Linux): el arranque escribe su fichero y el estado se lee del fichero", () => {
    if (process.platform !== "linux") return;
    const home = mkdtempSync(join(tmpdir(), "nido-e8autostart-"));
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(autostartEnabledNow()).toBe(false);
      applyAutostart(true);
      expect(autostartEnabledNow()).toBe(true);
      const content = readFileSync(autostartFilePath(home), "utf8");
      expect(content).toBe(desktopEntryContents(content.match(/^Exec=(.*)$/m)?.[1] ?? ""));
      expect(content).toContain("Name=NIDO PC");
      applyAutostart(false);
      expect(autostartEnabledNow()).toBe(false);
      expect(existsSync(autostartFilePath(home))).toBe(false);
    } finally {
      process.env.HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  applyResidentSetting(false);
});
