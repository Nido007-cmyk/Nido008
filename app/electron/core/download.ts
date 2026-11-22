/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El descargador de modelos, con el patrón que la auditoría de
 * ataque 1 (M-3) fijó como requisito previo: se descarga siempre a
 * un fichero `.part`, se verifica tamaño y huella sobre el `.part`,
 * y solo entonces se renombra atómicamente al nombre final. En
 * disco, un fichero con su nombre final ES un modelo verificado;
 * un `.part` es una descarga en curso o rota, y ninguna vía de
 * carga lo acepta (la vía de carga solo abre `<id>.gguf` verificado,
 * ver loadPath.ts). Un fichero con nombre final que no verifica
 * no se conserva como si lo fuera: `downloadModel` lo retira y
 * lo vuelve a bajar.
 *
 * La descarga es reanudable (Range) porque los ficheros pesan
 * gigabytes y la red de una casa se cae: un `.part` sano se continúa,
 * nunca se tira por sistema. Si la verificación falla, el `.part`
 * se borra: un contenido que no casa con la huella no es reanudable,
 * es corrupto.
 *
 * La extensión de E4 (paso 4) añade lo que el gestor necesita y
 * las partidas de la auditoría de descarga cobran:
 *
 *   - Progreso contado: cada byte que entra suma al contador
 *     (con el desplazamiento de la reanudación) y se reporta
 *     con `onProgress`. El mismo contador es el tope en vuelo
 *     (D-1, «TOPE-EN-VUELO»): un cuerpo que supera los bytes
 *     declarados en el catálogo aborta la transferencia en el
 *     acto, y su destino queda declarado: el `.part` se borra,
 *     porque un cuerpo que se pasa de su tamaño declarado no
 *     es un parcial reanudable, es un cuerpo hostil o corrupto.
 *   - Pausa por `AbortSignal`: abortar a mitad de descarga
 *     lanza `DownloadPaused` y el `.part` se queda en disco
 *     tal cual, para continuar en el siguiente intento. Pausar
 *     no es fallar: es el estado que la tarjeta «pausado»
 *     enseña.
 *   - Descarte (`discardDownload`): borra el `.part` y su
 *     temporal de reinicio, y solo eso. El fichero final, si
 *     existe, no se toca jamás desde el descarte.
 *   - Enlaces (D-3, «PART-SYMLINK»): el `.part` y el final se
 *     comprueban con `lstat` antes de tocar nada; lo que no
 *     sea un fichero regular se rechaza sin escribir un byte.
 *   - Reanudación no regresiva (D-7, «REANUDACION-REGRESIVA»):
 *     si el servidor ignora el Range y toca empezar de cero
 *     habiendo un `.part` sano, el cuerpo nuevo se escribe a
 *     un temporal (`.part.fresh`) y solo sustituye al `.part`
 *     cuando verifica; un corte a mitad deja el prefijo bueno
 *     intacto, byte a byte.
 *
 * Esta es la ÚNICA red de NIDO tras la instalación: bajar los
 * modelos que la persona pidió, de las URLs fijadas a su revisión
 * en el catálogo, y verificarlos antes de que existan con su nombre.
 */

