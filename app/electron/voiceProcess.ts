/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * voiceProcess.ts — el gestor del proceso propio de voz, en
 * el proceso principal (firma 6 de la apertura de E9). Bifurca
 * el anfitrión (voiceHost.ts, un proceso de utilidad de
 * Electron) la primera vez que hace falta y lo mantiene vacío
 * entre dictados; el runtime de voz nunca vive en el
 * principal, así que su contabilidad es la de ese proceso y
 * un fallo del addon nativo no se lleva la app entera.
 *
 * La conducta de memoria es la firmada, sin prometer de más:
 * la escucha se CARGA al pulsar (al abrir la sesión, no al
 * arrancar la app) y se SUELTA al terminar (al cerrarla, por
 * resultado, por error o por parada). La suelta es la parcial
 * medida (V-05: ~214 MB recuperados de ~766 MB; el resto lo
 * retienen las arenas nativas del runtime). La válvula de
 * reciclado cierra la cuenta contra la línea base del propio
 * anfitrión: si tras soltar retiene más que su RSS al cargar
 * más RECYCLE_MARGIN_MB de margen, el gestor lo mata y el
 * siguiente dictado lo bifurca de nuevo, vacío. La regla se
 * dirimió por medición en la puerta de la escucha: la huella
 * cargada del anfitrión real es ~0,9 GB  (el proceso de utilidad
 * con su runtime), así que un umbral absoluto
 * heredado de la ruta de pieza (~552 MB retenidos allí)
 * mataba el anfitrión tras CADA dictado y cada dictado
 * pagaba la carga entera; contra su propia línea base, un
 * dictado normal no paga la bifurcación y una retención que
 * crece sesión a sesión sí.
 *
 * Nada se carga sin la puerta del paso 0: al abrir la sesión,
 * las rutas salen de verifiedAssetDir contra el catálogo de
 * activos, verificadas enteras en ese momento. El estado del
 * motor que se enseña (engineState) es una comprobación
 * ligera de presencia y tamaños — una pista para pintar el
 * botón, no una carga — y la sesión cobra la verificación
 * entera antes de cargar nada.
 *
 * Las costuras de prueba: la fábrica del anfitrión y el
 * resolvedor de activos se inyectan; la batería conduce el
 * gestor con un anfitrión falso y un resolvedor de mentira,
 * y la puerta de la carcasa lo conduce con los de verdad.
 */

import path from "node:path";
import { stat } from "node:fs/promises";
import { utilityProcess } from "electron";
import { ASSET_CATALOG, type AssetEntry } from "./core/assetCatalog.ts";
import { verifiedAssetDir } from "./core/loadPath.ts";
import { voiceSidFor } from "../../src/voice/tts.js";

/** El evento de sesión que el gestor entrega a su suscriptor. */
export type VoiceSessionEvent =
  | { type: "start" }
  | { type: "end" }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

