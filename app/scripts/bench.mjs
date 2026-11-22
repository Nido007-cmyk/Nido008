#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Banco E1 · orquestador de la prueba de empaquetado (INSTALADOR-ETAPA
 * pasos 2, 3 y 4; CARCASA-PC §6 pasos 2 a 4). Corre SIEMPRE contra
 * los paquetes construidos, nunca contra el árbol de desarrollo:
 *
 *  - Arranque en frío: 5 lanzamientos en modo NIDO_BENCH=cold; se mide
 *    de spawn a «READY» (ventana cargada) y se publica la mediana.
 *  - Corrida completa (NIDO_BENCH=full): la app carga el Qwen3-0.6B
 *    por la vía de la casa y responde; en cada estado (reposo,
 *    cargado, generando) se captura el censo de puertos en escucha
 *    atribuibles a sus procesos (ss -tlnp y ss -ulnp, salida cruda
 *    guardada) y la suma de RSS de su árbol de procesos.
 *  - Test de rechazo de D-1 (NIDO_BENCH=tamper): se prepara una
 *    copia del 0.6B alterada en un byte (mismo tamaño, mismo nombre
 *    de catálogo) en un directorio de modelos propio y la app debe
 *    rechazarla por huella. La corrida completa con el fichero
 *    genuino es el control: la misma vía que rechaza el alterado
 *    acepta el bueno.
 *  - Corrida de sondas (NIDO_BENCH=probe, tanda de arreglos de la
 *    carcasa): sin cargar modelo, la página ejerce S-FETCH (fetch
 *    a un fichero canario plantado fuera del asar en
 *    bench-results/canary.txt, con contenido azaroso por corrida),
 *    S-PERM (permisos) y S-DEVTOOLS (atajos). Su informe es
 *    probe-report.json.
 *  - Corrida hostil de entorno (S-DEVURL): el paquete-banco en modo
 *    probe con VITE_DEV_SERVER_URL=https://example.com/ en el
 *    entorno; su informe es probe-hostile.json y la página cargada
 *    tiene que ser la local.
 *  - Censo de red saliente (CARCASA-RED-ARRANQUE): el paquete de
 *    PRODUCCIÓN, sin variables del banco y con entorno limpio,
 *    bajo strace (connect/sendto) durante el arranque y ~20 s de
 *    reposo; los destinos van a outbound.json y la traza cruda a
 *    strace-outbound.txt. Es el gemelo saliente del censo de
 *    escucha: aquel prueba que la app no escucha; este, que no
 *    habla sin que la persona lo pida.
 *  - Corrida de la guardia de arranque (D-7): el paquete de
 *    producción lanzado con --remote-debugging-port tiene que
 *    salir sin ventana; el veredicto va a guard-report.json.
 *  - Tamaños: el artefacto AppImage y el directorio instalado (du).
 *
 * Las corridas del banco (cold, tamper, full, probe y la hostil)
 * lanzan el PAQUETE-BANCO (release-bench/linux-unpacked) cuando
 * existe; antes de que la tanda de arreglos lo separara, lanzan el
 * de producción, que era el único. El censo saliente y la guardia
 * lanzan siempre el de PRODUCCIÓN (release/linux-unpacked).
 *
 * Etapas: sin argumentos corre todo; con una lista separada por
 * comas (cold,tamper,full,probe,hostile,outbound,guard) corre solo
 * esas, para iterar una pierna sin repetir la corrida completa.
 *
 * Salida: bench-results/summary.json + los informes por corrida y
 * las salidas crudas de los censos. El resumen conserva las etapas
 * de corridas anteriores del mismo directorio (cada corrida pisa
 * solo las suyas), para que una iteración parcial no borre la
 * evidencia de la completa. Los informes y los registros de la
 * corrida guardan métricas y huellas de la respuesta, nunca su
 * texto ni la pregunta (DC-1 de AUDITORIA-DISCO-CLARO): la línea
 * ANSWER de stdout ya viaja en esa forma desde la entrada del
 * banco, y este orquestador la traslada tal cual.
 * La máquina de esta corrida es la VM de la casa (~8 GB, CPU
 * compartida, sin GPU, sesión como root): por correr como root,
 * Chromium exige desactivar su sandbox de sistema operativo
 * (ELECTRON_DISABLE_SANDBOX=1); es una condición del banco en esta
 * VM, queda registrada en el resumen, y no cambia la configuración
 * empaquetada de la ventana (webPreferences sandbox: true, que la
 * suite de endurecimiento verifica por su lado).
 */