import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { chmod, lstat, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import unbzip2Stream from "@balena/unbzip2-stream";
import { Parser as TarParser } from "tar";
import type { ReadEntry } from "tar";
import type { AssetEntry } from "./assetCatalog.js";
import { assetStepName, assetTempName, isLooseAsset } from "./assetCatalog.js";
import type { CatalogEntry } from "./catalog.js";
import {
  LoadRefusal,
  resolveModelFile,
  sha256OfFile,
  verifiedAssetDir,
  verifyModelFile,
} from "./loadPath.js";

export interface DownloadResult {
  file: string;
  bytes: number;
  resumedFrom: number;
  /**
   * La reparación de D-2, declarada (política firmada en la
   * apertura de E4 §3.4): true cuando esta llamada encontró
   * un fichero final que no verificaba, lo retiró y bajó de
   * cero. La reparación ocurre al invocar la descarga, nunca
   * en silencio al censar, y el resultado la nombra.
   */
  repairedCorruptFinal: boolean;
}

export interface DownloadOptions {
  /** Progreso contado: bytes en el `.part` (con el desplazamiento) y total declarado. */
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  /** Abortar es pausar: el `.part` se conserva y se lanza DownloadPaused. */
  signal?: AbortSignal;
}

/** La pausa de una descarga: no es un fallo, es un estado. */
export class DownloadPaused extends Error {
  constructor(entryId: string) {
    super(
      `download paused for ${entryId}: the partial file is kept on disk and the next attempt resumes from it.`,
    );
    this.name = "DownloadPaused";
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

/**
 * D-3: antes de tocar el `.part` o el final, lo que exista con
 * esos nombres tiene que ser un fichero regular. Un enlace a
 * un fichero ajeno no se sigue ni escribiendo ni borrando a
 * través de él: se rechaza la descarga sin tocar un byte.
 */
async function refuseIfNotRegular(file: string, entryId: string): Promise<void> {
  const info = await lstat(file).catch(() => null);
  if (info && !info.isFile()) {
    throw new LoadRefusal(
      `download refused for ${entryId}: "${path.basename(file)}" exists and is not a regular file. Nothing was written.`,
    );
  }
}

/**
 * Descarga (o reanuda) el modelo de una entrada del catálogo hasta
 * dejarlo verificado con su nombre final en el directorio de
 * modelos. Lanza ante cualquier fallo; un fallo de red deja el
 * `.part` para reanudar, un fallo de verificación lo borra, y una
 * pausa (`signal`) lo deja tal cual lanzando `DownloadPaused`.
 */
export async function downloadModel(
  entry: CatalogEntry,
  modelsDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const finalName = `${entry.id}.gguf`;
  const finalPath = path.join(path.resolve(modelsDir), finalName);
  const partPath = `${finalPath}.part`;

  await refuseIfNotRegular(finalPath, entry.id);
  await refuseIfNotRegular(partPath, entry.id);

  // Si ya está instalado y verificado, no hay nada que bajar.
  // Si lo que hay con el nombre final NO verifica (corrupción
  // en disco, copia interrumpida, un pin que avanzó), no es un
  // modelo instalado: es el mismo estado que un .part corrupto
  // con otro nombre, y recibe su misma conducta: se retira y
  // se descarga de cero. La vía de carga no se abre con esto:
  // ella verifica por su cuenta y jamás habría abierto ese
  // fichero, y lo que llegue al nombre final seguirá naciendo
  // solo del renombrado tras verificar el .part, como hoy.
  let repairedCorruptFinal = false;
  const existing = await stat(finalPath).catch(() => null);
  if (existing?.isFile()) {
    const verified = await verifyModelFile(finalPath, entry).then(
      () => true,
      () => false,
    );
    if (verified) {
      return {
        file: finalPath,
        bytes: existing.size,
        resumedFrom: existing.size,
        repairedCorruptFinal: false,
      };
    }
    await rm(finalPath, { force: true });
    repairedCorruptFinal = true;
  }

  let resumeFrom = 0;
  const part = await stat(partPath).catch(() => null);
  if (part?.isFile()) {
    if (part.size > entry.fileBytes) {
      // Un .part mayor que el fichero entero no puede ser de esta
      // descarga: corrupto, se borra y se empieza de cero.
      await rm(partPath, { force: true });
    } else if (part.size === entry.fileBytes) {
      // Un .part completo pero corrupto se borra al fallar la
      // verificación, igual que en la rama de descarga fresca
      // (auditoría de ataque 2, observación baja): si se quedara,
      // cada llamada repetiría el mismo rechazo contra el mismo
      // fichero y la entrada quedaría atascada hasta borrarlo a
      // mano. Borrado, la siguiente llamada descarga de cero.
      await verifyModelFile(partPath, entry).catch(async (err) => {
        await rm(partPath, { force: true });
        throw err;
      });
      await rename(partPath, finalPath);
      return { file: finalPath, bytes: part.size, resumedFrom: part.size, repairedCorruptFinal };
    } else {
      resumeFrom = part.size;
    }
  }

  if (opts.signal?.aborted) throw new DownloadPaused(entry.id);

  const headers: Record<string, string> = {};
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
  const response = await fetch(entry.sourceUrl, {
    headers,
    redirect: "follow",
    signal: opts.signal,
  }).catch((err: unknown) => {
    if (opts.signal?.aborted) throw new DownloadPaused(entry.id);
    throw err;
  });
  if (!response.ok || !response.body) {
    throw new LoadRefusal(
      `download failed for ${entry.id}: HTTP ${response.status} from the publisher. The partial file is kept for resume.`,
    );
  }
  const verdict = resumeVerdict(response, resumeFrom, entry.fileBytes);
  if (verdict === "refuse") {
    // No se abre el stream: el .part queda byte a byte como
    // estaba, para reanudar en el siguiente intento.
    throw new LoadRefusal(
      `download refused for ${entry.id}: the server answered the range request with a 206 that does not continue at byte ${resumeFrom}. The partial file is kept for resume.`,
    );
  }
  const append = verdict === "append";
  // D-7: empezar de cero con un .part sano en disco se escribe
  // a un temporal; el prefijo bueno solo se sustituye cuando
  // el cuerpo nuevo ha verificado entero.
  const useTemp = !append && resumeFrom > 0;
  const writePath = useTemp ? `${partPath}.fresh` : partPath;
  const countedFrom = append ? resumeFrom : 0;
  if (countedFrom > 0) opts.onProgress?.(countedFrom, entry.fileBytes);

  let received = countedFrom;
  let capBreached = false;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > entry.fileBytes) {
        capBreached = true;
        callback(new Error("download cap breached"));
        return;
      }
      opts.onProgress?.(received, entry.fileBytes);
      callback(null, chunk);
    },
  });
  const out = createWriteStream(writePath, { flags: append ? "a" : "w" });
  try {
    await pipeline(Readable.fromWeb(response.body as never), counter, out);
  } catch (err) {
    if (capBreached) {
      // D-1: el destino del cuerpo que se pasa queda declarado:
      // se borra lo escrito por esta transferencia. El .part
      // anterior, si lo había (rama temporal), no es de este
      // cuerpo y se conserva.
      await rm(writePath, { force: true });
      throw new LoadRefusal(
        `download refused for ${entry.id}: the publisher sent more bytes than the ${entry.fileBytes} the catalog declares. The overrun body was discarded; it is not a resumable partial.`,
      );
    }
    if (opts.signal?.aborted) {
      if (useTemp) await rm(writePath, { force: true });
      throw new DownloadPaused(entry.id);
    }
    // Un corte de red en la rama temporal no toca el prefijo
    // bueno: el temporal se va, el .part se queda (D-7).
    if (useTemp) await rm(writePath, { force: true });
    throw err;
  }

  // Verificación sobre lo escrito, rename atómico solo tras verificar.
  await verifyModelFile(writePath, entry).catch(async (err) => {
    await rm(writePath, { force: true });
    throw err;
  });
  await rename(writePath, finalPath);
  if (useTemp) await rm(partPath, { force: true });
  // La ruta final también pasa por la puerta de nombres de la casa.
  await resolveModelFile(modelsDir, finalName);
  return { file: finalPath, bytes: entry.fileBytes, resumedFrom: countedFrom, repairedCorruptFinal };
}

