/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { createReadStream } from "node:fs";
import { open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extractPdfPages, PdfTextError, type PaginaTexto } from "./pdfText.js";
import {
  CHUNK_CHARS,
  OVERLAP_CHARS,
  chunkPages,
  chunkText,
  estimateChunkCountForPages,
} from "./pageChunker.js";
import { isOcrAvailable, ocrSupportsHeif, recognizeImageText, recognizeScannedPdfPages, OCR_PROVENANCE_NOTE, OcrError, OcrLang } from "./ocr.js";
import { attachmentKind, heifBrandOf, KIND_SAMPLE_BYTES, MAX_IMPORT_PDF_PAGES, type UnsupportedReason } from "./attachmentPolicy.js";
import { embeddingEngine } from "../rag/embed.js";
import {
  getDbEpoch,
  insertChunk,
  insertChunkWithoutEmbedding,
  createCustomCollection,
  measureCollectionStoredBytes,
  setCustomCollectionSizeBytes,
  deleteCustomCollection,
  deleteOrphanCollectionChunks,
  setCustomCollectionActive,
  listCustomCollections,
  getCollectionDocs,
  getMetaValue,
  setMetaValue,
  listAllCollectionDocFingerprints,
  listCollectionChunks,
  recordCollectionDocFingerprints,
  recordImportWarnings,
  listImportWarnings as listImportWarningsInDb,
  dismissImportWarnings as dismissImportWarningsInDb,
  CustomCollection,
  AllDocFingerprintRow,
  DocFingerprintRow,
  StoredImportWarning,
} from "../rag/db.js";
import { enforceStorageBudget, DEFAULT_DOC_STORAGE_BUDGET_BYTES } from "../rag/docStorageBudget.js";
import { sha256Hex } from "../models/sha256.js";

/**
 * Las tres costuras de plataforma de este porte (E6, paso 2; el
 * mapa de porte las nombra): donde el móvil importa DocumentPicker,
 * FileSystem y Sharing de Expo, PC lee por la sede (el proceso
 * principal, con el tope aplicado durante la lectura) y recibe el
 * selector y la exportación de la carcasa por registro.
 *
 * Un fichero ya elegido: en PC la ruta nace en el renderizador
 * (webUtils, DISENO-PC §6) y viaja por su canal hasta la carcasa,
 * que llama a `importDocuments` con estos descriptores; `uri` es
 * la ruta local del fichero y el original nunca se copia.
 */
export interface PickedDocumentFile {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string;
}

/** El selector del sistema, registrado por la carcasa (null = sin selección). */
export type DocumentPickerFn = () => Promise<PickedDocumentFile[] | null>;
let documentPicker: DocumentPickerFn | null = null;
export function setDocumentPicker(fn: DocumentPickerFn | null): void {
  documentPicker = fn;
}

/** La salida de una exportación (guardar como / compartir del sistema), registrada por la carcasa. */
export type CollectionShareFn = (path: string, collection: CustomCollection) => Promise<void>;
let collectionShare: CollectionShareFn | null = null;
export function setCollectionShareHandler(fn: CollectionShareFn | null): void {
  collectionShare = fn;
}

/** El directorio de caché de exportaciones, registrado por la carcasa. */
export type ImportCacheDirProvider = () => string | null;
let importCacheDir: ImportCacheDirProvider | null = null;
export function setImportCacheDirProvider(fn: ImportCacheDirProvider | null): void {
  importCacheDir = fn;
}

/**
 * User-supplied document import for the local knowledge base (Settings >
 * Knowledge Base > Import Documents). Formats:
 *
 * - .txt / .md: read as plain text.
 * - .csv: naive comma-split per line (no quoted-field escaping) - fine for
 *   simple exports, not a full CSV parser.
 * - .json: if it matches the same {title, source, body}[] shape used by the
 *   app's own downloadable corpus packs (assets/corpus/*.json), each entry
 *   is imported as its own doc; otherwise the whole file is chunked as text.
 * - .pdf: embedded/selectable text via the pdfText contract (in PC,
 *   pdfjs-dist packaged locally, no network). Scanned pages (the
 *   whole PDF, or loose pages inside a mixed one) go through OCR
 *   via src/services/ocr.ts (design in docs/OCR_DESIGN.md) and
 *   enter as their own doc, marked with its OCR provenance. In a
 *   build without the engine, an all-scanned import says so
 *   (error code scannedNoOcr) instead of a generic "no text".
 * - images (jpg/png/webp/gif/bmp/heic/heif/avif, by extension or by
 *   their own bytes via attachmentPolicy): printed text read with
 *   the same on-device OCR, provenance marked the same way.
 *   Password-protected PDFs are rejected with a clear error rather
 *   than attempted.
 */


export const SUPPORTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/avif",
];

/** Extensiones que el selector puede dar a una imagen (el despacho final lo deciden los bytes, attachmentPolicy). */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"]);
/** Extensiones de texto ya despachadas por su rama: no hace falta clasificarlas por magia. */
const TEXT_DISPATCH_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "html", "htm", "xml", "log"]);

/**
 * Offensive audit (0.1.18): limits. A 300 MB log picked by mistake was read
 * whole into a JS string (the app could be killed for memory) and then
 * embedded chunk by chunk for hours. 25 MB of text is ~12,000 pages; PDFs are
 * measured by the text they give (MAX_IMPORT_CHUNKS).
 */
export const MAX_IMPORT_TEXT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_PDF_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_CHUNKS = 4000;
/** El tope de páginas vive en attachmentPolicy (E6, paso 6) y se re-exporta aquí, que es donde las baterías lo han leído siempre. */
export { MAX_IMPORT_PDF_PAGES } from "./attachmentPolicy.js";

export type DocImportErrorCode =
  | "tooLarge"
  | "tooManyChunks"
  | "pdfPassword"
  | "pdfUnreadable"
  | "unsupported"
  | "noText"
  | "scannedNoOcr"
  | "imageNoOcr"
  | "ocrFailed";

/** Error with a code the screen shows in the app language (message: for logs). */
export class DocImportError extends Error {
  readonly code: DocImportErrorCode;
  readonly vars: Record<string, string>;
  constructor(code: DocImportErrorCode, message: string, vars: Record<string, string> = {}) {
    super(message);
    this.name = "DocImportError";
    this.code = code;
    this.vars = vars;
  }
}

export interface ImportProgress {
  stage: "reading" | "ocr" | "chunking" | "embedding";
  chunkIndex?: number;
  chunkCount?: number;
}

/**
 * Auditoría 2026-10-29: cuántos trozos daría un texto de esta longitud, sin
 * trocearlo. Sirve para rechazar un texto enorme ANTES de crear miles de
 * trozos en memoria (un PDF pequeño puede descomprimirse en cientos de MB de
 * texto). Coincide con chunkText: 1 trozo hasta CHUNK_CHARS y después uno
 * cada CHUNK_CHARS − OVERLAP_CHARS caracteres.
 */
export function estimateChunkCount(length: number): number {
  if (length <= 0) return 0;
  if (length <= CHUNK_CHARS) return 1;
  return 1 + Math.ceil((length - CHUNK_CHARS) / (CHUNK_CHARS - OVERLAP_CHARS));
}

/** Caracteres que caben en `chunks` trozos (lo inverso de estimateChunkCount). */
export function maxCharsForChunks(chunks: number): number {
  if (chunks <= 0) return 0;
  return CHUNK_CHARS + (chunks - 1) * (CHUNK_CHARS - OVERLAP_CHARS);
}

function tooManyChunks(count: number): DocImportError {
  return new DocImportError("tooManyChunks", `Too much text: about ${count} chunks.`, {
    max: String(MAX_IMPORT_CHUNKS),
  });
}

function csvToText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").join(" | "))
    .join("\n");
}

type ParsedDoc = {
  title: string;
  source: string;
  body: string;
  ocr?: boolean;
  /**
   * E6 (paso 4): las páginas del documento cuando el extractor
   * las entrega (los PDF). El troceado corre por página y cada
   * fragmento guarda la suya; sin páginas, el documento se
   * trocea entero como siempre y sus fragmentos van sin página.
   */
  pages?: PaginaTexto[];
};

