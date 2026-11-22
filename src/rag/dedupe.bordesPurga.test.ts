/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Bordes de la deduplicación que la purga fija en su letra
 * (su preparación, §3.2): el umbral exacto, la contención en las dos
 * direcciones, el cuerpo vacío y el de una palabra, el título que
 * solo difiere en blancos y mayúsculas, y la comparación solo contra
 * los trozos conservados. La batería de contrato de la pieza es
 * dedupe.test.ts; esta la completa sin tocarla.
 */
import { describe, it, expect } from "vitest";
import { dedupeArticleCopies } from "./dedupe.js";
import type { RetrievedChunk } from "./retrieve.types.js";

function chunk(id: string, title: string, body: string): RetrievedChunk {
  return {
    chunkId: id,
    docId: `doc-${id}`,
    title,
    body,
    score: 1.0,
    matchType: "semantic",
  };
}

describe("bordes de dedupeArticleCopies", () => {
  it("la parte igual al umbral (0,6 exactos) cae", () => {
    // El conservado tiene 5 pares; el candidato comparte 3 de los 5.
    const kept = chunk("a", "T", "alpha bravo charlie delta echo foxtrot");
    const candidate = chunk("b", "T", "alpha bravo charlie delta xray yankee");
    expect(dedupeArticleCopies([kept, candidate]).map((c) => c.chunkId)).toEqual(["a"]);
  });

  it("la parte inmediatamente por debajo del umbral (0,5) se conserva", () => {
    // 4 pares por cuerpo, 2 compartidos: 0,5 en las dos direcciones.
    const first = chunk("a", "T", "alpha bravo charlie delta echo");
    const second = chunk("b", "T", "alpha bravo charlie xray yankee");
    expect(dedupeArticleCopies([first, second])).toHaveLength(2);
  });

  it("la contención corta en larga cae (el corto llega segundo)", () => {
    const long = chunk("a", "T", "zero one two three four five six");
    const short = chunk("b", "T", "one two three four");
    expect(dedupeArticleCopies([long, short]).map((c) => c.chunkId)).toEqual(["a"]);
  });

  it("la contención larga en corta cae (el corto llega primero)", () => {
    const short = chunk("a", "T", "one two three four");
    const long = chunk("b", "T", "zero one two three four five six");
    expect(dedupeArticleCopies([short, long]).map((c) => c.chunkId)).toEqual(["a"]);
  });

  it("dos cuerpos vacíos con el mismo título se conservan los dos", () => {
    const chunks = [chunk("a", "T", ""), chunk("b", "T", "")];
    expect(dedupeArticleCopies(chunks)).toHaveLength(2);
  });

  it("dos cuerpos de una palabra con el mismo título se conservan los dos", () => {
    const chunks = [chunk("a", "T", "Solo"), chunk("b", "T", "Solo")];
    expect(dedupeArticleCopies(chunks)).toHaveLength(2);
  });

  it("el título que solo difiere en blancos y mayúsculas es el mismo título", () => {
    const chunks = [
      chunk("a", "  MY   Article ", "The quick brown fox jumps over the lazy dog."),
      chunk("b", "my article", "The quick brown fox jumps over the lazy dog."),
    ];
    expect(dedupeArticleCopies(chunks).map((c) => c.chunkId)).toEqual(["a"]);
  });

  it("solo se compara contra conservados: la copia de un caído no cae por él", () => {
    // b comparte 6 de 10 pares con a (0,6: cae). c comparte 8 de 9 con
    // b (copia de b) pero solo 4 con a (por debajo del umbral en las
    // dos direcciones): c se conserva porque b ya no está en la lista.
    const a = chunk("a", "T", "a b c d e f g h i j k");
    const b = chunk("b", "T", "a b c d e f g x y z w");
    const c = chunk("c", "T", "c d e f g x y z w v");
    expect(dedupeArticleCopies([a, b, c]).map((x) => x.chunkId)).toEqual(["a", "c"]);
  });

  it("no muta la entrada y devuelve una lista nueva", () => {
    const chunks = [
      chunk("a", "T", "The quick brown fox jumps over the lazy dog."),
      chunk("b", "T", "The quick brown fox jumps over the lazy dog."),
    ];
    const result = dedupeArticleCopies(chunks);
    expect(chunks).toHaveLength(2);
    expect(result).not.toBe(chunks);
    expect(result).toHaveLength(1);
  });
});
