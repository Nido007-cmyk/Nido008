/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.datos0199.test.ts — la batería de la tanda
 * de datos 0.1.99 del móvil recreada en PC (m-62: sin tamaño del
 * selector, la cota actúa antes de leer; M-32: la contabilidad
 * es lo almacenado y la cuota se aplica), en su forma de PC:
 * base real y ficheros reales. Las 6 declaraciones conservan su
 * aserción; la fórmula exacta de bytes del móvil (texto x2 +
 * vector float32) es de su almacén: aquí la medida se cobra
 * contra measureCollectionStoredBytes, que es la verdad de este
 * almacén (texto + copia FTS + vectores en su formato).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      modelSha256: null,
    }),
  },
}));

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import {
  createCustomCollection,
  listCustomCollections,
  measureCollectionStoredBytes,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array, size?: number): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: size === undefined ? null : size };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-datos-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("m-62: sin tamaño del selector, la cota actúa ANTES de leer", () => {
  it("un .txt gigante sin tamaño declarado se rechaza sin leerlo entero", async () => {
    const file = write("gigante.txt", "x".repeat(26 * 1024 * 1024));
    await expect(importDocuments([file], "x")).rejects.toMatchObject({ code: "tooLarge" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("una imagen gigante sin tamaño declarado se rechaza antes del OCR", async () => {
    const png = new Uint8Array(26 * 1024 * 1024);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const file = write("foto.png", png);
    await expect(importDocuments([file], "x")).rejects.toMatchObject({ code: "tooLarge" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("un fichero pequeño sin tamaño declarado importa como siempre", async () => {
    const file = write("pequeno.txt", "Un documento pequeno y honesto.");
    const created = await importDocuments([file], "Pequeno");
    expect(created.chunkCount).toBe(1);
  });
});

describe("M-32: la contabilidad es lo almacenado y la cuota se aplica", () => {
  it("sizeBytes nace de lo almacenado (texto + FTS + vectores), no del fichero fuente", async () => {
    const file = write("doc.txt", "contenido breve", 5_000_000);
    const created = await importDocuments([file], "docs");
    expect(created.sizeBytes).not.toBe(5_000_000);
    expect(created.sizeBytes).toBe(await measureCollectionStoredBytes(created.id));
    expect(created.sizeBytes).toBeGreaterThan(0);
  });

  it("tras importar, lo que excede la cuota expulsa la colección menos usada, no la nueva", async () => {
    await createCustomCollection({
      id: "vieja",
      name: "Vieja",
      sourceFilename: null,
      docCount: 1,
      chunkCount: 10,
      sizeBytes: 60 * 1024 * 1024,
    });
    const file = write("nuevo.txt", "documento nuevo pequeno");
    const created = await importDocuments([file], "nueva");
    const collections = await listCustomCollections();
    expect(collections.map((c) => c.id)).not.toContain("vieja");
    expect(collections.map((c) => c.id)).toContain(created.id);
  });

  it("bajo cuota no se expulsa nada", async () => {
    await createCustomCollection({
      id: "previa",
      name: "Previa",
      sourceFilename: null,
      docCount: 1,
      chunkCount: 1,
      sizeBytes: 1024,
    });
    const file = write("otro.txt", "otro documento pequeno");
    const created = await importDocuments([file], "otra");
    const collections = await listCustomCollections();
    expect(collections.map((c) => c.id)).toContain("previa");
    expect(collections.map((c) => c.id)).toContain(created.id);
  });
});
