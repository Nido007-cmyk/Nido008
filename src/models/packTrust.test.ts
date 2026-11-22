/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packTrust.test.ts — registro y puerta de apertura de paquetes
 * (bloque puerta de E5, paso 4; la parte de registro y apertura
 * de la batería §5.4 de la etapa). Acredita los dos módulos
 * adelantados por J-3 — importedPacksRegistry.ts y packTrust.ts —
 * y cobra en este paso las partidas con sede en él:
 *
 * - J3S-1: la acreditación «el fichero sustituido tras la
 *   importación no abre» ejecutada contra una sustitución del
 *   MISMO tamaño. Resultado cobrado: la puerta, fiel al móvil,
 *   decide «current» por tamaño y la sustitución del mismo
 *   tamaño SÍ abre; la partida cierra en su forma (b), con la
 *   letra de la acreditación estrechada a lo que la puerta
 *   cobra y el riesgo residual declarado en el asiento del
 *   paso (precondición: escritura local sobre el directorio
 *   de datos). La sustitución de OTRO tamaño no abre.
 * - J5S-1: el experimento hermano contra
 *   verifiedImportedPacks(): la marca es la misma puerta, y
 *   con sizeBytes ≤ 0 la sola presencia basta; documentado en
 *   los casos, con el dirimen de la frase cobrado en el paso 2.
 * - J3S-2: la contención de la resolución (la forma de la
 *   resolución, construida en dataDir.resolvePackPath): la
 *   clave con ../../ y pin casado por tamaño ya no sirve
 *   ningún fichero de fuera del directorio de datos.
 * - J3S-4: readPackSource ante el pack de esquema desviado
 *   (chunks sin la columna source) degrada a null, no rechaza:
 *   el arreglo de una línea contra la pieza, hallazgo contra
 *   el adelanto de J-3.
 *
 * Los paquetes de la batería son sintéticos pero válidos
 * (esquema v2 entero, construidos con node:sqlite), escritos
 * en un directorio de datos temporal por la costura de la
 * casa (setPacksDataDir). Nada de lo aquí escrito es una
 * instalación: son fixtures de batería.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PackPathRefusal, packsDataPath, resolvePackPath, setPacksDataDir } from "./dataDir.js";
import { readImportedPacks, writeImportedPacks, type ImportedPackRecord } from "./importedPacksRegistry.js";
import { packFileState } from "./packTrust.js";
import { closeAllPacks, knowledgePacks, listPackGuides, readPackSource } from "../rag/packs.js";
import { verifiedImportedPacks } from "../services/packImporter.js";
import type { CatalogModel } from "./manifest.js";

const GENUINO = "CUERPO-GENUINO-de-la-guia-de-prueba";
const MUTADO = "CUERPO-MUTADO--de-la-guia-de-prueba";

let root = "";
let corpus = "";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Un paquete sintético válido (esquema v2; `source` opcional en chunks). */
function buildPack(file: string, opts: { withSource?: boolean; body?: string } = {}): Buffer {
  const withSource = opts.withSource ?? true;
  const body = opts.body ?? GENUINO;
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE meta (key TEXT, value TEXT)");
  db.exec(
    `CREATE TABLE chunks (id INTEGER PRIMARY KEY, title TEXT, body TEXT${withSource ? ", source TEXT" : ""}, scale TEXT, vec BLOB, guide INTEGER, keys TEXT)`,
  );
  db.exec("CREATE TABLE guides (id INTEGER PRIMARY KEY, key TEXT, lang TEXT, title TEXT, category TEXT, region TEXT, sources TEXT, verified TEXT)");
  db.exec("CREATE TABLE regions (code TEXT, names TEXT, aliases TEXT, phrases TEXT)");
  db.exec("CREATE TABLE facts (region TEXT, key TEXT, value TEXT, label TEXT, note TEXT, source_title TEXT, source_url TEXT, quote TEXT, checked TEXT)");
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  meta.run("format", "nido-knowledge-pack");
  meta.run("formatVersion", "2");
  meta.run("name", "Pack de prueba");
  meta.run("embeddingModelSha256", "");
  db.prepare(
    `INSERT INTO chunks (id, title, body${withSource ? ", source" : ""}, scale, vec, guide, keys) VALUES (1, 'Guía de prueba', ?${withSource ? ", 'fuente'" : ""}, 'pack', ?, 1, 'guia')`,
  ).run(body, new Uint8Array(384));
  db.prepare(
    "INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (1, 'guia', 'es', 'Guía de prueba', 'prueba', '', 'fuente', '2026-01-01')",
  ).run();
  db.close();
  return readFileSync(file);
}

