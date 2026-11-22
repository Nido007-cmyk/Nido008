/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asiento de PC (E3, tanda 3 · J-2): batería recreada del 0.1.108
 * bajo la decisión de puerta firmada en la apertura de la tanda
 * (estudios/E3-J2-APERTURA.md §2.1 y §3) y el dirimen de
 * embeddings (estudios/DIRIMEN-EMBEDDINGS.md §3.1 y §3.2). De
 * sus 14 casos: 3 LITERALES (los dos de variantes de paquetes y
 * el de rechazo, con su afirmación ganada), 3 ADAPTADOS CON
 * ASIENTO y 8 contra el CATÁLOGO FIXTURE de dos modelos.
 *
 * Las adaptaciones, con el texto original citado:
 *
 *   - «both catalog models exist; bge stays the required
 *     default»: el original afirmaba `bge().required === true`,
 *     `e5().required === false` y que sus ficheros difieren,
 *     contra el manifiesto de dos modelos. En PC el catálogo
 *     tiene exactamente un modelo de embeddings (e5),
 *     `defaultEmbeddingModel()` lo devuelve (requerido por
 *     construcción), `embeddingModelById(id bge)` es `undefined`
 *     y las dos constantes de id siguen existiendo como claves
 *     de variante: eso afirma el caso adaptado.
 *   - «new installs: multilingual for Spanish and Portuguese
 *     only»: es/pt corren literales; en/null/«» esperan el id e5
 *     (el original esperaba el id bge), porque no existe un
 *     segundo modelo al que caer.
 *   - «active model: the Settings choice if it's a catalog
 *     model, else the default»: corre con el mismo asiento — la
 *     elección e5 es literal y la elección desaparecida cae al
 *     defecto, que en PC es e5; el caso afirma además la vía del
 *     dirimen: una elección que nombra el id bge cae al defecto
 *     por la misma vía «gone-model», porque ese id no es un
 *     modelo del catálogo.
 *   - «refuses a non-embedding model» corre literal, como en el
 *     móvil. La afirmación ganada del dirimen (§3.1), el rechazo
 *     hacia el id bge por la guarda de catálogo, salió con la
 *     guarda en la alineación al móvil (paso 11).
 *
 * Los 8 casos de orden, recuperación y cola corren contra el
 * catálogo fixture de dos modelos (las dos entradas como datos,
 * espejo de las del manifiesto móvil campo a campo: bge con
 * `required: true` y e5 con `required: false`), inyectado por la
 * batería sustituyendo el manifiesto por una factoría cuyo
 * `MODEL_CATALOG` es el real del adaptador en una lista mutable
 * que estos casos pueblan con el fixture. El fixture prueba la
 * maquinaria del cambio, agnóstica al modelo; que bge sea
 * instalable lo desmienten los casos adaptados contra el
 * catálogo real, no este fixture.
 *
 * Nota del acto 2A de E4 (2026-11-20, cierre de P11): la
 * entrada `bge-small-en-v1.5-q8` entró en el catálogo, y los
 * tres casos adaptados se re-asientan en su forma nueva, que
 * es la que corre hoy: «new installs» vuelve a su forma
 * literal del móvil por el dato solo; «both catalog models
 * exist» y «active model» conservan forma asentada de PC (los
 * dos modelos existen y el id bge resuelve; el `required`
 * derivado por clase y el defecto e5 de J-2 no dependen del
 * catálogo). Los párrafos de arriba quedan como el registro
 * de la forma anterior, la del catálogo de un solo modelo.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogModel } from "../models/manifest.js";

// Mock state lives on globalThis: mock factories run before this module body.
type World = {
  log: string[];
  active: string | null;
  loaded: string | null;
  failLoad: string | null;
  failReset: boolean;
  failSetActive: boolean;
};
const W = (): World => (globalThis as unknown as { __swW: World }).__swW;
(globalThis as unknown as { __swW: World }).__swW = {
  log: [],
  active: null,
  loaded: null,
  failLoad: null,
  failReset: false,
  failSetActive: false,
};

