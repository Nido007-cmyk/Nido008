/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Motor de NIDO PC: envoltura propia y mínima sobre node-llama-cpp
 * (bindings de Node para llama.cpp). El motor hace tres cosas y solo
 * tres: cargar un GGUF local con el contexto que la matemática de
 * ram.ts aprobó, responder a un prompt en una sesión de chat, y
 * devolver las cifras medidas de la generación (tokens y tiempo) para
 * que la casa nunca prometa velocidades que no midió.
 *
 * Sin red: este módulo no descarga nada. El fichero ya está en disco
 * o no hay motor.
 *
 * La cirugía de E4 (paso 5) deja el motor completo para el gestor:
 *
 *   - Retiene el contexto además del modelo, y `unload()` camina
 *     la cadena de liberación en su orden: sesión → secuencia →
 *     contexto → modelo. Tras `unload()`, `ask` y `countTokens`
 *     fallan con el mismo «engine not loaded» (regresión cobrada
 *     de la tanda 1: el modelo retenido no puede sobrevivir a la
 *     descarga, o el conteo contaría sobre un modelo muerto).
 *   - La carga cierra el TOCTOU (D-4, mecanismo firmado): el
 *     fichero verificado se copia a un directorio privado del
 *     proceso (nombre no adivinable, fuera del directorio de
 *     modelos) y `loadModel` carga desde la copia; la copia se
 *     retira tras la carga. Ni una sustitución ni una carrera
 *     de enlaces sobre el nombre instalado pueden colar bytes
 *     no verificados entre la verificación y el parser.
 *   - `ask` acepta el prompt de sistema y el muestreo por
 *     llamada: un prompt de sistema distinto del de la carga
 *     corre en una sesión efímera sobre una secuencia nueva
 *     del contexto retenido, que se desecha al terminar.
 */

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import type { LlamaContext, LlamaModel } from "node-llama-cpp";
import type { CatalogEntry } from "./catalog.js";
import { verifiedModelPath, verifyModelFile } from "./loadPath.js";

/**
 * Alineación al móvil, cierre R1 (paso 6): los dos tipos del motor del
 * móvil que el bucle del turno (`agent/loop/agentLoop.ts`) y
 * `toolCallJson.ts` consumen, copiados de `inference/LlamaEngine.ts` del
 * 0.1.108. LlamaEngine no se porta (su hoja es llama.rn); el contrato de
 * tipos se resuelve en esta costura del motor de PC.
 */
export interface ChatMessageInput {
  role: string;
  content: string;
}

export type SamplingPresetName = "structured" | "factual" | "chat";

export interface GenerationStats {
  promptTokens: number;
  answerTokens: number;
  generationSeconds: number;
  /** Tokens de respuesta por segundo, medidos en esta máquina. */
  tokensPerSecond: number;
}

export interface EngineAnswer {
  text: string;
  stats: GenerationStats;
}

/** El prompt de sistema por defecto: NIDO nunca conversa sin el suyo. */
export const DEFAULT_SYSTEM_PROMPT =
  "You are NIDO, a private offline assistant. Answer directly, briefly and honestly. " +
  "If you do not know something, say so.";

/** La tabla de presets del móvil (SAMPLING_PRESETS, 0.1.108). */
const SAMPLING_PRESETS: Record<
  SamplingPresetName,
  { temperature: number; topK: number; topP: number; minP: number; repeatPenalty?: number }
> = {
  structured: { temperature: 0.1, topK: 20, topP: 0.8, minP: 0 },
  factual: { temperature: 0.3, topK: 20, topP: 0.8, minP: 0, repeatPenalty: 1.1 },
  chat: { temperature: 0.7, topK: 20, topP: 0.8, minP: 0, repeatPenalty: 1.1 },
};

/** El muestreo histórico de `ask` sin opciones: el de la tanda 1. */
const DEFAULT_SAMPLING = { temperature: 0.7, topK: 20, topP: 0.8 };

export interface AskOptions {
  maxTokens?: number;
  /** Prompt de sistema de esta llamada; otro distinto corre en sesión efímera. */
  systemPrompt?: string;
  /** Preset nombrado o valores sueltos; lo suelto manda sobre el preset. */
  samplingPreset?: SamplingPresetName;
  temperature?: number;
  topP?: number;
  topK?: number;
}