/** Lo que una importación va anotando para nombrar su error si al final no entra nada. */
interface ImportSink {
  emptyPdfNames: string[];
  ocrFailedNames: string[];
  /**
   * El OCR de páginas de un PDF que SÍ corrió y devolvió vacío
   * (no rechazó: resolvió sin texto), aporte lo que aporte su
   * capa de texto (Adversaria H-01: antes solo se anotaba sin
   * capa, y el PDF mixto callaba sus páginas escaneadas). Se
   * anota aparte de ocrFailedNames a propósito: el error de
   * vacío total distingue «resolvió vacío» (noText) de «la
   * llamada rechazó» (ocrFailed) — esa distinción es la que
   * separa las ramas del fallo en el aparato — y esta lista da
   * el nombre a los avisos por fichero.
   */
  ocrEmptyNames: string[];
  noOcrImageNames: string[];
  /**
   * E6 (paso 3, D-3): los PDF rechazados de este fichero, con su
   * código (pdfPassword / pdfUnreadable). En el móvil estos dos
   * errores mataban el lote entero; la puerta D-3 de la etapa
   * manda que el lote mixto los rechace por fichero con su aviso
   * persistido y deje entrar a los buenos — adaptación nombrada
   * del porte. Si no entra nada de nada, el error de la
   * importación es el código del primer rechazo.
   */
  rejectedPdfByName: Map<string, "pdfPassword" | "pdfUnreadable">;
  /**
   * Acto 2 del bloque de piezas sueltas: el veredicto
   * `unsupported` del clasificador por bytes, cobrado por fin
   * con el mismo patrón D-3 — mapa por fichero con la razón del
   * veredicto (archive / spreadsheet / old-office / unknown),
   * aviso propio persistido y, si no entra nada, el error de la
   * importación con el código "unsupported".
   */
  rejectedUnsupportedByName: Map<string, UnsupportedReason>;
  /**
   * La huella de cada rechazo de OCR, por nombre de fichero: el
   * código del OcrError y su mensaje acotado. Antes de R-06 P5 el
   * catch del importador tiraba el error entero y ni el código ni
   * el mensaje sobrevivían a ninguna superficie.
   */
  ocrErrorByName: Map<string, { code: string; message: string }>;
}

/** Tope del mensaje de error de OCR que se conserva: el del módulo nativo, sin contenido del usuario. */
const OCR_ERROR_MESSAGE_MAX = 200;

/**
 * Anota un rechazo de OCR conservando su huella (código y mensaje
 * acotado del OcrError), en vez del catch desnudo que lo enterraba.
 */
function noteOcrFailure(sink: ImportSink | undefined, filename: string, e: unknown): void {
  if (!sink) return;
  sink.ocrFailedNames.push(filename);
  const code = e instanceof OcrError ? e.code : "OCR_FAILED";
  const message = (e instanceof Error ? e.message : String(e)).slice(0, OCR_ERROR_MESSAGE_MAX);
  sink.ocrErrorByName.set(filename, { code, message });
}

/**
 * Por qué un fichero no aportó texto a una importación con éxito
 * (R-06 P5): el aviso que la Biblioteca enseña en la colección.
 * `ocrFailed` lleva la huella del rechazo (código y mensaje del
 * nativo, acotado); `ocrEmpty` es un OCR que corrió y volvió sin
 * texto; `imageNoOcr`, una imagen en una versión sin el módulo.
 */
export type ImportWarningReason =
  | "ocrFailed"
  | "ocrEmpty"
  | "imageNoOcr"
  | "unsupported"
  | "noText"
  /** E6 (paso 3, D-3): el PDF rechazado por su contraseña, nombrado por fichero. */
  | "pdfPassword"
  /** E6 (paso 3, D-3): el PDF que no se pudo leer, nombrado por fichero. */
  | "pdfUnreadable"
  /** C-06: el contenido ya vive en la biblioteca y no ha entrado. */
  | "alreadyImported"
  /** C-06: el contenido entra, pero es casi igual a un documento ya presente. */
  | "similarImported";

export interface ImportWarning {
  name: string;
  reason: ImportWarningReason;
  ocrCode?: string;
  ocrMessage?: string;
  /**
   * C-06 (alreadyImported/similarImported): la colección donde el
   * documento ya vive. Ausente cuando la única copia está en la
   * misma colección sobre la que cuelga el aviso.
   */
  detail?: string;
  /**
   * C-06: el nombre de fichero que el documento ya tenía — un
   * fichero renombrado se avisa con AMBOS nombres para que la
   * persona encuentre el original.
   */
  previousName?: string;
}

/** La colección creada por una importación, con los avisos por fichero sin texto de esa importación. */
export interface ImportedCollection extends CustomCollection {
  importWarnings: ImportWarning[];
  /**
   * C-06, caso 1 con el lote entero: todo documento con contenido
   * ya vivía en la biblioteca, así que NO se ha creado colección
   * alguna y esta es la que ya guarda el primer duplicado. No es un
   * error: la tarjeta ofrece «importar de todos modos» en el momento.
   */
  duplicateImport?: boolean;
}

/** Opciones extra de una importación (C-06). */
export interface ImportDocumentsOptions {
  /**
   * «Importar de todos modos»: la persona, delante del aviso de
   * idéntico, pide la copia a sabiendas. Sin esta opción, un
   * documento cuyo contenido ya vive en la biblioteca no entra.
   */
  forceDuplicates?: boolean;
}

/** El aviso de un fichero, leído de los sumideros de su importación. */
function importWarningFor(name: string, sink: ImportSink): ImportWarning {
  const rejectedUnsupported = sink.rejectedUnsupportedByName.get(name);
  if (rejectedUnsupported) return { name, reason: "unsupported" };
  const rejectedPdf = sink.rejectedPdfByName.get(name);
  if (rejectedPdf) return { name, reason: rejectedPdf };
  if (sink.ocrFailedNames.includes(name)) {
    const detail = sink.ocrErrorByName.get(name);
    return {
      name,
      reason: "ocrFailed",
      ...(detail ? { ocrCode: detail.code, ocrMessage: detail.message } : {}),
    };
  }
  if (sink.ocrEmptyNames.includes(name)) return { name, reason: "ocrEmpty" };
  if (sink.noOcrImageNames.includes(name)) return { name, reason: "imageNoOcr" };
  return { name, reason: "noText" };
}

/** H-11: los avisos persistidos de unas colecciones, leídos de la base. */
export async function listImportWarnings(
  collectionIds: readonly string[]
): Promise<Record<string, ImportWarning[]>> {
  const stored = await listImportWarningsInDb(collectionIds);
  const out: Record<string, ImportWarning[]> = {};
  for (const [id, warnings] of Object.entries(stored)) {
    out[id] = warnings.map((w) => ({ ...w, reason: w.reason as ImportWarningReason }));
  }
  return out;
}

/** H-11: descarta un grupo de avisos (colección, razón) ya vistos. */
export async function dismissImportWarnings(
  collectionId: string,
  reason: ImportWarningReason
): Promise<void> {
  await dismissImportWarningsInDb(collectionId, reason);
}

// ---------------------------------------------------------------------------
// C-06: identidad por huella del contenido extraído
// ---------------------------------------------------------------------------

/**
 * Normalización v1 de la identidad: recorta los extremos y colapsa
 * cada racha de blancos (espacios, tabuladores, saltos) a un solo
 * espacio. Es la forma canónica sobre la que se huella un documento:
 * dos copias del mismo texto separadas por un salto de línea de más
 * son el mismo documento.
 *
 * Desviación declarada del papel de diseño (que huellaba
 * título + "\n" + cuerpo): la huella es del CUERPO solo. Con el
 * título dentro, un fichero renombrado — cuyo título derivado cambia
 * con el nombre — escaparía del caso idéntico, y el propio papel
 * pide que el renombrado avise con ambos nombres; el falso positivo
 * que el papel acepta (dos documentos plantilla con el mismo texto
 * son el mismo documento) solo se cumple con el cuerpo solo.
 */
export function normalizeContentText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * La huella de identidad de un documento: SHA-256 del cuerpo
 * normalizado (v1). Un cuerpo vacío o de solo blancos no tiene
 * identidad (null): los ficheros sin texto siguen el camino de los
 * avisos, nunca el de los duplicados. Salvedad OCR declarada: la
 * huella de un documento reconocido es la de ESE texto reconocido —
 * dos lecturas del mismo papel pueden diferir y no casar; eso
 * degrada a «no detectado», nunca a un falso duplicado.
 */
