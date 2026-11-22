/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * orchestrator.judge.test.ts — E10, paso 2: el juez dentro del
 * pipeline de investigación.
 *
 * Lo que esta batería especifica (sobre el pipeline recreado en
 * el paso 1, con el motor y la recuperación apuntalados como en
 * las baterías heredadas; el juez es el real, en su modo léxico
 * porque el contexto semántico no tiene e5 residente aquí):
 *
 * - Juez por pasada: cada subrespuesta se juzga contra SUS
 *   fragmentos antes de la síntesis; lo retirado no llega a la
 *   síntesis como material, y la cabecera de la perspectiva es
 *   el veredicto (con apoyo / parcial con su conteo / sin
 *   fuentes), no la etiqueta de conteo.
 * - Juez final: el informe sintetizado pasa entero por el juez
 *   contra la unión de fragmentos citados; lo que retira queda
 *   contado, y una cita que solo vivía en una frase retirada
 *   sale de la lista (ninguna cita huérfana se sirve).
 * - Los conteos de la corrida (por pasada, el final y el tiempo
 *   del juez) quedan asentados en el resultado.
 *
 * Las fixtures usan prosa real medida contra el juez y contra
 * la puerta antes de escribirse: el tema (los acueductos
 * romanos) no es de los que la segunda red preempta, la
 * afirmación apoyada copia el cuerpo de su fragmento, y la
 * inventada trae una fecha y una cantidad sin respaldo, la
 * forma que el juez retira por su maquinaria de números. La
 * primera versión de esta batería usó una picadura de medusa
 * como tema y el pipeline la interceptó por la segunda red
 * antes de juzgar nada: era la puerta funcionando, y quedó
 * asentado en el cierre del paso.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => false,
  },
}));

vi.mock("../rag/retrieve.js", () => ({
  retrieve: (query: string) => retrieveMock(query),
  assemblePrompt: () => "mock sub-question prompt",
}));

import { runDeepResearch } from "./orchestrator.js";
import type { RetrievedChunk } from "../rag/retrieve.types.js";

function chunk(chunkId: string, title: string, body: string): RetrievedChunk {
  return {
    chunkId,
    docId: `doc-${chunkId}`,
    title,
    body,
    score: 1,
    matchType: "semantic" as const,
  } as RetrievedChunk;
}

const AQ_BODY =
  "Roman aqueducts carried water along a gentle downhill slope, often only a few tens of centimeters of fall per kilometer. " +
  "Where a valley crossed the line, the Romans built arcades of arches to keep the channel at its level.";
const AQ = chunk("aq", "Roman aqueducts", AQ_BODY);
const ARC = chunk(
  "arc",
  "Arcades",
  "Where a valley crossed the line, the Romans built arcades of arches to keep the channel at its level."
);

const SUPPORTED =
  "Roman aqueducts carried water along a gentle downhill slope. " +
  "Where a valley crossed the line, the Romans built arcades of arches to keep the channel at its level.";
const INVENTED = "The Aqua Claudia was finished in the year 312 and carried 900 million liters of water every day.";
const QUERY = "How did Roman aqueducts carry water across valleys?";
const SUBQ = "How did Roman aqueducts keep their slope across a valley?";

const SYNTH_MARKER = "synthesizing multiple research perspectives";

/** Guion completo: descomposición, subrespuestas, planes de fragmentos y síntesis. */
function scriptRun(
  subQuestions: string[],
  answers: string[],
  chunkPlans: RetrievedChunk[][],
  synthesis: string,
) {
  const prompts: string[] = [];
  let researchCall = 0;
  generateMock.mockImplementation(async (opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    if (
      opts.prompt.startsWith("Break this research question") ||
      opts.prompt.startsWith("Divide esta pregunta de investigación")
    ) {
      return subQuestions.join("\n");
    }
    if (opts.prompt.includes(SYNTH_MARKER) || opts.prompt.includes("sintetizando varias perspectivas")) {
      return synthesis;
    }
    return answers[Math.min(researchCall++, answers.length - 1)];
  });
  const plans = [...chunkPlans];
  retrieveMock.mockImplementation(async () => plans.shift() ?? []);
  return prompts;
}

function synthesisPrompt(prompts: string[]): string {
  return prompts.find((p) => p.includes(SYNTH_MARKER) || p.includes("sintetizando varias perspectivas")) ?? "";
}

beforeEach(() => {
  generateMock.mockReset();
  retrieveMock.mockReset();
});

