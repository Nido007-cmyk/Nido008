/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.limits.test.ts — la batería de límites del
 * móvil recreada en PC (auditoría ofensiva 0.1.18: límites de
 * importación, importaciones vacías y limpieza), en su forma de
 * PC: base real, ficheros reales y el motor pdfjs real donde el
 * móvil apuntalaba el nativo con un doble; donde la aserción es
 * sobre lo que el importador le pasa AL lector (los topes), la
 * costura del contrato recibe un doble registrador, como en el
 * móvil. Las 13 declaraciones conservan su aserción.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const embedWorld = ((globalThis as Record<string, unknown>).__nidoLimitsEmbed ??= {
  failAt: -1,
  calls: 0,
}) as { failAt: number; calls: number };

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => {
      const at = embedWorld.calls++;
      if (embedWorld.failAt >= 0 && at === embedWorld.failAt) throw new Error("embed boom");
      return { vector: new Float32Array([0.1, 0.2, 0.3]), modelSha256: null };
    },
  },
}));

import {
  estimateChunkCount,
  importDocuments,
  listImportWarnings,
  MAX_IMPORT_CHUNKS,
  maxCharsForChunks,
  type PickedDocumentFile,
} from "./documentImporter.js";
import {
  getDb,
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { _setPdfTextNativeForTests } from "./pdfText.js";
import { _setOcrNativeForTests } from "./ocr.js";
import { makePdf, makePdfFromStreams } from "./pdfTestFixtures.js";

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array, size?: number): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: size ?? null };
}

