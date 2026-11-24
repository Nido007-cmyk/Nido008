/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * vaultWipe.ts — Superficies de bóveda (PAQ-2): la
 * primitiva extendida de borrado total. La que había,
 * `wipeDatabase` (databaseManager.ts), borra UN fichero
 * (nido_memory.db) y su delegado no tenía llamante: un
 * botón «borrar todo» apuntado a ella vendería un
 * borrado que deja intactas las conversaciones selladas
 * y la bóveda. Esta primitiva borra el estado ENTERO de
 * NIDO en esta computadora, con la forma del móvil
 * (`appReset.ts`, la verdad base): censo canónico único,
 * marcador durable escrito ANTES de la primera
 * operación destructiva (si el proceso muere a mitad,
 * el próximo arranque lo detecta y completa el borrado
 * antes de enseñar nada: fail-closed), triturado
 * criptográfico primero y verificación al final que
 * nombra lo que quede, sin callar nada.
 *
 * El censo (los 10 puntos de §1 de
 * PREP-SUPERFICIES-BOVEDA, rutas relativas a la base de
 * userData): el blob de custodia y el staging de
 * rotación en vault/; store/ entero (la memoria con sus
 * sidecars y restos, el índice de búsqueda, las
 * conversaciones selladas con sus cuarentenas y los
 * paquetes añadidos); knowledge/ (la base de
 * conocimiento); nido-prefs.json; models/ y assets/
 * (descargas: no son datos personales, pero la letra de
 * la superficie los nombra parte del borrado y se
 * vuelven a descargar); export-tmp/ y paste-tmp/
 * (temporales con material de la persona EN CLARO).
 * Fuera del censo, declarado: las cachés propias de
 * Electron no son estado de NIDO y el renderizador no
 * usa localStorage (0 usos en app/src), así que este
 * censo SÍ es el estado entero de la app.
 *
 * El orden del censo ES la semántica: el blob de
 * custodia va primero porque borrarlo es el triturado
 * criptográfico — sin él, todo lo cifrado que pudiera
 * sobrevivir a un borrado a medias es irrecuperable
 * aunque el fichero quede en disco.
 *
 * La costura de prueba (el removedor inyectado) es la
 * forma del sabotaje de deleteAsync en la batería del
 * móvil: la primitiva corre entera (marcador, orden,
 * verificación) y solo la hoja que borra puede fingir
 * un fallo donde una batería lo pide. En producción
 * nadie la inyecta: el removedor es rmSync recursivo.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileDurable } from "./durableFs.js";

/** El marcador durable de un borrado en curso, en la base de userData. */
export const WIPE_MARKER = ".nido-wipe-in-progress";

/**
 * La lista canónica y única del estado entero, en su
 * orden de borrado: el blob de custodia primero
 * (triturado), el resto de la bóveda detrás, y cada
 * área por su nombre. Cada nombre del censo de §1 está
 * aquí por su nombre o por su directorio.
 */
export const WIPE_CENSUS: readonly string[] = [
  "vault/nido-keyvault.json",
  "vault/nido-rotation-staging.json",
  "vault",
  "store",
  "knowledge",
  "nido-prefs.json",
  "models",
  "assets",
  "export-tmp",
  "paste-tmp",
];

/** La hoja que borra un punto del censo (fichero o directorio entero). */
export type WipeRemover = (absPath: string) => void;

const defaultRemove: WipeRemover = (abs) => {
  rmSync(abs, { recursive: true, force: true });
};

/** ¿Quedó un borrado a mitad? El arranque lo pregunta antes de enseñar nada. */
export function wipeInterrupted(baseDir: string): boolean {
  return existsSync(path.join(baseDir, WIPE_MARKER));
}

/**
 * Borra el estado entero bajo la base dada y devuelve
 * los nombres del censo que NO se pudieron borrar
 * (vacío = limpio). El marcador se escribe antes de la
 * primera operación destructiva y solo se retira tras
 * verificar que no queda nada: si la lista no sale
 * vacía, el marcador permanece puesto y el próximo
 * arranque (o la siguiente llamada) completa el
 * borrado. Lo que no está en el censo no se toca.
 */
export function wipeAllState(baseDir: string, remove: WipeRemover = defaultRemove): string[] {
  if (!existsSync(baseDir)) return [];
  writeFileDurable(path.join(baseDir, WIPE_MARKER), new Date().toISOString());
  for (const entry of WIPE_CENSUS) {
    const abs = path.join(baseDir, entry);
    if (!existsSync(abs)) continue;
    try {
      remove(abs);
    } catch {
      /* la verificación de abajo lo nombra: aquí no se calla ni se finge */
    }
  }
  const leftovers = WIPE_CENSUS.filter((entry) => existsSync(path.join(baseDir, entry)));
  if (leftovers.length === 0) {
    rmSync(path.join(baseDir, WIPE_MARKER), { force: true });
  }
  return leftovers;
}
