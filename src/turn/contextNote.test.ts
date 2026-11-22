/**
 * contextNote.test.ts · Batería de la nota de contexto P-2 (S-6):
 * el umbral es el 80 % de la ventana elegida, la cesión se avisa al
 * pasar `droppedTurns` a más de cero, y hay una nota por cruce y
 * conversación.
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_NOTE_THRESHOLD,
  EMPTY_CONTEXT_NOTE_STATE,
  decideContextNote,
} from "./contextNote.js";

describe("nota de contexto P-2", () => {
  it("el umbral firmado es el 80 %", () => {
    expect(CONTEXT_NOTE_THRESHOLD).toBe(0.8);
  });

  it("bajo el umbral y sin cesión no hay nota", () => {
    const r = decideContextNote(EMPTY_CONTEXT_NOTE_STATE, {
      fractionUsed: 0.5,
      droppedTurns: 0,
    });
    expect(r.note).toBeNull();
  });

  it("al cruzar el 80 % sin cesión sale la nota de llenado, una vez", () => {
    const first = decideContextNote(EMPTY_CONTEXT_NOTE_STATE, {
      fractionUsed: 0.83,
      droppedTurns: 0,
    });
    expect(first.note).toBe("filling");
    const second = decideContextNote(first.state, {
      fractionUsed: 0.9,
      droppedTurns: 0,
    });
    expect(second.note).toBeNull();
  });

  it("al pasar droppedTurns a más de cero sale la nota de cesión, una vez", () => {
    const first = decideContextNote(EMPTY_CONTEXT_NOTE_STATE, {
      fractionUsed: 0.95,
      droppedTurns: 2,
    });
    expect(first.note).toBe("dropping");
    const second = decideContextNote(first.state, {
      fractionUsed: 0.97,
      droppedTurns: 3,
    });
    expect(second.note).toBeNull();
  });

  it("la cesión no repite la de llenado después", () => {
    const first = decideContextNote(EMPTY_CONTEXT_NOTE_STATE, {
      fractionUsed: 0.9,
      droppedTurns: 1,
    });
    expect(first.note).toBe("dropping");
    const second = decideContextNote(first.state, {
      fractionUsed: 0.99,
      droppedTurns: 0,
    });
    expect(second.note).toBeNull();
  });
});
