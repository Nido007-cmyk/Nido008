/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda 13 · A4: la batería de M-5 (la escalera en un único módulo
 * de producción) y de la sede de M-7 se cobra aquí en su mitad de
 * grafo; la mitad de modo de M-7 vive en grounding.judgeMode.test.ts.
 *
 * Casos de grafo: la escalera vive en src/routing/precedence.ts,
 * la importan el bucle (su sexto escalón, el único que su red de
 * salida consulta, a través del módulo) y el núcleo del examen
 * (deterministicAnswer delega en precedenceAnswer y ya no importa
 * los detectores), y el orden de escalones aparece en un solo
 * sitio de producción (censo por búsqueda sobre src/).
 *
 * Casos de empalme: los seis empalmes de precedencia por pares,
 * cada uno con un espécimen que dispara AMBOS escalones (la
 * batería lo prueba llamando a los detectores por separado) y la
 * ruta servida es la del escalón anterior. Los especímenes se
 * midieron contra los detectores reales antes de fijarse.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers.js";
import { crisisQuestionKind, emergencyQuestionKind } from "../rag/packFacts.js";
import { isFactualQuestion } from "../rag/grounding.js";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate.js";
import { precedenceAnswer } from "./precedence.js";

const SRC = join(process.cwd(), "src");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function ficherosProduccion(dir: string, base = ""): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const rel = base ? `${base}/${nombre}` : nombre;
    if (statSync(ruta).isDirectory()) salida.push(...ficherosProduccion(ruta, rel));
    else if (nombre.endsWith(".ts") && !nombre.endsWith(".test.ts")) salida.push(rel);
  }
  return salida;
}

describe("M-5 · el grafo de la escalera", () => {
  it("precedence.ts importa cada detector de su casa", () => {
    const fuente = leer("routing/precedence.ts");
    expect(fuente).toContain('import { matchSafetyAnswer } from "../agent/loop/safetyAnswers.js"');
    expect(fuente).toContain('from "../rag/packFacts.js"');
    expect(fuente).toContain("crisisQuestionKind");
    expect(fuente).toContain("emergencyQuestionKind");
    expect(fuente).toContain('import { isFactualQuestion } from "../rag/grounding.js"');
    expect(fuente).toContain('from "./emergencyGate.js"');
    expect(fuente).toContain("isEmergencySituation");
    expect(fuente).toContain("isHealthQuestion");
    expect(fuente).toContain("healthSafeText");
  });

  it("el orden de llamada de los escalones en precedenceAnswer es el firmado", () => {
    const fuente = leer("routing/precedence.ts");
    const cuerpo = fuente.slice(fuente.indexOf("export function precedenceAnswer"));
    const orden = [
      "matchSafetyAnswer(query, lang)",
      "emergencyQuestionKind(query)",
      "crisisQuestionKind(query)",
      "isEmergencySituation(query)",
      "isHealthQuestion(query)",
      "isFactualQuestion(query)",
    ].map((llamada) => cuerpo.indexOf(llamada));
    for (const pos of orden) expect(pos).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < orden.length; i++) expect(orden[i]).toBeGreaterThan(orden[i - 1]);
  });

  it("el núcleo del examen delega en la escalera y ya no importa los detectores", () => {
    const fuente = leer("eval/blindCore.ts");
    expect(fuente).toContain('from "../routing/precedence.js"');
    expect(fuente).toContain("precedenceAnswer(q.query, q.lang)");
    for (const nombre of [
      "matchSafetyAnswer",
      "emergencyQuestionKind",
      "crisisQuestionKind",
      "isEmergencySituation",
      "isHealthQuestion",
      "healthSafeText",
    ]) {
      expect(fuente).not.toContain(nombre);
    }
    // isFactualQuestion solo puede aparecer en prosa histórica, nunca importado.
    expect(fuente).not.toContain('import { isFactualQuestion }');
  });

  it("el bucle consulta el sexto escalón a través del módulo de la escalera", () => {
    const fuente = leer("agent/loop/agentLoop.ts");
    expect(fuente).toContain('import { isFactualQuestion } from "../../routing/precedence.js"');
    expect(fuente).not.toContain('import { isFactualQuestion } from "../../rag/grounding.js"');
  });

  it("censo: la composición de la escalera vive en un solo fichero de producción", () => {
    // Componer la escalera = importar los detectores de las cuatro
    // casas. emergencyGate.ts importa dos (número y crisis) como
    // señales de su puerta, nunca la cadena: no importa el detector
    // de hechos ni sirve la ruta de precedencia.
    const conLaEscalera = ficherosProduccion(SRC).filter((rel) => {
      const fuente = leer(rel);
      return (
        fuente.includes("matchSafetyAnswer") &&
        fuente.includes("emergencyQuestionKind") &&
        fuente.includes("crisisQuestionKind") &&
        fuente.includes("isFactualQuestion")
      );
    });
    expect(conLaEscalera).toEqual(["routing/precedence.ts"]);
  });
});

