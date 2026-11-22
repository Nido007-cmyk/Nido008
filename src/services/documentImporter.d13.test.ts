/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.d13.test.ts — D-13 entero (paso 9): cero
 * conexiones durante la importación completa de CADA
 * formato.
 *
 * El instrumento es el del paso 3 llevado a todos los
 * formatos: `fetch` sustituido por un contador que lanza y
 * `net.Socket.prototype.connect` contado, alrededor de la
 * importación completa (extracción y OCR incluidos). Los
 * fixtures incluyen las dos tentaciones nombradas por la
 * puerta: un PDF con una acción URI externa y una acción
 * remota GoToR en su anotación (recursos que «querrían»
 * salir) y un PNG con metadatos XMP que nombran una URL.
 * La barra: cero intentos de fetch y cero conexiones en
 * todos los formatos.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import { createCanvas, loadImage } from "@napi-rs/canvas";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3]),
      modelSha256: null,
    }),
  },
}));

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import { makeMixedPdf, makePdf, makeScannedPdf } from "./pdfTestFixtures.js";
import { terminateOcrEngine } from "./ocrEngine.js";
import { resetDatabase, setKnowledgeDbDekProvider, setKnowledgeDbDir } from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

let dir = "";

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, name);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

/** Un PDF cuyo catálogo abre una acción URI externa y cuya
 * página lleva una anotación con una acción remota: lo más
 * parecido a «querer salir» que el formato ofrece. */
function makeWantingOutPdf(): Uint8Array {
  const objects: string[] = [
    "",
    `<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R] >>`,
    `<< /Type /Action /S /URI /URI (https://example.invalid/salir) >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    "",
    `<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /Type /Action /S /GoToR /F (https://example.invalid/remoto.pdf) /D [0 /Fit] >> >>`,
  ];
  const stream = "BT /F1 18 Tf 72 720 Td (Texto con enlaces que no deben seguirse) Tj ET";
  objects[6] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Un PNG con un bloque tEXt XMP que nombra una URL remota. */
function pngWithRemoteXmp(png: Buffer): Buffer {
  const xmp =
    "XML:com.adobe.xmp\0<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF><rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:source>https://example.invalid/origen-remoto</dc:source></rdf:Description></rdf:RDF></x:xmpmeta>";
  const data = Buffer.from(xmp, "latin1");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from("tEXt"), data])), 8 + data.length);
  // Se inserta tras la cabecera IHDR (8 de firma + 25 de IHDR).
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

/** Un BMP de 32 bits construido desde los píxeles del lienzo
 * (el lienzo de la casa no codifica BMP; el formato se
 * escribe a mano, que es lo que un fichero real trae). */
async function makeBmp(): Promise<Buffer> {
  const canvas = createCanvas(700, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 700, 120);
  ctx.fillStyle = "black";
  ctx.font = "40px sans-serif";
  ctx.fillText("EL ZORRO MARRON SALTA", 20, 70);
  const img = await loadImage(canvas.toBuffer("image/png"));
  const c2 = createCanvas(img.width, img.height);
  const x2 = c2.getContext("2d");
  x2.drawImage(img, 0, 0);
  const rgba = x2.getImageData(0, 0, img.width, img.height).data;
  const { width, height } = img;
  const rowBytes = width * 4;
  const pixelBytes = rowBytes * height;
  const out = Buffer.alloc(54 + pixelBytes);
  out.write("BM", 0, "latin1");
  out.writeUInt32LE(54 + pixelBytes, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22); // positivo: filas de abajo arriba
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(32, 28);
  out.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const si = (srcY * width + x) * 4;
      const di = 54 + (y * width + x) * 4;
      out[di] = rgba[si + 2]; // B
      out[di + 1] = rgba[si + 1]; // G
      out[di + 2] = rgba[si]; // R
      out[di + 3] = rgba[si + 3]; // A
    }
  }
  return out;
}

