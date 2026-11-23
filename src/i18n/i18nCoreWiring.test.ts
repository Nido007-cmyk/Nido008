/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * i18nCoreWiring.test.ts — batería de la tanda breve I18N-2: el
 * módulo i18n del núcleo existe, resuelve en los cinco sitios que
 * lo esperaban y se alimenta del idioma de la persona.
 *
 * Lo que cobra, por la vía real y no por la reserva:
 * - El contrato del módulo: nace en el idioma del dispositivo,
 *   `t` sirve los tres locales con su interpolación tras
 *   `changeLanguage`, y `language`/`resolvedLanguage` lo siguen.
 * - Las tarjetas del handler en español y portugués: la familia
 *   de «Crear evento» (`create_calendar_event` por
 *   `buildToolHandlers`, con el canal de confirmación capturado
 *   y rechazando, para cobrar también el texto de cancelación
 *   del núcleo de confirmación en el mismo idioma).
 * - La alimentación desde prefs: un turno real por `runTurn`
 *   con el `lang` del turno (el que la carcasa lee de
 *   `prefs.lang`) deja el módulo en ese idioma, y la vía
 *   programada (`runScheduledTasksNow` con `ctx.lang`) igual.
 * - La caída honesta: una clave ausente en los tres locales
 *   devuelve la propia clave, nunca una cadena vacía.
 *
 * La fachada del motor y la recuperación se sustituyen por
 * dobles con la forma de turnPipeline.test.ts: lo que se mide
 * es el cable del idioma, no la generación. El almacén de
 * tareas se sustituye para que la vía programada corra sin
 * tareas debidas (su composición real la cobra su batería).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const facade = vi.hoisted(() => ({
  generate: vi.fn(async () => "Respuesta del doble."),
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

vi.mock("../rag/retrieve.js", () => ({
  retrieve: vi.fn(async () => []),
  activeRetrievalProfile: () => null,
}));

vi.mock("../agent/scheduled/taskStore.js", () => ({
  getDueTasks: vi.fn(async () => []),
  recordTaskRun: vi.fn(async () => undefined),
  updateTaskAfterRun: vi.fn(async () => undefined),
}));

import i18n from "./index.js";
import { deviceDefaultLanguage } from "../models/settings.js";
import { buildToolHandlers } from "../agent/tools/handlers.js";
import { confirmPayloadChangedMessage, type ConfirmRequest } from "../agent/tools/confirm.js";
import { getUiLocale } from "../agent/loop/cannedResponses.js";
import { MODEL_CATALOG } from "../models/manifest.js";
import { productionTurnDeps, runTurn, type TurnDeps } from "../turn/turnPipeline.js";
import { runScheduledTasksNow, type ScheduledRunContext } from "../agent/scheduled/runScheduled.js";

afterEach(() => {
  i18n.changeLanguage(deviceDefaultLanguage());
});

type Req = { title: string; message: string; scope?: string };

/** La tarjeta de «Crear evento», capturada y rechazada: describe y no ejecuta. */
async function createEventCard(): Promise<{ req: Req; out: string }> {
  const capture: Req[] = [];
  const h = buildToolHandlers({
    requestConfirm: async (req: ConfirmRequest) => {
      capture.push(req as Req);
      return false;
    },
  });
  const out = await h["create_calendar_event"]({
    title: "Dentista",
    start: "2026-11-24T15:00:00",
  });
  expect(capture).toHaveLength(1);
  return { req: capture[0], out };
}

describe("el módulo i18n del núcleo", () => {
  it("nace en el idioma del dispositivo", () => {
    expect(i18n.language).toBe(deviceDefaultLanguage());
    expect(i18n.resolvedLanguage).toBe(deviceDefaultLanguage());
  });

  it("t sirve los tres locales con su interpolación tras changeLanguage", () => {
    i18n.changeLanguage("es");
    expect(i18n.t("agentConfirm.createEventTitle")).toBe("Crear evento");
    expect(i18n.t("agentConfirm.scopeCreateEvent", { title: "Dentista", start: "mañana" })).toBe(
      "Alcance: solo este evento: «Dentista» (mañana)",
    );
    i18n.changeLanguage("en");
    expect(i18n.t("agentConfirm.createEventTitle")).toBe("Create event");
    i18n.changeLanguage("pt");
    expect(i18n.t("agentConfirm.createEventTitle")).toBe("Criar evento");
    expect(i18n.t("agentConfirm.scopeCreateEvent", { title: "Dentista", start: "amanhã" })).toBe(
      "Alcance: apenas este evento: «Dentista» (amanhã)",
    );
  });

  it("language y resolvedLanguage siguen a changeLanguage, con normalización y sin idiomas no soportados", () => {
    i18n.changeLanguage("pt");
    expect(i18n.language).toBe("pt");
    expect(i18n.resolvedLanguage).toBe("pt");
    i18n.changeLanguage("es-ES");
    expect(i18n.language).toBe("es");
    i18n.changeLanguage("fr");
    expect(i18n.language).toBe("es");
  });

  it("la caída honesta: la clave ausente en los tres locales devuelve la propia clave, nunca vacío", () => {
    i18n.changeLanguage("es");
    expect(i18n.t("agentConfirm.claveQueNoExiste")).toBe("agentConfirm.claveQueNoExiste");
    expect(i18n.t("agentConfirm.scopeCreateEvent")).toContain("{{title}}");
  });
});

describe("las tarjetas del handler por la vía real", () => {
  it("la tarjeta de crear evento, en español: título, mensaje, alcance y cancelación", async () => {
    i18n.changeLanguage("es");
    const { req, out } = await createEventCard();
    expect(req.title).toBe("Crear evento");
    expect(req.message).toMatch(/^¿Crear en tu calendario «Dentista» el .+\?$/);
    expect(req.scope).toMatch(/^Alcance: solo este evento: «Dentista» \(.+\)$/);
    expect(out).toBe("Entendido, no hice nada.");
  });

  it("la tarjeta de crear evento, en portugués: título, mensaje, alcance y cancelación", async () => {
    i18n.changeLanguage("pt");
    const { req, out } = await createEventCard();
    expect(req.title).toBe("Criar evento");
    expect(req.message).toMatch(/^Criar “Dentista” no seu calendário em .+\?$/);
    expect(req.scope).toMatch(/^Alcance: apenas este evento: «Dentista» \(.+\)$/);
    expect(out).toBe("Entendido, não fiz nada.");
  });
});

describe("la alimentación desde prefs", () => {
  it("un turno real por runTurn con el lang del turno deja el módulo en ese idioma", async () => {
    const entry = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;
    const deps: TurnDeps = await productionTurnDeps({
      handlers: {},
      packFacts: async () => ({ regions: [], facts: [] }),
      availableModels: [{ model: entry, present: true }],
      fallbackModelId: entry.id,
      ensureEmbeddings: async () => false,
      buildSemanticContext: async () => null,
      semanticDanger: async () => false,
      verifiedImportedPackIds: async () => new Set<string>(),
    });
    i18n.changeLanguage("en");
    await runTurn(
      { query: "hola", lang: "pt", systemPrompt: "Eres NIDO.", history: [] },
      deps,
    );
    expect(i18n.language).toBe("pt");
    const { req } = await createEventCard();
    expect(req.title).toBe("Criar evento");
  });

  it("la vía programada con ctx.lang deja el módulo en ese idioma", async () => {
    const strings: ScheduledRunContext["strings"] = {
      doneTitle: (name) => name,
      failedTitle: (name) => name,
      failedBody: "",
      dueTitle: (name) => name,
      dueBody: "",
    };
    i18n.changeLanguage("en");
    const results = await runScheduledTasksNow({
      engine: { generate: async () => "" } as never,
      lang: "es",
      strings,
    });
    expect(results).toEqual([]);
    expect(i18n.language).toBe("es");
  });
});

describe("las otras resoluciones del módulo", () => {
  it("los mensajes del núcleo de confirmación salen en el idioma fijado", () => {
    // La resolución de confirmCoreT se cobra por
    // confirmPayloadChangedMessage (export del árbol cometido,
    // con interpolación): el mensaje de cancelación
    // (confirmCancelledMessage) es el export de la cura de
    // CONF-2, aún sin cometer, y lo cobrará la batería de
    // CONF-1 cuando esa cura se cometa. Su texto servido por la
    // vía real ya lo cobran los casos de la tarjeta, arriba.
    i18n.changeLanguage("es");
    expect(confirmPayloadChangedMessage("create_calendar_event")).toBe(
      "Bloqueado por seguridad: el contenido de «create_calendar_event» cambió después de tu confirmación. La acción NO se ejecutó.",
    );
    i18n.changeLanguage("pt");
    expect(confirmPayloadChangedMessage("create_calendar_event")).toBe(
      "Bloqueado por segurança: o conteúdo de “create_calendar_event” mudou após a sua confirmação. A ação NÃO foi executada.",
    );
    i18n.changeLanguage("en");
    expect(confirmPayloadChangedMessage("create_calendar_event")).toBe(
      "Blocked for security: the payload of “create_calendar_event” changed after confirmation. The action was NOT executed.",
    );
  });

  it("getUiLocale lee el idioma fijado, fresco en cada llamada", () => {
    i18n.changeLanguage("pt");
    expect(getUiLocale()).toBe("pt");
    i18n.changeLanguage("es");
    expect(getUiLocale()).toBe("es");
    i18n.changeLanguage("en");
    expect(getUiLocale()).toBe("en");
  });
});