export function docContentFingerprint(body: string): string | null {
  const normalized = normalizeContentText(body);
  if (normalized.length === 0) return null;
  return sha256Hex(new TextEncoder().encode(normalized));
}

/** La huella de un trozo, sobre la misma normalización v1. */
function chunkFingerprint(piece: string): string {
  return sha256Hex(new TextEncoder().encode(normalizeContentText(piece)));
}

/** C-06: fracción de trozos compartidos a partir de la cual un documento nuevo se dice parecido a uno presente. */
const SIMILARITY_THRESHOLD = 0.9;

/** Intersección con multiplicidad de dos listas de huellas de trozo. */
function sharedChunkCount(a: readonly string[], b: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const f of a) counts.set(f, (counts.get(f) ?? 0) + 1);
  let shared = 0;
  for (const f of b) {
    const n = counts.get(f) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(f, n - 1);
    }
  }
  return shared;
}

let ocrNotePrefixes: string[] | null = null;

/**
 * Reconstruye el cuerpo de un documento desde sus trozos guardados:
 * quita la nota de procedencia OCR del primer trozo (el importador
 * la antepone al cuerpo antes de trocear) y cose cada trozo
 * siguiente por su solape — trozo_i empieza OVERLAP_CHARS antes del
 * final del anterior, así que aporta desde ese desplazamiento.
 * Los prefijos se calculan perezosos, al primer uso: a nivel de
 * módulo romperían los mundos de prueba que simulan ./ocr sin la
 * tabla de notas.
 */
export function reconstructDocBody(bodies: readonly string[]): string {
  if (bodies.length === 0) return "";
  ocrNotePrefixes ??= Object.values(OCR_PROVENANCE_NOTE).map((note) => `${note}\n\n`);
  let first = bodies[0];
  for (const prefix of ocrNotePrefixes) {
    if (first.startsWith(prefix)) {
      first = first.slice(prefix.length);
      break;
    }
  }
  let out = first;
  for (let i = 1; i < bodies.length; i++) out += bodies[i].slice(OVERLAP_CHARS);
  return out;
}

/** Marca en meta de que el registro perezoso ya corrió (la clave lleva la versión de la normalización). */
const REGISTRY_MARK_KEY = "import_fp_registry_v1";

/**
 * C-06: el registro perezoso de lo importado ANTES de la cura. Las
 * colecciones viejas no tienen filas de huella: se reconstruye el
 * cuerpo de cada documento cosiendo sus trozos y se registra su
 * huella (kind "registry"), SIN BORRAR NADA — los gemelos que ya
 * vivían duplicados quedan avisados por nombre en la colección de
 * la copia posterior; borrar la copia es la acción de la persona.
 *
 * Corre una sola vez (marca en meta), es best-effort entero — el
 * patrón de la barrida de huérfanos: si algo falla no se pone la
 * marca y se reintenta en la próxima apertura o importación, y un
 * fallo del registro nunca tumba ni la importación ni la Biblioteca.
 */
export async function ensureImportFingerprintRegistry(opts?: {
  lifecycleEpoch?: number;
}): Promise<void> {
  try {
    if (await getMetaValue(REGISTRY_MARK_KEY)) return;
    const writeOpts =
      opts?.lifecycleEpoch != null ? { lifecycleEpoch: opts.lifecycleEpoch } : undefined;
    const collections = await listCustomCollections();
    const createdAtById = new Map(collections.map((c) => [c.id, c.createdAt]));
    const existing = await listAllCollectionDocFingerprints();
    const have = new Set(existing.map((r) => `${r.collectionId}${r.docId}`));
    const byFp = new Map<string, AllDocFingerprintRow[]>();
    const group = (r: AllDocFingerprintRow) => {
      const arr = byFp.get(r.fingerprint);
      if (arr) arr.push(r);
      else byFp.set(r.fingerprint, [r]);
    };
    existing.forEach(group);
    for (const c of collections) {
      const chunks = await listCollectionChunks(c.id);
      const byDoc = new Map<string, typeof chunks>();
      for (const ch of chunks) {
        const arr = byDoc.get(ch.doc_id);
        if (arr) arr.push(ch);
        else byDoc.set(ch.doc_id, [ch]);
      }
      const rows: DocFingerprintRow[] = [];
      for (const [docId, parts] of byDoc) {
        if (have.has(`${c.id}${docId}`)) continue;
        const fp = docContentFingerprint(reconstructDocBody(parts.map((p) => p.body)));
        if (!fp) continue;
        const row: DocFingerprintRow = {
          docId,
          fingerprint: fp,
          fileName: parts[0]?.source ?? "",
          kind: "registry",
        };
        rows.push(row);
        group({ ...row, collectionId: c.id, collectionName: c.name });
      }
      if (rows.length > 0) await recordCollectionDocFingerprints(c.id, rows, writeOpts);
    }
    // Gemelos ya vivos (entre colecciones o dentro de una): aviso en
    // la copia posterior nombrando a la primera; nada se borra.
    for (const rows of byFp.values()) {
      if (rows.length < 2) continue;
      const sorted = [...rows].sort(
        (a, b) =>
          (createdAtById.get(a.collectionId) ?? 0) - (createdAtById.get(b.collectionId) ?? 0) ||
          a.docId.localeCompare(b.docId)
      );
      const first = sorted[0];
      for (const extra of sorted.slice(1)) {
        const warning: StoredImportWarning = {
          name: extra.fileName,
          reason: "alreadyImported",
          ...(extra.collectionId !== first.collectionId ? { detail: first.collectionName } : {}),
          previousName: first.fileName,
        };
        await recordImportWarnings(extra.collectionId, [extra.fileName], [warning], writeOpts);
      }
    }
    await setMetaValue(REGISTRY_MARK_KEY, "1", writeOpts);
  } catch {
    // Best-effort: sin marca, se reintenta la próxima vez.
  }
}

/** El entorno de reconocimiento de UNA importación: idioma de la app y si esta versión trae el módulo. */
interface ImportEnv {
  lang: OcrLang;
  ocrAvailable: boolean;
  onProgress?: (p: ImportProgress) => void;
}

/**
 * Los primeros bytes de un fichero, para clasificarlo por su magia
 * (attachmentPolicy) cuando la extensión no lo despacha. En PC se
 * leen los bytes mismos de la ruta, sin pasar por ninguna
 * codificación intermedia.
 */
async function readKindSample(uri: string): Promise<Uint8Array | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(uri, "r");
    const buf = Buffer.alloc(KIND_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, KIND_SAMPLE_BYTES, 0);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * La lectura de un fichero de texto por la sede (E6, §3.1 del
 * documento de etapa): en streaming, con el tope de bytes aplicado
 * DURANTE la lectura — un log de 300 MB elegido por error muere
 * contra el contador, no en la memoria — y decodificación UTF-8
 * estricta con detección de BOM. Lo que no decodifica no se importa
 * con caracteres de sustitución en silencio: vuelve como
 * `undecodable` y el llamante lo rechaza como noText con su aviso
 * (decisión de la etapa; el móvil no declara este caso).
 */
type TextFileRead =
  | { kind: "text"; text: string }
  | { kind: "tooLarge"; bytes: number }
  | { kind: "undecodable" };

async function readTextFileCapped(uri: string, maxBytes: number): Promise<TextFileRead> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of createReadStream(uri)) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) return { kind: "tooLarge", bytes: total };
    parts.push(buf);
  }
  let bytes = Buffer.concat(parts);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  try {
    return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { kind: "undecodable" };
  }
}

/**
 * PDFs are binary - reading them with readAsStringAsync (used for every
 * other format) would just return garbage, so extraction has its own path
 * via the native module rather than going through the raw-text branches
 * below. Password-protected PDFs surface a clear message instead of the
 * native module's raw PASSWORD_REQUIRED/INCORRECT_PASSWORD error code -
 * this importer has no password-prompt UI, so there's nothing useful to do
 * with an encrypted PDF beyond telling the user why it was skipped.
 */
