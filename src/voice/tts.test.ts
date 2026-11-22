/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Los casos heredados del móvil (src/voice/tts.test.ts), recreados
 * contra la mitad pura portada: en PC tts.ts no importa ni el
 * motor del sistema ni el idioma global, así que los mocks de
 * Expo del original no tienen aquí nada que sustituir.
 */
import { describe, it, expect, vi } from "vitest";
import {
  cleanForSpeech,
  setTtsEnginePort,
  speakText,
  speechLocaleFor,
  stopSpeaking,
  type TtsEnginePort,
} from "./tts.js";

describe("speechLocaleFor (F1 M-3)", () => {
  it("cada idioma de la app lee con su variante regional", () => {
    expect(speechLocaleFor("es")).toBe("es-MX");
    expect(speechLocaleFor("en")).toBe("en-US");
    expect(speechLocaleFor("pt")).toBe("pt-BR");
    expect(speechLocaleFor("pt-BR")).toBe("pt-BR");
    expect(speechLocaleFor("de")).toBe("en-US");
    expect(speechLocaleFor(undefined)).toBe("en-US");
  });
});

describe("cleanForSpeech", () => {
  it("elimina bloques de código", () => {
    const out = cleanForSpeech("Mira:\n```js\nconst x = 1;\n```\nListo.");
    expect(out).not.toContain("const x");
    expect(out).toContain("Mira");
    expect(out).toContain("Listo");
  });

  it("limpia markdown en línea", () => {
    expect(cleanForSpeech("**negrita** y *cursiva*")).toBe("negrita y cursiva");
    expect(cleanForSpeech("[NIDO](https://ejemplo.com)")).toBe("NIDO");
    expect(cleanForSpeech("`código` inline")).toBe("código inline");
  });

  it("recorta a 2000 caracteres", () => {
    const out = cleanForSpeech("a".repeat(3000));
    expect(out.length).toBe(2000);
  });

  it("devuelve vacío si no hay texto útil", () => {
    expect(cleanForSpeech("   ")).toBe("");
    expect(cleanForSpeech("```\n```")).toBe("");
  });
});

describe("cleanForSpeech: el razonamiento no se lee (auditoría 0.1.93)", () => {
  it("lee solo la respuesta de un turno que razonó", () => {
    const out = cleanForSpeech("<think>\nOkay, 3 boxes of 12 is 36, minus 7 is 29.\n</think>\n\nMe quedan 29 huevos.");
    expect(out).toBe("Me quedan 29 huevos.");
  });

  it("plantillas que abren el bloque en el prompt: solo llega el cierre", () => {
    expect(cleanForSpeech("3 x 12 = 36; 36 - 7 = 29.</think>Quedan 29.")).toBe("Quedan 29.");
  });

  it("un razonamiento que no terminó no se lee", () => {
    expect(cleanForSpeech("<think>\nLet me see, the user asks")).toBe("");
  });

  it("una respuesta sin razonamiento se lee igual que antes", () => {
    expect(cleanForSpeech("Hola. **Todo** bien.")).toBe("Hola. Todo bien.");
  });
});

describe("la orquestación de la lectura (paso 2 de E9)", () => {
  /**
   * Un puerto de mentira: sintetiza al instante y su «play»
   * queda sonando hasta que la prueba lo asienta o
   * stopPlayback lo corta, como el reproductor de verdad.
   */
  function fakePort() {
    const synthesized: string[] = [];
    const played: string[] = [];
    let settlePlay: (() => void) | null = null;
    let stopped = 0;
    const port: TtsEnginePort = {
      synthesize: vi.fn(async (sentence: string) => {
        synthesized.push(sentence);
        return { samples: new Float32Array(4), sampleRate: 24000 };
      }),
      play: vi.fn(
        (audio: { samples: Float32Array }) =>
          new Promise<void>((resolve) => {
            played.push(`play:${audio.samples.length}`);
            settlePlay = resolve;
          }),
      ),
      stopPlayback: vi.fn(() => {
        stopped++;
        settlePlay?.();
        settlePlay = null;
      }),
    };
    return {
      port,
      synthesized,
      played,
      stoppedCount: () => stopped,
      finishPlay: () => {
        settlePlay?.();
        settlePlay = null;
      },
    };
  }

  it("la interrupción es instantánea: corta el sonido y no suena ni una frase más", async () => {
    const fake = fakePort();
    setTtsEnginePort(fake.port);
    const reading = speakText("Uno. Dos. Tres.", "es");
    // La primera frase ya está sonando (y la segunda, en
    // generación anticipada: es la vía firmada).
    await vi.waitFor(() => expect(fake.played).toHaveLength(1));
    expect(fake.synthesized).toEqual(["Uno.", "Dos."]);
    // La apertura de la propia lectura ya paró una vez (corta
    // lo anterior, la semántica del móvil): la interrupción
    // tiene que parar exactamente una vez más.
    const stopsBefore = fake.stoppedCount();
    stopSpeaking();
    await reading;
    expect(fake.stoppedCount()).toBe(stopsBefore + 1);
    // Ni la segunda (ya sintetizada) ni la tercera suenan.
    expect(fake.played).toHaveLength(1);
    expect(fake.synthesized).toEqual(["Uno.", "Dos."]);
    setTtsEnginePort(null);
  });

  it("una guía entera se lee por frases, cada una una sola vez y en orden, sin tope de pasada", async () => {
    const fake = fakePort();
    setTtsEnginePort(fake.port);
    // Doce frases de ~400 caracteres: ~4.800 en total, muy
    // por encima del tope de 2.000 de una sola limpieza.
    const sentences = Array.from(
      { length: 12 },
      (_, i) => `Frase número ${i + 1} ${"de la guía ".repeat(36)}con su cierre.`,
    );
    const reading = speakText(sentences.join(" "), "es");
    for (let i = 0; i < 12; i++) {
      await vi.waitFor(() => expect(fake.played.length).toBeGreaterThan(i));
      fake.finishPlay();
    }
    await reading;
    expect(fake.synthesized).toEqual(sentences);
    expect(fake.played).toHaveLength(12);
    setTtsEnginePort(null);
  });
});
