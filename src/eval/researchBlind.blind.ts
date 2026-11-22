/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchBlind.blind — la corrida del conjunto ciego propio de
 * E10 (paso 2), en sus DOS brazos. NO forma parte de la suite:
 * corre con su configuración propia (`vitest.blind.config.ts`) y
 * no suma casos a ninguna foto.
 *
 * Los brazos, contra el mismo conjunto sellado:
 * - «completo»: el pipeline tal como la etapa lo deja, con el
 *   juez por pasada y el juez final.
 * - «final»: el mismo pipeline con el juez solo al final (las
 *   subrespuestas entran sin juzgar, con la etiqueta de conteo).
 *
 * El listón (hoja de la etapa, S-2): 0 afirmaciones sin fuente
 * servidas en el informe final, por brazo y por caso, sin
 * compensación. Las trampas del conjunto son las afirmaciones
 * sin fuente plantadas; servir una es fallar el caso.
 *
 * El instrumento: el motor es un doble guionado por caso (la
 * descomposición, las subrespuestas y la síntesis son las del
 * conjunto), la recuperación sirve los fragmentos del conjunto
 * y el pipeline y el juez son los reales. El juez corre en su
 * modo léxico en este arnés (no hay proveedor de embeddings
 * residente): la medición es el suelo del juez, no su techo; el
 * modo completo se ejerce en la app real. Lo que la corrida
 * mide es la composición (qué sobrevive al informe final), no
 * la generación.
 *
 * Los registros crudos van a `src/eval/blind-results/`, en la
 * forma de las corridas de la casa.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import setJson from "./researchBlindSet.json" with { type: "json" };
import {
  RESEARCH_BLIND_SEAL,
  researchBlindSeal,
  servedAnchors,
  servedTraps,
  type ResearchBlindCase,
  type ResearchBlindSet,
} from "./researchBlindCore.js";

const set = setJson as unknown as ResearchBlindSet;

type Arm = "completo" | "final";

const state = vi.hoisted(() => ({
  current: null as { kase: ResearchBlindCase; arm: Arm } | null,
}));

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => true,
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    generate: async (args: { prompt?: string; messages?: unknown }) => {
      const p = args.prompt ?? JSON.stringify(args.messages ?? "");
      const cur = state.current;
      if (!cur) throw new Error("corrida sin caso activo");
      const { kase, arm } = cur;
      if (
        p.includes("Break this research question into") ||
        p.includes("Divide esta pregunta de investigación en") ||
        p.includes("Divida esta pergunta de pesquisa em")
      ) {
        // La descomposición se parsea por líneas, no por JSON:
        // el doble devuelve las subpreguntas una por línea, en
        // la forma en que el pipeline las lee.
        return kase.subQuestions.join("\n");
      }
      if (
        p.includes("synthesizing multiple research perspectives") ||
        p.includes("sintetizando varias perspectivas de investigación") ||
        p.includes("sintetizando várias perspectivas de pesquisa")
      ) {
        return arm === "completo" ? kase.synthesis.full : kase.synthesis.finalOnly;
      }
      // La subrespuesta no lleva instrucción propia: corre sobre
      // el montaje de chat ordinario, que contiene la subpregunta
      // tal cual. Se reconoce por descarte, tras la descomposición
      // y la síntesis.
      const idx = kase.subQuestions.findIndex((sq) => p.includes(sq));
      if (idx >= 0) return kase.passes[idx]!.answer;
      throw new Error("prompt no guionado en la corrida del ciego");
    },
  },
}));

const retrieval = vi.hoisted(() => ({
  bySubQuestion: new Map<string, unknown[]>(),
}));

vi.mock("../rag/retrieve.js", () => ({
  retrieve: async (q: string) => retrieval.bySubQuestion.get(q) ?? [],
}));

import { runDeepResearch } from "../services/orchestrator.js";

interface Row {
  id: string;
  arm: Arm;
  servedTraps: string[];
  anchorsServed: string[];
  anchorsTotal: number;
  citations: number;
  noSourcesFound: boolean;
  perPass: { kept: number; removed: number }[];
  finalKept: number;
  finalRemoved: number;
  judgeMs: number;
  wallMs: number;
  chunksConsumed: number;
}

