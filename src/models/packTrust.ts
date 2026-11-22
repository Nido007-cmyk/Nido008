/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * packTrust.ts — la puerta de apertura de paquetes de PC: si los
 * bytes que hay en disco pueden abrirse como el paquete que la
 * entrada dice ser. ADELANTO de E5 firmado en la apertura de J-3
 * (vía A de estudios/E5-PACKS-FRONTERA.md §3.1): el módulo entró
 * entero en aquella tanda porque `openPack` (rag/packs.ts)
 * consume `packFileState` en cada apertura; su acreditación de
 * etapa llegó en el paso 4 del bloque puerta de E5, con su
 * batería (packTrust.test.ts) y con la letra de su acreditación
 * estrechada a lo que la puerta cobra en la partida J3S-1: la
 * vía «current» decide por tamaño contra el pin, fiel al
 * móvil, y el diario de instalación acredita la vía «outdated»
 * por mtime o por re-hash contra la prueba de instalación.
 *
 * El contrato es el de `packFileState` de la fuente 0.1.108
 * (models/modelTrust.ts): "current" (completo para su pin),
 * "outdated" (una versión anterior cuyos bytes quedaron probados
 * al instalarla, 0.1.57) o "unusable". Un paquete sin pin nunca
 * llega a esta puerta: knowledgePacks() solo construye entradas
 * que traen uno (M-35/F-03).
 *
 * Adaptación de PC asentada: donde la fuente lee el diario de
 * instalación de installState.ts, aquí la prueba de instalación
 * vive en el diario propio de paquetes,
 * `corpus/pack-install-records.json` (id → { sizeBytes, sha256,
 * mtimeMs }), que la puerta de fichero de E5 escribirá al
 * instalar; sin diario o sin asiento, no hay "outdated" que
 * probar y la puerta cae a la comparación contra el pin vigente,
 * que es la dirección cerrada. El sistema de ficheros es el de
 * Node y la raíz es la costura del directorio de datos
 * (src/models/dataDir.ts). La puerta de modelos (la vía única de
 * carga de E0) NO vive aquí: en PC ya tiene su casa en
 * src/core/loadPath.ts y no se duplica.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getPacksDataDir, packsDataPath } from "./dataDir.js";
import type { CatalogModel } from "./manifest.js";

export function isKnowledgePack(asset: Pick<CatalogModel, "kind"> & { format?: string }): boolean {
  return asset.kind === "corpus" && asset.format === "sqlite-pack";
}

/** La prueba que la instalación dejó de unos bytes concretos. */
export interface PackInstallProof {
  sizeBytes: number;
  sha256: string;
  mtimeMs: number | null;
}

const INSTALL_RECORDS_NAME = "pack-install-records.json";

function readInstallProof(id: string): PackInstallProof | null {
  try {
    const text = readFileSync(join(getPacksDataDir(), "corpus", INSTALL_RECORDS_NAME), "utf8");
    const parsed = JSON.parse(text) as Record<string, Partial<PackInstallProof>>;
    const rec = parsed?.[id];
    if (rec && typeof rec.sizeBytes === "number" && typeof rec.sha256 === "string") {
      return { sizeBytes: rec.sizeBytes, sha256: rec.sha256, mtimeMs: rec.mtimeMs ?? null };
    }
  } catch {
    // No journal yet (or unreadable): no proof to consult.
  }
  return null;
}

function sameSha(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function isProvenOutdatedPack(
  asset: CatalogModel & { format?: string },
  path: string,
  sizeOnDisk: number,
  mtime: number | null,
): Promise<boolean> {
  if (!isKnowledgePack(asset)) return false;
  const proof = readInstallProof(asset.id);
  if (!proof) return false;
  // Proof of the current catalog version: not outdated (the normal gate decides).
  if (proof.sizeBytes === asset.sizeBytes && sameSha(proof.sha256, asset.sha256)) return false;
  if (sizeOnDisk !== proof.sizeBytes) return false;
  if (proof.mtimeMs != null && mtime != null) {
    if (proof.mtimeMs === mtime) return true;
  }
  // Rewritten since (or no mtime to compare): only a re-hash can prove it.
  try {
    return sameSha(await sha256OfFile(path), proof.sha256);
  } catch {
    return false;
  }
}

export type PackFileState = "current" | "outdated" | "unusable";

/**
 * Whether a knowledge pack's file can be opened: "current" (complete for the
 * catalog, as before), "outdated" (older verified bytes, see above) or
 * "unusable". Local packs (sizeBytes 0, built by the user) have no catalog
 * entry to compare against and are "current" when present.
 */
export async function packFileState(asset: CatalogModel & { format?: string }): Promise<PackFileState> {
  // La resolución contenida (J3S-2): un nombre que resuelve fuera
  // del directorio de datos es «unusable», el estado cerrado.
  let path: string;
  try {
    path = packsDataPath(asset.filename);
  } catch {
    return "unusable";
  }
  let info: ReturnType<typeof statSync> | null = null;
  try {
    info = statSync(path);
  } catch {
    info = null;
  }
  if (!info || !info.isFile()) return "unusable";
  const size = info.size ?? 0;
  if (asset.sizeBytes <= 0) return "current";
  if (await isProvenOutdatedPack(asset, path, size, info.mtimeMs ?? null)) return "outdated";
  return size === asset.sizeBytes ? "current" : "unusable";
}
