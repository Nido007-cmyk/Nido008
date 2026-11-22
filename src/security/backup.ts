/**
 * backup.ts — respaldo y restauración de las bases cifradas (E2, paso 5).
 *
 * Diseño: estudios/MEMORIA-CIFRADA-ETAPA.md §3.6, espejo del móvil
 * (backup.ts + vaultBackupGate.ts + restoreNotice.ts). Un respaldo es
 * UN fichero contenedor:
 *
 *   "NID1" ‖ uint32LE(longitud de la cabecera) ‖ cabecera JSON ‖ carga
 *
 * La cabecera es el manifiesto: formato y versión, la clave de las
 * bases y una entrada por fichero con su sha256 **sobre los bytes**
 * (`sha256Kind: "bytes"`). La carga es la concatenación de los ficheros
 * en el orden del manifiesto (las bases y sus marcadores de formato).
 *
 * Formato 2 (tanda de seguridad, A-3): el manifiesto NO lleva la DEK en
 * claro en ninguna forma. Lleva la DEK envuelta (`keyWrap`) por el
 * proveedor de contraseña con una contraseña DE RESPALDO, distinta de
 * la de la bóveda, con los parámetros sellados de E2 (scrypt N=2^17,
 * r=8, p=1, AES-256-GCM): quien tenga el fichero sin la contraseña no
 * puede leer nada de lo que lleva. El formato 1 (la DEK en hex en la
 * cabecera, la «clave del respaldo» exportable del móvil) queda como
 * vía LEGADA DE LECTURA: se sigue restaurando, y el resultado lo
 * declara (`legacyCleartextKey: true`) con su aviso propio, porque
 * cualquiera que tenga un fichero v1 puede leer los datos que trae.
 *
 * Reglas que no se negocian:
 * - Crear un respaldo exige la bóveda DESBLOQUEADA (la puerta del
 *   móvil): la DEK sale de la sesión, nunca de un fichero.
 * - Restaurar exige aceptar el aviso (la restauración SUSTITUYE los
 *   datos actuales) y verifica la huella de cada entrada ANTES de tocar
 *   nada; una sola huella mala aborta sin tocar el destino.
 * - La sustitución es atómica por base, con `.pre-restore-bak` y
 *   rollback si algo falla a mitad; el rollback devuelve también los
 *   sidecars (-wal/-shm/-journal) del destino y el blob de custodia
 *   anterior (ATAQUE4-P2).
 * - Al terminar, la DEK restaurada se re-envuelve con la custodia LOCAL
 *   (la bóveda de este PC pasa a abrir los datos restaurados con la
 *   credencial de este PC).
 * - Una versión de respaldo más nueva que la soportada se rechaza
 *   (`tooNew`): jamás se restaura a ciegas un formato futuro.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { moveDurable, writeFileDurable } from "./durableFs.js";
import {
  type CustodyLevel,
  type KeyCustodyProvider,
  type WrappedBlob,
  PasswordCustodyProvider,
  SALT_BYTES,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  VAULT_BLOB_FILE,
  selectCustodyProvider,
  vaultBlobPath,
  writeVaultBlobVerified,
} from "./keyVault.js";
import { ROTATION_STAGING_FILE } from "./stagingSeal.js";
import { formatMarkerPath } from "./formatMarker.js";
import { openSecureDatabase, rawOpenEncrypted, verifyHandle } from "./secureDatabase.js";
import type { VaultSession } from "./vaultSession.js";

export const BACKUP_FORMAT = "nido-pc-backup";
export const BACKUP_FORMAT_VERSION = 2;
const MAGIC = Buffer.from("NID1", "latin1");

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export class BackupTooNewError extends BackupError {
  constructor(version: number) {
    super(`el respaldo es de la versión ${version} y esta app soporta hasta la ${BACKUP_FORMAT_VERSION}: no se restaura a ciegas`);
    this.name = "BackupTooNewError";
  }
}

/**
 * El aviso de restauración (espejo de restoreNotice.ts del móvil, con
 * el límite de autenticidad nombrado: ATAQUE4-P6, de D-6). Las huellas
 * garantizan integridad contra corrupción, NO origen: ningún respaldo
 * trae prueba de quién lo creó, y el aviso lo dice antes de que nadie
 * restaure el fichero de otro. (El formato 1 sí llevaba la clave en la
 * cabecera por diseño; su aviso propio es legacyBackupWarningText.)
 */
