/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packSection.test.ts — la batería propia del paso 8 de E5: la
 * composición de la sección de paquetes de Ajustes, no sus
 * fuentes. Las fuentes (la puerta de apertura `packFileState`,
 * el núcleo de origen, los dos registros, la puerta de fichero y
 * el descargador) tienen sus baterías dueñas y aquí no se
 * re-cobra ni un caso suyo: el rojo de esta batería es de la
 * composición — la lista unificada de las tres fuentes, el
 * estado derivado en cada llamada, las acciones por la puerta
 * real, la nota en su segunda sede y el Vital en sus dos formas.
 *
 * Cada caso corre sobre un directorio de datos temporal propio
 * por la costura de la casa (setPacksDataDir), con los paquetes
 * sintéticos de la forma de la batería dueña de la puerta de
 * fichero (esquema v2, clave fixture en memoria).
 */
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPacksDataDir } from "../models/dataDir.js";
import { readImportedPacks, writeImportedPacks } from "../models/importedPacksRegistry.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";
import {
  canonicalPackManifestJSON,
  type PackManifest,
  type PackOrigin,
} from "../models/packImport.js";
import { BASE_ADDRESS, SALVORA_NOTE, SOLANA_ADDRESS } from "../content/support.js";
import { closeAllPacks } from "../rag/packs.js";
import {
  derivePackSectionRows,
  importPackRow,
  installPackRow,
  packSectionNote,
  removePackRow,
  type PackSectionDoor,
  type PackSectionRow,
} from "./packSection.js";

const E5_SHA = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const CUERPO = "Ante una quemadura leve, pon la zona bajo agua fría durante diez minutos.";

let root = "";
let corpus = "";
let staging = "";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Fixtures: la clave y el paquete sintético, en la forma de la
// batería dueña de la puerta de fichero.
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

function signedManifest(id: string, bytes: Buffer, kp: FixtureKey): string {
  const m: PackManifest = {
    id,
    sha256: sha256Hex(bytes),
    sizeBytes: bytes.length,
    signedBy: "SALVORA PACKS",
    signingPublicKey: kp.publicB64,
    signedAt: "2026-11-17T00:00:00.000Z",
  };
  const sig = kp.sign(new TextEncoder().encode(canonicalPackManifestJSON(m)));
  return JSON.stringify({ ...m, signature: sig.toString("base64") });
}

function buildPack(file: string, name = "Pack de prueba"): Buffer {
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
  meta.run("name", name);
  meta.run("embeddingModelSha256", E5_SHA);
  meta.run("dims", "2");
  db.prepare(
    "INSERT INTO chunks (id, title, body, source, scale, vec, guide, keys) VALUES (1, 'Quemadura leve', ?, 'fuente', '1', ?, 1, 'quemadura leve')",
  ).run(CUERPO, new Uint8Array(new Int8Array([127, 0]).buffer));
  db.prepare("INSERT INTO chunks_fts (rowid, title, body, keys) VALUES (1, 'Quemadura leve', ?, 'quemadura leve')").run(CUERPO);
  db.prepare(
    "INSERT INTO guides (id, key, lang, title, category, region, sources, verified) VALUES (1, 'quemadura', 'es', 'Quemadura leve', 'prueba', '', 'fuente', '2026-01-01')",
  ).run();
  db.close();
  return readFileSync(file);
}

function stage(filename: string, bytes: Buffer, manifestText: string | null): string {
  const path = join(staging, filename);
  writeFileSync(path, bytes);
  if (manifestText !== null) writeFileSync(`${path}.json`, manifestText);
  return path;
}

const accept = async (): Promise<boolean> => true;

function catalogEntry(partial: Partial<PackCatalogEntry> & { id: string }): PackCatalogEntry {
  return {
    kind: "corpus",
    format: "sqlite-pack",
    label: `Pack ${partial.id}`,
    filename: `corpus/${partial.id}.sqlite`,
    sizeBytes: 1000,
    sha256: "0".repeat(64),
    sourceUrl: "https://example.invalid/pack.sqlite",
    license: "CC BY 4.0 (NIDO)",
    description: "fixture",
    required: false,
    ...partial,
  } as PackCatalogEntry;
}

