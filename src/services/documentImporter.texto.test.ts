/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.texto.test.ts — la batería propia del paso 2
 * de E6 contra la base real y ficheros reales:
 *
 * - D-12 (codificación, §3.1 del documento de etapa): UTF-8 con
 *   BOM entra limpio; lo que no decodifica se rechaza declarado
 *   como noText con su aviso, sin caracteres de sustitución.
 * - D-11 en su forma de texto: el texto que pasa del tope de
 *   fragmentos se rechaza antes de crear colección alguna, con
 *   la base sin filas del intento, y la suma del lote corta sin
 *   leer los ficheros que quedan.
 * - Los formatos y el despacho del paso: csv ingenuo, json en
 *   sus dos formas, el despacho por bytes (la magia manda sobre
 *   el nombre) y la degradación honesta a FTS sin motor.
 *
 * La cobertura del móvil por fichero (límites y datos0199)
 * vive en sus baterías recreadas con su nombre:
 * documentImporter.limits.test.ts y
 * documentImporter.datos0199.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

const embedWorld = ((globalThis as Record<string, unknown>).__nidoE6Embed ??= {
  mode: "ok" as "ok" | "unavailable",
}) as { mode: "ok" | "unavailable" };

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => {
      if (embedWorld.mode === "unavailable") {
        throw new Error("EmbeddingEngine: native embedding unavailable in this build (test double)");
      }
      return { vector: new Float32Array([0.1, 0.2, 0.3]), modelSha256: null };
    },
  },
}));

