/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La batería del triángulo de sellos (AUDITORIA-12, H-2;
 * ejecutada en la pieza de cobertura que descarga el
 * cargo H-4, en la forma de AUD12-COBERTURA-PREP.md
 * §2.2). Compara las tres sedes de los sellos de los
 * conjuntos ciegos sin escribir en ninguna: las dos
 * tablas SIGNED_SEALS de los corredores entre sí, las
 * tablas contra el asiento firmado
 * (estudios/E3-J10-APERTURA.md) y los sellos
 * recomputados sobre los conjuntos vivos.
 *
 * Los corredores son guiones que ejecutan al
 * importarse (código de nivel superior con
 * process.exit): esta batería no los importa. Los lee
 * como texto y extrae el bloque SIGNED_SEALS con un
 * análisis estricto, y lee el documento firmado como
 * texto y extrae los cuatro sellos enteros de su
 * tabla. Si el análisis de cualquiera de las tres
 * fuentes no encuentra exactamente cuatro sellos en su
 * forma (64 hexadecimales), el caso correspondiente
 * cae: un cambio de formato no puede vaciar la
 * comparación en silencio.
 *
 * La batería solo lee y compara: ningún código de la
 * pieza escribe el documento ni las tablas, y ninguna
 * sede se regenera desde otra. Si una comparación cae,
 * la divergencia se dirime en un asiento de la casa y
 * se corrige donde el dirimen mande, nunca copiando
 * valores de una sede a otra para que la batería pase.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLIND_SET, BLIND_SET_VERSION, type BlindQuestion } from "./blindSet.js";
import { BLIND_SET_2, BLIND_SET_2_VERSION } from "./blindSet2.js";
import { BLIND_SET_3, BLIND_SET_3_VERSION } from "./blindSet3.js";
import { BLIND_SET_4, BLIND_SET_4_VERSION } from "./blindSet4.js";
import { sceneSkipped } from "../test/sceneGate.js";

function readRepoText(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/**
 * Extrae la tabla SIGNED_SEALS de un corredor, leído
 * como texto. Estricto: el bloque debe traer
 * exactamente cuatro pares versión → sello, cada sello
 * en su forma de 64 hexadecimales; cualquier otra cosa
 * lanza, y el caso que lo lee cae.
 */
function parseRunnerSeals(text: string, source: string): Record<string, string> {
  const start = text.indexOf("SIGNED_SEALS");
  if (start < 0) throw new Error(`${source}: no se encuentra SIGNED_SEALS`);
  const end = text.indexOf("};", start);
  if (end < 0) throw new Error(`${source}: el bloque SIGNED_SEALS no cierra`);
  const block = text.slice(start, end);
  const keys = [...block.matchAll(/"(\d+)":/g)].map((m) => m[1]);
  const pairs = [...block.matchAll(/"(\d+)":\s*"([0-9a-f]{64})"/g)];
  if (keys.length !== 4 || pairs.length !== 4) {
    throw new Error(
      `${source}: SIGNED_SEALS debe traer exactamente 4 pares con sellos de 64 hexadecimales (claves: ${keys.length}, pares en forma: ${pairs.length})`,
    );
  }
  const seals: Record<string, string> = {};
  for (const [, version, seal] of pairs) {
    if (seals[version]) throw new Error(`${source}: versión repetida ${version} en SIGNED_SEALS`);
    seals[version] = seal;
  }
  return seals;
}

/**
 * Extrae los cuatro sellos enteros de la tabla del
 * asiento firmado. Estricto: exactamente cuatro filas
 * «Sello 0N», una por conjunto, y cada fila con
 * exactamente un sello en su forma de 64 hexadecimales
 * (la forma truncada de la segunda columna no casa el
 * patrón y no cuenta).
 */
function parseDocumentSeals(text: string): Record<string, string> {
  const seals: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const row = /^\|\s*Sello\s+0([1-4])\s*\|/.exec(line);
    if (!row) continue;
    const version = row[1];
    if (seals[version]) throw new Error(`documento firmado: fila de Sello 0${version} repetida`);
    const full = [...line.matchAll(/[0-9a-f]{64}/g)].map((m) => m[0]);
    if (full.length !== 1) {
      throw new Error(
        `documento firmado: la fila de Sello 0${version} debe traer exactamente un sello de 64 hexadecimales (trae ${full.length})`,
      );
    }
    seals[version] = full[0];
  }
  if (Object.keys(seals).length !== 4) {
    throw new Error(
      `documento firmado: se esperaban exactamente 4 filas de sellos (hay ${Object.keys(seals).length})`,
    );
  }
  return seals;
}

