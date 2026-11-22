/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * db.version.test.ts — L1 FORMAT VERSIONING CONTRACT (base de
 * conocimiento).
 *
 * - nido_knowledge.db: tabla meta(schema_version) — stamp v1 en la
 *   primera apertura, enforcement en cada apertura posterior.
 *   Ausente (donde el stamp ya debería existir), desconocida o
 *   corrupta → fail-closed con KnowledgeDbVersionError.
 *
 * Estrategia: código REAL (rag/db) contra un driver falso inyectado
 * con setKnowledgeDbTestDriver, siguiendo el patrón de
 * db.lifecycle.test.ts. La versión que "contiene" la base se
 * configura por test (fx.versions): ausente del mapa = sin fila →
 * ruta de stamp. Nada aquí depende de timings.
 *
 * Asiento de PC (E3, tanda 3½ · el esquema, decisión D-8 de su
 * orden): esta batería se recrea SOLO con el describe de
 * conocimiento (5 casos). El describe de memoria de la fuente
 * («memory DB version contract», 5 casos) NO está en este fichero:
 * es de la tanda 13, que lo añadirá aquí mismo sin tocar los ya
 * cobrados. Las adaptaciones de importación de la cabecera son las
 * de la casa en PC: la costura vive en `./db` (D-2), las factorías
 * en `./dbTestHarness`, la DEK llega por el proveedor de fixture
 * (D-3) y no existen los módulos de plataforma del móvil
 * (expo-sqlite, expo-file-system, keyManager).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mundo falso (hoisted)
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  const runLog: string[] = []; // runAsync: SQL + params (para afirmar el stamp)
  // dbName -> valor crudo de meta.schema_version. Ausente del mapa = sin fila.
  const versions = new Map<string, string>();
  const opens: string[] = [];

  function reset(): void {
    files.clear();
    runLog.length = 0;
    versions.clear();
    opens.length = 0;
  }

  function makeHandle(path: string) {
    let keyApplied = false;
    return {
      execAsync: async (sql: string) => {
        if (/^\s*PRAGMA\s+key/i.test(sql)) keyApplied = true;
      },
      getAllAsync: async <T>(sql: string): Promise<T[]> => {
        if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
        if (/table_info\s*\(\s*chunks\s*\)/i.test(sql))
          return [{ name: "chunk_id" }, { name: "collection_id" }] as T[];
        return [] as T[];
      },
      getFirstAsync: async <T>(sql: string): Promise<T | null> => {
        if (/schema_version/.test(sql)) {
          const v = [...versions.entries()].find(([name]) => path.includes(name))?.[1];
          return v === undefined ? null : ({ value: v } as T);
        }
        if (/integrity_check/i.test(sql)) return { integrity_check: "ok" } as T;
        if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
          throw new Error("file is not a database (sin clave)");
        }
        return { n: 1 } as T;
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        runLog.push(`RUN ${sql} :: ${JSON.stringify(params ?? [])}`);
        return { lastInsertRowId: 0, changes: 0 };
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        await fn();
      },
      closeAsync: async () => {},
    };
  }

  function makeDriver() {
    return makeFakeFsDriver({
      files,
      makeHandle,
      docDir: DOC,
      onOpen: (path) => {
        opens.push(path);
      },
    });
  }

  return { DOC, files, runLog, versions, opens, makeDriver, reset };
});

import { makeFakeFsDriver, fixtureDekProvider } from "./dbTestHarness.js";
import { KnowledgeDbVersionError } from "../security/formatVersion.js";
import { getDb, resetDatabase, setKnowledgeDbDekProvider, setKnowledgeDbTestDriver } from "./db.js";

beforeEach(async () => {
  fx.reset();
  setKnowledgeDbTestDriver(fx.makeDriver());
  setKnowledgeDbDekProvider(fixtureDekProvider);
  // Aislar la promesa cacheada entre tests (bump de epoch, sin sleeps).
  await resetDatabase();
});

afterEach(() => {
  setKnowledgeDbTestDriver(null);
  setKnowledgeDbDekProvider(null);
});

function stampLogged(): boolean {
  return fx.runLog.some(
    (l) => /INSERT INTO meta/i.test(l) && /schema_version/.test(l) && l.includes('"1"'),
  );
}

// ---------------------------------------------------------------------------
// nido_knowledge.db
// ---------------------------------------------------------------------------
describe("knowledge DB version contract (nido_knowledge.db)", () => {
  it("base nueva (sin fila meta): estampa schema_version=1 y abre", async () => {
    await expect(getDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(true);
  });

  it("schema_version=1 abre sin re-estampar", async () => {
    fx.versions.set("nido_knowledge.db", "1");
    await expect(getDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(false);
  });

  it("schema_version=2 (más nueva) falla cerrada con KnowledgeDbVersionError", async () => {
    fx.versions.set("nido_knowledge.db", "2");
    const err = await getDb().catch((e) => e);
    expect(err).toBeInstanceOf(KnowledgeDbVersionError);
    expect((err as Error).name).toBe("KnowledgeDbVersionError");
    expect((err as Error).message).toContain("nido_knowledge.db");
  });

  it("schema_version corrupta falla cerrada", async () => {
    fx.versions.set("nido_knowledge.db", "banana");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("tras un rechazo, la promesa no queda envenenada: con v1 la siguiente apertura funciona", async () => {
    fx.versions.set("nido_knowledge.db", "2");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
    fx.versions.set("nido_knowledge.db", "1");
    await expect(getDb()).resolves.toBeDefined();
  });
});