/**
 * Las cifras de una generación, como función pura (F-PC63):
 * el cociente se guarda en su forma firmada — solo con tokens
 * y transcurso positivo hay velocidad; en cualquier otro caso
 * es 0, lo no medido declarado, nunca infinito ni `null` en
 * JSON. El transcurso lo mide el reloj fino en `ask`.
 */
export function measuredStats(answerTokens: number, generationSeconds: number): GenerationStats {
  return {
    promptTokens: -1, // la sesión no expone el conteo del prompt; no se inventa
    answerTokens,
    generationSeconds,
    tokensPerSecond:
      generationSeconds > 0 && answerTokens > 0 ? answerTokens / generationSeconds : 0,
  };
}

export class LocalEngine {
  private session: LlamaChatSession | null = null;
  /**
   * El modelo cargado, RETENIDO (E3, tanda 1): sin esta referencia no
   * hay tokenizador disponible tras la carga y todo conteo de tokens
   * sería estimación. La sesión sola no expone ni el modelo ni el
   * conteo; el modelo retenido es lo que hace real a `countTokens`.
   */
  private model: LlamaModel | null = null;
  /** El contexto, RETENIDO (E4, paso 5): la secuencia de la sesión nace de él. */
  private context: LlamaContext | null = null;
  /** El prompt de sistema con el que cargó la sesión residente. */
  private systemPrompt: string = DEFAULT_SYSTEM_PROMPT;

  private constructor() {}