/** Sustitución del mismo tamaño: mismos bytes salvo el cuerpo, byte a byte. */
function mutateSameSize(bytes: Buffer): Buffer {
  const out = Buffer.from(bytes);
  const at = out.indexOf(GENUINO);
  expect(at).toBeGreaterThanOrEqual(0);
  out.write(MUTADO, at, "utf8");
  expect(out.length).toBe(bytes.length);
  return out;
}

function recordFor(bytes: Buffer, name = "Pack de prueba"): ImportedPackRecord {
  return { origin: "salvora", sha256: sha256Hex(bytes), sizeBytes: bytes.length, name, importedAt: "2026-11-17T00:00:00.000Z" };
}

function writeCorpusFile(name: string, bytes: Buffer): string {
  const file = join(corpus, name);
  writeFileSync(file, bytes);
  return file;
}

/** Toca el mtime +2 s: la caché de apertura distingue el fichero nuevo. */
function bumpMtime(file: string): void {
  const s = statSync(file);
  utimesSync(file, s.atime, new Date(s.mtimeMs + 2000));
}

beforeAll(() => {
  mkdirSync(join(process.cwd(), ".tmp-vitest"), { recursive: true });
  root = mkdtempSync(join(process.cwd(), ".tmp-vitest", "packdoor-"));
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  setPacksDataDir(root);
});

afterEach(async () => {
  await closeAllPacks();
});

afterAll(() => {
  setPacksDataDir(null);
  rmSync(root, { recursive: true, force: true });
});

describe("registro de importados (§5.4)", () => {
  it("un registro ilegible o mal formado se lee vacío: ningún importado aparece ni abre", async () => {
    const bytes = buildPack(join(corpus, "tienda.sqlite"));
    writeCorpusFile("tienda.sqlite", bytes);
    writeFileSync(join(corpus, "imported-packs.json"), "{ esto no es json");
    expect(await readImportedPacks()).toEqual({});
    const packs = await knowledgePacks();
    expect(packs.some((p) => p.id === "local-tienda")).toBe(false);
    expect(await listPackGuides("local-tienda")).toEqual([]);
  });

  it("un asiento bajo el nombre de un fichero de catálogo no crea un importado", async () => {
    const bytes = buildPack(join(corpus, "nido-esencial-e5.sqlite"));
    writeCorpusFile("nido-esencial-e5.sqlite", bytes);
    await writeImportedPacks({ "nido-esencial-e5.sqlite": recordFor(bytes) });
    const entries = (await knowledgePacks()).filter((p) => p.filename === "corpus/nido-esencial-e5.sqlite");
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("nido-esencial-e5");
    expect(entries[0]!.sha256).toBe("c4d49aa945199520af9273cf5fd02f52d26eda7f82b1c41c65f121a635706c92");
  });

  it("un .sqlite válido sin asiento no es un paquete: no aparece y nunca abre (M-35)", async () => {
    const bytes = buildPack(join(corpus, "suelto.sqlite"));
    writeCorpusFile("suelto.sqlite", bytes);
    await writeImportedPacks({});
    expect((await knowledgePacks()).some((p) => p.id === "local-suelto")).toBe(false);
    expect(await listPackGuides("local-suelto")).toEqual([]);
    expect(await readPackSource("pack:local-suelto:1")).toBeNull();
  });

  it("el asiento manda: al cambiar el pin del asiento, la entrada trae el pin nuevo; al borrarlo, el importado desaparece", async () => {
    const bytes = buildPack(join(corpus, "tienda.sqlite"));
    writeCorpusFile("tienda.sqlite", bytes);
    await writeImportedPacks({ "tienda.sqlite": recordFor(bytes) });
    let entry = (await knowledgePacks()).find((p) => p.id === "local-tienda");
    expect(entry?.sha256).toBe(sha256Hex(bytes));
    const other = recordFor(Buffer.from("otros bytes"));
    await writeImportedPacks({ "tienda.sqlite": other });
    entry = (await knowledgePacks()).find((p) => p.id === "local-tienda");
    expect(entry?.sha256).toBe(other.sha256);
    expect(entry?.sizeBytes).toBe(other.sizeBytes);
    await writeImportedPacks({});
    expect((await knowledgePacks()).some((p) => p.id === "local-tienda")).toBe(false);
  });
});

