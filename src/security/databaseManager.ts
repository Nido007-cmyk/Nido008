/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * databaseManager.ts — NIDO: gestor centralizado de la base `nido_memory.db`.
 *
 * Unifica el acceso de los 4 stores (memory, tasks, skills, graph) a una
 * sola conexión coordinada. Resuelve la deuda arquitectónica H-1/H-2/H-3:
 *
 * - UNA sola conexión (no 4 handles independientes)
 * - UN solo writeQueue global (escrituras serializadas entre stores)
 * - Wipe gate centralizado (todos los stores respetan Clear All Data)
 * - Epoch único (invalida handles tras wipe)
 * - Schema version unificada
 * - close() real que cierra el handle
 *
 * Garantías de seguridad (no se debilitan):
 * - SQLCipher siempre (fail-closed si no hay clave)
 * - Cero fallback a plaintext
 * - DbLifecycleEndedError tras wipe
 *
 * Uso:
 *   import { getDatabase, writeTransaction } from "../security/databaseManager";
 *   const db = await getDatabase();
 *   await writeTransaction(async (db) => { ... });
 *
 * Recreación de PC (alineación al móvil, cierre R1): el contrato del
 * 0.1.108 (la interfaz, el DDL unificado, el singleton con su epoch, la
 * cola única de escrituras, la barrera de wipe, las migraciones
 * versionadas y safeJsonParse) se copia tal cual. El suelo de la apertura
 * es la base cifrada de la app de E2, nunca la base de conocimiento:
 * - la DEK es la del almacén de la app (`privacy/keyManager`
 *   getDatabaseKeyHex sobre `security/appStore`, por proveedor inyectable).
 *   Sin clave, la apertura falla cerrada y no hay rama de desarrollo en
 *   claro;
 * - la apertura y el borrado pasan por `ensureEncryptedDatabase` y
 *   `deleteManagedDatabase` de E2 (SQLCipher sobre
 *   better-sqlite3-multiple-ciphers) en el directorio de datos de la app;
 * - el handle asíncrono de seis métodos es un adaptador sobre el SecureDb
 *   síncrono de E2, igual que en rag/db.ts (D-7a);
 * - el error de ciclo de vida y la barrera de wipe viven en este módulo,
 *   porque la forma de E2 en PC no los trae (en el móvil cuelgan de
 *   secureDatabase). La barrera la arma wipeDatabase mientras dura el
 *   borrado.
 */

// Tipo local para evitar importar expo-sqlite (paquete roto en entorno de tests).
// En producción, la forma real viene de secureDatabase.
/**
 * H8-2026-10-06: esta interfaz DEBE coincidir con SecureDbHandle
 * (src/security/secureDatabase.ts). La versión anterior declaraba
 * `execAsync(sql, params?)` (el wrapper real IGNORA params — la misma
 * clase del bug `LIMIT ?`) y `withTransactionAsync<T>` con retorno T
 * que el runtime no entrega. El cast `as unknown as` ocultaba el desajuste.
 */
interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
import { getDatabaseKeyHex } from "../privacy/keyManager.js";
import {
  deleteManagedDatabase,
  ensureEncryptedDatabase,
  type SecureDb,
} from "./secureDatabase.js";
import { appStoreDir } from "./appStore.js";
import {
  MEMORY_DB_SCHEMA_VERSION,
  MemoryDbVersionError,
} from "./formatVersion.js";
import { applyMigrations } from "./dbMigrations.js";
import { MEMORY_MIGRATIONS } from "./memoryMigrations.js";

/** Error de ciclo de vida: el handle es de un ciclo ya terminado (wipe/close). */
export class DbLifecycleEndedError extends Error {
  constructor(name: string) {
    super(`${name}: el ciclo de vida de la base terminó (borrado o cierre); reabre con getDatabase().`);
    this.name = "DbLifecycleEndedError";
  }
}

/** Barrera de wipe: mientras dura un borrado, nada atraviesa (ver wipeDatabase). */
let wipeGate: Promise<void> | null = null;
function getWipeGate(): Promise<void> | null {
  return wipeGate;
}

type SecureDbHandle = SQLiteDatabase;

const HANDLE_METHODS = [
  "execAsync",
  "getAllAsync",
  "getFirstAsync",
  "runAsync",
  "withTransactionAsync",
  "closeAsync",
] as const;

function assertDbHandleShape(db: unknown, where: string): void {
  const h = db as Record<string, unknown> | null | undefined;
  const missing = HANDLE_METHODS.filter((k) => typeof h?.[k] !== "function");
  if (missing.length > 0) {
    throw new Error(`Handle de base incompleto en ${where}: faltan ${missing.join(", ")}`);
  }
}

