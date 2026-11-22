/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El almacén de conocimiento de PC: la envoltura `getDb` sobre la
 * apertura cifrada de E2 y el esquema que `openAndMigrate` crea al
 * abrir `nido_knowledge.db` — la DDL de las 12 tablas y el FTS5, los
 * cuatro ALTER guardados y las dos puertas de apertura (versión de
 * formato y sello de embeddings) — más el epoch de ciclo de vida,
 * `resetDatabase`, el escritor mínimo `insertChunk` y las funciones
 * que la capa de búsqueda consume (las cinco que J-2 importaba de
 * este módulo y `getEmbeddingStamp`).
 *
 * Recién recreado en la tanda 3½ (el esquema), que sustituyó entero
 * el marcador fail-closed que J-2 dejó en esta ruta. El resto de
 * `db.ts` quedó fuera con su sede: colecciones, avisos y huellas →
 * E6 (traídos en su paso 2, con `insertChunkWithoutEmbedding`);
 * `deleteSeedChunks` → la tanda de `seedCorpus`; el cluster de
 * formato de vectores → `vectorFormatMigration` (aquí solo entra
 * su lector interno, como apoyo de los dos productores).
 *
 * Asientos de PC de esta recreación (orden de la tanda, §3):
 * - D-2 · La costura de test vive en este módulo
 *   (`setKnowledgeDbTestDriver`): la capa de E2 no tiene abstracción
 *   de driver donde colgarla (funciones síncronas de fichero, ya
 *   acreditadas tal cual en E2). Sin conductor inyectado, la
 *   apertura corre por `ensureEncryptedDatabase` de E2 y el handle
 *   asíncrono de 6 métodos es un adaptador interno sobre su
 *   `SecureDb` síncrono (D-7a: la envoltura sigue asíncrona porque
 *   sus consumidores y sus baterías están escritos contra esa
 *   forma).
 * - D-3 · La DEK llega por un proveedor inyectable
 *   (`setKnowledgeDbDekProvider`): sin proveedor, o con proveedor
 *   que devuelve `null`, `getDb()` falla cerrado y no crea base
 *   alguna. El registro de producción, respaldado por la
 *   `VaultSession` de E2, lo cablea la carcasa en E3.7; el
 *   directorio de la base se fija igual (`setKnowledgeDbDir`).
 * - D-6 · La migración del nombre de fichero heredado salió con
 *   la purga de la cadena legada: en PC nunca hubo una base
 *   instalada con ese nombre y la línea nació con el nombre
 *   propio, así que no había pasado que migrar.
 * - D-7b · La barrera de wipe (`getWipeGate`) se omite con causa:
 *   en PC no existe aún coordinador de borrado (superficie de
 *   E3.7); las guardas de epoch se recrean enteras.
 * - El error de ciclo de vida `DbLifecycleEndedError` vive en
 *   este módulo: en el móvil cuelga de la capa de seguridad, cuya
 *   forma de PC no lo trae (misma causa que D-2).
 * - Los errores de apertura suben intactos (la etapa que falló se
 *   escribe en el log, no en el mensaje): es la forma que la
 *   propia fuente adoptó para `getDb` tras cazar el mensaje de
 *   etapa llegando a la pantalla de la persona.
 */

import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  assertDek,
  deleteManagedDatabase,
  ensureEncryptedDatabase,
  type SecureDb,
} from "../security/secureDatabase.js";
import {
  KNOWLEDGE_DB_SCHEMA_VERSION,
  KnowledgeDbVersionError,
  checkFormatVersion,
} from "../security/formatVersion.js";
import { quantizeVectorInt8 } from "./pure.js";
import type { ChunkRecord } from "./retrieve.types.js";

export type { ChunkRecord } from "./retrieve.types.js";

const DB_NAME = "nido_knowledge.db";
/** Nombre del fichero de la base de conocimiento (lo necesita el borrado total para verificar). */
export const KNOWLEDGE_DB_NAME = DB_NAME;
/**
 * Sufijos gestionados junto al fichero principal: sidecars de SQLite,
 * temporal de migración y marcador .sqlcipher.
 */
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal", ".migtmp", ".sqlcipher"];

// ---------------------------------------------------------------------------
// Error de ciclo de vida (en el móvil vive en la capa de seguridad; aquí,
// en el módulo dueño del ciclo, por el asiento de la cabecera)
// ---------------------------------------------------------------------------

/**
 * Error lanzado cuando un write encolado pertenece a un ciclo de vida
 * de la base que ya terminó (el borrado total comenzó después de
 * encolar el write). El trabajo obsoleto falla de forma explícita en
 * vez de reabrir o repoblar silenciosamente la base borrada.
 */
export class DbLifecycleEndedError extends Error {
  readonly dbName: string;
  constructor(dbName: string) {
    super(
      `Write rechazado: el ciclo de vida de "${dbName}" terminó ` +
        `(borrado total). El trabajo obsoleto no puede reabrir ni repoblar la base.`,
    );
    this.name = "DbLifecycleEndedError";
    this.dbName = dbName;
  }
}

// ---------------------------------------------------------------------------
// El handle asíncrono de 6 métodos y la costura de test (D-2)
// ---------------------------------------------------------------------------

