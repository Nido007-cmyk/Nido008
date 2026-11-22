/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 2 de E8: la agenda de disparo (capa 2 de
 * AVISOS §3.2) contra la base cifrada real, con un cifrado de
 * máquina de doble (AES-GCM con clave fija: lo que se prueba
 * es la forma de la capa, no la custodia del SO, que es del
 * tiempo de ejecución). Puerta del paso: T-9 (la reconciliación
 * en los dos sentidos y el instante derivado) y la pierna de
 * avisos de T-19 (el borrado total elimina avisos y agenda),
 * más el arranque de la sustitución de la costura S-1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import {
  configureNoticeAgenda,
  readNoticeAgenda,
  syncNoticeAgenda,
  type NoticeAgendaCipher,
} from "./noticeAgenda.js";
import {
  armNotice,
  disarmNotice,
  getNotice,
  listArmed,
  reconcileNoticeAgenda,
  setNoticeRuntimePoke,
  toBaseLocal,
  wipeNoticeData,
} from "./noticeStore.js";
import { createEvent, deleteEvent } from "./calendarStore.js";
import { createContact } from "./contactStore.js";
import {
  cancelReminderNotification,
  scheduleReminderNotification,
} from "../../notify/notifications.js";

const KEY = randomBytes(32);
const AGENDA_KEY = randomBytes(32);

const testCipher: NoticeAgendaCipher = {
  seal(plain) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", AGENDA_KEY, iv);
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
  },
  unseal(sealed) {
    try {
      const raw = Buffer.from(sealed, "base64");
      const d = createDecipheriv("aes-256-gcm", AGENDA_KEY, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  },
};

let dir: string;
let agendaPath: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e8agenda-"));
  agendaPath = join(dir, "notice-agenda.bin");
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
  configureNoticeAgenda({ filePath: agendaPath, cipher: testCipher });
});

