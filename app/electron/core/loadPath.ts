/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * LA VÍA DE CARGA — la única puerta por la que un GGUF llega al
 * parser nativo. Nace de la auditoría de ataque 1 (hallazgos A-2 y
 * M-2): la verificación no puede vivir solo en un script de
 * desarrollo; vive aquí, en la biblioteca que la app importa, y la
 * comparten el motor y la sonda.
 *
 * Reglas, todas fail-closed:
 *  - Nada de esquemas: una cadena `hf:`, `https://` o cualquier
 *    `://` se rechaza. node-llama-cpp acepta URIs y las descarga;
 *    esta puerta existe para que ninguna ruta de datos pueda
 *    convertir el motor en un descargador sin huellas.
 *  - Nada fuera del directorio de modelos: el nombre es un nombre
 *    de fichero, sin separadores ni `..`, y el camino resuelto debe
 *    quedar dentro del directorio.
 *  - Nada se parsea sin verificar antes: tamaño exacto y sha256
 *    contra el catálogo, sobre los bytes del fichero en streaming.
 *    Un GGUF hostil bien formado solo puede llegar al parser si su
 *    huella es la del catálogo.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetEntry } from "./assetCatalog.js";
import { isLooseAsset } from "./assetCatalog.js";
import type { CatalogEntry } from "./catalog.js";

/** Rechazo de la vía de carga: siempre con la causa en el mensaje. */
export class LoadRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadRefusal";
  }
}

/**
 * Resuelve el fichero de un modelo DENTRO del directorio de modelos.
 * `fileName` es un nombre, no una ruta: cualquier esquema, separador
 * o intento de salida se rechaza antes de tocar el disco.
 */
export async function resolveModelFile(
  modelsDir: string,
  fileName: string,
): Promise<string> {
  if (fileName.includes("://") || fileName.startsWith("hf:") || fileName.includes(":")) {
    throw new LoadRefusal(
      `refused: "${fileName}" looks like a URI, not a local model file. NIDO loads only verified local files.`,
    );
  }
  if (fileName !== path.basename(fileName) || fileName.includes("..")) {
    throw new LoadRefusal(
      `refused: "${fileName}" is not a plain file name inside the models directory.`,
    );
  }
  const dir = path.resolve(modelsDir);
  const resolved = path.resolve(dir, fileName);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new LoadRefusal(`refused: "${fileName}" resolves outside the models directory.`);
  }
  // lstat, no stat (D-3, mitad de lectura): un enlace con el
  // nombre de un modelo no es el modelo, aunque apunte a un
  // fichero regular; la puerta de carga solo abre ficheros
  // regulares que viven en el directorio, no destinos.
  const info = await lstat(resolved).catch(() => null);
  if (!info?.isFile()) {
    throw new LoadRefusal(`refused: model file not found: ${fileName}`);
  }
  return resolved;
}

/** sha256 de un fichero, en streaming sobre sus bytes. */
export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Verifica un fichero contra su entrada del catálogo: tamaño exacto
 * y huella. Lanza LoadRefusal ante cualquier diferencia; no devuelve
 * booleanos que un llamante pueda ignorar.
 */
export async function verifyModelFile(file: string, entry: CatalogEntry): Promise<void> {
  const info = await stat(file);
  if (info.size !== entry.fileBytes) {
    throw new LoadRefusal(
      `refused: size mismatch for ${entry.id}: file has ${info.size} bytes, catalog says ${entry.fileBytes}. Nothing was loaded.`,
    );
  }
  const digest = await sha256OfFile(file);
  if (digest !== entry.sha256) {
    throw new LoadRefusal(
      `refused: sha256 mismatch for ${entry.id}. Nothing was loaded.`,
    );
  }
}

/**
 * La puerta completa: resuelve `<id>.gguf` dentro del directorio de
 * modelos y lo verifica contra el catálogo. Si devuelve una ruta, el
 * fichero es el del catálogo; si no, ha lanzado.
 */
export async function verifiedModelPath(
  modelsDir: string,
  entry: CatalogEntry,
): Promise<string> {
  const file = await resolveModelFile(modelsDir, `${entry.id}.gguf`);
  await verifyModelFile(file, entry);
  return file;
}

