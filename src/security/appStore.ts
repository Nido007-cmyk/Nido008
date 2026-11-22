/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * appStore.ts — EL ALMACÉN CIFRADO DE LA APP SOBRE E2 (alineación al
 * móvil, cierres R1 y R3).
 *
 * Las piezas del móvil que guardan estado de la app fuera de la base de
 * conocimiento (`models/settings.ts` con su fichero de ajustes, el
 * almacén seguro de `privacy/keyManager.ts` y la base de la app de
 * `security/databaseManager.ts`) se adoptan con su lógica, y su suelo se
 * resuelve aquí: un directorio de datos de la app y la DEK de la bóveda
 * de E2, con el mismo patrón inyectable que la base de conocimiento ya
 * usa (`setKnowledgeDbDekProvider` y `setKnowledgeDbDir` en rag/db.ts,
 * asiento D-3).
 *
 * - La DEK llega por un proveedor inyectable. En producción es la
 *   `VaultSession` de E2 y la cablea la carcasa. Sin proveedor, o con un
 *   proveedor que devuelve null, toda operación que necesita la clave
 *   falla cerrada: nunca se escribe en claro.
 * - Lo sellado usa AES-256-GCM sobre `node:crypto`, la misma primitiva
 *   con la que E2 envuelve la DEK y sella el staging de la rotación:
 *   cabecera `NSF1`, nonce de 12 bytes, etiqueta de 16 bytes y el texto
 *   cifrado.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertDek } from "./secureDatabase.js";

/** Proveedor de la DEK vigente: la sesión de la bóveda en producción. */
export type AppStoreDekProvider = () => Buffer | null | Promise<Buffer | null>;

let dekProvider: AppStoreDekProvider | null = null;
let appDir: string | null = null;

/** Registra el proveedor de DEK (la carcasa; las baterías, el de fixture). */
export function setAppStoreDekProvider(p: AppStoreDekProvider | null): void {
  dekProvider = p;
}

/** Fija el directorio de datos de la app (la carcasa; las baterías, uno temporal). */
export function setAppStoreDir(dir: string | null): void {
  appDir = dir;
}

/** Directorio de datos de la app (por defecto el mismo que la base de conocimiento). */
export function appStoreDir(): string {
  return appDir ?? join(homedir(), ".nido");
}

/** Error de apertura sin clave: la operación se rechaza, nunca degrada a claro. */
export class AppStoreLockedError extends Error {
  constructor() {
    super(
      "Almacén cifrado de la app sin DEK: no hay proveedor registrado o la sesión no entregó clave (fail-closed).",
    );
    this.name = "AppStoreLockedError";
  }
}

/** La DEK vigente; lanza `AppStoreLockedError` si no hay. */
export async function appStoreDek(): Promise<Buffer> {
  const dek = dekProvider ? await dekProvider() : null;
  if (!dek) throw new AppStoreLockedError();
  assertDek(dek);
  return dek;
}

/** ¿Hay proveedor de DEK registrado? (sin pedir la clave). */
export function appStoreHasDekProvider(): boolean {
  return dekProvider !== null;
}

const MAGIC = Buffer.from("NSF1", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Sella bytes con la DEK (AES-256-GCM). */
export function seal(dek: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ct]);
}

/** Abre lo sellado; lanza si la cabecera, la clave o la etiqueta no casan. */
export function unseal(dek: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < MAGIC.length + NONCE_BYTES + TAG_BYTES || !sealed.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Almacén cifrado de la app: contenido sin sellar o con cabecera desconocida.");
  }
  const nonce = sealed.subarray(4, 4 + NONCE_BYTES);
  const tag = sealed.subarray(4 + NONCE_BYTES, 4 + NONCE_BYTES + TAG_BYTES);
  const ct = sealed.subarray(4 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", dek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