async function chunkCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
  return row?.n ?? -1;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-limits-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
  embedWorld.failAt = -1;
  embedWorld.calls = 0;
  _setPdfTextNativeForTests(undefined);
  _setOcrNativeForTests(undefined);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  _setPdfTextNativeForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe("document import limits", () => {
  it("rejects a file the picker reports as too large, before reading it", async () => {
    const file = write("grande.txt", "contenido breve", 30 * 1024 * 1024);
    await expect(importDocuments([file], "x")).rejects.toMatchObject({ code: "tooLarge" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("rejects text that turns out too large once read", async () => {
    // Sin tamaño declarado y mintiendo el descriptor: el fichero
    // real pasa del tope y la lectura en streaming lo corta.
    const file = write("real.txt", "x".repeat(26 * 1024 * 1024), 10);
    await expect(importDocuments([file], "x")).rejects.toMatchObject({ code: "tooLarge" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("an import with no text says so instead of creating an empty collection", async () => {
    const file = write("empty.txt", "   ", 3);
    await expect(importDocuments([file], "x")).rejects.toMatchObject({ code: "noText" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("bounty tanda 6: un PDF escaneado (sin capa de texto) se nombra por su causa, no como «sin texto»", async () => {
    // El mundo de este caso es una versión SIN el módulo de OCR
    // (la costura del contrato en null): con el motor presente,
    // el mismo PDF se nombra por la vía del OCR vacío.
    _setOcrNativeForTests(null);
    const file = write("escaneado.pdf", makePdf([""]));
    const err = await importDocuments([file], "x").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "scannedNoOcr", vars: { name: "escaneado.pdf" } });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("bounty tanda 6: un PDF escaneado junto a un texto bueno no envenena la importación", async () => {
    _setOcrNativeForTests(null);
    const pdf = write("escaneado.pdf", makePdf([""]));
    const txt = write("notas.txt", "palabra ".repeat(50));
    const created = await importDocuments([pdf, txt], "Mixta");
    expect(created.chunkCount).toBeGreaterThan(0);
    const collections = await listCustomCollections();
    expect(collections).toHaveLength(1);
  });

  it("auditoría 2026-10-31 (F3-17): cada importación barre primero los trozos huérfanos de la anterior", async () => {
    const db = await getDb();
    // El huérfano se siembra con la clave foránea apagada, como
    // queda una base tras una carga (la siembra es la de esta misma batería).
    await db.execAsync("PRAGMA foreign_keys = OFF");
    await db.runAsync(
      `INSERT INTO chunks (chunk_id, doc_id, title, body, source, collection_id)
       VALUES ('huerfano', 'doc-huerfano', 't', 'cuerpo huerfano', 's', 'coleccion-inexistente')`,
    );
    await db.execAsync("PRAGMA foreign_keys = ON");
    const file = write("doc.txt", "palabra ".repeat(50));
    await importDocuments([file], "Mi doc");
    const orphan = await db.getFirstAsync<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks WHERE chunk_id = 'huerfano'",
    );
    expect(orphan).toBeNull();
  });

  it("a failure half way removes what was already inserted", async () => {
    embedWorld.failAt = 2;
    const file = write("doc.txt", "palabra ".repeat(2000));
    await expect(importDocuments([file], "Mi doc")).rejects.toThrow("embed boom");
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("a normal import still works", async () => {
    const file = write("ok.md", "Hola mundo");
    const created = await importDocuments([file], "Notas");
    expect(created.id).toMatch(/^custom-/);
    expect(created.chunkCount).toBe(1);
    expect(await chunkCount()).toBe(1);
  });

  it("estimateChunkCount coincide con el troceado real", async () => {
    for (const len of [1, 1999, 2000, 2001, 3800, 3801, 10_000, 123_457]) {
      await resetDatabase();
      const file = write("n.txt", "a".repeat(len));
      const created = await importDocuments([file], "n");
      expect(created.chunkCount).toBe(estimateChunkCount(len));
    }
    expect(estimateChunkCount(0)).toBe(0);
  });
});

describe("auditoría 2026-10-29: bomba de descompresión en PDF", () => {
  it("un PDF pequeño que da demasiado texto se rechaza antes de trocear", async () => {
    // El doble del lector devuelve ~11 000 trozos de texto, como
    // el mundo del móvil: la aserción es del importador ante ese
    // desenlace (la bomba con el motor real la cobra
    // documentImporter.pdf.test.ts).
    _setPdfTextNativeForTests({
      extractText: async () => "palabra ".repeat(2_500_000),
      extractPages: async () => [
        { pagina: 1, texto: "palabra ".repeat(2_500_000), origen: "texto" as const },
      ],
    });
    const file = write("bomba.pdf", "%PDF-1.4 falso", 1024 * 1024);
    const err = await importDocuments([file], "x").catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "tooManyChunks",
      vars: { max: String(MAX_IMPORT_CHUNKS) },
    });
    expect(await chunkCount()).toBe(0);
    expect(await listCustomCollections()).toEqual([]);
  });

  it("varios archivos: se para en cuanto la suma pasa del tope, sin leer los demás", async () => {
    let pdfCalls = 0;
    const pdfMaxChars: number[] = [];
    _setPdfTextNativeForTests({
      extractText: async (_uri: string, maxChars: number) => {
        pdfCalls++;
        pdfMaxChars.push(maxChars);
        return "a".repeat(5_000_000);
      },
      extractPages: async (_uri: string, _maxPages: number, maxChars?: number) => {
        pdfCalls++;
        pdfMaxChars.push(maxChars ?? -1);
        return [{ pagina: 1, texto: "a".repeat(5_000_000), origen: "texto" as const }];
      },
    });
    expect(estimateChunkCount(5_000_000)).toBeLessThan(MAX_IMPORT_CHUNKS);
    const files = [write("a.pdf", "%PDF-a"), write("b.pdf", "%PDF-b"), write("c.pdf", "%PDF-c")];
    await expect(importDocuments(files, "x")).rejects.toMatchObject({ code: "tooManyChunks" });
    expect(pdfCalls).toBe(2);
    expect(await chunkCount()).toBe(0);
    // El segundo PDF solo tiene permiso para lo que queda del tope, no para todo.
    expect(pdfMaxChars[1]).toBeLessThan(pdfMaxChars[0]);
  });

  it("el lector nativo recibe el tope de texto, así que nunca devuelve más", async () => {
    const pdfMaxChars: number[] = [];
    _setPdfTextNativeForTests({
      extractText: async (_uri: string, maxChars: number) => {
        pdfMaxChars.push(maxChars);
        return "a".repeat(1000);
      },
      extractPages: async (_uri: string, _maxPages: number, maxChars?: number) => {
        pdfMaxChars.push(maxChars ?? -1);
        return [{ pagina: 1, texto: "a".repeat(1000), origen: "texto" as const }];
      },
    });
    const file = write("ok.pdf", "%PDF-ok");
    await importDocuments([file], "x");
    expect(pdfMaxChars[0]).toBe(maxCharsForChunks(MAX_IMPORT_CHUNKS) + 200);
    expect(estimateChunkCount(maxCharsForChunks(MAX_IMPORT_CHUNKS))).toBe(MAX_IMPORT_CHUNKS);
  });

  it("un PDF normal sigue entrando", async () => {
    const text = "Texto de un PDF normal. ".repeat(200);
    _setPdfTextNativeForTests({
      extractText: async () => text,
      extractPages: async () => [{ pagina: 1, texto: text, origen: "texto" as const }],
    });
    const file = write("ok.pdf", "%PDF-ok", 50_000);
    const created = await importDocuments([file], "PDF");
    expect(created.id).toMatch(/^custom-/);
    expect(created.chunkCount).toBe(estimateChunkCount(text.trim().length));
  });
});
