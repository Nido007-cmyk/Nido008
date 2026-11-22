/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.dedupe.test.ts — la batería de identidad
 * del móvil recreada en PC (C-06 + H-11 + ADV2-06: el
 * importador con memoria e identidad), en su forma de PC:
 * base real y ficheros reales; el lector de PDF y el OCR se
 * apuntalan en sus costuras de contrato (los dobles de
 * _setPdfTextNativeForTests / _setOcrNativeForTests), como el
 * mundo del móvil apuntalaba sus módulos. Las 17 declaraciones
 * conservan su aserción.
 *
 * - C-06: la identidad de un documento es la huella SHA-256 de
 *   su contenido extraído (normalización v1). Idéntico no
 *   entra dos veces; editado (≥ 90 % de trozos idénticos)
 *   entra como copia nueva con aviso; lo ya duplicado antes
 *   de la cura se registra de forma perezosa desde sus trozos.
 * - H-11: los avisos se persisten y se releen por la vía de
 *   lectura, no del resultado de la importación.
 * - ADV2-06: los sumideros son por fichero, no por nombre.
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

import {
  docContentFingerprint,
  importDocuments,
  listImportWarnings,
  normalizeContentText,
  type PickedDocumentFile,
} from "./documentImporter.js";
import {
  createCustomCollection,
  getDb,
  insertChunkWithoutEmbedding,
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { _setPdfTextNativeForTests } from "./pdfText.js";
import { _setOcrNativeForTests, OcrError } from "./ocr.js";

const pdfTextByUri = new Map<string, string>();
const pdfOcrByUri = new Map<string, { text?: string; error?: Error }>();
const imageOcrByUri = new Map<string, { text?: string; error?: Error }>();

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}
const asset = (f: PickedDocumentFile) => f;

async function chunkCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
  return row?.n ?? -1;
}
async function collectionCount(): Promise<number> {
  return (await listCustomCollections()).length;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-dedupe-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
  _setPdfTextNativeForTests({
    extractText: async (uri: string) => pdfTextByUri.get(uri) ?? "",
    extractPages: async (uri: string) => [
      { pagina: 1, texto: pdfTextByUri.get(uri) ?? "", origen: "texto" as const },
    ],
  });
  _setOcrNativeForTests({
    recognize: async (uri: string) => {
      const scripted = imageOcrByUri.get(uri);
      if (scripted?.error) throw scripted.error;
      return scripted?.text ?? "";
    },
    findScannedPdfPages: async (uri: string) => (pdfOcrByUri.has(uri) ? [0] : []),
    recognizePdfPages: async (uri: string) => {
      const scripted = pdfOcrByUri.get(uri);
      if (scripted?.error) throw scripted.error;
      return scripted?.text ?? "";
    },
  });
});
beforeEach(async () => {
  await resetDatabase();
  pdfTextByUri.clear();
  pdfOcrByUri.clear();
  imageOcrByUri.clear();
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  _setPdfTextNativeForTests(undefined);
  _setOcrNativeForTests(undefined);
  rmSync(dir, { recursive: true, force: true });
});

/** Texto largo de frase periódica: cada trozo de 2000 cae en la misma fase. */
const longBody = (phrase: string, reps: number) => phrase.repeat(reps);
const CLINIC_NOTE =
  "Nota de la clínica: la cita es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214 del segundo piso. " +
  "El jarabe se toma 5 ml dos veces al día después de comer. Para cambiar la cita llame al 520-555-0147.";