/** Adaptador del handle asíncrono sobre el SecureDb síncrono de E2 (como rag/db.ts, D-7a). */
function adaptSecureDb(db: SecureDb): SQLiteDatabase {
  const bind = (params?: unknown[]) => (params ?? []) as never[];
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      db.prepare(sql).all(...bind(params)) as T[],
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> =>
      (db.prepare(sql).get(...bind(params)) ?? null) as T | null,
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = db.prepare(sql).run(...bind(params));
        return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
      }
      const info = db.prepare(sql).run();
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec("BEGIN");
      try {
        await fn();
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* el error original es lo que importa */
        }
        throw e;
      }
    },
    closeAsync: async () => {
      db.close();
    },
  };
}

const DB_NAME = "nido_memory.db";
const SCHEMA_VERSION = MEMORY_DB_SCHEMA_VERSION;

/** DDL unificado: todas las tablas de los 4 stores. */
const UNIFIED_DDL = `
-- Tabla de versión (fuente de verdad del esquema)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Memory store (facts, preferences, people, logs, reminders, notes)
CREATE TABLE IF NOT EXISTS facts (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'general',
  confidence REAL NOT NULL DEFAULT 1.0,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  relationship TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_log (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,
  entry      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_log_day ON daily_log(day);
CREATE TABLE IF NOT EXISTS agent_notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_reminders (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  due_at     TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON agent_reminders(due_at) WHERE done = 0;
-- 0.1.32: ritmo de los recordatorios que se repiten. Tabla aparte (aditiva,
-- sin migración): una base vieja simplemente no tiene filas aquí.
CREATE TABLE IF NOT EXISTS agent_reminder_repeat (
  reminder_id TEXT PRIMARY KEY,
  every       TEXT NOT NULL CHECK (every IN ('day', 'week'))
);
-- 0.1.35: «cada mes» / «cada año». Tabla aparte (aditiva): la de arriba
-- tiene CHECK (day, week) en las bases ya creadas y no se puede alterar.
CREATE TABLE IF NOT EXISTS agent_reminder_repeat_cal (
  reminder_id TEXT PRIMARY KEY,
  every       TEXT NOT NULL CHECK (every IN ('month', 'year'))
);

-- Task store (scheduled tasks)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  instruction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  notify_on_complete INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tools_used TEXT NOT NULL DEFAULT '[]',
  policy_decisions INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON scheduled_task_runs(task_id);

-- Historial de acciones del agente. Nunca guarda argumentos ni resultados:
-- solo la herramienta, el desenlace y, si la acción se puede deshacer, el
-- id de lo que creó.
CREATE TABLE IF NOT EXISTS agent_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  outcome TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  undo_kind TEXT,
  undo_id TEXT,
  undone INTEGER NOT NULL DEFAULT 0
);

-- Learned skills store
CREATE TABLE IF NOT EXISTS learned_skills (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  total_uses INTEGER NOT NULL DEFAULT 0,
  learned_from TEXT NOT NULL DEFAULT '',
  refinements TEXT NOT NULL DEFAULT '[]'
);

-- T-17 (0.1.99, m-92): el grafo de conocimiento se retiró entero
-- (decisión del dueño). Ningún código de producción escribió nunca
-- en kg_entities/kg_relations: las instalaciones existentes
-- conservan esas dos tablas vacías como huérfanas inocuas y las
-- nuevas ya no las crean.

-- E7 paso 1: la agenda de la persona (AGENDA-PC §3.1 y §4.1;
-- AVISOS-ETAPA §3.1). Aditiva, como las tablas de ritmo de arriba:
-- nace con CREATE TABLE IF NOT EXISTS sobre la base personal, sin
-- bump de versión (el marcador sigue en MEMORY_DB_SCHEMA_VERSION
-- y su disciplina no cambia). Las tres tablas viven en ESTA base,
-- la que el respaldo y la rotación de E2 ya nombran en su censo
-- multi-base: la agenda entra en ese censo por construcción, sin
-- fichero nuevo que pudiera quedar fuera.
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  rrule TEXT,
  rrule_until INTEGER,
  alert_offset_min INTEGER,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_starts ON calendar_events(starts_at);
-- La ficha de contacto (AGENDA-PC §4.1): phones y emails van como
-- JSON (cero o varios, con su etiqueta), en la forma que el paso 4
-- consume; el cumpleaños se guarda sin año salvo que la persona
-- lo dé.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  relation TEXT,
  birthday_month INTEGER,
  birthday_day INTEGER,
  birthday_year INTEGER,
  phones TEXT NOT NULL DEFAULT '[]',
  emails TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  alert_lead_days INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- La cola de avisos (AVISOS-ETAPA §3.1, unión del dirimen H-1):
-- base_local + repeat son la verdad; next_fire_at es el epoch
-- derivado e indexado. Su única escritura es noticeStore.
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT,
  body_json TEXT NOT NULL DEFAULT '{}',
  base_local TEXT NOT NULL,
  repeat TEXT,
  next_fire_at INTEGER NOT NULL,
  ends_at INTEGER,
  state TEXT NOT NULL DEFAULT 'armed',
  snooze_until INTEGER,
  last_fired_at INTEGER,
  missed_count INTEGER NOT NULL DEFAULT 0,
  source_chat TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_next_fire ON notices(next_fire_at) WHERE state = 'armed';
`;

