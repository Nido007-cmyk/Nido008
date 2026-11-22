/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * pdfTextEngine.test.ts — el motor de PDF de PC (pdfjs-dist
 * empaquetado) contra PDFs reales: los generados por
 * pdfTestFixtures y los tres fixtures del móvil. Cobra lo que
 * el paso 3 firma: PaginaTexto por página con su número y su
 * origen, los topes DENTRO del extractor (caracteres y páginas,
 * este desde los metadatos), el mapa de errores al contrato y
 * la detección de páginas escaneadas de §3.3.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  caracteresUtiles,
  esPaginaEscaneada,
  extractPdfPages,
  extractPdfTextCapped,
} from "./pdfText.js";
import { MAX_IMPORT_PDF_PAGES } from "./documentImporter.js";
import { makePdf } from "./pdfTestFixtures.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
let dir = "";

function write(name: string, content: string | Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-pdf-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("el motor pdfjs contra PDFs reales", () => {
  it("entrega PaginaTexto por página: número 1-based, texto de su página, origen texto", async () => {
    const uri = write(
      "tres.pdf",
      makePdf([
        "Primera pagina del documento.",
        "La frase unica vive en la pagina dos.",
        "Tercera pagina de cierre.",
      ]),
    );
    const pages = await extractPdfPages(uri, MAX_IMPORT_PDF_PAGES);
    expect(pages.map((p) => p.pagina)).toEqual([1, 2, 3]);
    expect(pages.map((p) => p.origen)).toEqual(["texto", "texto", "texto"]);
    expect(pages[1].texto).toContain("La frase unica vive en la pagina dos.");
    expect(pages[0].texto).not.toContain("frase unica");
  });

  it("el texto entero une las páginas y respeta un tope holgado", async () => {
    const uri = write("dos.pdf", makePdf(["Pagina uno con texto.", "Pagina dos con texto."]));
    const text = await extractPdfTextCapped(uri, 100_000, MAX_IMPORT_PDF_PAGES);
    expect(text).toContain("Pagina uno con texto.");
    expect(text).toContain("Pagina dos con texto.");
  });

  it("el tope de caracteres corta dentro del extractor: TEXT_TOO_LARGE", async () => {
    const uri = write("cap.pdf", makePdf(["Una pagina con bastante mas texto del que el tope admite."]));
    await expect(extractPdfTextCapped(uri, 20, MAX_IMPORT_PDF_PAGES)).rejects.toMatchObject({
      code: "TEXT_TOO_LARGE",
    });
  });

  it("el tope de páginas se cobra desde los metadatos: TOO_MANY_PAGES sin extraer", async () => {
    const many = Array.from({ length: MAX_IMPORT_PDF_PAGES + 1 }, () => "x");
    const uri = write("muchas.pdf", makePdf(many));
    await expect(extractPdfTextCapped(uri, 100_000, MAX_IMPORT_PDF_PAGES)).rejects.toMatchObject({
      code: "TOO_MANY_PAGES",
    });
    await expect(extractPdfPages(uri, MAX_IMPORT_PDF_PAGES)).rejects.toMatchObject({
      code: "TOO_MANY_PAGES",
    });
  });

  it("la contraseña se nombra: PASSWORD_REQUIRED (fixture cifrado del móvil)", async () => {
    await expect(
      extractPdfTextCapped(join(FIXTURES, "pdf-cifrado.pdf"), 100_000, MAX_IMPORT_PDF_PAGES),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
  });

  it("un PDF truncado no se lee: PDF_LOAD_ERROR", async () => {
    const bytes = makePdf(["Texto que se corta a mitad de fichero."]);
    const uri = write("truncado.pdf", bytes.subarray(0, Math.floor(bytes.length * 0.4)));
    await expect(extractPdfTextCapped(uri, 100_000, MAX_IMPORT_PDF_PAGES)).rejects.toMatchObject({
      code: "PDF_LOAD_ERROR",
    });
  });

  it("la latina CID extrae su frase entera por Identity-H + ToUnicode", async () => {
    const text = await extractPdfTextCapped(
      join(FIXTURES, "pdf-latino-cid.pdf"),
      100_000,
      MAX_IMPORT_PDF_PAGES,
    );
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("La cita es el martes a las nueve.");
    expect(flat).toContain("Revisión general.");
  });

  it("la detección de escaneadas: la página sin capa de texto se marca; la de texto, no", async () => {
    const uri = write(
      "mixto.pdf",
      makePdf(["Pagina con texto de verdad y contenido suficiente.", ""]),
    );
    const pages = await extractPdfPages(uri, MAX_IMPORT_PDF_PAGES);
    expect(esPaginaEscaneada(pages[0])).toBe(false);
    expect(esPaginaEscaneada(pages[1])).toBe(true);
    expect(caracteresUtiles("Hola, ¿qué tal? 123")).toBe(13);
    expect(caracteresUtiles("   ···   ")).toBe(0);
  });
});