/**
 * El descarte de una descarga: borra el `.part` (y su temporal
 * de reinicio, si quedó), y solo eso. El fichero final no se
 * toca jamás desde aquí: descartar una descarga a medias no
 * desinstala un modelo.
 */
export async function discardDownload(
  entry: CatalogEntry,
  modelsDir: string,
): Promise<void> {
  const partPath = path.join(path.resolve(modelsDir), `${entry.id}.gguf.part`);
  await rm(partPath, { force: true });
  await rm(`${partPath}.fresh`, { force: true });
}

// ── Los activos de voz (E9 paso 0) ─────────────────────────────────
//
// downloadAsset es el espejo de downloadModel para los paquetes
// multi-fichero de assetCatalog.ts (ACTIVOS-VOZ-CARGA §4, con las
// enmiendas VA de la apertura de E9). Las fases son las mismas y
// fail-closed: descargar al temporal, verificar tamaño y huella
// del PAQUETE entero, extraer a un directorio de paso validando
// cada ruta efectiva contra el manifiesto, verificar el árbol
// extraído fichero a fichero, y solo entonces renombrar al
// directorio final y borrar el paquete. En disco, un directorio
// con el nombre del activo ES un activo verificado (la puerta
// verifiedAssetDir lo cobra entero antes de entregarlo); un
// `.part` — de descarga o de paso — no lo abre nadie.
//
// La forma real de los paquetes, medida sobre los de sherpa-onnx
// antes de construir (sonda de prefijo de los tarball de Parakeet
// y de Kokoro, registros del paso): cada paquete trae UN
// directorio raíz con el nombre del propio fichero (la base de la
// sourceUrl sin «.tar.bz2») y los ficheros del manifiesto bajo
// él. Los caminos del manifiesto no traen prefijo: la raíz se
// retira al extraer, y todo lo que no viva bajo esa raíz, o no
// esté en el manifiesto ya sin ella, rechaza el paquete entero.