describe("E10 paso 2 — juez por pasada", () => {
  it("la afirmación sin apoyo se retira antes de la síntesis y el veredicto es parcial con su conteo", async () => {
    const prompts = scriptRun([SUBQ], [`${SUPPORTED} ${INVENTED}`], [[AQ]], "Roman aqueducts carried water along a gentle downhill slope [1].");
    const result = await runDeepResearch(QUERY, undefined, undefined, 200);
    const prompt = synthesisPrompt(prompts);
    // Lo retirado por el juez de la pasada no es material de síntesis.
    expect(prompt).not.toContain("900 million");
    // La cabecera de la perspectiva es el veredicto, con su conteo.
    expect(prompt).toContain("[judged: partial — 2 kept, 1 removed — sources: 1]");
    expect(result.judge?.perPass).toEqual([{ kept: 2, removed: 1 }]);
    expect(result.answer).not.toContain("900 million");
  });

  it("todo apoyado: el veredicto es con apoyo y nada se retira", async () => {
    const prompts = scriptRun([SUBQ], [SUPPORTED], [[AQ]], "Roman aqueducts carried water along a gentle downhill slope [1].");
    const result = await runDeepResearch(QUERY, undefined, undefined, 200);
    expect(synthesisPrompt(prompts)).toContain("[judged: supported — sources: 1]");
    expect(result.judge?.perPass).toEqual([{ kept: 2, removed: 0 }]);
    expect(result.judge?.finalRemoved).toBe(0);
  });

  it("la etiqueta del veredicto en español: juzgado, con apoyo", async () => {
    const bodyEs =
      "Los acueductos romanos llevaban el agua por una pendiente suave y constante. " +
      "Cuando un valle cruzaba el trazado, los romanos construían arcadas de arcos para mantener el canal a su nivel.";
    const prompts = scriptRun(
      ["¿Cómo mantenían su pendiente los acueductos romanos al cruzar un valle?"],
      [bodyEs],
      [[chunk("ac", "Acueductos romanos", bodyEs)]],
      "Los acueductos romanos llevaban el agua por una pendiente suave y constante [1]."
    );
    const result = await runDeepResearch(
      "¿Cómo llevaban el agua los acueductos romanos a través de los valles?",
      undefined,
      undefined,
      200,
      undefined,
      undefined,
      undefined,
      "es"
    );
    expect(synthesisPrompt(prompts)).toContain("[juzgado: con apoyo — fuentes: 1]");
    expect(result.judge?.perPass).toEqual([{ kept: 2, removed: 0 }]);
  });

  it("pasada sin fuentes: veredicto sin fuentes, sin juzgar, y su conteo es cero", async () => {
    const prompts = scriptRun(
      [SUBQ, "What is the capital of Atlantis?"],
      [SUPPORTED, "Nobody knows."],
      [[AQ], []],
      "Roman aqueducts carried water along a gentle downhill slope [1]."
    );
    const result = await runDeepResearch("Tell me about Roman aqueducts and Atlantis", undefined, undefined, 200);
    const prompt = synthesisPrompt(prompts);
    expect(prompt).toContain("[judged: sources: none — generated without local sources]");
    expect(result.judge?.perPass).toEqual([
      { kept: 2, removed: 0 },
      { kept: 0, removed: 0 },
    ]);
  });
});

describe("E10 paso 2 — juez final y conteos de la corrida", () => {
  it("el juez final retira la afirmación inventada de la síntesis y su cita huérfana sale de la lista", async () => {
    scriptRun(
      [SUBQ],
      [
        "Roman aqueducts carried water along a gentle downhill slope [1]. " +
          "Where a valley crossed the line, the Romans built arcades of arches to keep the channel at its level [2].",
      ],
      [[AQ, ARC]],
      `Roman aqueducts carried water along a gentle downhill slope [1]. ${INVENTED} [2].`
    );
    const result = await runDeepResearch(QUERY, undefined, undefined, 200);
    expect(result.answer).not.toContain("900 million");
    expect(result.judge?.finalRemoved).toBe(1);
    // La cita [2] solo vivía en la frase retirada: no se sirve.
    expect(result.citations.map((c) => c.chunkId)).toEqual(["aq"]);
  });

  it("los conteos de la corrida quedan asentados: por pasada, el final y el tiempo del juez", async () => {
    scriptRun([SUBQ], [`${SUPPORTED} ${INVENTED}`], [[AQ]], "Roman aqueducts carried water along a gentle downhill slope [1].");
    const result = await runDeepResearch(QUERY, undefined, undefined, 200);
    expect(result.judge).toBeDefined();
    expect(result.judge?.perPass).toHaveLength(1);
    expect(result.judge?.finalKept).toBeGreaterThanOrEqual(1);
    expect(typeof result.judge?.judgeMs).toBe("number");
    expect(result.judge?.judgeMs).toBeGreaterThanOrEqual(0);
  });
});
