/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Recreación de comportamiento (E3, tanda 3 · J-2) del motor de
 * embeddings del móvil contra el motor de la casa: la fuente
 * habla con llama.rn; esta habla con node-llama-cpp por la vía
 * única de carga de E0/E1 (`src/core/loadPath.ts`), y la
 * diferencia está en la costura del motor, no en el
 * comportamiento de la clase: la misma cola serializada, la
 * misma puerta de carga envolviendo la cola, el mismo
 * pre-flight de RAM antes de liberar el modelo en uso, la misma
 * residencia bajo demanda con proveedor y vuelo único, la misma
 * marca de último uso viviendo en el motor y los mismos
 * prefijos por modelo, leídos dentro de la tarea encolada.
 *
 * Dos diferencias de plataforma, asentadas en la apertura de la
 * tanda:
 *
 *   - La identidad del modelo cargado es la huella verificada
 *     del fichero al cargar (la forma de PC de la búsqueda por
 *     nombre en el manifiesto móvil), y es fail-closed: la
 *     huella tiene que ser una de las dos conocidas del mundo
 *     de búsqueda (la del e5, la del bge), y si el nombre del
 *     fichero es una entrada del catálogo de la casa, la vía lo
 *     verifica entero contra la entrada. Los vectores de un
 *     modelo no acreditado jamás entran en la base.
 *   - El pre-flight usa la matemática de la casa
 *     (`availableBudgetBytes` sobre la foto de `node:os`): lo
 *     necesario es el tamaño del fichero más el margen de
 *     trabajo del contexto de embeddings, y el rechazo es un
 *     `EmbeddingFitError` con el mensaje de la fuente, para que
 *     la pantalla de Ajustes lo convierta en «no hay memoria
 *     suficiente» en vez de un fallo genérico.
 *
 * Lo que esta recreación OMITE de la fuente, asentado: la
 * telemetría del móvil (sin contraparte en PC: nada registra
 * duraciones ni rechazos en la casa) y el envoltorio de etapas
 * `withStage` de su arranque. El directorio de modelos nace en
 * `models/` del repositorio y la carcasa lo fijará al
 * directorio de datos en E3.7 por la costura exportada
 * `setEmbeddingModelsDir`.
 */

import { freemem, totalmem } from "node:os";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getLlama, type LlamaEmbeddingContext, type LlamaModel } from "node-llama-cpp";
import { resolveModelFile, sha256OfFile, verifyModelFile } from "../core/loadPath.js";
import { availableBudgetBytes, toGib } from "../core/ram.js";
import { DESKTOP_CATALOG } from "../core/catalog.js";
import {
  BGE_SMALL_EN_PROFILE,
  BGE_SMALL_EN_SHA256,
  MULTILINGUAL_E5_SMALL_SHA256,
  embeddingProfileForSha,
  type EmbeddingProfile,
} from "./embeddingProfile.js";
import { withNativeLoadGate } from "../inference/nativeGate.js";

export { cosineSimilarity } from "./pure.js";

/**
 * The embedding model file is ~132 MB on disk but needs working RAM while
 * llama.cpp builds its context and computes. This is the extra headroom the
 * load demands on top of the file size, matching the phone's rule so the
 * load fails honestly on a tight machine instead of taking the process down.
 */
const EMBEDDING_HEADROOM_BYTES = 64 * 1024 * 1024;

/**
 * El contexto de embeddings, en tokens: el del e5 sellado
 * (512, como el n_ctx del móvil); es el tamaño del contexto
 * que se crea.
 */
const EMBEDDING_CONTEXT_TOKENS = 512;

/**
 * El tope usable de una entrada, medido (H-E6-4): con el
 * contexto de 512, getEmbeddingFor acepta 510 tokens y
 * rechaza 511 — la binding reserva 2. fitToContext recorta
 * a este tope, no al del contexto.
 */
const EMBEDDING_USABLE_TOKENS = 510;

/**
 * Raised when the device does not have enough free RAM to load the
 * embedding model. The settings screen catches this exact class and turns
 * it into the "not enough memory" message instead of a generic failure.
 */
export class EmbeddingFitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingFitError";
  }
}

