/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Entrada del banco de carcasa de NIDO PC (etapa E1; separada de
 * la entrada de producción por CARCASA-BANCO-FUERA, C-ATQ-5): este
 * fichero SOLO entra en el paquete-banco (sabor de construcción
 * NIDO_BUILD_FLAVOR=bench, salida release-bench); el paquete de
 * producción no lo contiene, ni sus variables, ni su escritura de
 * informes a rutas del entorno. El banco ejerce la carcasa
 * compartida (shell.ts) y el núcleo de la casa, los mismos que la
 * app entrega.
 *
 * Modo banco (NIDO_BENCH): con NIDO_BENCH=full, la app empaquetada
 * carga el Qwen3-0.6B por la vía de carga de la casa (loadPath +
 * engine del núcleo, copiados tal cual en electron/core/) y
 * responde la pregunta de la sonda, anunciando sus estados por
 * stdout (READY / STATE rest|loaded|generating / ANSWER / DONE)
 * para que el orquestador (scripts/bench.mjs) haga el censo de
 * puertos y las mediciones de memoria en cada estado. Con
 * NIDO_BENCH=cold solo arranca, anuncia READY y sale: es la medida
 * de arranque en frío. Con NIDO_BENCH=tamper intenta cargar el
 * modelo de un directorio con una copia alterada en un byte y
 * anuncia TAMPER-REJECTED o TAMPER-LOADED: es el test de rechazo
 * de D-1. Con NIDO_BENCH=probe no carga ningún modelo: anuncia
 * READY, corre las sondas del renderizador (las del mundo de la
 * página más las de la tanda de arreglos de la carcasa: S-FETCH
 * contra el fichero canario de NIDO_BENCH_CANARY, S-PERM y
 * S-DEVTOOLS), escribe el informe y sale. Las tres sondas de la
 * carcasa corren también en el modo full, antes de cargar el
 * modelo. Con NIDO_BENCH=packprobe no carga ningún modelo:
 * corre en el proceso principal la sonda de SQLite de paquetes
 * del paso 1 del bloque puerta de E5 (O-05.1) contra el paquete
 * real de NIDO_BENCH_PACK y sale. Con NIDO_BENCH=persist-write y
 * persist-verify corre la prueba de persistencia de producción
 * del §8.9 (tanda 14, acto 6): instala los servicios reales y
 * conduce el puente de la página en dos procesos contra el mismo
 * directorio de datos; su orquestador es scripts/persist.mjs y
 * su detalle va en su propia sección, abajo.
 *
 * El informe del banco se escribe en NIDO_BENCH_OUT (JSON) y
 * guarda MÉTRICAS Y HUELLAS, nunca la pregunta ni la respuesta
 * verbatim (DC-1 de AUDITORIA-DISCO-CLARO): de la respuesta van
 * su número de caracteres y su sha256, y ningún registro de la
 * corrida escribe prompts ni respuestas. La pregunta de la sonda
 * es una constante sintética de este fichero, no un dato de la
 * persona; aun así no viaja al informe.
 */
import path from "node:path";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {app, BrowserWindow, screen} from "electron";
import {
    bootShell,
    isAppUrl,
    ipcRejectedAttempts,
    navigationAttempts,
    updaterState,
    WEB_PREFERENCES,
    windowOpenAttempts
} from "./shell.ts";
import {DESKTOP_CATALOG} from "./core/catalog.ts";
import {LocalEngine} from "./core/engine.ts";
import {LoadRefusal} from "./core/loadPath.ts";
import {installServices} from "./services.ts";
import {getDb} from "../../src/rag/db.js";

// ---------------------------------------------------------------------
// Banco E1: estado e informe
// ---------------------------------------------------------------------
const BENCH_MODE = process.env["NIDO_BENCH"] ?? "";
const BENCH_OUT = process.env["NIDO_BENCH_OUT"] ?? "";
const BENCH_DWELL_MS = Number(process.env["NIDO_BENCH_DWELL_MS"] ?? 6000);
const BENCH_MODEL_ID = "qwen3-0.6b-q4km";
const BENCH_QUESTION =
    "What is the capital of France? Answer briefly, then add one sentence on why offline assistants matter.";
// 256 es el defecto de engine.ask y es deliberado: las cinco
// generaciones vacías del 2026-11-16 (2 tokens, texto vacío) pidieron
// topes de 32, 48 o 96, y todas las generaciones sanas del día
// pidieron 256 (censo interno de velocidades y la sonda
// A/B del informe de convivencia de voz:
// mismo modelo y sesión, 48 → vacío, 256 → texto). La primera
// corrida de este banco, con 96, reprodujo la firma exacta (2 tokens
// en 750 s; la contención de CPU explica el tiempo, no el corte:
// engine.ask no corta por tiempo de pared). El mecanismo interno
// del corte con tope pequeño no está probado en ningún informe; el
// banco usa el tope que la app misma usa por defecto.
const BENCH_MAX_TOKENS = 256;
const BENCH_CONTEXT_SIZE = 2048;

type BenchReport = Record<string, unknown>;
const benchReport: BenchReport = {mode: BENCH_MODE, startedAt: new Date().toISOString()};

// El sello de construcción (pasada del banco, R-1): cada
// informe del banco lo trae en su sobre, junto a mode y
// startedAt. La foto se lee del build-info.json dentro del
// propio paquete (la misma vía del lector de services) y la
// huella del build-seal.json junto al paquete; lo que falte
// se asienta como null, no se inventa. La comparación que
// decide si la sesión corre vive en los orquestadores
// (scripts/buildSeal.mjs): esto es la copia al informe.
try {
    const info = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "build-info.json"), "utf8")) as {
        builtAt?: unknown; head?: unknown; dirty?: unknown;
    };
    let asarSha256: unknown = null;
    try {
        const seal = JSON.parse(fs.readFileSync(path.join(path.dirname(process.execPath), "build-seal.json"), "utf8")) as {
            asarSha256?: unknown;
        };
        asarSha256 = typeof seal.asarSha256 === "string" ? seal.asarSha256 : null;
    } catch {
        // Sin sello junto al paquete: la huella va null.
    }
    benchReport.buildSeal = {
        builtAt: typeof info.builtAt === "string" ? info.builtAt : null,
        head: typeof info.head === "string" ? info.head : null,
        dirty: typeof info.dirty === "boolean" ? info.dirty : null,
        asarSha256
    };
} catch {
    benchReport.buildSeal = null;
}

function benchLog(line: string) {
    console.log(`NIDO-BENCH ${line}`);
}