async function extractPdf(uri: string, filename: string, maxChars: number): Promise<PaginaTexto[]> {
  try {
    // Auditoría 2026-10-29: el módulo nativo se para en `maxChars` (lo que
    // aún cabe en el tope de trozos) y rechaza PDFs con demasiadas páginas,
    // antes de que el texto llegue entero a la memoria.
    // E6 (paso 4): la extracción es por páginas (extractPdfPages)
    // para que el troceador ancle cada fragmento a su página; el
    // tope de caracteres corta dentro del extractor igual que
    // antes, y el de páginas sale de los metadatos.
    return await extractPdfPages(uri, MAX_IMPORT_PDF_PAGES, maxChars);
  } catch (e) {
    const code = e instanceof PdfTextError ? e.code : "PDF_EXTRACTION_ERROR";
    if (code === "PASSWORD_REQUIRED") {
      throw new DocImportError("pdfPassword", `"${filename}" is password-protected - password-protected PDFs aren't supported.`, { name: filename });
    }
    if (code === "TEXT_TOO_LARGE" || code === "TOO_MANY_PAGES") {
      throw tooManyChunks(MAX_IMPORT_CHUNKS + 1);
    }
    throw new DocImportError("pdfUnreadable", `Couldn't read "${filename}": ${e instanceof Error ? e.message : String(e)}`, { name: filename });
  }
}

/**
 * El error de una importación que no dio ningún texto: si algún PDF
 * entró vacío (escaneado, sin capa de texto) y esta versión no trae
 * OCR, el error lo nombra (scannedNoOcr); si no, el genérico de
 * siempre. Pura, para probarla sin el importador entero.
 */
export function emptyImportErrorCode(emptyPdfNames: string[], ocrAvailable: boolean): DocImportErrorCode {
  return emptyPdfNames.length > 0 && !ocrAvailable ? "scannedNoOcr" : "noText";
}

/**
 * T-03 de la 0.1.99 (m-62): el tamaño real de un asset cuando el
 * selector no lo declara. Sin esto, la ruta de texto leía el fichero
 * ENTERO para comprobar el tope después de tenerlo en memoria (un
 * .txt enorme sin tamaño era un OOM en aparatos justos, no un error
 * limpio) y la de imagen entraba al OCR sin cota previa. Los assets
 * del selector se copian a la caché local (pickDocuments usa
 * copyToCacheDirectory), así que el tamaño existe en el sistema de
 * ficheros aunque el selector no lo haya reportado. Si ni así se
 * puede saber, devuelve null y manda la segunda red de siempre (la
 * comprobación tras leer, en la ruta de texto).
 */
async function pickerAssetSizeBytes(
  file: PickedDocumentFile
): Promise<number | null> {
  if (file.size != null) return file.size;
  try {
    const info = await stat(file.uri);
    return typeof info.size === "number" ? info.size : null;
  } catch {
    return null;
  }
}

async function parseFileContent(
  file: PickedDocumentFile,
  fallbackTitle: string,
  chunksLeft: number = MAX_IMPORT_CHUNKS,
  sink?: ImportSink,
  env?: ImportEnv
): Promise<ParsedDoc[]> {
  const filename = file.name;
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  // El despacho lo decide la extensión conocida o, si no, los
  // propios bytes del fichero (attachmentPolicy): una imagen
  // llamada .bin o un PDF llamado .data van por su camino.
  // Auditoría completa (F-2): la 0.1.68 prometió que el tipo lo
  // deciden los bytes y no el nombre, pero una extensión conocida
  // mandaba sin mirarlos: un PDF llamado «.txt» se indexaba como
  // texto basura, y una foto llamada «.pdf» fallaba como PDF
  // ilegible. Ahora la magia fuerte (%PDF-, JPEG, PNG, WEBP, GIF,
  // HEIF) manda siempre; sin ella, la extensión conocida, y si no,
  // la clasificación entera de los bytes.
  const sample = await readKindSample(file.uri);
  // La decisión entera (kind y razón), no solo el kind: la razón
  // del veredicto unsupported viaja hasta el aviso (acto 2).
  const decision = sample ? attachmentKind(filename, sample) : null;
  const byBytes = decision?.kind ?? null;
  let kind: "pdf" | "image" | "text" | "unsupported" | null = null;
  if (byBytes === "pdf" || byBytes === "image") kind = byBytes;
  else if (ext === "pdf") kind = "pdf";
  else if (IMAGE_EXTENSIONS.has(ext)) kind = "image";
  else if (TEXT_DISPATCH_EXTENSIONS.has(ext)) kind = "text";
  else kind = byBytes;

  // m-62: el tamaño que gobierna las cotas es el declarado por el
  // selector o, si no lo declara, el real del fichero — resuelto
  // aquí, antes de leer ni de pasar por OCR.
  const sizeBytes = await pickerAssetSizeBytes(file);

  if (kind === "image") {
    if (sizeBytes != null && sizeBytes > MAX_IMPORT_TEXT_FILE_BYTES) {
      throw new DocImportError("tooLarge", `"${filename}" is too large (${sizeBytes} bytes).`, {
        name: filename,
        max: String(Math.round(MAX_IMPORT_TEXT_FILE_BYTES / (1024 * 1024))),
      });
    }
    // E6 (paso 6, firma 4): HEIC/HEIF/AVIF sin decodificador
    // local confirmado se nombran como sin OCR, no se intentan:
    // un intento fallido en silencio sería peor que el nombre.
    const heifByBrand = sample ? heifBrandOf(sample) !== null : false;
    const heifByExt = ["heic", "heif", "avif"].includes(ext);
    if ((heifByBrand || heifByExt) && !(await ocrSupportsHeif())) {
      sink?.noOcrImageNames.push(filename);
      return [{ title: fallbackTitle, source: filename, body: "" }];
    }
    // Una imagen entra por su texto impreso, leído en el aparato.
    // Sin el módulo en esta versión, se anota para nombrarla si la
    // importación entera queda vacía (error imageNoOcr).
    if (!env?.ocrAvailable) {
      sink?.noOcrImageNames.push(filename);
      return [{ title: fallbackTitle, source: filename, body: "" }];
    }
    env.onProgress?.({ stage: "ocr" });
    try {
      const text = await recognizeImageText(file.uri, env.lang);
      return [{ title: fallbackTitle, source: filename, body: text, ocr: true }];
    } catch (e) {
      noteOcrFailure(sink, filename, e);
      return [{ title: fallbackTitle, source: filename, body: "" }];
    }
  }

  const limit = kind === "pdf" ? MAX_IMPORT_PDF_FILE_BYTES : MAX_IMPORT_TEXT_FILE_BYTES;
  if (sizeBytes != null && sizeBytes > limit) {
    throw new DocImportError("tooLarge", `"${filename}" is too large (${sizeBytes} bytes).`, {
      name: filename,
      max: String(Math.round(limit / (1024 * 1024))),
    });
  }

  if (kind === "pdf") {
    let pages: PaginaTexto[];
    try {
      pages = await extractPdf(file.uri, filename, maxCharsForChunks(chunksLeft) + OVERLAP_CHARS);
    } catch (e) {
      // E6 (paso 3, D-3): la contraseña y lo ilegible se rechazan
      // POR FICHERO con su aviso, y el lote sigue; los topes
      // (tooManyChunks, tooLarge) siguen matando el lote, que es
      // su forma firmada en D-11.
      if (
        e instanceof DocImportError &&
        (e.code === "pdfPassword" || e.code === "pdfUnreadable")
      ) {
        sink?.rejectedPdfByName.set(filename, e.code);
        return [{ title: fallbackTitle, source: filename, body: "" }];
      }
      throw e;
    }
    const text = pages.map((p) => p.texto).join("\n\n");
    // Un PDF sin capa de texto (escaneado) extrae vacío: se anota
    // para que una importación sin nada importable lo nombre
    // (emptyImportErrorCode), no para fallar aquí — en una
    // importación mixta los demás ficheros siguen entrando.
    if (text.trim().length === 0) sink?.emptyPdfNames.push(filename);
    // Auditoría 2026-10-29 (bomba de descompresión): el tamaño del archivo
    // no dice cuánto texto sale. Se mide aquí, antes de trocear nada.
    // E6 (§4.4): la estimación se suma por páginas.
    const estimated = estimateChunkCountForPages(pages);
    if (estimated > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimated);
    const docs: ParsedDoc[] = [{ title: fallbackTitle, source: filename, body: text, pages }];
    // Las páginas escaneadas del PDF (todas si no hay capa de
    // texto; las sueltas si es mixto) pasan por OCR cuando la
    // versión trae el módulo, y el texto reconocido entra con
    // su página y su origen en el mismo documento (E6, paso 6:
    // la forma por páginas; en el móvil entraba como documento
    // propio sin página, porque allí la cita no la tenía).
    if (env?.ocrAvailable) {
      env.onProgress?.({ stage: "ocr" });
      try {
        const ocrPages = await recognizeScannedPdfPages(file.uri, env.lang);
        if (ocrPages === null) {
          // Auditoría completa, F-1: el PDF no tiene páginas
          // escaneadas; no hay nada que avisar.
        } else if (ocrPages.every((p) => p.texto.trim().length === 0)) {
          // Adversaria H-01: la vía OCR de este fichero corrió y
          // volvió sin texto — se anota SIEMPRE, aporte lo que
          // aporte la capa de texto. La condición anterior (solo
          // sin capa) dejaba el PDF mixto en silencio: la portada
          // daba su chunk y las páginas escaneadas que no se
          // leyeron no se nombraban en ninguna parte. Desde la
          // auditoría completa (F-1) la costura distingue «no hay
          // páginas escaneadas» (null, sin aviso) de «las hay y el
          // motor no leyó nada» (este aviso).
          sink?.ocrEmptyNames.push(filename);
        } else {
          // Las páginas reconocidas se suman a las del documento
          // en orden de página (la de texto antes que la de OCR
          // del mismo número): el registro de huellas cose los
          // fragmentos en el orden en que se escriben.
          docs[0] = {
            ...docs[0],
            pages: [...(docs[0].pages ?? []), ...ocrPages].sort(
              (a, b) => a.pagina - b.pagina,
            ),
          };
        }
      } catch (e) {
        // El texto de la capa (si lo hay) sigue valiendo; si no lo
        // hay, el nombre y la huella del rechazo quedan anotados
        // para el error de vacío y para los avisos.
        noteOcrFailure(sink, filename, e);
      }
    }
    return docs;
  }

  // Acto 2 del bloque de piezas sueltas: el veredicto
  // `unsupported` se cobra aquí — tras el bloque de PDF y la
  // puerta de tamaño (un no-soportado gigante sigue muriendo
  // como tooLarge) y antes de la lectura de texto. Hasta esta
  // rama, un formato no soportado cuyos bytes decodificaban
  // entraba como texto, y el que no decodificaba se rechazaba
  // como noText cabalgando sobre la indecodificabilidad, no
  // sobre el veredicto. Devuelve el documento vacío de siempre,
  // como la rama undecodable y la de PDF rechazado.
  if (kind === "unsupported") {
    sink?.rejectedUnsupportedByName.set(filename, decision?.reason ?? "unknown");
    return [{ title: fallbackTitle, source: filename, body: "" }];
  }

  // La lectura por la sede aplica el tope durante la lectura
  // (§3.1): el tamaño declarado ya se cobró arriba, y lo que el
  // selector no declaró lo corta el contador del streaming, no una
  // comprobación tras tener el fichero entero en memoria.
  const read = await readTextFileCapped(file.uri, MAX_IMPORT_TEXT_FILE_BYTES);
  if (read.kind === "tooLarge") {
    throw new DocImportError("tooLarge", `"${filename}" is too large (${read.bytes} bytes).`, {
      name: filename,
      max: String(Math.round(MAX_IMPORT_TEXT_FILE_BYTES / (1024 * 1024))),
    });
  }
  if (read.kind === "undecodable") {
    // §3.1: lo que no decodifica en UTF-8 se rechaza declarado —
    // entra como documento vacío y la maquinaria de avisos lo
    // nombra noText, sin caracteres de sustitución importados.
    return [{ title: fallbackTitle, source: filename, body: "" }];
  }
  const raw = read.text;

  if (ext === "json") {
    try {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.every((d) => typeof d?.title === "string" && typeof d?.body === "string")
      ) {
        return parsed.map((d) => ({
          title: d.title,
          source: typeof d.source === "string" ? d.source : filename,
          body: d.body,
        }));
      }
    } catch {
      // not valid JSON, or not the corpus-pack shape - fall through to plain text
    }
    return [{ title: fallbackTitle, source: filename, body: raw }];
  }

  if (ext === "csv") {
    return [{ title: fallbackTitle, source: filename, body: csvToText(raw) }];
  }

  // .md / .txt / anything else we let through the picker filter
  return [{ title: fallbackTitle, source: filename, body: raw }];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * El selector de ficheros del sistema, por la costura de la
 * carcasa: en PC la ruta nace en el renderizador (webUtils) y la
 * carcasa registra aquí cómo se elige; sin registro no hay
 * selección (null), como un selector cancelado.
 */
