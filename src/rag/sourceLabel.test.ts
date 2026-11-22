/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * sourceLabel.test.ts — la etiqueta de la fuente y la
 * cabecera de página en su forma pura (E6, paso 7; contrato
 * §7.1): la página sale del metadato en los tres idiomas, y
 * sin página la etiqueta es la del móvil, solo el documento.
 */
import { describe, it, expect } from "vitest";
import { sourceLabel, sourcePageHeader } from "./sourceLabel.js";

describe("la etiqueta de la fuente desde el metadato", () => {
  it("con página: «{documento} · pág. {n}» en es y pt, «{document} · p. {n}» en en", () => {
    expect(sourceLabel("Contrato de alquiler", 7, "es")).toBe("Contrato de alquiler · pág. 7");
    expect(sourceLabel("Contrato de alquiler", 7, "pt")).toBe("Contrato de alquiler · pág. 7");
    expect(sourceLabel("Rental contract", 7, "en")).toBe("Rental contract · p. 7");
  });

  it("sin página (txt, imagen, corpus): solo el documento, como en el móvil", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      expect(sourceLabel("Notas de la reunión", null, lang)).toBe("Notas de la reunión");
      expect(sourceLabel("Notas de la reunión", undefined, lang)).toBe("Notas de la reunión");
    }
  });

  it("la cabecera del panel: «pág. 7 de 128» con total, «pág. 7» sin él, null sin página", () => {
    expect(sourcePageHeader(7, 128, "es")).toBe("pág. 7 de 128");
    expect(sourcePageHeader(7, 128, "pt")).toBe("pág. 7 de 128");
    expect(sourcePageHeader(7, 128, "en")).toBe("p. 7 of 128");
    expect(sourcePageHeader(7, null, "es")).toBe("pág. 7");
    expect(sourcePageHeader(7, null, "en")).toBe("p. 7");
    expect(sourcePageHeader(null, 128, "es")).toBeNull();
    // Un total menor que la página es un dato roto: no se enseña.
    expect(sourcePageHeader(7, 3, "es")).toBe("pág. 7");
  });
});
