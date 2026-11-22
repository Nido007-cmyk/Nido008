/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * M-35 (auditoría 2026-11-13, carril 07) — integridad de los packs en
 * reposo, a nivel de packs.ts:
 *
 *  - F-03: un `.sqlite` suelto en corpus/ (sin pin de catálogo y sin
 *    registro de la puerta firmada) NO es un pack: no se lista, no se
 *    abre, no responde.
 *  - B3: las respuestas deterministas de emergencia (hechos) solo salen
 *    de packs del catálogo firmado; un pack importado por la puerta
 *    sirve guías y búsqueda, no números de emergencia.
 *  - P-39 (B7): un pack cuyas filas superan los topes no se abre.
 *
 * El mundo falso trae un FS en memoria con diario de instalación y
 * registro de importados, porque eso es lo que un pack instalado por un
 * flujo legítimo tiene de verdad: pin (catálogo o registro) y, tras la
 * primera verificación, asiento en el diario.
 *
 * Recreación de PC (E3, tanda 5 · J-5; apertura §3.5 y §3.7, con su
 * asiento): el mundo se traduce a la forma que la recreación de J-3
 * dejó asentada para estas rutas:
 *   - El pack del catálogo (nido-local) es un fichero SQLite REAL en
 *     un directorio temporal bajo la costura del directorio de datos,
 *     construido desde su FakeDb (meta, regiones, hechos y el conteo
 *     de trozos como filas reales) cada vez que el mundo lo muta
 *     (Proxy sobre cada FakeDb), y abre por la vía «outdated» de la
 *     puerta verdadera con la prueba de instalación escrita desde
 *     el fichero real (corpus/pack-install-records.json, la forma
 *     PC del diario).
 *   - El importado (tienda.sqlite) y el suelto conservan sus bytes
 *     literales de la fuente y el registro de importados es el
 *     fichero real corpus/imported-packs.json con el pin de esos
 *     bytes: ningún caso los abre (B3 excluye al importado de los
 *     hechos antes de abrirlo, y el suelto ni siquiera se lista),
 *     así que sus FakeDb son el espejo del mundo de la fuente sin
 *     materializar — la exclusión que los casos cobran ocurre en
 *     la misma puerta que en la fuente (CATALOG_PACK_IDS y el
 *     listado), no en la apertura.
 *   - La aserción sobre openedDbs de la fuente no tiene superficie
 *     en PC (packs.ts no lleva registro de aperturas): el «no se
 *     abre» del suelto queda cobrado por construcción y por el
 *     primer caso (no se lista; answerFromPackFacts solo abre
 *     packs listados del catálogo).
 *   - El manifiesto se resuelve contra la composición fixture de
 *     §3.5 (CORPUS_CATALOG desde packCatalog.ts de J-3; la fila bge
 *     como dato fixture no requerido, por la misma firma).
 * Las demás aserciones no cambian en una coma.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setPacksDataDir } from "../models/dataDir.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";

const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

interface FakeDb {
  meta: Record<string, string>;
  regions: Array<Record<string, string>>;
  facts: Array<Record<string, string>>;
  chunkCount: number;
}
interface World {
  dbs: Map<string, FakeDb>;
}
const W = (): World => (globalThis as unknown as { __priW: World }).__priW;
(globalThis as unknown as { __priW: World }).__priW = { dbs: new Map() } as World;

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

let packs: typeof import("./packs.js");
let catalog: (typeof import("../models/manifest.js")) & { CORPUS_CATALOG: PackCatalogEntry[] };
beforeAll(async () => {
  packs = await import("./packs.js");
  catalog = (await import("../models/manifest.js")) as typeof catalog;
});

// ---------------------------------------------------------------------------
// El mundo materializado bajo la costura del directorio de datos.
// ---------------------------------------------------------------------------