describe("puerta de apertura (§5.4)", () => {
  const asset = (patch: Partial<CatalogModel>): CatalogModel & { format?: string } => ({
    id: "prueba",
    kind: "corpus",
    format: "sqlite-pack",
    label: "Prueba",
    filename: "corpus/prueba.sqlite",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    sourceUrl: "",
    license: "",
    description: "",
    required: false,
    ...patch,
  });

  it("sin fichero o con otro tamaño, el estado es unusable; con el tamaño del pin, current", async () => {
    expect(await packFileState(asset({}))).toBe("unusable");
    writeCorpusFile("prueba.sqlite", Buffer.alloc(50));
    expect(await packFileState(asset({}))).toBe("unusable");
    writeCorpusFile("prueba.sqlite", Buffer.alloc(100));
    expect(await packFileState(asset({}))).toBe("current");
  });

  it("con sizeBytes ≤ 0 la sola presencia es current (la letra exacta de la vía)", async () => {
    writeCorpusFile("prueba.sqlite", Buffer.alloc(7));
    expect(await packFileState(asset({ sizeBytes: 0, sha256: "" }))).toBe("current");
  });

  it("la vía outdated: el diario acredita los bytes instalados, por mtime y por re-hash", async () => {
    const oldBytes = Buffer.alloc(100, 7);
    const file = writeCorpusFile("prueba.sqlite", oldBytes);
    const proof = { sizeBytes: 100, sha256: sha256Hex(oldBytes), mtimeMs: statSync(file).mtimeMs };
    writeFileSync(join(corpus, "pack-install-records.json"), JSON.stringify({ prueba: proof }));
    // La prueba no es el pin vigente y el mtime casa: outdated sin re-hash.
    expect(await packFileState(asset({}))).toBe("outdated");
    // Reescrito (mtime nuevo) con los mismos bytes: el re-hash contra la prueba lo acredita.
    bumpMtime(file);
    expect(await packFileState(asset({}))).toBe("outdated");
    // Bytes que no son ni la prueba ni verificables contra ella, con el
    // tamaño del pin vigente: la vía rápida decide por tamaño (J3S-1).
    writeCorpusFile("prueba.sqlite", Buffer.alloc(100, 9));
    expect(await packFileState(asset({}))).toBe("current");
    // Y si la prueba ES el pin vigente, manda la puerta normal.
    writeFileSync(
      join(corpus, "pack-install-records.json"),
      JSON.stringify({ prueba: { sizeBytes: 100, sha256: "a".repeat(64), mtimeMs: null } }),
    );
    expect(await packFileState(asset({}))).toBe("current");
  });
});

describe("J3S-1 · la sustitución tras la importación, contra la apertura", () => {
  it("la sustitución de OTRO tamaño no abre; la del MISMO tamaño abre por la vía rápida (letra estrechada)", async () => {
    const genuine = buildPack(join(corpus, "tienda.sqlite"));
    writeCorpusFile("tienda.sqlite", genuine);
    await writeImportedPacks({ "tienda.sqlite": recordFor(genuine) });
    // El genuino sirve su guía.
    expect((await listPackGuides("local-tienda")).length).toBe(1);
    const doc = await readPackSource("pack:local-tienda:1");
    expect(JSON.stringify(doc)).toContain("CUERPO-GENUINO");
    await closeAllPacks();

    // Otro tamaño: la puerta lo caza y no abre.
    writeCorpusFile("tienda.sqlite", genuine.subarray(0, genuine.length - 500));
    bumpMtime(join(corpus, "tienda.sqlite"));
    expect(await packFileState((await knowledgePacks()).find((p) => p.id === "local-tienda")!)).toBe("unusable");
    expect(await listPackGuides("local-tienda")).toEqual([]);
    await closeAllPacks();

    // El mismo tamaño, cuerpo mutado: la vía «current» decide por
    // tamaño, fiel al móvil, y la apertura SIRVE el cuerpo mutado.
    // Este es el resultado que la forma (b) de la partida asienta:
    // la acreditación se estrecha a lo que la puerta cobra.
    const mutated = mutateSameSize(genuine);
    writeCorpusFile("tienda.sqlite", mutated);
    bumpMtime(join(corpus, "tienda.sqlite"));
    expect(await packFileState((await knowledgePacks()).find((p) => p.id === "local-tienda")!)).toBe("current");
    const served = await readPackSource("pack:local-tienda:1");
    expect(JSON.stringify(served)).toContain("CUERPO-MUTADO");
  });
});

