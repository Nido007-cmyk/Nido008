/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería de la derivación de tarjetas (paso 2 de E4):
 * las pruebas 1 a 7 de la hoja de la etapa
 * (estudios/MODELOS-ETAPA.md §5) y la 18, la tabla derivada
 * contra el informe del catálogo. Sin red y sin disco: la
 * foto, el censo y las transferencias son datos inyectados.
 */

import { describe, expect, it } from "vitest";
import { DESKTOP_CATALOG, defaultModelForBudget } from "./catalog.js";
import type { DiskState } from "./library.js";
import { canonicalBudgetBytes } from "./machine.js";
import { deriveCards, type ModelTransfer } from "./modelCards.js";
import {
  availableBudgetBytes,
  planDesktopContext,
  type MachineSnapshot,
} from "./ram.js";

const GiB = 1024 * 1024 * 1024;
const byId = (cards: ReturnType<typeof deriveCards>, id: string) => {
  const c = cards.find((x) => x.entry.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
};
const NO_CENSUS = new Map<string, DiskState>();
const NO_TRANSFERS = new Map<string, ModelTransfer>();
const derive = (snapshot: MachineSnapshot, extra?: Partial<Parameters<typeof deriveCards>[0]>) =>
  deriveCards({
    snapshot,
    canonicalBudget: canonicalBudgetBytes(snapshot.totalRamBytes || 8 * GiB),
    census: NO_CENSUS,
    residentId: null,
    transfers: NO_TRANSFERS,
    ...extra,
  });

describe("paso 2 · derivación de tarjetas", () => {
  it("prueba 1 · el residente no se juzga apilado sobre sí mismo: con su crédito, su tarjeta es el plan de la máquina limpia", () => {
    const total = 8 * GiB;
    const clean: MachineSnapshot = { totalRamBytes: total };
    const resident = DESKTOP_CATALOG.find((e) => e.id === "qwen3-4b-instruct-2507-q4km")!;
    const cleanPlan = planDesktopContext(resident, clean)!;
    const footprint = cleanPlan.workingSet.totalBytes;
    const freeBusy = availableBudgetBytes(clean) - footprint;
    const busy: MachineSnapshot = { totalRamBytes: total, freeRamBytes: freeBusy };
    const credited: MachineSnapshot = { ...busy, releasableBytes: footprint };

    const busyCard = byId(derive(busy, { residentId: resident.id }), resident.id);
    expect(busyCard.plan!.fit).not.toBe(cleanPlan.fit);

    const creditedCards = derive(credited, { residentId: resident.id });
    const residentCard = byId(creditedCards, resident.id);
    expect(residentCard.plan!.fit).toBe(cleanPlan.fit);
    expect(residentCard.plan!.contextSize).toBe(cleanPlan.contextSize);
    expect(residentCard.state).toBe("active");

    // Y las demás tarjetas se derivan contra la foto con el
    // crédito: la memoria del residente vuelve al cambiar.
    const other = DESKTOP_CATALOG.find((e) => e.id === "qwen3-1.7b-q4km")!;
    const otherCard = byId(creditedCards, other.id);
    const otherPlan = planDesktopContext(other, credited)!;
    expect(otherCard.plan!.fit).toBe(otherPlan.fit);
    expect(otherCard.plan!.contextSize).toBe(otherPlan.contextSize);
  });

  it("prueba 2 · sin lectura de RAM: ningún plan, y el recomendado sigue siendo el de la escalera", () => {
    const cards = derive({ totalRamBytes: 0 }, { canonicalBudget: canonicalBudgetBytes(8 * GiB) });
    expect(cards.every((c) => c.plan === null)).toBe(true);
    const recommended = cards.filter((c) => c.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].entry.id).toBe(defaultModelForBudget(canonicalBudgetBytes(8 * GiB)).id);
  });

  it("prueba 3 · el recomendado es exactamente defaultModelForBudget(canónico) en 8/16/32 GiB, y en 8 GiB nunca es rojo", () => {
    for (const gb of [8, 16, 32]) {
      const snapshot: MachineSnapshot = { totalRamBytes: gb * GiB };
      const cards = derive(snapshot);
      const recommended = cards.filter((c) => c.recommended);
      expect(recommended, `${gb} GiB`).toHaveLength(1);
      expect(recommended[0].entry.id).toBe(defaultModelForBudget(canonicalBudgetBytes(gb * GiB)).id);
      if (gb === 8) expect(recommended[0].plan!.fit).not.toBe("red");
    }
  });

  it("prueba 4 · el estado sale del censo y de las transferencias, con su precedencia", () => {
    const census = new Map<string, DiskState>([
      ["qwen3-0.6b-q4km", { kind: "installed", bytes: 1, verified: true, source: "scan" }],
      ["qwen2.5-0.5b-instruct-q4km", { kind: "installed", bytes: 1, verified: false, source: "scan" }],
      ["qwen2.5-1.5b-instruct-q4km", { kind: "partial", bytes: 10 }],
      ["qwen3-1.7b-q4km", { kind: "checking" }],
      ["qwen3-4b-instruct-2507-q4km", { kind: "installed", bytes: 1, verified: true, source: "scan" }],
      ["qwen2.5-7b-instruct-q4km", { kind: "partial", bytes: 5 }],
      ["lfm2.5-8b-a1b-q4km", { kind: "partial", bytes: 5 }],
    ]);
    const transfers = new Map<string, ModelTransfer>([
      ["qwen2.5-7b-instruct-q4km", { downloadedBytes: 5, paused: false }],
      ["lfm2.5-8b-a1b-q4km", { downloadedBytes: 5, paused: true }],
    ]);
    const cards = derive(
      { totalRamBytes: 16 * GiB },
      { census, transfers, residentId: "qwen3-4b-instruct-2507-q4km" },
    );
    expect(byId(cards, "qwen3-4b-instruct-2507-q4km").state).toBe("active"); // residente manda sobre en disco
    expect(byId(cards, "qwen2.5-7b-instruct-q4km").state).toBe("downloading"); // transferencia manda sobre parcial
    expect(byId(cards, "lfm2.5-8b-a1b-q4km").state).toBe("paused");
    expect(byId(cards, "qwen2.5-1.5b-instruct-q4km").state).toBe("partial");
    expect(byId(cards, "qwen3-1.7b-q4km").state).toBe("checking");
    expect(byId(cards, "qwen3-0.6b-q4km").state).toBe("on-disk");
    expect(byId(cards, "qwen2.5-0.5b-instruct-q4km").state).toBe("mismatch");
    expect(byId(cards, "qwen3-8b-q4km").state).toBe("not-downloaded");
    // Acciones principales por estado.
    expect(byId(cards, "qwen3-0.6b-q4km").action).toBe("use");
    expect(byId(cards, "qwen2.5-0.5b-instruct-q4km").action).toBe("redownload");
    expect(byId(cards, "qwen2.5-1.5b-instruct-q4km").action).toBe("continue");
    expect(byId(cards, "qwen2.5-7b-instruct-q4km").action).toBe("pause");
    expect(byId(cards, "lfm2.5-8b-a1b-q4km").action).toBe("continue");
    expect(byId(cards, "qwen3-8b-q4km").action).toBe("download");
    expect(byId(cards, "qwen3-1.7b-q4km").action).toBe("none");
  });

  it("prueba 5 · el desglose de cada tarjeta suma el total del plan, y el color es el del plan", () => {
    for (const gb of [8, 16, 32]) {
      const cards = derive({ totalRamBytes: gb * GiB });
      for (const card of cards) {
        if (!card.plan) continue;
        const w = card.plan.workingSet;
        expect(
          w.weightsBytes + w.kvBytes + w.computeBytes + w.logitsBytes,
          `${card.entry.id} en ${gb} GiB`,
        ).toBe(w.totalBytes);
        expect(["green", "yellow", "red"]).toContain(card.plan.fit);
      }
    }
  });

  it("prueba 6 · la tarjeta del residente declara residente y plan: de ahí sale el texto de la acción con residente", () => {
    const cards = derive(
      { totalRamBytes: 16 * GiB },
      { residentId: "qwen3-1.7b-q4km" },
    );
    const resident = byId(cards, "qwen3-1.7b-q4km");
    expect(resident.resident).toBe(true);
    expect(resident.state).toBe("active");
    expect(cards.filter((c) => c.resident)).toHaveLength(1);
    // Sin residente, ninguna tarjeta se marca activa.
    expect(derive({ totalRamBytes: 16 * GiB }).some((c) => c.state === "active")).toBe(false);
  });

  it("prueba 7 · la degradación distingue el peldaño del suelo q8 desde los campos del plan", () => {
    // Peldaño: el 14B en 16 GiB baja de su techo en fp16.
    const cards16 = derive({ totalRamBytes: 16 * GiB });
    const stepDown = byId(cards16, "qwen3-14b-q4km");
    expect(stepDown.plan!.fit).toBe("yellow");
    expect(stepDown.degradation).toBe("step-down");
    // Suelo: se busca una clase donde el 8B solo quepa en el
    // mínimo con la KV a q8, y la tarjeta lo nombra suelo.
    let floorFound = false;
    for (let total = 6 * GiB; total <= 10 * GiB; total += GiB / 4) {
      const card = byId(derive({ totalRamBytes: total }), "qwen3-8b-q4km");
      if (card.plan?.fit === "yellow" && card.degradation === "floor-q8") {
        expect(card.plan.contextSize).toBe(2048);
        floorFound = true;
        break;
      }
    }
    expect(floorFound).toBe(true);
    // Verde y rojo no degradan.
    expect(byId(cards16, "qwen3-0.6b-q4km").degradation).toBe("none");
    expect(byId(cards16, "qwen3-32b-q4km").degradation).toBe("none");
  });

  it("prueba 18 · las tarjetas coinciden con la tabla del informe del catálogo (npm run catalog) en 8/16/32 GiB", () => {
    for (const gb of [8, 16, 32]) {
      const snapshot: MachineSnapshot = { totalRamBytes: gb * GiB };
      const budget = availableBudgetBytes(snapshot);
      const cards = derive(snapshot);
      // El informe imprime el defecto de la clase y, por cada
      // LLM, el plan de planDesktopContext sobre la misma
      // foto: la tarjeta tiene que cobrar lo mismo.
      const recommended = cards.filter((c) => c.recommended);
      expect(recommended[0].entry.id).toBe(defaultModelForBudget(budget).id);
      for (const entry of DESKTOP_CATALOG) {
        if (entry.kind !== "llm") continue;
        const expected = planDesktopContext(entry, snapshot)!;
        const card = byId(cards, entry.id);
        expect(card.plan!.fit, `${entry.id} en ${gb} GiB`).toBe(expected.fit);
        expect(card.plan!.contextSize, `${entry.id} en ${gb} GiB`).toBe(expected.contextSize);
      }
    }
  });
});
