/**
 * contextNote.ts · La decisión de la nota de contexto (P-2, S-6).
 *
 * La nota vive en el flujo de la conversación y avisa cuando la
 * ventana elegida se llena: al cruzar el 80 % sin cesión, y al pasar
 * a ceder turnos antiguos cuando `droppedTurns` sube a más de cero.
 * Una nota por cruce y conversación: la decisión es pura y la
 * superficie solo la pinta. Sin la palabra «token» y sin cifra cruda:
 * la superficie traduce el tipo de nota a su texto llano.
 */

export type ContextNoteKind = "filling" | "dropping";

export interface ContextNoteState {
  /** Ya se enseñó la nota de llenado en esta conversación. */
  fillingShown: boolean;
  /** Ya se enseñó la nota de cesión en esta conversación. */
  droppingShown: boolean;
}

export const CONTEXT_NOTE_THRESHOLD = 0.8;

export const EMPTY_CONTEXT_NOTE_STATE: ContextNoteState = {
  fillingShown: false,
  droppingShown: false,
};

/**
 * Decide la nota de este turno. `fractionUsed` es la fracción de la
 * ventana elegida que el turno usó (del `contextNote` del pipeline)
 * y `droppedTurns` los turnos antiguos cedidos en este turno.
 */
export function decideContextNote(
  state: ContextNoteState,
  input: { fractionUsed: number; droppedTurns: number },
): { note: ContextNoteKind | null; state: ContextNoteState } {
  if (input.droppedTurns > 0 && !state.droppingShown) {
    return {
      note: "dropping",
      state: { ...state, droppingShown: true, fillingShown: true },
    };
  }
  if (input.fractionUsed >= CONTEXT_NOTE_THRESHOLD && !state.fillingShown) {
    return { note: "filling", state: { ...state, fillingShown: true } };
  }
  return { note: null, state };
}
