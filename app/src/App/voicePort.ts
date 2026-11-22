/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * voicePort.ts — el adaptador del puerto del motor de dictado
 * (src/voice/voiceInput.ts) sobre el puente de la carcasa, y la
 * captura del micrófono del renderizador.
 *
 * El adaptador traduce los eventos de sesión del proceso de
 * voz (start/end/result/error por nido:voice-event) a los cinco
 * nombres del contrato heredado (onSpeechStart, onSpeechEnd,
 * onPartialResults, onResults, onError) y mantiene UNA sola
 * suscripción al puente, viva desde el primer uso.
 *
 * La captura es el gesto del permiso «media»: getUserMedia se
 * llama solo desde startVoiceCapture, que solo se invoca desde
 * el botón de dictado al pulsarlo (la allowlist de la carcasa
 * lo declara en shell.ts). El audio se convierte a Float32 a
 * 16 kHz y sale por el canal de envío; no se guarda en disco
 * ni sale del ordenador: vive lo que vive la transcripción
 * (la privacidad del micrófono del paso 5 de E9).
 */

import {
  setVoiceEnginePort,
  type VoiceEngineEventName,
  type VoiceEnginePort,
} from "../../../src/voice/voiceInput.js";
import {
  setTtsEnginePort,
  speechLocaleFor,
  type TtsEnginePort,
} from "../../../src/voice/tts.js";
import type { VoiceSessionPayload } from "./App.tsx";

type Listener = (event: never) => void;

const listeners = new Map<VoiceEngineEventName, Set<Listener>>();
let bridgeSubscribed = false;

function dispatch(name: VoiceEngineEventName, event: unknown): void {
  for (const listener of [...(listeners.get(name) ?? [])]) {
    (listener as (e: unknown) => void)(event);
  }
}

function ensureBridgeSubscription(): void {
  if (bridgeSubscribed) return;
  bridgeSubscribed = true;
  window.nido.onVoiceEvent((payload: VoiceSessionPayload) => {
    switch (payload?.type) {
      case "start":
        dispatch("onSpeechStart", {});
        break;
      case "end":
        dispatch("onSpeechEnd", {});
        break;
      case "result":
        dispatch("onResults", { text: payload.text ?? "" });
        stopVoiceCapture();
        break;
      case "error":
        dispatch("onError", {
          code: payload.code ?? "engine",
          message: payload.message ?? "",
        });
        stopVoiceCapture();
        break;
      default:
        break;
    }
  });
}

// ---------------------------------------------------------------------
// La captura del micrófono
// ---------------------------------------------------------------------

interface ActiveCapture {
  stop(): void;
}

let activeCapture: ActiveCapture | null = null;

/** Detiene la captura viva, si la hay (al cerrar la sesión, siempre). */
export function stopVoiceCapture(): void {
  activeCapture?.stop();
  activeCapture = null;
}

/**
 * Abre el micrófono y bombea muestras Float32 a 16 kHz al
 * proceso de voz. Es el gesto del permiso: solo lo llama el
 * puerto al empezar una sesión de dictado, tras la pulsación.
 */
async function startVoiceCapture(): Promise<void> {
  stopVoiceCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  const step = context.sampleRate / 16000;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    let samples: Float32Array;
    if (step === 1) {
      samples = new Float32Array(input.length);
      samples.set(input);
    } else {
      const count = Math.floor(input.length / step);
      samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = input[Math.floor(i * step)];
    }
    window.nido.voiceDictationAudio(samples.buffer as ArrayBuffer);
  };
  source.connect(processor);
  processor.connect(context.destination);
  activeCapture = {
    stop() {
      processor.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

// ---------------------------------------------------------------------
// El puerto del motor
// ---------------------------------------------------------------------

const voicePort: VoiceEnginePort = {
  async engineState() {
    const reply = await window.nido.voiceEngineState();
    return reply?.ok && typeof reply.state === "string" ? reply.state : "none";
  },
  async startListening() {
    ensureBridgeSubscription();
    const reply = await window.nido.voiceDictationStart();
    if (!reply?.ok) {
      throw new Error(reply?.reason ?? "dictation-start-rejected");
    }
    // La sesión está abierta en el proceso de voz (la escucha
    // ya cargó): ahora se abre el micrófono, para no perder la
    // frase en la carga ni capturar antes de tiempo.
    await startVoiceCapture();
  },
  async stopListening() {
    await window.nido.voiceDictationStop();
  },
  addListener(eventName, listener) {
    ensureBridgeSubscription();
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName)!.add(listener as Listener);
    return {
      remove() {
        listeners.get(eventName)?.delete(listener as Listener);
      },
    };
  },
};

let installed = false;

/** Registra el puerto del motor de dictado (una vez, al primer uso). */
export function installVoicePort(): void {
  if (installed) return;
  installed = true;
  setVoiceEnginePort(voicePort);
}

// ---------------------------------------------------------------------
// La lectura (paso 2): síntesis por el puente, reproducción aquí
// ---------------------------------------------------------------------

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let settleCurrentPlay: (() => void) | null = null;

function stopPlaybackInternal(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // Ya parado: la promesa se asienta igual.
    }
    currentSource = null;
  }
  settleCurrentPlay?.();
  settleCurrentPlay = null;
}

