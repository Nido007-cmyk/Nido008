/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * guideCoherenceField.test.ts — la puerta de coherencia de guía
 * (§1 pieza B del bloque del loop), sobre el clúster real de
 * cuatro guías del pack incluido, leído del sqlite tal cual.
 *
 * La escena es la de la pasada en vivo (H-LOOP-1/3): sin pata
 * semántica que puntúe, la elección no elige y el turno cae a la
 * ruta del modelo con las fuentes del clúster; el modelo compone
 * su respuesta DESDE LA GUÍA VECINA (las frases reales que la
 * pasada sirvió: la aspirina de 162 a 325 mg del dolor de pecho
 * para la pregunta de RCP; la parte blanda de la nariz para la
 * del sangrado) y el juez la deja pasar porque cada frase SÍ
 * descansa en una fuente, solo que en la guía equivocada. La
 * puerta mira esa composición tras el juez: si la pregunta tiene
 * guía ganadora por su identidad (su título y las preguntas que
 * sus claves declaran responder) y ninguna frase citada descansa
 * en ella, se sirve la ganadora tal cual, con su ruta propia.
 *
 * La fachada del motor y la recuperación son los dobles de
 * turnPipeline.test.ts: lo que se cobra es la composición del
 * turno entero, no la generación.
 */
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const facade = vi.hoisted(() => ({
  answer: "La capital de Francia es París.",
  generate: vi.fn(async (args: { messages?: unknown; prompt?: unknown }) => {
    facade.lastPrompt = JSON.stringify(args?.messages ?? args?.prompt ?? []);
    return facade.answer;
  }),
  isLoaded: true,
  modelInfo: { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 } as { filename: string; nCtx: number } | null,
  lastPrompt: null as string | null,
  modelsDir: null as string | null,
  load: vi.fn(async (_filename: string) => undefined),
}));

