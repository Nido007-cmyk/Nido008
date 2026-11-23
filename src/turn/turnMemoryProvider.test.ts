/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la Pieza B de H-01 (cadena de curas, acto 5): el
 * turno de producción LEE la memoria guardada. Hasta la cura,
 * `productionTurnDeps` dejaba `loadMemory` y
 * `loadMemoryQueryData` en undefined y el bucle corría sin
 * memoria: lo guardado no volvía nunca a la conversación. Los
 * dos casos cobran que los deps de producción traen el
 * snapshot del almacén — el del turno (hechos, preferencias,
 * personas y diario) y el de la bifurcación de consultas
 * (hechos y personas) — sembrado en la base real.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../security/appStore.js";
import { closeDatabase } from "../security/databaseManager.js";
import * as memoryStore from "../agent/memory/memoryStore.js";
import { productionTurnDeps } from "./turnPipeline.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-h01-turno-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const partial = {
  handlers: {},
  packFacts: async () => ({ regions: [], facts: [] }),
};

describe("H-01 Pieza B · el turno de producción lee la memoria guardada", () => {
  it("loadMemory trae el snapshot: hechos, preferencias, personas y diario", async () => {
    await memoryStore.saveFact({ content: "Mi color favorito es el verde" });
    await memoryStore.setPreference("name", "Aldo");
    await memoryStore.savePerson({ name: "Carmen Ruiz", relationship: "hermana" });
    await memoryStore.logDay("Hoy llegó el paquete", "2026-11-22");

    const deps = await productionTurnDeps(partial);
    expect(deps.loadMemory).toBeDefined();
    const mem = await deps.loadMemory!();
    expect(mem?.facts.map((f) => f.content)).toContain("Mi color favorito es el verde");
    expect(mem?.preferences.find((p) => p.key === "name")?.value).toBe("Aldo");
    expect(mem?.people.map((p) => p.name)).toContain("Carmen Ruiz");
    expect(mem?.recentLog.map((e) => e.entry)).toContain("Hoy llegó el paquete");
  });

  it("loadMemoryQueryData trae los hechos y las personas de la bifurcación", async () => {
    await memoryStore.saveFact({ content: "Mi perro se llama Toby" });
    await memoryStore.savePerson({ name: "Bruno Díaz", relationship: "primo" });

    const deps = await productionTurnDeps(partial);
    expect(deps.loadMemoryQueryData).toBeDefined();
    const data = await deps.loadMemoryQueryData!();
    expect(data?.facts.map((f) => f.content)).toContain("Mi perro se llama Toby");
    expect(data?.people.map((p) => p.name)).toContain("Bruno Díaz");
    expect(data?.people.find((p) => p.name === "Bruno Díaz")?.relationship).toBe("primo");
  });
});
