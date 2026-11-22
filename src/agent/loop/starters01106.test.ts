/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Defecto E (pasada 0.1.106, fotos del dueño 2026-11-16 07:53–07:56
 * MST, Tab A9+): «remind me to» y «save a note:» — dos de los
 * ejemplos que el PROPIO app sugiere — morían en la conversación
 * crecida con «The conversation no longer fits in the model's
 * memory…». El mensaje completo pasaba; el incompleto, no.
 *
 * Causa raíz medida en el banco (estimateTokens, el estimador
 * único): el sistema del bucle del agente con intención «actuar»
 * estima 1738–1746 tokens SIN memoria (el catálogo de herramientas
 * es el globo); en el peldaño nCtx 1024, sistema + mensaje corto
 * (54) + mínimo de generación (64) = 1856 > 1024, y
 * assertPromptBudget («inicio» / «inicio (sin memoria)») mata el
 * turno. Ningún router determinista capturaba el arrancador
 * incompleto (extractToolAction exigía contenido tras el verbo),
 * así que caía a ese ensamblado.
 *
 * Lo que fija esta regresión:
 *  1. La vía determinista captura el arrancador incompleto como
 *     intención empezada y responde con la pregunta de SU
 *     herramienta (dueño, textual para la nota: «¿Qué nota quieres
 *     salvar?»), en es/en/pt, y la conversación continúa desde esa
 *     pregunta: la respuesta del usuario completa la intención.
 *  2. El ensamblado del agente gradúa lo graduable (la memoria ya
 *     graduaba; ahora también el catálogo: completo → mínimo →
 *     ninguno) antes de que la guarda pueda matar un turno: en el
 *     peldaño de 1024 el sistema base (461–590) cabe siempre y un
 *     mensaje corto jamás muere por memoria.
 *  3. TODOS los ejemplos que el app ofrece (las 4 sugerencias × 3
 *     idiomas y los ejemplos del carrusel) completan su turno sobre
 *     la conversación crecida de reproducción: ninguno muere en una
 *     guarda de presupuesto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractToolAction,
  runToolAction,
  resetConversationState,
  beginUserTurn,
  routerMessage,
  type ToolAction,
  type ToolRouterDeps,
} from "./toolRouter.js";
import { runAgentLoop, buildSystemPrompt, type AgentEngine } from "./agentLoop.js";
import { classifyIntent } from "./intent.js";
import { estimateTokens } from "./contextBudget.js";
import { assembleChatMessages } from "../../rag/pure.js";
import { getPersonality } from "../../constants/personalities.js";
import esJson from "../../i18n/locales/es.json" with { type: "json" };
import enJson from "../../i18n/locales/en.json" with { type: "json" };
import ptJson from "../../i18n/locales/pt.json" with { type: "json" };

const NOW = new Date(2026, 10, 16, 7, 53);

function stubDeps(calls: Array<{ name: string; args: Record<string, unknown> }>): ToolRouterDeps {
  return {
    dispatch: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { status: "executed" as const, text: "ok" };
    },
    isDisabled: () => false,
    now: () => NOW,
  };
}

beforeEach(() => {
  resetConversationState();
});

describe("E · el arrancador incompleto se captura como intención empezada", () => {
  it.each([
    // Los textos EXACTOS que el app sugiere (con su espacio final).
    ["remind me to ", "reminderStarter", "en"],
    ["save a note: ", "noteStarter", "en"],
    ["send a message to ", "messageStarter", "en"],
    ["recuérdame ", "reminderStarter", "es"],
    ["guarda una nota: ", "noteStarter", "es"],
    ["manda un mensaje a ", "messageStarter", "es"],
    ["lembra-me de ", "reminderStarter", "pt"],
    ["guarda uma nota: ", "noteStarter", "pt"],
    ["envia uma mensagem ao ", "messageStarter", "pt"],
    // Tal como los teclea una persona: sin espacio final, con o sin
    // dos puntos, con la otra forma del portugués.
    ["remind me to", "reminderStarter", "en"],
    ["save a note:", "noteStarter", "en"],
    ["send a message to", "messageStarter", "en"],
    ["recuérdame", "reminderStarter", "es"],
    ["guarda una nota", "noteStarter", "es"],
    ["lembre-me de", "reminderStarter", "pt"],
    ["guarda uma nota:", "noteStarter", "pt"],
    // Guarda de pares pt (micro-tanda de la parada del idioma): toda
    // forma tu de un verbo de arrancador pelado trae su pareja você
    // en la misma regla. Las tres formas você que la parada cazó
    // (guarde, envie, mande) nacen en rojo sin las curas espejo del
    // móvil en toolRouter.ts; las demás son candado de pares que ya
    // valen.
    ["guarde uma nota:", "noteStarter", "pt"],
    ["tome nota:", "noteStarter", "pt"],
    ["salve uma nota:", "noteStarter", "pt"],
    ["crie uma nota:", "noteStarter", "pt"],
    ["escreva uma nota:", "noteStarter", "pt"],
    ["envie uma mensagem para", "messageStarter", "pt"],
    ["mande uma mensagem para", "messageStarter", "pt"],
  ] as const)("«%s» → %s (%s)", (text, kind, lang) => {
    const a = extractToolAction(text, NOW);
    expect(a?.kind).toBe(kind);
    expect(a?.lang).toBe(lang);
  });

  it("las formas completas de siempre no cambian de ruta", () => {
    expect(extractToolAction("save a note: buy milk", NOW)?.kind).toBe("noteSave");
    expect(extractToolAction("guarda una nota: la receta", NOW)?.kind).toBe("noteSave");
    const send = extractToolAction("send a message to Ana: hola", NOW);
    expect(send?.kind).toBe("nidoSend");
    // El recordatorio completo es de actionRouter (extractToolAction
    // sigue sin tocarlo): la captura del arrancador no le roba nada.
    expect(extractToolAction("remind me to drink water tomorrow at 9", NOW)).toBeNull();
  });
});

