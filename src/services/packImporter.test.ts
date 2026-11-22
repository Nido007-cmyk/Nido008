/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packImporter.test.ts — la puerta de fichero de paquetes (paso 7
 * de E5): los tres casos del §5.1 de PAQUETES-ETAPA.md por la
 * puerta completa, no solo por el núcleo, con la carpeta de
 * paquetes inspeccionada tras cada rechazo (nada se copió), y las
 * baterías que el orden PI-2 y la retirada PI-4 traen
 * (duplicados definidos, edición actualizada, la retirada con
 * sus tres borrados).
 *
 * Los casos de siempre corren con paquetes sintéticos válidos
 * (esquema v2 entero, construidos con node:sqlite) firmados con
 * una clave fixture generada en memoria, por la costura de test
 * del núcleo: la aceptación por firma queda cubierta sin los
 * zips de la tienda, y los rechazos por clave extranjera corren
 * contra la clave incrustada de producción, sin costura. Los
 * casos de bytes reales (§5.2) corren solo si los zips de la
 * tienda están en su sitio (describe.runIf, como en
 * packImport.test.ts): los cuatro paquetes reales por la puerta
 * entera con su origen, el manipulado y el truncado, el
 * manifiesto re-firmado con clave extranjera y el manifiesto
 * grapado de otro fichero, y la guarda del nombre de catálogo.
 *
 * Cada caso corre sobre un directorio de datos temporal propio
 * por la costura de la casa (setPacksDataDir), con la copia
 * elegida en una carpeta de staging fuera de corpus/: nada de
 * lo aquí escrito es una instalación de la casa, son fixtures
 * de batería sobre la puerta real.
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPacksDataDir } from "../models/dataDir.js";
import { readImportedPacks } from "../models/importedPacksRegistry.js";
import {
  canonicalPackManifestJSON,
  PACK_IMPORT_MAX_BYTES,
  SALVORA_PACKS_PUBLIC_KEY_BASE64,
  type PackManifest,
  type PackOrigin,
} from "../models/packImport.js";
import { closeAllPacks, knowledgePacks, listPackGuides, readPackSource, searchPacks } from "../rag/packs.js";
import {
  importPackFromFile,
  listImportedPacks,
  removeImportedPack,
  verifiedImportedPacks,
  type PackImportOutcome,
} from "./packImporter.js";

const E5_SHA = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
// Los casos de bytes reales mueven megabytes (inflar el zip, hashear,
// copiar, abrir) y el de la edición actualizada encadena tres
// importaciones: plazo explícito, en la forma de la casa (HEAVY).
const HEAVY = 120_000;
const CUERPO_A = "Ante una quemadura leve, pon la zona bajo agua fría durante diez minutos.";
const CUERPO_B = "Ante una quemadura leve, enfría la zona con agua fría y cúbrela con una gasa estéril.";

let root = "";
let corpus = "";
let staging = "";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Clave fixture y manifiestos firmados (la forma de packImport.test.ts).
// ---------------------------------------------------------------------------

interface FixtureKey {
  publicB64: string;
  sign: (message: Uint8Array) => Buffer;
}

function fixtureKeyPair(): FixtureKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = (publicKey as KeyObject).export({ format: "der", type: "spki" });
  const raw = Buffer.from(spki).subarray(spki.length - 32);
  return {
    publicB64: raw.toString("base64"),
    sign: (message: Uint8Array) => cryptoSign(null, Buffer.from(message), privateKey),
  };
}

/** El manifiesto compañero firmado con la clave dada, en su forma canónica. */
function signedManifest(id: string, bytes: Buffer, kp: FixtureKey, declaredKey?: string): string {
  const m: PackManifest = {
    id,
    sha256: sha256Hex(bytes),
    sizeBytes: bytes.length,
    signedBy: "SALVORA PACKS",
    signingPublicKey: declaredKey ?? kp.publicB64,
    signedAt: "2026-11-17T00:00:00.000Z",
  };
  const sig = kp.sign(new TextEncoder().encode(canonicalPackManifestJSON(m)));
  return JSON.stringify({ ...m, signature: sig.toString("base64") });
}

