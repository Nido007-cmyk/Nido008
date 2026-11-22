/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * packImporter.ts — la puerta firmada de importación de paquetes,
 * la pieza real. El paso 7 de E5 completa aquí el sustituto fiel
 * que J-5 dejó firmado en su apertura (§3.4 de
 * estudios/E3-J5-APERTURA.md), con el orden PI-2 entero de la
 * etapa (§2.1 de estudios/PAQUETES-ETAPA.md) sobre la copia
 * elegida, la retirada de importados (PI-4) y la acreditación
 * entera del sustituto contra la frase rebajada del dirimen
 * J5S-1 (forma (b), cobrada en el paso 2 del bloque puerta de
 * E5): la declaración de sustituto sale del fichero con esta
 * recreación, y ningún informe posterior lo llamará sustituto.
 *
 * La puerta no copia ni abre nada hasta que todas las
 * comprobaciones pasan, en este orden y sin saltarse ningún
 * escalón, sobre la copia elegida:
 *
 *   0. Tope de tamaño antes de cualquier trabajo: el fichero
 *      ofrecido no pasa de PACK_IMPORT_MAX_BYTES, comprobado
 *      antes de hashear o copiar.
 *   1. Manifiesto compañero legible: `<pack>.sqlite.json`
 *      junto a la copia, parseado por parsePackManifest; un
 *      manifiesto ilegible es un manifiesto ausente.
 *   2. Huella exacta: la del fichero es exactamente la que el
 *      manifiesto declara; un solo byte cambiado cae aquí, en
 *      `hash-mismatch`.
 *   3. Origen probado, una de dos, sin tercera vía ni
 *      confianza por primer uso (verifyPackOrigin, el núcleo
 *      de models/packImport.ts): SALVORA PACKS, por la firma
 *      Ed25519 verificada contra la clave incrustada (el
 *      manifiesto nunca elige su propio ancla; si trae campos
 *      de firma, se juzga solo por la firma); o NIDO, porque
 *      su SHA-256 es un pin exacto del catálogo firmado. Y la
 *      guarda del nombre de catálogo (auditoría 0.1.93 de la
 *      fuente): un nombre de fichero del catálogo solo lo
 *      ocupan los bytes de esa entrada; unos bytes verificados
 *      con otro origen bajo ese nombre caen en `hash-mismatch`.
 *   4. Formato de paquete (summarizePackMeta, el mismo
 *      criterio que openPack al abrir).
 *   5. Esquema interno y topes (validatePackSchema): las
 *      tablas y columnas que los lectores consultan, al menos
 *      un fragmento de contenido y ningún conteo sobre su tope.
 *
 * Tras las cinco comprobaciones: confirmación de la persona
 * con el origen nombrado, como costura inyectable (la UI la
 * aporta la carcasa, cableada en el paso 8 de la etapa por el
 * canal de importación de paquetes; el servicio no sabe de
 * diálogos), promoción por renombrado (copia al nombre
 * `.part` dentro de corpus/ y renombrado al nombre final: un
 * corte a mitad no deja paquete, y la edición anterior sigue
 * sirviendo hasta el renombrado), asiento en el registro de
 * importados y asiento en el diario de instalación con los
 * bytes ya verificados. Esta pieza es el primer llamante de
 * producción de writeImportedPacks: la puerta escribe el
 * asiento al importar y lo borra al retirar, por esa función
 * y no por una escritura paralela. Duplicados definidos,
 * nunca silenciosos: los mismos bytes verificados ya en su
 * sitio = `already-imported`, sin tocar el fichero ni el
 * registro; bytes distintos verificados bajo el mismo nombre
 * = edición actualizada, con la misma confirmación que
 * cualquier importación.
 *
 * La retirada de un importado (PI-4) borra las tres cosas en
 * el mismo acto: el fichero, su asiento en el registro y su
 * asiento en el diario. Sin registro no es un paquete, y
 * re-añadirlo después funciona como la primera vez.
 *
 * La marca de un importado (verifiedImportedPacks, la
 * superficie que la vía literal consume) se decide en la
 * puerta de apertura (packTrust.packFileState) contra el
 * asiento, en el momento de leer, con la regla de la fuente
 * (packImporter.ts:164 del móvil):
 *
 *   - lectura fresca del registro en cada llamada;
 *   - un asiento bajo nombre de fichero del catálogo no se
 *     reporta: el fichero se presenta como el ítem del catálogo;
 *   - un asiento cuyo fichero ya no está en corpus/ no se
 *     reporta (asiento rancio);
 *   - la marca se decide en la puerta de apertura contra el
 *     asiento: la entrada que knowledgePacks() construye desde
 *     el asiento debe dar «current». Lo que esa puerta cobra en
 *     su vía «current» es el TAMAÑO contra el pin del asiento
 *     (y la sola presencia cuando el asiento trae
 *     `sizeBytes` ≤ 0), fiel al móvil: una sustitución de otro
 *     tamaño pierde la marca como pierde el derecho a abrir, y
 *     una del mismo tamaño la conserva por la vía rápida. El
 *     dirimen de esta frase es del bloque puerta de E5 (paso
 *     2, partida J5S-1): la frase baja a lo que la puerta
 *     cobra, con el riesgo residual declarado en aquel
 *     asiento (su precondición es escritura local sobre el
 *     directorio de datos); esta recreación hereda el dirimen
 *     y no lo reabre;
 *   - si el registro no se lee, el fail-closed del registro da
 *     vacío: solo integrados, y la ruta de importados no se
 *     abre por la caída.
 *
 * Adaptaciones de PC asentadas: el sistema de ficheros es el
 * de Node y la raíz es la costura del directorio de datos
 * (src/models/dataDir.ts); la meta y el esquema de la copia
 * elegida se leen con node:sqlite en solo lectura, la misma
 * vía con la que el lector abre los paquetes; el diario es el
 * propio de paquetes (corpus/pack-install-records.json, el
 * que packTrust.ts lee y packDownloader.ts escribe); y la
 * copia elegida no se mueve de donde la persona la tiene: se
 * copia al nombre temporal y se promueve por renombrado,
 * donde la fuente mueve su copia de caché del selector.
 */
import { statSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256OfFile } from "../core/loadPath.js";
import { CORPUS_CATALOG, type PackCatalogEntry } from "../models/packCatalog.js";
import { getPacksDataDir, packsDataPath } from "../models/dataDir.js";
import {
  readImportedPacks,
  writeImportedPacks,
  type ImportedPackRecord,
} from "../models/importedPacksRegistry.js";
import {
  parsePackManifest,
  summarizePackMeta,
  validatePackSchema,
  verifyPackOrigin,
  PACK_IMPORT_MAX_BYTES,
  SALVORA_PACKS_PUBLIC_KEY_BASE64,
  type PackMetaSummary,
  type PackOrigin,
  type PackSchemaDescriptor,
} from "../models/packImport.js";
import { packFileState } from "../models/packTrust.js";
import { closePack } from "../rag/packs.js";

const CORPUS_DIR = "corpus/";

export interface ImportedPackItem {
  filename: string;
  /** Display name: the pack's own meta.name when it declares one. */
  name: string;
  origin: PackOrigin;
  sizeBytes: number;
  sha256: string;
  /**
   * 0.1.87: the embedding model the pack was built with (its
   * meta.embeddingModelSha256), read when the list is built so the
   * surface can warn when it is not the active search model.
   * Undefined when the pack's meta cannot be read.
   */
  embeddingModelSha256?: string;
}

export type PackImportRejectionReason =
  | "missing-manifest"
  | "hash-mismatch"
  | "not-signed-by-us"
  | "not-a-pack"
  | "damaged"
  | "too-large";

export type PackImportOutcome =
  | { status: "imported"; item: ImportedPackItem }
  | { status: "already-imported"; item: ImportedPackItem }
  | { status: "cancelled" }
  | { status: "rejected"; reason: PackImportRejectionReason };

/** The id knowledgePacks() gives a non-catalog pack file (rag/packs.ts). */
const localPackId = (filename: string) => `local-${filename.replace(/\.sqlite$/, "")}`;

function catalogEntryForFilename(filename: string): PackCatalogEntry | undefined {
  return CORPUS_CATALOG.find((c) => c.filename === `${CORPUS_DIR}${filename}`);
}

/** The entry knowledgePacks() fabricates for a local pack file. */
function localPackEntry(filename: string): PackCatalogEntry {
  return (
    catalogEntryForFilename(filename) ?? {
      id: localPackId(filename),
      kind: "corpus",
      format: "sqlite-pack",
      label: filename,
      filename: `${CORPUS_DIR}${filename}`,
      sizeBytes: 0,
      sha256: "",
      sourceUrl: "",
      license: "",
      description: "",
      required: false,
    }
  );
}

