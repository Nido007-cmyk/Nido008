/**
 * Tests del marcador de formato (E2, pasos 0 y 2): el entregable que la
 * prueba de pieza NO validó. Se prueba la escritura atómica, la lectura y
 * la puerta de compatibilidad campo a campo (fail-closed en cada desvío),
 * y que la versión fijada en el código es la instalada de verdad.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DB_FORMAT_VERSION,
  DB_LIBRARY,
  DB_LIBRARY_VERSION,
  FormatMarkerError,
  assertFormatMarkerCompatible,
  buildFormatMarker,
  formatMarkerPath,
  readFormatMarker,
  writeFormatMarker,
} from "./formatMarker.js";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-marker-"));
  dbPath = path.join(dir, "nido.db");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("marcador de formato", () => {
  it("la versión fijada en el código es la versión instalada de la librería", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "node_modules/better-sqlite3-multiple-ciphers/package.json"), "utf8"),
    ) as { version: string };
    expect(pkg.version).toBe(DB_LIBRARY_VERSION);
    const root = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    // Pin exacto, sin rango: la disciplina de §2.2 de la etapa.
    expect(root.dependencies["better-sqlite3-multiple-ciphers"]).toBe(DB_LIBRARY_VERSION);
  });

  it("sin marcador, readFormatMarker devuelve null y la puerta falla cerrada", () => {
    expect(readFormatMarker(dbPath)).toBeNull();
    expect(() => assertFormatMarkerCompatible(dbPath)).toThrow(FormatMarkerError);
  });

  it("escribe y relee el marcador con la configuración sellada", () => {
    const written = writeFormatMarker(dbPath, 4096);
    expect(written.cipher).toBe("sqlcipher");
    expect(written.legacy).toBe(4);
    expect(written.version).toBe(DB_FORMAT_VERSION);
    expect(written.pageSize).toBe(4096);
    expect(existsSync(formatMarkerPath(dbPath))).toBe(true);
    expect(readFormatMarker(dbPath)).toEqual(written);
    expect(assertFormatMarkerCompatible(dbPath)).toEqual(written);
  });

  it("cada campo desviado falla cerrado: cipher, legacy, versión, librería", () => {
    const good = buildFormatMarker(4096);
    const casos: Array<[string, Record<string, unknown>]> = [
      ["cipher sqleet (el defecto de la librería)", { ...good, cipher: "sqleet" }],
      ["legacy 3", { ...good, legacy: 3 }],
      ["versión de formato futura", { ...good, version: DB_FORMAT_VERSION + 1 }],
      ["otra versión de la librería", { ...good, libraryVersion: "99.0.0" }],
      ["otro formato", { ...good, format: "otro-formato" }],
    ];
    for (const [nombre, marker] of casos) {
      writeFileSync(formatMarkerPath(dbPath), JSON.stringify(marker), "utf8");
      expect(() => assertFormatMarkerCompatible(dbPath), nombre).toThrow(FormatMarkerError);
    }
    writeFormatMarker(dbPath, 4096);
    expect(assertFormatMarkerCompatible(dbPath).cipher).toBe("sqlcipher");
  });

  it("un marcador corrupto (no JSON) falla cerrado, no se ignora", () => {
    writeFileSync(formatMarkerPath(dbPath), "{esto no es json", "utf8");
    expect(() => assertFormatMarkerCompatible(dbPath)).toThrow(FormatMarkerError);
    writeFormatMarker(dbPath, 4096);
  });
});

describe("F-PC66 · la identidad de la librería se comprueba, no solo su versión", () => {
  it("un marcador válido pasa la puerta (control)", () => {
    writeFormatMarker(dbPath, 4096);
    expect(assertFormatMarkerCompatible(dbPath).library).toBe(DB_LIBRARY);
  });

  it("library sustituida por otra librería con la misma cadena de versión: FormatMarkerError", () => {
    const good = buildFormatMarker(4096);
    writeFileSync(formatMarkerPath(dbPath), JSON.stringify({ ...good, library: "better-sqlite3" }), "utf8");
    expect(() => assertFormatMarkerCompatible(dbPath)).toThrow(FormatMarkerError);
  });

  it("library ausente del marcador: FormatMarkerError", () => {
    const good = buildFormatMarker(4096) as unknown as Record<string, unknown>;
    delete good.library;
    writeFileSync(formatMarkerPath(dbPath), JSON.stringify(good), "utf8");
    expect(() => assertFormatMarkerCompatible(dbPath)).toThrow(FormatMarkerError);
  });

  it("deriva de libraryVersion con la identidad intacta: FormatMarkerError (control)", () => {
    const good = buildFormatMarker(4096);
    writeFileSync(formatMarkerPath(dbPath), JSON.stringify({ ...good, libraryVersion: "99.0.0" }), "utf8");
    expect(() => assertFormatMarkerCompatible(dbPath)).toThrow(FormatMarkerError);
    writeFormatMarker(dbPath, 4096);
  });
});
