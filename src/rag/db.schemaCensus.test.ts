/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * db.schemaCensus.test.ts — batería NUEVA declarada de la tanda 3½
 * (el esquema de conocimiento): en el móvil el censo del esquema no
 * existe como batería (lo ejercita la familia `db.*` de pasada).
 * Esta afirma el esquema COMO FORMA, leído de `sqlite_master` y
 * `PRAGMA table_info` tras abrir, en tres describes:
 *
 * - A · la base fresca, abierta por el camino de producción (la
 *   apertura cifrada de E2 con la DEK de fixture, en un directorio
 *   temporal): las 12 tablas + `chunks_fts`, su SQL fts5 sin
 *   `content=`, las 5 tablas sombra, cero disparadores, los 3
 *   índices con nombre, las columnas de cada tabla (incluidas las
 *   que llegan por ALTER), el stamp `schema_version = '1'`, el
 *   sello de embeddings del modelo activo y el `journal_mode` WAL.
 * - B · el fixture v1 abierto llega al MISMO censo: sobre una copia
 *   temporal de `knowledge.v1.db` (por el conductor de test con
 *   handle node:sqlite, el camino de la longevidad), el censo tras
 *   `getDb()` es idéntico al de la base fresca — las 4 tablas y el
 *   índice que le faltan existen tras abrir, y los dos ALTER
 *   históricos dispararon — con `schema_version` intacta en '1'.
 *   Este describe es el que caza la divergencia que las réplicas ya
 *   mostraron una vez (la de `retrieve.lexical` creaba su
 *   `chunks_fts` sin `doc_id`).
 * - C · el FTS no nace vacío: tras `insertChunk`, la fila espejo
 *   existe en `chunks_fts`, una consulta `MATCH` la encuentra y la
 *   fila de `chunk_embeddings` acompaña — la DDL y su escritor
 *   mínimo cobrados como una sola pieza.
 *
 * Su cifra (13 casos) la fija esta tanda al escribirla y NO se suma
 * a los 24 de la puerta parcial.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";

import { makeNodeSqliteHandle, fixtureDekProvider } from "./dbTestHarness.js";
import {
  countChunkVectors,
  getDb,
  insertChunk,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
  type KnowledgeDbHandle,
} from "./db.js";

const EXPECTED_TABLES = [
  "answer_feedback",
  "chat_messages",
  "chat_sessions",
  "chunk_embeddings",
  "chunks",
  "chunks_fts",
  "custom_collection_docs",
  "custom_collection_warnings",
  "custom_collections",
  "execution_telemetry",
  "meta",
  "router_missed",
  "router_samples",
];

const EXPECTED_COLUMNS: Record<string, string[]> = {
  chunks: ["chunk_id", "doc_id", "title", "body", "source", "collection_id", "page", "origen"],
  chunk_embeddings: ["chunk_id", "embedding", "dim"],
  chat_sessions: ["id", "title", "summary", "created_at", "updated_at"],
  chat_messages: ["id", "session_id", "role", "text", "created_at", "interrupted"],
  answer_feedback: ["message_id", "rating", "created_at"],
  execution_telemetry: [
    "id",
    "created_at",
    "model_id",
    "task_type",
    "adaptive_routing_used",
    "reason_codes",
    "retrieval_used",
    "model_switches",
    "cross_message_model_switch",
    "model_residency",
    "model_load_ms",
    "ttft_ms",
    "generation_latency_ms",
    "total_latency_ms",
    "tokens_generated",
    "tok_per_sec",
    "peak_rss_bytes",
    "outcome",
    "error_message",
  ],
  router_samples: ["id", "ts", "classify_ms", "outcome", "route", "model_tool", "retry"],
  router_missed: ["id", "ts", "text", "route", "model_tool", "retry", "fallback"],
  custom_collections: [
    "id",
    "name",
    "source_filename",
    "doc_count",
    "chunk_count",
    "size_bytes",
    "active",
    "created_at",
    "last_accessed",
    "page_count",
  ],
  custom_collection_docs: ["collection_id", "doc_id", "fingerprint", "file_name", "kind"],
  custom_collection_warnings: [
    "collection_id",
    "file_name",
    "reason",
    "ocr_code",
    "ocr_message",
    "detail",
    "previous_name",
    "created_at",
  ],
  meta: ["key", "value"],
};

const EXPECTED_INDEXES = [
  "idx_chat_messages_session",
  "idx_custom_collection_docs_fp",
  "idx_execution_telemetry_created",
];

interface Census {
  tables: string[];
  indexes: string[];
  columns: Record<string, string[]>;
}

