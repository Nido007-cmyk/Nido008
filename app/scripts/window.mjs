/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Orquestador de los cobros de ventana de VENTANA-LINUX-T14 §4.2
 * sobre el paquete-banco (tanda 14, acto 6): registros 4 (la
 * primera ventana), 5 (el mínimo como conducta), 2 (el título
 * vivo, pre-corrida: su firma es de la pasada) y 6 (la
 * restauración en su ciclo entero, con sus dos caídas). El 1 es
 * de papel, el 3 y el 8 van por código en la suite de
 * endurecimiento y por captura en la pasada, y el 7 va sobre el
 * paquete de producción con scripts/instance.mjs.
 *
 * Uso, en dos pasos separados como el de persistencia: primero
 * `npm run dist:bench` y después `node scripts/window.mjs`.
 * El veredicto es la línea final (WINDOW PASS / WINDOW FAIL).
 * La mitad de posición de las caídas («centrada») no la puede dar
 * esta máquina (bajo el Xvfb desnudo coloca el servidor, no un
 * gestor): las caídas se cobran en tamaño, supervivencia y
 * ausencia de diálogo, y la posición queda declarada como límite
 * del banco en el asiento, no pasada en silencio.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {checkFreshness, notRunRecord, sealCitation} from "./buildSeal.mjs";

const appDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoDir = path.resolve(appDir, "..");
const exePath = path.join(appDir, "release-bench", "linux-unpacked", "nido-pc");
const outDir = path.join(appDir, "bench-results", "window");
const PASSWORD = "sonda-ventana-14";
const PHASE_TIMEOUT_MS = 180_000;

fs.mkdirSync(outDir, {recursive: true});

function startXvfb() {
    const display = ":96";
    const xvfb = spawn("Xvfb", [display, "-screen", "0", "1440x900x24", "-nolisten", "tcp"], {
        stdio: "ignore"
    });
    return {xvfb, display};
}

function runPhase(phase, home, display, tag) {
    const out = path.join(outDir, `report-${tag}.json`);
    const env = {
        ...process.env,
        HOME: home,
        DISPLAY: display,
        ELECTRON_DISABLE_SANDBOX: "1",
        NIDO_BENCH: "window",
        NIDO_WINDOW_PHASE: phase,
        NIDO_BENCH_OUT: out,
        NIDO_PERSIST_PASSWORD: PASSWORD
    };
    return new Promise((resolve, reject) => {
        const child = spawn(exePath, [], {env, stdio: ["ignore", "pipe", "pipe"]});
        let log = "";
        child.stdout.on("data", (c) => { log += c.toString(); });
        child.stderr.on("data", (c) => { log += c.toString(); });
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`fase ${tag}: timeout (${PHASE_TIMEOUT_MS} ms)\n${log.slice(-2000)}`));
        }, PHASE_TIMEOUT_MS);
        child.on("exit", (code) => {
            clearTimeout(timer);
            fs.writeFileSync(path.join(outDir, `run-${tag}.log`), log);
            if (!fs.existsSync(out))
                return reject(new Error(`fase ${tag}: sin informe (exit ${code})\n${log.slice(-2000)}`));
            resolve(JSON.parse(fs.readFileSync(out, "utf8")));
        });
    });
}

function findUserData(home) {
    const hits = [];
    const walk = (dir, depth) => {
        if (depth > 5 || !fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, depth + 1);
            else if (entry.name === "nido-prefs.json" || entry.name === "window-state.json") hits.push(path.dirname(full));
        }
    };
    walk(home, 0);
    return hits[0] ?? null;
}

const checks = [];
function check(name, ok, detail) {
    checks.push({name, ok: ok === true, detail});
}

