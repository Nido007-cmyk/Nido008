/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * db.e6D9.test.ts — batería D-9 de la etapa E6 en su forma del
 * paso 1 (esquema y almacén), contra `estudios/E6-APERTURA.md`
 * y la hoja de ejecución de la etapa: D-9 cobra que con la
 * bóveda bloqueada nada se lee ni se cita, y que al desbloquear
 * todo vuelve sin reimportar. En el paso 1 su forma cobrable es
 * la del almacén: la base se abre solo por la función única de
 * E2 (sin DEK no hay base, y no se crea fichero alguno), y el
 * esquema que vuelve al desbloquear trae las tres adiciones de
 * la etapa (`chunks.page`, `chunks.origen`,
 * `custom_collections.page_count`) con sus defaults honestos.
 * La forma de importación de D-9 la ejercitan los pasos que
 * traen el importador, sobre esta misma base.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

import { makeNodeSqliteHandle, fixtureDekProvider } from "./dbTestHarness.js";
import {
  getDb,
  insertChunk,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
  type KnowledgeDbHandle,
} from "./db.js";

interface ColInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

async function colInfo(db: KnowledgeDbHandle, table: string): Promise<ColInfo[]> {
  return db.getAllAsync<ColInfo>(`PRAGMA table_info(${table})`);
}

let tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

describe("A — el almacén vacío, abierto por la función única", () => {
  let db: KnowledgeDbHandle;

  beforeAll(async () => {
    setKnowledgeDbDir(tmp("nido-e6d9-a-"));
    setKnowledgeDbDekProvider(fixtureDekProvider);
    db = await getDb();
  });

  it("chunks trae page INTEGER NULL y origen TEXT NOT NULL DEFAULT 'texto'", async () => {
    const cols = await colInfo(db, "chunks");
    const page = cols.find((c) => c.name === "page");
    const origen = cols.find((c) => c.name === "origen");
    expect(page).toBeDefined();
    expect(page!.type).toBe("INTEGER");
    expect(page!.notnull).toBe(0);
    expect(origen).toBeDefined();
    expect(origen!.type).toBe("TEXT");
    expect(origen!.notnull).toBe(1);
    expect(origen!.dflt_value).toBe("'texto'");
  });

  it("custom_collections trae page_count INTEGER NULL", async () => {
    const cols = await colInfo(db, "custom_collections");
    const pc = cols.find((c) => c.name === "page_count");
    expect(pc).toBeDefined();
    expect(pc!.type).toBe("INTEGER");
    expect(pc!.notnull).toBe(0);
  });

  it("un fragmento escrito por el camino vigente se lee con page NULL y origen 'texto'", async () => {
    await insertChunk(
      { chunkId: "e6d9-1", docId: "doc-e6d9", title: "T", body: "cuerpo del paso 1" },
      new Float32Array([0.1, 0.2, 0.3]),
    );
    const row = await db.getFirstAsync<{ page: number | null; origen: string }>(
      "SELECT page, origen FROM chunks WHERE chunk_id = 'e6d9-1'",
    );
    expect(row?.page).toBeNull();
    expect(row?.origen).toBe("texto");
  });
});

describe("B — la base heredada llega al mismo esquema", () => {
  let copyPath = "";

  beforeAll(async () => {
    await resetDatabase();
    const dir = tmp("nido-e6d9-b-");
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

  it("tras abrir el v1, las tres columnas existen y el default se lee en una fila escrita sin ellas", async () => {
    const db = await getDb();
    const chunks = await colInfo(db, "chunks");
    expect(chunks.map((c) => c.name)).toContain("page");
    expect(chunks.map((c) => c.name)).toContain("origen");
    const colls = await colInfo(db, "custom_collections");
    expect(colls.map((c) => c.name)).toContain("page_count");
    await db.runAsync(
      "INSERT INTO chunks (chunk_id, doc_id, title, body, source) VALUES ('e6d9-v1', 'd', 't', 'b', NULL)",
    );
    const row = await db.getFirstAsync<{ page: number | null; origen: string }>(
      "SELECT page, origen FROM chunks WHERE chunk_id = 'e6d9-v1'",
    );
    expect(row?.page).toBeNull();
    expect(row?.origen).toBe("texto");
  });

  it("una base que ya trae las tres columnas abre sin duplicarlas (la guarda del ALTER)", async () => {
    const dir = tmp("nido-e6d9-b2-");
    const p = join(dir, "k2.db");
    copyFileSync(join(FIX, "knowledge.v1.db"), p);
    const raw = new DatabaseSync(p);
    try {
      raw.exec("ALTER TABLE chunks ADD COLUMN page INTEGER NULL");
      raw.exec("ALTER TABLE chunks ADD COLUMN origen TEXT NOT NULL DEFAULT 'texto'");
      raw.exec("ALTER TABLE custom_collections ADD COLUMN page_count INTEGER NULL");
    } finally {
      raw.close();
    }
    setKnowledgeDbTestDriver({
      dbDir: () => "file:///docs/SQLite/",
      openDb: async () => makeNodeSqliteHandle(p),
      exists: async () => true,
      remove: async () => {},
      rename: async () => {
        throw new Error("rename no usado");
      },
      writeFile: async () => {
        throw new Error("writeFile no usado");
      },
    });
    await resetDatabase();
    const db = await getDb();
    const chunks = await colInfo(db, "chunks");
    expect(chunks.filter((c) => c.name === "page")).toHaveLength(1);
    expect(chunks.filter((c) => c.name === "origen")).toHaveLength(1);
    const colls = await colInfo(db, "custom_collections");
    expect(colls.filter((c) => c.name === "page_count")).toHaveLength(1);
    setKnowledgeDbTestDriver(null);
  });
});

describe("C — D-9: con la bóveda bloqueada no hay base; al desbloquear, todo vuelve", () => {
  let dir = "";

  beforeAll(async () => {
    await resetDatabase();
    dir = tmp("nido-e6d9-c-");
    setKnowledgeDbDir(dir);
  });

  it("sin DEK, getDb() rechaza fail-closed y no se crea fichero de base alguno", async () => {
    setKnowledgeDbDekProvider(() => null);
    await expect(getDb()).rejects.toThrow(/fail-closed|sin DEK/);
    const files = readdirSync(dir);
    expect(files.filter((f) => f.startsWith("nido_knowledge.db"))).toEqual([]);
  });

  it("con la DEK entregada, la misma apertura sirve el esquema entero con las tres adiciones", async () => {
    setKnowledgeDbDekProvider(fixtureDekProvider);
    const db = await getDb();
    const chunks = await colInfo(db, "chunks");
    expect(chunks.map((c) => c.name)).toContain("page");
    expect(chunks.map((c) => c.name)).toContain("origen");
    const colls = await colInfo(db, "custom_collections");
    expect(colls.map((c) => c.name)).toContain("page_count");
    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    expect(ver?.value).toBe("1");
  });
});

afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});
