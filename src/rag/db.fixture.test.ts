/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * db.fixture.test.ts — L2 HISTORICAL FIXTURE CORPUS + MIGRATION
 * HARNESS (nido_knowledge.db).
 *
 * Longevity rule under test: "v1 data opens in current code; unknown
 * major fails closed with a named error". The fixtures in
 * __fixtures__/ are real SQLite files whose schema + meta stamp were
 * produced by executing the REAL writer's own SQL (getDb →
 * openAndMigrate) — see __fixtures__/README. Negatives mutate ONLY
 * meta.schema_version.
 *
 * Harness strategy: the injected fake driver opens a TEMP COPY of
 * the fixture file with node:sqlite and lets the REAL getDb() code
 * path run its real SQL against it — including the real
 * `SELECT value FROM meta WHERE key='schema_version'` and the real
 * checkFormatVersion. The version verdict therefore comes from the
 * fixture's actual bytes, not from a canned value.
 *
 * Encoded L1 semantics:
 * - v1 → ACCEPT.
 * - v2 / v99 / corrupt → REJECT with KnowledgeDbVersionError (exact name).
 * - no meta row → ACCEPT + stamp v1 (first-open stamping, L1 semantics).
 *
 * Asiento de PC (E3, tanda 3½ · el esquema, decisión D-8 de su
 * orden): esta batería se recrea SOLO con el describe de longevidad
 * (5 casos). El describe del router (0.1.39) de la fuente (4 casos,
 * sobre `routerStats` y `missedPhrases`) NO está en este fichero:
 * es de la tanda 11, que lo añadirá aquí mismo sin tocar los ya
 * cobrados. Las adaptaciones de importación son las de la casa en
 * PC: la costura vive en `./db` (D-2), el handle en
 * `./dbTestHarness`, la DEK llega por el proveedor de fixture (D-3)
 * y no existen los módulos de plataforma del móvil.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixturePath = (name: string): string => join(FIX, name);
const DOC = "file:///docs/";

import { makeNodeSqliteHandle, fixtureDekProvider } from "./dbTestHarness.js";
import { KnowledgeDbVersionError } from "../security/formatVersion.js";
import {
  getDb,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
  setKnowledgeDbTestDriver,
} from "./db.js";

// ---------------------------------------------------------------------------
// Driver respaldado por el fixture real
// ---------------------------------------------------------------------------
let tmpDirs: string[] = [];
let scratchDir = "";

/** Copia el fixture a un temp (el test no-meta escribe el stamp; el fixture no se toca). */
function stageFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-l2-knowledge-"));
  tmpDirs.push(dir);
  const tmp = join(dir, "fixture.db");
  copyFileSync(fixturePath(name), tmp);
  return tmp;
}

/** El driver "ve" el fixture como la base existente (sin tmp ni marker). */
function useFixture(name: string): string {
  const dbPath = stageFixture(name);
  setKnowledgeDbTestDriver({
    dbDir: () => `${DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_knowledge.db")) throw new Error(`DB inesperada: ${path}`);
      return makeNodeSqliteHandle(dbPath);
    },
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado en estos tests");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado en estos tests");
    },
  });
  return dbPath;
}

function readStamp(dbPath: string): string | null {
  const check = new DatabaseSync(dbPath);
  try {
    const row = check.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } finally {
    check.close();
  }
}

beforeEach(async () => {
  tmpDirs = [];
  scratchDir = mkdtempSync(join(tmpdir(), "nido-l2-scratch-"));
  tmpDirs.push(scratchDir);
  // El resetDatabase() de aislamiento corre por el camino de
  // producción: su directorio es un temporal desechable de la suite.
  setKnowledgeDbDir(scratchDir);
  setKnowledgeDbDekProvider(fixtureDekProvider);
  // Aislar la promesa cacheada entre tests (bump de epoch, sin sleeps).
  await resetDatabase();
});

afterEach(() => {
  setKnowledgeDbTestDriver(null);
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("knowledge DB fixture corpus — longevity contract", () => {
  it("v1 fixture abre con el código actual → ACCEPT", async () => {
    useFixture("knowledge.v1.db");
    await expect(getDb()).resolves.toBeDefined();
  });

  it("v99 fixture → REJECT con KnowledgeDbVersionError (nombre exacto)", async () => {
    useFixture("knowledge.v99.db");
    const err = await getDb().catch((e) => e);
    expect(err).toBeInstanceOf(KnowledgeDbVersionError);
    expect((err as Error).name).toBe("KnowledgeDbVersionError");
    expect((err as Error).message).toContain("nido_knowledge.db");
  });

  it("v2 fixture (más nueva que este lector) → REJECT con KnowledgeDbVersionError", async () => {
    useFixture("knowledge.v2.db");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("versión corrupta → REJECT con KnowledgeDbVersionError", async () => {
    useFixture("knowledge.corrupt-version.db");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("sin fila meta → ACCEPT y estampa v1 (semántica L1 de primera apertura)", async () => {
    const dbPath = useFixture("knowledge.no-meta.db");
    expect(readStamp(dbPath)).toBeNull();
    await expect(getDb()).resolves.toBeDefined();
    // El stamp lo escribió el propio código al abrir, no el test.
    expect(readStamp(dbPath)).toBe("1");
  });
});