export async function pickDocuments(): Promise<PickedDocumentFile[] | null> {
  if (!documentPicker) return null;
  return documentPicker();
}

/**
 * Colecciones cuya importación está en vuelo en este proceso (carril
 * F-REV): la importación inserta sus trozos antes de crear la fila de
 * la colección, así que durante el vuelo esos trozos parecen huérfanos
 * a la barrida de F3-17. El registro se pasa a la barrida como
 * exclusión para que sea segura en sí misma, llame quien la llame.
 */
const inFlightCollectionIds = new Set<string>();

/** Cadena que serializa las importaciones (ver importDocuments). */
let importChain: Promise<unknown> = Promise.resolve();

/**
 * Imports one or more already-picked files as a single named collection:
 * reads each file, splits into docs (see parseFileContent), chunks each doc,
 * embeds every chunk on-device (sequentially - the shared llama.cpp
 * embedding context can't run concurrent embeddings), and inserts into the
 * FTS5 + vector tables tagged with this collection's id so it can be
 * toggled or deleted as a unit later.
 *
 * Las importaciones van EN SERIE, una tras otra (sonda del carril
 * F-REV): el llamante de la UI no tenía guarda de reentrada y dos
 * importaciones concurrentes dejaban que la barrida inicial de la
 * segunda borrara los trozos en vuelo de la primera, que nacía
 * declarando trozos que no tenía. El epoch de ciclo de vida se
 * captura cuando la importación arranca de verdad, tras la espera.
 */
export function importDocuments(
  files: PickedDocumentFile[],
  collectionName: string,
  onProgress?: (p: ImportProgress) => void,
  opts?: ImportDocumentsOptions
): Promise<ImportedCollection> {
  const run = importChain.then(() => importDocumentsSerial(files, collectionName, onProgress, opts));
  // La cadena nunca muere: el fallo lo recibe el llamante en `run`,
  // no la cadena que ordena a las importaciones siguientes.
  importChain = run.catch(() => {});
  return run;
}