const rows: Row[] = [];

async function runArm(kase: ResearchBlindCase, arm: Arm): Promise<Row> {
  state.current = { kase, arm };
  retrieval.bySubQuestion.clear();
  kase.subQuestions.forEach((sq, i) => {
    retrieval.bySubQuestion.set(
      sq,
      kase.passes[i]!.chunks.map((c) => ({ ...c, docId: c.chunkId })),
    );
  });
  const t0 = performance.now();
  const r = await runDeepResearch(
    kase.question,
    "You are NIDO.",
    undefined,
    2048,
    undefined,
    undefined,
    undefined,
    kase.lang,
    arm === "final" ? { judgePerPass: false } : undefined,
  );
  const wallMs = performance.now() - t0;
  state.current = null;
  return {
    id: kase.id,
    arm,
    servedTraps: servedTraps(r.answer, kase.traps),
    anchorsServed: servedAnchors(r.answer, kase.supportedAnchors),
    anchorsTotal: kase.supportedAnchors.length,
    citations: r.citations.length,
    noSourcesFound: r.noSourcesFound ?? false,
    perPass: r.judge?.perPass ?? [],
    finalKept: r.judge?.finalKept ?? -1,
    finalRemoved: r.judge?.finalRemoved ?? -1,
    judgeMs: r.judge?.judgeMs ?? -1,
    wallMs: Math.round(wallMs),
    chunksConsumed: kase.passes.reduce((n, p) => n + p.chunks.length, 0),
  };
}

describe("el ciego propio de E10: la precondición", () => {
  it("el sello del conjunto recomputa antes de correr", () => {
    expect(researchBlindSeal(set)).toBe(RESEARCH_BLIND_SEAL);
    expect(set.cases).toHaveLength(6);
  });
});

for (const kase of set.cases) {
  for (const arm of ["completo", "final"] as Arm[]) {
    it(
      `${kase.id} · brazo ${arm}: 0 afirmaciones sin fuente servidas`,
      async () => {
        const row = await runArm(kase, arm);
        rows.push(row);
        expect(row.servedTraps).toEqual([]);
      },
      60_000,
    );
  }
}

afterAll(() => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "blind-results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString();
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(dir, "research-blind-e10-corrida-01.jsonl"), jsonl, "utf8");
  const lines: string[] = [
    "# Corrida 01 del conjunto ciego propio de E10 (paso 2)",
    "",
    `- Cuándo (UTC): ${stamp}`,
    `- Conjunto: research-blind-e10 v${set.version} · sello ${RESEARCH_BLIND_SEAL}`,
    `- Listón: ${set.bar}.`,
    "- Instrumento: motor guionado por caso; recuperación con los fragmentos del conjunto;",
    "  pipeline y juez reales. El juez corre en su modo léxico en este arnés (sin proveedor",
    "  de embeddings residente): la medición es el suelo del juez, no su techo.",
    "- Brazos: «completo» = juez por pasada y al final · «final» = juez solo al final.",
    "",
    "| caso | brazo | trampas servidas | anclajes servidos | citas | por pasada (cons./ret.) | final (cons./ret.) | juez ms | total ms |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.arm} | ${r.servedTraps.length === 0 ? "0" : r.servedTraps.join(", ")} | ${r.anchorsServed.length}/${r.anchorsTotal} | ${r.citations} | ${r.perPass.map((p) => `${p.kept}/${p.removed}`).join(" · ") || "—"} | ${r.finalKept}/${r.finalRemoved} | ${Math.round(r.judgeMs)} | ${r.wallMs} |`,
    ),
    "",
    `Veredicto por brazo: completo ${rows.filter((r) => r.arm === "completo" && r.servedTraps.length === 0).length}/6 sin trampas servidas · final ${rows.filter((r) => r.arm === "final" && r.servedTraps.length === 0).length}/6 sin trampas servidas.`,
    "",
  ];
  writeFileSync(join(dir, "research-blind-e10-corrida-01.md"), lines.join("\n"), "utf8");
});
