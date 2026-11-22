/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * orchestrator.sessions.test.ts — E10, paso 6: las sesiones
 * que sobreviven, cobradas sobre el pipeline.
 *
 * - La foto de la sesión se entrega SOLO al cerrar cada
 *   etapa (plan, cada pasada, contraste, cierre), en su
 *   orden, y nunca a mitad de una etapa.
 * - Parar es pausar: la corrida parada tras la primera
 *   pasada se reanuda desde su foto, no redescompone ni
 *   repite la pasada cerrada, y su informe final es
 *   IDÉNTICO, byte a byte, al de la corrida sin paradas
 *   (misma corpus, mismo motor guionado: la identidad la
 *   cobra la comparación directa de respuesta y citas).
 * - Un contraste cerrado no se repite al reanudar: la
 *   ronda sigue solo con las preguntas que faltan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const AQ = {
  chunkId: "aq",
  docId: "doc-aq",
  title: "Roman aqueducts",
  body: "Roman aqueducts carried water along a gentle downhill slope. The Aqua Claudia carried water across the valleys on tall arches.",
  score: 0.9,
};
const ARC = {
  chunkId: "arc",
  docId: "doc-arc",
  title: "Arcade bridges",
  body: "An arcade of stone arches carried the channel across a valley. The arcade kept the channel at the height the slope needed.",
  score: 0.8,
};

const SQ_SLOPE = "How did Roman aqueducts keep their slope across a valley?";
const SQ_ARCADE = "What structures carried the channel over a valley?";
const SQ_GAP = "Which aqueducts still stand today?";
const SUPPORTED_SLOPE =
  "Roman aqueducts carried water along a gentle downhill slope [1]. The Aqua Claudia carried water across the valleys on tall arches [1].";
const SUPPORTED_ARCADE =
  "An arcade of stone arches carried the channel across a valley [1]. The arcade kept the channel at the height the slope needed [1].";
const SYNTHESIS =
  "Roman aqueducts carried water along a gentle downhill slope [1]. An arcade of stone arches carried the channel across a valley [2].";

const script = vi.hoisted(() => ({
  contrastJson: "",
  contrastCalls: 0,
  passPrompts: [] as string[],
  synthCalls: 0,
}));

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      if (p.includes("You are reviewing the perspectives")) {
        script.contrastCalls += 1;
        return script.contrastJson;
      }
      if (p.includes("synthesizing multiple research perspectives")) {
        script.synthCalls += 1;
        return SYNTHESIS;
      }
      script.passPrompts.push(p);
      if (p.includes(SQ_SLOPE)) return SUPPORTED_SLOPE;
      if (p.includes(SQ_ARCADE)) return SUPPORTED_ARCADE;
      if (p.includes(SQ_GAP)) return SUPPORTED_ARCADE;
      return "No local detail is available for this question.";
    },
  },
}));

const retrieval = vi.hoisted(() => ({
  byQuestion: new Map<string, unknown[]>(),
}));
vi.mock("../rag/retrieve.js", () => ({
  retrieve: async (q: string) => retrieval.byQuestion.get(q) ?? [],
}));

vi.mock("../rag/semanticContext.js", () => ({
  buildJudgeSemanticContext: async () => null,
}));

import {
  runDeepResearch,
  type ResearchSessionSnapshot,
} from "./orchestrator.js";
import { RESEARCH_BUDGETS } from "./researchBudgets.js";

const Q = "How did Roman aqueducts carry water across valleys?";
const PLAN = { subQuestions: [SQ_SLOPE, SQ_ARCADE], scope: "both" as const };

function reset(contrastJson = "") {
  script.contrastJson = contrastJson;
  script.contrastCalls = 0;
  script.passPrompts = [];
  script.synthCalls = 0;
  retrieval.byQuestion = new Map([
    [SQ_SLOPE, [AQ]],
    [SQ_ARCADE, [ARC]],
    [SQ_GAP, [ARC]],
  ]);
}

beforeEach(() => reset());

