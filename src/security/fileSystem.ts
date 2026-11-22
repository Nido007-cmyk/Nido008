/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * fileSystem.ts — EL CONTRATO `expo-file-system/legacy` DEL MÓVIL SOBRE EL
 * ALMACÉN CIFRADO DE E2 (alineación al móvil, cierre R3).
 *
 * `models/settings.ts` se adopta del 0.1.108 tal cual y su única hoja de
 * plataforma es `expo-file-system/legacy`. Este módulo es esa hoja en PC,
 * con las firmas del contrato que el fichero usa: `documentDirectory`,
 * `getInfoAsync`, `readAsStringAsync`, `writeAsStringAsync`, `deleteAsync`
 * y `moveAsync`.
 *
 * Suelo: los ficheros viven bajo el directorio de datos de la app
 * (`appStoreDir()`), sellados con la DEK de E2 (`appStore.ts`). Lo escrito
 * nunca toca el disco en claro, y sin DEK leer o escribir falla cerrado.
 * Consultar, borrar y mover no necesitan la clave, igual que en el móvil.
 *
 * `documentDirectory` es una raíz estable, `file:///nido-app/`, porque el
 * móvil la lee al cargar el módulo (`settings.ts` compone sus rutas como
 * constantes). Cada operación traduce esa raíz al directorio vigente en
 * el momento de la llamada, y una ruta que resuelva fuera de él se
 * rechaza. Es la misma contención que `resolvePackPath` en
 * models/dataDir.ts.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { appStoreDek, appStoreDir, seal, unseal } from "./appStore.js";
import { moveDurable } from "./durableFs.js";

/** La raíz de documentos con la forma del móvil (URI con barra final). */
export const documentDirectory = "file:///nido-app/";

/** Una ruta que no está bajo `documentDirectory` o que escapa del directorio de datos. */
export class AppFilePathRefusal extends Error {}

function realPath(uri: string): string {
  if (!uri.startsWith(documentDirectory)) {
    throw new AppFilePathRefusal(`refused: "${uri}" is not under the app document directory.`);
  }
  const dir = resolve(appStoreDir());
  const p = resolve(dir, uri.slice(documentDirectory.length));
  if (p !== dir && !p.startsWith(dir + sep)) {
    throw new AppFilePathRefusal(`refused: "${uri}" resolves outside the app data directory.`);
  }
  return p;
}

export interface FileInfo {
  exists: boolean;
  isDirectory: boolean;
  uri: string;
  size?: number;
  modificationTime?: number;
}

export async function getInfoAsync(uri: string): Promise<FileInfo> {
  const p = realPath(uri);
  if (!existsSync(p)) return { exists: false, isDirectory: false, uri };
  const st = statSync(p);
  return {
    exists: true,
    isDirectory: st.isDirectory(),
    uri,
    size: st.size,
    modificationTime: st.mtimeMs / 1000,
  };
}

export async function readAsStringAsync(uri: string): Promise<string> {
  const p = realPath(uri);
  const dek = await appStoreDek();
  return unseal(dek, readFileSync(p)).toString("utf8");
}

export async function writeAsStringAsync(uri: string, contents: string): Promise<void> {
  const p = realPath(uri);
  const dek = await appStoreDek();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, seal(dek, Buffer.from(contents, "utf8")));
}

export async function deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void> {
  const p = realPath(uri);
  if (!existsSync(p)) {
    if (options?.idempotent) return;
    throw new Error(`File '${uri}' could not be deleted because it could not be found`);
  }
  rmSync(p, { recursive: true, force: true });
}

export async function moveAsync(options: { from: string; to: string }): Promise<void> {
  const from = realPath(options.from);
  const to = realPath(options.to);
  mkdirSync(dirname(to), { recursive: true });
  // Sitio 14 del censo de A-4 (dirimen de la apertura de la tanda de
  // seguridad): el movimiento entra por moveDurable, con su fsync del
  // directorio, para que la guardia de censo nazca sin excepciones en
  // la capa de seguridad.
  moveDurable(from, to);
}
