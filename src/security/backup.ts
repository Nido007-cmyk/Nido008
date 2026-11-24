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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  /** Ruta relativa a la base (userData); la lectura admite también la forma legada con una subida (`../store/…`), el ancla histórica en la bóveda. */
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

/**
 * La regla de UN segmento de nombre de entrada (la constante de
 * E2, con oficio nuevo desde la tanda breve de núcleo del
 * respaldo): un segmento empieza en alfanumérico y sigue con
 * letras, dígitos, punto, guion y guion bajo. Juzga segmentos, no
 * nombres enteros: el `..` como subcadena dentro de un segmento
 * (`a..b.db`) no es una subida y entra; la subida se juzga como
 * segmento en entryPathSegments.
 */
const SAFE_ENTRY_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * La gramática de un nombre de entrada (tanda breve de núcleo
 * del respaldo, Forma A; el hallazgo en
 * cadena-prep/ACTO-0-BOVEDA-HALLAZGO.md): parte el nombre por
 * `/` o `\` — las dos grafías que path.relative pudo escribir,
 * la de la plataforma y la de Windows — y admite el nombre
 * plano (`nido.db`), el relativo a la base
 * (`store/nido_memory.db`) y la forma legada con UNA sola
 * subida en primera posición (`../store/…`, el ancla histórica
 * en la bóveda). Todo lo demás se rechaza con el mensaje de
 * siempre: cadena vacía, ruta absoluta (el segmento inicial
 * vacío de `/etc/passwd`), prefijo de unidad (`C:` y su
 * familia, con rechazo expreso), segmento vacío (separador
 * doblado o final: `store//x`, `store/`), segmento `.`, un
 * `..` fuera de la primera posición o sin un segmento útil
 * detrás, y cualquier segmento fuera de la clase sellada.
 * Devuelve los segmentos; la forma canónica del nombre es
 * `segmentos.join("/")`.
 */
