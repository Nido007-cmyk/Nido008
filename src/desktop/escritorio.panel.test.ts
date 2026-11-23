/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.panel — E11 paso 5: el panel de sesión que
 * crece el pie de cifras de la barra (`src/desktop/panel.ts`).
 * Contrato de cifras como conducta (el del móvil): cada
 * cifra enseñada tiene su fuente viva nombrada — las
 * mediciones del gestor de modelos que `boot.stats` ya trae
 * y `ram.ts` —; lo que no se puede medir no se enseña, con
 * su hueco declarado en la forma del pie de hoy. Ninguna
 * cifra fabricada, estimada ni heredada de un papel.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Panel = typeof import("./panel.js");
let pieza: Panel | null = null;
beforeAll(async () => {
  pieza = await import("./panel.js").catch(() => null);
});
function P(): Panel {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/panel.ts (el panel de sesión de E11 paso 5 no está construido)",
    );
  return pieza;
}

type Sources = import("./panel.js").PanelSources;
const full: Sources = {
  ramUsedBytes: 5 * 2 ** 30,
  ramTotalBytes: 16 * 2 ** 30,
  diskUsedBytes: 120 * 2 ** 30,
  diskTotalBytes: 512 * 2 ** 30,
  lastGenRate: 42.5,
  modelName: "Qwen3 8B",
  modelSizeBytes: 5.2 * 2 ** 30,
  contextSize: 32768,
  contextUsedFraction: 0.25,
  memoryUsedBytes: () => 640 * 2 ** 20,
};
const byId = (figs: import("./panel.js").PanelFigure[], id: string) => figs.find((f) => f.id === id);

describe("escritorio.panel · cada cifra contra su fuente, al momento de leerla", () => {
  it("la cifra del modelo es la de su fuente: el modelo activo y su tamaño, ni otro ni estimado", () => {
    const m = P();
    const fig = byId(m.composePanelFigures(full), "model");
    expect(fig).toBeDefined();
    expect(fig!.hole).toBe(false);
    expect(fig!.text).toContain("Qwen3 8B");
    // Otra fuente, otra cifra: la figura sigue a la fuente.
    const other = byId(
      m.composePanelFigures({ ...full, modelName: "LFM2.5 1.2B", modelSizeBytes: 1.2 * 2 ** 30 }),
      "model",
    );
    expect(other!.text).toContain("LFM2.5 1.2B");
    expect(other!.text).not.toContain("Qwen3 8B");
  });

  it("la cifra de contexto es la de su fuente: el tamaño de contexto y su fracción usada", () => {
    const m = P();
    const fig = byId(m.composePanelFigures(full), "context");
    expect(fig).toBeDefined();
    expect(fig!.hole).toBe(false);
    expect(fig!.text).toContain("32768");
    const other = byId(m.composePanelFigures({ ...full, contextSize: 8192 }), "context");
    expect(other!.text).toContain("8192");
    expect(other!.text).not.toContain("32768");
  });

  it("la cifra de velocidad es la tasa real de la última generación de su fuente", () => {
    const m = P();
    const fig = byId(m.composePanelFigures(full), "rate");
    expect(fig).toBeDefined();
    expect(fig!.hole).toBe(false);
    expect(fig!.text).toContain("42.5");
  });

  it("sin tasa real no hay cifra: la figura de velocidad cae en su hueco declarado, sin inventar un cero", () => {
    const m = P();
    const fig = byId(m.composePanelFigures({ ...full, lastGenRate: null }), "rate");
    expect(fig).toBeDefined();
    expect(fig!.hole).toBe(true);
    expect(fig!.text).not.toContain("0");
    expect(fig!.text.length).toBeGreaterThan(0); // el hueco se dice, no se calla
  });

  it("con su fuente apagada, la cifra de disco enseña el hueco del pie de hoy («—»)", () => {
    const m = P();
    const fig = byId(
      m.composePanelFigures({ ...full, diskUsedBytes: null, diskTotalBytes: null }),
      "disk",
    );
    expect(fig).toBeDefined();
    expect(fig!.hole).toBe(true);
    expect(fig!.text).toBe("—");
  });

  it("la foto de memoria se refresca: dos lecturas en dos momentos enseñan lo que la fuente dice en cada una", () => {
    const m = P();
    let now = 640 * 2 ** 20;
    const src = { ...full, memoryUsedBytes: () => now };
    const first = byId(m.composePanelFigures(src), "memory");
    now = 900 * 2 ** 20;
    const second = byId(m.composePanelFigures(src), "memory");
    expect(first!.text).not.toBe(second!.text);
    expect(second!.text).toContain("900");
  });
});