async function readCensus(db: KnowledgeDbHandle): Promise<Census> {
  const tableRows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  const indexRows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
  );
  const columns: Record<string, string[]> = {};
  for (const t of EXPECTED_TABLES) {
    if (t === "chunks_fts") continue;
    const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`);
    columns[t] = rows.map((r) => r.name);
  }
  return {
    tables: tableRows.map((r) => r.name),
    indexes: indexRows.map((r) => r.name),
    columns,
  };
}

let tmpDirs: string[] = [];
let censusA: Census | null = null;

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

describe("A — base fresca por el camino de producción", () => {
  let db: KnowledgeDbHandle;

  beforeAll(async () => {
    setKnowledgeDbDir(tmp("nido-census-a-"));
    setKnowledgeDbDekProvider(fixtureDekProvider);
    db = await getDb();
    censusA = await readCensus(db);
  });

  it("las 12 tablas + chunks_fts existen con su nombre (y ninguna otra salvo sqlite_sequence)", async () => {
    expect(censusA).not.toBeNull();
    const extra = censusA!.tables.filter(
      (t) => !EXPECTED_TABLES.includes(t) && !t.startsWith("chunks_fts_") && t !== "sqlite_sequence",
    );
    expect(extra).toEqual([]);
    for (const t of EXPECTED_TABLES) expect(censusA!.tables).toContain(t);
  });

  it("el SQL de chunks_fts declara fts5 con chunk_id/doc_id UNINDEXED, title y body, y sin content=", async () => {
    const row = await db.getFirstAsync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'",
    );
    const sql = (row?.sql ?? "").toLowerCase();
    expect(sql).toContain("fts5");
    expect(sql).toContain("chunk_id unindexed");
    expect(sql).toContain("doc_id unindexed");
    expect(sql).toContain("title");
    expect(sql).toContain("body");
    expect(sql).not.toContain("content=");
  });

  it("las 5 tablas sombra del FTS existen", async () => {
    for (const s of ["_data", "_idx", "_content", "_docsize", "_config"]) {
      expect(censusA!.tables).toContain(`chunks_fts${s}`);
    }
  });

  it("cero disparadores en sqlite_master", async () => {
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'",
    );
    expect(row?.n).toBe(0);
  });

  it("los 3 índices con nombre existen", async () => {
    expect(censusA!.indexes).toEqual(EXPECTED_INDEXES);
  });

  it("table_info de cada tabla casa con el contrato DDL, incluidas las columnas que llegan por ALTER", async () => {
    expect(censusA!.columns).toEqual(EXPECTED_COLUMNS);
  });

  it("tras la primera apertura, meta.schema_version = '1'", async () => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    expect(row?.value).toBe("1");
  });

  it("meta trae el sello embedding_model_sha256 del modelo activo (e5)", async () => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'embedding_model_sha256'",
    );
    expect(row?.value).toBe(E5);
  });

  it("el journal_mode resultante es WAL", async () => {
    const row = await db.getFirstAsync<{ journal_mode: string }>("PRAGMA journal_mode");
    expect(row?.journal_mode).toBe("wal");
  });
});

describe("B — el fixture v1 abierto llega al mismo censo", () => {
  let copyPath = "";

  beforeAll(async () => {
    await resetDatabase(); // cae el handle de A; su directorio se descarta
    const dir = tmp("nido-census-b-");
    copyPath = join(dir, "k.db");
    copyFileSync(join(FIX, "knowledge.v1.db"), copyPath);
    setKnowledgeDbTestDriver({
      dbDir: () => "file:///docs/SQLite/",
      openDb: async () => makeNodeSqliteHandle(copyPath),
      exists: async () => true,
      remove: async () => {},
      rename: async () => {
        throw new Error("rename no usado");
      },
      writeFile: async () => {
        throw new Error("writeFile no usado");
      },
    });
  });

  afterAll(() => {
    setKnowledgeDbTestDriver(null);
  });

  it("el censo tras abrir el v1 es idéntico al de la base fresca", async () => {
    const db = await getDb();
    const censusB = await readCensus(db);
    expect(censusA).not.toBeNull();
    expect(censusB.tables).toEqual(censusA!.tables);
    expect(censusB.indexes).toEqual(censusA!.indexes);
    expect(censusB.columns).toEqual(censusA!.columns);
  });

  it("los dos ALTER históricos dispararon y schema_version sigue en '1'", async () => {
    const db = await getDb();
    const msgs = await db.getAllAsync<{ name: string }>("PRAGMA table_info(chat_messages)");
    expect(msgs.map((c) => c.name)).toContain("interrupted");
    const colls = await db.getAllAsync<{ name: string }>("PRAGMA table_info(custom_collections)");
    expect(colls.map((c) => c.name)).toContain("last_accessed");
    const check = new DatabaseSync(copyPath);
    try {
      const row = check.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as {
        value: string;
      };
      expect(row.value).toBe("1");
    } finally {
      check.close();
    }
  });
});

describe("C — el FTS no nace vacío", () => {
  let db: KnowledgeDbHandle;

  beforeAll(async () => {
    await resetDatabase();
    setKnowledgeDbDir(tmp("nido-census-c-"));
    db = await getDb();
    await insertChunk(
      {
        chunkId: "censo-1",
        docId: "doc-censo",
        title: "Guía de censo",
        body: "contenido buscable del censo de esquema",
      },
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
    );
  });

  it("tras insertChunk, la fila espejo existe en chunks_fts y un MATCH la encuentra", async () => {
    const all = await db.getAllAsync<{ chunk_id: string }>("SELECT chunk_id FROM chunks_fts");
    expect(all).toEqual([{ chunk_id: "censo-1" }]);
    const found = await db.getAllAsync<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH 'buscable'",
    );
    expect(found).toEqual([{ chunk_id: "censo-1" }]);
  });

  it("la fila de chunk_embeddings acompaña", async () => {
    expect(await countChunkVectors()).toEqual({ chunks: 1, withVector: 1 });
  });
});

afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});