export interface AssetDownloadResult {
  /** La raíz de resolución del manifiesto: la que verifiedAssetDir devuelve. */
  dir: string;
  /** Los bytes del paquete instalados (archiveBytes del catálogo). */
  bytes: number;
  resumedFrom: number;
  /** Como en DownloadResult: un final que no verificaba se retiró y se reinstaló. */
  repairedCorruptFinal: boolean;
}

/** El host único al que puede saltar una descarga de activo (VA-01). */
const ASSET_CDN_HOST = "release-assets.githubusercontent.com";

/** Extrae el `filename=` de una cabecera Content-Disposition o de un parámetro equivalente. */
function declaredFileName(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return match ? match[1].trim() : null;
}

/** El nombre que la propia Location declara, en sus parámetros de disposición. */
function fileNameDeclaredByLocation(target: URL): string | null {
  for (const param of ["response-content-disposition", "rscd"]) {
    const name = declaredFileName(target.searchParams.get(param));
    if (name !== null) return name;
  }
  return null;
}

/**
 * VA-01: la redirección se sigue a mano y solo vale UN salto, a
 * ASSET_CDN_HOST, con el nombre de fichero de la respuesta atado
 * al del activo pedido. La forma real de GitHub Releases, medida:
 * un 302 cuya Location ya declara el nombre en sus parámetros
 * (`response-content-disposition` / `rscd`, `attachment;
 * filename=<nombre>`). Segundo salto, otro host, un nombre
 * declarado distinto, o un salto que no declara nombre alguno:
 * rechazo, sin escribir un byte. Una respuesta directa (200/206)
 * no pasa por esta atadura: la gobierna la huella del catálogo,
 * que es más fuerte que un nombre.
 */
async function fetchAssetResponse(
  entry: AssetEntry,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const first = await fetch(entry.sourceUrl, { headers, redirect: "manual", signal });
  if (first.status < 300 || first.status >= 400) return first;
  const location = first.headers.get("location");
  if (!location) {
    throw new LoadRefusal(
      `download refused for ${entry.id}: the publisher answered HTTP ${first.status} without a Location. Nothing was written.`,
    );
  }
  let target: URL;
  try {
    target = new URL(location);
  } catch {
    throw new LoadRefusal(
      `download refused for ${entry.id}: the redirect Location is not a URL. Nothing was written.`,
    );
  }
  if (target.hostname !== ASSET_CDN_HOST) {
    throw new LoadRefusal(
      `download refused for ${entry.id}: the redirect leaves for ${target.hostname}; the only hop a NIDO download may take is to ${ASSET_CDN_HOST}. Nothing was written.`,
    );
  }
  const expectedName = path.posix.basename(new URL(entry.sourceUrl).pathname);
  const declaredInLocation = fileNameDeclaredByLocation(target);
  if (declaredInLocation !== null && declaredInLocation !== expectedName) {
    throw new LoadRefusal(
      `download refused for ${entry.id}: the redirect declares the file "${declaredInLocation}", not the requested "${expectedName}". Nothing was written.`,
    );
  }
  const second = await fetch(target, { headers, redirect: "manual", signal });
  if (second.status >= 300 && second.status < 400) {
    throw new LoadRefusal(
      `download refused for ${entry.id}: a second redirect hop (HTTP ${second.status}); a NIDO download follows exactly one. Nothing was written.`,
    );
  }
  const declared =
    declaredFileName(second.headers.get("content-disposition")) ?? declaredInLocation;
  if (declared !== expectedName) {
    throw new LoadRefusal(
      `download refused for ${entry.id}: the delivered file is not declared as "${expectedName}". Nothing was written.`,
    );
  }
  return second;
}