describe("E10 paso 6 · la foto se guarda al cerrar cada etapa", () => {
  it("la secuencia de guardados es plan, pasada, pasada, contraste, cierre", async () => {
    const saved: ResearchSessionSnapshot[] = [];
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: PLAN,
      contrast: true,
      session: { onStageClosed: (s) => void saved.push(structuredClone(s)) },
    });
    expect(result.answer.length).toBeGreaterThan(0);
    expect(saved.map((s) => s.stage)).toEqual(["plan", "passes", "passes", "contrast", "done"]);
    expect(saved.map((s) => s.passes.length)).toEqual([0, 1, 2, 2, 2]);
    // La foto de cierre lleva el material entero juzgado.
    expect(saved[4].passes[0].result.subQuestion).toBe(SQ_SLOPE);
    expect(saved[4].passes[1].result.verdict?.status).toBeDefined();
  });
});

describe("E10 paso 6 · parar es pausar y reanudar es idéntico", () => {
  it("la reanudada no repite lo cerrado y su informe es byte a byte el de la corrida entera", async () => {
    // La corrida sin paradas, con su sesión grabando.
    const savedWhole: ResearchSessionSnapshot[] = [];
    const whole = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: PLAN,
      session: { onStageClosed: (s) => void savedWhole.push(structuredClone(s)) },
    });
    expect(whole.answer).toBe(SYNTHESIS);

    // La misma corrida, parada tras cerrar la primera pasada.
    reset();
    const savedStopped: ResearchSessionSnapshot[] = [];
    let checks = 0;
    const stopped = await runDeepResearch(
      Q,
      undefined,
      undefined,
      2000,
      undefined,
      undefined,
      () => {
        checks += 1;
        return checks >= 2;
      },
      "en",
      { plan: PLAN, session: { onStageClosed: (s) => void savedStopped.push(structuredClone(s)) } },
    );
    expect(stopped.stopped).toBe(true);
    expect(stopped.answer).toBe("");
    const lastClosed = savedStopped[savedStopped.length - 1];
    expect(lastClosed.stage).toBe("passes");
    expect(lastClosed.passes.length).toBe(1);

    // La reanudación desde la foto: ni la pasada cerrada se
    // repite (sus prompts no vuelven a salir) ni la síntesis
    // cambia: el informe es el mismo, byte a byte.
    const passPromptsBefore = script.passPrompts.length;
    const resumed = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      session: { resume: lastClosed, onStageClosed: () => undefined },
    });
    const resumedPassPrompts = script.passPrompts.slice(passPromptsBefore);
    expect(resumedPassPrompts.some((p) => p.includes(SQ_SLOPE))).toBe(false);
    expect(resumedPassPrompts.some((p) => p.includes(SQ_ARCADE))).toBe(true);
    expect(resumed.answer).toBe(whole.answer);
    expect(resumed.citations.map((c) => c.chunkId)).toEqual(whole.citations.map((c) => c.chunkId));
    expect(resumed.receipt?.claims).toEqual(whole.receipt?.claims);
  });
});

describe("E10 paso 6 · el contraste cerrado no se repite", () => {
  it("reanudar desde la foto del contraste corre solo la ronda que falta", async () => {
    const contrastJson = JSON.stringify({
      conflicts: [],
      duplicates: [],
      gaps: [{ topic: "standing", question: SQ_GAP }],
    });
    reset(contrastJson);
    const saved: ResearchSessionSnapshot[] = [];
    const whole = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: PLAN,
      contrast: true,
      budgetOverride: RESEARCH_BUDGETS["16"],
      session: { onStageClosed: (s) => void saved.push(structuredClone(s)) },
    });
    expect(script.contrastCalls).toBe(1);
    const atContrast = saved.find((s) => s.stage === "contrast")!;
    expect(atContrast.contrast?.gaps.length).toBe(1);
    expect(atContrast.passes.length).toBe(2);

    // Reanudar desde esa foto: el contraste no se repite y
    // la pregunta de la ronda corre una sola vez.
    const contrastCallsBefore = script.contrastCalls;
    const passPromptsBefore = script.passPrompts.length;
    const resumed = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      contrast: true,
      budgetOverride: RESEARCH_BUDGETS["16"],
      session: { resume: atContrast, onStageClosed: () => undefined },
    });
    expect(script.contrastCalls).toBe(contrastCallsBefore);
    const resumedPassPrompts = script.passPrompts.slice(passPromptsBefore);
    expect(resumedPassPrompts.filter((p) => p.includes(SQ_GAP)).length).toBe(1);
    expect(resumedPassPrompts.some((p) => p.includes(SQ_SLOPE))).toBe(false);
    expect(resumed.answer).toBe(whole.answer);
  });
});
