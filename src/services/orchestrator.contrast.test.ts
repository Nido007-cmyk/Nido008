/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * orchestrator.contrast.test — el paso 4 de E10 con el motor
 * guionado: el plan editado manda (la corrida investiga las
 * subpreguntas del plan, no una descomposición nueva; la
 * añadida a mano pasa por la segunda red como las demás), la
 * pasada de contraste alimenta la síntesis, el hueco sembrado
 * se declara y no se rellena, la ronda de huecos es ÚNICA y
 * solo donde la clase la tiene, y un contraste que no valida
 * se declara fallido en vez de disimularse.
 *
 * El mundo es el de los acueductos romanos (la puerta no lo
 * preempta) salvo donde el caso cobra la puerta misma.
 */
import { describe, it, expect, vi } from "vitest";

const AQ = {
  id: "aq",
  title: "Roman aqueducts",
  body: "The Aqua Claudia carried water across the valleys on tall arches. Gravity kept the water moving along a gentle slope.",
  score: 0.9,
};
const ARC = {
  id: "arc",
  title: "Arcade bridges",
  body: "An arcade of stone arches carried the channel across a valley. The arcade kept the channel at the height the slope needed.",
  score: 0.8,
};

const SQ_SLOPE = "How did Roman aqueducts keep their slope across a valley?";
const SQ_ARCADE = "What structures carried the channel over a valley?";
const SQ_GAP = "Which inscriptions name the engineers who designed the aqueducts?";
const SUPPORTED_SLOPE = "The Aqua Claudia carried water across the valleys on tall arches [1]. Gravity kept the water moving along a gentle slope [1].";
const SUPPORTED_ARCADE = "An arcade of stone arches carried the channel across a valley [1]. The arcade kept the channel at the height the slope needed [1].";

const script = vi.hoisted(() => ({
  contrastJson: "",
  contrastCalls: 0,
  synthPrompts: [] as string[],
  passPrompts: [] as string[],
  decomposeCalls: 0,
}));

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      if (p.includes("Break this research question into")) {
        script.decomposeCalls += 1;
        throw new Error("con plan aprobado no se descompone");
      }
      if (p.includes("You are reviewing the perspectives")) {
        script.contrastCalls += 1;
        return script.contrastJson;
      }
      if (p.includes("synthesizing multiple research perspectives")) {
        script.synthPrompts.push(p);
        return "The Aqua Claudia carried water across the valleys on tall arches [1]. An arcade of stone arches carried the channel across a valley [2].";
      }
      script.passPrompts.push(p);
      if (p.includes(SQ_SLOPE)) return SUPPORTED_SLOPE;
      if (p.includes(SQ_ARCADE)) return SUPPORTED_ARCADE;
      if (p.includes("Which aqueducts still stand today?")) return SUPPORTED_ARCADE;
      return "No local detail is available for this question.";
    },
  },
}));

const retrieval = vi.hoisted(() => ({
  byQuestion: new Map<string, unknown[]>(),
  calls: [] as string[],
}));
vi.mock("../rag/retrieve.js", () => ({
  retrieve: async (q: string) => {
    retrieval.calls.push(q);
    return retrieval.byQuestion.get(q) ?? [];
  },
}));

vi.mock("../rag/semanticContext.js", () => ({
  buildJudgeSemanticContext: async () => null,
}));

import { runDeepResearch } from "./orchestrator.js";
import { RESEARCH_BUDGETS } from "./researchBudgets.js";

const Q = "How did Roman aqueducts carry water across valleys?";

function reset(contrastJson: string) {
  script.contrastJson = contrastJson;
  script.contrastCalls = 0;
  script.synthPrompts = [];
  script.passPrompts = [];
  script.decomposeCalls = 0;
  retrieval.calls = [];
  retrieval.byQuestion = new Map([
    [SQ_SLOPE, [AQ]],
    [SQ_ARCADE, [ARC]],
    [SQ_GAP, []],
  ]);
}

describe("el plan editado manda", () => {
  it("la corrida investiga las subpreguntas del plan y no descompone de nuevo", async () => {
    reset("");
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE, SQ_ARCADE], scope: "both" },
    });
    expect(script.decomposeCalls).toBe(0);
    expect(result.subQuestions).toEqual([SQ_SLOPE, SQ_ARCADE]);
    expect(retrieval.calls).toEqual([SQ_SLOPE, SQ_ARCADE]);
    expect(result.emergencyIntercepted).toBeFalsy();
  });

  it("una subpregunta añadida a mano que destapa la emergencia intercepta antes de investigar", async () => {
    reset("");
    const added = "My son is choking right now and cannot breathe, what do I do?";
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE, added], scope: "both" },
    });
    expect(result.emergencyIntercepted).toBe(true);
    expect(retrieval.calls).toEqual([]);
    expect(script.passPrompts).toEqual([]);
  });
});

