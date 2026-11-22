/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pack search with the multilingual model: full vector search through the
 * native index (a Spanish question has no keywords in common with an English
 * article), keyword-only for a pack made with another model, and the
 * original keyword-first path untouched for bge.
 *
 * Recreación de PC (E3, tanda 5 · J-5; apertura §3.5 y §3.7, con su
 * asiento): el mundo sustituido de la fuente se traduce a la forma que
 * la recreación de J-3 dejó asentada para estas mismas rutas:
 *   - No hay módulos expo en PC: el pack es un fichero SQLite REAL en
 *     un directorio temporal bajo la costura del directorio de datos
 *     (models/dataDir.ts), con su tabla FTS5 real poblada con las
 *     filas del mundo; la maquinaria léxica entera (construcción de
 *     la consulta, puerta de cobertura, BM25, normalización por pack)
 *     corre de verdad sobre él. El campo `ftsHits` del mundo de la
 *     fuente no viaja: lo que el mock respondía por decreto lo decide
 *     aquí el FTS real con las puertas reales, y los casos se
 *     escribieron contra ese mismo contrato.
 *   - El diario de instalación del móvil es en PC el registro de
 *     pruebas de instalación (corpus/pack-install-records.json): la
 *     batería lo escribe desde el fichero fixture real y el pack
 *     abre por la vía «outdated» de la puerta verdadera (packTrust).
 *   - El índice nativo y su mundo de ficheros se sustituyen tras los
 *     ganchos que J-3 dejó asentados en vectorIndex.ts
 *     (__setNativeVectorsForTest / __setVectorIndexFsForTest): el
 *     nativo falso registra las llamadas {floor, limit} en
 *     W().searchCalls y devuelve los hits del mundo, como el mock
 *     de la fuente; el fs falso declara el .nvi existente según
 *     W().indexReady.
 *   - El manifiesto se resuelve contra la composición fixture de
 *     §3.5 (vi.mock con importOriginal): CORPUS_CATALOG desde el
 *     packCatalog.ts de J-3 y la fila bge como dato fixture con su
 *     huella real del catálogo del móvil (manifest.ts:373), como
 *     entrada NO requerida.
 *   - El defecto de searchPacks en PC es el e5 (asentado en la
 *     recreación de packs.ts de J-3: ningún consumidor de producción
 *     usa el defecto, y retrieve.ts pasa siempre perfil y huella
 *     explícitos). Los dos casos del describe de bge, que en la
 *     fuente corrían contra el defecto bge, declaran aquí el perfil
 *     bge explícito (bgeOpts, espejo de e5Opts): es el entorno lo
 *     que se asienta; las aserciones no cambian en una coma.
 * Las asignaciones del mundo (incluidas las de W().meta.*) pasan por
 * Proxies que rematerializan el fichero, como en packGuides.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setPacksDataDir } from "../models/dataDir.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";
import { __setNativeVectorsForTest, __setVectorIndexFsForTest } from "./vectorIndex.js";

type Row = { id: number; title: string; body: string; vec: Uint8Array };
type World = {
  installed: { filename: string; size: number };
  meta: Record<string, string>;
  rows: Row[];
  indexReady: boolean;
  /** Pretend the pack is too big for the exact search (the Wikipedia). */
  bigPack?: boolean;
  searchCalls: Array<{ floor: number; limit: number }>;
  hits: { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null };
  /** 0.1.36: lo que devuelve la búsqueda sin piso (fondo para la distintividad). */
  topHits?: { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null };
};
const W = (): World => (globalThis as unknown as { __pkW: World }).__pkW;

// La composición fixture del manifiesto (§3.5 de la apertura).
vi.mock("../models/manifest.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../models/manifest.js")>();
  const { CORPUS_CATALOG } = await import("../models/packCatalog.js");
  return {
    ...real,
    CORPUS_CATALOG,
    MODEL_CATALOG: [
      ...real.MODEL_CATALOG,
      {
        id: "bge-small-en-v1.5-q8",
        kind: "embedding" as const,
        label: "bge-small-en-v1.5 (Q8_0)",
        filename: "models/embedding.gguf",
        sizeBytes: 36_806_944,
        sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
        sourceUrl:
          "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
        revision: "d32f8c040ea3b516330eeb75b72bcc2d3a780ab7",
        license: "MIT",
        description: "33M, sentence embeddings for the local vector index. Default.",
        required: false,
      },
    ],
  };
});

