/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * keyManager.ts — EL CONTRATO DEL ALMACÉN SEGURO DEL MÓVIL SOBRE E2
 * (alineación al móvil, cierre R3; R1 añade la clave de la base).
 *
 * En el móvil, este módulo guarda claves y ajustes privados en
 * expo-secure-store (Android Keystore) detrás de un backend inyectable
 * (`SecureBackend`). Aquí entra la parte del contrato que consumen las
 * piezas adoptadas: el backend inyectable con su doble en memoria para las
 * baterías, y `readPrivateSetting` / `writePrivateSetting` con la
 * semántica del 0.1.108, copiadas tal cual.
 *
 * Suelo: el backend real de PC es el almacén cifrado de la app
 * (`security/appStore.ts`). Cada clave es un fichero sellado con la DEK de
 * la bóveda de E2, bajo `secure-store/` del directorio de datos de la app.
 * Sin proveedor de DEK no hay backend, lo mismo que en el móvil cuando
 * falta SecureStore: leer devuelve `undefined` y escribir devuelve
 * `false`, y quien llama decide.
 *
 * Cierre R1: `getDatabaseKeyHex` entrega la clave de la base de la app
 * (`security/databaseManager`). En el móvil sale de SecureStore, envuelta
 * o no por la bóveda de hardware; en PC es la DEK de la bóveda de E2 que
 * entrega el proveedor del almacén de la app. Falla cerrada: sin
 * proveedor o sin clave lanza, y nunca devuelve null en producción, como
 * el móvil sin SecureStore en producción.
 *
 * Lo demás del keyManager del móvil (claves P2P, bóveda de hardware,
 * pérdida de clave) no entra: ninguna pieza adoptada lo usa, y la
 * custodia de la DEK en PC es de E2 (keyVault, vaultSession).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appStoreDek, appStoreDir, appStoreHasDekProvider, seal, unseal } from "../security/appStore.js";

export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let testBackend: SecureBackend | null = null;

/** Solo para tests: inyecta un backend en memoria. */
export function setTestSecureBackend(b: SecureBackend | null): void {
  testBackend = b;
}

/** Backend en memoria para tests. */
export function createMemorySecureBackend(): SecureBackend {
  const map = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
}

/** Las claves del almacén son alias fijos del código: letras, dígitos y `_`. */
function itemPath(key: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(key)) throw new Error("keyManager: alias de almacén no válido.");
  return join(appStoreDir(), "secure-store", `${key}.sealed`);
}

/** El backend real de PC: ficheros sellados con la DEK de E2. */
const sealedBackend: SecureBackend = {
  async getItemAsync(key: string): Promise<string | null> {
    const p = itemPath(key);
    if (!existsSync(p)) return null;
    return unseal(await appStoreDek(), readFileSync(p)).toString("utf8");
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    const p = itemPath(key);
    const dek = await appStoreDek();
    mkdirSync(join(appStoreDir(), "secure-store"), { recursive: true });
    writeFileSync(p, seal(dek, Buffer.from(value, "utf8")));
  },
  async deleteItemAsync(key: string): Promise<void> {
    rmSync(itemPath(key), { force: true });
  },
};

function realBackend(): SecureBackend | null {
  if (testBackend) return testBackend;
  return appStoreHasDekProvider() ? sealedBackend : null;
}

export async function readPrivateSetting(key: string): Promise<string | null | undefined> {
  if (!key.startsWith("nido_private_")) throw new Error("keyManager: clave privada no permitida.");
  const backend = realBackend();
  if (!backend) return undefined;
  try {
    return await backend.getItemAsync(key);
  } catch {
    return undefined;
  }
}

/** true si quedó guardado en SecureStore; false si no se pudo (quien llama decide). */
export async function writePrivateSetting(key: string, value: string | null): Promise<boolean> {
  if (!key.startsWith("nido_private_")) throw new Error("keyManager: clave privada no permitida.");
  const backend = realBackend();
  if (!backend) return false;
  try {
    if (value === null) await backend.deleteItemAsync(key);
    else await backend.setItemAsync(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * La clave de la base de la app en hex (64 caracteres). Fail-closed: si no
 * hay DEK, lanza (`AppStoreLockedError`) y la base no se abre.
 */
export async function getDatabaseKeyHex(): Promise<string> {
  const dek = await appStoreDek();
  return dek.toString("hex");
}

