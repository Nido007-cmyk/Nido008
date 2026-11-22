/**
 * stagingSeal.ts — el sello de staging de la rotación (E2, paso 4).
 *
 * Espejo de la llave de staging del móvil: antes de tocar ninguna base,
 * la rotación escribe en disco el estado que permite recuperarla tras
 * un corte (DEK vieja, DEK nueva, bases afectadas), sellado con una
 * clave aleatoria de un solo uso envuelta por el proveedor de custodia
 * activo (los proveedores llevan su credencial en la construcción, como
 * en keyVault.ts). Sin desenvolver esa clave no hay staging legible: el
 * fichero en crudo no contiene ninguna DEK en ninguna forma (eso caza
 * R-2).
 *
 * El fichero vive junto a la bóveda: `nido-rotation-staging.json`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileDurable } from "./durableFs.js";
import {
  type KeyCustodyProvider,
  type WrappedBlob,
  selectCustodyProvider,
} from "./keyVault.js";

export const ROTATION_STAGING_FILE = "nido-rotation-staging.json";
const STAGING_FORMAT = "nido-pc-rotation-staging";

export class StagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingError";
  }
}

export interface RotationStagingPayload {
  createdAt: string;
  oldDekHex: string;
  newDekHex: string;
  /** Rutas absolutas de las bases afectadas por la rotación. */
  dbPaths: string[];
}

interface StagingFile {
  format: typeof STAGING_FORMAT;
  version: 1;
  createdAt: string;
  wrappedStagingKey: WrappedBlob;
  /** base64(nonce ‖ cifrado ‖ etiqueta GCM) del payload JSON. */
  sealed: string;
}

export function rotationStagingPath(dir: string): string {
  return path.join(dir, ROTATION_STAGING_FILE);
}

function writeFileAtomic(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  writeFileDurable(filePath, data, { tmpPath: tmp, mode: 0o600 });
}

/** Sella el estado de la rotación ANTES de tocar ninguna base. */
export async function sealRotationStaging(
  dir: string,
  payload: RotationStagingPayload,
  providers: readonly KeyCustodyProvider[],
): Promise<void> {
  const provider = await selectCustodyProvider(providers);
  const stagingKey = randomBytes(32);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", stagingKey, nonce);
    const plain = Buffer.from(JSON.stringify(payload), "utf8");
    const sealed = Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const file: StagingFile = {
      format: STAGING_FORMAT,
      version: 1,
      createdAt: payload.createdAt,
      wrappedStagingKey: await provider.wrap(stagingKey),
      sealed: sealed.toString("base64"),
    };
    writeFileAtomic(rotationStagingPath(dir), JSON.stringify(file));
  } finally {
    stagingKey.fill(0);
  }
}

/**
 * Lee el staging sellado. Devuelve null si no hay ninguno. Lanza
 * StagingError si el fichero está manipulado o la credencial que lleva
 * el proveedor no desenvuelve la clave de staging: fail-closed, sin
 * payload parcial.
 */
export async function readRotationStaging(
  dir: string,
  providers: readonly KeyCustodyProvider[],
): Promise<RotationStagingPayload | null> {
  const filePath = rotationStagingPath(dir);
  if (!existsSync(filePath)) return null;
  let file: StagingFile;
  try {
    file = JSON.parse(readFileSync(filePath, "utf8")) as StagingFile;
  } catch {
    throw new StagingError("el fichero de staging de rotación está corrupto (no es JSON)");
  }
  if (file.format !== STAGING_FORMAT || file.version !== 1 || typeof file.sealed !== "string" || !file.wrappedStagingKey) {
    throw new StagingError("el fichero de staging de rotación no tiene la forma esperada (fail-closed)");
  }
  const provider = providers.find((p) => p.id === file.wrappedStagingKey.provider);
  if (!provider) {
    throw new StagingError(`el staging se selló con el proveedor «${file.wrappedStagingKey.provider}», que no está disponible`);
  }
  let stagingKey: Buffer;
  try {
    stagingKey = await provider.unwrap(file.wrappedStagingKey);
  } catch (err) {
    throw new StagingError(`la clave de staging no desenvuelve: ${(err as Error).message}`);
  }
  try {
    const raw = Buffer.from(file.sealed, "base64");
    const nonce = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const body = raw.subarray(12, raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", stagingKey, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    const payload = JSON.parse(plain.toString("utf8")) as RotationStagingPayload;
    if (
      typeof payload.oldDekHex !== "string" ||
      typeof payload.newDekHex !== "string" ||
      !Array.isArray(payload.dbPaths)
    ) {
      throw new StagingError("el payload de staging no tiene la forma esperada (fail-closed)");
    }
    return payload;
  } catch (err) {
    if (err instanceof StagingError) throw err;
    throw new StagingError("el staging no abre: manipulado o clave equivocada (fail-closed)");
  } finally {
    stagingKey.fill(0);
  }
}

export function clearRotationStaging(dir: string): void {
  rmSync(rotationStagingPath(dir), { force: true });
}

export function hasRotationStaging(dir: string): boolean {
  return existsSync(rotationStagingPath(dir));
}
