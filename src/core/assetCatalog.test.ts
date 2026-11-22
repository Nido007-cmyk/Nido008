/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La integridad del catálogo de activos: la guarda gemela
 * de la de catalog.test.ts, nombrada por el asiento de
 * apertura de E4 sin renumerar la batería de la hoja. Con
 * la enmienda VA-06: cobra host y repositorio de cada
 * sourceUrl, no solo el patrón de fijación.
 */

import { describe, expect, it } from "vitest";
import { ASSET_CATALOG, isLooseAsset } from "./assetCatalog.js";

const HEX64 = /^[0-9a-f]{64}$/;
/** Los totales extraídos de los tres manifiestos verificados. */
const EXTRACTED: Record<string, number> = {
  "parakeet-tdt-0.6b-v3-int8": 671_341_917,
  "kokoro-multi-lang-v1_0": 401_239_297,
  silero_vad: 643_854,
};
const FILE_COUNT: Record<string, number> = {
  "parakeet-tdt-0.6b-v3-int8": 9,
  "kokoro-multi-lang-v1_0": 377,
  silero_vad: 1,
};

describe("assetCatalog integrity", () => {
  it("ids are unique and every entry carries the full manifest", () => {
    const ids = ASSET_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of ASSET_CATALOG) {
      expect(entry.files.length, entry.id).toBe(FILE_COUNT[entry.id]);
      expect(entry.files.reduce((sum, f) => sum + f.bytes, 0), entry.id).toBe(EXTRACTED[entry.id]);
      expect(entry.license.length, entry.id).toBeGreaterThan(0);
      expect(entry.archiveBytes, entry.id).toBeGreaterThan(0);
      expect(entry.archiveSha256, entry.id).toMatch(HEX64);
    }
  });

  it("every file path is a relative POSIX path, unduplicated, with a 64-hex pin", () => {
    for (const entry of ASSET_CATALOG) {
      const paths = entry.files.map((f) => f.path);
      expect(new Set(paths).size, entry.id).toBe(paths.length);
      for (const file of entry.files) {
        expect(file.path.startsWith("/"), `${entry.id}:${file.path}`).toBe(false);
        expect(file.path.includes("\\"), `${entry.id}:${file.path}`).toBe(false);
        expect(file.path.split("/").includes(".."), `${entry.id}:${file.path}`).toBe(false);
        expect(file.path.split("/").includes(""), `${entry.id}:${file.path}`).toBe(false);
        expect(file.bytes, `${entry.id}:${file.path}`).toBeGreaterThan(0);
        expect(file.sha256, `${entry.id}:${file.path}`).toMatch(HEX64);
      }
    }
  });

  it("every sourceUrl is https, pinned to its revision, on the one allowed host and repo (VA-06)", () => {
    for (const entry of ASSET_CATALOG) {
      const url = new URL(entry.sourceUrl);
      expect(url.protocol, entry.id).toBe("https:");
      expect(url.hostname, entry.id).toBe("github.com");
      expect(url.pathname.startsWith("/k2-fsa/sherpa-onnx/releases/download/"), entry.id).toBe(true);
      expect(url.pathname, entry.id).toContain(`/releases/download/${entry.revision}/`);
    }
  });

  it("only the VAD is a loose asset; archives extract to more than the tarball", () => {
    for (const entry of ASSET_CATALOG) {
      if (entry.id === "silero_vad") {
        expect(isLooseAsset(entry)).toBe(true);
        expect(entry.archiveBytes).toBe(entry.files[0].bytes);
      } else {
        expect(isLooseAsset(entry), entry.id).toBe(false);
        expect(EXTRACTED[entry.id], entry.id).toBeGreaterThan(entry.archiveBytes);
      }
    }
  });
});

describe("VA-08: la unicidad de rutas del manifiesto es exacta", () => {
  // El censo de integridad de E4 pide la unicidad de rutas en
  // forma exacta (`new Set(paths)`), sin NFC ni insensibilidad
  // a mayúsculas: esa es la forma sellada y no se pliega. Este
  // caso cobra la otra mitad del hecho sobre el catálogo vivo:
  // ni siquiera plegando caja y forma Unicode aparece una
  // colisión, así que la unicidad exacta no esconde dos rutas
  // que en un sistema de ficheros insensible a la caja (el de
  // Windows, donde el activo correrá) serían el mismo fichero.
  // Si una edición futura del catálogo metiera dos rutas que
  // solo se distinguen por la caja o la forma, este caso cae.
  it("ninguna ruta del catálogo colisiona con otra ni en forma exacta ni plegada", () => {
    const paths = ASSET_CATALOG.flatMap((entry) =>
      entry.files.map((file) => `${entry.id}/${file.path}`),
    );
    expect(new Set(paths).size).toBe(paths.length);
    const folded = paths.map((p) => p.toLowerCase().normalize("NFC"));
    expect(new Set(folded).size).toBe(paths.length);
  });
});
