/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda de paridad numérica de la serie de curas (F-PC36, F-PC37,
 * F-PC38 en salida A firmada, F-PC41 y F-PC42): la familia de
 * palabras numéricas en letra, cobrada tabla a tabla por la
 * superficie que la consume, en los tres idiomas. Todos los huecos
 * son del móvil, heredados en copia fiel probada por diff; la tanda
 * los cura en PC como mejora declarada sobre la base móvil, y la
 * medida de cada cura es esta batería, no el fichero del móvil.
 *
 * Nacimiento (contra el árbol sin curar): 27 rojos especificados
 * (A 3, B 1, C 2, D 1 + 3 del 11 en salida A, G 5, K 3, L 9) más
 * los 2 de la sección J, medidos en su corrida (las dos infieles:
 * la fiel en letra nace sostenida). Las secciones E, F, H e I
 * nacen como guardias en verde.
 *
 * Forma de las sondas: cada caso es una `it` generada por valor e
 * idioma. La sección G cobra `wordNumberValue` con el token en su
 * forma plegada, que es el contrato de esa superficie (sus
 * llamadores de producción le pasan raíces ya plegadas); las
 * formas naturales con tilde se cobran en texto corrido por la
 * sección F (`sentenceWordReadings` pliega la frase). Las sondas
 * de G4 llevan marco de unidad porque `quantitiesOf` solo lee
 * cantidades con dimensión: la frase numérica bajo prueba es la
 * de la especificación («quinze mil», «vinte e um»…).
 */
import { describe, expect, it } from "vitest";
import {
  extractCalcAction,
  extractReminderAction,
  extractTimerAction,
  hasUnsupportedInterval,
  parseReminderDateTime,
} from "../agent/loop/actionRouter.js";
import {
  quantitiesOf,
  sentenceWordReadings,
  wordNumberValue,
} from "./evidenceNumbers.js";
import { parseDateMentions } from "./dates.js";
import {
  doseMeasuresOf,
  splitClausesWithSep,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding.js";
import type { JudgeSemanticContext } from "./semanticContext.js";

const NOW = new Date(2026, 10, 3, 17, 0);
const offMin = (iso: string | null | undefined): number | null =>
  iso ? Math.round((new Date(iso).getTime() - NOW.getTime()) / 60000) : null;

// ---------------------------------------------------------------- A
// El relativo: «en/in/em {w} minutos» contra NUMBER_WORDS y su
// alternancia. Rojos al nacer: pt 11, 12 y 15 (F-PC36).
describe("A · relativo (extractReminderAction)", () => {
  const VALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 30];
  const ES = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "quince", "veinte", "treinta"];
  const EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty"];
  const PT = ["um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "quinze", "vinte", "trinta"];
  const rows: Array<[string, string, number]> = [];
  VALS.forEach((v, i) => {
    rows.push([`es «en ${ES[i]} minutos»`, `recuérdame en ${ES[i]} minutos salir`, v]);
    rows.push([`en «in ${EN[i]} minute${v === 1 ? "" : "s"}»`, `remind me in ${EN[i]} minute${v === 1 ? "" : "s"} to leave`, v]);
    rows.push([`pt «em ${PT[i]} minuto${v === 1 ? "" : "s"}»`, `lembre-me em ${PT[i]} minuto${v === 1 ? "" : "s"} de sair`, v]);
  });
  rows.push(["es «en media hora»", "recuérdame en media hora salir", 30]);
  rows.push(["en «in half an hour»", "remind me in half an hour to leave", 30]);
  rows.push(["pt «em meia hora»", "lembre-me em meia hora de sair", 30]);
  it.each(rows)("%s → +%d min", (_nombre, texto, v) => {
    expect(offMin(extractReminderAction(texto, NOW)?.dueAt)).toBe(v);
  });
});

