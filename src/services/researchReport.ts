/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchReport.ts — E10 (paso 5): los estilos de informe y
 * los dos recibos de una corrida de investigación.
 *
 * Los cuatro estilos (Completo, Ejecutivo, Comparativo,
 * Cronológico) son cuatro formas de leer EL MISMO material
 * juzgado: las afirmaciones con cita de la respuesta servida,
 * ni una más ni una menos. El estilo cambia la forma, nunca
 * lo afirmado ni sus citas — por construcción, porque las
 * cuatro formas se componen desde las mismas frases citadas,
 * y por batería, que lo cobra extrayendo el conjunto de
 * afirmaciones de cada forma y comparándolo.
 *
 * Los recibos son datos antes que texto: el recibo por
 * afirmación (cada afirmación sustantiva con su fragmento,
 * su documento y su paquete) es el que la superficie navega
 * (una afirmación abre su fragmento), y el recibo de corrida
 * (modelo, etapas con su tiempo y sus tokens, veredictos por
 * pasada, juez final, huecos declarados) es el que el
 * informe guardado lleva entero.
 */
import { splitSentences } from "../rag/grounding.js";
import type { GateLang } from "../routing/emergencyGate.js";
import type {
  ResearchContrast,
  ResearchStageStat,
  ResearchStyle,
  ResearchSubResult,
  ResearchVerdict,
} from "./orchestrator.js";
import type { RetrievedChunk } from "../rag/retrieve.js";

/** El material juzgado de una corrida, en la forma que los recibos leen. */
export interface ReportMaterial {
  answer: string;
  citations: RetrievedChunk[];
  subResults?: ResearchSubResult[];
  judge?: {
    perPass: { kept: number; removed: number }[];
    finalKept: number;
    finalRemoved: number;
    judgeMs: number;
  };
  stats?: { stages: ResearchStageStat[]; totalTokens: number; rateTokPerSec: number };
  executedPlan?: { subQuestion: string; sourceCount: number; state: string }[];
  contrast?: ResearchContrast;
  gapsDeclared?: string[];
  gapRoundUsed?: boolean;
  /** Los ids de fragmento de cada pasada, en su orden (para el Comparativo). */
  passChunkIds?: string[][];
  style?: ResearchStyle;
}

export interface ClaimCitationRef {
  /** El número de cita tal como se sirve en el informe ([n]). */
  n: number;
  chunkId: string;
  docId: string;
  title: string;
}

export interface ClaimReceiptEntry {
  claim: string;
  citations: ClaimCitationRef[];
}

export interface RunReceipt {
  model: string | null;
  style: ResearchStyle;
  stages: ResearchStageStat[];
  totalMs: number;
  totalTokens: number;
  rateTokPerSec: number | null;
  passes: { subQuestion: string; sourceCount: number; verdict?: ResearchVerdict }[];
  finalJudge: { kept: number; removed: number } | null;
  judgeMs: number;
  fragmentsConsulted: number;
  contrast: { conflicts: number; duplicates: number; gaps: number; failed: boolean } | null;
  gapRoundUsed: boolean;
  gapsDeclared: string[];
}

export interface ResearchReceipt {
  claims: ClaimReceiptEntry[];
  run: RunReceipt;
}

