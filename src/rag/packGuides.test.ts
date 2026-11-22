/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Lector de documentos de las guías (pieza 2026-11-08): listPackGuides y
 * readPackGuide leen las guías de un pack instalado SIN cargar ningún
 * motor. El mundo falso sigue el patrón de packs.multilingual.test.ts:
 * expo-sqlite y expo-file-system mockeados, y el pack pasa la puerta de
 * confianza real (packFileState) con la instalación verificada que una
 * descarga deja: asiento en el diario y mtime del fichero atado a él
 * (M-35: la presencia sola ya no abre ningún pack).
 *
 * Recreación de PC (E3, tanda 5 · J-5; apertura §3.5 y §3.7, con su
 * asiento): el mundo sustituido de la fuente se traduce a la forma que
 * la recreación de J-3 dejó asentada para estas mismas rutas:
 *   - No hay módulos expo en PC: el pack es un fichero SQLite REAL en
 *     un directorio temporal bajo la costura del directorio de datos
 *     (models/dataDir.ts), construido con node:sqlite desde el mundo
 *     de la batería cada vez que el mundo cambia (las asignaciones
 *     del mundo pasan por un Proxy que rematerializa el fichero).
 *   - El diario de instalación del móvil (nido-install-state.json)
 *     es en PC el registro de pruebas de instalación de la puerta
 *     (corpus/pack-install-records.json, models/packTrust.ts): la
 *     batería lo escribe desde el fichero fixture real (tamaño,
 *     huella y mtime suyos), así que el pack abre por la vía
 *     «outdated» de la puerta verdadera, como una versión anterior
 *     verificada al instalarla. El campo `journal` del mundo de la
 *     fuente no viaja: su contenido lo produce la materialización.
 *   - El manifiesto se resuelve contra la composición fixture de
 *     §3.5 (vi.mock con importOriginal): CORPUS_CATALOG sale del
 *     packCatalog.ts adelantado de J-3 — los mismos datos firmados
 *     que la pieza verdadera consume — y MODEL_CATALOG conserva el
 *     real del adaptador de J-2 más la fila bge como dato fixture
 *     con su huella real (no requerida: el e5 sigue siendo el
 *     embeddings instalable y el requerido de PC).
 *   - El mock de ./vectorIndex de la fuente no viaja: en PC el
 *     módulo real, sin nativo, reporta no disponible por su propio
 *     contrato (asentado en J-3) y el lector de guías no lo toca.
 *   - El caso «nunca carga un motor» mira los dos motores de la
 *     casa en su forma PC: el de embeddings (rag/embed.ts) y el de
 *     lenguaje (core/engine.ts, la clase LocalEngine). La cadena
 *     de packs.ts no alcanza ninguno de los dos (la pieza lo
 *     declara en su cabecera desde J-3): los espías vigilan las
 *     dos superficies como en la fuente.
 * Las aserciones de los 7 casos no cambian en una coma.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setPacksDataDir } from "../models/dataDir.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";

type GuideRow = { id: number; key: string; lang: string; title: string; category: string; region: string; sources: string; verified: string };
type ChunkRow = { id: number; title: string; body: string; source: string; guide: number | null };
type World = {
  installed: { filename: string; size: number };
  meta: Record<string, string>;
  guides: GuideRow[];
  chunks: ChunkRow[];
};
const W = (): World => (globalThis as unknown as { __pgW: World }).__pgW;

const llamaLoad = vi.fn();
const embeddingLoad = vi.fn();
vi.mock("../core/engine.js", () => ({
  LocalEngine: class {
    load(...a: unknown[]) {
      return llamaLoad(...a);
    }
  },
}));
vi.mock("./embed.js", () => ({ embeddingEngine: { load: embeddingLoad } }));

// La composición fixture del manifiesto (§3.5 de la apertura): el
// módulo real de J-2 no trae CORPUS_CATALOG ni la fila bge; la
// batería los compone desde los datos firmados (packCatalog.ts de
// J-3 y la fila del catálogo del móvil, manifest.ts:373), sin
// tocar el adaptador de producción.
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
let catalog: (typeof import("../models/manifest.js")) & { CORPUS_CATALOG: PackCatalogEntry[] };
beforeAll(async () => {
  packs = await import("./packs.js");
  catalog = (await import("../models/manifest.js")) as typeof catalog;
});