vi.mock("../inference/LlamaEngine.js", () => ({
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

const retrieval = vi.hoisted(() => ({
  chunks: [] as unknown[],
}));

vi.mock("../rag/retrieve.js", () => ({
  retrieve: vi.fn(async () => retrieval.chunks),
  activeRetrievalProfile: () => null,
}));

import { MODEL_CATALOG } from "../models/manifest.js";
import { setPacksDataDir } from "../models/dataDir.js";
import { guideTitleOf } from "../rag/packSource.js";
import { productionTurnDeps, runTurn, type TurnDeps } from "./turnPipeline.js";

const entry = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;

async function deps(partial: Partial<TurnDeps> = {}): Promise<TurnDeps> {
  return productionTurnDeps({
    handlers: {},
    packFacts: async () => ({ regions: [], facts: [] }),
    availableModels: [{ model: entry, present: true }],
    fallbackModelId: entry.id,
    ensureEmbeddings: async () => false,
    buildSemanticContext: async () => null,
    semanticDanger: async () => false,
    verifiedImportedPackIds: async () => new Set<string>(),
    ...partial,
  });
}

const baseInput = {
  lang: "es" as const,
  systemPrompt: "Eres NIDO.",
  history: [],
};

interface RealChunk {
  chunkId: string;
  source: string;
  title: string;
  body: string;
  keys?: string;
}

/** Los fragmentos reales del clúster, por su id en el pack incluido. */
function realChunk(id: number, rows: Map<number, { title: string; body: string; keys: string }>): RealChunk {
  const r = rows.get(id);
  if (!r) throw new Error(`el pack incluido ya no trae el fragmento ${id} del clúster`);
  return {
    chunkId: `pack:nido-esencial:${id}`,
    source: "NIDO Esencial",
    title: r.title,
    body: r.body,
    ...(r.keys ? { keys: r.keys } : {}),
  };
}

let rows: Map<number, { title: string; body: string; keys: string }>;
let packsFixtureDir = "";

beforeAll(() => {
  const url = new URL("../../assets/bundled-packs/nido-esencial.sqlite", import.meta.url);
  const db = new DatabaseSync(decodeURIComponent(url.pathname), { readOnly: true });
  try {
    rows = new Map(
      (db.prepare("SELECT id, title, body, keys FROM chunks WHERE guide IN (60, 64, 72, 81)").all() as Array<{
        id: number;
        title: string;
        body: string;
        keys: string;
      }>).map((r) => [r.id, { title: r.title, body: r.body, keys: r.keys }]),
    );
  } finally {
    db.close();
  }
  // La escena trae el pack INSTALADO, como en la app: la puerta
  // sirve la ganadora leyéndola de su pack (readPackSource), así
  // que el directorio de datos se fija a una tienda temporal con
  // el pack incluido enlazado (bajo el árbol: /tmp no admite el
  // enlace duro entre sistemas de ficheros). La escena en sí no
  // cuenta como caso: el Δ sigue siendo +3 exacto.
  packsFixtureDir = mkdtempSync(path.join(process.cwd(), ".guide-coherence-fixture-"));
  mkdirSync(path.join(packsFixtureDir, "corpus"), { recursive: true });
  linkSync(decodeURIComponent(url.pathname), path.join(packsFixtureDir, "corpus", "nido-esencial.sqlite"));
  setPacksDataDir(packsFixtureDir);
});

afterAll(() => {
  setPacksDataDir(null);
  if (packsFixtureDir) rmSync(packsFixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
  facade.generate.mockClear();
  facade.load.mockClear();
  facade.isLoaded = true;
  facade.modelInfo = { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 };
  facade.lastPrompt = null;
  facade.modelsDir = null;
  facade.answer = "La capital de Francia es París.";
  retrieval.chunks = [];
});

/** La lista fusionada de la escena: el clúster entero, sin puntuación semántica. */
function cluster(...ids: number[]): RealChunk[] {
  return ids.map((id) => realChunk(id, rows));
}

/** La composición real de la pasada desde el fragmento 233 (dolor de pecho). */
const CHEST_COMPOSITION =
  "Llama de inmediato al número de emergencias. Que la persona deje de hacer esfuerzo. Siéntala semirrecostada, en la posición más cómoda. " +
  "Si es un adulto despierto, no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague. " +
  "Si tiene medicación recetada para la angina (nitroglicerina), ayúdala a tomarla. Afloja la ropa, tranquilízala y no la dejes sola.";

/** La composición real de la pasada desde el fragmento 261 (sangrado de nariz). */
const NOSE_COMPOSITION =
  "Siéntate y echa la cabeza un poco hacia delante (no hacia atrás: la sangre iría a la garganta). " +
  "Aprieta la parte blanda de la nariz con los dedos, sin soltar, durante 15 minutos seguidos. Respira por la boca. " +
  "Escupe la sangre que llegue a la boca.";

describe("la puerta de coherencia de guía, sobre el clúster real", () => {
  it("la composición desde la vecina sale sustituida por la guía de la pregunta, en las dos escenas de la pasada", async () => {
    // Escena 1: RCP preguntada, dolor de pecho compuesto.
    retrieval.chunks = cluster(191, 194, 233, 232, 207, 261);
    facade.answer = CHEST_COMPOSITION;
    const rcp = await runTurn({ ...baseInput, query: "¿Cómo se hace la RCP en un adulto?" }, await deps());
    expect(rcp.route).toBe("guide-coherence");
    expect(rcp.text).toContain("Guía «RCP (reanimación) en adultos y niños mayores» de NIDO Esencial, tal como está escrita (sin modelo):");
    expect(rcp.text).toContain("30 compresiones y 2 respiraciones");
    expect(rcp.text).not.toContain("162 y 325");
    expect(rcp.sources.length).toBeGreaterThan(0);
    expect(rcp.sources.every((c) => guideTitleOf(c.title) === "RCP (reanimación) en adultos y niños mayores")).toBe(true);

    // Escena 2: sangrado preguntado, nariz compuesta.
    retrieval.chunks = cluster(261, 207, 191, 233, 232, 194);
    facade.answer = NOSE_COMPOSITION;
    const sangre = await runTurn({ ...baseInput, query: "¿Cómo detengo un sangrado fuerte?" }, await deps());
    expect(sangre.route).toBe("guide-coherence");
    expect(sangre.text).toContain("Guía «Hemorragias graves: cómo parar la sangre» de NIDO Esencial, tal como está escrita (sin modelo):");
    expect(sangre.text).toContain("Torniquete (brazos y piernas)");
    expect(sangre.text).not.toContain("parte blanda de la nariz");
    expect(sangre.sources.length).toBeGreaterThan(0);
    expect(sangre.sources.every((c) => guideTitleOf(c.title) === "Hemorragias graves: cómo parar la sangre")).toBe(true);
  });

  it("la guarda de la ganadora: si la composición descansa en la guía de la pregunta, no se toca", async () => {
    retrieval.chunks = cluster(191, 194, 233, 232, 207, 261);
    facade.answer = CHEST_COMPOSITION;
    const r = await runTurn({ ...baseInput, query: "¿Qué hago si me duele mucho el pecho?" }, await deps());
    expect(r.route).toBe("model");
    expect(r.text).toContain("aspirina");
    expect(r.text).not.toContain("tal como está escrita (sin modelo)");
  });

  it("la guarda sin ganadora: una pregunta sin guía en el clúster no se toca", async () => {
    retrieval.chunks = cluster(191, 194, 233, 232, 207, 261);
    facade.answer = "La capital de Francia es París.";
    const r = await runTurn({ ...baseInput, query: "¿Cuál es la capital de Francia?" }, await deps());
    expect(r.route).toBe("model");
    expect(r.text).not.toContain("tal como está escrita (sin modelo)");
  });
});
