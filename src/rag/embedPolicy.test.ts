/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asiento de PC (E3, tanda 3 · J-2): batería recreada del 0.1.108
 * bajo la decisión de puerta firmada en la apertura de la tanda
 * (estudios/E3-J2-APERTURA.md §3 y §5). Es una de las cinco
 * baterías de la puerta de J-2 (46/46, sin diferidos): sus 5 casos
 * corren LITERALES, sin adaptación — es la única batería hermética
 * tal cual de la tanda. La única diferencia con el original es la
 * extensión `.js` en la importación, la convención de la casa.
 */

import { describe, it, expect } from "vitest";
import { embeddingIdleUnloadDue } from "./embedPolicy.js";

const MIN = 60_000;

describe("embeddingIdleUnloadDue (optimización 2026-11-08, fase 4)", () => {
  it("sin uso registrado nunca se descarga", () => {
    expect(embeddingIdleUnloadDue(100 * MIN, null, null, 10 * MIN)).toBe(false);
  });

  it("con uso reciente no se descarga", () => {
    expect(embeddingIdleUnloadDue(20 * MIN, 15 * MIN, null, 10 * MIN)).toBe(false);
  });

  it("inactivo más que el umbral y sin fondo reciente: se descarga", () => {
    expect(embeddingIdleUnloadDue(30 * MIN, 15 * MIN, null, 10 * MIN)).toBe(true);
    expect(embeddingIdleUnloadDue(30 * MIN, 15 * MIN, 5 * MIN, 10 * MIN)).toBe(true);
  });

  it("el fondo reciente protege la ventana aunque el uso sea viejo", () => {
    expect(embeddingIdleUnloadDue(30 * MIN, 5 * MIN, 25 * MIN, 10 * MIN)).toBe(false);
  });

  it("el borde exacto cuenta como vencido", () => {
    expect(embeddingIdleUnloadDue(25 * MIN, 15 * MIN, null, 10 * MIN)).toBe(true);
  });
});
