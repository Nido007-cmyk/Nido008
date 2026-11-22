/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería del censo (paso 3 de E4): las pruebas 8 y 9
 * (censo de modelos) y 19 a 21 (censo de activos y su
 * regresión) de la hoja de la etapa
 * (estudios/MODELOS-ETAPA.md §5). Sin disco real: los
 * hechos de disco se fabrican en una costura falsa.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AssetEntry } from "./assetCatalog.js";
import type { CatalogEntry } from "./catalog.js";
import { censusAssets, censusModels, type LibraryFs } from "./library.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

class FakeFs implements LibraryFs {
  files = new Map<string, Buffer>();
  dirs = new Set<string>();
  async list(dir: string): Promise<string[]> {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    const out = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        if (rest) out.add(rest.split("/")[0]);
      }
    }
    return [...out];
  }
  async size(path: string): Promise<number | null> {
    return this.files.get(path)?.length ?? null;
  }
  async isDirectory(path: string): Promise<boolean> {
    return this.dirs.has(path);
  }
  async hash(path: string): Promise<string> {
    const b = this.files.get(path);
    if (!b) throw new Error(`missing ${path}`);
    return sha(b);
  }
}

const MODELS = "/models";
const ASSETS = "/assets";
const payload = Buffer.from("contenido del modelo de prueba");
const tinyModel: CatalogEntry = {
  id: "tiny",
  label: "Tiny",
  kind: "llm",
  fileBytes: payload.length,
  arch: { layers: 1, kvHeads: 1, headDim: 8, vocab: 100 },
  maxContext: 2048,
  license: "MIT",
  sourceUrl: "https://example.invalid/tiny.gguf",
  revision: "test",
  sha256: sha(payload),
  role: "light",
  note: "fixture",
};

describe("paso 3 · censo de modelos", () => {
  it("prueba 8 · cada hecho de disco da su estado: parcial, instalado sin verificar, instalado verificado, ausente", async () => {
    const fs = new FakeFs();
    // Ausente: directorio vacío.
    let census = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(census.get("tiny")).toEqual({ kind: "absent" });

    // Parcial: el temporal con N bytes.
    fs.files.set(`${MODELS}/tiny.gguf.part`, Buffer.from("12345"));
    census = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(census.get("tiny")).toEqual({ kind: "partial", bytes: 5 });

    // Instalado sin verificar: nombre final y tamaño exacto,
    // sin petición de huella.
    fs.files.delete(`${MODELS}/tiny.gguf.part`);
    fs.files.set(`${MODELS}/tiny.gguf`, payload);
    census = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(census.get("tiny")).toEqual({
      kind: "installed",
      bytes: payload.length,
      verified: false,
      source: "scan",
    });

    // Instalado verificado: con petición de huella y la
    // huella buena.
    census = await censusModels(MODELS, { fs, catalog: [tinyModel], verifyHashes: true });
    expect(census.get("tiny")).toEqual({
      kind: "installed",
      bytes: payload.length,
      verified: true,
      source: "scan",
    });

    // Tamaño distinto con el nombre final: no es instalado.
    fs.files.set(`${MODELS}/tiny.gguf`, Buffer.from("otro tamaño"));
    census = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(census.get("tiny")?.kind).toBe("partial");
  });

  it("prueba 9 · el censo es sin estado: un fichero que cambia entre dos censos cambia su estado", async () => {
    const fs = new FakeFs();
    fs.files.set(`${MODELS}/tiny.gguf.part`, Buffer.from("123"));
    const before = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(before.get("tiny")).toEqual({ kind: "partial", bytes: 3 });
    fs.files.delete(`${MODELS}/tiny.gguf.part`);
    fs.files.set(`${MODELS}/tiny.gguf`, payload);
    const after = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(after.get("tiny")?.kind).toBe("installed");
  });
});

