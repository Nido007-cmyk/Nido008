/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pieza 3 de la carcasa (H-EMB-A), familia 1, pierna negativa:
 * antes del desbloqueo no hay proveedor registrado ni memoria
 * de sesión, y la garantía de residencia resuelve falso — el
 * estado de hoy, el que el discrim cobró en sesión
 * (`embeddingsEnsureLoaded` falso con la Biblioteca llena).
 * Registro de módulos propio, separado de la pierna positiva a
 * propósito: el vuelo único del motor deja su promesa asentada
 * en falso si la primera llamada resuelve en síncrono sin
 * proveedor, así que las dos piernas no comparten instancia
 * (hallazgo declarado en el asiento de la cadena; el motor no
 * se toca en esta pieza).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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

beforeAll(async () => {
  harness.userData = mkdtempSync(path.join(tmpdir(), "nido-emb-absent-"));
  await installServices();
}, 60_000);

describe("Pieza 3 de la carcasa: sin desbloqueo no hay proveedor (H-EMB-A)", () => {
  it("antes del desbloqueo, la garantía resuelve falso: no hay proveedor registrado", async () => {
    expect(embeddingEngine.isLoaded).toBe(false);
    await expect(embeddingEngine.ensureLoaded()).resolves.toBe(false);
    expect(embeddingEngine.isLoaded).toBe(false);
  });
});