export function restoreNoticeText(): string {
  return (
    "Restaurar un respaldo sustituye los datos actuales de NIDO en este PC por los del respaldo. " +
    "Lo que no esté en el respaldo se pierde. Si algo falla a mitad, la restauración se deshace sola. " +
    "Un respaldo solo es de fiar si el fichero ha estado bajo tu custodia: NIDO comprueba que el respaldo " +
    "no esté corrupto, pero no puede verificar quién lo creó."
  );
}

/**
 * El aviso de CREACIÓN del formato 2 (A-3): el respaldo nace cerrado
 * con su propia contraseña de respaldo, y sin ella no hay
 * recuperación posible ni restablecimiento por parte de NIDO.
 */
export function backupCreationNoticeText(): string {
  return (
    "Este respaldo queda cerrado con su propia contraseña de respaldo: sin ella, el fichero no se abre " +
    "y los datos no se pueden recuperar. Guárdala en un sitio seguro: NIDO no la conoce y no puede " +
    "restablecerla. Quien tenga el fichero sin la contraseña no puede leer nada de lo que lleva."
  );
}

/**
 * El aviso de la vía legada (A-3): un respaldo de formato 1 lleva su
 * clave en claro dentro del fichero; se dice al restaurar y se
 * recomienda sustituirlo por uno nuevo en cuanto se termine.
 */
export function legacyBackupWarningText(): string {
  return (
    "Este respaldo es de un formato antiguo: lleva su clave en claro dentro del fichero, así que " +
    "cualquiera que lo tenga puede leer los datos que trae. Cuando termines de restaurar, crea un " +
    "respaldo nuevo, que sí va cerrado con contraseña, y borra este fichero."
  );
}

/**
 * La clave del respaldo LEGADO (formato 1): la DEK en hex minúsculas
 * (espejo de exportDatabaseKey del móvil). Solo la usa la vía legada
 * de lectura; el formato 2 no lleva la DEK en claro en ninguna forma.
 */
export function exportDatabaseKey(dek: Buffer): string {
  if (dek.length !== 32) throw new BackupError("la DEK debe ser de 32 bytes");
  return dek.toString("hex");
}

/**
 * Normaliza la clave de un respaldo LEGADO (formato 1), leída de su
 * cabecera o escrita a mano: quita espacios y guiones, pasa a
 * minúsculas y exige exactamente 64 hex. Lo demás se rechaza sin
 * intentar abrir nada.
 */
export function normalizeBackupKey(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new BackupError("la clave del respaldo debe ser de 64 caracteres hexadecimales");
  }
  return Buffer.from(clean, "hex");
}

export interface BackupManifestEntry {
  /** Ruta relativa dentro del respaldo (nombre de fichero, sin carpetas). */
  path: string;
  bytes: number;
  sha256: string;
  sha256Kind: "bytes";
}

/** El manifiesto del formato 2: la DEK viaja ENVUELTA, nunca en claro. */
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 2;
  createdAt: string;
  app: "nido-pc";
  /** La DEK envuelta con la contraseña de respaldo (proveedor `contrasena`). */
  keyWrap: WrappedBlob;
  entries: BackupManifestEntry[];
}

/** El manifiesto del formato 1, declarado aparte: solo se lee (vía legada). */
export interface BackupManifestV1 {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: string;
  app: "nido-pc";
  /** La DEK en claro, en hex: el defecto que el formato 2 cierra. */
  databaseKeyHex: string;
  entries: BackupManifestEntry[];
}

const sha256Hex = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const SAFE_ENTRY_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * La envoltura de clave de un manifiesto v2 se valida ENTERA en la
 * lectura, antes de desenvolver nada: forma, proveedor y los
 * parámetros sellados de E2. Un `n` rebajado se rechaza aquí, sin
 * derivar: desenvolver un blob rebajado sería aceptar en silencio una
 * clave cerrada con menos coste del sellado.
 */