// ---------------------------------------------------------------------------
// El paquete sintético: esquema v2 entero, con su FTS y su vector.
// ---------------------------------------------------------------------------

interface PackOpts {
  body?: string;
  name?: string;
  format?: string;
  withGuidesTable?: boolean;
  withChunks?: boolean;
}

function buildPack(file: string, opts: PackOpts = {}): Buffer {
  const body = opts.body ?? CUERPO_A;
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE meta (key TEXT, value TEXT)");
  db.exec(
    "CREATE TABLE chunks (id INTEGER PRIMARY KEY, title TEXT, body TEXT, source TEXT, scale TEXT, vec BLOB, guide INTEGER, keys TEXT)",
  );
  db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(title, body, keys)");
  if (opts.withGuidesTable ?? true) {
    db.exec("CREATE TABLE guides (id INTEGER PRIMARY KEY, key TEXT, lang TEXT, title TEXT, category TEXT, region TEXT, sources TEXT, verified TEXT)");
  }
  db.exec("CREATE TABLE regions (code TEXT, names TEXT, aliases TEXT, phrases TEXT)");
  db.exec("CREATE TABLE facts (region TEXT, key TEXT, value TEXT, label TEXT, note TEXT, source_title TEXT, source_url TEXT, quote TEXT, checked TEXT)");
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  meta.run("format", opts.format ?? "nido-knowledge-pack");
  meta.run("formatVersion", "2");
  meta.run("name", opts.name ?? "Pack de prueba");
  meta.run("embeddingModelSha256", E5_SHA);
  meta.run("dims", "2");
  if (opts.withChunks ?? true) {
    db.prepare(
      "INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys) VALUES (1, 'Quemadura leve', ?, 'fuente', '1', ?, 1, 'quemadura leve')",
    ).run(body, new Uint8Array(new Int8Array([127, 0]).buffer));
    db.prepare("INSERT INTO chunks_fts (rowid, title, body, keys) VALUES (1, 'Quemadura leve', ?, 'quemadura leve')").run(body);
    if (opts.withGuidesTable ?? true) {
      db.prepare(
        "INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (1, 'quemadura', 'es', 'Quemadura leve', 'prueba', '', 'fuente', '2026-01-01')",
      ).run();
    }
  }
  db.close();
  return readFileSync(file);
}

/** Deja la copia elegida y su manifiesto compañero en la carpeta de staging. */
function stage(filename: string, bytes: Buffer, manifestText: string | null): string {
  const path = join(staging, filename);
  writeFileSync(path, bytes);
  if (manifestText !== null) writeFileSync(`${path}.json`, manifestText);
  return path;
}

const accept = async (): Promise<boolean> => true;

/** La carpeta de paquetes, inspeccionada: los nombres que hay, ordenados. */
function corpusListing(): string[] {
  return existsSync(corpus) ? readdirSync(corpus).sort() : [];
}

function diary(): Record<string, unknown> {
  const path = join(corpus, "pack-install-records.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
}

/** Tras un rechazo: ni el fichero, ni su .part, ni un solo asiento. */
async function expectNothingCopied(filename: string): Promise<void> {
  expect(corpusListing()).not.toContain(filename);
  expect(corpusListing()).not.toContain(`${filename}.part`);
  expect(await readImportedPacks()).toEqual({});
  expect(diary()).toEqual({});
  expect((await listImportedPacks()).length).toBe(0);
}

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".tmp-vitest"), { recursive: true });
  root = mkdtempSync(join(process.cwd(), ".tmp-vitest", "packdoor-"));
  corpus = join(root, "corpus");
  staging = join(root, "elegidos");
  mkdirSync(corpus, { recursive: true });
  mkdirSync(staging, { recursive: true });
  setPacksDataDir(root);
});