function sameSha(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ---------------------------------------------------------------------------
// El diario de instalación de paquetes (corpus/pack-install-records.json):
// la prueba que la instalación deja de unos bytes concretos, en la misma
// forma que packDownloader.ts escribe y packTrust.ts lee. La puerta de
// fichero asienta en él al importar y borra su asiento al retirar (PI-4).
// ---------------------------------------------------------------------------

const INSTALL_RECORDS_NAME = "pack-install-records.json";

interface PackInstallRecord {
  sizeBytes: number;
  sha256: string;
  mtimeMs: number | null;
  filename: string;
}

function installRecordsPath(): string {
  return join(getPacksDataDir(), "corpus", INSTALL_RECORDS_NAME);
}

async function readInstallRecords(): Promise<Record<string, PackInstallRecord>> {
  try {
    const parsed = JSON.parse(await readFile(installRecordsPath(), "utf8")) as Record<
      string,
      PackInstallRecord
    >;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Sin diario todavía: el primer asiento lo nace.
  }
  return {};
}

async function writeInstallRecords(records: Record<string, PackInstallRecord>): Promise<void> {
  const path = installRecordsPath();
  mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(records, null, 2));
}

/** El asiento del diario tras una promoción verificada, con su mtime. */
async function seatInstallRecord(id: string, record: PackInstallRecord): Promise<void> {
  const records = await readInstallRecords();
  records[id] = record;
  await writeInstallRecords(records);
}

/** PI-4: la retirada borra también el asiento del diario. */
async function clearInstallRecord(id: string): Promise<void> {
  const records = await readInstallRecords();
  if (records[id]) {
    delete records[id];
    await writeInstallRecords(records);
  }
}

// ---------------------------------------------------------------------------
// Registry of what this door verified (origin marks live here, nowhere else).
// The read/write itself lives in models/importedPacksRegistry.ts, shared
// with the engine (M-35): the same record that carries the origin mark is
// the pack's pin at open time.
// ---------------------------------------------------------------------------

/**
 * Packs the signed door verified whose bytes still verify right
 * now, keyed by pack id (`local-<file base>`), with the name and
 * origin the door recorded. Read fresh on every call: the literal
 * route's authority set for imported guides (M-35).
 */
export async function verifiedImportedPacks(): Promise<Map<string, { name: string; origin: PackOrigin }>> {
  const out = new Map<string, { name: string; origin: PackOrigin }>();
  const registry = await readImportedPacks();
  for (const [filename, record] of Object.entries(registry)) {
    // A record under a catalog file name is not an import: the
    // file presents as the catalog entry (same rule as
    // knowledgePacks in rag/packs.ts).
    if (CORPUS_CATALOG.some((c) => c.filename === `${CORPUS_DIR}${filename}`)) continue;
    let exists = false;
    try {
      exists = statSync(packsDataPath(`${CORPUS_DIR}${filename}`)).isFile();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    // The entry built FROM the record, exactly as knowledgePacks
    // builds it: the record's verified pair is the pack's pin.
    const entry: PackCatalogEntry = {
      id: `local-${filename.replace(/\.sqlite$/, "")}`,
      kind: "corpus",
      format: "sqlite-pack",
      label: record.name || filename,
      filename: `${CORPUS_DIR}${filename}`,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      sourceUrl: "",
      license: "",
      description: "",
      required: false,
    };
    const state = await packFileState(entry).catch(() => "unusable" as const);
    if (state !== "current") continue;
    out.set(entry.id, { name: record.name || filename, origin: record.origin });
  }
  return out;
}

/**
 * Packs this door imported and verified, still on disk. A pack whose file
 * name is a catalog file name is NOT listed here: it presents as the
 * catalog item it byte-for-byte is, in the downloadable packs list.
 */
export async function listImportedPacks(): Promise<ImportedPackItem[]> {
  const registry = await readImportedPacks();
  const items: ImportedPackItem[] = [];
  for (const [filename, record] of Object.entries(registry)) {
    if (catalogEntryForFilename(filename)) continue;
    let path: string;
    let size: number;
    try {
      path = packsDataPath(`${CORPUS_DIR}${filename}`);
      const info = statSync(path);
      if (!info.isFile()) continue;
      size = info.size;
    } catch {
      // Sin fichero (o con un nombre que la contención rechaza): no se lista.
      continue;
    }
    // La huella de embeddings del pack, de su propia meta, para el
    // aviso de otro modelo en la superficie. Una meta ilegible deja
    // el campo vacío y el aviso calla: no se afirma un desajuste
    // que no se puede leer.
    const meta = readPackMeta(path);
    const embeddingModelSha256 = meta ? summarizePackMeta(meta)?.embeddingModelSha256 : undefined;
    items.push({
      filename,
      name: record.name,
      origin: record.origin,
      sizeBytes: size,
      sha256: record.sha256,
      ...(embeddingModelSha256 ? { embeddingModelSha256 } : {}),
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/** Reads a chosen file's meta table in read-only mode, the packs.ts way. */
function readPackMeta(path: string): Record<string, string> | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("SELECT key, value FROM meta").all() as Array<{
      key: string;
      value: string;
    }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ya cerrado o nunca abierto: la lectura ya dio su veredicto.
    }
  }
}

/**
 * A chosen file's internal schema (which tables exist, their columns,
 * and the content row counts) for the door's step 5, read like
 * readPackMeta. Null when the file cannot be opened as a database at
 * all; a table the PRAGMA finds no columns for simply does not exist.
 */
function readPackSchema(path: string): PackSchemaDescriptor | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const database = db;
    const tables: Record<string, string[]> = {};
    for (const table of ["meta", "chunks", "guides", "regions", "facts"]) {
      const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length > 0) tables[table] = cols.map((c) => c.name);
    }
    const count = (table: string): number => {
      if (!tables[table]) return 0;
      const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
        | { n: number }
        | undefined;
      return row && Number.isFinite(row.n) ? row.n : 0;
    };
    return {
      tables,
      counts: {
        chunks: count("chunks"),
        guides: count("guides"),
        regions: count("regions"),
        facts: count("facts"),
      },
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ya cerrado o nunca abierto: la lectura ya dio su veredicto.
    }
  }
}