// ---------------------------------------------------------------------
// La reserva del sistema (paso 5): la voz del SO, solo de
// lectura, ofrecida cuando existe y enseñada con su nombre.
// ---------------------------------------------------------------------

let reserveOffered = true;

/** La política de la reserva, desde el ajuste de la casa. */
export function setReserveOffered(offered: boolean): void {
  reserveOffered = offered;
}

/** ¿Tiene el sistema una voz utilizable ahora mismo? */
export function systemVoicePresent(): boolean {
  try {
    return (window.speechSynthesis?.getVoices().length ?? 0) > 0;
  } catch {
    return false;
  }
}

let settleSystemPlay: (() => void) | null = null;

function stopSystemSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // Sin síntesis del sistema: nada que parar.
  }
  settleSystemPlay?.();
  settleSystemPlay = null;
}

const ttsAdapter: TtsEnginePort = {
  async synthesize(sentence, appLanguage) {
    const reply = await window.nido.voiceSynth(sentence, appLanguage);
    if (reply?.ok && reply.samples instanceof ArrayBuffer) {
      return {
        samples: new Float32Array(reply.samples),
        sampleRate: typeof reply.sampleRate === "number" ? reply.sampleRate : 24000,
      };
    }
    // Sin voz de la casa: la reserva del sistema, si se
    // ofrece y existe. La frase viaja como texto y la voz
    // la pone el SO al sonar (ver play).
    if (reserveOffered && systemVoicePresent()) {
      return {
        samples: new Float32Array(0),
        sampleRate: 0,
        systemText: sentence,
        systemLang: speechLocaleFor(appLanguage),
      };
    }
    return null;
  },
  play(audio) {
    if (audio.systemText) {
      return new Promise<void>((resolve) => {
        stopSystemSpeech();
        settleSystemPlay = resolve;
        const utterance = new SpeechSynthesisUtterance(audio.systemText);
        utterance.lang = audio.systemLang ?? "en-US";
        utterance.onend = () => {
          if (settleSystemPlay === resolve) settleSystemPlay = null;
          resolve();
        };
        utterance.onerror = utterance.onend;
        window.speechSynthesis.speak(utterance);
      });
    }
    const { samples, sampleRate } = audio;
    return new Promise<void>((resolve) => {
      stopPlaybackInternal();
      audioContext ??= new AudioContext();
      const ctx = audioContext;
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      currentSource = source;
      settleCurrentPlay = resolve;
      source.onended = () => {
        if (currentSource === source) currentSource = null;
        if (settleCurrentPlay === resolve) settleCurrentPlay = null;
        resolve();
      };
      void ctx.resume();
      source.start();
    });
  },
  stopPlayback() {
    stopPlaybackInternal();
    stopSystemSpeech();
  },
};

let ttsInstalled = false;

/** Registra el puerto de lectura (una vez, al primer uso). */
export function installTtsPort(): void {
  if (ttsInstalled) return;
  ttsInstalled = true;
  setTtsEnginePort(ttsAdapter);
}

/**
 * La superficie avisa al terminar o detener una lectura:
 * Kokoro se suelta en su proceso (la suelta de la lectura no
 * toca la escucha).
 */
export function releaseSpeechEngine(): void {
  void window.nido.voiceSpeakRelease().catch(() => {});
}
