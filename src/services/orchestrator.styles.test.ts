/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * orchestrator.styles.test — el paso 5 de E10 con el motor
 * guionado: los cuatro estilos sobre el mismo material
 * juzgado (las mismas afirmaciones con las mismas citas en
 * las cuatro formas, extraídas y comparadas), el recibo por
 * afirmación resuelto hasta el fragmento, el recibo de
 * corrida entero, y la instrucción de estilo llegando a la
 * síntesis solo cuando el estilo no es el de por defecto.
 */
import { describe, it, expect, vi } from "vitest";

const AQ = {
  chunkId: "aq",
  docId: "doc-aq",
  id: "aq",
  title: "Roman aqueducts",
  body: "The Aqua Claudia carried water across the valleys on tall arches. Gravity kept the water moving along a gentle slope.",
  score: 0.9,
};
const ARC = {
  chunkId: "arc",
  docId: "doc-arc",
  id: "arc",
  title: "Roman aqueduct arcades",
  body: "Roman aqueducts crossed a valley on an arcade of stone arches that carried the channel. The arcade kept the channel at the height the slope needed. The channel was inspected in March 1849 and repaired in 1903. The arcade was extended in 1750.",
  score: 0.8,
};

const SQ_SLOPE = "How did Roman aqueducts keep their slope across a valley?";
const SQ_ARCADE = "What structures carried water over a valley?";

const CLAIM_A = "The Aqua Claudia carried water across the valleys on tall arches [1].";
const CLAIM_B = "Gravity kept the water moving along a gentle slope [1].";
const CLAIM_C = "An arcade of stone arches carried the channel across a valley [2].";
const CLAIM_D = "The channel was inspected in March 1849 and repaired in 1903 [2].";
const CLAIM_E = "The arcade was extended in 1750 [2].";
const ANSWER = [CLAIM_A, CLAIM_B, CLAIM_C, CLAIM_D, CLAIM_E].join(" ");
const ALL_CLAIMS = [CLAIM_A, CLAIM_B, CLAIM_C, CLAIM_D, CLAIM_E];

const script = vi.hoisted(() => ({ synthPrompts: [] as string[] }));
vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      if (p.includes("You are reviewing the perspectives")) {
        return JSON.stringify({ conflicts: [], duplicates: [], gaps: [] });
      }
      if (p.includes("synthesizing multiple research perspectives")) {
        script.synthPrompts.push(p);
        return ANSWER;
      }
      if (p.includes(SQ_SLOPE)) {
        return "The Aqua Claudia carried water across the valleys on tall arches [1]. Gravity kept the water moving along a gentle slope [1].";
      }
      if (p.includes(SQ_ARCADE)) {
        return "An arcade of stone arches carried the channel across a valley [1]. The channel was inspected in March 1849 and repaired in 1903 [1]. The arcade was extended in 1750 [1].";
      }
      throw new Error("prompt no guionado en la batería de estilos");
    },
  },
}));

vi.mock("../rag/retrieve.js", () => ({
  retrieve: async (q: string) => {
    if (q === SQ_SLOPE) return [AQ];
    if (q === SQ_ARCADE) return [ARC];
    return [];
  },
}));

vi.mock("../rag/semanticContext.js", () => ({
  buildJudgeSemanticContext: async () => null,
}));

import { runDeepResearch, type ResearchResult } from "./orchestrator.js";
import { citedClaims, renderReportStyle } from "./researchReport.js";

async function runOnce(extra: Record<string, unknown> = {}): Promise<ResearchResult> {
  script.synthPrompts = [];
  return runDeepResearch("How did Roman aqueducts carry water across valleys?", undefined, undefined, 3000, undefined, undefined, undefined, "en", {
    plan: { subQuestions: [SQ_SLOPE, SQ_ARCADE], scope: "both" },
    contrast: true,
    ...extra,
  });
}

describe("los cuatro estilos sobre el mismo material", () => {
  it("las mismas afirmaciones con las mismas citas aparecen en las cuatro formas", async () => {
    const result = await runOnce();
    expect(citedClaims(result.answer).map((c) => c.claim)).toEqual(ALL_CLAIMS);
    for (const style of ["completo", "ejecutivo", "comparativo", "cronologico"] as const) {
      const rendered = renderReportStyle(result, style, "en");
      for (const claim of ALL_CLAIMS) {
        expect(rendered, `${style} perdió la afirmación «${claim}»`).toContain(claim);
      }
    }
  });

  it("el cronológico ordena por fecha y el ejecutivo conserva el orden del informe", async () => {
    const result = await runOnce();
    const chrono = renderReportStyle(result, "cronologico", "en");
    expect(chrono.indexOf(CLAIM_E)).toBeLessThan(chrono.indexOf(CLAIM_D));
    expect(chrono).toContain("Claims without a date in the sources");
    const exec = renderReportStyle(result, "ejecutivo", "en");
    expect(exec.indexOf(CLAIM_D)).toBeLessThan(exec.indexOf(CLAIM_E));
  });

  it("el comparativo agrupa por perspectiva con sus subpreguntas como ejes", async () => {
    const result = await runOnce();
    const comp = renderReportStyle(result, "comparativo", "en");
    expect(comp).toContain(SQ_SLOPE);
    expect(comp).toContain(SQ_ARCADE);
    expect(comp.indexOf(CLAIM_A)).toBeGreaterThan(comp.indexOf(SQ_SLOPE));
    expect(comp.indexOf(CLAIM_C)).toBeGreaterThan(comp.indexOf(SQ_ARCADE));
  });

  it("la instrucción de estilo llega a la síntesis; el estilo por defecto no añade nada", async () => {
    await runOnce({ style: "ejecutivo" });
    expect(script.synthPrompts[0]).toContain("executive brief");
    const plain = await runOnce();
    expect(plain.style).toBe("completo");
    expect(script.synthPrompts[0]).not.toContain("executive brief");
  });
});

describe("los dos recibos", () => {
  it("cada afirmación del informe tiene su entrada, resuelta hasta el fragmento", async () => {
    const result = await runOnce();
    const claims = result.receipt?.claims ?? [];
    expect(claims.map((c) => c.claim)).toEqual(ALL_CLAIMS);
    expect(claims[0].citations).toEqual([
      { n: 1, chunkId: "aq", docId: "doc-aq", title: "Roman aqueducts" },
    ]);
    expect(claims[2].citations[0].chunkId).toBe("arc");
    expect(claims[2].citations[0].title).toBe("Roman aqueduct arcades");
    // Cada cita del recibo resuelve a un fragmento servido.
    const served = new Set(result.citations.map((c) => c.chunkId));
    for (const entry of claims) {
      for (const ref of entry.citations) expect(served.has(ref.chunkId)).toBe(true);
    }
  });

  it("el recibo de corrida trae etapas, pasadas con veredicto, juez final y conteos", async () => {
    const result = await runOnce();
    const run = result.receipt?.run;
    expect(run).toBeDefined();
    expect(run!.stages.map((s) => s.stage)).toEqual([
      "decompose",
      "pass",
      "pass",
      "contrast",
      "synthesis",
    ]);
    expect(run!.passes).toHaveLength(2);
    expect(run!.passes[0].verdict?.status).toBe("supported");
    expect(run!.finalJudge).toEqual({ kept: 5, removed: 0 });
    expect(run!.fragmentsConsulted).toBe(2);
    expect(run!.style).toBe("completo");
  });
});
