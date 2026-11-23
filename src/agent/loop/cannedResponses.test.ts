/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, afterEach } from "vitest";
import { matchCanned } from "./cannedResponses.js";
import i18n from "../../i18n/index.js";
import { deviceDefaultLanguage } from "../../models/settings.js";

/**
 * Reconciliación I18N-2 (con su causa): los casos que cobran el
 * idioma de la respuesta nacieron con la cadena i18n muerta en el
 * banco — getUiLocale() era null y decidía la heurística por
 * texto, con su defecto «es». Con el módulo del núcleo resuelto,
 * el idioma de la UI manda (el diseño del FIX 2026-10-08, el del
 * móvil en vivo): cada caso que cobra idioma fija el del módulo
 * expresamente y cobra el idioma verdadero servido. Los casos de
 * clase (kind) y de no-coincidencia no cobran idioma y no cambian.
 */
afterEach(() => {
  i18n.changeLanguage(deviceDefaultLanguage());
});

describe("matchCanned — greetings", () => {
  it.each(["hola", "¡Hola!", "hey", "hey, what's up?", "buenos días", "gracias", "hi, hello"])(
    "matches pure greeting %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("greeting");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("responds in English to English greetings", () => {
    i18n.changeLanguage("en");
    expect(matchCanned("hey")!.lang).toBe("en");
    expect(matchCanned("good morning")!.lang).toBe("en");
  });

  it("responds in Spanish to Spanish greetings (UI fijada en es)", () => {
    i18n.changeLanguage("es");
    expect(matchCanned("hola")!.lang).toBe("es");
    expect(matchCanned("buenas tardes")!.lang).toBe("es");
  });

  it("does NOT match greetings with extra content", () => {
    expect(matchCanned("hola, recuérdame comprar pan")).toBeNull();
    expect(matchCanned("hey, can you compare X and Y")).toBeNull();
    expect(matchCanned("hola quiero saber la hora")).toBeNull();
  });
});

describe("matchCanned — identity", () => {
  it.each(["quién eres", "¿Cómo te llamas?", "who are you", "what's your name"])(
    "matches identity question %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("identity");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it.each(["¿Quién es nido?", "quien es nido", "qué es nido", "que es nido", "who is nido", "what is nido"])(
    "TESTFIX-2026-10-08: matches third-person identity %p (was: 'termómetro de datos' hallucination)",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("identity");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("third-person identity answers in the UI language (la UI manda, I18N-2)", () => {
    // Antes: la heurística por texto daba es/en según la frase,
    // porque getUiLocale() era null. Con el módulo vivo, el
    // idioma de la UI manda para las dos frases.
    i18n.changeLanguage("es");
    expect(matchCanned("¿Quién es nido?")!.lang).toBe("es");
    expect(matchCanned("who is nido?")!.lang).toBe("es");
    i18n.changeLanguage("en");
    expect(matchCanned("who is nido?")!.lang).toBe("en");
  });

  it("does NOT match identity inside a longer message", () => {
    expect(matchCanned("dime quién eres y qué hora es")).toBeNull();
    expect(matchCanned("who are you and what can you do")).toBeNull();
  });

  it("identity answer mentions offline/privacy", () => {
    i18n.changeLanguage("es");
    expect(matchCanned("quién eres")!.text).toMatch(/sin internet|offline/i);
  });
});

describe("matchCanned — help", () => {
  it.each(["ayuda", "help", "¿qué puedes hacer?", "what can you do"])(
    "matches help request %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("help");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("does NOT match help inside a longer message", () => {
    expect(matchCanned("ayúdame a recordar esto")).toBeNull();
    expect(matchCanned("help me remember this")).toBeNull();
  });
});

describe("matchCanned — privacy (TESTFIX-2026-10-08)", () => {
  it.each([
    "¿Dónde guardas mis datos?",
    "donde guardas mis datos",
    "dónde están mis datos",
    "dónde se guardan mis datos",
    "quién puede ver mis datos",
    "where do you store my data?",
    "where is my data stored",
    "who can see my data",
    // FIX 2026-10-08: variantes en tercera persona (evidencia física:
    // "dónde guardan mis datos?" no matcheaba).
    "dónde guardan mis datos?",
    "donde guardan mis datos",
    "dónde guarda mis datos",
    "donde guardan mi información",
    "where do they store my data?",
    "where does it store my data",
  ])("matches privacy question %p (was: model dodge)", (text) => {
    const hit = matchCanned(text);
    expect(hit).not.toBeNull();
    expect(hit!.kind).toBe("privacy");
    expect(hit!.deterministic).toBe(true);
  });

  it("privacy answer states on-device encrypted storage, no cloud", () => {
    i18n.changeLanguage("es");
    const es = matchCanned("¿Dónde guardas mis datos?")!;
    expect(es.lang).toBe("es");
    expect(es.text).toMatch(/este dispositivo/i);
    expect(es.text).toMatch(/cifrada/i);
    expect(es.text).toMatch(/nube/i);
    i18n.changeLanguage("en");
    const en = matchCanned("where is my data stored?")!;
    expect(en.lang).toBe("en");
    expect(en.text).toMatch(/this device/i);
    expect(en.text).toMatch(/encrypted/i);
    expect(en.text).toMatch(/cloud/i);
  });

  it("does NOT match privacy inside a longer message", () => {
    expect(matchCanned("dime dónde guardas mis datos y cómo te llamas")).toBeNull();
    expect(matchCanned("where do you store my data and what is your name")).toBeNull();
  });
});

describe("matchCanned — fall-through", () => {
  it("returns null for empty/blank input", () => {
    expect(matchCanned("")).toBeNull();
    expect(matchCanned("   ")).toBeNull();
  });

  it("returns null for normal queries", () => {
    expect(matchCanned("recuérdame comprar pan")).toBeNull();
    expect(matchCanned("cuánto es 24 por 17")).toBeNull();
    expect(matchCanned("capital de Australia")).toBeNull();
  });
});
