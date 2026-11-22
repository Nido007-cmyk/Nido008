/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { llamaEngine } from "../inference/LlamaEngine.js";
import { withBoundedRepair } from "../agent/loop/structuredOutput.js";
import { retrieve, assemblePrompt, RetrievedChunk, ConversationHistory } from "../rag/retrieve.js";
import { assembleChatMessages } from "../rag/pure.js";
import { gatePreemptsDeepResearch, type GateLang } from "../routing/emergencyGate.js";
import { splitSentences, verifyGroundedAnswer, type GroundingChunk } from "../rag/grounding.js";
import { buildJudgeSemanticContext } from "../rag/semanticContext.js";
import {
  currentResearchClass,
  measuredRate,
  recordMeasuredRate,
  researchBudget,
  stageTimeoutMs,
  type ResearchBudget,
} from "./researchBudgets.js";
import {
  contentTermsOf,
  currentRateForEstimate,
  estimatePlanCost,
  planCoverage,
  researchScopeCounts,
  type ResearchPlan,
} from "./researchPlan.js";
import { buildResearchReceipt, type ResearchReceipt } from "./researchReport.js";
import type { RetrievalScope } from "../rag/retrieve.js";

/**
 * "Deep Research Mode" — a sequential multi-pass pipeline over the SAME
 * single loaded model, not literally multiple specialist models running
 * concurrently. Three frontier-agent-inspired ideas (running 3 models at
 * once, a planner model, a critic model) genuinely don't fit in the 12GB
 * RAM budget alongside everything else this app already loads — so this
 * decomposes the request into sequential llama.cpp calls on one context
 * instead: decompose -> research each sub-question (with its own
 * retrieval pass) -> synthesize. Slower than the normal single-pass chat
 * (several LLM calls instead of one), not "multiple AI agents." The UI
 * badge for this mode says "Deep Research (multi-pass)", not "multi-agent",
 * to avoid overclaiming what's actually happening.
 */

export type ResearchStage = "decomposing" | "researching" | "synthesizing";

export interface ResearchProgress {
  stage: ResearchStage;
  subQuestionIndex?: number;
  subQuestionCount?: number;
}

/**
 * E10 (paso 6): la foto de una sesión de investigación al
 * cerrar una etapa — lo que el almacén de sesiones guarda y
 * lo que la reanudación restaura. Las etapas son: el plan
 * (descomposición fijada y segunda red pasada), las pasadas
 * (cada una cerrada con su subrespuesta juzgada y sus
 * fragmentos), el contraste (con su ronda de huecos) y el
 * cierre (la corrida entera). La foto nunca se toma a mitad
 * de una etapa: lo que no cerró, no está.
 */
export interface ResearchSessionSnapshot {
  stage: "plan" | "passes" | "contrast" | "done";
  subQuestions: string[];
  passes: { result: ResearchSubResult; chunks: RetrievedChunk[] }[];
  contrast?: ResearchContrast | null;
  gapRoundUsed?: boolean;
}

export interface ResearchResult {
  answer: string;
  subQuestions: string[];
  citations: RetrievedChunk[];
  /**
   * E10 (paso 6): la corrida se detuvo a petición de la
   * persona entre etapas. Con sesión activa, el trabajo
   * cerrado queda guardado y la corrida se reanuda desde la
   * última etapa cerrada; sin sesión, es el retorno parcial
   * de siempre.
   */
  stopped?: boolean;
  /** True if any stage hit its derived stage ceiling and was cut off early. */
  timedOut?: boolean;
  /**
   * Honest no-result signal (2026-09-28): true when every sub-question's
   * retrieval pass returned zero chunks. The UI renders a deterministic
   * note; the synthesis prompt also gets nudged via researchSubQuestion.
   */
  noSourcesFound?: boolean;
  /**
   * R-07 second net: true when the emergency/health gate fired on the
   * original question or on a decomposed sub-question AFTER decompose
   * ran. The pipeline is abandoned before any research pass and the UI
   * serves the turn through the protected route instead (guide
   * verbatim / fixed path with its gates). `answer` is empty.
   */
  emergencyIntercepted?: boolean;
  /**
   * E10 (paso 2): los conteos de los jueces de la corrida (por
   * pasada y el final), con el tiempo del juez medido. Ausente en
   * los retornos tempranos que no juzgan nada: el interceptado por
   * la segunda red y el suelo determinista sin fuentes.
   */
  judge?: ResearchJudgeCounts;
  /**
   * E10 (paso 3): las cifras de la corrida por etapa (tiempo y
   * tokens de respuesta contados por el motor cuando puede
   * contarlos; en los arneses guionados los tokens leen 0 y el
   * tiempo es el de las llamadas). Es la materia del recibo de
   * corrida y del documento de presupuestos.
   */
  stats?: ResearchRunStats;
  /**
   * E10 (paso 4): el plan tal como se ejecutó, con el estado
   * de cada subpregunta (cubierta, hueco, o caída por el
   * juez). Presente cuando la corrida corre con plan visible
   * (la opción de contraste del flujo de la superficie).
   */
  executedPlan?: ExecutedPlanEntry[];
  /** E10 (paso 4): la salida de la pasada de contraste, cuando corrió. */
  contrast?: ResearchContrast;
  /**
   * E10 (paso 4): los huecos que la investigación declara sin
   * cubrir (sin fuentes, o no cubribles tras la ronda única).
   * El informe los declara; no los rellena.
   */
  gapsDeclared?: string[];
  /** E10 (paso 4): true cuando la ronda única de huecos corrió. */
  gapRoundUsed?: boolean;
  /**
   * E10 (paso 5): las subrespuestas juzgadas de la corrida, en
   * su orden: la materia del recibo de corrida y de las formas
   * del informe. Presente en el retorno de síntesis.
   */
  subResults?: ResearchSubResult[];
  /** E10 (paso 5): los ids de fragmento de cada pasada, en su orden. */
  passChunkIds?: string[][];
  /** E10 (paso 5): el estilo con el que la síntesis se redactó. */
  style?: ResearchStyle;
  /**
   * E10 (paso 5): los dos recibos de la corrida (por afirmación
   * y de corrida), como datos: la superficie navega el de
   * afirmaciones y el documento guardado lleva los dos.
   */
  receipt?: ResearchReceipt;
}

/**
 * E10 (paso 5): los cuatro estilos de informe sobre el mismo
 * material juzgado. El estilo cambia la forma, nunca lo
 * afirmado ni sus citas: la síntesis recibe la estructura del
 * estilo y las formas de lectura se componen desde las mismas
 * frases citadas (researchReport.ts).
 */
export type ResearchStyle = "completo" | "ejecutivo" | "comparativo" | "cronologico";

/** Una etapa de la corrida, con su tiempo y sus tokens generados. */
export interface ResearchStageStat {
  stage: "decompose" | "pass" | "contrast" | "synthesis";
  ms: number;
  tokens: number;
}

export interface ResearchRunStats {
  stages: ResearchStageStat[];
  totalTokens: number;
  /** La tasa vigente al cerrar (medida en la corrida o la de reserva). */
  rateTokPerSec: number;
}

/**
 * One sub-question's research output, paired with how many local source
 * chunks its retrieval pass actually found. The count travels with the
 * answer so the final synthesis can tell sourced perspectives apart from
 * ones the model generated with no local sources at all (D/F5).
 */
export interface ResearchSubResult {
  subQuestion: string;
  answer: string;
  sourceCount: number;
  /**
   * E10 (paso 2): el veredicto del juez por pasada sobre esta
   * subrespuesta, contra sus propios fragmentos. Cuando el pipeline
   * corre, toda subrespuesta entra en la síntesis juzgada y con su
   * veredicto, que sustituye a la etiqueta de conteo [fuentes: n]
   * como cabecera de la perspectiva. Los constructores puros del
   * prompt (buildSynthesisPrompt/buildSynthesisMessages) aceptan
   * subresultados sin veredicto y conservan entonces la etiqueta
   * de conteo: el formateador imprime lo que recibe, y es el
   * pipeline quien siempre entrega veredictos.
   */
  verdict?: ResearchVerdict;
}

/**
 * El veredicto de una pasada juzgada: con apoyo (ninguna frase
 * retirada), parcial (con su conteo de conservadas y retiradas) o
 * sin fuentes (la pasada no recuperó fragmentos y no hubo nada
 * que juzgar). Es el resultado de una verificación real del juez
 * de la casa con sus umbrales sellados, no un conteo de
 * recuperación.
 */
export interface ResearchVerdict {
  status: "supported" | "partial" | "no-sources";
  kept: number;
  removed: number;
}

/**
 * Los conteos que los jueces de la corrida dejan asentados (el
 * material del recibo): por pasada, las frases conservadas y
 * retiradas; al final, las del informe entero contra la unión de
 * fragmentos citados; y el tiempo total que el juez costó en la
 * corrida, medido, para la expectativa de coste de la partida
 * O-07.
 */
export interface ResearchJudgeCounts {
  perPass: { kept: number; removed: number }[];
  finalKept: number;
  finalRemoved: number;
  judgeMs: number;
}

/**
 * E10 (paso 4): la salida estructurada de la pasada de
 * contraste — conflictos entre perspectivas, afirmaciones
 * duplicadas y huecos contra el plan, con la subpregunta
 * propuesta para cada hueco cubrible. No es prosa para la
 * persona: la consume la síntesis y la ronda de huecos.
 */
