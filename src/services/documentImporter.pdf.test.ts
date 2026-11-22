/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.pdf.test.ts — la puerta del paso 3 de E6
 * contra la base real, ficheros reales y el motor pdfjs real:
 *
 * - D-3 (el lote mixto): un PDF truncado, uno con contraseña y
 *   un ejecutable renombrado a .pdf se rechazan POR FICHERO con
 *   su aviso persistido (pdfUnreadable, pdfPassword,
 *   pdfUnreadable); los dos buenos (un PDF de texto y un .txt)
 *   entran buscables; una sola colección, sin fragmentos
 *   huérfanos ni colección a medias.
 * - D-11 en su forma PDF: el PDF sobre el tope de páginas y el
 *   PDF cuyo texto pasa del tope de fragmentos se rechazan
 *   antes de crear colección alguna, con la base sin filas.
 * - D-13 en su forma del paso 3: la importación de PDF no abre
 *   ninguna conexión de red (fetch http/https y net.connect
 *   censados durante la importación).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as net from "node:net";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3]),
      modelSha256: null,
    }),
  },
}));

import {
  importDocuments,
  listImportWarnings,
  MAX_IMPORT_CHUNKS,
  maxCharsForChunks,
  MAX_IMPORT_PDF_PAGES,
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
import { makePdf, makePdfFromStreams } from "./pdfTestFixtures.js";


const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

async function chunkCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
  return row?.n ?? -1;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-imp-pdf-"));
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

describe("D-3 · el lote mixto", () => {
  it("los malos se rechazan por fichero con su aviso persistido y los buenos entran buscables", async () => {
    const goodBytes = makePdf(["El manual de la bomba de agua.", "La presion correcta es dos bares."]);
    const truncBytes = makePdf(["Documento que no llegara entero a su destino."]);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    const files: PickedDocumentFile[] = [
      write("bueno.pdf", goodBytes),
      write("truncado.pdf", truncBytes.subarray(0, Math.floor(truncBytes.length * 0.4))),
      { uri: join(FIXTURES, "pdf-cifrado.pdf"), name: "secreto.pdf", size: null },
      write("programa.pdf", exe),
      write("notas.txt", "Apunte suelto sobre la presion de la caldera."),
    ];
    const created = await importDocuments(files, "Mixta");
    expect(created.chunkCount).toBeGreaterThan(0);

    const warnings = await listImportWarnings([created.id]);
    const byName = new Map((warnings[created.id] ?? []).map((w) => [w.name, w.reason]));
    expect(byName.get("truncado.pdf")).toBe("pdfUnreadable");
    expect(byName.get("secreto.pdf")).toBe("pdfPassword");
    expect(byName.get("programa.pdf")).toBe("pdfUnreadable");
    expect(byName.has("bueno.pdf")).toBe(false);
    expect(byName.has("notas.txt")).toBe(false);

    const db = await getDb();
    const hitPdf = await db.getFirstAsync<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ?",
      ["presion"],
    );
    expect(hitPdf?.chunk_id).toBeTruthy();
    const orphans = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chunks WHERE collection_id IS NOT NULL AND collection_id NOT IN (SELECT id FROM custom_collections)",
    );
    expect(orphans?.n).toBe(0);
    const collections = await listCustomCollections();
    expect(collections.map((c) => c.id)).toEqual([created.id]);
    const stray = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chunks WHERE collection_id <> ?",
      [created.id],
    );
    expect(stray?.n).toBe(0);
  }, 30_000);

  it("un lote de solo rechazados no crea colección y el error nombra el primer rechazo", async () => {
    const files: PickedDocumentFile[] = [
      { uri: join(FIXTURES, "pdf-cifrado.pdf"), name: "secreto.pdf", size: null },
    ];
    await expect(importDocuments(files, "Solo")).rejects.toMatchObject({ code: "pdfPassword" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  }, 30_000);
});

describe("D-11 · topes antes de crear (PDF)", () => {
  it("el PDF sobre el tope de páginas se rechaza antes de crear colección alguna", async () => {
    const many = Array.from({ length: MAX_IMPORT_PDF_PAGES + 1 }, () => "x");
    const file = write("muchas.pdf", makePdf(many));
    await expect(importDocuments([file], "Muchas")).rejects.toMatchObject({
      code: "tooManyChunks",
    });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  }, 30_000);

  it("el PDF cuyo texto pasa del tope de fragmentos se rechaza antes de trocear", async () => {
    // La bomba de descompresión en su forma real: operaciones de
    // texto reposicionadas sobre la página (cada BT vuelve arriba),
    // que es como un PDF escupe mucho más texto del que su tamaño
    // sugiere. Una sola línea gigante no sirve de fixture: pdfjs
    // solo extrae la parte de la línea que cae sobre la página.
    // Cada línea en su propia posición y con su propio texto:
    // pdfjs deduplica glifos idénticos en idénticas coordenadas.
    const perPage = Array.from({ length: 210 }, (_, i) => {
      const head = `linea ${i} `;
      const line = head + "a".repeat(90 - head.length);
      return `BT /F1 18 Tf 56 ${780 - i} Td (${line}) Tj ET`;
    }).join("\n");
    // Rendimiento medido de la página fixture en esta máquina:
    // 12.389 caracteres extraídos por página (pdfjs agrupa las
    // líneas que se solapan). Se dimensiona con un rendimiento
    // prudente de 10.000 y margen: el extractor corta al pasar
    // su tope, así que el exceso no se paga entero.
    const totalChars = maxCharsForChunks(MAX_IMPORT_CHUNKS) + 600_000;
    const pageCount = Math.ceil(totalChars / 10_000);
    const streams = Array.from({ length: pageCount }, () => perPage);
    const file = write("bomba.pdf", makePdfFromStreams(streams));
    await expect(importDocuments([file], "Bomba")).rejects.toMatchObject({
      code: "tooManyChunks",
    });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
    // La extracción corta al pasar el tope (~580 páginas leídas
    // de 780); en esta VM eso pasa del timeout por defecto.
  }, 60_000);
});

describe("D-13 · cero conexiones al importar un PDF", () => {
  it("ni fetch de red ni net.connect durante la importación", async () => {
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fetchUrls.push(String(input));
      throw new Error("red censada");
    }) as typeof fetch;
    let connects = 0;
    const proto = net.Socket.prototype as unknown as {
      connect: (...args: unknown[]) => unknown;
    };
    const originalConnect = proto.connect;
    proto.connect = function (...args: unknown[]) {
      connects++;
      return originalConnect.apply(this, args);
    };
    try {
      const file = write("red.pdf", makePdf(["Un PDF que no debe salir a ninguna parte."]));
      const created = await importDocuments([file], "Red");
      expect(created.chunkCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      proto.connect = originalConnect;
    }
    expect(fetchUrls.filter((u) => /^https?:|^wss?:/.test(u))).toEqual([]);
    expect(connects).toBe(0);
  }, 30_000);
});