function writeBenchReport() {
    if (!BENCH_OUT)
        return;
    try {
        fs.writeFileSync(BENCH_OUT, JSON.stringify(benchReport, null, 2));
    } catch {
        // El informe es del banco; si no se puede escribir, los
        // marcadores de stdout siguen siendo la evidencia primaria.
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------
// Sondas de la carcasa (tanda de arreglos, AUDITORIA-CARCASA-ATAQUE):
// S-FETCH (C-ATQ-1), S-PERM (C-ATQ-2) y S-DEVTOOLS (C-ATQ-6). Corren
// en los modos probe y full, antes de cargar ningún modelo, sobre
// la misma ventana de la casa.
// ---------------------------------------------------------------------
async function runShellProbes(window: BrowserWindow) {
    // S-FETCH: la página intenta leer por fetch un fichero canario
    // que el orquestador plantó FUERA del asar (su ruta llega por
    // NIDO_BENCH_CANARY). El informe registra solo si el intento
    // quedó bloqueado y el nombre del error: el contenido del
    // canario no se copia a ningún campo, y la suite comprueba que
    // tampoco aparece en el informe entero.
    const canaryPath = process.env["NIDO_BENCH_CANARY"] ?? "";
    if (canaryPath) {
        try {
            benchReport.fileFetch = await window.webContents.executeJavaScript(`(async () => {
                const result = {attempted: true, blocked: false, errorName: null};
                try {
                    const response = await fetch("file://" + ${JSON.stringify(canaryPath)});
                    await response.text();
                    result.blocked = !response.ok;
                    if (!response.ok)
                        result.errorName = "status " + response.status;
                } catch (err) {
                    result.blocked = true;
                    result.errorName = err && err.name ? String(err.name) : String(err);
                }
                return result;
            })()`);
        } catch (err) {
            benchReport.fileFetch = {
                attempted: true,
                blocked: false,
                errorName: `arnés: ${String(err)}`
            };
        }
    }

    // S-PERM: los seis estados de permissions.query, la petición de
    // notificaciones y el rechazo de getUserMedia. La señal que
    // distingue «la capa de permisos frenó» de «no hay micrófono en
    // la VM» es el nombre del error: NotAllowedError (permiso)
    // frente a NotFoundError (dispositivo ausente).
    try {
        benchReport.permissions = await window.webContents.executeJavaScript(`(async () => {
            const names = ["microphone", "camera", "geolocation", "notifications", "midi", "clipboard-read"];
            const query = {};
            for (const name of names) {
                try {
                    query[name] = (await navigator.permissions.query({name})).state;
                } catch (err) {
                    query[name] = "error:" + (err && err.name ? String(err.name) : String(err));
                }
            }
            let notificationRequest = null;
            try {
                notificationRequest = await Notification.requestPermission();
            } catch (err) {
                notificationRequest = "error:" + (err && err.name ? String(err.name) : String(err));
            }
            let getUserMediaError = null;
            try {
                await navigator.mediaDevices.getUserMedia({audio: true});
                getUserMediaError = "none";
            } catch (err) {
                getUserMediaError = err && err.name ? String(err.name) : String(err);
            }
            return {query, notificationRequest, getUserMediaError};
        })()`);
    } catch (err) {
        benchReport.permissions = {error: String(err)};
    }

    // S-DEVTOOLS: los dos atajos que el menú por defecto trae
    // (Ctrl+Shift+I y F12) despachados a la ventana; tras cada uno,
    // DevTools no debe estar abierto. El despacho va por el
    // depurador interno del propio webContents
    // (Input.dispatchKeyEvent con rawKeyDown, la técnica de la
    // auditoría): el sendInputEvent de Electron no dispara los
    // aceleradores del menú y la sonda nació muda (en verde sin
    // causa contra el paquete vigente, cazado en el paso de rojo
    // de esta tanda).
    const webContents = window.webContents;
    const debuggerSession = webContents.debugger;
    try {
        if (!debuggerSession.isAttached())
            debuggerSession.attach("1.3");
        const dispatchKey = async (params: Record<string, unknown>) => {
            await debuggerSession.sendCommand("Input.dispatchKeyEvent", {type: "rawKeyDown", ...params});
            await debuggerSession.sendCommand("Input.dispatchKeyEvent", {type: "keyUp", ...params});
        };
        // La apertura de DevTools es lenta bajo contención (su
        // frontend es una página entera): se espera en activo hasta
        // 4 s por atajo antes de dar el «no abrió» por bueno.
        const waitDevToolsOpened = async () => {
            for (let waited = 0; waited < 4000; waited += 250) {
                if (webContents.isDevToolsOpened() || webContents.devToolsWebContents)
                    return true;
                await sleep(250);
            }
            return webContents.isDevToolsOpened();
        };
        await dispatchKey({
            key: "I", code: "KeyI",
            windowsVirtualKeyCode: 73, nativeVirtualKeyCode: 73,
            modifiers: 2 | 8 // Control | Shift
        });
        const afterCtrlShiftI = await waitDevToolsOpened();
        if (afterCtrlShiftI) {
            webContents.closeDevTools();
            // El cierre también es asíncrono: sin esperarlo, la F12
            // siguiente llega con DevTools aún abierto y actúa de
            // conmutador que lo apaga, falseando su lectura.
            for (let waited = 0; waited < 8000 && webContents.isDevToolsOpened(); waited += 250)
                await sleep(250);
        }
        await dispatchKey({
            key: "F12", code: "F12",
            windowsVirtualKeyCode: 123, nativeVirtualKeyCode: 123,
            modifiers: 0
        });
        const afterF12 = await waitDevToolsOpened();
        if (afterF12)
            webContents.closeDevTools();
        benchReport.devTools = {afterCtrlShiftI, afterF12};
    } catch (err) {
        benchReport.devTools = {error: String(err)};
    } finally {
        if (debuggerSession.isAttached())
            debuggerSession.detach();
    }
}

// ---------------------------------------------------------------------
// El banco: sondas de renderizador, estados, motor por la vía de la
// casa y ataques de navegación contra la propia ventana.
// ---------------------------------------------------------------------
async function runBench(window: BrowserWindow) {
    benchReport.webPreferences = {...WEB_PREFERENCES, preload: "<dist-electron>/preload.mjs"};
    benchReport.updater = updaterState();
    benchLog("READY");
    writeBenchReport();

    if (BENCH_MODE === "cold") {
        benchLog("DONE");
        app.quit();
        return;
    }

    // Modo packprobe (bloque puerta de E5, paso 1 · O-05.1): la
    // sonda de SQLite de paquetes dentro del proceso principal
    // del paquete construido — la misma que corre en el Node de
    // la VM (versión, FTS5 real, apertura en solo lectura de un
    // paquete real por NIDO_BENCH_PACK y una consulta FTS real
    // sobre su índice). Es del proceso principal y no necesita
    // la ventana: corre al arrancar, antes de las sondas del
    // renderizador. Si el binario no trajera FTS5, el informe
    // lo dice y la etapa se detiene: no se asume.
    if (BENCH_MODE === "packprobe") {
        const probe: Record<string, unknown> = {runtime: `electron ${process.versions.electron} / node ${process.versions.node}`};
        try {
            const mem = new DatabaseSync(":memory:");
            probe.sqliteVersion = (mem.prepare("SELECT sqlite_version() AS v").get() as {v: string}).v;
            mem.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(x)");
            mem.prepare("INSERT INTO probe_fts(x) VALUES (?)").run("hola mundo");
            const hit = mem.prepare("SELECT x FROM probe_fts WHERE probe_fts MATCH ?").get("hola") as {x: string} | undefined;
            probe.fts5 = hit?.x === "hola mundo";
            mem.close();
        } catch (err) {
            probe.fts5 = false;
            probe.fts5Error = String(err);
        }
        const packPath = process.env["NIDO_BENCH_PACK"] ?? "";
        try {
            const db = new DatabaseSync(packPath, {readOnly: true});
            const meta = Object.fromEntries(
                (db.prepare("SELECT key, value FROM meta").all() as Array<{key: string; value: string}>)
                    .map((r) => [r.key, r.value]));
            probe.packFormat = meta["format"] ?? null;
            probe.chunks = (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as {n: number}).n;
            probe.ftsMatchFiebre = (db.prepare(
                "SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?").get("fiebre") as {n: number}).n;
            db.close();
        } catch (err) {
            probe.packError = String(err);
        }
        benchReport.packProbe = probe;
        benchLog(`PACKPROBE ${JSON.stringify(probe)}`);
        writeBenchReport();
        benchLog("DONE");
        setTimeout(() => app.quit(), 500);
        return;
    }

    // Sondas del mundo de la página: sin Node, sin ipcRenderer
    // expuesto en ninguna forma (sonda de D-2: no hay objeto que el
    // puente pueda proxificar ni devolver), con el puente nombrado
    // de la casa, la raíz montada y la CSP en el documento.
    try {
        benchReport.rendererProbes = await window.webContents.executeJavaScript(`(() => {
            const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
            const root = document.getElementById("root");
            return {
                typeofRequire: typeof require,
                typeofProcess: typeof process,
                typeofModule: typeof module,
                ipcRendererExposed: typeof window.ipcRenderer !== "undefined",
                hasNidoBridge: typeof (window.nido && window.nido.checkForUpdates) === "function",
                rootChildren: root ? root.childElementCount : -1,
                csp: meta ? meta.getAttribute("content") : null,
                href: location.href
            };
        })()`);
    } catch (err) {
        benchReport.rendererProbes = {error: String(err)};
    }

    // Sondas de la carcasa (S-FETCH, S-PERM, S-DEVTOOLS) en los
    // modos probe y full, antes de cargar ningún modelo.
    if (BENCH_MODE === "probe" || BENCH_MODE === "full")
        await runShellProbes(window);

    if (BENCH_MODE === "probe") {
        benchReport.ipcRejectedAttempts = ipcRejectedAttempts;
        writeBenchReport();
        benchLog("DONE");
        setTimeout(() => app.quit(), 500);
        return;
    }

    // Modo tamper (test de rechazo de D-1): el directorio de modelos
    // trae una copia del 0.6B alterada en un byte, con el nombre del
    // catálogo. El único cargador que queda en la app (LocalEngine
    // por loadPath) tiene que rechazarla por huella ANTES de cargar:
    // si carga, el criterio sellado ha caído y el marcador lo dice.
    if (BENCH_MODE === "tamper") {
        const modelsDir = process.env["NIDO_MODELS_DIR"] ?? path.join(process.cwd(), "models");
        const entry = DESKTOP_CATALOG.find((candidate) => candidate.id === BENCH_MODEL_ID);
        if (!entry)
            throw new Error(`bench model not in catalog: ${BENCH_MODEL_ID}`);
        try {
            await LocalEngine.load(modelsDir, entry, BENCH_CONTEXT_SIZE);
            benchReport.tamperTest = {modelId: entry.id, rejected: false};
            benchLog("TAMPER-LOADED");
        } catch (err) {
            benchReport.tamperTest = {
                modelId: entry.id,
                rejected: true,
                loadRefusal: err instanceof LoadRefusal,
                error: String(err)
            };
            benchLog(`TAMPER-REJECTED ${String(err)}`);
        }
        writeBenchReport();
        benchLog("DONE");
        setTimeout(() => app.quit(), 500);
        return;
    }

    // Ataque 1: window.open hacia fuera. Debe denegarse y no crear
    // ninguna ventana.
    const windowsBefore = BrowserWindow.getAllWindows().length;
    try {
        await window.webContents.executeJavaScript(
            `window.open("https://example.com/", "_blank"); true`);
    } catch {
        // Un rechazo del propio executeJavaScript también es denegación.
    }
    await sleep(600);
    benchReport.windowOpen = {
        attempts: windowOpenAttempts,
        windowsBefore,
        windowsAfter: BrowserWindow.getAllWindows().length
    };
    writeBenchReport();

    // Estado 1 · reposo: ventana abierta, sin modelo.
    benchLog("STATE rest");
    benchReport.states = {restAt: new Date().toISOString()};
    writeBenchReport();
    await sleep(BENCH_DWELL_MS);

    // El motor, por la vía de la casa: la ruta sale del catálogo y se
    // verifica en tamaño y huella antes de que el parser vea un byte.
    const modelsDir = process.env["NIDO_MODELS_DIR"] ?? path.join(process.cwd(), "models");
    const entry = DESKTOP_CATALOG.find((candidate) => candidate.id === BENCH_MODEL_ID);
    if (!entry)
        throw new Error(`bench model not in catalog: ${BENCH_MODEL_ID}`);
    const engine = await LocalEngine.load(modelsDir, entry, BENCH_CONTEXT_SIZE);
    benchReport.engine = {
        modelId: entry.id,
        modelsDir,
        contextSize: BENCH_CONTEXT_SIZE,
        verifiedViaLoadPath: true
    };

    // Estado 2 · modelo cargado, sin generar.
    benchLog("STATE loaded");
    (benchReport.states as Record<string, string>).loadedAt = new Date().toISOString();
    writeBenchReport();
    await sleep(BENCH_DWELL_MS);

    // Estado 3 · generando la respuesta de la sonda.
    benchLog("STATE generating");
    (benchReport.states as Record<string, string>).generatingAt = new Date().toISOString();
    writeBenchReport();
    const answer = await engine.ask(BENCH_QUESTION, BENCH_MAX_TOKENS);
    // DC-1: la respuesta no se persiste; van sus métricas y su
    // huella, en el informe y en el marcador de stdout.
    const answerMetrics = {
        chars: answer.text.length,
        sha256: createHash("sha256").update(answer.text).digest("hex"),
        stats: answer.stats
    };
    benchReport.answer = answerMetrics;
    benchLog(`ANSWER ${JSON.stringify(answerMetrics)}`);

    // Ataque 2: navegación de la página hacia fuera. Debe bloquearse
    // y la URL debe seguir siendo la de la app.
    try {
        await window.webContents.executeJavaScript(
            `location.href = "https://example.com/"; true`);
    } catch {
        // Si la navegación ocurriera, la promesa muere con la página:
        // la URL leída después es la evidencia que manda.
    }
    await sleep(800);
    benchReport.navigation = {
        attempts: navigationAttempts,
        urlAfter: window.webContents.getURL(),
        stillAppUrl: isAppUrl(window.webContents.getURL())
    };
    (benchReport.states as Record<string, string>).doneAt = new Date().toISOString();
    benchReport.updater = updaterState();
    benchReport.ipcRejectedAttempts = ipcRejectedAttempts;
    writeBenchReport();
    benchLog("DONE");
    setTimeout(() => app.quit(), 500);
}

// ---------------------------------------------------------------------
// Modo persist (tanda 14, acto 6): la prueba de persistencia de
// producción del §8.9. A diferencia de los demás modos, este no
// ejerce solo la carcasa: instala los SERVICIOS reales (la misma
// installServices que la entrada de producción llama antes que la
// carcasa) y conduce el puente verdadero de la página
// (window.nido, las llamadas exactas del renderer) en dos fases
// que el orquestador (scripts/persist.mjs) lanza como dos procesos
// separados contra el mismo directorio de datos:
//
// - persist-write: crea la bóveda, cobra el registro §8.9 al
//   desbloquear (la creación desbloquea), escribe los ajustes por
//   sus canales (idioma y tema en prefs; personalidad,
//   instrucciones propias y resumen automático en el almacén
//   sellado), bloquea en explícito y cobra que la escritura
//   sellada falla cerrada con la bóveda bloqueada, redesbloquea
//   (el registro se repone), sirve un turno de la tabla fija que
//   sella una conversación, y abre la base cifrada por su getter
//   del núcleo con la clave registrada.
// - persist-verify: un proceso nuevo sobre el mismo directorio:
//   la bóveda existe y nace bloqueada, la base se niega a abrir
//   antes de desbloquear (sonda del proceso principal), una
//   contraseña equivocada se rechaza y la bóveda sigue bloqueada,
//   el desbloqueo bueno cobra, y cada valor escrito en la fase 1
//   se relee por el bootstrap; la base cifrada se reabre con la
//   clave de la sesión nueva.
//
// El idioma que la sonda escribe es «pt» a propósito: es distinto
// del que la detección por Intl de esta máquina produciría, así
// que un pisotón de la clase A-1 hacia el valor del entorno sería
// visible en la comprobación, cosa que «en» no podía prometer
// (precisión de la vigía de la persistencia).
//
// El informe guarda valores sintéticos de la sonda y métricas,
// nunca texto de conversación (DC-1): del turno van su ruta y el
// número de caracteres de la respuesta. La contraseña es sintética
// y llega por NIDO_PERSIST_PASSWORD; sin ella el modo no corre.
// ---------------------------------------------------------------------
const PERSIST_PASSWORD = process.env["NIDO_PERSIST_PASSWORD"] ?? "";
const PERSIST_MARKER = "SONDA-PERSIST-14";
const PERSIST_CONV_ID = "persist-probe-14";

async function persistDbProbe(): Promise<Record<string, unknown>> {
    try {
        const db = await getDb();
        const row = await db.getFirstAsync<{n: number}>("SELECT count(*) AS n FROM sqlite_master");
        await db.closeAsync();
        return {opened: true, sqliteMasterEntries: row?.n ?? null};
    } catch (err) {
        return {opened: false, error: String(err)};
    }
}

async function runPersist(window: BrowserWindow) {
    const phase = BENCH_MODE === "persist-write" ? "write" : "verify";
    benchReport.phase = phase;
    if (phase === "verify") {
        // La sonda de la base ANTES de desbloquear, en el proceso
        // principal: sin sesión no hay proveedor de DEK registrado
        // y la apertura debe fallar cerrada (la pierna que el
        // diseño de la prueba pide y la primera forma no traía).
        benchReport.dbBeforeUnlock = await persistDbProbe();
    }
    try {
        const script = phase === "write"
            ? `(async () => {
                const nido = window.nido;
                const out = {};
                const b0 = await nido.bootstrap();
                out.vaultExistedAtStart = b0.vault.exists;
                out.unlockedAtStart = b0.vault.unlocked;
                const created = await nido.vaultCreate(${JSON.stringify(PERSIST_PASSWORD)});
                out.createOk = created.ok === true;
                const b1 = await nido.bootstrap();
                out.unlockedAfterCreate = b1.vault.unlocked;
                out.prefsSet = (await nido.prefsSet({lang: "pt", theme: "night"})).ok === true;
                out.personalitySet = (await nido.settingsSet({personality: "detailed"})).ok === true;
                out.customSet = (await nido.settingsSet({customSystemPrompt: ${JSON.stringify(PERSIST_MARKER)}})).ok === true;
                out.memorySet = (await nido.settingsSet({memoryAutoSummarize: false})).ok === true;
                await nido.vaultLock();
                const bLock = await nido.bootstrap();
                out.lockedAfterExplicitLock = !bLock.vault.unlocked;
                out.sealedWriteWhileLocked = (await nido.settingsSet({personality: "brief"})).ok === true;
                out.unlockAfterLock = (await nido.vaultUnlock(${JSON.stringify(PERSIST_PASSWORD)})).ok === true;
                const bRelock = await nido.bootstrap();
                out.unlockedAfterRelock = bRelock.vault.unlocked;
                const turn = await nido.turnSend({conversationId: ${JSON.stringify(PERSIST_CONV_ID)}, text: "What is the emergency phone number?"});
                out.turnOk = turn.ok === true;
                out.turnRoute = turn.result ? (turn.result.route ?? null) : null;
                const b2 = await nido.bootstrap();
                out.langAfter = b2.prefs.lang;
                out.themeAfter = b2.prefs.theme;
                out.personalityAfter = b2.personality ?? null;
                out.customAfter = b2.customSystemPrompt ?? null;
                out.autoSummarizeAfter = b2.memorySettings ? b2.memorySettings.autoSummarize : null;
                out.conversationsAfter = b2.conversations.length;
                const conv = b2.conversations.find((c) => c.id === ${JSON.stringify(PERSIST_CONV_ID)});
                out.probeTurns = conv ? conv.turns.length : 0;
                const assistant = conv ? conv.turns.filter((t) => t.role === "assistant") : [];
                out.assistantChars = assistant.length ? assistant[assistant.length - 1].text.length : 0;
                return out;
            })()`
            : `(async () => {
                const nido = window.nido;
                const out = {};
                const b0 = await nido.bootstrap();
                out.vaultExists = b0.vault.exists;
                out.lockedAtStart = !b0.vault.unlocked;
                const wrong = await nido.vaultUnlock("contrasena-equivocada-14");
                out.wrongPasswordOk = wrong.ok === true;
                const bWrong = await nido.bootstrap();
                out.lockedAfterWrongPassword = !bWrong.vault.unlocked;
                const u = await nido.vaultUnlock(${JSON.stringify(PERSIST_PASSWORD)});
                out.unlockOk = u.ok === true;
                const b1 = await nido.bootstrap();
                out.lang = b1.prefs.lang;
                out.theme = b1.prefs.theme;
                out.personality = b1.personality ?? null;
                out.custom = b1.customSystemPrompt ?? null;
                out.autoSummarize = b1.memorySettings ? b1.memorySettings.autoSummarize : null;
                out.conversations = b1.conversations.length;
                const conv = b1.conversations.find((c) => c.id === ${JSON.stringify(PERSIST_CONV_ID)});
                out.probeTurns = conv ? conv.turns.length : 0;
                const assistant = conv ? conv.turns.filter((t) => t.role === "assistant") : [];
                out.assistantChars = assistant.length ? assistant[assistant.length - 1].text.length : 0;
                return out;
            })()`;
        benchReport.bridge = await window.webContents.executeJavaScript(script);
    } catch (err) {
        benchReport.bridge = {error: String(err)};
    }
    benchReport.db = await persistDbProbe();
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog(phase === "write" ? "PERSIST-WRITE-DONE" : "PERSIST-VERIFY-DONE");
    setTimeout(() => app.quit(), 500);
}

// ---------------------------------------------------------------------
// Modo window (tanda 14, acto 6): los cobros de ventana de
// VENTANA-LINUX-T14 §4.2 que se ejercen sobre la ventana viva del
// paquete-banco (registros 2, 4, 5 y 6; el 7 va sobre producción
// con su orquestador propio, y el 3 y el 8 por código van en la
// suite de endurecimiento y en la pasada). Instala los servicios
// reales como el modo persist, porque el registro 2 conduce la
// superficie por el puente; las fases llegan por NIDO_WINDOW_PHASE:
//
// - read: límites y título al asentarse, sin tocar nada (la mitad
//   del registro 4 que no provoca).
// - shrink: tras leer, pide 320×200 por la API y relee: el mínimo
//   de 640×480 como conducta (registro 5).
// - read-shrink: las dos en un lanzamiento.
// - settle-bounds: fija unos límites por la API y CIERRA la
//   ventana por su vía (el guardado del estado ocurre en el
//   evento de cierre): la primera mitad del registro 6.
// - read-bounds: solo lee los límites al asentarse (la segunda
//   mitad del registro 6 y las dos caídas, cuyo estado prepara el
//   orquestador entre lanzamientos).
// - title: el título en sus estados por el puente (registro 2,
//   pre-corrida; su firma es de la pasada): puerta, tema noche con
//   la sesión abierta, conversación abierta y vuelta al día.
// ---------------------------------------------------------------------
const WINDOW_PHASE = process.env["NIDO_WINDOW_PHASE"] ?? "read";

async function runWindow(window: BrowserWindow) {
    benchReport.phase = WINDOW_PHASE;
    benchReport.titleAtSettle = window.getTitle();
    benchReport.boundsAtSettle = window.getBounds();
    const display = screen.getPrimaryDisplay();
    benchReport.displaySize = display.size;
    try {
        if (WINDOW_PHASE === "shrink" || WINDOW_PHASE === "read-shrink") {
            window.setSize(320, 200);
            await sleep(600);
            benchReport.boundsAfterShrink = window.getBounds();
        } else if (WINDOW_PHASE === "settle-bounds") {
            window.setBounds({x: 60, y: 50, width: 900, height: 640});
            await sleep(600);
            benchReport.boundsAfterSet = window.getBounds();
            writeBenchReport();
            benchLog("WINDOW-SETTLED");
            window.close();
            setTimeout(() => app.quit(), 2000);
            return;
        } else if (WINDOW_PHASE === "title") {
            const exec = (code: string) => window.webContents.executeJavaScript(code);
            await exec(`window.nido.vaultCreate(${JSON.stringify(PERSIST_PASSWORD)})`);
            benchReport.titleAfterUnlock = window.getTitle();
            await exec(`window.nido.prefsSet({theme: "night"})`);
            await sleep(300);
            benchReport.titleNight = window.getTitle();
            await exec(`window.nido.turnSend({conversationId: "window-probe", text: "What is the emergency phone number?"})`);
            benchReport.titleWithConversation = window.getTitle();
            await exec(`window.nido.prefsSet({theme: "daylight"})`);
            await sleep(300);
            benchReport.titleDaylight = window.getTitle();
        }
    } catch (err) {
        benchReport.error = String(err);
    }
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("WINDOW-DONE");
    setTimeout(() => app.quit(), 500);
}

// ---------------------------------------------------------------------
// Modo boot (tanda 14, acto 7 · registro 4): el arranque en frío
// medido de M-1. El orquestador (scripts/photos.mjs) pasa el
// instante del lanzamiento por NIDO_BOOT_T0 y prepara el HOME con
// el modelo presente; la medida es lanzamiento → puerta asentada
// → crear la bóveda → bienvenida (estado del renderer en cada
// primer arranque) y su pulsación → composer, sin modelo cargado:
// el camino entero de la primera vez. Cinco lanzamientos, la
// mediana manda contra la puerta de 6.000 ms.
// ---------------------------------------------------------------------
const BOOT_T0 = Number(process.env["NIDO_BOOT_T0"] ?? "0");

async function runBoot(window: BrowserWindow) {
    benchReport.tSettleMs = Date.now() - BOOT_T0;
    try {
        const exec = (code: string) => window.webContents.executeJavaScript(code);
        // La bóveda se crea POR LA PUERTA, como la persona: por
        // el puente el renderer no se mueve de la puerta y la
        // medida cobraría esperas agotadas, no el arranque.
        const gDeadline = Date.now() + 20000;
        while (Date.now() < gDeadline) {
            if ((await exec(`!!document.querySelector(".vault-gate")`)) === true) break;
            await sleep(100);
        }
        // La vía del cruce, asentada con su clave y su valor
        // de código (pasada del banco, R-4), salga el bucle
        // como salga: la verificación la cobra del informe,
        // sin leer el código otra vez. La clave vieja en prosa
        // deja de nacer: una sola clave para la vía, y su
        // valor es el código, no la prosa.
        benchReport.vaultCrossing = "form";
        // El cruce de la puerta con su propio cronómetro
        // alrededor del paso (pasada del banco, R-3): la
        // duración de crear la bóveda por su formulario como
        // medida, no como diferencia contra el lanzamiento.
        // Solo un cruce que sale la asienta como número: un
        // cruce que no sale no es una duración medida.
        const gateT0 = Date.now();
        await exec(`(() => {
            const fields = [...document.querySelectorAll(".vault-card input")].filter((i) => i.type === "password" || i.type === "text");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            for (const f of fields) {
                setter.call(f, ${JSON.stringify(PERSIST_PASSWORD)});
                f.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return fields.length;
        })()`);
        await sleep(300);
        await exec(`document.querySelector(".vault-card .btn.primary")?.click()`);
        const goneDeadline = Date.now() + 30000;
        let gateGone = false;
        while (Date.now() < goneDeadline) {
            if ((await exec(`!document.querySelector(".vault-gate")`)) === true) {
                gateGone = true;
                break;
            }
            await sleep(100);
        }
        benchReport.tVaultCreateMs = gateGone ? Date.now() - gateT0 : null;
        // El resultado del cruce, y si no salió, el error de
        // la puerta (pasada del banco, R-5): la superficie ya
        // separa las causas en .vault-error, con texto por
        // clase (vaultCorrupt, vaultExists, vaultShort,
        // vaultWrong). Leerlo tras un cruce que no sale
        // separa en el propio informe «el envío corrió y el
        // puente rechazó» (puerta con error) de «el envío
        // nunca corrió o sigue en curso» (puerta sin error),
        // que sin esta lectura firman igual: la puerta se
        // quedó. La superficie no se toca: su error ya existe
        // construido.
        if (gateGone) {
            benchReport.gateResult = "crossed";
        } else {
            const vaultError = (await exec(`(() => {
                const el = document.querySelector(".vault-error");
                return el ? {present: true, text: (el.textContent ?? "").trim()} : {present: false, text: null};
            })()`)) as {present: boolean; text: string | null};
            benchReport.vaultError = vaultError;
            benchReport.gateResult = vaultError.present ? "failed-with-error" : "failed-no-error";
        }
        benchReport.tGateMs = Date.now() - BOOT_T0;
        // La bienvenida es estado del renderer y se monta en cada
        // primer arranque con modelo y cero conversaciones: la
        // medida la atraviesa con su pulsación, como la persona.
        // Su hallazgo se asienta con su bandera (R-3), simétrica
        // a composerFound: tWelcomeMs se asienta siempre y la
        // bandera dice si la salida fue por hallazgo o por plazo.
        const wDeadline = Date.now() + 20000;
        let welcome = false;
        while (Date.now() < wDeadline) {
            const w = (await exec(`!!document.querySelector(".welcome-hero .btn.primary")`)) as boolean;
            if (w) {
                welcome = true;
                break;
            }
            await sleep(100);
        }
        benchReport.welcomeFound = welcome;
        benchReport.tWelcomeMs = Date.now() - BOOT_T0;
        await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
        const deadline = Date.now() + 30000;
        let composer = false;
        while (Date.now() < deadline) {
            composer = (await exec(`!!document.querySelector(".composer textarea")`)) as boolean;
            if (composer) break;
            await sleep(100);
        }
        benchReport.composerFound = composer;
        // Solo las llegadas llevan tiempo: una espera agotada no
        // es una medición y no entra en la mediana como número.
        benchReport.tComposerMs = composer ? Date.now() - BOOT_T0 : null;
    } catch (err) {
        benchReport.error = String(err);
    }
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("BOOT-DONE");
    setTimeout(() => app.quit(), 500);
}

// ---------------------------------------------------------------------
// Modo capture (tanda 14, acto 8): la sesión de fotos de FOTOS-14
// sobre el paquete-banco servido por nido://app/, en el orden
// enmendado de la hoja. La cadena limpia corre con un HOME por
// fase y el principal se monta una sola vez (forma B de la cura
// del instrumento, con su enmienda firmada en la hoja): la copia
// truncada nace y muere en el HOME de la fase del error, el
// fichero genuino solo se lee y nunca se escribe, y la
// bienvenida se siembra con el genuino en su propio HOME.
//
// Cada fase fija su ventana con setSize y la lee de vuelta con
// getBounds antes de capturar: 1440×900 en todas las capturas
// salvo la del régimen medio, que baja a 1024 exactos leídos;
// una lectura que no casa detiene la fase sin capturar. Toda
// captura pasa por la guarda de la ventana de bloqueo de snap:
// reloj desde el desbloqueo de la fase, redesbloqueo y re-cobro
// del estado antes de capturar, o la captura se asienta no
// cobrada con su causa. Ninguna toma sobrescribe a otra: la que
// sustituye gana el sufijo -t2, -t3… El informe guarda
// predicados, lecturas de tamaño y longitudes, nunca texto de
// conversación (DC-1).
// ---------------------------------------------------------------------
const CAPTURE_PHASE = process.env["NIDO_CAPTURE_PHASE"] ?? "";
const CAPTURE_DIR = process.env["NIDO_CAPTURE_DIR"] ?? "";
const WINDOW_GUARD_MS = 8 * 60 * 1000;

async function runCapture(window: BrowserWindow) {
    const exec = (code: string) => window.webContents.executeJavaScript(code) as Promise<unknown>;
    const out: Record<string, unknown> = {phase: CAPTURE_PHASE, snaps: [] as string[], notCharged: [] as unknown[], sizeLog: {} as Record<string, unknown>, guardLog: [] as unknown[]};
    benchReport.capture = out;
    const snaps = out.snaps as string[];
    const notCharged = out.notCharged as {name: string; cause: string}[];
    const sizeLog = out.sizeLog as Record<string, {width: number; height: number}>;
    const guardLog = out.guardLog as {name: string; elapsedMs: number; reUnlocks: number}[];
    let unlockedAt = 0;
    let reUnlocks = 0;
    let recheck: () => Promise<boolean> = async () => true;
    const waitFor = async (predicate: string, timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ((await exec(`!!(${predicate})`)) === true) return true;
            await sleep(700);
        }
        return false;
    };
    const fixAndRead = async (w: number, h: number): Promise<boolean> => {
        window.setPosition(0, 0);
        window.setSize(w, h);
        await sleep(600);
        const b = window.getBounds();
        (out[`sizeRead-${w}x${h}`] as unknown) = b;
        return b.width === w && b.height === h;
    };
    // La guarda de la ventana de bloqueo: la línea son 8 minutos
    // desde el desbloqueo de la fase (margen del instrumento bajo
    // los diez sellados), o el bootstrap diciendo bloqueada por
    // cualquier vía. Si restaura, el estado se re-cobra por el
    // recheck de la fase; si no, la captura no se cobra.
    const guardWindow = async (name: string): Promise<boolean> => {
        const elapsed = Date.now() - unlockedAt;
        const b = (await exec(`window.nido.bootstrap()`)) as {vault?: {unlocked?: boolean}};
        if (elapsed < WINDOW_GUARD_MS && b?.vault?.unlocked !== false) {
            guardLog.push({name, elapsedMs: elapsed, reUnlocks});
            return true;
        }
        // El redesbloqueo también va por la puerta: su envío
        // refresca la app y el estado se re-cobra contra su
        // predicado (la conversación se reabre desde recientes
        // si la superficie volvió a la lista).
        if (!(await driveGate())) return false;
        reUnlocks += 1;
        guardLog.push({name, elapsedMs: elapsed, reUnlocks});
        return recheck();
    };
    const snap = async (name: string) => {
        if (!(await guardWindow(name))) {
            notCharged.push({name, cause: "ventana-bloqueo"});
            return;
        }
        const b = window.getBounds();
        sizeLog[name] = {width: b.width, height: b.height};
        const expected = name.startsWith("foto-4") ? {width: 1024, height: 900} : {width: 1440, height: 900};
        if (b.width !== expected.width || b.height !== expected.height) {
            notCharged.push({name, cause: "size-read"});
            return;
        }
        const img = await window.webContents.capturePage();
        let target = name;
        if (fs.existsSync(path.join(CAPTURE_DIR, target))) {
            const base = name.replace(/\.png$/, "");
            let n = 2;
            while (fs.existsSync(path.join(CAPTURE_DIR, `${base}-t${n}.png`))) n++;
            target = `${base}-t${n}.png`;
        }
        fs.writeFileSync(path.join(CAPTURE_DIR, target), img.toPNG());
        snaps.push(target);
    };
    // La bóveda se abre POR LA PUERTA, como la persona: crear o
    // desbloquear por el puente no mueve el renderer (la puerta
    // sigue en pantalla y la foto enseñaría la puerta, cobrado
    // por la primera sonda del instrumento). Se rellenan los
    // campos del formulario y se pulsa su botón; la puerta misma
    // refresca la app al entrar.
    const driveGate = async (): Promise<boolean> => {
        await waitFor(`document.querySelector(".vault-gate, .composer textarea, .welcome-hero, .view-scroll")`, 30000);
        if ((await exec(`!!document.querySelector(".vault-gate")`)) !== true) {
            unlockedAt = Date.now();
            // El camino ya desbloqueado asienta la clave
            // también (R-4), con el valor que nombra el
            // hecho: ningún informe queda sin la vía.
            out.vaultCrossing = "already-unlocked";
            return true;
        }
        await exec(`(() => {
            const fields = [...document.querySelectorAll(".vault-card input")].filter((i) => i.type === "password" || i.type === "text");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            for (const f of fields) {
                setter.call(f, ${JSON.stringify(PERSIST_PASSWORD)});
                f.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return fields.length;
        })()`);
        await sleep(300);
        await exec(`document.querySelector(".vault-card .btn.primary")?.click()`);
        const gone = await waitFor(`!document.querySelector(".vault-gate")`, 30000);
        if (gone) unlockedAt = Date.now();
        out.vaultCrossing = "form";
        // El resultado del cruce y, si no salió, el error de
        // la puerta (R-5), en la misma forma que en boot.
        if (gone) {
            out.gateResult = "crossed";
        } else {
            const vaultError = (await exec(`(() => {
                const el = document.querySelector(".vault-error");
                return el ? {present: true, text: (el.textContent ?? "").trim()} : {present: false, text: null};
            })()`)) as {present: boolean; text: string | null};
            out.vaultError = vaultError;
            out.gateResult = vaultError.present ? "failed-with-error" : "failed-no-error";
        }
        return gone;
    };
    const openVault = async (): Promise<void> => {
        await driveGate();
    };
    const typeDraft = async (text: string) => {
        await exec(`(() => {
            const ta = document.querySelector(".composer textarea");
            if (!ta) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(ta, ${JSON.stringify(text)});
            ta.dispatchEvent(new Event("input", {bubbles: true}));
            return true;
        })()`);
    };
    const turnSettled = `(() => {
        if (document.querySelector(".send-box.stop")) return false;
        const bubbles = document.querySelectorAll(".turn-assistant");
        if (!bubbles.length) return false;
        const last = bubbles[bubbles.length - 1];
        return (last.textContent ?? "").trim().length > 0;
    })()`;
    const sendTurn = async (text: string, timeoutMs: number): Promise<boolean> => {
        await typeDraft(text);
        await exec(`document.querySelector(".send-box")?.click()`);
        return waitFor(turnSettled, timeoutMs);
    };
    // El re-cobro base del principal: la conversación abierta con
    // su último turno visible, reabierta desde recientes si la
    // superficie cayó a otra vista.
    const reopenConversation = async (): Promise<boolean> => {
        if ((await exec(`!!document.querySelector(".turn-assistant")`)) === true) return true;
        await exec(`document.querySelector(".recent-item .recent-title")?.click()`);
        return waitFor(`document.querySelector(".turn-assistant")`, 20000);
    };
    try {
        await openVault();
        if (!(await fixAndRead(1440, 900))) {
            out.error = "size-gate: la ventana no leyó 1440×900";
            throw new Error(out.error as string);
        }
        if (CAPTURE_PHASE === "nomodel") {
            recheck = async () => waitFor(`document.querySelector(".view-scroll")`, 20000);
            await recheck();
            out.conversationReadback = []; // §2.1: fase sin conversación, ausencia asentada
            await sleep(1500);
            await snap("foto-52-sin-modelo.png");
        } else if (CAPTURE_PHASE === "error") {
            await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
            await waitFor(`document.querySelector(".composer textarea")`, 20000);
            await typeDraft("¿Cuál es la capital de Islandia?");
            await exec(`document.querySelector(".send-box")?.click()`);
            const card = `(() => {
                if (document.querySelector(".send-box.stop")) return false;
                return [...document.querySelectorAll(".chat-column .card")].length > 0;
            })()`;
            out.errorCardShown = await waitFor(card, 120000);
            recheck = async () => waitFor(card, 20000);
            // §2.1 también aquí: la fase corre un turno (el que
            // falla) y su conversación se lee de vuelta antes de
            // cerrar, como en la principal.
            const bErr = (await exec(`window.nido.bootstrap()`)) as any;
            out.conversationReadback = (bErr?.conversations ?? []).map((c: any) => ({
                id: c.id,
                turns: (c.turns ?? []).map((t: any) => ({
                    role: t.role,
                    route: t.route ?? null,
                    warnings: t.warnings ?? null,
                    sources: Array.isArray(t.sources) ? t.sources.length : null,
                    textLen: typeof t.text === "string" ? t.text.length : null,
                })),
            }));
            await sleep(800);
            await snap("foto-53-error-carga.png");
        } else if (CAPTURE_PHASE === "welcome") {
            recheck = async () => waitFor(`document.querySelector(".welcome-hero .btn.primary")`, 20000);
            out.welcomeShown = await recheck();
            // La misma bandera del modo boot (R-3): la espera
            // de la bienvenida asienta si salió por hallazgo.
            // welcomeShown queda como el hecho de la fase; la
            // bandera es la que la cuenta de la pierna cobra.
            out.welcomeFound = out.welcomeShown === true;
            out.conversationReadback = []; // §2.1: fase sin conversación, ausencia asentada
            await sleep(800);
            await snap("foto-51-bienvenida.png");
        } else if (CAPTURE_PHASE === "modelos") {
            // E4 paso 6: la superficie del gestor con la escalera
            // sembrada por enlace. La navegación por el riel, la
            // espera a las filas del gestor (el censo con huella
            // de los cuatro GGUF tarda), la ficha del primero
            // abierta y el tema nocturno por el canal de prefs.
            // La marca de los datos del gestor (no los del
            // bootstrap, que pintan las filas al instante): un
            // modelo sembrado lee «En disco» solo cuando el
            // censo con huella del gestor ya volvió.
            const managerMark = `[...document.querySelectorAll(".model-row-meta")].some((e) => (e.textContent ?? "").includes("En disco"))`;
            const gotoModels = async (): Promise<boolean> => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    await exec(`[...document.querySelectorAll(".nav-item")].find((b) => ["Modelos", "Models"].includes((b.textContent ?? "").trim()))?.click()`);
                    if (await waitFor(managerMark, attempt === 0 ? 120000 : 30000)) return true;
                }
                return false;
            };
            out.modelsShown = await gotoModels();
            recheck = async () => waitFor(managerMark, 20000);
            await sleep(1200);
            await snap("foto-e4-gestor-daylight.png");
            await exec(`document.querySelector(".model-row .model-row-main")?.click()`);
            await sleep(600);
            await exec(`[...document.querySelectorAll(".card")].pop()?.scrollIntoView({block: "start"})`);
            await sleep(600);
            await snap("foto-e4-gestor-ficha.png");
            await exec(`window.nido.prefsSet({theme: "night"})`);
            window.webContents.reload();
            out.modelsShownNight = await gotoModels();
            await sleep(800);
            await snap("foto-e4-gestor-night.png");
        } else if (CAPTURE_PHASE === "pasada") {
            // E4 paso 7 (E4-PASADA §1.2): la secuencia de
            // superficie. La re-verificación del 1.7B por la
            // cola del gestor, las cinco activaciones en su
            // orden por el canal, la pregunta canónica a tope
            // 256 por el compositor real y, en cada cambio, la
            // foto del plan leída del canal (insignias, chip y
            // cuenta: el contraste de §1.3). Cada paso se anexa
            // a pasada-steps.jsonl al ocurrir: la corrida es
            // larga y su registro no espera al final.
            const stepsPath = path.join(CAPTURE_DIR, "pasada-steps.jsonl");
            const step = (rec: Record<string, unknown>) => {
                fs.appendFileSync(stepsPath, JSON.stringify({at: new Date().toISOString(), ...rec}) + "\n");
            };
            const treeRssBytes = () =>
                app.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0) * 1024;
            const QUESTION = "What is the capital of France, and why do offline assistants matter?";
            const enterChat = async (): Promise<boolean> => {
                if ((await exec(`!!document.querySelector(".composer textarea")`)) === true) return true;
                await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
                return waitFor(`document.querySelector(".composer textarea")`, 20000);
            };
            const sendCanonical = async (): Promise<boolean> => {
                const before = (await exec(`document.querySelectorAll(".turn-assistant").length`)) as number;
                await typeDraft(QUESTION);
                await exec(`document.querySelector(".send-box")?.click()`);
                return waitFor(`(() => {
                    if (document.querySelector(".send-box.stop")) return false;
                    const b = document.querySelectorAll(".turn-assistant");
                    if (b.length <= ${before}) return false;
                    return (b[b.length - 1].textContent ?? "").trim().length > 0;
                })()`, 1200000);
            };
            out.rssIdleBytes = treeRssBytes();
            step({step: "reposo", rssBytes: out.rssIdleBytes});
            const tVerify = Date.now();
            const listed = (await exec(`window.nido.modelsList()`)) as any;
            out.reverifyMs = Date.now() - tVerify;
            const card17 = (listed?.models ?? []).find((m: any) => m.id === "qwen3-1.7b-q4km");
            step({step: "reverificacion-1.7b", ms: out.reverifyMs, state: card17?.state ?? null});
            const fullSequence = [
                "qwen3-1.7b-q4km",
                "qwen3-0.6b-q4km",
                "qwen2.5-1.5b-instruct-q4km",
                "qwen3-4b-instruct-2507-q4km",
                "qwen3-1.7b-q4km",
            ];
            const sequence =
                process.env["NIDO_PASADA_SOLO"] === "1"
                    ? fullSequence.slice(0, 1)
                    : process.env["NIDO_PASADA_ID"]
                      ? [process.env["NIDO_PASADA_ID"]]
                      : fullSequence;
            out.activations = [];
            for (const id of sequence) {
                const rec: Record<string, unknown> = {id};
                const tLoad = Date.now();
                let r = (await exec(`window.nido.modelLoad(${JSON.stringify(id)})`)) as any;
                if (r?.ok !== true && r?.reason === "locked") {
                    // Una generación larga pudo dejar caer la
                    // sesión por inactividad: se reabre la puerta
                    // y se reintenta una vez, asentado.
                    await openVault();
                    rec.reunlock = true;
                    r = (await exec(`window.nido.modelLoad(${JSON.stringify(id)})`)) as any;
                }
                rec.loadMs = Date.now() - tLoad;
                rec.loadOk = r?.ok === true;
                rec.loadReason = r?.reason ?? null;
                rec.loadError = r?.error ?? null;
                const photo = (r?.models ?? listed?.models ?? []) as any[];
                const mine = photo.find((m: any) => m.id === id);
                rec.fit = mine?.fit ?? null;
                rec.contextSize = mine?.contextSize ?? null;
                rec.degradation = mine?.degradation ?? null;
                rec.state = mine?.state ?? null;
                rec.badges = photo
                    .filter((m: any) => m.kind === "llm")
                    .map((m: any) => ({id: m.id, fit: m.fit, state: m.state, recommended: m.recommended === true}));
                rec.rssLoadedBytes = treeRssBytes();
                step({step: "activacion", ...rec});
                if (r?.ok === true) {
                    await enterChat();
                    const tGen = Date.now();
                    rec.genOk = await sendCanonical();
                    rec.genMs = Date.now() - tGen;
                    const boot = (await exec(`window.nido.bootstrap()`)) as any;
                    rec.lastGenRate = boot?.stats?.lastGenRate ?? null;
                    rec.rssAfterGenBytes = treeRssBytes();
                    rec.answerHead = (await exec(
                        `(() => { const b = document.querySelectorAll(".turn-assistant"); return b.length ? (b[b.length - 1].textContent ?? "").slice(0, 160) : ""; })()`,
                    )) as string;
                    step({
                        step: "generacion",
                        id,
                        genOk: rec.genOk,
                        genMs: rec.genMs,
                        lastGenRate: rec.lastGenRate,
                        answerHead: rec.answerHead,
                    });
                }
                (out.activations as unknown[]).push(rec);
            }
            recheck = async () => true;
        } else if (CAPTURE_PHASE === "principal") {
            // La fase principal de la re-captura (PREP-CURA-RECAPTURA
            // §2.5): una sola bóveda y una sola conversación. La
            // puerta por su formulario; el montaje del modelo por el
            // canal (§2.2: la recomendación leída de su sede, modelId,
            // con intento y resultado asentados y la residencia
            // cobrada tras la carga y tras los turnos); el censo del
            // paquete asentado; el turno fundamentado el primero y el
            // único antes de la foto 4, con su lectura de vuelta
            // (§2.1) como predicado que autoriza las capturas 1 a 4; y
            // el turno del ensayo solo tras el punto de la foto 4,
            // con la espera del primer token de §2.6 y su desenlace
            // asentado en la lectura final. Sin turno de
            // calentamiento: el montaje es el canal, no un turno.
            const enterChat = async (): Promise<boolean> => {
                await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
                return waitFor(`document.querySelector(".composer textarea")`, 30000);
            };
            const readback = async (): Promise<any[]> => {
                const b = (await exec(`window.nido.bootstrap()`)) as any;
                const convs = (b?.conversations ?? []).map((c: any) => ({
                    id: c.id,
                    turns: (c.turns ?? []).map((t: any) => ({
                        role: t.role,
                        route: t.route ?? null,
                        warnings: t.warnings ?? null,
                        sources: Array.isArray(t.sources) ? t.sources.map((s: any) => s.title ?? "?") : null,
                        textLen: typeof t.text === "string" ? t.text.length : null,
                    })),
                }));
                out.conversationReadback = convs;
                return convs as any[];
            };
            const b0 = (await exec(`window.nido.bootstrap()`)) as any;
            out.packCensus = {packs: b0?.library?.packs ?? null, factCount: b0?.library?.factCount ?? null};
            const ml = (await exec(`window.nido.modelsList()`)) as any;
            const mlData = ml?.ok ? (ml.models ? ml : ml.data) : ml;
            const recId = mlData?.recommendation?.modelId ?? null;
            out.modelLoadAttempt = {id: recId, via: "window.nido.modelLoad"};
            out.modelLoadResult = recId
                ? await exec(`window.nido.modelLoad(${JSON.stringify(recId)})`).catch((e: unknown) => ({bridgeError: String(e)}))
                : {skipped: "sin recomendación legible"};
            const ml2 = (await exec(`window.nido.modelsList()`)) as any;
            const ml2Data = ml2?.ok ? (ml2.models ? ml2 : ml2.data) : ml2;
            out.residentAfterLoad = (ml2Data?.models ?? []).filter((m: any) => m.resident).map((m: any) => m.id);
            out.composerShown = await enterChat();
            recheck = reopenConversation;
            // El turno fundamentado, el primero y el único antes de
            // la foto 4: el firmado de la pasada.
            out.groundedSettled = await sendTurn("¿Cómo se hace la reanimación cardiopulmonar paso a paso?", 600000);
            const convs = await readback();
            const assistantTurns = convs.flatMap((c: any) => c.turns).filter((t: any) => t.role === "assistant");
            const grounded = assistantTurns[assistantTurns.length - 1] ?? null;
            out.groundedRoute = grounded?.route ?? null;
            out.groundedSources = Array.isArray(grounded?.sources) ? grounded.sources.length : 0;
            out.evidenceShown = await exec(`!!document.querySelector(".evidence-card")`);
            out.chipsShown = await exec(`!!document.querySelector(".source-chip")`);
            out.turnWithEvidence = out.evidenceShown === true && out.chipsShown === true && (out.groundedSources as number) > 0;
            if (out.turnWithEvidence === true) {
                await exec(`document.querySelector(".chat-scroll")?.scrollTo(0, 0)`);
                await sleep(800);
                await snap("foto-1-conversacion-daylight.png");
                await exec(`window.nido.prefsSet({theme: "night"})`);
                window.webContents.reload();
                await enterChat();
                await exec(`document.querySelector(".recent-item .recent-title")?.click()`);
                out.nightTurnShown = await waitFor(`document.querySelector(".turn-assistant")`, 20000);
                out.nightEvidenceShown = await exec(`!!document.querySelector(".evidence-card")`);
                await exec(`document.querySelector(".chat-scroll")?.scrollTo(0, 0)`);
                await sleep(800);
                await snap("foto-2-conversacion-night-garden.png");
                await exec(`window.nido.prefsSet({theme: "daylight"})`);
                window.webContents.reload();
                await enterChat();
                await exec(`document.querySelector(".recent-item .recent-title")?.click()`);
                await waitFor(`document.querySelector(".turn-assistant")`, 20000);
                await exec(`document.querySelector(".source-chip")?.scrollIntoView({block: "center"})`);
                await sleep(300);
                await exec(`document.querySelector(".source-chip")?.click()`);
                out.panelShown = await waitFor(`document.querySelector("aside.sources-panel")`, 10000);
                out.panelWidthPx = await exec(`Math.round(document.querySelector("aside.sources-panel")?.getBoundingClientRect().width ?? 0)`);
                recheck = async () => {
                    if ((await exec(`!!document.querySelector("aside.sources-panel")`)) === true) return true;
                    if (!(await reopenConversation())) return false;
                    await exec(`document.querySelector(".source-chip")?.click()`);
                    return waitFor(`document.querySelector("aside.sources-panel")`, 10000);
                };
                await sleep(800);
                await snap("foto-3-panel-fuentes.png");
                out.foto4SizeOk = await fixAndRead(1024, 900);
                if (out.foto4SizeOk) {
                    out.columnWidthPx = await exec(`Math.round(document.querySelector(".chat-column")?.getBoundingClientRect().width ?? 0)`);
                    out.panelShownAt1024 = await exec(`!!document.querySelector("aside.sources-panel")`);
                    await snap("foto-4-regimen-medio.png");
                } else {
                    notCharged.push({name: "foto-4-regimen-medio.png", cause: "size-read"});
                }
                out.foto4ReturnOk = await fixAndRead(1440, 900);
            } else {
                // La ruta fundamentada no se produce: las cuatro
                // tomas se asientan ausentes con su ruta como causa,
                // en la forma de §1.2 (a') y §2.4, no pasadas.
                const cause = `ruta-sin-fuentes:${out.groundedRoute} · la ruta fundamentada no se produce para el turno firmado (rama (b) de PREP-CURA-RECAPTURA, firmada por la casa; HALLAZGO-EMBEDDINGS-SIN-CARGA-14)`;
                for (const name of ["foto-1-conversacion-daylight.png", "foto-2-conversacion-night-garden.png", "foto-3-panel-fuentes.png", "foto-4-regimen-medio.png"])
                    notCharged.push({name, cause});
            }
            // El turno del ensayo, solo tras el punto de la foto 4
            // (§2.5 paso 6), y la foto 6 con los tokens en curso
            // (§2.6): la captura espera al primer token asentado como
            // predicado, no a la pastilla sola.
            await exec(`document.querySelector("aside.sources-panel button[aria-label='close']")?.click()`);
            await sleep(500);
            recheck = async () => waitFor(`document.querySelector(".emergency-pill")`, 15000);
            await typeDraft("Escribe un ensayo muy largo y detallado sobre la historia de los faros en el mundo, con varios párrafos y muchos ejemplos.");
            // El predicado de §2.6 mira la burbuja NUEVA del turno:
            // contar las burbujas antes de enviar y exigir una más
            // con texto. La forma anterior casaba con la burbuja del
            // turno anterior (≥30 caracteres ya escritos) y capturó
            // la foto 6 en «pensando» a los 94 ms, el defecto mismo
            // de la toma detenida; lo cazó la mirada al fotograma.
            const bubblesBefore = (await exec(`document.querySelectorAll(".turn-assistant .bubble").length`)) as number;
            const tEssay = Date.now();
            await exec(`document.querySelector(".send-box")?.click()`);
            const streaming = `(() => {
                if (!document.querySelector(".emergency-pill")) return false;
                if (!document.querySelector(".send-box.stop")) return false;
                const bubbles = document.querySelectorAll(".turn-assistant .bubble");
                if (bubbles.length <= ${bubblesBefore}) return false;
                return (bubbles[bubbles.length - 1].textContent ?? "").trim().length >= 30;
            })()`;
            out.streamingShown = await waitFor(streaming, 300000);
            out.firstTokenWaitMs = out.streamingShown === true ? Date.now() - tEssay : null;
            out.pillShown = await exec(`!!document.querySelector(".emergency-pill")`);
            out.streamedChars = await exec(`(() => {
                const bubbles = document.querySelectorAll(".turn-assistant .bubble");
                return bubbles.length ? (bubbles[bubbles.length - 1].textContent ?? "").trim().length : 0;
            })()`);
            await snap("foto-6-pastilla-emergencia.png");
            // El turno se deja asentar entero y su desenlace entra en
            // la lectura de vuelta: no se cierra la app sobre su vuelo.
            out.essaySettled = await waitFor(turnSettled, 600000);
            await readback();
            const ml3 = (await exec(`window.nido.modelsList()`)) as any;
            const ml3Data = ml3?.ok ? (ml3.models ? ml3 : ml3.data) : ml3;
            out.residentAfterTurns = (ml3Data?.models ?? []).filter((m: any) => m.resident).map((m: any) => m.id);
        }
    } catch (err) {
        out.error = String(err);
    }
    out.reUnlocks = reUnlocks;
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("CAPTURE-DONE");
    setTimeout(() => app.quit(), 500);
}