/** El contrato de handle contra el que corre toda la capa de búsqueda. */
export interface KnowledgeDbHandle {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  closeAsync(): Promise<void>;
  runAsync(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** El conductor inyectable: espejo del `SecureDbDriver` del móvil. */
export interface KnowledgeDbDriver {
  openDb(path: string): Promise<KnowledgeDbHandle>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  dbDir(): string;
}

let testDriver: KnowledgeDbDriver | null = null;

/** Solo para tests: inyecta un conductor falso. */
export function setKnowledgeDbTestDriver(d: KnowledgeDbDriver | null): void {
  testDriver = d;
}

const HANDLE_METHODS = [
  "execAsync",
  "getAllAsync",
  "getFirstAsync",
  "closeAsync",
  "runAsync",
  "withTransactionAsync",
] as const;

/**
 * Verificación explícita de forma en runtime del handle devuelto por
 * la apertura, ANTES de usarlo: los 6 métodos de la interfaz. Un
 * handle al que le falte un método falla aquí con un mensaje claro,
 * en vez de tres llamadas más tarde con "undefined is not a function".
 */
function assertKnowledgeDbHandleShape(db: unknown, where: string): void {
  const h = db as Record<string, unknown> | null | undefined;
  const missing = HANDLE_METHODS.filter((k) => typeof h?.[k] !== "function");
  if (missing.length > 0) {
    throw new Error(`Handle de base incompleto en ${where}: faltan ${missing.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// La DEK (D-3) y el directorio de producción
// ---------------------------------------------------------------------------

/** Proveedor de la DEK vigente: la sesión de la bóveda en producción. */
export type KnowledgeDbDekProvider = () => Buffer | null | Promise<Buffer | null>;

let dekProvider: KnowledgeDbDekProvider | null = null;

/** Registra el proveedor de DEK (la carcasa en E3.7; las baterías, el de fixture). */
export function setKnowledgeDbDekProvider(p: KnowledgeDbDekProvider | null): void {
  dekProvider = p;
}

let knowledgeDir: string | null = null;

/** Fija el directorio de la base de conocimiento (la carcasa en E3.7). */
export function setKnowledgeDbDir(dir: string | null): void {
  knowledgeDir = dir;
}

function baseDir(): string {
  return knowledgeDir ?? join(homedir(), ".nido");
}

/** Directorio con la forma que la envoltura concatena (termina en `/`). */
function activeDbDir(): string {
  return testDriver ? testDriver.dbDir() : `${baseDir()}/`;
}

async function pathExists(path: string): Promise<boolean> {
  return testDriver ? testDriver.exists(path) : existsSync(path);
}

async function pathRename(from: string, to: string): Promise<void> {
  if (testDriver) return testDriver.rename(from, to);
  renameSync(from, to);
}

// ---------------------------------------------------------------------------
// Adaptador del handle de producción sobre el SecureDb síncrono de E2 (D-7a)
// ---------------------------------------------------------------------------

function adaptSecureDb(db: SecureDb): KnowledgeDbHandle {
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
      db.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
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

// ---------------------------------------------------------------------------
// Migración del nombre heredado (D-6: comprobación sin pasado)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Epoch de ciclo de vida
// ---------------------------------------------------------------------------

let dbPromise: Promise<KnowledgeDbHandle> | null = null;

/**
 * Epoch del ciclo de vida de la base de conocimiento. resetDatabase()
 * lo incrementa. Cada writeTransaction captura el epoch al encolarse;
 * cuando le llega su turno solo se ejecuta si el epoch no cambió. Así,
 * un write encolado pero no iniciado antes del borrado total falla de
 * forma explícita (DbLifecycleEndedError) en vez de reabrir/repoblar
 * la base ya borrada.
 *
 * La comprobación ocurre en el momento de ejecución (no solo al
 * encolar), así que ningún timing puede resucitar la base: el trabajo
 * obsoleto nunca llega a llamar a getDb().
 */
let dbEpoch = 0;
/**
 * Epoch para el que se creó el handle/promesa cacheado en `dbPromise`.
 * Junto con el post-chequeo de getDbForEpoch cierra el TOCTOU entre
 * "writer autorizado para el epoch N" y "adquisición del handle": si
 * resetDatabase() avanzó el ciclo de vida mientras se esperaba la
 * apertura, el handle obtenido (viejo o recién creado) se descarta sin
 * usar.
 */
let dbOpenEpoch = -1;

/**
 * Generación actual del ciclo de vida de la base de conocimiento. Las
 * operaciones largas (seed del corpus, import de documentos) la
 * capturan al inicio y la propagan a cada write vía WriteOptions: si
 * el borrado total avanza el ciclo a mitad de la operación, sus writes
 * pendientes fallan con DbLifecycleEndedError en vez de repoblar la
 * base nueva con trabajo obsoleto del ciclo anterior.
 */
export function getDbEpoch(): number {
  return dbEpoch;
}

/** Opciones de escritura: token de ciclo de vida de la operación origen. */
export interface WriteOptions {
  /**
   * Epoch capturado al inicio de una operación larga (seed/import).
   * Por defecto se usa el vigente al encolar el write (correcto para
   * acciones discretas de la persona).
   */
  lifecycleEpoch?: number;
}

/**
 * Opens (and lazily creates) the local knowledge base: an FTS5 virtual
 * table for lexical search plus a parallel table of vector embeddings
 * for semantic search. Entirely local — no network anywhere in this
 * path.
 *
 * Lecturas del ciclo de vida actual: se ligan al epoch vigente en el
 * momento de la llamada. Las escrituras deben pasar por
 * writeTransaction (guard de ciclo de vida + serialización); ver
 * getDbForEpoch.
 */
export function getDb(): Promise<KnowledgeDbHandle> {
  return getDbForEpoch(dbEpoch);
}

/**
 * Adquisición de handle ligada a un epoch concreto (TOCTOU-hardened):
 *
 * 1. Pre-chequeo: si el epoch ya avanzó, se falla sin tocar nada.
 * 2. Post-chequeo tras el `await`: si el borrado total avanzó el epoch
 *    mientras se esperaba la apertura, el handle se descarta sin
 *    usar — nunca se escribe sobre un handle de un ciclo de vida ya
 *    terminado, ni sobre uno recién abierto para el ciclo nuevo por
 *    un writer obsoleto.
 *
 * Invariante: un writer planificado bajo el epoch N no puede adquirir
 * un handle usable después de que reset avance el ciclo de vida a
 * N+1.
 *
 * (La barrera de wipe del móvil se omite con causa: asiento D-7b de
 * la cabecera.)
 */
async function getDbForEpoch(epoch: number): Promise<KnowledgeDbHandle> {
  // Etapa de un fallo de getDb(), solo para el log: el error sube
  // intacto (una etiqueta de etapa en el mensaje llegó una vez a la
  // pantalla de la persona; la lección quedó).
  const dstage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[db] getDb failed at stage ${name}`);
      throw e;
    }
  };
  if (epoch !== dbEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  if (!dbPromise) {
    dbOpenEpoch = epoch;
    const fresh = dstage("openAndMigrate", async () => openAndMigrate());
    dbPromise = fresh;
    // No cachear un rechazo para siempre: si esta apertura falla, se
    // limpia el slot para que la próxima llamada reintente en vez de
    // recibir una promesa envenenada permanentemente. El error
    // original sigue llegando intacto a todos los que esperaban
    // `fresh`.
    fresh.catch(() => {
      if (dbPromise === fresh) {
        dbPromise = null;
        dbOpenEpoch = -1;
      }
    });
  }
  const db = await dbPromise;
  if (epoch !== dbEpoch || epoch !== dbOpenEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  return db;
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * A transaction on the shared connection, run after any other one
 * still in progress. Two overlapping withTransactionAsync calls on
 * one connection fail with "cannot start a transaction within a
 * transaction", so the writes serialize here instead.
 */
export function writeTransaction(
  work: (db: KnowledgeDbHandle) => Promise<void>,
  opts?: WriteOptions,
): Promise<void> {
  // Epoch de la operación origen (seed/import lo capturan al inicio)
  // o, por defecto, el vigente al encolar. El guard compara en
  // ejecución: el trabajo obsoleto falla explícito aunque el epoch
  // avanzara a mitad.
  const scheduledEpoch = opts?.lifecycleEpoch ?? dbEpoch;
  const run = writeChain.then(async () => {
    // Lifecycle guard: si el borrado total comenzó después de encolar
    // este write, fallar explícitamente en vez de reabrir/repoblar la
    // base. getDbForEpoch repite el chequeo de forma atómica con la
    // adquisición del handle (ver TOCTOU): el epoch capturado viaja
    // hasta el handle.
    if (scheduledEpoch !== dbEpoch) {
      throw new DbLifecycleEndedError(DB_NAME);
    }
    const db = await getDbForEpoch(scheduledEpoch);
    await db.withTransactionAsync(() => work(db));
  });
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Closes and deletes the on-disk database (chat history, the whole
 * knowledge base — bundled corpus, downloaded packs, and custom
 * imported collections all live in this one file) and clears the
 * cached connection so the next getDb() call creates a fresh one.
 * Used by the "Clear All Data" flow — not called during normal
 * operation.
 *
 * Wipe-terminal semantics (GOAL 1 + R1/R2/TOCTOU):
 * 1. El epoch se invalida PRIMERO y de forma síncrona: cualquier
 *    write encolado pero aún no iniciado verá el cambio cuando le
 *    llegue su turno y fallará con DbLifecycleEndedError en vez de
 *    reabrir la base.
 * 2. El reset NO drena el trabajo en vuelo del ciclo anterior: debe
 *    poder completar aunque una transacción vieja siga abierta sobre
 *    el handle viejo. La terminalidad no depende del drenaje: el bump
 *    síncrono impide que el ciclo viejo adquiera NUEVOS handles, el
 *    borrado es unlink (las escrituras del handle viejo vía su fd ya
 *    abierto van a un inodo sin path y no recrean el fichero) y el
 *    cierre best-effort del handle viejo aborta/libera su
 *    transacción cuando el driver lo permite.
 * 3. R1: borrar una base ausente es "ya limpio" y no aborta el wipe;
 *    cualquier otro error de borrado se propaga para que el wipe
 *    falle de forma honesta.
 * 4. TOCTOU: la adquisición del handle está ligada al epoch
 *    (getDbForEpoch): ningún reset puede colarse entre "writer
 *    autorizado" y "handle adquirido" de forma que permita mutación
 *    obsoleta.
 *
 * El borrado en producción pasa por `deleteManagedDatabase` de E2
 * (fichero principal con sus sidecars, temporal y marcadores, en una
 * sola llamada acreditada por su etapa); con un conductor de test
 * inyectado, pasa por su `remove` para cada sufijo gestionado.
 */
export async function resetDatabase(): Promise<void> {
  // Invalidar el ciclo de vida antes de cualquier await: a partir de
  // aquí ningún trabajo obsoleto puede reabrir la base.
  dbEpoch += 1;
  const oldDbPromise = dbPromise;
  dbPromise = null;
  dbOpenEpoch = -1;
  // Sin drenaje del trabajo en vuelo: el reset debe completar aunque
  // una transacción del ciclo anterior siga abierta (ver punto 2).
  // El cierre best-effort aborta esa transacción cuando el driver lo
  // permite; la terminalidad la garantizan el bump síncrono + unlink.
  if (oldDbPromise) {
    try {
      const db = await oldDbPromise;
      await db.closeAsync();
    } catch {
      /* best-effort: el borrado decide el resultado */
    }
  }
  // Se borra el fichero de la base con su nombre propio y sus
  // sidecars.
  for (const name of [DB_NAME]) {
    if (testDriver) {
      const dir = testDriver.dbDir();
      for (const suffix of DB_FILE_SUFFIXES) {
        await testDriver.remove(`${dir}${name}${suffix}`);
      }
    } else {
      deleteManagedDatabase(baseDir(), name);
    }
  }
}

// ---------------------------------------------------------------------------
// openAndMigrate: la apertura y el esquema
// ---------------------------------------------------------------------------

async function openAndMigrate(): Promise<KnowledgeDbHandle> {
  // La DEK llega por el proveedor inyectado (D-3): sin proveedor, o
  // con proveedor que devuelve null, la apertura falla cerrada y no
  // se crea base alguna. En producción el proveedor es la sesión de
  // la bóveda de E2.
  const dek = dekProvider ? await dekProvider() : null;
  if (!dek) {
    throw new Error(
      "Base de conocimiento sin DEK: no hay proveedor registrado o la sesión no entregó clave. Apertura rechazada (fail-closed).",
    );
  }
  assertDek(dek);
  // Apertura cifrada con migración plaintext→cifrado fail-closed, por
  // la capa de E2; con un conductor de test, el conductor abre.
  const db: KnowledgeDbHandle = testDriver
    ? await testDriver.openDb(`${testDriver.dbDir()}${DB_NAME}`)
    : adaptSecureDb(ensureEncryptedDatabase(baseDir(), DB_NAME, dek));

  // Verificación explícita de que el handle devuelto expone TODOS los
  // métodos que openAndMigrate y el resto del código llaman sobre él
  // ANTES de usarlo (los 6 de la interfaz).
  assertKnowledgeDbHandleShape(db, "apertura de la base de conocimiento");

  // GOAL 2: si la inicialización del esquema falla (disco lleno, base
  // corrupta), no filtrar el handle y no dejar la promesa cacheada
  // envenenada: getDb() la limpia al rechazar para que el próximo
  // intento reintente. El error original se relanza intacto; un fallo
  // del close de limpieza nunca lo enmascara. Sin fallback silencioso
  // a otra base.
  try {
    await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      doc_id UNINDEXED,
      title,
      body
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
      -- embedding: el formato se autodescribe por la longitud de la fila
      -- (dim*4 B = float32 · dim B = int8, P-01) y el lector sirve
      -- ambos; el sello meta 'embedding_storage_format' fija el formato
      -- de ESCRITURA vigente (ver el bloque P-01 junto a
      -- insertEmbeddingForModel).
      embedding BLOB NOT NULL,
      dim INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      interrupted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);

    -- One rating per assistant message (message_id is the primary key,
    -- not an auto-increment id) — a re-tap replaces the row via INSERT
    -- OR REPLACE rather than accumulating a history of rating changes;
    -- this app only needs "the person's current verdict on this
    -- answer," not an edit trail.
    CREATE TABLE IF NOT EXISTS answer_feedback (
      message_id TEXT PRIMARY KEY REFERENCES chat_messages(id),
      rating TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Persistent, model-tagged execution telemetry, local/offline
    -- only, never transmitted. NEVER stores the person's prompt or
    -- the generated response text — this is engineering/debugging
    -- data (timing, model, task classification), not a copy of
    -- conversation history. reason_codes is a JSON-encoded string
    -- array, read as a whole, never queried by individual code.
    CREATE TABLE IF NOT EXISTS execution_telemetry (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      model_id TEXT,
      task_type TEXT,
      adaptive_routing_used INTEGER NOT NULL DEFAULT 0,
      reason_codes TEXT,
      retrieval_used INTEGER,
      model_switches INTEGER,
      cross_message_model_switch INTEGER,
      model_residency TEXT,
      model_load_ms REAL,
      ttft_ms REAL,
      generation_latency_ms REAL,
      total_latency_ms REAL,
      tokens_generated INTEGER,
      tok_per_sec REAL,
      peak_rss_bytes INTEGER,
      outcome TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_telemetry_created
      ON execution_telemetry(created_at DESC);

    -- Coste del pre-router por mensaje (ms) y adónde fue (router /
    -- model / notUnderstood / chat). Solo números: NUNCA el texto.
    CREATE TABLE IF NOT EXISTS router_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      classify_ms REAL NOT NULL,
      outcome TEXT NOT NULL,
      route TEXT,
      model_tool TEXT,
      retry TEXT
    );

    -- Registro OPCIONAL (apagado por defecto, meta
    -- 'router.keep_missed') de las frases que el router no reconoció.
    -- Es el único sitio de la telemetría que guarda texto: solo si la
    -- persona lo enciende, máximo 50, y apagarlo lo borra.
    CREATE TABLE IF NOT EXISTS router_missed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      text TEXT NOT NULL,
      route TEXT NOT NULL,
      model_tool TEXT,
      retry TEXT,
      fallback TEXT
    );

    -- User-imported document collections. Chunks from the
    -- bundled/downloaded corpus have no collection (collection_id IS
    -- NULL on the chunks table) and are always searched; chunks
    -- belonging to a collection are only searched while that
    -- collection's "active" flag is on, so the person can toggle a
    -- custom pack off without deleting it.
    CREATE TABLE IF NOT EXISTS custom_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_filename TEXT,
      doc_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL DEFAULT 0
    );

    -- C-06: identidad de los documentos importados. Una fila por
    -- documento que entró, con la huella SHA-256 de su contenido
    -- extraído: es el registro que impide que reimportar duplique en
    -- silencio. Tabla aditiva con IF NOT EXISTS (mismo patrón que
    -- router_missed): no mueve el schema_version de formato y muere
    -- con el fichero en el borrado total.
    CREATE TABLE IF NOT EXISTS custom_collection_docs (
      collection_id TEXT NOT NULL REFERENCES custom_collections(id),
      doc_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      file_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'import',
      PRIMARY KEY (collection_id, doc_id)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_collection_docs_fp
      ON custom_collection_docs(fingerprint);

    -- H-11: los avisos de importación persisten con su colección en
    -- vez de morir con la pantalla que los vio nacer. Una fila por
    -- (colección, fichero, razón); la escritura reemplaza por fichero
    -- y el borrado de la colección cascada dentro de su transacción.
    CREATE TABLE IF NOT EXISTS custom_collection_warnings (
      collection_id TEXT NOT NULL REFERENCES custom_collections(id),
      file_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      ocr_code TEXT,
      ocr_message TEXT,
      detail TEXT,
      previous_name TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (collection_id, file_name, reason)
    );
    -- L1 — contrato de versionado: cada apertura estampa y exige
    -- schema_version. major desconocido / ausente / corrupto →
    -- fail-closed con KnowledgeDbVersionError; nunca se opera sobre
    -- un esquema que no se entiende.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(chunks)`);
    if (!columns.some((c) => c.name === "collection_id")) {
      await db.execAsync(
        `ALTER TABLE chunks ADD COLUMN collection_id TEXT REFERENCES custom_collections(id)`,
      );
    }

    // E6 (paso 1): la página de cada fragmento y su origen, aditivos
    // por este mismo patrón. `page` es la página del documento de la
    // que salió el fragmento (NULL en el corpus y en lo importado sin
    // paginar: la cita sin página es la forma honesta de lo que no la
    // tiene); `origen` distingue el texto extraído ('texto') del
    // leído por OCR ('ocr', paso 6). Las filas anteriores quedan con
    // page NULL y origen 'texto' por el DEFAULT, sin reescribirse.
    if (!columns.some((c) => c.name === "page")) {
      await db.execAsync(`ALTER TABLE chunks ADD COLUMN page INTEGER NULL`);
    }
    if (!columns.some((c) => c.name === "origen")) {
      await db.execAsync(
        `ALTER TABLE chunks ADD COLUMN origen TEXT NOT NULL DEFAULT 'texto'`,
      );
    }

    // Vía de cada turno (route / model_tool / retry), aditivo: las
    // muestras anteriores quedan con NULL y el resumen no las cuenta.
    const routerColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(router_samples)`,
    );
    for (const col of ["route", "model_tool", "retry"]) {
      if (!routerColumns.some((c) => c.name === col)) {
        await db.execAsync(`ALTER TABLE router_samples ADD COLUMN ${col} TEXT`);
      }
    }

    // La respuesta del asistente nace como fila marcada «interrupted»
    // al empezar la generación y la marca se quita al terminar. Si el
    // proceso muere a mitad, la marca queda y el aviso sobrevive a la
    // reapertura. Las instalaciones nuevas tienen la columna por el
    // CREATE TABLE; las existentes, por este ALTER.
    const msgColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(chat_messages)`);
    if (!msgColumns.some((c) => c.name === "interrupted")) {
      await db.execAsync(
        `ALTER TABLE chat_messages ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0`,
      );
    }

    // Storage budget: track last access for LRU eviction. New installs
    // get the column via CREATE TABLE; existing DBs get ALTER.
    const collColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(custom_collections)`,
    );
    if (!collColumns.some((c) => c.name === "last_accessed")) {
      await db.execAsync(
        `ALTER TABLE custom_collections ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`,
      );
      // Backfill: existing collections get created_at as their last access.
      await db.execAsync(
        `UPDATE custom_collections SET last_accessed = created_at WHERE last_accessed = 0`,
      );
    }

    // E6 (paso 1): el conteo de páginas de la colección, aditivo.
    // NULL mientras ningún documento paginado lo alimente; lo
    // escribe la importación de la etapa y lo enseña la Biblioteca.
    if (!collColumns.some((c) => c.name === "page_count")) {
      await db.execAsync(
        `ALTER TABLE custom_collections ADD COLUMN page_count INTEGER NULL`,
      );
    }

    const schemaVer = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version';",
    );
    if (!schemaVer) {
      // Primera apertura de esta base (instalación nueva o base
      // heredada sin stamp): se estampa v1. Las bases creadas a
      // partir de aquí ya la traen.
      await db.runAsync("INSERT INTO meta (key, value) VALUES ('schema_version', ?);", [
        String(KNOWLEDGE_DB_SCHEMA_VERSION),
      ]);
    } else {
      checkFormatVersion({
        formatId: "nido_knowledge.db",
        found: schemaVer.value,
        supportedMajor: KNOWLEDGE_DB_SCHEMA_VERSION,
        ErrorClass: KnowledgeDbVersionError,
      });
    }

    // Verificar identidad del modelo de embeddings. Si cambió el
    // modelo, los vectores almacenados son inválidos (dim distinta o
    // pesos distintos → scores basura silenciosos). Fail-closed con
    // mensaje claro en vez de degradación silenciosa.
    //
    // El modelo esperado es el ACTIVO (Ajustes), no siempre el
    // requerido. El cambio de modelo se hace por un camino explícito
    // (embeddingSwitch.ts → resetEmbeddingsForModel), que borra los
    // vectores y re-sella en la misma transacción.
    const expectedSha = await activeEmbeddingSha256();
    const storedModel = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
    );
    // Si no hay stamp (base nueva o fixture sin el campo), se estampa
    // sin fallar. Solo se falla si hay un valor distinto.
    if (!storedModel?.value) {
      await db.runAsync(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_model_sha256', ?);",
        [expectedSha],
      );
    } else if (storedModel.value !== expectedSha) {
      // Sin ningún vector guardado no hay nada que el modelo anterior
      // haya calculado: re-sellar es seguro (p. ej. un cambio de
      // modelo interrumpido entre el borrado de vectores y el ajuste
      // activo). Con vectores de otro modelo se sigue fallando
      // cerrado, como siempre.
      const vectors = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM chunk_embeddings;",
      );
      // Vectors of ANOTHER CATALOG model (e.g. a backup made before
      // switching search models, or Settings lost while the base
      // survived): they are known to be invalid here, so they're
      // dropped and rebuilt in the background (reembed.ts) — never
      // scored against the wrong model. An unknown stamp still fails
      // closed.
      const knownModels = await catalogEmbeddingShas();
      const storedIsKnown =
        knownModels.includes(storedModel.value) && knownModels.includes(expectedSha);
      if ((vectors?.n ?? 0) === 0 || storedIsKnown) {
        await db.withTransactionAsync(async () => {
          await db.runAsync("DELETE FROM chunk_embeddings;");
          await db.runAsync(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_model_sha256', ?);",
            [expectedSha],
          );
        });
      } else {
        try {
          await db.closeAsync();
        } catch {
          /* el error original es lo que importa */
        }
        throw new KnowledgeDbVersionError(
          storedModel.value,
          `modelo de embeddings cambió (actual: ${expectedSha.slice(0, 12)}…). Se requiere re-indexar la base de conocimiento.`,
        );
      }
    }
  } catch (err) {
    try {
      await db.closeAsync();
    } catch {
      /* el error original es lo que importa; la limpieza no lo enmascara */
    }
    throw err;
  }

  return db;
}

