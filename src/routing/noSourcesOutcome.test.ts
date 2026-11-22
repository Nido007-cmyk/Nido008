/**
 * 0.1.90 · Familia 4 — la abstención ante una pregunta general.
 *
 * Foto del dueño (15:43 MST, Tab A9+, 0.1.89): con el Qwen3-0.6B
 * activo, «Explícame cómo cambiar una llanta en 5 pasos numerados,
 * cada paso con una sola línea» recibió la abstención determinista
 * («No encontré información sobre esto en las fuentes offline de
 * NIDO…») sin generar: la puerta previa de la ruta fija (y su gemela
 * del post-chequeo) sustituían toda pregunta «de hechos» sin fuentes.
 *
 * La ley del dueño (2026-11-09): sin guía que la responda, genera el
 * modelo; la abstención queda SOLO para salud y seguridad sin
 * evidencia. La decisión vive en noSourcesOutcome (emergencyGate.ts)
 * y la consumen la puerta previa de la ruta fija y el post-chequeo.
 *
 * (iii) «pregunta con guía → guía literal» no se prueba aquí: ese
 * camino (pickLexicalGuideChunk y la tentativa) va ANTES de esta
 * puerta y no se tocó; lo cubren las suites del campo de guías.
 */
import { describe, it, expect } from "vitest";
// isFactualQuestion vive en grounding.ts entero, recreado en la
// tanda 8 (J-7): la directiva @ts-expect-error que declaraba su
// ausencia (firma 4 de la apertura de Puertas) se retira en esta
// pasada, como el propio fichero mandaba, y el caso de la llanta
// corre contra el detector real.
import { isFactualQuestion } from "../rag/grounding.js";
import { isEmergencySituation, isHealthQuestion, noSourcesOutcome } from "./emergencyGate.js";

const outcomeFor = (query: string) =>
  noSourcesOutcome({ isHealth: isHealthQuestion(query), isEmergency: isEmergencySituation(query) });

const TIRE = "Explícame cómo cambiar una llanta en 5 pasos numerados, cada paso con una sola línea";

describe("familia 4 (i): la pregunta general sin guía genera", () => {
  // HEREDADO de la tanda 7, corrido en la tanda 8 (J-7) y no
  // sumado allí (firma 4 de la apertura de Puertas): este caso
  // se difirió ENTERO a J-7 como it.skip con su texto íntegro,
  // sin fixture de superficies y sin sustituto, porque su
  // primera aserción corre contra isFactualQuestion, que vive
  // en grounding.ts entero. Recreado el juez en J-7, el caso
  // se desmarca y corre contra el detector real: «heredado de
  // la tanda 7, corrido, no sumado». Los otros 4 casos de esta
  // batería corren desde la tanda 7 contra el emergencyGate
  // recreado; con este, la batería queda en 5/5 ejecutados.
  it("la llanta, con su redacción exacta: era «de hechos» y ya no abstiene", () => {
    // Por qué disparaba la puerta vieja: el clasificador de hechos la
    // caza por «Explícame» — y ese clasificador NO cambia.
    expect(isFactualQuestion(TIRE)).toBe(true);
    // Pero no es salud ni emergencia…
    expect(isHealthQuestion(TIRE)).toBe(false);
    expect(isEmergencySituation(TIRE)).toBe(false);
    // …así que el turno genera con el modelo activo.
    expect(outcomeFor(TIRE)).toBe("generate");
  });

  it("otras generales inofensivas también generan (ES/EN/PT)", () => {
    for (const q of [
      "¿Cuál es la capital de Islandia?",
      "Explain how photosynthesis works in simple terms",
      "Como faço para trocar um pneu em 5 passos?",
      "Cuéntame un cuento muy corto de un zorro que aprende a nadar",
    ]) {
      expect(outcomeFor(q), q).toBe("generate");
    }
  });
});

describe("familia 4 (ii): salud y seguridad sin evidencia siguen en abstención", () => {
  it("una pregunta de salud sin fuentes cae al texto seguro", () => {
    const q = "¿Qué dosis de paracetamol le puedo dar a mi hijo de 5 años?";
    expect(isHealthQuestion(q)).toBe(true);
    expect(outcomeFor(q)).toBe("safe-text");
  });

  it("una emergencia viva contada sin guía cae al texto seguro", () => {
    const q = "Mi casa huele a gas, ¿qué hago?";
    expect(isEmergencySituation(q)).toBe(true);
    expect(outcomeFor(q)).toBe("safe-text");
  });

  it("la tabla de verdad de la decisión es exactamente salud O emergencia", () => {
    expect(noSourcesOutcome({ isHealth: false, isEmergency: false })).toBe("generate");
    expect(noSourcesOutcome({ isHealth: true, isEmergency: false })).toBe("safe-text");
    expect(noSourcesOutcome({ isHealth: false, isEmergency: true })).toBe("safe-text");
    expect(noSourcesOutcome({ isHealth: true, isEmergency: true })).toBe("safe-text");
  });
});
