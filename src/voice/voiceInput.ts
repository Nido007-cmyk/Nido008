/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * voiceInput.ts — el contrato de sesión del dictado, recreado del
 * móvil (src/voice/VoiceInput.ts) contra el motor de PC: el
 * proceso propio de voz de la carcasa (firma 6 de la apertura de
 * E9), donde Parakeet escucha y el VAD de Silero corta la frase
 * en flujo. El corte de la sesión es ese «end»: no hay un fin de
 * voz del sistema detrás.
 *
 * La costura es el puerto del motor: la carcasa registra su
 * adaptador al arrancar (setVoiceEnginePort) y traduce los
 * mensajes del proceso de voz a los cinco eventos de siempre.
 * Sin puerto registrado no hay dictado: la sesión resuelve null
 * y el estado del motor es «none», como en el móvil sin módulo
 * nativo.
 *
 * La diferencia declarada con el móvil: allí startListening
 * leía el ajuste «solo en el teléfono» y se lo pasaba al módulo
 * nativo. En PC ese mecanismo no existe (dirimen D-1, forma C):
 * el dictado es el modelo local por construcción, y ofrecer la
 * voz del sistema como reserva es otra sesión, con su propia
 * clave y su propia superficie (paso 5), no un parámetro de
 * esta.
 */

import {
  parseEngineState,
  type VoiceEngineState,
} from "./voicePolicy.js";

export type VoiceEvent =
  | { type: "start" }
  | { type: "end" }
  | { type: "partial"; text: string }
  | { type: "result"; text: string }
  | { type: "error"; code: string; message: string };

export type VoiceEngineEventName =
  | "onSpeechStart"
  | "onSpeechEnd"
  | "onPartialResults"
  | "onResults"
  | "onError";

/**
 * El puerto del motor de dictado. La carcasa lo implementa
 * sobre el proceso propio de voz; la batería, con un registro
 * de oyentes falso, como en el móvil.
 */
export interface VoiceEnginePort {
  engineState(): Promise<string>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  addListener(
    eventName: VoiceEngineEventName,
    listener: (event: never) => void,
  ): { remove(): void };
}

let enginePort: VoiceEnginePort | null = null;

/** La carcasa registra su adaptador del proceso de voz al arrancar. */
export function setVoiceEnginePort(port: VoiceEnginePort | null): void {
  enginePort = port;
}

/**
 * Qué motor de dictado hay: el del proceso de voz responde
 * «onDevice» cuando la escucha local está lista. Sin puerto, o
 * con el puerto caído, «none»: nunca se finge un motor que no
 * contestó.
 */
export async function voiceEngineState(): Promise<VoiceEngineState> {
  if (!enginePort) return "none";
  try {
    return parseEngineState(await enginePort.engineState());
  } catch {
    return "none";
  }
}

/**
 * Auditoría completa 2026-10-31 (F1 M-4): margen tras el fin de
 * la voz. El reconocedor emite primero el fin (en PC: el corte
 * del VAD) y después el resultado o el error, así que no se
 * puede resolver en el fin sin romper el dictado normal; pero
 * si tras el fin no llega ni resultado ni error (la persona
 * paró con otro toque y solo llegó el fin), la promesa quedaba
 * colgada para siempre y los oyentes vivos. Pasado este margen
 * sin desenlace, la sesión se cierra con null y los oyentes se
 * quitan: un resultado tardío ya no puede llamar a onEvent con
 * la sesión muerta.
 */
const END_GRACE_MS = 1000;

/**
 * Empieza una sesión de escucha. Resuelve con la transcripción
 * final cuando el motor reporta un resultado, o null en error,
 * cancelación o fin sin desenlace pasado el margen. `onEvent`
 * es opcional, para la respuesta de la interfaz (parciales y
 * estado de escucha) más allá del texto final.
 */
export function startListening(
  onEvent?: (event: VoiceEvent) => void,
): Promise<string | null> {
  if (!enginePort) return Promise.resolve(null);
  const port = enginePort;

  return new Promise((resolve) => {
    const subscriptions: { remove(): void }[] = [];
    let resolved = false;
    let endTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (text: string | null) => {
      if (resolved) return;
      resolved = true;
      if (endTimer) clearTimeout(endTimer);
      subscriptions.forEach((s) => s.remove());
      resolve(text);
    };

    subscriptions.push(
      port.addListener("onSpeechStart", () => onEvent?.({ type: "start" })),
      port.addListener("onSpeechEnd", () => {
        onEvent?.({ type: "end" });
        if (!endTimer) endTimer = setTimeout(() => finish(null), END_GRACE_MS);
      }),
      port.addListener("onPartialResults", (e: { text: string }) =>
        onEvent?.({ type: "partial", text: e.text }),
      ),
      port.addListener("onResults", (e: { text: string }) => {
        onEvent?.({ type: "result", text: e.text });
        finish(e.text);
      }),
      port.addListener("onError", (e: { code: string; message: string }) => {
        onEvent?.({ type: "error", code: e.code, message: e.message });
        finish(null);
      }),
    );

    port.startListening().catch(() => finish(null));
  });
}

export async function stopListening(): Promise<void> {
  if (!enginePort) return;
  await enginePort.stopListening().catch(() => {});
}
