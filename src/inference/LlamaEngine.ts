/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * LlamaEngine — la fachada del motor con la forma que las piezas
 * portadas del móvil consumen (tanda 14, costura de plataforma
 * nombrada). El móvil habla con llama.rn a través de su
 * `src/inference/LlamaEngine.ts`; en PC esa hoja no existe y las
 * piezas portadas (el ejecutor de `src/routing/executor.ts`, el
 * bucle de `src/agent/loop/`) importan este módulo. Aquí vive la
 * traducción a node-llama-cpp, y solo aquí: ningún llamador toca
 * la librería nativa por otra vía para generar.
 *
 * Contrato, el del móvil en su sustancia:
 *   - `load(filename)`: carga el GGUF del catálogo cuyo nombre
 *     instalado es ese (`<id>.gguf`), verificado en tamaño y
 *     huella por la vía única (`verifiedModelPath`) antes de que
 *     el parser nativo vea un byte, con el contexto que el plan
 *     de escritorio aprueba para esta máquina
 *     (`planDesktopContext`). Si ese mismo fichero ya reside, no
 *     hace nada. Sin directorio de modelos registrado
 *     (`setLlamaModelsDir`), la carga falla en claro.
 *   - `generate(...)`: sesión EFÍMERA por llamada — secuencia
 *     nueva, historial fijado desde los mensajes de la llamada y
 *     secuencia desechada al terminar; el historial vive en el
 *     llamador (el bucle, el ejecutor), nunca aquí. Honra
 *     `nPredict` como techo de tokens, la temperatura tal como se
 *     pasa (o la del preset nombrado, con la tabla del móvil),
 *     `signal` como parada y `timeoutMs` como corte duro: al
 *     cortar, avisa por `onTimeout` y RESUELVE con el texto
 *     parcial acumulado, como hace el motor del móvil al parar
 *     una compleción; no lanza por parada ni por plazo.
 *   - `responseFormat` con `json_schema` se sirve con la gramática
 *     que node-llama-cpp deriva del esquema; `json_object`, con la
 *     gramática de un objeto JSON genérico.
 *   - `getModelInfo()` dice el fichero residente EN LA FORMA EN
 *     QUE SE PIDIÓ CARGAR (el ejecutor compara contra esa forma)
 *     y el contexto con el que cargó; `null` sin modelo.
 *   - `hasEmbeddedChatTemplate()` lee la plantilla de chat de los
 *     metadatos del GGUF cargado, no una tabla.
 *   - `countTokens(text)`: conteo real con el tokenizador del
 *     modelo residente, la misma convención que `LocalEngine`
 *     (sin tokens especiales).
 *
 * `LocalEngine` (src/core/engine.ts) no se toca: sigue siendo el
 * motor de la fundación para sus llamadores. Esta fachada retiene
 * su propio modelo y su propio contexto, como el motor del móvil
 * retiene el suyo.
 */

import { freemem, totalmem } from "node:os";
import { getLlama, LlamaChatSession, LlamaCompletion } from "node-llama-cpp";
import type { LlamaContext, LlamaGrammar, LlamaModel } from "node-llama-cpp";
import { DESKTOP_CATALOG, type CatalogEntry } from "../core/catalog.js";
import { DEFAULT_SYSTEM_PROMPT, type ChatMessageInput, type SamplingPresetName } from "../core/engine.js";
import { verifiedModelPath } from "../core/loadPath.js";
import { planDesktopContext, type MachineSnapshot } from "../core/ram.js";

export type { ChatMessageInput, SamplingPresetName };

export interface FacadeModelInfo {
  filename: string;
  nCtx: number;
}

export interface FacadeGenerateArgs {
  messages?: ChatMessageInput[];
  prompt?: string;
  nPredict: number;
  temperature?: number;
  samplingPreset?: SamplingPresetName;
  onToken?: (chunk: string) => void;
  timeoutMs?: number;
  onTimeout?: () => void;
  signal?: AbortSignal;
  telemetryContext?: { taskType?: string };
  responseFormat?: { type: "json_object" | "json_schema"; json_schema?: { schema: object } };
}

