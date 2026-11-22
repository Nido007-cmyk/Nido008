/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Orquestador del registro 7 de VENTANA-LINUX-T14 §4.2 (tanda 14,
 * acto 6): la instancia única y el cierre, por conducta, a nivel
 * de sistema operativo, sobre el PAQUETE DE PRODUCCIÓN
 * (dist:dir). El paquete-banco no puede cobrar este registro: su
 * entrada arranca la carcasa sin la bandera singleInstance que la
 * de producción sí pasa (dirimido en el diseño de la prueba de
 * persistencia).
 *
 * La vía compuesta (PREP-VENTANA-14 §9): un Xvfb propio, UN HOME
 * temporal compartido por los dos lanzamientos (con dos HOME el
 * verde sería falso: el cerrojo vive atado al directorio de
 * datos), el segundo lanzamiento sin ningún interruptor (nada de
 * depuración remota: la guardia D-7 lo haría salir con otra
 * firma), censo de procesos por la ruta del ejecutable, y el
 * cliente X mínimo de la casa (scripts/ventanax.c, compilado en
 * cada corrida) para enumerar las ventanas, leer el foco y cerrar
 * la ventana por su protocolo WM_DELETE_WINDOW: el gesto de un
 * gestor, no una muerte del proceso.
 *
 * Uso, en dos pasos separados: primero `npm run dist:dir` (si su
 * salida termina en el fallo de verifyNativeBinaries tras
 * producir el directorio, el artefacto es el directorio; un
 * directorio ausente o incompleto invalida la corrida) y después
 * `node scripts/instance.mjs`. Veredicto: la línea final
 * (INSTANCE PASS / INSTANCE FAIL).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {checkFreshness, notRunRecord, sealCitation} from "./buildSeal.mjs";

const appDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoDir = path.resolve(appDir, "..");
const exePath = path.join(appDir, "release", "linux-unpacked", "nido-pc");
const outDir = path.join(appDir, "bench-results", "instance");
const ventanaxSrc = path.join(appDir, "scripts", "ventanax.c");
const ventanaxBin = path.join(outDir, "ventanax");
const DISPLAY = ":95";

fs.mkdirSync(outDir, {recursive: true});

const checks = [];
function check(name, ok, detail) {
    checks.push({name, ok: ok === true, detail});
}

function appProcesses() {
    const out = execFileSync("ps", ["-eo", "pid,ppid,args"], {encoding: "utf8"});
    const procs = [];
    for (const line of out.split("\n").slice(1)) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (m && m[3].includes(exePath)) procs.push({pid: Number(m[1]), ppid: Number(m[2]), args: m[3]});
    }
    const pids = new Set(procs.map((p) => p.pid));
    const mains = procs.filter((p) => !pids.has(p.ppid));
    return {procs, mains};
}

function xList(env) {
    const out = execFileSync(ventanaxBin, ["list"], {env, encoding: "utf8"});
    const focus = out.match(/foco=0x([0-9a-f]+)/)?.[1] ?? null;
    const windows = [...out.matchAll(/win=0x([0-9a-f]+) id=\d+ nombre="([^"]*)"/g)]
        .map((m) => ({id: m[1], name: m[2]}));
    return {focus, windows, raw: out};
}

