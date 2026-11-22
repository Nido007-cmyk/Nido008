/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pageChunker.ts — el troceador con ancla de página (E6, paso 4;
 * la pieza nueva de la etapa, DOCUMENTOS-ETAPA §4).
 *
 * Las constantes son las del móvil y no cambian (2.000
 * caracteres por fragmento, 200 de solape): los pisos del
 * perfil e5 se calibraron con este troceado y cambiarlo
 * invalidaría la calibración heredada. Lo nuevo es el ancla:
 *
 * 1. Ningún fragmento cruza una página: el troceado corre
 *    dentro de cada página, con el mismo algoritmo de siempre.
 * 2. El solape no se arrastra a la página siguiente: el primer
 *    fragmento de una página empieza en su primer carácter.
 * 3. La estimación previa se suma por páginas (§4.4).
 * 4. Cada fragmento sale con su página (1-based, o null en los
 *    documentos sin paginar) y su origen (texto u ocr).
 * 5. La marca de procedencia del OCR va dentro del texto del
 *    PRIMER fragmento de cada página reconocida (§4.5), como en
 *    el móvil va dentro del texto reconocido.
 *
 * chunkText es el algoritmo del importador del móvil, tal cual;
 * vive aquí porque el ancla lo envuelve.
 */

const CHARS_PER_TOKEN = 4; // rough English-text heuristic, no tokenizer on-device
export const CHUNK_CHARS = 500 * CHARS_PER_TOKEN;
export const OVERLAP_CHARS = 50 * CHARS_PER_TOKEN;

export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_CHARS, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = end - OVERLAP_CHARS;
  }
  return chunks;
}

/** Una página por trocear: la forma de PaginaTexto y la de los documentos sin paginar (pagina null). */
export interface PaginaPorTrocear {
  pagina: number | null;
  texto: string;
  origen: "texto" | "ocr";
}

/** Un fragmento con su ancla: el cuerpo y la página y el origen de los que sale. */
export interface FragmentoAnclado {
  body: string;
  page: number | null;
  origen: "texto" | "ocr";
}

/**
 * Trocea un documento página a página. `ocrNote` es la marca de
 * procedencia que se antepone al primer fragmento de cada
 * página de origen OCR (la pasa el importador en el idioma de
 * la app; sin nota, las páginas OCR entran como las de texto).
 */
export function chunkPages(
  pages: readonly PaginaPorTrocear[],
  ocrNote?: string,
): FragmentoAnclado[] {
  const out: FragmentoAnclado[] = [];
  for (const page of pages) {
    const pieces = chunkText(page.texto);
    pieces.forEach((body, i) => {
      out.push({
        body: i === 0 && page.origen === "ocr" && ocrNote ? `${ocrNote}\n\n${body}` : body,
        page: page.pagina,
        origen: page.origen,
      });
    });
  }
  return out;
}

/** La estimación de fragmentos de una longitud, la fórmula del importador. */
export function estimateChunkCountForLength(length: number): number {
  if (length <= 0) return 0;
  if (length <= CHUNK_CHARS) return 1;
  return 1 + Math.ceil((length - CHUNK_CHARS) / (CHUNK_CHARS - OVERLAP_CHARS));
}

/** §4.4: la estimación previa de un documento paginado se suma por páginas. */
export function estimateChunkCountForPages(pages: readonly PaginaPorTrocear[]): number {
  return pages.reduce((sum, p) => sum + estimateChunkCountForLength(p.texto.trim().length), 0);
}
