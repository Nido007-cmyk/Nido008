/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Deduplicación de copias entre bibliotecas: cuando la recuperación
 * fusiona resultados de varios packs, el mismo artículo puede llegar
 * dos veces (el mismo texto vive en más de un pack). Esta pieza deja
 * caer los trozos que son copia de uno ya conservado y deja pasar los
 * demás, sin reordenar ni mutar la entrada: el orden de llegada es el
 * orden de rango (mejor primero) y el primero que llega es el que se
 * conserva.
 *
 * Dos trozos son copia cuando se cumplen las dos cosas:
 *   1. El mismo título tras normalizarlo (minúsculas, blancos
 *      colapsados, extremos recortados).
 *   2. Al menos COPY_MIN_SHARE de los pares de palabras consecutivos
 *      de uno están contenidos en el otro, en cualquiera de las dos
 *      direcciones. Los pares se forman con las palabras separadas
 *      por blancos, en minúsculas; un cuerpo de menos de dos palabras
 *      no tiene pares, su parte es 0 y nunca es copia por pares.
 *
 * La comparación es solo contra los trozos ya conservados: un trozo
 * que es copia de uno ya caído no cae por ese. Función pura, sin
 * estado entre llamadas.
 */

import type { RetrievedChunk } from "./retrieve.types.js";

/**
 * Parte mínima de pares compartidos para juzgar copia. El valor se
 * afinó sobre texto de estilo enciclopédico: por debajo de él, dos
 * secciones distintas del mismo artículo comparten vocabulario pero
 * no la sucesión de palabras; en él o por encima, un trozo repite al
 * otro.
 */
export const COPY_MIN_SHARE = 0.6;

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

function wordPairs(body: string): Set<string> {
  const words = body
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const pairs = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) {
    pairs.add(words[i] + " " + words[i + 1]);
  }
  return pairs;
}

/** Parte de los pares de `pairs` que también están en `other`. */
function shareOf(pairs: Set<string>, other: Set<string>): number {
  if (pairs.size === 0) return 0;
  let shared = 0;
  for (const pair of pairs) {
    if (other.has(pair)) shared++;
  }
  return shared / pairs.size;
}

export function dedupeArticleCopies(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  const keptTitles: string[] = [];
  const keptPairs: Set<string>[] = [];
  for (const chunk of chunks) {
    const title = normalizeTitle(chunk.title);
    const pairs = wordPairs(chunk.body);
    let copy = false;
    for (let i = 0; i < kept.length; i++) {
      if (keptTitles[i] !== title) continue;
      if (
        shareOf(pairs, keptPairs[i]) >= COPY_MIN_SHARE ||
        shareOf(keptPairs[i], pairs) >= COPY_MIN_SHARE
      ) {
        copy = true;
        break;
      }
    }
    if (!copy) {
      kept.push(chunk);
      keptTitles.push(title);
      keptPairs.push(pairs);
    }
  }
  return kept;
}
