/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchReports.test.ts — E10 (paso 5): el almacén de
 * informes sobre la memoria cifrada real: el documento de
 * una corrida entra, se lee, se lista y se borra en la base
 * de la persona, y el fichero en disco no lleva la pregunta
 * en claro (la bóveda cifra en reposo).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../security/appStore.js";
import { closeDatabase } from "../security/databaseManager.js";
import {
  deleteResearchReport,
  getResearchReport,
  listResearchReports,
  saveResearchReport,
} from "./researchReports.js";
import type { ResearchReceipt } from "./researchReport.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e10-informes-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const RECEIPT: ResearchReceipt = {
  claims: [
    {
      claim: "The arcade kept the slope.",
      citations: [{ n: 1, chunkId: "aq", docId: "doc-aq", title: "Aqueducts" }],
    },
  ],
  run: {
    model: "qwen3-4b-instruct-2507-q4km",
    style: "completo",
    stages: [{ stage: "decompose", ms: 10, tokens: 5 }],
    totalMs: 100,
    totalTokens: 42,
    rateTokPerSec: 1.8,
    passes: [],
    finalJudge: { kept: 1, removed: 0 },
    judgeMs: 3,
    fragmentsConsulted: 1,
    contrast: null,
    gapRoundUsed: false,
    gapsDeclared: [],
  },
};

const QUERY = "¿Cómo cruzaban los valles los acueductos?";

describe("E10 paso 5 · informes guardados en la memoria cifrada", () => {
  it("guardar y leer: el documento lleva la pregunta, el informe y el recibo", async () => {
    const saved = await saveResearchReport({
      query: QUERY,
      style: "completo",
      completoText: "The arcade kept the slope [1].",
      receipt: RECEIPT,
      lang: "es",
    });
    const read = await getResearchReport(saved.id);
    expect(read).not.toBeNull();
    expect(read!.query).toBe(QUERY);
    expect(read!.document).toContain("The arcade kept the slope [1].");
    expect(read!.document).toContain("Modelo: qwen3-4b-instruct-2507-q4km");
    expect(read!.receipt.run.model).toBe("qwen3-4b-instruct-2507-q4km");
  });

  it("listar y borrar: el borrado deja la lista sin el informe", async () => {
    const a = await saveResearchReport({
      query: QUERY,
      style: "ejecutivo",
      completoText: "One [1].",
      receipt: RECEIPT,
      lang: "en",
    });
    await saveResearchReport({
      query: "otra pregunta",
      style: "completo",
      completoText: "Two [1].",
      receipt: RECEIPT,
      lang: "en",
    });
    expect((await listResearchReports()).length).toBe(2);
    await deleteResearchReport(a.id);
    const left = await listResearchReports();
    expect(left.length).toBe(1);
    expect(left[0].query).toBe("otra pregunta");
    expect(await getResearchReport(a.id)).toBeNull();
  });

  it("en reposo no hay claro: el fichero de la base no contiene la pregunta", async () => {
    await saveResearchReport({
      query: QUERY,
      style: "completo",
      completoText: "The arcade kept the slope [1].",
      receipt: RECEIPT,
      lang: "es",
    });
    const raw = readFileSync(join(dir, "nido_memory.db"));
    expect(raw.includes(Buffer.from("acueductos"))).toBe(false);
    expect(raw.includes(Buffer.from("arcade kept"))).toBe(false);
  });
});
