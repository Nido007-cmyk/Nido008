/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchBudgets.test — la tabla sellada del paso 3 de E10 y
 * su derivación de techos: las clases por RAM, los totales de
 * la tabla contra su aritmética, el techo derivado de la tasa
 * (presupuesto ÷ tasa × (1 + margen)) con sus cotas, y la tasa
 * medida gobernando sobre la de reserva solo para su modelo.
 * Las cifras medidas que sostienen la tabla viven en el
 * documento (estudios/E10-PRESUPUESTOS.md) y en el registro
 * del arnés; aquí se cobra la forma de la cuenta.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_STAGE_TIMEOUT_MS,
  MIN_STAGE_TIMEOUT_MS,
  RESEARCH_BUDGETS,
  STAGE_TIMEOUT_MARGIN,
  measuredRate,
  recordMeasuredRate,
  researchClassForTotalRam,
  resetMeasuredRate,
  stageTimeoutMs,
  typicalTotalTokens,
} from "./researchBudgets.js";

const GIB = 1024 * 1024 * 1024;

beforeEach(() => {
  resetMeasuredRate();
});

describe("las clases de máquina por RAM total", () => {
  it("los cortes nominales de la arquitectura", () => {
    expect(researchClassForTotalRam(8 * GIB)).toBe("8");
    expect(researchClassForTotalRam(11.9 * GIB)).toBe("8");
    expect(researchClassForTotalRam(12 * GIB)).toBe("16");
    expect(researchClassForTotalRam(16 * GIB)).toBe("16");
    expect(researchClassForTotalRam(23.9 * GIB)).toBe("16");
    expect(researchClassForTotalRam(24 * GIB)).toBe("32");
    expect(researchClassForTotalRam(64 * GIB)).toBe("32");
    // Sin lectura de RAM, la clase conservadora.
    expect(researchClassForTotalRam(0)).toBe("8");
  });
});

describe("la tabla sellada y su aritmética", () => {
  it("los rangos de plan y los presupuestos por clase", () => {
    expect([RESEARCH_BUDGETS["8"].planMin, RESEARCH_BUDGETS["8"].planMax]).toEqual([4, 6]);
    expect([RESEARCH_BUDGETS["16"].planMin, RESEARCH_BUDGETS["16"].planMax]).toEqual([6, 8]);
    expect([RESEARCH_BUDGETS["32"].planMin, RESEARCH_BUDGETS["32"].planMax]).toEqual([8, 10]);
    expect(RESEARCH_BUDGETS["8"].chunksPerPass).toBe(8);
    expect(RESEARCH_BUDGETS["16"].chunksPerPass).toBe(12);
    expect(RESEARCH_BUDGETS["32"].chunksPerPass).toBe(12);
    // La clase de 8 GB no tiene ronda de huecos; las mayores, una.
    expect(RESEARCH_BUDGETS["8"].gapRounds).toBe(0);
    expect(RESEARCH_BUDGETS["16"].gapRounds).toBe(1);
    expect(RESEARCH_BUDGETS["32"].gapSubQuestions).toBe(4);
  });

  it("el total típico a techo es la suma de la tabla", () => {
    // 300 + 6×800 + 600 + 0 + 2000
    expect(typicalTotalTokens(RESEARCH_BUDGETS["8"])).toBe(7700);
    // 400 + 8×1000 + 800 + 3×1000 + 3000
    expect(typicalTotalTokens(RESEARCH_BUDGETS["16"])).toBe(15200);
    // 500 + 10×1200 + 1000 + 4×1200 + 4000
    expect(typicalTotalTokens(RESEARCH_BUDGETS["32"])).toBe(22300);
  });
});

describe("el techo derivado de la tasa", () => {
  it("sin medición, gobierna la tasa de reserva de la clase", () => {
    const rate = RESEARCH_BUDGETS["8"].fallbackRateTokPerSec;
    const expected = Math.round((800 / rate) * (1 + STAGE_TIMEOUT_MARGIN) * 1000);
    expect(stageTimeoutMs(800, "8")).toBe(expected);
    expect(stageTimeoutMs(300, "8")).toBe(Math.round((300 / rate) * 1.5 * 1000));
  });

  it("las cotas: ningún techo bajo el mínimo ni sobre el máximo", () => {
    expect(stageTimeoutMs(1, "8")).toBe(MIN_STAGE_TIMEOUT_MS);
    expect(stageTimeoutMs(10_000_000, "8")).toBe(MAX_STAGE_TIMEOUT_MS);
  });

  it("la tasa medida gobierna para su modelo, y solo para el suyo", () => {
    recordMeasuredRate(10, "modelo-a.gguf");
    expect(measuredRate("modelo-a.gguf")).toBe(10);
    expect(measuredRate("modelo-b.gguf")).toBeNull();
    // 800 tokens a 10 tok/s × 1,5 = 120 s.
    expect(stageTimeoutMs(800, "8", "modelo-a.gguf")).toBe(120_000);
    // Otro modelo sigue con la de reserva.
    expect(stageTimeoutMs(800, "8", "modelo-b.gguf")).toBe(stageTimeoutMs(800, "8"));
    expect(stageTimeoutMs(800, "8")).toBeGreaterThan(120_000);
  });

  it("una tasa fuera de la banda plausible no se registra", () => {
    recordMeasuredRate(0.1, "modelo-a.gguf");
    expect(measuredRate("modelo-a.gguf")).toBeNull();
    recordMeasuredRate(501, "modelo-a.gguf");
    expect(measuredRate("modelo-a.gguf")).toBeNull();
    recordMeasuredRate(Number.NaN, "modelo-a.gguf");
    expect(measuredRate("modelo-a.gguf")).toBeNull();
    recordMeasuredRate(2.5, "modelo-a.gguf");
    expect(measuredRate("modelo-a.gguf")).toBe(2.5);
  });
});
