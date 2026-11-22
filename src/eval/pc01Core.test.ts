/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * El instrumento de PC-01 (tanda 12 · J-10): la forma canónica y
 * el sello, el vocabulario cerrado de la construcción y las
 * cuatro claves hermanas, probadas sobre artefactos sintéticos.
 * El conjunto PC-01 en sí y su corrida son registros sellados
 * aparte (scripts/pc01Run01.ts), no casos de esta batería.
 */
import { describe, expect, it } from "vitest";
import {
  abstentionMeetsKey,
  canonicalPc01,
  closedVocabulary,
  fragmentSha256,
  pageMeetsKey,
  pc01Seal,
  receiptMeetsKey,
  sentenceMeetsKey,
  serveDraft,
  type Pc01CaseD,
  type Pc01CaseE,
  type Pc01Set,
} from "./pc01Core.js";
import type { GroundingResult } from "../rag/grounding.js";

const CHUNK = { chunkId: "pack:nido-esencial-e5:212", title: "Quemaduras", body: "Enfría la quemadura con agua corriente fresca (no helada) al menos 10 minutos, cuanto antes mejor." };

const miniSet = (): Pc01Set => ({
  version: "PC-01",
  A: [{ id: "a1", type: "salud", lang: "es", expected: "fixed-text", query: "¿Qué dosis le doy?" }],
  B: [
    {
      id: "b1",
      mechanism: "M1",
      lang: "es",
      question: "¿Cuánto enfrío una quemadura?",
      fixedChunks: [CHUNK],
      faithfulDraft: "Enfría la quemadura con agua corriente fresca al menos 10 minutos.",
      inventedDraft: "Enfría la quemadura con agua corriente fresca al menos 20 minutos.",
      faithfulSentence: "Enfría la quemadura con agua corriente fresca al menos 10 minutos.",
      inventedSentence: "Enfría la quemadura con agua corriente fresca al menos 20 minutos.",
      source: { packId: "nido-esencial-e5", guideTitle: "Quemaduras", section: "Pasos", fragment: CHUNK.body, sha256: fragmentSha256(CHUNK.body) },
      expectedLeg: "evidenceNumbers",
    },
  ],
  C: { paginationRule: "páginas de 1800 caracteres", pageSizeChars: 1800, document: "doc", map: [], cases: [] },
  D: [],
  E: [],
});

