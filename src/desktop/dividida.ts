/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dividida.ts — E11 paso 8: la vista dividida sobre el
 * panel de fuentes ya construido. Tres divisiones con su
 * lectura: una fuente, un documento de la biblioteca y
 * otra conversación, cada una con su referencia. El
 * estado guarda el ancla (el mensaje que la persona
 * estaba leyendo) y la conversación principal: abrir no
 * sustituye a la principal ni mezcla sus mensajes con
 * los de la otra, y cerrar vuelve al sitio exacto. La
 * presentación sigue al régimen: en ancho la división
 * vive en el panel; en medio cae a la forma de hoja de
 * la primera superficie, sin una cuarta forma inventada.
 */

export type SplitKind = "source" | "library-doc" | "conversation";

export interface SplitState {
  /** El sitio al que se vuelve al cerrar (el mensaje en lectura). */
  anchor: string;
  /** La conversación principal: la división nunca la sustituye. */
  mainConversationId?: string;
  open: SplitKind | null;
  /** La referencia de lo dividido (la fuente, el documento, la otra conversación). */
  ref?: string;
}

export function closedSplit(anchor: string, mainConversationId?: string): SplitState {
  return { anchor, mainConversationId, open: null };
}

export function openSplit(state: SplitState, kind: SplitKind, ref: string): SplitState {
  return { ...state, open: kind, ref };
}

export function closeSplit(state: SplitState): SplitState {
  return { ...state, open: null, ref: undefined };
}

export type SplitRegime = "wide" | "medium";

/**
 * La forma de la división según el régimen: panel en
 * ancho, hoja en medio (la forma de la primera
 * superficie), nada si está cerrada.
 */
export function splitPresentation(
  state: SplitState,
  regime: SplitRegime,
): "panel" | "sheet" | "none" {
  if (state.open === null) return "none";
  return regime === "wide" ? "panel" : "sheet";
}
