/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pieza 3 de la carcasa (H-EMB-A), familia 4: el proveedor de
 * residencia del e5 queda en null tras el bloqueo, cobrado en la
 * misma lectura que los demás nulos del §8.9. Registro de
 * módulos fresco y motor que nunca cargó en la escena a
 * propósito: con una carga previa, la memoria de sesión del
 * motor (`lastFilename`, que la pieza no toca) enmascararía al
 * proveedor por diseño y la lectura no cobraría el desregistro.
 * La escena siembra el e5 genuino con su nombre de instalación:
 * si el proveedor sobreviviera al bloqueo, la garantía cargaría
 * el modelo y residería — la lectura es afilada. En la misma
 * lectura: la base de conocimiento se niega a abrir sin DEK
 * (proveedor anulado), ningún modelo de generación reside y la
 * entrada del turno responde `locked` sin sesión.
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
import { embeddingEngine } from "../../src/rag/embed.js";
import { llamaEngine } from "../../src/inference/LlamaEngine.js";
import { getDb } from "../../src/rag/db.js";

const E5_GENUINE = process.env.NIDO_E5_GENUINE ?? "multilingual-e5-small-q8_0.gguf";

const event = { sender: {}, senderFrame: { url: "nido://app/index.html" } };

function call(channel: string, args?: unknown): Promise<{ ok: boolean; reason?: string }> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<{ ok: boolean; reason?: string }>;
}

async function waitFor(fn: () => Promise<boolean>, ms = 20_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
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
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-emb-dereg-"));
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(E5_GENUINE, path.join(modelsDir, "multilingual-e5-small-q8.gguf"));
  await installServices();
}, 60_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("Pieza 3 de la carcasa: el desregistro del proveedor al bloquear (H-EMB-A)", () => {
  it("tras un ciclo de bloqueo, el proveedor queda en null en la misma lectura que los demás nulos del §8.9", async () => {
    const created = await call("nido:vault-create", { password: "sonda-embeddings-14" });
    expect(created.ok).toBe(true);
    // Los proveedores del §8.9 están vivos con la sesión abierta:
    // la base de conocimiento abre con la DEK registrada.
    const db = await getDb();
    await db.closeAsync();

    const locked = await call("nido:vault-lock");
    expect(locked.ok).toBe(true);

    // El bloque de nulos corre al bloquear: la base se niega a
    // abrir (sin proveedor de DEK) cuando el desmontaje asienta.
    const dbRefused = await waitFor(async () => {
      try {
        const again = await getDb();
        await again.closeAsync();
        return false;
      } catch {
        return true;
      }
    });
    expect(dbRefused).toBe(true);

    // La misma lectura: el proveedor de embeddings en null (el
    // motor nunca cargó en esta escena; con el e5 sembrado, un
    // proveedor vivo cargaría y residería), sin modelo residente
    // y con la entrada del turno cobrando la sesión.
    await expect(embeddingEngine.ensureLoaded()).resolves.toBe(false);
    expect(embeddingEngine.isLoaded).toBe(false);
    expect(llamaEngine.isLoaded).toBe(false);
    const turn = await call("nido:turn-send", { conversationId: "sonda", text: "hola" });
    expect(turn).toEqual({ ok: false, reason: "locked" });
  }, 120_000);
});
