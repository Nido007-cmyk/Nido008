/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchBlind.test — la batería del instrumento del ciego
 * propio de E10: el sello recomputa sobre el conjunto tal como
 * está en disco, la composición del conjunto es la declarada y
 * el marcador cobra trampas y anclajes por su letra. La corrida
 * misma vive fuera de la suite (researchBlind.blind.ts, con su
 * configuración propia): esta batería no la corre ni la cobra.
 */
import { describe, it, expect } from "vitest";
import setJson from "./researchBlindSet.json" with { type: "json" };
import {
  RESEARCH_BLIND_SEAL,
  researchBlindSeal,
  servedAnchors,
  servedTraps,
  type ResearchBlindSet,
} from "./researchBlindCore.js";

const set = setJson as unknown as ResearchBlindSet;

describe("el conjunto ciego propio de E10: su sello y su composición", () => {
  it("el sello recomputa sobre el conjunto en disco", () => {
    expect(researchBlindSeal(set)).toBe(RESEARCH_BLIND_SEAL);
  });

  it("la composición declarada: seis casos, cada uno con su trampa o su suelo", () => {
    expect(set.set).toBe("research-blind-e10");
    expect(set.cases.map((c) => c.id)).toEqual(["rb-1", "rb-2", "rb-3", "rb-4", "rb-5", "rb-6"]);
    for (const c of set.cases) {
      // Cada caso planta al menos una trampa: un caso sin trampa
      // no mediría el listón.
      expect(c.traps.length, c.id).toBeGreaterThan(0);
      // Las pasadas guionadas casan con las subpreguntas.
      expect(c.passes.length, c.id).toBe(c.subQuestions.length);
      // Ninguna trampa vive en un fragmento del corpus: una
      // trampa con apoyo dejaría de ser una afirmación sin
      // fuente y el listón no mediría nada.
      for (const p of c.passes) {
        for (const ch of p.chunks) {
          for (const t of c.traps) {
            expect(ch.body.toLowerCase(), `${c.id}/${t}`).not.toContain(t.toLowerCase());
          }
        }
      }
    }
    // El caso sin fuentes es el suelo determinista: su única
    // pasada no recupera nada.
    const rb3 = set.cases.find((c) => c.id === "rb-3")!;
    expect(rb3.passes[0]!.chunks).toHaveLength(0);
  });

  it("el marcador cobra una trampa servida y deja pasar el texto limpio", () => {
    const rb1 = set.cases.find((c) => c.id === "rb-1")!;
    expect(servedTraps(rb1.synthesis.finalOnly, rb1.traps)).toEqual(["900 million", "year 312"]);
    expect(servedTraps(rb1.synthesis.full, rb1.traps)).toEqual([]);
    expect(servedAnchors(rb1.synthesis.full, rb1.supportedAnchors)).toEqual([
      "gentle downhill slope",
    ]);
    expect(servedAnchors("Unrelated text.", rb1.supportedAnchors)).toEqual([]);
  });
});