vi.mock("../models/settings.js", () => ({
  getActiveModelId: async () => W().active,
  setActiveModelId: async (_kind: string, id: string) => {
    if (W().failSetActive) throw new Error("disk full");
    W().log.push(`setActive:${id}`);
    W().active = id;
  },
}));
vi.mock("./embed.js", () => ({
  embeddingEngine: {
    load: async (filename: string) => {
      if (W().failLoad === filename) throw new Error("does not fit in RAM");
      W().log.push(`load:${filename}`);
      W().loaded = filename;
    },
    get loadedModelSha256() {
      return null;
    },
  },
}));
vi.mock("./db.js", () => ({
  resetEmbeddingsForModel: async (sha: string) => {
    if (W().failReset) throw new Error("db locked");
    W().log.push(`reset:${sha.slice(0, 6)}`);
  },
}));
vi.mock("./packs.js", () => ({
  closeAllPacks: async () => W().log.push("closePacks"),
  prepareVectorIndexes: async () => W().log.push("prepareIndexes"),
}));
vi.mock("./reembed.js", () => ({
  reembedMissing: async () => W().log.push("reembed"),
}));
// El manifiesto NO se sustituye por un doble: la factoría deja el
// MODEL_CATALOG real del adaptador en una lista mutable, para que
// la batería inyecte el catálogo fixture de dos modelos solo en
// los casos que lo firman (ver la cabecera).
vi.mock("../models/manifest.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../models/manifest.js")>();
  const mutable: CatalogModel[] = [...real.MODEL_CATALOG];
  (globalThis as unknown as { __swCatalog: CatalogModel[] }).__swCatalog = mutable;
  return { ...real, MODEL_CATALOG: mutable };
});

import { MODEL_CATALOG } from "../models/manifest.js";

// El catálogo fixture de dos modelos: espejo de las dos entradas
// de embeddings del manifiesto móvil (0.1.108), campo a campo.
const FIXTURE_BGE: CatalogModel = {
  id: "bge-small-en-v1.5-q8",
  kind: "embedding",
  label: "bge-small-en-v1.5 (Q8_0)",
  filename: "models/embedding.gguf",
  sizeBytes: 36_806_944,
  sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
  sourceUrl:
    "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf",
  revision: "d32f8c040ea3b516330eeb75b72bcc2d3a780ab7",
  license: "MIT",
  description: "33M, sentence embeddings for the local vector index. Default.",
  required: true,
};
const FIXTURE_E5: CatalogModel = {
  id: "multilingual-e5-small-q8",
  kind: "embedding",
  label: "multilingual-e5-small (Q8_0)",
  filename: "models/embedding-multilingual.gguf",
  sizeBytes: 132_441_664,
  sha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde",
  sourceUrl:
    "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v2/multilingual-e5-small-q8_0.gguf",
  license: "MIT",
  description: "118M, multilingual sentence embeddings: search in Spanish, Portuguese and English.",
  required: false,
};

const REAL_CATALOG: CatalogModel[] = [...MODEL_CATALOG];
function useRealCatalog(): void {
  MODEL_CATALOG.splice(0, MODEL_CATALOG.length, ...REAL_CATALOG);
}
function useFixtureCatalog(): void {
  MODEL_CATALOG.splice(0, MODEL_CATALOG.length, FIXTURE_BGE, FIXTURE_E5);
}

// Imported after the mocks are registered (works the same in every runner).
type Mod = typeof import("./embeddingSwitch.js");
let m: Mod;
beforeAll(async () => {
  m = await import("./embeddingSwitch.js");
});
const DEFAULT_EMBEDDING_ID = "bge-small-en-v1.5-q8";
const MULTILINGUAL_EMBEDDING_ID = "multilingual-e5-small-q8";

const e5 = () => m.embeddingModelById(MULTILINGUAL_EMBEDDING_ID)!;
const bge = () => m.embeddingModelById(DEFAULT_EMBEDDING_ID)!;

beforeEach(() => {
  Object.assign(W(), { log: [], active: null, loaded: null, failLoad: null, failReset: false, failSetActive: false });
  useRealCatalog();
});