// ---------------------------------------------------------------------------
// Escritor mínimo y las funciones de la capa de búsqueda
// ---------------------------------------------------------------------------

export async function insertChunk(
  chunk: ChunkRecord,
  embedding: Float32Array,
  opts?: WriteOptions & {
    /**
     * Model that computed `embedding`. When given, the vector is
     * stored only if the base is still stamped for that model;
     * otherwise the chunk is stored without it (keyword search works,
     * reembed.ts adds the vector). Protects against a model switch
     * landing between embed and insert.
     */
    modelSha256?: string | null;
  },
): Promise<void> {
  await writeTransaction(async (txn) => {
    if (opts?.modelSha256) {
      const stamp = await txn.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
      );
      if (stamp?.value !== opts.modelSha256) {
        await txn.runAsync(
          `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id, page, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null, chunk.page ?? null, chunk.origen ?? "texto"],
        );
        await txn.runAsync(
          `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
          [chunk.chunkId, chunk.docId, chunk.title, chunk.body],
        );
        await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id = ?`, [chunk.chunkId]);
        return;
      }
    }
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id, page, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null, chunk.page ?? null, chunk.origen ?? "texto"],
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body],
    );
    // P-01: con el sello en int8 la escritura cuantiza al almacenar;
    // en float32 los bytes son exactamente los de siempre.
    const format = await readVectorStorageFormat(txn);
    const bytes =
      format === "int8" ? quantizeVectorInt8(embedding) : new Uint8Array(embedding.buffer);
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding, dim) VALUES (?, ?, ?)`,
      [chunk.chunkId, bytes, embedding.length],
    );
  }, opts);
}

