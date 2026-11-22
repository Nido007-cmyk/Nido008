/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * P-01 paso 1: retrieve() corriendo como módulo sobre el almacén
 * real, en los tres estados del formato de vectores.
 *
 * Asiento de PC (E3, tanda 4 · J-3; subconjunto de lectura de
 * `E3-J3-DB.md` §2/§3 y apertura de la tanda §3.1): esta batería se
 * recrea SOLO con el describe «retrieve() sobre la misma base en
 * los tres estados» (2 casos), que es el cobro propio de J-3. Los
 * otros dos describes de la fuente («el sello y las escrituras»,
 * 3 casos, y «la migración en sitio», 6 casos) NO están en este
 * fichero: quedan con la sede difusa de `vectorFormatMigration`
 * que `E3-J3-DB.md` §3 nombró, y ningún informe de J-3 los hereda
 * en silencio. El fichero queda en copropiedad: la sede que mañana
 * añada sus describes no toca los ya cobrados, y todo cambio sobre
 * un describe cobrado re-corre el subconjunto como regresión.
 *
 * Adaptaciones de plataforma, las de la casa en PC: la costura de
 * test vive en `./db` (D-2 de la tanda 3½), el handle en
 * `./dbTestHarness` y la DEK llega por el proveedor de fixture
 * (D-3); no existen los módulos de plataforma del móvil. La
 * siembra de la colección personal (R-03) se hace por SQL directo
 * sobre la copia de la fixture: en PC `createCustomCollection`
 * es territorio de E6 y el sujeto de este describe es retrieve(),
 * no el escritor de colecciones; la fila sembrada es la misma que
 * aquel escritor produce (activa por defecto).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

type Fx = { DOC: string; activeEmbedding: string | null };
const g = globalThis as unknown as { __nidoVfFx?: Fx };
g.__nidoVfFx = g.__nidoVfFx ?? { DOC: "file:///docs/", activeEmbedding: null };
const fx = g.__nidoVfFx;

vi.mock("../models/settings.js", () => ({
  getActiveModelId: async (kind: string) =>
    kind === "embedding"
      ? ((globalThis as unknown as { __nidoVfFx?: Fx }).__nidoVfFx?.activeEmbedding ?? null)
      : null,
}));
// La consulta de retrieve() queda fijada: vector e1 (dim 384) y modelo
// bge — los vectores de estas fixtures se construyen a coseno exacto
// contra e1, así que lo servido es calculable a mano.
vi.mock("./embed.js", () => ({
  embeddingEngine: {
    embedQueryTagged: async () => {
      const vector = new Float32Array(384);
      vector[0] = 1;
      return {
        vector,
        modelSha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
      };
    },
    loadedModelSha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
  },
}));
vi.mock("./packs.js", () => ({ searchPacks: async () => ({ lexical: [], semantic: [] }) }));

import { makeNodeSqliteHandle, fixtureDekProvider } from "./dbTestHarness.js";
import {
  countFloat32VectorRows,
  getDb,
  getEmbeddingStamp,
  getVectorStorageFormat,
  insertChunk,
  listFloat32VectorBatch,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
  storeQuantizedVectorBatch,
} from "./db.js";
import { migrateVectorStorageFormat } from "./vectorFormatMigration.js";
import { retrieve } from "./retrieve.js";
import { quantizeVectorInt8 } from "./pure.js";

const DIM = 384;

let tmpDirs: string[] = [];

function useFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-vf-"));
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

function rawRows(
  dbPath: string,
  sql: string
): Array<{ chunk_id: string; embedding: Uint8Array; dim: number; len: number }> {
  const d = new DatabaseSync(dbPath);
  try {
    return d.prepare(sql).all() as Array<{
      chunk_id: string;
      embedding: Uint8Array;
      dim: number;
      len: number;
    }>;
  } finally {
    d.close();
  }
}

const allVectorRows = (dbPath: string) =>
  rawRows(
    dbPath,
    "SELECT chunk_id, embedding, dim, length(embedding) AS len FROM chunk_embeddings ORDER BY chunk_id"
  );

/** Vector a coseno exacto t contra la consulta e1: [t, √(1−t²), 0, …]. */
function vecAtCos(t: number): Float32Array {
  const v = new Float32Array(DIM);
  v[0] = t;
  v[1] = Math.sqrt(Math.max(0, 1 - t * t));
  return v;
}

const chunk = (id: string, extra?: { collectionId?: string; title?: string; body?: string }) => ({
  chunkId: id,
  docId: `d-${id}`,
  title: extra?.title ?? `T ${id}`,
  body: extra?.body ?? `body ${id}`,
  ...(extra?.collectionId ? { collectionId: extra.collectionId } : {}),
});

/** Convierte UN lote con las piezas exportadas: así se simula una migración que muere a mitad. */
async function convertOneBatch(limit: number): Promise<void> {
  const stamp = await getEmbeddingStamp();
  const batch = await listFloat32VectorBatch(limit);
  const updates = batch.map((row) => ({
    chunkId: row.chunkId,
    bytes: quantizeVectorInt8(
      new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dim)
    ),
  }));
  expect(await storeQuantizedVectorBatch(updates, stamp)).toBe(true);
}