async function importDocumentsSerial(
  files: PickedDocumentFile[],
  collectionName: string,
  onProgress?: (p: ImportProgress) => void,
  opts?: ImportDocumentsOptions
): Promise<ImportedCollection> {
  const collectionId = `custom-${Date.now()}-${slug(collectionName)}`;
  // Token de ciclo de vida de ESTA importación (ver seedCorpus.seedNow): si
  // Clear All Data avanza el ciclo a mitad, los inserts pendientes y la
  // creación de la colección fallan con DbLifecycleEndedError en vez de
  // repoblar la base nueva con documentos del ciclo anterior.
  const runEpoch = getDbEpoch();

  onProgress?.({ stage: "reading" });
  // ADV2-06: los sumideros son POR FICHERO, no uno del lote indexado
  // por nombre. Con un sumidero único, dos ficheros del mismo nombre
  // en un lote heredaban el uno la marca del otro: el «informe.pdf»
  // sano salía avisado ocrFailed con el código y el mensaje del
  // gemelo que sí falló (y escapaba de su propio ocrEmpty). Cada
  // fichero lleva su sumidero y su desenlace viaja con él.
  interface FileOutcome {
    name: string;
    sink: ImportSink;
    docs: ParsedDoc[];
  }
  const outcomes: FileOutcome[] = [];
  // El reconocimiento se prepara una vez por importación: si esta
  // versión no trae el módulo, el idioma ni se lee (el camino sin
  // OCR es exactamente el de siempre). models/settings se importa
  // aquí dentro a propósito: cargarlo arriba arrastraría su
  // superficie de ficheros a los mundos de prueba del importador.
  const ocrAvailable = await isOcrAvailable();
  let lang: OcrLang = "en";
  if (ocrAvailable) {
    lang = (await (await import("../models/settings.js")).getLanguageId()) as OcrLang;
  }
  const env: ImportEnv = { lang, ocrAvailable, onProgress };
  let estimatedChunks = 0;
  for (const file of files) {
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "");
    const sink: ImportSink = {
      emptyPdfNames: [],
      ocrFailedNames: [],
      ocrEmptyNames: [],
      noOcrImageNames: [],
      ocrErrorByName: new Map(),
      rejectedPdfByName: new Map(),
      rejectedUnsupportedByName: new Map(),
    };
    const docs = await parseFileContent(file, fallbackTitle, MAX_IMPORT_CHUNKS - estimatedChunks, sink, env);
    // Se corta en cuanto la suma pasa del tope, sin leer los archivos que
    // quedan ni trocear lo leído. (La cuenta es previa a la
    // deduplicación a propósito: conservadora — un lote de puros
    // duplicados enormes se corta aquí aunque luego no entrara nada.)
    // E6 (§4.4): con páginas, la estimación del lote también se suma por páginas.
    for (const d of docs) {
      estimatedChunks += d.pages
        ? estimateChunkCountForPages(d.pages)
        : estimateChunkCount(d.body.trim().length);
    }
    if (estimatedChunks > MAX_IMPORT_CHUNKS) throw tooManyChunks(estimatedChunks);
    outcomes.push({ name: file.name, sink, docs });
  }

  // C-06: antes de trocear nada, el registro perezoso de lo ya
  // importado (best-effort) y la detección por huella — lo idéntico
  // no llega ni al embedding.
  await ensureImportFingerprintRegistry({ lifecycleEpoch: runEpoch });
  const force = opts?.forceDuplicates === true;
  interface ParsedEntry {
    fileName: string;
    doc: ParsedDoc;
    fingerprint: string | null;
  }
  const entries: ParsedEntry[] = outcomes.flatMap((o) =>
    o.docs.map((doc) => ({ fileName: o.name, doc, fingerprint: docContentFingerprint(doc.body) }))
  );
  const accepted: ParsedEntry[] = [];
  const dupByFile = new Map<string, { collections: Set<string>; previousName: string }>();
  const similarByFile = new Map<string, { detail: string; previousName: string }>();
  let existingCollections: CustomCollection[] = [];
  if (!force) {
    existingCollections = await listCustomCollections();
    const liveRows = await listAllCollectionDocFingerprints();
    const liveByFp = new Map<string, AllDocFingerprintRow[]>();
    for (const r of liveRows) {
      const arr = liveByFp.get(r.fingerprint);
      if (arr) arr.push(r);
      else liveByFp.set(r.fingerprint, [r]);
    }
    // Candidatos a parecido: los documentos ya presentes, con las
    // huellas de sus trozos reconstruidos (cosidos y sin la nota de
    // procedencia, igual que se trocearía su cuerpo hoy).
    interface SimilarCandidate {
      collectionName: string;
      fileName: string;
      chunkFps: string[];
    }
    const existingSimilar: SimilarCandidate[] = [];
    for (const c of existingCollections) {
      const stored = await listCollectionChunks(c.id);
      const byDoc = new Map<string, typeof stored>();
      for (const ch of stored) {
        const arr = byDoc.get(ch.doc_id);
        if (arr) arr.push(ch);
        else byDoc.set(ch.doc_id, [ch]);
      }
      for (const parts of byDoc.values()) {
        existingSimilar.push({
          collectionName: c.name,
          fileName: parts[0]?.source ?? "",
          chunkFps: chunkText(reconstructDocBody(parts.map((p) => p.body))).map(chunkFingerprint),
        });
      }
    }
    const batchSeen = new Map<string, string>();
    const acceptedSimilar: SimilarCandidate[] = [];
    for (const e of entries) {
      const fp = e.fingerprint;
      if (fp) {
        const liveHits = liveByFp.get(fp);
        const batchHit = batchSeen.get(fp);
        if (liveHits || batchHit) {
          let rec = dupByFile.get(e.fileName);
          if (!rec) {
            rec = {
              collections: new Set<string>(),
              previousName: liveHits?.[0]?.fileName ?? batchHit!,
            };
            dupByFile.set(e.fileName, rec);
          }
          for (const h of liveHits ?? []) rec.collections.add(h.collectionName);
          continue;
        }
        // Parecido (≥ 90 % de trozos idénticos): entra como copia
        // nueva, avisada con el mejor parecido. Borde declarado:
        // un documento de UN solo trozo editado comparte 0 trozos
        // y esta red no lo ve — el idéntico exacto, que es el daño
        // medido de C-06, queda cazado siempre por la huella.
        const chunkFps = chunkText(e.doc.body).map(chunkFingerprint);
        let best: { fraction: number; cand: SimilarCandidate } | null = null;
        for (const cand of [...existingSimilar, ...acceptedSimilar]) {
          const denom = Math.max(chunkFps.length, cand.chunkFps.length);
          if (denom === 0) continue;
          const fraction = sharedChunkCount(chunkFps, cand.chunkFps) / denom;
          if (fraction >= SIMILARITY_THRESHOLD && (!best || fraction > best.fraction)) {
            best = { fraction, cand };
          }
        }
        if (best && !similarByFile.has(e.fileName)) {
          similarByFile.set(e.fileName, {
            detail: best.cand.collectionName,
            previousName: best.cand.fileName,
          });
        }
        batchSeen.set(fp, e.fileName);
        acceptedSimilar.push({ collectionName, fileName: e.fileName, chunkFps });
      }
      accepted.push(e);
    }
  } else {
    accepted.push(...entries);
  }

  // Los avisos del lote, por fichero y en el orden del lote.
  const buildWarnings = (excludeCollectionName?: string): ImportWarning[] => {
    const warnings: ImportWarning[] = [];
    // Los avisos de identidad se emiten UNA vez por nombre: dos
    // outcomes pueden compartir nombre (el mismo fichero dos veces,
    // o gemelos del mismo nombre) y sus duplicados se agregan en un
    // solo registro — emitirlo dos veces duplicaría la fila
    // persistida (y rompería su clave primaria).
    const identityWarned = new Set<string>();
    for (const o of outcomes) {
      // R-06 P5 + Adversaria H-01: el aviso OCR/sin-texto de un
      // fichero nace de DOS suelos — que sus documentos no den ni
      // un trozo (el de R-06 P5) o que su vía OCR haya quedado
      // nombrada en SU sumidero (rechazó o volvió vacía), aporte
      // lo que aporte la capa de texto: sin el segundo suelo, el
      // PDF mixto importaba «con éxito» callando que sus páginas
      // escaneadas no entraron. Un fichero puede aportar chunks Y
      // llevar aviso; la importación no se convierte en fracaso.
      if (
        o.sink.ocrFailedNames.length > 0 ||
        o.sink.ocrEmptyNames.length > 0 ||
        // El texto efectivo de un documento es su cuerpo o el
        // de sus páginas: en la forma por páginas de PC el
        // cuerpo unido es la capa de texto y las páginas OCR
        // viven en `pages` — un escaneado que entró por OCR
        // no es un fichero sin texto (cobrado por D-5).
        o.docs.every(
          (d) =>
            d.body.trim().length === 0 &&
            !(d.pages ?? []).some((p) => p.texto.trim().length > 0)
        )
      ) {
        warnings.push(importWarningFor(o.name, o.sink));
      }
      if (!identityWarned.has(o.name)) {
        const dup = dupByFile.get(o.name);
        if (dup) {
          identityWarned.add(o.name);
          const names = [...dup.collections].filter((n) => n !== excludeCollectionName);
          warnings.push({
            name: o.name,
            reason: "alreadyImported",
            ...(names.length > 0 ? { detail: names.join(", ") } : {}),
            previousName: dup.previousName,
          });
        }
        const sim = similarByFile.get(o.name);
        if (sim) {
          identityWarned.add(o.name);
          warnings.push({
            name: o.name,
            reason: "similarImported",
            detail: sim.detail,
            previousName: sim.previousName,
          });
        }
      }
    }
    return warnings;
  };

  // C-06, caso 1 con el lote entero: todo lo que traía contenido ya
  // vivía en la biblioteca. No nace colección ni es un error: los
  // avisos se cuelgan de la colección que ya guarda el primer
  // duplicado y se devuelve ESA colección marcada, para que la
  // tarjeta ofrezca «importar de todos modos» en el momento.
  if (accepted.length === 0 && dupByFile.size > 0) {
    const liveRows = await listAllCollectionDocFingerprints();
    const targetEntry = entries.find(
      (e) => e.fingerprint && liveRows.some((r) => r.fingerprint === e.fingerprint)
    );
    const targetRow = targetEntry
      ? liveRows.find((r) => r.fingerprint === targetEntry.fingerprint)
      : undefined;
    const target = targetRow
      ? existingCollections.find((c) => c.id === targetRow.collectionId)
      : undefined;
    if (targetRow && target) {
      const warnings = buildWarnings(target.name);
      await recordImportWarnings(
        target.id,
        outcomes.map((o) => o.name),
        warnings,
        { lifecycleEpoch: runEpoch }
      );
      return { ...target, importWarnings: warnings, duplicateImport: true };
    }
  }
  const importWarnings = buildWarnings();

  onProgress?.({ stage: "chunking" });
  const chunks: {
    chunkId: string;
    docId: string;
    title: string;
    body: string;
    source: string;
    page: number | null;
    origen: "texto" | "ocr";
  }[] = [];
  const acceptedDocIds: string[] = [];
  accepted.forEach((entry, docIndex) => {
    const doc = entry.doc;
    const docId = `${collectionId}-doc${docIndex}-${slug(doc.title)}`;
    acceptedDocIds.push(docId);
    // E6 (paso 4): con páginas, el troceado corre dentro de cada
    // página y cada fragmento guarda la suya y su origen; la
    // procedencia del OCR la pone el troceador en el primer
    // fragmento de cada página reconocida (§4.5). Sin páginas,
    // el camino de siempre: el documento entero, y si es OCR su
    // procedencia va antepuesta al cuerpo como en el móvil.
    const pieces = doc.pages
      ? chunkPages(doc.pages, OCR_PROVENANCE_NOTE[env.lang])
      : chunkText(
          doc.ocr && doc.body.trim().length > 0
            ? `${OCR_PROVENANCE_NOTE[env.lang]}\n\n${doc.body}`
            : doc.body,
        ).map((body) => ({
          body,
          page: null as number | null,
          origen: (doc.ocr ? "ocr" : "texto") as "texto" | "ocr",
        }));
    pieces.forEach((piece, i) => {
      chunks.push({
        chunkId: `${docId}-c${i}`,
        docId,
        title: pieces.length > 1 ? `${doc.title} (part ${i + 1}/${pieces.length})` : doc.title,
        body: piece.body,
        source: doc.source,
        page: piece.page,
        origen: piece.origen,
      });
    });
  });

  // Nothing to import (scanned PDF without text, empty file): say so instead
  // of creating an empty collection that looks imported. The error
  // names the cause: an image in a build without OCR, a recognition
  // that failed, a scanned PDF in a build without OCR, or plain
  // no text — in that order.
  if (chunks.length === 0) {
    // ADV2-06: también el error de vacío total lee los desenlaces
    // POR FICHERO en el orden del lote — el primer fichero sin OCR,
    // el primer rechazo con SU código y SU mensaje (nunca los de un
    // gemelo del mismo nombre), los PDF vacíos de todos.
    const firstNoOcrImage = outcomes.find((o) => o.sink.noOcrImageNames.length > 0);
    if (firstNoOcrImage) {
      const name = firstNoOcrImage.sink.noOcrImageNames[0];
      throw new DocImportError(
        "imageNoOcr",
        `"${name}" is an image and this build has no OCR.`,
        { name }
      );
    }
    const firstOcrFailure = outcomes.find((o) => o.sink.ocrFailedNames.length > 0);
    if (firstOcrFailure) {
      const name = firstOcrFailure.sink.ocrFailedNames[0];
      // R-06 P5: el error nombrado conserva la huella del rechazo
      // (código y mensaje acotado del nativo) en sus vars y en su
      // mensaje de registro — es lo que separa «la llamada rechazó»
      // de «resolvió vacía» fuera del aparato.
      const detail = firstOcrFailure.sink.ocrErrorByName.get(name);
      throw new DocImportError(
        "ocrFailed",
        `"${name}" couldn't be read even with OCR${detail ? ` (${detail.code}: ${detail.message})` : ""}.`,
        detail ? { name, ocrCode: detail.code, ocrMessage: detail.message } : { name }
      );
    }
    // E6 (paso 3, D-3): si no entró nada y algún PDF fue rechazado,
    // el error de la importación es el código de ese rechazo — un
    // PDF con contraseña solo sigue nombrándose pdfPassword, como
    // en el móvil, en vez de disolverse en el genérico de vacío.
    const firstRejectedPdf = outcomes.find((o) => o.sink.rejectedPdfByName.size > 0);
    if (firstRejectedPdf) {
      const [name, code] = [...firstRejectedPdf.sink.rejectedPdfByName.entries()][0];
      throw new DocImportError(
        code,
        code === "pdfPassword"
          ? `"${name}" is password-protected - password-protected PDFs aren't supported.`
          : `Couldn't read "${name}".`,
        { name },
      );
    }
    // Acto 2: tras el PDF rechazado (que sigue nombrándose
    // primero, como hoy), si no entró nada y algún fichero fue
    // rechazado por no soportado, el error lleva su código.
    const firstRejectedUnsupported = outcomes.find((o) => o.sink.rejectedUnsupportedByName.size > 0);
    if (firstRejectedUnsupported) {
      const [name] = [...firstRejectedUnsupported.sink.rejectedUnsupportedByName.entries()][0];
      throw new DocImportError("unsupported", `"${name}" is in a format that isn't supported.`, { name });
    }
    const emptyPdfNames = outcomes.flatMap((o) => o.sink.emptyPdfNames);
    const code = emptyImportErrorCode(emptyPdfNames, ocrAvailable);
    throw new DocImportError(
      code,
      code === "scannedNoOcr"
        ? `"${emptyPdfNames[0]}" looks like a scanned PDF and this build has no OCR.`
        : "No text found in the selected files.",
      code === "scannedNoOcr" ? { name: emptyPdfNames[0] } : {}
    );
  }
  if (chunks.length > MAX_IMPORT_CHUNKS) {
    throw new DocImportError("tooManyChunks", `Too much text: ${chunks.length} chunks.`, {
      max: String(MAX_IMPORT_CHUNKS),
    });
  }

  // Desde aquí hay una importación en vuelo: este id queda
  // registrado para que la barrida de huérfanos de otra importación
  // no toque sus trozos (carril F-REV), y se desregistra al salir,
  // nazca o muera la importación — si muere, el catch de abajo ya
  // limpió sus trozos y su fila.
  inFlightCollectionIds.add(collectionId);
  try {
    // F3-17: antes de insertar, barrer los trozos huérfanos de una
    // importación anterior muerta a mitad. Best-effort: si la barrida
    // falla, la importación sigue y la próxima lo reintenta.
    await deleteOrphanCollectionChunks({
      lifecycleEpoch: runEpoch,
      excludeCollectionIds: [...inFlightCollectionIds],
    }).catch(() => {});
    // Adaptación del porte a la sede de PC (E6, paso 2): en el
    // móvil la fila de la colección nace tras insertar los trozos,
    // pero en PC chunks.collection_id es clave foránea y la
    // conexión la hace cumplir (secureDatabase: foreign_keys = ON),
    // así que aquí la fila nace ANTES de sus trozos, con su
    // sizeBytes provisional en 0; la medida de M-32 lo corrige en
    // su sitio tras insertar. Si la importación muere, el catch de
    // abajo borra la colección y sus trozos como en el móvil.
    // E6 (paso 7): el page_count de la colección es el del
    // documento paginado cuando el lote trae UNO solo con
    // páginas — el caso del contrato («128 páginas» en la
    // Biblioteca, «pág. 7 de 128» en el panel). Con varios
    // documentos paginados no hay un total del lote que sea el
    // de un documento: queda NULL y cada panel cae al máximo
    // de su propio documento.
    const paginatedDocs = accepted.filter((e) => (e.doc.pages?.length ?? 0) > 0);
    const collection: Omit<CustomCollection, "active" | "createdAt" | "lastAccessed"> = {
      id: collectionId,
      name: collectionName,
      sourceFilename: files.map((f) => f.name).join(", "),
      docCount: accepted.length,
      chunkCount: chunks.length,
      sizeBytes: 0,
      pageCount: paginatedDocs.length === 1 ? paginatedDocs[0].doc.pages!.length : null,
    };
    await createCustomCollection(collection, { lifecycleEpoch: runEpoch });
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({ stage: "embedding", chunkIndex: i, chunkCount: chunks.length });
      const chunk = chunks[i];
      // F4-2026-10-06: si el JSI de embedding no está disponible, insertar
      // sin embedding (FTS-only) en vez de fallar en duro.
      try {
        const embedding = await embeddingEngine.embedPassageTagged(`${chunk.title}\n${chunk.body}`);
        await insertChunk({ ...chunk, collectionId }, embedding.vector, {
          lifecycleEpoch: runEpoch,
          modelSha256: embedding.modelSha256,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/native embedding unavailable/i.test(msg)) throw err;
        await insertChunkWithoutEmbedding({ ...chunk, collectionId }, { lifecycleEpoch: runEpoch });
      }
    }

    // T-03 de la 0.1.99 (M-32): sizeBytes es lo que la colección
    // ocupa en la base (texto + copia FTS + vectores, medido sobre
    // lo recién insertado), no la suma de los ficheros fuente. Si la
    // medida fallara, el respaldo es el texto de los trozos por dos
    // (chunks + FTS) sin vectores: una cota baja honesta, nunca el
    // tamaño del fichero del selector.
    const measured = await measureCollectionStoredBytes(collectionId).catch(() => -1);
    const storedSizeBytes =
      measured >= 0
        ? measured
        : chunks.reduce(
            (sum, c) =>
              sum + 2 * (new TextEncoder().encode(c.title).length + new TextEncoder().encode(c.body).length),
            0
          );
    await setCustomCollectionSizeBytes(collectionId, storedSizeBytes, {
      lifecycleEpoch: runEpoch,
    });
    // C-06 + H-11: con la colección ya nacida, se registran las
    // huellas de lo que entró y se persisten los avisos del lote —
    // dentro del mismo try: si el ciclo de vida murió a mitad, el
    // catch borra la colección y la cascada se lleva ambas filas.
    const fingerprintRows: DocFingerprintRow[] = [];
    accepted.forEach((entry, i) => {
      if (entry.fingerprint) {
        fingerprintRows.push({
          docId: acceptedDocIds[i],
          fingerprint: entry.fingerprint,
          fileName: entry.fileName,
          kind: force ? "forced" : "import",
        });
      }
    });
    await recordCollectionDocFingerprints(collectionId, fingerprintRows, {
      lifecycleEpoch: runEpoch,
    });
    await recordImportWarnings(
      collectionId,
      outcomes.map((o) => o.name),
      importWarnings,
      { lifecycleEpoch: runEpoch }
    );
  } catch (e) {
    // Half-imported chunks had no collection row: invisible in search but
    // taking space forever. Remove them (best-effort) and report the error.
    await deleteCustomCollection(collectionId).catch(() => {});
    throw e;
  } finally {
    inFlightCollectionIds.delete(collectionId);
  }

  // T-03 de la 0.1.99 (M-32): la cuota de documentos se aplica tras
  // cada importación con éxito — hasta esta versión
  // enforceStorageBudget no tenía ningún llamador y la base de
  // conocimiento crecía sin tope, lote a lote. Best-effort y FUERA
  // del try de arriba a propósito: un fallo al expulsar no debe
  // deshacer una importación ya nacida; la próxima pasada lo
  // reintenta. La colección recién creada va protegida en esta
  // pasada (si ella sola pasara del tope, la expulsará la siguiente
  // ya asentada, no el gesto que la trajo).
  await enforceStorageBudget(DEFAULT_DOC_STORAGE_BUDGET_BYTES, {
    protectIds: [collectionId],
  }).catch(() => {});

  const [created] = (await listCustomCollections()).filter((c) => c.id === collectionId);
  return { ...created, importWarnings };
}