/**
 * Inserts a chunk WITHOUT a vector embedding (FTS-only). Used when the
 * native embedding engine is unavailable in the build — the document is
 * still searchable via full-text search; only semantic vector search is
 * degraded. This keeps setup from blocking on a native JSI issue.
 */
export async function insertChunkWithoutEmbedding(
  chunk: ChunkRecord,
  opts?: WriteOptions,
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id, page, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null, chunk.page ?? null, chunk.origen ?? "texto"],
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body],
    );
    // Deliberately no chunk_embeddings row — vector search will skip it.
  }, opts);
}

async function catalogEmbeddingShas(): Promise<string[]> {
  const { MODEL_CATALOG } = await import("../models/manifest.js");
  return MODEL_CATALOG.filter((m) => m.kind === "embedding").map((m) => m.sha256);
}

/**
 * SHA-256 of the embedding model the person has active (Settings),
 * falling back to the catalog's required one. This is what the
 * knowledge base must be stamped with.
 */
async function activeEmbeddingSha256(): Promise<string> {
  const { MODEL_CATALOG } = await import("../models/manifest.js");
  const required = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required);
  let activeId: string | null = null;
  try {
    const { getActiveModelId } = await import("../models/settings.js");
    activeId = await getActiveModelId("embedding");
  } catch {
    /* settings unreadable: the required model, as before */
  }
  const active = activeId
    ? MODEL_CATALOG.find((m) => m.kind === "embedding" && m.id === activeId)
    : undefined;
  return (active ?? required)?.sha256 ?? "unknown";
}