describe("E · cada arrancador responde con SU pregunta, en el idioma de la interfaz", () => {
  it.each([
    [{ kind: "noteStarter", lang: "es" } as ToolAction, "¿Qué nota quieres salvar?"],
    [{ kind: "noteStarter", lang: "en" } as ToolAction, "What note do you want to save?"],
    [{ kind: "noteStarter", lang: "pt" } as ToolAction, "Que nota você quer salvar?"],
    [{ kind: "reminderStarter", lang: "es" } as ToolAction, "¿Qué quieres que te recuerde?"],
    [{ kind: "reminderStarter", lang: "en" } as ToolAction, "What do you want me to remind you?"],
    [{ kind: "reminderStarter", lang: "pt" } as ToolAction, "O que você quer que eu te lembre?"],
    [{ kind: "messageStarter", lang: "es" } as ToolAction, "¿A quién quieres enviarle un mensaje?"],
    [{ kind: "messageStarter", lang: "en" } as ToolAction, "Who do you want to send a message to?"],
    [{ kind: "messageStarter", lang: "pt" } as ToolAction, "Para quem você quer enviar uma mensagem?"],
  ])("%o → «%s»", async (action, expected) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const out = await runToolAction(action, stubDeps(calls));
    expect(out.response).toBe(expected);
    // Preguntar no ejecuta ninguna herramienta.
    expect(calls).toHaveLength(0);
  });
});

describe("E · la conversación continúa desde la pregunta", () => {
  it("nota: la respuesta se guarda como la nota pedida", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const deps = stubDeps(calls);
    beginUserTurn();
    await runToolAction({ kind: "noteStarter", lang: "es" }, deps);
    beginUserTurn();
    const fill = extractToolAction("comprar leche y pan", NOW);
    expect(fill?.kind).toBe("noteStarterFill");
    const out = await runToolAction(fill!, deps);
    expect(calls).toEqual([
      { name: "save_note", args: { title: "comprar leche y pan", body: "comprar leche y pan" } },
    ]);
    expect(out.response).toBe(routerMessage("noteSaved", "es", { title: "comprar leche y pan" }));
  });

  it("recordatorio: la respuesta es el contenido (con su cuándo si lo trae)", async () => {
    const deps = stubDeps([]);
    beginUserTurn();
    await runToolAction({ kind: "reminderStarter", lang: "en" }, deps);
    beginUserTurn();
    const fill = extractToolAction("drink water", NOW);
    expect(fill?.kind).toBe("reminderStarterFill");
    if (fill?.kind === "reminderStarterFill") expect(fill.text).toBe("drink water");
    // En un intento nuevo, el contenido CON fecha también es el relleno:
    // el bucle lo parsea como la frase completa que no se tecleó entera.
    resetConversationState();
    beginUserTurn();
    await runToolAction({ kind: "reminderStarter", lang: "en" }, deps);
    beginUserTurn();
    const fill2 = extractToolAction("call mom tomorrow at 5", NOW);
    expect(fill2?.kind).toBe("reminderStarterFill");
    if (fill2?.kind === "reminderStarterFill") expect(fill2.text).toBe("call mom tomorrow at 5");
  });

  it("mensaje: la respuesta es el destinatario y el flujo pide el texto como siempre", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const deps = stubDeps(calls);
    beginUserTurn();
    await runToolAction({ kind: "messageStarter", lang: "es" }, deps);
    beginUserTurn();
    const fill = extractToolAction("Ana", NOW);
    expect(fill?.kind).toBe("messageStarterFill");
    const out = await runToolAction(fill!, deps);
    expect(out.response).toBe(routerMessage("nidoAskText", "es", { to: "Ana" }));
    expect(calls).toHaveLength(0);
  });

  it("las guardas de siempre mandan: otra orden no se traga como relleno", async () => {
    const deps = stubDeps([]);
    beginUserTurn();
    await runToolAction({ kind: "noteStarter", lang: "es" }, deps);
    beginUserTurn();
    expect(extractToolAction("qué hora es", NOW)?.kind).toBe("time");
  });

  it("un «no» anula la pregunta y la siguiente frase ya no es relleno", async () => {
    const deps = stubDeps([]);
    beginUserTurn();
    await runToolAction({ kind: "reminderStarter", lang: "en" }, deps);
    beginUserTurn();
    expect(extractToolAction("no", NOW)).toBeNull();
    beginUserTurn();
    expect(extractToolAction("water", NOW)).toBeNull();
  });
});