export { listCustomCollections, setCustomCollectionActive, deleteCustomCollection };

/**
 * Exports a collection back out as JSON in the same {title, source, body}[]
 * shape as the app's own downloadable corpus packs - portable, small, and
 * re-embeddable by any instance of the app regardless of embedding model
 * version. Not a raw .sqlite/.db export: that would bake in this device's
 * specific embedding vectors, which are meaningless (or wrong-dimension) on
 * a phone running a different embedding model. Hands off to the OS share
 * sheet so the user picks the transport (Bluetooth, Nearby Share, a file
 * manager, etc.) themselves.
 */
/**
 * SEC-04: exportaciones de colección vivas en ESTE proceso. El JSON de
 * exportCollection lleva el texto completo de la colección y vive en la
 * caché; si el proceso muere con la hoja de compartir abierta, su finally
 * no corre y el JSON en claro queda huérfano hasta que Android limpie la
 * caché. El prefijo reservado `nido-export-` hace identificable todo
 * huérfano futuro, este registro protege una exportación en curso, y
 * sweepOrphanedCollectionExports() (abajo) recoge al arrancar lo que un
 * proceso anterior dejó.
 */
const liveCollectionExports = new Set<string>();

export async function exportCollection(collection: CustomCollection): Promise<void> {
  const docs = await getCollectionDocs(collection.id);
  const json = JSON.stringify(docs, null, 2);
  const cacheDir = importCacheDir?.() ?? null;
  if (!cacheDir) throw new Error("Sharing isn't available on this device");
  const path = `${cacheDir}nido-export-${slug(collection.name)}.json`;
  liveCollectionExports.add(path);
  await writeFile(path, json, "utf8");

  try {
    if (collectionShare) {
      await collectionShare(path, collection);
    } else {
      throw new Error("Sharing isn't available on this device");
    }
  } finally {
    liveCollectionExports.delete(path);
    // El JSON exportado puede contener documentos del usuario: no dejarlo
    // en caché tras compartir (el usuario ya eligió el destino).
    await rm(path, { force: true }).catch(() => {});
  }
}