// ---------------------------------------------------------------------------
// El mundo materializado: el fichero real bajo la costura de datos.
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "nido-j5-packguides-"));
setPacksDataDir(tmpRoot);
afterAll(() => {
  setPacksDataDir(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

let vitalEntry: PackCatalogEntry | null = null;
let lastBuiltKey = "";

/** (Re)construye el fichero del pack y su prueba de instalación desde el mundo. */
function materialize() {
  if (!vitalEntry) return;
  const w = W();
  if (!w.installed || !w.meta || !w.guides || !w.chunks) return;
  // Solo se reconstruye cuando el estado que el pack ve cambia de
  // verdad (las asignaciones del mundo llegan en ráfaga).
  const key = JSON.stringify([w.installed, w.meta, w.guides, w.chunks]);
  if (key === lastBuiltKey) return;
  lastBuiltKey = key;
  const corpusDir = join(tmpRoot, "corpus");
  mkdirSync(corpusDir, { recursive: true });
  const filePath = join(tmpRoot, vitalEntry.filename);
  rmSync(filePath, { force: true });
  if (w.installed.filename !== vitalEntry.filename) return;
  const db = new DatabaseSync(filePath);
  db.exec(
    "CREATE TABLE meta (key TEXT, value TEXT);" +
      "CREATE TABLE guides (id INTEGER, key TEXT, lang TEXT, title TEXT, category TEXT, region TEXT, sources TEXT, verified TEXT);" +
      "CREATE TABLE chunks (id INTEGER, title TEXT, body TEXT, source TEXT, guide INTEGER);"
  );
  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(w.meta)) insMeta.run(k, v);
  const insGuide = db.prepare("INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const g of w.guides) insGuide.run(g.id, g.key, g.lang, g.title, g.category, g.region, g.sources, g.verified);
  const insChunk = db.prepare("INSERT INTO chunks (id, title, body, source, guide) VALUES (?, ?, ?, ?, ?)");
  for (const c of w.chunks) insChunk.run(c.id, c.title, c.body, c.source, c.guide);
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

(globalThis as unknown as { __pgW: World }).__pgW = new Proxy({} as World, {
  set(target, prop, value) {
    const ok = Reflect.set(target as object, prop, value);
    materialize();
    return ok;
  },
});

const GUIDE_1: GuideRow = {
  id: 1, key: "cpr", lang: "en", title: "CPR for adults", category: "first-aid",
  region: "", sources: "IFRC 2025", verified: "2026-11-07",
};
const GUIDE_2: GuideRow = {
  id: 2, key: "burns", lang: "en", title: "Burns", category: "first-aid",
  region: "", sources: "IFRC 2025", verified: "2026-11-07",
};

beforeEach(async () => {
  const vital = catalog.CORPUS_CATALOG.find((c) => c.id === "wiki-vital5")!;
  vitalEntry = vital;
  Object.assign(W(), {
    installed: { filename: vital.filename, size: vital.sizeBytes },
    meta: { format: "nido-knowledge-pack", formatVersion: "2", dims: "2", embeddingModelSha256: "802c868f" },
    guides: [GUIDE_2, GUIDE_1],
    chunks: [
      { id: 10, title: "CPR for adults — Push hard", body: "Push in the center.", source: "NIDO — CPR for adults", guide: 1 },
      { id: 9, title: "CPR for adults", body: "Check response first.", source: "NIDO — CPR for adults", guide: 1 },
      { id: 11, title: "Burns", body: "Cool with water.", source: "NIDO — Burns", guide: 2 },
    ],
  });
  llamaLoad.mockClear();
  embeddingLoad.mockClear();
  await packs.closeAllPacks();
});

describe("guide document reader (no model)", () => {
  it("lists the pack guides in their order", async () => {
    const guides = await packs.listPackGuides("wiki-vital5");
    expect(guides.map((g) => g.title)).toEqual(["CPR for adults", "Burns"]);
    expect(guides[0]).toMatchObject({ key: "cpr", lang: "en", sources: "IFRC 2025" });
  });

  it("reads a whole guide as one document, bare chunk first", async () => {
    const doc = await packs.readPackGuide("wiki-vital5", 1);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("CPR for adults");
    expect(doc!.source).toBe("NIDO — CPR for adults");
    expect(doc!.body).toBe("Check response first.\n\nPush in the center.");
  });

  it("falls back to title matching when chunks carry no guide link", async () => {
    W().chunks = W().chunks.map((c) => ({ ...c, guide: null }));
    const doc = await packs.readPackGuide("wiki-vital5", 2);
    expect(doc).not.toBeNull();
    expect(doc!.body).toBe("Cool with water.");
  });

  it("returns empty and null for a pack that is not installed", async () => {
    W().installed = { filename: "corpus/none.sqlite", size: 0 };
    await packs.closeAllPacks();
    expect(await packs.listPackGuides("wiki-vital5")).toEqual([]);
    expect(await packs.readPackGuide("wiki-vital5", 1)).toBeNull();
    expect(await packs.listPackGuides("no-such-pack")).toEqual([]);
  });

  it("returns empty and null for a v1 pack (no guides table)", async () => {
    W().meta = { format: "nido-knowledge-pack", formatVersion: "1", dims: "2", embeddingModelSha256: "802c868f" };
    await packs.closeAllPacks();
    expect(await packs.listPackGuides("wiki-vital5")).toEqual([]);
    expect(await packs.readPackGuide("wiki-vital5", 1)).toBeNull();
  });

  it("returns null for a guide id that does not exist", async () => {
    expect(await packs.readPackGuide("wiki-vital5", 99)).toBeNull();
  });

  it("never loads a model engine while listing or reading", async () => {
    await packs.listPackGuides("wiki-vital5");
    await packs.readPackGuide("wiki-vital5", 1);
    await packs.readPackGuide("wiki-vital5", 2);
    expect(llamaLoad).not.toHaveBeenCalled();
    expect(embeddingLoad).not.toHaveBeenCalled();
  });
});