// La corrida corta discriminante de PREP-CAUSA-SIN-MODELO (§5):
// corre los tres turnos de la sesión detenida por el puente (no por
// el DOM), asienta el resultado entero de cada turno (ruta, avisos,
// fuentes, evidencia, residencia) y lee la conversación persistida
// de vuelta por el bootstrap antes de cerrar, que es el registro
// que la sesión de fotos destruyó al borrar su HOME. El turno del
// ensayo se deja asentar entero y tras él se recarga y se re-lee la
// línea del modelo: eso cobra o mata H4.
async function runTurnProbe(window: BrowserWindow) {
    const exec = (code: string) => window.webContents.executeJavaScript(code) as Promise<unknown>;
    const out: Record<string, unknown> = {turns: [] as unknown[], readback: [] as unknown[]};
    benchReport.turnprobe = out;
    const waitFor = async (predicate: string, timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ((await exec(`!!(${predicate})`)) === true) return true;
            await sleep(700);
        }
        return false;
    };
    const driveGate = async (): Promise<boolean> => {
        await waitFor(`document.querySelector(".vault-gate, .composer textarea, .welcome-hero, .view-scroll")`, 30000);
        if ((await exec(`!!document.querySelector(".vault-gate")`)) !== true) {
            out.vaultCrossing = "already-unlocked";
            return true;
        }
        await exec(`(() => {
            const fields = [...document.querySelectorAll(".vault-card input")].filter((i) => i.type === "password" || i.type === "text");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            for (const f of fields) {
                setter.call(f, ${JSON.stringify(PERSIST_PASSWORD)});
                f.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return fields.length;
        })()`);
        await sleep(300);
        await exec(`document.querySelector(".vault-card .btn.primary")?.click()`);
        const gone = await waitFor(`!document.querySelector(".vault-gate")`, 30000);
        out.vaultCrossing = "form";
        return gone;
    };
    const sendViaBridge = async (convId: string, text: string): Promise<unknown> =>
        exec(`window.nido.turnSend({conversationId: ${JSON.stringify(convId)}, text: ${JSON.stringify(text)}})`);
    const summarize = (r: any) => ({
        ok: r?.ok ?? null,
        route: r?.result?.route ?? null,
        warnings: r?.result?.warnings ?? null,
        sources: Array.isArray(r?.result?.sources) ? r.result.sources.length : null,
        evidence: !!r?.result?.evidence,
        generationModelResident: r?.result?.generationModelResident ?? null,
        textLen: typeof r?.result?.text === "string" ? r.result.text.length : null,
    });
    const readback = async (label: string) => {
        const b = (await exec(`window.nido.bootstrap()`)) as any;
        const convs = (b?.conversations ?? []).map((c: any) => ({
            id: c.id,
            turns: (c.turns ?? []).map((t: any) => ({
                role: t.role,
                route: t.route ?? null,
                warnings: t.warnings ?? null,
                sources: Array.isArray(t.sources) ? t.sources.length : null,
                evidence: !!t.evidence,
                textLen: typeof t.text === "string" ? t.text.length : null,
            })),
        }));
        (out.readback as unknown[]).push({label, convs});
        return b;
    };
    try {
        out.gateOk = await driveGate();
        await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
        await waitFor(`document.querySelector(".composer textarea")`, 30000);
        const convId = `turnprobe-${Date.now()}`;
        const questions = [
            "What is the emergency phone number?",
            "¿Cómo se hace la reanimación cardiopulmonar paso a paso?",
            "Escribe un ensayo muy largo y detallado sobre la historia de los faros en el mundo, con varios párrafos y muchos ejemplos."
        ];
        for (let i = 0; i < questions.length; i++) {
            const t0 = Date.now();
            const r = await sendViaBridge(convId, questions[i]);
            (out.turns as unknown[]).push({i: i + 1, wallMs: Date.now() - t0, ...summarize(r)});
            await readback(`tras turno ${i + 1}`);
            // El informe se asienta también a mitad: si el turno del
            // ensayo se alarga, la evidencia del fundamentado y de
            // la sonda ya está en disco.
            benchReport.finishedAt = new Date().toISOString();
            writeBenchReport();
        }
        // La segunda pasada de la pregunta de RCP en conversación
        // nueva, tras dar tiempo al índice perezoso: separa la
        // familia (b)/(c) de la (a) de H2.
        await sleep(30000);
        const conv2 = `turnprobe2-${Date.now()}`;
        const t0 = Date.now();
        const r2 = await sendViaBridge(conv2, questions[1]);
        out.retryCpr = {wallMs: Date.now() - t0, ...summarize(r2)};
        await readback("tras reintento RCP");
        const bFinal = await readback("final");
        out.corpusIndexStatus = bFinal?.corpusIndexStatus ?? bFinal?.indexStatus ?? null;
        // H4: recarga y re-lectura de la residencia.
        window.webContents.reload();
        await sleep(4000);
        const b2 = (await exec(`window.nido.bootstrap()`)) as any;
        out.residentAfterEssay = (b2?.models ?? []).filter((m: any) => m.resident).map((m: any) => m.id);
        out.installedModels = (b2?.models ?? []).filter((m: any) => m.installed).map((m: any) => m.id);
    } catch (err) {
        out.error = String(err);
    }
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("TURNPROBE-DONE");
    setTimeout(() => app.quit(), 500);
}

