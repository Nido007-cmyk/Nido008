/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * paridadGuia.test.ts — H-GUIA-1: la paridad trilingüe de las
 * formas de memoria que la guía promete, cazada por la medición
 * de la pasada de la guía (2026-11-20).
 *
 * El defecto, medido contra el turno real: la capa determinista
 * servía en español formas que en inglés y portugués caían al
 * modelo o a «no supe qué acción»:
 *
 *  - La orden de guardar un dato («remember that…», «lembra
 *    que…») clasifica «recordar» y la bifurcación del pipeline
 *    le cerraba la puerta (la puerta de las preguntas de memoria
 *    exige datos que ningún llamador de producción provee), así
 *    que la orden nunca llegaba al loop que la extrae. Su gemela
 *    española («recuerda que…») clasifica «actuar» y se guarda.
 *  - La lista de notas: «¿qué notas tengo guardadas?»,
 *    «what notes do I have saved?» y «que notas eu tenho
 *    salvas?» rompían el anclaje de NOTE_LIST_RULES, cuyas
 *    gemelas sin el adjetivo sí entraban.
 *
 * La cura cobra las dos mitades en su forma: la puerta de la
 * bifurcación se abre para la orden explícita de memoria (el
 * extractor de datos es su medida: si el loop va a extraer un
 * dato, la orden entra), y las reglas de la lista admiten el
 * adjetivo en los tres idiomas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractToolAction } from "./toolRouter.js";

const facade = vi.hoisted(() => ({
  generate: vi.fn(async (args: { messages?: unknown; prompt?: unknown }) => {
    facade.lastPrompt = JSON.stringify(args?.messages ?? args?.prompt ?? []);
    return "Respuesta del modelo de prueba.";
  }),
  isLoaded: true,
  modelInfo: { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 } as { filename: string; nCtx: number } | null,
  lastPrompt: null as string | null,
  modelsDir: null as string | null,
  load: vi.fn(async (_filename: string) => undefined),
}));

vi.mock("../../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    generate: facade.generate,
    get isLoaded() {
      return facade.isLoaded;
    },
    getModelInfo: () => facade.modelInfo,
    get lastPromptSent() {
      return facade.lastPrompt;
    },
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    hasEmbeddedChatTemplate: () => true,
    load: facade.load,
    stop: () => undefined,
  },
  setLlamaModelsDir: () => undefined,
  llamaModelsDir: () => facade.modelsDir,
}));

vi.mock("../../rag/retrieve.js", () => ({
  retrieve: vi.fn(async () => []),
  activeRetrievalProfile: () => null,
}));

const mem = vi.hoisted(() => ({
  facts: [] as { id: string; content: string; category: string }[],
  reset() {
    mem.facts = [];
  },
}));
vi.mock("../memory/memoryStore.js", () => ({
  MAX_FACT_CONTENT_CHARS: 500,
  MAX_PERSON_NOTES_CHARS: 500,
  saveNote: async () => ({ id: "n1", title: "", body: "" }),
  listNotes: async () => [],
  getNote: async () => null,
  deleteNote: async () => undefined,
  saveReminder: async (input: { text: string }) => ({ id: "r1", ...input }),
  listReminders: async () => [],
  deleteReminder: async () => undefined,
  saveFact: async (input: { content: string; category: string }) => {
    const f = { id: `f${mem.facts.length + 1}`, ...input };
    mem.facts.push(f);
    return f;
  },
  getFacts: async () => mem.facts,
  deleteFact: async () => undefined,
  savePerson: async (input: { name: string }) => ({ id: "p1", ...input }),
  getPeople: async () => [],
  deletePerson: async () => undefined,
}));

import { productionTurnDeps, runTurn } from "../../turn/turnPipeline.js";
import { MODEL_CATALOG } from "../../models/manifest.js";
import { buildToolHandlers } from "../tools/handlers.js";
import { PERSONALITIES } from "../../constants/personalities.js";

const entry06 = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;
const succinct = PERSONALITIES.find((p) => p.id === "succinct")!;

async function run(text: string, lang: "es" | "en" | "pt") {
  const deps = await productionTurnDeps({
    handlers: buildToolHandlers({ requestConfirm: async () => true }),
    packFacts: async () => ({ regions: [], facts: [] }),
    availableModels: [{ model: entry06, present: true }],
    fallbackModelId: entry06.id,
    ensureEmbeddings: async () => true,
    buildSemanticContext: async () => null,
    semanticDanger: async () => false,
    verifiedImportedPackIds: async () => new Set<string>(),
    onConfirmTool: async () => true,
  });
  return runTurn({ query: text, lang, systemPrompt: succinct.systemPrompt, history: [] }, deps);
}

beforeEach(() => {
  facade.generate.mockClear();
  mem.reset();
});

describe("H-GUIA-1 · la orden de guardar un dato entra al loop en los tres idiomas", () => {
  it("en: «remember that the library opens at 9» guarda el dato", async () => {
    const r = await run("remember that the library opens at 9", "en");
    expect(r.route).toBe("agent-loop");
    expect(mem.facts.length).toBe(1);
    expect(mem.facts[0].content).toContain("library opens at 9");
  });

  it("pt: «lembra que a biblioteca abre às 9» guarda el dato", async () => {
    const r = await run("lembra que a biblioteca abre às 9", "pt");
    expect(r.route).toBe("agent-loop");
    expect(mem.facts.length).toBe(1);
  });

  it("es: «recuerda que la biblioteca abre a las 9» sigue guardando el dato (control)", async () => {
    const r = await run("recuerda que la biblioteca abre a las 9", "es");
    expect(r.route).toBe("agent-loop");
    expect(mem.facts.length).toBe(1);
  });

  it("la pregunta sobre la memoria ajena no se convierte en orden: «do you remember when the library opens?» no guarda nada", async () => {
    const r = await run("do you remember when the library opens?", "en");
    expect(mem.facts.length).toBe(0);
    expect(r.route).not.toBe("agent-loop");
  });
});

describe("H-GUIA-1 · la lista de notas admite el adjetivo en los tres idiomas", () => {
  it("es: «¿qué notas tengo guardadas?» es noteList", () => {
    expect(extractToolAction("¿qué notas tengo guardadas?")?.kind).toBe("noteList");
  });
  it("en: «what notes do I have saved?» es noteList", () => {
    expect(extractToolAction("what notes do I have saved?")?.kind).toBe("noteList");
  });
  it("pt: «que notas eu tenho salvas?» es noteList", () => {
    expect(extractToolAction("que notas eu tenho salvas?")?.kind).toBe("noteList");
  });
  it("pt: «mostra as minhas notas» es noteList", () => {
    expect(extractToolAction("mostra as minhas notas")?.kind).toBe("noteList");
  });
  it("controles: las formas que ya entraban siguen entrando", () => {
    expect(extractToolAction("¿qué notas tengo?")?.kind).toBe("noteList");
    expect(extractToolAction("what notes do I have?")?.kind).toBe("noteList");
    expect(extractToolAction("mostre minhas notas")?.kind).toBe("noteList");
  });
});
