/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la cura A-20 (cadena de curas, acto 7): cargar un
 * modelo en el gestor ESCRIBE el ajuste de modelo activo.
 * Hasta la cura, `nido:model-load` activaba el modelo en el
 * gestor pero nadie escribía `setActiveModelId`: al reiniciar
 * la app, el turno volvía al modelo por defecto porque el
 * ajuste seguía en su valor anterior (productionTurnDeps lee
 * el activo de los ajustes en cada turno). La elección de la
 * persona se perdía en cada reinicio.
 *
 * Los dos primeros casos nacen en rojo: tras una carga con
 * éxito por cada una de las dos vías (la normal y el reintento
 * con menos memoria), el ajuste leído de vuelta tiene que ser
 * el modelo cargado. Las dos guardias nacen verdes y sellan la
 * colocación de la escritura: una carga que falla no escribe
 * nada, y sin sesión tampoco.
 *
 * Arnés de servicios reales de la casa con el GGUF genuino
 * del qwen3-0.6b sembrado por enlace duro, como en
 * modelListSequence.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
  },
  BrowserWindow: {
    fromWebContents: () => ({ isDestroyed: () => false }),
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      harness.handlers.set(channel, fn as never);
    },
    on: () => undefined,
  },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined },
}));

vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import { getActiveModelId } from "../../src/models/settings.ts";

const event = { sender: {}, senderFrame: { url: "nido://app/index.html" } };

type Reply = { ok: boolean; reason?: string };

function call(channel: string, args?: unknown): Promise<Reply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<Reply>;
}

const ID = "qwen3-0.6b-q4km";
const PASSWORD = "sonda-a20-activo";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-a20-activo-"));
  const dir = path.join(harness.userData, "models");
  mkdirSync(dir, { recursive: true });
  linkSync(path.join(process.cwd(), "models", `${ID}.gguf`), path.join(dir, `${ID}.gguf`));
  await installServices();
  const created = await call("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("A-20 · cargar un modelo escribe el ajuste de activo", () => {
  it("tras nido:model-load, el activo leído de vuelta es el modelo cargado", async () => {
    const r = await call("nido:model-load", { id: ID });
    expect(r.ok).toBe(true);
    expect(await getActiveModelId("llm")).toBe(ID);
  }, 300_000);

  it("tras nido:model-load-retry-less, el activo leído de vuelta es el modelo cargado", async () => {
    const r = await call("nido:model-load-retry-less", { id: ID });
    expect(r.ok).toBe(true);
    expect(await getActiveModelId("llm")).toBe(ID);
  }, 300_000);

  it("guarda: una carga que falla no escribe el ajuste", async () => {
    const before = await getActiveModelId("llm");
    globalThis.fetch = async () => {
      throw new Error("sin red en el banco");
    };
    try {
      const r = await call("nido:model-load", { id: "qwen2.5-0.5b-instruct-q4km" });
      expect(r.ok).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(await getActiveModelId("llm")).toBe(before);
  }, 300_000);

  it("guarda: sin sesión la carga responde locked y no escribe el ajuste", async () => {
    const before = await getActiveModelId("llm");
    const locked = await call("nido:vault-lock");
    expect(locked.ok).toBe(true);
    const r = await call("nido:model-load", { id: ID });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("locked");
    const un = await call("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    expect(await getActiveModelId("llm")).toBe(before);
  }, 300_000);
});
