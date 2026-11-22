/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ocr.ts — la costura del reconocimiento de texto (OCR) en el
 * aparato (programa «Lo mejor de la bounty», tanda 6; pieza 05 de
 * la colección: Field Atlas, Apache-2.0; diseño completo en
 * docs/OCR_DESIGN.md).
 *
 * Contrato traído tal cual del móvil en E6 (paso 2). Allí el motor
 * (Tesseract vía tesseract4android) vive en un módulo nativo
 * propio; en PC el motor es tesseract.js empaquetado con los datos
 * spa/eng/por y nace en el paso 6 de la etapa, detrás de este mismo
 * contrato: vive en `ocrEngine.ts` y se importa diferido. Mientras
 * su sede esté vacía, `isOcrAvailable()` dice que no y las
 * funciones de reconocimiento lanzan OcrError("UNAVAILABLE") — el
 * importador convierte eso en el mensaje honesto de «PDF escaneado
 * sin OCR en esta versión», en vez de importar un documento vacío
 * en silencio.
 *
 * Idiomas: los de la casa (es/en/pt) con los códigos de tessdata
 * (spa/eng/por) que el motor recibe.
 */

import { MAX_OCR_PAGES } from "./attachmentPolicy.js";
import type { PaginaTexto } from "./pdfText.js";

export type OcrLang = "es" | "en" | "pt";

/** Código de datos de idioma (tessdata) por idioma de la app. */
export const TESSDATA_LANG: Record<OcrLang, string> = { es: "spa", en: "eng", pt: "por" };

/**
 * Lo que recibe el motor: los tres datos de la casa, el del idioma de
 * la app primero (0.1.75). Antes solo iba el del idioma de la app, y
 * un documento en otra de las tres lenguas se leía con el diccionario
 * equivocado (acentos y palabras perdidas). Tesseract usa el primero
 * como principal y prueba los otros en las palabras dudosas.
 */
export function tessdataSpec(lang: OcrLang): string {
  const order: OcrLang[] = [lang, ...(["es", "en", "pt"] as OcrLang[]).filter((l) => l !== lang)];
  return order.map((l) => TESSDATA_LANG[l]).join("+");
}

/**
 * La marca de procedencia que viaja DENTRO del texto reconocido
 * cuando entra en la base de conocimiento (como avisa Field
 * Atlas: el OCR puede equivocarse). Texto fijo trilingüe, como el
 * texto seguro de la puerta de salud (routing/emergencyGate.ts).
 */
export const OCR_PROVENANCE_NOTE: Record<OcrLang, string> = {
  es: "Texto reconocido con OCR en este aparato: puede contener errores; verifícalo antes de fiarte.",
  en: "Text recognized with OCR on this device: it can contain mistakes; check it before relying on it.",
  pt: "Texto reconhecido com OCR neste aparelho: pode conter erros; verifique-o antes de confiar.",
};

export interface NidoOcrNative {
  recognize(uri: string, tessdataLang: string): Promise<string>;
  recognizePdfPages?: (uri: string, pages: number[], tessdataLang: string) => Promise<string>;
  /** Índices 0-based de las páginas escaneadas (capa de texto vacía), con el tope del nativo. */
  findScannedPdfPages?: (uri: string) => Promise<number[]>;
  /**
   * E6 (paso 6): el texto reconocido de UNA página de un PDF
   * (índice 0-based), para que cada página reconocida entre con
   * su número. Los nativos sin esta forma caen a
   * recognizePdfPages con su texto unido en la primera página.
   */
  recognizePdfPageText?: (uri: string, page: number, tessdataLang: string) => Promise<string>;
  /** E6 (paso 6): ¿decodifica este motor los formatos HEIC/HEIF/AVIF en esta plataforma? */
  heifDecodable?: boolean;
}

export type OcrErrorCode = "UNAVAILABLE" | "OCR_FAILED" | "OCR_UNAVAILABLE" | "PASSWORD_REQUIRED";

/** Auditoría completa, F-4: el código del nativo se conserva (antes todo salía como OCR_FAILED, también el fallo de integridad de los datos). */
const NATIVE_CODES: ReadonlySet<string> = new Set(["OCR_UNAVAILABLE", "PASSWORD_REQUIRED", "OCR_FAILED"]);
function fromNative(e: unknown): OcrError {
  const code = (e as { code?: unknown })?.code;
  return new OcrError(
    typeof code === "string" && NATIVE_CODES.has(code) ? (code as OcrErrorCode) : "OCR_FAILED",
    e instanceof Error ? e.message : String(e),
  );
}

export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

let native: NidoOcrNative | null | undefined;
/** Import diferido, como en pdfText.ts: la costura se prueba sin el motor. */
async function getNative(): Promise<NidoOcrNative | null> {
  if (native === undefined) {
    try {
      const mod = await import("./ocrEngine.js");
      native = mod.ocrEngine ?? null;
    } catch {
      native = null;
    }
  }
  return native;
}

/** Tests: sustituye el motor. */
export function _setOcrNativeForTests(n: NidoOcrNative | null | undefined): void {
  native = n;
}

/** ¿Trae esta versión de la app el módulo de OCR? */
export async function isOcrAvailable(): Promise<boolean> {
  return (await getNative()) !== null;
}