function textImage(mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif"): Buffer {
  const canvas = createCanvas(700, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 700, 120);
  ctx.fillStyle = "black";
  ctx.font = "40px sans-serif";
  ctx.fillText("EL ZORRO MARRON SALTA", 20, 70);
  // Los tipos de @napi-rs/canvas no declaran 'image/gif' en
  // toBuffer aunque el runtime lo codifica (GIF89a real,
  // comprobado); el gif sale por encodeSync, que sí lo tipa.
  switch (mime) {
    case "image/png":
      return canvas.toBuffer("image/png");
    case "image/jpeg":
      return canvas.toBuffer("image/jpeg");
    case "image/webp":
      return canvas.toBuffer("image/webp");
    case "image/gif":
      return canvas.encodeSync("gif");
  }
}

async function importUnderCensus(file: PickedDocumentFile, name: string): Promise<number> {
  const fetchUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    fetchUrls.push(String(input));
    throw new Error("red censada");
  }) as typeof fetch;
  let connects = 0;
  const proto = net.Socket.prototype as unknown as { connect: (...args: unknown[]) => unknown };
  const originalConnect = proto.connect;
  proto.connect = function (...args: unknown[]) {
    connects++;
    return originalConnect.apply(this, args);
  };
  try {
    const created = await importDocuments([file], name);
    expect(connects, `conexiones al importar ${file.name}`).toBe(0);
    expect(
      fetchUrls.filter((u) => /^https?:|^wss?:/.test(u)),
      `fetch al importar ${file.name}`,
    ).toEqual([]);
    return created.chunkCount;
  } finally {
    globalThis.fetch = originalFetch;
    proto.connect = originalConnect;
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-d13-"));
  setKnowledgeDbDir(dir);
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  await terminateOcrEngine();
  rmSync(dir, { recursive: true, force: true });
});

describe("D-13 entero · cero conexiones en la importación completa de cada formato", () => {
  it("texto y markdown", async () => {
    expect(await importUnderCensus(write("a.txt", "Un texto llano que no debe salir a ninguna parte."), "Texto")).toBe(1);
    expect(await importUnderCensus(write("b.md", "# Titulo\n\nUn markdown tranquilo y local."), "Markdown")).toBe(1);
  }, 60_000);

  it("PDF de texto y PDF con recursos que querrían salir", async () => {
    expect(await importUnderCensus(write("c.pdf", makePdf(["Un PDF de texto, en local."])), "PdfTexto")).toBe(1);
    expect(await importUnderCensus(write("d.pdf", makeWantingOutPdf()), "PdfSaliente")).toBe(1);
  }, 60_000);

  it("PDF escaneado y PDF mixto (con OCR)", async () => {
    expect(
      await importUnderCensus(write("e.pdf", makeScannedPdf(["EL ZORRO MARRON", "SALTA SOBRE EL PERRO", "PEREZOSO DEL RIO"])), "PdfEscaneado"),
    ).toBeGreaterThan(0);
    expect(
      await importUnderCensus(write("f.pdf", makeMixedPdf("Texto nativo de la primera pagina.", "TEXTO PINTADO EN LA SEGUNDA")), "PdfMixto"),
    ).toBeGreaterThan(0);
  }, 180_000);

  it("imágenes: PNG con XMP remoto, JPG, WebP, GIF y BMP (con OCR)", async () => {
    const png = pngWithRemoteXmp(textImage("image/png"));
    expect(await importUnderCensus(write("g.png", png), "PngXmp")).toBeGreaterThan(0);
    expect(await importUnderCensus(write("h.jpg", textImage("image/jpeg")), "Jpg")).toBeGreaterThan(0);
    expect(await importUnderCensus(write("i.webp", textImage("image/webp")), "Webp")).toBeGreaterThan(0);
    expect(await importUnderCensus(write("j.gif", textImage("image/gif")), "Gif")).toBeGreaterThan(0);
    expect(await importUnderCensus(write("k.bmp", await makeBmp()), "Bmp")).toBeGreaterThan(0);
  }, 300_000);
});
