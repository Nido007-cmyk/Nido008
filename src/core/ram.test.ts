/**
 * Tests de la matemática de memoria de escritorio. Las cifras de
 * anclaje salen de las arquitecturas públicas de los modelos y de la
 * fórmula exacta de KV de llama.cpp; si un número cambia, ha cambiado
 * la fórmula o el dato, y este fichero es donde se nota.
 */

import { describe, expect, it } from "vitest";
import { DESKTOP_CATALOG, defaultModelForBudget } from "./catalog.js";
import {
  GIB,
  MIB,
  availableBudgetBytes,
  estimateWorkingSet,
  kvCacheBytes,
  planDesktopContext,
  systemReserveBytes,
  type MachineSnapshot,
} from "./ram.js";

const byId = (id: string) => DESKTOP_CATALOG.find((m) => m.id === id)!;
const machine = (gb: number): MachineSnapshot => ({ totalRamBytes: gb * GIB });

describe("kvCacheBytes — la fórmula exacta", () => {
  it("Qwen2.5-7B a 4096: 2 × 28 × 4096 × 4 × 128 × 2 = 224 MiB", () => {
    const q7b = byId("qwen2.5-7b-instruct-q4km");
    expect(kvCacheBytes(q7b.arch, 4096)).toBe(224 * MIB);
  });

  it("Qwen3-0.6B a 4096: su KV es pesada para su tamaño (8 cabezas KV)", () => {
    const q06 = byId("qwen3-0.6b-q4km");
    expect(kvCacheBytes(q06.arch, 4096)).toBe(448 * MIB);
  });

  it("q8_0 parte la KV exactamente por la mitad", () => {
    const q7b = byId("qwen2.5-7b-instruct-q4km");
    expect(kvCacheBytes(q7b.arch, 8192, 1)).toBe(kvCacheBytes(q7b.arch, 8192, 2) / 2);
  });
});

describe("systemReserveBytes — reserva proporcional con suelo y techo", () => {
  it("8 GiB → suelo de 2 GiB", () => {
    expect(systemReserveBytes(8 * GIB)).toBe(2 * GIB);
  });
  it("16 GiB → 20 % = 3,2 GiB", () => {
    expect(systemReserveBytes(16 * GIB)).toBe(Math.floor(16 * GIB * 0.2));
  });
  it("64 GiB → techo de 8 GiB", () => {
    expect(systemReserveBytes(64 * GIB)).toBe(8 * GIB);
  });
});

describe("availableBudgetBytes", () => {
  it("sin lectura en vivo manda la cuenta por el total", () => {
    const budget = availableBudgetBytes(machine(16));
    expect(budget).toBe(16 * GIB - systemReserveBytes(16 * GIB) - 256 * MIB);
  });

  it("con la RAM libre baja, manda la libre", () => {
    const budget = availableBudgetBytes({ totalRamBytes: 16 * GIB, freeRamBytes: 3 * GIB });
    expect(budget).toBe(3 * GIB);
  });

  it("el crédito liberable suma en la foto viva", () => {
    const budget = availableBudgetBytes({
      totalRamBytes: 16 * GIB,
      freeRamBytes: 3 * GIB,
      releasableBytes: 1 * GIB,
    });
    expect(budget).toBe(4 * GIB);
  });
});

describe("availableBudgetBytes — la lectura en vivo en su borde (F-PC62)", () => {
  it("lectura en vivo de 0: el presupuesto es 0, no la cuenta por el total", () => {
    const budget = availableBudgetBytes({ totalRamBytes: 16 * GIB, freeRamBytes: 0 });
    expect(budget).toBe(0);
  });

  it("lectura de 0 con crédito liberable: el crédito se cobra", () => {
    const budget = availableBudgetBytes({
      totalRamBytes: 16 * GIB,
      freeRamBytes: 0,
      releasableBytes: 1 * GIB,
    });
    expect(budget).toBe(1 * GIB);
  });

  it("lectura de 0 con liberable enorme: manda el tope por el total", () => {
    const budget = availableBudgetBytes({
      totalRamBytes: 16 * GIB,
      freeRamBytes: 0,
      releasableBytes: 64 * GIB,
    });
    expect(budget).toBe(16 * GIB - systemReserveBytes(16 * GIB) - 256 * MIB);
  });

  it("sin lectura: manda la cuenta por el total (control)", () => {
    const budget = availableBudgetBytes(machine(16));
    expect(budget).toBe(16 * GIB - systemReserveBytes(16 * GIB) - 256 * MIB);
  });

  it("lectura positiva: manda la libre (control)", () => {
    const budget = availableBudgetBytes({ totalRamBytes: 16 * GIB, freeRamBytes: 3 * GIB });
    expect(budget).toBe(3 * GIB);
  });

  it("lectura negativa: el presupuesto es 0, nunca la cuenta por el total", () => {
    const budget = availableBudgetBytes({ totalRamBytes: 16 * GIB, freeRamBytes: -1 });
    expect(budget).toBe(0);
  });

  it("planDesktopContext con lectura de 0: rojo, con el presupuesto 0 asentado", () => {
    const plan = planDesktopContext(byId("qwen3-0.6b-q4km"), {
      totalRamBytes: 16 * GIB,
      freeRamBytes: 0,
    })!;
    expect(plan.budgetBytes).toBe(0);
    expect(plan.fit).toBe("red");
  });
});

