/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda 13 · A4: la batería de M-7 — el campo judgeMode de
 * GroundingResult. El mismo espécimen juzgado en las dos ramas
 * marca "full" con un contexto semántico usable y "lexical" sin
 * él o con uno que usableSemanticContext no valida; la
 * abstención lleva la marca de su rama en las dos; y los caminos
 * de salto (respuesta vacía, sin fuentes, bloque de pensamiento)
 * marcan "lexical": el juez sale antes de validar contexto
 * alguno y ninguna puerta semántica actúa.
 *
 * El contexto hecho a mano sigue el patrón de
 * nucleoSemantico.test.ts: vectores en el plano xy alineados con
 * el troceo del propio juez (splitSentences + splitClausesWithSep).
 */
import { describe, expect, it } from "vitest";
import {
  splitClausesWithSep,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding.js";
import type { JudgeSemanticContext } from "./semanticContext.js";

const FECHA = new Date("2026-11-14T12:00:00Z");
const E1 = new Float32Array([1, 0, 0, 0]);

const GUIA_LLANTA_ES: GroundingChunk = {
  title: "Cambio de llanta",
  body: "Para cambiar una llanta, apaga el motor y pon el freno de mano en un sitio seguro y plano. Afloja las tuercas media vuelta antes de levantar el coche con el gato. Nunca te pongas debajo del coche apoyado solo en el gato. El par recomendado para las tuercas es de 120 newtons. La rueda de repuesto temporal se usa a un máximo de 80 km por hora. La asistencia en carretera responde en el 900-555-0134 y las emergencias en el 112. Esta guía fue revisada el 3 de octubre de 2023.",
};
const PREGUNTA_LLANTA = "¿Cómo cambio la llanta de un carro en la carretera?";
const RESPUESTA_FIEL = "Afloja las tuercas media vuelta antes de levantar el coche con el gato.";
const RESPUESTA_AJENA = "La capital de Francia es París y allí se encuentra la torre Eiffel.";

/** Contexto válido con todos los vectores alineados en E1 (coseno 1). */
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

describe("M-7 · judgeMode en las dos ramas con el mismo espécimen", () => {
  it("con contexto usable, el veredicto marca full", () => {
    const r = verifyGroundedAnswer(RESPUESTA_FIEL, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, ctxValido([GUIA_LLANTA_ES], RESPUESTA_FIEL));
    expect(r.judgeMode).toBe("full");
  });

  it("sin contexto, el mismo veredicto marca lexical", () => {
    const r = verifyGroundedAnswer(RESPUESTA_FIEL, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA);
    expect(r.judgeMode).toBe("lexical");
  });

  it("con un contexto que no valida (otro perfil), el veredicto marca lexical", () => {
    const malo: JudgeSemanticContext = { ...ctxValido([GUIA_LLANTA_ES], RESPUESTA_FIEL), profileId: "bge-small-en" };
    const r = verifyGroundedAnswer(RESPUESTA_FIEL, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, malo);
    expect(r.judgeMode).toBe("lexical");
  });

  it("la abstención con contexto usable marca full", () => {
    const r = verifyGroundedAnswer(RESPUESTA_AJENA, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA, ctxValido([GUIA_LLANTA_ES], RESPUESTA_AJENA));
    expect(r.status).toBe("abstained");
    expect(r.judgeMode).toBe("full");
  });

  it("la abstención sin contexto marca lexical", () => {
    const r = verifyGroundedAnswer(RESPUESTA_AJENA, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA);
    expect(r.status).toBe("abstained");
    expect(r.judgeMode).toBe("lexical");
  });
});

describe("M-7 · los caminos de salto también marcan", () => {
  it("respuesta vacía: skipped con lexical", () => {
    const r = verifyGroundedAnswer("   ", [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA);
    expect(r.status).toBe("skipped");
    expect(r.judgeMode).toBe("lexical");
  });

  it("sin fuentes: skipped con lexical", () => {
    const r = verifyGroundedAnswer(RESPUESTA_FIEL, [], "es", PREGUNTA_LLANTA, FECHA);
    expect(r.status).toBe("skipped");
    expect(r.judgeMode).toBe("lexical");
  });

  it("bloque de pensamiento: skipped con lexical", () => {
    const r = verifyGroundedAnswer(`<think>razono</think> ${RESPUESTA_FIEL}`, [GUIA_LLANTA_ES], "es", PREGUNTA_LLANTA, FECHA);
    expect(r.status).toBe("skipped");
    expect(r.judgeMode).toBe("lexical");
  });
});
