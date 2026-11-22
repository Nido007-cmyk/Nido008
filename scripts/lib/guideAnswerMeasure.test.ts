/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La costura de medición de J-10 (tanda 12) en guideAnswerRun: sin
 * `measure`, las anchuras con las que la vía llama a retrieve son
 * las constantes selladas (ANSWER_CONTEXT_CHUNKS para el contexto,
 * GUIDE_PICK_CHUNKS para el ensanche de la elección); con `measure`,
 * son las pedidas, y cada anchura cae a su constante si no se pide.
 * La equivalencia por defecto se fija aquí por las llamadas, no por
 * la palabra del arnés: es lo que hace que la re-derivación mida
 * sobre el camino real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "../../src/rag/retrieve.types.js";
import type { PackSourceDoc } from "../../src/rag/packSource.js";
import { BGE_SMALL_EN_PROFILE } from "../../src/rag/embeddingProfile.js";
import { ANSWER_CONTEXT_CHUNKS } from "../../src/rag/pure.js";
import { GUIDE_PICK_CHUNKS } from "../../src/rag/guidePickCandidates.js";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
const verifiedImportedPacksMock = vi.fn();
vi.mock("../../src/rag/retrieve.js", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => BGE_SMALL_EN_PROFILE,
}));
vi.mock("../../src/rag/packs.js", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));
vi.mock("../../src/services/packImporter.js", () => ({
  verifiedImportedPacks: (...a: unknown[]) => verifiedImportedPacksMock(...a),
}));

import { answerFromGuide } from "./guideAnswerMeasure.js";

const chunk = (id: string, title: string, body: string, rawScore?: number): RetrievedChunk =>
  ({ chunkId: id, docId: id, title, body, score: 1, rawScore, matchType: "semantic" }) as RetrievedChunk;

const DOC: PackSourceDoc = {
  title: "Dolor en el pecho",
  source: "https://example.org/fuente",
  parts: [
    { id: 1, body: "Qué hacer\n1. Llama de inmediato al número de emergencias.\n2. Sienta a la persona semirrecostada.", used: true },
    { id: 2, body: "Qué no hacer\nNo le des de comer ni de beber.", used: false },
  ],
};

const BEST = chunk("pack:nido-esencial:5", "Dolor en el pecho", "Llama de inmediato al número de emergencias.", 0.95);
const OTHER = chunk("pack:wiki-vital5:9", "Otra cosa", "Texto ajeno.", 0.8);

const topKs = () => retrieveMock.mock.calls.map((c) => c[1]);

describe("answerFromGuide · costura de medición de J-10", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifiedImportedPacksMock.mockResolvedValue(new Map());
  });

  it("sin measure: el contexto se pide con ANSWER_CONTEXT_CHUNKS", async () => {
    retrieveMock.mockResolvedValue([BEST]);
    readPackSourceMock.mockResolvedValue(DOC);
    const out = await answerFromGuide("dolor en el pecho", "es");
    expect(out.answer).not.toBeNull();
    expect(topKs()).toEqual([ANSWER_CONTEXT_CHUNKS]);
  });

  it("sin measure: el ensanche de la elección se pide con GUIDE_PICK_CHUNKS", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    const out = await answerFromGuide("qué es el corazón", "es");
    expect(out.answer).toBeNull();
    expect(topKs()).toEqual([ANSWER_CONTEXT_CHUNKS, GUIDE_PICK_CHUNKS]);
  });

  it("con measure entera: las dos anchuras son las pedidas", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    const out = await answerFromGuide("qué es el corazón", "es", undefined, { contextChunks: 8, pickChunks: 14 });
    expect(out.answer).toBeNull();
    expect(topKs()).toEqual([8, 14]);
  });

  it("con measure parcial: la anchura no pedida cae a su constante", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    const out = await answerFromGuide("qué es el corazón", "es", undefined, { contextChunks: 12 });
    expect(out.answer).toBeNull();
    expect(topKs()).toEqual([12, GUIDE_PICK_CHUNKS]);
  });
});
