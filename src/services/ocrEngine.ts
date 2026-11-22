/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * ocrEngine.ts — el motor de OCR de PC (E6, paso 6):
 * tesseract.js 7.0.0 fijado exacto con los datos 4.0.0 de
 * spa/eng/por de los paquetes @tesseract.js-data, ejecutado en
 * su worker, sin red: los datos se preparan UNA vez en una
 * carpeta local (los tres paquetes traen cada uno su idioma;
 * el motor necesita una sola carpeta con los tres) y el worker
 * lee solo de ahí (cacheMethod: none, langPath local).
 *
 * La decisión del lienzo (O-02) se cierra en este paso con su
 * criterio firmado: pintar una página de PDF a imagen se hace
 * con pdfjs sobre @napi-rs/canvas 1.1.1 (licencia MIT, sin
 * superficie de red), el píxel vive SOLO en memoria (lienzo →
 * PNG en un Buffer → worker) y nunca toca un fichero temporal
 * en claro. La alternativa (pintar en una ventana oculta del
 * renderizador) queda descartada con su motivo: acoplaría el
 * motor del proceso principal a una ventana viva y no corre
 * fuera de la app abierta; el lienzo en el principal corre
 * igual en la app y en las baterías.
 *
 * El dirimen HEIC/HEIF/AVIF en esta VM (firma 4): ningún
 * decodificador local de la cadena (leptonica de tesseract.js,
 * Skia de @napi-rs/canvas en Linux) lee esos formatos aquí, y
 * no hay muestra que lo pruebe en sentido contrario: salen
 * del catálogo de importación de la v1 con el error honesto
 * imageNoOcr (el importador los nombra sin intentarlo), y su
 * cierre formal es la pierna de Windows de E12 (W-11).
 * `heifDecodable` lleva el resultado del dirimen: false.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { NidoOcrNative } from "./ocr.js";
import { MAX_IMPORT_PDF_PAGES } from "./attachmentPolicy.js";
import { esPaginaEscaneada, type PaginaTexto } from "./pdfText.js";

/** El resultado del dirimen HEIC/HEIF/AVIF en esta máquina (ver la cabecera). */
export const heifDecodable = false;

type CodedError = Error & { code: string };
function coded(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code });
}

const TESSDATA_VERSION = "4.0.0";
const TESS_LANGS = ["spa", "eng", "por"] as const;

let ocrDataDir: string | null = null;
/** La carpeta de datos del motor, registrada por la carcasa (su directorio de datos de la app). */
export function setOcrDataDir(dir: string | null): void {
  ocrDataDir = dir;
}

let stagedDir: string | null = null;
/**
 * Prepara la carpeta única de datos: copia los traineddata de
 * los tres paquetes a una carpeta local si faltan o difieren
 * en tamaño. Son datos del motor (públicos, fijados por el
 * lockfile), no datos de la persona.
 */
function ensureTessdataDir(): string {
  if (stagedDir) return stagedDir;
  const base = ocrDataDir ?? join(tmpdir(), "nido-tessdata");
  const dir = join(base, TESSDATA_VERSION);
  mkdirSync(dir, { recursive: true });
  const require = createRequire(import.meta.url);
  for (const lang of TESS_LANGS) {
    const pkgDir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    const src = join(pkgDir, TESSDATA_VERSION, `${lang}.traineddata.gz`);
    const dest = join(dir, `${lang}.traineddata.gz`);
    if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) {
      copyFileSync(src, dest);
    }
  }
  stagedDir = dir;
  return dir;
}

interface TessWorker {
  recognize: (image: Buffer) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

const workers = new Map<string, Promise<TessWorker>>();
let workerChain: Promise<unknown> = Promise.resolve();

function getWorker(spec: string): Promise<TessWorker> {
  let w = workers.get(spec);
  if (!w) {
    w = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(spec, 1, {
        langPath: ensureTessdataDir(),
        cacheMethod: "none",
        logger: () => {},
      } as never);
      return worker as unknown as TessWorker;
    })();
    workers.set(spec, w);
  }
  return w;
}

/** Reconoce con el worker del spec, en serie: un worker hace un trabajo cada vez. */
async function recognizeWithSpec(spec: string, image: Buffer): Promise<string> {
  const run = async () => {
    const worker = await getWorker(spec);
    const { data } = await worker.recognize(image);
    return data.text;
  };
  const result = workerChain.then(run, run);
  workerChain = result.catch(() => {});
  return result;
}

