/**
 * formatMarker.ts — el marcador de formato de las bases cifradas (E2, pasos 0 y 2).
 *
 * Diseño: estudios/MEMORIA-CIFRADA-ETAPA.md §2.2. Junto a cada base vive un
 * fichero de metadatos NO sensible que registra la configuración de cipher
 * con la que se creó: versión de formato, cipher, legacy, tamaño de página
 * y versión exacta de la librería. Al abrir, si el marcador no coincide con
 * lo que esta app sabe abrir, se falla cerrado: no se «intenta» con otro
 * cipher ni con otra versión. Es la defensa contra la deriva de formato
 * entre versiones de la librería (el postmortem de §2.2: una subida menor
 * cambió los defectos y las bases dejaron de abrir).
 *
 * El marcador NO se validó en la prueba de pieza (solo se probó la
 * disciplina de pragmas): es entregable expreso de esta etapa y su prueba
 * propia vive en formatMarker.test.ts y en secureDatabase.test.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileDurable } from "./durableFs.js";

/** Identificador del formato de base de NIDO PC. */
export const DB_FORMAT_ID = "nido-pc-db";
/** Versión mayor del formato. Solo se abre lo que coincide exactamente. */
export const DB_FORMAT_VERSION = 1;
/** Cipher sellado: SQLCipher, como el móvil. Nunca el defecto (sqleet). */
export const DB_CIPHER = "sqlcipher";
/** Parámetros SQLCipher v4, los del móvil. */
export const DB_LEGACY = 4;
/** Librería que crea las bases y su versión fijada exacta (sin `^`). */
export const DB_LIBRARY = "better-sqlite3-multiple-ciphers";
export const DB_LIBRARY_VERSION = "13.1.1";

export interface DbFormatMarker {
  format: typeof DB_FORMAT_ID;
  version: number;
  cipher: typeof DB_CIPHER;
  legacy: typeof DB_LEGACY;
  pageSize: number;
  library: typeof DB_LIBRARY;
  libraryVersion: string;
  createdAt: string;
}

/** Error nombrado y greppable: el marcador no coincide con lo abrible. */
export class FormatMarkerError extends Error {
  readonly dbPath: string;
  readonly found: unknown;

  constructor(dbPath: string, found: unknown, reason: string) {
    super(`marcador de formato incompatible en ${path.basename(dbPath)}: ${reason}`);
    this.name = "FormatMarkerError";
    this.dbPath = dbPath;
    this.found = found;
  }
}

/** Ruta del marcador de una base: `<base>.format.json`, junto a ella. */
export function formatMarkerPath(dbPath: string): string {
  return `${dbPath}.format.json`;
}

export function buildFormatMarker(pageSize: number): DbFormatMarker {
  return {
    format: DB_FORMAT_ID,
    version: DB_FORMAT_VERSION,
    cipher: DB_CIPHER,
    legacy: DB_LEGACY,
    pageSize,
    library: DB_LIBRARY,
    libraryVersion: DB_LIBRARY_VERSION,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Escritura atómica y durable (temporal + fsync + rename + fsync del
 * directorio, por durableFs): nunca un marcador a medias (A-4).
 */
export function writeFormatMarker(dbPath: string, pageSize: number): DbFormatMarker {
  const marker = buildFormatMarker(pageSize);
  const target = formatMarkerPath(dbPath);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileDurable(target, JSON.stringify(marker, null, 2) + "\n", { tmpPath: tmp });
  return marker;
}

/** Lee el marcador; `null` si no existe; lanza si existe pero está corrupto. */
export function readFormatMarker(dbPath: string): DbFormatMarker | null {
  const p = formatMarkerPath(dbPath);
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new FormatMarkerError(dbPath, undefined, `el marcador no se puede leer (${(err as Error).message})`);
  }
  return parsed as DbFormatMarker;
}

/**
 * La puerta del marcador al abrir una base EXISTENTE: debe existir y
 * coincidir campo a campo con lo que esta app sabe abrir. Cualquier
 * desviación (otro cipher, otro legacy, otra versión de formato u otra
 * versión de librería) falla cerrado con FormatMarkerError.
 */
export function assertFormatMarkerCompatible(dbPath: string): DbFormatMarker {
  const marker = readFormatMarker(dbPath);
  if (!marker) {
    throw new FormatMarkerError(
      dbPath,
      null,
      "la base existe pero no tiene marcador de formato; no la creó esta app y no se abre a ciegas",
    );
  }
  if (marker.format !== DB_FORMAT_ID) {
    throw new FormatMarkerError(dbPath, marker.format, `formato desconocido (se esperaba ${DB_FORMAT_ID})`);
  }
  if (marker.version !== DB_FORMAT_VERSION) {
    throw new FormatMarkerError(dbPath, marker.version, `versión de formato no soportada (se esperaba ${DB_FORMAT_VERSION})`);
  }
  if (marker.cipher !== DB_CIPHER) {
    throw new FormatMarkerError(dbPath, marker.cipher, `cipher distinto del sellado (se esperaba ${DB_CIPHER})`);
  }
  if (marker.legacy !== DB_LEGACY) {
    throw new FormatMarkerError(dbPath, marker.legacy, `legacy distinto del sellado (se esperaba ${DB_LEGACY})`);
  }
  // F-PC66: la IDENTIDAD de la librería se comprueba, no solo su
  // versión. Sin este campo, un marcador de OTRA librería con la
  // misma cadena de versión pasaba la puerta entera.
  if (marker.library !== DB_LIBRARY) {
    throw new FormatMarkerError(
      dbPath,
      marker.library,
      `la creó otra librería (${String(marker.library)}); esta app abre las de ${DB_LIBRARY}`,
    );
  }
  if (marker.libraryVersion !== DB_LIBRARY_VERSION) {
    throw new FormatMarkerError(
      dbPath,
      marker.libraryVersion,
      `la creó otra versión de la librería (${String(marker.libraryVersion)}); ` +
        `esta app abre las de ${DB_LIBRARY_VERSION} y la subida de versión exige su tanda con prueba de formato`,
    );
  }
  return marker;
}