describe("M-5 · los seis empalmes de precedencia", () => {
  it("1>2 seguridad gana al número: el espécimen dispara ambos y sirve seguridad (es/en/pt)", () => {
    const casos: Array<[string, "es" | "en" | "pt"]> = [
      ["Mi hijo se está ahogando y no puede respirar, ¿cuál es el número de emergencias?", "es"],
      ["My son is choking and cannot breathe, what is the emergency number?", "en"],
      ["Meu filho está engasgando e não consegue respirar, qual é o número de emergência?", "pt"],
    ];
    for (const [q, lang] of casos) {
      expect(matchSafetyAnswer(q, lang)).not.toBeNull();
      expect(emergencyQuestionKind(q)).not.toBeNull();
      expect(precedenceAnswer(q, lang).route).toBe("safety");
    }
  });

  it("2>3 el número gana a crisis: ambos detectores de packFacts disparan y seguridad no (es/pt)", () => {
    const casos: Array<[string, "es" | "en" | "pt"]> = [
      ["¿A quién llamo para pedir auxilio? ¿Hay una línea de crisis?", "es"],
      ["Devo ligar para o 112 ou existe uma linha de crise?", "pt"],
    ];
    for (const [q, lang] of casos) {
      expect(matchSafetyAnswer(q, lang)).toBeNull();
      expect(emergencyQuestionKind(q)).not.toBeNull();
      expect(crisisQuestionKind(q)).toBe(true);
      expect(precedenceAnswer(q, lang).route).toBe("emergency-number");
    }
  });

  it("3>4 crisis gana a la situación viva (es/en/pt)", () => {
    const casos: Array<[string, "es" | "en" | "pt"]> = [
      ["¿Cuál es la línea de crisis? Hay humo saliendo de mi cocina", "es"],
      ["What is the crisis hotline? There is smoke coming from my kitchen", "en"],
      ["Qual é a linha de crise? Há fumaça saindo da minha cozinha", "pt"],
    ];
    for (const [q, lang] of casos) {
      expect(matchSafetyAnswer(q, lang)).toBeNull();
      expect(crisisQuestionKind(q)).toBe(true);
      expect(isEmergencySituation(q)).toBe(true);
      expect(precedenceAnswer(q, lang).route).toBe("crisis");
    }
  });

  it("4>5 la situación viva gana a la puerta de salud (es)", () => {
    const q = "Mi padre se agarra el pecho y dice que le duele el brazo izquierdo";
    expect(isEmergencySituation(q)).toBe(true);
    expect(isHealthQuestion(q)).toBe(true);
    expect(precedenceAnswer(q, "es").route).toBe("emergency-situation");
  });

  it("5>6 la puerta de salud gana al «no lo sé» de hechos (es/en)", () => {
    const casos: Array<[string, "es" | "en" | "pt"]> = [
      ["¿Qué es la diabetes y cómo se trata?", "es"],
      ["What is diabetes and how is it treated?", "en"],
    ];
    for (const [q, lang] of casos) {
      expect(isHealthQuestion(q)).toBe(true);
      expect(isFactualQuestion(q)).toBe(true);
      expect(precedenceAnswer(q, lang).route).toBe("health-gate");
    }
  });

  it("6>7 el «no lo sé» de hechos gana a la caída al modelo, y sin hechos se cae al modelo (es)", () => {
    const q = "¿Quién escribió Don Quijote?";
    expect(isFactualQuestion(q)).toBe(true);
    expect(precedenceAnswer(q, "es").route).toBe("factual-refusal");
    expect(precedenceAnswer("Cuéntame un cuento de un zorro", "es").route).toBe("model");
  });
});
