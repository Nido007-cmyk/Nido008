/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 3 de E8: la pasada de recuperación
 * (AVISOS-ETAPA §4.3) contra la base cifrada real, con el
 * reloj inyectado. Puerta: T-8 (al volver con vencidos
 * mezclados, cada familia recibe su trato y correr la pasada
 * dos veces no duplica nada) y el compañero «dos al mismo
 * instante».
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
import { runCatchUpPass, type CatchUpItem } from "./noticeCatchUp.js";
import {
  armNotice,
  getNotice,
  listArmed,
  toBaseLocal,
  type Notice,
} from "./noticeStore.js";

const KEY = randomBytes(32);
let dir: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e8catchup-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

/** Viernes 11 de junio de 2027, 10:00 local: el retorno a la vida. */
const NOW = new Date(2027, 5, 11, 10, 0, 0, 0).getTime();
const H = 3600 * 1000;

function collector(): { items: CatchUpItem[]; sink: (i: CatchUpItem) => void } {
  const items: CatchUpItem[] = [];
  return { items, sink: (i) => void items.push(i) };
}

async function armOneShot(at: Date, text = "Regar las plantas"): Promise<Notice> {
  return armNotice({
    kind: "reminder",
    body: { text },
    baseLocal: toBaseLocal(at),
    now: at.getTime() - H,
  });
}

async function armDailySeries(): Promise<Notice> {
  // Base el lunes 7 a las 09:00, armada una hora antes: al
  // volver el viernes hay 5 ocurrencias debidas (7 a 11).
  return armNotice({
    kind: "reminder",
    body: { text: "Las pastillas" },
    baseLocal: toBaseLocal(new Date(2027, 5, 7, 9, 0)),
    repeat: "day",
    now: new Date(2027, 5, 7, 8, 0).getTime(),
  });
}