// ---------------------------------------------------------------- B
// La cola tras la hora: «1 hora y/and/e {w} minutos» contra
// RELATIVE_TAIL_RE, cuyo valor sale de NUMBER_WORDS. Rojo al
// nacer: pt «quinze» (F-PC36, su tercera superficie).
describe("B · cola del relativo (extractReminderAction)", () => {
  const VALS = [5, 10, 15, 20, 30];
  const ES = ["cinco", "diez", "quince", "veinte", "treinta"];
  const EN = ["five", "ten", "fifteen", "twenty", "thirty"];
  const PT = ["cinco", "dez", "quinze", "vinte", "trinta"];
  const rows: Array<[string, string, number]> = [];
  VALS.forEach((v, i) => {
    rows.push([`es «y ${ES[i]}»`, `recuérdame en 1 hora y ${ES[i]} minutos salir`, 60 + v]);
    rows.push([`en «and ${EN[i]}»`, `remind me in 1 hour and ${EN[i]} minutes to leave`, 60 + v]);
    rows.push([`pt «e ${PT[i]}»`, `lembre-me em 1 hora e ${PT[i]} minutos de sair`, 60 + v]);
  });
  it.each(rows)("%s → +%d min", (_nombre, texto, v) => {
    expect(offMin(extractReminderAction(texto, NOW)?.dueAt)).toBe(v);
  });
});

// ---------------------------------------------------------------- C
// El temporizador: TIMER_NUMBER_WORDS. Rojos al nacer: pt 11 y 12
// (F-PC36); «quinze» ya está en su bloque pt.
describe("C · temporizador (extractTimerAction)", () => {
  const VALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 30];
  const ES = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "quince", "veinte", "treinta"];
  const EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty"];
  const PT = ["um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "quinze", "vinte", "trinta"];
  const mins = (q: string) => (extractTimerAction(q)?.durationMs ?? NaN) / 60000;
  const rows: Array<[string, string, number]> = [];
  VALS.forEach((v, i) => {
    rows.push([`es «de ${ES[i]} minutos»`, `pon un temporizador de ${ES[i]} minutos`, v]);
    rows.push([`en «for ${EN[i]} minute${v === 1 ? "" : "s"}»`, `set a timer for ${EN[i]} minute${v === 1 ? "" : "s"}`, v]);
    rows.push([`pt «de ${PT[i]} minuto${v === 1 ? "" : "s"}»`, `coloca um temporizador de ${PT[i]} minuto${v === 1 ? "" : "s"}`, v]);
  });
  it.each(rows)("%s → %d min", (_nombre, texto, v) => {
    expect(mins(texto)).toBe(v);
  });
});

// ---------------------------------------------------------------- D
// El detector de intervalos: INTERVAL_NUMBER, una sola cadena
// para los tres idiomas. Rojos al nacer: el «doze» pt (F-PC36) y
// el 11 en los tres idiomas (F-PC38, salida A firmada: entran
// «once», «eleven» y «onze»; el comentario de la tabla no se
// toca). El 13, el 14 y 16+ quedan fuera en las dos salidas:
// subconjunto curado declarado, no hueco.
describe("D · intervalos no soportados (hasUnsupportedInterval)", () => {
  const VALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30];
  const ES = ["dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "doce", "quince", "veinte", "treinta"];
  const EN = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twelve", "fifteen", "twenty", "thirty"];
  const PT = ["dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "doze", "quinze", "vinte", "trinta"];
  const rows: Array<[string, string]> = [];
  VALS.forEach((v, i) => {
    rows.push([`es «cada ${ES[i]} días»`, `cada ${ES[i]} días`]);
    rows.push([`en «every ${EN[i]} days»`, `every ${EN[i]} days`]);
    rows.push([`pt «a cada ${PT[i]} dias»`, `a cada ${PT[i]} dias`]);
  });
  rows.push(["es «cada once días» (F-PC38)", "cada once días"]);
  rows.push(["en «every eleven days» (F-PC38)", "every eleven days"]);
  rows.push(["pt «a cada onze dias» (F-PC38)", "a cada onze dias"]);
  it.each(rows)("%s → detectado", (_nombre, texto) => {
    expect(hasUnsupportedInterval(texto)).toBe(true);
  });
});

// ---------------------------------------------------------------- E
// La hora de reloj: CLOCK_WORDS, completa 1–12 en los tres
// idiomas, con las variantes de dictado del español. Guardia:
// nace en verde y no debe caer con ninguna cura de la familia.
describe("E · hora de reloj (parseReminderDateTime)", () => {
  const NOW2 = new Date(2026, 10, 3, 8, 0);
  const ES = ["una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"];
  const EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const PT = ["uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"];
  const rows: Array<[string, string, number]> = [];
  for (let v = 1; v <= 12; v++) {
    rows.push([`es «a las ${ES[v - 1]}»`, `a las ${ES[v - 1]}`, v]);
    rows.push([`en «at ${EN[v - 1]}»`, `at ${EN[v - 1]}`, v]);
    rows.push([`pt «às ${PT[v - 1]}»`, `às ${PT[v - 1]}`, v]);
  }
  rows.push(["es dictado «a las sinco»", "a las sinco", 5]);
  rows.push(["es dictado «a las onse»", "a las onse", 11]);
  rows.push(["es dictado «a las dose»", "a las dose", 12]);
  it.each(rows)("%s → hora %d (módulo 12)", (_nombre, texto, v) => {
    const iso = parseReminderDateTime(texto, NOW2);
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).getHours() % 12).toBe(v % 12);
  });
});

