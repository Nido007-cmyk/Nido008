/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La sincronización de la sede única del núcleo (decisión
 * de apertura de E4, vía C, firmada en estudios/E4-SEDE-NUCLEO.md
 * §3 y en estudios/E4-APERTURA.md §3.1): la raíz src/core/ es
 * el único árbol que se edita a mano, y la copia de
 * app/electron/core/ es una copia generada por este script,
 * byte a byte, nunca editada a mano. Corre como paso previo
 * de la construcción de la carcasa (gancho prebuild:vite de
 * app/package.json): ningún paquete se construye jamás desde
 * una copia vieja, porque la copia se regenera desde la raíz
 * del mismo árbol de trabajo antes de agrupar.
 *
 * La lista de sincronización nace con las cinco piezas de la
 * fundación y crece por asiento: las piezas puras nuevas de
 * E4 (machine.ts, modelCards.ts, library.ts y assetCatalog.ts)
 * nacen en src/core/ y entraron en la lista en el paso 5,
 * cuando el gestor de proceso (app/electron/modelManager.ts)
 * se convirtió en su primer consumidor en la carcasa. La
 * guarda de la batería de la raíz (src/core/coreCopy.test.ts)
 * trae la misma lista y exige sha256 idénticos por pareja y
 * el mismo censo de ficheros en ambos árboles: si esta lista
 * y la suya divergen, la guarda cae, que es su trabajo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const SYNCED_CORE_FILES = [
    "ram.ts",
    "catalog.ts",
    "engine.ts",
    "loadPath.ts",
    "download.ts",
    "machine.ts",
    "modelCards.ts",
    "library.ts",
    "assetCatalog.ts",
];

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootCoreDir = path.resolve(appDir, "..", "src", "core");
const copyCoreDir = path.resolve(appDir, "electron", "core");

function sha256Of(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

fs.mkdirSync(copyCoreDir, {recursive: true});
for (const name of SYNCED_CORE_FILES) {
    const from = path.join(rootCoreDir, name);
    const to = path.join(copyCoreDir, name);
    fs.copyFileSync(from, to);
    console.log(`sync-core: ${name} sha256 ${sha256Of(to)}`);
}
console.log(`sync-core: ${SYNCED_CORE_FILES.length} piezas sincronizadas desde src/core/ (la raíz es la única sede; esta copia no se edita a mano)`);
