/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pieza 3 de la carcasa (H-EMB-A), familia 1: el proveedor de
 * residencia del e5 queda registrado tras el desbloqueo y el
 * motor reside por él. La batería instala los servicios reales
 * sobre el doble de Electron de la pierna de la Pieza 2, con el
 * GGUF genuino del e5 sembrado en el directorio de modelos de la
 * escena con su nombre de instalación (`<id>.gguf`, el que la vía
 * de descarga escribe y el que el resolvedor del activo nombra).
 * La pierna negativa de la familia vive en su propio registro de
 * módulos (embeddingsProviderAbsent.test.ts): las dos piernas no
 * comparten instancia en esta batería porque el vuelo único del
 * motor, que la pieza no toca, deja su promesa asentada en falso
 * si la primera llamada resuelve en síncrono sin proveedor (el
 * hallazgo va declarado en el asiento de la cadena, con su sitio
 * en embed.ts y su alcanzabilidad medida: ninguna ruta de
 * producción llama a la garantía sin proveedor registrado,
 * porque el turno cobra la sesión en su entrada). La pata
 * semántica que este registro habilita (la guía de RCP coronando
 * contra la puerta léxica) se cobra en la sesión de superficie,
 * no en esta batería.
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

const E5_SHA256 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const E5_GENUINE = process.env.NIDO_E5_GENUINE ?? "multilingual-e5-small-q8_0.gguf";

const event = { sender: {}, senderFrame: { url: "nido://app/index.html" } };

function call(channel: string, args?: unknown): Promise<{ ok: boolean; reason?: string }> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<{ ok: boolean; reason?: string }>;
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
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-emb-reg-"));
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(E5_GENUINE, path.join(modelsDir, "multilingual-e5-small-q8.gguf"));
  await installServices();
}, 60_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("Pieza 3 de la carcasa: el registro del proveedor de embeddings (H-EMB-A)", () => {
  it("tras el desbloqueo, el proveedor registrado carga el e5 activo y el motor queda residente", async () => {
    const created = await call("nido:vault-create", { password: "sonda-embeddings-14" });
    expect(created.ok).toBe(true);
    await expect(embeddingEngine.ensureLoaded()).resolves.toBe(true);
    expect(embeddingEngine.isLoaded).toBe(true);
    expect(embeddingEngine.loadedModelSha256).toBe(E5_SHA256);
  }, 180_000);
});
