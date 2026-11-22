/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La biblioteca local: el censo de lo que hay en disco, en
 * el núcleo compartido. Su sede y su diseño viven en
 * estudios/MODELOS-ETAPA.md §3.2: censo por enumeración del
 * manifiesto (nunca por barrido del directorio), tres
 * verdades distintas (¿existe?, ¿cuánto ocupa?, ¿es lo que
 * dice ser?) y desconocido nunca disfrazado de roto.
 *
 * Este fichero nace en el paso 2 de E4 con solo el tipo del
 * estado de disco, porque la derivación de tarjetas
 * (src/core/modelCards.ts) lo consume; el censo mismo
 * (censusModels y censusAssets) llega en el paso 3, en este
 * mismo fichero.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DESKTOP_CATALOG, type CatalogEntry } from "./catalog.js";
import {
  ASSET_CATALOG,
  assetStepName,
  assetTempName,
  isLooseAsset,
  type AssetEntry,
} from "./assetCatalog.js";
import { sha256OfFile } from "./loadPath.js";

/**
 * El estado de una entrada en disco. `installed` con
 * `verified: false` es «bytes completos, huella no
 * comprobada»: no es un tercer estado de error, es la
 * verdad de lo que se sabe. `partial` son bytes que no
 * llegan al tamaño declarado: un temporal vivo o un resto.
 * `checking` es el instante de la enumeración.
 */
export type DiskState =
  | { kind: "absent" }
  | { kind: "checking" }
  | { kind: "installed"; bytes: number; verified: boolean; source: "scan" | "post-download" }
  | { kind: "partial"; bytes: number };

/**
 * El estado de un activo-directorio, con su propio tipo
 * (enmienda H-AV3): las fases de su instalación son estados
 * (descargando el archivo, instalando en el directorio de
 * paso), y su `installed` solo existe verificado, fichero a
 * fichero contra el manifiesto. `mismatch` nombra las rutas
 * ausentes o cambiadas, y solo esas.
 */
export type AssetDiskState =
  | { kind: "absent" }
  | { kind: "downloading"; bytes: number; totalBytes: number }
  | { kind: "installing" }
  | { kind: "checking" }
  | { kind: "installed"; verified: true }
  | { kind: "mismatch"; changedFiles: string[] };

/** El censo de un activo: su estado y sus restos descartables. */
export interface AssetCensus {
  state: AssetDiskState;
  /**
   * Temporales o directorios de paso que quedan junto a un
   * final verificado: se reportan como residuo descartable,
   * no como estado (asiento de la sede de activos).
   */
  residue: string[];
}

/**
 * La costura de disco del censo, inyectable para la
 * batería: enumerar nombres, medir tamaños, saber si una
 * ruta es directorio y hashear un fichero. La enumeración
 * que rechaza (directorio ausente) se lee como directorio
 * vacío: todo ausente, que es la verdad de ese disco.
 */
export interface LibraryFs {
  list(dir: string): Promise<string[]>;
  size(path: string): Promise<number | null>;
  isDirectory(path: string): Promise<boolean>;
  hash(path: string): Promise<string>;
}

const nodeLibraryFs: LibraryFs = {
  async list(dir) {
    return readdir(dir).catch(() => [] as string[]);
  },
  async size(path) {
    const info = await stat(path).catch(() => null);
    return info?.isFile() ? info.size : null;
  },
  async isDirectory(path) {
    const info = await stat(path).catch(() => null);
    return info?.isDirectory() ?? false;
  },
  hash: (path) => sha256OfFile(path),
};

export interface CensusOptions {
  fs?: LibraryFs;
  /** Pedir la huella en el censo de modelos (la distinción escaneo/post-descarga). */
  verifyHashes?: boolean;
}

/**
 * El censo de modelos: por cada entrada del catálogo, el
 * estado de su `<id>.gguf` en el directorio de modelos.
 * Nunca barre el directorio buscando otra cosa: enumera el
 * manifiesto y pregunta por sus nombres. Un fichero con el
 * nombre final y un tamaño distinto del declarado no es un
 * instalado: es un parcial con esos bytes, no cargable por
 * ninguna vía (la puerta de carga exige tamaño y huella
 * exactos, y esta es su misma verdad).
 */