/** Las frases de la respuesta que llevan cita: las afirmaciones del informe. */
export function citedClaims(answer: string): { claim: string; numbers: number[] }[] {
  return splitSentences(answer)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((claim) => ({
      claim,
      numbers: [...claim.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
    }))
    .filter((c) => c.numbers.length > 0);
}

/** El recibo por afirmación: afirmación → fragmento → documento/paquete. */
export function buildClaimReceipt(material: ReportMaterial): ClaimReceiptEntry[] {
  return citedClaims(material.answer).map(({ claim, numbers }) => ({
    claim,
    citations: numbers
      .map((n) => material.citations[n - 1])
      .filter((c): c is RetrievedChunk => Boolean(c))
      .map((c, i) => ({
        n: numbers[i],
        chunkId: c.chunkId,
        docId: c.docId,
        title: c.title,
      })),
  }));
}

/** El recibo de la corrida entera. */
export function buildRunReceipt(material: ReportMaterial, modelKey: string | null): RunReceipt {
  const stages = material.stats?.stages ?? [];
  return {
    model: modelKey,
    style: material.style ?? "completo",
    stages,
    totalMs: stages.reduce((n, s) => n + s.ms, 0),
    totalTokens: material.stats?.totalTokens ?? 0,
    rateTokPerSec: material.stats?.rateTokPerSec ?? null,
    passes: (material.subResults ?? []).map((r) => ({
      subQuestion: r.subQuestion,
      sourceCount: r.sourceCount,
      verdict: r.verdict,
    })),
    finalJudge: material.judge
      ? { kept: material.judge.finalKept, removed: material.judge.finalRemoved }
      : null,
    judgeMs: material.judge?.judgeMs ?? 0,
    fragmentsConsulted: (material.subResults ?? []).reduce((n, r) => n + r.sourceCount, 0),
    contrast: material.contrast
      ? {
          conflicts: material.contrast.conflicts.length,
          duplicates: material.contrast.duplicates.length,
          gaps: material.contrast.gaps.length,
          failed: material.contrast.failed === true,
        }
      : null,
    gapRoundUsed: material.gapRoundUsed === true,
    gapsDeclared: material.gapsDeclared ?? [],
  };
}

export function buildResearchReceipt(material: ReportMaterial, modelKey: string | null): ResearchReceipt {
  return { claims: buildClaimReceipt(material), run: buildRunReceipt(material, modelKey) };
}

// ---------------------------------------------------------------------
// Las cuatro formas de leer la misma corrida
// ---------------------------------------------------------------------

const REPORT_TEXT: Record<
  GateLang,
  {
    sources: string;
    declaredGaps: string;
    agreements: string;
    disagreements: string;
    timeline: string;
    undated: string;
  }
> = {
  en: {
    sources: "Sources",
    declaredGaps: "What the local sources do not cover",
    agreements: "Where the perspectives agree",
    disagreements: "Where the perspectives disagree",
    timeline: "Timeline",
    undated: "Claims without a date in the sources",
  },
  es: {
    sources: "Fuentes",
    declaredGaps: "Lo que las fuentes locales no cubren",
    agreements: "Donde las perspectivas coinciden",
    disagreements: "Donde las perspectivas se contradicen",
    timeline: "Línea de tiempo",
    undated: "Afirmaciones sin fecha en las fuentes",
  },
  pt: {
    sources: "Fontes",
    declaredGaps: "O que as fontes locais não cobrem",
    agreements: "Onde as perspectivas coincidem",
    disagreements: "Onde as perspectivas se contradizem",
    timeline: "Linha do tempo",
    undated: "Afirmações sem data nas fontes",
  },
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  janeiro: 1, fevereiro: 2, março: 3, maio: 5, junho: 6, julho: 7,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** La clave de orden cronológico de una afirmación, o null si no trae fecha. */
export function claimDateKey(claim: string): [number, number, number] | null {
  const numeric = claim.match(/\b(\d{1,2})\/(\d{1,2})\/((?:1[0-9]{3})|(?:20[0-9]{2}))\b/);
  if (numeric) return [Number(numeric[3]), Number(numeric[2]), Number(numeric[1])];
  const yearMatch = claim.match(/\b((?:1[0-9]{3})|(?:20[0-9]{2}))\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const lower = claim.toLowerCase();
  let month = 0;
  for (const [name, idx] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      month = idx;
      break;
    }
  }
  return [year, month, 0];
}

/**
 * Una corrida en el estilo pedido. Las cuatro formas llevan
 * las mismas afirmaciones con las mismas citas: se componen
 * desde las frases citadas de la respuesta servida.
 */
export function renderReportStyle(
  material: ReportMaterial,
  style: ResearchStyle,
  lang: GateLang = "en",
): string {
  const txt = REPORT_TEXT[lang];
  const claims = citedClaims(material.answer);
  const gaps = material.gapsDeclared ?? [];
  const gapsBlock =
    gaps.length > 0 ? `\n\n${txt.declaredGaps}:\n${gaps.map((g) => `- ${g}`).join("\n")}` : "";
  switch (style) {
    case "completo": {
      const sources =
        material.citations.length > 0
          ? `\n\n${txt.sources}:\n${material.citations.map((c, i) => `[${i + 1}] ${c.title}`).join("\n")}`
          : "";
      return `${material.answer}${gapsBlock}${sources}`;
    }
    case "ejecutivo": {
      const bullets = claims.map((c) => `- ${c.claim}`).join("\n");
      return `${bullets}${gapsBlock}`;
    }
    case "comparativo": {
      const passes = material.executedPlan ?? material.subResults ?? [];
      const passIds = material.passChunkIds ?? [];
      const byPass = new Map<number, string[]>();
      const rest: string[] = [];
      for (const { claim, numbers } of claims) {
        const chunkIds = numbers
          .map((n) => material.citations[n - 1]?.chunkId)
          .filter((x): x is string => Boolean(x));
        const idx = passIds.findIndex((ids) => chunkIds.some((id) => ids.includes(id)));
        if (idx >= 0) byPass.set(idx, [...(byPass.get(idx) ?? []), claim]);
        else rest.push(claim);
      }
      const parts: string[] = [];
      passes.forEach((p, i) => {
        const list = byPass.get(i);
        if (list && list.length > 0) parts.push(`${p.subQuestion}\n${list.map((c) => `- ${c}`).join("\n")}`);
      });
      if (rest.length > 0) parts.push(rest.map((c) => `- ${c}`).join("\n"));
      const contrast = material.contrast;
      if (contrast && !contrast.failed) {
        if (contrast.duplicates.length > 0) {
          parts.push(`${txt.agreements}:\n${contrast.duplicates.map((d) => `- ${d.note}`).join("\n")}`);
        }
        if (contrast.conflicts.length > 0) {
          parts.push(`${txt.disagreements}:\n${contrast.conflicts.map((c) => `- ${c.note}`).join("\n")}`);
        }
      }
      return `${parts.join("\n\n")}${gapsBlock}`;
    }
    case "cronologico": {
      const dated: { key: [number, number, number]; claim: string }[] = [];
      const undated: string[] = [];
      for (const { claim } of claims) {
        const key = claimDateKey(claim);
        if (key) dated.push({ key, claim });
        else undated.push(claim);
      }
      dated.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
      const parts: string[] = [];
      if (dated.length > 0) {
        parts.push(`${txt.timeline}:\n${dated.map((d) => `- ${d.claim}`).join("\n")}`);
      }
      if (undated.length > 0) {
        parts.push(`${txt.undated}:\n${undated.map((c) => `- ${c}`).join("\n")}`);
      }
      return `${parts.join("\n\n")}${gapsBlock}`;
    }
  }
}

/** El recibo de corrida en texto, para el documento guardado y la exportación. */
export function renderRunReceipt(run: RunReceipt, lang: GateLang = "en"): string {
  const labels: Record<GateLang, { model: string; style: string; stages: string; passes: string; finalJudge: string; fragments: string; gaps: string }> = {
    en: { model: "Model", style: "Style", stages: "Stages", passes: "Passes", finalJudge: "Final judge", fragments: "Fragments consulted", gaps: "Declared gaps" },
    es: { model: "Modelo", style: "Estilo", stages: "Etapas", passes: "Pasadas", finalJudge: "Juez final", fragments: "Fragmentos consultados", gaps: "Huecos declarados" },
    pt: { model: "Modelo", style: "Estilo", stages: "Etapas", passes: "Passagens", finalJudge: "Juiz final", fragments: "Fragmentos consultados", gaps: "Lacunas declaradas" },
  };
  const t = labels[lang];
  const lines: string[] = [
    `${t.model}: ${run.model ?? "—"}`,
    `${t.style}: ${run.style}`,
    `${t.fragments}: ${run.fragmentsConsulted}`,
    `${t.stages}:`,
    ...run.stages.map((s) => `- ${s.stage}: ${s.ms} ms · ${s.tokens} tokens`),
    `${t.passes}:`,
    ...run.passes.map(
      (p) =>
        `- ${p.subQuestion} · ${p.sourceCount} · ${p.verdict ? p.verdict.status : "—"}`,
    ),
  ];
  if (run.finalJudge) {
    lines.push(`${t.finalJudge}: ${run.finalJudge.kept} / ${run.finalJudge.removed}`);
  }
  if (run.gapsDeclared.length > 0) {
    lines.push(`${t.gaps}:`);
    lines.push(...run.gapsDeclared.map((g) => `- ${g}`));
  }
  return lines.join("\n");
}
