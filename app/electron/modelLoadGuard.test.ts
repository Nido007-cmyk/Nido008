/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La pierna de fijación de la Pieza 2 de la carcasa (H-CARGA-A):
 * los canales de carga cobran la sesión en su entrada. La batería
 * instala los servicios reales sobre un doble de Electron que
 * captura los manejadores registrados y los invoca con un evento
 * de la casa: con la bóveda bloqueada, cada canal responde
 * `locked` sin tocar el motor; con la sesión viva, la carga corre
 * su flujo diseñado entero, con el GGUF genuino del 0.6B sembrado
 * en el directorio de modelos de la escena. El censo de canales
 * (channelContract) fija la forma del contrato, no este
 * comportamiento: esta pierna es la que lo cobra. El orden de los
 * casos es la escena: primero la bóveda bloqueada, después la
 * sesión viva.
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

// La bendición de origen entra por su sede real (appUrl.ts, la
// misma que shell.ts re-exporta): el doble de la carcasa no
// necesita el resto de la superficie de Electron de shell.ts.
vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import { llamaEngine } from "../../src/inference/LlamaEngine.js";
import { sceneSkipped } from "../../src/test/sceneGate.js";

const event = { sender: {}, senderFrame: { url: "nido://app/index.html" } };

function call(channel: string, args?: unknown): Promise<{ ok: boolean; reason?: string }> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<{ ok: boolean; reason?: string }>;
}

const SCENE_OFF = sceneSkipped("modelLoadGuard", [
  path.join(process.cwd(), "models", "qwen3-0.6b-q4km.gguf"),
]);

beforeAll(async () => {
  if (SCENE_OFF) return;
  // La siembra va por enlace duro desde un temporal en el
  // mismo sistema de ficheros que los genuinos: desde el
  // paso 4 de E4, la mitad de lectura de D-3 rechaza por
  // lstat todo fichero no regular en la vía de carga, y un
  // enlace simbólico no lo es. La siembra original de la
  // carcasa era simbólica, de cuando la vía solo leía; la
  // clase quedó cobrada en la pasada del paso 7 y en el
  // cierre del paso 8, y las afirmaciones no cambian.
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-load-guard-"));
  // El GGUF genuino del 0.6B, sembrado por enlace en el directorio
  // de modelos de la escena (el que installServices registra).
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "models", "qwen3-0.6b-q4km.gguf"),
    path.join(modelsDir, "qwen3-0.6b-q4km.gguf"),
  );
  await installServices();
}, 60_000);

afterAll(() => {
  if (SCENE_OFF) return;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe.skipIf(SCENE_OFF)("Pieza 2 de la carcasa: los canales de carga cobran la sesión (H-CARGA-A)", () => {
  it("con la bóveda bloqueada, model-load responde locked sin cargar", async () => {
    const r = await call("nido:model-load", { id: "qwen3-0.6b-q4km" });
    expect(r).toEqual({ ok: false, reason: "locked" });
    expect(llamaEngine.isLoaded).toBe(false);
  });

  it("con la bóveda bloqueada, model-load-retry-less responde locked sin cargar", async () => {
    const r = await call("nido:model-load-retry-less", { id: "qwen3-0.6b-q4km" });
    expect(r).toEqual({ ok: false, reason: "locked" });
    expect(llamaEngine.isLoaded).toBe(false);
  });

  it("con la sesión viva, la carga corre su flujo diseñado y el modelo queda residente", async () => {
    const created = await call("nido:vault-create", { password: "sonda-carga-14" });
    expect(created.ok).toBe(true);
    const r = await call("nido:model-load", { id: "qwen3-0.6b-q4km" });
    expect(r.ok).toBe(true);
    expect(llamaEngine.isLoaded).toBe(true);
  }, 180_000);
});
