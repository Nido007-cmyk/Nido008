/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La batería del conjunto real de PC-01 (tanda 12 · J-10): donde
 * pc01Core.test.ts guarda el instrumento con casos sintéticos,
 * esta guarda el conjunto sellado tal como quedó construido —
 * su sello recomputa, su censo es el del diseño (24/24/12/8/8),
 * las huellas de sus fragmentos casan con su texto, los gemelos
 * de B difieren en una sola frase y el mapa de páginas de C
 * recomputa contra la regla de paginación sellada. No corre el
 * juez ni la recuperación: eso fue la corrida 01, una sola vez.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { splitSentences } from "../rag/grounding.js";
import {
  fragmentSha256,
  pc01Seal,
  type Pc01Set,
  type Pc01Source,
} from "./pc01Core.js";

const SETTLED_SEAL = "32b9cbd24ad08035919f794f7d5f4208a60ced1a6e00ca52867e59fa16069ef6";

function loadSet(): { set: Pc01Set; seal: string } {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL("./pc01Set.json", import.meta.url)), "utf8")) as Pc01Set & { seal: string };
  const { seal, ...set } = raw;
  return { set, seal };
}

describe("PC-01: el conjunto sellado", () => {
  it("el sello recomputa y es el asentado antes de la corrida 01", () => {
    const { set, seal } = loadSet();
    expect(seal).toBe(SETTLED_SEAL);
    expect(pc01Seal(set)).toBe(SETTLED_SEAL);
  });

  it("el censo es el del diseño: 24/24/12/8/8 = 76 ítems", () => {
    const { set } = loadSet();
    expect(set.version).toBe("PC-01");
    expect(set.A).toHaveLength(24);
    expect(set.B).toHaveLength(24);
    expect(set.C.cases).toHaveLength(12);
    expect(set.D).toHaveLength(8);
    expect(set.E).toHaveLength(8);
  });

  it("el bloque A reparte 8 fijos y 16 de modelo, con 2 ES + 1 EN + 1 PT por tipo", () => {
    const { set } = loadSet();
    expect(set.A.filter((q) => q.expected === "fixed-text")).toHaveLength(8);
    expect(set.A.filter((q) => q.expected === "model-side")).toHaveLength(16);
    for (const type of ["emergencia", "salud", "hechos", "calculo", "explicacion", "parecidas"]) {
      const ofType = set.A.filter((q) => q.type === type);
      expect(ofType).toHaveLength(4);
      expect(ofType.filter((q) => q.lang === "es")).toHaveLength(2);
      expect(ofType.filter((q) => q.lang === "en")).toHaveLength(1);
      expect(ofType.filter((q) => q.lang === "pt")).toHaveLength(1);
    }
  });

  it("toda huella de fragmento citado casa con su texto", () => {
    const { set } = loadSet();
    const sources: Pc01Source[] = [];
    for (const c of set.B) sources.push(c.source);
    for (const m of set.C.map) sources.push(m.source);
    for (const c of set.C.cases) if (c.source) sources.push(c.source);
    for (const c of set.D) for (const s of c.subQuestions) sources.push(s.source);
    for (const c of set.E) if (c.source) sources.push(c.source);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(fragmentSha256(s.fragment)).toBe(s.sha256);
  });

  it("los gemelos de B difieren en exactamente la frase puntuada", () => {
    const { set } = loadSet();
    for (const c of set.B) {
      const f = splitSentences(c.faithfulDraft);
      const i = splitSentences(c.inventedDraft);
      expect(i).toHaveLength(f.length);
      const diff = f.map((s, k) => (s === i[k] ? -1 : k)).filter((k) => k >= 0);
      expect(diff).toHaveLength(1);
      expect(f[diff[0]]).toBe(c.faithfulSentence);
      expect(i[diff[0]]).toBe(c.inventedSentence);
    }
  });

  it("el bloque B reparte cuatro casos por mecanismo", () => {
    const { set } = loadSet();
    for (const m of ["M1", "M2", "M3", "M4", "M5", "M6"]) {
      expect(set.B.filter((c) => c.mechanism === m)).toHaveLength(4);
    }
  });

  it("el mapa de C recomputa contra la regla de paginación sellada", () => {
    const { set } = loadSet();
    const size = set.C.pageSizeChars;
    expect(set.C.paginationRule).toContain(String(size));
    for (const entry of set.C.map) {
      const idx = set.C.document.indexOf(entry.source.fragment);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(Math.floor(idx / size) + 1).toBe(entry.page);
    }
    for (const c of set.C.cases) {
      if (c.trap === "apartado-ausente") {
        expect(c.keyPage).toBeNull();
        expect(c.source).toBeNull();
      } else {
        const entry = set.C.map.find((m) => m.fragmentId === c.source!.sha256);
        expect(entry).toBeDefined();
        expect(entry!.page).toBe(c.keyPage);
      }
    }
  });

  it("D: seis plenos y dos señuelos con su ausencia medida; E: cuatro y cuatro", () => {
    const { set } = loadSet();
    expect(set.D.filter((c) => c.gap === null)).toHaveLength(6);
    const gaps = set.D.filter((c) => c.gap !== null);
    expect(gaps).toHaveLength(2);
    for (const c of gaps) {
      expect(c.gap!.absence.lexicalContentHits).toBe(0);
      expect(c.gap!.absence.floors.length).toBeGreaterThan(0);
    }
    expect(set.E.filter((c) => c.kind === "parcial")).toHaveLength(4);
    const noSource = set.E.filter((c) => c.kind === "sin-fuente");
    expect(noSource).toHaveLength(4);
    for (const c of noSource) expect(c.absence!.lexicalContentHits).toBe(0);
    for (const c of set.E.filter((x) => x.kind === "parcial")) {
      expect(c.goodSentences).toHaveLength(1);
      expect(c.inventedSentences).toHaveLength(1);
      expect(c.draft).toBe(`${c.goodSentences![0]} ${c.inventedSentences![0]}`);
    }
  });
});