describe("choosing the model", () => {
  it("both catalog models exist; bge stays the required default", () => {
    // Forma asentada de PC tras el acto 2A de E4 (ver la
    // cabecera): los dos modelos existen en el catálogo y el
    // id bge resuelve, que es lo que el dato nuevo cambia. Lo
    // que el dato no cambia, por las dos decisiones asentadas:
    // el adaptador deriva `required: true` para todo
    // embeddings (la afirmación del móvil `e5().required ===
    // false` es inexpresable en esta forma), y el defecto de
    // búsqueda sigue siendo el e5, la primera entrada
    // requerida, por el asiento de J-2.
    expect(m.DEFAULT_EMBEDDING_ID).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.MULTILINGUAL_EMBEDDING_ID).toBe(MULTILINGUAL_EMBEDDING_ID);
    const embeddings = MODEL_CATALOG.filter((x) => x.kind === "embedding");
    expect(embeddings).toHaveLength(2);
    expect(e5().required).toBe(true);
    expect(bge().required).toBe(true);
    expect(m.defaultEmbeddingModel()).toBe(e5());
    expect(m.embeddingModelById(DEFAULT_EMBEDDING_ID)).toBe(bge());
  });

  it("new installs: multilingual for Spanish and Portuguese only", () => {
    // En su forma literal del móvil desde el acto 2A de E4:
    // la caída de `defaultEmbeddingIdForLanguage` resuelve al
    // id bge en cuanto la entrada existe, sin tocar código.
    expect(m.defaultEmbeddingIdForLanguage("es")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("pt")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("es-MX")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("pt-BR")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("en")).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage(null)).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("")).toBe(DEFAULT_EMBEDDING_ID);
  });

  it("active model: the Settings choice if it's a catalog model, else the default", async () => {
    // Forma asentada de PC: el defecto al que se cae es e5
    // (primera entrada requerida, asiento de J-2), no el id
    // bge del móvil. Lo que el dato del acto 2A sí cambia:
    // una elección de Ajustes que nombra bge resuelve a bge
    // mismo, en vez de caer al defecto por la vía «gone-model».
    expect((await m.activeEmbeddingModel()).id).toBe(MULTILINGUAL_EMBEDDING_ID);
    W().active = MULTILINGUAL_EMBEDDING_ID;
    expect((await m.activeEmbeddingModel()).id).toBe(MULTILINGUAL_EMBEDDING_ID);
    W().active = "gone-model";
    expect((await m.activeEmbeddingModel()).id).toBe(MULTILINGUAL_EMBEDDING_ID);
    W().active = DEFAULT_EMBEDDING_ID;
    expect((await m.activeEmbeddingModel()).id).toBe(DEFAULT_EMBEDDING_ID);
  });

  it("single-variant packs map to themselves; the withdrawn Vital ids resolve to themselves with no model", () => {
    // La fila de variantes del Vital salió con la retirada de sus
    // entradas del catálogo (purga de la cadena legada, respaldo de
    // VITAL-REEDICION-PREP §5.3): sin fila, sus ids se resuelven a sí
    // mismos para todo modelo y no declaran modelo de vectores. Su
    // vuelta (paso 8 de E5) re-asienta este caso a la forma de dos
    // variantes.
    expect(m.packIdForEmbedding("wiki-vital5", MULTILINGUAL_EMBEDDING_ID)).toBe("wiki-vital5");
    expect(m.packIdForEmbedding("wiki-vital5", DEFAULT_EMBEDDING_ID)).toBe("wiki-vital5");
    expect(m.packIdForEmbedding("wiki-vital5-e5", DEFAULT_EMBEDDING_ID)).toBe("wiki-vital5-e5");
    expect(m.packIdForEmbedding("corpus-standard", MULTILINGUAL_EMBEDDING_ID)).toBe("corpus-standard");
    expect(m.embeddingIdForPack("wiki-vital5-e5")).toBeNull();
    expect(m.embeddingIdForPack("wiki-vital5")).toBeNull();
    expect(m.embeddingIdForPack("corpus-full")).toBeNull();
  });

  it("the seven packs of the 2026-10-30 programme resolve their e5 twin both ways", () => {
    for (const base of ["nido-ninos", "nido-crisis", "nido-desastres", "nido-sin-servicios", "nido-campo", "nido-viaje", "nido-hogar"]) {
      expect(m.packIdForEmbedding(base, MULTILINGUAL_EMBEDDING_ID)).toBe(`${base}-e5`);
      expect(m.packIdForEmbedding(`${base}-e5`, MULTILINGUAL_EMBEDDING_ID)).toBe(`${base}-e5`);
      expect(m.packIdForEmbedding(`${base}-e5`, DEFAULT_EMBEDDING_ID)).toBe(base);
      expect(m.packIdForEmbedding(base, DEFAULT_EMBEDDING_ID)).toBe(base);
      expect(m.embeddingIdForPack(`${base}-e5`)).toBe(MULTILINGUAL_EMBEDDING_ID);
      expect(m.embeddingIdForPack(base)).toBe(DEFAULT_EMBEDDING_ID);
    }
  });
});

