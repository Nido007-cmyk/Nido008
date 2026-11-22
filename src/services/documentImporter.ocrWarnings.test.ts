/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.ocrWarnings.test.ts — la batería de avisos
 * de OCR del móvil recreada en PC (R-06 P5 + Adversaria H-01 +
 * auditoría completa F-1/F-2), en su forma de PC: base real y
 * ficheros reales, con el lector de PDF y el OCR apuntalados
 * en sus costuras de contrato con el mismo mundo guionizado
 * del móvil. Las 16 declaraciones conservan su aserción; donde
 * el móvil contaba inserciones de su mundo, aquí se cuentan
 * las filas de la base.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3]),
      modelSha256: null,
    }),
  },
}));

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import {
  getDb,
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { _setPdfTextNativeForTests } from "./pdfText.js";
import { _setOcrNativeForTests, OcrError } from "./ocr.js";

const world = {
  pdfText: "",
  ocrAvailable: true,
  pdfOcrText: "" as string | null,
  pdfOcrError: null as Error | null,
  imageOcrText: "",
  imageOcrError: null as Error | null,
};

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}
const asset = (f: PickedDocumentFile) => f;

async function inserted(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
  return row?.n ?? -1;
}
async function created(): Promise<number> {
  return (await listCustomCollections()).length;
}

