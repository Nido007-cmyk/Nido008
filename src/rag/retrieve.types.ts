/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Asiento de PC (E3, tanda 2 · J-1): en el móvil, `ChunkRecord` vive
 * en `src/rag/db.ts` (el almacén) y este fichero lo importa. En PC el
 * tipo viaja sin el almacén: el almacén cifrado es el de E2
 * (`src/security/`) y su forma es otra. La interfaz se declara aquí
 * verbatim desde `db.ts` del 0.1.108; cuando J-3 (tanda 4) recree la
 * recuperación, el mapeo al almacén de PC se asienta allí.
 */
export interface ChunkRecord {
  chunkId: string;
  docId: string;
  title: string;
  body: string;
  source?: string;
  /** Set for chunks from a user-imported collection; omitted for the bundled/downloaded corpus. */
  collectionId?: string;
  /**
   * E6 (paso 4): la página del documento de la que salió el
   * fragmento (1-based), o null cuando el documento no pagina
   * (txt/md/csv/json y el corpus). La cita la lee de aquí, nunca
   * del texto de la respuesta.
   */
  page?: number | null;
  /** E6 (paso 4): el origen del fragmento: texto extraído u OCR. */
  origen?: "texto" | "ocr";
}

/**
 * Which corpus a chunk came from. R-03 (physical round 0.1.68): until now
 * RetrievedChunk carried no provenance — the SQL mappings knew
 * (collection_id, pack file) and discarded it — so the fusion ranker
 * could not prefer the user's own document even in principle. "user" =
 * imported into a personal collection, "builtin" = the bundled/downloaded
 * base corpus, "pack" = a knowledge pack.
 */
export type ChunkSourceKind = "user" | "builtin" | "pack";

export interface RetrievedChunk extends ChunkRecord {
  score: number;
  /**
   * Corpus of origin, filled by every retrieval mapping (retrieve.ts,
   * packs.ts). Optional only so older fixtures keep compiling; a chunk
   * without it is treated as non-user by the fusion's personal-corpus
   * reserve (see fuseRetrievalResults in pure.ts).
   */
  sourceKind?: ChunkSourceKind;
  /**
   * CL-12: cobertura de términos de la pata léxica (términos de la
   * pregunta presentes en el chunk / total de términos), estampada
   * por las búsquedas léxicas. Es la medida absoluta del chunk solo
   * léxico ante la puerta post-fusión de fuseRetrievalResults.
   */
  termCoverage?: number;
  /**
   * Absolute pre-fusion score where one exists on a bounded scale: the raw
   * cosine similarity for semantic (and hybrid) chunks. Left undefined for
   * lexical-only chunks — BM25 is unbounded, so no honest percentage exists
   * for them. `score` remains the fused RELATIVE rank used for sorting; the
   * UI renders rawScore, never score, so a lone weak match can no longer
   * display a weight-scheme-constant "50%".
   */
  rawScore?: number;
  matchType: "lexical" | "semantic" | "hybrid";
  /**
   * 0.1.87: the v2 pack format's indexed real questions for this
   * section (chunks.keys). The pack search reads them for its
   * coverage gate; the guide pick's lexical path (piece 4) needs
   * them on the chunk itself — a mapped chunk that drops them
   * silently narrows that path to title+body.
   */
  keys?: string;
  /**
   * Adversaria H-07: este fragmento es un RESTO — fitChunksToBudget lo
   * truncó por frases para que el prompt cupiera en la ventana. Sin la
   * marca, el resto viajaba como si fuera la fuente entera: la pantalla
   * lo enseñaba completo (enseñaba otro objeto, en realidad) y el
   * verificador juzgaba contra el cuerpo entero que el modelo nunca
   * vio. Solo lo pone fitChunksToBudget, sobre la copia que devuelve;
   * el fragmento de la recuperación nunca lleva esta marca.
   */
  truncated?: boolean;
}