import {spawn, execFileSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {checkFreshness, notRunRecord, sealCitation} from "./buildSeal.mjs";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "..");
const exePath = path.join(appDir, "release", "linux-unpacked", "nido-pc");
const benchExeCandidate = path.join(appDir, "release-bench", "linux-unpacked", "nido-pc");
const benchExePath = fs.existsSync(benchExeCandidate) ? benchExeCandidate : exePath;
const modelsDir = process.env["NIDO_MODELS_DIR"] ?? path.join(appDir, "..", "models");
const outDir = path.join(appDir, "bench-results");
fs.mkdirSync(outDir, {recursive: true});
const canaryPath = path.join(outDir, "canary.txt");

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const harnessEnv = {
    ...(isRoot ? {ELECTRON_DISABLE_SANDBOX: "1"} : {}),
    NIDO_MODELS_DIR: modelsDir
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Xvfb propio: la VM no tiene sesión gráfica. Se levanta sin
// escucha TCP (-nolisten tcp) para no contaminar el censo, y su PID
// queda fuera del árbol de la app a propósito.
function startXvfb() {
    const display = ":77";
    const xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
        stdio: "ignore"
    });
    return {xvfb, display};
}

// --- Árbol de procesos y RSS (ps), censo de sockets (ss) -------------
function readProcessTable() {
    const out = execFileSync("ps", ["-eo", "pid=,ppid=,rss="], {encoding: "utf8"});
    const table = new Map();
    for (const line of out.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length !== 3)
            continue;
        const [pid, ppid, rss] = parts.map(Number);
        if (Number.isFinite(pid))
            table.set(pid, {ppid, rssKiB: rss});
    }
    return table;
}

function treePids(rootPid, table) {
    const children = new Map();
    for (const [pid, info] of table) {
        if (!children.has(info.ppid))
            children.set(info.ppid, []);
        children.get(info.ppid).push(pid);
    }
    const result = [];
    const queue = [rootPid];
    while (queue.length > 0) {
        const pid = queue.shift();
        result.push(pid);
        for (const child of children.get(pid) ?? [])
            queue.push(child);
    }
    return result;
}

function sampleState(rootPid, label) {
    const table = readProcessTable();
    const pids = treePids(rootPid, table);
    let rssKiB = 0;
    for (const pid of pids)
        rssKiB += table.get(pid)?.rssKiB ?? 0;

    const pidSet = new Set(pids);
    const listeners = [];
    const rawByTool = {};
    for (const args of [["-tlnp"], ["-ulnp"]]) {
        let raw = "";
        try {
            raw = execFileSync("ss", args, {encoding: "utf8"});
        } catch {
            raw = "";
        }
        rawByTool[args[0]] = raw;
        for (const line of raw.split("\n")) {
            const match = line.match(/pid=(\d+)/g);
            if (!match)
                continue;
            if (match.some((token) => pidSet.has(Number(token.slice(4)))))
                listeners.push(line.trim());
        }
    }
    fs.writeFileSync(path.join(outDir, `ss-${label}.txt`),
        `# censo ${label} · pids de la app: ${pids.join(",")}\n` +
        `# --- ss -tlnp ---\n${rawByTool["-tlnp"]}\n# --- ss -ulnp ---\n${rawByTool["-ulnp"]}\n`);
    return {
        label,
        pids,
        processCount: pids.length,
        rssBytes: rssKiB * 1024,
        listeningSockets: listeners
    };
}