/**
 * The explicit embedding-model switch: every stored vector is dropped
 * and the base is re-stamped with the new model, in ONE transaction.
 * Text and keyword search are untouched; vectors are rebuilt
 * afterwards by reembed.ts. Never call this without also making
 * `sha256` the active model.
 */
export async function resetEmbeddingsForModel(
  sha256: string,
  opts?: WriteOptions,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`invalid embedding model sha256: ${sha256}`);
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM chunk_embeddings`);
    await txn.runAsync(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('embedding_model_sha256', ?);",
      [sha256],
    );
  }, opts);
}

/** The model the stored vectors belong to (meta stamp), or null. */
export async function getEmbeddingStamp(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
  );
  return row?.value ?? null;
}

/** Chunks with no vector yet (new model, or indexed while embeddings were unavailable). */
export async function listChunksWithoutEmbedding(
  limit: number,
): Promise<Array<{ chunkId: string; title: string; body: string }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chunk_id: string; title: string | null; body: string }>(
    `SELECT c.chunk_id, c.title, c.body FROM chunks c
     LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id
     WHERE e.chunk_id IS NULL ORDER BY c.rowid LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ chunkId: r.chunk_id, title: r.title ?? "", body: r.body }));
}

export async function countChunkVectors(): Promise<{ chunks: number; withVector: number }> {
  const db = await getDb();
  const c = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks;");
  const e = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id;",
  );
  return { chunks: c?.n ?? 0, withVector: e?.n ?? 0 };
}

/**
 * E6 (paso 5): el estado de indexado de UNA colección — cuántos
 * de sus fragmentos tienen vector bajo el sello vigente y
 * cuántos quedan pendientes. Es el dato que la Biblioteca
 * enseña como «reindexado pendiente» (paso 8) cuando el sello
 * de embeddings cambió y los vectores viejos cayeron: el texto
 * queda, la búsqueda semántica de esa colección queda en
 * espera, y ningún vector de otro modelo se puntúa jamás.
 */