function seedCatalogFile(entry: PackCatalogEntry, bytes: Buffer): void {
  writeFileSync(join(root, entry.filename), bytes);
}

function diaryPath(): string {
  return join(corpus, "pack-install-records.json");
}

function writeDiary(records: Record<string, unknown>): void {
  writeFileSync(diaryPath(), JSON.stringify(records));
}

function corpusListing(): string[] {
  return existsSync(corpus) ? readdirSync(corpus).sort() : [];
}

const derivationSource = () =>
  readFileSync(fileURLToPath(new URL("./packSection.ts", import.meta.url)), "utf8");

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".tmp-vitest"), { recursive: true });
  root = mkdtempSync(join(process.cwd(), ".tmp-vitest", "packsection-"));
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
// Grupo A · La lista unificada nace de las tres fuentes (5)
// ---------------------------------------------------------------------------

describe("grupo A · la lista unificada de las tres fuentes", () => {
  it("A1 · una familia que ningún papel nombra entra por su entrada, sin enumeración en la derivación", async () => {
    const entry = catalogEntry({ id: "lugares-agua-inesperado" });
    const rows = await derivePackSectionRows([entry]);
    const row = rows.find((r) => r.key === "lugares-agua-inesperado");
    expect(row).toBeDefined();
    expect(row!.kind).toBe("catalog");
    expect(row!.origin).toBe("nido");
    expect(row!.originLabel).toBe("NIDO");
    expect(row!.state).toBe("available");
    expect(derivationSource()).not.toContain("lugares-agua-inesperado");
  });

  it("A2 · un importado se ve con su procedencia: etiqueta del asiento, nombre y marca de importado", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"), "Guías de la tienda");
    const chosen = stage("tienda.sqlite", bytes, signedManifest("tienda", bytes, kp));
    const outcome = await importPackRow(chosen, accept, undefined, kp.publicB64);
    expect(outcome.status).toBe("imported");
    const rows = await derivePackSectionRows([]);
    const row = rows.find((r) => r.kind === "imported");
    expect(row).toBeDefined();
    expect(row!.origin).toBe("salvora");
    expect(row!.originLabel).toBe("SALVORA PACKS");
    expect(row!.name).toBe("Guías de la tienda");
    expect(row!.importedAt).toBeTruthy();
    expect(row!.canRemove).toBe(true);
  });

  it("A3 · sin asiento no hay paquete: un .sqlite suelto en corpus/ no produce fila", async () => {
    writeFileSync(join(corpus, "suelto.sqlite"), Buffer.alloc(64, 7));
    const rows = await derivePackSectionRows([]);
    expect(rows.find((r) => r.key === "suelto.sqlite")).toBeUndefined();
    expect(rows).toEqual([]);
  });

  it("A4 · un asiento bajo nombre de catálogo no duplica: una sola fila, la del catálogo", async () => {
    const entry = catalogEntry({ id: "nido-local-e5", filename: "corpus/nido-local-e5.sqlite" });
    seedCatalogFile(entry, Buffer.alloc(entry.sizeBytes, 3));
    await writeImportedPacks({
      "nido-local-e5.sqlite": {
        origin: "salvora",
        sha256: "f".repeat(64),
        sizeBytes: entry.sizeBytes,
        name: "No debe verse",
        importedAt: "2026-11-17T00:00:00.000Z",
      },
    });
    const rows = await derivePackSectionRows([entry]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("catalog");
    expect(rows[0].key).toBe("nido-local-e5");
  });

  it("A5 · el registro ilegible lee vacío: la derivación no lanza y no abre la vía", async () => {
    writeFileSync(join(corpus, "imported-packs.json"), "{ esto no es json");
    const entry = catalogEntry({ id: "nido-esencial-e5" });
    const rows = await derivePackSectionRows([entry]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("catalog");
    expect(rows.find((r) => r.kind === "imported")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Grupo B · El estado se cobra de su fuente (5)
// ---------------------------------------------------------------------------

describe("grupo B · el estado derivado de su fuente", () => {
  it("B1 · al día, por la puerta: packFileState current y sin ofrecer instalar", async () => {
    const entry = catalogEntry({ id: "al-dia" });
    seedCatalogFile(entry, Buffer.alloc(entry.sizeBytes, 1));
    const rows = await derivePackSectionRows([entry]);
    expect(rows[0].state).toBe("current");
    expect(rows[0].canInstall).toBe(false);
    expect(rows[0].canRemove).toBe(false);
  });

  it("B2 · versión anterior en uso: outdated contra la prueba del diario, con actualizar disponible", async () => {
    const entry = catalogEntry({ id: "anterior", sizeBytes: 1000 });
    const oldBytes = Buffer.alloc(900, 5);
    seedCatalogFile(entry, oldBytes);
    const mtimeMs = statSync(join(root, entry.filename)).mtimeMs;
    writeDiary({
      anterior: { sizeBytes: 900, sha256: sha256Hex(oldBytes), mtimeMs, filename: entry.filename },
    });
    const rows = await derivePackSectionRows([entry]);
    expect(rows[0].state).toBe("outdated");
    expect(rows[0].canInstall).toBe(true);
    expect(rows[0].canRemove).toBe(false);
  });

  it("B3 · disponible, sin fichero: ofrece instalar, no quitar, y no se presenta como instalada", async () => {
    const entry = catalogEntry({ id: "ausente" });
    const rows = await derivePackSectionRows([entry]);
    expect(rows[0].state).toBe("available");
    expect(rows[0].canInstall).toBe(true);
    expect(rows[0].canRemove).toBe(false);
  });

  it("B4 · el importado rancio no se lista; el presente y verificado produce su fila con quitar", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    await importPackRow(chosen, accept, undefined, kp.publicB64);
    let rows = await derivePackSectionRows([]);
    const row = rows.find((r) => r.kind === "imported");
    expect(row).toBeDefined();
    expect(row!.verified).toBe(true);
    expect(row!.canRemove).toBe(true);
    rmSync(join(corpus, "quemadura.sqlite"), { force: true });
    rows = await derivePackSectionRows([]);
    expect(rows.find((r) => r.kind === "imported")).toBeUndefined();
  });

  it("B5 · el estado se deriva, no se guarda: sin el asiento del diario la fila se recomputa", async () => {
    const entry = catalogEntry({ id: "recomputa", sizeBytes: 1000 });
    const oldBytes = Buffer.alloc(900, 9);
    seedCatalogFile(entry, oldBytes);
    const mtimeMs = statSync(join(root, entry.filename)).mtimeMs;
    writeDiary({
      recomputa: { sizeBytes: 900, sha256: sha256Hex(oldBytes), mtimeMs, filename: entry.filename },
    });
    let rows = await derivePackSectionRows([entry]);
    expect(rows[0].state).toBe("outdated");
    rmSync(diaryPath(), { force: true });
    rows = await derivePackSectionRows([entry]);
    expect(rows[0].state).toBe("unusable");
    expect(rows[0].canInstall).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grupo C · Las acciones ejercen la puerta real (5)
// ---------------------------------------------------------------------------

describe("grupo C · las acciones por la puerta", () => {
  it("C1 · instalar pasa la entrada exacta de la fila a downloadPack y la fila se re-deriva", async () => {
    const entry = catalogEntry({ id: "instala" });
    const rows = await derivePackSectionRows([entry]);
    const seen: PackCatalogEntry[] = [];
    const door: PackSectionDoor = {
      download: async (e) => {
        seen.push(e);
        return { file: e.filename, bytes: e.sizeBytes, resumedFrom: 0 };
      },
      importFile: async () => ({ status: "cancelled" }) as const,
      remove: async () => {},
    };
    await installPackRow(rows[0], door);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(rows[0].entry);
    seedCatalogFile(entry, Buffer.alloc(entry.sizeBytes, 2));
    const after = await derivePackSectionRows([entry]);
    expect(after[0].state).toBe("current");
  });

  it("C2 · la confirmación recibe el origen verificado y su no corta la copia en un byte", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("tienda.sqlite", bytes, signedManifest("tienda", bytes, kp));
    const beforeListing = corpusListing();
    const origins: PackOrigin[] = [];
    const outcome = await importPackRow(
      chosen,
      async (origin) => {
        origins.push(origin);
        return false;
      },
      undefined,
      kp.publicB64,
    );
    expect(outcome).toEqual({ status: "cancelled" });
    expect(origins).toEqual(["salvora"]);
    expect(corpusListing()).toEqual(beforeListing);
    expect(await readImportedPacks()).toEqual({});
  });

  it("C3 · quitar cobra los tres borrados: fichero, asiento del registro y asiento del diario", async () => {
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("quemadura.sqlite", bytes, signedManifest("quemadura", bytes, kp));
    await importPackRow(chosen, accept, undefined, kp.publicB64);
    const rows = await derivePackSectionRows([]);
    const row = rows.find((r) => r.kind === "imported") as PackSectionRow;
    expect(await removePackRow(row)).toBe(true);
    expect(existsSync(join(corpus, "quemadura.sqlite"))).toBe(false);
    expect(await readImportedPacks()).toEqual({});
    const diary = existsSync(diaryPath())
      ? (JSON.parse(readFileSync(diaryPath(), "utf8")) as Record<string, unknown>)
      : {};
    expect(diary["local-quemadura"]).toBeUndefined();
  });

  it("C4 · quitar no existe en filas de catálogo: la acción se niega y el fichero queda intacto", async () => {
    const entry = catalogEntry({ id: "intocable" });
    seedCatalogFile(entry, Buffer.alloc(entry.sizeBytes, 4));
    const rows = await derivePackSectionRows([entry]);
    expect(rows[0].canRemove).toBe(false);
    expect(await removePackRow(rows[0])).toBe(false);
    expect(existsSync(join(root, entry.filename))).toBe(true);
  });

  it("C5 · un rechazo se enseña con su razón y sin residuo", async () => {
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("huerfano.sqlite", bytes, null);
    const outcome = await importPackRow(chosen, accept);
    expect(outcome).toEqual({ status: "rejected", reason: "missing-manifest" });
    expect(corpusListing()).not.toContain("huerfano.sqlite");
    expect(corpusListing()).not.toContain("huerfano.sqlite.part");
    expect(await readImportedPacks()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Grupo D · La nota en su segunda sede (4)
// ---------------------------------------------------------------------------

describe("grupo D · la nota de SALVORA en su segunda sede", () => {
  it("D1 · presencia y forma: texto de la sección, sin direcciones ni forma de compra", () => {
    const note = packSectionNote("es");
    expect(note).toContain("salvorapacks.com");
    expect(note).not.toContain(SOLANA_ADDRESS);
    expect(note).not.toContain(BASE_ADDRESS);
  });

  it("D2 · el marco entero en los tres idiomas, sin afirmación de desbloqueo", () => {
    const frames: Record<string, string[]> = {
      es: ["es gratuito", "no desbloquea nada", "no hay contenido bloqueado", "puerta firmada"],
      en: ["is free", "unlocks nothing", "no locked content", "signed door"],
      pt: ["é gratuito", "não desbloqueia nada", "não há conteúdo bloqueado", "porta assinada"],
    };
    for (const lang of ["es", "en", "pt"] as const) {
      const note = packSectionNote(lang);
      for (const clause of frames[lang]) expect(note).toContain(clause);
    }
  });

  it("D3 · una sola fuente para las dos sedes: la sección sirve el texto de la fuente, carácter a carácter", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      expect(packSectionNote(lang)).toBe(SALVORA_NOTE[lang]);
    }
    expect(derivationSource()).not.toContain("contenido bloqueado");
    expect(derivationSource()).not.toContain("no locked content");
    expect(derivationSource()).not.toContain("conteúdo bloqueado");
  });

  it("D4 · la nota no bloquea ningún flujo: las acciones corren igual con ella presente", async () => {
    for (const lang of ["es", "en", "pt"] as const) void packSectionNote(lang);
    const kp = fixtureKeyPair();
    const bytes = buildPack(join(staging, "build.sqlite"));
    const chosen = stage("flujo.sqlite", bytes, signedManifest("flujo", bytes, kp));
    const outcome = await importPackRow(chosen, accept, undefined, kp.publicB64);
    expect(outcome.status).toBe("imported");
    const rows = await derivePackSectionRows([]);
    const row = rows.find((r) => r.kind === "imported") as PackSectionRow;
    expect(await removePackRow(row)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grupo E · El Vital en sus dos formas (3)
// ---------------------------------------------------------------------------

describe("grupo E · el Vital en sus dos formas", () => {
  const VITAL_E5_PIN = "15cd1b2a2b5e3ec141778a1b5fe943f0f1bbe91bcf5131df86ab36274b74e4d2";
  const VITAL_BASE_PIN = "c5f32a6ed86aa5d0ec7211ae53ac52811b8b63f74ba52232d1aea97ac98d2996";
  const VITAL_SIZE = 163647488;

  function seedVitalArtifact(filename: string, sourceName: string): void {
    const src = join(process.env.HOME ?? "", "workspace", "vital-reedicion-tmp", sourceName);
    const dst = join(corpus, filename);
    try {
      linkSync(src, dst);
    } catch {
      copyFileSync(src, dst);
    }
  }

  it("E1 · forma reedición: con los pines nuevos y el artefacto reeditado en el sitio, el Vital entra al día", async () => {
    const e5 = catalogEntry({
      id: "wiki-vital5-e5",
      filename: "corpus/wiki-vital5-e5.sqlite",
      sizeBytes: VITAL_SIZE,
      sha256: VITAL_E5_PIN,
    });
    const base = catalogEntry({
      id: "wiki-vital5",
      filename: "corpus/wiki-vital5.sqlite",
      sizeBytes: VITAL_SIZE,
      sha256: VITAL_BASE_PIN,
    });
    seedVitalArtifact("wiki-vital5-e5.sqlite", "wiki-vital5-e5.sqlite");
    seedVitalArtifact("wiki-vital5.sqlite", "wiki-vital5.sqlite");
    const rows = await derivePackSectionRows([base, e5]);
    expect(rows.find((r) => r.key === "wiki-vital5")!.state).toBe("current");
    expect(rows.find((r) => r.key === "wiki-vital5-e5")!.state).toBe("current");
  });

  it("E2 · forma retirada: sin las entradas no hay fila del Vital, y su fichero legado sin asiento no produce fila", async () => {
    writeFileSync(join(corpus, "wiki-vital5-e5.sqlite"), Buffer.alloc(128, 6));
    const rows = await derivePackSectionRows([catalogEntry({ id: "nido-esencial-e5" })]);
    expect(rows.find((r) => r.key.includes("vital"))).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it("E3 · el pin legado no es valor esperado en ninguna parte del código del paso ni de su batería", () => {
    const legacy = [
      "6eda30df", "c736faaa", "d2925ada", "3f346a51",
      "e0211e57", "353e9842", "ccb89788", "5da33886",
    ].join("");
    expect(legacy).toHaveLength(64);
    expect(derivationSource()).not.toContain(legacy);
    const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(ownSource).not.toContain(legacy);
  });
});