describe("E · capa 2: el ensamblado del agente gradúa el catálogo antes de morir", () => {
  // Forma PC de la capa 2 (crédito heredado de la tanda 11, vía B;
  // apartamientos §6.2 y §6.3 de la apertura): donde el móvil probaba
  // contra el peldaño de 1.024, PC prueba que el nivel observado es
  // «full» en su ventana mínima (8.192) y que la válvula
  // (full → minimal → none) solo baja ante una ventana inyectada
  // artificialmente pequeña. El nivel observado se lee del prompt de
  // sistema que el motor recibe en su primera generación.
  async function observedSystemPrompt(nCtx: number): Promise<string> {
    const calls: { messages: { role: string; content: string }[] }[] = [];
    const engine = {
      generate: vi.fn(async (args: { messages: { role: string; content: string }[] }) => {
        calls.push(args);
        return "Vale, lo subo.";
      }),
    } as unknown as AgentEngine;
    await runAgentLoop("avísame cuando llegue Juan", {
      engine,
      handlers: {},
      loadMemory: async () => null,
      nCtx,
      lang: "es",
    });
    expect(calls.length).toBeGreaterThanOrEqual(1);
    return calls[0].messages[0].content;
  }

  it("el nivel observado es «full» en la ventana mínima de PC (8192); la válvula solo baja ante una ventana inyectada pequeña", async () => {
    const user = estimateTokens("remind me to");
    for (const lang of ["es", "en", "pt"] as const) {
      // El catálogo completo cabe en la ventana mínima de PC con su reserva.
      expect(estimateTokens(buildSystemPrompt("actuar", "", lang, "full")) + user + 64).toBeLessThanOrEqual(8192);
      // Los niveles de la válvula no cambian: siguen cabiendo en 1024.
      expect(estimateTokens(buildSystemPrompt("actuar", "", lang, "minimal")) + user + 64).toBeLessThanOrEqual(1024);
      expect(estimateTokens(buildSystemPrompt("actuar", "", lang, "none")) + user + 64).toBeLessThanOrEqual(1024);
    }
    // Sin nivel pedido, el prompt es byte a byte el completo de hoy.
    expect(buildSystemPrompt("actuar", "", "en")).toBe(buildSystemPrompt("actuar", "", "en", "full"));
    expect(buildSystemPrompt("conversar", "", "es")).toBe(buildSystemPrompt("conversar", "", "es", "full"));
    // El nivel OBSERVADO en la ventana mínima de PC es el completo.
    const full = buildSystemPrompt("actuar", "", "es", "full");
    expect(await observedSystemPrompt(8192)).toBe(full);
    // Y la válvula solo baja ante una ventana inyectada pequeña:
    // el prompt servido a 1024 es el mínimo o el ninguno, no el completo.
    const lowered = await observedSystemPrompt(1024);
    expect(lowered).not.toBe(full);
    expect([buildSystemPrompt("actuar", "", "es", "minimal"), buildSystemPrompt("actuar", "", "es", "none")]).toContain(lowered);
  });

  it("un turno «actuar» sin captura determinista RESPONDE en la ventana mínima de PC (8192), con el catálogo completo", async () => {
    // Espécimen verificado en el banco: clasifica «actuar», ningún
    // router determinista lo captura y el turno llega al ensamblado.
    const specimen = "avísame cuando llegue Juan";
    expect(classifyIntent(specimen)).toBe("actuar");
    const calls: unknown[][] = [];
    let i = 0;
    const responses = ["Vale, lo subo."];
    const engine: AgentEngine & { calls: unknown[][] } = {
      calls,
      generate: vi.fn(async (args: unknown) => {
        calls.push([args]);
        return responses[Math.min(i++, responses.length - 1)];
      }),
    } as unknown as AgentEngine & { calls: unknown[][] };
    const result = await runAgentLoop(specimen, {
      engine,
      handlers: {},
      loadMemory: async () => null,
      nCtx: 8192,
      lang: "es",
    });
    // El turno RESPONDE (lo que el bucle responda con honestidad es
    // asunto suyo; lo que no puede es morir en la guarda) y el motor
    // llegó a correr: el ensamblado cupo, con el catálogo completo.
    expect(result.response.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const firstArgs = calls[0][0] as { messages: { role: string; content: string }[] };
    expect(firstArgs.messages[0].content).toBe(buildSystemPrompt("actuar", "", "es", "full"));
  });
});

// La conversación de las pasadas del dueño (0.1.104 + 0.1.106), tal
// como quedó: la crecida sobre la que ningún ejemplo puede morir.
const TURNOS_CRECIDOS = [
  { role: "user" as const, text: "Cuanto es 36 por 4" },
  { role: "assistant" as const, text: "36 por 4 son 144." },
  { role: "user" as const, text: "Recuerdame tomar agua mañana a las 9:00" },
  { role: "assistant" as const, text: "Listo, te lo recuerdo mañana a las 9:00." },
  { role: "user" as const, text: "Como hago rcp a un adulto" },
  { role: "assistant" as const, text: "Guía de RCP servida literal, paso a paso." },
  { role: "user" as const, text: "Como cambio la llanta de un carro" },
  { role: "assistant" as const, text: "Abstención honesta con extracto de la guía de avería en carretera." },
  { role: "user" as const, text: "Que hago si un niño se esta atragantando" },
  { role: "assistant" as const, text: "Texto seguro de salud a la primera; la guía, a la segunda." },
];

const RESUMEN_CRECIDO =
  "- El usuario preguntó cuánto es 36 por 4 y se le respondió 144.\n" +
  "- El usuario pidió un recordatorio para tomar agua mañana a las 9:00 y se creó.\n" +
  "- El usuario preguntó cómo hacer RCP a un adulto y se le sirvió la guía.\n" +
  "- El usuario preguntó cómo cambiar la llanta de un carro y se le dio el extracto de avería.\n" +
  "- El usuario preguntó qué hacer si un niño se está atragantando.\n" +
  "- El usuario usa un tono conciso y directo.";

describe("E · la lista entera de ejemplos del app contra la conversación crecida", () => {
  const STARTER_KIND = { reminder: "reminderStarter", note: "noteStarter", message: "messageStarter" } as const;
  const LOCALES = [
    ["es", esJson],
    ["en", enJson],
    ["pt", ptJson],
  ] as const;

  it.each(LOCALES.map(([lang]) => [lang] as const))(
    "las 4 sugerencias de %s: las de herramienta se capturan y ninguna muere en el ensamblado fijo a 1024",
    (lang) => {
      const json = LOCALES.find(([l]) => l === lang)![1] as typeof esJson;
      const s = json.chatScreen.suggestions;
      const personality = getPersonality("succinct");
      for (const key of ["reminder", "note", "documents", "message"] as const) {
        const prompt = s[key].prompt;
        if (key === "reminder" || key === "note" || key === "message") {
          const a = extractToolAction(prompt, NOW);
          expect(a?.kind, `${lang}/${key}`).toBe(STARTER_KIND[key]);
        }
        // Documentos no es una orden de herramienta: su turno es el de
        // la vía de conocimiento, y lo que se le exige es no morir.
        expect(
          () =>
            assembleChatMessages(prompt, [], personality.systemPrompt, { summary: RESUMEN_CRECIDO, turns: TURNOS_CRECIDOS }, personality.styleReminder, false, {
              nCtx: 1024,
              reserveGeneration: 512,
            }),
          `${lang}/${key}`,
        ).not.toThrow();
      }
    },
  );

  it("los ejemplos del carrusel (es/en/pt) tampoco mueren en el ensamblado fijo a 1024", () => {
    const personality = getPersonality("succinct");
    const prompts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") return;
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.prompt === "string") prompts.push(o.prompt);
        Object.values(o).forEach(walk);
      }
    };
    for (const [, json] of LOCALES) walk((json as typeof esJson).promptIdeasCarousel);
    expect(prompts.length).toBeGreaterThanOrEqual(12);
    for (const p of prompts) {
      expect(
        () =>
          assembleChatMessages(p, [], personality.systemPrompt, { summary: RESUMEN_CRECIDO, turns: TURNOS_CRECIDOS }, personality.styleReminder, false, {
            nCtx: 1024,
            reserveGeneration: 512,
          }),
        p.slice(0, 40),
      ).not.toThrow();
    }
  });
});