  /**
   * Carga un GGUF local y abre el contexto al tamaño aprobado.
   * gpuLayers: "auto" deja que llama.cpp decida la descarga a GPU;
   * en máquinas sin GPU el motor corre en CPU, sin que nadie tenga
   * que configurar nada.
   *
   * La sesión nace SIEMPRE con prompt de sistema: es la paridad con
   * el móvil (que nunca conversa sin el suyo) y además es un
   * requisito medido de esta pila — sin mensaje de sistema, la
   * plantilla de chat de Qwen3 en node-llama-cpp produce una
   * generación vacía (0 tokens, cazado y reproducido en la tanda 1;
   * ver CHECKPOINT). Nunca «arreglarlo» quitando el prompt: el
   * prompt es de NIDO, no del motor.
   */
  static async load(
    modelsDir: string,
    entry: CatalogEntry,
    contextSize: number,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  ): Promise<LocalEngine> {
    // La vía de carga (auditoría de ataque 1, A-2): la ruta sale del
    // directorio de modelos y de la entrada del catálogo, verificada
    // en tamaño y huella ANTES de que el parser nativo vea un byte.
    // Ningún llamante puede pasar una URI ni una ruta arbitraria.
    const modelPath = await verifiedModelPath(modelsDir, entry);
    // skipDownload (A-3): sin binario local válido, node-llama-cpp
    // descargaría binarios de GitHub o compilaría llama.cpp desde la
    // red. NIDO es offline por diseño: lo ejecutable llega con la
    // app o no llega, y la ausencia se dice, no se disimula.
    const llama = await getLlama({ skipDownload: true }).catch((err: unknown) => {
      throw new Error(
        "The local engine binary for this machine is not available, and NIDO never downloads or builds binaries at runtime (offline by design). Reinstall NIDO PC to restore the engine.",
        { cause: err },
      );
    });
    // D-4: la carga lee una copia instantánea en un directorio
    // privado del proceso, no el nombre instalado. La copia se
    // verifica a su vez (tamaño y huella) antes de cargar:
    // una sustitución que cayera entre la verificación del
    // instalado y la copia muere en esa segunda puerta, y tras
    // ella el nombre privado no es alcanzable por ninguna
    // carrera. Coste declarado al firmar el mecanismo: un
    // fileBytes extra de disco durante la carga y el tiempo
    // de la copia con su verificación.
    const staging = await mkdtemp(path.join(tmpdir(), "nido-load-"));
    const stagedPath = path.join(staging, `${entry.id}.gguf`);
    let model: LlamaModel;
    try {
      await copyFile(modelPath, stagedPath);
      await verifyModelFile(stagedPath, entry);
      model = await llama.loadModel({ modelPath: stagedPath });
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    const context = await model.createContext({
      contextSize,
      batchSize: 512,
      // 0 = el máximo de hilos que el hardware admite: en escritorio
      // no hay la presión térmica ni de batería del móvil, y la orden
      // de la casa es usar toda la máquina.
      threads: 0,
    });
    const engine = new LocalEngine();
    engine.model = model;
    engine.context = context;
    engine.systemPrompt = systemPrompt;
    engine.session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt,
    });
    return engine;
  }

  /**
   * Descarga el motor caminando la cadena de liberación en su
   * orden: sesión (que dispone su secuencia) → contexto →
   * modelo. Cada paso va en mejor esfuerzo para que un fallo
   * de disposición no deje los demás sin caminar; al final,
   * ninguna referencia queda viva.
   */
  async unload(): Promise<void> {
    const session = this.session;
    const context = this.context;
    const model = this.model;
    this.session = null;
    this.context = null;
    this.model = null;
    try {
      session?.dispose({ disposeSequence: true });
    } catch { /* disposición en mejor esfuerzo */ }
    try {
      await context?.dispose();
    } catch { /* disposición en mejor esfuerzo */ }
    try {
      await model?.dispose();
    } catch { /* disposición en mejor esfuerzo */ }
  }

  /**
   * Conteo REAL de tokens con el tokenizador del GGUF cargado: la
   * implementación de `TokenCounter` (src/agent/loop/contextBudget.ts)
   * que el presupuesto y los routers reciben inyectada en producción.
   *
   * Convención fijada (E3, tanda 1), la misma de la fixture sellada
   * del estimador: SIN tokens especiales. `model.tokenize(text)` en
   * node-llama-cpp no añade BOS/EOS ni interpreta el texto como
   * tokens especiales (su parámetro `specialTokens` va en falso por
   * defecto y aquí no se toca), así que la cuenta es la del texto
   * pelado, comparable fila a fila contra `realTokens` de la fixture.
   * Caso de calibración: Qwen3-0.6B, cuyo fichero es por huella el
   * mismo que midió la fixture en 2026-11-11; sus cuentas quedan
   * validadas contra el máximo congelado en
   * src/agent/loop/tokenizerFixture.test.ts.
   */
  countTokens(text: string): number {
    if (!this.model) throw new Error("engine not loaded");
    return this.model.tokenize(text).length;
  }

  /**
   * Una pregunta, una respuesta, con sus cifras medidas. El
   * segundo argumento admite la forma histórica (el tope de
   * tokens como número, la que el banco usa) y la de opciones.
   */
  async ask(prompt: string, options: AskOptions | number = {}): Promise<EngineAnswer> {
    if (typeof options === "number") options = { maxTokens: options };
    if (!this.session || !this.context) throw new Error("engine not loaded");
    const preset = options.samplingPreset ? SAMPLING_PRESETS[options.samplingPreset] : undefined;
    const sampling = {
      temperature: options.temperature ?? preset?.temperature ?? DEFAULT_SAMPLING.temperature,
      topP: options.topP ?? preset?.topP ?? DEFAULT_SAMPLING.topP,
      topK: options.topK ?? preset?.topK ?? DEFAULT_SAMPLING.topK,
      minP: preset?.minP,
      // node-llama-cpp cobra la penalización por repetición como
      // objeto { penalty }; la tabla del móvil trae el factor.
      repeatPenalty: preset?.repeatPenalty ? { penalty: preset.repeatPenalty } : undefined,
    };
    const run = async (session: LlamaChatSession): Promise<EngineAnswer> => {
      let answerTokens = 0;
      // Reloj fino (F-PC63): performance.now() es monótono y
      // resuelve bajo el milisegundo; Date.now() dejaba
      // generaciones enteras en un transcurso de cero.
      const started = performance.now();
      const text = await session.prompt(prompt, {
        maxTokens: options.maxTokens ?? 256,
        ...sampling,
        onToken: () => {
          answerTokens += 1;
        },
      });
      const generationSeconds = (performance.now() - started) / 1000;
      return { text: text.trim(), stats: measuredStats(answerTokens, generationSeconds) };
    };
    if (options.systemPrompt === undefined || options.systemPrompt === this.systemPrompt) {
      return run(this.session);
    }
    // Sesión efímera: secuencia nueva del contexto retenido con
    // el prompt de sistema de esta llamada, desechada al salir.
    const ephemeral = new LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: options.systemPrompt,
    });
    try {
      return await run(ephemeral);
    } finally {
      try {
        ephemeral.dispose({ disposeSequence: true });
      } catch { /* disposición en mejor esfuerzo */ }
    }
  }
}
