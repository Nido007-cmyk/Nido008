/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El sello de construcción de la pasada del banco (R-1): la
 * disciplina que hace que una sesión mida el paquete que cree
 * medir. La construcción deja dos registros que deben casar
 * entre sí: el `build-info.json` dentro del paquete (con
 * `builtAt` y la foto del árbol: el HEAD y la marca de sucio
 * del instante en que la cadena empezó, capturados por
 * scripts/buildPhoto.mjs como primer paso de build:vite) y el
 * `build-seal.json` junto al directorio del paquete (con la
 * huella sha256 del app.asar producido y la misma foto
 * repetida, escrito por el paso que sella en el afterPack de
 * electron-builder.ts, ciego al sabor). Un fichero dentro del
 * asar no puede llevar la huella del asar que lo contiene:
 * por eso la huella vive fuera y la foto vive en las dos
 * copias.
 *
 * Este módulo es la mitad de los orquestadores: captura la
 * foto del árbol de este momento con el mismo cálculo que la
 * captura de la construcción, lee los dos registros del
 * paquete y los compara. Si algo no casa, la sesión no corre:
 * el orquestador escribe su registro como «no corrida» con la
 * causa y sale con código distinto de cero. Correr un paquete
 * rezagado sigue posible solo nombrándolo en el entorno
 * (NIDO_BENCH_ALLOW_STALE=1), y el registro cita ese nombre.
 */
import {execFileSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ALLOW_STALE_ENV = "NIDO_BENCH_ALLOW_STALE";

// La foto es sobre los caminos que la construcción consume
// (app/ y src/), con los productos de la propia construcción
// y del banco excluidos: un registro del banco o un dist
// recién empaquetado no ensucian la foto que los nombra.
const PHOTO_PATHS = ["app", "src"];
const PHOTO_EXCLUDES = [
    ":(exclude)app/bench-results",
    ":(exclude)app/release",
    ":(exclude)app/release-bench",
    ":(exclude)app/dist",
    ":(exclude)app/dist-electron",
    ":(exclude)app/build-info.json",
];

export function captureTreePhoto(repoDir) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repoDir, encoding: "utf8"}).trim();
    const status = execFileSync(
        "git",
        ["status", "--porcelain", "--", ...PHOTO_PATHS, ...PHOTO_EXCLUDES],
        {cwd: repoDir, encoding: "utf8"}
    );
    return {head, dirty: status.trim().length > 0};
}

function sha256File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(file);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

async function readPackagedBuildInfo(asarPath) {
    try {
        const asar = await import("@electron/asar");
        const raw = asar.extractFile(asarPath, "build-info.json");
        const parsed = JSON.parse(raw.toString("utf8"));
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

// La comparación entera, en su orden: el sello junto al
// paquete existe; la huella del asar en disco casa con la
// del sello; la construcción capturó la foto; el build-info
// dentro del paquete trae la misma foto que el sello (las
// dos copias casan entre sí); y la foto casa con el árbol
// de este momento. Devuelve {ok, stale, cause, seal,
// allowStale}: con la salida nombrada, ok es verdadero y
// stale trae la causa que se saltó, citada en el registro.
export async function checkFreshness(exePath, repoDir) {
    const allowStale = process.env[ALLOW_STALE_ENV] === "1";
    const dir = path.dirname(exePath);
    const asarPath = path.join(dir, "resources", "app.asar");
    let seal = null;
    try {
        seal = JSON.parse(fs.readFileSync(path.join(dir, "build-seal.json"), "utf8"));
    } catch { /* sin sello: la causa se asienta abajo */ }
    const summary = seal && typeof seal === "object"
        ? {
            builtAt: typeof seal.builtAt === "string" ? seal.builtAt : null,
            head: typeof seal.head === "string" ? seal.head : null,
            dirty: typeof seal.dirty === "boolean" ? seal.dirty : null,
            asarSha256: typeof seal.asarSha256 === "string" ? seal.asarSha256 : null,
        }
        : null;
    const fail = (cause) => ({ok: allowStale, stale: true, cause, seal: summary, allowStale});

    if (!summary || !summary.asarSha256)
        return fail("el paquete no trae sello de construcción (build-seal.json) junto a él");
    if (!fs.existsSync(asarPath))
        return fail("el paquete no trae resources/app.asar");
    const asarSha256 = await sha256File(asarPath);
    if (asarSha256 !== summary.asarSha256)
        return fail("la huella del app.asar en disco no casa con la del sello de construcción");
    if (seal.photoCaptured !== true)
        return fail("la construcción no capturó la foto del árbol (foto no capturada: la cadena se invocó saltándose su primer paso)");
    const inPkg = await readPackagedBuildInfo(asarPath);
    if (!inPkg || typeof inPkg.head !== "string")
        return fail("el paquete no trae build-info.json con la foto dentro del asar");
    if (inPkg.head !== summary.head || inPkg.dirty !== summary.dirty || inPkg.builtAt !== summary.builtAt)
        return fail("las dos copias de la foto (el sello junto al paquete y el build-info dentro) no casan entre sí");
    let now;
    try {
        now = captureTreePhoto(repoDir);
    } catch (err) {
        return fail(`la foto del árbol de este momento no se pudo capturar: ${String(err)}`);
    }
    if (now.head !== summary.head || now.dirty !== summary.dirty)
        return fail("la foto del sello no casa con el árbol de este momento (el árbol se movió tras construir)");
    return {ok: true, stale: false, cause: null, seal: summary, allowStale};
}

// El registro de una sesión que no corre: el orquestador lo
// escribe en su registro y sale con código distinto de cero.
export function notRunRecord(fresh) {
    return {
        status: "no corrida",
        cause: fresh.cause,
        buildSeal: fresh.seal,
        at: new Date().toISOString(),
    };
}

// Lo que el registro de una sesión que sí corre cita del
// sello: la construcción que midió, y la salida nombrada si
// la comparación se saltó por su nombre.
export function sealCitation(fresh) {
    return {
        ...fresh.seal,
        stale: fresh.stale,
        ...(fresh.stale ? {staleCause: fresh.cause, allowStaleEnv: `${ALLOW_STALE_ENV}=1`} : {}),
    };
}