/** La tabla de presets del móvil (SAMPLING_PRESETS, 0.1.108). */
const SAMPLING_PRESETS: Record<SamplingPresetName, { temperature: number; minP: number; repeatPenalty?: number }> = {
  structured: { temperature: 0.1, minP: 0 },
  factual: { temperature: 0.3, minP: 0, repeatPenalty: 1.1 },
  chat: { temperature: 0.7, minP: 0, repeatPenalty: 1.1 },
};

/** T-10 del móvil: semilla fija de los presets reproducibles. */
const DETERMINISTIC_SEED = 1234567;

let modelsDir: string | null = null;

/**
 * Registra el directorio de modelos de la instalación. Lo llama la
 * carcasa al arrancar (y los instrumentos de la pasada); sin él,
 * `load` no sabe dónde mirar y falla en claro.
 */
export function setLlamaModelsDir(dir: string): void {
  modelsDir = dir;
}

/**
 * El directorio de modelos registrado, o null si aún no se registró.
 * Lo lee el censo de presencia en disco de la fábrica del turno
 * (H-1 de la caza de errores de la tanda 14): la presencia se mide
 * contra este directorio, nunca se declara.
 */
export function llamaModelsDir(): string | null {
  return modelsDir;
}

function machineSnapshot(): MachineSnapshot {
  return { totalRamBytes: totalmem(), freeRamBytes: freemem() };
}

class LlamaEngineFacade {
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private entry: CatalogEntry | null = null;
  private loadedFilename: string | null = null;
  private contextSize = 0;
  private inFlight: AbortController | null = null;
  /** Serializa las generaciones: una a la vez, como el motor del móvil. */
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * El prompt efectivamente enviado en la última generación (los
   * mensajes en su forma serializada, o el prompt crudo): el
   * registro que la pasada del turno guarda para cobrar el cerco
   * de I-1 sobre lo que el modelo vio de verdad, no sobre lo que
   * se suponía que veía. Solo la última generación; sin historial.
   */
  private lastSentPrompt: string | null = null;

  /** El prompt de la última generación, o null si aún no hubo ninguna. */
  get lastPromptSent(): string | null {
    return this.lastSentPrompt;
  }

  get isLoaded(): boolean {
    return this.model !== null && this.context !== null;
  }

  getModelInfo(): FacadeModelInfo | null {
    if (!this.isLoaded || this.loadedFilename === null) return null;
    return { filename: this.loadedFilename, nCtx: this.contextSize };
  }

  hasEmbeddedChatTemplate(): boolean {
    if (!this.model) return false;
    const metadata = this.model.fileInfo?.metadata as
      | { tokenizer?: { chat_template?: unknown } }
      | undefined;
    const template = metadata?.tokenizer?.chat_template;
    return typeof template === "string" && template.length > 0;
  }

  countTokens(text: string): number {
    if (!this.model) throw new Error("LlamaEngine: no hay modelo residente para contar tokens");
    return this.model.tokenize(text).length;
  }

  async load(filename: string): Promise<void> {
    if (this.isLoaded && this.loadedFilename === filename) return;
    if (!modelsDir) {
      throw new Error("LlamaEngine: el directorio de modelos no está registrado (setLlamaModelsDir)");
    }
    const base = filename.split(/[\\/]/).pop() ?? filename;
    const entry = DESKTOP_CATALOG.find((e) => `${e.id}.gguf` === base);
    if (!entry) {
      throw new Error(`LlamaEngine: «${filename}» no es un fichero del catálogo de escritorio`);
    }
    const plan = planDesktopContext(entry, machineSnapshot());
    if (!plan) {
      throw new Error(`LlamaEngine: ${entry.label} no cabe en la memoria de esta máquina`);
    }
    // La vía única de carga: tamaño y huella verificados antes del parser.
    const modelPath = await verifiedModelPath(modelsDir, entry);
    const llama = await getLlama({ skipDownload: true }).catch((err: unknown) => {
      throw new Error(
        "LlamaEngine: el binario local del motor no está disponible y NIDO nunca descarga ni compila binarios al usar la app (sin conexión por diseño).",
        { cause: err },
      );
    });
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({
      contextSize: plan.contextSize,
      batchSize: 512,
      threads: 0,
    });
    await this.disposeNow();
    this.model = model;
    this.context = context;
    this.entry = entry;
    this.loadedFilename = filename;
    this.contextSize = plan.contextSize;
  }