async function waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    for (;;) {
        const value = fn();
        if (value) return value;
        if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${label}`);
        await new Promise((r) => setTimeout(r, 700));
    }
}

async function main() {
    if (!fs.existsSync(exePath))
        throw new Error(`no existe el paquete de producción: ${exePath} (construye antes con npm run dist:dir, en un paso separado)`);
    // La guarda de frescura (pasada del banco, R-1) sobre el
    // paquete de producción, que es el que este registro
    // ejerce: si el sello no casa, la sesión no corre y su
    // registro nace como «no corrida» con la causa, aquí y
    // en la copia durable.
    const fresh = await checkFreshness(exePath, repoDir);
    if (!fresh.ok) {
        const record = notRunRecord(fresh);
        fs.writeFileSync(path.join(outDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "instance");
        fs.mkdirSync(durableDir, {recursive: true});
        fs.writeFileSync(path.join(durableDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        console.error(`INSTANCE NO CORRIDA: ${fresh.cause}`);
        process.exit(3);
    }
    fs.writeFileSync(path.join(outDir, "session-seal.json"), JSON.stringify(sealCitation(fresh), null, 2));
    fs.rmSync(path.join(outDir, "no-corrida.json"), {force: true});
    execFileSync("gcc", ["-O2", "-Wall", "-Wextra", "-o", ventanaxBin, ventanaxSrc, "-lX11"], {stdio: "inherit"});

    const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1440x900x24", "-nolisten", "tcp"], {stdio: "ignore"});
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nido-instance-home-"));
    const env = {...process.env, HOME: home, DISPLAY, ELECTRON_DISABLE_SANDBOX: "1"};
    const logs = [];
    try {
        await new Promise((r) => setTimeout(r, 1200));
        check("R7: antes del primer lanzamiento no hay ningún proceso de la app", appProcesses().mains.length === 0, appProcesses().mains.length);

        const first = spawn(exePath, [], {env, stdio: ["ignore", "pipe", "pipe"]});
        first.stdout.on("data", (c) => logs.push(`[1] ${c}`));
        first.stderr.on("data", (c) => logs.push(`[1] ${c}`));
        const win1 = await waitFor(() => xList(env).windows.find((w) => w.name === "NIDO PC"), 90_000, "la ventana de la app");
        const census1 = appProcesses();
        check("R7: el primer lanzamiento deja un solo proceso principal y una sola ventana",
            census1.mains.length === 1, {mains: census1.mains.map((p) => p.pid), win: win1});
        const mainPid = census1.mains[0]?.pid;

        const second = spawn(exePath, [], {env, stdio: ["ignore", "pipe", "pipe"]});
        second.stdout.on("data", (c) => logs.push(`[2] ${c}`));
        second.stderr.on("data", (c) => logs.push(`[2] ${c}`));
        const secondExit = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 60_000);
            second.on("exit", (code, signal) => { clearTimeout(timer); resolve({code, signal}); });
        });
        check("R7: el segundo lanzamiento termina por sí solo, sin interruptores", secondExit !== null, secondExit);
        await new Promise((r) => setTimeout(r, 1000));
        const census2 = appProcesses();
        const list2 = xList(env);
        const appWindows = list2.windows.filter((w) => w.name === "NIDO PC");
        check("R7: tras el segundo lanzamiento sigue habiendo un solo proceso principal, el primero intacto, y una sola ventana",
            census2.mains.length === 1 && census2.mains[0]?.pid === mainPid && appWindows.length === 1,
            {mains: census2.mains.map((p) => p.pid), windows: appWindows});
        check("R7: la ventana existente queda enfocada tras el segundo lanzamiento (la mitad de enfocar de D-L7, leída en el servidor)",
            list2.focus !== null && appWindows.length === 1 && list2.focus === appWindows[0].id,
            {focus: list2.focus, win: appWindows[0]?.id});

        execFileSync(ventanaxBin, ["close", `0x${appWindows[0].id}`], {env, stdio: "inherit"});
        const firstExit = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 30_000);
            first.on("exit", (code, signal) => { clearTimeout(timer); resolve({code, signal}); });
        });
        check("R7: cerrar la única ventana por su protocolo termina el proceso (sin matarlo)",
            firstExit !== null, firstExit);
        await new Promise((r) => setTimeout(r, 800));
        check("R7: tras el cierre no queda ningún proceso de la app", appProcesses().mains.length === 0, appProcesses().mains.length);
    } finally {
        fs.writeFileSync(path.join(outDir, "instance.log"), logs.join(""));
        xvfb.kill("SIGKILL");
        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "instance");
        fs.mkdirSync(durableDir, {recursive: true});
        fs.writeFileSync(path.join(durableDir, "instance-checks.json"), JSON.stringify(checks, null, 2));
        fs.copyFileSync(path.join(outDir, "instance.log"), path.join(durableDir, "instance.log"));
        if (fs.existsSync(path.join(outDir, "session-seal.json")))
            fs.copyFileSync(path.join(outDir, "session-seal.json"), path.join(durableDir, "session-seal.json"));
    }
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks)
        console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name} :: ${JSON.stringify(c.detail)}`);
    console.log(failed.length === 0
        ? `INSTANCE PASS (${checks.length}/${checks.length})`
        : `INSTANCE FAIL (${checks.length - failed.length}/${checks.length})`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(String(err));
    console.log("INSTANCE FAIL (error del orquestador)");
    process.exit(1);
});
