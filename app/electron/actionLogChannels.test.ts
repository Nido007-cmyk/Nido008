/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de canales de la cura O-12 (cadena de curas, acto 6):
 * el historial de acciones del agente llega a la tarjeta de
 * permisos por tres canales nuevos, con la sesión primero y el
 * fallo cerrado, como los de memoria y tareas.
 *
 * 1. La lista: lo registrado con la persistencia arrancada en
 *    installServices vuelve por nido:action-log-list, lo más
 *    reciente primero y con sus campos (herramienta, desenlace,
 *    confirmación y referencia de deshacer).
 * 2. El deshacer tras el reinicio: una nota creada y registrada
 *    se deshace por nido:action-log-undo DESPUÉS de reinstalar
 *    los servicios y reabrir la bóveda sobre el mismo userData:
 *    la nota desaparece y la entrada queda marcada deshecha.
 *    Este es el cargo de persistencia de verdad del acto.
 * 3. El borrado: nido:action-log-clear vacía el historial y la
 *    lista siguiente vuelve vacía.
 * 4. Sin sesión, los tres canales responden locked y nada se
 *    lee, se deshace ni se borra.
 *
 * Nacen en rojo contra la punta sin la pieza: los canales no
 * existen y la persistencia no arranca en installServices.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
  },
  BrowserWindow: {
    fromWebContents: () => ({
      isDestroyed: () => false,
      webContents: { send: () => undefined },
    }),
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      harness.handlers.set(channel, fn as never);
    },
    on: (channel: string, fn: unknown) => {
      harness.listeners.set(channel, fn as never);
    },
  },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined },
}));

vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import * as memoryStore from "../../src/agent/memory/memoryStore.js";
import { actionLog } from "../../src/agent/actionLog.js";
import { listActions } from "../../src/agent/actionLogStore.js";

const PASSWORD = "sonda-o12-historial";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type Reply = { ok: boolean; reason?: string };
type StoredRow = {
  id: number;
  tool: string;
  outcome: string;
  confirmed: boolean;
  undone: boolean;
  undo?: { kind: string; id: string };
};
type ListReply = Reply & { actions?: StoredRow[] };

function call(channel: string, args?: unknown): Promise<Reply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<Reply>;
}

function callList(): Promise<ListReply> {
  return call("nido:action-log-list") as Promise<ListReply>;
}

/** El sink guarda en segundo plano: se espera a que la fila exista. */
async function esperaGuardada(tool: string): Promise<StoredRow> {
  let found: StoredRow | undefined;
  await vi.waitFor(
    async () => {
      found = (await listActions(50)).find((a) => a.tool === tool);
      expect(found).toBeDefined();
    },
    { timeout: 15_000, interval: 100 },
  );
  return found!;
}

async function reiniciarServicios(): Promise<void> {
  await call("nido:vault-lock");
  await installServices();
  const un = await call("nido:vault-unlock", { password: PASSWORD });
  expect(un.ok).toBe(true);
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-o12-historial-"));
  await installServices();
  const created = await call("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("O-12 · el historial del agente por sus canales", () => {
  it("la lista trae lo registrado, lo más reciente primero y con sus campos", async () => {
    actionLog.record("device_time", "executed");
    actionLog.record("save_fact", "blocked", true);
    await esperaGuardada("device_time");
    await esperaGuardada("save_fact");
    const r = await callList();
    expect(r.ok).toBe(true);
    const mine = (r.actions ?? []).filter((a) => a.tool === "device_time" || a.tool === "save_fact");
    expect(mine.map((a) => a.tool)).toEqual(["save_fact", "device_time"]);
    expect(mine[0].outcome).toBe("blocked");
    expect(mine[0].confirmed).toBe(true);
    expect(mine[1].outcome).toBe("executed");
  }, 60_000);

  it("el deshacer tras el reinicio borra lo creado y marca la entrada", async () => {
    const note = await memoryStore.saveNote({ title: "Nota del historial", body: "cuerpo" });
    actionLog.noteUndo("save_note", { kind: "note", id: note.id });
    actionLog.record("save_note", "executed");
    const row = await esperaGuardada("save_note");

    await reiniciarServicios();

    const undo = await call("nido:action-log-undo", { id: row.id });
    expect(undo.ok).toBe(true);
    expect(await memoryStore.getNote(note.id)).toBeNull();
    const r = await callList();
    const back = (r.actions ?? []).find((a) => a.id === row.id);
    expect(back?.undone).toBe(true);
  }, 120_000);

  it("el borrado vacía el historial", async () => {
    actionLog.record("device_time", "executed");
    await esperaGuardada("device_time");
    const clear = await call("nido:action-log-clear");
    expect(clear.ok).toBe(true);
    const r = await callList();
    expect(r.ok).toBe(true);
    expect(r.actions).toEqual([]);
  }, 60_000);

  it("sin sesión, los tres canales responden locked", async () => {
    const locked = await call("nido:vault-lock");
    expect(locked.ok).toBe(true);
    const list = await callList();
    expect(list.ok).toBe(false);
    expect(list.reason).toBe("locked");
    const undo = await call("nido:action-log-undo", { id: 1 });
    expect(undo.ok).toBe(false);
    expect(undo.reason).toBe("locked");
    const clear = await call("nido:action-log-clear");
    expect(clear.ok).toBe(false);
    expect(clear.reason).toBe("locked");
  }, 60_000);
});
