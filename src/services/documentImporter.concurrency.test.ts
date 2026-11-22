/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.concurrency.test.ts — la batería F3-17
 * del móvil recreada en PC (1 declaración), en la forma que
 * la disciplina de PC dicta:
 *
 * En el móvil, dos importaciones podían correr a la vez y la
 * barrida de apertura de la segunda se comía los trozos en
 * vuelo de la primera; la cura fue el registro de
 * colecciones en vuelo que la barrida excluye. En PC esa
 * cura vive igual (inFlightCollectionIds + la exclusión de
 * deleteOrphanCollectionChunks), y además importDocuments
 * se serializa por una cadena: la segunda importación ni
 * arranca mientras la primera vive. La batería cobra las
 * dos capas: la barrida en su forma de producción (con la
 * exclusión, contra una importación aparcada a mitad) recoge
 * el huérfano de una importación muerta y respeta lo en
 * vuelo; y la importación concurrente espera su turno y
 * entra entera después.
 *
 * El huérfano se siembra con el driver de fixture sin
 * claves foráneas (la opción nombrada del arnés: es el
 * estado que la barrida existe para recoger), y la
 * importación en vuelo se aparca en la puerta del doble de
 * embeddings con un trozo ya insertado.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const world = ((globalThis as Record<string, unknown>).__nidoE6Conc ??= {
  calls: 0,
  gateAt: -1,
  release: null as null | (() => void),
  parked: null as null | (() => void),
}) as {
  calls: number;
  gateAt: number;
  release: null | (() => void);
  parked: null | (() => void);
};

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => {
      world.calls++;
      if (world.calls === world.gateAt) {
        world.parked?.();
        await new Promise<void>((r) => (world.release = r));
      }
      return { vector: new Float32Array([0.1, 0.2, 0.3]), modelSha256: null };
    },
  },
}));

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import {
  createCustomCollection,
  deleteOrphanCollectionChunks,
  getDb,
  insertChunkWithoutEmbedding,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
} from "../rag/db.js";
import { fixtureDekProvider, makeNodeSqliteHandle } from "../rag/dbTestHarness.js";

let dir = "";
let dbPath = "";

function write(name: string, content: string): PickedDocumentFile {
  const path = join(dir, name);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

const longText = (word: string) => `${word} `.repeat(1500); // ~4 trozos

async function countChunks(collectionId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunks WHERE collection_id = ?`,
    [collectionId],
  );
  return row?.n ?? -1;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-conc-"));
  dbPath = join(dir, "k.db");
  setKnowledgeDbTestDriver({
    dbDir: () => `${dir}/`,
    openDb: async () => makeNodeSqliteHandle(dbPath, { foreignKeysOff: true, transactional: true }),
    exists: async (path: string) => existsSync(dbPath) && !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
  setKnowledgeDbDir(dir);
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbTestDriver(null);
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("importaciones concurrentes contra la barrida de huérfanos (F3-17)", () => {
  it("la barrida no se come los trozos en vuelo de la primera y la segunda importación espera su turno", async () => {
    // El huérfano de una importación muerta: su colección
    // existió y su fila se fue sin cascada.
    await createCustomCollection({
      id: "custom-muerta",
      name: "Muerta",
      sourceFilename: "muerta.txt",
      docCount: 1,
      chunkCount: 1,
      sizeBytes: 0,
    });
    await insertChunkWithoutEmbedding({
      chunkId: "dead-1",
      docId: "dead",
      title: "Muerto",
      body: "trozo de una importación muerta",
      source: "muerta.txt",
      collectionId: "custom-muerta",
    });
    const db = await getDb();
    await db.runAsync(`DELETE FROM custom_collections WHERE id = ?`, ["custom-muerta"]);
    expect(await countChunks("custom-muerta")).toBe(1);

    // A arranca y queda aparcada en la puerta del segundo
    // embedding: un trozo insertado y la importación en vuelo.
    world.calls = 0;
    world.gateAt = 2;
    const parked = new Promise<void>((r) => (world.parked = r));
    const pA = importDocuments([write("alfa.txt", longText("alfa"))], "Coleccion Alfa");
    await parked;
    const inFlight = await db.getFirstAsync<{ collection_id: string }>(
      `SELECT collection_id FROM chunks WHERE collection_id LIKE 'custom-%' AND collection_id != 'custom-muerta' LIMIT 1`,
    );
    const idA = inFlight?.collection_id;
    expect(idA).toBeTruthy();
    expect(await countChunks(idA!)).toBe(1);

    // La barrida de apertura de la propia A ya recogió el
    // huérfano (su forma de producción, con la exclusión de
    // lo en vuelo) sin tocar lo que A iba a insertar.
    expect(await countChunks("custom-muerta")).toBe(0);

    // Y la misma barrida, lanzada a mitad de vuelo de A con
    // su exclusión, sigue sin tocar su trozo.
    const removed = await deleteOrphanCollectionChunks({ excludeCollectionIds: [idA!] });
    expect(removed).toBe(0);
    expect(await countChunks(idA!)).toBe(1);

    // B, pedida mientras A vive, espera su turno en la cadena
    // de importaciones: no entra ni toca nada hasta que A
    // termine.
    let bDone = false;
    const pB = importDocuments([write("bravo.txt", longText("bravo"))], "Coleccion Bravo").then((r) => {
      bDone = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(bDone).toBe(false);
    expect(await countChunks(idA!)).toBe(1);

    // A se suelta y termina entera; B entra después, entera.
    world.release?.();
    const a = await pA;
    expect(a.id).toBe(idA);
    expect(await countChunks(idA!)).toBeGreaterThan(1);
    const b = await pB;
    expect(bDone).toBe(true);
    expect(await countChunks(b.id)).toBeGreaterThan(0);
  }, 60_000);
});
