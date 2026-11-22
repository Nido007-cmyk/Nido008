/**
 * Tests de la vía de carga (auditoría de ataque 1, A-2): lo que
 * debe fallar, falla cerrado. URIs rechazadas, rutas fuera del
 * directorio rechazadas, huellas distintas rechazadas — desde la
 * propia biblioteca, no desde un script.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog.js";
import {
  LoadRefusal,
  resolveModelFile,
  verifiedModelPath,
  verifyModelFile,
} from "./loadPath.js";

let dir: string;
const payload = Buffer.from("nido-test-payload");
const entry: CatalogEntry = {
  id: "modelo-de-prueba",
  label: "Modelo de prueba",
  kind: "llm",
  fileBytes: payload.length,
  arch: { layers: 1, kvHeads: 1, headDim: 1, vocab: 1 },
  maxContext: 2048,
  license: "MIT",
  sourceUrl: "https://example.invalid/modelo.gguf",
  revision: "test",
  sha256: createHash("sha256").update(payload).digest("hex"),
  role: "light",
  note: "test",
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-loadpath-"));
  await writeFile(path.join(dir, "modelo-de-prueba.gguf"), payload);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveModelFile — la puerta de nombres", () => {
  it("rechaza URIs de red y esquemas hf:", async () => {
    await expect(resolveModelFile(dir, "https://evil.example/x.gguf")).rejects.toBeInstanceOf(LoadRefusal);
    await expect(resolveModelFile(dir, "hf:Qwen/modelo")).rejects.toBeInstanceOf(LoadRefusal);
  });

  it("rechaza rutas que salen del directorio de modelos", async () => {
    await expect(resolveModelFile(dir, "../fuera.gguf")).rejects.toBeInstanceOf(LoadRefusal);
    await expect(resolveModelFile(dir, "sub/modelo.gguf")).rejects.toBeInstanceOf(LoadRefusal);
    await expect(resolveModelFile(dir, "/etc/passwd")).rejects.toBeInstanceOf(LoadRefusal);
  });

  it("rechaza un fichero que no existe", async () => {
    await expect(resolveModelFile(dir, "no-estoy.gguf")).rejects.toBeInstanceOf(LoadRefusal);
  });

  it("acepta un nombre llano que existe dentro", async () => {
    await expect(resolveModelFile(dir, "modelo-de-prueba.gguf")).resolves.toBe(
      path.join(dir, "modelo-de-prueba.gguf"),
    );
  });
});

describe("verifyModelFile — tamaño y huella, fail-closed", () => {
  it("acepta el fichero exacto del catálogo", async () => {
    await expect(
      verifyModelFile(path.join(dir, "modelo-de-prueba.gguf"), entry),
    ).resolves.toBeUndefined();
  });

  it("rechaza el tamaño distinto", async () => {
    const other = path.join(dir, "otro.gguf");
    await writeFile(other, Buffer.from("corto"));
    await expect(verifyModelFile(other, entry)).rejects.toBeInstanceOf(LoadRefusal);
  });

  it("rechaza el mismo tamaño con otra huella", async () => {
    const other = path.join(dir, "gemelo.gguf");
    await writeFile(other, Buffer.alloc(payload.length, 7));
    await expect(verifyModelFile(other, entry)).rejects.toBeInstanceOf(LoadRefusal);
  });
});

describe("verifiedModelPath — la puerta entera", () => {
  it("devuelve la ruta solo si el fichero es el del catálogo", async () => {
    await expect(verifiedModelPath(dir, entry)).resolves.toBe(
      path.join(dir, "modelo-de-prueba.gguf"),
    );
  });
});
