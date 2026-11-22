/**
 * secureDatabase.ts — el almacén cifrado (E2, pasos 2 y 3).
 *
 * Diseño: estudios/MEMORIA-CIFRADA-ETAPA.md §2.2, §3.2 y §3.3. Puerto del
 * móvil (su secureDatabase.ts) a better-sqlite3-multiple-ciphers, con la
 * misma forma: función única de apertura, sonda de tipo, máquina de
 * estados de migración y verificación por huella (esquema + conteos).
 *
 * LA FUNCIÓN ÚNICA DE APERTURA. Ningún otro código de la app abre la
 * base. El orden de pragmas es parte del formato y no se negocia:
 *   PRAGMA cipher = 'sqlcipher'   (ANTES de la clave, siempre)
 *   PRAGMA legacy = 4             (parámetros SQLCipher v4, los del móvil)
 *   PRAGMA key = "x'<DEK hex>'"   (DEK cruda de 32 bytes)
 *   PRAGMA journal_mode = WAL · foreign_keys = ON · secure_delete = ON
 * Tras aplicar la clave se verifica con lectura real e integrity_check;
 * si la verificación falla, se cierra y se lanza: jamás se crea una base
 * nueva vacía encima de una que no abrió (ese es el fallo que caza T-1).
 *
 * EL MARCADOR DE FORMATO corre por primera vez aquí (pasos 0 y 2): una
 * base existente solo se abre si su marcador coincide con lo que esta
 * app sabe abrir (formatMarker.ts); una base nueva nace con su marcador.
 *
 * DIFERENCIA DE MECANISMO con el móvil, asentada en el CHECKPOINT: esta
 * build de la librería no registra sqlcipher_export, así que la copia de
 * la migración se hace por replay (esquema desde sqlite_master + filas
 * tabla a tabla) en vez de por exportación interna. El contrato es el
 * mismo: copia a *.migtmp, verificación de la copia (integridad, esquema
 * comparado por sqlite_master, conteos por tabla, foreign_key_check) y
 * solo entonces el rename atómico y el marcador *.sqlcipher.
 */

import Database from "better-sqlite3-multiple-ciphers";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renameDurable } from "./durableFs.js";
import { FormatMarkerError, assertFormatMarkerCompatible, writeFormatMarker } from "./formatMarker.js";

export type SecureDb = Database.Database;

export class SecureDbOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureDbOpenError";
  }
}

export class RecoveryRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryRequiredError";
  }
}

/** Corte simulado para los tests de interrupción (M-2): no es un error real. */
export class SimulatedCrashError extends Error {
  constructor(point: string) {
    super(`corte simulado en ${point}`);
    this.name = "SimulatedCrashError";
  }
}

export function assertDek(dek: Buffer): void {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) {
    throw new SecureDbOpenError("la DEK debe ser un Buffer de 32 bytes (fail-closed)");
  }
}

export function dekToHex(dek: Buffer): string {
  assertDek(dek);
  return dek.toString("hex");
}

const VERIFY_READ_SQL = "SELECT count(*) AS n FROM sqlite_master";
const INTEGRITY_CHECK_SQL = "integrity_check"; // Sin el prefijo: db.pragma() ya lo pone.
const SCHEMA_SQL = "SELECT type AS type, name AS name, sql AS sql FROM sqlite_master ORDER BY type, name";

/**
 * Apertura cruda con la disciplina de pragmas, SIN puerta de marcador y
 * SIN verificación. Solo la usan esta pieza (para verificar temporales y
 * sondas) y la rotación; el resto de la app abre por openSecureDatabase.
 */
