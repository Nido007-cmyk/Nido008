/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * voiceHost.ts — el anfitrión del proceso propio de voz
 * (firma 6 de la apertura de E9): el runtime de sherpa-onnx
 * vive AQUÍ, en un proceso de utilidad de Electron hijo del
 * principal, nunca en el principal. Un fallo del addon nativo
 * no se lleva la app entera; la contabilidad de memoria de la
 * voz es la de este proceso y solo la suya; y la válvula de
 * reciclado (el gestor lo mata y lo vuelve a bifurcar) actúa
 * sin tocar al motor LLM ni a la ventana.
 *
 * La ley de los búferes, medida en las puertas de los pasos
 * 1 y 2: la jaula de la V8 de Electron no admite búferes
 * externos en ningún proceso del app (probado en el de
 * utilidad y en el principal), y el addon de sherpa entrega
 * sus resultados como vistas externas por defecto. Todo lo
 * que este anfitrión recibe del addon se pide COPIADO
 * (front(false) en el VAD, enableExternalBuffer: false en
 * la síntesis): con la copia, la pila entera corre aquí.
 *
 * El protocolo con el gestor (voiceProcess.ts) es de mensajes
 * nombrados por process.parentPort:
 *
 *   entra: load {parakeetDir, vadFile} · audio {samples} ·
 *          stop · release · accounting ·
 *          load-tts {kokoroDir} · synth {id, text, sid} ·
 *          release-tts ·
 *          load-whisper {dir, prefix} ·
 *          transcribe {id, samples} · release-whisper ·
 *          load-piper {dir, modelFile} ·
 *          synth-piper {id, text} · release-piper
 *   sale:  loaded {rssMB} · load-error {message} ·
 *          speech-start · segment {text} · stopped ·
 *          released {rssMB} · rss {rssMB} · error {message} ·
 *          tts-loaded {rssMB} · tts-load-error {message} ·
 *          audio {id, samples, sampleRate} ·
 *          synth-error {id, message} · tts-released {rssMB} ·
 *          whisper-loaded {rssMB} ·
 *          whisper-load-error {message} ·
 *          transcribed {id, text} ·
 *          transcribe-error {id, message} ·
 *          whisper-released {rssMB} ·
 *          piper-loaded {rssMB} · piper-load-error {message} ·
 *          piper-audio {id, samples, sampleRate} ·
 *          piper-synth-error {id, message} ·
 *          piper-released {rssMB}
 *
 * Whisper (paso 3) es el tercer inquilino: su reconocedor
 * vive aparte de los dos motores de la conversación (el
 * dictado no lo toca) y transcribe ficheros enteros de una
 * pasada, sin VAD: el small como alternativa ligera y el
 * large-v3-turbo como extra de ficheros largos. El prefijo
 * de sus ficheros lo nombra el paquete del publicador
 * (small-*, turbo-*) y llega con el mensaje de carga.
 *
 * Piper (paso 4) es el cuarto: una voz VITS cada vez en su
 * propio hueco (load-piper/synth-piper/release-piper),
 * cargada desde su paquete convertido de sherpa-onnx con
 * sus tokens y su espeak-ng-data propios. La voz cruda de
 * Hugging Face no corre en este runtime (su .onnx no trae
 * los metadatos que el cargador VITS exige, medido en la
 * sonda del paso): la conversión del propio sherpa es la
 * forma que entra, con la ficha de licencia de la voz
 * registrada en el catálogo.
 *
 * La lectura (paso 2) comparte el proceso: Kokoro se carga
 * aparte (load-tts) y se suelta aparte (release-tts), para
 * que leer no pague la escucha ni dictar pague la lectura.
 * La síntesis es por frases enteras (generate síncrono sobre
 * una frase: es el proceso de la voz y nada más corre en él;
 * las APIs de streaming del binding, V-04, quedan fuera de
 * la v1 por la firma 4).
 *
 * La escucha es sin flujo y la corta el VAD en flujo: el audio
 * (16 kHz, Float32) entra por acceptWaveform; cuando Silero
 * cierra una frase, el segmento entero pasa por Parakeet y su
 * texto sale como «segment». No hay parciales en esta espina:
 * el reconocedor sin flujo no los produce sin pagar
 * decodificaciones intermedias, y el contrato de sesión los
 * admite sin exigirlos (la revisión de la persona es sobre el
 * texto final, que es el que se enseña antes de enviar).
 *
 * Las rutas que llegan en «load» ya pasaron la puerta del
 * paso 0 (verifiedAssetDir) en el gestor: aquí no se resuelve
 * ni se carga ningún camino que no venga verificado de allí.
 *
 * La liberación es la parcial medida (V-05): soltar las
 * referencias devuelve la parte del runtime (~214 MB de
 * ~766 MB en la medición de la casa); el resto lo retienen
 * las arenas nativas hasta que el gestor recicla el proceso.
 * Este fichero no promete la liberación entera: la declara.
 */

import sherpa from "sherpa-onnx-node";

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort = (
  process as unknown as { parentPort: ParentPortLike }
).parentPort;

const SAMPLE_RATE = 16000;

