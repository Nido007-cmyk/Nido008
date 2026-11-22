/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packs.exactRows.test.ts — los dos casos dueños de la
 * generalización O-05.2 del paso 6 de E5 (partida P6S-1, de la
 * auditoría de superficie del paso 6: la construcción no tenía
 * caso dueño en la suite y seis mutaciones plantadas contra ella
 * pasaban en verde). Un paquete de más de
 * EXACT_SEARCH_MAX_ROWS trozos (5.000), instalado por la costura
 * acreditada del registro, con un trozo diana cuyo vector casa
 * con la pregunta y cuyo texto NO comparte ni un término con
 * ella (pregunta en inglés, trozo en español: la forma de la
 * batería multilingüe, para que solo la vía exacta pueda
 * servirlo):
 *
 * - preparado (prepareVectorIndexes), el pack grande sirve el
 *   trozo por la vía exacta: la carga forzada en segundo plano
 *   es la que lo trae;
 * - sin preparar, la ruta de la pregunta no lo sirve: la
 *   pregunta no dispara la preparación de un pack grande.
 *
 * Declarado en la letra de la auditoría: estos dos casos cazan
 * también las mutaciones M-1 (el tope invertido), M-2
 * (exactSearcherFor forzando la carga), M-3 (la preparación sin
 * forzar) y M-4 (el tope fuera) en las direcciones mostradas;
 * M-5 (la composición que espera la preparación) y M-6 (la
 * guarda de leído una vez) no los caza ningún caso y no forman
 * parte de la cura nombrada.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setPacksDataDir } from "../models/dataDir.js";
import { MULTILINGUAL_E5_SMALL_PROFILE, MULTILINGUAL_E5_SMALL_SHA256 } from "./embeddingProfile.js";
import { writeImportedPacks } from "../models/importedPacksRegistry.js";
import { closeAllPacks, prepareVectorIndexes, searchPacks } from "./packs.js";

const HEAVY = 120_000; // cargar (o no cargar) 5.001 filas no es un caso de 5 s
const FILLER_ROWS = 5_000; // + el trozo diana = 5.001 > EXACT_SEARCH_MAX_ROWS
// La pregunta no comparte con el trozo ni un término NI un prefijo
// léxico: buildLexicalQuery casa por prefijo («plants» → «plan»* →
// «plantas»), y un diana que fuera candidato léxico lo serviría la
// caída sellada a palabras-primero puntuándolo por vector, sin
// pasar por la vía exacta — la primera forma de esta fixture cayó
// en eso y el caso de la no carga salió rojo contra la
// construcción buena. Con cero candidatos, solo la vía exacta
// puede servir el trozo, que es lo que los dos casos dirimen.
const PREGUNTA = "what does the cell nucleus contain";
const QUERY = new Float32Array([1, 0]);
const DIANA = "pack:local-grande:1";

let root: string;
let corpusDir: string;

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** El paquete grande: 5.001 trozos, uno solo con texto y vector. */
function buildBigPack(file: string): void {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE meta (key TEXT, value TEXT)");
  db.exec(
    "CREATE TABLE chunks (id INTEGER PRIMARY KEY, title TEXT, body TEXT, source TEXT, scale TEXT, vec BLOB, guide INTEGER, keys TEXT)",
  );
  db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, keys)");
  db.exec("CREATE TABLE guides (id INTEGER PRIMARY KEY, key TEXT, lang TEXT, title TEXT, category TEXT, region TEXT, sources TEXT, verified TEXT)");
  db.exec("CREATE TABLE regions (code TEXT, names TEXT, aliases TEXT, phrases TEXT)");
  db.exec("CREATE TABLE facts (region TEXT, key TEXT, value TEXT, label TEXT, note TEXT, source_title TEXT, source_url TEXT, quote TEXT, checked TEXT)");
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  meta.run("format", "nido-knowledge-pack");
  meta.run("formatVersion", "2");
  meta.run("name", "Pack grande de prueba");
  meta.run("embeddingModelSha256", MULTILINGUAL_E5_SMALL_SHA256);
  meta.run("dims", "2");
  // El trozo diana: texto en español sin un término de la pregunta,
  // vector alineado con ella.
  db.prepare(
    "INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys) VALUES (1, 'Fotosíntesis', 'Las plantas fabrican su comida con la luz del sol.', 'fuente', '1', ?, 0, 'fotosintesis')",
  ).run(new Uint8Array(new Int8Array([127, 0]).buffer));
  db.prepare(
    "INSERT INTO chunks_fts (rowid, title, body, keys) VALUES (1, 'Fotosíntesis', 'Las plantas fabrican su comida con la luz del sol.', 'fotosintesis')",
  ).run();
  // El relleno: 5.000 filas sin texto y con vector cero, insertadas
  // de una vez por CTE recursiva (la forma de la batería
  // multilingüe). Sin texto no entran en el FTS: una MATCH sobre
  // cadenas vacías no devuelve nada, que es lo que su ausencia
  // del índice dice.
  db.exec(`
    WITH RECURSIVE seq(n) AS (
      SELECT 2 UNION ALL SELECT n + 1 FROM seq WHERE n < ${FILLER_ROWS + 1}
    )
    INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys)
    SELECT n, '', '', 'fuente', '1', zeroblob(2), 0, '' FROM seq;
  `);
  db.close();
}

beforeAll(async () => {
  mkdirSync(join(process.cwd(), ".tmp-vitest"), { recursive: true });
  root = mkdtempSync(join(process.cwd(), ".tmp-vitest", "exactrows-"));
  corpusDir = join(root, "corpus");
  mkdirSync(corpusDir, { recursive: true });
  setPacksDataDir(root);
  const file = join(corpusDir, "grande.sqlite");
  buildBigPack(file);
  const bytes = readFileSync(file);
  // Instalado por la costura acreditada: el asiento del registro
  // casa con los bytes construidos (la forma de packTrust.test.ts).
  await writeImportedPacks({
    "grande.sqlite": {
      origin: "nido",
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
      name: "Pack grande de prueba",
      importedAt: new Date().toISOString(),
    },
  });
});

afterEach(async () => {
  await closeAllPacks();
});

afterAll(() => {
  setPacksDataDir(null);
  rmSync(root, { recursive: true, force: true });
});

describe("la generalización O-05.2 · los dos casos dueños (P6S-1)", () => {
  it("preparado, el pack grande sirve por la vía exacta un trozo que ninguna otra vía alcanza", { timeout: HEAVY }, async () => {
    await prepareVectorIndexes(MULTILINGUAL_E5_SMALL_SHA256, MULTILINGUAL_E5_SMALL_PROFILE);
    const r = await searchPacks(PREGUNTA, QUERY, 12);
    // La vía exacta lo trae (la carga forzada de la preparación)…
    expect(r.semantic.map((c) => c.chunkId)).toContain(DIANA);
    // …y la de palabras clave no: ni un término de la pregunta está
    // en el trozo, así que lo sirvió la exacta y ninguna otra.
    expect(r.lexical.map((c) => c.chunkId)).not.toContain(DIANA);
  });

  it("sin preparar, la ruta de la pregunta no carga las filas del pack grande", { timeout: HEAVY }, async () => {
    // Estado fresco: el paquete se reabre sin filas cargadas, y la
    // pregunta corre sin que nadie haya preparado nada.
    await closeAllPacks();
    const r = await searchPacks(PREGUNTA, QUERY, 12);
    expect(r.semantic.map((c) => c.chunkId)).not.toContain(DIANA);
    expect(r.semantic).toEqual([]);
    expect(r.lexical).toEqual([]);
  });
});
