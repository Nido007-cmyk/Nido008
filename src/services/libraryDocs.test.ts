/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * libraryDocs.test.ts — las puertas D-7 y D-14 de E6 (paso 8)
 * contra la base real:
 *
 * - D-7: con un presupuesto de fixture, la expulsión se
 *   lleva la colección menos reciente y nunca la recién
 *   importada en su propio gesto; la Biblioteca enseña la
 *   medida real tras la expulsión (la fila que queda y el
 *   total son la medida de M-32, no una estimación).
 * - D-14: borrar la colección borra fragmentos, vectores,
 *   huellas y avisos en su transacción; la pregunta vuelve
 *   sin fuentes (la abstención honesta nace de ahí) y el
 *   presupuesto refleja la medida liberada.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../rag/embed.js", () => {
  const vector = () => {
    const v = new Float32Array(384).fill(1);
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };
  return {
    embeddingEngine: {
      get loadedModelSha256() {
        return null;
      },
      embedPassage: async () => vector(),
      embedPassageTagged: async () => ({ vector: vector(), modelSha256: null }),
      embedQueryTagged: async () => ({ vector: vector(), modelSha256: null }),
    },
  };
});

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import { listLibraryCollections } from "./libraryDocs.js";
import { retrieve } from "../rag/retrieve.js";
import { enforceStorageBudget } from "../rag/docStorageBudget.js";
import {
  deleteCustomCollection,
  getDb,
  listCustomCollections,
  listImportWarnings,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

let dir = "";
let seq = 0;

function write(name: string, content: string): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

const longText = (word: string) => `${word} `.repeat(600);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-d7-"));
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

describe("D-7 · el presupuesto expulsa la menos reciente y protege la recién importada", () => {
  it("la expulsión se lleva la vieja, la Biblioteca enseña la medida real de la que queda", async () => {
    const a = await importDocuments([write("alfa.txt", longText("alfa"))], "Alfa");
    // Alfa envejece: su último acceso queda muy atrás.
    const db = await getDb();
    await db.runAsync(`UPDATE custom_collections SET last_accessed = 1 WHERE id = ?`, [a.id]);
    const b = await importDocuments([write("bravo.txt", longText("bravo"))], "Bravo");

    const before = await listLibraryCollections();
    expect(before.rows.map((r) => r.name).sort()).toEqual(["Alfa", "Bravo"]);
    const bravoBytes = before.rows.find((r) => r.id === b.id)!.sizeBytes;
    expect(bravoBytes).toBeGreaterThan(0);
    expect(before.totalBytes).toBeGreaterThan(bravoBytes);

    // El gesto del importador con un presupuesto de fixture:
    // cabe Bravo, no las dos.
    const result = await enforceStorageBudget(bravoBytes, { protectIds: [b.id] });
    expect(result.evictedIds).toEqual([a.id]);

    const after = await listLibraryCollections();
    expect(after.rows.map((r) => r.id)).toEqual([b.id]);
    expect(after.rows[0].sizeBytes).toBe(bravoBytes);
    expect(after.totalBytes).toBe(bravoBytes);
    // Lo expulsado ya no responde: con el doble de vectores
    // constantes la vía semántica sirve lo que queda (Bravo)
    // para cualquier pregunta, así que la aserción es la
    // procedencia — ningún fragmento de la colección expulsada.
    const hits = await retrieve("alfa alfa alfa", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.collectionId === b.id)).toBe(true);
  }, 60_000);

  it("la recién importada no cae en su propio gesto ni pasando ella sola del presupuesto", async () => {
    const b = await importDocuments([write("bravo.txt", longText("bravo"))], "Bravo");
    const { rows } = await listLibraryCollections();
    const bytes = rows[0].sizeBytes;
    const result = await enforceStorageBudget(Math.floor(bytes / 2), { protectIds: [b.id] });
    expect(result.evicted).toBe(false);
    expect(result.totalBytesAfter).toBe(bytes);
    expect((await listCustomCollections()).map((c) => c.id)).toEqual([b.id]);
  }, 60_000);
});

describe("B-2 · los avisos de la importación viven en la fila de la Biblioteca", () => {
  it("los avisos persistidos de una colección vuelven en su fila, con nombre y razón exactos", async () => {
    const good = write("manual.txt", longText("caldera"));
    const bad = write("vacio.txt", "   ");
    const created = await importDocuments([good, bad], "Manual");

    const { rows } = await listLibraryCollections();
    const row = rows.find((r) => r.id === created.id)!;
    expect(row).toBeDefined();
    expect((row.warnings ?? []).map((w) => ({ name: w.name, reason: w.reason }))).toEqual([
      { name: "vacio.txt", reason: "noText" },
    ]);
  }, 60_000);

  it("dos colecciones no cruzan sus avisos, y la que no tiene va vacía", async () => {
    const a = await importDocuments(
      [write("bueno.txt", longText("alfa")), write("hueco.txt", "   ")],
      "ConAviso",
    );
    const b = await importDocuments([write("limpio.txt", longText("bravo"))], "Limpia");

    const { rows } = await listLibraryCollections();
    const rowA = rows.find((r) => r.id === a.id)!;
    const rowB = rows.find((r) => r.id === b.id)!;
    expect((rowA.warnings ?? []).map((w) => w.name)).toEqual(["hueco.txt"]);
    expect(rowB.warnings).toEqual([]);
  }, 60_000);
});

describe("D-14 · borrar la colección lo borra todo y la medida se libera", () => {
  it("fragmentos, vectores, huellas y avisos caen en la transacción; la pregunta queda sin fuentes", async () => {
    // Un lote con un fichero bueno y uno sin texto: la
    // colección nace con un aviso persistido que borrar.
    const good = write("manual.txt", longText("caldera"));
    const bad = write("vacio.txt", "   ");
    const created = await importDocuments([good, bad], "Manual");
    expect((await listImportWarnings([created.id]))[created.id]?.length).toBeGreaterThan(0);

    const db = await getDb();
    const count = async (sql: string) =>
      (await db.getFirstAsync<{ n: number }>(sql, [created.id]))?.n ?? -1;
    expect(await count(`SELECT COUNT(*) AS n FROM chunks WHERE collection_id = ?`)).toBeGreaterThan(0);
    expect(await count(`SELECT COUNT(*) AS n FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id WHERE c.collection_id = ?`)).toBeGreaterThan(0);
    expect(await count(`SELECT COUNT(*) AS n FROM custom_collection_docs WHERE collection_id = ?`)).toBeGreaterThan(0);
    const before = await listLibraryCollections();
    expect(before.totalBytes).toBeGreaterThan(0);
    expect((await retrieve("caldera caldera", 5)).length).toBeGreaterThan(0);

    await deleteCustomCollection(created.id);

    expect(await count(`SELECT COUNT(*) AS n FROM chunks WHERE collection_id = ?`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM custom_collection_docs WHERE collection_id = ?`)).toBe(0);
    expect((await listImportWarnings([created.id]))[created.id] ?? []).toEqual([]);
    expect(await retrieve("caldera caldera", 5)).toEqual([]);
    const after = await listLibraryCollections();
    expect(after.rows).toEqual([]);
    expect(after.totalBytes).toBe(0);
  }, 60_000);
});
