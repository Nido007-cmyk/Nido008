/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * libraryDocs.ts — las filas de documentos personales de la
 * Biblioteca (E6, paso 8).
 *
 * Cada fila se compone del registro y de la medida, nunca de
 * una estimación: el tamaño es la medida real de M-32
 * (measureCollectionStoredBytes, la que el importador
 * guarda tras importar), los documentos son los del
 * registro de la colección (sus nombres de fichero, no los
 * títulos de los trozos) y el estado de reindexado pendiente
 * sale de contar vectores (countCollectionVectors): cuántos
 * trozos esperan vector del modelo activo. El total es la
 * suma de las medidas, para que la expulsión y el borrado
 * se vean en la cifra que la Biblioteca enseña (D-7, D-14).
 */
import {
  countCollectionVectors,
  listCollectionDocFiles,
  listCustomCollections,
  measureCollectionStoredBytes,
} from "../rag/db.js";
import { DEFAULT_DOC_STORAGE_BUDGET_BYTES } from "../rag/docStorageBudget.js";
import { listImportWarnings, type ImportWarning } from "./documentImporter.js";

export interface LibraryCollectionRow {
  id: string;
  name: string;
  /** Los documentos del registro, por nombre de fichero. */
  docs: string[];
  docCount: number;
  chunkCount: number;
  /** La medida real en bytes (M-32), nunca la estimación. */
  sizeBytes: number;
  /** Las páginas del documento paginado único, si lo hay. */
  pageCount: number | null;
  active: boolean;
  /** Trozos sin vector del modelo activo: el reindexado pendiente. */
  pendingVectors: number;
  /**
   * Los avisos persistidos de su importación (B-2 del clúster
   * de Biblioteca): los ficheros que no aportaron texto, con
   * su razón, compuestos desde el registro del importador.
   * Vacío cuando la importación entró entera.
   */
  warnings: ImportWarning[];
  createdAt: number;
  lastAccessed: number;
}

export interface LibraryDocsData {
  rows: LibraryCollectionRow[];
  /** La suma de las medidas reales: el uso del presupuesto. */
  totalBytes: number;
  budgetBytes: number;
}

export async function listLibraryCollections(): Promise<LibraryDocsData> {
  const collections = await listCustomCollections();
  // B-2: los avisos persistidos se componen una sola vez,
  // con los ids de las filas, y cada fila lleva los suyos.
  const warningsById = await listImportWarnings(collections.map((c) => c.id));
  const rows: LibraryCollectionRow[] = [];
  for (const c of collections) {
    const [docs, measured, vectors] = await Promise.all([
      listCollectionDocFiles(c.id),
      measureCollectionStoredBytes(c.id).catch(() => -1),
      countCollectionVectors(c.id).catch(() => null),
    ]);
    rows.push({
      id: c.id,
      name: c.name,
      docs,
      docCount: c.docCount,
      chunkCount: c.chunkCount,
      // La medida manda; si medir fallara, la guardada tras la
      // importación es la misma medida de M-32, no una
      // estimación distinta.
      sizeBytes: measured >= 0 ? measured : c.sizeBytes,
      pageCount: c.pageCount,
      active: c.active,
      pendingVectors: vectors ? vectors.pending : 0,
      warnings: warningsById[c.id] ?? [],
      createdAt: c.createdAt,
      lastAccessed: c.lastAccessed,
    });
  }
  return {
    rows,
    totalBytes: rows.reduce((sum, r) => sum + r.sizeBytes, 0),
    budgetBytes: DEFAULT_DOC_STORAGE_BUDGET_BYTES,
  };
}
