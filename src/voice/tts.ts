/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * tts.ts — la lectura en voz alta: la mitad pura portada del
 * móvil (qué locale lee cada idioma de la app y cómo se limpia
 * un texto antes de leerlo) y, desde el paso 2 de E9, la
 * orquestación de la lectura con la voz de la casa (Kokoro):
 * por frases del texto ya asentado, con la siguiente frase
 * generándose mientras la anterior suena (firma 4 de la
 * apertura) y la interrupción instantánea. La síntesis y la
 * reproducción viven tras la costura TtsEnginePort, que la
 * carcasa instala (el proceso de voz sintetiza; el
 * renderizador reproduce). La reserva del sistema es del
 * paso 5. Nada de lo que se lee sale del ordenador.
 */

import { stripThinking } from "../services/thinking.js";

/**
 * Auditoría completa 2026-10-31 (F1 M-3): la lectura forzaba siempre
 * voz y locale es-MX, con la app en inglés o en portugués el texto se
 * leía con voz española y resultaba difícil de entender. El locale de
 * lectura sale ahora del idioma de la app, con la variante regional
 * que la app ya usa como referencia en cada idioma.
 */
const SPEECH_LOCALES: Record<string, string> = {
  es: "es-MX",
  en: "en-US",
  pt: "pt-BR",
};

export function speechLocaleFor(appLanguage: string | null | undefined): string {
  const base = (appLanguage ?? "").toLowerCase().split("-")[0];
  // Sin idioma conocido manda la lengua de respaldo declarada (en).
  return SPEECH_LOCALES[base] ?? "en-US";
}

/**
 * La voz de Kokoro de cada idioma (banco multi-lang v1_0):
 * español ef_dora (28), inglés em_alex (29), portugués
 * pf_dora (42). Sin idioma conocido, la inglesa de respaldo,
 * la misma regla que speechLocaleFor.
 */
const KOKORO_SIDS: Record<string, number> = { es: 28, en: 29, pt: 42 };

export function voiceSidFor(appLanguage: string | null | undefined): number {
  const base = (appLanguage ?? "").toLowerCase().split("-")[0];
  return KOKORO_SIDS[base] ?? 29;
}

/**
 * Parte un texto en frases para leerlo por frases (firma 4):
 * corta tras la puntuación que cierra (. ! ? …) y conserva el
 * resto final sin puntuación como su propia frase. No intenta
 * resolver abreviaturas: una frase cortada de más se lee
 * seguida de la siguiente y la lectura suena continua.
 */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["»”']?|[^.!?…]+$/g) ?? [];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Limpia markdown y bloques de código antes de leer. */
export function cleanForSpeech(text: string): string {
  // Auditoría 0.1.93: el razonamiento de un modelo que razona
  // (<think>…</think>) se leía en voz alta entero antes de la respuesta.
  // En pantalla va plegado; en voz no se lee. Un razonamiento sin cerrar
  // (se quedó sin respuesta) no se lee tampoco.
  return stripThinking(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 2000);
}

// ---------------------------------------------------------------------
// La orquestación de la lectura (paso 2 de E9)
// ---------------------------------------------------------------------

/** El audio de una frase sintetizada, listo para sonar. */
export interface SpeechSamples {
  samples: Float32Array;
  sampleRate: number;
  /**
   * La forma de la reserva del sistema (paso 5): cuando la
   * voz de la casa no está y la reserva se ofrece, la frase
   * no trae muestras: trae el texto y su locale, y la voz la
   * pone el sistema operativo al sonar (play la reconoce).
   * Es la voz del sistema, nunca la de NIDO (H-5).
   */
  systemText?: string;
  systemLang?: string;
}

/**
 * La costura del motor de lectura: la carcasa la instala con
 * la síntesis del proceso de voz y la reproducción del
 * renderizador. Sin puerto no hay lectura (la semántica del
 * móvil: si la voz no está, el texto sigue visible y no pasa
 * nada).
 */
export interface TtsEnginePort {
  synthesize(sentence: string, appLanguage: string): Promise<SpeechSamples | null>;
  /** Suena el audio; la promesa se asienta cuando termina o cuando stopPlayback lo corta. */
  play(audio: SpeechSamples): Promise<void>;
  /** Corta lo que esté sonando ahora mismo. */
  stopPlayback(): void;
}

let ttsPort: TtsEnginePort | null = null;

export function setTtsEnginePort(port: TtsEnginePort | null): void {
  ttsPort = port;
}

/**
 * La generación de lectura en curso: cada speakText y cada
 * stopSpeaking la avanzan, y una vuelta del bucle con la
 * generación cambiada se retira sin sonar más. Es lo que
 * hace la interrupción instantánea y lo que impide que dos
 * lecturas se pisen.
 */
let readingGeneration = 0;

/** Detiene la lectura en curso, al instante. */
export function stopSpeaking(): void {
  readingGeneration++;
  ttsPort?.stopPlayback();
}

/**
 * Lee un texto YA ASENTADO (la respuesta tras el juez, la
 * guía entera, los pasos de la práctica): nunca se le pasa
 * un borrador, y la foto que lee es el texto que recibe —
 * si la superficie cambia su texto a mitad de lectura, esta
 * lectura sigue con el suyo. Corta cualquier lectura
 * anterior (la semántica del móvil), parte el texto en
 * frases, limpia cada una (la limpieza es por frase: el
 * tope de 2.000 de cleanForSpeech no amputa un texto largo,
 * lo lee entero frase a frase) y las suena en orden, con la
 * siguiente generándose mientras la anterior suena. Una
 * frase que no se puede sintetizar se salta en silencio.
 */
export async function speakText(
  text: string,
  appLanguage: string,
): Promise<void> {
  if (!ttsPort) return;
  stopSpeaking();
  const generation = readingGeneration;
  const sentences = splitSentences(text)
    .map((s) => cleanForSpeech(s))
    .filter((s) => s.length > 0);
  let pending: Promise<SpeechSamples | null> | null = null;
  for (let i = 0; i < sentences.length; i++) {
    if (generation !== readingGeneration) return;
    pending ??= ttsPort.synthesize(sentences[i], appLanguage);
    const audio = await pending;
    pending = null;
    if (generation !== readingGeneration) return;
    if (!audio) continue;
    if (i + 1 < sentences.length) {
      pending = ttsPort.synthesize(sentences[i + 1], appLanguage);
    }
    await ttsPort.play(audio);
  }
}