export async function countCollectionVectors(
  collectionId: string,
): Promise<{ chunks: number; withVector: number; pending: number }> {
  const db = await getDb();
  const c = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunks WHERE collection_id = ?;",
    [collectionId],
  );
  const e = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chunk_embeddings e
     JOIN chunks c ON c.chunk_id = e.chunk_id WHERE c.collection_id = ?;`,
    [collectionId],
  );
  const chunks = c?.n ?? 0;
  const withVector = e?.n ?? 0;
  return { chunks, withVector, pending: chunks - withVector };
}

/**
 * Stores a re-computed vector only if the base is still stamped with
 * the model that computed it and the chunk still exists. Returns
 * false when the model changed meanwhile (the caller stops), so a
 * vector from one model can never land in a base stamped for another.
 */
export async function insertEmbeddingForModel(
  chunkId: string,
  embedding: Float32Array,
  modelSha256: string,
  opts?: WriteOptions,
): Promise<boolean> {
  let stored = false;
  await writeTransaction(async (txn) => {
    const stamp = await txn.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
    );
    if (stamp?.value !== modelSha256) return;
    // P-01: el mismo sello de formato que en insertChunk — con int8
    // se cuantiza al almacenar; en float32, los bytes de siempre.
    const format = await readVectorStorageFormat(txn);
    const bytes =
      format === "int8"
        ? quantizeVectorInt8(embedding)
        : new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding, dim)
       SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM chunks WHERE chunk_id = ?)`,
      [chunkId, bytes, embedding.length, chunkId],
    );
    stored = true;
  }, opts);
  return stored;
}

// ---------------------------------------------------------------------------
// P-01 · Formato de almacenamiento de los vectores (sello en meta)
//
// Dos formatos conviven y el lector los sirve sin distinguir la tabla:
// float32 (dim*4 B por fila, el histórico) e int8 (dim B por fila, la
// cuarta parte). Cada fila LEÍDA se autodescribe por su longitud; el
// sello meta 'embedding_storage_format' fija solo el formato de
// ESCRITURA: ausente = float32. Los dos únicos productores
// (insertChunk, insertEmbeddingForModel) leen el sello DENTRO de su
// transacción y cuantizan al almacenar cuando dice int8. La migración
// de lo ya almacenado vive en vectorFormatMigration.ts (su sede).
// ---------------------------------------------------------------------------

/** Clave meta del sello de formato de escritura de vectores. */
export const VECTOR_STORAGE_FORMAT_KEY = "embedding_storage_format";

export type VectorStorageFormat = "float32" | "int8";

/** El sello dentro de una transacción/handle dado; ausente = float32. */
async function readVectorStorageFormat(db: KnowledgeDbHandle): Promise<VectorStorageFormat> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?;",
    [VECTOR_STORAGE_FORMAT_KEY],
  );
  return row?.value === "int8" ? "int8" : "float32";
}

// ---------------------------------------------------------------------------
// Cluster de formato de vectores (P-01) — entra en la tanda 4 (J-3)
// con su consumidor, `vectorFormatMigration.ts`, cuya sede difusa
// nombró el cierre de la 3½ («aquí entró solo su lector interno,
// readVectorStorageFormat, como apoyo de los dos productores»).
// Las cinco funciones se recrean fieles a la fuente 0.1.108 sobre
// el handle de PC; ninguna cifra de la puerta de J-3 depende de
// ellas (su acreditación vive en los describes de formato de
// db.vectorFormat, con sede en la pieza de la migración).
// ---------------------------------------------------------------------------

/** El formato de ESCRITURA vigente (el de lectura se autodescribe por fila). */
export async function getVectorStorageFormat(): Promise<VectorStorageFormat> {
  const db = await getDb();
  return readVectorStorageFormat(db);
}

/**
 * Filas aún en float32: el progreso de la migración ES este conteo (una
 * fila es float32 si su longitud es dim*4; convertida mide dim).
 */
export async function countFloat32VectorRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunk_embeddings WHERE length(embedding) = dim * 4;",
  );
  return row?.n ?? 0;
}

/** Un lote de filas float32 por convertir, en orden estable de fila. */
export async function listFloat32VectorBatch(
  limit: number,
): Promise<Array<{ chunkId: string; embedding: Uint8Array; dim: number }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ chunk_id: string; embedding: Uint8Array; dim: number }>(
    `SELECT chunk_id, embedding, dim FROM chunk_embeddings
     WHERE length(embedding) = dim * 4 ORDER BY rowid LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ chunkId: r.chunk_id, embedding: r.embedding, dim: r.dim }));
}

/**
 * Aplica un lote ya cuantizado en UNA transacción que revalida DENTRO el
 * sello de modelo que la migración capturó para ese lote: si un cambio
 * de modelo (resetEmbeddingsForModel) aterrizó entretanto, no escribe
 * nada y devuelve false — y como el reset borra todas las filas, la
 * migración simplemente termina, sin filas y sin error. Cada UPDATE
 * exige que la fila siga en float32: lo ya convertido no se re-convierte
 * (idempotencia por construcción, no por memoria del proceso).
 */
export async function storeQuantizedVectorBatch(
  updates: Array<{ chunkId: string; bytes: Uint8Array }>,
  expectedModelSha256: string | null,
  opts?: WriteOptions,
): Promise<boolean> {
  let applied = false;
  await writeTransaction(async (txn) => {
    const stamp = await txn.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
    );
    if ((stamp?.value ?? null) !== expectedModelSha256) return;
    for (const u of updates) {
      await txn.runAsync(
        `UPDATE chunk_embeddings SET embedding = ?
         WHERE chunk_id = ? AND length(embedding) = dim * 4`,
        [u.bytes, u.chunkId],
      );
    }
    applied = true;
  }, opts);
  return applied;
}

/**
 * Cierra la migración: con el modelo intacto y el conteo de float32 en
 * cero — recontado DENTRO de la misma transacción — fija el sello de
 * escritura en int8. Devuelve false (sin tocar nada) si el modelo cambió
 * o queda alguna fila float32.
 */
export async function sealVectorStorageInt8(
  expectedModelSha256: string | null,
  opts?: WriteOptions,
): Promise<boolean> {
  let sealed = false;
  await writeTransaction(async (txn) => {
    const stamp = await txn.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'embedding_model_sha256';",
    );
    if ((stamp?.value ?? null) !== expectedModelSha256) return;
    const left = await txn.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chunk_embeddings WHERE length(embedding) = dim * 4;",
    );
    if ((left?.n ?? 0) !== 0) return;
    await txn.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, 'int8');", [
      VECTOR_STORAGE_FORMAT_KEY,
    ]);
    sealed = true;
  }, opts);
  return sealed;
}

// ---------------------------------------------------------------------------
// Colecciones, avisos y huellas (E6, paso 2): la cola del `db.ts` del
// móvil que la recreación de la tanda 3½ dejó fuera con esta sede.
// Las tablas llegaron con el esquema; estas son sus funciones.
// ---------------------------------------------------------------------------

export interface CustomCollection {
  id: string;
  name: string;
  sourceFilename: string | null;
  docCount: number;
  chunkCount: number;
  sizeBytes: number;
  active: boolean;
  createdAt: number;
  lastAccessed: number;
  /**
   * E6: las páginas del documento paginado de la importación
   * cuando es único (la Biblioteca enseña «128 páginas» sin
   * abrirlo, y el panel compone «pág. 7 de 128»); null cuando
   * el lote no tiene un único documento con páginas.
   */
  pageCount: number | null;
}

export async function listCustomCollections(): Promise<CustomCollection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    source_filename: string | null;
    doc_count: number;
    chunk_count: number;
    size_bytes: number;
    active: number;
    created_at: number;
    last_accessed: number;
    page_count: number | null;
  }>(`SELECT * FROM custom_collections ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sourceFilename: r.source_filename,
    docCount: r.doc_count,
    chunkCount: r.chunk_count,
    sizeBytes: r.size_bytes,
    active: r.active === 1,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
    pageCount: r.page_count ?? null,
  }));
}