/** Cierra los workers (las baterías y el apagado ordenado de la app). */
export async function terminateOcrEngine(): Promise<void> {
  const all = [...workers.values()];
  workers.clear();
  await Promise.allSettled(
    all.map(async (w) => {
      await (await w).terminate();
    }),
  );
}

async function recognize(uri: string, spec: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(uri);
  } catch (e) {
    throw coded("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
  try {
    return await recognizeWithSpec(spec, bytes);
  } catch (e) {
    throw coded("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// El pintado de páginas (pdfjs sobre @napi-rs/canvas)
// ---------------------------------------------------------------------------

interface PdfjsModule {
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
  OPS: Record<string, number>;
}
interface PdfDecodedImage {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: unknown;
}
interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}
interface PdfPage {
  getViewport: (params: { scale: number }) => {
    width: number;
    height: number;
    transform: number[];
  };
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get: (id: string) => PdfDecodedImage | undefined };
}

let pdfjsPromise: Promise<{ pdfjs: PdfjsModule; pkgDir: string }> | null = null;
function loadPdfjs(): Promise<{ pdfjs: PdfjsModule; pkgDir: string }> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // pdfjs busca DOMMatrix y Path2D en el global al pintar:
      // los pone el lienzo empaquetado antes de cargarlo.
      const canvas = await import("@napi-rs/canvas");
      const g = globalThis as Record<string, unknown>;
      g.DOMMatrix = canvas.DOMMatrix;
      g.Path2D = canvas.Path2D;
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

async function openPdf(uri: string): Promise<{ pdfjs: PdfjsModule; doc: PdfDoc; pkgDir: string }> {
  const { pdfjs, pkgDir } = await loadPdfjs();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(uri));
  } catch (e) {
    throw coded("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
  try {
    const doc = await pdfjs.getDocument({
      data: bytes,
      cMapUrl: join(pkgDir, "cmaps") + "/",
      cMapPacked: true,
      standardFontDataUrl: join(pkgDir, "standard_fonts") + "/",
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    return { pdfjs, doc, pkgDir };
  } catch (e) {
    const name = (e as { name?: unknown })?.name;
    if (name === "PasswordException") throw coded("PASSWORD_REQUIRED", "The PDF is password-protected.");
    throw coded("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
}

/** La escala de pintado: 3x con el lado mayor acotado a 4.000 px. */
function renderScale(viewport: { width: number; height: number }): number {
  const base = Math.max(viewport.width, viewport.height);
  return Math.min(3, 4000 / Math.max(1, base));
}

async function recognizePdfPageText(uri: string, pageIndex: number, spec: string): Promise<string> {
  const canvasPkg = await import("@napi-rs/canvas");
  const { pdfjs, doc } = await openPdf(uri);
  try {
    if (pageIndex < 0 || pageIndex >= doc.numPages) {
      throw coded("OCR_FAILED", `Page ${pageIndex + 1} is out of range.`);
    }
    const page = await doc.getPage(pageIndex + 1);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale(unit) });
    const canvas = canvasPkg.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await composePageImages(pdfjs, canvasPkg, page, ctx as never, viewport.transform);
    // El píxel va del lienzo al worker en memoria, nunca a un fichero.
    const png = canvas.toBuffer("image/png");
    return await recognizeWithSpec(spec, png);
  } finally {
    await doc.destroy().catch(() => {});
  }
}

/**
 * Compone la página escaneada desde sus imágenes decodificadas
 * en vez de page.render: el pintado general de pdfjs desploma
 * el proceso en esta cadena con cualquier página que incruste
 * una imagen (medido en el paso: Node y vitest, JPEG y Flate
 * por igual; el texto solo pinta bien). La página escaneada ES
 * su imagen: la lista de operadores trae cada imagen ya
 * decodificada (datos RGB/RGBA/gris) y su transformación; se
 * vuelca cada una en su sitio sobre el lienzo. Las operaciones
 * de texto o vector no se componen: por §3.3 la capa de una
 * página escaneada no aporta texto útil y lo que el OCR lee
 * es la imagen.
 */
async function composePageImages(
  pdfjs: PdfjsModule,
  canvasPkg: typeof import("@napi-rs/canvas"),
  page: PdfPage,
  ctx: {
    save: () => void;
    restore: () => void;
    setTransform: (m: unknown) => void;
    drawImage: (img: unknown, ...rest: number[]) => void;
  },
  viewportTransform: number[],
): Promise<void> {
  const ops = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  let ctm = new canvasPkg.DOMMatrix(viewportTransform);
  const stack: InstanceType<typeof canvasPkg.DOMMatrix>[] = [];
  // El espacio de imagen de PDF crece hacia arriba: pintar en
  // el cuadrado unidad exige el volteo [1 0 0 -1 0 1] que el
  // pintor de pdfjs aplica a cada imagen; sin él la página
  // sale del revés y el OCR lee basura (medido en el paso).
  const imageFlip = new canvasPkg.DOMMatrix([1, 0, 0, -1, 0, 1]);
  const paintImage = (img: PdfDecodedImage): void => {
    const temp = imageToCanvas(canvasPkg, img);
    if (!temp) return;
    ctx.save();
    ctx.setTransform(ctm.multiply(imageFlip));
    ctx.drawImage(temp, 0, 0, 1, 1);
    ctx.restore();
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = ctm.multiply(new canvasPkg.DOMMatrix(args as number[]));
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
      const img = page.objs.get(args[0] as string);
      if (img) paintImage(img);
    } else if (fn === OPS.paintInlineImageXObject) {
      const img = args[0] as PdfDecodedImage | undefined;
      if (img) paintImage(img);
    }
  }
}

/** Los datos decodificados de pdfjs a un lienzo: kind 1 =
 * gris de 1 bit empaquetado, 2 = RGB, 3 = RGBA (sus
 * ImageKind). */
function imageToCanvas(
  canvasPkg: typeof import("@napi-rs/canvas"),
  img: PdfDecodedImage,
): ReturnType<typeof import("@napi-rs/canvas").createCanvas> | null {
  const { width, height } = img;
  if (!width || !height) return null;
  const canvas = canvasPkg.createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (img.bitmap) {
    (ctx as unknown as { drawImage: (i: unknown, x: number, y: number) => void }).drawImage(img.bitmap, 0, 0);
    return canvas as unknown as ReturnType<typeof import("@napi-rs/canvas").createCanvas>;
  }
  const data = img.data;
  if (!data) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (img.kind === 3) {
    rgba.set(data.subarray(0, rgba.length));
  } else if (img.kind === 1) {
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const o = (y * width + x) * 4;
        rgba[o] = v;
        rgba[o + 1] = v;
        rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
    }
  } else {
    for (let px = 0, total = width * height; px < total; px++) {
      rgba[px * 4] = data[px * 3] ?? 0;
      rgba[px * 4 + 1] = data[px * 3 + 1] ?? 0;
      rgba[px * 4 + 2] = data[px * 3 + 2] ?? 0;
      rgba[px * 4 + 3] = 255;
    }
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return canvas as unknown as ReturnType<typeof import("@napi-rs/canvas").createCanvas>;
}

async function findScannedPdfPages(uri: string): Promise<number[]> {
  // La detección es la de §3.3 sobre la extracción del motor de
  // texto: página con menos de 16 caracteres útiles.
  const { pdfTextEngine } = await import("./pdfTextEngine.js");
  if (!pdfTextEngine.extractPages) throw coded("OCR_FAILED", "PDF reader not available.");
  let pages: PaginaTexto[];
  try {
    pages = await pdfTextEngine.extractPages(uri, MAX_IMPORT_PDF_PAGES);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    if (code === "PASSWORD_REQUIRED") throw coded("PASSWORD_REQUIRED", "The PDF is password-protected.");
    throw coded("OCR_FAILED", e instanceof Error ? e.message : String(e));
  }
  return pages.filter((p) => esPaginaEscaneada(p)).map((p) => p.pagina - 1);
}

async function recognizePdfPages(
  uri: string,
  pages: number[],
  spec: string,
): Promise<string> {
  const wanted = pages.length > 0 ? pages : await findScannedPdfPages(uri);
  const parts: string[] = [];
  for (const idx of wanted) {
    parts.push(await recognizePdfPageText(uri, idx, spec));
  }
  return parts.join("\n\n");
}

export const ocrEngine: NidoOcrNative = {
  recognize,
  recognizePdfPages,
  findScannedPdfPages,
  recognizePdfPageText,
  heifDecodable,
};
