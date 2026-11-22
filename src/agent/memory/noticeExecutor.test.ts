/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 5 de E7: el suelo del ejecutor. La
 * semántica en Node de la cola de avisos, contra la base
 * cifrada real, con el reloj inyectado y un sumidero falso
 * de despacho: ningún reloj de producción (eso es de E8).
 * Puerta del paso en la enumeración de E7-DECISIONES §5.2:
 * 9 casos (materialización con su forma 3, disparo con
 * reloj falso 3, la base manda 1, perdidos como lista 1,
 * atomicidad de la transacción de repetición 1).
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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { buildToolHandlers } from "../tools/handlers.js";
import { createEvent } from "./calendarStore.js";
import { createContact } from "./contactStore.js";
import {
  armNotice,
  getNotice,
  listArmed,
  listMissed,
  runNoticePass,
  toBaseLocal,
  type Notice,
} from "./noticeStore.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e7ejecutor-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

/** 8 de junio de 2027, 09:00 local. */
const T = new Date(2027, 5, 8, 9, 0, 0, 0);

describe("E7 paso 5 · suelo del ejecutor", () => {
  it("materialización · event: la fila entera, su ref_id y el next_fire_at derivado", async () => {
    const ev = await createEvent({
      title: "Dentista",
      startsAt: new Date(2027, 5, 8, 10, 0).getTime(),
      endsAt: new Date(2027, 5, 8, 11, 0).getTime(),
      alertOffsetMin: 30,
    });
    const armed = (await listArmed()).filter((n) => n.kind === "event");
    expect(armed).toHaveLength(1);
    expect(armed[0].refId).toBe(ev.id);
    expect(armed[0].state).toBe("armed");
    expect(armed[0].repeat).toBeNull();
    expect(armed[0].nextFireAt).toBe(new Date(2027, 5, 8, 9, 30).getTime());
    // La forma del cuerpo de un aviso de evento: título e inicio.
    expect((armed[0].body as { title?: string }).title).toBe("Dentista");
    expect((armed[0].body as { startsAt?: number }).startsAt).toBe(
      new Date(2027, 5, 8, 10, 0).getTime(),
    );
  });

  it("materialización · birthday: la fila entera, su ref_id y el next_fire_at derivado", async () => {
    const ficha = await createContact(
      { name: "Carmen Ruiz", birthdayMonth: 6, birthdayDay: 8 },
      new Date(2027, 0, 15, 12, 0),
    );
    const armed = (await listArmed()).filter((n) => n.kind === "birthday");
    expect(armed).toHaveLength(1);
    expect(armed[0].refId).toBe(ficha.id);
    expect(armed[0].repeat).toBe("year");
    expect(armed[0].nextFireAt).toBe(new Date(2027, 5, 8, 9, 0).getTime());
  });

  it("materialización · reminder: la fila entera, sin ref_id y con su next_fire_at", async () => {
    const h = buildToolHandlers({});
    await h["create_reminder"]({ text: "Llamar al banco", at: "2027-06-08T09:00:00" });
    const armed = (await listArmed()).filter((n) => n.kind === "reminder");
    expect(armed).toHaveLength(1);
    expect(armed[0].refId).toBeNull();
    expect(armed[0].nextFireAt).toBe(T.getTime());
    expect((armed[0].body as { text?: string }).text).toBe("Llamar al banco");
  });

  it("disparo con reloj falso · reminder: el sumidero lo recibe y la fila queda fired", async () => {
    const n = await armNotice({
      kind: "reminder",
      body: { text: "Llamar al banco" },
      baseLocal: toBaseLocal(T),
    });
    const seen: Notice[] = [];
    const r = await runNoticePass(T.getTime(), (notice) => {
      seen.push(notice);
    });
    expect(seen.map((x) => x.id)).toEqual([n.id]);
    expect(r.fired.map((x) => x.id)).toEqual([n.id]);
    const after = await getNotice(n.id);
    expect(after?.state).toBe("fired");
    expect(after?.lastFiredAt).toBe(T.getTime());
  });

  it("disparo con reloj falso · event: el sumidero lo recibe y la fila queda fired", async () => {
    const ev = await createEvent({
      title: "Dentista",
      startsAt: new Date(2027, 5, 8, 10, 0).getTime(),
      endsAt: new Date(2027, 5, 8, 11, 0).getTime(),
      alertOffsetMin: 30,
    });
    const due = new Date(2027, 5, 8, 9, 30).getTime();
    const seen: Notice[] = [];
    await runNoticePass(due, (notice) => {
      seen.push(notice);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe("event");
    expect(seen[0].refId).toBe(ev.id);
    const after = await getNotice(seen[0].id);
    expect(after?.state).toBe("fired");
  });

  it("disparo con reloj falso · birthday: el sumidero lo recibe y la fila avanza un año, armada", async () => {
    const n = await armNotice({
      kind: "birthday",
      refId: "ficha-1",
      body: { text: "Carmen Ruiz" },
      baseLocal: toBaseLocal(T),
      repeat: "year",
    });
    const seen: Notice[] = [];
    await runNoticePass(T.getTime(), (notice) => {
      seen.push(notice);
    });
    expect(seen.map((x) => x.id)).toEqual([n.id]);
    const after = await getNotice(n.id);
    expect(after?.state).toBe("armed");
    expect(after?.lastFiredAt).toBe(T.getTime());
    expect(after?.nextFireAt).toBe(new Date(2028, 5, 8, 9, 0).getTime());
  });

  it("la base manda: matar y rearrancar no duplica los armados", async () => {
    await armNotice({ kind: "reminder", body: { text: "Uno" }, baseLocal: toBaseLocal(T) });
    const ev = await createEvent({
      title: "Dentista",
      startsAt: new Date(2027, 5, 8, 10, 0).getTime(),
      endsAt: new Date(2027, 5, 8, 11, 0).getTime(),
      alertOffsetMin: 30,
    });
    expect(await listArmed()).toHaveLength(2);
    // Matar y rearrancar: la misma base, las mismas dos filas.
    await closeDatabase();
    expect(await listArmed()).toHaveLength(2);
    // Rearmar el mismo evento (corregirlo) no duplica su aviso.
    const { updateEvent } = await import("./calendarStore.js");
    await updateEvent(ev.id, { title: "Dentista (movido)" });
    const armed = await listArmed();
    expect(armed).toHaveLength(2);
    expect(armed.filter((n) => n.refId === ev.id)).toHaveLength(1);
  });

  it("perdidos como lista sin fingidas: el vencido se lista y sigue armado, no fired", async () => {
    const yesterday = new Date(2027, 5, 7, 9, 0);
    const n = await armNotice({
      kind: "reminder",
      body: { text: "Lo de ayer" },
      baseLocal: toBaseLocal(yesterday),
    });
    const missed = await listMissed(T.getTime());
    expect(missed.map((x) => x.id)).toEqual([n.id]);
    const after = await getNotice(n.id);
    expect(after?.state).toBe("armed");
    expect(after?.lastFiredAt).toBeNull();
  });

  it("atomicidad de la transacción de repetición: avanzar y marcar en la misma operación", async () => {
    const n = await armNotice({
      kind: "reminder",
      body: { text: "Diario" },
      baseLocal: toBaseLocal(T),
      repeat: "day",
    });
    const { advanceAfterFire } = await import("./noticeStore.js");
    const advanced = await advanceAfterFire(n.id, T.getTime());
    expect(advanced?.nextFireAt).toBe(new Date(2027, 5, 9, 9, 0).getTime());
    expect(advanced?.lastFiredAt).toBe(T.getTime());
    // Repetir la misma llamada no avanza dos veces ni duplica la fila:
    // el siguiente se deriva de la verdad (base + repeat), no del estado.
    const again = await advanceAfterFire(n.id, T.getTime());
    expect(again?.nextFireAt).toBe(new Date(2027, 5, 9, 9, 0).getTime());
    expect(await listArmed()).toHaveLength(1);
  });
});
