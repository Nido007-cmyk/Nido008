/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La declaración de tipos de la casa para sherpa-onnx-node
 * 1.13.8: el paquete no trae tipos de TypeScript (su superficie
 * está documentada en JSDoc sobre types.js). Aquí se declara
 * solo la parte que la casa usa, con las formas que el propio
 * paquete define; se amplía cuando un paso usa otra pieza.
 */

declare module "sherpa-onnx-node" {
  /** Un segmento de voz del VAD: muestras y su inicio, en muestras. */
  export interface SpeechSegment {
    start: number;
    samples: Float32Array;
  }

  export interface SileroVadConfig {
    model: string;
    threshold?: number;
    minSilenceDuration?: number;
    minSpeechDuration?: number;
    maxSpeechDuration?: number;
    windowSize?: number;
  }

  export interface VadConfig {
    sileroVad: SileroVadConfig;
    sampleRate?: number;
    numThreads?: number;
    provider?: string;
    debug?: boolean;
  }

  /** El detector de actividad de voz (Silero), en flujo. */
  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    pop(): void;
    flush(): void;
    reset(): void;
    clear(): void;
  }

  export interface OfflineTransducerModelConfig {
    encoder: string;
    decoder: string;
    joiner: string;
  }

  export interface OfflineWhisperModelConfig {
    encoder: string;
    decoder: string;
    language?: string;
    task?: string;
    tailPaddings?: number;
  }

  export interface OfflineModelConfig {
    transducer?: OfflineTransducerModelConfig;
    whisper?: OfflineWhisperModelConfig;
    tokens: string;
    modelType?: string;
    numThreads?: number;
    provider?: string;
    debug?: boolean;
  }

  export interface OfflineRecognizerConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: OfflineModelConfig;
    decodingMethod?: string;
  }

  export interface OfflineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  }

  /** El reconocedor sin flujo (Parakeet y Whisper en ONNX). */
  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string };
  }

  export interface OfflineTtsKokoroConfig {
    model: string;
    voices: string;
    tokens: string;
    dataDir: string;
    lexicon?: string;
    lengthScale?: number;
  }

  export interface OfflineTtsVitsConfig {
    model: string;
    tokens: string;
    dataDir: string;
    lexicon?: string;
    noiseScale?: number;
    noiseScaleW?: number;
    lengthScale?: number;
  }

  export interface OfflineTtsConfig {
    /**
     * La configuración cuelga de «model» en el binding de
     * Node (medido en la sonda de cadena del paso 1: con
     * «modelConfig» el validador nativo rechaza la
     * configuración, «Please provide exactly one tts
     * model»).
     */
    model: {
      kokoro?: OfflineTtsKokoroConfig;
      vits?: OfflineTtsVitsConfig;
      numThreads?: number;
      provider?: string;
      debug?: boolean;
    };
    maxNumSentences?: number;
    silenceScale?: number;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  /** La síntesis sin flujo (Kokoro y las voces VITS de Piper). */
  export class OfflineTts {
    constructor(config: OfflineTtsConfig);
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generate(request: {
      text: string;
      sid: number;
      speed?: number;
      /**
       * Con false, el addon entrega las muestras copiadas a
       * un búfer propio de JS en vez de una vista externa
       * sobre su memoria nativa: es la forma que este
       * entorno admite (ver voiceHost.ts).
       */
      enableExternalBuffer?: boolean;
    }): GeneratedAudio;
  }

  /**
   * La exportación por defecto del paquete (CommonJS): el
   * objeto entero de module.exports. Es la vía que el
   * anfitrión importa: la importación por espacio de nombres
   * de este paquete no expone sus clases al cargar el módulo
   * compilado en el proceso de utilidad (medido en la puerta
   * de la escucha de E9: «OfflineRecognizer is not a
   * constructor»), y la por defecto sí, como en la sonda de
   * pieza por tsx.
   */
  const sherpaDefault: {
    Vad: typeof Vad;
    OfflineRecognizer: typeof OfflineRecognizer;
    OfflineTts: typeof OfflineTts;
  };
  export default sherpaDefault;
}
