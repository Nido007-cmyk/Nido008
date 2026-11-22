#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Suite de endurecimiento de la carcasa (INSTALADOR-ETAPA paso 5;
 * CARCASA-PC §6 paso 5). Corre CONTRA LOS PAQUETES construidos
 * (release/ el de producción y release-bench/ el del banco) y
 * contra los informes del banco (bench-results/), nunca contra el
 * código fuente como sustituto:
 *
 *  1. Los OCHO fusibles de Electron, leídos del binario de
 *     producción (@electron/fuses) y asertados uno a uno contra su
 *     valor esperado declarado: 0 RunAsNode fuera, 1
 *     EnableCookieEncryption dentro (decisión D-1 de la tanda de
 *     arreglos de la carcasa), 2
 *     EnableNodeOptionsEnvironmentVariable fuera, 3
 *     EnableNodeCliInspectArguments fuera, 4
 *     EnableEmbeddedAsarIntegrityValidation dentro (en Linux es
 *     estado, no imposición: la plataforma no lo impone al cargar
 *     y su prueba de imposición vive en la pierna de Windows de
 *     E12), 5 OnlyLoadAppFromAsar dentro, 6
 *     LoadBrowserProcessSpecificV8Snapshot fuera, 7
 *     GrantFileProtocolExtraPrivileges fuera (CARCASA-F7). La
 *     lista es cerrada a propósito: el próximo fusible que
 *     Electron añada nace como hueco visible en esta cabecera, no
 *     como silencio.
 *  2. El bundle principal del paquete de producción (la entrada y
 *     sus chunks compartidos, sin la entrada del banco ni el
 *     preload): webPreferences selladas (contextIsolation sí,
 *     nodeIntegration no, sandbox sí, devTools no),
 *     actualizador en manual (autoDownload y autoInstallOnAppQuit
 *     en false), verifyUpdateCodeSignature jamás en false, la
 *     guarda isPackaged presente (CARCASA-DEVURL; su puerta de
 *     conducta es S-DEVURL) y los dos manejadores de permisos
 *     instalados (CARCASA-PERMISOS; su puerta de conducta es
 *     S-PERM). El bundle principal de producción no contiene
 *     NIDO_BENCH (CARCASA-BANCO-FUERA).
 *  2b. Censo del asar de producción: la entrada del banco no está
 *     en el paquete de producción y sí está, como principal, en el
 *     paquete-banco; y ningún fichero JS del asar de producción
 *     contiene la cadena NIDO_BENCH (el censo es sobre todo el
 *     asar: si la partición de Rollup dejara código del banco en
 *     un chunk compartido, este check lo caza).
 *  3. D-1 estructural: la vía heredada del scaffold no existe en
 *     ningún paquete: ni selectModelFileAndLoad, ni showOpenDialog,
 *     ni el canal llmRpc, ni una sola llamada a getLlama() sin
 *     skipDownload. Las vías que quedan son cuatro, una lista
 *     cerrada, todas con el sello en verdadero en el sitio:
 *     (i) LocalEngine.load (app/electron/core/engine.ts), a la que
 *     llama el banco al montar su modelo; (ii)
 *     EmbeddingEngine.loadNow (src/rag/embed.ts), a la que llama
 *     su propio ensureLoaded; (iii) LlamaEngine.load
 *     (src/inference/LlamaEngine.ts), a la que llama el singleton
 *     del turno; (iv) LlamaEngine.grammarFor (el mismo fichero), a
 *     la que llama la generación de la fachada con
 *     responseFormat. La gemela de src/core/engine.ts no viaja en
 *     el paquete y no cuenta como quinta vía. El núcleo viaja en
 *     el paquete-banco desde la partición, y es sobre sus bundles
 *     donde se resuelve el alias, fichero a fichero: cada chunk
 *     minifica el suyo, y el censo de invocaciones se hace dentro
 *     de cada fichero, nunca sobre el texto unido.
 *  4. El bundle del renderizador dentro del asar de producción:
 *     sin enlaces de descarga de modelos (R-1), sin
 *     api.github.com (la insignia retirada), sin llmRpc; y la CSP
 *     en dist/index.html con default-src 'self' y SIN
 *     frame-ancestors (D-4: por <meta> no se promete lo que la
 *     especificación ignora).
 *  5. Los informes del banco (corridas reales de los paquetes):
 *     webPreferences efectivas, mundo de la página sin Node y sin
 *     ipcRenderer expuesto (cierre de D-2: no hay objeto que el
 *     puente pueda devolver ni proxificar), puente nombrado
 *     presente, window.open denegado sin crear ventanas, navegación
 *     fuera bloqueada, actualizador quieto (cero comprobaciones sin
 *     petición) y la respuesta del motor presente (paso 2). Y las
 *     sondas vivas de la tanda de arreglos: S-FETCH (la página no
 *     lee el fichero canario fuera del asar y su contenido no
 *     aparece en ningún informe), S-PERM (ningún permiso se lee
 *     granted; notificaciones denegadas; getUserMedia rechazado
 *     por permiso, NotAllowedError), S-DEVTOOLS (ni Ctrl+Shift+I
 *     ni F12 abren DevTools) y S-DEVURL (con la variable de
 *     desarrollo puesta a un origen remoto, la página cargada es
 *     la local y el puente está en ella).
 *  6. D-1 en ejecución: el informe tamper dice rechazado por huella
 *     (LoadRefusal) ante el GGUF alterado en un byte.
 *  7. Los censos del banco: cero sockets en escucha en los tres
 *     estados (reposo, cargado, generando); el censo saliente del
 *     arranque en frío con reposo no emite ningún destino fuera de
 *     la lista permitida de esta suite (CARCASA-RED-ARRANQUE); y
 *     la guardia de arranque de D-7: lanzado con
 *     --remote-debugging-port, el paquete de producción sale sin
 *     ventana.
 *
 * Uso: primero `npm run bench` (genera bench-results/), después
 * `npm run hardening`. Sale con código 1 si algo falla, nombrando
 * cada fallo; un solo fallo abierto en los tests de D-1 tumba la
 * carcasa según el criterio sellado de la etapa.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {getCurrentFuseWire, FuseState} from "@electron/fuses";
