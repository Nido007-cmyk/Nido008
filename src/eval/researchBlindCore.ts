/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchBlindCore — el conjunto ciego propio de E10 y su clave.
 *
 * Nace sellado como los conjuntos de los exámenes: el conjunto y
 * la clave viven en ficheros separados (`researchBlindSet.json`
 * lleva las preguntas, los materiales guionados y las trampas;
 * este núcleo lleva el sello y el marcador), y la corrida
 * (`researchBlind.blind.ts`, fuera de la suite) se niega a correr
 * si el sello no recomputa.
 *
 * El listón es el de la hoja de la etapa (S-2): CERO afirmaciones
 * sin fuente servidas en el informe final, cobrado por brazo y
 * por caso, sin compensación. Una afirmación sin fuente «servida»
 * es, para este instrumento, una trampa del conjunto presente en
 * el texto final: las trampas se plantaron a mano en las
 * subrespuestas, en la síntesis o en ambas, y cada una es una
 * afirmación que ningún fragmento del corpus sostiene.
 *
 * El conjunto no cobra ninguna barra de ningún examen sellado
 * (no es PC-01, ni su bloque D) y no suma a la suite: su corrida
 * vive en su propia configuración de vitest.
 */
import { createHash } from "node:crypto";

export interface ResearchBlindChunk {
  chunkId: string;
  title: string;
  body: string;
}

export interface ResearchBlindPass {
  chunks: ResearchBlindChunk[];
  answer: string;
}

export interface ResearchBlindCase {
  id: string;
  lang: "en" | "es" | "pt";
  question: string;
  subQuestions: string[];
  passes: ResearchBlindPass[];
  synthesis: { full: string; finalOnly: string };
  traps: string[];
  supportedAnchors: string[];
}

export interface ResearchBlindSet {
  set: string;
  version: number;
  bar: string;
  cases: ResearchBlindCase[];
}

/**
 * El sello del conjunto tal como se selló al nacer (sha256 sobre
 * la forma canónica de sus casos). Si el conjunto cambia, el
 * sello deja de recomputar y la corrida se niega: un cambio del
 * conjunto es un asiento nuevo, nunca una edición silenciosa.
 */
export const RESEARCH_BLIND_SEAL =
  "dbaa1735c6679202de44e3e26b8310c2e81626f164d97d360124ad12b2495ab2";

function canonicalCases(set: ResearchBlindSet): string {
  return JSON.stringify(
    set.cases.map((c) => ({
      id: c.id,
      lang: c.lang,
      question: c.question,
      subQuestions: c.subQuestions,
      passes: c.passes.map((p) => ({
        chunks: p.chunks.map((ch) => ({ chunkId: ch.chunkId, title: ch.title, body: ch.body })),
        answer: p.answer,
      })),
      synthesis: c.synthesis,
      traps: c.traps,
      supportedAnchors: c.supportedAnchors,
    })),
  );
}

export function researchBlindSeal(set: ResearchBlindSet): string {
  return createHash("sha256").update(canonicalCases(set), "utf8").digest("hex");
}

/** Las trampas de un caso presentes en el texto servido. */
export function servedTraps(answer: string, traps: string[]): string[] {
  const haystack = answer.toLowerCase();
  return traps.filter((t) => haystack.includes(t.toLowerCase()));
}

/** Los anclajes con apoyo de un caso presentes en el texto servido. */
export function servedAnchors(answer: string, anchors: string[]): string[] {
  const haystack = answer.toLowerCase();
  return anchors.filter((a) => haystack.includes(a.toLowerCase()));
}