// La entrada fixture del Vital, compuesta sobre el catálogo real:
// su oferta salió del catálogo con la purga de la cadena legada
// (respaldo de VITAL-REEDICION-PREP §5.3) y esta batería simula el
// pack ya instalado, con su asiento del registro de instalados, que
// es su sujeto. packs.ts lee el catálogo de packCatalog.js en
// directo, así que la composición va en ese módulo y el mock del
// manifiesto la hereda por la misma importación.
vi.mock("../models/packCatalog.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../models/packCatalog.js")>();
  const vitalFixture: (typeof real.PACK_CATALOG)[number] = {
    id: "wiki-vital5",
    kind: "corpus",
    format: "sqlite-pack",
    label: "Wikipedia Vital Articles (+50,000 articles)",
    filename: "corpus/wiki-vital5.sqlite",
    sizeBytes: 163647488,
    sha256: "d3b87d562baba3489f6878bf99783f50d504db94c347029771e53f6d1aecc666",
    sourceUrl:
      "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v1/wiki-vital5.sqlite",
    license: "CC BY-SA 4.0 (Wikipedia)",
    description:
      "Introductions of Wikipedia's ~50,000 Vital Articles (level 5), searchable offline. ~164MB.",
    required: false,
  };
  return {
    ...real,
    PACK_CATALOG: [...real.PACK_CATALOG, vitalFixture],
    CORPUS_CATALOG: [...real.CORPUS_CATALOG, vitalFixture],
  };
});

let packs: typeof import("./packs.js");
let profiles: typeof import("./embeddingProfile.js");
let catalog: (typeof import("../models/manifest.js")) & { CORPUS_CATALOG: PackCatalogEntry[] };

// ---------------------------------------------------------------------------
// El mundo materializado: el fichero real y el índice falso.
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "nido-j5-multilingual-"));
setPacksDataDir(tmpRoot);

let vitalEntry: PackCatalogEntry | null = null;
let lastBuiltKey = "";

function materialize() {
  if (!vitalEntry) return;
  const w = W();
  if (!w.installed || !w.meta || !w.rows) return;
  // Las asignaciones del mundo llegan en ráfaga (la semilla de
  // beforeEach, los ajustes de un caso): solo se reconstruye el
  // fichero cuando el estado que el pack ve cambia de verdad.
  const key = JSON.stringify([
    w.installed,
    w.meta,
    w.rows.map((r) => [r.id, r.title, r.body, Array.from(r.vec)]),
    !!w.bigPack,
  ]);
  if (key === lastBuiltKey) return;
  lastBuiltKey = key;
  const corpusDir = join(tmpRoot, "corpus");
  mkdirSync(corpusDir, { recursive: true });
  const filePath = join(tmpRoot, vitalEntry.filename);
  rmSync(filePath, { force: true });
  const db = new DatabaseSync(filePath);
  db.exec(
    "CREATE TABLE meta (key TEXT, value TEXT);" +
      "CREATE TABLE chunks (id INTEGER, title TEXT, body TEXT, vec BLOB);" +
      "CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body);"
  );
  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(w.meta)) insMeta.run(k, v);
  const insChunk = db.prepare("INSERT INTO chunks (id, title, body, vec) VALUES (?, ?, ?, ?)");
  const insFts = db.prepare("INSERT INTO chunks_fts (rowid, title, body) VALUES (?, ?, ?)");
  for (const r of w.rows) {
    insChunk.run(r.id, r.title, r.body, r.vec);
    insFts.run(r.id, r.title, r.body);
  }
  if (w.bigPack) {
    const maxId = w.rows.reduce((m, r) => Math.max(m, r.id), 0);
    db.exec(
      `INSERT INTO chunks (id, title, body, vec) WITH RECURSIVE c(n) AS (SELECT ${maxId + 1} UNION ALL SELECT n + 1 FROM c WHERE n < 50000) SELECT n, '', '', x'0000' FROM c;`
    );
  }
  db.close();
  const bytes = readFileSync(filePath);
  const proof = {
    [vitalEntry.id]: {
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mtimeMs: statSync(filePath).mtimeMs,
    },
  };
  writeFileSync(join(corpusDir, "pack-install-records.json"), JSON.stringify(proof));
}