describe("switchEmbeddingModel — order and recovery", () => {
  // Los ocho casos de orden, recuperación y cola corren contra el
  // catálogo fixture de dos modelos inyectado por la batería
  // (asiento en la cabecera): prueban la maquinaria del cambio,
  // no que bge sea instalable.
  describe("against the two-model fixture catalog (seated)", () => {
    beforeEach(() => {
      useFixtureCatalog();
    });

    it("load → drop vectors + re-stamp → Settings → packs → background rebuild", async () => {
      await m.switchEmbeddingModel(e5());
      expect(W().log).toEqual([
        `load:${e5().filename}`,
        `reset:${e5().sha256.slice(0, 6)}`,
        `setActive:${MULTILINGUAL_EMBEDDING_ID}`,
        "closePacks",
        "reembed",
        "prepareIndexes",
      ]);
    });

    it("if the new model can't load, nothing changes", async () => {
      W().failLoad = e5().filename;
      await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/RAM/);
      expect(W().log).toEqual([]);
      expect(W().active).toBeNull();
    });

    it("if re-stamping fails, the previous model is loaded again and vectors are kept", async () => {
      W().failReset = true;
      await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/db locked/);
      expect(W().log).toEqual([`load:${e5().filename}`, `load:${bge().filename}`]);
      expect(W().active).toBeNull();
    });

    it("if Settings can't be saved, the base is re-stamped back and rebuilt for the previous model", async () => {
      W().failSetActive = true;
      await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/disk full/);
      expect(W().log).toEqual([
        `load:${e5().filename}`,
        `reset:${e5().sha256.slice(0, 6)}`,
        `reset:${bge().sha256.slice(0, 6)}`,
        `load:${bge().filename}`,
        "reembed",
      ]);
    });

    it("already the active model → only ensures it's loaded, never drops vectors", async () => {
      W().active = MULTILINGUAL_EMBEDDING_ID;
      await m.switchEmbeddingModel(e5());
      expect(W().log).toEqual([`load:${e5().filename}`]);
    });

    it("requests run in order and the LAST one wins (on → off quickly)", async () => {
      const on = m.switchEmbeddingModel(e5());
      const off = m.switchEmbeddingModel(bge());
      await Promise.all([on, off]);
      expect(W().active).toBe(DEFAULT_EMBEDDING_ID);
      expect(W().log.filter((l) => l.startsWith("setActive"))).toEqual([
        `setActive:${MULTILINGUAL_EMBEDDING_ID}`,
        `setActive:${DEFAULT_EMBEDDING_ID}`,
      ]);
    });

    it("the same request twice while waiting is joined, not run twice", async () => {
      const first = m.switchEmbeddingModel(bge()); // no-op (bge active), occupies the queue
      const a = m.switchEmbeddingModel(e5());
      const b = m.switchEmbeddingModel(e5());
      expect(b).toBe(a);
      await Promise.all([first, a, b]);
      expect(W().log.filter((l) => l.startsWith("reset"))).toHaveLength(1);
    });

    it("a failed request doesn't block the next one", async () => {
      W().failLoad = e5().filename;
      await expect(m.switchEmbeddingModel(e5())).rejects.toThrow();
      W().failLoad = null;
      await m.switchEmbeddingModel(e5());
      expect(W().active).toBe(MULTILINGUAL_EMBEDDING_ID);
    });
  });

  it("refuses a non-embedding model", async () => {
    await expect(m.switchEmbeddingModel({ ...e5(), kind: "llm" })).rejects.toThrow(/not an embedding model/);
  });
});