export interface ResearchContrast {
  conflicts: { perspectives: number[]; note: string }[];
  duplicates: { perspectives: number[]; note: string }[];
  gaps: { topic: string; question: string }[];
  /** True cuando la pasada no produjo salida válida: se declara, no se disimula. */
  failed?: boolean;
}

/** El estado de una subpregunta ejecutada, para el recibo del plan. */
export type PlanEntryState = "covered" | "gap" | "judge-fallen";

/** Una subpregunta del plan tal como la corrida la dejó. */
export interface ExecutedPlanEntry {
  subQuestion: string;
  sourceCount: number;
  state: PlanEntryState;
}

/**
 * Deterministic honest answer for the all-zero-evidence case (D/F5): every
 * sub-question's retrieval pass returned nothing, so there is no sourced
 * research to synthesize. Returning this instead of calling the synthesis
 * LLM guarantees the model is never invited to fabricate a "well-reasoned,
 * cited" answer from empty perspectives.
 *
 * R-07: localized es/en/pt like the chat route's fixed texts — before,
 * this honest floor existed ONLY in English, so a Spanish-speaking user
 * in Deep Research got an English dead end. Same structure in the three
 * languages (parity is counted in the tests), no citation markers.
 */
const NO_SOURCES_RESEARCH_ANSWER: Record<GateLang, string> = {
  en:
    "I couldn't find any relevant sources in the offline index, so I can't " +
    "produce a sourced research answer for this question. You can import " +
    "relevant documents into the knowledge base, or try rephrasing the question.",
  es:
    "No encontré ninguna fuente relevante en el índice sin conexión, así que no puedo " +
    "producir una respuesta de investigación con fuentes para esta pregunta. Puedes importar " +
    "documentos relevantes a la base de conocimiento, o intentar reformular la pregunta.",
  pt:
    "Não encontrei nenhuma fonte relevante no índice offline, por isso não posso " +
    "produzir uma resposta de pesquisa com fontes para esta pergunta. Pode importar " +
    "documentos relevantes para a base de conhecimento, ou tentar reformular a pergunta.",
};

export function noSourcesResearchAnswer(lang: GateLang = "en"): string {
  return NO_SOURCES_RESEARCH_ANSWER[lang];
}

/**
 * Structural citation renumbering (R2): rewrite perspective-relative
 * citations [1..k] of ONE sub-question's research answer into global
 * offsets across the concatenated footnote list the UI renders
 * (SourceFootnotes numbers chips i+1 over allChunks, in sub-question
 * order). Citations outside 1..perspectiveChunkCount are left untouched —
 * they are either invented (stripped later by cleanCitations, which keeps
 * only 1..allChunks.length) or belong to another namespace entirely.
 *
 * This is structural, not a prompt nudge: the synthesis LLM never sees a
 * perspective-relative citation, so it cannot emit a "[1]" that mislinks
 * to another perspective's chunk. Offsets come from each perspective's
 * sourceCount (=== its retrieval pass's chunk count), computed
 * deterministically in buildSynthesisPrompt — the model does no
 * renumbering at all.
 */
export function renumberPerspectiveCitations(
  answer: string,
  globalOffset: number,
  perspectiveChunkCount: number
): string {
  if (globalOffset === 0 || perspectiveChunkCount <= 0) return answer;
  return answer.replace(/\[(\d+)\]/g, (match, digits) => {
    const n = Number(digits);
    return n >= 1 && n <= perspectiveChunkCount ? `[${globalOffset + n}]` : match;
  });
}

/**
 * Pure prompt builder for the final synthesis (D/F5, R2). Each perspective
 * is labeled with its own retrieval result so the model cannot mistake
 * general-knowledge prose for sourced research:
 * - a perspective that had sources keeps its citations — RESTRUCTURED by
 *   renumberPerspectiveCitations into GLOBAL offsets across the
 *   concatenated footnote list, cited ONLY for claims it itself sourced —
 *   citation numbers are never to be invented or renumbered by the model;
 * - a perspective marked [sources: none] must never be presented as backed
 *   by local sources.
 * When NO perspective has sources, the citation framing is omitted entirely
 * (an empty "cite sources" instruction is exactly the dangling framing that
 * nudges a small model toward inventing content to fill it).
 */
/**
 * Fixed scaffolding of the synthesis, per UI language (R-07): before,
 * every string here was hard English, so with the interface in Spanish
 * the synthesis was steered in English and answered in English. The
 * English texts are the originals, unchanged; es/pt carry the same
 * instructions with an explicit answer-language order, following the
 * chat route's pattern of localized fixed texts.
 */
const SYNTH_TEXT: Record<
  GateLang,
  {
    fallbackSystem: string;
    synthesizing: string;
    perspective: (n: number, subQuestion: string) => string;
    sourcesTag: (n: number) => string;
    noSourcesTag: string;
    verdictTag: (v: ResearchVerdict, n: number) => string;
    citationInstruction: string;
    noCitationInstruction: string;
    originalQuestion: string;
    closing: string;
    answerLabel: string;
    /** E10 (paso 4): el bloque de contraste y huecos declarados para la síntesis. */
    contrastBlock: (contrast: ResearchContrast | null, gaps: string[]) => string;
    /** E10 (paso 5): la estructura del estilo de informe (vacía en Completo). */
    styleInstruction: Record<ResearchStyle, string>;
  }
