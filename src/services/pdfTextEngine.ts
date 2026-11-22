/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pdfTextEngine.ts — el motor de extracción de PDF de PC
 * (E6, paso 3): pdfjs-dist 4.10.38 fijado exacto, empaquetado
 * con su worker y sus recursos (cmaps y fuentes estándar) como
 * ficheros locales del paquete. Nada sale a la red: el documento
 * se pasa entero en memoria, la evaluación de scripts del PDF
 * está apagada (isEvalSupported: false) y los recursos se
 * resuelven contra el directorio del paquete instalado, nunca
 * contra una URL.
 *
 * Cumple el contrato de `pdfText.ts` (la forma del nativo del
 * móvil): la extracción se para en cuanto el texto pasa de
 * maxChars, también a mitad de página (TEXT_TOO_LARGE); un PDF
 * con más de maxPages páginas se rechaza desde los metadatos,
 * antes de extraer nada (TOO_MANY_PAGES); la contraseña se
 * nombra (PASSWORD_REQUIRED); lo ilegible es PDF_LOAD_ERROR o
 * PDF_EXTRACTION_ERROR según la fase. Y entrega las páginas
 * (PaginaTexto) para el troceador con ancla del paso 4.
 *
 * Los errores salen como Error con `code`: el contrato los
 * traduce con toPdfTextError, como traduce los del nativo.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NidoPdfTextNative, PaginaTexto } from "./pdfText.js";

type CodedError = Error & { code: string };
function coded(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code });
}

interface PdfjsModule {
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
}
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}
interface PdfPage {
  getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
}

let pdfjsPromise: Promise<{ pdfjs: PdfjsModule; pkgDir: string }> | null = null;
function loadPdfjs(): Promise<{ pdfjs: PdfjsModule; pkgDir: string }> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
      const require = createRequire(import.meta.url);
      const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
        join(pkgDir, "legacy", "build", "pdf.worker.mjs"),
      ).href;
      return { pdfjs, pkgDir };
    })();
  }
  return pdfjsPromise;
}

async function openDocument(uri: string): Promise<{ doc: PdfDoc; pkgDir: string }> {
  const { pdfjs, pkgDir } = await loadPdfjs();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(uri));
  } catch (e) {
    throw coded("PDF_LOAD_ERROR", e instanceof Error ? e.message : String(e));
  }
  try {
    const doc = await pdfjs.getDocument({
      data: bytes,
      // Rutas del sistema de ficheros, NO URLs file://: el
      // worker de pdfjs en Node lee los recursos por fs, y un
      // fetch a file:// falla en silencio — con URLs, los
      // CMaps nombrados no resuelven (un PDF CJK extraía vacío)
      // y las fuentes estándar no cargan (ninguna página se
      // pinta). Corregido en el paso 6 (H-E6-2) al traer el
      // pintado; la extracción hereda la cura.
      cMapUrl: join(pkgDir, "cmaps") + "/",
      cMapPacked: true,
      standardFontDataUrl: join(pkgDir, "standard_fonts") + "/",
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    return { doc, pkgDir };
  } catch (e) {
    const name = (e as { name?: unknown })?.name;
    if (name === "PasswordException") {
      throw coded("PASSWORD_REQUIRED", "The PDF is password-protected.");
    }
    throw coded("PDF_LOAD_ERROR", e instanceof Error ? e.message : String(e));
  }
}

function checkPages(doc: PdfDoc, maxPages: number): void {
  if (doc.numPages > maxPages) {
    throw coded("TOO_MANY_PAGES", `The PDF has ${doc.numPages} pages (max ${maxPages}).`);
  }
}

/** El texto de una página: los ítems en orden, con salto de línea donde el propio PDF lo marca. */
async function pageText(page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    out += item.hasEOL ? "\n" : " ";
  }
  return out.trim();
}

async function extractText(uri: string, maxChars: number, maxPages: number): Promise<string> {
  const { doc } = await openDocument(uri);
  try {
    checkPages(doc, maxPages);
    const parts: string[] = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      let text: string;
      try {
        text = await pageText(await doc.getPage(n));
      } catch (e) {
        throw coded("PDF_EXTRACTION_ERROR", e instanceof Error ? e.message : String(e));
      }
      if (text.length > 0) {
        parts.push(text);
        total += text.length;
        if (total > maxChars) {
          throw coded("TEXT_TOO_LARGE", `PDF text exceeds ${maxChars} characters.`);
        }
      }
    }
    return parts.join("\n\n");
  } finally {
    await doc.destroy().catch(() => {});
  }
}

async function extractPages(
  uri: string,
  maxPages: number,
  maxChars?: number,
): Promise<PaginaTexto[]> {
  const { doc } = await openDocument(uri);
  try {
    checkPages(doc, maxPages);
    const pages: PaginaTexto[] = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      let text: string;
      try {
        text = await pageText(await doc.getPage(n));
      } catch (e) {
        throw coded("PDF_EXTRACTION_ERROR", e instanceof Error ? e.message : String(e));
      }
      pages.push({ pagina: n, texto: text, origen: "texto" });
      total += text.length;
      // El mismo tope dentro del extractor que en extractText:
      // la bomba de descompresión se para a mitad de documento,
      // no tras tenerlo entero en memoria.
      if (maxChars !== undefined && total > maxChars) {
        throw coded("TEXT_TOO_LARGE", `PDF text exceeds ${maxChars} characters.`);
      }
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => {});
  }
}

export const pdfTextEngine: NidoPdfTextNative = { extractText, extractPages };
