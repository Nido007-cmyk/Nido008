/**
 * tasksSurface.test.ts — E8 (paso 8): la superficie de tareas
 * programadas contra los canales reales y el disparo.
 *
 * El suelo nombrado por el diseño: las formas de parseClock,
 * los rechazos del alta, el interruptor con su recálculo, el
 * borrado (la tarea y su historial, con su aviso desarmado),
 * la lista con la última corrida en sus tres estados, los
 * canales cerrados sin sesión, y T-21: con la bóveda
 * bloqueada la tarea no corre ni parcialmente; corre una
 * vez tras desbloquear, con las guardas del disparo en su
 * orden y la corrida verificada en el historial.
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
import { parseClock } from "../src/App/ScheduledTasksCard.tsx";
import { listArmed } from "../../src/agent/memory/noticeStore.js";
import { getTaskRuns, saveTask } from "../../src/agent/scheduled/taskStore.js";
import { runTaskPassOnce, startTaskRuntime } from "./taskRuntime.ts";

const PASSWORD = "sonda-e8-tareas";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type TaskRow = {
  id: string; name: string; schedule: string; enabled: boolean;
  nextRunAt: number | null;
  lastRun: { success: boolean; summary: string } | null;
};
type ListReply = { ok: boolean; reason?: string; tasks?: TaskRow[] };
type SaveReply = { ok: boolean; reason?: string; errors?: string[]; task?: TaskRow };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-e8-tareas-"));
  await installServices();
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("parseClock: las formas de la hora", () => {
  it("acepta las formas del móvil y rechaza las imposibles", () => {
    expect(parseClock("7:05")).toEqual({ hour: 7, minute: 5 });
    expect(parseClock("07:05")).toEqual({ hour: 7, minute: 5 });
    expect(parseClock("7")).toEqual({ hour: 7, minute: 0 });
    expect(parseClock("705")).toEqual({ hour: 7, minute: 5 });
    expect(parseClock("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("7:60")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});

describe("E8 paso 8 · los canales de tareas", () => {
  it("sin sesión, los tres canales fallan cerrados", async () => {
    expect(await call<ListReply>("nido:tasks-list")).toMatchObject({ ok: false, reason: "locked" });
    expect(
      await call<SaveReply>("nido:tasks-save", { name: "x", schedule: "0 7 * * *", instruction: "y" }),
    ).toMatchObject({ ok: false, reason: "locked" });
    expect(await call<{ ok: boolean; reason?: string }>("nido:tasks-delete", { id: "t" })).toMatchObject({
      ok: false,
      reason: "locked",
    });
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
  }, 120_000);

  it("el alta guarda, arma su aviso y la lista la trae con su próxima hora", async () => {
    const saved = await call<SaveReply>("nido:tasks-save", {
      name: "Resumen de la mañana",
      schedule: "0 7 * * *",
      instruction: "Resume mis notas de ayer",
      enabled: true,
    });
    expect(saved.ok).toBe(true);
    const task = saved.task!;
    expect(task.nextRunAt).toBeGreaterThan(Date.now());
    expect((await listArmed()).filter((n) => n.kind === "task" && n.refId === task.id)).toHaveLength(1);
    const list = await call<ListReply>("nido:tasks-list");
    const row = list.tasks?.find((t) => t.id === task.id);
    expect(row?.name).toBe("Resumen de la mañana");
    expect(row?.lastRun).toBeNull();
  }, 60_000);

  it("los rechazos del alta: argumentos, horario inválido y tarea desconocida", async () => {
    expect(await call<SaveReply>("nido:tasks-save", { name: "x" })).toMatchObject({
      ok: false,
      reason: "bad-args",
    });
    expect(
      await call<SaveReply>("nido:tasks-save", { name: "x", schedule: "no es cron", instruction: "y" }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await call<SaveReply>("nido:tasks-save", {
        id: "task_que_no_existe",
        name: "x",
        schedule: "0 7 * * *",
        instruction: "y",
      }),
    ).toMatchObject({ ok: false, reason: "not-found" });
  }, 60_000);

  it("el interruptor recalcula la próxima hora y desarma al pausar", async () => {
    const saved = await call<SaveReply>("nido:tasks-save", {
      name: "Pausable",
      schedule: "30 8 * * *",
      instruction: "Haz algo",
      enabled: true,
    });
    const id = saved.task!.id;
    const paused = await call<SaveReply>("nido:tasks-save", {
      id,
      name: "Pausable",
      schedule: "30 8 * * *",
      instruction: "Haz algo",
      enabled: false,
    });
    expect(paused.task?.nextRunAt).toBeNull();
    expect((await listArmed()).filter((n) => n.kind === "task" && n.refId === id)).toHaveLength(0);
    const resumed = await call<SaveReply>("nido:tasks-save", {
      id,
      name: "Pausable",
      schedule: "30 8 * * *",
      instruction: "Haz algo",
      enabled: true,
    });
    expect(resumed.task?.nextRunAt).toBeGreaterThan(Date.now());
    expect((await listArmed()).filter((n) => n.kind === "task" && n.refId === id)).toHaveLength(1);
  }, 60_000);

  it("la lista enseña la última corrida en sus tres estados y el borrado se lleva la tarea, su historial y su aviso", async () => {
    const mk = async (name: string) =>
      (await call<SaveReply>("nido:tasks-save", {
        name,
        schedule: "0 9 * * *",
        instruction: "Algo",
        enabled: true,
      })).task!;
    const okTask = await mk("Con éxito");
    const badTask = await mk("Con fallo");
    const neverTask = await mk("Sin correr");
    const { recordTaskRun } = await import("../../src/agent/scheduled/taskStore.js");
    const now = Date.now();
    await recordTaskRun({
      taskId: okTask.id, startedAt: now - 1000, completedAt: now, success: true,
      summary: "Resumen hecho", toolsUsed: ["list_notes"], policyDecisions: 1,
    });
    await recordTaskRun({
      taskId: badTask.id, startedAt: now - 1000, completedAt: now, success: false,
      summary: "", toolsUsed: [], policyDecisions: 0, error: "sin modelo",
    });
    const list = await call<ListReply>("nido:tasks-list");
    expect(list.tasks?.find((t) => t.id === okTask.id)?.lastRun?.success).toBe(true);
    expect(list.tasks?.find((t) => t.id === badTask.id)?.lastRun?.success).toBe(false);
    expect(list.tasks?.find((t) => t.id === neverTask.id)?.lastRun).toBeNull();

    const del = await call<{ ok: boolean }>("nido:tasks-delete", { id: okTask.id });
    expect(del.ok).toBe(true);
    const after = await call<ListReply>("nido:tasks-list");
    expect(after.tasks?.some((t) => t.id === okTask.id)).toBe(false);
    expect(await getTaskRuns(okTask.id)).toHaveLength(0);
    expect((await listArmed()).filter((n) => n.kind === "task" && n.refId === okTask.id)).toHaveLength(0);
  }, 60_000);
});

describe("T-21 · el disparo con la bóveda bloqueada y tras desbloquear", () => {
  it("bloqueada no corre ni parcialmente; desbloqueada corre una vez y la corrida queda verificada", async () => {
    const now = Date.now();
    await saveTask({
      id: "task_t21",
      name: "Vencida",
      schedule: "0 7 * * *",
      instruction: "Di la hora",
      enabled: true,
      createdAt: now - 86_400_000,
      lastRunAt: null,
      nextRunAt: now - 60_000,
      allowedTools: ["device_time"],
      notifyOnComplete: false,
    });
    const flags = { vault: false, turn: false, model: true };
    startTaskRuntime({
      isVaultOpen: () => flags.vault,
      isTurnInFlight: () => flags.turn,
      isModelReady: () => flags.model,
      lang: () => "es",
      strings: () => ({}),
    });
    // Bloqueada: ni una corrida parcial.
    expect(await runTaskPassOnce()).toBe(0);
    expect(await getTaskRuns("task_t21")).toHaveLength(0);
    // Desbloqueada pero con un turno en vuelo: la guarda manda.
    flags.vault = true;
    flags.turn = true;
    expect(await runTaskPassOnce()).toBe(0);
    expect(await getTaskRuns("task_t21")).toHaveLength(0);
    // Desbloqueada y sin modelo: tampoco.
    flags.turn = false;
    flags.model = false;
    expect(await runTaskPassOnce()).toBe(0);
    expect(await getTaskRuns("task_t21")).toHaveLength(0);
    // Todo abierto: corre una vez y su registro se verifica.
    flags.model = true;
    expect(await runTaskPassOnce()).toBe(1);
    expect(await getTaskRuns("task_t21")).toHaveLength(1);
    // Y no se repite: la tarea avanzó a su próxima hora.
    expect(await runTaskPassOnce()).toBe(0);
    expect(await getTaskRuns("task_t21")).toHaveLength(1);
  }, 180_000);
});