/** Tamaño y huella del paquete descargado, contra los pines del catálogo. */
async function verifyAssetArchive(file: string, entry: AssetEntry): Promise<void> {
  const st = await stat(file).catch(() => null);
  if (!st?.isFile() || st.size !== entry.archiveBytes) {
    throw new LoadRefusal(
      `size mismatch for asset ${entry.id}: expected ${entry.archiveBytes} bytes, found ${st?.size ?? "nothing"}. Nothing was installed.`,
    );
  }
  if ((await sha256OfFile(file)) !== entry.archiveSha256) {
    throw new LoadRefusal(
      `sha256 mismatch for asset ${entry.id}: the downloaded package is not the pinned one. Nothing was installed.`,
    );
  }
}

/**
 * El nombre del directorio raíz del paquete: la base de la
 * sourceUrl sin «.tar.bz2» (medido: `kokoro-multi-lang-v1_0`,
 * `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`). Sin esa forma no
 * hay raíz derivable y el paquete no se extrae.
 */
function assetArchiveRootName(entry: AssetEntry): string {
  const base = path.posix.basename(new URL(entry.sourceUrl).pathname);
  if (!base.endsWith(".tar.bz2") || base === ".tar.bz2") {
    throw new LoadRefusal(
      `asset ${entry.id} does not name a .tar.bz2 package; its root directory cannot be derived. Nothing was installed.`,
    );
  }
  return base.slice(0, -".tar.bz2".length);
}

/**
 * Extrae el paquete al directorio de paso validando la RUTA
 * EFECTIVA de cada entrada — la que queda tras resolver las
 * extensiones pax y los nombres largos GNU, que es la que el
 * parser entrega (VA-03) — antes de escribir nada de ella:
 *
 *   - absoluta, con segmentos `..`, vacíos o con separadores de
 *     Windows: rechazo del paquete entero (§4.7, clases 1 y 2);
 *   - fuera del directorio raíz del paquete: rechazo entero;
 *   - enlaces (simbólicos o duros), dispositivos y cualquier
 *     tipo que no sea fichero regular o directorio: rechazo
 *     entero (clase 3);
 *   - un fichero cuya ruta sin la raíz no está en el manifiesto,
 *     o una ruta repetida (VA-04): rechazo entero (clase 4);
 *   - un directorio que no sea la raíz ni prefijo propio de un
 *     camino del manifiesto: rechazo entero;
 *   - el tamaño de cabecera de cada fichero tiene que ser el
 *     del manifiesto, y los modos del tar NO se honran jamás:
 *     lo escrito nace 0644 y los directorios 0755 (VA-05).
 *
 * Ante cualquier rechazo, quien llama descarta el directorio de
 * paso entero: del paquete hostil no queda nada en su sitio.
 */