// ---------------------------------------------------------------- F
// La dosis en letra por la pierna de palabras: WORD_NUMBERS,
// completa 1–12 en los tres idiomas, en su marco cerrado de
// dosis. Guardia: nace en verde.
describe("F · dosis en letra (sentenceWordReadings)", () => {
  const ES = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce"];
  const EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const PT = ["um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"];
  const rows: Array<[string, string, number]> = [];
  for (let v = 1; v <= 12; v++) {
    rows.push([`es «${ES[v - 1]} comprimidos»`, `${ES[v - 1]} comprimidos`, v]);
    rows.push([`en «${EN[v - 1]} tablets»`, `${EN[v - 1]} tablets`, v]);
    rows.push([`pt «${PT[v - 1]} comprimidos»`, `${PT[v - 1]} comprimidos`, v]);
  }
  it.each(rows)("%s → lectura %d", (_nombre, texto, v) => {
    expect(sentenceWordReadings(texto).some((r) => r.value === v)).toBe(true);
  });
});

// ---------------------------------------------------------------- G
// La pierna WN entera: WN_SMALL, WN_TENS y WN_HUNDREDS por
// `wordNumberValue` (token plegado, el contrato de la superficie)
// y los compuestos y miles por `quantitiesOf` con marco de
// unidad. Rojos al nacer (F-PC37): «quinze» en G1, su gemela
// «quatorze», «veintiuno» en G2, «quinze» y «quinze mil» en G4.
describe("G1 · WN_SMALL (wordNumberValue)", () => {
  const ES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve"];
  const EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const PT = ["zero", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const rows: Array<[string, string, number]> = [];
  ES.forEach((w, v) => rows.push([`es «${w}»`, w, v]));
  EN.forEach((w, v) => rows.push([`en «${w}»`, w, v]));
  PT.forEach((w, v) => rows.push([`pt «${w}»`, w, v]));
  rows.push(["pt variante «quatorze»", "quatorze", 14]);
  it.each(rows)("%s → %d", (_nombre, w, v) => {
    expect(wordNumberValue(w)).toBe(v);
  });
});

describe("G2 · WN_TENS (wordNumberValue)", () => {
  const rows: Array<[string, string, number]> = [
    ["es «veinte»", "veinte", 20], ["es «veintiuno»", "veintiuno", 21],
    ["es «veintidos»", "veintidos", 22], ["es «veintitres»", "veintitres", 23],
    ["es «veinticuatro»", "veinticuatro", 24], ["es «veinticinco»", "veinticinco", 25],
    ["es «veintiseis»", "veintiseis", 26], ["es «veintisiete»", "veintisiete", 27],
    ["es «veintiocho»", "veintiocho", 28], ["es «veintinueve»", "veintinueve", 29],
    ["es «treinta»", "treinta", 30], ["es «cuarenta»", "cuarenta", 40],
    ["es «cincuenta»", "cincuenta", 50], ["es «sesenta»", "sesenta", 60],
    ["es «setenta»", "setenta", 70], ["es «ochenta»", "ochenta", 80],
    ["es «noventa»", "noventa", 90],
    ["en «twenty»", "twenty", 20], ["en «thirty»", "thirty", 30],
    ["en «forty»", "forty", 40], ["en «fifty»", "fifty", 50],
    ["en «sixty»", "sixty", 60], ["en «seventy»", "seventy", 70],
    ["en «eighty»", "eighty", 80], ["en «ninety»", "ninety", 90],
    ["pt «vinte»", "vinte", 20], ["pt «trinta»", "trinta", 30],
    ["pt «quarenta»", "quarenta", 40], ["pt «cinquenta»", "cinquenta", 50],
    ["pt «sessenta»", "sessenta", 60], ["pt «setenta»", "setenta", 70],
    ["pt «oitenta»", "oitenta", 80], ["pt «noventa»", "noventa", 90],
  ];
  it.each(rows)("%s → %d", (_nombre, w, v) => {
    expect(wordNumberValue(w)).toBe(v);
  });
});

describe("G3 · WN_HUNDREDS (wordNumberValue)", () => {
  const rows: Array<[string, string, number]> = [
    ["es «cien»", "cien", 100], ["es «doscientos»", "doscientos", 200],
    ["es «trescientos»", "trescientos", 300], ["es «cuatrocientos»", "cuatrocientos", 400],
    ["es «quinientos»", "quinientos", 500], ["es «seiscientos»", "seiscientos", 600],
    ["es «setecientos»", "setecientos", 700], ["es «ochocientos»", "ochocientos", 800],
    ["es «novecientos»", "novecientos", 900],
    ["pt «cem»", "cem", 100], ["pt «duzentos»", "duzentos", 200],
    ["pt «trezentos»", "trezentos", 300], ["pt «quatrocentos»", "quatrocentos", 400],
    ["pt «quinhentos»", "quinhentos", 500], ["pt «seiscentos»", "seiscentos", 600],
    ["pt «setecentos»", "setecentos", 700], ["pt «oitocentos»", "oitocentos", 800],
    ["pt «novecentos»", "novecentos", 900],
  ];
  it.each(rows)("%s → %d", (_nombre, w, v) => {
    expect(wordNumberValue(w)).toBe(v);
  });
});

describe("G4 · compuestos y miles (quantitiesOf)", () => {
  const rows: Array<[string, string, number]> = [
    ["«quinze miligramas»", "quinze miligramas", 15],
    ["«quinze mil» (miligramas)", "quinze mil miligramas", 15000],
    ["«quince mil» (miligramos)", "quince mil miligramos", 15000],
    ["«fifteen thousand milligrams»", "fifteen thousand milligrams", 15000],
    ["«vinte e um» (miligramas)", "vinte e um miligramas", 21],
    ["«twenty one» (milligrams)", "twenty one milligrams", 21],
    ["«one hundred» (milligrams)", "one hundred milligrams", 100],
    ["«two hundred fifty» (milligrams)", "two hundred fifty milligrams", 250],
    ["«ciento veinticinco» (miligramos)", "ciento veinticinco miligramos", 125],
    ["«dez mil» (miligramas)", "dez mil miligramas", 10000],
  ];
  it.each(rows)("%s → canónico %d", (_nombre, texto, v) => {
    expect(quantitiesOf(texto).some((q) => q.canon === v)).toBe(true);
  });
});

// ---------------------------------------------------------------- H
// El día en letra: WORDDAY (es/pt) y ORDAY (en) por
// `parseDateMentions`, el contraste de F-PC37: estas tablas sí
// traen «quatorze» y «quinze». Guardia: nace en verde.
describe("H · día en letra (parseDateMentions)", () => {
  const REF = new Date(2026, 0, 15);
  const ES = ["primero", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve", "treinta", "treinta y uno"];
  const PT = ["primeiro", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro", "vinte e cinco", "vinte e seis", "vinte e sete", "vinte e oito", "vinte e nove", "trinta", "trinta e um"];
  const EN = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"];
  const rows: Array<[string, string, number]> = [];
  ES.forEach((w, i) => rows.push([`es «el ${w} de mayo»`, `el ${w} de mayo`, i + 1]));
  PT.forEach((w, i) => rows.push([`pt «no dia ${w} de maio»`, `no dia ${w} de maio`, i + 1]));
  EN.forEach((w, i) => rows.push([`en «the ${w} of May»`, `the ${w} of May`, i + 1]));
  it.each(rows)("%s → día %d de mayo", (_nombre, texto, v) => {
    const m = parseDateMentions(texto, REF);
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m[0]?.dom).toBe(v);
    expect(m[0]?.month).toBe(5);
  });
});

// ---------------------------------------------------------------- I
// La dosis medida en letra: MEASURE_NUMBER_WORDS por
// `doseMeasuresOf`, completa 1–10 en los tres idiomas. Guardia:
// nace en verde (su plenitud es la sección entera: el 11+ fuera
// de las medidas queda declarado en el asiento, no curado).
describe("I · dosis medida (doseMeasuresOf)", () => {
  const ES = ["un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
  const EN = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const PT = ["um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
  const rows: Array<[string, string, number]> = [];
  for (let v = 1; v <= 10; v++) {
    rows.push([`es «${ES[v - 1]} miligramos»`, `${ES[v - 1]} miligramos`, v]);
    rows.push([`en «${EN[v - 1]} milligrams»`, `${EN[v - 1]} milligrams`, v]);
    rows.push([`pt «${PT[v - 1]} miligramas»`, `${PT[v - 1]} miligramas`, v]);
  }
  it.each(rows)("%s → mg %d", (_nombre, texto, v) => {
    const r = doseMeasuresOf(texto);
    expect(r).toHaveLength(1);
    expect(r[0]?.unit).toBe("mg");
    expect(r[0]?.lo).toBe(v);
    expect(r[0]?.hi).toBe(v);
  });
});

// ---------------------------------------------------------------- J
// El juez en dos modos con el par de F-PC37. La fuente afirma
// «quinze miligramas» en letra. Fiel: la respuesta lo afirma en
// la misma letra y se sostiene. Infiel: la respuesta afirma
// «quinze» contra el «catorze» de la fuente: solo se caza si la
// pierna WN lee la palabra de la respuesta y la choca con la de
// la evidencia (al nacer se sellaba, porque «quinze» no se
// leía: los 2 rojos de nacimiento de la sección). La fiel va en
// letra y no en dígitos por medición de la pieza: el juez no
// sostiene una dosis en dígitos contra una fuente en letra ni
// dentro del rango de su tabla de medidas («cinco» en la fuente
// y «5» en la respuesta también se abstiene), así que el par se
// juzga por la pierna de cantidades WN, que es la que F-PC37
// cura. El modo se afirma desde el propio `judgeMode` del
// resultado (el mecanismo de la tanda 13): sin contexto,
// «lexical»; con el contexto hecho a mano de vectores
// alineados, «full».
describe("J · el juez en dos modos (verifyGroundedAnswer)", () => {
  const FECHA = new Date("2026-11-14T12:00:00Z");
  const E1 = new Float32Array([1, 0, 0, 0]);
  const GUIA_QUINZE: GroundingChunk = {
    title: "Dosagem do paracetamol",
    body: "A dose recomendada de paracetamol para adultos é de quinze miligramas por quilo de peso. A dose pode repetir-se até quatro vezes ao dia, com um intervalo mínimo de quatro horas. Não ultrapasse a dose máxima diária indicada na embalagem. Esta guia foi revisada em 3 de outubro de 2023.",
  };
  const GUIA_CATORZE: GroundingChunk = {
    title: "Dosagem do paracetamol",
    body: "A dose recomendada de paracetamol para adultos é de catorze miligramas por quilo de peso. A dose pode repetir-se até quatro vezes ao dia, com um intervalo mínimo de quatro horas. Não ultrapasse a dose máxima diária indicada na embalagem. Esta guia foi revisada em 3 de outubro de 2023.",
  };
  const PREGUNTA = "Qual é a dose recomendada de paracetamol para adultos?";
  const FIEL = "A dose recomendada de paracetamol para adultos é de quinze miligramas por quilo de peso.";
  const INFIEL = "A dose recomendada de paracetamol para adultos é de quinze miligramas por quilo de peso.";
  function ctxValido(chunks: GroundingChunk[], answer: string): JudgeSemanticContext {
    const chunkClauseVectors = chunks.map((c) => {
      const ss = splitSentences(c.body.trim())
        .map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean);
      return ss.flatMap((s) => splitClausesWithSep(s).map(() => E1));
    });
    const answerClauseVectors = splitSentences(answer.trim()).map((s) =>
      splitClausesWithSep(s).map(() => E1),
    );
    return {
      chunkClauseVectors,
      answerClauseVectors,
      questionChunkSims: Float32Array.from(chunks.map(() => 0.9)),
      profileId: "multilingual-e5-small",
    };
  }

  it("léxico: la fiel («quinze» en la fuente y en la respuesta) se sostiene", () => {
    const r = verifyGroundedAnswer(FIEL, [GUIA_QUINZE], "pt", PREGUNTA, FECHA);
    expect(r.judgeMode).toBe("lexical");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("quinze miligramas");
  });

  it("léxico: la infiel («quinze» contra «catorze» de la fuente) se caza", () => {
    const r = verifyGroundedAnswer(INFIEL, [GUIA_CATORZE], "pt", PREGUNTA, FECHA);
    expect(r.judgeMode).toBe("lexical");
    expect(r.text).not.toContain("quinze miligramas");
  });

  it("completo: la fiel se sostiene", () => {
    const r = verifyGroundedAnswer(FIEL, [GUIA_QUINZE], "pt", PREGUNTA, FECHA, ctxValido([GUIA_QUINZE], FIEL));
    expect(r.judgeMode).toBe("full");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("quinze miligramas");
  });

  it("completo: la infiel se caza", () => {
    const r = verifyGroundedAnswer(INFIEL, [GUIA_CATORZE], "pt", PREGUNTA, FECHA, ctxValido([GUIA_CATORZE], INFIEL));
    expect(r.judgeMode).toBe("full");
    expect(r.text).not.toContain("quinze miligramas");
  });
});

// ---------------------------------------------------------------- K
// F-PC41: el «por» tras dividir. La regla general («N por M» es
// producto) no se toca: el rescate vive dentro de la rama del
// verbo de `normalizeCalcText`, tras el pelado del verbo y antes
// del caso especial de la resta, solo para divide|dividir, y
// cubre «por» y «by». Rojos al nacer: los tres rescates.
describe("K · el «por» tras dividir (extractCalcAction)", () => {
  const rows: Array<[string, string, number]> = [
    ["«divide 100 por 4»", "divide 100 por 4", 25],
    ["«dividir 100 por 4»", "dividir 100 por 4", 25],
    ["«divide 100 by 4»", "divide 100 by 4", 25],
    ["control «divide 100 entre 4»", "divide 100 entre 4", 25],
    ["control «multiplica 6 por 9» (el por general sigue producto)", "multiplica 6 por 9", 54],
    ["control «cuánto es 9 por 7»", "cuánto es 9 por 7", 63],
  ];
  it.each(rows)("%s → %d", (_nombre, texto, v) => {
    const a = extractCalcAction(texto);
    expect(a).not.toBeNull();
    expect(a?.result).toBe(v);
  });
});

// ---------------------------------------------------------------- L
// F-PC42: la fila portuguesa de la calculadora y el «from»
// inglés. Rojos al nacer: los cinco de la suma pt con la «e», los
// dos de la resta pt, el «subtract … from» y las «dúzias».
describe("L · verbos pt y «from» (extractCalcAction)", () => {
  const rows: Array<[string, string, number]> = [
    ["«quanto é 45 e 67»", "quanto é 45 e 67", 112],
    ["«soma 45 e 67»", "soma 45 e 67", 112],
    ["«somar 45 e 67»", "somar 45 e 67", 112],
    ["«some 45 e 67»", "some 45 e 67", 112],
    ["«adiciona 45 e 67»", "adiciona 45 e 67", 112],
    ["«subtrai 25 de 100»", "subtrai 25 de 100", 75],
    ["«subtrair 25 de 100»", "subtrair 25 de 100", 75],
    ["«subtract 25 from 100»", "subtract 25 from 100", 75],
    ["«quanto é 3 dúzias»", "quanto é 3 dúzias", 36],
    ["verde «cuánto es 45 y 67»", "cuánto es 45 y 67", 112],
    ["verde «what is 45 and 67»", "what is 45 and 67", 112],
    ["verde «resta 25 de 100»", "resta 25 de 100", 75],
    ["verde «cuánto es 3 docenas»", "cuánto es 3 docenas", 36],
    ["verde «what is 3 dozen»", "what is 3 dozen", 36],
    ["control pt «quanto é 45 mais 67»", "quanto é 45 mais 67", 112],
    ["control pt «quanto é 100 menos 25»", "quanto é 100 menos 25", 75],
    ["control pt «quanto é 6 vezes 9»", "quanto é 6 vezes 9", 54],
    ["control pt «quanto é 100 dividido por 4»", "quanto é 100 dividido por 4", 25],
    ["control pt «quanto é 5 ao quadrado»", "quanto é 5 ao quadrado", 25],
    ["control pt «quanto é a raiz quadrada de 144»", "quanto é a raiz quadrada de 144", 12],
    ["control pt «quanto é 15% de 200»", "quanto é 15% de 200", 30],
  ];
  it.each(rows)("%s → %d", (_nombre, texto, v) => {
    const a = extractCalcAction(texto);
    expect(a).not.toBeNull();
    expect(a?.result).toBe(v);
  });
});