/** El directorio de modelos de esta pieza; la carcasa lo fija en E3.7. */
let embeddingModelsDir = join(process.cwd(), "models");

/** Fija el directorio de modelos (la carcasa, al arrancar; las sondas, al montar su escena). */
export function setEmbeddingModelsDir(dir: string): void {
  embeddingModelsDir = dir;
}

/**
 * Wraps a small local embedding model (GGUF, <300MB) via node-llama-cpp's
 * embedding mode. Kept as a separate, lighter-weight context from the main
 * generation LLM so it can stay resident cheaply for fast retrieval without
 * competing with the primary model's RAM budget.
 */
export class EmbeddingEngine {
  private context: LlamaEmbeddingContext | null = null;
  private model: LlamaModel | null = null;
  private modelFilename: string | null = null;
  private modelSha256: string | null = null;
  // Optimización 2026-11-08 (fase 4): residencia bajo demanda. El
  // último fichero cargado se recuerda también tras descargar (para
  // poder recargar sin que el llamador repita la resolución), y la
  // pantalla registra un proveedor que resuelve el fichero activo
  // cuando este motor nunca cargó en la sesión.
  private lastFilename: string | null = null;
  private ensureProvider: (() => Promise<string | null>) | null = null;
  private ensuring: Promise<boolean> | null = null;
  // 0.1.84 (cierre de la desviación de la fase 4): la marca de último
  // uso vive en el MOTOR, no en la pantalla. La 0.1.83 la asignaba
  // solo ChatScreen al terminar el arranque, y las búsquedas — que no
  // pasan por la pantalla — no la renovaban: pasados 10 min el pulso
  // descargaba el motor pese a un uso reciente y ciclaba recarga y
  // descarga cada 30 s. Ahora cada embed consumado la renueva aquí.
  private lastUsedAt: number | null = null;
  // node-llama-cpp rejects a call on a context that's still working
  // ("Context is busy"), so loads, embeddings and unloads run one at a time.
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  load(modelFilename: string): Promise<void> {
    // Fase 2 (reapertura del defecto, 2026-11-08): tras la puerta de
    // carga, como el LLM — una carga nativa a la vez en todo el proceso.
    // Antes los dos motores cargaban en paralelo (Promise.all en
    // ChatScreen) y cada pre-flight leía la foto de RAM sin el otro.
    return withNativeLoadGate(() => this.enqueue(() => this.loadNow(modelFilename)));
  }

  private async loadNow(modelFilename: string) {
    // Same rationale as LlamaEngine.load: ChatScreen re-mounts (and calls
    // load() again) every time Settings is closed, even if the user didn't
    // touch the model — skip re-initializing the native context if it's
    // already loaded with this exact file.
    if (this.context && this.modelFilename === modelFilename) {
      return;
    }

    const base = basename(modelFilename);
    const modelPath = await resolveModelFile(embeddingModelsDir, base);
    // Puerta de integridad (la vía única de la casa): si el nombre
    // es una entrada del catálogo, el fichero se verifica entero
    // contra la entrada (tamaño y huella). La existencia en la
    // ruta esperada nunca basta.
    const catalogEntry = DESKTOP_CATALOG.find((entry) => `${entry.id}.gguf` === base);
    if (catalogEntry) await verifyModelFile(modelPath, catalogEntry);
    // Identidad del modelo cargado: la huella verificada del
    // fichero, y tiene que ser una de las dos conocidas del mundo
    // de búsqueda — otra cosa no es un modelo que esta casa sepa
    // gobernar (ningún perfil podría gobernar sus vectores).
    const sha256 = await sha256OfFile(modelPath);
    if (sha256 !== MULTILINGUAL_E5_SMALL_SHA256 && sha256 !== BGE_SMALL_EN_SHA256) {
      throw new Error(`EmbeddingEngine: ${modelFilename} is not a known embedding model`);
    }
    const info = await stat(modelPath);
    if (!info.isFile()) {
      throw new Error(`Embedding model not found at ${modelPath}`);
    }
    const fileSizeBytes = info.size;
    // F2-2026-10-06: pre-flight ANTES de liberar el modelo actual (igual
    // que LlamaEngine). Si el chequeo falla, se conserva el modelo en uso.
    const snapshot = { totalRamBytes: totalmem(), freeRamBytes: freemem() };
    const availableBytes = availableBudgetBytes(snapshot);
    const neededBytes = fileSizeBytes + EMBEDDING_HEADROOM_BYTES;
    if (snapshot.totalRamBytes > 0 && neededBytes > availableBytes) {
      throw new EmbeddingFitError(
        `Embedding model "${modelFilename}" needs roughly ${toGib(neededBytes)}GB of RAM, ` +
          `but this device only has about ${toGib(availableBytes)}GB free ` +
          `(of ${toGib(snapshot.totalRamBytes)}GB total). Close background apps and retry.`,
      );
    }
    await this.unloadNow();
    // skipDownload: la casa jamás descarga un runtime en silencio;
    // el binario de node-llama-cpp viaja con la instalación.
    const llama = await getLlama({ skipDownload: true });
    const model = await llama.loadModel({ modelPath });
    let context: LlamaEmbeddingContext;
    try {
      context = await model.createEmbeddingContext({ contextSize: EMBEDDING_CONTEXT_TOKENS, threads: 0 });
    } catch (error) {
      await model.dispose();
      throw error;
    }
    this.context = context;
    this.model = model;
    this.modelFilename = modelFilename;
    this.lastFilename = modelFilename;
    this.touchUsed();
    this.modelSha256 = sha256;
  }

