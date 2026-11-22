/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La escalera de precedencia determinista de la app, en su único
 * sitio de producción (M-5 de la auditoría maestra, cobrado en la
 * tanda 13). Hasta esta tanda la cadena vivía escrita solo dentro
 * del núcleo del examen ciego (src/eval/blindCore.ts): el examen
 * medía una precedencia que el código servido no heredaba por
 * construcción, y nada obligaba a que la medida y la servida
 * fueran la misma. La cadena se mueve aquí tal cual — mismos
 * detectores, mismo orden, mismos textos — y el núcleo del examen
 * la consume desde esta casa; el bucle la importa también (su red
 * de salida consulta el sexto escalón a través de este módulo).
 *
 * El orden, que es el de la app y el de la tabla fija del dueño:
 * 1. respuestas de seguridad (matchSafetyAnswer; dentro de esa
 *    pieza manda su propio orden: autolesión primero, antes del
 *    tope de longitud, y el número de emergencias al final);
 * 2. ruta del número de emergencias (emergencyQuestionKind);
 * 3. ruta de crisis (crisisQuestionKind);
 * 4. situación de emergencia viva (isEmergencySituation), que
 *    sirve el texto seguro fijo;
 * 5. puerta léxica de salud (isHealthQuestion), que sirve el
 *    mismo texto seguro fijo;
 * 6. el «no lo sé» de hechos (isFactualQuestion);
 * 7. si nada dispara, la ruta del modelo.
 *
 * En la condición «sin packs» no hay recuperación en esta capa:
 * la ruta de guías no vive aquí (ver src/eval/blindSet.ts).
 */
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers.js";
import { crisisQuestionKind, emergencyQuestionKind } from "../rag/packFacts.js";
import { isFactualQuestion } from "../rag/grounding.js";
import { healthSafeText, isEmergencySituation, isHealthQuestion } from "./emergencyGate.js";

export type PrecedenceLang = "es" | "en" | "pt";

export type PrecedenceRoute =
  | "safety"
  | "emergency-number"
  | "crisis"
  | "emergency-situation"
  | "health-gate"
  | "factual-refusal"
  | "model";

export interface PrecedenceResult {
  route: PrecedenceRoute;
  /** La clase del escalón que disparó, cuando la pieza la da (seguridad, número). */
  kind?: string;
  /** El texto fijo servido, cuando el escalón sirve uno (seguridad, situación, salud). */
  text?: string;
}

/**
 * El sexto escalón, re-exportado desde su casa en la escalera: la
 * red de salida del bucle lo consulta a través de este módulo, de
 * modo que un cambio del detector de hechos llega al bucle por
 * construcción y no por una segunda importación paralela.
 */
export { isFactualQuestion };

/** La capa determinista, con la precedencia de la app. Pura. */
export function precedenceAnswer(query: string, lang: PrecedenceLang): PrecedenceResult {
  const safety = matchSafetyAnswer(query, lang);
  if (safety) return { route: "safety", kind: safety.kind, text: safety.text };
  const numberKind = emergencyQuestionKind(query);
  if (numberKind) return { route: "emergency-number", kind: numberKind };
  if (crisisQuestionKind(query)) return { route: "crisis" };
  if (isEmergencySituation(query)) return { route: "emergency-situation", text: healthSafeText(lang) };
  if (isHealthQuestion(query)) return { route: "health-gate", text: healthSafeText(lang) };
  if (isFactualQuestion(query)) return { route: "factual-refusal" };
  return { route: "model" };
}
