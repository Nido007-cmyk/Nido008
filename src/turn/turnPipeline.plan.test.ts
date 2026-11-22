/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * turnPipeline.plan.test — el paso 4 de E10 en el turno: el
 * plan se pide antes de enviar (planTurn cobra los mismos
 * cortes que el turno: si otra ruta responde o la segunda
 * red intercepta, no hay plan que enseñar), y el turno con el
 * plan aprobado investiga el plan editado por la rama
 * profunda, con su contraste. La subpregunta añadida a mano
 * que destapa la emergencia abandona la investigación y el
 * turno sirve su ruta protegida, como cobró la secuencia de
 * oro del paso 2 para la pregunta original.
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
const SQ_ARCADE = "What structures carried water over a valley?";

const engine = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    get isLoaded() {
      return true;
    },
    getModelInfo: () => ({ filename: "models/qwen3-4b-instruct-2507-q4km.gguf", nCtx: 16384 }),
    get lastPromptSent() {
      return null;
    },
    load: async () => undefined,
    stop: () => undefined,
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      engine.calls.push(p);
      if (p.includes("Break this research question into")) {
        return `${SQ_SLOPE}\n${SQ_ARCADE}`;
      }
      if (p.includes("You are reviewing the perspectives")) {
        return JSON.stringify({ conflicts: [], duplicates: [], gaps: [] });
      }
      if (p.includes("synthesizing multiple research perspectives")) {
        return "The Aqua Claudia carried water across the valleys on tall arches [1]. An arcade of stone arches carried the channel across a valley [2].";
      }
      if (p.includes(SQ_SLOPE)) {
        return "The Aqua Claudia carried water across the valleys on tall arches [1]. Gravity kept the water moving along a gentle slope [1].";
      }
      if (p.includes(SQ_ARCADE)) {
        return "An arcade of stone arches carried the channel across a valley [1]. The arcade kept the channel at the height the slope needed [1].";
      }
      return "La capital de Francia es París.";
    },
  },
  setLlamaModelsDir: () => undefined,
  llamaModelsDir: () => null,
}));

const retrieval = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../rag/retrieve.js", () => ({
  retrieve: async (q: string) => {
    retrieval.calls.push(q);
    if (q === SQ_SLOPE) return [AQ];
    if (q === SQ_ARCADE) return [ARC];
    return [];
  },
  assemblePrompt: (q: string) => q,
}));

vi.mock("../rag/semanticContext.js", () => ({
  buildJudgeSemanticContext: async () => null,
}));

import { planTurn, productionTurnDeps, runTurn, type TurnDeps } from "./turnPipeline.js";

async function deps(): Promise<TurnDeps> {
  return productionTurnDeps({
    handlers: {} as TurnDeps["handlers"],
    packFacts: async () => ({ regions: [], facts: [] }),
  });
}

const Q = "How did Roman aqueducts carry water across valleys?";

describe("planTurn: el plan antes del envío", () => {
  it("una pregunta investigable devuelve su plan descompuesto", async () => {
    const outcome = await planTurn(
      { query: Q, lang: "en", systemPrompt: "", researchMode: true },
      await deps(),
    );
    expect(outcome.kind).toBe("plan");
    if (outcome.kind === "plan") {
      expect(outcome.plan.subQuestions).toEqual([SQ_SLOPE, SQ_ARCADE]);
      expect(outcome.plan.intercepted).toBe(false);
    }
  });

  it("la emergencia no se convierte en plan: se declara preemptada", async () => {
    const outcome = await planTurn(
      { query: "My son is choking right now and cannot breathe, what do I do?", lang: "en", systemPrompt: "", researchMode: true },
      await deps(),
    );
    expect(outcome.kind).toBe("preempted");
  });

  it("sin el modo activo no hay plan", async () => {
    const outcome = await planTurn(
      { query: Q, lang: "en", systemPrompt: "", researchMode: false },
      await deps(),
    );
    expect(outcome.kind).toBe("not-deep");
  });
});

describe("el turno con el plan aprobado", () => {
  it("investiga el plan editado por la rama profunda", async () => {
    retrieval.calls = [];
    const outcome = await planTurn(
      { query: Q, lang: "en", systemPrompt: "", researchMode: true },
      await deps(),
    );
    if (outcome.kind !== "plan") throw new Error("el plan no llegó");
    const result = await runTurn(
      {
        query: Q,
        lang: "en",
        systemPrompt: "",
        researchMode: true,
        researchPlan: outcome.plan,
      },
      await deps(),
    );
    expect(result.route).toBe("deep-research");
    expect(retrieval.calls).toContain(SQ_SLOPE);
    expect(retrieval.calls).toContain(SQ_ARCADE);
    expect(result.text).toContain("Aqua Claudia");
  });

  it("la subpregunta añadida que destapa la emergencia abandona la investigación", async () => {
    const outcome = await planTurn(
      { query: Q, lang: "en", systemPrompt: "", researchMode: true },
      await deps(),
    );
    if (outcome.kind !== "plan") throw new Error("el plan no llegó");
    const edited = {
      ...outcome.plan,
      subQuestions: [
        ...outcome.plan.subQuestions,
        "My toddler is choking right now and cannot breathe, what do I do?",
      ],
    };
    const result = await runTurn(
      {
        query: Q,
        lang: "en",
        systemPrompt: "",
        researchMode: true,
        researchPlan: edited,
      },
      await deps(),
    );
    expect(result.route).not.toBe("deep-research");
    expect(result.researchPreempted).toBe(true);
  });
});