function assertSealedKeyWrap(keyWrap: unknown): asserts keyWrap is WrappedBlob {
  const kw = keyWrap as Partial<WrappedBlob> | null;
  if (
    !kw ||
    typeof kw !== "object" ||
    kw.version !== 1 ||
    kw.provider !== "contrasena" ||
    typeof kw.wrapped !== "string" ||
    kw.wrapped.length === 0 ||
    !kw.params ||
    kw.params.kdf !== "scrypt"
  ) {
    throw new BackupError("el manifiesto del respaldo no trae una envoltura de clave válida (keyWrap)");
  }
  if (kw.params.n !== SCRYPT_N || kw.params.r !== SCRYPT_R || kw.params.p !== SCRYPT_P) {
    throw new BackupError("la envoltura de clave del respaldo trae parámetros de derivación rebajados: no se desenvuelve");
  }
  if (Buffer.from(kw.params.salt, "base64").length !== SALT_BYTES) {
    throw new BackupError("la envoltura de clave del respaldo trae una sal de tamaño inválido");
  }
}

function writeContainer(destPath: string, manifest: BackupManifest, payloads: Buffer[]): void {
  const header = Buffer.from(JSON.stringify(manifest), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length, 0);
  const tmp = `${destPath}.tmp-${randomBytes(4).toString("hex")}`;
  writeFileDurable(destPath, Buffer.concat([MAGIC, len, header, ...payloads]), { tmpPath: tmp, mode: 0o600 });
}

interface ReadContainer {
  manifest: BackupManifest | BackupManifestV1;
  payloads: Map<string, Buffer>;
}

/**
 * Lee un respaldo y verifica la huella de CADA entrada antes de
 * devolver un solo byte. Cualquier desvío (magia, versión, tamaño,
 * huella, ruta insegura) lanza sin entregar carga.
 */
export function readBackupContainer(srcPath: string): ReadContainer {
  const raw = readFileSync(srcPath);
  if (raw.length < 8 || !raw.subarray(0, 4).equals(MAGIC)) {
    throw new BackupError("el fichero no es un respaldo de NIDO PC (magia desconocida)");
  }
  const headerLen = raw.readUInt32LE(4);
  if (headerLen <= 0 || 8 + headerLen > raw.length) throw new BackupError("la cabecera del respaldo está corrupta");
  let manifest: BackupManifest | BackupManifestV1;
  try {
    manifest = JSON.parse(raw.subarray(8, 8 + headerLen).toString("utf8")) as BackupManifest | BackupManifestV1;
  } catch {
    throw new BackupError("la cabecera del respaldo no es JSON válido");
  }
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError("el manifiesto no es de un respaldo de NIDO PC");
  if (typeof manifest.version !== "number") throw new BackupError("el manifiesto no declara versión");
  if (manifest.version > BACKUP_FORMAT_VERSION) throw new BackupTooNewError(manifest.version);
  if (manifest.version === 2) {
    // Formato vigente: la envoltura se valida entera en la lectura.
    assertSealedKeyWrap((manifest as BackupManifest).keyWrap);
  } else if (manifest.version === 1) {
    // Vía legada: la clave viaja en la cabecera; se valida su forma.
    normalizeBackupKey((manifest as BackupManifestV1).databaseKeyHex);
  } else {
    throw new BackupError("la versión del respaldo no es válida");
  }
  const payloads = new Map<string, Buffer>();
  const seenPaths = new Set<string>();
  let offset = 8 + headerLen;
  for (const entry of manifest.entries ?? []) {
    if (!SAFE_ENTRY_PATH.test(entry.path) || entry.path.includes("..")) {
      throw new BackupError(`el respaldo trae una ruta insegura: ${entry.path}`);
    }
    // D-3 (ATAQUE4-P2, de F-08/F-08b): un manifiesto con dos entradas
    // del mismo nombre es malformado por definición. Sin este rechazo,
    // la segunda carga sobrescribe a la primera en el mapa y, en la
    // sustitución, destruye el .pre-restore-bak de la primera: un
    // rollback posterior perdía la base original entera.
    if (seenPaths.has(entry.path)) {
      throw new BackupError(`el manifiesto trae la entrada ${entry.path} duplicada: respaldo malformado`);
    }
    seenPaths.add(entry.path);
    if (entry.sha256Kind !== "bytes") throw new BackupError(`huella de clase desconocida en ${entry.path}`);
    const slice = raw.subarray(offset, offset + entry.bytes);
    if (slice.length !== entry.bytes) throw new BackupError(`el respaldo está truncado en ${entry.path}`);
    if (sha256Hex(slice) !== entry.sha256) {
      throw new BackupError(`la huella de ${entry.path} no coincide: respaldo manipulado o corrupto`);
    }
    payloads.set(entry.path, Buffer.from(slice));
    offset += entry.bytes;
  }
  if (offset !== raw.length) throw new BackupError("el respaldo trae bytes de más tras la última entrada");
  return { manifest, payloads };
}

