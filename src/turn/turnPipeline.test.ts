/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * turnPipeline.test.ts — el orden del turno, cobrado por sus
 * rutas deterministas y por su aserción de no carga (tanda 14).
 *
 * La fachada del motor y la recuperación se sustituyen por dobles
 * (el patrón de chatSimulation.test.ts): lo que se mide aquí es la
 * COMPOSICIÓN — qué ruta sirve cada clase de turno y qué no se
 * toca en cada una — no la generación, que la pasada cobra sobre
 * el paquete con el modelo de referencia. La aserción clave es la
 * del escenario 3 de la pasada en su forma de batería: ante una
 * pregunta de salud sin guía, el turno sirve el texto seguro SIN
 * que la generación del modelo se invoque una sola vez.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const facade = vi.hoisted(() => ({
  generate: vi.fn(async (args: { messages?: unknown; prompt?: unknown }) => {
    // La fachada real registra el prompt en cada generación; el
    // doble hace lo mismo para que promptSent se cobre de verdad:
    // registra los argumentos REALES de la llamada (antes registraba
    // un texto fijo, y ningún caso podía cobrar lo que el prompt
    // llevaba de verdad — lo cobró el caso del recordatorio de
    // estilo de A-4).
    facade.lastPrompt = JSON.stringify(args?.messages ?? args?.prompt ?? []);
    return "La capital de Francia es París.";
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
import { healthSafeText } from "../routing/emergencyGate.js";
import { productionTurnDeps, runTurn, type TurnDeps } from "./turnPipeline.js";

const entry = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;

async function deps(partial: Partial<TurnDeps> = {}): Promise<TurnDeps> {
  return await productionTurnDeps({
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

beforeEach(() => {
  facade.generate.mockClear();
  facade.load.mockClear();
  facade.isLoaded = true;
  facade.modelInfo = { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 };
  facade.lastPrompt = null;
  facade.modelsDir = null;
  retrieval.chunks = [];
});

describe("el turno entero: las rutas que no tocan el modelo", () => {
  it("la seguridad sirve su texto fijo sin generar", async () => {
    const r = await runTurn({ ...baseInput, query: "Quiero hacerme daño" }, await deps());
    expect(r.route).toBe("safety");
    expect(r.text.length).toBeGreaterThan(20);
    expect(facade.generate).not.toHaveBeenCalled();
    expect(r.generationModelLoadedByTurn).toBe(false);
  });

  it("salud sin guía: texto seguro y la generación NUNCA se invoca (la aserción de no carga)", async () => {
    const r = await runTurn(
      { ...baseInput, query: "¿Qué dosis de paracetamol le doy a mi hijo de 5 años?" },
      await deps(),
    );
    expect(r.route).toBe("safe-text");
    expect(r.text).toBe(healthSafeText("es"));
    expect(facade.generate).not.toHaveBeenCalled();
  });

  it("el número de emergencias sale de los hechos del pack, sin generar", async () => {
    // Costa Rica: la tabla de seguridad no conoce su número (su
    // clase del número respondería «no lo tengo»), así que el que
    // sirve es el del pack, que es el orden firmado.
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es el número de emergencias en Costa Rica?" },
      await deps({
        packFacts: async () => ({
          regions: [
            {
              code: "CR",
              names: { es: "Costa Rica" },
              phrases: { es: "en Costa Rica" },
              aliases: ["Costa Rica"],
            },
          ],
          facts: [
            {
              region: "CR",
              key: "emergency.general",
              value: "911",
              label: { es: "Emergencias" },
              note: {},
              sourceTitle: "Sistema de Emergencias 9-1-1",
              sourceUrl: "https://example.org",
              quote: "",
              checked: "2026-01-01",
            },
          ],
        }),
      }),
    );
    expect(r.route).toBe("pack-facts");
    expect(r.text).toContain("911");
    expect(facade.generate).not.toHaveBeenCalled();
  });

  it("sin pack que responda, el número lo sirve la tabla de seguridad como respaldo", async () => {
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es el número de emergencias en España?" },
      await deps(),
    );
    expect(r.route).toBe("safety");
    expect(r.text).toContain("112");
    expect(facade.generate).not.toHaveBeenCalled();
  });
});

describe("el turno entero: la ruta del modelo", () => {
  it("una pregunta corriente sin fuentes genera, juzga en modo léxico y registra el prompt enviado", async () => {
    // La garantía de embeddings sana a propósito (Pieza 3 de la
    // carcasa): este caso fija el turno corriente SIN avisos, y
    // con la garantía fallando el aviso «embeddings-not-loaded»
    // es hoy la conducta firmada — lo cobran los casos de la
    // pieza al final de este fichero, no este.
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps({ ensureEmbeddings: async () => true }),
    );
    expect(r.route).toBe("model");
    expect(r.text).toContain("París");
    expect(facade.generate).toHaveBeenCalled();
    expect(r.judgeMode).toBe("lexical");
    expect(r.promptSent).toContain("capital de Francia");
    expect(r.warnings).toEqual([]);
    expect(r.stopped).toBe(false);
    expect(r.timedOut).toBe(false);
    expect(r.contextNote).toBeDefined();
    expect(r.contextNote!.droppedTurns).toBe(0);
  });

  it("la parada a mitad de generación asienta el turno parado, con su texto parcial (§3.4 del bloque del loop)", async () => {
    // El doble imita el contrato real del motor: emite una pieza,
    // la pulsación aborta el controlador del turno, y la llamada
    // resuelve con el parcial SOLO si traía la señal del turno;
    // sin ella corre hasta su fin. Antes de §3.4 el ejecutor no
    // la pasaba: el turno asentaba entero y sin marca.
    const controller = new AbortController();
    let seenSignal: unknown;
    facade.generate.mockImplementationOnce(async (args: any) => {
      facade.lastPrompt = JSON.stringify(args?.messages ?? args?.prompt ?? []);
      seenSignal = args?.signal;
      args?.onToken?.("Érase ");
      controller.abort();
      if (args?.signal?.aborted) return "Érase una vez un faro.";
      args?.onToken?.("una vez un faro que alumbraba toda la bahía.");
      return "Érase una vez un faro que alumbraba toda la bahía.";
    });
    const r = await runTurn(
      { ...baseInput, query: "Cuéntame un cuento corto sobre un faro", signal: controller.signal },
      await deps(),
    );
    expect(seenSignal).toBe(controller.signal);
    expect(r.route).toBe("model");
    expect(r.stopped).toBe(true);
    expect(r.text).toContain("Érase una vez un faro.");
    expect(r.text).not.toContain("bahía");
  });

  it("el recordatorio de estilo del tono llega al prompt enviado (A-4: el tono gobierna)", async () => {
    // La otra mitad de A-4 (refresco de la guía contra la tanda 14):
    // la personalidad persistía sin aplicarse, porque el pipeline no
    // cosía el styleReminder del tono en el turno. Con el hilo, el
    // recordatorio viaja junto a la pregunta en el prompt enviado.
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?", styleReminder: "RECORDATORIO-DE-ESTILO-14" },
      await deps(),
    );
    expect(r.route).toBe("model");
    expect(r.promptSent).toContain("RECORDATORIO-DE-ESTILO-14");
  });

  it("la investigación pedida sobre una pregunta de crisis queda preemptada y el turno cae a la ruta protegida", async () => {
    retrieval.chunks = [
      {
        id: "x1",
        packId: "nido-esencial",
        title: "Ayuda en crisis",
        body: "La línea de crisis atiende a cualquier hora. Pedir ayuda es el primer paso.",
        score: 0.9,
      },
    ];
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la línea de crisis de España?", researchMode: true },
      await deps(),
    );
    expect(r.researchPreempted).toBe(true);
    expect(r.route).toBe("model");
  });
});

describe("las señales honestas del turno (caza de errores de la tanda 14)", () => {
  it("H-2: una ruta que no genera no hereda el prompt de un turno anterior", async () => {
    facade.lastPrompt = "prompt de un turno anterior del proceso";
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es el número de emergencias en España?" },
      await deps(),
    );
    expect(r.route).toBe("safety");
    expect(facade.generate).not.toHaveBeenCalled();
    expect(r.promptSent).toBeNull();
  });

  it("H-2: tras un turno que genera, el siguiente que no genera sigue sin prompt ajeno", async () => {
    const first = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps(),
    );
    expect(first.promptSent).toContain("capital de Francia");
    const second = await runTurn(
      { ...baseInput, query: "¿Cuál es el número de emergencias en España?" },
      await deps(),
    );
    expect(second.route).toBe("safety");
    expect(second.promptSent).toBeNull();
  });

  it("H-1: la fábrica mide la presencia contra el disco registrado", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "nido-models-"));
    writeFileSync(join(dir, "qwen3-0.6b-q4km.gguf"), "gguf");
    facade.modelsDir = dir;
    const measured = await productionTurnDeps({
      handlers: {},
      packFacts: async () => ({ regions: [], facts: [] }),
    });
    const byId = new Map(measured.availableModels.map((a) => [a.model.id, a.present]));
    expect(byId.get("qwen3-0.6b-q4km")).toBe(true);
    for (const [id, present] of byId) {
      if (id !== "qwen3-0.6b-q4km") expect(present).toBe(false);
    }
    facade.modelsDir = null;
    const unregistered = await productionTurnDeps({
      handlers: {},
      packFacts: async () => ({ regions: [], facts: [] }),
    });
    expect(unregistered.availableModels.every((a) => a.present === false)).toBe(true);
  });

  it("H-1+H-3: sin ningún modelo presente, el turno se declara sin generación", async () => {
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps({ availableModels: [{ model: entry, present: false }] }),
    );
    expect(r.route).toBe("model");
    expect(r.text).toBe("");
    expect(facade.generate).not.toHaveBeenCalled();
    expect(r.warnings).toContain("no-generate-step:no-model-available");
  });

  it("H-1+H-3 (ejecución por la fábrica): con el censo medido vacío, el turno entero se declara sin generación", async () => {
    // Sin sobreescritura de availableModels: la presencia sale del
    // censo de la fábrica (directorio no registrado → nada presente).
    const factoryDeps = await productionTurnDeps({
      handlers: {},
      packFacts: async () => ({ regions: [], facts: [] }),
      ensureEmbeddings: async () => false,
      buildSemanticContext: async () => null,
      semanticDanger: async () => false,
      verifiedImportedPackIds: async () => new Set<string>(),
    });
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      factoryDeps,
    );
    expect(r.route).toBe("model");
    expect(r.text).toBe("");
    expect(facade.generate).not.toHaveBeenCalled();
    expect(r.warnings).toContain("no-generate-step:no-model-available");
  });

  it("H-3: si el modelo presente no carga, el aviso del ejecutor viaja en el resultado", async () => {
    facade.isLoaded = false;
    facade.modelInfo = null;
    facade.load.mockRejectedValueOnce(new Error("fichero corrupto"));
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps(),
    );
    expect(r.route).toBe("model");
    expect(r.text).toBe("");
    expect(r.warnings.some((w) => w.startsWith("model-unavailable:"))).toBe(true);
  });
});

