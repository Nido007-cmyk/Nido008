/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Los dos cargos de superficie de la lectura de E9 (paso 2),
 * como contratos sobre la fuente en la forma de la casa (sin
 * arnés de componentes: cobran la cadena, no el gesto; su
 * fragilidad queda declarada como en los contratos vecinos).
 * Los cargos de conducta de la orquestación (la interrupción
 * instantánea y la guía entera frase a frase) viven en
 * src/voice/tts.test.ts contra un puerto de mentira.
 *
 *   1. La lectura sale solo del texto asentado tras el juez:
 *      speakText se invoca una sola vez en la superficie,
 *      dentro del gancho useReading; el botón de lectura del
 *      turno del asistente le pasa el texto del turno ya
 *      guardado; y la región del dictado y el composer no
 *      leen nada (el dictado detiene la lectura, no la usa).
 *   2. La práctica de RCP lee la guía del porte con la voz
 *      del idioma: Emergencia compone el texto desde
 *      CPR_GUIDE (la guía NIDO Esencial palabra por palabra
 *      del porte de E3) en el idioma de la app y lo lee por
 *      el mismo gancho; el mapa de voces de Kokoro es el
 *      fijado (ef_dora 28, em_alex 29, pf_dora 42).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { voiceSidFor } from "../../src/voice/tts.js";

const appSrc = readFileSync(
  fileURLToPath(new URL("../src/App/App.tsx", import.meta.url)),
  "utf8",
);

/** La región entre dos marcas de la fuente. */
function region(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("la lectura en la superficie (E9 paso 2)", () => {
  it("la lectura sale solo del texto asentado tras el juez, por un único camino", () => {
    const llamadas = appSrc.match(/speakText\(/g) ?? [];
    expect(llamadas).toHaveLength(1);
    const gancho = region(appSrc, "function useReading", "/** La presencia de la voz de lectura");
    expect(gancho).toContain("speakText(text, lang)");
    expect(gancho).toContain("stopSpeaking()");
    // El botón del turno asentado le pasa el texto del turno.
    expect(appSrc).toContain("toggleRead(`turn:${currentId}:${i}`, t.text)");
    // El dictado detiene la lectura y ni él ni el composer leen.
    const dictado = region(
      appSrc,
      "const toggleDictation = useCallback",
      "// La semilla de la guía",
    );
    expect(dictado).toContain("stopSpeaking()");
    expect(dictado).not.toContain("toggleRead");
    expect(dictado).not.toContain("speakText");
  });

  it("la práctica de RCP lee la guía del porte con la voz del idioma", () => {
    const emergencia = region(
      appSrc,
      "function EmergencyView",
      "function ChatView",
    );
    expect(emergencia).toContain("CPR_GUIDE[boot.prefs.lang]");
    expect(emergencia).toContain("...guide.compressions");
    expect(emergencia).toContain('toggleRead(\n                  "cpr-guide"');
    expect(voiceSidFor("es")).toBe(28);
    expect(voiceSidFor("en")).toBe(29);
    expect(voiceSidFor("pt")).toBe(42);
    expect(voiceSidFor("pt-BR")).toBe(42);
  });
});
