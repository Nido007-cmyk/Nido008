/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación v2 (plan profesional, E2). Los casos viven en cases/v2.json.
 *
 * - runner "ci-router" / "ci-safety": se comprueban en cada PR, sin modelo
 *   (evalV2.deterministic.test.ts).
 * - "pack-retrieval+device": la guía correcta se encuentra con el modelo de
 *   embeddings (knowledge-pack.yml) y se muestra tal cual en el teléfono.
 * - "device": solo en el teléfono (pendiente: que la evaluación del teléfono
 *   pase por el mismo camino que el chat).
 *
 * Recreación de PC (E3, tanda 12 · J-10): réplica fiel del cargador de
 * la fuente 0.1.108 (68 líneas: tipos y carga del JSON, nada más; el
 * arnés de medición de la re-derivación nace en esta tanda y vive
 * fuera de este fichero). La fixture se consume sellada: su huella
 * sha256 es 37904546221a62164629aa6bed05e4641d731cab777b7d78ce3bc0d7b59339a0
 * y su censo (118 casos, version 2, reparto device 53 / ci-router 27 /
 * ci-safety 20 / pack-retrieval+device 18) lo guarda su batería. La
 * única adaptación es la forma del import del JSON, la de la casa en
 * PC (atributo `with { type: "json" }`, sin resolveJsonModule).
 */
import cases from "./cases/v2.json" with { type: "json" };

export type EvalGroupV2 =
  | "first-aid"
  | "emergency-number"
  | "safety"
  | "tools"
  | "smalltalk"
  | "honesty"
  | "utility"
  | "attack"
  | "legacy-v1";

export type EvalRunnerV2 = "ci-router" | "ci-safety" | "pack-retrieval+device" | "device";

export interface EvalExpectV2 {
  /** smalltalk | calc | timer | reminder | tool:<kind> | safety:<kind> | guide:<inicio de título> | pack-fact | model | none | none-tool */
  route?: string;
  /** Se comparan sin tildes ni mayúsculas. */
  mustContain?: string[];
  mustNotContain?: string[];
  idk?: boolean;
  verbatimGuide?: boolean;
  noAction?: boolean;
  confirmation?: boolean;
  country?: string;
  countryUnknownAsked?: boolean;
  region?: string;
  repeat?: string;
  /** Texto que debe capturar la acción (p. ej. el mensaje de nidoSend). */
  text?: string;
  gradingNotes?: string;
}

export interface EvalCaseV2 {
  id: string;
  group: EvalGroupV2;
  lang: "es" | "en" | "pt";
  runner: EvalRunnerV2;
  query: string;
  precondition?: string;
  expect: EvalExpectV2;
  notes?: string;
}

export const EVAL_SET_V2_VERSION = (cases as { version: string }).version;
export const EVAL_SET_V2: EvalCaseV2[] = (cases as { cases: EvalCaseV2[] }).cases;

/** Compara sin tildes ni mayúsculas. */
export function foldForEval(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