> = {
  en: {
    fallbackSystem: "You are an offline research assistant.",
    synthesizing: " You are synthesizing multiple research perspectives into one answer.",
    perspective: (n, subQuestion) => `Perspective ${n} (${subQuestion})`,
    sourcesTag: (n) => `[sources: ${n}]`,
    noSourcesTag: `[sources: none — generated without local sources]`,
    verdictTag: (v, n) =>
      v.status === "no-sources"
        ? `[judged: sources: none — generated without local sources]`
        : v.status === "supported"
          ? `[judged: supported — sources: ${n}]`
          : `[judged: partial — ${v.kept} kept, ${v.removed} removed — sources: ${n}]`,
    citationInstruction:
      ` Cite sources as [n] ONLY for claims that a perspective itself ` +
      `sourced — copy each citation number exactly as it appears in that ` +
      `perspective (citation numbers are already global across all ` +
      `perspectives): never invent citation numbers and never renumber ` +
      `them. A perspective ` +
      `whose mark says sources: none was generated without any local sources: ` +
      `never present its claims as backed by local sources; attribute them ` +
      `to general knowledge, or say the local index had nothing on that part.`,
    noCitationInstruction:
      ` No perspective had any local sources, so write the answer without ` +
      `citations and without implying that local sources support it.`,
    originalQuestion: "Original question:",
    closing:
      `Compare these perspectives, reconcile any conflicts, and write one unified, ` +
      `well-reasoned answer.`,
    answerLabel: "Answer:",
    contrastBlock: (contrast, gaps) => {
      const lines: string[] = [];
      if (contrast && !contrast.failed) {
        for (const c of contrast.conflicts) {
          lines.push(`- Conflict between perspectives ${c.perspectives.join(" and ")}: ${c.note} Present both sides; do not silently pick one.`);
        }
        for (const d of contrast.duplicates) {
          lines.push(`- Duplicate claim in perspectives ${d.perspectives.join(" and ")}: ${d.note} State it once.`);
        }
      }
      if (gaps.length > 0) {
        lines.push(`Declared gaps — the local sources did not cover these; say so plainly in the report and do not fill them:`);
        for (const g of gaps) lines.push(`- ${g}`);
      }
      return lines.length > 0 ? `\n\nContrast findings:\n${lines.join("\n")}` : "";
    },
    styleInstruction: {
      completo: "",
      ejecutivo:
        ` Structure the report as an executive brief: the direct answer first in a few lines, ` +
        `then the strongest supports with their citations, then what the local sources do not cover.`,
      comparativo:
        ` Structure the report as a comparison: lay out each perspective's position with the ` +
        `citation for each claim, then where the perspectives agree, then where they contradict each other.`,
      cronologico:
        ` Structure the report as a timeline: the dated facts in chronological order, each with ` +
        `its citation, then the parts of the timeline the sources leave open.`,
    },
  },
  es: {
    fallbackSystem: "Eres un asistente de investigación sin conexión.",
    synthesizing: " Estás sintetizando varias perspectivas de investigación en una sola respuesta.",
    perspective: (n, subQuestion) => `Perspectiva ${n} (${subQuestion})`,
    sourcesTag: (n) => `[fuentes: ${n}]`,
    noSourcesTag: `[fuentes: ninguna — generada sin fuentes locales]`,
    verdictTag: (v, n) =>
      v.status === "no-sources"
        ? `[juzgado: fuentes: ninguna — generada sin fuentes locales]`
        : v.status === "supported"
          ? `[juzgado: con apoyo — fuentes: ${n}]`
          : `[juzgado: parcial — ${v.kept} conservadas, ${v.removed} retiradas — fuentes: ${n}]`,
    citationInstruction:
      ` Cita las fuentes como [n] SOLO para las afirmaciones que una perspectiva ` +
      `haya respaldado ella misma con fuentes — copia cada número de cita exactamente ` +
      `como aparece en esa perspectiva (los números de cita ya son globales entre ` +
      `todas las perspectivas): nunca inventes números de cita ni los renumeres. ` +
      `Una perspectiva cuya marca dice fuentes: ninguna se generó sin ninguna fuente ` +
      `local: nunca presentes sus afirmaciones como respaldadas por fuentes locales; ` +
      `atribúyelas al conocimiento general, o di que el índice local no tenía nada ` +
      `sobre esa parte.`,
    noCitationInstruction:
      ` Ninguna perspectiva tuvo fuentes locales, así que escribe la respuesta sin ` +
      `citas y sin dar a entender que las fuentes locales la respaldan.`,
    originalQuestion: "Pregunta original:",
    closing:
      `Compara estas perspectivas, reconcilia cualquier conflicto y escribe una ` +
      `única respuesta bien razonada, en español.`,
    answerLabel: "Respuesta:",
    contrastBlock: (contrast, gaps) => {
      const lines: string[] = [];
      if (contrast && !contrast.failed) {
        for (const c of contrast.conflicts) {
          lines.push(`- Conflicto entre las perspectivas ${c.perspectives.join(" y ")}: ${c.note} Presenta las dos partes; no elijas una en silencio.`);
        }
        for (const d of contrast.duplicates) {
          lines.push(`- Afirmación duplicada en las perspectivas ${d.perspectives.join(" y ")}: ${d.note} Dila una sola vez.`);
        }
      }
      if (gaps.length > 0) {
        lines.push(`Huecos declarados — las fuentes locales no cubrieron esto; dilo con claridad en el informe y no lo rellenes:`);
        for (const g of gaps) lines.push(`- ${g}`);
      }
      return lines.length > 0 ? `\n\nResultados del contraste:\n${lines.join("\n")}` : "";
    },
    styleInstruction: {
      completo: "",
      ejecutivo:
        ` Estructura el informe como un resumen ejecutivo: primero la respuesta directa en ` +
        `pocas líneas, después los apoyos más fuertes con sus citas, y al final lo que las ` +
        `fuentes locales no cubren.`,
      comparativo:
        ` Estructura el informe como una comparación: expón la posición de cada perspectiva ` +
        `con la cita de cada afirmación, después dónde coinciden las perspectivas y dónde se ` +
        `contradicen.`,
      cronologico:
        ` Estructura el informe como una línea de tiempo: los hechos con fecha en orden ` +
        `cronológico, cada uno con su cita, y después las partes de la línea que las fuentes ` +
        `dejan abiertas.`,
    },
  },
  pt: {
    fallbackSystem: "És um assistente de pesquisa offline.",
    synthesizing: " Estás a sintetizar várias perspectivas de pesquisa numa única resposta.",
    perspective: (n, subQuestion) => `Perspectiva ${n} (${subQuestion})`,
    sourcesTag: (n) => `[fontes: ${n}]`,
    noSourcesTag: `[fontes: nenhuma — gerada sem fontes locais]`,
    verdictTag: (v, n) =>
      v.status === "no-sources"
        ? `[julgado: fontes: nenhuma — gerada sem fontes locais]`
        : v.status === "supported"
          ? `[julgado: com apoio — fontes: ${n}]`
          : `[julgado: parcial — ${v.kept} mantidas, ${v.removed} removidas — fontes: ${n}]`,
    citationInstruction:
      ` Cita as fontes como [n] APENAS para as afirmações que uma perspectiva ` +
      `tenha respaldado ela mesma com fontes — copia cada número de citação ` +
      `exatamente como aparece nessa perspectiva (os números de citação já são ` +
      `globais entre todas as perspectivas): nunca inventes números de citação nem ` +
      `os renumeres. Uma perspectiva cuja marca diz fontes: nenhuma foi gerada sem ` +
      `nenhuma fonte local: nunca apresentes as suas afirmações como respaldadas ` +
      `por fontes locais; atribui-as ao conhecimento geral, ou diz que o índice ` +
      `local não tinha nada sobre essa parte.`,
    noCitationInstruction:
      ` Nenhuma perspectiva teve fontes locais, por isso escreve a resposta sem ` +
      `citações e sem dar a entender que as fontes locais a respaldam.`,
    originalQuestion: "Pergunta original:",
    closing:
      `Compara estas perspectivas, reconcilia qualquer conflito e escreve uma ` +
      `única resposta bem fundamentada, em português.`,
    answerLabel: "Resposta:",
    contrastBlock: (contrast, gaps) => {
      const lines: string[] = [];
      if (contrast && !contrast.failed) {
        for (const c of contrast.conflicts) {
          lines.push(`- Conflito entre as perspectivas ${c.perspectives.join(" e ")}: ${c.note} Apresenta os dois lados; não escolhas um em silêncio.`);
        }
        for (const d of contrast.duplicates) {
          lines.push(`- Afirmação duplicada nas perspectivas ${d.perspectives.join(" e ")}: ${d.note} Diz-la uma só vez.`);
        }
      }
      if (gaps.length > 0) {
        lines.push(`Lacunas declaradas — as fontes locais não cobriram isto; diz-lo com clareza no relatório e não o preenchas:`);
        for (const g of gaps) lines.push(`- ${g}`);
      }
      return lines.length > 0 ? `\n\nResultados do contraste:\n${lines.join("\n")}` : "";
    },
    styleInstruction: {
      completo: "",
      ejecutivo:
        ` Estrutura o relatório como um resumo executivo: primeiro a resposta direta em ` +
        `poucas linhas, depois os apoios mais fortes com as suas citações, e no fim o que as ` +
        `fontes locais não cobrem.`,
      comparativo:
        ` Estrutura o relatório como uma comparação: expõe a posição de cada perspectiva com ` +
        `a citação de cada afirmação, depois onde as perspectivas coincidem e onde se contradizem.`,
      cronologico:
        ` Estrutura o relatório como uma linha do tempo: os factos com data em ordem ` +
        `cronológica, cada um com a sua citação, e depois as partes da linha que as fontes ` +
        `deixam em aberto.`,
    },
  },
};

/** Shared content for buildSynthesisPrompt / buildSynthesisMessages (P1.4). */
function synthesisParts(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined,
  lang: GateLang = "en",
  contrast: ResearchContrast | null = null,
  gaps: string[] = [],
  style: ResearchStyle = "completo"
): { system: string; user: string } {
  const txt = SYNTH_TEXT[lang];
  const anySources = subResults.some((r) => r.sourceCount > 0);
  // R2: cumulative global offset per perspective — footnote [n] in the UI
  // is allChunks[n-1], i.e. perspective i's chunk k sits at
  // (sum of previous perspectives' sourceCounts) + k.
  let globalOffset = 0;
  const perspectives = subResults
    .map((r, i) => {
      const renumbered = renumberPerspectiveCitations(r.answer, globalOffset, r.sourceCount);
      // E10 (paso 2): con veredicto, la cabecera de la perspectiva es
      // el veredicto del juez por pasada; sin veredicto (los
      // constructores puros llamados en directo), la etiqueta de
      // conteo de siempre.
      const tag = r.verdict
        ? txt.verdictTag(r.verdict, r.sourceCount)
        : r.sourceCount > 0
          ? txt.sourcesTag(r.sourceCount)
          : txt.noSourcesTag;
      const text = `${txt.perspective(i + 1, r.subQuestion)} ` + tag + `:\n${renumbered}`;
      globalOffset += r.sourceCount;
      return text;
    })
    .join("\n\n");
  const instruction =
    systemPrompt && systemPrompt.trim().length > 0 ? systemPrompt.trim() : txt.fallbackSystem;
  const citationInstruction = anySources ? txt.citationInstruction : txt.noCitationInstruction;
  const system = `${instruction}${txt.synthesizing}` + citationInstruction + txt.styleInstruction[style];
  const user =
    `${txt.originalQuestion} ${originalQuery}\n\n${perspectives}\n\n` +
    txt.closing +
    txt.contrastBlock(contrast, gaps);
  return { system, user };
}

export function buildSynthesisPrompt(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined,
  lang: GateLang = "en",
  contrast: ResearchContrast | null = null,
  gaps: string[] = [],
  style: ResearchStyle = "completo"
): string {
  const { system, user } = synthesisParts(originalQuery, subResults, systemPrompt, lang, contrast, gaps, style);
  return `${system}\n\n${user}\n\n${SYNTH_TEXT[lang].answerLabel}`;
}