import * as asar from "@electron/asar";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const exePath = path.join(appDir, "release", "linux-unpacked", "nido-pc");
const asarPath = path.join(appDir, "release", "linux-unpacked", "resources", "app.asar");
const benchAsarPath = path.join(appDir, "release-bench", "linux-unpacked", "resources", "app.asar");
const benchDir = path.join(appDir, "bench-results");

// Lista de destinos salientes permitidos en el arranque
// (CARCASA-RED-ARRANQUE, decisión D-3): nace vacía y solo crece
// con el residuo que una decisión firmada nombre, con su nombre.
// Formato: "dns:<nombre>" para preguntas al resolvedor y
// "net:<dirección>:<puerto>" para conexiones y envíos.
//
// Residuo firmado por D-3 en la tanda de arreglos de la carcasa
// (2026-11-16): la maquinaria de actualización de componentes de
// Chromium consulta redirector.gvt1.com al arrancar y abre su
// conexión TLS, y ninguna de las dos palancas de la decisión la
// apaga en Electron 45.3.3 (disable-component-update y
// disable-background-networking, agotadas y medidas sobre la app
// viva). El residuo es esa consulta y nada más: la pregunta al
// resolvedor del sistema (198.19.0.1:53 en esta VM), el nombre
// preguntado y su extremo :443 (198.18.205.53 es la dirección
// sintética que el resolvedor de esta VM asigna al nombre; en
// otra red el extremo llevará la dirección real del servicio).
// El DoH integrado sí quedó apagado (ningún extremo :443 de
// resolvedores de terceros en el censo). Cualquier destino nuevo
// fuera de estos tres vuelve a poner el check en rojo.
const ALLOWED_OUTBOUND_DESTINATIONS = [
    "dns:redirector.gvt1.com",
    "net:198.18.205.53:443",
    "net:198.19.0.1:53"
];

