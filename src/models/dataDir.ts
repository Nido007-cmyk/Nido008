/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La costura del directorio de datos de los paquetes (E3, tanda 4 ·
 * J-3): el análogo de PC del `FileSystem.documentDirectory` del
 * móvil para todo lo que vive bajo `corpus/` (los paquetes, su
 * registro de importados y su diario de instalación). Sin fijar, el
 * directorio es el de trabajo del proceso — la forma en que las
 * baterías y el banco lo ejercitan —; la carcasa lo fija al
 * directorio de datos real de la app desde E3.7 (tanda 14:
 * `setPacksDataDir` en el registro de desbloqueo de services,
 * junto a `setKnowledgeDbDir` y `setEmbeddingModelsDir`, que
 * recibieron la misma fijación en la misma pasada).
 */
import { resolve, sep } from "node:path";

let packsDataDir: string | null = null;

export function setPacksDataDir(dir: string | null): void {
  packsDataDir = dir;
}

/** Directorio bajo el que vive `corpus/` (ruta de fichero, sin esquema). */
export function getPacksDataDir(): string {
  return packsDataDir ?? process.cwd();
}

/** La misma raíz en forma de URI `file://` con barra final, como el documentDirectory del móvil. */
export function packsDocumentDirectory(): string {
  const dir = getPacksDataDir().replace(/\/$/, "");
  return `file://${dir}/`;
}

/** Un nombre de paquete que resuelve fuera del directorio de datos. */
export class PackPathRefusal extends Error {}

/**
 * La resolución de paquetes, con la contención que la vía de
 * modelos ya tiene (resolveModelFile en core/loadPath.ts): el
 * nombre se resuelve contra el directorio de datos y el resultado
 * debe quedar DENTRO de él. Sin esta contención, una clave del
 * registro de importados con `../../` y un pin casado por tamaño
 * servía ficheros de fuera del directorio (partida J3S-2,
 * cobrada en el paso 4 del bloque puerta de E5 en esta forma:
 * la resolución gana la contención). Quien resuelve decide qué
 * hace con el rechazo: las puertas degradan a su estado cerrado
 * (no abre, no verificado), nunca sirven el fichero de fuera.
 */
export function resolvePackPath(filename: string): string {
  const dir = resolve(getPacksDataDir());
  const resolved = resolve(dir, filename);
  if (resolved !== dir && !resolved.startsWith(dir + sep)) {
    throw new PackPathRefusal(
      `refused: "${filename}" resolves outside the packs data directory.`,
    );
  }
  return resolved;
}

/** Ruta de un fichero de paquetes por su nombre relativo al directorio de datos. */
export function packsDataPath(filename: string): string {
  return resolvePackPath(filename);
}
