/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asiento de PC (E3, tanda 3 · J-2): batería recreada del 0.1.108
 * bajo la decisión de puerta firmada en la apertura de la tanda
 * (estudios/E3-J2-APERTURA.md §2.1 y §3) y el dirimen de
 * embeddings (estudios/DIRIMEN-EMBEDDINGS.md §3.2). De sus 6
 * casos, los 6 corren LITERALES desde el acto 2A de E4 (uno
 * corrió ADAPTADO CON ASIENTO mientras su premisa faltó):
 *
 *   - «profiles are keyed by the catalog SHA-256 of each
 *     embedding model»: su premisa (el catálogo contiene las dos
 *     huellas) fue falsa en PC mientras el catálogo sellado en
 *     E0 trajo UNA entrada de embeddings (el e5), y el caso
 *     corrió adaptado a esa verdad. El acto 2A de E4 completó
 *     el catálogo con el bge como entrada: la premisa volvió a
 *     ser cierta y el caso corre desde entonces en su forma
 *     literal del móvil, las cuatro afirmaciones. El texto
 *     original del caso afirmaba:
 *       const shas = MODEL_CATALOG.filter((m) => m.kind ===
 *         "embedding").map((m) => m.sha256);
 *       expect(shas).toContain(BGE_SMALL_EN_SHA256);
 *       expect(shas).toContain(MULTILINGUAL_E5_SMALL_SHA256);
 *       expect(embeddingProfileForSha(BGE_SMALL_EN_SHA256))
 *         .toBe(BGE_SMALL_EN_PROFILE);
 *       expect(embeddingProfileForSha(
 *         MULTILINGUAL_E5_SMALL_SHA256))
 *         .toBe(MULTILINGUAL_E5_SMALL_PROFILE);
 *     Las cuatro corren en PC desde el acto 2A de E4 (antes,
 *     la segunda no podía: la huella bge no era de catálogo).
 *
 *   - «no catalog embedding model falls back silently» corre
 *     LITERAL contra el catálogo de PC: itera sus modelos de
 *     embeddings y exige que cada uno resuelva su propio
 *     perfil.
 */

import { describe, expect, it } from "vitest";
import {
  BGE_SMALL_EN_PROFILE,
  BGE_SMALL_EN_SHA256,
  embeddingProfileForSha,
  isSingleTermQuery,
  MULTILINGUAL_E5_SMALL_PROFILE,
  MULTILINGUAL_E5_SMALL_SHA256,
  semanticFloor,
} from "./embeddingProfile.js";
import { MIN_SEMANTIC_SIMILARITY, MIN_SEMANTIC_SIMILARITY_SINGLE_TERM } from "./pure.js";
import { MODEL_CATALOG } from "../models/manifest.js";

describe("embedding profiles", () => {
  it("bge keeps exactly today's search settings (no behaviour change)", () => {
    expect(BGE_SMALL_EN_PROFILE).toMatchObject({
      queryPrefix: "",
      passagePrefix: "",
      minSimilarity: MIN_SEMANTIC_SIMILARITY,
      minSimilaritySingleTerm: MIN_SEMANTIC_SIMILARITY_SINGLE_TERM,
      margin: 0.4,
    });
  });

  it("e5 uses its required prefixes and its own, higher floors", () => {
    expect(MULTILINGUAL_E5_SMALL_PROFILE.queryPrefix).toBe("query: ");
    expect(MULTILINGUAL_E5_SMALL_PROFILE.passagePrefix).toBe("passage: ");
    expect(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity).toBeGreaterThan(BGE_SMALL_EN_PROFILE.minSimilarity);
    expect(MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm).toBeGreaterThanOrEqual(
      MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity
    );
    // A big pack needs more evidence than the built-in base.
    expect(MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity).toBeGreaterThan(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity);
    expect(MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilaritySingleTerm).toBeGreaterThan(
      MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm
    );
  });

  it("profiles are keyed by the catalog SHA-256 of each embedding model", () => {
    // En su forma literal del móvil desde el acto 2A de E4
    // (ver la cabecera): el catálogo trae las dos huellas y
    // cada una resuelve su propio perfil, ninguna por la caída.
    const shas = MODEL_CATALOG.filter((m) => m.kind === "embedding").map((m) => m.sha256);
    expect(shas).toContain(BGE_SMALL_EN_SHA256);
    expect(shas).toContain(MULTILINGUAL_E5_SMALL_SHA256);
    expect(embeddingProfileForSha(BGE_SMALL_EN_SHA256)).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(MULTILINGUAL_E5_SMALL_SHA256)).toBe(MULTILINGUAL_E5_SMALL_PROFILE);
  });

  it("unknown or missing model → bge settings (what every earlier build used)", () => {
    expect(embeddingProfileForSha("f".repeat(64))).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(null)).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(undefined)).toBe(BGE_SMALL_EN_PROFILE);
  });

  it("single-term rule = at most one CONTENT term (R-03; before, raw words)", () => {
    expect(isSingleTermQuery("hola")).toBe(true);
    expect(isSingleTermQuery("  fotosíntesis  ")).toBe(true);
    expect(isSingleTermQuery("")).toBe(true);
    // The old rule counted raw words, so these read as 3-4 word queries
    // and the reinforced floors never applied — yet each carries exactly
    // one content term, like the round's «¿En qué sala?» (→ Sala Bosworth).
    expect(isSingleTermQuery("¿qué es la fotosíntesis?")).toBe(true);
    expect(isSingleTermQuery("¿En qué sala?")).toBe(true);
    // Two or more content terms keep the base floor.
    expect(isSingleTermQuery("hola qué tal")).toBe(false);
    expect(isSingleTermQuery("¿qué día y a qué hora es la cita?")).toBe(false);
    expect(semanticFloor(MULTILINGUAL_E5_SMALL_PROFILE, "hola")).toBe(MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm);
    expect(semanticFloor(MULTILINGUAL_E5_SMALL_PROFILE, "¿En qué sala?")).toBe(
      MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm
    );
    expect(semanticFloor(MULTILINGUAL_E5_SMALL_PROFILE, "hola qué tal")).toBe(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity);
  });
});

describe("every catalog embedding model has a profile", () => {
  it("no catalog embedding model falls back silently", () => {
    for (const m of MODEL_CATALOG.filter((x) => x.kind === "embedding")) {
      const p = embeddingProfileForSha(m.sha256);
      // bge is the fallback itself; any other model must map to its own profile.
      if (m.sha256 !== BGE_SMALL_EN_SHA256) expect(p).not.toBe(BGE_SMALL_EN_PROFILE);
    }
  });
});