async function extractAssetArchive(
  archivePath: string,
  stepDir: string,
  entry: AssetEntry,
): Promise<void> {
  const rootName = assetArchiveRootName(entry);
  const manifest = new Map(entry.files.map((f) => [f.path, f.bytes]));
  const seen = new Set<string>();
  const writes: Promise<void>[] = [];
  const writeStreams: ReturnType<typeof createWriteStream>[] = [];
  let failure: LoadRefusal | null = null;

  const source = createReadStream(archivePath);
  const decompressor = unbzip2Stream();
  const parser = new TarParser();
  // El asentamiento del flujo, asignado al coser la cadena:
  // los rechazos de validación lo asientan directamente,
  // porque desmontar la cadena puede no producir ni «end»
  // ni «error» en el parser.
  let settleFlow: (err: Error | null) => void = () => {};
  // Ante cualquier fallo se desmonta la cadena entera: ni el
  // lector sigue trayendo bytes ni una escritura a medias sigue
  // abierta (el directorio de paso se descarta fuera, entero).
  const teardown = () => {
    // Cada destroy por su lado y sin lanzar: que uno falle no
    // puede dejar la cadena medio desmontada ni matar el
    // asentamiento del flujo (medido en la sonda del paso: un
    // destroy que lanzaba dentro de fail() colgaba la cadena
    // entera, porque el asentamiento nunca se llamaba).
    for (const stream of [source, decompressor, ...writeStreams]) {
      try {
        stream.destroy();
      } catch {
        // Ya cerrado: no hay nada que desmontar.
      }
    }
    // El parser (el Minipass de tar 7.5.23) NO tiene destroy,
    // ni en el tipo ni en el objeto (medido): se le corta la
    // entrada destruyendo lo que lo alimenta, y el flujo se
    // asienta por settleFlow, no por su «end».
    try {
      source.unpipe(decompressor);
    } catch {
      // Sin tubería que cortar.
    }
  };

  // Las entradas se cobran por el EVENTO «entry»: la opción
  // `onentry` del constructor no dispara en tar 7.5.23 (medido
  // en la sonda del paso: cero entradas y el flujo colgado; con
  // el evento, el mismo paquete entero). Y la cadena se cose
  // con pipe a mano, no con pipeline(): el descompresor de
  // @balena (un through2 de readable-stream) entrega los bytes
  // pero nunca cierra a ojos de pipeline, y la promesa no se
  // asienta jamás (medido también). Con pipe y el «end» del
  // parser, la misma cadena termina.
  parser.on("entry", (e: ReadEntry) => {
    if (failure) {
      e.resume();
      return;
    }
    const fail = (message: string) => {
      failure = new LoadRefusal(`extraction refused for ${entry.id}: ${message}`);
      // Primero se asienta el flujo; el desmonte va después y
      // ya no puede colgar nada.
      settleFlow(failure);
      teardown();
      e.resume();
    };
    // La ruta efectiva: el parser ya aplicó la extensión pax y
    // el nombre largo GNU (VA-03). Un directorio puede traer la
    // barra final: se retira para comparar.
    const effective = e.path.replace(/\/+$/, "");
    if (effective.startsWith("/") || effective.includes("\\")) {
      fail(`an entry path is absolute or uses foreign separators: ${e.path}`);
      return;
    }
    const segments = effective.split("/");
    if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) {
      fail(`an entry path is not a plain relative path: ${e.path}`);
      return;
    }
    if (segments[0] !== rootName) {
      fail(`an entry lives outside the package root ${rootName}: ${e.path}`);
      return;
    }
    const stripped = segments.slice(1).join("/");
    if (e.type === "Directory") {
      if (
        stripped !== "" &&
        !entry.files.some((f) => f.path.startsWith(`${stripped}/`))
      ) {
        fail(`a directory that no manifest path needs: ${e.path}`);
        return;
      }
      e.resume();
      return;
    }
    if (e.type !== "File" && e.type !== "OldFile") {
      fail(`an entry is a ${e.type}, not a regular file: ${e.path}`);
      return;
    }
    if (stripped === "") {
      fail(`a regular file carries the package root name: ${e.path}`);
      return;
    }
    const declaredBytes = manifest.get(stripped);
    if (declaredBytes === undefined) {
      fail(`a file that is not in the manifest: ${e.path}`);
      return;
    }
    if (seen.has(stripped)) {
      fail(`a path repeated inside the package: ${e.path}`);
      return;
    }
    if (e.size !== declaredBytes) {
      fail(
        `the header size of ${stripped} is ${e.size}, not the ${declaredBytes} of the manifest`,
      );
      return;
    }
    seen.add(stripped);
    const target = path.join(stepDir, ...stripped.split("/"));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    const out = createWriteStream(target, { mode: 0o644 });
    writeStreams.push(out);
    writes.push(
      new Promise<void>((resolveWrite, rejectWrite) => {
        let settled = false;
        out.on("finish", () => {
          settled = true;
          resolveWrite();
        });
        out.on("error", (err) => {
          if (!failure) {
            failure = new LoadRefusal(
              `extraction refused for ${entry.id}: writing ${stripped} failed: ${err.message}`,
            );
          }
          settleFlow(failure);
          teardown();
          if (!settled) {
            settled = true;
            rejectWrite(err);
          }
        });
        out.on("close", () => {
          if (!settled) {
            settled = true;
            rejectWrite(
              new Error(`the write of ${stripped} closed before finishing`),
            );
          }
        });
      }),
    );
    e.pipe(out);
  });

  const flowError = await new Promise<Error | null>((resolveFlow) => {
    let settled = false;
    settleFlow = (err: Error | null) => {
      if (!settled) {
        settled = true;
        resolveFlow(err);
      }
    };
    source.on("error", (err) => {
      teardown();
      settleFlow(err);
    });
    decompressor.on("error", (err) => {
      teardown();
      settleFlow(err);
    });
    parser.on("error", (err) => {
      teardown();
      settleFlow(err);
    });
    parser.on("end", () => settleFlow(null));
    parser.on("close", () =>
      settleFlow(
        failure ?? new Error("the parser closed before the package ended"),
      ),
    );
    source.pipe(decompressor).pipe(parser);
  });
  await Promise.allSettled(writes);
  if (failure) throw failure;
  if (flowError) {
    throw new LoadRefusal(
      `extraction refused for ${entry.id}: the package could not be read (${flowError.message}). Nothing was installed.`,
    );
  }
  // VA-05, la segunda mitad: el modo con el que createWriteStream
  // crea el fichero pasa por el umask del proceso (0644 con
  // umask 027 nace 0640, medido), así que el modo de la casa se
  // fija expresamente sobre lo escrito, fichero a fichero.
  for (const rel of seen) {
    await chmod(path.join(stepDir, ...rel.split("/")), 0o644);
  }
}