const tmpRoot = mkdtempSync(join(tmpdir(), "nido-j5-integrity-"));
setPacksDataDir(tmpRoot);
afterAll(() => {
  setPacksDataDir(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

const corpusDir = join(tmpRoot, "corpus");
const builtKeys = new Map<string, string>();

/** (Re)construye el fichero real de nido-local desde su FakeDb y su prueba. */
function materializeLocal() {
  const db = W().dbs.get("nido-local.sqlite");
  if (!db) return;
  const key = JSON.stringify([db.meta, db.regions, db.facts, db.chunkCount]);
  if (builtKeys.get("nido-local.sqlite") === key) return;
  builtKeys.set("nido-local.sqlite", key);
  mkdirSync(corpusDir, { recursive: true });
  const filePath = join(corpusDir, "nido-local.sqlite");
  rmSync(filePath, { force: true });
  const sql = new DatabaseSync(filePath);
  sql.exec(
    "CREATE TABLE meta (key TEXT, value TEXT);" +
      "CREATE TABLE regions (code TEXT, names TEXT, aliases TEXT, phrases TEXT);" +
      "CREATE TABLE facts (id INTEGER PRIMARY KEY, region TEXT, key TEXT, value TEXT, label TEXT, note TEXT, source_title TEXT, source_url TEXT, quote TEXT, checked TEXT);" +
      "CREATE TABLE chunks (id INTEGER, title TEXT, body TEXT, source TEXT, vec BLOB);"
  );
  const insMeta = sql.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(db.meta)) insMeta.run(k, v);
  const insRegion = sql.prepare("INSERT INTO regions (code, names, aliases, phrases) VALUES (?, ?, ?, ?)");
  for (const r of db.regions) insRegion.run(r.code, r.names, r.aliases, r.phrases);
  const insFact = sql.prepare(
    "INSERT INTO facts (region, key, value, label, note, source_title, source_url, quote, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const f of db.facts) insFact.run(f.region, f.key, f.value, f.label, f.note, f.source_title, f.source_url, f.quote, f.checked);
  if (db.chunkCount > 0) {
    sql.exec(
      `INSERT INTO chunks (id, title, body, source, vec) WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < ${db.chunkCount}) SELECT n, '', '', '', x'' FROM c;`
    );
  }
  sql.close();
  const bytes = readFileSync(filePath);
  const proof = {
    "nido-local": {
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      mtimeMs: statSync(filePath).mtimeMs,
    },
  };
  writeFileSync(join(corpusDir, "pack-install-records.json"), JSON.stringify(proof));
}

function proxiedDb(name: string, db: FakeDb): FakeDb {
  return new Proxy(db, {
    set(target, prop, value) {
      const ok = Reflect.set(target, prop, value);
      if (name === "nido-local.sqlite") materializeLocal();
      return ok;
    },
  });
}

// The real NIDO Local facts for Chile, in the pack tables' row shape.
const factsDoc = JSON.parse(
  readFileSync(new URL("../../knowledge-packs/nido-local/facts.json", import.meta.url), "utf8")
);
const clRegionRow = {
  code: "CL",
  names: JSON.stringify(factsDoc.regions.CL.names),
  aliases: JSON.stringify(factsDoc.regions.CL.aliases),
  phrases: JSON.stringify(factsDoc.regions.CL.in ?? {}),
};
const clFactRows = (factsDoc.facts as Array<Record<string, any>>)
  .filter((f) => f.region === "CL")
  .map((f) => ({
    region: f.region,
    key: f.key,
    value: f.value,
    label: JSON.stringify(f.label),
    note: JSON.stringify(f.note ?? {}),
    source_title: f.source.title,
    source_url: f.source.url,
    quote: f.source.quote,
    checked: f.source.checked,
  }));

const META_V2 = { format: "nido-knowledge-pack", formatVersion: "2", dims: "384", embeddingModelSha256: "x" };
const TIENDA_BYTES = new Uint8Array(2048);
for (let i = 0; i < TIENDA_BYTES.length; i++) TIENDA_BYTES[i] = (i * 11 + 7) & 0xff;
const SUELTO_BYTES = new Uint8Array(1024).fill(65);

function seedWorld() {
  const w = W();
  w.dbs.clear();
  builtKeys.clear();
  rmSync(corpusDir, { recursive: true, force: true });
  mkdirSync(corpusDir, { recursive: true });
  // Imported pack: the door's registry is its pin (the real registry
  // file, with the hash of the literal bytes below).
  writeFileSync(join(corpusDir, "tienda.sqlite"), TIENDA_BYTES);
  const registry = {
    version: 1,
    packs: {
      "tienda.sqlite": {
        origin: "salvora",
        sha256: sha256Hex(TIENDA_BYTES),
        sizeBytes: TIENDA_BYTES.length,
        name: "Tienda",
        importedAt: "2026-11-01T00:00:00.000Z",
      },
    },
  };
  writeFileSync(join(corpusDir, "imported-packs.json"), JSON.stringify(registry));
  // Stray file: no catalog pin, no registry record.
  writeFileSync(join(corpusDir, "suelto.sqlite"), SUELTO_BYTES);
  const empty: FakeDb = { meta: { ...META_V2 }, regions: [], facts: [], chunkCount: 10 };
  w.dbs.set("nido-local.sqlite", proxiedDb("nido-local.sqlite", { ...empty, regions: [], facts: [] }));
  w.dbs.set("tienda.sqlite", proxiedDb("tienda.sqlite", { ...empty, regions: [], facts: [] }));
  w.dbs.set("suelto.sqlite", proxiedDb("suelto.sqlite", { ...empty, regions: [], facts: [] }));
  materializeLocal();
}

beforeEach(async () => {
  seedWorld();
  await packs.closeAllPacks();
});

const CL_QUESTION = "¿a qué número llamo para una ambulancia en Chile?";

describe("M-35/F-03: un fichero suelto en corpus/ no es un pack", () => {
  it("knowledgePacks no lo lista; el importado con registro sí aparece, con su pin", async () => {
    const list = await packs.knowledgePacks();
    const ids = list.map((p) => p.id);
    expect(ids).toContain("nido-local");
    expect(ids).not.toContain("local-suelto");
    const tienda = list.find((p) => p.id === "local-tienda");
    expect(tienda).toBeDefined();
    expect(tienda!.sha256).toBe(sha256Hex(TIENDA_BYTES));
    expect(tienda!.sizeBytes).toBe(TIENDA_BYTES.length);
  });

  it("un hecho que solo vive en el fichero suelto no responde como emergencia", async () => {
    W().dbs.get("suelto.sqlite")!.regions = [clRegionRow];
    W().dbs.get("suelto.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
  });
});

describe("M-35/B3: autoridad de emergencia solo del catálogo firmado", () => {
  it("un pack importado no responde números de emergencia aunque cubra el país", async () => {
    W().dbs.get("tienda.sqlite")!.regions = [clRegionRow];
    W().dbs.get("tienda.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
  });

  it("el pack del catálogo sí responde (control)", async () => {
    W().dbs.get("nido-local.sqlite")!.regions = [clRegionRow];
    W().dbs.get("nido-local.sqlite")!.facts = clFactRows;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain("131");
  });

  it("loadAllPackFacts tampoco trae hechos de un importado", async () => {
    W().dbs.get("tienda.sqlite")!.regions = [clRegionRow];
    W().dbs.get("tienda.sqlite")!.facts = clFactRows;
    const all = await packs.loadAllPackFacts();
    expect(all.facts).toEqual([]);
    expect(all.regions).toEqual([]);
  });
});

describe("M-35/P-39: topes de filas al abrir", () => {
  it("un pack del catálogo con más trozos que el tope no se abre ni responde", async () => {
    const db = W().dbs.get("nido-local.sqlite")!;
    db.regions = [clRegionRow];
    db.facts = clFactRows;
    db.chunkCount = 2_000_000;
    const answer = await packs.answerFromPackFacts(CL_QUESTION, "es");
    expect(answer).toBeNull();
  });
});
