/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * voiceSurface.ts — el estado honesto de la voz en la
 * superficie (paso 5 de E9, letra H-5): qué motor de lectura
 * hay, dicho con su nombre propio, en uno de tres estados.
 *
 *   - «local»: la voz de la casa (Kokoro) está instalada.
 *     La escucha y la lectura son de NIDO, sin conexión.
 *   - «reserve»: no hay voz de la casa, pero la persona
 *     acepta la reserva y el sistema operativo tiene una
 *     voz utilizable. Es la voz DEL SISTEMA, no la de NIDO,
 *     y la superficie la enseña con ese nombre (H-5).
 *   - «none»: no hay voz. Ni simulada ni en silencio: la
 *     sección lo dice y ofrece la descarga (H-1, H-7).
 *
 * La reserva de PC es solo de SALIDA (MEDICION-D1 §4): el
 * dictado no tiene reserva del sistema en ninguna forma,
 * porque en PC es local por construcción. Por eso esta
 * función habla de la lectura; el dictado tiene su propio
 * estado (el motor de escucha, en voiceProcess).
 */

export type VoiceSurfaceState = "local" | "reserve" | "none";

export interface VoiceSurfaceInputs {
  /** La voz de la casa (Kokoro) está instalada y verificada. */
  speechLocal: boolean;
  /** La clave propia de PC: ofrecer la voz del sistema como reserva. */
  reserveOffered: boolean;
  /** El sistema operativo tiene una voz utilizable ahora. */
  systemVoicePresent: boolean;
}

export function voiceSurfaceState(input: VoiceSurfaceInputs): VoiceSurfaceState {
  if (input.speechLocal) return "local";
  if (input.reserveOffered && input.systemVoicePresent) return "reserve";
  return "none";
}
