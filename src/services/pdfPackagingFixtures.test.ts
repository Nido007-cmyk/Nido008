/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * pdfPackagingFixtures.test.ts — la batería de fixtures del
 * móvil recreada en PC (P-04/P-05): las tres PDFs de
 * `__fixtures__/` son los ficheros reales del móvil, verificados
 * allí por una ruta independiente (poppler).
 *
 * Lo que este test juzga en esta máquina:
 *  1. La ESTRUCTURA de cada fixture, con las aserciones del
 *     móvil tal cual (los bytes llevan lo que las define).
 *  2. El CONTRATO del importador ante los desenlaces REALES del
 *     motor de PC (pdfjs empaquetado), no ante un doble: la
 *     cifrada se nombra pdfPassword y no importa nada; la latina
 *     CID entra con su texto.
 *
 * Diferencia medida y declarada contra el móvil: allí la CJK
 * sin su cmap hacía fallar la extracción (pdfUnreadable),
 * porque su APK recortado no llevaba el recurso. Aquí el
 * recurso SÍ va empaquetado y la CJK entra con su texto.
 * Corrección H-E6-2 (paso 6): la primera forma del motor
 * pasaba los recursos como URLs file://, que el worker de
 * pdfjs en Node no puede leer, y la CJK extraía vacía; con
 * las rutas del sistema de ficheros, el CMap nombrado
 * resuelve y el texto es el del fixture. El caso cobra el
 * desenlace curado, con su mecanismo nombrado.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3]),
      modelSha256: null,
    }),
  },
}));

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import {
  getDb,
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const bytesOf = (name: string) => readFileSync(join(FIXTURES, name));
const latin1Of = (name: string) => bytesOf(name).toString("latin1");
const asset = (name: string): PickedDocumentFile => ({
  uri: join(FIXTURES, name),
  name,
  size: bytesOf(name).length,
});

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-fixtures-"));
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

describe("P-04/P-05 · la estructura de las fixtures es la que las define", () => {
  it("la cifrada lleva el diccionario Standard R3 y su texto NO viaja en claro", () => {
    const raw = latin1Of("pdf-cifrado.pdf");
    expect(raw).toContain("/Encrypt");
    expect(raw).toContain("/Filter /Standard");
    expect(raw).toContain("/R 3");
    expect(raw).not.toContain("amoxicilina");
  });

  it("la latina CID es Type0 + CIDFontType2 con Identity-H y ToUnicode", () => {
    const raw = latin1Of("pdf-latino-cid.pdf");
    expect(raw).toContain("/Subtype /Type0");
    expect(raw).toContain("/Subtype /CIDFontType2");
    expect(raw).toContain("/Encoding /Identity-H");
    expect(raw).toContain("/ToUnicode");
  });

  it("la CJK nombra UniJIS-UCS2-H (Adobe-Japan1) y NO incrusta ToUnicode: cuelga del recurso", () => {
    const raw = latin1Of("pdf-cjk.pdf");
    expect(raw).toContain("/Encoding /UniJIS-UCS2-H");
    expect(raw).toContain("(Japan1)");
    expect(raw).not.toContain("/ToUnicode");
  });
});

describe("P-04/P-05 · el contrato del importador con el motor empaquetado", () => {
  it("P-04 · la cifrada: el motor pide contraseña y la importación lo NOMBRA (pdfPassword), sin importar nada", async () => {
    const err = await importDocuments([asset("pdf-cifrado.pdf")], "Cifrada").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "pdfPassword" });
    expect(String((err as Error).message)).toContain("pdf-cifrado.pdf");
    expect(await listCustomCollections()).toEqual([]);
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
    expect(row?.n).toBe(0);
  });

  // Timeout expreso (60 s): los dos casos de P-05 ejercen el
  // motor real con sus recursos y bajo la contención de la
  // suite entera el defecto de 5 s se cobraba en falso (medido
  // en la suite del ACTO 6, como en la del ACTO 3).
  it("P-05 · la CJK con su cmap empaquetado: importa con su texto, nunca en silencio", async () => {
    const result = await importDocuments([asset("pdf-cjk.pdf")], "CJK");
    expect(result.chunkCount).toBeGreaterThan(0);
    const db = await getDb();
    const row = await db.getFirstAsync<{ body: string }>("SELECT body FROM chunks LIMIT 1");
    expect(row?.body).toContain("こんにちは世界");
  }, 60_000);

  it("P-05 · la latina CID importa con su texto (Identity-H es de los que quedan)", async () => {
    const result = await importDocuments([asset("pdf-latino-cid.pdf")], "Latina");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.importWarnings ?? []).toEqual([]);
    const db = await getDb();
    const row = await db.getFirstAsync<{ body: string }>("SELECT body FROM chunks LIMIT 1");
    const flat = (row?.body ?? "").replace(/\s+/g, " ");
    expect(flat).toContain("La cita es el martes a las nueve.");
    expect(flat).toContain("Revisión general.");
  }, 60_000);
});