// --- Lanzamiento de la app empaquetada -------------------------------
function launchApp(display, extraEnv, exe = benchExePath, extraArgs = []) {
    const child = spawn(exe, extraArgs, {
        env: {...process.env, ...harnessEnv, ...extraEnv, DISPLAY: display},
        stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.on("data", (chunk) => {
        fs.appendFileSync(path.join(outDir, "app-stderr.log"), chunk);
    });
    return child;
}

function waitForLine(child, needle, timeoutMs) {
    return new Promise((resolve, reject) => {
        let buffer = "";
        const timer = setTimeout(() => reject(new Error(`timeout esperando "${needle}"`)), timeoutMs);
        child.stdout.on("data", (chunk) => {
            buffer += chunk.toString();
            let index;
            while ((index = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (line.includes(needle)) {
                    clearTimeout(timer);
                    resolve(line);
                }
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`la app salió (código ${code}) esperando "${needle}"`));
        });
    });
}

// La corrida completa necesita reaccionar a varios marcadores en
// orden; se consume stdout con un lector de líneas compartido.
function lineReader(child) {
    const waiters = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            fs.appendFileSync(path.join(outDir, "app-stdout.log"), line + "\n");
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (line.includes(waiters[i].needle)) {
                    const waiter = waiters.splice(i, 1)[0];
                    waiter.resolve(line);
                }
            }
        }
    });
    return {
        waitFor(needle, timeoutMs) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`timeout esperando "${needle}"`)), timeoutMs);
                waiters.push({
                    needle,
                    resolve: (line) => {
                        clearTimeout(timer);
                        resolve(line);
                    }
                });
            });
        }
    };
}

async function waitExitOrKill(child, timeoutMs) {
    await Promise.race([
        new Promise((resolve) => child.on("exit", resolve)),
        sleep(timeoutMs).then(() => child.kill("SIGKILL"))
    ]);
}

async function coldStarts(display) {
    const times = [];
    for (let i = 0; i < 5; i++) {
        const reportPath = path.join(outDir, `cold-report-${i}.json`);
        const started = performance.now();
        const child = launchApp(display, {NIDO_BENCH: "cold", NIDO_BENCH_OUT: reportPath});
        await waitForLine(child, "NIDO-BENCH READY", 120_000);
        times.push(performance.now() - started);
        await waitExitOrKill(child, 10_000);
    }
    const sorted = [...times].sort((a, b) => a - b);
    return {runsMs: times, medianMs: sorted[Math.floor(sorted.length / 2)]};
}

async function fullRun(display) {
    const reportPath = path.join(outDir, "bench-report.json");
    const child = launchApp(display, {
        NIDO_BENCH: "full",
        NIDO_BENCH_OUT: reportPath,
        NIDO_BENCH_DWELL_MS: "6000",
        NIDO_BENCH_CANARY: canaryPath
    });
    const lines = lineReader(child);
    const samples = {};

    await lines.waitFor("NIDO-BENCH READY", 120_000);
    await lines.waitFor("NIDO-BENCH STATE rest", 60_000);
    samples.rest = sampleState(child.pid, "rest");

    const loadedLine = lines.waitFor("NIDO-BENCH STATE loaded", 300_000);
    await loadedLine;
    samples.loaded = sampleState(child.pid, "loaded");

    await lines.waitFor("NIDO-BENCH STATE generating", 60_000);
    const generatingSamples = [];
    for (let i = 0; i < 3; i++) {
        generatingSamples.push(sampleState(child.pid, `generating-${i}`));
        await sleep(2500);
    }
    samples.generating = generatingSamples[generatingSamples.length - 1];
    samples.generatingAll = generatingSamples;

    // 2.400 s y no 900: la espera es un parámetro del arnés, no un
    // criterio de la etapa. Medido el 2026-11-16 en esta VM (celda de
    // ~1,5 CPU compartidas entre hasta cinco carriles): la evaluación
    // del prompt de sistema (~130 tokens) ya consumió ~750 s bajo
    // contención en la corrida con tope 96, y la primera corrida a 256
    // agotó los 900 s sin que la app fallara (seguía generando, con
    // CPU activa, cuando el orquestador la mató). La pregunta que el
    // banco dirime es si el paquete responde, no en cuánto tiempo
    // responde esta VM compartida.
    const answerLine = await lines.waitFor("NIDO-BENCH ANSWER", 2_400_000);
    const answer = JSON.parse(answerLine.slice(answerLine.indexOf("ANSWER") + "ANSWER".length).trim());
    await lines.waitFor("NIDO-BENCH DONE", 60_000);
    await waitExitOrKill(child, 10_000);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return {samples, answer, report};
}