export async function createCustomCollection(
  collection: Omit<CustomCollection, "active" | "createdAt" | "lastAccessed" | "pageCount"> & {
    pageCount?: number | null;
  },
  opts?: WriteOptions,
): Promise<void> {
  // R2: por el ciclo de vida guardado + serializado: un import obsoleto no
  // puede recrear la colección tras Clear All Data.
  const now = Date.now();
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT INTO custom_collections (id, name, source_filename, doc_count, chunk_count, size_bytes, active, created_at, last_accessed, page_count)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        collection.id,
        collection.name,
        collection.sourceFilename,
        collection.docCount,
        collection.chunkCount,
        collection.sizeBytes,
        now,
        now,
        collection.pageCount ?? null,
      ],
    );
  }, opts);
}

export async function setCustomCollectionActive(id: string, active: boolean): Promise<void> {
  // R2: ver createCustomCollection.
  await writeTransaction(async (txn) => {
    await txn.runAsync(`UPDATE custom_collections SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
  });
}

/**
 * E6 (paso 2): la medida de M-32 en su sitio. En PC la fila de la
 * colección nace antes que sus trozos (chunks.collection_id es
 * clave foránea y la conexión la hace cumplir), con size_bytes
 * provisional; tras insertar y medir lo almacenado, esta función
 * deja la medida real en la fila.
 */
export async function setCustomCollectionSizeBytes(
  id: string,
  sizeBytes: number,
  opts?: WriteOptions,
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(`UPDATE custom_collections SET size_bytes = ? WHERE id = ?`, [sizeBytes, id]);
  }, opts);
}

/**
 * T-03 de la 0.1.99 (M-32): cuánto ocupa de verdad una colección en
 * la base — el texto de sus chunks (título + cuerpo en bytes UTF-8),
 * la copia de ese texto en el índice FTS y los blobs de sus
 * vectores. Es la medida que alimenta custom_collections.size_bytes
 * de las colecciones importadas desde esta versión; antes se
 * guardaba la suma de los tamaños de los ficheros fuente del
 * selector, que no dice nada de lo almacenado: un PDF escaneado de
 * 100 MB aporta casi nada de texto, y un .txt breve aporta sus
 * chunks y, sobre todo, sus embeddings (que no contaban).
 */
export async function measureCollectionStoredBytes(collectionId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT
       (SELECT COALESCE(SUM(COALESCE(LENGTH(CAST(title AS BLOB)), 0) + COALESCE(LENGTH(CAST(body AS BLOB)), 0)), 0)
          FROM chunks WHERE collection_id = ?) +
       (SELECT COALESCE(SUM(COALESCE(LENGTH(CAST(f.title AS BLOB)), 0) + COALESCE(LENGTH(CAST(f.body AS BLOB)), 0)), 0)
          FROM chunks_fts f JOIN chunks c ON c.chunk_id = f.chunk_id WHERE c.collection_id = ?) +
       (SELECT COALESCE(SUM(LENGTH(e.embedding)), 0)
          FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id WHERE c.collection_id = ?)
       AS total`,
    [collectionId, collectionId, collectionId],
  );
  return Number(row?.total ?? 0);
}

export async function deleteCustomCollection(id: string): Promise<void> {
  await writeTransaction(async (txn) => {
    const rows = await txn.getAllAsync<{ chunk_id: string }>(
      `SELECT chunk_id FROM chunks WHERE collection_id = ?`,
      [id],
    );
    for (const r of rows) {
      await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunks WHERE chunk_id = ?`, [r.chunk_id]);
    }
    // H-11/C-06: los avisos y las huellas de la colección mueren con
    // ella, dentro de la misma transacción — un aviso sin colección
    // sería un huérfano y una huella sin colección bloquearía para
    // siempre la reimportación de un documento que ya no está.
    await txn.runAsync(`DELETE FROM custom_collection_warnings WHERE collection_id = ?`, [id]);
    await txn.runAsync(`DELETE FROM custom_collection_docs WHERE collection_id = ?`, [id]);
    await txn.runAsync(`DELETE FROM custom_collections WHERE id = ?`, [id]);
  });
}

/**
 * Auditoría completa 2026-10-31 (F3-17): trozos cuya colección no
 * existe. La importación inserta los trozos primero y crea la fila de
 * la colección al final; su catch limpia si el error ocurre en vida,
 * pero si el proceso muere a mitad quedan trozos con un collection_id
 * sin fila: invisibles en búsqueda y en la lista, fuera del
 * presupuesto de almacenamiento (que suma colecciones) y sin ruta de
 * borrado, porque deleteCustomCollection parte de la fila. Esta
 * barrida los elimina con la misma limpieza por trozo (fts y
 * embeddings incluidos). Devuelve cuántos trozos se quitaron.
 */
export async function deleteOrphanCollectionChunks(
  opts?: WriteOptions & {
    /**
     * Colecciones vivas cuya fila aún no existe porque su importación
     * está en vuelo (documentImporter las registra antes de insertar):
     * sus trozos no son huérfanos y la barrida no debe tocarlos. Sin
     * esta exclusión, la barrida de una segunda importación se comía
     * los trozos en vuelo de la primera (sonda del carril F-REV).
     */
    excludeCollectionIds?: readonly string[];
  },
): Promise<number> {
  let removed = 0;
  const excluded = opts?.excludeCollectionIds ?? [];
  const exclusion =
    excluded.length > 0
      ? `AND collection_id NOT IN (${excluded.map(() => "?").join(", ")})`
      : "";
  await writeTransaction(async (txn) => {
    const rows = await txn.getAllAsync<{ chunk_id: string }>(
      `SELECT chunk_id FROM chunks WHERE collection_id IS NOT NULL
        AND collection_id NOT IN (SELECT id FROM custom_collections) ${exclusion}`,
      [...excluded],
    );
    for (const r of rows) {
      await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunks WHERE chunk_id = ?`, [r.chunk_id]);
      removed++;
    }
  }, opts);
  return removed;
}

export async function getCollectionDocs(
  id: string,
): Promise<Array<{ title: string; source: string; body: string }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ title: string; body: string; source: string | null }>(
    `SELECT DISTINCT title, body, source FROM chunks WHERE collection_id = ? ORDER BY chunk_id`,
    [id],
  );
  return rows.map((r) => ({ title: r.title, body: r.body, source: r.source ?? "" }));
}

/**
 * C-06: los trozos de una colección en orden de inserción, que es el
 * orden en que el importador los escribió (empezando por el trozo 0
 * de cada documento). Lo lee el registro perezoso de huellas para
 * reconstruir el cuerpo de cada documento ya importado cosiendo los
 * trozos por su solape.
 */
export interface CollectionChunkRow {
  doc_id: string;
  chunk_id: string;
  title: string;
  body: string;
  source: string;
  /** E6 (paso 4): la página del fragmento (NULL sin paginar) y su origen. */
  page: number | null;
  origen: string;
}