// La corrida discriminante de PREP-CURA-RECAPTURA (§1.1): una sola
// fase principal corta que ejercita el montaje de §2.2 (la carga por
// el canal, con intento y resultado asentados y la residencia
// cobrada dos veces), corre los turnos en el orden de §2.5 (el
// fundamentado primero), lee la conversación de vuelta antes de
// cerrar (§2.1) y sonda la recuperación sobre el mismo HOME por
// capas (packs enumerados y su estado, búsqueda en packs léxica y
// semántica, embeddings disponibles, retrieve entero): es la sonda
// que separa las ramas (a), (a'), (b) y (c) de H2 sin tocar
// producción.
async function runDiscrim(window: BrowserWindow) {
    const exec = (code: string) => window.webContents.executeJavaScript(code) as Promise<unknown>;
    const out: Record<string, unknown> = {turns: [] as unknown[], readback: [] as unknown[]};
    benchReport.discrim = out;
    const waitFor = async (predicate: string, timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ((await exec(`!!(${predicate})`)) === true) return true;
            await sleep(700);
        }
        return false;
    };
    const driveGate = async (): Promise<boolean> => {
        await waitFor(`document.querySelector(".vault-gate, .composer textarea, .welcome-hero, .view-scroll")`, 30000);
        if ((await exec(`!!document.querySelector(".vault-gate")`)) !== true) {
            out.vaultCrossing = "already-unlocked";
            return true;
        }
        await exec(`(() => {
            const fields = [...document.querySelectorAll(".vault-card input")].filter((i) => i.type === "password" || i.type === "text");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            for (const f of fields) {
                setter.call(f, ${JSON.stringify(PERSIST_PASSWORD)});
                f.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return fields.length;
        })()`);
        await sleep(300);
        await exec(`document.querySelector(".vault-card .btn.primary")?.click()`);
        const gone = await waitFor(`!document.querySelector(".vault-gate")`, 30000);
        out.vaultCrossing = "form";
        return gone;
    };
    const summarize = (r: any) => ({
        ok: r?.ok ?? null,
        route: r?.result?.route ?? null,
        warnings: r?.result?.warnings ?? null,
        sources: Array.isArray(r?.result?.sources) ? r.result.sources.length : null,
        evidence: !!r?.result?.evidence,
        textLen: typeof r?.result?.text === "string" ? r.result.text.length : null,
    });
    const readback = async (label: string) => {
        const b = (await exec(`window.nido.bootstrap()`)) as any;
        const convs = (b?.conversations ?? []).map((c: any) => ({
            id: c.id,
            turns: (c.turns ?? []).map((t: any) => ({
                role: t.role,
                route: t.route ?? null,
                warnings: t.warnings ?? null,
                sources: Array.isArray(t.sources) ? t.sources.length : null,
                textLen: typeof t.text === "string" ? t.text.length : null,
            })),
        }));
        (out.readback as unknown[]).push({label, convs});
        return b;
    };
    try {
        out.gateOk = await driveGate();
        const b0 = (await exec(`window.nido.bootstrap()`)) as any;
        out.libraryPacks = b0?.library?.packs ?? null;
        out.libraryFactCount = b0?.library?.factCount ?? null;
        // El estado del índice de paquetes no lo expone el
        // bootstrap con ninguna clave: se asienta la ausencia como
        // hecho del instrumento (COBRO-TURNPROBE), con las claves
        // que sí trae y casan con «index» (ninguna a esta foto).
        out.bootstrapIndexKeys = Object.keys(b0 ?? {}).filter((k) => /index/i.test(k));
        const ml = (await exec(`window.nido.modelsList()`)) as any;
        const mlData = ml?.ok ? (ml.models ? ml : ml.data) : ml;
        out.modelsCensus = (mlData?.models ?? []).map((m: any) => ({id: m.id, installed: m.installed, resident: m.resident}));
        out.recommendation = mlData?.recommendation ?? null;
        const recId = mlData?.recommendation?.modelId ?? mlData?.recommendation?.id ?? null;
        // §2.2: el montaje por el canal de carga, asentado.
        out.modelLoadAttempt = {id: recId, via: "window.nido.modelLoad"};
        out.modelLoadResult = recId
            ? await exec(`window.nido.modelLoad(${JSON.stringify(recId)})`).catch((e: unknown) => ({bridgeError: String(e)}))
            : {skipped: "sin recomendación legible"};
        const ml2 = (await exec(`window.nido.modelsList()`)) as any;
        const ml2Data = ml2?.ok ? (ml2.models ? ml2 : ml2.data) : ml2;
        out.residentAfterLoad = (ml2Data?.models ?? []).filter((m: any) => m.resident).map((m: any) => m.id);
        // La sonda de recuperación por capas, sobre el mismo HOME.
        out.coreProbe = await discrimCoreProbe();
        // Los turnos, en el orden de §2.5: el fundamentado primero.
        const convId = `discrim-${Date.now()}`;
        const questions = [
            "¿Cómo se hace la reanimación cardiopulmonar paso a paso?",
            "Escribe un ensayo muy largo y detallado sobre la historia de los faros en el mundo, con varios párrafos y muchos ejemplos."
        ];
        for (let i = 0; i < questions.length; i++) {
            const t0 = Date.now();
            const r = await exec(`window.nido.turnSend({conversationId: ${JSON.stringify(convId)}, text: ${JSON.stringify(questions[i])}})`);
            (out.turns as unknown[]).push({i: i + 1, wallMs: Date.now() - t0, ...summarize(r)});
            await readback(`tras turno ${i + 1}`);
            // El informe se asienta también a mitad: si el turno del
            // ensayo se alarga, la evidencia del fundamentado y de
            // la sonda ya está en disco.
            benchReport.finishedAt = new Date().toISOString();
            writeBenchReport();
        }
        const ml3 = (await exec(`window.nido.modelsList()`)) as any;
        const ml3Data = ml3?.ok ? (ml3.models ? ml3 : ml3.data) : ml3;
        out.residentAfterTurns = (ml3Data?.models ?? []).filter((m: any) => m.resident).map((m: any) => m.id);
    } catch (err) {
        out.error = String(err);
    }
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("DISCRIM-DONE");
    setTimeout(() => app.quit(), 500);
}