/** El árbol extraído se cobra entero contra el manifiesto antes del renombrado. */
async function verifyExtractedTree(stepDir: string, entry: AssetEntry): Promise<void> {
  for (const file of entry.files) {
    const target = path.join(stepDir, ...file.path.split("/"));
    const st = await lstat(target).catch(() => null);
    if (!st?.isFile() || st.isSymbolicLink()) {
      throw new LoadRefusal(
        `extraction refused for ${entry.id}: ${file.path} is missing or is not a regular file in the extracted tree. Nothing was installed.`,
      );
    }
    if (st.size !== file.bytes) {
      throw new LoadRefusal(
        `extraction refused for ${entry.id}: ${file.path} has ${st.size} bytes on disk, not the ${file.bytes} of the manifest. Nothing was installed.`,
      );
    }
    if ((await sha256OfFile(target)) !== file.sha256) {
      throw new LoadRefusal(
        `extraction refused for ${entry.id}: sha256 mismatch for ${file.path} in the extracted tree. Nothing was installed.`,
      );
    }
  }
}

/**
 * Descarga (o reanuda) el activo de una entrada del catálogo de
 * activos hasta dejarlo verificado en el directorio de activos:
 * el de archivo, en `<assetsDir>/<id>`; el suelto, plano en
 * `<assetsDir>/<su fichero>` (VA-02: sin extracción ni directorio
 * de paso, renombrado del temporal verificado a su nombre).
 * Lanza ante cualquier fallo; una pausa deja el temporal para
 * reanudar y un fallo de verificación lo borra, como en los
 * modelos. Un árbol final que no verifica se retira entero y se
 * reinstala, y el resultado lo declara (la reparación de D-2,
 * en la forma de los activos).
 */
