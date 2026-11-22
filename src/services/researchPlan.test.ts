/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchPlan.test — el plan visible del paso 4 de E10 en su
 * parte sin modelo y en su API: la cobertura por términos (un
 * término de la pregunta que ninguna subpregunta recoge es el
 * hueco declarado del plan, por su letra exacta), la
 * estimación de coste contra la tabla sellada y planResearch
 * entero con el motor guionado (descompone, comprueba, cuenta
 * y estima; no investiga: ninguna pasada corre al planear).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      if (p.includes("Break this research question into")) {
        return "How did Roman aqueducts keep their slope across a valley?\nWhat structures carried water over a valley?";
      }
      throw new Error("prompt no guionado en la batería del plan");
    },
  },
}));

const retrieval = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../rag/retrieve.js", () => ({
  retrieve: async () => {
    retrieval.calls += 1;
    return [];
  },
}));

// Sin base de conocimiento en el arnés: el conteo de
// documentos cobra su cero honesto por la vía del error.
vi.mock("../rag/db.js", () => ({
  getDb: async () => {
    throw new Error("sin base en la batería");
  },
}));

import {
  contentTermsOf,
  estimatePlanCost,
  planCoverage,
} from "./researchPlan.js";
import { planResearch } from "./orchestrator.js";
import { RESEARCH_BUDGETS } from "./researchBudgets.js";

describe("la cobertura sin modelo", () => {
  it("un término que ninguna subpregunta recoge es el hueco declarado, por su letra", () => {
    const cov = planCoverage("How did Roman aqueducts carry water across valleys?", [
      "How did Roman aqueducts keep their slope across a valley?",
      "What structures carried water over a valley?",
    ]);
    // «valleys» (plural) no es «valley» y «carry» no es
    // «carried»: la regla cobra la letra exacta, y el hueco se
    // declara en vez de presumirse cubierto.
    expect(cov.gaps).toContain("valleys");
    expect(cov.gaps).toContain("carry");
    expect(cov.covered).toContain("aqueducts");
    expect(cov.covered).toContain("water");
    expect(cov.gaps).not.toContain("aqueducts");
  });

  it("los términos de contenido pliegan acentos y descartan las vacías", () => {
    const terms = contentTermsOf("¿Cómo se formaron los Andes y qué procesos geológicos siguen?");
    expect(terms.has("formaron")).toBe(true);
    expect(terms.has("geologicos")).toBe(true);
    expect(terms.has("como")).toBe(false);
    expect(terms.has("los")).toBe(false);
  });
});

describe("la estimación de coste del plan", () => {
  it("es la aritmética de la tabla: pasadas a su presupuesto, contraste y síntesis", () => {
    const budget = RESEARCH_BUDGETS["8"];
    const est = estimatePlanCost(budget, 5, 2);
    expect(est.tokens).toBe(5 * 800 + 600 + 2000);
    expect(est.seconds).toBe(Math.round(est.tokens / 2));
  });
});

describe("planResearch: el plan antes de gastar", () => {
  it("descompone, comprueba la cobertura, cuenta ámbitos y estima, sin investigar", async () => {
    retrieval.calls = 0;
    const plan = await planResearch(
      "How did Roman aqueducts carry water across valleys?",
      "en",
      "both",
    );
    expect(plan.subQuestions).toHaveLength(2);
    expect(plan.coverage.gaps).toContain("valleys");
    // Los conteos se miden contra el disco real del arnés: sin
    // directorio de datos de la app, ningún ámbito tiene
    // fuentes presentes, y el plan lo declara vacío en vez de
    // inventar una cifra.
    expect(plan.scopeCounts).toEqual({ packs: 0, documents: 0, both: 0 });
    expect(plan.scopeEmpty).toBe(true);
    expect(plan.estimatedTokens).toBe(2 * plan.budget.subAnswerTokens + plan.budget.contrastTokens + plan.budget.synthesisTokens);
    // Planear no investiga: la recuperación de pasadas no corrió.
    expect(retrieval.calls).toBe(0);
  });
});
