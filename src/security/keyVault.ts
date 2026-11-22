/**
 * keyVault.ts — custodia de la DEK por escalera declarada (E2, paso 1).
 *
 * Diseño: estudios/MEMORIA-CIFRADA-ETAPA.md §3.1. La DEK (32 bytes de
 * CSPRNG, generada una vez, jamás derivada de PIN/UUID/identidad) vive en
 * claro solo en memoria del proceso principal; en disco vive siempre
 * envuelta por el proveedor de custodia activo. La escalera es
 * `tpm` → `dpapi` → `contrasena`, buscando el nivel más alto disponible
 * y declarándolo tal cual es: DPAPI jamás se etiqueta como TPM.
 *
 * El blob envuelto es `nido-keyvault.json`, con cabecera versionada y sin
 * ningún secreto en claro: { version, provider, createdAt, params,
 * wrapped }. Su seguridad la da el mecanismo, no la ubicación.
 *
 * Proveedor `contrasena` (Node puro, corre entero en esta VM):
 * KEK = scrypt(N=2^17, r=8, p=1, salida 32) con sal de 16 bytes de CSPRNG;
 * envoltura AES-256-GCM con nonce de 12 bytes por envoltura. La etiqueta
 * GCM manda: contraseña equivocada = error sin DEK, nunca una DEK «casi».
 *
 * REQUISITO cazado por la prueba de pieza (INFORME-CONTRASENA.md) y
 * sellado aquí: `maxmem` se fija explícitamente al derivar. Con el
 * defecto de Node (32 MiB) la derivación con estos parámetros ni arranca
 * en ninguna máquina (ERR_CRYPTO_INVALID_SCRYPT_PARAMS); el primer valor
 * probado que deriva es 136 MiB. Su regresión permanente es el caso C-3
 * de la batería (keyVault.test.ts).
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileDurable } from "./durableFs.js";

export type CustodyLevel = "tpm" | "dpapi" | "contrasena";

/** Orden de la escalera, del nivel más alto al suelo. */
export const CUSTODY_LADDER: readonly CustodyLevel[] = ["tpm", "dpapi", "contrasena"];

export interface ScryptParams {
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  /** Sal en base64 (16 bytes de CSPRNG por envoltura). */
  salt: string;
}

export interface WrappedBlob {
  version: 1;
  provider: CustodyLevel;
  createdAt: string;
  /** Solo el proveedor `contrasena` los lleva: parámetros de su KDF. */
  params?: ScryptParams;
  /** La DEK envuelta, en base64. Nunca la DEK en claro en ninguna forma. */
  wrapped: string;
}