// La sonda por capas de la recuperación, en el proceso principal y
// con los registros que el desbloqueo de esta misma sesión dejó
// puestos: enumera los packs que la app ve, cobra el estado del
// Esencial contra su pin, busca en packs sin vector y con vector,
// cobra la disponibilidad del motor de embeddings y corre el
// retrieve entero que el turno corre.
async function discrimCoreProbe(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const question = "¿Cómo se hace la reanimación cardiopulmonar paso a paso?";
    try {
        const packs = await import("../../src/rag/packs.js");
        const trust = await import("../../src/models/packTrust.js");
        const list = await packs.knowledgePacks();
        out.packIds = list.map((p: any) => p.id);
        const esencial = list.find((p: any) => p.id === "nido-esencial-e5") ?? list.find((p: any) => /esencial|essential/i.test(`${p.id} ${p.filename ?? ""}`));
        out.esencial = esencial
            ? {
                  id: esencial.id,
                  filename: esencial.filename,
                  state: await trust.packFileState(esencial as never).catch((e: unknown) => `error:${String(e)}`),
              }
            : null;
        const lexOnly = await packs.searchPacks(question, null, 12).catch((e: unknown) => ({error: String(e)} as never));
        out.searchPacksLexical = (lexOnly as any)?.error
            ? lexOnly
            : {
                  lexical: ((lexOnly as any).lexical ?? []).length,
                  semantic: ((lexOnly as any).semantic ?? []).length,
                  titles: ((lexOnly as any).lexical ?? []).slice(0, 4).map((h: any) => h.title ?? h.chunkId ?? "?"),
              };
    } catch (err) {
        out.packsError = String(err);
    }
    try {
        const embed = await import("../../src/rag/embed.js");
        out.embeddingsEnsureLoaded = await embed.embeddingEngine.ensureLoaded().catch((e: unknown) => `error:${String(e)}`);
        const tagged = await embed.embeddingEngine.embedQueryTagged(question).catch((e: unknown) => null);
        out.embedQuery = tagged ? {dims: tagged.vector?.length ?? null, modelSha256: tagged.modelSha256} : "error-o-nulo";
        if (tagged) {
            const packs = await import("../../src/rag/packs.js");
            const withVec = await packs.searchPacks(question, tagged.vector, 12).catch((e: unknown) => ({error: String(e)} as never));
            out.searchPacksWithVector = (withVec as any)?.error
                ? withVec
                : {lexical: ((withVec as any).lexical ?? []).length, semantic: ((withVec as any).semantic ?? []).length};
        }
    } catch (err) {
        out.embeddingsError = String(err);
    }
    try {
        const retr = await import("../../src/rag/retrieve.js");
        const hits = await retr.retrieve(question, 6);
        out.retrieveHits = hits.length;
        out.retrieveTitles = hits.slice(0, 6).map((h: any) => h.title ?? h.chunkId ?? "?");
    } catch (err) {
        out.retrieveError = String(err);
    }
    return out;
}

