/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * importedPacksRegistry.ts — the registry of packs the signed door
 * verified (`corpus/imported-packs.json`), shared by the door
 * (services/packImporter.ts, which writes it) and the engine
 * (rag/packs.ts, which reads it).
 *
 * M-35 (auditoría 2026-11-13, carril 07 · F-03/B2): this registry is the
 * ONLY thing that makes a non-catalog file in corpus/ a pack. Each
 * record carries the SHA-256 and size the door verified at import, and
 * that pair is the pack's pin: knowledgePacks() builds the pack's
 * catalog-shaped entry from it, and the open gate (packTrust's
 * packFileState) judges the file against that pin — by SIZE in its
 * "current" path (and by mere presence when the record's sizeBytes
 * ≤ 0), and by mtime or a full re-hash against the install proof in
 * its "outdated" path. The whole byte verification lives at import
 * (the door's exact-hash step, PI-2 · 2) and in that second path, not
 * in the current opening. A `.sqlite` file with no record here is
 * not a pack — being present in the directory proves nothing, the
 * same rule the GGUF gate applies to models (no pin, not usable).
 *
 * The file format is the one the door has written since Pieza A
 * ({ version: 1, packs: { [filename]: record } }); records written by
 * older versions keep working unchanged — the pin was always recorded,
 * it just was never consulted at open time before M-35.
 *
 * ADELANTO de E5 firmado en la apertura de J-3 (vía A de
 * estudios/E5-PACKS-FRONTERA.md §3.1): el módulo entero entra en
 * esta tanda porque su lectura fail-closed ES la semántica M-35
 * que packsRestIntegrity acredita en J-5; su acreditación de etapa
 * llega en el paso 4 de E5. Adaptación de PC asentada: el sistema
 * de ficheros es el de Node y la raíz es la costura del directorio
 * de datos (src/models/dataDir.ts), así que
 * `importedPacksRegistryUri()` devuelve la RUTA del fichero, no
 * una URI de expo-file-system.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPacksDataDir } from "./dataDir.js";
import type { PackOrigin } from "./packImport.js";

export const IMPORTED_PACKS_REGISTRY_NAME = "imported-packs.json";

export interface ImportedPackRecord {
  origin: PackOrigin;
  sha256: string;
  sizeBytes: number;
  name: string;
  importedAt: string;
}

export function importedPacksRegistryUri(): string {
  return join(getPacksDataDir(), "corpus", IMPORTED_PACKS_REGISTRY_NAME);
}

/**
 * Every record the door left, keyed by file name. An unreadable or
 * malformed registry reads as empty: no record, no pack — the failure
 * direction is closed, never open.
 */
export async function readImportedPacks(): Promise<Record<string, ImportedPackRecord>> {
  try {
    const text = readFileSync(importedPacksRegistryUri(), "utf8");
    const parsed = JSON.parse(text) as { packs?: Record<string, ImportedPackRecord> };
    if (parsed && typeof parsed === "object" && parsed.packs && typeof parsed.packs === "object") {
      return parsed.packs;
    }
  } catch {
    // No registry yet (or unreadable): no pack carries an import record.
  }
  return {};
}

export async function writeImportedPacks(packs: Record<string, ImportedPackRecord>): Promise<void> {
  const uri = importedPacksRegistryUri();
  mkdirSync(dirname(uri), { recursive: true });
  writeFileSync(uri, JSON.stringify({ version: 1, packs }));
}