export interface KeyCustodyProvider {
  id: CustodyLevel;
  available(): Promise<boolean>;
  /** Envuelve la DEK con el mecanismo del nivel. Lanza si no puede. */
  wrap(dek: Buffer): Promise<WrappedBlob>;
  /** Desenvuelve; lanza sin entregar nada si no puede: fail-closed. */
  unwrap(blob: WrappedBlob): Promise<Buffer>;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

/** La envoltura no verifica (contraseña equivocada o blob manipulado). */
export class VaultUnlockError extends VaultError {
  constructor(message = "la custodia no verifica: contraseña equivocada o blob manipulado") {
    super(message);
    this.name = "VaultUnlockError";
  }
}

/** El fichero de custodia está mal formado o no es de esta app. */
export class VaultBlobError extends VaultError {
  constructor(message: string) {
    super(message);
    this.name = "VaultBlobError";
  }
}

// ---------------------------------------------------------------------------
// Proveedor `contrasena`: scrypt + AES-256-GCM, Node puro
// ---------------------------------------------------------------------------

export const SCRYPT_N = 2 ** 17;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const KEK_BYTES = 32;
export const DEK_BYTES = 32;
export const SALT_BYTES = 16;
export const GCM_NONCE_BYTES = 12;
/**
 * maxmem explícito de la derivación sellada: 136 MiB. La memoria teórica
 * de scrypt con N=2^17, r=8 es 128 MiB; el defecto de Node (32 MiB) hace
 * que la derivación ni arranque. Primer valor probado que deriva: este.
 */
export const SCRYPT_MAXMEM = 136 * 1024 * 1024;

/**
 * El mínimo de una contraseña NUEVA (B-7, forma (b) dirimida por la
 * casa en la tanda de seguridad): 8 caracteres contados en puntos de
 * código Unicode. Vive solo donde el secreto nace (wrap); abrir y
 * restaurar no comprueban nada, para que una contraseña más corta,
 * creada antes, siga abriendo su memoria.
 */
export const MIN_PASSWORD_CHARS = 8;

function scryptAsync(password: string, salt: Buffer, params: { n: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEK_BYTES,
      { N: params.n, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

/**
 * Deriva la KEK con los parámetros sellados a través de esta pieza.
 * El caso C-3 de la batería llama exactamente a esta función: si el
 * `maxmem` fijado se perdiera, caería con ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 */
export async function deriveKekWithSealedParams(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export class PasswordCustodyProvider implements KeyCustodyProvider {
  readonly id = "contrasena" as const;
  readonly #password: string;

  constructor(password: string) {
    if (typeof password !== "string" || password.length === 0) {
      throw new VaultError("el proveedor contrasena exige una contraseña no vacía");
    }
    this.#password = password;
  }

  async available(): Promise<boolean> {
    return true; // Es el suelo de la escalera: siempre disponible.
  }

  async wrap(dek: Buffer): Promise<WrappedBlob> {
    if (dek.length !== DEK_BYTES) throw new VaultError(`la DEK debe ser de ${DEK_BYTES} bytes`);
    // B-7: el mínimo se impone AQUÍ, donde el secreto nace. Toda
    // contraseña nueva pasa por esta función (la de la bóveda al
    // crearla o al cambiarla; la del respaldo al crearlo, que envuelve
    // por el mismo proveedor), así que un solo punto cobra la política
    // entera. El conteo es en puntos de código Unicode ([...s].length):
    // no castiga a quien escribe con caracteres de dos bytes ni infla
    // la cifra con mitades de un carácter. unwrap() no comprueba nada.
    if ([...this.#password].length < MIN_PASSWORD_CHARS) {
      throw new VaultError(`una contraseña nueva debe tener al menos ${MIN_PASSWORD_CHARS} caracteres`);
    }
    const salt = randomBytes(SALT_BYTES);
    const kek = await deriveKekWithSealedParams(this.#password, salt);
    try {
      const nonce = randomBytes(GCM_NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", kek, nonce);
      const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        version: 1,
        provider: "contrasena",
        createdAt: new Date().toISOString(),
        params: { kdf: "scrypt", n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: salt.toString("base64") },
        wrapped: Buffer.concat([nonce, ct, tag]).toString("base64"),
      };
    } finally {
      kek.fill(0);
    }
  }

  async unwrap(blob: WrappedBlob): Promise<Buffer> {
    if (blob.provider !== "contrasena" || !blob.params || blob.params.kdf !== "scrypt") {
      throw new VaultBlobError("el blob no es una envoltura del proveedor contrasena");
    }
    // Fail-closed también en los parámetros: un blob con parámetros
    // rebajados no se deriva; la envoltura sellada usa exactamente estos.
    if (blob.params.n !== SCRYPT_N || blob.params.r !== SCRYPT_R || blob.params.p !== SCRYPT_P) {
      throw new VaultBlobError("el blob trae parámetros de derivación distintos de los sellados");
    }
    const salt = Buffer.from(blob.params.salt, "base64");
    if (salt.length !== SALT_BYTES) throw new VaultBlobError("el blob trae una sal de tamaño inválido");
    const kek = await deriveKekWithSealedParams(this.#password, salt);
    try {
      const raw = Buffer.from(blob.wrapped, "base64");
      if (raw.length !== GCM_NONCE_BYTES + DEK_BYTES + 16) {
        throw new VaultUnlockError("la envoltura tiene un tamaño inválido");
      }
      const nonce = raw.subarray(0, GCM_NONCE_BYTES);
      const tag = raw.subarray(raw.length - 16);
      const ct = raw.subarray(GCM_NONCE_BYTES, raw.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", kek, nonce);
      decipher.setAuthTag(tag);
      // Si la etiqueta no verifica (contraseña equivocada o manipulación),
      // final() lanza aquí y no se entrega DEK alguna.
      const dek = Buffer.concat([decipher.update(ct), decipher.final()]);
      if (dek.length !== DEK_BYTES) throw new VaultUnlockError("la DEK desenvuelta tiene un tamaño inválido");
      return dek;
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultUnlockError();
    } finally {
      kek.fill(0);
    }
  }
}

// ---------------------------------------------------------------------------
// Escalera y estado declarado
// ---------------------------------------------------------------------------

export interface VaultStatus {
  level: CustodyLevel;
  hello: boolean;
}

/**
 * Elige el nivel más alto disponible. La lista se ORDENA por
 * CUSTODY_LADDER dentro de la propia función (arreglo ATAQUE4-P8, de
 * D-9/H-07): un llamador que pase los proveedores desordenados no
 * pierde el nivel alto en silencio. El id del elegido es el nivel
 * declarado, sin disfraces.
 */
export async function selectCustodyProvider(providers: readonly KeyCustodyProvider[]): Promise<KeyCustodyProvider> {
  const rank = (p: KeyCustodyProvider): number => {
    const i = CUSTODY_LADDER.indexOf(p.id);
    return i === -1 ? CUSTODY_LADDER.length : i; // Un id fuera de la escalera va el último.
  };
  const ordered = [...providers].sort((a, b) => rank(a) - rank(b));
  for (const provider of ordered) {
    if (await provider.available()) return provider;
  }
  throw new VaultError("ningún proveedor de custodia está disponible");
}

export function vaultStatusFor(provider: KeyCustodyProvider, hello = false): VaultStatus {
  return { level: provider.id, hello };
}

// ---------------------------------------------------------------------------
// El fichero de custodia: nido-keyvault.json
// ---------------------------------------------------------------------------

export const VAULT_BLOB_FILE = "nido-keyvault.json";

export function vaultBlobPath(dir: string): string {
  return path.join(dir, VAULT_BLOB_FILE);
}

/**
 * Escritura atómica y durable (temporal + fsync + rename + fsync del
 * directorio, por durableFs): nunca un blob a medias, ni en disco ni
 * tras un corte de energía (A-4).
 */
export function writeVaultBlob(dir: string, blob: WrappedBlob): void {
  const target = vaultBlobPath(dir);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileDurable(target, JSON.stringify(blob, null, 2) + "\n", { tmpPath: tmp });
}

export function readVaultBlob(dir: string): WrappedBlob {
  const p = vaultBlobPath(dir);
  if (!existsSync(p)) throw new VaultBlobError("no existe el fichero de custodia (nido-keyvault.json)");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new VaultBlobError("el fichero de custodia no se puede leer como JSON");
  }
  const blob = parsed as Partial<WrappedBlob>;
  if (
    blob.version !== 1 ||
    (blob.provider !== "tpm" && blob.provider !== "dpapi" && blob.provider !== "contrasena") ||
    typeof blob.wrapped !== "string" ||
    blob.wrapped.length === 0
  ) {
    throw new VaultBlobError("el fichero de custodia está mal formado");
  }
  return blob as WrappedBlob;
}

/**
 * Escribe el blob de custodia y COMPRUEBA lo recién guardado:
 * desenvuelve el blob leído del disco y exige que la DEK coincide con
 * la que se acababa de envolver (arreglo ATAQUE4-P3, de D-4/E-06). Un
 * proveedor defectuoso que envuelva otra clave ya no pasa en silencio:
 * la operación se declara fallida en el momento, no al próximo
 * desbloqueo. Quien llama decide qué hacer con el blob malo que queda
 * en disco (la rotación restaura el anterior; la primera instalación
 * lo borra; la restauración deshace la sustitución entera).
 */
export async function writeVaultBlobVerified(
  dir: string,
  provider: KeyCustodyProvider,
  dek: Buffer,
): Promise<WrappedBlob> {
  const blob = await provider.wrap(dek);
  writeVaultBlob(dir, blob);
  let back: Buffer;
  try {
    back = await provider.unwrap(readVaultBlob(dir));
  } catch (err) {
    throw new VaultError(
      `la custodia recién guardada no se pudo desenvolver de comprobación: ${(err as Error).message}`,
    );
  }
  const ok = back.equals(dek);
  back.fill(0);
  if (!ok) {
    throw new VaultError(
      "la custodia recién guardada desenvuelve una DEK distinta de la guardada (proveedor defectuoso): la operación se declara fallida",
    );
  }
  return blob;
}

/**
 * Primera instalación: genera la DEK de CSPRNG y la deja envuelta en el
 * fichero de custodia. La DEK en claro la devuelve solo en memoria.
 * El guardado se verifica desenvolviendo (writeVaultBlobVerified); si
 * la comprobación falla, el blob malo se retira para que una nueva
 * instalación no nazca sobre una bóveda que no abre nada.
 *
 * F-PC64: es SOLO de primera instalación. Si ya existe un fichero de
 * custodia en el directorio, la función rechaza antes de generar nada:
 * sin la guarda, una segunda llamada sobrescribía el blob válido con
 * una DEK nueva y la memoria anterior quedaba ilegible para siempre
 * (y si el proveedor fallaba al envolver, el catch borraba el blob
 * bueno). La guarda va sobre el FICHERO, no sobre un blob válido: un
 * fichero corrupto en esa ruta también es evidencia de una bóveda y
 * también cierra la puerta. Con la guarda, el rmSync del catch solo
 * puede retirar un blob que esta misma llamada acaba de escribir.
 */
export async function initializeVault(
  dir: string,
  provider: KeyCustodyProvider,
): Promise<{ dek: Buffer; blob: WrappedBlob }> {
  if (existsSync(vaultBlobPath(dir))) {
    throw new VaultBlobError(
      "ya existe un fichero de custodia en este directorio: initializeVault es solo de primera instalación",
    );
  }
  const dek = randomBytes(DEK_BYTES);
  try {
    const blob = await writeVaultBlobVerified(dir, provider, dek);
    return { dek, blob };
  } catch (err) {
    rmSync(vaultBlobPath(dir), { force: true });
    dek.fill(0);
    throw err;
  }
}

/**
 * Desbloqueo: lee el blob y lo desenvuelve con el proveedor que lo creó
 * (el de su campo `provider`, buscado entre los candidatos). Si ese
 * proveedor no está entre los candidatos o no verifica, lanza sin DEK.
 */
export async function unlockVaultWith(
  dir: string,
  providers: readonly KeyCustodyProvider[],
): Promise<{ dek: Buffer; blob: WrappedBlob; provider: KeyCustodyProvider }> {
  const blob = readVaultBlob(dir);
  const provider = providers.find((p) => p.id === blob.provider);
  if (!provider) {
    throw new VaultError(`el blob es del nivel ${blob.provider} y ese proveedor no está disponible aquí`);
  }
  const dek = await provider.unwrap(blob);
  if (dek.length !== DEK_BYTES) throw new VaultUnlockError("la DEK desenvuelta tiene un tamaño inválido");
  return { dek, blob, provider };
}