describe("J5S-1 · el experimento hermano contra verifiedImportedPacks", () => {
  it("la marca sigue a la misma puerta: genuino dentro, otro tamaño fuera, mismo tamaño dentro, sizeBytes 0 por presencia", async () => {
    const genuine = buildPack(join(corpus, "tienda.sqlite"));
    writeCorpusFile("tienda.sqlite", genuine);
    await writeImportedPacks({ "tienda.sqlite": recordFor(genuine) });
    expect((await verifiedImportedPacks()).has("local-tienda")).toBe(true);

    writeCorpusFile("tienda.sqlite", genuine.subarray(0, genuine.length - 500));
    bumpMtime(join(corpus, "tienda.sqlite"));
    expect((await verifiedImportedPacks()).has("local-tienda")).toBe(false);

    writeCorpusFile("tienda.sqlite", mutateSameSize(genuine));
    bumpMtime(join(corpus, "tienda.sqlite"));
    expect((await verifiedImportedPacks()).has("local-tienda")).toBe(true);

    await writeImportedPacks({
      "tienda.sqlite": { origin: "salvora", sha256: "f".repeat(64), sizeBytes: 0, name: "Pack de prueba", importedAt: "2026-11-17T00:00:00.000Z" },
    });
    expect((await verifiedImportedPacks()).has("local-tienda")).toBe(true);
  });
});

describe("J3S-2 · la contención de la resolución", () => {
  it("packsDataPath rechaza todo nombre que resuelve fuera del directorio de datos", () => {
    expect(() => packsDataPath("corpus/../../fuera.sqlite")).toThrow(PackPathRefusal);
    expect(() => resolvePackPath("../fuera.sqlite")).toThrow(PackPathRefusal);
    expect(() => packsDataPath("/etc/passwd")).toThrow(PackPathRefusal);
    expect(packsDataPath("corpus/dentro.sqlite")).toBe(join(root, "corpus", "dentro.sqlite"));
  });

  it("la clave con ../../ y pin casado por tamaño ya no sirve el fichero de fuera", async () => {
    // El fichero de fuera: un paquete válido, fuera del directorio.
    const outside = buildPack(join(root, "..", "fuera-del-directorio.sqlite"));
    const outsidePath = join(root, "..", "fuera-del-directorio.sqlite");
    writeFileSync(outsidePath, outside);
    const clave = "../../fuera-del-directorio.sqlite";
    await writeImportedPacks({
      [clave]: { origin: "salvora", sha256: "f".repeat(64), sizeBytes: outside.length, name: "Fuera", importedAt: "2026-11-17T00:00:00.000Z" },
    });
    const entry = (await knowledgePacks()).find((p) => p.filename === `corpus/${clave}`);
    expect(entry).toBeDefined();
    expect(await packFileState(entry!)).toBe("unusable");
    expect((await verifiedImportedPacks()).size).toBe(0);
    expect(await listPackGuides(entry!.id)).toEqual([]);
    expect(await readPackSource(`pack:${entry!.id}:1`)).toBeNull();
    rmSync(outsidePath, { force: true });
    expect(existsSync(outsidePath)).toBe(false);
  });
});

describe("J3S-4 · readPackSource ante el esquema desviado", () => {
  it("un pack abrible cuya tabla chunks no trae la columna source degrada a null, no rechaza", async () => {
    const bytes = buildPack(join(corpus, "desviado.sqlite"), { withSource: false });
    writeCorpusFile("desviado.sqlite", bytes);
    await writeImportedPacks({ "desviado.sqlite": recordFor(bytes) });
    await expect(readPackSource("pack:local-desviado:1")).resolves.toBeNull();
  });

  it("control: el pack gemelo con la columna source sí sirve su documento", async () => {
    const bytes = buildPack(join(corpus, "sano.sqlite"), { withSource: true });
    writeCorpusFile("sano.sqlite", bytes);
    await writeImportedPacks({ "sano.sqlite": recordFor(bytes) });
    const doc = await readPackSource("pack:local-sano:1");
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).toContain("CUERPO-GENUINO");
  });
});