describe("planDesktopContext — los modelos de la foto del dueño", () => {
  it("en 8 GiB: el 7B NO es verde (la tableta tenía razón a su manera), pero cabe degradado", () => {
    const plan = planDesktopContext(byId("qwen2.5-7b-instruct-q4km"), machine(8))!;
    expect(plan.fit).toBe("yellow");
    expect(plan.contextSize).toBeGreaterThanOrEqual(2048);
  });

  it("en 16 GiB: el 7B es verde a contexto amplio", () => {
    const plan = planDesktopContext(byId("qwen2.5-7b-instruct-q4km"), machine(16))!;
    expect(plan.fit).toBe("green");
    expect(plan.contextSize).toBe(32768);
  });

  it("en 16 GiB: el LFM2.5-8B también es verde", () => {
    const plan = planDesktopContext(byId("lfm2.5-8b-a1b-q4km"), machine(16))!;
    expect(plan.fit).toBe("green");
  });

  it("en 32 GiB: verde todo el catálogo salvo el 32B denso, amarillo declarado", () => {
    for (const entry of DESKTOP_CATALOG.filter((m) => m.kind === "llm")) {
      const plan = planDesktopContext(entry, machine(32))!;
      expect(plan.fit, entry.id).toBe(entry.id === "qwen3-32b-q4km" ? "yellow" : "green");
    }
  });

  it("catálogo grande: los veredictos del estudio, reproducidos por la cuenta", () => {
    // Qwen3-14B: rojo en 8 (los pesos solos no caben), amarillo en 16, verde en 32.
    expect(planDesktopContext(byId("qwen3-14b-q4km"), machine(8))!.fit).toBe("red");
    expect(planDesktopContext(byId("qwen3-14b-q4km"), machine(16))!.fit).toBe("yellow");
    expect(planDesktopContext(byId("qwen3-14b-q4km"), machine(32))!.fit).toBe("green");
    // El MoE 30B-2507: verde en 32, rojo en 16.
    expect(planDesktopContext(byId("qwen3-30b-a3b-instruct-2507-q4km"), machine(32))!.fit).toBe("green");
    expect(planDesktopContext(byId("qwen3-30b-a3b-instruct-2507-q4km"), machine(16))!.fit).toBe("red");
    // Phi-4: verde en 16 a SU techo (16.384), no al de la clase.
    const phi = planDesktopContext(byId("phi-4-q4km"), machine(16))!;
    expect(phi.fit).toBe("green");
    expect(phi.contextSize).toBe(16384);
    // Mistral Small 24B: rojo en 16 por la política de presupuesto, verde en 32.
    expect(planDesktopContext(byId("mistral-small-3.1-24b-q4km"), machine(16))!.fit).toBe("red");
    expect(planDesktopContext(byId("mistral-small-3.1-24b-q4km"), machine(32))!.fit).toBe("green");
  });

  it("Gemma 3 con su KV híbrida real: el 12B es verde en 16 y el 27B en 32", () => {
    expect(planDesktopContext(byId("gemma-3-12b-it-q4km"), machine(16))!.fit).toBe("green");
    expect(planDesktopContext(byId("gemma-3-27b-it-qat-q4_0"), machine(32))!.fit).toBe("green");
    expect(planDesktopContext(byId("gemma-3-27b-it-qat-q4_0"), machine(16))!.fit).toBe("red");
  });

  it("en 8 GiB: el ligero y el 1.7B son verdes", () => {
    expect(planDesktopContext(byId("qwen3-0.6b-q4km"), machine(8))!.fit).toBe("green");
    expect(planDesktopContext(byId("qwen3-1.7b-q4km"), machine(8))!.fit).toBe("green");
  });

  it("un modelo imposible es rojo, con la cuenta a la vista", () => {
    const huge = {
      id: "huge",
      fileBytes: 40 * GIB,
      arch: { layers: 80, kvHeads: 8, headDim: 128, vocab: 128000 },
      maxContext: 32768,
    };
    const plan = planDesktopContext(huge, machine(16))!;
    expect(plan.fit).toBe("red");
    expect(plan.workingSet.totalBytes).toBeGreaterThan(plan.budgetBytes);
  });

  it("sin RAM usable no hay plan: no se juzga a ciegas", () => {
    expect(planDesktopContext(byId("qwen3-0.6b-q4km"), { totalRamBytes: 0 })).toBeNull();
  });

  it("el techo nunca supera el máximo del modelo ni 32768", () => {
    const plan = planDesktopContext(byId("qwen3-0.6b-q4km"), machine(32))!;
    expect(plan.ceiling).toBe(32768);
    expect(plan.contextSize).toBeLessThanOrEqual(plan.ceiling);
  });
});

