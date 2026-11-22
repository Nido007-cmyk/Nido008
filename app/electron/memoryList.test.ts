/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * §2 del bloque del loop (H-LOOP-5): lo guardado en memoria se
 * puede ver y borrar. Hasta esta pieza ningún sitio de la app
 * listaba los datos guardados ni permitía borrarlos: la sección
 * Memoria traía solo su explicación y el interruptor del
 * resumen, y las formas de `toolRouter` mandaban a «Mi memoria»,
 * que en PC no existía como lista. La cura es superficie y
 * puente (diseño DISENO-HLOOP5): dos canales nuevos sobre el
 * almacén que el chat ya usa, con los topes de la pantalla del
 * móvil (hechos 100, notas 50, personas todas, recordatorios
 * 50), y la fecha del recordatorio compuesta en el canal con la
 * misma `reminderWhen` del chat.
 *
 * Los tres cargos, con el arnés de servicios reales de la casa
 * (doble de Electron y manejadores reales cobrados por canal),
 * contra el almacén de escena sembrado por su propio módulo —
 * el mismo singleton que los manejadores despachan:
 *
 * 1. La lista devuelve las cuatro clases: sembrados un hecho,
 *    una nota, una persona y un recordatorio, `nido:memory-list`
 *    los devuelve los cuatro, cada uno en su clase y con sus
 *    campos de fila (el recordatorio, con su `dueLabel` ya
 *    compuesta en palabras).
 * 2. El borrado de cada clase: `nido:memory-delete` con cada
 *    `kind` quita su fila y la lista siguiente ya no la trae;
 *    las otras tres clases quedan intactas. Un `kind`
 *    desconocido responde `{ ok: false }` sin tocar nada.
 * 3. Sin sesión, `locked` en los dos canales: con la bóveda
 *    cerrada, `nido:memory-list` y `nido:memory-delete`
 *    responden `{ ok: false, reason: "locked" }` y nada se lee
 *    ni se borra (la fila sembrada sigue en el almacén).
 *
 * Los tres nacen en rojo contra la punta sin la pieza: los
 * canales no existen y el arnés lo cobra al invocarlos.
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
import { reminderWhen } from "../../src/agent/loop/toolRouter.js";

const PASSWORD = "sonda-loop2-memoria";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type FactRow = { id: string; content: string };
type NoteRow = { id: string; title: string; body: string };
type PersonRow = { id: string; name: string; notes?: string };
type ReminderRow = {
  id: string;
  text: string;
  due_at: string | null;
  repeat?: string | null;
  done: number;
  dueLabel: string | null;
};
type ListReply = {
  ok: boolean;
  reason?: string;
  facts?: FactRow[];
  notes?: NoteRow[];
  people?: PersonRow[];
  reminders?: ReminderRow[];
};
type Reply = { ok: boolean; reason?: string };

function callList(): Promise<ListReply> {
  const fn = harness.handlers.get("nido:memory-list");
  if (!fn) throw new Error("sin manejador registrado: nido:memory-list");
  return fn(event, undefined) as Promise<ListReply>;
}

function call(channel: string, args?: unknown): Promise<Reply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<Reply>;
}

const DUE_AT = "2026-11-25T15:30:00.000Z";

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-loop2-memoria-"));
  await installServices();
  const created = await call("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("§2 · la vista de Memoria: la lista y el borrado por los canales", () => {
  it("la lista devuelve las cuatro clases, cada una con sus campos de fila", async () => {
    const fact = await memoryStore.saveFact({ content: "Mi color favorito es el verde" });
    const note = await memoryStore.saveNote({
      title: "Taller",
      body: "El taller cierra los lunes",
    });
    const person = await memoryStore.savePerson({
      name: "Carmen",
      notes: "Le gustan las orquídeas",
    });
    const reminder = await memoryStore.saveReminder({
      text: "Regar las plantas",
      dueAt: DUE_AT,
      repeat: "week",
    });

    const r = await callList();
    expect(r.ok).toBe(true);
    expect(r.facts).toHaveLength(1);
    expect(r.facts?.[0].id).toBe(fact.id);
    expect(r.facts?.[0].content).toBe("Mi color favorito es el verde");
    expect(r.notes).toHaveLength(1);
    expect(r.notes?.[0].id).toBe(note.id);
    expect(r.notes?.[0].title).toBe("Taller");
    expect(r.notes?.[0].body).toBe("El taller cierra los lunes");
    expect(r.people).toHaveLength(1);
    expect(r.people?.[0].id).toBe(person.id);
    expect(r.people?.[0].name).toBe("Carmen");
    expect(r.people?.[0].notes).toBe("Le gustan las orquídeas");
    expect(r.reminders).toHaveLength(1);
    expect(r.reminders?.[0].id).toBe(reminder.id);
    expect(r.reminders?.[0].text).toBe("Regar las plantas");
    expect(r.reminders?.[0].due_at).toBe(DUE_AT);
    expect(r.reminders?.[0].repeat).toBe("week");
    // La fecha llega compuesta en palabras por el canal, con la
    // misma función del chat y el idioma de la sesión (el de la
    // escena, español), lista para pintar: recortada y con su
    // primera letra en mayúscula, como la pinta el móvil.
    const when = reminderWhen(DUE_AT, "es").trim();
    expect(r.reminders?.[0].dueLabel).toBe(when.charAt(0).toUpperCase() + when.slice(1));
  });

  it("el borrado de cada clase quita su fila y las otras tres quedan intactas", async () => {
    // La escena viene del cargo anterior: una fila por clase.
    const before = await callList();
    expect(before.ok).toBe(true);
    const ids = {
      fact: before.facts![0].id,
      note: before.notes![0].id,
      person: before.people![0].id,
      reminder: before.reminders![0].id,
    };

    // Un kind desconocido no toca nada.
    const bogus = await call("nido:memory-delete", { kind: "bogus", id: ids.fact });
    expect(bogus.ok).toBe(false);
    const afterBogus = await callList();
    expect(afterBogus.facts).toHaveLength(1);

    const kinds = [
      ["fact", "facts"],
      ["note", "notes"],
      ["person", "people"],
      ["reminder", "reminders"],
    ] as const;
    const deleted = new Set<string>();
    for (const [kind, field] of kinds) {
      const del = await call("nido:memory-delete", { kind, id: ids[kind] });
      expect(del.ok).toBe(true);
      deleted.add(field);
      const after = await callList();
      expect(after.ok).toBe(true);
      for (const [, f] of kinds) {
        expect(after[f]).toHaveLength(deleted.has(f) ? 0 : 1);
      }
    }
    const end = await callList();
    expect(end.facts).toHaveLength(0);
    expect(end.notes).toHaveLength(0);
    expect(end.people).toHaveLength(0);
    expect(end.reminders).toHaveLength(0);
  });

  it("sin sesión, los dos canales responden locked y nada se lee ni se borra", async () => {
    const fact = await memoryStore.saveFact({ content: "Dato que nadie borra sin sesión" });
    const locked = await call("nido:vault-lock");
    expect(locked.ok).toBe(true);

    const list = await callList();
    expect(list.ok).toBe(false);
    expect(list.reason).toBe("locked");

    const del = await call("nido:memory-delete", { kind: "fact", id: fact.id });
    expect(del.ok).toBe(false);
    expect(del.reason).toBe("locked");

    // El almacén conserva la fila: el borrado bloqueado no la tocó.
    const still = await memoryStore.getFacts(100);
    expect(still.some((f) => f.id === fact.id)).toBe(true);
  });
});
