/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.zoom — E11 paso 6: el zoom en cinco escalones
 * discretos (D-3 dirimido en su forma A), como extensión del
 * ajuste `FontScale` del almacén cifrado
 * (`src/desktop/zoom.ts` + la extensión del tipo en
 * `src/models/settings.ts`). Una sola tabla escalón→factor
 * alimenta `--font-scale`, acotada por las razones medidas
 * del móvil (cuerpo ≈ ×0,89 en compacto y ≈ ×1,21 en grande
 * sobre el estándar). La migración de la escala numérica
 * retirada se cobra en sus dos casos diseñados.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

const fx = vi.hoisted(() => {
  const files = new Map<string, string>();
  return { DOC: "file:///docs/", files, reset: () => files.clear() };
});
vi.mock("../security/fileSystem.js", () => ({
  documentDirectory: fx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fx.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const v = fx.files.get(from);
    if (v !== undefined) {
      fx.files.set(to, v);
      fx.files.delete(from);
    }
  },
}));

type Zoom = typeof import("./zoom.js");
let pieza: Zoom | null = null;
beforeAll(async () => {
  pieza = await import("./zoom.js").catch(() => null);
});
function P(): Zoom {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/zoom.ts (el zoom en cinco escalones de E11 paso 6 no está construido)",
    );
  return pieza;
}

describe("escritorio.zoom · los cinco escalones y su tabla", () => {
  it("son exactamente cinco escalones en orden, con standard en el centro y los tres heredados en su sitio", () => {
    const m = P();
    const ids = m.FONT_SCALE_STEPS.map((s) => s.id);
    expect(ids.length).toBe(5);
    expect(ids[2]).toBe("standard");
    expect(ids).toContain("compact");
    expect(ids).toContain("large");
    expect(ids.indexOf("compact")).toBe(1);
    expect(ids.indexOf("large")).toBe(3);
    // Ni un sexto valor ni un valor con otro nombre: los dos
    // nuevos son los extremos, acuñados por el paso.
    expect(new Set(ids).size).toBe(5);
  });

  it("la tabla escalón→factor es una sola, creciente, con standard en 1 y acotada por las razones del móvil", () => {
    const m = P();
    const factors = m.FONT_SCALE_STEPS.map((s) => s.factor);
    for (let i = 1; i < factors.length; i++) expect(factors[i]).toBeGreaterThan(factors[i - 1]);
    const byId = new Map(m.FONT_SCALE_STEPS.map((s) => [s.id, s.factor]));
    expect(byId.get("standard")).toBe(1);
    // La cota medida del móvil: cuerpo ≈ ×0,89 compacto, ≈ ×1,21 grande.
    expect(Math.abs((byId.get("compact") ?? 0) - 0.89)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((byId.get("large") ?? 0) - 1.21)).toBeLessThanOrEqual(0.02);
    expect(m.fontScaleFactor("standard")).toBe(1);
  });

  it("Ctrl+0 cae en standard: el escalón de vuelta es el central, el mismo por teclado que por ajustes", () => {
    const m = P();
    expect(m.FONT_SCALE_STEPS[m.FONT_SCALE_STEPS.length >> 1].id).toBe("standard");
    expect(m.resetFontScaleStep()).toBe("standard");
    expect(m.resetFontScaleStep()).toBe(m.FONT_SCALE_STEPS[2].id);
  });

  it("el escalón persiste en el almacén cifrado: los extremos nuevos se escriben y se releen enteros", async () => {
    const m = P();
    const settings = await import("../models/settings.js");
    const first = m.FONT_SCALE_STEPS[0].id;
    const last = m.FONT_SCALE_STEPS[4].id;
    await settings.setFontScale(first as never);
    expect(await settings.getFontScale()).toBe(first);
    await settings.setFontScale(last as never);
    expect(await settings.getFontScale()).toBe(last);
    await settings.setFontScale("standard");
    expect(await settings.getFontScale()).toBe("standard");
  });
});

describe("escritorio.zoom · la migración de la escala numérica retirada (los 2 diseñados)", () => {
  it("el número guardado se cobra como el escalón más cercano en el primer arranque", () => {
    const m = P();
    // Para cada número de la vieja grampa (1…1,4), el escalón
    // cobrado es el de factor más cercano de la tabla construida.
    for (const saved of [1, 1.1, 1.25, 1.32, 1.4]) {
      const step = m.migrateNumericFontScale(saved);
      const nearest = m.FONT_SCALE_STEPS.reduce((a, b) =>
        Math.abs(b.factor - saved) < Math.abs(a.factor - saved) ? b : a,
      );
      expect(step, `guardado ${saved}`).toBe(nearest.id);
    }
    expect(m.migrateNumericFontScale(1)).toBe("standard");
  });

  it("sin número guardado, o ya retirado, el arranque cae en standard sin error", () => {
    const m = P();
    expect(m.migrateNumericFontScale(undefined)).toBe("standard");
    expect(m.migrateNumericFontScale(null)).toBe("standard");
  });
});