function entryPathSegments(raw: string): string[] {
  const insegura = () => new BackupError(`el respaldo trae una ruta insegura: ${raw}`);
  if (typeof raw !== "string" || raw.length === 0) throw insegura();
  if (/^[A-Za-z]:/.test(raw)) throw insegura();
  const segments = raw.split(/[/\\]/);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "..") {
      if (i !== 0 || segments.length < 2) throw insegura();
      continue;
    }
    if (!SAFE_ENTRY_PATH.test(seg)) throw insegura();
  }
  return segments;
}

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
  const seenCanonical = new Set<string>();
  let offset = 8 + headerLen;
  for (const entry of manifest.entries ?? []) {
    const canonical = entryPathSegments(entry.path).join("/");
    // D-3 (ATAQUE4-P2, de F-08/F-08b): un manifiesto con dos entradas
    // del mismo nombre es malformado por definición. Sin este rechazo,
    // la segunda carga sobrescribe a la primera en el mapa y, en la
    // sustitución, destruye el .pre-restore-bak de la primera: un
    // rollback posterior perdía la base original entera.
    if (seenPaths.has(entry.path)) {
      throw new BackupError(`el manifiesto trae la entrada ${entry.path} duplicada: respaldo malformado`);
    }
    seenPaths.add(entry.path);
    // La misma entrada en dos grafías (`store\x.db` y `store/x.db`)
    // es el mismo nombre canónico: malformado también, cobrado
    // aquí, en la lectura. El mapa se indexa por la canónica.
    if (seenCanonical.has(canonical)) {
      throw new BackupError(`el manifiesto trae la entrada ${entry.path} duplicada: respaldo malformado`);
    }
    seenCanonical.add(canonical);
    if (entry.sha256Kind !== "bytes") throw new BackupError(`huella de clase desconocida en ${entry.path}`);
    const slice = raw.subarray(offset, offset + entry.bytes);
    if (slice.length !== entry.bytes) throw new BackupError(`el respaldo está truncado en ${entry.path}`);
    if (sha256Hex(slice) !== entry.sha256) {
      throw new BackupError(`la huella de ${entry.path} no coincide: respaldo manipulado o corrupto`);
    }
    payloads.set(canonical, Buffer.from(slice));
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
 * Restaura un respaldo sobre la BASE dada (el directorio de
 * userData). Orden: aviso aceptado → contenedor verificado entero
 * → la DEK se desenvuelve con la contraseña de respaldo (v2; en v1
 * se lee de la cabecera, vía legada) → resolución de cada nombre a
 * su ruta efectiva dentro de la base → lista blanca →
 * comprobación previa de destino (M-3) → cada base del respaldo
 * abre con su clave (en un árbol temporal bajo la base) →
 * sustitución atómica con rollback → re-envoltura de la DEK
 * restaurada con la custodia local, que vive en la bóveda
 * (`vaultDir`) → la sesión, si está abierta, adopta la DEK
 * restaurada.
 * El resultado declara si el respaldo era de la vía legada
 * (`legacyCleartextKey`): un v1 trae su clave en claro y se dice.
 */
export async function restoreBackup(opts: {
  srcPath: string;
  /** La base (userData): los nombres del respaldo resuelven dentro de ella. */
  dir: string;
  /**
   * El directorio de la bóveda: la custodia vive en vault/,
   * FUERA de la base. Obligatorio y sin defecto a propósito:
   * un olvido tiene que ser un error de compilación, no una
   * restauración que re-envuelve la clave en el sitio
   * equivocado. En la batería plana de E2, vaultDir === dir
   * es la verdad de aquel diseño.
   */
  vaultDir: string;
  providers: readonly KeyCustodyProvider[];
  session?: VaultSession;
  /** El aviso de restauración debe aceptarse ANTES de ejecutar. */
  noticeAccepted: boolean;
  /** La contraseña de respaldo (solo v2): sin ella no se desenvuelve nada. */
  backupPassword?: string;
}): Promise<{ restored: string[]; custodyLevel: CustodyLevel; legacyCleartextKey: boolean }> {
  const { srcPath, dir, vaultDir, providers, session } = opts;
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
  const stamp = randomBytes(4).toString("hex");

  // RESOLUCIÓN (Forma A): cada nombre del manifiesto ya viene
  // canonizado por la lectura; aquí se resuelve a su ruta
  // EFECTIVA dentro de la base: la forma legada pierde su única
  // subida (su ancla era la bóveda, que cuelga de la base) y la
  // forma nueva ya es relativa a la base. Desde aquí la función
  // solo mira rutas efectivas: la lista blanca, la comprobación
  // de huérfanas, el temporal, la sustitución y el resultado
  // hablan de ellas. Dos nombres con el mismo destino
  // (`store/x.db` y `../store/x.db`) son el malformado de D-3
  // cobrado en esta capa, antes de tocar el destino; y la
  // contención dentro de la base se AFIRMA por entrada (la ruta
  // resuelta, estrictamente dentro de la base resuelta) aunque
  // la gramática la haga verdad por construcción: es la red
  // bajo la gramática, y la composición del destino en la
  // sustitución queda cubierta por ella.
  const baseResolved = path.resolve(dir);
  const effective = new Map<string, Buffer>();
  const effectiveOrder: string[] = [];
  for (const entry of manifest.entries) {
    const canonical = entryPathSegments(entry.path).join("/");
    const eff = canonical.startsWith("../") ? canonical.slice(3) : canonical;
    if (effective.has(eff)) {
      throw new BackupError(`el manifiesto trae la entrada ${entry.path} duplicada: respaldo malformado`);
    }
    const dest = path.resolve(baseResolved, eff);
    if (dest === baseResolved || !dest.startsWith(baseResolved + path.sep)) {
      throw new BackupError(`el respaldo trae una ruta insegura: ${entry.path}`);
    }
    effective.set(eff, payloads.get(canonical) as Buffer);
    effectiveOrder.push(eff);
  }
  const dbEffective = effectiveOrder.filter((p) => !p.endsWith(".format.json"));

  // LISTA BLANCA (arreglo ATAQUE4-P5, de D-7/F-13d): solo se escriben
  // las bases del respaldo y los marcadores de formato DE esas bases.
  // Cualquier otro nombre (un .json ajeno como el staging de rotación,
  // la propia bóveda, un sidecar suelto) se rechaza aquí, en la
  // verificación previa, antes de tocar el destino: un respaldo no
  // puede plantar ficheros que la app no espera. Se juzga sobre las
  // rutas EFECTIVAS: el marcador `<efectiva>.format.json` exige su
  // base efectiva, así que un marcador que viaja en el otro ancla
  // que su base queda fuera de la lista.
  for (const eff of effectiveOrder) {
    if (eff.endsWith(".format.json")) {
      const base = eff.slice(0, -".format.json".length);
      if (!effective.has(base)) {
        throw new BackupError(`el respaldo trae el marcador ${eff} sin su base: fuera de la lista blanca`);
      }
    } else if (
      eff.endsWith(".json") ||
      eff.endsWith("-wal") ||
      eff.endsWith("-shm") ||
      eff.endsWith("-journal")
    ) {
      throw new BackupError(`el respaldo trae una entrada fuera de la lista blanca de restauración: ${eff}`);
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
  // (temporales y respaldos de la propia restauración). El escaneo
  // corre SOBRE LA BASE: la recorre y recorre cada subdirectorio
  // inmediato (UN nivel: store/, knowledge/ y la propia vault/),
  // saltando los nombres que empiezan por punto (los temporales
  // de la casa, `.restore-check-…` entre ellos). La identidad de
  // una base gestionada es su ruta relativa a la base con `/`, y
  // el rechazo la nombra por ella (`knowledge/nido_knowledge.db`);
  // las exclusiones de siempre se aplican al SEGMENTO FINAL del
  // nombre, y la definición de base gestionada no cambia.
  const restoredNames = new Set(dbEffective);
  const orphans: string[] = [];
  const scanLevel = (absDir: string, prefix: string) => {
    for (const name of readdirSync(absDir)) {
      if (!name.endsWith(".format.json")) continue;
      const base = name.slice(0, -".format.json".length);
      if (base === VAULT_BLOB_FILE || base === ROTATION_STAGING_FILE) continue;
      if (base.endsWith(".pre-restore-bak") || base.includes(".tmp-") || base.includes(".restore-tmp-")) continue;
      if (!existsSync(path.join(absDir, base))) continue;
      const identity = prefix + base;
      if (!restoredNames.has(identity)) orphans.push(identity);
    }
  };
  scanLevel(dir, "");
  for (const dent of readdirSync(dir, { withFileTypes: true })) {
    if (dent.name.startsWith(".")) continue;
    if (dent.isDirectory()) scanLevel(path.join(dir, dent.name), `${dent.name}/`);
  }
  if (orphans.length > 0) {
    throw new BackupError(
      `el destino guarda bases que no vienen en el respaldo: ${orphans.join(", ")}. ` +
        "Si se restaura, esas bases quedan ilegibles para siempre: su clave deja de guardarla la bóveda. " +
        "Inclúyelas en el respaldo o apártalas a mano antes de restaurar.",
    );
  }

  // Verificación previa: cada base abre con la clave del respaldo,
  // desde un temporal, antes de tocar el destino. El temporal es
  // un ÁRBOL por corrida bajo la base (`.restore-check-<stamp>/`
  // con la ruta efectiva dentro): los sidecars de la apertura
  // caen dentro del árbol, la limpieza es el árbol entero en un
  // finally y ningún resto queda en la base, lo acierte o lo
  // falle la verificación.
  const checkRoot = path.join(dir, `.restore-check-${stamp}`);
  try {
    for (const eff of dbEffective) {
      const tmpPath = path.join(checkRoot, eff);
      mkdirSync(path.dirname(tmpPath), { recursive: true });
      writeFileSync(tmpPath, effective.get(eff) as Buffer);
      try {
        const db = rawOpenEncrypted(tmpPath, restoredDek);
        try {
          verifyHandle(db);
        } finally {
          db.close();
        }
      } catch (err) {
        throw new BackupError(`la base ${eff} del respaldo no abre con su clave: ${(err as Error).message}`);
      }
    }
  } finally {
    rmSync(checkRoot, { recursive: true, force: true });
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
  const blobPath = vaultBlobPath(vaultDir);
  const prevBlobRaw = existsSync(blobPath) ? readFileSync(blobPath) : null;
  let provider: KeyCustodyProvider;
  try {
    for (const eff of effectiveOrder) {
      const dest = path.join(dir, eff);
      // El área de la ruta efectiva puede no existir en una base
      // recién nacida (una instalación de prueba sin store/
      // todavía): se crea antes de escribir cada destino.
      mkdirSync(path.dirname(dest), { recursive: true });
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
      writeFileDurable(dest, effective.get(eff) as Buffer, { tmpPath: tmp, mode: 0o600 });
    }
    // Re-envoltura local VERIFICADA desenvolviendo lo recién guardado
    // (ATAQUE4-P3, de D-4): la bóveda de este PC pasa a guardar la DEK
    // restaurada con la credencial de este PC, y si la comprobación
    // falla la restauración entera se deshace. La custodia vive en
    // la bóveda (vaultDir), fuera de la base.
    provider = await selectCustodyProvider(providers);
    await writeVaultBlobVerified(vaultDir, provider, restoredDek);
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
  return { restored: dbEffective, custodyLevel: provider.id, legacyCleartextKey };
}