// El escenario 3 del registro 2 de la pasada del acto 7 (salud sin
// guía): una pregunta de salud sin fuente en los paquetes instalados,
// por el turno real conducido en la superficie, SIN montaje previo:
// el escenario cobra la abstención honesta con su botón a la guía
// completa y la aserción de no carga del modelo, comprobada por la
// traza de la corrida (el censo de residencia antes y después, sin
// ninguna llamada de carga en el modo). El informe asienta la ruta
// leída de vuelta, el texto servido y la residencia en los dos
// extremos; el artefacto firmado vive en registros/.
async function runEsc3(window: BrowserWindow) {
    const exec = (code: string) => window.webContents.executeJavaScript(code) as Promise<unknown>;
    const out: Record<string, unknown> = {};
    benchReport.esc3 = out;
    const waitFor = async (predicate: string, timeoutMs: number): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ((await exec(`!!(${predicate})`)) === true) return true;
            await sleep(700);
        }
        return false;
    };
    const driveGate = async (): Promise<boolean> => {
        await waitFor(`document.querySelector(".vault-gate, .composer textarea, .welcome-hero, .view-scroll")`, 30000);
        if ((await exec(`!!document.querySelector(".vault-gate")`)) !== true) {
            out.vaultCrossing = "already-unlocked";
            return true;
        }
        await exec(`(() => {
            const fields = [...document.querySelectorAll(".vault-card input")].filter((i) => i.type === "password" || i.type === "text");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            for (const f of fields) {
                setter.call(f, ${JSON.stringify(PERSIST_PASSWORD)});
                f.dispatchEvent(new Event("input", {bubbles: true}));
            }
            return fields.length;
        })()`);
        await sleep(300);
        await exec(`document.querySelector(".vault-card .btn.primary")?.click()`);
        const gone = await waitFor(`!document.querySelector(".vault-gate")`, 30000);
        out.vaultCrossing = "form";
        return gone;
    };
    const census = async () => {
        const ml = (await exec(`window.nido.modelsList()`)) as any;
        const d = ml?.ok ? (ml.models ? ml : ml.data) : ml;
        return (d?.models ?? []).map((m: any) => ({id: m.id, installed: m.installed, resident: m.resident}));
    };
    try {
        out.gateOk = await driveGate();
        // La bienvenida de primera vez no monta el compositor: se
        // despide con su botón primario, la forma de los modos
        // hermanos (turnprobe, discrim). El estado welcomeSeen es
        // local del renderer y ningún canal lo siembra: la primera
        // cura de este modo lo intentó por settings-set, que no
        // acepta la clave, y la corrida volvió a caer (60 s de
        // búsqueda del compositor + 150 s de espera de
        // asentamiento, 216,2 s en la primera corrida).
        await exec(`document.querySelector(".welcome-hero .btn.primary")?.click()`);
        const b0 = (await exec(`window.nido.bootstrap()`)) as any;
        out.libraryPacks = b0?.library?.packs ?? null;
        out.libraryFactCount = b0?.library?.factCount ?? null;
        out.censusBefore = await census();
        out.residentsBefore = (out.censusBefore as any[]).filter((m) => m.resident).map((m) => m.id);
        // El turno, por la superficie: escribir en el composer y enviar.
        out.composerFound = await waitFor(`!!document.querySelector(".composer textarea")`, 60000);
        if (!out.composerFound) {
            // Guarda de causa nombrada: sin compositor el turno
            // nunca se compone, y el informe lo dice en esa forma
            // en vez de leerse como un turno no asentado (deuda
            // cobrada por COBRO-ESC3-CAUSA, traída en esta cura).
            out.cause = "composer-not-found: la superficie no montó el compositor tras la puerta y la bienvenida; el turno nunca se compuso";
            out.settled = false;
            const bx = (await exec(`window.nido.bootstrap()`)) as any;
            out.readback = (bx?.conversations ?? []).map((c: any) => ({
                id: c.id,
                turns: (c.turns ?? []).map((t: any) => ({
                    role: t.role,
                    route: t.route ?? null,
                    warnings: t.warnings ?? null,
                    sources: Array.isArray(t.sources) ? t.sources.length : null,
                    evidence: !!t.evidence,
                    textLen: typeof t.text === "string" ? t.text.length : null,
                    text: typeof t.text === "string" ? t.text.slice(0, 800) : null,
                })),
            }));
            out.censusAfter = await census();
            out.residentsAfter = (out.censusAfter as any[]).filter((m: any) => m.resident).map((m: any) => m.id);
            return;
        }
        const question = "¿Qué dosis de paracetamol puede tomar un adulto de 70 kilos?";
        out.question = question;
        await exec(`(() => {
            const ta = document.querySelector(".composer textarea");
            if (!ta) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(ta, ${JSON.stringify(question)});
            ta.dispatchEvent(new Event("input", {bubbles: true}));
            return true;
        })()`);
        await sleep(300);
        const t0 = Date.now();
        await exec(`document.querySelector(".send-box")?.click()`);
        out.settled = await waitFor(`!document.querySelector(".send-box.stop") && document.querySelectorAll(".turn-assistant .bubble").length > 0`, 150000);
        out.wallMs = Date.now() - t0;
        out.dom = await exec(`(() => {
            const turns = document.querySelectorAll(".turn-assistant");
            const last = turns[turns.length - 1];
            const bubble = last?.querySelector(".bubble");
            const candidates = [...(last?.querySelectorAll("button, a") ?? [])].map((el) => ({text: (el.textContent ?? "").trim().slice(0, 80), cls: el.className}));
            return {
                turnText: (bubble?.textContent ?? "").trim().slice(0, 800),
                buttons: candidates,
                guideButton: candidates.find((c) => /gu[ií]a|guide/i.test(c.text) || /guide/i.test(c.cls)) ?? null,
            };
        })()`);
        const b1 = (await exec(`window.nido.bootstrap()`)) as any;
        out.readback = (b1?.conversations ?? []).map((c: any) => ({
            id: c.id,
            turns: (c.turns ?? []).map((t: any) => ({
                role: t.role,
                route: t.route ?? null,
                warnings: t.warnings ?? null,
                sources: Array.isArray(t.sources) ? t.sources.length : null,
                evidence: !!t.evidence,
                textLen: typeof t.text === "string" ? t.text.length : null,
                text: typeof t.text === "string" ? t.text.slice(0, 800) : null,
            })),
        }));
        out.censusAfter = await census();
        out.residentsAfter = (out.censusAfter as any[]).filter((m: any) => m.resident).map((m: any) => m.id);
    } catch (err) {
        out.error = String(err);
    }
    benchReport.finishedAt = new Date().toISOString();
    writeBenchReport();
    benchLog("ESC3-DONE");
    setTimeout(() => app.quit(), 500);
}

