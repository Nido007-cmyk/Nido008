/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda 13 · A5 (B6): la segunda red de presupuesto (I-7 segunda
 * mitad e I-9 de AUDITORIA-INYECCION, firma 5). Los payloads C1 y
 * C2 de la auditoría como contrato, contados con el tokenizador
 * real de Qwen3-0.6B por la vía única de la fundación
 * (LocalEngine.countTokens sobre el fichero verificado por
 * huella): lo que con el estimador pasaba entero desbordando la
 * ventana, con el conteo real queda acotado por el ajuste
 * (fitChunksToBudget con la medida real inyectada) y cazado por
 * la guarda del bucle (assertPromptBudget con el contador real
 * inyectado, la pieza que esta tanda abre). Y el caso de I-9: el
 * cuerpo de ≈308.000 caracteres de la sonda C4, que sin
 * presupuesto atraviesa entero, con el presupuesto del camino
 * del bucle queda acotado en las dos vías, y lo acotado pasa la
 * guarda del bucle.
 *
 * El espécimen checo se midió al nacer esta batería en esta
 * máquina: su render estimado cabe en 2.048 con la reserva de
 * 256 y su conteo real no (la clase débil del estimador que la
 * auditoría midió en C1/C2). Si el fichero del modelo no está,
 * la batería cae con su nombre, no en silencio.
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { assembleChatMessages, assemblePrompt, fitChunksToBudget } from "../../rag/pure.js";
import type { RetrievedChunk } from "../../rag/retrieve.js";
import { DESKTOP_CATALOG } from "../../core/catalog.js";
import { LocalEngine } from "../../core/engine.js";
import { assertPromptBudget, estimatePromptTokens } from "./agentLoop.js";
import { defaultTokenCounter } from "./contextBudget.js";
import { sceneSkipped } from "../../test/sceneGate.js";

const NCTX = 2048;
const RESERVA = 256;

const PARRAFO_CHECO =
  "Při výměně pneumatiky nejprve zastavte na rovném a bezpečném místě, zatáhněte ruční brzdu a vypněte motor. " +
  "Povolte matice kola o polovinu otáčky ještě předtím, než vůz zvednete heverem. " +
  "Nikdy nevstupujte pod vůz, který stojí pouze na heveru. " +
  "Doporučený utahovací moment matic je 120 newtonmetrů a rezervní kolo smíte používat nejvýše do rychlosti 80 kilometrů za hodinu. " +
  "Pokud si nejste jistí, zavolejte asistenční službu a počkejte na bezpečném místě mimo vozovku.";
const CUERPO_CHECO = PARRAFO_CHECO.repeat(9);

function fragmentoCheco(): RetrievedChunk {
  return { chunkId: "cz1", docId: "cz1", title: "Výměna pneumatiky", body: CUERPO_CHECO, score: 0.9, matchType: "hybrid" };
}

const renderDe = (list: RetrievedChunk[]) => list.map((c, i) => `[${i + 1}] ${c.title}\n${c.body}`).join("\n\n");

let engine: LocalEngine;

// La puerta de escena sustituye al lanzamiento expreso que
// vivía en el beforeAll: la máxima queda intacta (la batería
// cuenta con el tokenizador real o no cuenta), porque sin la
// declaración de la corrida el ayudante lanza con su mensaje
// y con el modelo presente todo corre; solo cambia quién
// firma el mensaje.
const SCENE_OFF = sceneSkipped("bucle.segundaRed", [
  join(process.cwd(), "models", "qwen3-0.6b-q4km.gguf"),
]);

beforeAll(async () => {
  if (SCENE_OFF) return;
  const entry = DESKTOP_CATALOG.find((e) => e.id === "qwen3-0.6b-q4km");
  if (!entry) throw new Error("segundaRed: la entrada qwen3-0.6b-q4km no está en el catálogo");
  const modelsDir = join(process.cwd(), "models");
  engine = await LocalEngine.load(modelsDir, entry, NCTX);
}, 180_000);