describe("Pieza 3 de la carcasa: la garantía de embeddings deja de tirarse (H-EMB-A)", () => {
  // Los deps de este fichero modelan la garantía fallando
  // (ensureEmbeddings → false): hasta la pieza, los dos sitios
  // que la cobran tiraban su resultado y el turno degradado no
  // asentaba nada. Los dos sitios son excluyentes en la
  // composición de hoy (el de la puerta previa corre sin fuentes
  // y el del juez con fuentes), y la propiedad de «una sola vez
  // por turno» vive en la guarda de finish: cada caso la cobra
  // contando exactamente una aparición.
  const aviso = "embeddings-not-loaded";
  const veces = (r: { warnings: string[] }) => r.warnings.filter((w) => w === aviso).length;

  it("el sitio de la puerta previa (sin fuentes): el falso asienta el aviso una sola vez", async () => {
    const r = await runTurn({ ...baseInput, query: "¿Cuál es la capital de Francia?" }, await deps());
    expect(r.route).toBe("model");
    expect(veces(r)).toBe(1);
  });

  it("el sitio del juez (con fuentes): el falso asienta el aviso una sola vez", async () => {
    retrieval.chunks = [
      {
        id: "x1",
        packId: "nido-esencial",
        title: "Capitales del mundo",
        body: "La capital de Francia es París. La capital de España es Madrid.",
        score: 0.9,
      },
    ];
    const r = await runTurn({ ...baseInput, query: "¿Cuál es la capital de Francia?" }, await deps());
    expect(r.route).toBe("model");
    expect(r.sources.length).toBeGreaterThan(0);
    expect(veces(r)).toBe(1);
  });

  it("con la garantía sana, ningún sitio asienta el aviso", async () => {
    retrieval.chunks = [
      {
        id: "x1",
        packId: "nido-esencial",
        title: "Capitales del mundo",
        body: "La capital de Francia es París. La capital de España es Madrid.",
        score: 0.9,
      },
    ];
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps({ ensureEmbeddings: async () => true }),
    );
    expect(r.route).toBe("model");
    expect(veces(r)).toBe(0);
  });

  it("un turno que sale antes de la garantía no asienta el aviso aunque esta fallara", async () => {
    const r = await runTurn({ ...baseInput, query: "Quiero hacerme daño" }, await deps());
    expect(r.route).toBe("safety");
    expect(r.warnings).toEqual([]);
  });
});