/** P1.4: messages form of the synthesis prompt for models with a chat template. */
export function buildSynthesisMessages(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined,
  lang: GateLang = "en",
  contrast: ResearchContrast | null = null,
  gaps: string[] = [],
  style: ResearchStyle = "completo"
): { role: string; content: string }[] {
  const { system, user } = synthesisParts(originalQuery, subResults, systemPrompt, lang, contrast, gaps, style);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Los techos de etapa ya no son una constante: desde el paso 3
// de E10 se derivan del presupuesto de tokens de cada etapa y
// de la tasa medida del modelo cargado (researchBudgets.ts,
// con la historia de la destitución del techo fijo heredado
// nombrada allí y en estudios/E10-PRESUPUESTOS.md).

/**
 * Decompose scaffolding per UI language (R-07): the instruction was
 * hard English, so a Spanish question was decomposed under English
 * orders (and the round's run drifted to an English topic). The
 * English text is the original, unchanged; es/pt ask for the
 * sub-questions in the UI language.
 */
const DECOMPOSE_TEXT: Record<
  GateLang,
  { instruction: string; question: string; subQuestions: string; repair: (error: string) => string }
> = {
  en: {
    instruction:
      `Break this research question into 2-3 focused sub-questions that ` +
      `together cover it well (e.g. technical analysis, counter-arguments, ` +
      `practical implications — whichever fit this question). One per line, ` +
      `no numbering, no extra commentary.`,
    question: "Question",
    subQuestions: "Sub-questions",
    repair: (error) =>
      `\n\nYour previous output failed validation: ${error}. Output one sub-question per line, no numbering, no extra commentary.`,
  },
  es: {
    instruction:
      `Divide esta pregunta de investigación en 2-3 subpreguntas concretas que ` +
      `juntas la cubran bien (por ejemplo análisis técnico, contraargumentos, ` +
      `implicaciones prácticas — las que encajen con esta pregunta). Una por ` +
      `línea, sin numeración y sin comentarios extra. Escribe las subpreguntas en español.`,
    question: "Pregunta",
    subQuestions: "Subpreguntas",
    repair: (error) =>
      `\n\nTu respuesta anterior no superó la validación: ${error}. Escribe una subpregunta por línea, sin numeración y sin comentarios extra.`,
  },
  pt: {
    instruction:
      `Divide esta pergunta de pesquisa em 2-3 subperguntas concretas que ` +
      `juntas a cubram bem (por exemplo análise técnica, contra-argumentos, ` +
      `implicações práticas — as que servirem a esta pergunta). Uma por linha, ` +
      `sem numeração e sem comentários extra. Escreve as subperguntas em português.`,
    question: "Pergunta",
    subQuestions: "Subperguntas",
    repair: (error) =>
      `\n\nA tua resposta anterior não passou na validação: ${error}. Escreve uma subpergunta por linha, sem numeração e sem comentários extra.`,
  },
};

/**
 * Núcleo 3 · N-08 (auditoría 2026-11-01): control de calidad de la
 * descomposición. Lo que el modelo devuelve se aceptaba entero:
 * la misma pregunta repetida tres veces consumía tres pasadas de
 * recuperación e investigación (el 0.5B entra en bucle pese a la
 * penalización de repetición: 0.1.34 ya lo documentó), y una
 * subpregunta en deriva total se investigaba y citaba como si
 * fuera del tema. Dos reglas baratas, sin modelo:
 * - Dedup por línea plegada (minúsculas, sin acentos): la repetida
 *   cuenta una vez.
 * - Deriva: una línea sin NINGÚN token de contenido en común con la
 *   pregunta (tokens plegados de ≥4 letras fuera de palabras
 *   función) se descarta — solo si sobrevive al menos una línea;
 *   si todas caerían, se conserva el parse tal cual. Fallo seguro:
 *   el QC nunca deja la investigación con menos de lo que hay.
 * - Excepción de seguridad (medida al implementar, contra la
 *   fixture de R-07): una línea que la puerta interceptaría JAMÁS
 *   se descarta por deriva. La segunda red de R-07 lee las
 *   subpreguntas TAL CUAL salen de descomponer; si el QC se
 *   tragara la línea de la emergencia («qué hacer si alguien se
 *   esta atragantando» no comparte tokens con «…un debate»), la
 *   red no la vería y la emergencia se investigaría. La línea se
 *   conserva y la red hace su trabajo: aborta el pipeline.
 */
const QC_STOPWORDS = new Set([
  "para", "como", "sobre", "entre", "cuando", "donde", "porque", "este", "esta", "esto", "esos", "esas",
  "cual", "desde", "hasta", "what", "which", "when", "where", "about", "with", "from", "that", "this",
  "does", "have", "qual", "quais", "mais",
]);

function foldQc(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function contentTokensQc(s: string): Set<string> {
  return new Set(
    foldQc(s)
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 4 && !QC_STOPWORDS.has(w)),
  );
}

function qcSubQuestions(lines: string[], query: string, lang: GateLang): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const l of lines) {
    const key = foldQc(l).replace(/[^a-z0-9ñ]+/g, " ").trim();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(l);
    }
  }
  const qTokens = contentTokensQc(query);
  if (qTokens.size === 0) return deduped;
  const onTopic = deduped.filter((l) => {
    // La línea que la puerta intercepta no es deriva descartable:
    // es la señal de la segunda red (ver la cabecera del QC).
    if (gatePreemptsDeepResearch(l, lang)) return true;
    for (const t of contentTokensQc(l)) if (qTokens.has(t)) return true;
    return false;
  });
  return onTopic.length > 0 ? onTopic : deduped;
}

/**
 * Núcleo 3 · N-08: citas honestas. ResearchResult.citations volvía
 * como la unión de TODO lo recuperado, citara la síntesis o no, y
 * la pantalla dibuja esa lista como las notas al pie de la
 * respuesta: fuentes que la respuesta no cita figuraban como su
 * respaldo. Ahora la lista devuelta es solo lo que la respuesta
 * final cita de verdad (marcadores globales [n] sobre allChunks),
 * con los marcadores renumerados a la lista filtrada; si la
 * respuesta no cita nada, la lista va vacía. Como el reestructurado
 * que ya hace synthesize, el texto final puede diferir del
 * transmitido token a token: manda el devuelto.
 */
function honestCitations(
  answer: string,
  allChunks: RetrievedChunk[],
): { answer: string; citations: RetrievedChunk[] } {
  const cited = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= allChunks.length) cited.add(n);
  }
  if (cited.size === 0) return { answer, citations: [] };
  const ordered = [...cited].sort((a, b) => a - b);
  const renum = new Map(ordered.map((oldIdx, i) => [oldIdx, i + 1] as const));
  const renumbered = answer.replace(/\[(\d{1,3})\]/g, (whole, d: string) => {
    const nn = renum.get(Number(d));
    return nn ? `[${nn}]` : whole;
  });
  return { answer: renumbered, citations: ordered.map((i) => allChunks[i - 1]) };
}

/**
 * E10 (paso 3): la clave del modelo cargado, leída con guarda —
 * los arneses guionados no siempre la exponen, y sin clave la
 * tasa registrada no se cobra contra ningún modelo.
 */
function loadedModelKey(): string | null {
  try {
    const info = llamaEngine.getModelInfo();
    return info?.filename ?? null;
  } catch {
    return null;
  }
}

/**
 * E10 (paso 3): cuenta los tokens de una generación con el
 * contador del motor y registra la tasa medida de la corrida
 * (tokens de respuesta ÷ segundos). Con guarda entera: un
 * motor que no puede contar (un doble de batería) deja la
 * cifra en 0 y no registra tasa, sin romper la etapa.
 */
function countAndRecordRate(text: string, ms: number): number {
  let tokens = 0;
  try {
    tokens = llamaEngine.countTokens(text);
  } catch {
    tokens = 0;
  }
  if (tokens > 0 && ms > 0) {
    const key = loadedModelKey();
    if (key !== null) recordMeasuredRate(tokens / (ms / 1000), key);
  }
  return tokens;
}

async function decompose(
  query: string,
  onTimeout: () => void,
  lang: GateLang = "en",
  budget: ResearchBudget = researchBudget(),
): Promise<{ subQuestions: string[]; ms: number; tokens: number }> {
  // P1.4-2026-10-08: real chat template when the GGUF ships one; the
  // hand-built "Question:/Sub-questions:" shape is the fallback for
  // models without an embedded template.
  const txt = DECOMPOSE_TEXT[lang];
  // E10 (paso 3): el plan crece a su clase — la instrucción pide
  // el rango de la tabla sellada (las tres lenguas llevan el
  // «2-3» heredado como plantilla y se sustituye por el rango).
  const instruction = txt.instruction.replace("2-3", `${budget.planMin}-${budget.planMax}`);
  const useTemplate = llamaEngine.hasEmbeddedChatTemplate();
  const buildParams = (repairError?: string) => {
    const suffix = repairError ? txt.repair(repairError) : "";
    return useTemplate
      ? {
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: `${txt.question}: ${query}${suffix}` },
          ],
        }
      : {
          prompt: `${instruction}\n\n${txt.question}: ${query}\n\n${txt.subQuestions}:${suffix}`,
        };
  };
  const parseLines = (text: string): string[] =>
    text
      .split("\n")
      .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((l) => l.length > 8)
      .slice(0, budget.planMax);
  const genOpts = {
    nPredict: budget.decomposeTokens,
    temperature: 0.4,
    // 0.1.34: la temperatura explícita gana; el preset aporta la
    // penalización de repetición (sin ella el 0.5B entra en bucle).
    samplingPreset: "factual" as const,
    timeoutMs: stageTimeoutMs(budget.decomposeTokens, currentResearchClass(), loadedModelKey()),
    onTimeout,
  };
  // P1.5: one bounded repair retry on empty parse; falls back to the
  // original query (pre-existing fail-closed behavior, unchanged).
  const started = performance.now();
  let lastText = "";
  const subQuestions = await withBoundedRepair({
    attempt: async () => {
      lastText = await llamaEngine.generate({ ...buildParams(), ...genOpts });
      return lastText;
    },
    repair: async (_bad, error) => {
      lastText = await llamaEngine.generate({ ...buildParams(error), ...genOpts });
      return lastText;
    },
    validate: (text) => {
      // N-08: el QC (dedupe + deriva) corre dentro de la validación,
      // así el reparo acotado y el fallback [query] de siempre cubren
      // también el parse que el QC dejara vacío.
      const lines = qcSubQuestions(parseLines(text), query, lang);
      return lines.length > 0
        ? { ok: true as const, value: lines }
        : { ok: false as const, error: `no sub-questions extracted (need 1-${budget.planMax} lines)` };
    },
    fallback: [query],
  });
  const ms = performance.now() - started;
  return { subQuestions, ms, tokens: countAndRecordRate(lastText, ms) };
}