function wrapMeta(meta: Record<string, string>): Record<string, string> {
  return new Proxy(meta, {
    set(target, prop, value) {
      const ok = Reflect.set(target, prop, value);
      materialize();
      return ok;
    },
  });
}

(globalThis as unknown as { __pkW: World }).__pkW = new Proxy({} as World, {
  set(target, prop, value) {
    const ok = Reflect.set(target as object, prop, prop === "meta" ? wrapMeta(value as Record<string, string>) : value);
    materialize();
    return ok;
  },
});

beforeAll(async () => {
  packs = await import("./packs.js");
  profiles = await import("./embeddingProfile.js");
  catalog = (await import("../models/manifest.js")) as typeof catalog;
  __setNativeVectorsForTest({
    buildIndex: async () => W().rows.length,
    search: async (_indexPath: string, _query: number[], floor: number, limit: number) => {
      W().searchCalls.push({ floor, limit });
      const h = floor < 0 ? W().topHits ?? W().hits : W().hits;
      return { ...h, count: h.ids.length };
    },
    release: () => true,
  });
  __setVectorIndexFsForTest({
    documentDirectory: `file://${tmpRoot}/`,
    getInfoAsync: async (uri: string) => ({ exists: uri.endsWith(".nvi") ? W().indexReady : false }),
    readDirectoryAsync: async () => [],
    deleteAsync: async () => {},
  });
});

