/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.paginas.test.ts — la puerta D-4 de E6
 * (paso 4) contra la base real y PDFs reales del generador:
 * los fragmentos de un PDF guardan su página y su origen al
 * escribirse; los de un documento sin paginar van con page
 * NULL; ninguna cita podrá afirmar otra página que la del
 * fragmento, porque el dato nace aquí.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  listCollectionChunks,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { makePdf, makePdfFromStreams } from "./pdfTestFixtures.js";

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-paginas-"));
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

describe("D-4 · la frase partida y las páginas de cada fragmento", () => {
  it("la frase partida entre las páginas 3 y 4: dos fragmentos, cada uno con su página", async () => {
    const pdf = write(
      "manual.pdf",
      makePdf([
        "Portada del manual de la caldera.",
        "Indice de contenidos del manual.",
        "La bomba se",
        "detiene con la llave de paso general.",
        "Pagina final de creditos.",
      ]),
    );
    const created = await importDocuments([pdf], "Manual");
    const rows = await listCollectionChunks(created.id);
    const mitadA = rows.find((r) => r.body.includes("La bomba se"));
    const mitadB = rows.find((r) => r.body.includes("detiene con la llave"));
    expect(mitadA?.page).toBe(3);
    expect(mitadB?.page).toBe(4);
    expect(mitadA?.chunk_id).not.toBe(mitadB?.chunk_id);
    expect(rows.every((r) => r.origen === "texto")).toBe(true);
    expect(rows.every((r) => typeof r.page === "number")).toBe(true);
  }, 30_000);

  it("una página con varios fragmentos: todos llevan la misma página", async () => {
    // La página larga se escribe a 6 pt con la forma cruda: a
    // 18 pt solo caben ~60 caracteres por línea sobre el papel
    // (la geometría medida en el paso 3), y una página fixture
    // debe rendir varios fragmentos como un documento real.
    const lineaLarga = (i: number) => {
      const head = `linea ${i} `;
      return head + "palabra ".repeat(21).slice(0, 170 - head.length).trim();
    };
    const paginaLarga = Array.from(
      { length: 60 },
      (_, i) => `BT /F1 6 Tf 40 ${770 - i * 8} Td (${lineaLarga(i)}) Tj ET`,
    ).join("\n");
    const portada = "BT /F1 18 Tf 56 780 Td (Portada breve.) Tj ET";
    const pdf = write("largo.pdf", makePdfFromStreams([portada, paginaLarga]));
    const created = await importDocuments([pdf], "Largo");
    const rows = await listCollectionChunks(created.id);
    const deLaDos = rows.filter((r) => r.page === 2);
    expect(deLaDos.length).toBeGreaterThan(3);
    const deLaUno = rows.filter((r) => r.page === 1);
    expect(deLaUno).toHaveLength(1);
  }, 30_000);

  it("un documento sin paginar: sus fragmentos van con page NULL y origen texto", async () => {
    const txt = write("notas.txt", "palabra ".repeat(1200));
    const created = await importDocuments([txt], "Notas");
    const rows = await listCollectionChunks(created.id);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.page === null)).toBe(true);
    expect(rows.every((r) => r.origen === "texto")).toBe(true);
    const db = await getDb();
    const raw = await db.getFirstAsync<{ page: unknown }>("SELECT page FROM chunks LIMIT 1");
    expect(raw?.page).toBeNull();
  });
});