function installDoubles(): void {
  _setPdfTextNativeForTests({
    extractText: async () => world.pdfText,
    extractPages: async () => [{ pagina: 1, texto: world.pdfText, origen: "texto" as const }],
  });
  if (!world.ocrAvailable) {
    _setOcrNativeForTests(null);
    return;
  }
  _setOcrNativeForTests({
    recognize: async () => {
      if (world.imageOcrError) throw world.imageOcrError;
      return world.imageOcrText;
    },
    findScannedPdfPages: async () => (world.pdfOcrText === null ? [] : [0]),
    recognizePdfPageText: async () => {
      if (world.pdfOcrError) throw world.pdfOcrError;
      return world.pdfOcrText ?? "";
    },
    recognizePdfPages: async () => {
      if (world.pdfOcrError) throw world.pdfOcrError;
      return world.pdfOcrText ?? "";
    },
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-ocrwarn-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
  world.pdfText = "";
  world.ocrAvailable = true;
  world.pdfOcrText = "";
  world.pdfOcrError = null;
  world.imageOcrText = "";
  world.imageOcrError = null;
  installDoubles();
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  _setPdfTextNativeForTests(undefined);
  _setOcrNativeForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe("R-06 P5: avisos por fichero sin texto", () => {
  it("imagen buena + PDF cuyo OCR devuelve «»: éxito y aviso que nombra el PDF", async () => {
    world.imageOcrText = "CLINICA SAN RAFAEL. Su cita es el martes.";
    world.pdfText = ""; // sin capa de texto
    world.pdfOcrText = ""; // el OCR corrió y volvió vacío
    const foto = write("foto.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    const pdf = write("documento-prueba-ocr.pdf", "%PDF-doble");
    const result = await importDocuments([asset(foto), asset(pdf)], "Mixta");
    expect(await created()).toBe(1);
    expect(await inserted()).toBeGreaterThan(0);
    expect(result.importWarnings).toEqual([{ name: "documento-prueba-ocr.pdf", reason: "ocrEmpty" }]);
  });

  it("PDF solo con OCR vacío: el error nombrado sigue siendo noText (resolvió vacío, no rechazó)", async () => {
    world.pdfText = "";
    world.pdfOcrText = "";
    const pdf = write("escaneado.pdf", "%PDF-doble");
    await expect(importDocuments([asset(pdf)], "x")).rejects.toMatchObject({ code: "noText" });
    expect(await created()).toBe(0);
  });

  it("PDF cuyo OCR lanza, solo: ocrFailed conserva el código y el mensaje del nativo", async () => {
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const pdf = write("malo.pdf", "%PDF-doble");
    const err = await importDocuments([asset(pdf)], "x").catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "ocrFailed",
      vars: {
        name: "malo.pdf",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    });
    expect((err as Error).message).toContain("Couldn't recognize the PDF's pages");
    expect(await created()).toBe(0);
  });

  it("PDF cuyo OCR lanza, junto a una imagen buena: éxito y el aviso conserva la huella del rechazo", async () => {
    world.imageOcrText = "Texto impreso de la foto.";
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const foto = write("foto.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    const pdf = write("malo.pdf", "%PDF-doble");
    const result = await importDocuments([asset(foto), asset(pdf)], "Mixta");
    expect(await created()).toBe(1);
    expect(result.importWarnings).toEqual([
      {
        name: "malo.pdf",
        reason: "ocrFailed",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    ]);
  });

  it("la huella conserva el mensaje acotado, no el error entero sin fin", async () => {
    world.imageOcrText = "Texto impreso de la foto.";
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "x".repeat(500));
    const foto = write("foto.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    const pdf = write("malo.pdf", "%PDF-doble");
    const result = await importDocuments([asset(foto), asset(pdf)], "Mixta");
    expect(result.importWarnings).toHaveLength(1);
    expect(result.importWarnings[0].ocrMessage).toHaveLength(200);
  });

  it("una importación limpia no devuelve avisos", async () => {
    const notas = write("notas.txt", "palabra ".repeat(50));
    const result = await importDocuments([asset(notas)], "Notas");
    expect(result.importWarnings).toEqual([]);
  });

  it("dos ficheros con el mismo contenido en un lote dan 1 chunk: el segundo cae en idéntico (C-06)", async () => {
    const text = "palabra ".repeat(50);
    const a = write("a.txt", text);
    const b = write("b.txt", text);
    const result = await importDocuments([asset(a), asset(b)], "Gemelos");
    expect(await inserted()).toBe(1);
    expect(result.importWarnings).toEqual([
      { name: "b.txt", reason: "alreadyImported", previousName: "a.txt" },
    ]);
  });
});

describe("Adversaria H-01: la vía OCR se nombra por fichero, aporte lo que aporte la capa", () => {
  it("PDF mixto (capa parcial) cuyo OCR rechaza: éxito, su chunk entra y el aviso nombra el rechazo", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026."; // solo la portada trae capa
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const pdf = write("mixto.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Mixto");
    expect(await created()).toBe(1);
    expect(await inserted()).toBe(1); // el chunk de la capa de texto
    expect(result.importWarnings).toEqual([
      {
        name: "mixto.pdf",
        reason: "ocrFailed",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    ]);
  });

  it("PDF mixto cuyo OCR resuelve vacío: éxito y aviso ocrEmpty — las páginas escaneadas no quedan en silencio", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026.";
    world.pdfOcrText = ""; // el OCR corrió y volvió sin texto
    const pdf = write("mixto.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Mixto");
    expect(await created()).toBe(1);
    expect(await inserted()).toBe(1);
    expect(result.importWarnings).toEqual([{ name: "mixto.pdf", reason: "ocrEmpty" }]);
  });

  it("PDF mixto cuyo OCR sí lee las páginas escaneadas: entran los dos textos y no hay aviso", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026.";
    world.pdfOcrText = "Página escaneada con el balance del ejercicio.";
    const pdf = write("mixto.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Mixto");
    expect(await inserted()).toBe(2);
    expect(result.importWarnings).toEqual([]);
  });

  it("PDF de solo texto en una versión sin OCR: entra por su capa y no gana avisos nuevos", async () => {
    world.ocrAvailable = false;
    installDoubles();
    world.pdfText = "palabra ".repeat(50);
    const pdf = write("informe.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Informe");
    expect(await created()).toBe(1);
    expect(result.importWarnings).toEqual([]);
  });

  it("imagen escaneada con OCR bueno: entra su texto y no hay aviso", async () => {
    world.imageOcrText = "CLINICA SAN RAFAEL. Su cita es el martes.";
    const foto = write("foto.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    const result = await importDocuments([asset(foto)], "Foto");
    expect(await inserted()).toBe(1);
    expect(result.importWarnings).toEqual([]);
  });

  it("auditoría completa F-1: PDF de solo texto con OCR disponible — sin páginas escaneadas no hay aviso", async () => {
    // La costura devuelve null cuando el nativo no encuentra páginas
    // escaneadas: no hay nada que reconocer y nada que avisar. Antes
    // volvía «» y todo PDF de texto recibía «el reconocimiento no
    // encontró texto en sus páginas escaneadas».
    world.pdfText = "palabra ".repeat(50);
    world.pdfOcrText = null;
    installDoubles();
    const pdf = write("informe.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Informe");
    expect(await created()).toBe(1);
    expect(result.importWarnings).toEqual([]);
  });

  it("auditoría completa F-1, par: el PDF con páginas escaneadas que el motor no lee sigue avisando", async () => {
    world.pdfText = "palabra ".repeat(50);
    world.pdfOcrText = "";
    const pdf = write("informe.pdf", "%PDF-doble");
    const result = await importDocuments([asset(pdf)], "Informe");
    expect(result.importWarnings).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
  });
});

describe("auditoría completa F-2: el tipo lo deciden los bytes, no el nombre", () => {
  it("un PDF llamado «.txt» va por la vía PDF, no se indexa como texto basura", async () => {
    // Discriminante: por la vía PDF, un PDF sin capa de texto en una
    // versión sin OCR falla con scannedNoOcr; por la vía de texto, el
    // binario entraría como texto y la importación «tendría éxito».
    world.ocrAvailable = false;
    installDoubles();
    world.pdfText = "";
    const file = write("informe.txt", "%PDF-1.7\n%âãÏÓ binario");
    await expect(importDocuments([asset(file)], "Informe")).rejects.toMatchObject({ code: "scannedNoOcr" });
  });

  it("par: un «.txt» de texto de verdad sigue entrando como texto", async () => {
    world.pdfText = "";
    const file = write("notas.txt", "Notas de la reunión del martes. ".repeat(20));
    const result = await importDocuments([asset(file)], "Notas");
    expect(await inserted()).toBeGreaterThan(0);
    expect(result.importWarnings).toEqual([]);
  });
});
