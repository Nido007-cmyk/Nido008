/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchBudgets — los presupuestos sellados de la
 * investigación profunda en PC (E10, paso 3) y la derivación
 * de sus techos de etapa.
 *
 * El documento que sella estas cifras es
 * `estudios/E10-PRESUPUESTOS.md`, nacido en el mismo paso, y su
 * instrumento es `scripts/e10Presupuestos.ts` (medición del
 * 2026-11-22 sobre el modelo de referencia y la instalación
 * viva de E5, en esta máquina). Lo que aquí vive es la tabla
 * por clase de máquina y la cuenta de los techos:
 *
 *   techo de etapa = presupuesto de tokens de la etapa
 *                    ÷ tasa medida × (1 + margen declarado)
 *
 * con el margen en STAGE_TIMEOUT_MARGIN (0,5) y el resultado
 * acotado entre MIN_STAGE_TIMEOUT_MS y MAX_STAGE_TIMEOUT_MS.
 * La tasa es la del modelo cargado en esta máquina: hasta que
 * una generación la mide, gobierna la tasa de reserva de la
 * clase (la de 8 GB es la medida por el arnés en esta máquina;
 * las de 16 y 32 GB son el suelo declarado por la cuenta en el
 * documento, no una medición); desde la primera generación de
 * la corrida, la tasa medida en vivo la sustituye y gobierna
 * los techos de las etapas siguientes, como manda el estudio.
 *
 * Historia nombrada (la destitución del paso 3): hasta este
 * paso, las etapas del pipeline heredaban del móvil un techo
 * fijo, STAGE_TIMEOUT_MS = 120_000, que no sabía cuánto tarda
 * su etapa: podía cortar una síntesis sana o dejar colgar una
 * muerta. La constante deja de gobernar aquí; queda citada
 * solo como historia del porte, en este comentario y en el
 * documento de presupuestos, nunca como valor vigente.
 *
 * La clase de máquina se lee del total de RAM con los cortes
 * nominales de la arquitectura (8/16/32 GB): una máquina por
 * debajo del corte siguiente corre con los presupuestos de la
 * clase menor, que es la conservadora. Sin lectura de RAM, la
 * clase es la de 8 GB.
 */
import { getDeviceTotalRamBytes } from "../core/ram.js";

export type ResearchClass = "8" | "16" | "32";

export interface ResearchBudget {
  /** Subpreguntas del plan: mínimo y máximo que pide la descomposición. */
  planMin: number;
  planMax: number;
  /** Tokens de generación de la descomposición. */
  decomposeTokens: number;
  /** Fragmentos por pasada de investigación (topK de su recuperación). */
  chunksPerPass: number;
  /** Tokens de generación de cada subrespuesta. */
  subAnswerTokens: number;
  /** Tokens de generación de la pasada de contraste (paso 4). */
  contrastTokens: number;
  /** Rondas de huecos tras el contraste: 0 = sin ronda en esta clase. */
  gapRounds: number;
  /** Subpreguntas máximas de la ronda de huecos. */
  gapSubQuestions: number;
  /** Tokens de generación de la síntesis (el informe). */
  synthesisTokens: number;
  /**
   * Tasa de reserva (tokens/s de respuesta) que gobierna los
   * techos hasta la primera medición en vivo de la corrida.
   */
  fallbackRateTokPerSec: number;
}

/**
 * La tabla sellada. La fila de 8 GB es la ejecutada y medida
 * en esta máquina; las de 16 y 32 GB están selladas por la
 * cuenta (derivadas en el documento, declaradas no
 * ejecutadas): la dirección que la medición sostuvo (plan más
 * grande y presupuestos mayores por clase) aplicada con la
 * aritmética a la vista en `estudios/E10-PRESUPUESTOS.md`.
 */