describe("la pasada de contraste y los huecos declarados", () => {
  it("el hueco sembrado se declara en el resultado y en el prompt de síntesis, y no se rellena", async () => {
    reset(JSON.stringify({ conflicts: [], duplicates: [], gaps: [] }));
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE, SQ_GAP], scope: "both" },
      contrast: true,
    });
    expect(result.executedPlan).toEqual([
      { subQuestion: SQ_SLOPE, sourceCount: 1, state: "covered" },
      { subQuestion: SQ_GAP, sourceCount: 0, state: "gap" },
    ]);
    expect(result.gapsDeclared).toContain(SQ_GAP);
    // La clase de esta máquina (8 GB) no tiene ronda: el hueco
    // se declara, no se investiga una segunda vez.
    expect(result.gapRoundUsed).toBe(false);
    expect(retrieval.calls.filter((q) => q === SQ_GAP)).toHaveLength(1);
    expect(script.synthPrompts[0]).toContain("Declared gaps");
    expect(script.synthPrompts[0]).toContain(SQ_GAP);
  });

  it("los conflictos y duplicados del contraste llegan al resultado y a la síntesis", async () => {
    reset(
      JSON.stringify({
        conflicts: [{ perspectives: [1, 2], note: "the slope figure differs" }],
        duplicates: [{ perspectives: [1, 2], note: "both credit the arches" }],
        gaps: [],
      }),
    );
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE, SQ_ARCADE], scope: "both" },
      contrast: true,
    });
    expect(result.contrast?.conflicts).toHaveLength(1);
    expect(result.contrast?.duplicates).toHaveLength(1);
    expect(script.synthPrompts[0]).toContain("Conflict between perspectives 1 and 2");
    expect(script.synthPrompts[0]).toContain("Duplicate claim in perspectives 1 and 2");
  });

  it("un contraste que no valida tras el reparo se declara fallido y la corrida termina igual", async () => {
    reset("esto no es json");
    const result = await runDeepResearch(Q, undefined, undefined, 2000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE, SQ_GAP], scope: "both" },
      contrast: true,
    });
    expect(result.contrast?.failed).toBe(true);
    expect(result.gapsDeclared).toContain(SQ_GAP);
    expect(result.answer.length).toBeGreaterThan(0);
  });
});

describe("la ronda única de huecos", () => {
  const GAP_Q1 = "Which aqueducts still stand today?";
  const GAP_Q2 = "What did an aqueduct cost to build?";
  const GAP_Q3 = "Who maintained the aqueducts day to day?";
  const GAP_Q4 = "Which aqueduct was the longest of all?";

  it("corre una sola vez, con su tope, y lo que sigue faltando se declara", async () => {
    reset(
      JSON.stringify({
        conflicts: [],
        duplicates: [],
        gaps: [
          { topic: "standing remains", question: GAP_Q1 },
          { topic: "construction cost", question: GAP_Q2 },
          { topic: "daily maintenance", question: GAP_Q3 },
          { topic: "the longest aqueduct", question: GAP_Q4 },
        ],
      }),
    );
    retrieval.byQuestion.set(GAP_Q1, [ARC]);
    const result = await runDeepResearch(Q, undefined, undefined, 3000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE], scope: "both" },
      contrast: true,
      budgetOverride: RESEARCH_BUDGETS["16"],
    });
    expect(result.gapRoundUsed).toBe(true);
    // El contraste corrió una vez: no existe segunda ronda.
    expect(script.contrastCalls).toBe(1);
    // La ronda de 16 GB corre como mucho 3 subpreguntas.
    const roundCalls = retrieval.calls.filter((q) => q.startsWith("Which") || q.startsWith("What did") || q.startsWith("Who maintained"));
    expect(roundCalls).toEqual([GAP_Q1, GAP_Q2, GAP_Q3]);
    // La que encontró fuentes deja de ser hueco; las demás se
    // declaran, incluida la que el tope dejó sin correr.
    expect(result.gapsDeclared).not.toContain("standing remains");
    expect(result.gapsDeclared).toContain("construction cost");
    expect(result.gapsDeclared).toContain("daily maintenance");
    expect(result.gapsDeclared).toContain("the longest aqueduct");
    expect(result.executedPlan?.some((e) => e.subQuestion === GAP_Q1 && e.state === "covered")).toBe(true);
  });

  it("una pregunta de la ronda que destapa la emergencia intercepta la corrida", async () => {
    reset(
      JSON.stringify({
        conflicts: [],
        duplicates: [],
        gaps: [{ topic: "dose", question: "My toddler is choking right now and cannot breathe, what do I do?" }],
      }),
    );
    const result = await runDeepResearch(Q, undefined, undefined, 3000, undefined, undefined, undefined, "en", {
      plan: { subQuestions: [SQ_SLOPE], scope: "both" },
      contrast: true,
      budgetOverride: RESEARCH_BUDGETS["16"],
    });
    expect(result.emergencyIntercepted).toBe(true);
  });
});