beforeEach(async () => {
  tmpDirs = [];
  fx.activeEmbedding = null;
  const scratch = mkdtempSync(join(tmpdir(), "nido-vf-scratch-"));
  tmpDirs.push(scratch);
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

describe("P-01 · retrieve() sobre la misma base en los tres estados", () => {
  const NOTA_BODY =
    "La cita es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214. Tel. 520-555-0147.";
  const QUERY = "¿En qué sala es la cita del martes?";

  async function seedSalaScenario(dbPath: string): Promise<void> {
    await getDb();
    // La colección personal de la nota (R-03): fila sembrada por SQL
    // directo (asiento de la cabecera); el escritor de colecciones
    // es de E6 en PC.
    const d = new DatabaseSync(dbPath);
    try {
      d.prepare(
        "INSERT INTO custom_collections (id, name, source_filename, doc_count, chunk_count, size_bytes, active, created_at, last_accessed) VALUES ('col-nota', 'Notas', 'nota.txt', 1, 1, 64, 1, 0, 0)"
      ).run();
    } finally {
      d.close();
    }
    // La nota del usuario (R-03/R-04) a coseno 0,80; señuelos a 0,78 y
    // 0,75 que ensanchan el rango para que la poda por margen no se coma
    // a la guía (con solo [0,80 · 0,75] el cutoff sería 0,78); uno a
    // 0,62 que la poda sí retira; ocho rellenos bajo el piso bge (0,60).
    await insertChunk(
      chunk("nota", { collectionId: "col-nota", title: "Cita del martes", body: NOTA_BODY }),
      vecAtCos(0.8)
    );
    await insertChunk(
      chunk("guia", {
        title: "Emergencias",
        body: "Para una emergencia llama al número de emergencias de tu país y pide una ambulancia.",
      }),
      vecAtCos(0.75)
    );
    await insertChunk(
      chunk("senal", {
        title: "Señales de alarma",
        body: "Reconoce las señales de alarma de un infarto y actúa sin demora.",
      }),
      vecAtCos(0.78)
    );
    await insertChunk(
      chunk("bajo", {
        title: "Primeros auxilios",
        body: "Nociones básicas de primeros auxilios para el hogar.",
      }),
      vecAtCos(0.62)
    );
    for (let i = 0; i < 8; i++) {
      await insertChunk(
        chunk(`relleno${i}`, {
          title: `Tema ${i}`,
          body: `Contenido de relleno número ${i} sobre jardinería y cocina.`,
        }),
        vecAtCos(0.3 + i * 0.03)
      );
    }
  }

  it("sirve lo mismo en float32, mixta y migrada — y la nota va primera con su texto entero", async () => {
    const dbPath = useFreshDb();
    await seedSalaScenario(dbPath);
    const ids = (rs: Awaited<ReturnType<typeof retrieve>>) => rs.map((c) => c.chunkId);

    const inFloat = await retrieve(QUERY);
    expect(ids(inFloat)).toContain("nota");
    expect(ids(inFloat)).toContain("guia");
    expect(ids(inFloat)).toContain("senal");
    expect(ids(inFloat)).not.toContain("bajo"); // la poda lo retira en los tres estados
    expect(inFloat[0].chunkId).toBe("nota");

    // Estado mixto: el primer lote (nota, guía, señal — los tres
    // servidos) ya es int8 y el sello sigue en float32: un estado
    // válido y permanente.
    await convertOneBatch(3);
    expect(allVectorRows(dbPath).find((r) => r.chunk_id === "nota")!.len).toBe(DIM);
    expect(await getVectorStorageFormat()).toBe("float32");
    const inMixed = await retrieve(QUERY);
    expect(ids(inMixed)).toEqual(ids(inFloat));

    // Estado migrado: todo int8 y el sello volteado.
    await migrateVectorStorageFormat();
    expect(await getVectorStorageFormat()).toBe("int8");
    const inInt8 = await retrieve(QUERY);
    expect(ids(inInt8)).toEqual(ids(inFloat));

    // Las literales R-03/R-04, servidas por el lector YA migrado (no
    // heredadas de antes de la migración): sala, día, hora y teléfono.
    expect(inInt8[0].chunkId).toBe("nota");
    expect(inInt8[0].body).toContain("sala 214");
    expect(inInt8[0].body).toContain("martes 10 de noviembre de 2026");
    expect(inInt8[0].body).toContain("9:30");
    expect(inInt8[0].body).toContain("520-555-0147");
  });

  it("una fila corrupta (dim*2 B) nunca se sirve con puntuación fantasma; las vecinas no se enteran", async () => {
    const dbPath = useFreshDb();
    await seedSalaScenario(dbPath);
    const d = new DatabaseSync(dbPath);
    try {
      d.prepare(
        "INSERT INTO chunks (chunk_id, doc_id, title, body, source) VALUES ('corrupta', 'd-corrupta', 'Fila corrupta', 'Texto de la fila corrupta', NULL)"
      ).run();
      d.prepare(
        "INSERT INTO chunks_fts (chunk_id, doc_id, title, body) VALUES ('corrupta', 'd-corrupta', 'Fila corrupta', 'Texto de la fila corrupta')"
      ).run();
      d.prepare(
        "INSERT INTO chunk_embeddings (chunk_id, embedding, dim) VALUES ('corrupta', ?, 384)"
      ).run(new Uint8Array(DIM * 2));
    } finally {
      d.close();
    }
    // La corrupta no cuenta como float32 para la migración (768 ≠ 1.536).
    expect(await countFloat32VectorRows()).toBe(12);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const results = await retrieve(QUERY);
      expect(results.map((c) => c.chunkId)).not.toContain("corrupta");
      expect(results.map((c) => c.chunkId)).toContain("nota");
      // Su destino es visible: el aviso la nombra.
      expect(warn.mock.calls.some((args) => String(args[0]).includes("corrupta"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
