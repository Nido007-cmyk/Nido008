/**
 * Prueba de motor de NIDO PC: carga un GGUF local del catálogo, le
 * hace UNA pregunta por terminal y registra la respuesta con sus
 * cifras medidas. Es la evidencia de que el pipeline entero
 * (verificación de huella en la vía de carga, matemática de
 * compatibilidad, motor) corre de verdad en esta máquina.
 *
 * SALIDA = DIAGNÓSTICO LOCAL (auditoría de ataque 1, B-1): esta
 * sonda imprime la pregunta y la respuesta en claro. Sirve para
 * preguntas de prueba; una transcripción con contenido real de una
 * persona no se pega jamás en documentos permanentes: se registra
 * el hecho y las cifras, no el texto.
 *
 * Uso:
 *   npm run probe
 *   npm run probe -- --model qwen2.5-7b-instruct-q4km.gguf --ctx 2048 --q "¿Pregunta?"
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_CATALOG, type CatalogEntry } from "../src/core/catalog.js";
import { LocalEngine } from "../src/core/engine.js";
import { sha256OfFile, verifyModelFile } from "../src/core/loadPath.js";
import {
  availableBudgetBytes,
  planDesktopContext,
  toGib,
} from "../src/core/ram.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const root = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(root, "..", "models");
const modelFile = arg("model") ?? "qwen3-0.6b-q4km.gguf";
const question =
  arg("q") ?? "What is the capital of France, and why do offline assistants matter?";
const ctxArg = arg("ctx");
const requestedContext = ctxArg === undefined ? 4096 : Number(ctxArg);
if (!Number.isFinite(requestedContext) || requestedContext <= 0) {
  console.error(`REFUSED: --ctx must be a positive number, got "${ctxArg}".`);
  process.exit(1);
}

// Fichero -> entrada del catálogo por id. Fail-closed: lo que no
// está en el catálogo no se carga, y la verificación de tamaño y
// huella la hace la función única de la vía de carga (loadPath.ts),
// la misma que usa el motor.
const entryId = modelFile.replace(/\.gguf$/, "");
const entry: CatalogEntry | undefined = DESKTOP_CATALOG.find((m) => m.id === entryId);
if (!entry) {
  console.error(`REFUSED: ${modelFile} is not in the catalog (id "${entryId}"). Fail-closed.`);
  process.exit(1);
}
const modelPath = path.join(modelsDir, modelFile);
try {
  await verifyModelFile(modelPath, entry);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
console.log(`model file: ${modelFile}`);
console.log(`catalog match: ${entry.label} (${entry.fileBytes} bytes)`);
console.log(`sha256: ${await sha256OfFile(modelPath)}`);
console.log("sha256 verified against catalog: OK");

const snapshot = {
  totalRamBytes: os.totalmem(),
  freeRamBytes: os.freemem(),
};
const budget = availableBudgetBytes(snapshot);
const plan = planDesktopContext(entry, snapshot)!;
console.log(
  `machine: total ${toGib(snapshot.totalRamBytes)} GiB, free ${toGib(snapshot.freeRamBytes)} GiB, budget ${toGib(budget)} GiB, threads available ${os.availableParallelism()}`,
);
console.log(
  `plan (canonical, by total): fit=${plan.fit} context=${plan.contextSize} (ceiling ${plan.ceiling}) working set ${toGib(plan.workingSet.totalBytes)} GiB ${plan.note}`,
);

const contextSize = Math.min(requestedContext, plan.contextSize);
console.log(`loading with context ${contextSize} ...`);
const rssBefore = process.memoryUsage().rss;
const engine = await LocalEngine.load(modelsDir, entry, contextSize);
const rssAfterLoad = process.memoryUsage().rss;
console.log(`loaded. process RSS ${toGib(rssBefore)} -> ${toGib(rssAfterLoad)} GiB`);

console.log(`\nQ: ${question}`);
const answer = await engine.ask(question);
console.log(`A: ${answer.text}`);
console.log(
  `\nmeasured: ${answer.stats.answerTokens} tokens in ${answer.stats.generationSeconds.toFixed(2)}s = ${answer.stats.tokensPerSecond.toFixed(1)} tok/s (this VM: shared CPU, ~6 GiB RAM — pipeline proof, not a real PC figure)`,
);
console.log(`process RSS after answer: ${toGib(process.memoryUsage().rss)} GiB`);
process.exit(0);
