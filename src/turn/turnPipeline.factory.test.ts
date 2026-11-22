/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * F-3 (auditoría del respaldo en el pipeline) nació para
 * ejercer la clase ligera de máquina en la fábrica, que
 * ninguna batería tocaba: su forma original certificaba
 * que el respaldo del planificador era el peldaño de la
 * escalera de presupuesto de cada clase (el ligero en la
 * ligera, el mayor en la grande). La pieza de los
 * modelos sin roles suprime ese asiento por dirimen de
 * la casa — el respaldo pasa a ser el modelo ACTIVO de
 * la persona, en la forma del móvil, y la escalera queda
 * como recomendación en el gestor y en la tarjeta — así
 * que los dos casos de F-3 se re-fundaron sobre la
 * mecánica nueva conservando su propósito y su
 * simulación: con el mismo activo declarado, la clase
 * ligera y la clase grande nombran EL ACTIVO y no su
 * peldaño. La pieza añade sus casos en el segundo
 * describe: sin activo declarado el respaldo queda sin
 * nombrar, el preset de Ajustes llega a los deps, y las
 * asignaciones de Ajustes llegan y mandan por la puerta
 * 1 de resolveModelForRole.
 *
 * La clase se simula como siempre: node:os se sustituye
 * con el estado hoisted (total y libre). Los ajustes se
 * sustituyen con el estado hoisted de los tres getters
 * (activo, preset, asignaciones), y el directorio de
 * modelos de la fachada sale del estado hoisted (null:
 * sin disco, la presencia sale medida en falso y la
 * fábrica no toca el sistema de ficheros).
 */
import { describe, it, expect, vi } from "vitest";

const osState = vi.hoisted(() => ({ total: 0, free: 0 }));

const settingsState = vi.hoisted(() => ({
  active: null as string | null,
  preset: "balanced" as "balanced" | "simple" | "research" | "custom",
  assignments: {} as Partial<Record<string, string>>,
}));

const dirState = vi.hoisted(() => ({ dir: null as string | null }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    totalmem: () => osState.total,
    freemem: () => osState.free,
  };
});

vi.mock("../inference/LlamaEngine.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, llamaModelsDir: () => dirState.dir };
});

vi.mock("../models/settings.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getActiveModelId: async () => settingsState.active,
    getRoutingPreset: async () => settingsState.preset,
    getModelRoleAssignments: async () => settingsState.assignments,
  };
});

import { productionTurnDeps } from "./turnPipeline.js";
import { buildModelProfiles } from "../routing/profiles.js";

const GIB = 1024 * 1024 * 1024;
const ACTIVE = "qwen2.5-1.5b-instruct-q4km";

function seedSettings(partial: Partial<typeof settingsState>): void {
  settingsState.active = partial.active ?? null;
  settingsState.preset = partial.preset ?? "balanced";
  settingsState.assignments = partial.assignments ?? {};
  dirState.dir = null;
}

async function deps() {
  return productionTurnDeps({
    handlers: {},
    packFacts: async () => ({ regions: [], facts: [] }),
  });
}

describe("productionTurnDeps factory — machine class (F-3)", () => {
  it("a light machine names the user's active model as the fallback, not its light rung", async () => {
    seedSettings({ active: ACTIVE });
    osState.total = 2 * GIB;
    osState.free = Math.floor(1.5 * GIB);
    expect((await deps()).fallbackModelId).toBe(ACTIVE);
  });

  it("a large machine names the same active model, not its largest rung", async () => {
    seedSettings({ active: ACTIVE });
    osState.total = 64 * GIB;
    osState.free = 40 * GIB;
    expect((await deps()).fallbackModelId).toBe(ACTIVE);
  });
});

describe("productionTurnDeps factory — los ajustes de la persona mandan (pieza de los modelos sin roles)", () => {
  it("sin modelo activo declarado, el respaldo queda sin nombrar y el preset es el de por defecto", async () => {
    seedSettings({ active: null });
    osState.total = 2 * GIB;
    osState.free = Math.floor(1.5 * GIB);
    const d = await deps();
    expect(d.fallbackModelId).toBeUndefined();
    expect(d.preset).toBe("balanced");
  });

  it("el preset guardado en Ajustes llega a los deps", async () => {
    seedSettings({ active: ACTIVE, preset: "research" });
    expect((await deps()).preset).toBe("research");
  });

  it("las asignaciones guardadas llegan y mandan por la puerta 1", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "nido-roles-"));
    writeFileSync(join(dir, "qwen2.5-0.5b-instruct-q4km.gguf"), "gguf");
    seedSettings({ active: null, assignments: { general: "qwen2.5-0.5b-instruct-q4km" } });
    dirState.dir = dir;
    try {
      const d = await deps();
      expect(d.roleAssignments).toEqual({ general: "qwen2.5-0.5b-instruct-q4km" });
      const profiles = buildModelProfiles(
        d.preset ?? "balanced",
        d.availableModels,
        d.roleAssignments ?? {},
        8 * GIB,
        d.fallbackModelId,
      );
      const general = profiles.find((p) => p.role === "general");
      expect(general?.enabled).toBe(true);
      expect(general?.modelId).toBe("qwen2.5-0.5b-instruct-q4km");
      expect(general?.userOverride).toBe(true);
    } finally {
      dirState.dir = null;
    }
  });
});