// ---------------------------------------------------------------------------
// Estado del singleton
// ---------------------------------------------------------------------------

let dbPromise: Promise<SQLiteDatabase> | null = null;
let openEpoch = -1;
let currentEpoch = 0;
let writeChain: Promise<unknown> = Promise.resolve();

/** Devuelve el epoch actual (para tests). */
export function getDatabaseEpoch(): number {
  return currentEpoch;
}

/**
 * Obtiene la conexión única a nido_memory.db.
 * Respeta wipe gate, epoch, y fail-closed.
 */
export async function getDatabase(): Promise<SQLiteDatabase> {
  return getDatabaseForEpoch(currentEpoch);
}

async function getDatabaseForEpoch(
  epoch: number
): Promise<SQLiteDatabase> {
  // Barrera de wipe: ni lecturas, ni aperturas, ni DDL atraviesan un
  // Clear All Data en curso.
  const gate = getWipeGate();
  if (gate) await gate;
  if (epoch !== currentEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  if (!dbPromise) {
    openEpoch = epoch;
    const fresh = openAndMigrate();
    dbPromise = fresh;
    // No cachear un rechazo: si la apertura falla, el próximo getDatabase()
    // reintenta en vez de recibir una promesa envenenada.
    fresh.catch(() => {
      if (dbPromise === fresh) {
        dbPromise = null;
        openEpoch = -1;
      }
    });
  }
  const db = await dbPromise;
  if (epoch !== currentEpoch || epoch !== openEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  return db;
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  // Fail-closed: si getDatabaseKeyHex falla, el error se propaga.
  // NO hay fallback a plaintext (corregido en commit ad1f82c).
  const encryptionKeyHex = await getDatabaseKeyHex();

  // PC: apertura cifrada de E2 en el directorio de la app, con la DEK
  // del almacén de la app; el handle se verifica antes de usarlo.
  const rawDb = adaptSecureDb(
    ensureEncryptedDatabase(appStoreDir(), DB_NAME, Buffer.from(encryptionKeyHex, "hex")),
  );
  assertDbHandleShape(rawDb, "databaseManager.openAndMigrate");
  const db = rawDb as SecureDbHandle;

  try {
    await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync(UNIFIED_DDL);

    // FASE 1 RISK-3 (2026-10-09): usar el framework de migraciones versionadas.
    // Con MEMORY_MIGRATIONS vacío, el comportamiento es idéntico al anterior:
    // - Sin schema_version → lo estampa con SCHEMA_VERSION (first-open)
    // - Con versión actual → no-op
    // - Con versión corrupta o futura → MemoryDbVersionError (fail-closed)
    await applyMigrations(db, {
      formatId: "nido_memory.db",
      supportedMajor: SCHEMA_VERSION,
      ErrorClass: MemoryDbVersionError,
      migrations: MEMORY_MIGRATIONS,
    });
  } catch (err) {
    try {
      await db.closeAsync();
    } catch {
      /* el error original es lo que importa */
    }
    throw err;
  }
  return db;
}

/**
 * Escrituras serializadas sobre la conexión compartida.
 * Todos los stores usan esta única cola (no 4 colas independientes).
 */
export function writeTransaction<T>(
  work: (db: SQLiteDatabase) => Promise<T>
): Promise<T> {
  const scheduledEpoch = currentEpoch;
  const run: Promise<T> = writeChain.then(async (): Promise<T> => {
    const gate = getWipeGate();
    if (gate) await gate;
    if (scheduledEpoch !== currentEpoch) {
      throw new DbLifecycleEndedError(DB_NAME);
    }
    const db = await getDatabaseForEpoch(scheduledEpoch);
    let result: T;
    await db.withTransactionAsync(async () => {
      result = await work(db);
    });
    return result!;
  });
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Cierra la conexión real y avanza el epoch.
 * Después de esto, getDatabase() reabre limpiamente.
 */
export async function closeDatabase(): Promise<void> {
  currentEpoch++;
  const old = dbPromise;
  dbPromise = null;
  openEpoch = -1;
  if (old) {
    try {
      const db = await old;
      await db.closeAsync();
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Wipe completo: elimina la base y rota la DEK.
 * Después del wipe, ningún store puede recuperar datos viejos.
 */
export async function wipeDatabase(): Promise<void> {
  // PC: la barrera de wipe vive aquí (ver la cabecera): mientras dura el
  // borrado, ni lecturas ni aperturas ni escrituras la atraviesan.
  let release!: () => void;
  wipeGate = new Promise<void>((res) => {
    release = res;
  });
  try {
    await closeDatabase();
    deleteManagedDatabase(appStoreDir(), DB_NAME);
    // El epoch ya avanzó en closeDatabase; la próxima apertura usa DEK nueva.
  } finally {
    wipeGate = null;
    release();
  }
}

/**
 * Parsea JSON de forma segura. Retorna fallback si el dato está corrupto.
 * (Resuelve H-5: JSON.parse sin protección)
 */
export function safeJsonParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
