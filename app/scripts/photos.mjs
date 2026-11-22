// Orquestador de la sesión de fotos y del arranque medido
// (tanda 14, actos 7 y 8). Lanza el paquete-banco (modos capture
// y boot del banco) bajo Xvfb propio a 1500×1000 (la pantalla es
// andamiaje: lo que la hoja mide es la ventana, fijada y leída
// a 1440×900 y a 1024×900; con la pantalla a 1440×900 la ventana
// leía 1439×899 por tocar el borde, cobrado por la sonda), en el orden
// enmendado de la hoja y en la forma B de la cura del
// instrumento: un HOME por fase para la cadena limpia (la copia
// truncada nace y muere en el HOME de la fase del error; el
// fichero genuino solo se lee y nunca se escribe; la sustitución
// de la restauración va declarada en la enmienda de la hoja) y
// el principal fundido en una sola fase con una sola
// conversación (bienvenida y pulsación, turno, fotos 1 a 4 en
// cadena y la pastilla en la misma conversación).
//
// Fases: nomodel (5.2), error (5.3), welcome (5.1) y principal
// (1, 2, 3, 4 y 6). Al cerrar escribe INDICE.md desde el disco
// y los informes de fase: cada foto presente con su huella
// sha256 y su tamaño leído (sizeLog del informe), cada ausente
// como AUSENTE con su causa, y las tomas de sesiones anteriores
// en su propia sección. Los gguf se siembran por enlace (el
// motor solo los lee y la huella se calcula sobre el
// contenido); el corpus se copia, porque su base se abre en
// escritura y el sitio firmado de J-10 no se toca a través de
// un enlace. Los dos pasos de construcción (build:vite y
// dist:bench) se lanzan POR SEPARADO antes, nunca encadenados
// tras el exit 1 conocido de verifyNativeBinaries.
import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {checkFreshness, notRunRecord, sealCitation} from "./buildSeal.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(appDir, "..");
const exePath = path.join(appDir, "release-bench", "linux-unpacked", "nido-pc");
const fotosDir = process.env["NIDO_FOTOS_DIR"] ?? path.join(repoDir, "fotos", "tanda14");
const PASSWORD = process.env["NIDO_PERSIST_PASSWORD"] ?? "";
const DISPLAY = ":95";
const MODEL_SRC = path.join(repoDir, "models", "qwen3-0.6b-q4km.gguf");
// La principal siembra los cuatro modelos del repo por enlace: la
// escalera nombra al residente de la sesión (enmienda §2.3 de la
// hoja) y la fase lo carga por el canal; el modelo del rol de
// generación (el 1.5B a esta foto) queda presente para su paso.
const PRINCIPAL_MODELS = [
    "qwen3-0.6b-q4km.gguf",
    "qwen2.5-1.5b-instruct-q4km.gguf",
    "qwen3-1.7b-q4km.gguf",
    "qwen3-4b-instruct-2507-q4km.gguf",
];
const E5_SRC = process.env.NIDO_E5_SRC ?? "multilingual-e5-small-q8_0.gguf";
const CORPUS_SRC = process.env.NIDO_CORPUS_SRC ?? "corpus";

fs.mkdirSync(fotosDir, {recursive: true});

function seedHome(kind) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `nido-foto-${kind}-`));
    const userData = path.join(home, ".config", "nido-pc");
    const models = path.join(userData, "models");
    if (kind === "nomodel") return home;
    fs.mkdirSync(models, {recursive: true});
    if (kind === "error") {
        fs.writeFileSync(path.join(models, "qwen3-0.6b-q4km.gguf"), fs.readFileSync(MODEL_SRC).subarray(0, 1024 * 1024));
        return home;
    }
    if (kind === "principal") {
        for (const m of PRINCIPAL_MODELS) fs.symlinkSync(path.join(repoDir, "models", m), path.join(models, m));
    } else {
        fs.symlinkSync(MODEL_SRC, path.join(models, "qwen3-0.6b-q4km.gguf"));
    }
    if (kind === "principal") {
        fs.symlinkSync(E5_SRC, path.join(models, "multilingual-e5-small-q8_0.gguf"));
        const corpus = path.join(userData, "store", "packs", "corpus");
        fs.mkdirSync(corpus, {recursive: true});
        for (const name of ["nido-esencial-e5.sqlite", "imported-packs.json", "pack-install-records.json"])
            fs.copyFileSync(path.join(CORPUS_SRC, name), path.join(corpus, name));
    }
    return home;
}

