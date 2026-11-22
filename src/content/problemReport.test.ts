/**
 * problemReport.test.ts · Batería del informe de problema (S-9,
 * bloque 5): composición en los tres idiomas, formas de «ninguno»,
 * saneamiento al componer y la suma de privacidad (cinco líneas,
 * solo datos de la app y de la máquina).
 */
import { describe, expect, it } from "vitest";
import { composeProblemReport, sanitizeErrorReason } from "./problemReport.js";

const FACTS = {
  version: "0.1.0",
  system: "Windows 11",
  memoryClass: "16 GB",
  modelName: "Qwen3 4B",
  lastError: "El modelo no respondió · 2026-11-19",
};

describe("informe de problema", () => {
  it("compone la plantilla en español", () => {
    const out = composeProblemReport("es", FACTS);
    expect(out.split("\n")).toEqual([
      "Informe de NIDO PC",
      "Versión de NIDO PC: 0.1.0",
      "Sistema: Windows 11 · Memoria: 16 GB",
      "Modelo en uso: Qwen3 4B",
      "Último error registrado: El modelo no respondió · 2026-11-19",
    ]);
  });

  it("compone la plantilla en inglés y portugués", () => {
    expect(composeProblemReport("en", FACTS).split("\n")[0]).toBe("NIDO PC report");
    expect(composeProblemReport("en", FACTS)).toContain("Model in use: Qwen3 4B");
    expect(composeProblemReport("pt", FACTS).split("\n")[0]).toBe("Relatório do NIDO PC");
    expect(composeProblemReport("pt", FACTS)).toContain("Modelo em uso: Qwen3 4B");
  });

  it("sin modelo y sin error, la línea dice «ninguno» en su forma", () => {
    const out = composeProblemReport("es", { ...FACTS, modelName: null, lastError: null });
    expect(out).toContain("Modelo en uso: ninguno");
    expect(out).toContain("Último error registrado: ninguno");
    const outEn = composeProblemReport("en", { ...FACTS, modelName: null, lastError: null });
    expect(outEn).toContain("Model in use: none");
    const outPt = composeProblemReport("pt", { ...FACTS, modelName: null, lastError: null });
    expect(outPt).toContain("Modelo em uso: nenhum");
  });

  it("suma de privacidad: cinco líneas y ninguna otra cosa", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const out = composeProblemReport(lang, FACTS);
      expect(out.split("\n")).toHaveLength(5);
    }
  });

  it("el saneamiento corta rutas, direcciones y saltos de línea", () => {
    expect(sanitizeErrorReason("fallo al abrir /home/persona/notas.txt con su secreto"))
      .toBe("fallo al abrir");
    expect(sanitizeErrorReason("error\ncon salto y https://ejemplo.com/x"))
      .toBe("error con salto y");
    expect(sanitizeErrorReason("x".repeat(300)).length).toBeLessThanOrEqual(201);
    const out = composeProblemReport("es", {
      ...FACTS,
      lastError: "cierre inesperado /home/persona/chat.db",
    });
    expect(out).not.toContain("/home/");
    expect(out.split("\n")).toHaveLength(5);
  });
});