describe("la pieza de los modelos sin roles: modelo presente ⇒ paso de generación", () => {
  it("un solo modelo presente sin roles y sin peldaño genera: el turno no se sirve vacío", async () => {
    // La forma afilada del censo del diagnóstico: el 0.5B no
    // trae curación alguna, no es el 1.5B y la escalera no
    // tiene peldaño para él; el respaldo de estos deps nombra
    // a otro modelo ausente (el peldaño vivo de otra clase).
    // Antes de la pieza, el plan nacía sin paso de generación
    // y el turno se servía vacío con el aviso de «sin
    // modelo» habiendo un modelo presente.
    const entry05 = MODEL_CATALOG.find((m) => m.id === "qwen2.5-0.5b-instruct-q4km")!;
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps({
        availableModels: [{ model: entry05, present: true }],
        fallbackModelId: "qwen3-1.7b-q4km",
      }),
    );
    expect(r.route).toBe("model");
    expect(facade.generate).toHaveBeenCalled();
    expect(r.text).toContain("París");
    expect(r.warnings).not.toContain("no-generate-step:no-model-available");
  });

  it("con cero LLM en la instalación, el vacío sigue siendo el estado honesto y ningún paso se inventa", async () => {
    const r = await runTurn(
      { ...baseInput, query: "¿Cuál es la capital de Francia?" },
      await deps({ availableModels: [] }),
    );
    expect(r.route).toBe("model");
    expect(r.text).toBe("");
    expect(facade.generate).not.toHaveBeenCalled();
    expect(r.warnings).toContain("no-generate-step:no-model-available");
  });
});