afterEach(async () => {
  configureNoticeAgenda(null);
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const FUTURE = new Date(2027, 5, 8, 9, 0, 0, 0);

async function armReminder(text = "Regar las plantas"): Promise<string> {
  const n = await armNotice({
    kind: "reminder",
    body: { text },
    baseLocal: toBaseLocal(FUTURE),
  });
  return n.id;
}

describe("E8 paso 2 · la agenda de disparo", () => {
  it("el espejo: la agenda trae id, kind y hora de los armados, y el fichero no enseña ni el texto ni el kind en claro", async () => {
    const a = await armReminder();
    const b = await armNotice({
      kind: "event",
      refId: "ev-1",
      body: { title: "Dentista" },
      baseLocal: toBaseLocal(new Date(2027, 5, 9, 10, 0)),
    });
    const agenda = await readNoticeAgenda();
    expect(agenda.entries.map((e) => e.id).sort()).toEqual([a, b.id].sort());
    const ev = agenda.entries.find((e) => e.id === b.id);
    expect(ev?.kind).toBe("event");
    expect(ev?.nextFireAt).toBe(new Date(2027, 5, 9, 10, 0).getTime());
    const raw = readFileSync(agendaPath, "utf8");
    expect(raw).not.toContain("Regar las plantas");
    expect(raw).not.toContain("reminder");
    expect(raw).not.toContain("Dentista");
  });

  it("el desarme borra las dos capas", async () => {
    const a = await armReminder();
    expect((await readNoticeAgenda()).entries).toHaveLength(1);
    await disarmNotice(a);
    expect(await getNotice(a)).toBeNull();
    expect((await readNoticeAgenda()).entries).toHaveLength(0);
  });

  it("T-9 · un aviso sin entrada en la agenda se repone al reconciliar", async () => {
    const a = await armReminder();
    await syncNoticeAgenda([]); // la divergencia: la escritura de la agenda se perdió
    expect((await readNoticeAgenda()).entries).toHaveLength(0);
    const report = await reconcileNoticeAgenda();
    expect(report.added).toEqual([a]);
    expect(report.removed).toEqual([]);
    const agenda = await readNoticeAgenda();
    expect(agenda.entries).toHaveLength(1);
    expect(agenda.entries[0].id).toBe(a);
  });

  it("T-9 · una entrada huérfana en la agenda se borra al reconciliar", async () => {
    await armReminder();
    const agenda = await readNoticeAgenda();
    await syncNoticeAgenda([
      ...agenda.entries,
      { id: "fantasma", kind: "reminder", nextFireAt: FUTURE.getTime() },
    ]);
    const report = await reconcileNoticeAgenda();
    expect(report.removed).toEqual(["fantasma"]);
    expect((await readNoticeAgenda()).entries.map((e) => e.id)).not.toContain("fantasma");
  });

  it("T-9 · un instante derivado que difiere en la agenda se corrige desde la base", async () => {
    const a = await armReminder();
    await syncNoticeAgenda([{ id: a, kind: "reminder", nextFireAt: 123 }]);
    const report = await reconcileNoticeAgenda();
    expect(report.corrected).toEqual([a]);
    expect((await readNoticeAgenda()).entries[0].nextFireAt).toBe(FUTURE.getTime());
  });

  it("T-19 (pierna de avisos) · el borrado total elimina los avisos y la agenda, y nada resucita al reconciliar", async () => {
    await armReminder();
    await armReminder("Segunda cosa");
    expect(await listArmed()).toHaveLength(2);
    await wipeNoticeData();
    expect(await listArmed()).toHaveLength(0);
    expect(existsSync(agendaPath)).toBe(false);
    const report = await reconcileNoticeAgenda();
    expect(report).toEqual({ added: [], removed: [], corrected: [] });
    expect((await readNoticeAgenda()).entries).toHaveLength(0);
  });

  it("sin configurar, la agenda es un no-op y la cola se comporta como en E7", async () => {
    configureNoticeAgenda(null);
    const a = await armReminder();
    expect(await getNotice(a)).not.toBeNull();
    expect((await readNoticeAgenda()).entries).toHaveLength(0);
    expect(existsSync(agendaPath)).toBe(false);
    await disarmNotice(a);
    expect(await getNotice(a)).toBeNull();
  });

  it("S-1 (paso 2) · programar arma el aviso enlazado y no duplica; cancelar lo desarma; sin base devuelve false", async () => {
    const when = new Date(Date.now() + 3600 * 1000);
    expect(await scheduleReminderNotification("r-1", "Pagar la luz", when, null)).toBe(true);
    const armed = (await listArmed()).filter((n) => n.kind === "reminder");
    expect(armed).toHaveLength(1);
    expect((armed[0].body as { reminderId?: string }).reminderId).toBe("r-1");
    expect((await readNoticeAgenda()).entries.map((e) => e.id)).toEqual([armed[0].id]);
    // La misma programación otra vez: el mismo aviso, sin duplicar.
    expect(await scheduleReminderNotification("r-1", "Pagar la luz", when, null)).toBe(true);
    expect((await listArmed()).filter((n) => n.kind === "reminder")).toHaveLength(1);
    await cancelReminderNotification("r-1");
    expect((await listArmed()).filter((n) => n.kind === "reminder")).toHaveLength(0);
    expect((await readNoticeAgenda()).entries).toHaveLength(0);
    // Sin base disponible, programar dice la verdad: false.
    await closeDatabase();
    setAppStoreDekProvider(null);
    expect(await scheduleReminderNotification("r-2", "Otra", when, null)).toBe(false);
  });

  it("T-22 (la cura que cazó) · la materialización de dueño entra en la agenda al escribir: el evento y el cumpleaños, sin esperar a la reconciliación", async () => {
    let pokes = 0;
    setNoticeRuntimePoke(() => {
      pokes++;
    });
    try {
      const startsAt = new Date(2027, 5, 8, 10, 0, 0, 0).getTime();
      const ev = await createEvent({
        title: "Dentista",
        startsAt,
        endsAt: startsAt + 3600_000,
        alertOffsetMin: 30,
      });
      let agenda = await readNoticeAgenda();
      const evEntry = agenda.entries.find((e) => e.kind === "event");
      expect(evEntry).toBeDefined();
      expect(evEntry!.nextFireAt).toBe(startsAt - 30 * 60_000);
      expect(pokes).toBeGreaterThan(0);

      const ficha = await createContact(
        { name: "Carmen Ruiz", birthdayMonth: 6, birthdayDay: 8 },
        new Date(2027, 0, 15, 12, 0),
      );
      agenda = await readNoticeAgenda();
      expect(agenda.entries.some((e) => e.kind === "birthday")).toBe(true);
      expect(ficha.id).not.toBe("");

      await deleteEvent(ev.id);
      agenda = await readNoticeAgenda();
      expect(agenda.entries.some((e) => e.kind === "event")).toBe(false);
      expect(agenda.entries.some((e) => e.kind === "birthday")).toBe(true);
    } finally {
      setNoticeRuntimePoke(null);
    }
  });
});