// ── La puerta de los activos de voz (E9 paso 0, VA-09) ─────────────
//
// Hermana de verifiedModelPath para los activos multi-fichero de
// assetCatalog.ts: es el ÚNICO camino por el que la carcasa y el
// proceso de voz resuelven un activo instalado. Devuelve la raíz
// de resolución del manifiesto: para un activo de archivo, su
// directorio verificado (<assetsDir>/<id>); para el suelto, el
// propio <assetsDir>, porque su único fichero vive plano en la
// raíz (así lo acredita el censo de E4). Unir la raíz devuelta a
// cada camino del manifiesto da el fichero verificado.
//
// Cada componente del camino se comprueba con lstat SIN seguir
// enlaces (la lección VA-09: un componente sustituido por un
// enlace simbólico invalida el árbol entero) y cada fichero del
// manifiesto se verifica en tamaño y huella, como el GGUF de un
// modelo. Lo que haya de más en el árbol no invalida (simetría
// con la regla del manifiesto de modelos).
//
// Declaración VA-09 sobre el subárbol espeak-ng-data/ de Kokoro:
// se entrega como directorio de datos (dataDir) al motor, y esta
// puerta lo verifica fichero a fichero contra el manifiesto al
// entregar (los 355 ficheros están en el manifiesto, cada uno con
// su tamaño y su huella). Lo ajeno dentro del subárbol no
// invalida, y el motor solo abre nombres derivados de la
// configuración que el módulo de voz compone desde el manifiesto:
// ese es el residuo honesto de la puerta, declarado aquí y en el
// asiento del paso.
//
// El directorio de paso de la instalación (<id>.part) NO es un
// nombre resoluble por esta puerta: un id terminado en .part se
// rechaza por su nombre, y un árbol que solo exista bajo el
// directorio de paso no resuelve (la puerta busca <id>, no el
// paso).

/** Comprueba un componente con lstat: existe, no es un enlace y es del tipo pedido. */
async function lstatComponent(
  file: string,
  want: "file" | "dir",
  label: string,
): Promise<void> {
  let st;
  try {
    st = await lstat(file);
  } catch {
    throw new LoadRefusal(`missing ${label}: ${file}`);
  }
  if (st.isSymbolicLink()) {
    throw new LoadRefusal(
      `refusing to follow a symbolic link at ${label}: ${file}`,
    );
  }
  if (want === "file" && !st.isFile()) {
    throw new LoadRefusal(`${label} is not a regular file: ${file}`);
  }
  if (want === "dir" && !st.isDirectory()) {
    throw new LoadRefusal(`${label} is not a directory: ${file}`);
  }
}

/**
 * Verifica un fichero del manifiesto dentro de una raíz ya
 * resuelta: recorre sus componentes sin seguir enlaces y cobra
 * tamaño y huella al final. Devuelve la ruta verificada.
 */
async function verifyManifestFile(
  rootDir: string,
  rel: string,
  bytes: number,
  sha256: string,
  assetId: string,
): Promise<string> {
  if (
    rel.startsWith("/") ||
    rel
      .split("/")
      .some((seg) => seg === "" || seg === "." || seg === ".." || seg.includes("\\"))
  ) {
    throw new LoadRefusal(
      `asset ${assetId} declares a manifest path that is not a plain relative path: ${rel}`,
    );
  }
  const segments = rel.split("/");
  let current = rootDir;
  for (const seg of segments.slice(0, -1)) {
    current = path.join(current, seg);
    await lstatComponent(current, "dir", `directory component of ${assetId}/${rel}`);
  }
  const file = path.join(current, segments[segments.length - 1]);
  await lstatComponent(file, "file", `manifest file of asset ${assetId}`);
  const st = await stat(file);
  if (st.size !== bytes) {
    throw new LoadRefusal(
      `size mismatch for ${assetId}/${rel}: expected ${bytes}, found ${st.size}`,
    );
  }
  if ((await sha256OfFile(file)) !== sha256) {
    throw new LoadRefusal(
      `sha256 mismatch for ${assetId}/${rel}: the file on disk is not the pinned asset file`,
    );
  }
  return file;
}

export async function verifiedAssetDir(
  assetsDir: string,
  entry: AssetEntry,
): Promise<string> {
  const root = path.resolve(assetsDir);
  // Nombre plano o nada: el id del catálogo nombra el directorio
  // del activo; un id con separadores, con .. o terminado en
  // .part (el directorio de paso de la instalación) no resuelve.
  if (
    entry.id === "" ||
    entry.id === "." ||
    entry.id === ".." ||
    entry.id !== path.basename(entry.id) ||
    entry.id.includes("\\") ||
    entry.id.endsWith(".part")
  ) {
    throw new LoadRefusal(`asset id is not a plain directory name: ${entry.id}`);
  }
  if (isLooseAsset(entry)) {
    // El suelto vive plano en la raíz del directorio de activos:
    // su único fichero se verifica ahí y la raíz de resolución
    // del manifiesto es el propio directorio de activos.
    const only = entry.files[0];
    await verifyManifestFile(root, only.path, only.bytes, only.sha256, entry.id);
    return root;
  }
  const dir = path.join(root, entry.id);
  if (path.dirname(dir) !== root) {
    throw new LoadRefusal(`asset directory escapes the assets directory: ${entry.id}`);
  }
  await lstatComponent(dir, "dir", `asset directory of ${entry.id}`);
  for (const file of entry.files) {
    await verifyManifestFile(dir, file.path, file.bytes, file.sha256, entry.id);
  }
  return dir;
}
