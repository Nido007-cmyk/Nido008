/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * executor.stopSignal.test.ts — la pierna de parada del ejecutor
 * (§3.4 del bloque del loop): la señal del turno llega AL MOTOR.
 *
 * El diagnóstico (DIAGNOSTICO-TURNSENDDOOR) cobró que la parada
 * de la vía del chat moría en la puerta del paso 9: el ejecutor
 * consultaba shouldStop solo entre pasos y no pasaba la señal a
 * ninguna de sus tres llamadas a generate, así que una generación
 * en vuelo corría hasta su fin y el turno asentaba tarde y sin
 * marca. La vía del agente sí la entrega desde M-20; esta batería
 * cobra el espejo en el ejecutor, llamada a llamada.
 *
 * El doble del motor imita el contrato real (LlamaEngine.ts:248-251,
 * :298-300, :367, :395): si la señal ya viene abortada al entrar,
 * resuelve vacío sin generar; si aborta a mitad, resuelve con el
 * texto parcial acumulado; y SOLO oye la parada si la llamada
 * recibió la señal — sin ella, la pulsación del usuario no le
 * llega y corre hasta su fin. Esa fidelidad es la que hace que
 * cada caso nazca en rojo por la causa exacta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockResidentFilename: string | null = null;
let loadHook: (() => void) | null = null;
const loadMock = vi.fn(async (filename: string) => {
  mockResidentFilename = filename;
  loadHook?.();
});
const retrieveMock = vi.fn(async (_query: string) => [] as any[]);
const getModelInfoMock = vi.fn(() =>
  mockResidentFilename ? { filename: mockResidentFilename, nCtx: 4096, nThreads: 4 } : null
);
const hasEmbeddedChatTemplateMock = vi.fn(() => false);

/** Guion por llamada a generate: cada caso declara qué hace cada una. */
type GenBehavior = (opts: any) => Promise<string>;
let genScript: GenBehavior[] = [];
let genIndex = 0;
const generateMock = vi.fn(async (opts: any) => {
  const behavior = genScript[genIndex] ?? faithfulFull;
  genIndex++;
  return behavior(opts);
});

const FULL = "uno dos tres cuatro cinco";
const PIECES = FULL.split(/(?<= )/);

/** El motor sin parada que le llegue: emite todo y resuelve entero. */
async function faithfulFull(opts: any): Promise<string> {
  if (opts?.signal?.aborted) return "";
  for (const piece of PIECES) opts?.onToken?.(piece);
  return FULL;
}

/**
 * El usuario pulsa «detener» tras la pieza n: el controlador
 * aborta en el mundo; el motor resuelve con el parcial SOLO si
 * su llamada traía la señal (si no, la pulsación no le llega y
 * la generación corre hasta su fin, como hoy).
 */
function pressStopAfter(n: number, controller: AbortController): GenBehavior {
  return async (opts: any) => {
    if (opts?.signal?.aborted) return "";
    let out = "";
    for (let i = 0; i < PIECES.length; i++) {
      out += PIECES[i];
      opts?.onToken?.(PIECES[i]);
      if (i + 1 === n) controller.abort();
      if (opts?.signal?.aborted) return out;
    }
    return out;
  };
}

/** La pulsación llega justo al abrir la llamada del veredicto. */
function pressStopAtEntry(controller: AbortController, unheard: string): GenBehavior {
  return async (opts: any) => {
    if (opts?.signal?.aborted) return "";
    controller.abort();
    if (opts?.signal?.aborted) return "";
    return unheard;
  };
}

/** Con la señal ya abortada al entrar, el motor resuelve vacío sin generar. */
async function faithfulEntry(opts: any): Promise<string> {
  if (opts?.signal?.aborted) return "";
  return "SUPPORTED. Todo concuerda.";
}

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    load: (filename: string) => loadMock(filename),
    generate: (opts: any) => generateMock(opts),
    getModelInfo: () => getModelInfoMock(),
    hasEmbeddedChatTemplate: () => hasEmbeddedChatTemplateMock(),
  },
}));

vi.mock("../rag/retrieve.js", () => ({
  retrieve: (query: string) => retrieveMock(query),
}));

import { executeRoutingPlan, type ExecutableModel } from "./executor.js";
import type { RoutingPlan } from "./router.js";

const MODELS: Record<string, ExecutableModel> = {
  phi: { id: "phi", filename: "models/primary-llm.gguf" },
  "qwen-1.5b": {
    id: "qwen-1.5b",
    filename: "models/qwen2.5-1.5b-instruct-q4km.gguf",
    usesChatTemplate: true,
  },
};
const resolveModel = (id: string) => MODELS[id];

function plan(overrides: Partial<RoutingPlan>): RoutingPlan {
  return {
    steps: [],
    selectedModelIds: [],
    estimatedCost: { modelSwitches: 0 },
    fallbackPolicy: "use-default",
    reasonCodes: [],
    ...overrides,
  };
}

