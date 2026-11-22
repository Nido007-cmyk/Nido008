/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * packDownloader.ts — la instalación y actualización de paquetes
 * de catálogo (bloque puerta de E5, paso 5): una de las dos
 * mitades de la puerta de instalación. Duplicación acotada del
 * patrón probado de src/core/download.ts, firmada en §5.3 de la
 * apertura de la etapa: `.part`, reanudación con Range,
 * verificación completa de tamaño y SHA-256 contra el pin de
 * packCatalog.ts sobre el `.part`, y solo entonces el
 * renombrado atómico al nombre final. `download.ts` no se toca:
 * el comportamiento ya probado de modelos queda intacto (su
 * diff en este bloque es vacío), y las primitivas compartidas
 * son las de la fundación (sha256OfFile de core/loadPath.ts).
 *
 * En disco, un fichero con su nombre final ES un paquete
 * verificado; un `.part` es una descarga en curso o rota, y
 * ninguna vía de lectura lo acepta. Actualizar es fichero
 * nuevo verificado y cambio al final: si la descarga se corta
 * o no verifica, la edición anterior sigue sirviendo (su
 * fichero no se toca hasta el renombrado) y el `.part` sano se
 * conserva para reanudar; un contenido que no casa con el pin
 * no es reanudable, es corrupto, y su `.part` se borra.
 *
 * Al instalar, la pieza deja el asiento del diario propio de
 * paquetes (corpus/pack-install-records.json, el que
 * packTrust.ts lee: por id, tamaño, huella contra la que se
 * verificó y mtime del fichero instalado, con su nombre de
 * fichero): es la prueba de instalación que la vía «outdated»
 * de la puerta de apertura acredita cuando el catálogo avance.
 * La retirada de un paquete (paso 7, PI-4) borra también su
 * asiento del diario.
 */

import { createWriteStream } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LoadRefusal, sha256OfFile } from "../core/loadPath.js";
import { packsDataPath } from "../models/dataDir.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";

export interface PackDownloadResult {
  file: string;
  bytes: number;
  resumedFrom: number;
}

const INSTALL_RECORDS_NAME = "pack-install-records.json";

interface PackInstallRecord {
  sizeBytes: number;
  sha256: string;
  mtimeMs: number | null;
  filename: string;
}

/** Verifica un fichero contra el pin de su entrada de paquete: tamaño exacto y huella. */
async function verifyPackFile(file: string, entry: PackCatalogEntry): Promise<void> {
  const info = await stat(file);
  if (info.size !== entry.sizeBytes) {
    throw new LoadRefusal(
      `refused: size mismatch for ${entry.id}: file has ${info.size} bytes, catalog says ${entry.sizeBytes}. Nothing was installed.`,
    );
  }
  const digest = await sha256OfFile(file);
  if (digest !== entry.sha256) {
    throw new LoadRefusal(`refused: sha256 mismatch for ${entry.id}. Nothing was installed.`);
  }
}

/**
 * El veredicto sobre una respuesta cuando se pidió rango, ANTES
 * de abrir el fichero: "append" solo si la respuesta declara
 * que continúa exactamente donde el .part quedó; "fresh" si
 * declara ser el fichero desde su byte 0 (el Range ignorado de
 * siempre, con 200, o un 206 que se declara desde 0); "refuse"
 * si declara cualquier otra cosa, porque ese cuerpo no tiene
 * posición conocida y usarlo en cualquier posición destruye el
 * .part sano que la reanudación existe para conservar.
 * Sin Content-Range (que un 206 debe traer), la única
 * declaración que queda es la longitud: el resto exacto
 * autoriza a añadir y el tamaño entero a escribir desde cero;
 * cualquier otra longitud no declara nada aprovechable.
 */
function resumeVerdict(
  response: Response,
  resumeFrom: number,
  totalBytes: number,
): "append" | "fresh" | "refuse" {
  if (resumeFrom <= 0 || response.status !== 206) return "fresh";
  const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
    (response.headers.get("content-range") ?? "").trim(),
  );
  if (range) {
    const start = Number(range[1]);
    if (start === resumeFrom) return "append";
    if (start === 0) return "fresh";
    return "refuse";
  }
  const length = Number(response.headers.get("content-length"));
  if (length === totalBytes - resumeFrom) return "append";
  if (length === totalBytes) return "fresh";
  return "refuse";
}