if (BENCH_MODE === "capture" || BENCH_MODE === "boot" || BENCH_MODE === "turnprobe" || BENCH_MODE === "discrim" || BENCH_MODE === "esc3") {
    if (!PERSIST_PASSWORD || (BENCH_MODE === "capture" && !CAPTURE_DIR)) {
        benchLog("CAPTURE/BOOT-ABORT sin contraseña o sin directorio");
        app.quit();
    } else {
        void (async () => {
            await installServices();
            bootShell({
                onPageSettled: (window) => {
                    if (BENCH_MODE === "capture") void runCapture(window);
                    else if (BENCH_MODE === "turnprobe") void runTurnProbe(window);
                    else if (BENCH_MODE === "discrim") void runDiscrim(window);
                    else if (BENCH_MODE === "esc3") void runEsc3(window);
                    else void runBoot(window);
                }
            });
        })();
    }
} else if (BENCH_MODE === "window") {
    if (!PERSIST_PASSWORD) {
        benchLog("WINDOW-ABORT sin NIDO_PERSIST_PASSWORD");
        app.quit();
    } else {
        void (async () => {
            await installServices();
            bootShell({
                onPageSettled: (window) => {
                    void runWindow(window);
                }
            });
        })();
    }
} else if (BENCH_MODE === "persist-write" || BENCH_MODE === "persist-verify") {
    if (!PERSIST_PASSWORD) {
        benchLog("PERSIST-ABORT sin NIDO_PERSIST_PASSWORD");
        app.quit();
    } else {
        void (async () => {
            await installServices();
            bootShell({
                onPageSettled: (window) => {
                    void runPersist(window);
                }
            });
        })();
    }
} else {
    bootShell({
        onPageSettled: (window) => {
            if (BENCH_MODE)
                void runBench(window);
        }
    });
}