describe("la huella de contenido (normalización v1)", () => {
  it("es el SHA-256 del cuerpo normalizado (trim + blancos colapsados); vacío no huella", () => {
    // Vector conocido: SHA-256("abc").
    expect(docContentFingerprint("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(docContentFingerprint("  abc \n\n")).toBe(docContentFingerprint("abc"));
    expect(docContentFingerprint("a   b\tc")).toBe(docContentFingerprint("a b c"));
    expect(docContentFingerprint("   \n ")).toBeNull();
    expect(normalizeContentText("  uno\n\n dos   tres ")).toBe("uno dos tres");
  });
});

describe("C-06: el idéntico no entra dos veces", () => {
  it("reimportar el mismo fichero: no nace colección, devuelve la existente y el aviso persiste en ella", async () => {
    const nota = write("nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    const first = await importDocuments([asset(nota)], "Notas");
    expect(first.importWarnings).toEqual([]);
    const chunksAfterFirst = await chunkCount();

    const second = await importDocuments([asset(nota)], "Otra");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await collectionCount()).toBe(1);
    expect(await chunkCount()).toBe(chunksAfterFirst);
    expect(second.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
    // H-11: el aviso vive en la base, no en el resultado — se relee.
    const persisted = await listImportWarnings([first.id]);
    expect(persisted[first.id]).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("lote parcial: entra lo nuevo y el aviso nombra lo repetido y dónde vive", async () => {
    const nota = write("nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    const nuevo = write("nuevo.txt", "Teléfonos del barrio: ferretería 555-0100.");
    await importDocuments([asset(nota)], "Notas");
    const chunksBefore = await chunkCount();

    const result = await importDocuments([asset(nota), asset(nuevo)], "Mezcla");
    expect(result.duplicateImport).toBeFalsy();
    expect(await collectionCount()).toBe(2);
    expect(await chunkCount()).toBe(chunksBefore + 1); // solo entró nuevo.txt
    expect(result.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", detail: "Notas", previousName: "nota.txt" },
    ]);
    const persisted = await listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "nota.txt", reason: "alreadyImported", detail: "Notas", previousName: "nota.txt" },
    ]);
  });

  it("renombrado: el mismo contenido con otro nombre cae en idéntico y el aviso lee ambos nombres", async () => {
    const body = "Horario del consultorio: lunes a viernes de 9 a 14.";
    const nota = write("nota.txt", body);
    await importDocuments([asset(nota)], "Notas");
    const copia = write("nota-copia.md", body);
    const second = await importDocuments([asset(copia)], "Copia");
    expect(second.duplicateImport).toBe(true);
    expect(await collectionCount()).toBe(1);
    expect(second.importWarnings).toEqual([
      { name: "nota-copia.md", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("el mismo fichero dos veces en un lote: una sola copia dentro de la colección", async () => {
    const nota = write("nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    const result = await importDocuments([asset(nota), asset(nota)], "Doble");
    expect(await collectionCount()).toBe(1);
    expect(await chunkCount()).toBe(1);
    expect(result.importWarnings).toEqual([
      { name: "nota.txt", reason: "alreadyImported", previousName: "nota.txt" },
    ]);
  });

  it("«importar de todos modos»: la copia nace, queda marcada como forzada y no lleva aviso", async () => {
    const nota = write("nota.txt", "Receta de la abuela: sopa de pollo con arroz.");
    await importDocuments([asset(nota)], "Notas");
    const forced = await importDocuments([asset(nota)], "Forzada", undefined, {
      forceDuplicates: true,
    });
    expect(forced.duplicateImport).toBeFalsy();
    expect(await collectionCount()).toBe(2);
    expect(forced.importWarnings).toEqual([]);
    const db = await getDb();
    const rows = await db.getAllAsync<{ kind: string }>(
      "SELECT kind FROM custom_collection_docs WHERE collection_id = ?",
      [forced.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("forced");
  });
});

describe("C-06: el editado entra como copia nueva, avisada", () => {
  const PHRASE = "El paciente debe tomar el jarabe con las comidas. ";
  it("un trozo distinto de doce: entra entero con aviso similarImported nombrando la colección del parecido", async () => {
    const v1 = longBody(PHRASE, 400);
    // Un carácter distinto en el interior de un solo trozo (fuera del
    // solape de 200 con los vecinos): 11 trozos, 10 compartidos.
    const at = 1800 * 5 + 900;
    const v2 = v1.slice(0, at) + "X" + v1.slice(at + 1);
    const f1 = write("v1.txt", v1);
    const f2 = write("v2.txt", v2);
    await importDocuments([asset(f1)], "Original");
    const chunksV1 = await chunkCount();
    expect(chunksV1).toBeGreaterThan(8);

    const result = await importDocuments([asset(f2)], "Copia");
    expect(result.duplicateImport).toBeFalsy();
    expect(await collectionCount()).toBe(2);
    expect(await chunkCount()).toBe(chunksV1 * 2); // la copia entró entera
    expect(result.importWarnings).toEqual([
      { name: "v2.txt", reason: "similarImported", detail: "Original", previousName: "v1.txt" },
    ]);
  });

  it("un texto sin parentesco entra sin aviso de parecido", async () => {
    const f1 = write("v1.txt", longBody(PHRASE, 400));
    const f2 = write("otro.txt", longBody("La cosecha de maíz empieza en agosto. ", 400));
    await importDocuments([asset(f1)], "Original");
    const result = await importDocuments([asset(f2)], "Otro");
    expect(result.importWarnings).toEqual([]);
  });

  it("borde declarado: la nota de un solo trozo, editada, entra como copia sin aviso de parecido", async () => {
    // La detección de parecidos vive en la fracción de trozos: con un
    // solo trozo, cualquier edición es 0 trozos compartidos y la red
    // no la ve. Es el límite declarado de la tanda (el idéntico, que
    // es el daño medido, sí queda cazado siempre).
    const pdf = write("documento-prueba-ocr.pdf", "%PDF-1.4 doble");
    pdfTextByUri.set(pdf.uri, CLINIC_NOTE);
    pdfOcrByUri.set(pdf.uri, { text: " " });
    await importDocuments([asset(pdf)], "Nota");
    pdfTextByUri.set(pdf.uri, CLINIC_NOTE.replace("520-555-0147", "520-555-0199"));
    const result = await importDocuments([asset(pdf)], "Nota editada");
    expect(result.duplicateImport).toBeFalsy();
    expect(await collectionCount()).toBe(2);
    expect(result.importWarnings.filter((w) => w.reason === "similarImported")).toEqual([]);
  });
});

describe("C-06: los formatos reales de la ronda", () => {
  it("el PDF de la nota importado dos veces: el segundo intento es caso 1", async () => {
    const pdf = write("documento-prueba-ocr.pdf", "%PDF-1.4 doble");
    pdfTextByUri.set(pdf.uri, CLINIC_NOTE);
    pdfOcrByUri.set(pdf.uri, { text: "" });
    const first = await importDocuments([asset(pdf)], "Nota");
    expect(first.importWarnings).toEqual([
      { name: "documento-prueba-ocr.pdf", reason: "ocrEmpty" },
    ]);
    const chunksAfterFirst = await chunkCount();

    const second = await importDocuments([asset(pdf)], "Nota otra vez");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await chunkCount()).toBe(chunksAfterFirst);
    expect(second.importWarnings.map((w) => w.reason).sort()).toEqual(["alreadyImported", "ocrEmpty"]);
    const persisted = await listImportWarnings([first.id]);
    expect(persisted[first.id].map((w) => w.reason).sort()).toEqual(["alreadyImported", "ocrEmpty"]);
  });

  it("la imagen de la nota importada dos veces: caso 1 por la huella del texto reconocido", async () => {
    const png = write(
      "documento-prueba-ocr.png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    );
    imageOcrByUri.set(png.uri, { text: CLINIC_NOTE });
    const first = await importDocuments([asset(png)], "Foto");
    expect(first.importWarnings).toEqual([]);
    const second = await importDocuments([asset(png)], "Foto otra vez");
    expect(second.duplicateImport).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await collectionCount()).toBe(1);
  });
});

describe("ADV2-06: gemelos del mismo nombre, sin herencia cruzada", () => {
  const BAD = { error: new OcrError("OCR_FAILED", "engine died") };
  const setupTwins = (badFirst: boolean) => {
    const bad = write("informe.pdf", "%PDF-malo");
    const good = write("informe.pdf", "%PDF-bueno");
    pdfTextByUri.set(bad.uri, "");
    pdfOcrByUri.set(bad.uri, BAD);
    pdfTextByUri.set(good.uri, "Informe anual completo con su capa de texto entera.");
    pdfOcrByUri.set(good.uri, { text: "" });
    return badFirst ? [bad, good] : [good, bad];
  };

  it("el malo primero: el sano NO queda marcado ocrFailed con el código del otro", async () => {
    const result = await importDocuments(setupTwins(true), "Informes");
    expect(await chunkCount()).toBeGreaterThan(0);
    const failed = result.importWarnings.filter((w) => w.reason === "ocrFailed");
    const empty = result.importWarnings.filter((w) => w.reason === "ocrEmpty");
    expect(failed).toEqual([
      { name: "informe.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
    ]);
    // El sano lleva solo su propio ruido de costura (ocrEmpty), no la marca ajena.
    expect(empty).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
    expect(result.importWarnings).toHaveLength(2);
  });

  it("el sano primero: el mismo desenlace, sin depender del orden", async () => {
    const result = await importDocuments(setupTwins(false), "Informes");
    const failed = result.importWarnings.filter((w) => w.reason === "ocrFailed");
    const empty = result.importWarnings.filter((w) => w.reason === "ocrEmpty");
    expect(failed).toEqual([
      { name: "informe.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "engine died" },
    ]);
    expect(empty).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
    expect(result.importWarnings).toHaveLength(2);
  });
});

describe("H-11: los avisos sobreviven a la pantalla", () => {
  it("la fixture literal: mixto con OCR rechazando — el aviso se lee de la base, no del resultado", async () => {
    const foto = write("foto.txt", "Texto bueno de compañía.");
    const mixto = write("mixto.pdf", "%PDF-mixto");
    pdfTextByUri.set(mixto.uri, "Portada del informe anual. Ejercicio 2026.");
    pdfOcrByUri.set(mixto.uri, { error: new OcrError("OCR_FAILED", "native boom") });
    const result = await importDocuments([asset(foto), asset(mixto)], "Mixta");
    // «Cerrar y reabrir»: se lee SOLO lo persistido.
    const persisted = await listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "mixto.pdf", reason: "ocrFailed", ocrCode: "OCR_FAILED", ocrMessage: "native boom" },
    ]);
  });

  it("gemela ocrEmpty y una noText: las dos quedan persistidas con su razón propia", async () => {
    const bueno = write("bueno.txt", "Texto bueno de compañía.");
    const vacio = write("vacio.txt", "   ");
    const mixto = write("mixto.pdf", "%PDF-mixto");
    pdfTextByUri.set(mixto.uri, "Portada del informe anual. Ejercicio 2026.");
    pdfOcrByUri.set(mixto.uri, { text: "" });
    const result = await importDocuments([asset(bueno), asset(vacio), asset(mixto)], "Mixta");
    const persisted = await listImportWarnings([result.id]);
    expect(persisted[result.id]).toEqual([
      { name: "vacio.txt", reason: "noText" },
      { name: "mixto.pdf", reason: "ocrEmpty" },
    ]);
  });

  it("importación que fracasa entera: no se escribe ningún aviso (no hay colección donde colgarlo)", async () => {
    const malo = write("malo.pdf", "%PDF-malo");
    pdfTextByUri.set(malo.uri, "");
    pdfOcrByUri.set(malo.uri, { error: new OcrError("OCR_FAILED", "native boom") });
    await expect(importDocuments([asset(malo)], "x")).rejects.toMatchObject({ code: "ocrFailed" });
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM custom_collection_warnings",
    );
    expect(row?.n).toBe(0);
    expect(await collectionCount()).toBe(0);
  });
});

describe("C-06: registro perezoso de lo ya importado antes de la cura", () => {
  it("una colección precura (trozos sin huellas) se registra cosiendo sus trozos y el reimport cae en caso 1", async () => {
    const body = longBody("La receta de la sopa lleva pollo, arroz y cilantro. ", 60); // ~3.060 chars → 2 trozos
    const collId = "custom-900-precura";
    await createCustomCollection({
      id: collId,
      name: "Precura",
      sourceFilename: "sopa.txt",
      docCount: 1,
      chunkCount: 2,
      sizeBytes: 10,
    });
    const docId = `${collId}-doc0-sopa`;
    const trimmed = body.trim();
    await insertChunkWithoutEmbedding({
      chunkId: `${docId}-c0`,
      docId,
      title: "sopa",
      body: trimmed.slice(0, 2000),
      source: "sopa.txt",
      collectionId: collId,
    });
    await insertChunkWithoutEmbedding({
      chunkId: `${docId}-c1`,
      docId,
      title: "sopa",
      body: trimmed.slice(1800),
      source: "sopa.txt",
      collectionId: collId,
    });
    const db = await getDb();
    const before = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM custom_collection_docs",
    );
    expect(before?.n).toBe(0);

    const sopa = write("sopa.txt", body);
    const result = await importDocuments([asset(sopa)], "Sopa otra vez");
    expect(result.duplicateImport).toBe(true);
    expect(result.id).toBe(collId);
    expect(await collectionCount()).toBe(1);
  });
});
