/**
 * Batería de paridad de la familia de CO (F-PC39 ALTA, F-PC52, F-PC53),
 * partida añadida de la tanda de seguridad en su forma (a): MEJORA
 * DECLARADA sobre hueco heredado del móvil. La pieza del móvil sirve
 * estos casos en español y en inglés y los pierde en portugués (y en
 * dos palabras sueltas del inglés y del portugués); la batería es la
 * medida de la cura, no el fichero del móvil. El móvil no se toca.
 *
 * Nacimiento cobrado: exactamente 8 rojos (las filas pt de los tres
 * tríos de síntomas, la celda del tallo «tont», las tres de «porch»/
 * «varanda» y la de «aquecedor de água»), todos conducta heredada.
 * El orden sellado de la puerta no se toca: su batería dueña es
 * emergencyGate.test.ts, que corre sin regresión con esta.
 */

import { describe, expect, it } from "vitest";
import { matchSafetyAnswer, type SafetyKind, type SafetyLang } from "./safetyAnswers.js";

type Caso = [texto: string, lang: SafetyLang, esperado: SafetyKind, nombre: string];

describe("Sección A · síntomas de CO: los tres tríos de la caza, los controles pt y la celda del tallo «tont»", () => {
  const casos: Caso[] = [
    ["creo que es monóxido de carbono, estoy con mucha debilidad", "es", "co-symptoms", "A-1 es · debilidad"],
    ["i think it is carbon monoxide, i feel very weak", "en", "co-symptoms", "A-1 en · weak"],
    ["acho que é monóxido de carbono, estou com muita fraqueza", "pt", "co-symptoms", "A-1 pt · fraqueza (F-PC39)"],
    ["estoy mal, casi me desmayé y huele a monóxido", "es", "co-symptoms", "A-2 es · desmayo"],
    ["i feel sick, i almost fainted and it smells of carbon monoxide", "en", "co-symptoms", "A-2 en · fainted"],
    ["estou mal, quase desmaiei e tem cheiro de monóxido", "pt", "co-symptoms", "A-2 pt · desmaiei (F-PC39)"],
    ["la alarma de monóxido está sonando", "es", "co-symptoms", "A-3 es · alarma con puente"],
    ["the carbon monoxide alarm is going off", "en", "co-symptoms", "A-3 en · alarm going off"],
    ["o alarme de monóxido está tocando", "pt", "co-symptoms", "A-3 pt · alarme con puente (F-PC39)"],
    ["estou com confusão por causa do gerador", "pt", "co-symptoms", "control pt · confusão"],
    ["estou com náusea por causa do gerador", "pt", "co-symptoms", "control pt · náusea"],
    ["estou com dor de cabeça por causa do gerador", "pt", "co-symptoms", "control pt · dor de cabeça"],
    ["o alarme está tocando e o gerador está ligado", "pt", "co-symptoms", "control pt · alarme sin puente"],
    ["estoy mareado por el generador", "es", "co-symptoms", "celda «tont» · es mareado"],
    ["estou com tontura por causa do gerador", "pt", "co-symptoms", "celda «tont» · pt tontura (control)"],
    ["estou tonto por causa do gerador", "pt", "co-symptoms", "celda «tont» · pt tonto (F-PC39)"],
  ];
  it.each(casos)("%s [%s] → %s · %s", (texto, lang, esperado) => {
    expect(matchSafetyAnswer(texto, lang)?.kind).toBe(esperado);
  });
});

describe("Sección B · peligro de CO: «porch» y «varanda» en CO_INDOOR_RE (F-PC52)", () => {
  const casos: Caso[] = [
    ["¿puedo usar el generador en el porche?", "es", "co-hazard", "B es · porche (control)"],
    ["can i use the generator on the porch?", "en", "co-hazard", "B en · porch (F-PC52)"],
    ["posso usar o gerador na varanda?", "pt", "co-hazard", "B pt · varanda con gerador (F-PC52)"],
    ["posso usar a churrasqueira na varanda?", "pt", "co-hazard", "B pt · varanda con churrasqueira (F-PC52)"],
  ];
  it.each(casos)("%s [%s] → %s · %s", (texto, lang, esperado) => {
    expect(matchSafetyAnswer(texto, lang)?.kind).toBe(esperado);
  });
});

describe("Sección C · aparatos de dentro con síntomas: «aquecedor de água» en CO_SYMPTOM_ONLY_DEVICE_RE (F-PC53)", () => {
  const casos: Caso[] = [
    ["estoy con náusea y el calentador de agua hace ruido", "es", "co-symptoms", "C es · calentador de agua (control)"],
    ["i feel nauseous and the water heater is making noise", "en", "co-symptoms", "C en · water heater (control)"],
    ["estou com náusea e o aquecedor de água faz barulho", "pt", "co-symptoms", "C pt · aquecedor de água (F-PC53)"],
    ["estou com náusea e o aquecedor a gás faz barulho", "pt", "co-symptoms", "C pt · aquecedor a gás (control)"],
    ["estou com dor de cabeça e a lareira faz fumaça", "pt", "co-symptoms", "C pt · lareira (control)"],
  ];
  it.each(casos)("%s [%s] → %s · %s", (texto, lang, esperado) => {
    expect(matchSafetyAnswer(texto, lang)?.kind).toBe(esperado);
  });
});