async function main() {
    if (!fs.existsSync(exePath))
        throw new Error(`no existe el paquete-banco: ${exePath} (construye antes con npm run dist:bench, en un paso separado)`);
    // La guarda de frescura (pasada del banco, R-1): si el
    // sello no casa, la sesión no corre y su registro nace
    // como «no corrida» con la causa, aquí y en la copia
    // durable.
    const fresh = await checkFreshness(exePath, repoDir);
    if (!fresh.ok) {
        const record = notRunRecord(fresh);
        fs.writeFileSync(path.join(outDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "window");
        fs.mkdirSync(durableDir, {recursive: true});
        fs.writeFileSync(path.join(durableDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        console.error(`WINDOW NO CORRIDA: ${fresh.cause}`);
        process.exit(3);
    }
    fs.writeFileSync(path.join(outDir, "session-seal.json"), JSON.stringify(sealCitation(fresh), null, 2));
    fs.rmSync(path.join(outDir, "no-corrida.json"), {force: true});
    const {xvfb, display} = startXvfb();
    try {
        await new Promise((r) => setTimeout(r, 1200));

        // Registros 4 y 5: un lanzamiento, HOME nuevo.
        const homeA = fs.mkdtempSync(path.join(os.tmpdir(), "nido-window-a-"));
        const a = await runPhase("read-shrink", homeA, display, "read-shrink");
        check("R4: la primera ventana nace en 1200×800 sin acotar en la pantalla de 1440×900",
            a.boundsAtSettle?.width === 1200 && a.boundsAtSettle?.height === 800,
            {bounds: a.boundsAtSettle, display: a.displaySize});
        check("R5: el intento de encoger a 320×200 se detiene en el mínimo 640×480 (I-06)",
            a.boundsAfterShrink?.width === 640 && a.boundsAfterShrink?.height === 480,
            a.boundsAfterShrink);

        // Registro 2 (pre-corrida): el título en sus estados.
        const homeB = fs.mkdtempSync(path.join(os.tmpdir(), "nido-window-b-"));
        const b = await runPhase("title", homeB, display, "title");
        check("R2 (pre-corrida): el título es «NIDO PC» en la puerta, con la sesión abierta, en noche, con conversación abierta y de vuelta en día",
            [b.titleAtSettle, b.titleAfterUnlock, b.titleNight, b.titleWithConversation, b.titleDaylight].every((t) => t === "NIDO PC"),
            {settle: b.titleAtSettle, unlock: b.titleAfterUnlock, night: b.titleNight, conv: b.titleWithConversation, day: b.titleDaylight});

        // Registro 6: el ciclo entero en su propio HOME.
        const homeC = fs.mkdtempSync(path.join(os.tmpdir(), "nido-window-c-"));
        await runPhase("settle-bounds", homeC, display, "settle-bounds");
        const userData = findUserData(homeC);
        const statePath = userData ? path.join(userData, "window-state.json") : null;
        const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
        check("R6: el fichero de estado trae exactamente las cinco claves de la enumeración cerrada",
            state !== null && JSON.stringify(Object.keys(state).sort()) === JSON.stringify(["height", "maximized", "width", "x", "y"]),
            state);
        check("R6: el estado guardado al cerrar es el dejado por el arnés (60, 50, 900×640, sin maximizar)",
            state?.x === 60 && state?.y === 50 && state?.width === 900 && state?.height === 640 && state?.maximized === false,
            state);
        const c2 = await runPhase("read-bounds", homeC, display, "restore");
        check("R6: al relanzar, los límites vuelven a los dejados",
            c2.boundsAtSettle?.x === 60 && c2.boundsAtSettle?.y === 50 && c2.boundsAtSettle?.width === 900 && c2.boundsAtSettle?.height === 640,
            c2.boundsAtSettle);
        if (statePath) fs.writeFileSync(statePath, "basura-no-json{{{");
        const c3 = await runPhase("read-bounds", homeC, display, "fall-corrupt");
        check("R6 caída (corrupto): la app abre viva en el tamaño de primer arranque, sin diálogo ni muerte (la posición centrada no se cobra en esta máquina)",
            c3.boundsAtSettle?.width === 1200 && c3.boundsAtSettle?.height === 800,
            c3.boundsAtSettle);
        if (statePath) fs.writeFileSync(statePath, JSON.stringify({x: 9000, y: 9000, width: 900, height: 640, maximized: false}));
        const c4 = await runPhase("read-bounds", homeC, display, "fall-offscreen");
        check("R6 caída (fuera de pantalla): la app abre viva en el tamaño de primer arranque, sin diálogo ni muerte (la posición centrada no se cobra en esta máquina)",
            c4.boundsAtSettle?.width === 1200 && c4.boundsAtSettle?.height === 800,
            c4.boundsAtSettle);

        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "window");
        fs.mkdirSync(durableDir, {recursive: true});
        for (const name of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, name), path.join(durableDir, name));
        fs.writeFileSync(path.join(durableDir, "window-checks.json"), JSON.stringify(checks, null, 2));
    } finally {
        xvfb.kill("SIGKILL");
    }
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks)
        console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name} :: ${JSON.stringify(c.detail)}`);
    console.log(failed.length === 0
        ? `WINDOW PASS (${checks.length}/${checks.length})`
        : `WINDOW FAIL (${checks.length - failed.length}/${checks.length})`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(String(err));
    console.log("WINDOW FAIL (error del orquestador)");
    process.exit(1);
});
