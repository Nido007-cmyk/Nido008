/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Orquestador de la prueba de persistencia de producción del
 * §8.9 (tanda 14, acto 6). Lanza el paquete-banco dos veces, como
 * dos procesos separados contra el MISMO directorio de datos (un
 * HOME temporal nuevo por corrida entera):
 *
 *   fase write  (NIDO_BENCH=persist-write):  crea la bóveda,
 *               escribe los ajustes por sus canales reales y
 *               sirve un turno que sella una conversación.
 *   fase verify (NIDO_BENCH=persist-verify): proceso nuevo: la
 *               bóveda nace bloqueada, se desbloquea y cada valor
 *               se relee por el bootstrap.
 *
 * Uso, en DOS pasos separados (no encadenar con &&): primero
 * `npm run dist:bench`, cuya salida puede terminar en el fallo
 * de verifyNativeBinaries DESPUÉS de producir el directorio
 * desempaquetado (el artefacto que esta prueba ejerce es el
 * directorio; el censo de binarios nativos tiene sede en E12), y
 * después `node scripts/persist.mjs`. El encadenado se
 * detendría en la construcción y nunca llegaría al orquestador.
 * El veredicto es la línea final (PERSIST PASS / PERSIST FAIL con
 * el censo de comprobaciones), y los informes por fase quedan en
 * bench-results/persist/ junto al censo de ficheros del
 * directorio de datos.
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
const outDir = path.join(appDir, "bench-results", "persist");
const PASSWORD = "sonda-persist-14";
const MARKER = "SONDA-PERSIST-14";
const PHASE_TIMEOUT_MS = 240_000;

fs.mkdirSync(outDir, {recursive: true});

function startXvfb() {
    const display = ":99";
    const xvfb = spawn("Xvfb", [display, "-screen", "0", "1440x900x24", "-nolisten", "tcp"], {
        stdio: "ignore"
    });
    return {xvfb, display};
}

function runPhase(phase, home, display) {
    const out = path.join(outDir, `report-${phase}.json`);
    const env = {
        ...process.env,
        HOME: home,
        DISPLAY: display,
        ELECTRON_DISABLE_SANDBOX: "1",
        NIDO_BENCH: `persist-${phase}`,
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
            reject(new Error(`fase ${phase}: timeout (${PHASE_TIMEOUT_MS} ms)\n${log.slice(-2000)}`));
        }, PHASE_TIMEOUT_MS);
        child.on("exit", (code) => {
            clearTimeout(timer);
            fs.writeFileSync(path.join(outDir, `run-${phase}.log`), log);
            if (!fs.existsSync(out))
                return reject(new Error(`fase ${phase}: sin informe (exit ${code})\n${log.slice(-2000)}`));
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
            else if (entry.name === "nido-prefs.json") hits.push(path.dirname(full));
        }
    };
    walk(home, 0);
    return hits[0] ?? null;
}

function census(dir, base, acc) {
    if (!dir || !fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) census(full, base, acc);
        else acc.push({path: path.relative(base, full), bytes: fs.statSync(full).size});
    }
    return acc;
}

const checks = [];
function check(name, ok, detail) {
    checks.push({name, ok: ok === true, detail});
}