/**
 * La forma canónica, reimplementada en la batería
 * (la misma de blindCore.ts): JSON.stringify de las
 * tuplas [id, type, lang, expected, query] en el orden
 * del fichero, SHA-256 hex en UTF-8.
 */
function sealOf(set: BlindQuestion[]): string {
  const canonical = JSON.stringify(set.map((q) => [q.id, q.type, q.lang, q.expected, q.query]));
  return createHash("sha256").update(canonical).digest("hex");
}

const SETS: Array<{ version: string; set: BlindQuestion[] }> = [
  { version: BLIND_SET_VERSION, set: BLIND_SET },
  { version: BLIND_SET_2_VERSION, set: BLIND_SET_2 },
  { version: BLIND_SET_3_VERSION, set: BLIND_SET_3 },
  { version: BLIND_SET_4_VERSION, set: BLIND_SET_4 },
];

const runnerA = fileURLToPath(new URL("../../scripts/blindRunA.ts", import.meta.url));
const runnerB = fileURLToPath(new URL("../../scripts/blindRunB.ts", import.meta.url));
const aperturaDoc = fileURLToPath(new URL("../../estudios/E3-J10-APERTURA.md", import.meta.url));

// La puerta de escena de la batería, con granularidad por
// caso: una sola llamada con los tres papeles (un solo aviso
// que nombra a todo lo que falta, y el lanzamiento ruidoso
// de siempre si la corrida no declaró el salto) y una
// bandera por grupo, porque los tres casos no dependen de
// los mismos papeles.
sceneSkipped("blindSeals", [runnerA, runnerB, aperturaDoc]);
const RUNNERS_OFF = !existsSync(runnerA) || !existsSync(runnerB);
const DOC_OFF = !existsSync(aperturaDoc);

describe("blindSeals · el triángulo de sellos (H-2)", () => {
  it.skipIf(RUNNERS_OFF)("las dos tablas SIGNED_SEALS casan entre sí, entrada a entrada", () => {
    const a = parseRunnerSeals(readRepoText("../../scripts/blindRunA.ts"), "blindRunA.ts");
    const b = parseRunnerSeals(readRepoText("../../scripts/blindRunB.ts"), "blindRunB.ts");
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const version of Object.keys(a)) {
      expect(b[version], `conjunto ${version}`).toBe(a[version]);
    }
  });

  it.skipIf(RUNNERS_OFF || DOC_OFF)("las tablas casan con el documento firmado", () => {
    const a = parseRunnerSeals(readRepoText("../../scripts/blindRunA.ts"), "blindRunA.ts");
    const b = parseRunnerSeals(readRepoText("../../scripts/blindRunB.ts"), "blindRunB.ts");
    const signed = parseDocumentSeals(readRepoText("../../estudios/E3-J10-APERTURA.md"));
    for (const { version } of SETS) {
      expect(a[version], `conjunto ${version} en blindRunA contra el firmado`).toBe(signed[version]);
      expect(b[version], `conjunto ${version} en blindRunB contra el firmado`).toBe(signed[version]);
    }
  });

  it.skipIf(DOC_OFF)("los sellos firmados recomputan sobre los conjuntos vivos", () => {
    const signed = parseDocumentSeals(readRepoText("../../estudios/E3-J10-APERTURA.md"));
    for (const { version, set } of SETS) {
      expect(sealOf(set), `conjunto ${version} recomputado`).toBe(signed[version]);
    }
  });
});