/** El anfitrión bifurcado, en la forma mínima que el gestor usa. */
export interface VoiceHostHandle {
  postMessage(message: Record<string, unknown>): void;
  onMessage(listener: (message: Record<string, unknown>) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export type VoiceHostFactory = () => VoiceHostHandle;

/** Las rutas verificadas que la sesión carga. */
export interface VoiceAssetPaths {
  parakeetDir: string;
  vadFile: string;
}

export type VoiceAssetResolver = (
  assetsDir: string,
) => Promise<VoiceAssetPaths | null>;

const PARAKEET_ID = "parakeet-tdt-0.6b-v3-int8";
const VAD_ID = "silero_vad";
const KOKORO_ID = "kokoro-multi-lang-v1_0";
const LOAD_TIMEOUT_MS = 120_000;
const SYNTH_TIMEOUT_MS = 120_000;
/** Un fichero largo a RTF ~1 en esta VM tarda minutos: el tope es holgado. */
const TRANSCRIBE_TIMEOUT_MS = 1_800_000;
const RELEASE_TIMEOUT_MS = 10_000;
const RSS_TIMEOUT_MS = 2_000;
/** La válvula de reciclado: el margen sobre la línea base, ver la cabecera. */
export const RECYCLE_MARGIN_MB = 150;

function catalogEntry(id: string): AssetEntry {
  const entry = ASSET_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`asset ${id} is not in the catalog`);
  return entry;
}

/**
 * El resolvedor de verdad: la puerta del paso 0, entera. Sin
 * activo instalado y verificado no hay rutas, y sin rutas no
 * hay sesión.
 */
export const verifiedVoiceAssets: VoiceAssetResolver = async (assetsDir) => {
  try {
    const parakeetDir = await verifiedAssetDir(assetsDir, catalogEntry(PARAKEET_ID));
    const vadRoot = await verifiedAssetDir(assetsDir, catalogEntry(VAD_ID));
    return {
      parakeetDir,
      vadFile: path.join(vadRoot, catalogEntry(VAD_ID).files[0].path),
    };
  } catch {
    return null;
  }
};

/**
 * El resolvedor de la lectura: la misma puerta del paso 0
 * sobre la entrada de Kokoro. Sin Kokoro verificado no hay
 * lectura, y la escucha no se entera: son activos
 * independientes y cada motor cobra su puerta al usarse.
 */
export const verifiedSpeechAssets = async (
  assetsDir: string,
): Promise<string | null> => {
  try {
    return await verifiedAssetDir(assetsDir, catalogEntry(KOKORO_ID));
  } catch {
    return null;
  }
};

/** La presencia ligera de un activo: manifiesto y tamaños, sin huellas. */
async function assetPresent(
  assetsDir: string,
  entry: AssetEntry,
): Promise<boolean> {
  const root =
    entry.files.length === 1 && entry.archiveBytes === entry.files[0].bytes
      ? assetsDir
      : path.join(assetsDir, entry.id);
  for (const file of entry.files) {
    const st = await stat(path.join(root, ...file.path.split("/"))).catch(
      () => null,
    );
    if (!st?.isFile() || st.size !== file.bytes) return false;
  }
  return true;
}

/**
 * La presencia ligera para el estado del motor: cada fichero
 * del manifiesto existe con su tamaño declarado. No verifica
 * huellas (eso lo cobra la sesión al abrir) y no carga nada.
 */
export async function voiceAssetsPresent(assetsDir: string): Promise<boolean> {
  for (const id of [PARAKEET_ID, VAD_ID]) {
    if (!(await assetPresent(assetsDir, catalogEntry(id)))) return false;
  }
  return true;
}

/** La presencia ligera de la lectura (Kokoro), para su botón. */
export async function voiceSpeechPresent(assetsDir: string): Promise<boolean> {
  return assetPresent(assetsDir, catalogEntry(KOKORO_ID));
}

/** La fábrica de verdad: un proceso de utilidad de Electron. */
export function voiceHostFactory(hostPath: string): VoiceHostFactory {
  return () => {
    const child = utilityProcess.fork(hostPath, [], {
      serviceName: "nido-voice",
    });
    return {
      postMessage: (message) => child.postMessage(message),
      onMessage: (listener) =>
        child.on("message", (message: Record<string, unknown>) =>
          listener(message),
        ),
      onExit: (listener) => child.on("exit", (code: number) => listener(code)),
      kill: () => child.kill(),
    };
  };
}

interface PendingWaiter {
  type: string;
  resolve: (message: Record<string, unknown> | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class VoiceProcessManager {
  private host: VoiceHostHandle | null = null;
  private loaded = false;
  private session: { emit: (event: VoiceSessionEvent) => void } | null = null;
  private waiters: PendingWaiter[] = [];
  private lastRssMB: number | null = null;
  /** El RSS del anfitrión al terminar de cargar: la línea base de la válvula. */
  private hostLoadedRssMB: number | null = null;
  /** Kokoro cargado en el anfitrión (la lectura, paso 2). */
  private ttsLoaded = false;
  /** La cadena que serializa las síntesis: una frase cada vez. */
  private synthChain: Promise<unknown> = Promise.resolve();
  private synthSeq = 0;

  constructor(
    private readonly deps: {
      assetsDir: string;
      hostFactory: VoiceHostFactory;
      resolveAssets?: VoiceAssetResolver;
      resolveSpeechAssets?: (assetsDir: string) => Promise<string | null>;
      recycleMarginMB?: number;
    },
  ) {}

  /** «onDevice» si la escucha local está presente; si no, «none». */
  async engineState(): Promise<string> {
    return (await voiceAssetsPresent(this.deps.assetsDir)) ? "onDevice" : "none";
  }

  /** «onDevice» si la voz de la casa (Kokoro) está presente; si no, «none». */
  async speechState(): Promise<string> {
    return (await voiceSpeechPresent(this.deps.assetsDir)) ? "onDevice" : "none";
  }

  /** La contabilidad del proceso de voz: su RSS y su estado de carga. */
  async accounting(): Promise<{
    hostAlive: boolean;
    loaded: boolean;
    ttsLoaded: boolean;
    rssMB: number | null;
  }> {
    if (this.host) {
      const reply = await this.request({ type: "accounting" }, "rss", RSS_TIMEOUT_MS);
      if (reply && typeof reply.rssMB === "number") this.lastRssMB = reply.rssMB;
    }
    return {
      hostAlive: this.host !== null,
      loaded: this.loaded,
      ttsLoaded: this.ttsLoaded,
      rssMB: this.lastRssMB,
    };
  }

  /**
   * Sintetiza UNA frase con la voz del idioma (paso 2): cobra
   * la puerta de Kokoro la primera vez, carga el motor en el
   * anfitrión y devuelve sus muestras. Las peticiones se
   * serializan por la cadena: la orquestación de la lectura
   * pide la siguiente frase mientras la anterior suena, y el
   * anfitrión genera de una en una. Sin activo verificado o
   * con el motor caído, null (la lectura se salta la frase,
   * en silencio, como el móvil sin voz).
   */
  /** El último fallo de la lectura, con su etapa (diagnóstico). */
  private lastSpeechError: string | null = null;

  /** El último fallo de la lectura («etapa: detalle»), o null. */
  speechError(): string | null {
    return this.lastSpeechError;
  }

  synthesize(
    sentence: string,
    appLanguage: string,
  ): Promise<{ samples: Float32Array; sampleRate: number } | null> {
    const fail = (stage: string, detail?: unknown): null => {
      this.lastSpeechError =
        detail !== undefined ? `${stage}: ${String(detail)}` : stage;
      return null;
    };
    const run = async (): Promise<{ samples: Float32Array; sampleRate: number } | null> => {
      const resolve = this.deps.resolveSpeechAssets ?? verifiedSpeechAssets;
      const kokoroDir = await resolve(this.deps.assetsDir);
      if (!kokoroDir) return fail("assets-unverified");
      this.ensureHost();
      if (!this.ttsLoaded) {
        const reply = await this.request(
          { type: "load-tts", kokoroDir },
          ["tts-loaded", "tts-load-error"],
          LOAD_TIMEOUT_MS,
        );
        if (!reply) return fail("tts-load-timeout");
        if (reply.type !== "tts-loaded") {
          return fail("tts-load", reply.message ?? reply.type);
        }
        this.ttsLoaded = true;
        if (typeof reply.rssMB === "number") {
          this.lastRssMB = reply.rssMB;
          this.hostLoadedRssMB ??= reply.rssMB;
        }
      }
      const id = ++this.synthSeq;
      const reply = await this.request(
        { type: "synth", id, text: sentence, sid: voiceSidFor(appLanguage) },
        ["audio", "synth-error"],
        SYNTH_TIMEOUT_MS,
      );
      if (!reply) return fail("synth-timeout");
      if (reply.type !== "audio") {
        return fail("synth", reply.message ?? reply.type);
      }
      const samples = reply.samples;
      if (!(samples instanceof Float32Array)) {
        return fail("synth-samples", Object.prototype.toString.call(samples));
      }
      this.lastSpeechError = null;
      return { samples, sampleRate: Number(reply.sampleRate) };
    };
    const result = this.synthChain.then(run, run);
    this.synthChain = result.catch(() => null);
    return result;
  }

  /**
   * La suelta de la lectura: Kokoro se libera en el anfitrión
   * sin tocar la escucha, y la válvula cobra como en la
   * suelta del reconocedor. La llama la superficie cuando la
   * lectura termina o se detiene; si la superficie muere a
   * mitad, el motor queda cargado hasta que el proceso se
   * recicle o la app se cierre (declarado, acotado).
   */
  async releaseSpeech(): Promise<void> {
    if (!this.host || !this.ttsLoaded) return;
    this.ttsLoaded = false;
    const reply = await this.request(
      { type: "release-tts" },
      "tts-released",
      RELEASE_TIMEOUT_MS,
    );
    if (reply && typeof reply.rssMB === "number") {
      this.lastRssMB = reply.rssMB;
      this.maybeRecycle(reply.rssMB);
    }
  }

  /** Kokoro o un Whisper cargado en el anfitrión (paso 3). */
  private whisperLoaded = false;
  /** La cadena que serializa las transcripciones de fichero. */
  private transcribeChain: Promise<unknown> = Promise.resolve();
  private transcribeSeq = 0;
  /** El último fallo de Whisper, con su etapa (diagnóstico). */
  private lastWhisperError: string | null = null;

  /** El último fallo de Whisper («etapa: detalle»), o null. */
  whisperError(): string | null {
    return this.lastWhisperError;
  }

  /** La presencia ligera de un motor Whisper, para su estado honesto. */
  async whisperPresent(id: string): Promise<boolean> {
    const entry = ASSET_CATALOG.find((e) => e.id === id);
    if (!entry || entry.kind !== "asr") return false;
    return assetPresent(this.deps.assetsDir, entry);
  }

  /**
   * Transcribe un fichero entero con un motor Whisper
   * (paso 3): cobra la puerta de su activo, lo carga en el
   * anfitrión (aparte de la escucha de la conversación, que
   * no se toca), decodifica las muestras de una pasada y lo
   * suelta. El prefijo de sus ficheros sale de su propio
   * manifiesto (small-*, turbo-*). Sin activo verificado o
   * con el motor caído, null y el fallo queda en
   * whisperError() con su etapa.
   */
  transcribeFile(
    samples: Float32Array,
    id: string,
  ): Promise<{ text: string } | null> {
    const run = async (): Promise<{ text: string } | null> => {
      const fail = (stage: string, detail?: unknown): null => {
        this.lastWhisperError =
          detail !== undefined ? `${stage}: ${String(detail)}` : stage;
        return null;
      };
      const entry = ASSET_CATALOG.find((e) => e.id === id);
      if (!entry) return fail("unknown-asset", id);
      const encoderFile = entry.files.find((f) =>
        f.path.endsWith("-encoder.int8.onnx"),
      );
      if (!encoderFile) return fail("no-encoder-in-manifest", id);
      const prefix = encoderFile.path.slice(
        0,
        encoderFile.path.length - "-encoder.int8.onnx".length,
      );
      let dir: string | null = null;
      try {
        dir = await verifiedAssetDir(this.deps.assetsDir, entry);
      } catch {
        dir = null;
      }
      if (!dir) return fail("assets-unverified", id);
      this.ensureHost();
      if (!this.whisperLoaded) {
        const reply = await this.request(
          { type: "load-whisper", dir, prefix },
          ["whisper-loaded", "whisper-load-error"],
          LOAD_TIMEOUT_MS,
        );
        if (!reply) return fail("whisper-load-timeout", id);
        if (reply.type !== "whisper-loaded") {
          return fail("whisper-load", reply.message ?? reply.type);
        }
        this.whisperLoaded = true;
        if (typeof reply.rssMB === "number") {
          this.lastRssMB = reply.rssMB;
          this.hostLoadedRssMB ??= reply.rssMB;
        }
      }
      const tid = ++this.transcribeSeq;
      const reply = await this.request(
        { type: "transcribe", id: tid, samples },
        ["transcribed", "transcribe-error"],
        TRANSCRIBE_TIMEOUT_MS,
      );
      await this.releaseWhisper();
      if (!reply) return fail("transcribe-timeout", id);
      if (reply.type !== "transcribed") {
        return fail("transcribe", reply.message ?? reply.type);
      }
      this.lastWhisperError = null;
      return { text: typeof reply.text === "string" ? reply.text : "" };
    };
    const result = this.transcribeChain.then(run, run);
    this.transcribeChain = result.catch(() => null);
    return result;
  }

  /** La suelta de Whisper: su reconocedor se libera en el anfitrión. */
  private async releaseWhisper(): Promise<void> {
    if (!this.host || !this.whisperLoaded) return;
    this.whisperLoaded = false;
    const reply = await this.request(
      { type: "release-whisper" },
      "whisper-released",
      RELEASE_TIMEOUT_MS,
    );
    if (reply && typeof reply.rssMB === "number") {
      this.lastRssMB = reply.rssMB;
      this.maybeRecycle(reply.rssMB);
    }
  }

  /** La voz Piper cargada en el anfitrión (paso 4), por su id. */
  private piperLoadedId: string | null = null;
  /** La cadena que serializa las síntesis de Piper. */
  private piperChain: Promise<unknown> = Promise.resolve();
  private piperSeq = 0;
  /** El último fallo de Piper, con su etapa (diagnóstico). */
  private lastPiperError: string | null = null;

  /** El último fallo de Piper («etapa: detalle»), o null. */
  piperError(): string | null {
    return this.lastPiperError;
  }

  /** La presencia ligera de una voz Piper, para su estado honesto. */
  async piperPresent(id: string): Promise<boolean> {
    const entry = ASSET_CATALOG.find((e) => e.id === id);
    if (!entry || entry.kind !== "voice") return false;
    return assetPresent(this.deps.assetsDir, entry);
  }

  /**
   * Sintetiza UNA frase con una voz Piper (paso 4): cobra la
   * puerta de su activo, la carga en su hueco del anfitrión
   * (cambiar de voz recarga) y devuelve sus muestras. Es la
   * vía de la comparativa y de la elección de voz de la
   * superficie; el defecto de lectura de la casa sigue
   * siendo Kokoro hasta el veredicto del dueño (D-01).
   */
  synthesizePiper(
    sentence: string,
    voiceId: string,
  ): Promise<{ samples: Float32Array; sampleRate: number } | null> {
    const run = async (): Promise<{ samples: Float32Array; sampleRate: number } | null> => {
      const fail = (stage: string, detail?: unknown): null => {
        this.lastPiperError =
          detail !== undefined ? `${stage}: ${String(detail)}` : stage;
        return null;
      };
      const entry = ASSET_CATALOG.find((e) => e.id === voiceId);
      if (!entry || entry.kind !== "voice") return fail("unknown-voice", voiceId);
      const model = entry.files.find((f) => f.path.endsWith(".onnx"));
      if (!model) return fail("no-model-in-manifest", voiceId);
      let dir: string | null = null;
      try {
        dir = await verifiedAssetDir(this.deps.assetsDir, entry);
      } catch {
        dir = null;
      }
      if (!dir) return fail("assets-unverified", voiceId);
      this.ensureHost();
      if (this.piperLoadedId !== voiceId) {
        if (this.piperLoadedId !== null) await this.releasePiper();
        const reply = await this.request(
          { type: "load-piper", dir, modelFile: model.path },
          ["piper-loaded", "piper-load-error"],
          LOAD_TIMEOUT_MS,
        );
        if (!reply) return fail("piper-load-timeout", voiceId);
        if (reply.type !== "piper-loaded") {
          return fail("piper-load", reply.message ?? reply.type);
        }
        this.piperLoadedId = voiceId;
        if (typeof reply.rssMB === "number") {
          this.lastRssMB = reply.rssMB;
          this.hostLoadedRssMB ??= reply.rssMB;
        }
      }
      const id = ++this.piperSeq;
      const reply = await this.request(
        { type: "synth-piper", id, text: sentence },
        ["piper-audio", "piper-synth-error"],
        SYNTH_TIMEOUT_MS,
      );
      if (!reply) return fail("piper-synth-timeout", voiceId);
      if (reply.type !== "piper-audio") {
        return fail("piper-synth", reply.message ?? reply.type);
      }
      const samples = reply.samples;
      if (!(samples instanceof Float32Array)) {
        return fail("piper-samples", Object.prototype.toString.call(samples));
      }
      this.lastPiperError = null;
      return { samples, sampleRate: Number(reply.sampleRate) };
    };
    const result = this.piperChain.then(run, run);
    this.piperChain = result.catch(() => null);
    return result;
  }

  /** La suelta de Piper: su voz se libera en el anfitrión. */
  async releasePiper(): Promise<void> {
    if (!this.host || this.piperLoadedId === null) return;
    this.piperLoadedId = null;
    const reply = await this.request(
      { type: "release-piper" },
      "piper-released",
      RELEASE_TIMEOUT_MS,
    );
    if (reply && typeof reply.rssMB === "number") {
      this.lastRssMB = reply.rssMB;
      this.maybeRecycle(reply.rssMB);
    }
  }

  /** La válvula: recicla si la retención pasa la línea base más el margen. */
  private maybeRecycle(rssMB: number): void {
    const margin = this.deps.recycleMarginMB ?? RECYCLE_MARGIN_MB;
    const baseline = this.hostLoadedRssMB;
    if (baseline !== null && rssMB > baseline + margin && this.host) {
      this.host.kill();
      this.host = null;
      this.hostLoadedRssMB = null;
      this.ttsLoaded = false;
      this.whisperLoaded = false;
      this.piperLoadedId = null;
    }
  }

  /**
   * Abre una sesión de dictado: verifica los activos por la
   * puerta, bifurca el anfitrión si hace falta, carga la
   * escucha y empieza a aceptar audio. Los eventos de la
   * sesión llegan por `emit` en el orden del contrato (start,
   * y al corte del VAD: end y result; o error).
   */
  async startSession(
    emit: (event: VoiceSessionEvent) => void,
  ): Promise<void> {
    if (this.session) {
      emit({ type: "error", code: "busy", message: "a dictation session is already open" });
      return;
    }
    const resolve = this.deps.resolveAssets ?? verifiedVoiceAssets;
    const paths = await resolve(this.deps.assetsDir);
    if (!paths) {
      emit({
        type: "error",
        code: "not-installed",
        message: "the listening model is not installed or did not verify",
      });
      return;
    }
    try {
      this.ensureHost();
      if (!this.loaded) {
        const reply = await this.request(
          { type: "load", parakeetDir: paths.parakeetDir, vadFile: paths.vadFile },
          ["loaded", "load-error"],
          LOAD_TIMEOUT_MS,
        );
        if (!reply || reply.type !== "loaded") {
          emit({
            type: "error",
            code: "load-failed",
            message:
              (typeof reply?.message === "string" && reply.message) ||
              "the voice host did not load the listening model",
          });
          return;
        }
        this.loaded = true;
        if (typeof reply.rssMB === "number") {
          this.lastRssMB = reply.rssMB;
          this.hostLoadedRssMB = reply.rssMB;
        }
      }
    } catch (err) {
      emit({
        type: "error",
        code: "load-failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    this.session = { emit };
  }

  /** El audio de la captura, en muestras Float32 a 16 kHz. */
  pushAudio(samples: Float32Array): void {
    if (!this.session || !this.host) return;
    this.host.postMessage({ type: "audio", samples });
  }

  /** La persona paró: el anfitrión vacía el VAD y cierra la frase si la hay. */
  stopSession(): void {
    if (!this.session || !this.host) return;
    this.host.postMessage({ type: "stop" });
  }

  /** Cierra el gestor (la app se cierra): el anfitrión muere con él. */
  dispose(): void {
    this.session = null;
    this.host?.kill();
    this.host = null;
    this.loaded = false;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({});
    }
    this.waiters = [];
  }

  private ensureHost(): void {
    if (this.host) return;
    const host = this.deps.hostFactory();
    this.host = host;
    host.onMessage((message) => this.onHostMessage(message));
    host.onExit(() => {
      if (this.host !== host) return;
      this.host = null;
      this.loaded = false;
      this.ttsLoaded = false;
      this.whisperLoaded = false;
      this.piperLoadedId = null;
      this.hostLoadedRssMB = null;
      // Quien esperaba respuesta de este anfitrión no espera
      // al temporizador: la muerte asienta sus promesas ya,
      // con una respuesta sintética que la nombra (medido en
      // la puerta del paso 4: una carga colgó los 120 s
      // enteros tras morir el proceso, y su fallo se leyó
      // como un tiempo agotado que no era).
      const waiters = this.waiters;
      this.waiters = [];
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve({ type: "__host-died" });
      }
      const session = this.session;
      this.session = null;
      session?.emit({
        type: "error",
        code: "host-died",
        message: "the voice process ended unexpectedly",
      });
    });
  }

  private request(
    message: Record<string, unknown>,
    replyTypes: string | string[],
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    if (!this.host) return Promise.resolve(null);
    const types = Array.isArray(replyTypes) ? replyTypes : [replyTypes];
    return new Promise((resolve) => {
      const waiter: PendingWaiter = {
        type: types.join("|"),
        resolve: (reply) => resolve(reply ?? null),
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          resolve(null);
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      this.host?.postMessage(message);
    });
  }

  private settleWaiters(message: Record<string, unknown>): boolean {
    const type = typeof message.type === "string" ? message.type : "";
    const idx = this.waiters.findIndex((w) => w.type.split("|").includes(type));
    if (idx === -1) return false;
    const [waiter] = this.waiters.splice(idx, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
    return true;
  }

  private onHostMessage(message: Record<string, unknown>): void {
    if (this.settleWaiters(message)) return;
    const session = this.session;
    switch (message.type) {
      case "speech-start":
        session?.emit({ type: "start" });
        break;
      case "segment": {
        if (!session) break;
        const text = typeof message.text === "string" ? message.text : "";
        session.emit({ type: "end" });
        if (text) {
          session.emit({ type: "result", text });
        } else {
          session.emit({
            type: "error",
            code: "no-match",
            message: "the phrase was heard but not recognized",
          });
        }
        this.session = null;
        void this.releaseRecognizer();
        break;
      }
      case "stopped":
        if (!session) break;
        session.emit({ type: "end" });
        this.session = null;
        void this.releaseRecognizer();
        break;
      case "error": {
        if (!session) break;
        session.emit({
          type: "error",
          code: "engine",
          message:
            (typeof message.message === "string" && message.message) ||
            "the voice engine failed",
        });
        this.session = null;
        void this.releaseRecognizer();
        break;
      }
      default:
        break;
    }
  }

  /**
   * La suelta de al terminar: el reconocedor se libera en el
   * anfitrión y, si la retención pasa el umbral, la válvula
   * recicla el proceso entero.
   */
  private async releaseRecognizer(): Promise<void> {
    if (!this.host || !this.loaded) return;
    this.loaded = false;
    const reply = await this.request(
      { type: "release" },
      "released",
      RELEASE_TIMEOUT_MS,
    );
    if (reply && typeof reply.rssMB === "number") {
      this.lastRssMB = reply.rssMB;
      this.maybeRecycle(reply.rssMB);
    }
  }
}