  /** ¿Hay un contexto de embeddings residente ahora mismo? */
  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * Último uso real del motor (carga o embed consumado), o null si
   * nunca se usó en esta sesión. Lo consulta el pulso de descarga por
   * inactividad de ChatScreen (embeddingIdleUnloadDue).
   */
  get lastUsedAtMs(): number | null {
    return this.lastUsedAt;
  }

  /** Marca el uso: la carga cuenta como uso, y cada embed también. */
  private touchUsed(): void {
    this.lastUsedAt = Date.now();
  }

  /**
   * Registra quién sabe resolver el fichero de embedding activo
   * (la pantalla, al montar). Lo usa la recarga bajo demanda cuando
   * este motor aún no cargó en la sesión.
   */
  setEnsureLoadedProvider(fn: (() => Promise<string | null>) | null): void {
    this.ensureProvider = fn;
  }

  /**
   * Fase 4: garantiza el motor residente, cargándolo si hace falta.
   * Vuelo único: las llamadas concurrentes comparten la misma
   * carga. Devuelve false cuando no hay forma de saber qué cargar
   * (ni memoria de la sesión ni proveedor) o la carga falla — el
   * llamador degrada (búsqueda léxica) en vez de romper. NUNCA se
   * llama desde dentro de una tarea de la cola: load() también
   * encola y sería un deadlock; los métodos públicos lo invocan
   * ANTES de encolar su trabajo.
   */
  ensureLoaded(): Promise<boolean> {
    if (this.context) return Promise.resolve(true);
    if (!this.ensuring) {
      // El vuelo se limpia en una continuación POSTERIOR a la
      // asignación, nunca en un finally dentro del cuerpo:
      // sin proveedor ni memoria el cuerpo se completa en
      // síncrono y su finally corría antes de asignar, dejando
      // pegado un vuelo resuelto en false para siempre (un
      // proveedor registrado después no cargaba jamás;
      // reproducido en la carcasa y cobrado en embed.test.ts,
      // E6 paso 7).
      const flight = (async () => {
        try {
          const filename = this.lastFilename ?? (this.ensureProvider ? await this.ensureProvider() : null);
          if (!filename) return false;
          await this.load(filename);
          return this.context !== null;
        } catch {
          return false;
        }
      })();
      this.ensuring = flight;
      void flight.then(() => {
        if (this.ensuring === flight) this.ensuring = null;
      });
    }
    return this.ensuring;
  }

  /** Catalog SHA-256 of the loaded model (the knowledge base is stamped with it), or null. */
  get loadedModelSha256(): string | null {
    return this.modelSha256;
  }

  /** Search settings of the loaded model (bge's when none is loaded). */
  get profile(): EmbeddingProfile {
    return this.modelSha256 ? embeddingProfileForSha(this.modelSha256) : BGE_SMALL_EN_PROFILE;
  }

