/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packSection.ts — la derivación de la sección de paquetes de
 * Ajustes (paso 8 de E5): compone, en cada llamada y sin caché
 * de filas, la lista unificada que la sección enseña, desde las
 * tres fuentes que ya existen en la casa:
 *
 *   - el catálogo firmado (PACK_CATALOG), listado tal como el
 *     catálogo lo da, sin fusionar parejas de variantes: qué
 *     variante sirve en la búsqueda lo gobierna el lector, no
 *     esta vista;
 *   - el registro de importados por fichero (readImportedPacks,
 *     fail-closed en su fuente: sin asiento no hay paquete,
 *     M-35 en la vista);
 *   - el disco y la puerta de apertura (packFileState), que es
 *     la única fuente que juzga el estado de unos bytes.
 *
 * Ninguna enumeración cerrada de familias ni de orígenes vive
 * aquí: se itera el catálogo entero y el registro entero, para
 * que una familia nueva entre por su entrada sin tocar esta
 * pieza. La lista del lector (knowledgePacks) no se reusa como
 * vista: es la lista de lectura del motor, sin estado ni
 * oferta.
 *
 * Las acciones no nacen aquí: se cablean a los servicios
 * acreditados de la puerta (downloadPack, importPackFromFile,
 * removeImportedPack) tras una costura inyectable para su
 * batería, con la puerta real por defecto.
 */
import { statSync } from "node:fs";
import { PACK_CATALOG, type PackCatalogEntry } from "../models/packCatalog.js";
import { packsDataPath } from "../models/dataDir.js";
import { readImportedPacks } from "../models/importedPacksRegistry.js";
import { PACK_ORIGIN_LABEL, type PackOrigin } from "../models/packImport.js";
import { packFileState } from "../models/packTrust.js";
import { salvoraNote, type SupportLang } from "../content/support.js";
import { activeEmbeddingModel } from "../rag/embeddingSwitch.js";
import { downloadPack, type PackDownloadResult } from "./packDownloader.js";
import {
  importPackFromFile,
  listImportedPacks,
  removeImportedPack,
  verifiedImportedPacks,
  type ImportedPackItem,
  type PackImportOutcome,
} from "./packImporter.js";

export type { PackImportOutcome };

/** El estado de una fila, en la letra de la listeza del paso. */
export type PackRowState =
  | "current" // al día, por la puerta de apertura
  | "outdated" // versión anterior en uso, con actualizar disponible
  | "available" // de catálogo, sin fichero: ofrece instalar
  | "unusable" // fichero presente que no acredita: no se presenta como instalado
  | "imported"; // importado por fichero, presente en su registro

export interface PackSectionRow {
  kind: "catalog" | "imported";
  /** La entrada de catálogo o el nombre de fichero del importado. */
  key: string;
  name: string;
  origin: PackOrigin;
  /** El origen como la interfaz lo nombra («NIDO», «SALVORA PACKS»). */
  originLabel: string;
  /** La edición de la entrada (su licencia); null en importados. */
  edition: string | null;
  state: PackRowState;
  canInstall: boolean;
  /** Quitar existe solo en filas importadas (PI-4). */
  canRemove: boolean;
  /** La ruta del fichero tal como el catálogo o el registro la nombran. */
  filename: string;
  /** La marca de importación del asiento; null en filas de catálogo. */
  importedAt: string | null;
  /** La marca de verificado vigente del importado; null en catálogo. */
  verified: boolean | null;
  /**
   * El aviso de otro modelo de embeddings del ítem importado (la
   * huella de su meta cuando difiere del modelo de búsqueda
   * activo): es un aviso de la fila, no un estado.
   */
  embeddingWarning: string | null;
  entry: PackCatalogEntry | null;
  item: ImportedPackItem | null;
}

const CORPUS_DIR = "corpus/";

/** The id knowledgePacks() gives a non-catalog pack file (rag/packs.ts). */
const localPackId = (filename: string) => `local-${filename.replace(/\.sqlite$/, "")}`;

function filePresent(filename: string): boolean {
  try {
    return statSync(packsDataPath(filename)).isFile();
  } catch {
    return false;
  }
}

/**
 * La lista unificada de la sección, derivada en esta llamada:
 * una fila por paquete, sin duplicar (un asiento bajo nombre de
 * catálogo no produce fila de importado: el fichero se presenta
 * como el ítem del catálogo), con la procedencia de su fuente y
 * el estado recomputado de la puerta de apertura.
 */
