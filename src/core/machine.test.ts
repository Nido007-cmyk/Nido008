/**
 * La foto de la máquina (E4, paso 1): composición de la foto
 * desde lecturas inyectadas, la caída honesta sin medición
 * (prueba 6 de la etapa en su mitad de foto) y el presupuesto
 * canónico de la lección 3.
 */

import { describe, expect, it } from "vitest";
import { canonicalBudgetBytes, machineSnapshot, type MachineReaders } from "./machine.js";
import { availableBudgetBytes, GIB, planDesktopContext } from "./ram.js";
import { DESKTOP_CATALOG } from "./catalog.js";

function readers(total: number, free: number | undefined): MachineReaders {
  return { totalRamBytes: () => total, freeRamBytes: () => free };
}

describe("foto de la máquina", () => {
  it("compone total, libre y liberable de las lecturas y del parámetro", () => {
    const snap = machineSnapshot(512, readers(16 * GIB, 6 * GIB));
    expect(snap).toEqual({
      totalRamBytes: 16 * GIB,
      freeRamBytes: 6 * GIB,
      releasableBytes: 512,
    });
  });

  it("sin residente, la foto no trae crédito", () => {
    const snap = machineSnapshot(undefined, readers(8 * GIB, 3 * GIB));
    expect(snap.releasableBytes).toBeUndefined();
  });

  it("si la lectura del libre no llega, la foto cae a la cuenta por el total", () => {
    const snap = machineSnapshot(undefined, readers(8 * GIB, undefined));
    expect(snap.freeRamBytes).toBeUndefined();
    expect(availableBudgetBytes(snap)).toBe(availableBudgetBytes({ totalRamBytes: 8 * GIB }));
  });

  it("un libre de cero no es una medición en vivo", () => {
    const snap = machineSnapshot(undefined, readers(8 * GIB, 0));
    expect(snap.freeRamBytes).toBeUndefined();
  });

  it("prueba 6 (mitad de foto): sin lectura de total no hay foto usable y el plan es null", () => {
    const snap = machineSnapshot(undefined, readers(0, undefined));
    expect(snap.totalRamBytes).toBe(0);
    const spec = DESKTOP_CATALOG[0]!;
    expect(planDesktopContext(spec, snap)).toBeNull();
  });

  it("el presupuesto canónico es la cuenta por el total, sin libre ni liberable", () => {
    for (const gib of [8, 16, 32]) {
      expect(canonicalBudgetBytes(gib * GIB)).toBe(
        availableBudgetBytes({ totalRamBytes: gib * GIB }),
      );
    }
    expect(canonicalBudgetBytes(0)).toBe(0);
  });
});