async function main() {
    if (!fs.existsSync(exePath))
        throw new Error(`no existe el paquete-banco: ${exePath} (construye antes con npm run dist:bench)`);
    // La guarda de frescura (pasada del banco, R-1): si el
    // sello no casa, la sesión no corre y su registro nace
    // como «no corrida» con la causa, aquí y en la copia
    // durable.
    const fresh = await checkFreshness(exePath, repoDir);
    if (!fresh.ok) {
        const record = notRunRecord(fresh);
        fs.writeFileSync(path.join(outDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "persist");
        fs.mkdirSync(durableDir, {recursive: true});
        fs.writeFileSync(path.join(durableDir, "no-corrida.json"), JSON.stringify(record, null, 2));
        console.error(`PERSIST NO CORRIDA: ${fresh.cause}`);
        process.exit(3);
    }
    fs.writeFileSync(path.join(outDir, "session-seal.json"), JSON.stringify(sealCitation(fresh), null, 2));
    fs.rmSync(path.join(outDir, "no-corrida.json"), {force: true});
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nido-persist-home-"));
    const {xvfb, display} = startXvfb();
    try {
        await new Promise((r) => setTimeout(r, 1200));
        const write = await runPhase("write", home, display);
        const wb = write.bridge ?? {};
        check("write: la bóveda no existía al arrancar", wb.vaultExistedAtStart === false, wb.vaultExistedAtStart);
        check("write: crear la bóveda cobra", wb.createOk === true, wb.createOk);
        check("write: la creación deja la sesión desbloqueada (registro §8.9 vivo)", wb.unlockedAfterCreate === true, wb.unlockedAfterCreate);
        check("write: prefs-set cobra", wb.prefsSet === true, wb.prefsSet);
        check("write: settings-set cobra (personalidad, instrucciones, memoria)", wb.personalitySet === true && wb.customSet === true && wb.memorySet === true,
            {p: wb.personalitySet, c: wb.customSet, m: wb.memorySet});
        check("write: el bloqueo explícito cobra y la escritura sellada falla cerrada", wb.lockedAfterExplicitLock === true && wb.sealedWriteWhileLocked === false,
            {locked: wb.lockedAfterExplicitLock, sealedWrite: wb.sealedWriteWhileLocked});
        check("write: el redesbloqueo tras el bloqueo cobra y repone el registro", wb.unlockAfterLock === true && wb.unlockedAfterRelock === true,
            {unlock: wb.unlockAfterLock, unlocked: wb.unlockedAfterRelock});
        check("write: el turno de la tabla fija se sirve y sella la conversación", wb.turnOk === true && wb.probeTurns >= 2 && wb.assistantChars > 0,
            {turnOk: wb.turnOk, route: wb.turnRoute, turns: wb.probeTurns, chars: wb.assistantChars});
        check("write: la base cifrada abre con la clave registrada (E2-11)", write.db?.opened === true, write.db);

        const verify = await runPhase("verify", home, display);
        const vb = verify.bridge ?? {};
        check("verify: la bóveda existe y nace bloqueada en el proceso nuevo", vb.vaultExists === true && vb.lockedAtStart === true,
            {exists: vb.vaultExists, locked: vb.lockedAtStart});
        check("verify: la base se niega a abrir antes de desbloquear (falla cerrada)", verify.dbBeforeUnlock?.opened === false, verify.dbBeforeUnlock);
        check("verify: la contraseña equivocada se rechaza y la bóveda sigue bloqueada", vb.wrongPasswordOk === false && vb.lockedAfterWrongPassword === true,
            {wrongOk: vb.wrongPasswordOk, locked: vb.lockedAfterWrongPassword});
        check("verify: el desbloqueo cobra con la misma contraseña", vb.unlockOk === true, vb.unlockOk);
        check("verify: el idioma persiste y se cobra en la superficie (A-1; la sonda escribe «pt», distinto del entorno, para que el pisotón sea visible)", vb.lang === "pt", vb.lang);
        check("verify: el tema persiste", vb.theme === "night", vb.theme);
        check("verify: la personalidad persiste en el almacén sellado", vb.personality === "detailed", vb.personality);
        check("verify: las instrucciones propias persisten", vb.custom === MARKER, vb.custom);
        check("verify: el ajuste de memoria persiste (resumen automático apagado)", vb.autoSummarize === false, vb.autoSummarize);
        check("verify: la conversación sellada se relee con sus conteos (DC-1: presencia y conteos, no igualdad de texto)", vb.conversations >= 1 && vb.probeTurns >= 2 && vb.assistantChars > 0,
            {convs: vb.conversations, turns: vb.probeTurns, chars: vb.assistantChars});
        check("verify: la base cifrada reabre con la clave de la sesión nueva (E2-11)", verify.db?.opened === true, verify.db);

        const userData = findUserData(home);
        const files = census(userData, userData, []);
        fs.writeFileSync(path.join(outDir, "user-data-census.json"),
            JSON.stringify({userData, files}, null, 2));
        check("censo: el directorio de datos trae bóveda, almacén y base",
            files.some((f) => f.path.startsWith("vault")) &&
            files.some((f) => f.path.startsWith("store")) &&
            files.some((f) => f.path.startsWith("knowledge")),
            files.map((f) => f.path));
        // La copia durable de la evidencia (la forma de cierre del
        // diseño de la prueba): los informes viven sin versionar en
        // bench-results/ y una limpieza los perdería; la copia de
        // la casa vive en turno14-prep/registros/persist/.
        const durableDir = path.join(appDir, "..", "..", "turno14-prep", "registros", "persist");
        fs.mkdirSync(durableDir, {recursive: true});
        fs.writeFileSync(path.join(outDir, "persist-checks.json"), JSON.stringify(checks, null, 2));
        for (const name of ["report-write.json", "report-verify.json", "run-write.log", "run-verify.log", "user-data-census.json", "persist-checks.json", "session-seal.json"])
            fs.copyFileSync(path.join(outDir, name), path.join(durableDir, name));
    } finally {
        xvfb.kill("SIGKILL");
    }
    const failed = checks.filter((c) => !c.ok);
    for (const c of checks)
        console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name} :: ${JSON.stringify(c.detail)}`);
    console.log(failed.length === 0
        ? `PERSIST PASS (${checks.length}/${checks.length})`
        : `PERSIST FAIL (${checks.length - failed.length}/${checks.length})`);
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(String(err));
    console.log("PERSIST FAIL (error del orquestador)");
    process.exit(1);
});