describe("C-4 del cableado de chat: la fase «buscando en tus fuentes»", () => {
  it("un turno con onPhase cobrado recibe «searching» una vez, antes del primer token", async () => {
    // El doble imita el contrato real del motor: la generación
    // emite sus piezas por el onToken que el ejecutor le entrega.
    // La fase se cobra contra ese flujo: la entrada en el bloque
    // de recuperación (paso 6) emite «searching» una sola vez y
    // antes de que la primera pieza exista.
    const events: string[] = [];
    facade.generate.mockImplementationOnce(async (args: any) => {
      facade.lastPrompt = JSON.stringify(args?.messages ?? args?.prompt ?? []);
      args?.onToken?.("La capital ");
      args?.onToken?.("de Francia es París.");
      return "La capital de Francia es París.";
    });
    const r = await runTurn(
      {
        ...baseInput,
        query: "¿Cuál es la capital de Francia?",
        onPhase: (phase: string) => {
          events.push(`phase:${phase}`);
        },
        onToken: () => {
          events.push("token");
        },
      },
      await deps({ ensureEmbeddings: async () => true }),
    );
    expect(r.route).toBe("model");
    expect(events.filter((e) => e === "phase:searching")).toHaveLength(1);
    expect(events.indexOf("phase:searching")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("phase:searching")).toBeLessThan(events.indexOf("token"));
  });
});