function runBench(mode, extraEnv, home, tag, timeoutMs = 15 * 60 * 1000) {
    return new Promise((resolve) => {
        const outPath = path.join(fotosDir, `report-${tag}.json`);
        const t0 = Date.now();
        const child = spawn(exePath, [], {
            cwd: appDir,
            env: {
                ...process.env,
                HOME: home,
                DISPLAY,
                ELECTRON_DISABLE_SANDBOX: "1",
                NIDO_BENCH: mode,
                NIDO_PERSIST_PASSWORD: PASSWORD,
                NIDO_BENCH_OUT: outPath,
                NIDO_BOOT_T0: String(t0),
                ...extraEnv,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let log = "";
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.on("close", (code) => {
            clearTimeout(killer);
            fs.writeFileSync(path.join(fotosDir, `run-${tag}.log`), log);
            let report = null;
            try {
                report = JSON.parse(fs.readFileSync(outPath, "utf8"));
            } catch { /* el informe ausente también es dato */ }
            resolve({code, report, wallMs: Date.now() - t0});
        });
    });
}

function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// El guion de la hoja (§0.6), en su orden: nombre, envío, tema y
// fase que lo captura.
const GUION = [
    ["foto-52-sin-modelo.png", "5.2", "Daylight", "nomodel"],
    ["foto-53-error-carga.png", "5.3", "Daylight", "error"],
    ["foto-51-bienvenida.png", "5.1", "Daylight", "welcome"],
    ["foto-1-conversacion-daylight.png", "1", "Daylight", "principal"],
    ["foto-2-conversacion-night-garden.png", "2", "Night Garden", "principal"],
    ["foto-3-panel-fuentes.png", "3", "Daylight", "principal"],
    ["foto-4-regimen-medio.png", "4", "Daylight", "principal"],
    ["foto-6-pastilla-emergencia.png", "6", "Daylight", "principal"],
];

function writeIndice(summary) {
    const seal = summary.buildSeal;
    const lines = [
        "# INDICE · Fotos de la tanda 14",
        "",
        `Sello del paquete capturado: ${seal ? `${seal.head} · construido ${seal.builtAt} · huella del asar ${String(seal.asarSha256).slice(0, 16)}…` : "sin sello"} · Cierre de la sesión: ${new Date().toISOString()}`,
        "Origen: paquete-banco servido por nido://app/, carpeta fotos/tanda14/.",
        `Sesión: ${Object.entries(summary.runs).map(([k, v]) => `${k} (código ${v.code})`).join(" · ")}`,
        "Veredicto de cada envío: pendiente del ojo del dueño.",
        "",
        "| Envío | Fichero | sha256 | Tamaño leído | Tema | Estado |",
        "|---|---|---|---|---|---|",
    ];
    const sessionFiles = new Set();
    for (const [name, envio, tema, phase] of GUION) {
        const capture = summary.runs[phase]?.capture ?? null;
        const written = (capture?.snaps ?? []).find((s) => s === name || s.startsWith(name.replace(/\.png$/, "") + "-t"));
        if (written && fs.existsSync(path.join(fotosDir, written))) {
            sessionFiles.add(written);
            const size = capture?.sizeLog?.[name];
            // §4.1 de la cura: la 5.2 y la 5.3 pasaron su punto en la
            // sesión anterior y no se sustituyen; su captura en esta
            // sesión es registro de la sesión, no toma del juego.
            const estado = (envio === "5.2" || envio === "5.3") && written !== name
                ? "registro de sesión · la toma vigente pasó su punto en la sesión anterior y no se sustituye"
                : "capturada";
            lines.push(`| ${envio} | ${written} | ${sha256(path.join(fotosDir, written))} | ${size ? `${size.width}×${size.height} leídos` : "sin lectura"} | ${tema} | ${estado} |`);
            continue;
        }
        const notCharged = (capture?.notCharged ?? []).find((n) => n.name === name);
        const read = capture?.[name.startsWith("foto-4") ? "sizeRead-1024x900" : "sizeRead-1440x900"];
        const readNote = read ? ` · lectura de la ventana: ${read.width}×${read.height}` : "";
        const cause = notCharged ? `no cobrada: ${notCharged.cause}` : capture?.error ? `error de la fase: ${capture.error}` : capture === null ? "la fase no produjo informe" : "la fase no la capturó";
        lines.push(`| ${envio} | ${name} | — | — | ${tema} | AUSENTE · ${cause}${readNote} |`);
    }
    const anteriores = fs.readdirSync(fotosDir).filter((f) => f.endsWith(".png") && !sessionFiles.has(f)).sort();
    if (anteriores.length) {
        lines.push("", "## Tomas anteriores en la carpeta", "", "| Fichero | sha256 | Nota |", "|---|---|---|");
        for (const f of anteriores) lines.push(`| ${f} | ${sha256(path.join(fotosDir, f))} | sin informe de fase en esta sesión |`);
    }
    lines.push("");
    fs.writeFileSync(path.join(fotosDir, "INDICE.md"), lines.join("\n"));
}

async function main() {
    if (!PASSWORD) {
        console.error("PHOTOS-ABORT sin NIDO_PERSIST_PASSWORD");
        process.exit(2);
    }
    // La guarda de frescura (pasada del banco, R-1): la
    // comparación del sello contra el paquete y contra el
    // árbol, antes de toda fase. Si no casa, la sesión no
    // corre: su registro nace como «no corrida» con la causa
    // en una línea y la salida es distinta de cero. Con la
    // salida nombrada (NIDO_BENCH_ALLOW_STALE=1) corre sobre
    // el rezagado y el registro cita ese nombre.
    const fresh = await checkFreshness(exePath, repoDir);
    if (!fresh.ok) {
        fs.writeFileSync(path.join(fotosDir, "sesion.json"), JSON.stringify({startedAt: new Date().toISOString(), ...notRunRecord(fresh)}, null, 2));
        console.error(`PHOTOS NO CORRIDA: ${fresh.cause}`);
        process.exit(3);
    }
    const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1500x1000x24"], {stdio: "ignore"});
    await new Promise((r) => setTimeout(r, 1500));
    const summary = {startedAt: new Date().toISOString(), buildSeal: sealCitation(fresh), runs: {}, boot: []};
    // La forma de la siembra, asentada en el registro (la casa la
    // cobra como precisa la de los modelos): modelos y e5 por
    // enlace simbólico a su fichero genuino (el motor solo lee);
    // el corpus por copia íntegra desde el sitio firmado de J-10
    // (su base se abre en escritura y el sitio no se toca); la
    // fase del error siembra una copia truncada a 1 MiB del 0.6B.
    summary.seedForm = {
        models: "enlace simbólico al fichero del repo",
        principalModels: PRINCIPAL_MODELS,
        embeddings: "enlace simbólico al fichero genuino de la casa de pruebas e5",
        corpus: "copia íntegra desde el corpus local de desarrollo (nido-esencial-e5.sqlite, imported-packs.json, pack-install-records.json)",
        errorPhase: "copia truncada a 1 MiB de qwen3-0.6b-q4km.gguf",
    };
    const solo = process.env.FOTOS_SOLO || null;
    try {
        for (const phase of ["nomodel", "error", "welcome", "principal"]) {
            if (solo && phase !== solo) continue;
            const home = seedHome(phase);
            const r = await runBench("capture", {NIDO_CAPTURE_PHASE: phase, NIDO_CAPTURE_DIR: fotosDir}, home, phase, 25 * 60 * 1000);
            summary.runs[phase] = {code: r.code, wallMs: r.wallMs, capture: r.report?.capture ?? null};
            console.log(`PHASE ${phase} code=${r.code} snaps=${(r.report?.capture?.snaps ?? []).join(",")} notCharged=${JSON.stringify(r.report?.capture?.notCharged ?? [])}`);
            fs.rmSync(home, {recursive: true, force: true});
        }
        for (let i = 1; !solo && i <= 5; i++) {
            const home = seedHome("welcome");
            const r = await runBench("boot", {}, home, `boot-${i}`, 5 * 60 * 1000);
            const rep = r.report;
            // La validez para la mediana es llegada (pasada del
            // banco, R-2, con los campos de R-3): entra solo la
            // corrida con composerFound y welcomeFound; una que
            // diga composer sin bienvenida es incoherente y entra
            // como fallida con esa causa asentada, no en la
            // mediana. Cada fallida trae su causa, aquí y en su
            // informe.
            const arrived = rep?.composerFound === true && rep?.welcomeFound === true;
            const cause = arrived
                ? null
                : !rep
                    ? "sin informe"
                    : rep.error
                        ? String(rep.error)
                        : rep.composerFound === true
                            ? "composer sin bienvenida: la corrida es incoherente y entra como fallida, no en la mediana"
                            : rep.welcomeFound !== true
                                ? "la bienvenida no se encontró dentro de su plazo"
                                : "el composer no se encontró dentro de su plazo";
            summary.boot.push({i, code: r.code, vaultCrossing: rep?.vaultCrossing ?? null, tSettleMs: rep?.tSettleMs ?? null, tGateMs: rep?.tGateMs ?? null, tVaultCreateMs: rep?.tVaultCreateMs ?? null, welcomeFound: rep?.welcomeFound ?? null, tWelcomeMs: rep?.tWelcomeMs ?? null, tComposerMs: rep?.tComposerMs ?? null, composerFound: rep?.composerFound ?? null, arrived, cause});
            console.log(`BOOT ${i} tComposerMs=${rep?.tComposerMs} llegada=${arrived}${cause ? ` causa=${cause}` : ""}`);
            fs.rmSync(home, {recursive: true, force: true});
        }
        // La cuenta entera: lanzadas = llegadas + fallidas.
        // bootMedianMs se calcula solo sobre las llegadas y
        // queda AUSENTE (no cero, no la mediana de las esperas)
        // si no alcanzan las 5 que M-4a pide: el registro cobra
        // NO MEDIDA con la cuenta.
        const arrivedTimes = summary.boot.filter((b) => b.arrived).map((b) => b.tComposerMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
        summary.bootArrivedCount = summary.boot.filter((b) => b.arrived).length;
        summary.bootFailedCount = summary.boot.length - summary.bootArrivedCount;
        summary.bootFailures = summary.boot.filter((b) => !b.arrived).map((b) => ({i: b.i, cause: b.cause}));
        if (arrivedTimes.length >= 5)
            summary.bootMedianMs = arrivedTimes[Math.floor(arrivedTimes.length / 2)];
    } finally {
        summary.finishedAt = new Date().toISOString();
        if (solo) {
            // La sonda por fase no pisa ni la sesión ni el índice del
            // juego: deja su propio informe y las tomas con su sufijo.
            fs.writeFileSync(path.join(fotosDir, `sesion-solo-${solo}.json`), JSON.stringify(summary, null, 2));
        } else {
            fs.writeFileSync(path.join(fotosDir, "sesion.json"), JSON.stringify(summary, null, 2));
            writeIndice(summary);
        }
        xvfb.kill("SIGTERM");
    }
    console.log(`PHOTOS DONE arranque: ${summary.bootMedianMs !== undefined ? `mediana ${summary.bootMedianMs}ms` : "NO MEDIDA"} · llegadas ${summary.bootArrivedCount} · fallidas ${summary.bootFailedCount} de ${summary.boot.length} lanzadas`);
}

await main();