/**
 * Runs the whole door over the chosen copy: its companion manifest
 * (`<pack>.sqlite.json`, beside the copy — the store's download brings
 * them side by side), the five PI-2 checks in their order, the person's
 * confirmation, and promotion by rename into the packs folder.
 * `confirm` is the surface's dialog seam: it receives the verified
 * origin and resolves true only when the person accepts; nothing is
 * copied before it resolves true, and a rejection never copies either.
 *
 * The optional third parameter is the same test seam as in the pure
 * core (models/packImport.ts): unit tests inject a fixture key
 * generated in memory so signature acceptance is covered everywhere,
 * without the store's real zips. Production callers never pass it —
 * the default is the embedded key and the behavior is identical.
 */
export async function importPackFromFile(
  sourcePath: string,
  confirm: (origin: PackOrigin) => Promise<boolean>,
  trustedPublicKeyBase64: string = SALVORA_PACKS_PUBLIC_KEY_BASE64
): Promise<PackImportOutcome> {
  const filename = basename(sourcePath);
  if (!filename.toLowerCase().endsWith(".sqlite")) {
    return { status: "rejected", reason: "not-a-pack" };
  }

  // PI-2 · 0 — the size cap is checked before any hashing or copying work.
  const pickedInfo = await stat(sourcePath).catch(() => null);
  if (!pickedInfo?.isFile() || pickedInfo.size <= 0) {
    return { status: "rejected", reason: "damaged" };
  }
  const sizeBytes = pickedInfo.size;
  if (sizeBytes > PACK_IMPORT_MAX_BYTES) return { status: "rejected", reason: "too-large" };

  // PI-2 · 1 — manifest present and legible.
  const manifestText = await readFile(`${sourcePath}.json`, "utf8").catch(() => null);
  const manifest = manifestText ? parsePackManifest(manifestText) : null;
  if (!manifest) return { status: "rejected", reason: "missing-manifest" };

  // PI-2 · 2+3 — hash, then origin (the pure core, models/packImport.ts).
  const fileSha256 = await sha256OfFile(sourcePath).catch(() => null);
  if (!fileSha256) return { status: "rejected", reason: "damaged" };
  const originResult = verifyPackOrigin(manifest, fileSha256, trustedPublicKeyBase64);
  if (!originResult.ok) return { status: "rejected", reason: originResult.reason };
  const origin = originResult.origin;

  // Auditoría 0.1.93 de la fuente: el nombre del archivo lo pone quien
  // lo entrega y no va atado a la firma. Un pack verificado pero
  // RENOMBRADO con el nombre de un pack del catálogo (otro pack
  // firmado, u otro pin del catálogo) habría sustituido al del
  // catálogo en disco y se habría presentado como él («presents as
  // the catalog item it byte-for-byte is»), fuera de la lista de
  // añadidos. Un nombre del catálogo solo lo puede ocupar el archivo
  // cuya huella es la de ESA entrada.
  const catalogSlot = catalogEntryForFilename(filename);
  if (catalogSlot && !sameSha(catalogSlot.sha256, fileSha256)) {
    return { status: "rejected", reason: "hash-mismatch" };
  }

  // PI-2 · 4 — the same format acceptance openPack applies.
  const meta = readPackMeta(sourcePath);
  if (!meta) return { status: "rejected", reason: "damaged" };
  const summary: PackMetaSummary | null = summarizePackMeta(meta);
  if (!summary) return { status: "rejected", reason: "not-a-pack" };

  // PI-2 · 5 (M-35/m-91) — the internal schema, not just the meta: the
  // tables and columns the readers query, at least one chunk of
  // content, and the row caps. A signed file whose schema is broken
  // would pass every check above and then fail inside the app pack by
  // pack; here it is simply not a pack.
  const schema = readPackSchema(sourcePath);
  if (!schema || !validatePackSchema(summary.formatVersion, schema)) {
    return { status: "rejected", reason: "not-a-pack" };
  }

  // Duplicates are defined, never silent: the same verified bytes
  // already in place are simply already imported; different verified
  // bytes under the same file name replace the old pack (an updated
  // edition), after the same confirmation as any import.
  const registry = await readImportedPacks();
  const targetPath = packsDataPath(`${CORPUS_DIR}${filename}`);
  const targetInfo = await stat(targetPath).catch(() => null);
  const existing = registry[filename];
  if (existing && targetInfo?.isFile() && sameSha(existing.sha256, fileSha256)) {
    return {
      status: "already-imported",
      item: { filename, name: existing.name, origin: existing.origin, sizeBytes, sha256: fileSha256 },
    };
  }

  if (!(await confirm(origin))) return { status: "cancelled" };

  // Promotion at the end, by rename — a cut mid-copy leaves no pack:
  // the chosen copy is copied to the `.part` name inside corpus/ and
  // only the rename puts verified bytes under the final name; the
  // previous edition, if any, keeps serving until that rename.
  const model = localPackEntry(filename);
  await closePack(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await closePack(localPackId(filename)).catch(() => {});
  await mkdir(dirname(targetPath), { recursive: true });
  const partPath = `${targetPath}.part`;
  await rm(partPath, { force: true });
  await copyFile(sourcePath, partPath);
  if (targetInfo?.isFile()) await rm(targetPath, { force: true });
  await rename(partPath, targetPath);

  const record: ImportedPackRecord = {
    origin,
    sha256: fileSha256,
    sizeBytes,
    name: summary.name ?? (typeof manifest.id === "string" ? manifest.id : filename),
    importedAt: new Date().toISOString(),
  };
  registry[filename] = record;
  await writeImportedPacks(registry);
  // El asiento del diario con los bytes ya verificados:
  // deja la prueba de instalación (tamaño, huella y mtime
  // de estos bytes) para que, si el pin que juzga al
  // fichero se mueve algún día, la vía «outdated» pueda
  // acreditar estos bytes por su mtime o por re-hash
  // contra la prueba. Best effort como toda escritura del
  // diario: sin el asiento no hay prueba que consultar, la
  // vía «outdated» no puede probar nada y la apertura
  // decide por tamaño contra el pin vigente, sin re-hash
  // alguno.
  const placed = await stat(targetPath).catch(() => null);
  await seatInstallRecord(model.id, {
    sizeBytes,
    sha256: fileSha256,
    mtimeMs: placed?.isFile() ? placed.mtimeMs : null,
    filename: `${CORPUS_DIR}${filename}`,
  }).catch(() => {});
  return {
    status: "imported",
    item: { filename, name: record.name, origin, sizeBytes, sha256: fileSha256 },
  };
}

/**
 * PI-4: removing an imported pack deletes its file (it disappears from
 * the list and from search results: without its registry record it is
 * not a pack at all, M-35) and drops its origin record and its install
 * journal seat. Re-adding the same file afterwards works exactly like
 * the first time.
 */
export async function removeImportedPack(filename: string): Promise<void> {
  const model = localPackEntry(filename);
  await closePack(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await closePack(localPackId(filename)).catch(() => {});
  await rm(packsDataPath(`${CORPUS_DIR}${filename}`), { force: true });
  await clearInstallRecord(model.id).catch(() => {});
  if (model.id !== localPackId(filename)) await clearInstallRecord(localPackId(filename)).catch(() => {});
  const registry = await readImportedPacks();
  if (registry[filename]) {
    delete registry[filename];
    await writeImportedPacks(registry);
  }
}