async function tamperRun(display) {
    const tamperedDir = path.join(outDir, "tampered-models");
    fs.mkdirSync(tamperedDir, {recursive: true});
    const genuinePath = path.join(modelsDir, "qwen3-0.6b-q4km.gguf");
    const tamperedPath = path.join(tamperedDir, "qwen3-0.6b-q4km.gguf");
    fs.copyFileSync(genuinePath, tamperedPath);
    // Un solo byte alterado, lejos de la cabecera: mismo tamaño,
    // mismo nombre; solo la huella puede cazarlo.
    const fd = fs.openSync(tamperedPath, "r+");
    const offset = 1_000_003;
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, offset);
    byte[0] = byte[0] ^ 0xff;
    fs.writeSync(fd, byte, 0, 1, offset);
    fs.closeSync(fd);

    const reportPath = path.join(outDir, "tamper-report.json");
    const child = launchApp(display, {
        NIDO_BENCH: "tamper",
        NIDO_BENCH_OUT: reportPath,
        NIDO_MODELS_DIR: tamperedDir
    });
    const lines = lineReader(child);
    const verdict = await Promise.race([
        lines.waitFor("NIDO-BENCH TAMPER-REJECTED", 180_000).then(() => "rejected"),
        lines.waitFor("NIDO-BENCH TAMPER-LOADED", 180_000).then(() => "loaded")
    ]);
    await waitExitOrKill(child, 10_000);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return {verdict, tamperedByteOffset: offset, report: report.tamperTest ?? null};
}

// Corrida de sondas (modo probe). Con hostile=true lleva además la
// variable de desarrollo puesta a un origen remoto (S-DEVURL). El
// lanzamiento lleva --use-fake-device-for-media-stream: esta VM no
// tiene micrófono, y sin un dispositivo presente getUserMedia
// rechaza NotFoundError (ausencia) decida lo que decida la capa de
// permisos; con el dispositivo simulado de Chromium, quien decide
// es la capa de permisos y su rechazo se lee NotAllowedError, que
// es la señal que S-PERM cobra. El interruptor va solo en las
// corridas de sondas del paquete-banco: nunca en el de producción
// ni en el censo saliente.
async function probeRun(display, hostile) {
    const reportPath = path.join(outDir, hostile ? "probe-hostile.json" : "probe-report.json");
    const child = launchApp(display, {
        NIDO_BENCH: "probe",
        NIDO_BENCH_OUT: reportPath,
        NIDO_BENCH_CANARY: canaryPath,
        ...(hostile ? {VITE_DEV_SERVER_URL: "https://example.com/"} : {})
    }, benchExePath, ["--use-fake-device-for-media-stream"]);
    const lines = lineReader(child);
    await lines.waitFor("NIDO-BENCH DONE", 180_000);
    await waitExitOrKill(child, 10_000);
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

// --- Censo de red saliente -------------------------------------------
// Des-escapa una cadena tal como strace la imprime (comillas y
// escapes C, con octales de 1 a 3 dígitos) a bytes crudos.
function unescapeStraceString(raw) {
    const bytes = [];
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== "\\") {
            bytes.push(ch.charCodeAt(0) & 0xff);
            continue;
        }
        const next = raw[++i];
        if (next === "n")
            bytes.push(10);
        else if (next === "r")
            bytes.push(13);
        else if (next === "t")
            bytes.push(9);
        else if (next === "\\")
            bytes.push(92);
        else if (next === "\"")
            bytes.push(34);
        else if (next === "x") {
            bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
            i += 2;
        } else if (next >= "0" && next <= "7") {
            let oct = next;
            while (oct.length < 3 && raw[i + 1] >= "0" && raw[i + 1] <= "7")
                oct += raw[++i];
            bytes.push(parseInt(oct, 8) & 0xff);
        } else if (next !== undefined)
            bytes.push(next.charCodeAt(0) & 0xff);
    }
    return Buffer.from(bytes);
}

// Lee la pregunta de un mensaje DNS (cabecera + etiquetas + tipo y
// clase) y devuelve el nombre, o null si el búfer no es una
// pregunta DNS bien formada. La exigencia de forma (QR=0, una
// pregunta, clase IN y longitud exacta del sendto) es lo que
// separa una consulta real del resolvedor de cualquier otro búfer
// que viaje por un sendto (un ClientHello TLS, por ejemplo).
function parseDnsQuestion(buf) {
    if (buf.length < 17)
        return null;
    if ((buf[2] & 0x80) !== 0)
        return null; // QR=1: es una respuesta, no una pregunta
    if (buf.readUInt16BE(4) < 1)
        return null; // QDCOUNT
    let offset = 12;
    const labels = [];
    while (offset < buf.length) {
        const len = buf[offset];
        if (len === 0) {
            offset += 1;
            break;
        }
        if (len > 63 || offset + 1 + len > buf.length)
            return null;
        labels.push(buf.toString("latin1", offset + 1, offset + 1 + len));
        offset += 1 + len;
    }
    if (labels.length === 0 || offset + 4 > buf.length)
        return null;
    const qtype = buf.readUInt16BE(offset);
    const qclass = buf.readUInt16BE(offset + 2);
    if (qtype === 0 || qclass !== 1)
        return null;
    const name = labels.join(".");
    return /^[a-z0-9._-]+$/i.test(name) ? name : null;
}

