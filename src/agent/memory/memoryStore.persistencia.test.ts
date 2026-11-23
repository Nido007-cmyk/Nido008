/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la cura H-01 (cadena de curas, acto 5): la memoria
 * del agente PERSISTE. Contra la costura en memoria esta batería
 * nace roja entera: lo guardado vive en el proceso y un reinicio
 * (cerrar la base, resetear los módulos y reimportar, el arnés
 * de base real de contactsReal) lo pierde todo. Contra el
 * almacén portado del móvil (H-01) cada caso cobra lo mismo que
 * la batería del móvil cobra allí: la nota, el recordatorio con
 * su ritmo, la fusión de hechos, la cerca de los hechos de peer
 * fuera del snapshot, la persona por nombre, la preferencia, el
 * diario y el avance del recordatorio repetido sobreviven al
 * reinicio porque viven en la base cifrada, no en el proceso.
 *
 * El arnés trabaja siempre por importaciones dinámicas: tras un
 * `vi.resetModules()` las importaciones estáticas del fichero
 * quedan apuntando a la encarnación anterior de los módulos, así
 * que cada encarnación (la inicial y cada reinicio) se carga de
 * nuevo y se le reaplican el directorio y la DEK de prueba.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

type Store = typeof import("./memoryStore.js");
type Dbm = typeof import("../../security/databaseManager.js");
type AppStore = typeof import("../../security/appStore.js");

let dir: string;
const KEY = randomBytes(32);
let store: Store;
let dbm: Dbm;
let appStore: AppStore;

/** Una encarnación nueva de los módulos sobre el mismo directorio. */
async function encarnacion(): Promise<Store> {
  vi.resetModules();
  appStore = await import("../../security/appStore.js");
  dbm = await import("../../security/databaseManager.js");
  appStore.setAppStoreDir(dir);
  appStore.setAppStoreDekProvider(() => Buffer.from(KEY));
  store = await import("./memoryStore.js");
  return store;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "nido-h01-"));
  await encarnacion();
});

afterEach(async () => {
  await dbm.closeDatabase();
  appStore.setAppStoreDekProvider(null);
  appStore.setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

/** El reinicio: la base se cierra y los módulos nacen de nuevo
 *  sobre el mismo directorio; solo lo persistido sobrevive. */
async function reiniciar(): Promise<Store> {
  await dbm.closeDatabase();
  return encarnacion();
}

describe("H-01 · la memoria persiste en la base cifrada", () => {
  it("la nota guardada se lee tras el reinicio", async () => {
    const note = await store.saveNote({ title: "Taller", body: "El taller cierra los lunes" });
    await reiniciar();
    const notes = await store.listNotes(50);
    expect(notes.map((n) => n.id)).toContain(note.id);
    const back = await store.getNote(note.id);
    expect(back?.title).toBe("Taller");
    expect(back?.body).toBe("El taller cierra los lunes");
  });

  it("el recordatorio con ritmo se lee tras el reinicio, con su ritmo", async () => {
    const r = await store.saveReminder({
      text: "Regar las plantas",
      dueAt: "2026-12-01T09:00:00.000Z",
      repeat: "week",
    });
    expect(r.repeat).toBe("week");
    await reiniciar();
    const all = await store.listReminders(50);
    const back = all.find((x) => x.id === r.id);
    expect(back).toBeDefined();
    expect(back?.repeat).toBe("week");
    expect(back?.due_at).toBe("2026-12-01T09:00:00.000Z");
  });

  it("el hecho casi duplicado se fusiona, y la fusión persiste tras el reinicio", async () => {
    await store.saveFact({ content: "Mi perro se llama Toby" });
    const merged = await store.saveFact({ content: "Mi perro se llama Toby y es café" });
    expect(merged.content).toBe("Mi perro se llama Toby y es café");
    await reiniciar();
    const facts = await store.getFacts(50);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Mi perro se llama Toby y es café");
  });

  it("el hecho de un par no entra en el snapshot, ni tras el reinicio", async () => {
    await store.saveFact({ content: "Mi color favorito es el verde", source: "user" });
    await store.saveFact({ content: "Dato remoto no confiable", source: "peer" });
    const snap1 = await store.snapshot();
    expect(snap1.facts.map((f) => f.content)).toEqual(["Mi color favorito es el verde"]);
    await reiniciar();
    const snap2 = await store.snapshot();
    expect(snap2.facts.map((f) => f.content)).toEqual(["Mi color favorito es el verde"]);
    // El dato del par sigue guardado como suyo: solo queda fuera del contexto.
    expect((await store.getFacts(50)).map((f) => f.content)).toContain("Dato remoto no confiable");
  });

  it("la persona se actualiza por nombre y la actualización persiste", async () => {
    const a = await store.savePerson({ name: "Carmen Ruiz", relationship: "hermana" });
    const b = await store.savePerson({ name: "carmen ruiz", notes: "Le gustan los tulipanes" });
    expect(b.id).toBe(a.id);
    await reiniciar();
    const people = await store.getPeople();
    expect(people).toHaveLength(1);
    expect(people[0].relationship).toBe("hermana");
    expect(people[0].notes).toBe("Le gustan los tulipanes");
  });

  it("la preferencia se lee tras el reinicio", async () => {
    await store.setPreference("name", "Aldo");
    await reiniciar();
    expect(await store.getPreference("name")).toBe("Aldo");
  });

  it("la entrada del diario se lee tras el reinicio", async () => {
    await store.logDay("Hoy llegó el paquete", "2026-11-22");
    await reiniciar();
    const log = await store.getRecentLog(10);
    expect(log.map((e) => e.entry)).toContain("Hoy llegó el paquete");
    expect(log.find((e) => e.entry === "Hoy llegó el paquete")?.day).toBe("2026-11-22");
  });

  it("completar un recordatorio repetido avanza su fecha, y el avance persiste", async () => {
    const r = await store.saveReminder({
      text: "Pastillas",
      dueAt: "2026-12-01T09:00:00.000Z",
      repeat: "day",
    });
    await store.completeReminder(r.id, new Date("2026-12-01T10:00:00.000Z"));
    const after = (await store.listReminders(50)).find((x) => x.id === r.id);
    expect(after).toBeDefined();
    expect(after?.done).toBe(0);
    expect(after?.due_at).toBe("2026-12-02T09:00:00.000Z");
    await reiniciar();
    const back = (await store.listReminders(50)).find((x) => x.id === r.id);
    expect(back?.due_at).toBe("2026-12-02T09:00:00.000Z");
  });
});