export async function censusModels(
  modelsDir: string,
  opts: CensusOptions & { catalog?: readonly CatalogEntry[] } = {},
): Promise<Map<string, DiskState>> {
  const fs = opts.fs ?? nodeLibraryFs;
  const catalog = opts.catalog ?? DESKTOP_CATALOG;
  const names = new Set(await fs.list(modelsDir));
  const out = new Map<string, DiskState>();
  for (const entry of catalog) {
    const file = `${entry.id}.gguf`;
    if (names.has(file)) {
      const bytes = (await fs.size(join(modelsDir, file))) ?? 0;
      if (bytes === entry.fileBytes) {
        const verified = opts.verifyHashes
          ? (await fs.hash(join(modelsDir, file))) === entry.sha256
          : false;
        out.set(entry.id, { kind: "installed", bytes, verified, source: "scan" });
      } else {
        out.set(entry.id, { kind: "partial", bytes });
      }
      continue;
    }
    const part = `${file}.part`;
    if (names.has(part)) {
      out.set(entry.id, { kind: "partial", bytes: (await fs.size(join(modelsDir, part))) ?? 0 });
      continue;
    }
    out.set(entry.id, { kind: "absent" });
  }
  return out;
}

/**
 * El censo de activos: por cada entrada del catálogo de
 * activos, el estado de su árbol en el directorio de
 * activos. Las fases son estados: el temporal del archivo
 * (`<id>.tar.bz2.part`) es `downloading` contra
 * `archiveBytes`; el directorio de paso (`<id>.part/`) es
 * `installing`; el árbol final se verifica fichero a
 * fichero (tamaño y huella) y solo así es `installed` —
 * con un fichero cambiado o ausente es `mismatch`
 * nombrándolo, jamás cargable. Lo ajeno al manifiesto no
 * aparece, no invalida y no se borra.
 *
 * El activo suelto (enmienda VA-02): su final es el propio
 * fichero en el directorio de activos, su `downloading` se
 * mide sobre el temporal de ese fichero (`<fichero>.part`)
 * y no conoce directorio de paso.
 */
export async function censusAssets(
  assetsDir: string,
  opts: { fs?: LibraryFs; catalog?: readonly AssetEntry[] } = {},
): Promise<Map<string, AssetCensus>> {
  const fs = opts.fs ?? nodeLibraryFs;
  const catalog = opts.catalog ?? ASSET_CATALOG;
  const names = new Set(await fs.list(assetsDir));
  const out = new Map<string, AssetCensus>();
  for (const entry of catalog) {
    out.set(entry.id, await censusOneAsset(entry, assetsDir, names, fs));
  }
  return out;
}

async function censusOneAsset(
  entry: AssetEntry,
  assetsDir: string,
  names: Set<string>,
  fs: LibraryFs,
): Promise<AssetCensus> {
  const loose = isLooseAsset(entry);
  const tempName = assetTempName(entry);
  const stepName = assetStepName(entry);
  const finalRoot = loose ? join(assetsDir, entry.files[0].path) : join(assetsDir, entry.id);
  const finalPresent = loose ? names.has(entry.files[0].path) : names.has(entry.id);

  if (finalPresent) {
    const changedFiles: string[] = [];
    for (const file of entry.files) {
      const path = loose ? finalRoot : join(finalRoot, ...file.path.split("/"));
      const bytes = await fs.size(path);
      if (bytes !== file.bytes) {
        changedFiles.push(file.path);
      } else if ((await fs.hash(path)) !== file.sha256) {
        changedFiles.push(file.path);
      }
    }
    if (changedFiles.length > 0) {
      return { state: { kind: "mismatch", changedFiles }, residue: [] };
    }
    const residue: string[] = [];
    if (names.has(tempName)) residue.push(tempName);
    if (!loose && names.has(stepName)) residue.push(stepName);
    return { state: { kind: "installed", verified: true }, residue };
  }
  if (!loose && names.has(stepName) && (await fs.isDirectory(join(assetsDir, stepName)))) {
    return { state: { kind: "installing" }, residue: [] };
  }
  if (names.has(tempName)) {
    const bytes = (await fs.size(join(assetsDir, tempName))) ?? 0;
    return {
      state: { kind: "downloading", bytes, totalBytes: entry.archiveBytes },
      residue: [],
    };
  }
  return { state: { kind: "absent" }, residue: [] };
}