function parseOutboundTrace(trace) {
    const dnsNames = new Set();
    // Solo sendto cuyo búfer NO quedó truncado por el -s de strace
    // (los truncados imprimen «...» tras la comilla y no casan) y
    // cuya longitud declarada es la del búfer des-escapado.
    const sendtoRe = /sendto\(\d+,\s*"((?:\\.|[^"\\])*)",\s*(\d+),/g;
    let match;
    while ((match = sendtoRe.exec(trace)) !== null) {
        const buf = unescapeStraceString(match[1]);
        if (buf.length !== Number(match[2]))
            continue;
        const name = parseDnsQuestion(buf);
        if (name)
            dnsNames.add(name);
    }
    const endpoints = new Set();
    for (const line of trace.split("\n")) {
        if (!/connect\(|sendto\(/.test(line) || !line.includes("AF_INET"))
            continue;
        const port = line.match(/htons\((\d+)\)/)?.[1];
        const addr = line.match(/inet_addr\("([^"]+)"\)/)?.[1] ??
            line.match(/inet_pton\(AF_INET6?,\s*"([^"]+)"\)/)?.[1];
        if (port && addr)
            endpoints.add(`${addr}:${port}`);
    }
    const destinations = [
        ...[...dnsNames].map((name) => `dns:${name}`),
        ...[...endpoints].map((endpoint) => `net:${endpoint}`)
    ].sort();
    return {
        dnsNames: [...dnsNames].sort(),
        endpoints: [...endpoints].sort(),
        destinations
    };
}

async function outboundCensus(display) {
    const tracePath = path.join(outDir, "strace-outbound.txt");
    // Entorno limpio enumerado: solo lo que el arranque necesita en
    // esta VM. Sin variables del banco y sin las del operador.
    const cleanEnv = {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        DISPLAY: display,
        HOME: process.env["HOME"] ?? "/root",
        ...(isRoot ? {ELECTRON_DISABLE_SANDBOX: "1"} : {})
    };
    const child = spawn("strace",
        ["-f", "-e", "trace=connect,sendto", "-s", "256", "-o", tracePath, exePath],
        {env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], detached: true});
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    // Arranque y ~20 s de reposo; después el orquestador lo mata
    // (grupo entero: strace y su árbol trazado).
    await sleep(25_000);
    // Autovalidación del censo: la app tiene que seguir viva justo
    // antes de la mataza. Un censo sobre un proceso que murió en
    // el arranque sale vacío y parece verde sin probar nada
    // (cazado en esta tanda: el paquete moría al arrancar por el
    // configureHostResolver antes de ready y el censo «pasó»). La
    // suite exige aliveAtKill === true junto a la lista vacía.
    let aliveAtKill = false;
    for (const entry of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(entry))
            continue;
        try {
            if (fs.readlinkSync(path.join("/proc", entry, "exe")) === exePath) {
                aliveAtKill = true;
                break;
            }
        } catch {
            // Proceso efímero o ilegible: se salta.
        }
    }
    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        // El grupo ya no existe: la app salió por su cuenta.
    }
    try {
        execFileSync("pkill", ["-KILL", "-f", exePath]);
    } catch {
        // Sin procesos que casen: nada que matar.
    }
    await sleep(500);
    const trace = fs.existsSync(tracePath) ? fs.readFileSync(tracePath, "utf8") : "";
    const result = {exePath, observedMs: 25_000, aliveAtKill, ...parseOutboundTrace(trace)};
    fs.writeFileSync(path.join(outDir, "outbound.json"), JSON.stringify(result, null, 2));
    return result;
}