  /** A question, with the model's query prefix ("query: " for e5, nothing for bge). */
  embedQuery(text: string): Promise<Float32Array> {
    return this.embedQueryTagged(text).then((r) => r.vector);
  }

  /** embedQuery plus the model that computed it (its thresholds apply to the scores). */
  embedQueryTagged(text: string): Promise<{ vector: Float32Array; modelSha256: string | null }> {
    return this.ensureLoaded().then(() =>
      this.enqueue(async () => {
        const modelSha256 = this.modelSha256;
        const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).queryPrefix : "";
        const vector = await this.embedNow(prefix + text);
        return { vector, modelSha256 };
      }),
    );
  }

  /** A stored text (article, document chunk), with the model's passage prefix. */
  embedPassage(text: string): Promise<Float32Array> {
    return this.embedPassageTagged(text).then((r) => r.vector);
  }

  /**
   * Like embedPassage, plus the SHA-256 of the model that actually computed
   * the vector (read inside the same queued task, so a model switch queued
   * meanwhile can't be confused with it). Stored vectors are written with
   * this tag: see insertChunk's modelSha256.
   */
  embedPassageTagged(text: string): Promise<{ vector: Float32Array; modelSha256: string | null }> {
    return this.ensureLoaded().then(() =>
      this.enqueue(async () => {
        const modelSha256 = this.modelSha256;
        const prefix = modelSha256 ? embeddingProfileForSha(modelSha256).passagePrefix : "";
        const vector = await this.embedNow(prefix + text);
        return { vector, modelSha256 };
      }),
    );
  }

  /** Raw embedding, no prefix. Callers use embedQuery / embedPassage. */
  embed(text: string): Promise<Float32Array> {
    return this.ensureLoaded().then(() => this.enqueue(() => this.embedNow(text)));
  }

  /**
   * H-E6-4 (E6, paso 9; medido sobre los fixtures sellados):
   * node-llama-cpp RECHAZA cualquier entrada de más de
   * EMBEDDING_CONTEXT_TOKENS tokens («Input is longer than the
   * usable context size»), y un fragmento ordinario de 2.000
   * caracteres en español pasa de ese tope (23 de 27 en los
   * documentos sellados): la importación entera rompía, porque
   * el importador solo degrada ante «native embedding
   * unavailable». La capa nativa del móvil (llama.rn, n_ctx
   * 512) trunca en silencio, así que la costura se alinea
   * aquí: la entrada se tokeniza con el modelo cargado y se
   * recorta a los tokens que caben; el vector es el de ese
   * prefijo, como en el móvil. El texto que cabe no se toca.
   * Sin tokenizador en el modelo (dobles de test), el texto va
   * tal cual y manda el comportamiento anterior.
   */
  private fitToContext(text: string): string {
    const model = this.model;
    if (!model || typeof model.tokenize !== "function" || typeof model.detokenize !== "function") {
      return text;
    }
    const tokens = model.tokenize(text);
    if (tokens.length <= EMBEDDING_USABLE_TOKENS) return text;
    return model.detokenize(tokens.slice(0, EMBEDDING_USABLE_TOKENS));
  }

  private async embedNow(text: string): Promise<Float32Array> {
    if (!this.context) throw new Error("EmbeddingEngine: model not loaded");
    try {
      const result = await this.context.getEmbeddingFor(this.fitToContext(text));
      // Uso consumado: renueva la marca (0.1.84, ver lastUsedAt).
      this.touchUsed();
      return Float32Array.from(result.vector);
    } catch (e) {
      // The native embedding binding may be missing from the build,
      // surfacing as the cryptic "undefined is not a function".
      // Translate it to a descriptive error so callers can degrade
      // gracefully (seed without vectors) instead of blocking setup.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("undefined is not a function")) {
        throw new Error(
          "EmbeddingEngine: native embedding unavailable in this build " +
            "(node-llama-cpp embedding context failed to initialize)",
        );
      }
      throw e;
    }
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    const context = this.context;
    const model = this.model;
    this.context = null;
    this.model = null;
    this.modelFilename = null;
    this.modelSha256 = null;
    if (context) await context.dispose();
    if (model) await model.dispose();
  }
}

export const embeddingEngine = new EmbeddingEngine();