export const RESEARCH_BUDGETS: Record<ResearchClass, ResearchBudget> = {
  "8": {
    planMin: 4,
    planMax: 6,
    decomposeTokens: 300,
    chunksPerPass: 8,
    subAnswerTokens: 800,
    contrastTokens: 600,
    gapRounds: 0,
    gapSubQuestions: 0,
    synthesisTokens: 2000,
    fallbackRateTokPerSec: 1.29,
  },
  "16": {
    planMin: 6,
    planMax: 8,
    decomposeTokens: 400,
    chunksPerPass: 12,
    subAnswerTokens: 1000,
    contrastTokens: 800,
    gapRounds: 1,
    gapSubQuestions: 3,
    synthesisTokens: 3000,
    fallbackRateTokPerSec: 1.0,
  },
  "32": {
    planMin: 8,
    planMax: 10,
    decomposeTokens: 500,
    chunksPerPass: 12,
    subAnswerTokens: 1200,
    contrastTokens: 1000,
    gapRounds: 1,
    gapSubQuestions: 4,
    synthesisTokens: 4000,
    fallbackRateTokPerSec: 1.0,
  },
};

const GIB = 1024 * 1024 * 1024;

/** La clase de una máquina por su RAM total (cortes nominales 12/24 GiB). */
export function researchClassForTotalRam(totalRamBytes: number): ResearchClass {
  if (totalRamBytes >= 24 * GIB) return "32";
  if (totalRamBytes >= 12 * GIB) return "16";
  return "8";
}

/** La clase de esta máquina, leída en el momento de la llamada. */
export function currentResearchClass(): ResearchClass {
  return researchClassForTotalRam(getDeviceTotalRamBytes());
}

/** El presupuesto vigente: el de la clase pedida o el de esta máquina. */
export function researchBudget(cls: ResearchClass = currentResearchClass()): ResearchBudget {
  return RESEARCH_BUDGETS[cls];
}

/** El total generado típico de una corrida a su techo, por la tabla. */
export function typicalTotalTokens(budget: ResearchBudget): number {
  return (
    budget.decomposeTokens +
    budget.planMax * budget.subAnswerTokens +
    budget.contrastTokens +
    budget.gapSubQuestions * budget.subAnswerTokens +
    budget.synthesisTokens
  );
}

// ---- La tasa medida y la derivación de techos.

/** El margen declarado de la derivación: el techo es 1,5× el tiempo a la tasa. */
export const STAGE_TIMEOUT_MARGIN = 0.5;

/** Ningún techo de etapa baja de un minuto ni pasa de dos horas. */
export const MIN_STAGE_TIMEOUT_MS = 60_000;
export const MAX_STAGE_TIMEOUT_MS = 7_200_000;

interface MeasuredRateState {
  modelKey: string;
  tokPerSec: number;
}

let measured: MeasuredRateState | null = null;

/**
 * Registra la tasa medida en una generación del modelo
 * cargado (tokens de respuesta ÷ segundos). Una tasa fuera de
 * la banda plausible (0,2 a 500 tok/s) no se registra: una
 * generación de un token no gobierna ningún techo.
 */
export function recordMeasuredRate(tokPerSec: number, modelKey: string): void {
  if (!Number.isFinite(tokPerSec) || tokPerSec < 0.2 || tokPerSec > 500) return;
  measured = { modelKey, tokPerSec };
}

/** La tasa medida para un modelo, si es la que se registró. */
export function measuredRate(modelKey: string): number | null {
  return measured !== null && measured.modelKey === modelKey ? measured.tokPerSec : null;
}

/** Solo para baterías: el estado de la tasa vuelve a su nacimiento. */
export function resetMeasuredRate(): void {
  measured = null;
}

/**
 * El techo de una etapa, derivado: presupuesto de tokens ÷
 * tasa × (1 + margen), acotado. La tasa es la medida para el
 * modelo cargado si la hay; si no, la de reserva de la clase.
 */
export function stageTimeoutMs(
  budgetTokens: number,
  cls: ResearchClass = currentResearchClass(),
  modelKey: string | null = null,
): number {
  const live = modelKey !== null ? measuredRate(modelKey) : null;
  const rate = live ?? RESEARCH_BUDGETS[cls].fallbackRateTokPerSec;
  const raw = (budgetTokens / rate) * (1 + STAGE_TIMEOUT_MARGIN) * 1000;
  return Math.min(MAX_STAGE_TIMEOUT_MS, Math.max(MIN_STAGE_TIMEOUT_MS, Math.round(raw)));
}