afterEach(async () => {
  await closeAllPacks();
  setPacksDataDir(null);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Los rechazos, por la puerta completa (§5.1.1 y §5.1.2).
// ---------------------------------------------------------------------------

describe("la puerta de fichero · los rechazos, con la carpeta inspeccionada", () => {
  it("un solo byte cambiado cae en hash-mismatch y no se copia nada", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const manifest = signedManifest("tienda", bytes, kp);
    const flipped = Buffer.from(bytes);
    flipped[Math.floor(flipped.length / 2)] ^= 0xff;
    const chosen = stage("tienda.sqlite", flipped, manifest);
    const outcome = await importPackFromFile(chosen, accept, kp.publicB64);
    expect(outcome).toEqual({ status: "rejected", reason: "hash-mismatch" });
    await expectNothingCopied("tienda.sqlite");
  });

  it("la copia truncada cae en hash-mismatch y no se copia nada", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const manifest = signedManifest("tienda", bytes, kp);
    const chosen = stage("tienda.sqlite", bytes.subarray(0, Math.floor(bytes.length / 2)), manifest);
    const outcome = await importPackFromFile(chosen, accept, kp.publicB64);
    expect(outcome).toEqual({ status: "rejected", reason: "hash-mismatch" });
    await expectNothingCopied("tienda.sqlite");
  });

  it("sin manifiesto compañero no hay puerta: missing-manifest, y la confirmación ni se pide", async () => {
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("tienda.sqlite", bytes, null);
    const outcome = await importPackFromFile(chosen, async () => {
      throw new Error("la confirmación no se pide en un rechazo");
    });
    expect(outcome).toEqual({ status: "rejected", reason: "missing-manifest" });
    await expectNothingCopied("tienda.sqlite");
  });

  it("un manifiesto ilegible es un manifiesto ausente: missing-manifest", async () => {
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("tienda.sqlite", bytes, "{ esto no es un manifiesto");
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "missing-manifest",
    });
    await expectNothingCopied("tienda.sqlite");
  });

  it("sin firma y sin pin del catálogo: not-signed-by-us", async () => {
    const bytes = buildPack(join(staging, "build.sqlite"));
    const unsigned = JSON.stringify({ id: "tercero", sha256: sha256Hex(bytes), sizeBytes: bytes.length });
    const chosen = stage("tercero.sqlite", bytes, unsigned);
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "not-signed-by-us",
    });
    await expectNothingCopied("tercero.sqlite");
  });

  it("firmado con clave extranjera, en sus dos disfraces: not-signed-by-us contra la clave incrustada", async () => {
    const foreign = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    // Disfraz 1: declara su propia clave, honestamente extranjera.
    const honest = stage("disfraz1.sqlite", bytes, signedManifest("disfraz", bytes, foreign));
    expect(await importPackFromFile(honest, accept)).toEqual({
      status: "rejected",
      reason: "not-signed-by-us",
    });
    await expectNothingCopied("disfraz1.sqlite");
    // Disfraz 2: declara la NUESTRA como suya, con firma de la extranjera.
    const lying = stage(
      "disfraz2.sqlite",
      bytes,
      signedManifest("disfraz", bytes, foreign, SALVORA_PACKS_PUBLIC_KEY_BASE64),
    );
    expect(await importPackFromFile(lying, accept)).toEqual({
      status: "rejected",
      reason: "not-signed-by-us",
    });
    await expectNothingCopied("disfraz2.sqlite");
  });

  it("el orden de los rechazos: lo que falla la huella y el origen cae en hash-mismatch, no en not-signed-by-us", async () => {
    const foreign = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const other = buildPack(join(staging, "other.sqlite"), { body: CUERPO_B });
    // El manifiesto firmado por la extranjera declara la huella de OTRO
    // fichero: las dos pruebas fallan, y la taxonomía dice cuál manda.
    const m: PackManifest = {
      id: "orden",
      sha256: sha256Hex(other),
      sizeBytes: bytes.length,
      signedBy: "SALVORA PACKS",
      signingPublicKey: foreign.publicB64,
      signedAt: "2026-11-17T00:00:00.000Z",
    };
    const sig = foreign.sign(new TextEncoder().encode(canonicalPackManifestJSON(m)));
    const chosen = stage("orden.sqlite", bytes, JSON.stringify({ ...m, signature: sig.toString("base64") }));
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("orden.sqlite");
  });

  it("un SQLite válido que no declara el formato de paquete: not-a-pack, tras pasar el origen", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"), { format: "otra-cosa" });
    const chosen = stage("raro.sqlite", bytes, signedManifest("raro", bytes, kp));
    expect(await importPackFromFile(chosen, accept, kp.publicB64)).toEqual({
      status: "rejected",
      reason: "not-a-pack",
    });
    await expectNothingCopied("raro.sqlite");
  });

  it("firmado y con formato, pero sin una tabla que los lectores consultan: not-a-pack", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"), { withGuidesTable: false });
    const chosen = stage("roto.sqlite", bytes, signedManifest("roto", bytes, kp));
    expect(await importPackFromFile(chosen, accept, kp.publicB64)).toEqual({
      status: "rejected",
      reason: "not-a-pack",
    });
    await expectNothingCopied("roto.sqlite");
  });

  it("firmado y con formato, pero sin un solo fragmento de contenido: not-a-pack", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"), { withChunks: false });
    const chosen = stage("vacio.sqlite", bytes, signedManifest("vacio", bytes, kp));
    expect(await importPackFromFile(chosen, accept, kp.publicB64)).toEqual({
      status: "rejected",
      reason: "not-a-pack",
    });
    await expectNothingCopied("vacio.sqlite");
  });

  it("por encima del tope de tamaño: too-large, antes del manifiesto y de la huella", async () => {
    // Sin manifiesto compañero a propósito: si la puerta mirara el
    // manifiesto o la huella antes que el tamaño, el veredicto sería
    // otro. El fichero es disperso: el tope se cobra por stat, sin
    // leer un solo byte.
    const chosen = join(staging, "enorme.sqlite");
    writeFileSync(chosen, "");
    truncateSync(chosen, PACK_IMPORT_MAX_BYTES + 1);
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "too-large",
    });
    await expectNothingCopied("enorme.sqlite");
  });

  it("la guarda del nombre de catálogo: bytes verificados de otro bajo el nombre del Esencial caen en hash-mismatch", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    // El origen pasa (firma fixture, por la costura) y aun así el
    // nombre del catálogo solo lo ocupan los bytes de ESA entrada.
    const chosen = stage("nido-esencial-e5.sqlite", bytes, signedManifest("impostor", bytes, kp));
    expect(await importPackFromFile(chosen, accept, kp.publicB64)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("nido-esencial-e5.sqlite");
  });

  it("lo que no es un .sqlite no entra en la puerta: not-a-pack", async () => {
    const chosen = stage("pack.zip", Buffer.from("no es un paquete"), null);
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "not-a-pack",
    });
  });

  it("una copia que no existe: damaged", async () => {
    expect(await importPackFromFile(join(staging, "fantasma.sqlite"), accept)).toEqual({
      status: "rejected",
      reason: "damaged",
    });
  });
});