describe("pc01Core · sello y forma canónica", () => {
  it("el sello es determinista y sensible a una sola palabra", () => {
    const a = miniSet();
    const b = miniSet();
    expect(pc01Seal(a)).toBe(pc01Seal(b));
    b.B[0]!.inventedSentence = "Enfría la quemadura con agua corriente fresca al menos 21 minutos.";
    expect(pc01Seal(a)).not.toBe(pc01Seal(b));
    expect(canonicalPc01(a)).toContain("PC-01");
  });

  it("fragmentSha256 es el sha256 del texto", () => {
    expect(fragmentSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("pc01Core · vocabulario cerrado", () => {
  it("una frase hecha con palabras del fragmento pasa; una palabra ajena la rechaza", () => {
    expect(closedVocabulary("Enfría la quemadura con agua fresca durante minutos.", [CHUNK]).ok).toBe(true);
    const bad = closedVocabulary("Enfría la quemadura con agua fresca y cúbrela con una tirita adhesiva.", [CHUNK]);
    expect(bad.ok).toBe(false);
    expect(bad.foreign.length).toBeGreaterThan(0);
  });

  it("las cifras quedan fuera de la regla (la vecina de M1 no está en las fuentes por diseño)", () => {
    expect(closedVocabulary("Enfría la quemadura con agua corriente fresca al menos 20 minutos.", [CHUNK]).ok).toBe(true);
  });
});

describe("pc01Core · sentenceMeetsKey", () => {
  const faithful = "Enfría la quemadura con agua corriente fresca al menos 10 minutos. Después cúbrela sin apretar.";
  it("el fiel está intacto solo si todas sus frases llegan al texto servido", () => {
    expect(sentenceMeetsKey({ role: "fiel", draft: faithful, scoredSentence: "", servedText: faithful })).toBe(true);
    expect(
      sentenceMeetsKey({ role: "fiel", draft: faithful, scoredSentence: "", servedText: "Enfría la quemadura con agua corriente fresca al menos 10 minutos." }),
    ).toBe(false);
  });

  it("la invención está cazada solo si su frase no llega al texto servido", () => {
    const invented = "Enfría la quemadura con agua corriente fresca al menos 20 minutos.";
    expect(sentenceMeetsKey({ role: "inventada", draft: "", scoredSentence: invented, servedText: faithful })).toBe(true);
    expect(sentenceMeetsKey({ role: "inventada", draft: "", scoredSentence: invented, servedText: invented })).toBe(false);
  });
});

describe("pc01Core · pageMeetsKey y receiptMeetsKey", () => {
  it("pageMeetsKey: la página de la clave, ninguna inventada; la ausencia cita ninguna", () => {
    expect(pageMeetsKey({ keyPage: 7, citedPage: 7, inventedPages: 0 })).toBe(true);
    expect(pageMeetsKey({ keyPage: 7, citedPage: 5, inventedPages: 0 })).toBe(false);
    expect(pageMeetsKey({ keyPage: null, citedPage: null, inventedPages: 0 })).toBe(true);
    expect(pageMeetsKey({ keyPage: null, citedPage: 3, inventedPages: 0 })).toBe(false);
    expect(pageMeetsKey({ keyPage: 7, citedPage: 7, inventedPages: 1 })).toBe(false);
  });

  const caseD: Pc01CaseD = {
    id: "d1",
    lang: "es",
    question: "¿Qué hago?",
    subQuestions: [
      { text: "s1", source: { packId: "p", guideTitle: "g", section: "s", fragment: "f", sha256: "x" } },
      { text: "s2", source: { packId: "p", guideTitle: "g", section: "s", fragment: "f", sha256: "x" } },
    ],
    gap: { text: "hueco", absence: { nearest: [], lexicalContentHits: 0, floors: "pisos" } },
  };

  it("receiptMeetsKey: los tres pisos no se compensan y un señuelo rellenado fracasa el caso", () => {
    expect(receiptMeetsKey(caseD, { coveredSubQuestions: [true, true], receiptValidByClaim: [true], gapDeclared: true }).whole).toBe(true);
    expect(receiptMeetsKey(caseD, { coveredSubQuestions: [true, false], receiptValidByClaim: [true], gapDeclared: true }).whole).toBe(false);
    expect(receiptMeetsKey(caseD, { coveredSubQuestions: [true, true], receiptValidByClaim: [false], gapDeclared: true }).whole).toBe(false);
    const filled = receiptMeetsKey(caseD, { coveredSubQuestions: [true, true], receiptValidByClaim: [true], gapDeclared: false });
    expect(filled.gaps).toBe(false);
    expect(filled.whole).toBe(false);
  });
});

describe("pc01Core · abstentionMeetsKey y el ejecutor de artefactos", () => {
  const noSource: Pc01CaseE = {
    id: "e1",
    kind: "sin-fuente",
    lang: "es",
    question: "¿Cómo se trata la migraña con aura?",
    fixedChunks: [],
    draft: "La migraña con aura se trata con ibuprofeno y reposo en silencio.",
    absence: { nearest: [], lexicalContentHits: 0, floors: "pisos" },
    source: null,
    goodSentences: null,
    inventedSentences: null,
  };

  it("sin fragmentos, el ejecutor sirve la abstención honesta y la clave la cobra entera", () => {
    const served = serveDraft(noSource.draft, [], "es", noSource.question);
    expect(served.status).toBe("abstained");
    expect(abstentionMeetsKey(noSource, served).whole).toBe(true);
  });

  it("si el borrador llegara servido, la clave lo rechaza", () => {
    const served: GroundingResult = { text: noSource.draft, status: "grounded", removed: 0, kept: 1, judgeMode: "lexical" };
    expect(abstentionMeetsKey(noSource, served).whole).toBe(false);
  });

  it("parcial: la mitad buena servida y la inventada ausente; cada mitad por la suya", () => {
    const partial: Pc01CaseE = {
      ...noSource,
      id: "e2",
      kind: "parcial",
      goodSentences: ["Enfría la quemadura con agua corriente fresca al menos 10 minutos."],
      inventedSentences: ["Aplica la pomada antibiótica CuraBurn tres veces al día."],
    };
    const goodServed: GroundingResult = {
      text: "Enfría la quemadura con agua corriente fresca al menos 10 minutos.",
      status: "partial",
      removed: 1,
      kept: 1,
      judgeMode: "lexical",
    };
    expect(abstentionMeetsKey(partial, goodServed)).toEqual({ firstHalf: true, secondHalf: true, whole: true });
    const badServed: GroundingResult = { text: `${partial.goodSentences![0]} ${partial.inventedSentences![0]}`, status: "grounded", removed: 0, kept: 2, judgeMode: "lexical" };
    expect(abstentionMeetsKey(partial, badServed).whole).toBe(false);
  });

  it("con fragmentos, el ejecutor es el juez: un extracto fiel sobrevive", () => {
    const served = serveDraft(CHUNK.body, [CHUNK], "es", "¿Cuánto tiempo enfrío una quemadura?");
    expect(served.text).toContain("al menos 10 minutos");
  });
});
