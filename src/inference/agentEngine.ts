/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * agentEngine.ts — el adaptador de producción del motor (tanda 14).
 *
 * Una pieza con dos consumidores (elección E-6 de la apertura): la
 * misma costura sobre la fachada `llamaEngine` sirve al bucle del
 * agente (`AgentEngine` de agentLoop.ts) y al productor del
 * resumen de conversación (`SummarizeEngine` de summarize.ts, que
 * se registra con `wireProductionEngines()` al arrancar la
 * carcasa). El bucle es el único dueño del historial; el adaptador
 * no guarda estado de conversación: traduce la llamada y delega.
 *
 * Las etiquetas de tarea (taskType) viajan tal como el llamador
 * las pasa: el bucle etiqueta «agent-loop» y la vía de JSON de
 * herramientas «tool-call-json» / «tool-call-json-repair»; los
 * tokens que la fachada cuenta por su `onToken` son tokens de
 * respuesta, y así se nombran en todo registro que los cite.
 */

import type { AgentEngine } from "../agent/loop/agentLoop.js";
import type { SummarizeEngine } from "../services/summarize.js";
import { setSummarizeEngine } from "../services/summarize.js";
import { llamaEngine } from "./LlamaEngine.js";

/** Techo por defecto cuando el llamador no pide presupuesto. */
const DEFAULT_N_PREDICT = 512;

/** El motor del bucle en producción: la fachada, sin estado propio. */
export const productionAgentEngine: AgentEngine = {
  async generate(args) {
    return llamaEngine.generate({
      messages: args.messages,
      nPredict: args.nPredict ?? DEFAULT_N_PREDICT,
      temperature: args.temperature,
      samplingPreset: args.samplingPreset,
      timeoutMs: args.timeoutMs,
      signal: args.signal,
      onToken: args.onToken,
      telemetryContext: args.telemetryContext,
      responseFormat: args.responseFormat,
    });
  },
};

/** El motor del productor de resúmenes: la misma fachada. */
export const productionSummarizeEngine: SummarizeEngine = {
  async generate(args) {
    return llamaEngine.generate({
      messages: args.messages,
      prompt: args.prompt,
      nPredict: args.nPredict ?? DEFAULT_N_PREDICT,
      temperature: args.temperature,
      samplingPreset: args.samplingPreset,
    });
  },
  hasEmbeddedChatTemplate() {
    return llamaEngine.hasEmbeddedChatTemplate();
  },
};

/**
 * Registra el motor del productor de resúmenes sobre la misma
 * costura. Lo llama la carcasa al arrancar; la persistencia del
 * resumen sobre el almacén cifrado es pieza aparte (el registro
 * de integración de la tanda), no de este adaptador.
 */
export function wireProductionEngines(): void {
  setSummarizeEngine(productionSummarizeEngine);
}
