/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * sourcePanel.ts — los datos de una fuente para su exhibición
 * (E6, paso 7; contrato de etapa §7.1 y §7.3, Tiempo 1).
 *
 * Compone la etiqueta de la fuente desde su metadato y, para
 * un fragmento de documento personal con página, sirve desde
 * la base cifrada el texto de ESA página (los trozos del
 * documento en esa página, cosidos por su solape) y su
 * cabecera («pág. 7 de 128»). El total sale del registro:
 * el page_count de la colección cuando su único documento
 * paginado es este; si no, el máximo de página entre los
 * trozos del propio documento — nunca un número inventado.
 * Nada de esto abre el fichero original ni revela su ruta:
 * lo que la persona ve sale de su memoria cifrada.
 */
import { listCollectionChunks, listCustomCollections } from "../rag/db.js";
import {
  cleanDocTitle,
  sourceLabel,
  sourcePageHeader,
  type SourceLabelLang,
} from "../rag/sourceLabel.js";
import type { RetrievedChunk } from "../rag/retrieve.types.js";
import { reconstructDocBody } from "./documentImporter.js";

export interface SourcePanelData {
  /** La etiqueta visible de la fuente («Contrato · pág. 7»). */
  label: string;
  /** La cabecera de página del panel, o null sin página. */
  pageHeader: string | null;
  /**
   * El texto de la página citada servido desde la base, o
   * null cuando la fuente no es de un documento personal
   * paginado (el panel enseña entonces el cuerpo del
   * fragmento, como antes de la etapa).
   */
  pageText: string | null;
  /** La página y su total, los datos tras la cabecera. */
  page: number | null;
  pageTotal: number | null;
}

export async function sourcePanelData(
  chunk: Pick<RetrievedChunk, "title" | "page" | "docId" | "collectionId">,
  lang: SourceLabelLang,
): Promise<SourcePanelData> {
  const page = chunk.page ?? null;
  // La etiqueta de un documento personal lleva su título del
  // registro, sin el sufijo de pieza del título guardado.
  const title = chunk.collectionId ? cleanDocTitle(chunk.title) : chunk.title;
  const label = sourceLabel(title, page, lang);
  if (page == null || !chunk.collectionId) {
    return { label, pageHeader: null, pageText: null, page, pageTotal: null };
  }
  const rows = await listCollectionChunks(chunk.collectionId);
  const docRows = rows.filter((r) => r.doc_id === chunk.docId);
  const pageRows = docRows.filter((r) => r.page === page);
  const pageText = pageRows.length > 0 ? reconstructDocBody(pageRows.map((r) => r.body)) : null;

  // El total del documento: el page_count guardado en la
  // importación manda cuando la colección tiene un único
  // documento paginado y es este; en cualquier otro caso, el
  // máximo de página entre los trozos del documento.
  const paginatedDocIds = new Set(
    rows.filter((r) => r.page != null).map((r) => r.doc_id),
  );
  let pageTotal: number | null = null;
  if (paginatedDocIds.size === 1 && paginatedDocIds.has(chunk.docId)) {
    const collection = (await listCustomCollections()).find((c) => c.id === chunk.collectionId);
    pageTotal = collection?.pageCount ?? null;
  }
  if (pageTotal == null) {
    const own = docRows.reduce((max, r) => (r.page != null && r.page > max ? r.page : max), 0);
    pageTotal = own > 0 ? own : null;
  }
  return {
    label,
    pageHeader: sourcePageHeader(page, pageTotal, lang),
    pageText,
    page,
    pageTotal,
  };
}
