/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packCatalog.test.ts — integridad del catálogo de paquetes de PC
 * (bloque puerta de E5, paso 3): el gemelo del test de integridad
 * del catálogo de modelos. Los pins viven en el código; esta
 * batería es la que vigila que cada entrada sea una entrada
 * oficial entera: huella en formato válido, tamaño declarado,
 * URL fijada a su release, sin ids ni ficheros repetidos, y solo
 * las nueve familias oficiales del censo, cada una en sus dos
 * variantes (bge y e5). El contraste pin a pin contra el catálogo
 * firmado del móvil es entregable registrado del paso, no un
 * caso de esta batería: vive en el asiento del paso.
 */
import { describe, expect, it } from "vitest";
import { CORPUS_CATALOG, PACK_CATALOG } from "./packCatalog.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RELEASE_PINNED = /^https:\/\/github\.com\/Nido007-cmyk\/Nido\/releases\/download\/knowledge-packs-v\d+\/[^/]+\.sqlite$/;

/**
 * Las nueve familias oficiales: id base de cada una (su variante e5
 * lleva el sufijo). La décima, wiki-vital5, salió del censo con la
 * purga de la cadena legada (respaldo de VITAL-REEDICION-PREP §5.3:
 * la reedición está producida pero su release no pudo publicarse, y
 * ningún pack ofrecido puede quedar sin poder abrirse sin la
 * aceptación retirada). Su vuelta tiene sede en el paso 8 de E5,
 * que la restituirá con su pin nuevo; ese commit re-asienta esta
 * lista a diez familias y el conteo a 20.
 */
const OFFICIAL_FAMILIES = [
  "nido-esencial",
  "nido-local",
  "nido-ninos",
  "nido-crisis",
  "nido-sin-servicios",
  "nido-hogar",
  "nido-desastres",
  "nido-campo",
  "nido-viaje",
];

describe("packCatalog · integridad", () => {
  it("trae las 18 entradas oficiales: 9 familias × 2 variantes", () => {
    expect(PACK_CATALOG.length).toBe(18);
    expect(CORPUS_CATALOG).toBe(PACK_CATALOG);
    for (const family of OFFICIAL_FAMILIES) {
      const base = PACK_CATALOG.find((e) => e.id === family);
      const e5 = PACK_CATALOG.find((e) => e.id === `${family}-e5`);
      expect(base, `familia ${family}`).toBeDefined();
      expect(e5, `variante e5 de ${family}`).toBeDefined();
      expect(base!.filename).toBe(`corpus/${family}.sqlite`);
      expect(e5!.filename).toBe(`corpus/${family}-e5.sqlite`);
    }
  });

  it("toda entrada trae huella de 64 hex, tamaño mayor que cero y URL fijada a su release", () => {
    for (const entry of PACK_CATALOG) {
      expect(entry.format, entry.id).toBe("sqlite-pack");
      expect(entry.kind, entry.id).toBe("corpus");
      expect(SHA256_HEX.test(entry.sha256), entry.id).toBe(true);
      expect(entry.sizeBytes, entry.id).toBeGreaterThan(0);
      expect(RELEASE_PINNED.test(entry.sourceUrl), `${entry.id}: ${entry.sourceUrl}`).toBe(true);
      expect(entry.sourceUrl.endsWith(`/${entry.filename.replace("corpus/", "")}`), entry.id).toBe(true);
    }
  });

  it("ningún id ni ningún nombre de fichero se repite", () => {
    const ids = PACK_CATALOG.map((e) => e.id);
    const files = PACK_CATALOG.map((e) => e.filename);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
  });

  it("ninguna entrada es de una familia fuera del censo oficial", () => {
    for (const entry of PACK_CATALOG) {
      const family = entry.id.replace(/-e5$/, "");
      expect(OFFICIAL_FAMILIES, entry.id).toContain(family);
    }
  });

  it("los dos paquetes que el bloque instala traen sus pins sellados", () => {
    const esencialE5 = PACK_CATALOG.find((e) => e.id === "nido-esencial-e5")!;
    expect(esencialE5.sha256).toBe("c4d49aa945199520af9273cf5fd02f52d26eda7f82b1c41c65f121a635706c92");
    expect(esencialE5.sizeBytes).toBe(1_286_144);
    const localE5 = PACK_CATALOG.find((e) => e.id === "nido-local-e5")!;
    expect(localE5.sha256).toBe("1647431996507545093904985af807b318d6127935b311c51dbab01cde22aa3c");
    expect(localE5.sizeBytes).toBe(376_832);
  });
});