/** Nombres de caché que el barrido conserva siempre (telemetría de ejecución: solo metadatos, por su diseño). */
const CACHE_SWEEP_KEEP = new Set(["execution_telemetry.json"]);

/**
 * SEC-04: barrido de exportaciones huérfanas al arrancar. Borra los *.json
 * de nivel superior de la caché que ningún proceso vivo posee: por el
 * censo cerrado de escritores de caché en release (exportCollection,
 * exportExecutionTelemetry de nombre fijo — conservado — y las copias del
 * selector de documentos, que no son *.json de nivel superior), todo *.json
 * de un proceso anterior es un resto sin dueño: su único dueño era el
 * finally de la exportación que lo escribió. Nunca entra en
 * subdirectorios, respeta el registro de vivas y traga los errores por
 * fichero; una caché ilegible devuelve 0. Devuelve cuántos borró.
 */
export async function sweepOrphanedCollectionExports(): Promise<number> {
  const cacheDir = importCacheDir?.() ?? null;
  if (!cacheDir) return 0;
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const name of names) {
    if (!name.endsWith(".json") || CACHE_SWEEP_KEEP.has(name)) continue;
    const path = `${cacheDir}${name}`;
    if (liveCollectionExports.has(path)) continue;
    try {
      const info = await stat(path);
      if (info.isDirectory()) continue;
      await rm(path, { force: true });
      deleted++;
    } catch {
      // Por fichero: un resto que no se puede borrar no bloquea el resto.
    }
  }
  return deleted;
}