const results = [];
function check(name, ok, detail = "") {
    results.push({name, ok, detail});
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Extrae un fichero de un asar como texto; las entradas que no
// son ficheros regulares (directorios —uno puede llamarse
// «highlight.js»—, enlaces) devuelven cadena vacía.
function extractIfFile(asarFile, file) {
    try {
        return asar.extractFile(asarFile, file.slice(1)).toString("utf8");
    } catch {
        return "";
    }
}

// Los JS de un asar bajo un prefijo, como texto unido.
function asarJsText(asarFile, prefix, exclude = []) {
    return asar.listPackage(asarFile, {})
        .filter((file) => file.startsWith(prefix) && file.endsWith(".js") &&
            !exclude.some((name) => file.endsWith(name)))
        .map((file) => extractIfFile(asarFile, file))
        .join("\n");
}

// El bundle principal de un paquete: la entrada y sus chunks
// compartidos en dist-electron/, sin el preload y sin la entrada
// del banco (que es otro principal, no este).
function mainBundleText(asarFile) {
    return asarJsText(asarFile, "/dist-electron/", ["preload.mjs", "bench.js"]);
}

// Los bundles donde viaja el núcleo (la entrada del banco y sus
// chunks): en el paquete-banco; antes de la partición, en el de
// producción, que era el único.
function nucleusBundleText() {
    const source = fs.existsSync(benchAsarPath) ? benchAsarPath : asarPath;
    return asarJsText(source, "/dist-electron/", ["preload.mjs"]);
}

// Los ficheros donde viaja el núcleo, SIN unir: cada chunk
// resuelve su propio alias de getLlama al minificar, así que el
// censo de invocaciones de D-1/A-3 se hace fichero a fichero.
// Unir los textos mezclaría alias distintos bajo un solo nombre
// y cegaría el conteo (en el chunk de servicios, el alias que el
// chunk del banco usa para getLlama nombra otra función).
function nucleusBundleFiles() {
    const source = fs.existsSync(benchAsarPath) ? benchAsarPath : asarPath;
    return asar.listPackage(source, {})
        .filter((file) => file.startsWith("/dist-electron/") && file.endsWith(".js") &&
            !file.endsWith("preload.mjs"))
        .map((file) => ({file, text: extractIfFile(source, file)}));
}

async function main() {
    if (!fs.existsSync(exePath) || !fs.existsSync(asarPath))
        throw new Error("no hay paquete: construye antes con npm run dist:dir");

    // 1 · Los ocho fusibles del binario de producción --------------
    const wire = await getCurrentFuseWire(exePath);
    const fuse = (index) => wire[index];
    check("fusible RunAsNode desactivado", fuse(0) === FuseState.DISABLE,
        `valor ${fuse(0)}`);
    check("fusible EnableCookieEncryption activado (decisión D-1)",
        fuse(1) === FuseState.ENABLE, `valor ${fuse(1)}`);
    check("fusible EnableNodeOptionsEnvironmentVariable desactivado",
        fuse(2) === FuseState.DISABLE, `valor ${fuse(2)}`);
    check("fusible EnableNodeCliInspectArguments desactivado (sin inspección de Node)",
        fuse(3) === FuseState.DISABLE, `valor ${fuse(3)}`);
    check("fusible EnableEmbeddedAsarIntegrityValidation activado (en Linux es estado, no imposición; la imposición se prueba en E12)",
        fuse(4) === FuseState.ENABLE, `valor ${fuse(4)}`);
    check("fusible OnlyLoadAppFromAsar activado",
        fuse(5) === FuseState.ENABLE, `valor ${fuse(5)}`);
    check("fusible LoadBrowserProcessSpecificV8Snapshot desactivado",
        fuse(6) === FuseState.DISABLE, `valor ${fuse(6)}`);
    check("fusible GrantFileProtocolExtraPrivileges desactivado",
        fuse(7) === FuseState.DISABLE, `valor ${fuse(7)}`);

    // 2 · Bundle principal del paquete de producción ----------------
    const mainBundle = mainBundleText(asarPath);
    check("webPreferences en el paquete: contextIsolation true",
        /contextIsolation:\s*(true|!0)/.test(mainBundle));
    check("webPreferences en el paquete: nodeIntegration false",
        /nodeIntegration:\s*(false|!1)/.test(mainBundle));
    check("webPreferences en el paquete: sandbox true",
        /sandbox:\s*(true|!0)/.test(mainBundle));
    check("webPreferences en el paquete: devTools false",
        /devTools:\s*(false|!1)/.test(mainBundle));
    check("actualizador manual en el paquete: autoDownload = false",
        /autoDownload\s*=\s*(false|!1)/.test(mainBundle));
    check("actualizador manual en el paquete: autoInstallOnAppQuit = false",
        /autoInstallOnAppQuit\s*=\s*(false|!1)/.test(mainBundle));
    check("verifyUpdateCodeSignature jamás en false (bundle principal)",
        !/verifyUpdateCodeSignature\s*[:=]\s*(false|!1)/.test(mainBundle));

    // 2b · Ventana (VENTANA-LINUX-T14 §4.2, registros 3(a) y 8(a)+(c),
    // tanda 14): el censo de código sobre el mismo bundle principal.
    // El alcance es el bundle del proceso principal empaquetado: las
    // ausencias se cazan atadas a las opciones y llamadas de la
    // ventana, no sobre el texto entero de la app.
    check("ventana R3(a): la retirada del menú de aplicación está en el paquete",
        /setApplicationMenu\(\s*null\s*\)/.test(mainBundle));
    check("ventana R8(a): el fondo de arranque #F7F5F0 está en la creación de la ventana",
        mainBundle.includes("#F7F5F0"));
    check("ventana R8(a): ninguna ventana transparente en el proceso principal",
        !/transparent\s*:\s*(true|!0)/.test(mainBundle));
    check("ventana R8(a): ninguna opacidad fijada en la creación de la ventana",
        !/opacity\s*:\s*[\d.]/.test(mainBundle));
    check("ventana R8(c): ningún registro de pantalla completa propia en el proceso principal",
        !/setFullScreen\s*\(/.test(mainBundle) && !/simple-full-screen|simpleFullscreen/.test(mainBundle));

    // 3 · D-1 estructural, sobre los bundles de ambos paquetes ------
    const nucleusBundle = nucleusBundleText();
    const allMainBundles = `${mainBundle}\n${nucleusBundle}`;
    check("D-1: sin selectModelFileAndLoad en el paquete",
        !allMainBundles.includes("selectModelFileAndLoad"));
    check("D-1: sin showOpenDialog en el paquete (no hay selector libre de GGUF)",
        !allMainBundles.includes("showOpenDialog"));
    check("D-1: sin canal llmRpc en el paquete",
        !allMainBundles.includes("llmRpc"));
    // La llamada viaja minificada con alias (`getLlama as F` en el
    // import; la llamada es `F({ skipDownload: !0 })`): los checks
    // resuelven el alias desde el propio bundle en vez de buscar el
    // nombre literal, que solo aparece en el import.
    const llamaAlias = nucleusBundle.match(/getLlama as (\w+)/)?.[1];
    check("D-1/A-3: ninguna llamada getLlama() sin opciones en el paquete",
        llamaAlias != null &&
        !new RegExp(`\\b${llamaAlias}\\(\\s*\\)`).test(nucleusBundle) &&
        !/getLlama\(\s*\)/.test(nucleusBundle),
        `alias en el bundle: ${llamaAlias ?? "no resuelto"}`);
    // D-1/A-3 en su forma A (cadena de la carcasa): la expectativa
    // heredada de una sola vía era el resto de E1; el censo
    // verdadero es de cuatro vías (cabecera, punto 3). La
    // comprobación resuelve el alias dentro de cada fichero y
    // cuenta TODA invocación del alias con argumentos, exigiendo
    // el sello en cada una: una quinta vía, o una primera sin
    // sello, tumba la suite. La guarda no se rebaja: cambia su
    // expectativa de un número heredado a la lista cerrada que
    // vigila.
    const llamaInvocations = [];
    for (const {file, text} of nucleusBundleFiles()) {
        const fileAlias = text.match(/getLlama as (\w+)/)?.[1];
        if (!fileAlias) continue;
        for (const m of text.matchAll(new RegExp(`\\b${fileAlias}\\(([^)]*)\\)`, "g")))
            llamaInvocations.push({file, args: m[1]});
    }
    check("D-1/A-3: las cuatro vías getLlama del paquete llevan skipDownload en verdadero en el sitio",
        llamaInvocations.length === 4 &&
        llamaInvocations.every((inv) => /skipDownload:\s*(!0|true)/.test(inv.args)),
        `invocaciones del alias: ${llamaInvocations.length}` +
        (llamaInvocations.length
            ? `, por fichero: ${llamaInvocations.map((inv) => inv.file.split("/").pop()).join(", ")}`
            : ""));

    // Vigilante de configuración (fuente de construcción, no paquete):
    const builderConfig = fs.readFileSync(path.join(appDir, "electron-builder.ts"), "utf8");
    check("verifyUpdateCodeSignature ausente de la configuración de construcción",
        !builderConfig.includes("verifyUpdateCodeSignature"));

    check("CARCASA-BANCO-FUERA: el bundle principal de producción no contiene NIDO_BENCH",
        !mainBundle.includes("NIDO_BENCH"));
    check("CARCASA-DEVURL: la guarda isPackaged está presente en el bundle principal de producción",
        mainBundle.includes("isPackaged"));
    check("CARCASA-PERMISOS: los dos manejadores de permisos están instalados en el bundle principal",
        mainBundle.includes("setPermissionRequestHandler") &&
        mainBundle.includes("setPermissionCheckHandler"));

    // 2b · Censo del asar de producción ------------------------------
    const packageFiles = asar.listPackage(asarPath, {});
    const benchPackageFiles = fs.existsSync(benchAsarPath)
        ? asar.listPackage(benchAsarPath, {})
        : null;
    const benchPackageJson = benchPackageFiles
        ? JSON.parse(asar.extractFile(benchAsarPath, "package.json").toString("utf8"))
        : null;
    check("CARCASA-BANCO-FUERA: la entrada del banco no está en producción y es el principal del paquete-banco",
        !packageFiles.some((file) => file.endsWith("dist-electron/bench.js")) &&
        benchPackageFiles != null &&
        benchPackageFiles.some((file) => file.endsWith("dist-electron/bench.js")) &&
        (benchPackageJson?.main ?? "").includes("bench.js"),
        benchPackageFiles == null ? "sin paquete-banco construido" : `main del banco: ${benchPackageJson?.main}`);
    const productionJsWithBenchCode = packageFiles
        .filter((file) => file.endsWith(".js"))
        .filter((file) => extractIfFile(asarPath, file).includes("NIDO_BENCH"));
    check("CARCASA-BANCO-FUERA: ningún fichero JS del asar de producción contiene NIDO_BENCH",
        productionJsWithBenchCode.length === 0,
        productionJsWithBenchCode.join(", "));

    // 4 · Bundle del renderizador ------------------------------------
    const rendererBundles = packageFiles.filter(
        (file) => file.startsWith("/dist/assets/") && file.endsWith(".js"));
    check("el paquete trae exactamente un bundle de renderizador",
        rendererBundles.length === 1, rendererBundles.join(", "));
    const rendererBundle = rendererBundles
        .map((file) => asar.extractFile(asarPath, file.slice(1)).toString("utf8"))
        .join("\n");
    check("R-1: sin enlaces huggingface.co en el renderizador",
        !rendererBundle.includes("huggingface.co"));
    check("sin api.github.com en el renderizador (insignia retirada, no dormida)",
        !rendererBundle.includes("api.github.com"));
    check("D-1: sin llmRpc en el renderizador", !rendererBundle.includes("llmRpc"));

    const indexHtml = asar.extractFile(asarPath, "dist/index.html").toString("utf8");
    const cspMatch = indexHtml.match(/Content-Security-Policy" content="([^"]*)"/);
    check("CSP presente en la ventana empaquetada", cspMatch != null);
    check("CSP con default-src 'self'",
        cspMatch != null && cspMatch[1].includes("default-src 'self'"),
        cspMatch?.[1] ?? "");
    check("D-4: la CSP de la meta no promete frame-ancestors",
        cspMatch != null && !cspMatch[1].includes("frame-ancestors"));

    // 5 y 6 · Informes del banco --------------------------------------
    const benchReportPath = path.join(benchDir, "bench-report.json");
    const summaryPath = path.join(benchDir, "summary.json");
    if (!fs.existsSync(benchReportPath) || !fs.existsSync(summaryPath)) {
        check("informes del banco presentes (npm run bench antes que la suite)", false,
            "faltan bench-report.json o summary.json");
    } else {
        const report = readJson(benchReportPath);
        const summary = readJson(summaryPath);

        check("banco: webPreferences pasadas a la ventana (contextIsolation)",
            report.webPreferences?.contextIsolation === true);
        check("banco: webPreferences pasadas a la ventana (nodeIntegration)",
            report.webPreferences?.nodeIntegration === false);
        check("banco: webPreferences pasadas a la ventana (sandbox)",
            report.webPreferences?.sandbox === true);

        const probes = report.rendererProbes ?? {};
        check("banco: la página no ve require", probes.typeofRequire === "undefined");
        check("banco: la página no ve process", probes.typeofProcess === "undefined");
        check("banco: la página no ve module", probes.typeofModule === "undefined");
        check("D-2: ipcRenderer NO está expuesto a la página en ninguna forma",
            probes.ipcRendererExposed === false);
        check("banco: el puente nombrado (window.nido.checkForUpdates) existe",
            probes.hasNidoBridge === true);
        check("banco: la raíz de la ventana montó contenido",
            typeof probes.rootChildren === "number" && probes.rootChildren > 0,
            `hijos: ${probes.rootChildren}`);
        check("banco: la CSP llega al documento de la ventana",
            typeof probes.csp === "string" && probes.csp.includes("default-src 'self'"));

        check("banco: window.open hacia fuera denegado y sin ventanas nuevas",
            report.windowOpen?.windowsAfter === report.windowOpen?.windowsBefore &&
            (report.windowOpen?.attempts ?? []).some(
                (attempt) => attempt.url.includes("example.com") && attempt.decision === "deny"),
            JSON.stringify(report.windowOpen?.attempts ?? []));
        check("banco: la navegación hacia fuera quedó bloqueada",
            report.navigation?.stillAppUrl === true &&
            (report.navigation?.attempts ?? []).some((attempt) => attempt.blocked),
            `url final: ${report.navigation?.urlAfter}`);

        check("banco: actualizador en manual, leído del paquete en ejecución",
            report.updater?.autoDownload === false &&
            report.updater?.autoInstallOnAppQuit === false);
        check("banco: cero comprobaciones de actualización sin petición",
            report.updater?.updateChecksRequested === 0,
            `peticiones: ${report.updater?.updateChecksRequested}`);

        // DC-1 (AUDITORIA-DISCO-CLARO): el informe guarda la
        // respuesta como métricas y huella, y ni el informe ni el
        // resumen ni el registro de stdout de la corrida contienen
        // la pregunta de la sonda ni texto de respuesta.
        const benchRaw = fs.readFileSync(benchReportPath, "utf8");
        const summaryRaw = fs.readFileSync(summaryPath, "utf8");
        const stdoutLogPath = path.join(benchDir, "app-stdout.log");
        const stdoutRaw = fs.existsSync(stdoutLogPath)
            ? fs.readFileSync(stdoutLogPath, "utf8")
            : "";
        check("paso 2: el motor respondió desde el paquete",
            typeof report.answer?.chars === "number" && report.answer.chars > 0 &&
            typeof report.answer?.sha256 === "string" &&
            /^[0-9a-f]{64}$/.test(report.answer.sha256) &&
            !benchRaw.includes("capital of France") &&
            !summaryRaw.includes("capital of France") &&
            !stdoutRaw.includes("capital of France"),
            `caracteres: ${report.answer?.chars}, sha256: ${report.answer?.sha256?.slice(0, 12)}…`);
        check("paso 2: la carga fue por la vía de la casa (loadPath)",
            report.engine?.verifiedViaLoadPath === true &&
            report.engine?.modelId === "qwen3-0.6b-q4km");

        // 6 · D-1 en ejecución
        const tamper = summary.tamperTest;
        check("D-1: el GGUF alterado en un byte fue RECHAZADO por la interfaz de carga",
            tamper?.verdict === "rejected" && tamper?.report?.rejected === true,
            tamper?.report?.error ?? tamper?.verdict ?? "sin informe tamper");
        check("D-1: el rechazo fue por huella (LoadRefusal de loadPath)",
            tamper?.report?.loadRefusal === true &&
            /sha256/i.test(tamper?.report?.error ?? ""),
            tamper?.report?.error ?? "");

        // 7 · Censo de puertos en escucha
        for (const state of ["rest", "loaded", "generating"]) {
            const sample = summary.states?.[state];
            check(`paso 3: cero sockets en escucha en estado ${state}`,
                sample != null && Array.isArray(sample.listeningSockets) &&
                sample.listeningSockets.length === 0,
                sample == null ? "sin muestra" : `${sample.listeningSockets.length} en escucha`);
        }
    }

    // 5b · Sondas vivas de la carcasa (informes probe y hostil) -------
    const probeReportPath = path.join(benchDir, "probe-report.json");
    const probeHostilePath = path.join(benchDir, "probe-hostile.json");
    const canaryPath = path.join(benchDir, "canary.txt");
    if (!fs.existsSync(probeReportPath)) {
        check("informes de sondas presentes (npm run bench antes que la suite)", false,
            "falta probe-report.json");
    } else {
        const probeRaw = fs.readFileSync(probeReportPath, "utf8");
        const probe = JSON.parse(probeRaw);
        const fullRaw = fs.existsSync(benchReportPath)
            ? fs.readFileSync(benchReportPath, "utf8")
            : "";
        const canary = fs.existsSync(canaryPath)
            ? fs.readFileSync(canaryPath, "utf8").trim()
            : "";
        check("S-FETCH: la página no pudo leer el fichero canario fuera del asar",
            probe.fileFetch?.attempted === true &&
            probe.fileFetch?.blocked === true &&
            canary.length > 0 &&
            !probeRaw.includes(canary) && !fullRaw.includes(canary),
            `bloqueado: ${probe.fileFetch?.blocked}, error: ${probe.fileFetch?.errorName}`);
        const query = probe.permissions?.query ?? {};
        const permissionNames = ["microphone", "camera", "geolocation", "notifications", "midi", "clipboard-read"];
        // E9 paso 1: «media» es el único permiso de la allowlist
        // (para el dictado, y solo desde su gesto); el micrófono
        // puede leerse granted y es el único que puede. Todo lo
        // demás sigue denegado por defecto.
        check("S-PERM: ningún permiso consultado se lee granted salvo el micrófono (media, E9)",
            permissionNames.every((name) => query[name] != null && (name === "microphone" || query[name] !== "granted")),
            permissionNames.map((name) => `${name}=${query[name]}`).join(", "));
        check("S-PERM: notificaciones denegadas y getUserMedia ya no muere por permiso (media concedido; en el banco sin micrófono muere por dispositivo)",
            probe.permissions?.notificationRequest === "denied" &&
            probe.permissions?.getUserMediaError != null &&
            probe.permissions?.getUserMediaError !== "NotAllowedError",
            `notificación: ${probe.permissions?.notificationRequest}, getUserMedia: ${probe.permissions?.getUserMediaError}`);
        check("S-DEVTOOLS: DevTools no se abre con Ctrl+Shift+I ni con F12",
            probe.devTools?.afterCtrlShiftI === false && probe.devTools?.afterF12 === false,
            `tras Ctrl+Shift+I: ${probe.devTools?.afterCtrlShiftI}, tras F12: ${probe.devTools?.afterF12}`);
        if (!fs.existsSync(probeHostilePath)) {
            check("S-DEVURL: la corrida hostil tiene informe", false, "falta probe-hostile.json");
        } else {
            const hostile = readJson(probeHostilePath);
            check("S-DEVURL: con VITE_DEV_SERVER_URL hostil, la página cargada es la local y el puente está en ella",
                typeof hostile.rendererProbes?.href === "string" &&
                hostile.rendererProbes.href.startsWith("nido://") &&
                hostile.rendererProbes?.hasNidoBridge === true,
                `href: ${hostile.rendererProbes?.href}`);
        }
    }

    // 7b · Censo saliente y guardia de arranque ------------------------
    const outboundPath = path.join(benchDir, "outbound.json");
    if (!fs.existsSync(outboundPath)) {
        check("censo saliente presente (npm run bench antes que la suite)", false,
            "falta outbound.json");
    } else {
        const outbound = readJson(outboundPath);
        const outside = (outbound.destinations ?? [])
            .filter((destination) => !ALLOWED_OUTBOUND_DESTINATIONS.includes(destination));
        // aliveAtKill: el censo solo vale si la app seguía viva al
        // cerrarlo; un proceso muerto en el arranque no emite nada
        // y daría un verde sin causa (cazado en esta tanda).
        check("censo saliente: el arranque en frío con reposo no emite destinos fuera de la lista permitida",
            outside.length === 0 && outbound.aliveAtKill === true,
            outside.length > 0
                ? `fuera de lista: ${outside.join(", ")}`
                : outbound.aliveAtKill === true
                    ? "sin destinos, app viva al cierre del censo"
                    : "la app no estaba viva al cierre del censo: censo sin valor");
    }
    const guardPath = path.join(benchDir, "guard-report.json");
    if (!fs.existsSync(guardPath)) {
        check("informe de la guardia presente (npm run bench antes que la suite)", false,
            "falta guard-report.json");
    } else {
        const guard = readJson(guardPath);
        check("guardia D-7: lanzado con --remote-debugging-port, el paquete de producción sale sin ventana",
            guard.exited === true && guard.residentAfter10s === false,
            `salió: ${guard.exited}, código: ${guard.exitCode}`);
    }

    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} en verde`);
    if (failed.length > 0) {
        console.log(`FALLAN: ${failed.map((result) => result.name).join(" · ")}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("SUITE FALLÓ AL CORRER:", err);
    process.exit(1);
});
