/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 4 de E8: el despacho con la app abierta
 * (AVISOS-ETAPA §5) contra la base cifrada real, con el canal
 * del SO como doble grabador. Puerta: T-10 (no-filtración con
 * la bóveda bloqueada y con el ajuste en genérico), T-11 (la
 * serie sobrevive a un despacho que lanza, porque la siguiente
 * ocurrencia queda armada antes), T-12 (posponer no toca la
 * serie) y T-13 (el resumen único de la recuperación), más la
 * comprobación del efecto tras la acción: lo que el despacho
 * cuenta como disparado es lo que el almacén enseña al
 * re-leerlo.
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
import {
  runDispatchPass,
  summarizeCatchUp,
  type DispatchTexts,
  type OsPayload,
} from "./noticeDispatcher.js";
import type { CatchUpItem } from "./noticeCatchUp.js";
import {
  armNotice,
  getNotice,
  markDone,
  snoozeNotice,
  toBaseLocal,
  type Notice,
} from "./noticeStore.js";

const KEY = randomBytes(32);
let dir: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e8dispatch-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const H = 3600 * 1000;
/** El momento del despacho: un aviso que venció hace 30 s va a su hora. */
const NOW = new Date(2027, 5, 11, 10, 0, 30).getTime();
const DUE = new Date(2027, 5, 11, 10, 0, 0).getTime();

const texts: DispatchTexts = {
  kindTitle: (k) => `kind:${k}`,
  genericBody: (k) => `generic:${k}`,
  summaryTitle: (n) => `summary:${n}`,
  summaryBody: (n) => `summary-body:${n}`,
};

function recorder(): { payloads: OsPayload[]; sink: (p: OsPayload) => void } {
  const payloads: OsPayload[] = [];
  return { payloads, sink: (p) => void payloads.push(p) };
}

async function armDue(kind: Notice["kind"], body: unknown, extra?: Partial<Parameters<typeof armNotice>[0]>): Promise<Notice> {
  return armNotice({
    kind,
    body,
    baseLocal: toBaseLocal(new Date(DUE)),
    now: DUE - H,
    ...extra,
  });
}