/**
 * E10 (paso 2): el juez de la casa dentro del pipeline, en la misma
 * forma en que el turno lo aplica — el contexto semántico se
 * construye si el e5 está residente (el constructor nunca lo carga:
 * sin residencia devuelve null) y el veredicto corre entonces en su
 * modo degradado léxico, como en el turno; los umbrales son los
 * sellados del juez, sin calibración nueva. Devuelve el texto
 * juzgado (las frases sin apoyo fuera, las negaciones cambiadas
 * sustituidas por la fuente literal: la cirugía del propio juez),
 * sus conteos y el tiempo que costó, medido para la expectativa de
 * coste de la partida O-07.
 */
async function judgeText(
  text: string,
  chunks: RetrievedChunk[],
  query: string,
  lang: GateLang,
): Promise<{ text: string; kept: number; removed: number; ms: number }> {
  const started = performance.now();
  const grounding: GroundingChunk[] = chunks.map((c) => ({
    title: c.title ?? "",
    body: c.body ?? "",
    truncated: c.truncated,
  }));
  const semanticCtx = await buildJudgeSemanticContext({ answer: text, chunks: grounding, query }).catch(
    () => null,
  );
  const result = verifyGroundedAnswer(text, grounding, lang, query, new Date(), semanticCtx ?? undefined);
  return { text: result.text, kept: result.kept, removed: result.removed, ms: performance.now() - started };
}

/**
 * E10 (paso 4): el plan visible de una investigación, antes de
 * gastar en pasadas. Descompone con el presupuesto de la
 * clase, comprueba la cobertura sin modelo, cuenta las
 * fuentes de cada ámbito y estima el coste. La superficie lo
 * enseña, la persona lo edita, y la corrida sigue el plan
 * editado (runDeepResearch con options.plan). Planear no
 * investiga: ninguna pasada corre aquí.
 */
export async function planResearch(
  query: string,
  lang: GateLang = "en",
  scope: RetrievalScope = "both",
): Promise<ResearchPlan> {
  const budget = researchBudget();
  const noop = () => {};
  const { subQuestions } = await decompose(query, noop, lang, budget);
  const coverage = planCoverage(query, subQuestions);
  const scopeCounts = await researchScopeCounts();
  const rate = currentRateForEstimate(budget, loadedModelKey());
  const { tokens, seconds } = estimatePlanCost(budget, subQuestions.length, rate);
  return {
    query,
    lang,
    scope,
    subQuestions,
    coverage,
    scopeCounts,
    scopeEmpty: scopeCounts[scope] === 0,
    intercepted: [query, ...subQuestions].some((t) => gatePreemptsDeepResearch(t, lang)),
    style: "completo",
    estimatedTokens: tokens,
    estimatedSeconds: seconds,
    budget,
  };
}

const CONTRAST_TEXT: Record<GateLang, { instruction: string; questionLabel: string; perspectivesLabel: string }> = {
  en: {
    instruction:
      `You are reviewing the perspectives of a research run before the final report is written. ` +
      `Compare them and answer with ONLY a JSON object of this exact shape, no other text: ` +
      `{"conflicts": [{"perspectives": [1, 2], "note": "short note"}], "duplicates": [{"perspectives": [1, 2], "note": "short note"}], "gaps": [{"topic": "what is missing", "question": "a focused sub-question that would cover it"}]}. ` +
      `A conflict is two perspectives stating incompatible things. A duplicate is the same claim repeated across perspectives. ` +
      `A gap is an aspect of the original question that no perspective covers with sources. Use the 1-based perspective numbers. ` +
      `If there are none of a kind, use an empty list for it.`,
    questionLabel: "Original question:",
    perspectivesLabel: "Perspectives:",
  },
  es: {
    instruction:
      `Estás revisando las perspectivas de una investigación antes de que se escriba el informe final. ` +
      `Compáralas y responde SOLO con un objeto JSON de esta forma exacta, sin ningún otro texto: ` +
      `{"conflicts": [{"perspectives": [1, 2], "note": "nota breve"}], "duplicates": [{"perspectives": [1, 2], "note": "nota breve"}], "gaps": [{"topic": "lo que falta", "question": "una subpregunta concreta que lo cubriría"}]}. ` +
      `Un conflicto son dos perspectivas que afirman cosas incompatibles. Un duplicado es la misma afirmación repetida en varias perspectivas. ` +
      `Un hueco es un aspecto de la pregunta original que ninguna perspectiva cubre con fuentes. Usa los números de perspectiva empezando en 1. ` +
      `Si no hay de una clase, usa una lista vacía para ella. Escribe las notas en español.`,
    questionLabel: "Pregunta original:",
    perspectivesLabel: "Perspectivas:",
  },
  pt: {
    instruction:
      `Estás a rever as perspectivas de uma pesquisa antes de o relatório final ser escrito. ` +
      `Compara-as e responde APENAS com um objeto JSON desta forma exata, sem nenhum outro texto: ` +
      `{"conflicts": [{"perspectives": [1, 2], "note": "nota breve"}], "duplicates": [{"perspectives": [1, 2], "note": "nota breve"}], "gaps": [{"topic": "o que falta", "question": "uma subpergunta concreta que o cobriria"}]}. ` +
      `Um conflito são duas perspectivas que afirmam coisas incompatíveis. Um duplicado é a mesma afirmação repetida em várias perspectivas. ` +
      `Uma lacuna é um aspeto da pergunta original que nenhuma perspectiva cobre com fontes. Usa os números de perspectiva a começar em 1. ` +
      `Se não houver de uma classe, usa uma lista vazia para ela. Escreve as notas em português.`,
    questionLabel: "Pergunta original:",
    perspectivesLabel: "Perspectivas:",
  },
};

/** La validación de forma de la salida del contraste: JSON con las tres listas. */
function parseContrast(text: string): ResearchContrast | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const pairs = (v: unknown): { perspectives: number[]; note: string }[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (e): e is { perspectives: unknown; note: unknown } =>
          typeof e === "object" && e !== null && "perspectives" in e && "note" in e,
      )
      .map((e) => ({
        perspectives: Array.isArray(e.perspectives)
          ? e.perspectives.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
          : [],
        note: typeof e.note === "string" ? e.note : "",
      }))
      .filter((e) => e.perspectives.length > 0 && e.note.length > 0);
  };
  const gaps = (v: unknown): { topic: string; question: string }[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (e): e is { topic: unknown; question: unknown } =>
          typeof e === "object" && e !== null && "topic" in e && "question" in e,
      )
      .map((e) => ({
        topic: typeof e.topic === "string" ? e.topic : "",
        question: typeof e.question === "string" ? e.question : "",
      }))
      .filter((e) => e.topic.length > 0 && e.question.length > 0);
  };
  if (!Array.isArray(obj.conflicts) || !Array.isArray(obj.duplicates) || !Array.isArray(obj.gaps)) {
    return null;
  }
  return { conflicts: pairs(obj.conflicts), duplicates: pairs(obj.duplicates), gaps: gaps(obj.gaps) };
}

/**
 * E10 (paso 4): la pasada de contraste. Con las subrespuestas
 * ya juzgadas, una generación dedicada busca conflictos,
 * duplicados y huecos, y devuelve la lista estructurada que
 * la síntesis consume. Si la salida no valida tras el reparo
 * acotado, la pasada se declara fallida y la corrida sigue
 * sin ella: un contraste ausente se dice, no se disimula.
 */
async function contrastPass(
  query: string,
  subResults: ResearchSubResult[],
  budget: ResearchBudget,
  lang: GateLang,
  onTimeout: () => void,
): Promise<{ contrast: ResearchContrast; ms: number; tokens: number }> {
  const txt = CONTRAST_TEXT[lang];
  const perspectives = subResults
    .map((r, i) => `${i + 1}. (${r.subQuestion}) [sources: ${r.sourceCount}]\n${r.answer}`)
    .join("\n\n");
  const userText = `${txt.questionLabel} ${query}\n\n${txt.perspectivesLabel}\n${perspectives}`;
  const started = performance.now();
  let lastText = "";
  const genOpts = {
    nPredict: budget.contrastTokens,
    temperature: 0.3,
    samplingPreset: "factual" as const,
    timeoutMs: stageTimeoutMs(budget.contrastTokens, currentResearchClass(), loadedModelKey()),
    onTimeout,
  };
  const contrast = await withBoundedRepair({
    attempt: async () => {
      lastText = llamaEngine.hasEmbeddedChatTemplate()
        ? await llamaEngine.generate({
            messages: [
              { role: "system", content: txt.instruction },
              { role: "user", content: userText },
            ],
            ...genOpts,
          })
        : await llamaEngine.generate({ prompt: `${txt.instruction}\n\n${userText}`, ...genOpts });
      return lastText;
    },
    repair: async (_bad, error) => {
      lastText = llamaEngine.hasEmbeddedChatTemplate()
        ? await llamaEngine.generate({
            messages: [
              { role: "system", content: txt.instruction },
              { role: "user", content: `${userText}\n\n(${error})` },
            ],
            ...genOpts,
          })
        : await llamaEngine.generate({ prompt: `${txt.instruction}\n\n${userText}\n\n(${error})`, ...genOpts });
      return lastText;
    },
    validate: (text) => {
      const parsed = parseContrast(text);
      return parsed
        ? { ok: true as const, value: parsed }
        : { ok: false as const, error: "the answer was not the required JSON object" };
    },
    fallback: { conflicts: [], duplicates: [], gaps: [], failed: true } as ResearchContrast,
  });
  const ms = performance.now() - started;
  return { contrast, ms, tokens: countAndRecordRate(lastText, ms) };
}