// ---------------------------------------------------------------------------
// La aceptación y los duplicados (PI-2), y la retirada (PI-4).
// ---------------------------------------------------------------------------

describe("la puerta de fichero · aceptación, duplicados y retirada", () => {
  it("el paquete íntegro se instala por la puerta y se consulta por las dos vías (§5.1.3)", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    const seen: PackOrigin[] = [];
    const outcome = await importPackFromFile(
      chosen,
      async (origin) => {
        seen.push(origin);
        return true;
      },
      kp.publicB64,
    );
    // La confirmación nombró el origen probado, y el resultado trae el ítem.
    expect(seen).toEqual(["salvora"]);
    expect(outcome).toEqual({
      status: "imported",
      item: {
        filename: "quemadura.sqlite",
        name: "Pack de prueba",
        origin: "salvora",
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
      },
    });
    // Los bytes verificados, con su nombre final, byte a byte.
    expect(readFileSync(join(corpus, "quemadura.sqlite"))).toEqual(bytes);
    expect(corpusListing()).not.toContain("quemadura.sqlite.part");
    // El asiento en el registro, con el par verificado por la puerta.
    expect(await readImportedPacks()).toEqual({
      "quemadura.sqlite": {
        origin: "salvora",
        sha256: sha256Hex(bytes),
        sizeBytes: bytes.length,
        name: "Pack de prueba",
        importedAt: expect.any(String),
      },
    });
    // El asiento en el diario, con los bytes ya verificados.
    const seat = diary()["local-quemadura"] as { sizeBytes: number; sha256: string; mtimeMs: number; filename: string };
    expect(seat.sizeBytes).toBe(bytes.length);
    expect(seat.sha256).toBe(sha256Hex(bytes));
    expect(seat.filename).toBe("corpus/quemadura.sqlite");
    expect(seat.mtimeMs).toBeCloseTo(statSync(join(corpus, "quemadura.sqlite")).mtimeMs, -2);
    // Listado con su marca, por las tres superficies.
    const entry = (await knowledgePacks()).find((p) => p.id === "local-quemadura");
    expect(entry?.sha256).toBe(sha256Hex(bytes));
    expect(entry?.sizeBytes).toBe(bytes.length);
    expect(await listImportedPacks()).toEqual([
      {
        filename: "quemadura.sqlite",
        name: "Pack de prueba",
        origin: "salvora",
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
        embeddingModelSha256: E5_SHA,
      },
    ]);
    expect((await verifiedImportedPacks()).get("local-quemadura")).toEqual({
      name: "Pack de prueba",
      origin: "salvora",
    });
    // Instalado no basta, tiene que responder: su guía se sirve entera.
    expect((await listPackGuides("local-quemadura")).length).toBe(1);
    const doc = await readPackSource("pack:local-quemadura:1");
    expect(JSON.stringify(doc)).toContain("agua fría");
    // La vía de palabras clave lo encuentra por su fuente.
    const lexical = await searchPacks("quemadura leve", null, 12);
    expect(lexical.lexical.map((c) => c.chunkId)).toContain("pack:local-quemadura:1");
    // La vía vectorial lo encuentra sin una sola palabra compartida:
    // la pregunta trae otros términos y el vector de la fixture es el
    // que casa (la forma de la batería multilingüe: el vector manda).
    const semantic = await searchPacks("how do plants make their food", new Float32Array([1, 0]), 12);
    expect(semantic.semantic.map((c) => c.chunkId)).toContain("pack:local-quemadura:1");
    expect(semantic.lexical.map((c) => c.chunkId)).not.toContain("pack:local-quemadura:1");
  });

  it("la confirmación denegada cancela: no se copia ni se asienta nada", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    const seen: PackOrigin[] = [];
    const outcome = await importPackFromFile(
      chosen,
      async (origin) => {
        seen.push(origin);
        return false;
      },
      kp.publicB64,
    );
    expect(outcome).toEqual({ status: "cancelled" });
    expect(seen).toEqual(["salvora"]);
    await expectNothingCopied("quemadura.sqlite");
  });

  it("los mismos bytes verificados otra vez: already-imported, sin confirmación y sin tocar nada", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    const first = await importPackFromFile(chosen, accept, kp.publicB64);
    expect(first.status).toBe("imported");
    const registryBefore = readFileSync(join(corpus, "imported-packs.json"), "utf8");
    const mtimeBefore = statSync(join(corpus, "quemadura.sqlite")).mtimeMs;
    const again = await importPackFromFile(
      chosen,
      async () => {
        throw new Error("already-imported no pide confirmación");
      },
      kp.publicB64,
    );
    expect(again).toEqual({
      status: "already-imported",
      item: {
        filename: "quemadura.sqlite",
        name: "Pack de prueba",
        origin: "salvora",
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
      },
    });
    expect(readFileSync(join(corpus, "imported-packs.json"), "utf8")).toBe(registryBefore);
    expect(statSync(join(corpus, "quemadura.sqlite")).mtimeMs).toBe(mtimeBefore);
  });

  it("bytes distintos verificados bajo el mismo nombre: edición actualizada, con la misma confirmación", { timeout: HEAVY }, async () => {
    const kp = fixtureKeyPair();
    const v1 = buildPack(join(staging, "v1.sqlite"), { body: CUERPO_A });
    const first = await importPackFromFile(
      stage("quemadura.sqlite", v1, signedManifest("quemadura", v1, kp)),
      accept,
      kp.publicB64,
    );
    expect(first.status).toBe("imported");

    const v2 = buildPack(join(staging, "v2.sqlite"), { body: CUERPO_B });
    const updated = await importPackFromFile(
      stage("quemadura.sqlite", v2, signedManifest("quemadura", v2, kp)),
      accept,
      kp.publicB64,
    );
    expect(updated.status).toBe("imported");
    expect(readFileSync(join(corpus, "quemadura.sqlite"))).toEqual(v2);
    expect((await readImportedPacks())["quemadura.sqlite"]?.sha256).toBe(sha256Hex(v2));
    await closeAllPacks();
    expect(JSON.stringify(await readPackSource("pack:local-quemadura:1"))).toContain("gasa estéril");

    // Y una tercera edición denegada en la confirmación deja la
    // anterior sirviendo, con su pin intacto.
    const v3 = buildPack(join(staging, "v3.sqlite"), { body: "CUERPO-TERCERO que nunca se instala." });
    const denied = await importPackFromFile(
      stage("quemadura.sqlite", v3, signedManifest("quemadura", v3, kp)),
      async () => false,
      kp.publicB64,
    );
    expect(denied).toEqual({ status: "cancelled" });
    expect(readFileSync(join(corpus, "quemadura.sqlite"))).toEqual(v2);
    expect((await readImportedPacks())["quemadura.sqlite"]?.sha256).toBe(sha256Hex(v2));
  });

  it("la retirada (PI-4) borra el fichero, el asiento del registro y el del diario; re-importar es como la primera vez", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    expect((await importPackFromFile(chosen, accept, kp.publicB64)).status).toBe("imported");
    expect((await listPackGuides("local-quemadura")).length).toBe(1);

    await removeImportedPack("quemadura.sqlite");
    // Los tres borrados, en el mismo acto.
    expect(existsSync(join(corpus, "quemadura.sqlite"))).toBe(false);
    expect(await readImportedPacks()).toEqual({});
    expect(diary()).toEqual({});
    // Y sin asiento no es un paquete: ni listado, ni marca, ni búsqueda.
    expect((await knowledgePacks()).some((p) => p.id === "local-quemadura")).toBe(false);
    expect(await listImportedPacks()).toEqual([]);
    expect((await verifiedImportedPacks()).has("local-quemadura")).toBe(false);
    expect(await listPackGuides("local-quemadura")).toEqual([]);
    const after = await searchPacks("quemadura leve", null, 12);
    expect(after.lexical.map((c) => c.chunkId)).not.toContain("pack:local-quemadura:1");

    // Re-añadirlo funciona exactamente como la primera vez.
    const again = await importPackFromFile(chosen, accept, kp.publicB64);
    expect(again.status).toBe("imported");
    expect((await listPackGuides("local-quemadura")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bytes reales (§5.1 y §5.2): los mismos zips que la batería del móvil.
// ---------------------------------------------------------------------------

const PACKS_DIR = join(homedir(), "workspace/your_files/salvora-packs");
const SALVORA_ZIP =
  process.env.SALVORA_PACK1_ZIP ?? join(PACKS_DIR, "salvora-emergencias-casa-edicion-2026-11.zip");
const ESENCIAL_ZIP = join(PACKS_DIR, "salvora-esencial-edicion-2026-11.zip");
const REAL_ZIPS_PRESENT = existsSync(SALVORA_ZIP) && existsSync(ESENCIAL_ZIP);
if (!REAL_ZIPS_PRESENT) {
  console.warn(
    `[packImporter.test] real store zips NOT found (pack 1: ${SALVORA_ZIP}; esencial: ${ESENCIAL_ZIP})` +
      " — real-bytes cases SKIPPED. Set SALVORA_PACK1_ZIP to the pack-1 zip to run them.",
  );
}

/** Minimal read-only ZIP reader (stored + deflate entries) for fixtures. */
function zipEntries(zipPath: string): Map<string, Buffer> {
  const buf = readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`no end-of-central-directory in ${zipPath}`);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt32LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe.runIf(REAL_ZIPS_PRESENT)("la puerta de fichero · bytes reales de la tienda y del catálogo", () => {
  let salvoraCache: Map<string, Buffer> | undefined;
  let esencialCache: Map<string, Buffer> | undefined;
  const salvora = () => (salvoraCache ??= zipEntries(SALVORA_ZIP));
  const esencial = () => (esencialCache ??= zipEntries(ESENCIAL_ZIP));

  const realCases: Array<{
    zip: () => Map<string, Buffer>;
    sqlite: string;
    origin: PackOrigin;
    catalogId: string | null;
  }> = [
    { zip: salvora, sqlite: "salvora-emergencias-casa.sqlite", origin: "salvora", catalogId: null },
    { zip: salvora, sqlite: "salvora-emergencias-casa-e5.sqlite", origin: "salvora", catalogId: null },
    { zip: esencial, sqlite: "nido-esencial.sqlite", origin: "nido", catalogId: "nido-esencial" },
    { zip: esencial, sqlite: "nido-esencial-e5.sqlite", origin: "nido", catalogId: "nido-esencial-e5" },
  ];

  for (const c of realCases) {
    it(`acepta ${c.sqlite} con origen ${c.origin} por la puerta completa, contra la clave incrustada`, { timeout: HEAVY }, async () => {
      const bytes = c.zip().get(c.sqlite)!;
      const manifestText = c.zip().get(`${c.sqlite}.json`)!.toString("utf8");
      const chosen = stage(c.sqlite, bytes, manifestText);
      const outcome: PackImportOutcome = await importPackFromFile(chosen, accept);
      expect(outcome.status).toBe("imported");
      if (outcome.status !== "imported") return;
      expect(outcome.item.origin).toBe(c.origin);
      expect(outcome.item.sha256).toBe(sha256Hex(bytes));
      expect(outcome.item.name).toBeTruthy();
      // Instalado por esta vía: los bytes verificados con su nombre final.
      expect(readFileSync(join(corpus, c.sqlite))).toEqual(bytes);
      // El diario trae su asiento bajo el id con el que se presenta.
      const seatId = c.catalogId ?? `local-${c.sqlite.replace(/\.sqlite$/, "")}`;
      const seat = diary()[seatId] as { sizeBytes: number; sha256: string } | undefined;
      expect(seat?.sizeBytes).toBe(bytes.length);
      expect(seat?.sha256).toBe(sha256Hex(bytes));
      if (c.catalogId) {
        // Bajo el nombre del catálogo se presenta como el ítem del
        // catálogo, una sola vez, y no como un importado.
        const entries = (await knowledgePacks()).filter((p) => p.filename === `corpus/${c.sqlite}`);
        expect(entries.length).toBe(1);
        expect(entries[0]!.id).toBe(c.catalogId);
        expect((await listImportedPacks()).some((i) => i.filename === c.sqlite)).toBe(false);
        expect((await verifiedImportedPacks()).has(seatId)).toBe(false);
      } else {
        // Un importado de la tienda: listado con su marca y su origen.
        const listed = (await listImportedPacks()).find((i) => i.filename === c.sqlite);
        expect(listed?.origin).toBe("salvora");
        expect((await verifiedImportedPacks()).get(seatId)?.origin).toBe("salvora");
        expect((await knowledgePacks()).find((p) => p.id === seatId)?.sha256).toBe(sha256Hex(bytes));
      }
    });
  }

  it("instalado por la puerta de fichero, el Esencial e5 responde: su guía 63 y la vía semántica con su propio vector", { timeout: HEAVY }, async () => {
    const bytes = esencial().get("nido-esencial-e5.sqlite")!;
    const chosen = stage(
      "nido-esencial-e5.sqlite",
      bytes,
      esencial().get("nido-esencial-e5.sqlite.json")!.toString("utf8"),
    );
    expect((await importPackFromFile(chosen, accept)).status).toBe("imported");
    // El lector lo sirve: las 174 guías y la 63 entera, la de la
    // secuencia de oro de J-6, citada por su fuente.
    expect((await listPackGuides("nido-esencial-e5")).length).toBe(174);
    const doc = await readPackSource("pack:nido-esencial-e5:203");
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).toContain("Atragantamiento");
    // La vía de palabras clave lo encuentra por su fuente.
    const lexical = await searchPacks("atragantamiento", null, 12);
    expect(lexical.lexical.some((c) => c.chunkId.startsWith("pack:nido-esencial-e5:"))).toBe(true);
    // La vía semántica, con el vector del propio trozo 203 como
    // pregunta (la forma de la batería multilingüe: el vector de la
    // fixture es el que casa, aquí el del paquete real): el trozo
    // se encuentra a sí mismo por encima de los pisos sellados.
    const db = new DatabaseSync(join(corpus, "nido-esencial-e5.sqlite"), { readOnly: true });
    const row = db.prepare("SELECT vec FROM chunks WHERE id = 203").get() as { vec: Uint8Array };
    db.close();
    const queryVec = new Float32Array(384);
    const int8 = new Int8Array(row.vec.buffer, row.vec.byteOffset, row.vec.byteLength);
    for (let i = 0; i < 384; i++) queryVec[i] = int8[i]!;
    const semantic = await searchPacks("consulta de control del paquete", queryVec, 12);
    expect(semantic.semantic.map((c) => c.chunkId)).toContain("pack:nido-esencial-e5:203");
  });

  it("el paquete real de SALVORA con un byte cambiado: hash-mismatch y la carpeta intacta", { timeout: HEAVY }, async () => {
    const bytes = Buffer.from(salvora().get("salvora-emergencias-casa.sqlite")!);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const chosen = stage(
      "salvora-emergencias-casa.sqlite",
      bytes,
      salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"),
    );
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("salvora-emergencias-casa.sqlite");
  });

  it("la copia truncada del paquete real de SALVORA: hash-mismatch y la carpeta intacta", { timeout: HEAVY }, async () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!.subarray(0, 100_000);
    const chosen = stage(
      "salvora-emergencias-casa.sqlite",
      bytes,
      salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"),
    );
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("salvora-emergencias-casa.sqlite");
  });

  it("el manifiesto real re-firmado con una clave extranjera: not-signed-by-us por la puerta", { timeout: HEAVY }, async () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!;
    const foreign = fixtureKeyPair();
    const parsed = JSON.parse(salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8")) as PackManifest;
    const forged: PackManifest = { ...parsed, signingPublicKey: foreign.publicB64 };
    const sig = foreign.sign(new TextEncoder().encode(canonicalPackManifestJSON(forged)));
    forged.signature = sig.toString("base64");
    const chosen = stage("salvora-emergencias-casa.sqlite", bytes, JSON.stringify(forged));
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "not-signed-by-us",
    });
    await expectNothingCopied("salvora-emergencias-casa.sqlite");
  });

  it("el manifiesto del Esencial grapado a los bytes de SALVORA: hash-mismatch por la puerta", { timeout: HEAVY }, async () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!;
    const chosen = stage(
      "salvora-emergencias-casa.sqlite",
      bytes,
      esencial().get("nido-esencial.sqlite.json")!.toString("utf8"),
    );
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("salvora-emergencias-casa.sqlite");
  });

  it("los bytes reales de SALVORA renombrados con el nombre del Esencial: la guarda del catálogo los rechaza", { timeout: HEAVY }, async () => {
    const bytes = salvora().get("salvora-emergencias-casa.sqlite")!;
    // Su propio manifiesto, válido y firmado por la nuestra, bajo el
    // nombre de un fichero del catálogo: el origen pasa y la guarda
    // del nombre es la que cae, en hash-mismatch.
    const chosen = stage(
      "nido-esencial-e5.sqlite",
      bytes,
      salvora().get("salvora-emergencias-casa.sqlite.json")!.toString("utf8"),
    );
    expect(await importPackFromFile(chosen, accept)).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
    });
    await expectNothingCopied("nido-esencial-e5.sqlite");
  });
});
