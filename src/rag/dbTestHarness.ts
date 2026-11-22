/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * dbTestHarness.ts — arnés compartido de las baterías `db.*` de la capa
 * de conocimiento (E3, tanda 3½ · el esquema, decisión D-2 de su orden).
 *
 * En el móvil las factorías viven en `src/security/secureDbTestHarness.ts`
 * y la costura en `secureDatabase.ts`; en PC la capa de E2 no tiene
 * abstracción de driver donde colgar ninguna de las dos (funciones
 * síncronas de fichero sobre better-sqlite3), así que la costura sigue a
 * la apertura bajo prueba: vive en `src/rag/db.ts`
 * (`setKnowledgeDbTestDriver`) y las factorías aquí.
 *
 * Aquí vive UNA sola versión de cada pieza:
 *
 * - `makeNodeSqliteHandle()`: handle sobre `node:sqlite` con la guarda
 *   `keyApplied` como comportamiento único — sin `PRAGMA key` previo,
 *   una lectura de `sqlite_master` falla como en una base SQLCipher
 *   real («file is not a database»), de modo que una apertura con la
 *   clave equivocada SÍ puede producir el fail-closed del real en
 *   estas suites. Los adornos reales de cada suite (transacción
 *   BEGIN/COMMIT, `foreign_keys` apagado) son opciones nombradas.
 * - `makeFakeFsDriver()`: el driver sobre un sistema de ficheros en
 *   memoria, con sus adornos como opciones.
 * - `fixtureDekProvider`: el proveedor de DEK de fixture (la DEK
 *   «ab…ab» de 32 bytes), el análogo del `fakeKeyManagerModule` del
 *   móvil: las baterías lo registran con `setKnowledgeDbDekProvider`
 *   en vez de re-teclear la clave en cada una.
 *
 * Nada de esto es código de producción: solo lo importan suites.
 */
import { DatabaseSync } from "node:sqlite";
import type { KnowledgeDbDriver, KnowledgeDbHandle } from "./db.js";

export interface NodeSqliteHandleOptions {
  /**
   * `withTransactionAsync` con BEGIN/COMMIT/ROLLBACK reales sobre la
   * conexión. Por defecto, la forma histórica de la mayoría: ejecutar
   * la tarea sin envolver.
   */
  transactional?: boolean;
  /**
   * Ejecuta `PRAGMA foreign_keys = OFF;` al abrir (paridad con el
   * teléfono: la app nunca activa las FK y node:sqlite sí por
   * defecto).
   */
  foreignKeysOff?: boolean;
}

/**
 * Handle sobre un fichero SQLite real servido por `node:sqlite`.
 * `PRAGMA key` es un no-op que ARMA la guarda; la versión de cipher se
 * responde con el literal de fixture; toda la demás SQL corre de verdad.
 */
export function makeNodeSqliteHandle(
  dbPath: string,
  options: NodeSqliteHandleOptions = {},
): KnowledgeDbHandle {
  const sqlite = new DatabaseSync(dbPath);
  if (options.foreignKeysOff) sqlite.exec("PRAGMA foreign_keys = OFF;");
  let keyApplied = false;
  const bind = (params?: unknown[]) => (params ?? []) as never[];
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) {
        keyApplied = true;
        return; // no-op en node:sqlite: la base de fixture va en claro
      }
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
        // Sin PRAGMA key la base «cifrada» no se puede leer, como una
        // base SQLCipher real.
        throw new Error("file is not a database (sin clave)");
      }
      return (sqlite.prepare(sql).get(...bind(params)) ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = sqlite.prepare(sql).run(...bind(params));
        return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
      }
      sqlite.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      if (!options.transactional) {
        await fn();
        return;
      }
      sqlite.exec("BEGIN");
      try {
        await fn();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    closeAsync: async () => {
      sqlite.close();
    },
  };
}

export interface FakeFsDriverOptions {
  /** El «disco» de la suite: mapa ruta → contenido, compartido con sus mundos falsos. */
  files: Map<string, string>;
  /** Fábrica del handle guionizado de la suite (su escenario; no se unifica). */
  makeHandle: (path: string) => KnowledgeDbHandle;
  /** Directorio de documentos del mundo falso. Por defecto `file:///docs/`. */
  docDir?: string;
  /** Contenido que `openDb` deja en `files` al abrir. Por defecto `"db-bytes"`. */
  bytesOnOpen?: string;
  /** Compuerta previa a la apertura. */
  beforeOpen?: (path: string) => Promise<void>;
  /** Registro y efectos de la apertura. */
  onOpen?: (path: string, files: Map<string, string>) => void;
  /** Registro del borrado. El borrado en sí siempre ocurre. */
  onRemove?: (path: string) => void;
  /** Mensaje del `rename` cuando la suite no lo usa. */
  renameError?: string;
}

/**
 * El driver sobre un sistema de ficheros en memoria: la cáscara
 * (dbDir, exists por mapa, remove que borra, writeFile que guarda,
 * rename que lanza «no usado») es una sola; lo que varía — el handle
 * guionizado, los registros, las compuertas — entra como opciones.
 */
export function makeFakeFsDriver(options: FakeFsDriverOptions): KnowledgeDbDriver {
  const docDir = options.docDir ?? "file:///docs/";
  return {
    dbDir: () => `${docDir}SQLite/`,
    openDb: async (path: string) => {
      await options.beforeOpen?.(path);
      options.onOpen?.(path, options.files);
      options.files.set(path, options.bytesOnOpen ?? "db-bytes");
      return options.makeHandle(path);
    },
    exists: async (path: string) => options.files.has(path),
    remove: async (path: string) => {
      options.onRemove?.(path);
      options.files.delete(path);
    },
    rename: async () => {
      throw new Error(options.renameError ?? "rename no usado en estos tests");
    },
    writeFile: async (path: string, content: string) => {
      options.files.set(path, content);
    },
  };
}

/** La DEK de fixture: «ab»×32, la misma que produce el escritor de los fixtures L2. */
export const FIXTURE_DEK: Buffer = Buffer.from("ab".repeat(32), "hex");

/** Proveedor de DEK de fixture para `setKnowledgeDbDekProvider`. */
export function fixtureDekProvider(): Buffer {
  return FIXTURE_DEK;
}
