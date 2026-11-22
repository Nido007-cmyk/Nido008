/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Los tres estados honestos de la voz (paso 5 de E9, letra
 * H-5), uno por caso: la sección Voz enseña el motor que
 * hay con su nombre propio, y ningún estado se disfraza de
 * otro.
 */
import { describe, expect, it } from "vitest";
import { voiceSurfaceState } from "./voiceSurface.js";

describe("el estado honesto de la voz (paso 5 de E9)", () => {
  it("con modelo local: la voz es la de la casa, haya o no reserva", () => {
    expect(
      voiceSurfaceState({
        speechLocal: true,
        reserveOffered: true,
        systemVoicePresent: true,
      }),
    ).toBe("local");
    expect(
      voiceSurfaceState({
        speechLocal: true,
        reserveOffered: false,
        systemVoicePresent: false,
      }),
    ).toBe("local");
  });

  it("con solo reserva: la voz es la del sistema, y se dice su nombre", () => {
    expect(
      voiceSurfaceState({
        speechLocal: false,
        reserveOffered: true,
        systemVoicePresent: true,
      }),
    ).toBe("reserve");
  });

  it("sin nada: ni la reserva apagada ni un sistema sin voz inventan un motor", () => {
    // La reserva existe pero la persona no la acepta.
    expect(
      voiceSurfaceState({
        speechLocal: false,
        reserveOffered: false,
        systemVoicePresent: true,
      }),
    ).toBe("none");
    // La reserva se ofrece pero el sistema no tiene voz.
    expect(
      voiceSurfaceState({
        speechLocal: false,
        reserveOffered: true,
        systemVoicePresent: false,
      }),
    ).toBe("none");
  });
});
