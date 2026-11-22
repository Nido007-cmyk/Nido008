/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * exampleTap.ts — la costura del toque de un ejemplo de la guía.
 *
 * La mecánica heredada del móvil, entera: tocar un ejemplo lo
 * escribe en el compositor del chat y nunca lo envía; enviarlo
 * lo decide la persona. La superficie usa esta costura y la
 * batería dueña la cobra en su forma (cobro 3): el resultado es
 * siempre escribir sin enviar, con la navegación al chat.
 */
export interface ExampleTapOutcome {
  navigateTo: "chat";
  composerText: string;
  send: false;
}

export function exampleTap(text: string): ExampleTapOutcome {
  return { navigateTo: "chat", composerText: text, send: false };
}