/** El asiento del diario de instalación de paquetes, tras un renombrado verificado. */
async function recordInstall(entry: PackCatalogEntry, finalPath: string): Promise<void> {
  const recordsPath = packsDataPath(`corpus/${INSTALL_RECORDS_NAME}`);
  let records: Record<string, PackInstallRecord> = {};
  try {
    const parsed = JSON.parse(await readFile(recordsPath, "utf8")) as Record<string, PackInstallRecord>;
    if (parsed && typeof parsed === "object") records = parsed;
  } catch {
    // Sin diario todavía: este asiento lo nace.
  }
  const info = await stat(finalPath);
  records[entry.id] = {
    sizeBytes: entry.sizeBytes,
    sha256: entry.sha256,
    mtimeMs: info.mtimeMs,
    filename: entry.filename,
  };
  mkdirSync(dirname(recordsPath), { recursive: true });
  await writeFile(recordsPath, JSON.stringify(records, null, 2));
}

/**
 * Descarga (o reanuda) el paquete de una entrada del catálogo
 * hasta dejarlo verificado con su nombre final en la carpeta de
 * paquetes, y asienta la instalación en el diario. Lanza ante
 * cualquier fallo; un fallo de red deja el `.part` para reanudar,
 * un fallo de verificación lo borra. Si el paquete ya está
 * instalado y verificado, no baja nada y devuelve su estado.
 */
export async function downloadPack(entry: PackCatalogEntry): Promise<PackDownloadResult> {
  const finalPath = packsDataPath(entry.filename);
  const partPath = `${finalPath}.part`;
  mkdirSync(dirname(finalPath), { recursive: true });

  // Si ya está instalado y verificado contra el pin vigente, no
  // hay nada que bajar. Si lo que hay no verifica contra el pin
  // (una edición anterior tras avanzar el catálogo, o unos bytes
  // que no son los del pin), no bloquea la actualización: sigue
  // en su sitio sirviendo como edición anterior hasta que la
  // descarga nueva verifique entera y el renombrado la cambie
  // (la regla de actualización de la etapa, §4.4). Nada que no
  // verifique llega nunca al nombre final por esta vía: el
  // renombrado solo ocurre tras verificar el `.part`.
  const existing = await stat(finalPath).catch(() => null);
  if (existing?.isFile()) {
    const verified = await verifyPackFile(finalPath, entry).then(
      () => true,
      () => false,
    );
    if (verified) {
      return { file: finalPath, bytes: existing.size, resumedFrom: existing.size };
    }
  }

  let resumeFrom = 0;
  const part = await stat(partPath).catch(() => null);
  if (part?.isFile()) {
    if (part.size > entry.sizeBytes) {
      // Un .part mayor que el fichero entero no puede ser de esta
      // descarga: corrupto, se borra y se empieza de cero.
      await rm(partPath, { force: true });
    } else if (part.size === entry.sizeBytes) {
      // Un .part completo pero corrupto se borra al fallar la
      // verificación, igual que en la vía de modelos: si se
      // quedara, cada llamada repetiría el mismo rechazo.
      await verifyPackFile(partPath, entry).catch(async (err) => {
        await rm(partPath, { force: true });
        throw err;
      });
      await rename(partPath, finalPath);
      await recordInstall(entry, finalPath);
      return { file: finalPath, bytes: part.size, resumedFrom: part.size };
    } else {
      resumeFrom = part.size;
    }
  }

  const headers: Record<string, string> = {};
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
  const response = await fetch(entry.sourceUrl, { headers, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new LoadRefusal(
      `download failed for ${entry.id}: HTTP ${response.status} from the publisher. The partial file is kept for resume.`,
    );
  }
  const verdict = resumeVerdict(response, resumeFrom, entry.sizeBytes);
  if (verdict === "refuse") {
    // No se abre el stream: el .part queda byte a byte como
    // estaba, para reanudar en el siguiente intento.
    throw new LoadRefusal(
      `download refused for ${entry.id}: the server answered the range request with a 206 that does not continue at byte ${resumeFrom}. The partial file is kept for resume.`,
    );
  }
  const append = verdict === "append";
  if (!append) resumeFrom = 0;
  const out = createWriteStream(partPath, { flags: append ? "a" : "w" });
  await pipeline(Readable.fromWeb(response.body as never), out);

  // Verificación sobre el .part, rename atómico solo tras verificar.
  await verifyPackFile(partPath, entry).catch(async (err) => {
    await rm(partPath, { force: true });
    throw err;
  });
  await rename(partPath, finalPath);
  await recordInstall(entry, finalPath);
  return { file: finalPath, bytes: entry.sizeBytes, resumedFrom: resumeFrom };
}
