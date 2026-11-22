/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Multilingual search: the knowledge base is stamped with the ACTIVE
 * embedding model, a switch drops every vector and re-stamps in one
 * step, and a vector computed by one model can never land in a base
 * stamped for another. Runs the real db.ts SQL on a copy of the v1
 * fixture (node:sqlite), same harness as db.fixture.test.ts but with
 * bound parameters.
 *
 * Asiento de PC (E3, tanda 3½ · el esquema, decisión D-5 de su orden
 * y asiento de adaptación del sello de su apertura): esta batería se
 * recrea SOLO con el describe «embedding model stamp» (5 casos). El
 * describe «explicit switch + rebuild» de la fuente (6 casos) NO
 * está en este fichero: su sede es la de `E3-J3-DB.md` §3 (J-2 /
 * siembra); sus funciones se recrean en la tanda como instrumentos,
 * no como sujetos. La batería corre contra el manifiesto REAL sin
 * mock (D-5) y simula solo `../models/settings`. El manifiesto de PC
 * trae UNA entrada de embeddings — el e5, requerido por
 * construcción — así que los casos corren en la forma firmada en la
 * apertura de la tanda:
 *
 * - Caso 1 (activo e5 estampa e5): literal.
 * - Caso 2, texto original: "an unknown/absent Settings choice
 *   stamps the required model (as before)" afirmando la huella bge.
 *   Adaptado en la identidad del requerido: el requerido, en PC, es
 *   el e5, y el caso afirma su huella.
 * - Caso 3 (sello desconocido con vectores → fail-closed): literal
 *   en su sujeto; la siembra corre bajo el requerido de PC (la
 *   fuente siembra bajo el requerido del móvil) y el sello crudo
 *   `f…f` lo escribe el caso a mano, como en la fuente.
 * - Caso 4, texto original: "vectors from the OTHER catalog model
 *   (old backup, lost Settings) → dropped and re-stamped, text
 *   kept". Corrió adaptado en su veredicto mientras en PC no
 *   hubo otro modelo del catálogo (la huella bge era un perfil
 *   conocido, no una entrada, y la puerta rechazaba fail-closed
 *   una base estampada bge con vectores). El acto 2A de E4 hizo
 *   del bge una entrada del catálogo: la premisa del móvil
 *   volvió a ser la de PC y el caso corre en su veredicto
 *   literal — los vectores del otro modelo se descartan, la
 *   base se re-sella al activo y el texto queda — afirmado por
 *   lectura directa (sello, conteo de vectores, fragmentos y
 *   FTS). La siembra del sello bge se hace por el único
 *   camino que en PC puede escribirlo: `resetEmbeddingsForModel`
 *   con la huella bge e `insertEmbeddingForModel` bajo ese sello.
 * - Caso 5 (sello distinto sin vectores → re-sellado): adaptado en
 *   la producción del sello distinto, que se escribe con la huella
 *   bge vía `resetEmbeddingsForModel` (el cambio interrumpido del
 *   propio relato del caso); la rama cobrada (cero vectores →
 *   re-sellado al activo) es agnóstica al sello en la fuente y
 *   corre entera.
 *
 * Las adaptaciones de importación son las de la casa en PC: la
 * costura vive en `./db` (D-2), el handle en `./dbTestHarness`, la
 * DEK llega por el proveedor de fixture (D-3) y no existen los
 * módulos de plataforma del móvil.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

// Shared with the mock factory through globalThis (it runs before
// this module's body).
type Fx = { DOC: string; activeEmbedding: string | null };
const g = globalThis as unknown as { __nidoEmbFx?: Fx };
g.__nidoEmbFx = g.__nidoEmbFx ?? { DOC: "file:///docs/", activeEmbedding: null };
const fx = g.__nidoEmbFx;

vi.mock("../models/settings.js", () => ({
  getActiveModelId: async (kind: string) =>
    kind === "embedding"
      ? ((globalThis as unknown as { __nidoEmbFx?: Fx }).__nidoEmbFx?.activeEmbedding ?? null)
      : null,
}));

import { makeNodeSqliteHandle, fixtureDekProvider } from "./dbTestHarness.js";
import { KnowledgeDbVersionError } from "../security/formatVersion.js";
import {
  countChunkVectors,
  getDb,
  getEmbeddingStamp,
  insertChunk,
  insertEmbeddingForModel,
  resetDatabase,
  resetEmbeddingsForModel,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
} from "./db.js";

const BGE = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const E5_ID = "multilingual-e5-small-q8";

let tmpDirs: string[] = [];

function useFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-emb-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "k.db");
  copyFileSync(join(FIX, "knowledge.v1.db"), dbPath);
  setKnowledgeDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => makeNodeSqliteHandle(dbPath, { transactional: true }),
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
  return dbPath;
}