import {
  DocImportError,
  importDocuments,
  listImportWarnings,
  MAX_IMPORT_CHUNKS,
  maxCharsForChunks,
  type PickedDocumentFile,
} from "./documentImporter.js";
import {
  getDb,
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { _setOcrNativeForTests } from "./ocr.js";

let dir = "";
let fileSeq = 0;

function write(name: string, content: string | Uint8Array, sizeOverride?: number): PickedDocumentFile {
  const path = join(dir, `${fileSeq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: sizeOverride ?? null };
}

async function chunkCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunks");
  return row?.n ?? -1;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-texto-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});

beforeEach(async () => {
  await resetDatabase();
  embedWorld.mode = "ok";
  _setOcrNativeForTests(undefined);
});

afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("D-12 · codificación", () => {
  it("UTF-8 con BOM entra limpio: sin BOM ni caracteres de sustitución en lo guardado", async () => {
    const body = "El zorro marrón salta sobre el perro perezoso. Ñandú, corazón, pingüino.";
    const file = write("bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]));
    const created = await importDocuments([file], "Con BOM");
    expect(created.chunkCount).toBe(1);
    const db = await getDb();
    const row = await db.getFirstAsync<{ body: string }>("SELECT body FROM chunks");
    expect(row?.body).toBe(body);
    expect(row?.body).not.toContain("�");
    expect(row?.body?.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("lo que no decodifica en UTF-8 se rechaza declarado: noText y ninguna colección", async () => {
    // UTF-16LE con BOM: no es UTF-8 válido y no debe entrar con sustituciones.
    const utf16 = Buffer.from("Hola mundo", "utf16le");
    const file = write("utf16.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]));
    await expect(importDocuments([file], "UTF16")).rejects.toMatchObject({ code: "noText" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("en un lote mixto, el bueno entra y el indecodificable queda avisado como noText", async () => {
    const good = write("bueno.txt", "Contenido bueno y decodificable.");
    const bad = write("malo.txt", new Uint8Array([0x68, 0x6f, 0x6c, 0x61, 0x20, 0xe9, 0x28]));
    const created = await importDocuments([good, bad], "Mixto");
    expect(created.chunkCount).toBe(1);
    const warnings = await listImportWarnings([created.id]);
    expect(warnings[created.id]).toEqual([{ name: "malo.txt", reason: "noText" }]);
  });
});

describe("D-11 · topes antes de crear (texto)", () => {
  it("un texto sobre el tope de fragmentos se rechaza antes de crear colección alguna", async () => {
    const big = "a".repeat(maxCharsForChunks(MAX_IMPORT_CHUNKS) + 1);
    const file = write("grande.txt", big);
    await expect(importDocuments([file], "Grande")).rejects.toMatchObject({ code: "tooManyChunks" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("la suma del lote corta en cuanto pasa del tope, sin leer los ficheros que quedan", async () => {
    const half = "b".repeat(maxCharsForChunks(3000));
    const f1 = write("uno.txt", half);
    const f2 = write("dos.txt", half);
    const ghost: PickedDocumentFile = { uri: join(dir, "no-existe.txt"), name: "no-existe.txt", size: null };
    await expect(importDocuments([f1, f2, ghost], "Lote")).rejects.toMatchObject({
      code: "tooManyChunks",
    });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });
});

describe("formatos y despacho · la cobertura del paso", () => {
  it("una importación normal entra y su texto se encuentra por FTS", async () => {
    const file = write("notas.txt", "La fotosíntesis convierte la luz en energía química.");
    const created = await importDocuments([file], "Notas");
    expect(created.chunkCount).toBe(1);
    const db = await getDb();
    const hit = await db.getFirstAsync<{ chunk_id: string }>(
      "SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ?",
      ["fotosíntesis"],
    );
    expect(hit?.chunk_id).toBeTruthy();
    const collections = await listCustomCollections();
    expect(collections.map((c) => c.id)).toEqual([created.id]);
  });

  it("sin motor de embeddings, la importación degrada a FTS y entra igual", async () => {
    embedWorld.mode = "unavailable";
    const file = write("sinmotor.txt", "Texto que entra solo con su índice de palabras.");
    const created = await importDocuments([file], "Sin motor");
    expect(created.chunkCount).toBe(1);
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM chunk_embeddings");
    expect(row?.n).toBe(0);
  });

  it("el despacho manda por los bytes: un PNG llamado .txt va por la vía de imagen", async () => {
    // Sin módulo de OCR en el mundo de este caso (la costura en
    // null): lo que se cobra es la vía, no el desenlace del motor.
    _setOcrNativeForTests(null);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const file = write("disfraz.txt", png);
    await expect(importDocuments([file], "Disfraz")).rejects.toMatchObject({ code: "imageNoOcr" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("el despacho manda por los bytes: un PDF llamado .txt va por la vía de PDF", async () => {
    const file = write("disfraz2.txt", "%PDF-1.4 contenido falso");
    await expect(importDocuments([file], "Disfraz2")).rejects.toMatchObject({ code: "pdfUnreadable" });
    expect(await listCustomCollections()).toEqual([]);
  });

  it("un texto con extensión desconocida entra por su contenido", async () => {
    const file = write("datos.bin", "Texto llano con una extensión rara.");
    const created = await importDocuments([file], "Bin");
    expect(created.chunkCount).toBe(1);
  });

  it("el CSV ingenuo une las celdas con « | »", async () => {
    const file = write("tabla.csv", "nombre,edad\nAna,7");
    const created = await importDocuments([file], "Tabla");
    expect(created.chunkCount).toBe(1);
    const db = await getDb();
    const row = await db.getFirstAsync<{ body: string }>("SELECT body FROM chunks");
    expect(row?.body).toContain("nombre | edad");
    expect(row?.body).toContain("Ana | 7");
  });

  it("el JSON con la forma del corpus entra como documentos propios; el otro, como texto", async () => {
    const corpus = write(
      "corpus.json",
      JSON.stringify([
        { title: "Uno", source: "s1", body: "Cuerpo del primero." },
        { title: "Dos", source: "s2", body: "Cuerpo del segundo." },
      ]),
    );
    const created = await importDocuments([corpus], "Corpus");
    expect(created.docCount).toBe(2);
    const plain = write("plano.json", JSON.stringify({ clave: "valor" }));
    const created2 = await importDocuments([plain], "Plano");
    expect(created2.docCount).toBe(1);
  });

  it("DocImportError conserva su código (la clase del contrato)", () => {
    const e = new DocImportError("tooLarge", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("tooLarge");
  });
});

// ---------------------------------------------------------------
// Acto 2 del bloque de piezas sueltas: el veredicto unsupported
// del clasificador por bytes se cobra por fin. Hasta esta cura
// el despacho guardaba solo el kind y descartaba la razón, y
// ninguna rama ramificaba sobre "unsupported": un formato no
// soportado cuyos bytes decodificaban entraba como texto, y el
// que no decodificaba se rechazaba como noText cabalgando
// sobre la indecodificabilidad, no sobre el veredicto.

function crc32Zip(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Un ZIP real con entradas comprimidas (deflate), construido en el acto. */
function zipComprimido(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, "utf8");
    const deflated = deflateRawSync(raw);
    const crc = crc32Zip(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centrals.reduce((n, b) => n + b.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Un XLSX real (ZIP con la estructura de oficina), con compresión real. */
function xlsxReal(): Buffer {
  return zipComprimido([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Datos" sheetId="1"/></sheets></workbook>'],
    ["xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>nombre</t></is></c><c r="B1" t="inlineStr"><is><t>edad</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c><c r="B2"><v>7</v></c></row></sheetData></worksheet>'],
  ]);
}

describe("despacho · el veredicto unsupported se cobra", () => {
  it("el stub de ZIP íntegramente UTF-8 se rechaza como unsupported, no entra como texto", async () => {
    // La magia PK\x03\x04 y el resto ASCII: los bytes de control
    // son puntos de código UTF-8 válidos, así que la lectura de
    // texto lo decodifica entero — y aun así su veredicto manda.
    const stub = Buffer.from(
      "PK\x03\x04ZORROPLATA el zorro de plata guarda su texto buscable dentro de un archivo artesanal",
      "utf8",
    );
    const file = write("archivo.zip", stub);
    await expect(importDocuments([file], "Stub")).rejects.toMatchObject({ code: "unsupported" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("el stub en lote mixto: el bueno entra y el aviso persistido es unsupported", async () => {
    const good = write("bueno.txt", "Contenido bueno y decodificable.");
    const stub = write(
      "archivo.zip",
      Buffer.from("PK\x03\x04ZORROPLATA otro texto artesanal que decodifica", "utf8"),
    );
    const created = await importDocuments([good, stub], "Mixto ZIP");
    expect(created.chunkCount).toBe(1);
    const warnings = await listImportWarnings([created.id]);
    expect(warnings[created.id]).toEqual([{ name: "archivo.zip", reason: "unsupported" }]);
  });

  it("una hoja real renombrada se rechaza como unsupported, no como noText", async () => {
    const file = write("datos.bin", xlsxReal());
    await expect(importDocuments([file], "Hoja")).rejects.toMatchObject({ code: "unsupported" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });

  it("la hoja real renombrada en lote mixto: el aviso persistido es unsupported", async () => {
    const good = write("bueno.txt", "Contenido bueno y decodificable.");
    const sheet = write("datos.bin", xlsxReal());
    const created = await importDocuments([good, sheet], "Mixto hoja");
    expect(created.chunkCount).toBe(1);
    const warnings = await listImportWarnings([created.id]);
    expect(warnings[created.id]).toEqual([{ name: "datos.bin", reason: "unsupported" }]);
  });

  it("un ZIP binario ordinario con su nombre se rechaza como unsupported", async () => {
    const zip = zipComprimido([
      ["notas.txt", "El contenido comprimido de un ZIP ordinario, con texto de sobra para que la compresión sea real y los bytes resultantes no decodifiquen como UTF-8."],
      ["otra.txt", "Segunda entrada del archivo, también comprimida."],
    ]);
    const file = write("copia.zip", zip);
    await expect(importDocuments([file], "ZIP")).rejects.toMatchObject({ code: "unsupported" });
    expect(await listCustomCollections()).toEqual([]);
    expect(await chunkCount()).toBe(0);
  });
});