describe("E8 paso 4 · el despacho con la app abierta", () => {
  it("T-10 · con la bóveda bloqueada la carga del SO no lleva ni el texto ni los nombres, en las cuatro familias", async () => {
    await armDue("reminder", { text: "Regar las plantas del balcón" });
    await armDue("event", { title: "Dentista con la doctora Paredes" });
    await armDue("birthday", { text: "Carmen" });
    await armDue("timer", { text: "Pasta para la cena" }, { endsAt: DUE });
    const { payloads, sink } = recorder();
    const r = await runDispatchPass(NOW, { vaultOpen: false, showText: true, texts, osSink: sink });
    expect(r.fired).toHaveLength(4);
    expect(payloads).toHaveLength(4);
    const all = payloads.map((p) => `${p.title} ${p.body}`).join(" | ");
    for (const secret of ["Regar", "balcón", "Dentista", "Paredes", "Carmen", "Pasta"]) {
      expect(all).not.toContain(secret);
    }
    for (const p of payloads) expect(p.body).toBe(`generic:${p.kind}`);
  });

  it("T-10 · con la bóveda abierta y el ajuste en genérico tampoco sale el texto; con el ajuste encendido, sí", async () => {
    await armDue("reminder", { text: "Regar las plantas" });
    const a = recorder();
    await runDispatchPass(NOW, { vaultOpen: true, showText: false, texts, osSink: a.sink });
    expect(a.payloads[0].body).toBe("generic:reminder");
    await armDue("reminder", { text: "Regar las plantas" });
    const b = recorder();
    await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: b.sink });
    expect(b.payloads[0].body).toBe("Regar las plantas");
  });

  it("T-11 · la serie sobrevive a un canal del SO que lanza: la siguiente ocurrencia quedó armada antes de despachar", async () => {
    const s = await armNotice({
      kind: "reminder",
      body: { text: "Las pastillas" },
      baseLocal: toBaseLocal(new Date(DUE)),
      repeat: "day",
      now: DUE - H,
    });
    const r = await runDispatchPass(NOW, {
      vaultOpen: true,
      showText: true,
      texts,
      osSink: () => {
        throw new Error("el SO no contesta");
      },
    });
    expect(r.osFailures).toHaveLength(1);
    expect(r.fired).toHaveLength(1);
    const series = await getNotice(s.id);
    expect(series?.state).toBe("armed");
    expect(series?.nextFireAt).toBe(DUE + 24 * H);
    expect(series?.lastFiredAt).toBe(DUE);
  });

  it("la comprobación del efecto: lo contado como disparado es lo que el almacén enseña al re-leerlo, y la pasada no se repite", async () => {
    const n = await armDue("reminder", { text: "Una sola vez" });
    const { payloads, sink } = recorder();
    const r = await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: sink });
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0].id).toBe(n.id); // el único se presenta en su propia fila
    const reread = await getNotice(n.id);
    expect(reread?.state).toBe("fired");
    expect(reread?.lastFiredAt).toBe(DUE);
    const r2 = await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: sink });
    expect(r2.fired).toHaveLength(0);
    expect(payloads).toHaveLength(1);
  });

  it("lo vencido hace dos horas no es de esta pasada: queda para la recuperación", async () => {
    await armNotice({
      kind: "reminder",
      body: { text: "Viejo" },
      baseLocal: toBaseLocal(new Date(NOW - 2 * H)),
      now: NOW - 3 * H,
    });
    const fresh = await armDue("reminder", { text: "Fresco" });
    const { sink } = recorder();
    const r = await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: sink });
    expect(r.fired.map((n) => n.id)).toEqual([fresh.id]);
  });

  it("el temporizador vence a su hora: queda fired persistente y su carga ofrece descartar", async () => {
    const t = await armDue("timer", { text: "Pasta" }, { endsAt: DUE });
    const { payloads, sink } = recorder();
    const r = await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: sink });
    expect(r.fired).toHaveLength(1);
    expect((await getNotice(t.id))?.state).toBe("fired");
    expect(payloads[0].actions).toEqual(["discard", "view"]);
    expect(await markDone(t.id)).toBe(true);
    expect((await getNotice(t.id))?.state).toBe("done");
  });

  it("T-12 · posponer la serie crea la derivada y no toca la serie; posponer la presentación mueve su fila y cuenta las veces", async () => {
    const s = await armNotice({
      kind: "reminder",
      body: { text: "Las pastillas" },
      baseLocal: toBaseLocal(new Date(DUE)),
      repeat: "day",
      now: DUE - H,
    });
    const target = NOW + 10 * 60 * 1000;
    const derived = await snoozeNotice(s.id, target, NOW);
    expect(derived?.repeat).toBeNull();
    expect(derived?.state).toBe("armed");
    expect(derived?.nextFireAt).toBe(target);
    expect((derived?.body as { snoozedFrom?: string }).snoozedFrom).toBe(s.id);
    const series = await getNotice(s.id);
    expect(series?.nextFireAt).toBe(new Date(DUE).getTime());
    expect(series?.state).toBe("armed");
    // La presentación de un disparo se pospone moviendo su fila.
    const { sink } = recorder();
    const r = await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: sink });
    const presentation = r.fired.find((n) => n.id !== derived?.id);
    expect(presentation).toBeDefined();
    const moved = await snoozeNotice(presentation!.id, NOW + H, NOW);
    expect(moved?.state).toBe("snoozed");
    expect(moved?.snoozeUntil).toBe(NOW + H);
    expect((moved?.body as { snoozeCount?: number }).snoozeCount).toBe(1);
    const moved2 = await snoozeNotice(presentation!.id, NOW + 2 * H, NOW);
    expect((moved2?.body as { snoozeCount?: number }).snoozeCount).toBe(2);
  });

  it("un pospuesto que vence se despacha como cualquier aviso a su hora", async () => {
    const n = await armDue("reminder", { text: "Pospuesto" });
    await runDispatchPass(NOW, { vaultOpen: true, showText: true, texts, osSink: () => undefined });
    const presentation = (await getNotice(n.id))!;
    expect(presentation.state).toBe("fired");
    const target = NOW + 10 * 60 * 1000;
    await snoozeNotice(n.id, target, NOW);
    const { payloads, sink } = recorder();
    const r = await runDispatchPass(target + 30 * 1000, { vaultOpen: true, showText: true, texts, osSink: sink });
    expect(r.fired).toHaveLength(1);
    expect(payloads[0].body).toBe("Pospuesto");
    expect((await getNotice(n.id))?.state).toBe("fired");
  });

  it("T-13 · la agrupación de la recuperación: ninguno, uno con su carga, varios con un solo resumen sin datos", async () => {
    const mk = (text: string): CatchUpItem => ({
      notice: {
        id: `id-${text}`,
        kind: "reminder",
        refId: null,
        body: { text },
        baseLocal: "2027-06-11T08:00:00",
        repeat: null,
        nextFireAt: DUE,
        endsAt: null,
        state: "missed",
        snoozeUntil: null,
        lastFiredAt: null,
        missedCount: 0,
        sourceChat: null,
        createdAt: DUE,
      },
      treatment: "missed",
      ageMs: H,
      skipped: 0,
    });
    expect(summarizeCatchUp([], true, texts)).toEqual([]);
    const one = summarizeCatchUp([mk("Regar")], true, texts);
    expect(one).toHaveLength(1);
    expect(one[0].body).toBe("Regar");
    const many = summarizeCatchUp([mk("Regar"), mk("Pagar"), mk("Llamar")], true, texts);
    expect(many).toHaveLength(1);
    expect(many[0].title).toBe("summary:3");
    expect(many[0].body).toBe("summary-body:3");
    expect(many[0].body).not.toContain("Regar");
  });
});
