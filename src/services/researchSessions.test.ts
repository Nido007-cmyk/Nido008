/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchSessions.test.ts — E10 (paso 6): el almacén de
 * sesiones sobre la memoria cifrada real: la foto entra al
 * cerrar una etapa y avanza etapa a etapa, la lista enseña
 * el avance, el borrado la retira, una base v1 sube a v2 con
 * la tabla puesta, y el fichero en reposo no lleva ni la
 * pregunta ni una subrespuesta en claro.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../security/appStore.js";
import { closeDatabase, getDatabase } from "../security/databaseManager.js";
import {
  deleteResearchSession,
  getResearchSession,
  listResearchSessions,
  saveResearchSessionStage,
} from "./researchSessions.js";
import type { ResearchSessionSnapshot } from "./orchestrator.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e10-sesiones-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const QUERY = "¿Cómo cruzaban los valles los acueductos?";

function snapshot(stage: ResearchSessionSnapshot["stage"], passes: number): ResearchSessionSnapshot {
  return {
    stage,
    subQuestions: ["¿Cómo mantenían la pendiente?", "¿Qué estructuras cruzaban el valle?"],
    passes: Array.from({ length: passes }, (_, i) => ({
      result: {
        subQuestion: `pregunta ${i}`,
        answer: `La respuesta juzgada ${i} del acueducto secreto.`,
        sourceCount: 1,
        verdict: { status: "supported" as const, kept: 2, removed: 0 },
      },
      chunks: [],
    })),
    contrast: null,
    gapRoundUsed: false,
  };
}

const META = { id: "sesion-1", query: QUERY, lang: "es", scope: "both", style: "completo" };

describe("E10 paso 6 · sesiones en la memoria cifrada", () => {
  it("la foto avanza por etapas sobre la misma fila y se lee entera", async () => {
    await saveResearchSessionStage({ ...META, snapshot: snapshot("plan", 0) });
    await saveResearchSessionStage({ ...META, snapshot: snapshot("passes", 1) });
    await saveResearchSessionStage({ ...META, snapshot: snapshot("passes", 2) });
    const row = await getResearchSession("sesion-1");
    expect(row).not.toBeNull();
    expect(row!.stage).toBe("passes");
    expect(row!.snapshot.passes.length).toBe(2);
    expect(row!.snapshot.passes[1].result.answer).toContain("acueducto secreto");
    const list = await listResearchSessions();
    expect(list.length).toBe(1);
    expect(list[0].closedPasses).toBe(2);
    expect(list[0].planSize).toBe(2);
  });

  it("borrar la sesión la retira de la base y de la lista", async () => {
    await saveResearchSessionStage({ ...META, snapshot: snapshot("plan", 0) });
    await deleteResearchSession("sesion-1");
    expect(await getResearchSession("sesion-1")).toBeNull();
    expect(await listResearchSessions()).toEqual([]);
  });

  it("la base nace en v2 y la tabla de sesiones existe", async () => {
    const db = await getDatabase();
    const version = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version';",
    );
    expect(version?.value).toBe("2");
    const table = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'research_sessions';",
    );
    expect(table?.name).toBe("research_sessions");
  });

  it("en reposo no hay claro: ni la pregunta ni una subrespuesta están en el fichero", async () => {
    await saveResearchSessionStage({ ...META, snapshot: snapshot("passes", 1) });
    const raw = readFileSync(join(dir, "nido_memory.db"));
    expect(raw.includes(Buffer.from("acueductos"))).toBe(false);
    expect(raw.includes(Buffer.from("acueducto secreto"))).toBe(false);
  });
});