let recognizer: InstanceType<typeof sherpa.OfflineRecognizer> | null = null;
let vad: InstanceType<typeof sherpa.Vad> | null = null;
let tts: InstanceType<typeof sherpa.OfflineTts> | null = null;
let whisper: InstanceType<typeof sherpa.OfflineRecognizer> | null = null;
let piper: InstanceType<typeof sherpa.OfflineTts> | null = null;
let speechActive = false;

function rssMB(): number {
  return Math.round(process.memoryUsage().rss / 1048576);
}

function post(message: Record<string, unknown>): void {
  parentPort.postMessage(message);
}

function recognize(samples: Float32Array): string {
  if (!recognizer) return "";
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

/** Vacía los segmentos que el VAD ya cerró, reconociendo cada uno. */
function drainSegments(): void {
  if (!vad) return;
  while (!vad.isEmpty()) {
    // front(false): la copia es de la casa. Con el búfer
    // externo (el defecto del binding, una vista sobre la
    // memoria nativa del VAD) el reconocedor lo rechazó en
    // la puerta de la escucha («External buffers are not
    // allowed»: los búferes externos del addon no cruzan
    // capas), y además la vista quedaría colgando tras el
    // pop().
    const segment = vad.front(false);
    vad.pop();
    post({ type: "segment", text: recognize(segment.samples) });
  }
}

function load(parakeetDir: string, vadFile: string): void {
  try {
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
      modelConfig: {
        transducer: {
          encoder: `${parakeetDir}/encoder.int8.onnx`,
          decoder: `${parakeetDir}/decoder.int8.onnx`,
          joiner: `${parakeetDir}/joiner.int8.onnx`,
        },
        tokens: `${parakeetDir}/tokens.txt`,
        modelType: "nemo_transducer",
        numThreads: 2,
        provider: "cpu",
        debug: false,
      },
      decodingMethod: "greedy_search",
    });
    vad = new sherpa.Vad(
      {
        sileroVad: {
          model: vadFile,
          threshold: 0.5,
          minSilenceDuration: 0.5,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 20,
          windowSize: 512,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        provider: "cpu",
        debug: false,
      },
      60,
    );
    speechActive = false;
    post({ type: "loaded", rssMB: rssMB() });
  } catch (err) {
    recognizer = null;
    vad = null;
    post({
      type: "load-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * La ventana del VAD (windowSize de la config): el audio se
 * le entrega SIEMPRE en rodajas de este tamaño. Medido en la
 * puerta de la escucha (sondas de pieza de E9): una llamada
 * grande a acceptWaveform (32.000 muestras de silencio de una
 * vez) NO hace avanzar el cierre del segmento — la frase
 * quedaba abierta hasta el flush — mientras que el mismo
 * silencio en rodajas de ventana cierra el segmento en su
 * sitio, recortado a la voz. La rodaja es invariante del
 * anfitrión: vale para cualquier remitente (el procesador de
 * la captura da 2.048, el banco empuja bloques mayores).
 */
const VAD_WINDOW = 512;

function onAudio(samples: Float32Array): void {
  if (!vad || !recognizer) return;
  try {
    for (let off = 0; off < samples.length; off += VAD_WINDOW) {
      vad.acceptWaveform(
        samples.subarray(off, Math.min(samples.length, off + VAD_WINDOW)),
      );
      if (!speechActive && vad.isDetected()) {
        speechActive = true;
        post({ type: "speech-start" });
      }
      drainSegments();
    }
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onStop(): void {
  if (!vad) {
    post({ type: "stopped" });
    return;
  }
  try {
    vad.flush();
    drainSegments();
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  speechActive = false;
  post({ type: "stopped" });
}

function onRelease(): void {
  recognizer = null;
  vad = null;
  speechActive = false;
  post({ type: "released", rssMB: rssMB() });
}

function loadTts(kokoroDir: string): void {
  try {
    tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: `${kokoroDir}/model.onnx`,
          voices: `${kokoroDir}/voices.bin`,
          tokens: `${kokoroDir}/tokens.txt`,
          dataDir: `${kokoroDir}/espeak-ng-data`,
          lexicon: [
            `${kokoroDir}/lexicon-us-en.txt`,
            `${kokoroDir}/lexicon-gb-en.txt`,
            `${kokoroDir}/lexicon-zh.txt`,
          ].join(","),
        },
        numThreads: 2,
        provider: "cpu",
        debug: false,
      },
      maxNumSentences: 1,
    });
    post({ type: "tts-loaded", rssMB: rssMB() });
  } catch (err) {
    tts = null;
    post({
      type: "tts-load-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onSynth(id: number, text: string, sid: number): void {
  if (!tts) {
    post({ type: "synth-error", id, message: "tts not loaded" });
    return;
  }
  try {
    // enableExternalBuffer: false — la salida llega copiada
    // a un búfer propio de JS. Con la vista externa (el
    // defecto del binding) la generación muere en este
    // entorno («External buffers are not allowed», medido
    // en la puerta del paso 2 en el proceso de utilidad y
    // en el principal: la jaula de la V8 de Electron no
    // admite búferes externos en ningún proceso del app).
    // Es la misma cura que front(false) en el VAD.
    const audio = tts.generate({
      text,
      sid,
      speed: 1.0,
      enableExternalBuffer: false,
    });
    post({
      type: "audio",
      id,
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    });
  } catch (err) {
    post({
      type: "synth-error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onReleaseTts(): void {
  tts = null;
  post({ type: "tts-released", rssMB: rssMB() });
}

function loadWhisper(dir: string, prefix: string): void {
  try {
    whisper = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: `${dir}/${prefix}-encoder.int8.onnx`,
          decoder: `${dir}/${prefix}-decoder.int8.onnx`,
          language: "",
          task: "transcribe",
          tailPaddings: 1000,
        },
        tokens: `${dir}/${prefix}-tokens.txt`,
        modelType: "whisper",
        numThreads: 2,
        provider: "cpu",
        debug: false,
      },
      decodingMethod: "greedy_search",
    });
    post({ type: "whisper-loaded", rssMB: rssMB() });
  } catch (err) {
    whisper = null;
    post({
      type: "whisper-load-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * La ventana de Whisper: 30 s es lo que su decodificador ve
 * de una pasada. Un fichero largo se transcribe por trozos
 * de 25 s y los textos se cosen en orden (la forma de los
 * propios ejemplos de sherpa-onnx para ficheros largos;
 * medido en la puerta del paso 3: sin trocear, el motor
 * devolvía solo la primera ventana de un fichero de
 * 293 s). El corte es ciego, no busca silencios: una
 * palabra a caballo entre dos trozos puede salir partida,
 * y el WER de la puerta lo mide tal cual.
 */
const WHISPER_CHUNK_SAMPLES = 25 * SAMPLE_RATE;

function onTranscribe(id: number, samples: Float32Array): void {
  if (!whisper) {
    post({ type: "transcribe-error", id, message: "whisper not loaded" });
    return;
  }
  try {
    const parts: string[] = [];
    for (let off = 0; off < samples.length; off += WHISPER_CHUNK_SAMPLES) {
      const stream = whisper.createStream();
      stream.acceptWaveform({
        sampleRate: SAMPLE_RATE,
        samples: samples.subarray(
          off,
          Math.min(samples.length, off + WHISPER_CHUNK_SAMPLES),
        ),
      });
      whisper.decode(stream);
      const text = whisper.getResult(stream).text.trim();
      if (text) parts.push(text);
    }
    post({ type: "transcribed", id, text: parts.join(" ") });
  } catch (err) {
    post({
      type: "transcribe-error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onReleaseWhisper(): void {
  whisper = null;
  post({ type: "whisper-released", rssMB: rssMB() });
}

function loadPiper(dir: string, modelFile: string): void {
  try {
    piper = new sherpa.OfflineTts({
      model: {
        vits: {
          model: `${dir}/${modelFile}`,
          tokens: `${dir}/tokens.txt`,
          dataDir: `${dir}/espeak-ng-data`,
        },
        numThreads: 2,
        provider: "cpu",
        debug: false,
      },
      maxNumSentences: 1,
    });
    post({ type: "piper-loaded", rssMB: rssMB() });
  } catch (err) {
    piper = null;
    post({
      type: "piper-load-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onSynthPiper(id: number, text: string): void {
  if (!piper) {
    post({ type: "piper-synth-error", id, message: "piper not loaded" });
    return;
  }
  try {
    const audio = piper.generate({
      text,
      sid: 0,
      speed: 1.0,
      enableExternalBuffer: false,
    });
    post({
      type: "piper-audio",
      id,
      samples: audio.samples,
      sampleRate: audio.sampleRate,
    });
  } catch (err) {
    post({
      type: "piper-synth-error",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function onReleasePiper(): void {
  piper = null;
  post({ type: "piper-released", rssMB: rssMB() });
}

parentPort.on("message", (event) => {
  const message = event.data as { type?: string } & Record<string, unknown>;
  switch (message?.type) {
    case "load":
      load(String(message.parakeetDir), String(message.vadFile));
      break;
    case "audio":
      onAudio(message.samples as Float32Array);
      break;
    case "stop":
      onStop();
      break;
    case "release":
      onRelease();
      break;
    case "load-tts":
      loadTts(String(message.kokoroDir));
      break;
    case "synth":
      onSynth(
        Number(message.id),
        String(message.text),
        Number(message.sid),
      );
      break;
    case "release-tts":
      onReleaseTts();
      break;
    case "load-whisper":
      loadWhisper(String(message.dir), String(message.prefix));
      break;
    case "transcribe":
      onTranscribe(Number(message.id), message.samples as Float32Array);
      break;
    case "release-whisper":
      onReleaseWhisper();
      break;
    case "load-piper":
      loadPiper(String(message.dir), String(message.modelFile));
      break;
    case "synth-piper":
      onSynthPiper(Number(message.id), String(message.text));
      break;
    case "release-piper":
      onReleasePiper();
      break;
    case "accounting":
      post({ type: "rss", rssMB: rssMB() });
      break;
    default:
      break;
  }
});

post({ type: "ready", rssMB: rssMB() });
