/**
 * E8 (paso 5): la batería de los temporizadores (AVISOS-ETAPA
 * T-14 a T-16 + el enlace de la vía rápida). El temporizador
 * guarda su fin absoluto; la cuenta visible es fin − ahora;
 * pausar retira el fin y guarda el restante; reanudar fija un
 * fin nuevo. Lo que la suspensión hace al fin: nada.
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
import { runCatchUpPass } from "./noticeCatchUp.js";
import { runDispatchPass, type DispatchTexts } from "./noticeDispatcher.js";
import {
  getNotice,
  listArmed,
  listScheduled,
  markDone,
  pauseTimer,
  resumeTimer,
} from "./noticeStore.js";
import {
  cancelReminderNotification,
  scheduleTimerNotification,
} from "../../notify/notifications.js";

const KEY = randomBytes(32);
let dir: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e8timers-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const MIN = 60_000;
const T0 = Date.parse("2026-03-02T10:00:00.000Z");
const TEXTS: DispatchTexts = {
  kindTitle: () => "Temporizador",
  genericBody: () => "genérico",
  summaryTitle: (n: number) => `${n} avisos`,
  summaryBody: (n: number) => `${n} avisos`,
};
const byTimerId = async (id: string) =>
  (await listArmed()).find(
    (n) => n.kind === "timer" && (n.body as { timerId?: string }).timerId === id,
  ) ??
  (await import("./noticeStore.js")).listNoticeView().then((rows) =>
    rows.find((n) => n.kind === "timer" && (n.body as { timerId?: string }).timerId === id),
  );

describe("E8 paso 5: temporizadores", () => {
  it("T-14: el fin es absoluto — una suspensión simulada de 10 minutos no lo mueve", async () => {
    await scheduleTimerNotification("timer-14", "Temporizador: pasta", new Date(T0 + 15 * MIN));
    const row = await byTimerId("timer-14");
    expect(row?.endsAt).toBe(T0 + 15 * MIN);
    // Diez minutos de pared después (la app «dormida»), lo que
    // queda es fin − ahora, no un contador guardado.
    expect((row?.endsAt ?? 0) - (T0 + 10 * MIN)).toBe(5 * MIN);
    // La app despierta diez minutos DESPUÉS del fin: vencido,
    // con su edad real.
    const seen: string[] = [];
    const pass = await runCatchUpPass(T0 + 25 * MIN, async (item) => {
      seen.push(item.treatment);
    });
    expect(seen).toEqual(["timer-expired"]);
    expect(pass.presented[0].ageMs).toBe(10 * MIN);
    expect((await getNotice(row!.id))?.state).toBe("fired");
  });

  it("T-15: pausar guarda el restante y sale de la agenda; reanudar fija un fin nuevo; pausar un vencido no existe", async () => {
    await scheduleTimerNotification("timer-15", "Temporizador: horno", new Date(T0 + 15 * MIN));
    const row = await byTimerId("timer-15");
    expect(row).toBeTruthy();

    const paused = await pauseTimer(row!.id, T0 + 5 * MIN);
    expect(paused?.state).toBe("snoozed");
    expect(paused?.endsAt).toBeNull();
    expect((paused?.body as { remainingMs?: number }).remainingMs).toBe(10 * MIN);
    // Fuera de la agenda: a su hora original no suena nada.
    expect((await listScheduled()).some((n) => n.id === row!.id)).toBe(false);
    const pass = await runDispatchPass(T0 + 15 * MIN + 30_000, {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: () => undefined,
    });
    expect(pass.fired.some((n) => n.id === row!.id)).toBe(false);
    // Pausar dos veces: la segunda no aplica.
    expect(await pauseTimer(row!.id, T0 + 6 * MIN)).toBeNull();

    // Reanudar una hora después: fin nuevo = ahora + restante,
    // y la fila vuelve a la agenda.
    const resumed = await resumeTimer(row!.id, T0 + 65 * MIN);
    expect(resumed?.state).toBe("armed");
    expect(resumed?.endsAt).toBe(T0 + 75 * MIN);
    expect((resumed?.body as { remainingMs?: unknown }).remainingMs).toBeUndefined();
    expect((await listScheduled()).some((n) => n.id === row!.id)).toBe(true);
    expect(await resumeTimer(row!.id, T0 + 66 * MIN)).toBeNull();

    // A su hora suena; pausar un vencido no existe.
    await runDispatchPass(T0 + 75 * MIN + 1_000, {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: () => undefined,
    });
    expect((await getNotice(row!.id))?.state).toBe("fired");
    expect(await pauseTimer(row!.id, T0 + 76 * MIN)).toBeNull();
  });

  it("T-16: dos temporizadores con nombre vencen en orden y se descartan por separado", async () => {
    await scheduleTimerNotification("timer-pasta", "Temporizador: pasta", new Date(T0 + 10 * MIN));
    await scheduleTimerNotification("timer-horno", "Temporizador: horno", new Date(T0 + 20 * MIN));
    const first = await runDispatchPass(T0 + 10 * MIN + 30_000, {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: () => undefined,
    });
    const pasta = first.fired.find((n) => (n.body as { timerId?: string }).timerId === "timer-pasta");
    expect(pasta).toBeTruthy();
    expect(first.fired.some((n) => (n.body as { timerId?: string }).timerId === "timer-horno")).toBe(false);
    // Descartar la pasta no toca el horno.
    expect(await markDone(pasta!.id)).toBe(true);
    const second = await runDispatchPass(T0 + 20 * MIN + 30_000, {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: () => undefined,
    });
    expect(second.fired.some((n) => (n.body as { timerId?: string }).timerId === "timer-horno")).toBe(true);
    expect(second.fired.some((n) => (n.body as { timerId?: string }).timerId === "timer-pasta")).toBe(false);
  });

  it("el enlace de la vía rápida: programar no duplica y borrar el recordatorio desarma el temporizador", async () => {
    await scheduleTimerNotification("timer-link", "Temporizador", new Date(T0 + 5 * MIN));
    await scheduleTimerNotification("timer-link", "Temporizador", new Date(T0 + 5 * MIN));
    const mine = (await listArmed()).filter(
      (n) => n.kind === "timer" && (n.body as { timerId?: string }).timerId === "timer-link",
    );
    expect(mine).toHaveLength(1);
    await cancelReminderNotification("timer-link");
    expect(
      (await listArmed()).some(
        (n) => n.kind === "timer" && (n.body as { timerId?: string }).timerId === "timer-link",
      ),
    ).toBe(false);
  });
});
