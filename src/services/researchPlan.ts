/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchPlan — el plan visible de la investigación profunda
 * (E10, paso 4): la comprobación de cobertura sin modelo, los
 * conteos de fuentes por ámbito y la estimación de coste que
 * la superficie enseña antes de gastar.
 *
 * La descomposición la hace el pipeline (orchestrator.ts);
 * este módulo lleva las piezas sin modelo que el plan
 * declara:
 *
 * - La cobertura: todo término de contenido de la pregunta
 *   debe quedar cubierto por al menos una subpregunta del
 *   plan, o el hueco se declara en el propio plan. La regla
 *   de términos es la del QC de la descomposición (plegado
 *   sin acentos, palabras de 4+ letras, la misma lista de
 *   vacías), replicada aquí porque el QC vive dentro del
 *   pipeline y esta comprobación tiene que poder correr sin
 *   él; si la lista cambia allí, cambia aquí.
 * - Los conteos por ámbito (estudio §3.0): paquetes
 *   instalados presentes en disco y documentos personales
 *   con contenido indexado. Sin ámbito con fuentes, la
 *   investigación no arranca y el plan dice por qué.
 * - La estimación de coste: la aritmética de la tabla
 *   sellada de presupuestos sobre el tamaño del plan, con el
 *   tiempo a la tasa vigente (la medida si la hay; si no, la
 *   de reserva de la clase).
 */
import { existsSync } from "node:fs";
import { getDb } from "../rag/db.js";
import { knowledgePacks } from "../rag/packs.js";
import { packsDataPath } from "../models/dataDir.js";
import type { RetrievalScope } from "../rag/retrieve.js";
import {
  measuredRate,
  researchBudget,
  type ResearchBudget,
} from "./researchBudgets.js";

export type { RetrievalScope };

/** El plan que la superficie enseña y la persona edita. */
export interface ResearchPlan {
  query: string;
  lang: "en" | "es" | "pt";
  /** El ámbito elegido al planear; la persona puede cambiarlo antes de correr. */
  scope: RetrievalScope;
  subQuestions: string[];
  /** La cobertura sin modelo: términos de la pregunta cubiertos y huecos. */
  coverage: { covered: string[]; gaps: string[] };
  /** Fuentes por ámbito, contadas antes de empezar. */
  scopeCounts: Record<RetrievalScope, number>;
  /** True cuando el ámbito elegido no tiene ninguna fuente: no arranca. */
  scopeEmpty: boolean;
  /**
   * E10 (paso 5): el estilo de informe elegido con el plan
   * (la persona lo cambia en el panel; el defecto es
   * «completo»). La corrida lo pasa a la síntesis y las
   * cuatro formas de lectura se componen de su material.
   */
  style: "completo" | "ejecutivo" | "comparativo" | "cronologico";
  /**
   * True si la segunda red intercepta la pregunta o alguna
   * subpregunta del plan: la emergencia nunca se convierte en
   * tema de investigación, así que la superficie no enseña
   * este plan y el turno corre por su ruta protegida.
   */
  intercepted: boolean;
  /** El coste estimado de correr este plan, en tokens y en segundos a la tasa. */
  estimatedTokens: number;
  estimatedSeconds: number;
  /** El presupuesto de la clase con el que se planeó (su foto). */
  budget: ResearchBudget;
}

const FOLD_RE = /[\u0300-\u036f]/g;

function foldTerm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(FOLD_RE, "");
}

/** La lista de vacías del QC de la descomposición, replicada (ver la cabecera). */
const CONTENT_STOPWORDS = new Set([
  "para", "como", "sobre", "entre", "cuando", "donde", "porque", "este", "esta", "esto", "esos", "esas",
  "cual", "desde", "hasta", "what", "which", "when", "where", "about", "with", "from", "that", "this",
  "does", "have", "qual", "quais", "mais",
]);

/** Los términos de contenido de un texto, con la regla del QC. */
export function contentTermsOf(text: string): Set<string> {
  return new Set(
    foldTerm(text)
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 4 && !CONTENT_STOPWORDS.has(w)),
  );
}

/**
 * La cobertura del plan sobre la pregunta, sin modelo: un
 * término está cubierto si aparece en alguna subpregunta;
 * los que no aparecen son el hueco declarado del plan.
 */
export function planCoverage(
  question: string,
  subQuestions: string[],
): { covered: string[]; gaps: string[] } {
  const qTerms = contentTermsOf(question);
  const coveredSet = new Set<string>();
  for (const sq of subQuestions) {
    for (const t of contentTermsOf(sq)) {
      if (qTerms.has(t)) coveredSet.add(t);
    }
  }
  const covered = [...qTerms].filter((t) => coveredSet.has(t)).sort();
  const gaps = [...qTerms].filter((t) => !coveredSet.has(t)).sort();
  return { covered, gaps };
}

/**
 * El coste estimado de un plan: sus pasadas a su presupuesto,
 * el contraste y la síntesis (la descomposición ya se gastó
 * al planear y no se cobra dos veces). El tiempo es el total
 * a la tasa dada. La ronda de huecos no se estima: es
 * condicional, y su techo va en la tabla de presupuestos.
 */
export function estimatePlanCost(
  budget: ResearchBudget,
  planSize: number,
  rateTokPerSec: number,
): { tokens: number; seconds: number } {
  const tokens = planSize * budget.subAnswerTokens + budget.contrastTokens + budget.synthesisTokens;
  return { tokens, seconds: Math.round(tokens / Math.max(rateTokPerSec, 0.01)) };
}

/**
 * Los conteos de fuentes por ámbito. Paquetes: las entradas
 * del catálogo de corpus cuyo fichero está presente (la
 * presencia se mide, no se declara). Documentos: los
 * documentos personales con trozos indexados en la base de
 * conocimiento. Un conteo que no se puede leer vale 0 y el
 * plan lo declara vacío, no lo inventa.
 */
export async function researchScopeCounts(): Promise<Record<RetrievalScope, number>> {
  let packs = 0;
  try {
    const catalog = await knowledgePacks();
    for (const pack of catalog) {
      try {
        if (existsSync(packsDataPath(pack.filename))) packs += 1;
      } catch {
        // Una ruta que no se puede resolver no cuenta como fuente.
      }
    }
  } catch {
    packs = 0;
  }
  let documents = 0;
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(DISTINCT doc_id) AS n FROM chunks",
    );
    documents = row?.n ?? 0;
  } catch {
    documents = 0;
  }
  return { packs, documents, both: packs + documents };
}

/** La tasa vigente para estimar: la medida del modelo dado, o la de reserva. */
export function currentRateForEstimate(budget: ResearchBudget, modelKey: string | null): number {
  return (modelKey !== null ? measuredRate(modelKey) : null) ?? budget.fallbackRateTokPerSec;
}