/**
 * Crea un respaldo de las bases dadas (formato 2). Exige la bóveda
 * desbloqueada (la sesión): sin sesión abierta no hay DEK y no hay
 * respaldo. Y exige la contraseña DE RESPALDO: la DEK se envuelve con
 * ella antes de tocar una sola base, así que sin contraseña (o con
 * una que el mínimo de B-7 rechace al envolver) no nace fichero.
 * Antes de leer los bytes, cada base se consolida (checkpoint) para
 * que el respaldo no dependa de un -wal suelto.
 */
export async function createBackup(opts: {
  dir: string;
  dbNames: string[];
  session: VaultSession;
  destPath: string;
  /** La contraseña de respaldo: cierra el fichero. Distinta de la de la bóveda. */
  backupPassword: string;
}): Promise<BackupManifest> {
  const { dir, dbNames, session, destPath, backupPassword } = opts;
  if (session.locked) {
    throw new BackupError("la bóveda está bloqueada: el respaldo exige la bóveda desbloqueada");
  }
  if (typeof backupPassword !== "string" || backupPassword.length === 0) {
    throw new BackupError("crear un respaldo exige su contraseña de respaldo: sin ella el fichero no quedaría cerrado");
  }
  const dek = session.dek;
  const keyWrap = await new PasswordCustodyProvider(backupPassword).wrap(dek);
  const entries: BackupManifestEntry[] = [];
  const payloads: Buffer[] = [];
  const addFile = (absPath: string, entryPath: string) => {
    const bytes = readFileSync(absPath);
    entries.push({ path: entryPath, bytes: bytes.length, sha256: sha256Hex(bytes), sha256Kind: "bytes" });
    payloads.push(bytes);
  };
  for (const name of dbNames) {
    const dbPath = path.join(dir, name);
    const db = openSecureDatabase(dbPath, dek);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    addFile(dbPath, name);
    const marker = formatMarkerPath(dbPath);
    if (existsSync(marker)) addFile(marker, `${name}.format.json`);
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    app: "nido-pc",
    keyWrap,
    entries,
  };
  writeContainer(destPath, manifest, payloads);
  return manifest;
}

/**
 * Restaura un respaldo sobre el directorio dado. Orden: aviso aceptado
 * → contenedor verificado entero → la DEK se desenvuelve con la
 * contraseña de respaldo (v2; en v1 se lee de la cabecera, vía legada)
 * → lista blanca → comprobación previa de destino (M-3) → cada base
 * del respaldo abre con su clave (en temporal) → sustitución atómica
 * con rollback → re-envoltura de la DEK restaurada con la custodia
 * local → la sesión, si está abierta, adopta la DEK restaurada.
 * El resultado declara si el respaldo era de la vía legada
 * (`legacyCleartextKey`): un v1 trae su clave en claro y se dice.
 */