export async function derivePackSectionRows(
  catalog: readonly PackCatalogEntry[] = PACK_CATALOG,
): Promise<PackSectionRow[]> {
  const rows: PackSectionRow[] = [];
  for (const entry of catalog) {
    let state: PackRowState = "available";
    if (filePresent(entry.filename)) {
      const judged = await packFileState(entry);
      state = judged === "current" ? "current" : judged === "outdated" ? "outdated" : "unusable";
    }
    rows.push({
      kind: "catalog",
      key: entry.id,
      name: entry.label,
      origin: "nido",
      originLabel: PACK_ORIGIN_LABEL.nido,
      edition: entry.license,
      state,
      canInstall: state !== "current",
      canRemove: false,
      filename: entry.filename,
      importedAt: null,
      verified: null,
      embeddingWarning: null,
      entry,
      item: null,
    });
  }
  // Los importados salen de la pieza que ya lista para la
  // superficie (listImportedPacks: sin fichero no hay fila, y un
  // nombre de catálogo no se lista como importado), con su marca
  // de verificado de la misma puerta que consume la vía literal
  // y su fecha del asiento del registro.
  const [items, verified, registry] = await Promise.all([
    listImportedPacks(),
    verifiedImportedPacks(),
    readImportedPacks(),
  ]);
  let activeSha: string | null = null;
  if (items.some((i) => i.embeddingModelSha256)) {
    activeSha = (await activeEmbeddingModel().catch(() => null))?.sha256 ?? null;
  }
  for (const item of items) {
    rows.push({
      kind: "imported",
      key: item.filename,
      name: item.name,
      origin: item.origin,
      originLabel: PACK_ORIGIN_LABEL[item.origin],
      edition: null,
      state: "imported",
      canInstall: false,
      canRemove: true,
      filename: `${CORPUS_DIR}${item.filename}`,
      importedAt: registry[item.filename]?.importedAt ?? null,
      verified: verified.has(localPackId(item.filename)),
      embeddingWarning:
        item.embeddingModelSha256 && activeSha && item.embeddingModelSha256 !== activeSha
          ? item.embeddingModelSha256
          : null,
      entry: null,
      item,
    });
  }
  return rows;
}

/** La puerta tras su costura: la real por defecto, una doble en batería. */
export interface PackSectionDoor {
  download: (entry: PackCatalogEntry) => Promise<PackDownloadResult>;
  importFile: (
    sourcePath: string,
    confirm: (origin: PackOrigin) => Promise<boolean>,
    trustedPublicKeyBase64?: string,
  ) => Promise<PackImportOutcome>;
  remove: (filename: string) => Promise<void>;
}

const realDoor: PackSectionDoor = {
  download: downloadPack,
  importFile: importPackFromFile,
  remove: removeImportedPack,
};

/**
 * Instalar (o actualizar) una fila de catálogo: pasa la entrada
 * exacta de la fila a la puerta de descarga, que verifica contra
 * el pin y asienta en el diario. Un fallo llega como el rechazo
 * que la puerta lanza; la fila se re-deriva tras el acto.
 */
export async function installPackRow(
  row: PackSectionRow,
  door: PackSectionDoor = realDoor,
): Promise<PackDownloadResult> {
  if (row.kind !== "catalog" || !row.entry) {
    throw new Error("pack-row-not-installable");
  }
  return door.download(row.entry);
}

/**
 * Añadir un paquete desde un fichero, por la puerta entera: la
 * confirmación recibe el origen ya verificado y lo nombra antes
 * de copiar nada; su no devuelve `cancelled` sin tocar un byte.
 */
export async function importPackRow(
  sourcePath: string,
  confirm: (origin: PackOrigin) => Promise<boolean>,
  door: PackSectionDoor = realDoor,
  trustedPublicKeyBase64?: string,
): Promise<PackImportOutcome> {
  return door.importFile(sourcePath, confirm, trustedPublicKeyBase64);
}

/**
 * Quitar un importado, con sus tres borrados de PI-4. En filas
 * de catálogo la acción no existe: devuelve false sin tocar
 * nada (la puerta no tiene retirada de paquetes de catálogo y
 * la superficie no la inventa).
 */
export async function removePackRow(
  row: PackSectionRow,
  door: PackSectionDoor = realDoor,
): Promise<boolean> {
  if (row.kind !== "imported" || !row.canRemove) return false;
  await door.remove(row.key);
  return true;
}

/**
 * La nota de SALVORA como texto de esta sección (su segunda
 * sede): se sirve de la fuente única, carácter a carácter; la
 * sección no guarda una segunda copia del texto.
 */
export function packSectionNote(lang: SupportLang): string {
  return salvoraNote(lang);
}