// Corrida de la guardia de arranque (D-7): con el interruptor de
// depuración remota presente, el proceso tiene que salir sin
// ventana; se cobra por la salida y por no quedar residente a los
// 10 s.
async function guardRun(display) {
    const child = spawn(exePath, ["--remote-debugging-port=9333"], {
        env: {...process.env, ...harnessEnv, DISPLAY: display},
        stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
        output += chunk.toString();
    });
    const exitCode = await Promise.race([
        new Promise((resolve) => child.on("exit", resolve)),
        sleep(10_000).then(() => null)
    ]);
    const result = exitCode === null
        ? {exited: false, residentAfter10s: true, exitCode: null}
        : {exited: true, residentAfter10s: false, exitCode};
    if (exitCode === null)
        child.kill("SIGKILL");
    result.outputTail = output.slice(-500);
    fs.writeFileSync(path.join(outDir, "guard-report.json"), JSON.stringify(result, null, 2));
    return result;
}

const ALL_STAGES = ["cold", "tamper", "full", "probe", "hostile", "outbound", "guard"];
// Las etapas que corren el paquete-banco y las que corren el
// de producción: el sello se cobra por etapa contra el
// paquete que la midió.
const BENCH_STAGES = ["cold", "tamper", "full", "probe", "hostile"];
const PROD_STAGES = ["outbound", "guard"];