/**
 * E10 (paso 5, hallazgo medido en su batería): el juez final
 * de una investigación juzga por grupos de cita — cada grupo
 * de frases contra los fragmentos que cita, y las frases sin
 * cita contra la unión. La forma de unión entera, medida
 * contra material de varias perspectivas, dejaba que la red
 * de relevancia del juez del chat (T-19, pensada para cazar
 * el sentido competidor entre dos guías de una respuesta)
 * vetara perspectivas enteras: una afirmación apoyada solo
 * por la perspectiva menos parecida a la pregunta original
 * caía aunque su fragmento la sostuviera entera, que es lo
 * contrario del diseño (cada pasada ya se juzga con su
 * subpregunta y contra sus fragmentos). El juez no se toca
 * ni un umbral se mueve: lo que cambia es la composición de
 * sus llamadas en este pipeline, a la forma que el recibo
 * por afirmación cobra (afirmación → su fragmento). Si todos
 * los grupos caen, el texto servido es el del juez de unión
 * (su forma de abstención con el extracto literal), como
 * hasta ahora.
 */
async function judgeFinalAnswer(
  answer: string,
  citations: RetrievedChunk[],
  query: string,
  lang: GateLang,
): Promise<{ text: string; kept: number; removed: number; ms: number }> {
  const sentences = splitSentences(answer).map((s) => s.trim()).filter((s) => s.length > 0);
  const groups = new Map<string, { chunks: RetrievedChunk[]; idx: number[] }>();
  // Las frases sin cita y sin sustancia (menos términos de
  // contenido que el mínimo que el juez juzga) no son
  // afirmaciones: son el andamiaje del informe (encabezados,
  // cierres) y viajan con el documento, como el juez las
  // trata dentro de una respuesta entera. Las sin cita CON
  // sustancia sí se juzgan, contra la unión: es la red que
  // caza la afirmación inventada que no se atrevió a citar.
  const connective = new Set<number>();
  sentences.forEach((s, i) => {
    const numbers = [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const chunks = numbers
      .map((n) => citations[n - 1])
      .filter((c): c is RetrievedChunk => Boolean(c));
    if (chunks.length === 0 && contentTermsOf(s).size < 3) {
      connective.add(i);
      return;
    }
    const key = chunks.length > 0 ? chunks.map((c) => c.chunkId).join("|") : "__union__";
    const group = groups.get(key) ?? {
      chunks: chunks.length > 0 ? chunks : citations,
      idx: [],
    };
    group.idx.push(i);
    groups.set(key, group);
  });
  const judgedByIdx = new Map<number, string>();
  let kept = 0;
  let removed = 0;
  let ms = 0;
  for (const group of groups.values()) {
    // Las citas del grupo se renumeran a la numeración local
    // de su lista antes de juzgar (un [3] global es un número
    // inventado para la lista de un solo fragmento), con el
    // mismo centinela de dos pasadas que el remapeo de vuelta.
    const localOfGlobal = new Map<number, number>();
    group.chunks.forEach((c, j) => localOfGlobal.set(citations.indexOf(c) + 1, j + 1));
    const text = group.idx
      .map((i) => sentences[i])
      .join(" ")
      .replace(/\[(\d+)\]/g, (_m, n: string) => `\u0001${localOfGlobal.get(Number(n)) ?? n}\u0002`)
      .replace(/\u0001(\d+)\u0002/g, "[$1]");
    const judged = await judgeText(text, group.chunks, query, lang);
    ms += judged.ms;
    kept += judged.kept;
    removed += judged.removed;
    if (judged.kept > 0 || judged.removed === 0) {
      // El juez numera contra la lista que recibe: sus [n] son
      // locales al grupo. Se remapean a la numeración global
      // de la corrida antes de reensamblar, en dos pasadas con
      // centinela para que ningún número ya remapeado se
      // vuelva a tocar: una cita mal atribuida es peor que una
      // cita ausente.
      const globalOfLocal = group.chunks.map((c) => citations.indexOf(c) + 1);
      const remapped = judged.text
        .replace(/\[(\d+)\]/g, (_m, n: string) => `\u0001${globalOfLocal[Number(n) - 1] ?? n}\u0002`)
        .replace(/\u0001(\d+)\u0002/g, "[$1]");
      const parts = splitSentences(remapped).map((s) => s.trim()).filter((s) => s.length > 0);
      group.idx.forEach((sentIdx, j) => {
        if (parts[j]) judgedByIdx.set(sentIdx, parts[j]);
      });
      // Las sustituciones del juez pueden fundir o partir
      // frases: si el conteo no casa, el grupo entero conserva
      // su texto juzgado en la posición de su primera frase.
      if (parts.length !== group.idx.length) {
        group.idx.forEach((sentIdx) => judgedByIdx.delete(sentIdx));
        judgedByIdx.set(group.idx[0], remapped.trim());
      }
    }
  }
  if (kept === 0 && removed > 0) {
    // Todo lo juzgado cayó: manda la forma de unión, con su
    // abstención. (Con kept y removed en cero no se juzgó
    // nada — puro texto de andamiaje — y se sirve lo
    // reensamblado tal cual.)
    const union = await judgeText(answer, citations, query, lang);
    return { text: union.text, kept: union.kept, removed: union.removed, ms: ms + union.ms };
  }
  const text = sentences
    .map((s, i) => (connective.has(i) ? s : judgedByIdx.get(i)))
    .filter((s): s is string => Boolean(s))
    .join(" ");
  return { text, kept, removed, ms };
}

/** El estado de una subpregunta ejecutada, para el recibo del plan. */
function planEntryState(r: ResearchSubResult): PlanEntryState {
  if (r.sourceCount === 0) return "gap";
  if (r.verdict && r.verdict.kept === 0 && r.verdict.removed > 0) return "judge-fallen";
  return "covered";
}

async function researchSubQuestion(
  subQuestion: string,
  systemPrompt: string | undefined,
  history: ConversationHistory | undefined,
  onTimeout: () => void,
  budget: ResearchBudget = researchBudget(),
  scope: RetrievalScope = "both",
): Promise<{ answer: string; chunks: RetrievedChunk[]; ms: number; tokens: number }> {
  const chunks = await retrieve(subQuestion, budget.chunksPerPass, scope);
  // Honest no-result: this sub-question's own retrieval pass found
  // nothing, so the model is told to say so briefly rather than answering
  // from general knowledge as if local sources backed it.
  // P1.4: messages+jinja when the model ships a template, else the
  // legacy hand-built prompt (same fallback pattern as executor.ts).
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? {
        messages: assembleChatMessages(subQuestion, chunks, systemPrompt, history, undefined, chunks.length === 0),
      }
    : {
        prompt: assemblePrompt(subQuestion, chunks, systemPrompt, history, undefined, chunks.length === 0),
      };
  const started = performance.now();
  const answer = await llamaEngine.generate({
    ...promptParams,
    nPredict: budget.subAnswerTokens,
    // RAG-GROUNDING 2026-10-11: con fuentes, más cerca de lo literal.
    temperature: chunks.length > 0 ? 0.3 : 0.6,
    samplingPreset: chunks.length > 0 ? "factual" : "chat",
    timeoutMs: stageTimeoutMs(budget.subAnswerTokens, currentResearchClass(), loadedModelKey()),
    onTimeout,
  });
  const ms = performance.now() - started;
  return { answer, chunks, ms, tokens: countAndRecordRate(answer, ms) };
}

async function synthesize(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined,
  maxTokens: number,
  onToken: (piece: string) => void,
  onTimeout: () => void,
  lang: GateLang = "en",
  contrast: ResearchContrast | null = null,
  gaps: string[] = [],
  style: ResearchStyle = "completo"
): Promise<{ text: string; ms: number; tokens: number }> {
  // P1.4: messages+jinja when the GGUF ships a template, else the legacy
  // hand-built string.
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? { messages: buildSynthesisMessages(originalQuery, subResults, systemPrompt, lang, contrast, gaps, style) }
    : { prompt: buildSynthesisPrompt(originalQuery, subResults, systemPrompt, lang, contrast, gaps, style) };
  const started = performance.now();
  const text = await llamaEngine.generate({
    ...promptParams,
    nPredict: maxTokens,
    temperature: 0.6,
    samplingPreset: "chat",
    onToken,
    timeoutMs: stageTimeoutMs(maxTokens, currentResearchClass(), loadedModelKey()),
    onTimeout,
  });
  const ms = performance.now() - started;
  return { text, ms, tokens: countAndRecordRate(text, ms) };
}

export async function runDeepResearch(
  query: string,
  systemPrompt: string | undefined,
  history: ConversationHistory | undefined,
  maxTokens: number,
  onProgress?: (p: ResearchProgress) => void,
  onToken?: (piece: string) => void,
  shouldStop?: () => boolean,
  lang: GateLang = "en",
  options?: {
    /**
     * E10 (paso 2): la costura del instrumento del ciego propio.
     * Con `judgePerPass: false`, las subrespuestas entran en la
     * síntesis sin juzgar y con la etiqueta de conteo (la forma
     * del paso 1), y solo corre el juez final: es el brazo «solo
     * al final» del conjunto ciego de la etapa, contra el que se
     * mide el brazo completo. La producción nunca lo pasa: el
     * defecto es juzgar por pasada, y el turno llama sin opciones.
     */
    judgePerPass?: boolean;
    /**
     * E10 (paso 4): el plan aprobado por la persona en la
     * superficie (planResearch + su edición). Con plan, la
     * corrida no descompone: investiga las subpreguntas del
     * plan, en su orden y con su ámbito. Las subpreguntas
     * añadidas a mano pasan por la misma segunda red que las
     * del modelo (la comprobación de la puerta de abajo corre
     * sobre la lista final, venga de donde venga).
     */
    plan?: { subQuestions: string[]; scope: RetrievalScope };
    /**
     * E10 (paso 4): con `contrast: true`, la corrida ejecuta la
     * pasada de contraste tras las pasadas juzgadas y, si su
     * clase lo tiene, la ronda única de huecos; el resultado
     * lleva el plan ejecutado con sus estados, el contraste y
     * los huecos declarados. Es el flujo de la superficie (el
     * turno lo activa cuando corre con plan visible); las
     * llamadas directas y los instrumentos no lo pasan y
     * corren el pipeline de los pasos 1 a 3 tal cual.
     */
    contrast?: boolean;
    /**
     * E10 (paso 4): la costura de instrumento de los
     * presupuestos — una corrida puede fijar la tabla de otra
     * clase para ejercitar su forma (la ronda de huecos de
     * 16 GB en una máquina de 8). La producción nunca lo pasa:
     * el defecto es la clase de la máquina.
     */
    budgetOverride?: ResearchBudget;
    /**
     * E10 (paso 5): el estilo de informe de la síntesis. El
     * defecto es Completo, que es la forma de los pasos 1 a 4
     * sin instrucción añadida; los otros tres añaden su
     * estructura a la petición de síntesis sobre el mismo
     * material juzgado.
     */
    style?: ResearchStyle;
    /**
     * E10 (paso 6): la sesión de la corrida. Con
     * `onStageClosed`, el pipeline entrega la foto de la
     * sesión al cerrar cada etapa (el llamante la guarda en
     * la memoria cifrada; el pipeline no conoce el almacén).
     * Con `resume`, la corrida reentra desde la foto: no
     * redescompone, no repite las pasadas cerradas ni el
     * contraste cerrado, y sintetiza sobre el material
     * restaurado tal cual — el informe de la reanudada es el
     * de la corrida sin paradas.
     */
    session?: {
      resume?: ResearchSessionSnapshot;
      onStageClosed?: (snapshot: ResearchSessionSnapshot) => void | Promise<void>;
      /** El ámbito de la sesión guardada (gobierna las pasadas que faltan al reanudar). */
      scope?: RetrievalScope;
      /** El estilo de la sesión guardada (gobierna la síntesis al reanudar). */
      style?: ResearchStyle;
    };
  }
): Promise<ResearchResult> {
  let timedOut = false;
  const markTimedOut = () => {
    timedOut = true;
  };

  // E10 (paso 3): la clase de la máquina y su presupuesto sellado
  // gobiernan la corrida entera (plan, pasadas, techos derivados).
  const budget = options?.budgetOverride ?? researchBudget();
  const scope: RetrievalScope = options?.plan?.scope ?? options?.session?.scope ?? "both";
  const stageStats: ResearchStageStat[] = [];
  const buildStats = (): ResearchRunStats => ({
    stages: stageStats,
    totalTokens: stageStats.reduce((n, s) => n + s.tokens, 0),
    rateTokPerSec: measuredRate(loadedModelKey() ?? "") ?? budget.fallbackRateTokPerSec,
  });

  const resume = options?.session?.resume;
  const saveStage = async (snapshot: ResearchSessionSnapshot): Promise<void> => {
    await options?.session?.onStageClosed?.(snapshot);
  };

  onProgress?.({ stage: "decomposing" });
  // Con plan aprobado no se descompone: el gasto de la
  // descomposición ya ocurrió al planear, y su etapa se
  // registra en cero para que la lista de etapas sea entera.
  // E10 (paso 6): con foto de sesión tampoco — el plan es el
  // de la foto, cerrado en su día.
  const decomposed = resume
    ? { subQuestions: resume.subQuestions, ms: 0, tokens: 0 }
    : options?.plan
      ? { subQuestions: options.plan.subQuestions, ms: 0, tokens: 0 }
      : await decompose(query, markTimedOut, lang, budget);
  const subQuestions = decomposed.subQuestions;
  stageStats.push({ stage: "decompose", ms: Math.round(decomposed.ms), tokens: decomposed.tokens });

  // R-07 second net (physical round of 0.1.68): ChatScreen already
  // checks the gate BEFORE this pipeline, but the decomposition itself
  // can surface the emergency the gate read differently in the raw
  // question — and this pipeline used to reclassify NOTHING between
  // the question and the synthesis. The original question and every
  // sub-question go through the same gate decision; on a hit the
  // research is abandoned before any retrieval pass and the caller
  // serves the protected route. The emergency never becomes a
  // "research topic".
  if ([query, ...subQuestions].some((t) => gatePreemptsDeepResearch(t, lang))) {
    return { answer: "", subQuestions, citations: [], timedOut, emergencyIntercepted: true, stats: buildStats() };
  }

  const subResults: ResearchSubResult[] = [];
  const allChunks: RetrievedChunk[] = [];
  const passChunkIds: string[][] = [];
  const passChunks: RetrievedChunk[][] = [];
  const perPass: { kept: number; removed: number }[] = [];
  let judgeMs = 0;

  // E10 (paso 6): la foto de la sesión con lo cerrado hasta
  // ahora, en la forma que el almacén guarda.
  const snapshotNow = (stage: ResearchSessionSnapshot["stage"]): ResearchSessionSnapshot => ({
    stage,
    subQuestions,
    passes: subResults.map((result, i) => ({ result, chunks: passChunks[i] ?? [] })),
    contrast: undefined,
    gapRoundUsed: false,
  });

  // E10 (paso 6): la etapa del plan cierra aquí — la lista
  // final fijada y la segunda red pasada. Una corrida
  // interceptada no deja sesión: no hay nada que reanudar.
  if (!resume) {
    await saveStage(snapshotNow("plan"));
  } else {
    // La reanudación restaura las pasadas del plan ya
    // cerradas, con sus fragmentos y sus veredictos, sin
    // re-investigarlas ni re-juzgarlas.
    const planPasses = resume.passes.slice(0, subQuestions.length);
    for (const p of planPasses) {
      subResults.push(p.result);
      allChunks.push(...p.chunks);
      passChunks.push(p.chunks);
      passChunkIds.push(p.chunks.map((c) => c.chunkId));
      if (p.result.verdict) perPass.push({ kept: p.result.verdict.kept, removed: p.result.verdict.removed });
    }
  }

  // Una pasada entera (recuperación en el ámbito de la corrida,
  // generación a su presupuesto y juez por pasada), compartida
  // por el bucle principal y por la ronda de huecos del paso 4.
  const runPass = async (subQuestion: string): Promise<void> => {
    const { answer, chunks, ms: passMs, tokens: passTokens } = await researchSubQuestion(
      subQuestion,
      systemPrompt,
      history,
      markTimedOut,
      budget,
      scope,
    );
    stageStats.push({ stage: "pass", ms: Math.round(passMs), tokens: passTokens });
    passChunkIds.push(chunks.map((c) => c.chunkId));
    passChunks.push(chunks);
    // E10 (paso 2): juez por pasada. La subrespuesta se juzga contra
    // SUS fragmentos antes de entrar en el conjunto de síntesis, y
    // entra juzgada y con su veredicto: lo que el juez retire no
    // llega a la síntesis como material, y queda contado aquí. Sin
    // fragmentos no hay nada que juzgar: el veredicto es sin
    // fuentes y la subrespuesta entra como estaba (su cabecera ya
    // lo declara).
    if (options?.judgePerPass === false) {
      // El brazo «solo al final» del ciego propio: sin juez por
      // pasada, sin veredicto y sin conteos de pasada.
      subResults.push({ subQuestion, answer, sourceCount: chunks.length });
    } else if (chunks.length === 0) {
      subResults.push({
        subQuestion,
        answer,
        sourceCount: 0,
        verdict: { status: "no-sources", kept: 0, removed: 0 },
      });
      perPass.push({ kept: 0, removed: 0 });
    } else {
      const judged = await judgeText(answer, chunks, subQuestion, lang);
      judgeMs += judged.ms;
      perPass.push({ kept: judged.kept, removed: judged.removed });
      subResults.push({
        subQuestion,
        answer: judged.text,
        sourceCount: chunks.length,
        verdict: {
          status: judged.removed === 0 ? "supported" : "partial",
          kept: judged.kept,
          removed: judged.removed,
        },
      });
    }
    allChunks.push(...chunks);
  };

  for (let i = subResults.length; i < subQuestions.length; i++) {
    // llamaEngine.stop() only interrupts whichever single completion call is
    // in flight *right now* — with several sequential completions here
    // (decompose, each sub-question, synthesize), a stop request needs its
    // own check between stages or the pipeline just carries on to the next
    // one regardless of the user having asked it to stop.
    if (shouldStop?.()) return { answer: "", subQuestions, citations: allChunks, timedOut, noSourcesFound: allChunks.length === 0, stopped: true };
    onProgress?.({ stage: "researching", subQuestionIndex: i, subQuestionCount: subQuestions.length });
    await runPass(subQuestions[i]);
    // E10 (paso 6): la pasada cerró; su foto se guarda ahora,
    // nunca a mitad de la pasada siguiente.
    await saveStage(snapshotNow("passes"));
  }

  if (shouldStop?.()) return { answer: "", subQuestions, citations: allChunks, timedOut, noSourcesFound: allChunks.length === 0, stopped: true };

  // E10 (paso 4): la pasada de contraste y la ronda ÚNICA de
  // huecos, en el flujo con plan visible. El contraste corre
  // sobre las perspectivas ya juzgadas; la ronda corre solo si
  // la clase la tiene (la de 8 GB no: sus huecos se declaran) y
  // solo una vez — tras ella, lo que falte se declara y la
  // investigación termina. Nunca hay una segunda ronda: no
  // existe código que la llame.
  let contrast: ResearchContrast | undefined;
  let gapRoundUsed = false;
  let gapsDeclared: string[] = [];
  if (options?.contrast === true && allChunks.length > 0) {
    // E10 (paso 6): un contraste ya cerrado en la foto no se
    // repite, y las pasadas de su ronda ya cerradas tampoco:
    // se restauran y la ronda sigue solo con las que faltan.
    const savedContrast = resume?.contrast ?? undefined;
    if (savedContrast !== undefined && savedContrast !== null) {
      contrast = savedContrast;
      gapRoundUsed = resume?.gapRoundUsed ?? false;
      for (const p of (resume?.passes ?? []).slice(subQuestions.length)) {
        subResults.push(p.result);
        allChunks.push(...p.chunks);
        passChunks.push(p.chunks);
        passChunkIds.push(p.chunks.map((c) => c.chunkId));
        if (p.result.verdict) perPass.push({ kept: p.result.verdict.kept, removed: p.result.verdict.removed });
      }
    } else {
      const c = await contrastPass(query, subResults, budget, lang, markTimedOut);
      contrast = c.contrast;
      stageStats.push({ stage: "contrast", ms: Math.round(c.ms), tokens: c.tokens });
      await saveStage({ ...snapshotNow("contrast"), contrast, gapRoundUsed: false });
    }
    if (budget.gapRounds > 0 && !contrast.failed && contrast.gaps.length > 0) {
      const candidates = contrast.gaps
        .map((g) => g.question)
        .filter((q) => q.length > 8)
        .slice(0, budget.gapSubQuestions)
        .filter((q) => !subResults.some((r) => r.subQuestion === q));
      if (candidates.length > 0) {
        // Las nuevas pasan por la segunda red antes de su
        // pasada, como las del plan y las añadidas a mano: si
        // una destapa el territorio protegido, la investigación
        // se abandona y el llamante sirve la ruta protegida.
        if (candidates.some((t) => gatePreemptsDeepResearch(t, lang))) {
          return {
            answer: "",
            subQuestions: [...subQuestions, ...candidates],
            citations: [],
            timedOut,
            emergencyIntercepted: true,
            stats: buildStats(),
          };
        }
        gapRoundUsed = true;
        for (const q of candidates) {
          if (shouldStop?.()) break;
          await runPass(q);
          await saveStage({ ...snapshotNow("contrast"), contrast, gapRoundUsed });
        }
      }
    }
  }
  if (options?.contrast === true) {
    // Los huecos declarados de la corrida: las subpreguntas que
    // quedaron sin fuentes (del plan o de la ronda) y los temas
    // del contraste cuya pregunta no se corrió o no encontró
    // fuentes. El informe los declara; no los rellena.
    const byQuestion = new Map(subResults.map((r) => [r.subQuestion, r]));
    const fromStates = subResults.filter((r) => planEntryState(r) === "gap").map((r) => r.subQuestion);
    const fromContrast = (contrast && !contrast.failed ? contrast.gaps : [])
      .filter((g) => {
        const ran = byQuestion.get(g.question);
        return !ran || ran.sourceCount === 0;
      })
      .map((g) => g.topic);
    gapsDeclared = [...new Set([...fromStates, ...fromContrast])];
  }
  const executedPlan: ExecutedPlanEntry[] | undefined =
    options?.contrast === true
      ? subResults.map((r) => ({ subQuestion: r.subQuestion, sourceCount: r.sourceCount, state: planEntryState(r) }))
      : undefined;

  // D/F5: no local source was found for ANY sub-question, so there is no
  // sourced research to synthesize. Answer deterministically instead of
  // asking the model to "write one unified, well-reasoned answer" with
  // citations from perspectives that had zero evidence — that framing is
  // exactly what invited fabrication. noSourcesFound stays true so the UI
  // renders its deterministic note as well.
  if (allChunks.length === 0) {
    // E10 (paso 6): el suelo sin fuentes también cierra la
    // sesión: la corrida terminó, con su respuesta honesta.
    await saveStage({ ...snapshotNow("done"), contrast: contrast ?? null, gapRoundUsed });
    return {
      answer: noSourcesResearchAnswer(lang),
      subQuestions,
      citations: allChunks,
      timedOut,
      noSourcesFound: true,
      ...(options?.contrast === true ? { executedPlan, contrast, gapsDeclared, gapRoundUsed } : {}),
    };
  }

  onProgress?.({ stage: "synthesizing" });
  // E10 (paso 3): la síntesis corre al presupuesto de su clase:
  // quien llama pasa ese presupuesto sellado como maxTokens (el
  // turno lo lee de la tabla), no el tope de respuesta del chat.
  const synth = await synthesize(
    query,
    subResults,
    systemPrompt,
    maxTokens,
    onToken ?? (() => {}),
    markTimedOut,
    lang,
    contrast ?? null,
    gapsDeclared,
    options?.style ?? options?.session?.style ?? "completo"
  );
  stageStats.push({ stage: "synthesis", ms: Math.round(synth.ms), tokens: synth.tokens });
  const answer = synth.text;

  // N-08: las citas que salen son las que la respuesta cita de
  // verdad, renumeradas (ver honestCitations). Los retornos
  // tempranos de arriba (parado, sin fuentes, interceptado) no
  // pasan por aquí y no cambian.
  const honest = honestCitations(answer, allChunks);
  // E10 (paso 2): juez final. El informe sintetizado pasa entero
  // por el juez contra la unión de fragmentos citados (en el orden
  // de la lista renumerada, que es el orden de sus marcadores),
  // con la herramienta de conflictos de números del propio juez; lo
  // que retire queda contado en los conteos de la corrida. Tras el
  // juez, la lista de citas se vuelve a filtrar a lo citado de
  // verdad sobre el texto juzgado: una frase retirada puede dejar
  // su cita huérfana, y ninguna cita huérfana se sirve.
  const finalJudged = await judgeFinalAnswer(honest.answer, honest.citations, query, lang);
  judgeMs += finalJudged.ms;
  const refiltered = honestCitations(finalJudged.text, honest.citations);
  const judgeCounts: ResearchJudgeCounts = {
    perPass,
    finalKept: finalJudged.kept,
    finalRemoved: finalJudged.removed,
    judgeMs,
  };
  const runStats = buildStats();
  const style = options?.style ?? options?.session?.style ?? "completo";
  // E10 (paso 5): los dos recibos se construyen sobre el
  // material servido (la respuesta ya juzgada y su lista de
  // citas filtrada), como datos: la superficie navega el de
  // afirmaciones y el documento guardado lleva los dos.
  const receipt = buildResearchReceipt(
    {
      answer: refiltered.answer,
      citations: refiltered.citations,
      subResults,
      judge: judgeCounts,
      stats: runStats,
      executedPlan,
      contrast,
      gapsDeclared,
      gapRoundUsed,
      passChunkIds,
      style,
    },
    loadedModelKey(),
  );
  // E10 (paso 6): la foto de cierre de la sesión, con todo el
  // material de la corrida ya juzgado.
  await saveStage({ ...snapshotNow("done"), contrast: contrast ?? null, gapRoundUsed });
  return {
    answer: refiltered.answer,
    subQuestions,
    citations: refiltered.citations,
    timedOut,
    noSourcesFound: allChunks.length === 0,
    judge: judgeCounts,
    stats: runStats,
    subResults,
    passChunkIds,
    style,
    receipt,
    ...(options?.contrast === true ? { executedPlan, contrast, gapsDeclared, gapRoundUsed } : {}),
  };
}
