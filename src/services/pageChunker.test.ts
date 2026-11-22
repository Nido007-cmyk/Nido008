/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * pageChunker.test.ts — el troceador con ancla (E6, paso 4;
 * DOCUMENTOS-ETAPA §4) en su forma pura: ningún fragmento
 * cruza una página, el solape no se arrastra, la estimación se
 * suma por páginas, las constantes del móvil no se mueven y la
 * procedencia del OCR va en el primer fragmento de cada página
 * reconocida.
 */
import { describe, it, expect } from "vitest";
import {
  CHUNK_CHARS,
  OVERLAP_CHARS,
  chunkPages,
  chunkText,
  estimateChunkCountForLength,
  estimateChunkCountForPages,
  type PaginaPorTrocear,
} from "./pageChunker.js";

const pagina = (n: number, texto: string, origen: "texto" | "ocr" = "texto"): PaginaPorTrocear => ({
  pagina: n,
  texto,
  origen,
});

describe("el troceador con ancla", () => {
  it("las constantes del móvil no se mueven: 2.000 y 200", () => {
    expect(CHUNK_CHARS).toBe(2000);
    expect(OVERLAP_CHARS).toBe(200);
  });

  it("ningún fragmento cruza una página: la frase partida vive en dos fragmentos, cada uno en la suya", () => {
    const pieces = chunkPages([
      pagina(3, "La bomba se"),
      pagina(4, "detiene con la llave de paso."),
    ]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ page: 3, body: "La bomba se" });
    expect(pieces[1]).toMatchObject({ page: 4, body: "detiene con la llave de paso." });
  });

  it("el solape no se arrastra: el primer fragmento de una página empieza en su primer carácter", () => {
    const long = "a".repeat(2500);
    const pieces = chunkPages([pagina(1, long), pagina(2, "Segunda pagina entera.")]);
    const second = pieces.filter((p) => p.page === 2);
    expect(second).toHaveLength(1);
    expect(second[0].body).toBe("Segunda pagina entera.");
    // Y dentro de la página larga el solape es el de siempre:
    const first = pieces.filter((p) => p.page === 1);
    expect(first).toHaveLength(2);
    expect(first[1].body.startsWith("a".repeat(200))).toBe(true);
  });

  it("una página larga da varios fragmentos, todos con la misma página", () => {
    const pieces = chunkPages([pagina(7, "palabra ".repeat(1200))]);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.every((p) => p.page === 7 && p.origen === "texto")).toBe(true);
  });

  it("la estimación se suma por páginas (§4.4) y coincide con la de longitudes", () => {
    const pages = [pagina(1, "a".repeat(2001)), pagina(2, "b".repeat(2001)), pagina(3, "")];
    expect(estimateChunkCountForPages(pages)).toBe(
      estimateChunkCountForLength(2001) * 2,
    );
    expect(estimateChunkCountForPages(pages)).toBe(4);
    // La suma por páginas nunca es menor que la del texto unido:
    // cada página redondea su propio primer fragmento.
    expect(estimateChunkCountForPages(pages)).toBeGreaterThan(
      estimateChunkCountForLength(4002),
    );
  });

  it("la procedencia del OCR va en el primer fragmento de CADA página reconocida, no en los demás", () => {
    const note = "Texto reconocido con OCR en este aparato.";
    const pieces = chunkPages(
      [pagina(1, "x".repeat(2500), "ocr"), pagina(2, "Pagina dos leida.", "ocr"), pagina(3, "Texto directo.")],
      note,
    );
    const p1 = pieces.filter((p) => p.page === 1);
    expect(p1[0].body.startsWith(note)).toBe(true);
    expect(p1[1].body.startsWith(note)).toBe(false);
    const p2 = pieces.filter((p) => p.page === 2);
    expect(p2).toHaveLength(1);
    expect(p2[0].body.startsWith(note)).toBe(true);
    const p3 = pieces.filter((p) => p.page === 3);
    expect(p3[0].body.startsWith(note)).toBe(false);
    expect(pieces.every((p) => (p.page === 3 ? p.origen === "texto" : p.origen === "ocr"))).toBe(true);
  });

  it("una página vacía no da fragmentos y no rompe el resto", () => {
    const pieces = chunkPages([pagina(1, "Con texto."), pagina(2, "   "), pagina(3, "Tambien con texto.")]);
    expect(pieces.map((p) => p.page)).toEqual([1, 3]);
  });

  it("chunkText conserva su forma: 2.000 da uno; 2.001 da dos con solape de 200", () => {
    expect(chunkText("a".repeat(2000))).toHaveLength(1);
    const two = chunkText("a".repeat(2001));
    expect(two).toHaveLength(2);
    expect(two[0]).toHaveLength(2000);
    expect(two[1]).toHaveLength(201);
  });
});
