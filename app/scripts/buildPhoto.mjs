/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El primer paso de la cadena de construcción (antepuesto a
 * build:vite en app/package.json): captura la foto del árbol
 * en el instante en que la construcción va a leerlo — el
 * HEAD de ese instante y su marca de árbol sucio, con el
 * cálculo de scripts/buildSeal.mjs — y la deja en
 * app/build-info.json, el fichero que la app ya lee para la
 * cadena de construcción de su Acerca de (services.ts) y que
 * viaja dentro del paquete por la lista files de
 * electron-builder.ts. El paso que sella (el afterPack de
 * electron-builder.ts) repite esta foto en el
 * build-seal.json junto al paquete, con la huella del asar.
 *
 * Tomar la foto después reproduciría el defecto del sello
 * viejo de photos.mjs (el commit tomado al arrancar el
 * orquestador, tras construir): la foto es del inicio de la
 * cadena o no es del paquete.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {captureTreePhoto} from "./buildSeal.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "..");

const photo = captureTreePhoto(repoDir);
const builtAt = new Date().toISOString();
const info = {
    build: `${photo.head.slice(0, 7)} · ${builtAt}`,
    builtAt,
    head: photo.head,
    dirty: photo.dirty,
};
fs.writeFileSync(path.join(appDir, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`buildPhoto: foto del árbol capturada (${info.build}${photo.dirty ? ", árbol sucio" : ""})`);
