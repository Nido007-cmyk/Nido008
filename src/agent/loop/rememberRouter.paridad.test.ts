/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda R de la serie de curas · la familia plegada de
 * `rememberRouter.ts` (F-PC40, F-PC43, F-PC47 y las celdas
 * de dieta del censo) sobre las superficies públicas
 * `extractRememberFact`, `extractPeople` y
 * `extractImplicitFact`. Convive con `olvidarParidad.test.ts`
 * en fichero distinto y con su Δ en línea propia.
 *
 * Nacimiento (contra el árbol sin curar): 30 rojos
 * (A 2, B 19, C 2, D 7). Los verdes de nacimiento son los
 * controles que la cura no puede romper.
 */
import { describe, expect, it } from "vitest";
import {
  extractImplicitFact,
  extractPeople,
  extractRememberFact,
} from "./rememberRouter.js";

// ---------------------------------------------------------------- A
// La guardia de consultas (F-PC40): QUERY_PATTERNS veta las
// consultas con forma de hecho en los tres idiomas. Hoy solo
// trae las formas españolas: la inglesa y la portuguesa se
// guardan como hecho (con su contenido verbatim, el de la
// caza). Las dos guardas finales son null hoy y tras la cura.
describe("A · la guardia de consultas (F-PC40)", () => {
  it("control es: «recuérdame cuándo es el cumpleaños de mi mamá» ya nace vetada", () => {
    expect(extractRememberFact("recuérdame cuándo es el cumpleaños de mi mamá")).toBeNull();
  });
  it("en: «remember the date of my mom's birthday» no se guarda como hecho", () => {
    expect(extractRememberFact("remember the date of my mom's birthday")).toBeNull();
  });
  it("pt: «lembra que dia é o aniversário da minha mãe?» no se guarda como hecho", () => {
    expect(extractRememberFact("lembra que dia é o aniversário da minha mãe?")).toBeNull();
  });
  it("guarda en: «remember when is my mom's birthday» es null", () => {
    expect(extractRememberFact("remember when is my mom's birthday")).toBeNull();
  });
  it("guarda pt: «lembre-me da data do aniversário da minha mãe» es null", () => {
    expect(extractRememberFact("lembre-me da data do aniversário da minha mãe")).toBeNull();
  });
});

// ---------------------------------------------------------------- B
// Personas (F-PC43): la pareja pt en PT_REL, la lista inglesa
// de m3 con sus tres formas de la caza y su bloque extendido
// del censo, los plurales en y pt con su mapa de singular, y
// el mejor amigo en y pt.
describe("B · personas (F-PC43)", () => {
  const CASOS: Array<[string, Array<[string, string]>]> = [
    ["meu parceiro se chama Carlos", [["Carlos", "parceiro"]]],
    ["minha parceira se chama Ana", [["Ana", "parceira"]]],
    ["my grandson is called Leo", [["Leo", "grandson"]]],
    ["my granddaughter is called Ana", [["Ana", "granddaughter"]]],
    ["my partner is called Sam", [["Sam", "partner"]]],
    ["my kids are called Leo and Max", [["Leo", "kid"], ["Max", "kid"]]],
    ["meus filhos se chamam Leo e Max", [["Leo", "filho"], ["Max", "filho"]]],
    ["mis hijos se llaman Leo y Max", [["Leo", "hijo"], ["Max", "hijo"]]],
    ["mi pareja se llama Ana", [["Ana", "pareja"]]],
    ["my grandfather is called Joe", [["Joe", "grandfather"]]],
    ["my grandmother is called Mary", [["Mary", "grandmother"]]],
    ["meu avô se chama João", [["João", "avô"]]],
    ["my father-in-law is called Bob", [["Bob", "father-in-law"]]],
    ["my mother-in-law is called Ana", [["Ana", "mother-in-law"]]],
    ["my brother-in-law is called Tom", [["Tom", "brother-in-law"]]],
    ["my sister-in-law is called Lia", [["Lia", "sister-in-law"]]],
    ["my son-in-law is called Rui", [["Rui", "son-in-law"]]],
    ["my daughter-in-law is called Sara", [["Sara", "daughter-in-law"]]],
    ["my godfather is called Pepe", [["Pepe", "godfather"]]],
    ["my godmother is called Rosa", [["Rosa", "godmother"]]],
    ["my grandpa is called Joe", [["Joe", "grandpa"]]],
    ["my grandma is called Mary", [["Mary", "grandma"]]],
    ["mi mejor amigo se llama Diego", [["Diego", "mejor amigo"]]],
    ["my best friend is called Sam", [["Sam", "best friend"]]],
    ["meu melhor amigo se chama Sam", [["Sam", "melhor amigo"]]],
    ["my nephew is called Tom", [["Tom", "nephew"]]],
    ["my uncle is called Bob", [["Bob", "uncle"]]],
    ["meu sobrinho se chama Leo", [["Leo", "sobrinho"]]],
  ];
  it.each(CASOS)("«%s» → %j", (t, esperado) => {
    expect(extractPeople(t).map((p) => [p.name, p.relationship])).toEqual(esperado);
  });
});

// ---------------------------------------------------------------- C
// El conteo (F-PC47): la serie 1–5 de hijos en los tres
// idiomas por la fila de conteo de DIET_ALLERGY_RES. La fila
// pt llegaba a três: quatro y cinco nacen en rojo.
describe("C · el conteo 1–5 (F-PC47)", () => {
  const CASOS = [
    "tengo un hijo", "tengo dos hijos", "tengo tres hijos", "tengo cuatro hijos", "tengo cinco hijos",
    "i have one kid", "i have two kids", "i have three kids", "i have four kids", "i have five kids",
    "tenho um filho", "tenho dois filhos", "tenho três filhos", "tenho quatro filhos", "tenho cinco filhos",
  ];
  it.each(CASOS)("«%s» → hecho implícito", (t) => {
    expect(extractImplicitFact(t)).not.toBeNull();
  });
});

// ---------------------------------------------------------------- D
// Las celdas de dieta del censo: los cinco tríos ejecutados
// (dieta, no-comer y estado) contra DIET_ALLERGY_RES. Rojos:
// pt hipertenso, pt asmático, en hypertensive, en
// asthmatic, pt pescetariano, pt açúcar y pt comprometido.
describe("D · celdas de dieta (censo de DIET_ALLERGY_RES)", () => {
  const CASOS = [
    "soy hipertenso", "sou hipertenso", "i am hypertensive",
    "soy asmático", "sou asmático", "i am asthmatic",
    "soy pescetariano", "sou pescetariano", "i am pescatarian",
    "no como azúcar", "eu não como açúcar", "i don't eat sugar",
    "estoy comprometido", "estou comprometido", "i'm engaged",
  ];
  it.each(CASOS)("«%s» → hecho implícito", (t) => {
    expect(extractImplicitFact(t)).not.toBeNull();
  });
});
