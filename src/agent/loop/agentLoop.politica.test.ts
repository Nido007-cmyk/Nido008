/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * agentLoop.politica.test.ts — Batería C de la pieza de
 * política configurable por herramienta (tanda 13, acto 7 /
 * pieza «política»): el paso por el bucle.
 *
 * La configuración (política y catálogo) viaja como dato
 * inmutable del turno en las opciones del bucle y llega a
 * los cinco puntos: las descripciones del prompt, el
 * despacho principal y las dos vías rápidas (contacto y
 * router comparten el mismo enhebrado de opciones). Sin las
 * opciones nuevas, prompt y despacho son los de siempre.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runAgentLoop, type AgentEngine } from "./agentLoop.js";
import type { ToolDefinition } from "../tools/manifest.js";
import { actionLog } from "../actionLog.js";

function fakeEngine(responses: string[]): AgentEngine & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  let i = 0;
  return {
    calls,
    generate: vi.fn(async (args: unknown) => {
      calls.push([args]);
      return responses[Math.min(i++, responses.length - 1)];
    }),
  };
}

const toolBlock = (name: string, args: Record<string, unknown>) =>
  "```tool\n" + JSON.stringify({ name, arguments: args }) + "\n```";

const noMemory = async () => null;

const scenarioCatalog: ToolDefinition[] = [
  {
    name: "create_event",
    description: "Crea un evento en el calendario.",
    parameters: {
      title: { type: "string", description: "Título", required: true },
      when: { type: "string", description: "Fecha/hora ISO", required: true },
    },
  },
  {
    name: "availability_query",
    description: "Consulta la disponibilidad entre dos fechas.",
    parameters: {
      start: { type: "string", description: "Inicio ISO", required: true },
      end: { type: "string", description: "Fin ISO", required: true },
    },
  },
];

beforeEach(() => {
  actionLog.clear();
});

describe("el paso de la política y el catálogo por el bucle", () => {
  it("un DENY configurado llega al despacho principal: el handler del guion nunca se ejecuta", async () => {
    let executions = 0;
    const engine = fakeEngine([
      toolBlock("create_event", { title: "Dentista", when: "2026-11-20T10:00:00" }),
      "Entendido, no lo creo.",
    ]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {
        create_event: async () => {
          executions++;
          return "creado";
        },
      },
      loadMemory: noMemory,
      toolPolicy: { create_event: "DENY" },
      toolsCatalog: scenarioCatalog,
    });
    expect(executions).toBe(0);
    const entry = actionLog.list().find((e) => e.tool === "create_event");
    expect(entry?.outcome).toBe("denied");
    expect(result.response).toContain("no lo creo");
  });

  it("el toolsCatalog llega a la descripción del prompt: el prompt describe el catálogo y no LOCAL_TOOLS", async () => {
    const engine = fakeEngine(["Hola, ¿en qué te ayudo?"]);
    await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {},
      loadMemory: noMemory,
      toolsCatalog: scenarioCatalog,
    });
    const first = engine.calls[0][0] as { messages: { role: string; content: string }[] };
    const system = first.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("availability_query");
    expect(system).toContain("create_event");
    // Sin el enhebrado, la intención «conversar» describiría su
    // lista de siempre (con remember_fact) y no el catálogo.
    expect(system).not.toContain("remember_fact");
  });

  it("una herramienta del catálogo propuesta por el motor guionizado se despacha, en vez de morir invalid", async () => {
    let executions = 0;
    const engine = fakeEngine([
      toolBlock("create_event", { title: "Dentista", when: "2026-11-20T10:00:00" }),
      "Evento creado.",
    ]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {
        create_event: async () => {
          executions++;
          return "creado";
        },
      },
      loadMemory: noMemory,
      toolsCatalog: scenarioCatalog,
    });
    expect(executions).toBe(1);
    expect(result.toolUses.some((u) => u.name === "create_event")).toBe(true);
  });

  it("sin las opciones nuevas, prompt y despacho son los de siempre (ancla)", async () => {
    let executions = 0;
    const engine = fakeEngine([toolBlock("device_time", {}), "Son las 10:30."]);
    const result = await runAgentLoop("dime algo interesante", {
      engine,
      handlers: {
        device_time: async () => {
          executions++;
          return "2026-11-19T10:30:00";
        },
      },
      loadMemory: noMemory,
    });
    expect(executions).toBe(1);
    expect(result.response).toContain("10:30");
    const first = engine.calls[0][0] as { messages: { role: string; content: string }[] };
    const system = first.messages.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain("device_time");
    expect(system).toContain("remember_fact");
  });
});