function raw(dbPath: string, sql: string): unknown[] {
  const d = new DatabaseSync(dbPath);
  try {
    return d.prepare(sql).all();
  } finally {
    d.close();
  }
}

const chunk = (id: string) => ({ chunkId: id, docId: `d-${id}`, title: `T ${id}`, body: `body ${id}` });
const vec = (x: number) => new Float32Array([x, 1, 2, 3]);

/**
 * Opens, adds two chunks with vectors stamped for the PC required
 * model (the absent-choice stamp), closes the cached handle. The
 * driver's remove() is a no-op, so resetDatabase() only drops the
 * handle and the file survives.
 */
async function seedWithVectors(): Promise<void> {
  fx.activeEmbedding = null;
  await getDb();
  await insertChunk(chunk("a"), vec(1));
  await insertChunk(chunk("b"), vec(2));
  await resetDatabase();
}

beforeEach(async () => {
  tmpDirs = [];
  fx.activeEmbedding = null;
  const scratch = mkdtempSync(join(tmpdir(), "nido-emb-scratch-"));
  tmpDirs.push(scratch);
  // El resetDatabase() de aislamiento, cuando corre sin conductor
  // (antes de useFreshDb), va por el camino de producción: su
  // directorio es un temporal desechable de la suite.
  setKnowledgeDbDir(scratch);
  setKnowledgeDbDekProvider(fixtureDekProvider);
  await resetDatabase();
});

afterEach(() => {
  setKnowledgeDbTestDriver(null);
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("embedding model stamp", () => {
  it("a new base is stamped with the active model (multilingual)", async () => {
    useFreshDb();
    fx.activeEmbedding = E5_ID;
    await getDb();
    expect(await getEmbeddingStamp()).toBe(E5);
  });

  it("an unknown/absent Settings choice stamps the required model (as before)", async () => {
    useFreshDb();
    fx.activeEmbedding = "no-such-model";
    await getDb();
    // Adaptado (asiento de la cabecera): en la fuente el requerido
    // es bge y el caso afirma su huella; en PC el requerido es el
    // e5, única entrada de embeddings del manifiesto.
    expect(await getEmbeddingStamp()).toBe(E5);
  });

  it("vectors from an UNKNOWN model → fail closed (unchanged R1 behaviour)", async () => {
    const dbPath = useFreshDb();
    await seedWithVectors();
    const d = new DatabaseSync(dbPath);
    d.prepare("UPDATE meta SET value = ? WHERE key = 'embedding_model_sha256'").run("f".repeat(64));
    d.close();
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("vectors from the OTHER catalog model (old backup, lost Settings) → dropped and re-stamped, text kept", async () => {
    const dbPath = useFreshDb();
    // Siembra con sello bge y vectores bajo ese sello, por el único
    // camino que en PC puede escribirlo (el cambio explícito).
    fx.activeEmbedding = null;
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    await insertChunk(chunk("b"), vec(2));
    await resetEmbeddingsForModel(BGE);
    expect(await insertEmbeddingForModel("a", vec(1), BGE)).toBe(true);
    expect(await insertEmbeddingForModel("b", vec(2), BGE)).toBe(true);
    expect(await countChunkVectors()).toEqual({ chunks: 2, withVector: 2 });
    await resetDatabase(); // el driver no borra: solo cae el handle
    fx.activeEmbedding = E5_ID;
    // Literal del móvil desde el acto 2A de E4 (asiento de la
    // cabecera): el bge es un modelo del catálogo, así que la
    // puerta descarta sus vectores y re-sella al activo, y el
    // texto queda.
    await getDb();
    expect(await getEmbeddingStamp()).toBe(E5);
    expect(await countChunkVectors()).toEqual({ chunks: 2, withVector: 0 });
    expect(raw(dbPath, "SELECT count(*) AS n FROM chunks")).toEqual([{ n: 2 }]);
    expect(raw(dbPath, "SELECT count(*) AS n FROM chunks_fts")).toEqual([{ n: 2 }]);
    expect(raw(dbPath, "SELECT value FROM meta WHERE key = 'embedding_model_sha256'")).toEqual([
      { value: E5 },
    ]);
  });

  it("stamp differs but there are NO vectors → re-stamped (interrupted switch), text kept", async () => {
    const dbPath = useFreshDb();
    fx.activeEmbedding = E5_ID;
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    await resetEmbeddingsForModel(BGE); // switch started…
    await resetDatabase(); // …and the app died before Settings changed
    // Settings still says e5 (adaptado: en la fuente dice bge, el
    // requerido del móvil; la rama cobrada es la misma).
    await getDb();
    expect(await getEmbeddingStamp()).toBe(E5);
    expect(raw(dbPath, "SELECT chunk_id FROM chunks")).toEqual([{ chunk_id: "a" }]);
  });
});
