/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * durableFs.ts — escritura y movimiento DURABLES (tanda de seguridad, A-4).
 *
 * Hasta esta pieza, cada escritura atómica de la capa de seguridad era
 * «temporal + renameSync» sin un solo fsync: ante un corte de energía,
 * el rename podía quedar en disco con el destino vacío o a medias. La
 * bóveda fallaba cerrada (no se filtraba nada; se perdía el acceso),
 * pero la durabilidad no estaba construida. Esta pieza es el ÚNICO
 * sitio de la capa donde se escribe o se mueve un fichero protegido, y
 * su contrato es el orden entero:
 *
 *   escribir el temporal → fsync del fichero → rename → fsync del directorio
 *
 * Un fsync que falla hace fallar la escritura entera: en las clases E
 * (escritura) y P (sustitución de una base ya escrita por SQLite) el
 * rename NO ocurre si el fsync del fichero falla. En la clase M
 * (movimiento puro entre nombres del mismo directorio) no hay fichero
 * que sincronizar antes: se mueve y se sincroniza el directorio.
 *
 * Cada llamante conserva su nombre de temporal y sus modos: la pieza
 * recibe el temporal ya nombrado por la costura de cada llamante
 * (`opts.tmpPath`) y el modo cuando lo hay (`opts.mode`).
 *
 * Windows, declarado: sincronizar un directorio con fsync no existe en
 * NTFS como en POSIX (abrir un directorio y sincronizarlo no está
 * soportado); `syncDir` traga SOLO ese error de plataforma y SOLO en
 * Windows, y la durabilidad NTFS queda declarada no probada aquí: su
 * pierna es la de E12 en máquina de Windows. En cualquier otra
 * plataforma, un fsync de directorio que falla hace fallar la
 * operación entera, como el del fichero.
 *
 * Las funciones aceptan un parámetro opcional de dependencias (el fs
 * real por defecto) para que la batería pruebe el orden exacto con un
 * fs fingido, sin tocar disco.
 */

import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Las operaciones de `node:fs` que la pieza usa, inyectables para la batería. */
export interface DurableFsDeps {
  writeFileSync: typeof writeFileSync;
  openSync: typeof openSync;
  fsyncSync: typeof fsyncSync;
  closeSync: typeof closeSync;
  renameSync: typeof renameSync;
}

const realDeps: DurableFsDeps = { writeFileSync, openSync, fsyncSync, closeSync, renameSync };

/**
 * Sincroniza un directorio para que el rename que acaba de ocurrir
 * dentro de él sobreviva a un corte. Defensivo solo en Windows y solo
 * en este paso (ver la cabecera): en el resto de plataformas el error
 * se propaga y la operación entera falla.
 */
export function syncDir(dir: string, deps: DurableFsDeps = realDeps): void {
  let fd: number | undefined;
  try {
    fd = deps.openSync(dir, "r");
    deps.fsyncSync(fd);
  } catch (err) {
    if (process.platform !== "win32") throw err;
    // Windows: no hay fsync de directorio; la durabilidad NTFS es la
    // pierna de E12, declarada no probada en esta máquina.
  } finally {
    if (fd !== undefined) deps.closeSync(fd);
  }
}

/** Sincroniza un fichero ya escrito, antes de cualquier rename. */
function syncFile(filePath: string, deps: DurableFsDeps): void {
  const fd = deps.openSync(filePath, "r");
  try {
    deps.fsyncSync(fd);
  } finally {
    deps.closeSync(fd);
  }
}

/**
 * Escritura durable (clase E): escribe `data` en el temporal, lo
 * sincroniza, lo renombra sobre `destPath` y sincroniza el directorio.
 * Si el fsync del fichero falla, el rename no ocurre y el destino
 * queda como estaba.
 */
export function writeFileDurable(
  destPath: string,
  data: string | Buffer,
  opts?: { tmpPath?: string; mode?: number; deps?: DurableFsDeps },
): void {
  const deps = opts?.deps ?? realDeps;
  const tmp = opts?.tmpPath ?? `${destPath}.tmp-${process.pid}`;
  deps.writeFileSync(tmp, data, opts?.mode !== undefined ? { mode: opts.mode } : undefined);
  syncFile(tmp, deps);
  deps.renameSync(tmp, destPath);
  syncDir(dirname(destPath), deps);
}

/**
 * Sustitución durable (clase P): el fichero ya está escrito y cerrado
 * por otro (SQLite); se sincroniza, se renombra sobre el destino y se
 * sincroniza el directorio. Si el fsync falla, el rename no ocurre.
 */
export function renameDurable(from: string, to: string, deps: DurableFsDeps = realDeps): void {
  syncFile(from, deps);
  deps.renameSync(from, to);
  syncDir(dirname(to), deps);
}

/**
 * Movimiento durable (clase M): renombra dentro del mismo directorio
 * (o entre directorios del mismo volumen) y sincroniza el directorio
 * destino. No hay contenido nuevo que sincronizar antes del rename.
 */
export function moveDurable(from: string, to: string, deps: DurableFsDeps = realDeps): void {
  deps.renameSync(from, to);
  syncDir(dirname(to), deps);
}