describe.skipIf(SCENE_OFF)("bucle.segundaRed · I-7: el conteo real acota lo que el estimador dejaba pasar", () => {
  it("C1 con el estimador (control): el fragmento checo entra entero creyendo que cabe", () => {
    const fitted = fitChunksToBudget([fragmentoCheco()], "", NCTX, RESERVA);
    expect(fitted).toHaveLength(1);
    expect(fitted[0].body).toBe(CUERPO_CHECO);
    expect(fitted[0].truncated).toBeFalsy();
    expect(estimatePromptTokens(renderDe(fitted)) + RESERVA).toBeLessThanOrEqual(NCTX);
    // Y sin embargo el conteo real del mismo render desborda la ventana:
    expect(engine.countTokens(renderDe(fitted)) + RESERVA).toBeGreaterThan(NCTX);
  });

  it("C1 con el conteo real inyectado: el ajuste acota el fragmento a la ventana real", () => {
    const fitted = fitChunksToBudget([fragmentoCheco()], "", NCTX, RESERVA, (list) => engine.countTokens(renderDe(list)));
    const entraEntero = fitted.length === 1 && fitted[0].body === CUERPO_CHECO && !fitted[0].truncated;
    expect(entraEntero).toBe(false);
    expect(engine.countTokens(renderDe(fitted)) + RESERVA).toBeLessThanOrEqual(NCTX);
  });

  it("C2 con el estimador (control): la guarda del bucle no lanza sobre el prompt checo", () => {
    const mensajes = [{ role: "user" as const, content: renderDe([fragmentoCheco()]) }];
    expect(() => assertPromptBudget(mensajes, NCTX, RESERVA, "sonda C2")).not.toThrow();
  });

  it("C2 con el contador real inyectado: la guarda del bucle caza el desborde que el estimador no veía", () => {
    const mensajes = [{ role: "user" as const, content: renderDe([fragmentoCheco()]) }];
    expect(() => assertPromptBudget(mensajes, NCTX, RESERVA, "sonda C2", (t) => engine.countTokens(t))).toThrow(/prompt excede el contexto/);
  });
});

describe.skipIf(SCENE_OFF)("bucle.segundaRed · I-9: sin presupuesto no acota nadie; con el del bucle, acotado", () => {
  const cuerpo308k = "Contenido de la guía importada. ".repeat(9_600); // ≈307.200 caracteres

  it("C4 sin presupuesto (control): el cuerpo de ≈308.000 caracteres atraviesa entero la vía plana", () => {
    const grande: RetrievedChunk = { chunkId: "g", docId: "g", title: "Guía importada", body: cuerpo308k, score: 0.9, matchType: "hybrid" };
    const prompt = assemblePrompt("¿Qué dice la guía?", [grande]);
    expect(prompt.length).toBeGreaterThan(308_000);
  });

  it("C4 con presupuesto: la vía plana queda acotada a su ventana", () => {
    const grande: RetrievedChunk = { chunkId: "g", docId: "g", title: "Guía importada", body: cuerpo308k, score: 0.9, matchType: "hybrid" };
    const prompt = assemblePrompt("¿Qué dice la guía?", [grande], undefined, undefined, undefined, false, { nCtx: 8192, reserveGeneration: 256 });
    expect(defaultTokenCounter(prompt) + 256).toBeLessThanOrEqual(8192);
  }, 60_000);

  it("C4 con presupuesto: la vía de mensajes queda acotada y lo acotado pasa la guarda del bucle", () => {
    const grande: RetrievedChunk = { chunkId: "g", docId: "g", title: "Guía importada", body: cuerpo308k, score: 0.9, matchType: "hybrid" };
    const mensajes = assembleChatMessages("¿Qué dice la guía?", [grande], undefined, undefined, undefined, false, { nCtx: 8192, reserveGeneration: 256 });
    const estimado = mensajes.reduce((acc, m) => acc + defaultTokenCounter(m.content), 0);
    expect(estimado + 256).toBeLessThanOrEqual(8192);
    expect(() => assertPromptBudget(mensajes, 8192, 256, "camino del bucle")).not.toThrow();
  }, 60_000);
});