export async function restoreBackup(opts: {
  srcPath: string;
  dir: string;
  providers: readonly KeyCustodyProvider[];
  session?: VaultSession;
  /** El aviso de restauración debe aceptarse ANTES de ejecutar. */
  noticeAccepted: boolean;
  /** La contraseña de respaldo (solo v2): sin ella no se desenvuelve nada. */
  backupPassword?: string;
}): Promise<{ restored: string[]; custodyLevel: CustodyLevel; legacyCleartextKey: boolean }> {
  const { srcPath, dir, providers, session } = opts;
  if (!opts.noticeAccepted) {
    throw new BackupError(`aviso de restauración no aceptado: ${restoreNoticeText()}`);
  }
  const { manifest, payloads } = readBackupContainer(srcPath);
  let restoredDek: Buffer;
  let legacyCleartextKey: boolean;
  if (manifest.version === 2) {
    if (typeof opts.backupPassword !== "string" || opts.backupPassword.length === 0) {
      throw new BackupError("este respaldo está cerrado con su contraseña de respaldo: sin ella no se puede restaurar");
    }
    try {
      restoredDek = await new PasswordCustodyProvider(opts.backupPassword).unwrap(manifest.keyWrap);
    } catch (err) {
      // VaultUnlockError envuelto en BackupError: el destino no se ha tocado.
      throw new BackupError(`la contraseña de respaldo no abre este respaldo: ${(err as Error).message}`);
    }
    legacyCleartextKey = false;
  } else {
    restoredDek = normalizeBackupKey(manifest.databaseKeyHex);
    legacyCleartextKey = true;
  }
  const dbEntries = manifest.entries.filter((e) => !e.path.endsWith(".format.json"));
  const stamp = randomBytes(4).toString("hex");

  // LISTA BLANCA (arreglo ATAQUE4-P5, de D-7/F-13d): solo se escriben
  // las bases del respaldo y los marcadores de formato DE esas bases.
  // Cualquier otro nombre (un .json ajeno como el staging de rotación,
  // la propia bóveda, un sidecar suelto) se rechaza aquí, en la
  // verificación previa, antes de tocar el destino: un respaldo no
  // puede plantar ficheros que la app no espera.
  for (const entry of manifest.entries) {
    if (entry.path.endsWith(".format.json")) {
      const base = entry.path.slice(0, -".format.json".length);
      if (!payloads.has(base)) {
        throw new BackupError(`el respaldo trae el marcador ${entry.path} sin su base: fuera de la lista blanca`);
      }
    } else if (
      entry.path.endsWith(".json") ||
      entry.path.endsWith("-wal") ||
      entry.path.endsWith("-shm") ||
      entry.path.endsWith("-journal")
    ) {
      throw new BackupError(`el respaldo trae una entrada fuera de la lista blanca de restauración: ${entry.path}`);
    }
  }

  // COMPROBACIÓN PREVIA DE DESTINO (M-3): una base GESTIONADA del
  // destino que no viaja en el respaldo quedaría huérfana al restaurar:
  // la sustitución re-envuelve la custodia con la DEK del respaldo y
  // la clave de esa base dejaría de guardarla nadie, ilegible para
  // siempre y sin aviso. Se detecta AQUÍ, antes de abrir una sola
  // base, y se rechaza nombrándola una a una con su salida: la app
  // nunca la borra ni la re-cifra por su cuenta. Base gestionada =
  // fichero con su marcador `<base>.format.json` al lado; no lo son
  // la bóveda, el staging de rotación ni los restos de operaciones
  // (temporales y respaldos de la propia restauración).
  const restoredNames = new Set(dbEntries.map((e) => e.path));
  const orphans: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".format.json")) continue;
    const base = name.slice(0, -".format.json".length);
    if (base === VAULT_BLOB_FILE || base === ROTATION_STAGING_FILE) continue;
    if (base.endsWith(".pre-restore-bak") || base.includes(".tmp-") || base.includes(".restore-tmp-")) continue;
    if (!existsSync(path.join(dir, base))) continue;
    if (!restoredNames.has(base)) orphans.push(base);
  }
  if (orphans.length > 0) {
    throw new BackupError(
      `el destino guarda bases que no vienen en el respaldo: ${orphans.join(", ")}. ` +
        "Si se restaura, esas bases quedan ilegibles para siempre: su clave deja de guardarla la bóveda. " +
        "Inclúyelas en el respaldo o apártalas a mano antes de restaurar.",
    );
  }

  // Verificación previa: cada base abre con la clave del respaldo,
  // desde un temporal, antes de tocar el destino.
  for (const entry of dbEntries) {
    const tmpPath = path.join(dir, `.restore-check-${stamp}-${entry.path}`);
    writeFileSync(tmpPath, payloads.get(entry.path) as Buffer);
    try {
      const db = rawOpenEncrypted(tmpPath, restoredDek);
      try {
        verifyHandle(db);
      } finally {
        db.close();
      }
    } catch (err) {
      throw new BackupError(`la base ${entry.path} del respaldo no abre con su clave: ${(err as Error).message}`);
    } finally {
      rmSync(tmpPath, { force: true });
      rmSync(`${tmpPath}-wal`, { force: true });
      rmSync(`${tmpPath}-shm`, { force: true });
    }
  }

  // Sustitución atómica con red de rollback. El rollback devuelve el
  // destino ENTERO: la principal Y sus sidecars (arreglo ATAQUE4-P2,
  // de D-2/F-14: el -wal del destino puede guardar la cola no
  // consolidada, y perderla era perder exactamente las filas que el
  // rollback existe para proteger), y también el blob de custodia si
  // la re-envoltura llegó a tocarlo.
  const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;
  interface SubBackup {
    dest: string;
    bak: string | null;
    sidecars: Array<{ src: string; bak: string }>;
  }
  const backups: SubBackup[] = [];
  const blobPath = vaultBlobPath(dir);
  const prevBlobRaw = existsSync(blobPath) ? readFileSync(blobPath) : null;
  let provider: KeyCustodyProvider;
  try {
    for (const entry of manifest.entries) {
      const dest = path.join(dir, entry.path);
      const sub: SubBackup = { dest, bak: null, sidecars: [] };
      backups.push(sub);
      // Primero los sidecars del original a su propio respaldo: dejan
      // de estar junto a la principal antes de que esta se mueva.
      for (const suffix of SIDECAR_SUFFIXES) {
        const src = `${dest}${suffix}`;
        if (existsSync(src)) {
          const bak = `${src}.pre-restore-bak`;
          moveDurable(src, bak);
          sub.sidecars.push({ src, bak });
        }
      }
      if (existsSync(dest)) {
        sub.bak = `${dest}.pre-restore-bak`;
        moveDurable(dest, sub.bak);
      }
      const tmp = `${dest}.restore-tmp-${stamp}`;
      writeFileDurable(dest, payloads.get(entry.path) as Buffer, { tmpPath: tmp, mode: 0o600 });
    }
    // Re-envoltura local VERIFICADA desenvolviendo lo recién guardado
    // (ATAQUE4-P3, de D-4): la bóveda de este PC pasa a guardar la DEK
    // restaurada con la credencial de este PC, y si la comprobación
    // falla la restauración entera se deshace.
    provider = await selectCustodyProvider(providers);
    await writeVaultBlobVerified(dir, provider, restoredDek);
  } catch (err) {
    // Rollback: fuera lo restaurado, vuelta a lo guardado (principal,
    // sidecars y blob de custodia, byte a byte).
    for (const { dest, bak, sidecars } of [...backups].reverse()) {
      rmSync(dest, { force: true });
      for (const suffix of SIDECAR_SUFFIXES) rmSync(`${dest}${suffix}`, { force: true });
      for (const { src, bak: sidecarBak } of sidecars) {
        if (existsSync(sidecarBak)) moveDurable(sidecarBak, src);
      }
      if (bak && existsSync(bak)) moveDurable(bak, dest);
    }
    if (prevBlobRaw) {
      const tmp = `${blobPath}.tmp-${process.pid}`;
      writeFileDurable(blobPath, prevBlobRaw, { tmpPath: tmp });
    } else {
      rmSync(blobPath, { force: true });
    }
    throw new BackupError(`la restauración falló y se deshizo: ${(err as Error).message}`);
  }
  for (const { bak, sidecars } of backups) {
    if (bak) rmSync(bak, { force: true });
    for (const { bak: sidecarBak } of sidecars) rmSync(sidecarBak, { force: true });
  }
  if (session && !session.locked) session.adoptDek(restoredDek);
  // El resultado DECLARA el nivel de custodia con el que se re-envolvió
  // (ATAQUE4-P8, de D-9/H-08): si este PC solo tiene contraseña y el
  // respaldo venía de un PC con TPM, el nivel baja y se dice. Y declara
  // si el respaldo era de la vía legada (A-3): un v1 traía su clave en
  // claro dentro del fichero, y quien restaura tiene que saberlo.
  return { restored: dbEntries.map((e) => e.path), custodyLevel: provider.id, legacyCleartextKey };
}