/**
 * E6 (paso 8): los documentos de una colección según su
 * registro (custom_collection_docs): los nombres de fichero
 * que la persona importó, en su orden. La Biblioteca lee los
 * documentos de aquí, no de los títulos de los trozos (que
 * llevan el sufijo de pieza del importador).
 */
export async function listCollectionDocFiles(collectionId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ file_name: string }>(
    `SELECT file_name FROM custom_collection_docs WHERE collection_id = ? ORDER BY rowid`,
    [collectionId],
  );
  return rows.map((r) => r.file_name);
}

export async function listCollectionChunks(collectionId: string): Promise<CollectionChunkRow[]> {
  const db = await getDb();
  return db.getAllAsync<CollectionChunkRow>(
    `SELECT doc_id, chunk_id, title, body, source, page, origen FROM chunks
     WHERE collection_id = ? ORDER BY rowid`,
    [collectionId],
  );
}

/**
 * H-11: un aviso de importación tal como se guarda. `reason` es una
 * cadena opaca para esta capa — el vocabulario cerrado (ocrFailed,
 * ocrEmpty, imageNoOcr, noText, alreadyImported, similarImported)
 * vive en el importador, que es quien produce y consume los avisos;
 * aquí solo se persiste y se devuelve intacto.
 */
export interface StoredImportWarning {
  name: string;
  reason: string;
  ocrCode?: string;
  ocrMessage?: string;
  /** C-06: la colección donde el documento ya vive. */
  detail?: string;
  /** C-06: el nombre con el que el documento ya estaba. */
  previousName?: string;
}

/**
 * H-11: persiste los avisos de una importación contra su colección
 * con la regla de reemplazo por fichero: primero se borran las filas
 * de los ficheros del lote en esa colección y luego se insertan los
 * avisos nuevos — el desenlace nuevo de un fichero sustituye a
 * cualquier aviso viejo del mismo fichero (una reimportación limpia
 * borra su aviso anterior sin tocar los de otros ficheros).
 */
export async function recordImportWarnings(
  collectionId: string,
  fileNames: readonly string[],
  warnings: readonly StoredImportWarning[],
  opts?: WriteOptions,
): Promise<void> {
  await writeTransaction(async (txn) => {
    for (const name of fileNames) {
      await txn.runAsync(
        `DELETE FROM custom_collection_warnings WHERE collection_id = ? AND file_name = ?`,
        [collectionId, name],
      );
    }
    const now = Date.now();
    for (const w of warnings) {
      await txn.runAsync(
        `INSERT INTO custom_collection_warnings
           (collection_id, file_name, reason, ocr_code, ocr_message, detail, previous_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          collectionId,
          w.name,
          w.reason,
          w.ocrCode ?? null,
          w.ocrMessage ?? null,
          w.detail ? w.detail : null,
          w.previousName ?? null,
          now,
        ],
      );
    }
  }, opts);
}

/**
 * H-11: los avisos persistidos de un conjunto de colecciones, en
 * orden de inserción por colección. Las colecciones sin avisos no
 * aparecen en el mapa devuelto.
 */
export async function listImportWarnings(
  collectionIds: readonly string[],
): Promise<Record<string, StoredImportWarning[]>> {
  if (collectionIds.length === 0) return {};
  const db = await getDb();
  const placeholders = collectionIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{
    collection_id: string;
    file_name: string;
    reason: string;
    ocr_code: string | null;
    ocr_message: string | null;
    detail: string | null;
    previous_name: string | null;
  }>(
    `SELECT collection_id, file_name, reason, ocr_code, ocr_message, detail, previous_name
     FROM custom_collection_warnings WHERE collection_id IN (${placeholders}) ORDER BY rowid`,
    [...collectionIds],
  );
  const out: Record<string, StoredImportWarning[]> = {};
  for (const r of rows) {
    const warning: StoredImportWarning = { name: r.file_name, reason: r.reason };
    if (r.ocr_code) warning.ocrCode = r.ocr_code;
    if (r.ocr_message) warning.ocrMessage = r.ocr_message;
    if (r.detail) warning.detail = r.detail;
    if (r.previous_name) warning.previousName = r.previous_name;
    (out[r.collection_id] ??= []).push(warning);
  }
  return out;
}

/**
 * H-11: el «Descartar» de la tarjeta borra solo el grupo (colección,
 * razón) que la persona ha visto y descartado; los demás grupos de
 * la misma colección quedan intactos.
 */
export async function dismissImportWarnings(
  collectionId: string,
  reason: string,
  opts?: WriteOptions,
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `DELETE FROM custom_collection_warnings WHERE collection_id = ? AND reason = ?`,
      [collectionId, reason],
    );
  }, opts);
}

/** C-06: una huella registrada de un documento importado. */
export interface DocFingerprintRow {
  docId: string;
  fingerprint: string;
  fileName: string;
  /** import = entró en una importación normal; registry = lo
   *  registró el registro perezoso de lo ya importado; forced =
   *  copia que entró con «importar de todos modos». */
  kind: "import" | "registry" | "forced";
}

/** C-06: una huella registrada con el nombre de su colección. */
export interface AllDocFingerprintRow extends DocFingerprintRow {
  collectionId: string;
  collectionName: string;
}

/**
 * C-06: registra las huellas de los documentos que acaban de entrar
 * en una colección (reemplaza las filas de esos documentos: la fila
 * de un documento describe su última entrada).
 */
export async function recordCollectionDocFingerprints(
  collectionId: string,
  rows: readonly DocFingerprintRow[],
  opts?: WriteOptions,
): Promise<void> {
  if (rows.length === 0) return;
  await writeTransaction(async (txn) => {
    for (const r of rows) {
      await txn.runAsync(
        `INSERT OR REPLACE INTO custom_collection_docs
           (collection_id, doc_id, fingerprint, file_name, kind)
         VALUES (?, ?, ?, ?, ?)`,
        [collectionId, r.docId, r.fingerprint, r.fileName, r.kind],
      );
    }
  }, opts);
}

/** C-06: todas las huellas registradas, con su colección. */
export async function listAllCollectionDocFingerprints(): Promise<AllDocFingerprintRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    collection_id: string;
    doc_id: string;
    fingerprint: string;
    file_name: string;
    kind: string;
    collection_name: string;
  }>(
    `SELECT d.collection_id, d.doc_id, d.fingerprint, d.file_name, d.kind,
            c.name AS collection_name
     FROM custom_collection_docs d
     JOIN custom_collections c ON c.id = d.collection_id
     ORDER BY d.rowid`,
  );
  return rows.map((r) => ({
    collectionId: r.collection_id,
    collectionName: r.collection_name,
    docId: r.doc_id,
    fingerprint: r.fingerprint,
    fileName: r.file_name,
    kind: (r.kind === "registry" || r.kind === "forced" ? r.kind : "import") as DocFingerprintRow["kind"],
  }));
}

/** Lee una clave de la tabla meta (null si no está). */
export async function getMetaValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

/** Escribe una clave de la tabla meta. */
export async function setMetaValue(key: string, value: string, opts?: WriteOptions): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
      [key, value],
    );
  }, opts);
}