export function rawOpenEncrypted(dbPath: string, dek: Buffer): SecureDb {
  assertDek(dek);
  const db = new Database(dbPath);
  try {
    db.pragma("cipher = 'sqlcipher'"); // ANTES de la clave, siempre
    db.pragma("legacy = 4");
    db.pragma(`key = "x'${dekToHex(dek)}'"`);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("secure_delete = ON");
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Verificación de apertura: lectura real + integrity_check en `ok`. */
export function verifyHandle(db: SecureDb): void {
  db.prepare(VERIFY_READ_SQL).get();
  const rows = db.pragma(INTEGRITY_CHECK_SQL) as Array<{ integrity_check: string }>;
  const verdict = String(rows?.[0]?.integrity_check ?? "").toLowerCase();
  if (verdict !== "ok") {
    throw new SecureDbOpenError(`integrity_check no pasó (${verdict || "sin veredicto"})`);
  }
}

/**
 * LA función única de apertura de la app. Crea el directorio, exige el
 * marcador de formato en las bases existentes, aplica la disciplina de
 * pragmas, verifica y solo entonces entrega el handle. Si la
 * verificación falla, cierra y lanza sin tocar el fichero.
 */
export function openSecureDatabase(dbPath: string, dek: Buffer): SecureDb {
  assertDek(dek);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const existed = existsSync(dbPath);
  const marker = existed ? assertFormatMarkerCompatible(dbPath) : null; // Fail-closed (FormatMarkerError).
  let db: SecureDb;
  try {
    db = rawOpenEncrypted(dbPath, dek);
  } catch (err) {
    throw new SecureDbOpenError(`la base no abrió: ${(err as Error).message}`);
  }
  try {
    verifyHandle(db);
  } catch (err) {
    db.close();
    throw new SecureDbOpenError(
      `la base no verificó con la DEK dada (¿clave equivocada?): ${(err as Error).message}. No se creó ninguna base nueva.`,
    );
  }
  // D-10 (ATAQUE4-P9): el pageSize del marcador se CONTRASTA contra el
  // real de la base ya abierta. El marcador lo puede mentir quien tenga
  // acceso al fichero; si difiere, el marcador no es de esta base y se
  // falla cerrado antes de entregar el handle.
  if (marker) {
    const realPageSize = Number(db.pragma("page_size", { simple: true }));
    if (realPageSize !== marker.pageSize) {
      db.close();
      throw new FormatMarkerError(
        dbPath,
        marker.pageSize,
        `el pageSize del marcador (${marker.pageSize}) no coincide con el de la base (${realPageSize})`,
      );
    }
  }
  if (!existed) {
    const pageSize = Number(db.pragma("page_size", { simple: true }));
    writeFormatMarker(dbPath, pageSize);
  }
  return db;
}

// ---------------------------------------------------------------------------
// Sonda de tipo (DbKind), espejo del móvil
// ---------------------------------------------------------------------------

export type DbKind = "plaintext" | "encrypted" | "unreadable";

/**
 * Distingue base en claro / cifrada / ilegible sin abrirla de verdad.
 * Sin DEK, una cifrada y una ilegible no se distinguen: se devuelve
 * "unreadable", como en el móvil.
 */
export function probeDbKind(dbPath: string, dek: Buffer | null): DbKind {
  for (const readonly of [true, false]) {
    try {
      const db = new Database(dbPath, { readonly });
      try {
        db.prepare(VERIFY_READ_SQL).get();
        return "plaintext";
      } finally {
        db.close();
      }
    } catch {
      // No abre sin clave (o el readonly no pudo con el WAL): se sigue.
    }
  }
  if (!dek) return "unreadable";
  try {
    const db = rawOpenEncrypted(dbPath, dek);
    try {
      db.prepare(VERIFY_READ_SQL).get();
      return "encrypted";
    } finally {
      db.close();
    }
  } catch {
    return "unreadable";
  }
}

// ---------------------------------------------------------------------------
// Huella de contenido: esquema comparado por sqlite_master + conteos
// ---------------------------------------------------------------------------

export interface TableFingerprint {
  name: string;
  sql: string | null;
  count: number;
}

interface SchemaRow {
  type: string;
  name: string;
  sql: string | null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function collectFingerprint(db: SecureDb): TableFingerprint[] {
  const objs = db.prepare(SCHEMA_SQL).all() as SchemaRow[];
  const out: TableFingerprint[] = [];
  for (const t of objs.filter((o) => o.type === "table")) {
    const row = db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(t.name)}`).get() as { n: number };
    out.push({ name: t.name, sql: t.sql, count: Number(row?.n ?? -1) });
  }
  return out;
}

export function fingerprintsEqual(a: TableFingerprint[], b: TableFingerprint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.name === b[i].name && t.sql === b[i].sql && t.count === b[i].count);
}

/** Verifica que `dbPath` abre con la DEK, pasa integrity_check y (si se pide) coincide con la huella. */
export function verifyEncryptedFile(dbPath: string, dek: Buffer, expected?: TableFingerprint[]): void {
  const db = rawOpenEncrypted(dbPath, dek);
  try {
    verifyHandle(db);
    if (expected) {
      const actual = collectFingerprint(db);
      if (!fingerprintsEqual(expected, actual)) {
        throw new SecureDbOpenError("la base no coincide con la huella esperada (esquema o conteos)");
      }
    }
  } finally {
    db.close();
  }
}

/**
 * Pre-vuelo de apertura: ¿el fichero ABRE con esta DEK (la lectura del
 * esquema prospera), sin exigir integridad ni huella? Es la pregunta que
 * distingue «fichero cifrado con ESTA clave pero de otro contenido» de
 * «no abre con esta clave» (otra clave, o basura). La recuperación de
 * migración la usa para no descartar a ciegas un temporal que podría
 * ser válido con la clave buena (D-1 de la auditoría de ataque 4).
 */
function opensWithDek(dbPath: string, dek: Buffer): boolean {
  try {
    const db = rawOpenEncrypted(dbPath, dek);
    try {
      db.prepare(VERIFY_READ_SQL).get();
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Migración en claro → cifrado: máquina de estados del móvil, tal cual
// ---------------------------------------------------------------------------

export type MigrationState =
  | "MIGRATION_NOT_REQUIRED"
  | "MIGRATION_REQUIRED"
  | "MIGRATION_IN_PROGRESS"
  | "MIGRATION_COMPLETE"
  | "RECOVERY_REQUIRED";

export interface DbPaths {
  main: string;
  tmp: string;
  marker: string;
  sidecars: string[];
}

export function dbPaths(dir: string, name: string): DbPaths {
  const main = path.join(dir, name);
  return {
    main,
    tmp: `${main}.migtmp`,
    marker: `${main}.sqlcipher`,
    sidecars: [`${main}-wal`, `${main}-shm`, `${main}-journal`],
  };
}

export function getMigrationState(dir: string, name: string, dek: Buffer | null): MigrationState {
  const p = dbPaths(dir, name);
  if (existsSync(p.tmp)) return "MIGRATION_IN_PROGRESS";
  if (!existsSync(p.main)) return "MIGRATION_NOT_REQUIRED";
  if (existsSync(p.marker)) return "MIGRATION_COMPLETE";
  const kind = probeDbKind(p.main, dek);
  if (kind === "plaintext") return "MIGRATION_REQUIRED";
  if (kind === "encrypted") return "MIGRATION_COMPLETE"; // Cifrada sin marcador (instalación intermedia).
  return "RECOVERY_REQUIRED";
}

function removeWithSidecars(mainPath: string): void {
  for (const p of [mainPath, `${mainPath}-wal`, `${mainPath}-shm`, `${mainPath}-journal`]) {
    rmSync(p, { force: true });
  }
}

function writeMigrationMarker(p: DbPaths, name: string): void {
  writeFileSync(
    p.marker,
    JSON.stringify({ v: 1, cipher: "sqlcipher4", migratedAt: new Date().toISOString(), db: name }),
    "utf8",
  );
}

/**
 * Escribe los dos marcadores de una base YA verificada con la DEK (la de
 * migración y la de formato). Cura la ventana de corte entre el rename y
 * los marcadores: una base que abre con nuestra DEK e integrity ok es
 * demostrablemente nuestra y puede recibir sus marcadores; una que no
 * abre, no recibe nada (fail-closed).
 */
function writeMarkersForVerifiedDb(p: DbPaths, name: string, dek: Buffer): void {
  const db = rawOpenEncrypted(p.main, dek);
  try {
    verifyHandle(db);
    writeFormatMarker(p.main, Number(db.pragma("page_size", { simple: true })));
  } finally {
    db.close();
  }
  writeMigrationMarker(p, name);
}

/** Copia las filas de una tabla del origen (en claro) al destino (cifrado). */
function copyTableRows(src: SecureDb, dst: SecureDb, table: string): void {
  const info = src.prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`).all() as Array<{ name: string; hidden: number }>;
  // hidden: 0 = columna normal; 2/3 = generada (no se inserta); 1 = oculta de tabla virtual.
  const cols = info.filter((c) => c.hidden === 0).map((c) => c.name);
  if (cols.length === 0) return;
  const colList = cols.map(quoteIdent).join(", ");
  const rows = src.prepare(`SELECT ${colList} FROM ${quoteIdent(table)}`).all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return;
  const insert = dst.prepare(
    `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${cols.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    insert.run(...cols.map((c) => row[c] as never));
  }
}

/**
 * Construye la copia cifrada en `tmpPath` por replay y la verifica contra
 * la huella del origen. El origen queda intacto pase lo que pase.
 */
function buildEncryptedCopy(srcPath: string, tmpPath: string, dek: Buffer): TableFingerprint[] {
  // Checkpoint del origen para que lo reciente no viva solo en su -wal.
  const setup = new Database(srcPath);
  try {
    setup.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* si el origen no está en WAL, no hay nada que consolidar */
  } finally {
    setup.close();
  }
  const src = new Database(srcPath, { readonly: true });
  try {
    const fingerprint = collectFingerprint(src);
    const objects = src.prepare(SCHEMA_SQL).all() as SchemaRow[];
    const dst = rawOpenEncrypted(tmpPath, dek);
    try {
      dst.pragma("foreign_keys = OFF"); // Durante la carga; se comprueba al final.
      const tables = objects.filter((o) => o.type === "table");
      const rest = objects.filter((o) => o.type !== "table" && o.sql);
      dst.transaction(() => {
        // sqlite_sequence no se crea a mano (nombre reservado): nace sola
        // al crear la primera tabla AUTOINCREMENT, con el mismo sql.
        for (const t of tables) if (t.sql && t.name !== "sqlite_sequence") dst.exec(t.sql);
        for (const t of tables) {
          if (t.name === "sqlite_sequence") continue; // Se copia al final, verbatim.
          copyTableRows(src, dst, t.name);
        }
        if (tables.some((t) => t.name === "sqlite_sequence")) {
          // La secuencia exacta del origen (puede ir por delante del
          // máximo id si hubo borrados): se impone tras la carga.
          dst.exec("DELETE FROM sqlite_sequence");
          copyTableRows(src, dst, "sqlite_sequence");
        }
        for (const o of rest) dst.exec(o.sql as string);
      })();
      const fkViolations = dst.pragma("foreign_key_check") as unknown[];
      if (fkViolations.length > 0) {
        throw new SecureDbOpenError("la copia no pasa foreign_key_check: migración abortada");
      }
    } finally {
      dst.close();
    }
    verifyEncryptedFile(tmpPath, dek, fingerprint);
    return fingerprint;
  } finally {
    src.close();
  }
}

export type MigrationFaultPoint = "afterCopy" | "afterVerify" | "afterRename";

/**
 * Migra una base en claro a SQLCipher. La única operación destructiva es
 * el rename atómico tmp→main, y solo ocurre tras la verificación
 * completa de la copia. Ante cualquier fallo la original queda intacta
 * y se lanza: nunca se sigue en claro en silencio.
 * `faultAt` existe solo para que M-2 inyecte cortes; en producción no se pasa.
 */
export function migratePlaintextToEncrypted(
  dir: string,
  name: string,
  dek: Buffer,
  opts?: { faultAt?: MigrationFaultPoint },
): void {
  assertDek(dek);
  const p = dbPaths(dir, name);
  const label = `migración(${name})`;
  // Un temporal previo es basura no verificada: fuera antes de empezar.
  if (existsSync(p.tmp)) removeWithSidecars(p.tmp);

  const fingerprint = buildEncryptedCopy(p.main, p.tmp, dek);
  if (opts?.faultAt === "afterCopy" || opts?.faultAt === "afterVerify") throw new SimulatedCrashError(opts.faultAt);

  // Sustitución atómica y durable (renameDurable, A-4): el rename
  // sobrescribe la original en claro, con el fichero sincronizado antes.
  renameDurable(p.tmp, p.main);
  if (opts?.faultAt === "afterRename") throw new SimulatedCrashError("afterRename");
  // Los sidecars pertenecen al fichero en claro: fuera.
  for (const s of p.sidecars) rmSync(s, { force: true });
  // La base migrada nace con sus dos marcadores (migración y formato).
  writeMarkersForVerifiedDb(p, name, dek);
  // Apertura final de confirmación, con huella.
  verifyEncryptedFile(p.main, dek, fingerprint);
  void label;
}

/**
 * Recupera un intento interrumpido (quedó el temporal). Idempotente.
 *
 * INVARIANTE (del móvil, A/F-NEW-1): la principal NUNCA se sustituye ni
 * se destruye hasta que el temporal haya DEMOSTRADO contener su
 * contenido (esquema + conteos idénticos a la huella de la principal).
 * Si la principal existe pero no puede leerse, no se promueve ni se
 * descarta nada y se lanza RECOVERY_REQUIRED: fail-closed explícito.
 *
 * PRE-VUELO DEL TEMPORAL (arreglo ATAQUE4-P1, de D-1/E-02): si el
 * temporal no verifica con la DEK dada hay dos mundos distintos y no
 * se tratan igual. Si el temporal ABRE con esta DEK pero su contenido
 * no es el de la principal (copia parcial de un corte durante la
 * copia, o temporal de otra base con la misma clave), es demostrable
 * que no guarda nada que esta clave deba conservar: se descarta y se
 * reintenta desde la principal. Si el temporal NO abre con esta DEK,
 * no se puede distinguir «temporal válido cifrado con OTRA clave» de
 * «basura»: descartarlo y re-migrar la principal con la clave dada
 * sellaría la base con una clave que la bóveda podría no guardar
 * (eso cazó E-02). En ese mundo no se toca NADA (ni temporal ni
 * principal) y se lanza RECOVERY_REQUIRED.
 */
export function recoverInterruptedMigration(dir: string, name: string, dek: Buffer): void {
  assertDek(dek);
  const p = dbPaths(dir, name);
  const label = `recuperación(${name})`;

  // Huella de la principal ANTES de cualquier operación destructiva.
  let expected: TableFingerprint[] | undefined;
  if (existsSync(p.main)) {
    try {
      const kind = probeDbKind(p.main, dek);
      if (kind === "unreadable") throw new Error("no abre ni en claro ni con la clave");
      const h = kind === "plaintext" ? new Database(p.main, { readonly: true }) : rawOpenEncrypted(p.main, dek);
      try {
        expected = collectFingerprint(h);
      } finally {
        h.close();
      }
    } catch {
      throw new RecoveryRequiredError(
        `${label}: RECOVERY_REQUIRED — la base principal existe pero no es legible con la DEK disponible; ` +
          "el temporal no puede demostrar que contiene su contenido. No se promueve ni se descarta nada.",
      );
    }
  }

  let tmpValid = false;
  if (existsSync(p.tmp)) {
    try {
      verifyEncryptedFile(p.tmp, dek, expected);
      tmpValid = true;
    } catch {
      tmpValid = false;
    }
  }
  if (tmpValid) {
    renameDurable(p.tmp, p.main);
    for (const s of p.sidecars) rmSync(s, { force: true });
    writeMarkersForVerifiedDb(p, name, dek);
    verifyEncryptedFile(p.main, dek, expected);
    return;
  }
  if (existsSync(p.tmp)) {
    // El temporal no demostró el contenido de la principal con esta
    // DEK. Antes de descartarlo, el pre-vuelo: si ni siquiera abre con
    // esta DEK, puede ser un temporal VÁLIDO cifrado con otra clave
    // (la buena) y la DEK dada la equivocada: no se descarta, no se
    // re-migra y no se toca nada (D-1). Solo se descarta el temporal
    // que abre con esta DEK y aun así no demuestra el contenido.
    if (!opensWithDek(p.tmp, dek)) {
      throw new RecoveryRequiredError(
        `${label}: RECOVERY_REQUIRED — el temporal existe pero no abre con la DEK disponible: ` +
          "podría ser un temporal válido cifrado con otra clave y descartarlo sellaría la base con la clave equivocada. " +
          "No se descartó ni se re-migró nada.",
      );
    }
    removeWithSidecars(p.tmp);
  }
  const kind = existsSync(p.main) ? probeDbKind(p.main, dek) : "unreadable";
  if (kind === "plaintext") {
    migratePlaintextToEncrypted(dir, name, dek);
    return;
  }
  if (kind === "encrypted") {
    writeMarkersForVerifiedDb(p, name, dek);
    verifyEncryptedFile(p.main, dek, expected);
    return;
  }
  throw new RecoveryRequiredError(
    `${label}: RECOVERY_REQUIRED — ni el temporal ni la principal son legibles. No se tocó nada.`,
  );
}

/**
 * Punto de entrada del almacén: garantiza que `name` queda abierta
 * CIFRADA, ejecutando la máquina de estados. RECOVERY_REQUIRED lanza:
 * nunca se abre en claro en silencio.
 */
export function ensureEncryptedDatabase(dir: string, name: string, dek: Buffer): SecureDb {
  const p = dbPaths(dir, name);
  const state = getMigrationState(dir, name, dek);
  switch (state) {
    case "MIGRATION_NOT_REQUIRED":
      return openSecureDatabase(p.main, dek);
    case "MIGRATION_COMPLETE":
      // Ventana de corte entre el rename y los marcadores: la base ya es
      // la cifrada pero puede faltarle el marcador de formato. Se cura
      // verificándola con la DEK y escribiendo los marcadores; si no
      // verificara, no se escribe nada y la apertura falla cerrada.
      if (existsSync(p.main) && !existsSync(`${p.main}.format.json`)) {
        writeMarkersForVerifiedDb(p, name, dek);
      }
      return openSecureDatabase(p.main, dek);
    case "MIGRATION_REQUIRED":
      migratePlaintextToEncrypted(dir, name, dek);
      return openSecureDatabase(dbPaths(dir, name).main, dek);
    case "MIGRATION_IN_PROGRESS":
      recoverInterruptedMigration(dir, name, dek);
      return openSecureDatabase(dbPaths(dir, name).main, dek);
    case "RECOVERY_REQUIRED":
      throw new RecoveryRequiredError(
        `${name}: RECOVERY_REQUIRED — la base no abre ni en claro ni con la clave. No se abrió en claro.`,
      );
  }
}

/**
 * Cambia la DEK de una base en disco (PRAGMA rekey con la disciplina de
 * pragmas) y lo verifica abriendo con la nueva. La usa la rotación
 * (paso 4); el marcador de formato no cambia con la clave.
 */
export function rekeyDatabaseFile(dbPath: string, oldDek: Buffer, newDek: Buffer): void {
  assertDek(oldDek);
  assertDek(newDek);
  const db = rawOpenEncrypted(dbPath, oldDek);
  try {
    verifyHandle(db);
    db.pragma(`rekey = "x'${dekToHex(newDek)}'"`);
  } finally {
    db.close();
  }
  verifyEncryptedFile(dbPath, newDek);
}

/** Limpieza total de una base gestionada: principal, sidecars, temporal y marcadores. */
export function deleteManagedDatabase(dir: string, name: string): void {
  const p = dbPaths(dir, name);
  removeWithSidecars(p.main);
  rmSync(p.tmp, { force: true });
  rmSync(p.marker, { force: true });
  rmSync(`${p.main}.format.json`, { force: true });
}

/** Lectura de bytes de un fichero (para huellas y barridos de canarios). */
export function readFileBytes(p: string): Buffer {
  return readFileSync(p);
}