// --- Activos: una entrada de archivo de dos ficheros y una suelta. ---
const aPayload = Buffer.from("fichero a del activo");
const bPayload = Buffer.from("fichero b del activo");
const archiveAsset: AssetEntry = {
  id: "activo-archivo",
  label: "Activo Archivo",
  kind: "asr",
  license: "MIT",
  sourceUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/activo.tar.bz2",
  revision: "asr-models",
  archiveBytes: 1000,
  archiveSha256: sha(Buffer.from("el tarball")),
  files: [
    { path: "a.onnx", bytes: aPayload.length, sha256: sha(aPayload) },
    { path: "sub/b.txt", bytes: bPayload.length, sha256: sha(bPayload) },
  ],
  note: "fixture",
};
const loosePayload = Buffer.from("el fichero suelto");
const looseAsset: AssetEntry = {
  id: "suelto",
  label: "Suelto",
  kind: "vad",
  license: "MIT",
  sourceUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/suelto.onnx",
  revision: "asr-models",
  archiveBytes: loosePayload.length,
  archiveSha256: sha(loosePayload),
  files: [{ path: "suelto.onnx", bytes: loosePayload.length, sha256: sha(loosePayload) }],
  note: "fixture",
};
const ASSET_FIXTURES = [archiveAsset, looseAsset];
const installArchive = (fs: FakeFs) => {
  fs.dirs.add(`${ASSETS}/activo-archivo`);
  fs.dirs.add(`${ASSETS}/activo-archivo/sub`);
  fs.files.set(`${ASSETS}/activo-archivo/a.onnx`, aPayload);
  fs.files.set(`${ASSETS}/activo-archivo/sub/b.txt`, bPayload);
};

describe("paso 3 · censo de activos", () => {
  it("prueba 19 · las fases son estados, y el final con un fichero cambiado es mismatch nombrándolo", async () => {
    const fs = new FakeFs();
    let census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({ kind: "absent" });

    // Descargando: el temporal del archivo con N bytes.
    fs.files.set(`${ASSETS}/activo-archivo.tar.bz2.part`, Buffer.alloc(400));
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({
      kind: "downloading",
      bytes: 400,
      totalBytes: 1000,
    });

    // Instalando: el directorio de paso manda sobre el temporal.
    fs.dirs.add(`${ASSETS}/activo-archivo.part`);
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({ kind: "installing" });

    // Instalado: el árbol final verificado fichero a fichero;
    // los restos se reportan como residuo, no como estado.
    installArchive(fs);
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({ kind: "installed", verified: true });
    expect(census.get("activo-archivo")?.residue).toEqual([
      "activo-archivo.tar.bz2.part",
      "activo-archivo.part",
    ]);

    // Un fichero cambiado (mismo tamaño, otros bytes): la
    // huella lo caza y el mismatch nombra ese fichero y solo ese.
    fs.files.set(`${ASSETS}/activo-archivo/a.onnx`, Buffer.alloc(aPayload.length, 7));
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({
      kind: "mismatch",
      changedFiles: ["a.onnx"],
    });
  });

  it("prueba 19 (suelto, VA-02) · el suelto se mide sobre el temporal de su propio fichero y no conoce paso", async () => {
    const fs = new FakeFs();
    fs.files.set(`${ASSETS}/suelto.onnx.part`, Buffer.alloc(3));
    let census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("suelto")?.state).toEqual({
      kind: "downloading",
      bytes: 3,
      totalBytes: loosePayload.length,
    });
    fs.files.delete(`${ASSETS}/suelto.onnx.part`);
    fs.files.set(`${ASSETS}/suelto.onnx`, loosePayload);
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("suelto")?.state).toEqual({ kind: "installed", verified: true });
  });

  it("prueba 20 · lo ajeno no invalida ni aparece; lo ausente del manifiesto es mismatch con su ruta", async () => {
    const fs = new FakeFs();
    installArchive(fs);
    fs.files.set(`${ASSETS}/activo-archivo/ajeno.bin`, Buffer.from("no es del manifiesto"));
    let census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({ kind: "installed", verified: true });

    fs.files.delete(`${ASSETS}/activo-archivo/sub/b.txt`);
    census = await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    expect(census.get("activo-archivo")?.state).toEqual({
      kind: "mismatch",
      changedFiles: ["sub/b.txt"],
    });
  });

  it("prueba 21 · los GGUF no se enteran: el censo de modelos devuelve lo mismo con el de activos al lado", async () => {
    const fs = new FakeFs();
    fs.files.set(`${MODELS}/tiny.gguf.part`, Buffer.from("12345"));
    installArchive(fs);
    const before = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    await censusAssets(ASSETS, { fs, catalog: ASSET_FIXTURES });
    const after = await censusModels(MODELS, { fs, catalog: [tinyModel] });
    expect(after).toEqual(before);
    expect(after.get("tiny")).toEqual({ kind: "partial", bytes: 5 });
  });
});