afterAll(() => {
  __setNativeVectorsForTest(undefined);
  __setVectorIndexFsForTest(null);
  setPacksDataDir(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

const v = (...xs: number[]) => new Uint8Array(new Int8Array(xs).buffer);

beforeEach(async () => {
  const vital = catalog.CORPUS_CATALOG.find((c) => c.id === "wiki-vital5")!;
  vitalEntry = vital;
  Object.assign(W(), {
    installed: { filename: vital.filename, size: vital.sizeBytes },
    // Test vectors are 2-dimensional; real packs declare 384.
    meta: { format: "nido-knowledge-pack", dims: "2", embeddingModelSha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde" },
    rows: [
      { id: 1, title: "Photosynthesis", body: "Plants…", vec: v(10, 0) },
      { id: 2, title: "Black hole", body: "Gravity…", vec: v(0, 10) },
      { id: 3, title: "Inflation", body: "Prices…", vec: v(7, 7) },
    ],
    indexReady: true,
    bigPack: false,
    searchCalls: [],
    hits: { ids: [1, 3], scores: [0.93, 0.9], gatedCount: 40, gatedMin: 0.81 },
    topHits: undefined,
  });
  await packs.closeAllPacks();
});

const e5Opts = () => ({ profile: profiles.MULTILINGUAL_E5_SMALL_PROFILE, modelSha256: profiles.MULTILINGUAL_E5_SMALL_SHA256 });
const bgeOpts = () => ({
  profile: profiles.BGE_SMALL_EN_PROFILE,
  modelSha256: catalog.MODEL_CATALOG.find((m) => m.id === "bge-small-en-v1.5-q8")!.sha256,
});

describe("searchPacks — multilingual (full vector search)", () => {
  it("finds English articles for a Spanish question with no shared keywords", async () => {
    const r = await packs.searchPacks("¿cómo hacen las plantas su comida?", new Float32Array([1, 0]), 12, e5Opts());
    expect(r.lexical).toEqual([]);
    // Range 0.93-0.81 → cutoff 0.93 - 0.4*0.12 = 0.882: both hits stay.
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis", "Inflation"]);
    expect(r.semantic.map((c) => c.score)).toEqual([0.93, 0.9]);
    expect(r.semantic[0].chunkId).toBe("pack:wiki-vital5:1");
  });

  it("uses e5's (higher) pack floor and the app's per-source limit", async () => {
    // Dos términos de contenido (inflación, desempleo) → piso base.
    await packs.searchPacks("¿qué es la inflación y el desempleo?", new Float32Array([1, 0]), 12, e5Opts());
    // 0.1.36: primero el fondo (sin piso, 50), luego la búsqueda real.
    expect(W().searchCalls).toEqual([
      { floor: -1, limit: 51 },
      { floor: profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity, limit: 12 },
    ]);
    await packs.searchPacks("inflación", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls[3].floor).toBe(profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilaritySingleTerm);
    // R-03: «¿qué es la inflación?» tiene UN término de contenido
    // (inflación) aunque tenga cuatro palabras: piso de término único.
    await packs.searchPacks("¿qué es la inflación?", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls[5].floor).toBe(profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilaritySingleTerm);
  });

  it("a question made only of stopwords still gets the vector search", async () => {
    const r = await packs.searchPacks("¿qué es?", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls.filter((c) => c.floor >= 0)).toHaveLength(1);
    expect(r.semantic.length).toBeGreaterThan(0);
  });

  it("0.1.36 distintividad: si nada destaca del fondo, el piso sube y no hay fuentes falsas", async () => {
    // Pregunta sin respuesta: los 50 mejores son todos parecidos (0.86–0.85).
    const flat = Array.from({ length: 51 }, (_, i) => 0.86 - i * 0.0002);
    W().topHits = { ids: flat.map((_, i) => i + 1), scores: flat, gatedCount: 51, gatedMin: flat[50] };
    await packs.searchPacks("¿dónde dejé las llaves del coche?", new Float32Array([1, 0]), 12, e5Opts());
    const real = W().searchCalls[1];
    expect(real.floor).toBeGreaterThan(0.86); // fondo ≈ 0.853 + 0.03
  });

  it("0.1.36 distintividad: si el mejor destaca, sigue pasando", async () => {
    const peaked = [0.93, 0.91, ...Array.from({ length: 49 }, (_, i) => 0.84 - i * 0.0005)];
    W().topHits = { ids: peaked.map((_, i) => i + 1), scores: peaked, gatedCount: 51, gatedMin: peaked[50] };
    await packs.searchPacks("¿qué es la inflación?", new Float32Array([1, 0]), 12, e5Opts());
    // El piso sube con el fondo (≈0.826 + 0.03) pero el mejor (0.93) pasa de sobra.
    expect(W().searchCalls[1].floor).toBeLessThan(0.93);
    expect(W().searchCalls[1].floor).toBeGreaterThanOrEqual(profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity);
  });

  it("index not built yet, big pack → keyword-first fallback for this question (no wait)", async () => {
    W().indexReady = false;
    W().bigPack = true;
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis"]); // cosine 1.0 ≥ floor
  });

  it("index not built yet, small pack → exact vector search, no keywords needed (prueba física 2026-11-06)", async () => {
    // Justo tras actualizar Esencial, su índice se reconstruye: la guía
    // tiene que seguir saliendo por vectores aunque no comparta palabras.
    W().indexReady = false;
    const r = await packs.searchPacks("qué pasa con las plantas y la luz", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.semantic[0]?.title).toBe("Photosynthesis");
    expect(r.semantic.map((c) => c.title)).not.toContain("Black hole");
  });

  it("pack made with another model → keyword search only, never its vectors", async () => {
    W().meta.embeddingModelSha256 = catalog.MODEL_CATALOG.find((m) => m.id === "bge-small-en-v1.5-q8")!.sha256;
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic).toEqual([]);
  });

  it("a pack declaring another vector size → keyword search only", async () => {
    W().meta.dims = "384";
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic).toEqual([]);
  });

  it("not a knowledge pack → skipped", async () => {
    W().meta = { format: "something-else" };
    const r = await packs.searchPacks("inflación precios", new Float32Array([1, 0]), 12, e5Opts());
    expect(r).toEqual({ lexical: [], semantic: [] });
  });
});

describe("searchPacks — bge keeps the original keyword-first search", () => {
  beforeEach(() => {
    W().meta.embeddingModelSha256 = catalog.MODEL_CATALOG.find((m) => m.id === "bge-small-en-v1.5-q8")!.sha256;
  });

  it("never calls the native index; vectors only re-rank keyword candidates", async () => {
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, bgeOpts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis"]);
  });

  it("no content words → nothing (as before)", async () => {
    const r = await packs.searchPacks("what is", new Float32Array([1, 0]), 12, bgeOpts());
    expect(r).toEqual({ lexical: [], semantic: [] });
  });
});