/**
 * Reconoce el texto impreso de una imagen (foto o página
 * escaneada) en el idioma dado. Lanza OcrError("UNAVAILABLE") si
 * la versión no trae el módulo (docs/OCR_DESIGN.md).
 */
export async function recognizeImageText(uri: string, lang: OcrLang): Promise<string> {
  const n = await getNative();
  if (!n) throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
  try {
    return await n.recognize(uri, tessdataSpec(lang));
  } catch (e) {
    throw fromNative(e);
  }
}

/** Sanea la lista de páginas para el módulo: índices 0-based, sin duplicados, en orden, con el tope de la política. */
export function sanitizeOcrPages(pages: number[]): number[] {
  const clean = [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 0))].sort((a, b) => a - b);
  return clean.slice(0, MAX_OCR_PAGES);
}

/**
 * Reconoce el texto de las páginas escaneadas de un PDF. Con
 * `pages` vacío, el módulo encuentra él mismo las páginas cuya
 * capa de texto está vacía o casi (la costura no puede enumerarlas:
 * nido-pdf-text devuelve el texto entero del documento) y devuelve
 * solo el texto reconocido de esas páginas, con el tope
 * MAX_OCR_PAGES. Lanza OcrError("UNAVAILABLE") si la versión no
 * trae el módulo o le falta esta entrada.
 */
export async function recognizePdfPagesText(uri: string, pages: number[], lang: OcrLang): Promise<string> {
  const n = await getNative();
  if (!n || typeof n.recognizePdfPages !== "function") {
    throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
  }
  try {
    return await n.recognizePdfPages(uri, sanitizeOcrPages(pages), tessdataSpec(lang));
  } catch (e) {
    throw fromNative(e);
  }
}

/**
 * Atajo del importador: el texto reconocido de las páginas escaneadas
 * de un PDF. Devuelve `null` cuando el PDF NO tiene páginas escaneadas
 * (no hay nada que reconocer), y una cadena —vacía si el motor no leyó
 * nada— cuando sí las tiene. Auditoría completa, F-1: antes las dos
 * situaciones volvían como «», y todo PDF de solo texto recibía el
 * aviso «el reconocimiento no encontró texto en sus páginas
 * escaneadas». Con un nativo anterior sin `findScannedPdfPages`, se
 * conserva la vía antigua.
 */
export async function recognizeScannedPdfText(uri: string, lang: OcrLang): Promise<string | null> {
  const n = await getNative();
  if (n && typeof n.findScannedPdfPages === "function" && typeof n.recognizePdfPages === "function") {
    let pages: number[];
    try {
      pages = sanitizeOcrPages(await n.findScannedPdfPages(uri));
    } catch (e) {
      throw fromNative(e);
    }
    if (pages.length === 0) return null;
    return recognizePdfPagesText(uri, pages, lang);
  }
  return recognizePdfPagesText(uri, [], lang);
}

/**
 * E6 (paso 6): las páginas escaneadas de un PDF reconocidas una
 * a una, cada una con su número y su origen 'ocr', para que
 * entren en el documento con su página real (la forma que el
 * troceador con ancla consume). Devuelve `null` cuando el PDF
 * no tiene páginas escaneadas — la misma distinción F-1 de
 * recognizeScannedPdfText — y páginas con el texto vacío
 * cuando las hay y el motor no leyó nada. Con un nativo sin la
 * forma por página, el texto unido va a la primera página
 * escaneada, como entraba antes de esta forma.
 */
export async function recognizeScannedPdfPages(
  uri: string,
  lang: OcrLang,
): Promise<PaginaTexto[] | null> {
  const n = await getNative();
  if (!n || typeof n.findScannedPdfPages !== "function") {
    throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
  }
  let indices: number[];
  try {
    indices = sanitizeOcrPages(await n.findScannedPdfPages(uri));
  } catch (e) {
    throw fromNative(e);
  }
  if (indices.length === 0) return null;
  const spec = tessdataSpec(lang);
  const pages: PaginaTexto[] = [];
  for (const [k, idx] of indices.entries()) {
    let texto: string;
    try {
      if (typeof n.recognizePdfPageText === "function") {
        texto = await n.recognizePdfPageText(uri, idx, spec);
      } else if (k === 0 && typeof n.recognizePdfPages === "function") {
        texto = await n.recognizePdfPages(uri, indices, spec);
      } else if (typeof n.recognizePdfPages !== "function") {
        throw new OcrError("UNAVAILABLE", "Text recognition (OCR) is not available in this build.");
      } else {
        texto = "";
      }
    } catch (e) {
      throw fromNative(e);
    }
    pages.push({ pagina: idx + 1, texto, origen: "ocr" });
  }
  return pages;
}

/**
 * E6 (paso 6, firma 4): ¿puede el motor de esta plataforma
 * decodificar HEIC/HEIF/AVIF? Sin motor, o sin su declaración,
 * la respuesta es no: el importador los nombra imageNoOcr en
 * vez de intentarlo y fallar en silencio.
 */
export async function ocrSupportsHeif(): Promise<boolean> {
  const n = await getNative();
  return n?.heifDecodable === true;
}