  /** Descarga el modelo residente y su contexto. */
  async unload(): Promise<void> {
    await this.disposeNow();
  }

  private async disposeNow(): Promise<void> {
    const context = this.context;
    const model = this.model;
    this.context = null;
    this.model = null;
    this.entry = null;
    this.loadedFilename = null;
    this.contextSize = 0;
    try {
      await context?.dispose();
    } catch { /* disposición en mejor esfuerzo */ }
    try {
      await model?.dispose();
    } catch { /* disposición en mejor esfuerzo */ }
  }

  /** Para la generación en vuelo, si la hay (la parada del llamador). */
  stop(): void {
    this.inFlight?.abort();
  }

  generate(args: FacadeGenerateArgs): Promise<string> {
    const run = this.queue.then(() => this.generateNow(args));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async generateNow(args: FacadeGenerateArgs): Promise<string> {
    if (!this.model || !this.context) {
      throw new Error("LlamaEngine: generate sin modelo residente");
    }
    const preset = args.samplingPreset ? SAMPLING_PRESETS[args.samplingPreset] : undefined;
    const temperature = args.temperature ?? preset?.temperature ?? 0.7;
    const minP = preset?.minP;
    const seed =
      args.samplingPreset === "structured" || args.samplingPreset === "factual"
        ? DETERMINISTIC_SEED
        : undefined;

    // Parada y plazo comparten un mismo controlador: la señal del
    // llamador y el temporizador abortan la misma generación.
    const controller = new AbortController();
    this.inFlight = controller;
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (args.signal) {
      if (args.signal.aborted) controller.abort();
      else args.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer =
      args.timeoutMs !== undefined && args.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              args.onTimeout?.();
            } catch { /* el aviso no tumba la generación */ }
            controller.abort();
          }, args.timeoutMs)
        : null;

