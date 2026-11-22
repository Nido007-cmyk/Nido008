/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda de paridad de la serie de curas · el plan semanal
 * (F-PC48, F-PC49 y F-PC51): el horario dictado, los gatillos y
 * el ejercicio en palabras de `extractWeeklyPlanAction`, en los
 * tres idiomas. Los huecos son del móvil, heredados en copia
 * fiel; la tanda los cura en PC como mejora declarada.
 *
 * Nacimiento (contra el árbol sin curar): 39 rojos (W1 21: los
 * cinco pares que hoy caen a la plantilla en los tres idiomas,
 * más los seis pares fuera de rango que hoy sirven un plan
 * inventado en vez de null; W2 3; W3 15).
 */
import { describe, expect, it } from "vitest";
import {
  extractWeeklyPlanAction,
  generateWeeklyPlan,
} from "./actionRouter.js";

// ---------------------------------------------------------------- W1
// El horario dictado. La cura (F-PC48): lectura 12 h solo con
// inicio de 12 h («9 to 6» pasa a 9–18, como el M7b asentado);
// formato 24 h entero aceptado tal como se parsea (con el fin
// menor, cruza medianoche); el inicio 0 entra; el par fuera de
// rango o de longitud cero en 24 h devuelve null, nunca un plan
// inventado; sin horario dictado se sirve la plantilla 9–18.
describe("W1 · el horario dictado (extractWeeklyPlanAction)", () => {
  const PAIRS: Array<[number, number, number | null, number | null]> = [
    [8, 16, 8, 16],
    [12, 20, 12, 20],
    [13, 21, 13, 21],
    [14, 22, 14, 22],
    [22, 6, 22, 6],
    [14, 2, 14, 2],
    [0, 8, 0, 8],
    [9, 6, 9, 18],
    [25, 30, null, null],
    [13, 13, null, null],
  ];
  const frames: Array<[string, (s: number, e: number) => string]> = [
    ["es", (s, e) => `hazme un plan semanal, trabajo de ${s} a ${e}`],
    ["en", (s, e) => `make me a weekly plan, work ${s} to ${e}`],
    ["pt", (s, e) => `faz um plano semanal, trabalho das ${s} às ${e}`],
  ];
  for (const [lang, frame] of frames) {
    for (const [s, e, ws, we] of PAIRS) {
      it(`${lang} «${s} a ${e}» → ${ws === null ? "null" : `${ws}–${we}`}`, () => {
        const a = extractWeeklyPlanAction(frame(s, e));
        if (ws === null) {
          expect(a).toBeNull();
        } else {
          expect(a).not.toBeNull();
          expect(a?.workStart).toBe(ws);
          expect(a?.workEnd).toBe(we);
          if (lang === "es" && s === 22 && e === 6) {
            // La sonda del título servido del par que cruza
            // medianoche: la primera línea del plan dice el
            // horario aceptado, no el de la plantilla.
            const titulo = generateWeeklyPlan(a as NonNullable<typeof a>).split("\n")[0] ?? "";
            expect(titulo).toContain("trabajo 22:00–6:00");
          }
        }
      });
    }
  }
  const SIN: Array<[string, string]> = [
    ["es", "hazme un plan semanal"],
    ["en", "make me a weekly plan"],
    ["pt", "faz um plano semanal"],
  ];
  it.each(SIN)("sin horario dictado (%s) → plantilla 9–18", (_lang, texto) => {
    const a = extractWeeklyPlanAction(texto);
    expect(a).not.toBeNull();
    expect(a?.workStart).toBe(9);
    expect(a?.workEnd).toBe(18);
  });
});

// ---------------------------------------------------------------- W2
// Los gatillos (F-PC49): entran «plan the week», «organize my
// week» y «quero um plano para a minha semana». La guarda M7a no
// se mueve: «weekend» no dispara y las formas sin verbo de
// petición («¿cuánto cuesta el plan semanal?», «mi plan de
// datos») siguen en null.
describe("W2 · los gatillos (extractWeeklyPlanAction)", () => {
  const POS: Array<[string, string]> = [
    ["es", "organiza mi semana"],
    ["es", "planifica la semana"],
    ["es", "quiero un plan para mi semana"],
    ["es", "hazme un plan semanal"],
    ["es", "planifica mi semana"],
    ["en", "organize my week"],
    ["en", "plan the week"],
    ["en", "plan my week"],
    ["en", "make me a weekly plan"],
    ["pt", "quero um plano para a minha semana"],
    ["pt", "organiza minha semana"],
    ["pt", "quero um plano da minha semana"],
    ["pt", "faz um plano semanal"],
    ["pt", "planeja a minha semana"],
  ];
  it.each(POS)("positivo %s «%s» → plan", (_lang, texto) => {
    expect(extractWeeklyPlanAction(texto)).not.toBeNull();
  });
  const NEG: Array<[string, string]> = [
    ["es", "¿cuánto cuesta el plan semanal?"],
    ["es", "mi plan de datos"],
    ["en", "organize my weekend"],
  ];
  it.each(NEG)("negativo %s «%s» → null", (_lang, texto) => {
    expect(extractWeeklyPlanAction(texto)).toBeNull();
  });
});

// ---------------------------------------------------------------- W3
// El ejercicio en palabras (F-PC51): la lista cerrada 1–7 en los
// tres idiomas, resuelta por NUMBER_WORDS y aceptada solo en el
// dominio 1–7 de la pieza (el dígito 8 tampoco se lee hoy: la
// frontera queda simétrica). Rojos al nacer: las quince palabras
// (toda palabra cae hoy al defecto 3, y ningún valor pedido es 3).
describe("W3 · el ejercicio en palabras (extractWeeklyPlanAction)", () => {
  const ES: Record<number, string> = { 2: "dos", 4: "cuatro", 5: "cinco", 6: "seis", 7: "siete" };
  const EN: Record<number, string> = { 2: "two", 4: "four", 5: "five", 6: "six", 7: "seven" };
  const PT: Record<number, string> = { 2: "dois", 4: "quatro", 5: "cinco", 6: "seis", 7: "sete" };
  const rows: Array<[string, string, number]> = [];
  for (const v of [2, 4, 5, 6, 7]) {
    rows.push(["es", `hazme un plan semanal, ejercicio ${ES[v]} veces`, v]);
    rows.push(["en", `make me a weekly plan, exercise ${EN[v]} times`, v]);
    rows.push(["pt", `faz um plano semanal, exercício ${PT[v]} vezes`, v]);
  }
  it.each(rows)("palabra %s «%s» → %d días", (_lang, texto, v) => {
    expect(extractWeeklyPlanAction(texto)?.exerciseDays).toBe(v);
  });
  const DIG: Array<[string, string]> = [
    ["es", "hazme un plan semanal, ejercicio 5 veces"],
    ["en", "make me a weekly plan, exercise 5 times"],
    ["pt", "faz um plano semanal, exercício 5 vezes"],
  ];
  it.each(DIG)("guardia dígito %s «%s» → 5 días", (_lang, texto) => {
    expect(extractWeeklyPlanAction(texto)?.exerciseDays).toBe(5);
  });
});