describe("E8 paso 3 · la pasada de recuperación", () => {
  it("único vencido: se presenta como perdido con su antigüedad y la fila queda missed; la segunda pasada no lo repite", async () => {
    const n = await armOneShot(new Date(2027, 5, 11, 8, 0));
    const { items, sink } = collector();
    const r1 = await runCatchUpPass(NOW, sink);
    expect(r1.presented).toHaveLength(1);
    expect(r1.presented[0].treatment).toBe("missed");
    expect(r1.presented[0].ageMs).toBe(2 * H);
    expect(items).toHaveLength(1);
    expect((await getNotice(n.id))?.state).toBe("missed");
    const r2 = await runCatchUpPass(NOW, sink);
    expect(r2.presented).toHaveLength(0);
    expect(items).toHaveLength(1);
  });

  it("serie con ocurrencias saltadas: una sola presentación (la más reciente), missed_count con las demás y la siguiente estrictamente futura", async () => {
    const s = await armDailySeries();
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(1);
    const item = r.presented[0];
    expect(item.treatment).toBe("missed-series");
    expect(item.ageMs).toBe(1 * H); // la del viernes a las 09:00
    expect(item.skipped).toBe(4);
    expect((item.notice.body as { seriesId?: string }).seriesId).toBe(s.id);
    expect(item.notice.state).toBe("missed");
    const series = await getNotice(s.id);
    expect(series?.state).toBe("armed");
    expect(series?.missedCount).toBe(4);
    expect(series?.nextFireAt).toBe(new Date(2027, 5, 12, 9, 0).getTime());
    const r2 = await runCatchUpPass(NOW, sink);
    expect(r2.presented).toHaveLength(0);
  });

  it("temporizador vencido: se anuncia como vencido y la fila queda fired, persistente", async () => {
    const ends = new Date(2027, 5, 11, 9, 0);
    const t = await armNotice({
      kind: "timer",
      body: { text: "Pasta" },
      baseLocal: toBaseLocal(ends),
      endsAt: ends.getTime(),
      now: NOW - H,
    });
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(1);
    expect(r.presented[0].treatment).toBe("timer-expired");
    expect((await getNotice(t.id))?.state).toBe("fired");
    const r2 = await runCatchUpPass(NOW, sink);
    expect(r2.presented).toHaveLength(0);
  });

  it("tarea debida: no se presenta ni se transiciona; vuelve en tasksDue esperando su disparo", async () => {
    const t = await armNotice({
      kind: "task",
      refId: "task-1",
      body: { title: "Resumen" },
      baseLocal: toBaseLocal(new Date(2027, 5, 11, 9, 30)),
      now: NOW - H,
    });
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(0);
    expect(r.tasksDue.map((n) => n.id)).toEqual([t.id]);
    expect((await getNotice(t.id))?.state).toBe("armed");
  });

  it("cumpleaños de ayer: se presenta como pasado reciente y la serie queda armada para el año siguiente", async () => {
    const b = await armNotice({
      kind: "birthday",
      refId: "contact-1",
      body: { text: "Carmen" },
      baseLocal: "2026-06-10T09:00:00",
      repeat: "year",
      now: new Date(2027, 0, 15).getTime(),
    });
    expect(b.nextFireAt).toBe(new Date(2027, 5, 10, 9, 0).getTime());
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(1);
    expect(r.presented[0].treatment).toBe("birthday-recent");
    expect(r.presented[0].ageMs).toBe(25 * H);
    const series = await getNotice(b.id);
    expect(series?.state).toBe("armed");
    expect(series?.nextFireAt).toBe(new Date(2028, 5, 10, 9, 0).getTime());
  });

  it("cumpleaños de hace diez días: no se presenta; la serie se archiva en silencio a su siguiente año", async () => {
    const b = await armNotice({
      kind: "birthday",
      refId: "contact-2",
      body: { text: "Bruno" },
      baseLocal: "2026-06-01T09:00:00",
      repeat: "year",
      now: new Date(2027, 0, 15).getTime(),
    });
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(0);
    const series = await getNotice(b.id);
    expect(series?.state).toBe("armed");
    expect(series?.nextFireAt).toBe(new Date(2028, 5, 1, 9, 0).getTime());
  });

  it("T-8 · vencidos mezclados en una pasada, y la pasada corrida otra vez no duplica nada", async () => {
    await armOneShot(new Date(2027, 5, 11, 8, 0));
    await armDailySeries();
    const ends = new Date(2027, 5, 11, 9, 0);
    await armNotice({
      kind: "timer",
      body: { text: "Pasta" },
      baseLocal: toBaseLocal(ends),
      endsAt: ends.getTime(),
      now: NOW - H,
    });
    await armNotice({
      kind: "birthday",
      refId: "contact-1",
      body: { text: "Carmen" },
      baseLocal: "2026-06-10T09:00:00",
      repeat: "year",
      now: new Date(2027, 0, 15).getTime(),
    });
    await armNotice({
      kind: "task",
      refId: "task-1",
      body: { title: "Resumen" },
      baseLocal: toBaseLocal(new Date(2027, 5, 11, 9, 30)),
      now: NOW - H,
    });
    const { items, sink } = collector();
    const r1 = await runCatchUpPass(NOW, sink);
    expect(r1.presented.map((i) => i.treatment).sort()).toEqual(
      ["birthday-recent", "missed", "missed-series", "timer-expired"].sort(),
    );
    expect(r1.tasksDue).toHaveLength(1);
    expect(r1.sinkFailures).toHaveLength(0);
    const r2 = await runCatchUpPass(NOW, sink);
    expect(r2.presented).toHaveLength(0);
    expect(r2.tasksDue).toHaveLength(1);
    expect(items).toHaveLength(4);
    expect(await listArmed()).toHaveLength(3); // la serie, el cumpleaños y la tarea
  });

  it("dos avisos al mismo instante: los dos se presentan", async () => {
    await armOneShot(new Date(2027, 5, 11, 8, 0), "Uno");
    await armOneShot(new Date(2027, 5, 11, 8, 0), "Dos");
    const { sink } = collector();
    const r = await runCatchUpPass(NOW, sink);
    expect(r.presented).toHaveLength(2);
    expect(r.presented.every((i) => i.treatment === "missed")).toBe(true);
  });

  it("un sumidero que falla no deshace lo persistido ni detiene al resto", async () => {
    const a = await armOneShot(new Date(2027, 5, 11, 8, 0), "Falla");
    await armOneShot(new Date(2027, 5, 11, 8, 30), "Pasa");
    const r = await runCatchUpPass(NOW, () => {
      throw new Error("canal caído");
    });
    expect(r.presented).toHaveLength(2);
    expect(r.sinkFailures).toHaveLength(2);
    expect((await getNotice(a.id))?.state).toBe("missed");
  });
});