describe("estimateWorkingSet", () => {
  it("los pesos son el tamaño del fichero, entero", () => {
    const ws = estimateWorkingSet(byId("qwen2.5-7b-instruct-q4km"), 4096);
    expect(ws.weightsBytes).toBe(4_683_074_240);
    expect(ws.totalBytes).toBe(
      ws.weightsBytes + ws.kvBytes + ws.computeBytes + ws.logitsBytes,
    );
  });
});

describe("kvCacheBytes — atención híbrida (extensión por Gemma 3)", () => {
  it("Gemma 3 27B a 32.768: su KV real es 2,91 GiB, no los 15,5 de la cota", () => {
    const g27 = byId("gemma-3-27b-it-qat-q4_0");
    // 10 capas globales a contexto pleno + 52 en ventana de 1.024.
    expect(kvCacheBytes(g27.arch, 32768)).toBe(3_120_562_176);
  });

  it("Gemma 3 12B a 32.768: 2,31 GiB con 8 capas globales y 40 en ventana", () => {
    const g12 = byId("gemma-3-12b-it-q4km");
    expect(kvCacheBytes(g12.arch, 32768)).toBe(2_483_027_968);
  });

  it("sin campos de ventana, la fórmula es la de siempre", () => {
    const q7b = byId("qwen2.5-7b-instruct-q4km");
    expect(kvCacheBytes(q7b.arch, 4096)).toBe(224 * MIB);
  });

  it("la ventana no crece por encima de su tamaño aunque el contexto sí", () => {
    const g12 = byId("gemma-3-12b-it-q4km");
    const at1k = kvCacheBytes(g12.arch, 1024);
    const at2k = kvCacheBytes(g12.arch, 2048);
    // Al pasar de 1.024 a 2.048 solo crecen las 8 capas globales.
    expect(at2k - at1k).toBe(2 * 8 * 1024 * 8 * 256 * 2);
  });
});

describe("defaultModelForBudget — la escalera de defaults", () => {
  it("sigue el presupuesto, no la RAM bruta", () => {
    expect(defaultModelForBudget(1.5 * GIB).id).toBe("qwen3-0.6b-q4km");
    expect(defaultModelForBudget(3 * GIB).id).toBe("qwen3-1.7b-q4km");
    expect(defaultModelForBudget(5 * GIB).id).toBe("qwen3-4b-instruct-2507-q4km");
    expect(defaultModelForBudget(8 * GIB).id).toBe("qwen2.5-7b-instruct-q4km");
    expect(defaultModelForBudget(12 * GIB).id).toBe("qwen3-8b-q4km");
    expect(defaultModelForBudget(25 * GIB).id).toBe("qwen3-30b-a3b-instruct-2507-q4km");
  });

  it("el default de cada clase cabe en verde en su clase de máquina", () => {
    for (const gb of [8, 16, 32]) {
      const snap = machine(gb);
      const chosen = defaultModelForBudget(availableBudgetBytes(snap));
      const plan = planDesktopContext(chosen, snap)!;
      expect(plan.fit, `${gb} GiB -> ${chosen.id}`).toBe("green");
    }
  });
});
