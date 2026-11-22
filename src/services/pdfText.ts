/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pdfText.ts — texto de un PDF con topes duros (auditoría 2026-10-29).
 *
 * Contrato traído tal cual del móvil en E6 (paso 2). Allí el motor es
 * un módulo nativo (modules/nido-pdf-text) que deja de extraer en
 * cuanto el texto pasa de `maxChars`, también a mitad de una página
 * enorme, y rechaza un PDF con más de `maxPages` páginas antes de
 * leer nada. En PC el motor es pdfjs-dist empaquetado, detrás de
 * este mismo contrato desde el paso 3: vive en `pdfTextEngine.ts`
 * y se importa diferido; sin motor, la extracción falla con
 * UNAVAILABLE, como en una versión del móvil sin el módulo. La
 * extensión de la etapa (PaginaTexto y extractPdfPages, §4.1 del
 * documento de etapa) es aditiva sobre el contrato del móvil.
 */
export interface NidoPdfTextNative {
  extractText(uri: string, maxChars: number, maxPages: number): Promise<string>;
  extractPages?(uri: string, maxPages: number, maxChars?: number): Promise<PaginaTexto[]>;
}

/**
 * La unidad de extracción de la etapa (DOCUMENTOS-ETAPA §4.1):
 * una página con su texto y su origen. `pagina` es 1-based; el
 * origen 'ocr' lo ponen las páginas que entren por reconocimiento
 * en el paso 6. Para txt/md/csv/json hay una sola «página» sin
 * número, que no pasa por esta interfaz.
 */
export interface PaginaTexto {
  pagina: number;
  texto: string;
  origen: "texto" | "ocr";
}

/**
 * Caracteres útiles de un texto (DOCUMENTOS-ETAPA §3.3): letras
 * y dígitos; el resto (espacios, signos sueltos, marcas) no
 * cuenta como contenido.
 */
export function caracteresUtiles(texto: string): number {
  return (texto.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** El umbral de página escaneada de §3.3: menos de 16 caracteres útiles. */
export const UMBRAL_PAGINA_ESCANEADA = 16;

export function esPaginaEscaneada(p: PaginaTexto): boolean {
  return caracteresUtiles(p.texto) < UMBRAL_PAGINA_ESCANEADA;
}

export type PdfTextErrorCode =
  | "PASSWORD_REQUIRED"
  | "TOO_MANY_PAGES"
  | "TEXT_TOO_LARGE"
  | "PDF_LOAD_ERROR"
  | "PDF_EXTRACTION_ERROR"
  | "UNAVAILABLE";

export class PdfTextError extends Error {
  constructor(
    readonly code: PdfTextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfTextError";
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  "PASSWORD_REQUIRED",
  "TOO_MANY_PAGES",
  "TEXT_TOO_LARGE",
  "PDF_LOAD_ERROR",
  "PDF_EXTRACTION_ERROR",
]);

/** Traduce un error del motor a un código estable. */
export function toPdfTextError(e: unknown): PdfTextError {
  const code = (e as { code?: unknown })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return new PdfTextError(
    typeof code === "string" && KNOWN.has(code) ? (code as PdfTextErrorCode) : "PDF_EXTRACTION_ERROR",
    message,
  );
}

let native: NidoPdfTextNative | null | undefined;
/** Import diferido: el contrato se puede probar sin el motor. */
async function getNative(): Promise<NidoPdfTextNative | null> {
  if (native === undefined) {
    try {
      const mod = await import("./pdfTextEngine.js");
      native = mod.pdfTextEngine ?? null;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Tests: sustituye el motor. */
export function _setPdfTextNativeForTests(n: NidoPdfTextNative | null | undefined): void {
  native = n;
}

export async function extractPdfTextCapped(uri: string, maxChars: number, maxPages: number): Promise<string> {
  const n = await getNative();
  if (!n) throw new PdfTextError("UNAVAILABLE", "PDF reader not available in this build.");
  try {
    return await n.extractText(uri, Math.max(0, Math.floor(maxChars)), Math.max(1, Math.floor(maxPages)));
  } catch (e) {
    throw toPdfTextError(e);
  }
}

/**
 * Las páginas del PDF, una a una (la forma que el troceador con
 * ancla del paso 4 consume). Los mismos topes y el mismo mapa de
 * errores que extractPdfTextCapped.
 */
export async function extractPdfPages(
  uri: string,
  maxPages: number,
  maxChars?: number,
): Promise<PaginaTexto[]> {
  const n = await getNative();
  if (!n || typeof n.extractPages !== "function") {
    throw new PdfTextError("UNAVAILABLE", "PDF reader not available in this build.");
  }
  try {
    return await n.extractPages(
      uri,
      Math.max(1, Math.floor(maxPages)),
      maxChars === undefined ? undefined : Math.max(0, Math.floor(maxChars)),
    );
  } catch (e) {
    throw toPdfTextError(e);
  }
}
