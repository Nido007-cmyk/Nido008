/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, afterEach } from "vitest";
import { getUiLocale, matchCanned } from "./cannedResponses.js";
import i18n from "../../i18n/index.js";
import { deviceDefaultLanguage } from "../../models/settings.js";

/**
 * FIX 2026-10-08: detectLang prefiere el idioma de la UI (getUiLocale,
 * leído fresco en cada llamada, nunca cacheado).
 *
 * Reconciliación I18N-2 (con su causa): esta batería nació cobrando
 * la forma del hueco — en tests la cadena i18n no cargaba,
 * getUiLocale() era null y la heurística por texto decidía. Con el
 * módulo del núcleo creado y resuelto por import estático, el
 * idioma de la UI existe también en el banco y manda, que es el
 * diseño del FIX: los casos fijan el idioma del módulo
 * expresamente y cobran ese idioma verdadero. La heurística por
 * texto queda en el código para el caso null, que con un módulo
 * en es/en/pt ya no se alcanza.
 */
afterEach(() => {
  i18n.changeLanguage(deviceDefaultLanguage());
});

describe("getUiLocale / detectLang", () => {
  it("getUiLocale() devuelve el idioma fijado en el módulo", () => {
    i18n.changeLanguage("es");
    expect(getUiLocale()).toBe("es");
    i18n.changeLanguage("en");
    expect(getUiLocale()).toBe("en");
    i18n.changeLanguage("pt");
    expect(getUiLocale()).toBe("pt");
  });

  it("el idioma de la UI manda sobre el texto (el diseño del FIX 2026-10-08)", () => {
    i18n.changeLanguage("es");
    expect(matchCanned("hey")!.lang).toBe("es");
    i18n.changeLanguage("en");
    expect(matchCanned("hola")!.lang).toBe("en");
  });

  it("los patrones de privacidad en tercera persona matchean", () => {
    expect(matchCanned("dónde guardan mis datos?")!.kind).toBe("privacy");
    expect(matchCanned("where do they store my data?")!.kind).toBe("privacy");
  });
});