export async function downloadAsset(
  entry: AssetEntry,
  assetsDir: string,
  opts: DownloadOptions = {},
): Promise<AssetDownloadResult> {
  const root = path.resolve(assetsDir);
  const loose = isLooseAsset(entry);
  const tempPath = path.join(root, assetTempName(entry));
  const finalDir = loose ? root : path.join(root, entry.id);
  const finalFile = loose ? path.join(root, entry.files[0].path) : null;

  await refuseIfNotRegular(tempPath, entry.id);
  if (loose) {
    await refuseIfNotRegular(finalFile as string, entry.id);
  } else {
    const existingDir = await lstat(finalDir).catch(() => null);
    if (existingDir && !existingDir.isDirectory()) {
      throw new LoadRefusal(
        `download refused for ${entry.id}: "${entry.id}" exists in the assets directory and is not a directory. Nothing was written.`,
      );
    }
  }

  // Instalado y verificado por la puerta: no hay nada que bajar.
  // Un final que NO verifica se retira entero y se reinstala.
  let repairedCorruptFinal = false;
  const finalPresent = loose
    ? (await stat(finalFile as string).catch(() => null))?.isFile() === true
    : (await stat(finalDir).catch(() => null))?.isDirectory() === true;
  if (finalPresent) {
    const installedDir = await verifiedAssetDir(assetsDir, entry).then(
      (dir) => dir,
      () => null,
    );
    if (installedDir !== null) {
      return {
        dir: installedDir,
        bytes: entry.archiveBytes,
        resumedFrom: entry.archiveBytes,
        repairedCorruptFinal: false,
      };
    }
    await rm(loose ? (finalFile as string) : finalDir, {
      recursive: !loose,
      force: true,
    });
    repairedCorruptFinal = true;
  }

  // El temporal: completo y verificado se instala sin red; sano
  // a medias se reanuda; mayor que el paquete o corrupto se va.
  let resumeFrom = 0;
  let archiveReady = false;
  const part = await stat(tempPath).catch(() => null);
  if (part?.isFile()) {
    if (part.size > entry.archiveBytes) {
      await rm(tempPath, { force: true });
    } else if (part.size === entry.archiveBytes) {
      await verifyAssetArchive(tempPath, entry).catch(async (err) => {
        await rm(tempPath, { force: true });
        throw err;
      });
      archiveReady = true;
      resumeFrom = entry.archiveBytes;
    } else {
      resumeFrom = part.size;
    }
  }

  if (!archiveReady) {
    if (opts.signal?.aborted) throw new DownloadPaused(entry.id);
    const headers: Record<string, string> = {};
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
    const response = await fetchAssetResponse(entry, headers, opts.signal).catch(
      (err: unknown) => {
        if (opts.signal?.aborted) throw new DownloadPaused(entry.id);
        throw err;
      },
    );
    if (!response.ok || !response.body) {
      throw new LoadRefusal(
        `download failed for ${entry.id}: HTTP ${response.status} from the publisher. The partial file is kept for resume.`,
      );
    }
    const verdict = resumeVerdict(response, resumeFrom, entry.archiveBytes);
    if (verdict === "refuse") {
      throw new LoadRefusal(
        `download refused for ${entry.id}: the server answered the range request with a 206 that does not continue at byte ${resumeFrom}. The partial file is kept for resume.`,
      );
    }
    const append = verdict === "append";
    const useTemp = !append && resumeFrom > 0;
    const writePath = useTemp ? `${tempPath}.fresh` : tempPath;
    const countedFrom = append ? resumeFrom : 0;
    if (countedFrom > 0) opts.onProgress?.(countedFrom, entry.archiveBytes);

    // VA-10: el tope en vuelo de D-1, en la forma de los activos:
    // un cuerpo que supera los bytes declarados del paquete (en
    // el suelto, los de su fichero) aborta en el acto y lo
    // escrito por ese cuerpo se borra: no es un parcial
    // reanudable, es un cuerpo sin fin o corrupto.
    let received = countedFrom;
    let capBreached = false;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > entry.archiveBytes) {
          capBreached = true;
          callback(new Error("download cap breached"));
          return;
        }
        opts.onProgress?.(received, entry.archiveBytes);
        callback(null, chunk);
      },
    });
    const out = createWriteStream(writePath, { flags: append ? "a" : "w" });
    try {
      await pipeline(Readable.fromWeb(response.body as never), counter, out);
    } catch (err) {
      if (capBreached) {
        await rm(writePath, { force: true });
        throw new LoadRefusal(
          `download refused for ${entry.id}: the publisher sent more bytes than the ${entry.archiveBytes} the catalog declares. The overrun body was discarded; it is not a resumable partial.`,
        );
      }
      if (opts.signal?.aborted) {
        if (useTemp) await rm(writePath, { force: true });
        throw new DownloadPaused(entry.id);
      }
      if (useTemp) await rm(writePath, { force: true });
      throw err;
    }
    await verifyAssetArchive(writePath, entry).catch(async (err) => {
      await rm(writePath, { force: true });
      throw err;
    });
    if (useTemp) {
      // D-7: el cuerpo nuevo, ya verificado, sustituye al .part
      // anterior de una vez (el rename lo reemplaza entero).
      await rename(writePath, tempPath);
    }
    resumeFrom = countedFrom;
  }

  // Instalación desde el temporal verificado.
  if (loose) {
    await rename(tempPath, finalFile as string);
  } else {
    const stepDir = path.join(root, assetStepName(entry));
    // Un paso interrumpido se descarta entero: la extracción
    // nace siempre de un directorio de paso vacío.
    await rm(stepDir, { recursive: true, force: true });
    try {
      await extractAssetArchive(tempPath, stepDir, entry);
      await verifyExtractedTree(stepDir, entry);
    } catch (err) {
      await rm(stepDir, { recursive: true, force: true });
      throw err;
    }
    await rename(stepDir, finalDir);
    await rm(tempPath, { force: true });
  }

  // La puerta cobra la instalación entera antes de devolverla.
  const dir = await verifiedAssetDir(assetsDir, entry);
  return { dir, bytes: entry.archiveBytes, resumedFrom: resumeFrom, repairedCorruptFinal };
}