    this.lastSentPrompt =
      args.messages !== undefined
        ? JSON.stringify(args.messages)
        : (args.prompt ?? null);
    // A-U6 (F-1): el parcial de ESTA generación, acumulado chunk
    // a chunk antes de reenviarlo, en la forma del móvil (su
    // fachada acumula `streamed` en su callback de tokens y el
    // texto asentado de una generación interrumpida es ese
    // parcial). Vive en una local de la llamada, nunca en
    // estado de la instancia: dos generaciones encoladas no
    // comparten parcial, y una generación que completa sigue
    // devolviendo el texto de la librería, no esta
    // concatenación. Sin él, la fachada perdía el parcial en
    // sus dos vías y un turno parado asentaba 0 caracteres.
    let streamed = "";
    const onToken = (chunk: string) => {
      streamed += chunk;
      args.onToken?.(chunk);
    };
    try {
      const grammar = await this.grammarFor(args.responseFormat);
      const sequence = this.context.getSequence();
      try {
        if (args.messages && args.messages.length > 0) {
          return await this.generateFromMessages(sequence, args, {
            temperature,
            minP,
            seed,
            grammar,
            signal: controller.signal,
            onToken,
            streamed: () => streamed,
          });
        }
        if (args.prompt !== undefined) {
          return await this.generateFromPrompt(sequence, args, {
            temperature,
            minP,
            seed,
            grammar,
            signal: controller.signal,
            onToken,
            streamed: () => streamed,
          });
        }
        throw new Error("LlamaEngine: generate necesita messages o prompt");
      } finally {
        await sequence.dispose().catch(() => undefined);
      }
    } catch (err) {
      // Parada o plazo (F-4): las vías de abajo ya resuelven con
      // el texto parcial cuando el aborto las alcanza; un error
      // de aborto que se escape hasta aquí resuelve con el
      // mismo parcial acumulado, nunca a un turno caído por una
      // parada pedida ni a una burbuja en 0 caracteres.
      if (controller.signal.aborted && (timedOut || args.signal?.aborted)) {
        return streamed;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      if (args.signal) args.signal.removeEventListener("abort", onExternalAbort);
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  private async grammarFor(
    responseFormat: FacadeGenerateArgs["responseFormat"],
  ): Promise<LlamaGrammar | undefined> {
    if (!responseFormat) return undefined;
    const llama = await getLlama({ skipDownload: true });
    if (responseFormat.type === "json_schema" && responseFormat.json_schema?.schema) {
      return llama.createGrammarForJsonSchema(responseFormat.json_schema.schema as never);
    }
    if (responseFormat.type === "json_object") {
      return llama.createGrammarForJsonSchema({ type: "object" } as never);
    }
    return undefined;
  }

  private async generateFromMessages(
    sequence: ReturnType<LlamaContext["getSequence"]>,
    args: FacadeGenerateArgs,
    opts: {
      temperature: number;
      minP?: number;
      seed?: number;
      grammar?: LlamaGrammar;
      signal: AbortSignal;
      onToken: (chunk: string) => void;
      streamed: () => string;
    },
  ): Promise<string> {
    const messages = args.messages ?? [];
    const system = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m !== system);
    const lastUser = [...rest].reverse().find((m) => m.role === "user");
    if (!lastUser) throw new Error("LlamaEngine: la llamada no trae mensaje de usuario");
    const history = rest.slice(0, rest.lastIndexOf(lastUser));
    const session = new LlamaChatSession({
      contextSequence: sequence,
      // Sin mensaje de sistema en la llamada, el de NIDO: la sesión
      // nunca conversa sin prompt de sistema (lección medida de la
      // tanda 1 en src/core/engine.ts).
      systemPrompt: system?.content ?? DEFAULT_SYSTEM_PROMPT,
    });
    if (history.length > 0) {
      session.setChatHistory(
        history.map((m) =>
          m.role === "assistant"
            ? { type: "model" as const, response: [m.content] }
            : { type: "user" as const, text: m.content },
        ),
      );
    }
    try {
      return await session.prompt(lastUser.content, {
        maxTokens: args.nPredict,
        temperature: opts.temperature,
        minP: opts.minP,
        seed: opts.seed,
        grammar: opts.grammar,
        signal: opts.signal,
        onTextChunk: opts.onToken,
      });
    } catch (err) {
      // A-U6 (F-2): al abortar manda el parcial acumulado. El
      // historial de la sesión nunca contiene la respuesta en
      // vuelo (la librería solo lo asigna al completar, y el
      // aborto lanza antes), así que extraer de él devolvía la
      // cadena vacía o, con historial, la respuesta ANTERIOR;
      // la extracción queda como red para cualquier vía en que
      // la librería sí la hubiera asentado.
      if (opts.signal.aborted) return opts.streamed() || extractModelText(session);
      throw err;
    }
  }

  private async generateFromPrompt(
    sequence: ReturnType<LlamaContext["getSequence"]>,
    args: FacadeGenerateArgs,
    opts: {
      temperature: number;
      minP?: number;
      seed?: number;
      grammar?: LlamaGrammar;
      signal: AbortSignal;
      onToken: (chunk: string) => void;
      streamed: () => string;
    },
  ): Promise<string> {
    const completion = new LlamaCompletion({ contextSequence: sequence });
    try {
      return await completion.generateCompletion(args.prompt ?? "", {
        maxTokens: args.nPredict,
        temperature: opts.temperature,
        minP: opts.minP,
        seed: opts.seed,
        grammar: opts.grammar,
        signal: opts.signal,
        onTextChunk: opts.onToken,
      });
    } catch (err) {
      // A-U6 (F-3): la vía sin plantilla devolvía la cadena
      // vacía por construcción ante cualquier aborto; resuelve
      // con el parcial acumulado, como la de con plantilla.
      if (opts.signal.aborted) return opts.streamed();
      throw err;
    }
  }
}

/** El texto del modelo en el historial de una sesión abortada. */
function extractModelText(session: LlamaChatSession): string {
  const history = session.getChatHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item && item.type === "model") {
      return item.response.filter((r): r is string => typeof r === "string").join("");
    }
  }
  return "";
}

/** La instancia que las piezas portadas importan, como en el móvil. */
export const llamaEngine = new LlamaEngineFacade();