async function main() {
    if (!fs.existsSync(exePath))
        throw new Error(`no existe el paquete de producción: ${exePath} (construye antes con npm run dist:dir)`);
    const stages = process.argv[2] ? process.argv[2].split(",") : ALL_STAGES;
    for (const stage of stages) {
        if (!ALL_STAGES.includes(stage))
            throw new Error(`etapa desconocida: ${stage} (válidas: ${ALL_STAGES.join(",")})`);
    }

    // La guarda de frescura (pasada del banco, R-1), antes de
    // toda etapa. Dos sub-partidas de la misma disciplina: si
    // el paquete de banco no existe, este orquestador ya no
    // cae en silencio al de producción — la sustitución corre
    // solo por la salida nombrada y el resumen asienta el
    // sello del paquete que corrió en verdad —; y si el sello
    // de un paquete que las etapas pedidas ejercen no casa,
    // la corrida no corre: el resumen nace como «no corrida»
    // con la causa y la salida es distinta de cero.
    const allowStale = process.env["NIDO_BENCH_ALLOW_STALE"] === "1";
    const benchExists = fs.existsSync(benchExeCandidate);
    const benchNeeded = stages.some((s) => BENCH_STAGES.includes(s));
    const prodNeeded = stages.some((s) => PROD_STAGES.includes(s));
    const summaryPathEarly = path.join(outDir, "summary.json");
    const notRun = (cause, seal) => {
        fs.writeFileSync(summaryPathEarly, JSON.stringify(notRunRecord({cause, seal}), null, 2));
        console.error(`BENCH NO CORRIDA: ${cause}`);
        process.exit(3);
    };
    if (benchNeeded && !benchExists && !allowStale)
        notRun("el paquete de banco no existe (release-bench) y la corrida no nombró la salida NIDO_BENCH_ALLOW_STALE=1", null);
    const freshBench = benchNeeded && benchExists ? await checkFreshness(benchExeCandidate, repoDir) : null;
    if (freshBench && !freshBench.ok)
        notRun(freshBench.cause, freshBench.seal);
    const freshProd = prodNeeded || (benchNeeded && !benchExists) ? await checkFreshness(exePath, repoDir) : null;
    if (freshProd && !freshProd.ok)
        notRun(freshProd.cause, freshProd.seal);
    const stageSeal = (stage) => {
        if (BENCH_STAGES.includes(stage) && freshBench)
            return {exePath: benchExeCandidate, ...sealCitation(freshBench)};
        if (BENCH_STAGES.includes(stage))
            return {exePath, ...sealCitation(freshProd), substitution: "el paquete de banco no existía; la etapa corrió el de producción por la salida nombrada NIDO_BENCH_ALLOW_STALE=1"};
        return {exePath, ...sealCitation(freshProd)};
    };

    // El canario de S-FETCH: contenido azaroso por corrida, plantado
    // fuera del asar; la suite comprueba que no aparece en ningún
    // informe.
    fs.writeFileSync(canaryPath,
        `nido-canary-${crypto.randomBytes(24).toString("hex")}\n`);

    const {xvfb, display} = startXvfb();
    await sleep(1200);
    try {
        const summaryPath = path.join(outDir, "summary.json");
        const summary = fs.existsSync(summaryPath)
            ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
            : {};
        Object.assign(summary, {
            machine: "VM de la casa (Linux, ~8 GB RAM, CPU compartida, sin GPU)",
            harness: {
                display,
                electronDisableSandboxEnv: isRoot,
                reason: isRoot
                    ? "la VM ejecuta como root y Chromium no arranca como root con su sandbox de SO; la configuración empaquetada de la ventana no cambia"
                    : null
            },
            exePath,
            benchExePath,
            modelsDir,
            measuredAt: new Date().toISOString()
        });

        if (stages.includes("cold")) {
            console.log("· arranque en frío ×5 …");
            summary.coldStart = await coldStarts(display);
            console.log(`  mediana: ${Math.round(summary.coldStart.medianMs)} ms`);
        }

        if (stages.includes("tamper")) {
            console.log("· test de rechazo de D-1 (GGUF alterado en un byte) …");
            summary.tamperTest = await tamperRun(display);
            console.log(`  veredicto: ${summary.tamperTest.verdict}`);
        }

        if (stages.includes("full")) {
            console.log("· corrida completa (reposo → cargado → generando) …");
            const full = await fullRun(display);
            summary.states = full.samples;
            summary.answer = full.answer;
            summary.benchReport = full.report;
            for (const [label, sample] of Object.entries(full.samples)) {
                if (sample && !Array.isArray(sample) && sample.rssBytes != null)
                    console.log(`  ${label}: RSS ${(sample.rssBytes / 1048576).toFixed(0)} MiB · ` +
                        `sockets en escucha: ${sample.listeningSockets.length}`);
            }
            console.log(`  respuesta: ${full.answer.chars} caracteres, sha256 ${String(full.answer.sha256).slice(0, 12)}…`);
        }

        if (stages.includes("probe")) {
            console.log("· corrida de sondas de la carcasa (probe) …");
            summary.probeReport = await probeRun(display, false);
            console.log(`  fetch al canario bloqueado: ${summary.probeReport.fileFetch?.blocked}`);
        }

        if (stages.includes("hostile")) {
            console.log("· corrida hostil de entorno (S-DEVURL) …");
            summary.probeHostile = await probeRun(display, true);
            console.log(`  href cargado: ${summary.probeHostile.rendererProbes?.href}`);
        }

        if (stages.includes("outbound")) {
            console.log("· censo de red saliente (producción, strace) …");
            summary.outbound = await outboundCensus(display);
            console.log(`  destinos: ${summary.outbound.destinations.join(", ") || "(ninguno)"}`);
        }

        if (stages.includes("guard")) {
            console.log("· corrida de la guardia de arranque (D-7) …");
            summary.guard = await guardRun(display);
            console.log(`  salió sin ventana: ${summary.guard.exited}`);
        }

        // Tamaños de la hoja (paso 4).
        const releaseDir = path.join(appDir, "release");
        const appImages = fs.readdirSync(releaseDir).filter((name) => name.endsWith(".AppImage"));
        summary.sizes = {
            appImageBytes: appImages.length > 0
                ? fs.statSync(path.join(releaseDir, appImages[0])).size
                : null,
            appImageName: appImages[0] ?? null,
            installedDirBytes: Number(
                execFileSync("du", ["-sb", path.join(releaseDir, "linux-unpacked")],
                    {encoding: "utf8"}).split("\t")[0])
        };

        // El sello por etapa (pasada del banco, R-1): cada
        // etapa trae el sello del paquete contra el que se
        // midió, con su propia marca; ninguna fusión de
        // corridas sucesivas convive bajo el measuredAt del
        // resumen sin su marca por etapa. Y una corrida real
        // retira la marca de «no corrida» que una anterior
        // hubiera dejado en el resumen fundido.
        summary.stageSeals = {...(summary.stageSeals ?? {})};
        for (const stage of stages)
            summary.stageSeals[stage] = {measuredAt: new Date().toISOString(), ...stageSeal(stage)};
        delete summary.status;
        delete summary.cause;
        delete summary.buildSeal;

        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        console.log(`· resumen en ${summaryPath}`);
    } finally {
        xvfb.kill("SIGKILL");
    }
}

main().catch((err) => {
    console.error("BANCO FALLÓ:", err);
    process.exit(1);
});