const verifyPlan = () =>
  plan({
    steps: [
      { id: "retrieve-0", type: "retrieve", required: false },
      { id: "generate-1", type: "generate", modelId: "phi", required: true },
      { id: "verify-2", type: "verify", modelId: "qwen-1.5b", required: false },
    ],
  });
const CHUNKS = [{ chunkId: "c1", docId: "d1", title: "T", body: "B", score: 1, matchType: "hybrid" as const }];

function callbacks(controller: AbortController) {
  return {
    shouldStop: () => controller.signal.aborted,
    signal: () => controller.signal,
  };
}

beforeEach(() => {
  loadMock.mockClear();
  generateMock.mockClear();
  retrieveMock.mockClear();
  getModelInfoMock.mockClear();
  mockResidentFilename = null;
  loadHook = null;
  genScript = [];
  genIndex = 0;
  retrieveMock.mockResolvedValue([]);
});

describe("la señal del turno dentro del ejecutor (§3.4)", () => {
  it("la señal llega a la generación principal con plantilla (identidad)", async () => {
    const controller = new AbortController();
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "qwen-1.5b", required: true }],
      selectedModelIds: ["qwen-1.5b"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, callbacks(controller));
    expect(result.answer).toBe(FULL);
    expect(generateMock).toHaveBeenCalledTimes(1);
    const opts = generateMock.mock.calls[0][0];
    expect(opts.messages).toBeDefined();
    expect(opts.signal).toBe(controller.signal);
  });

  it("la señal llega a la generación principal sin plantilla (identidad)", async () => {
    const controller = new AbortController();
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "phi", required: true }],
      selectedModelIds: ["phi"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, callbacks(controller));
    expect(result.answer).toBe(FULL);
    expect(generateMock).toHaveBeenCalledTimes(1);
    const opts = generateMock.mock.calls[0][0];
    expect(opts.prompt).toBeDefined();
    expect(opts.signal).toBe(controller.signal);
  });

  it("parada a mitad de escritura: asienta con el parcial y con su marca", async () => {
    const controller = new AbortController();
    genScript = [pressStopAfter(2, controller)];
    const p = plan({
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "phi", required: true },
      ],
      selectedModelIds: ["phi"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, callbacks(controller));
    expect(result.answer).toBe("uno dos ");
    expect(result.stopped).toBe(true);
  });

  it("parada durante la carga: la generación ni se intenta", async () => {
    const controller = new AbortController();
    loadHook = () => controller.abort();
    const p = plan({
      steps: [{ id: "generate-0", type: "generate", modelId: "qwen-1.5b", required: true }],
      selectedModelIds: ["qwen-1.5b"],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, callbacks(controller));
    expect(generateMock).not.toHaveBeenCalled();
    expect(result.stepsExecuted).toBe(0);
    expect(result.stopped).toBe(true);
  });

  it("parada durante la recuperación, con retrieve como último paso: deja su marca", async () => {
    const controller = new AbortController();
    retrieveMock.mockImplementation(async () => {
      controller.abort();
      return CHUNKS;
    });
    const p = plan({
      steps: [{ id: "retrieve-0", type: "retrieve", required: false }],
      selectedModelIds: [],
    });
    const result = await executeRoutingPlan(p, { query: "hi" }, resolveModel, callbacks(controller));
    expect(result.stepsExecuted).toBe(1);
    expect(result.stopped).toBe(true);
  });

  it("parada durante el veredicto: su llamada traía la señal y el turno asienta parado e incierto", async () => {
    const controller = new AbortController();
    retrieveMock.mockResolvedValue(CHUNKS);
    genScript = [faithfulFull, pressStopAtEntry(controller, "SUPPORTED. Todo concuerda."), faithfulEntry];
    const result = await executeRoutingPlan(verifyPlan(), { query: "hi" }, resolveModel, callbacks(controller));
    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(generateMock.mock.calls[1][0].signal).toBe(controller.signal);
    expect(result.verification.status).toBe("uncertain");
    expect(result.stopped).toBe(true);
  });

  it("parada durante el reparo del veredicto: el reparo traía la señal y nunca hay una cuarta llamada", async () => {
    const controller = new AbortController();
    retrieveMock.mockResolvedValue(CHUNKS);
    genScript = [
      faithfulFull,
      async () => "No lo tengo claro.", // intento: formato inválido, sin parada
      pressStopAtEntry(controller, "Sigo sin tenerlo claro."), // el reparo: la parada llega al abrir
    ];
    const result = await executeRoutingPlan(verifyPlan(), { query: "hi" }, resolveModel, callbacks(controller));
    expect(generateMock).toHaveBeenCalledTimes(3);
    expect(generateMock.mock.calls[2][0].signal).toBe(controller.signal);
    expect(result.verification.status).toBe("uncertain");
    expect(result.stopped).toBe(true);
  });
});
