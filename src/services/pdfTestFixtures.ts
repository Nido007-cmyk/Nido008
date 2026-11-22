/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * pdfTestFixtures.ts — un escritor de PDF mínimo para las
 * baterías de la etapa E6: genera PDFs reales y válidos (tabla
 * xref con sus desplazamientos, fuente Helvetica base) con el
 * texto dado, una página por entrada. Sin dependencias: lo que
 * las baterías necesitan es un PDF de verdad que pdfjs y
 * poppler lean igual, no un documento bonito.
 */

import { createCanvas } from "@napi-rs/canvas";

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Un PDF con una página por cadena; cada cadena puede llevar
 * varias líneas separadas por \n. Una cadena vacía da una
 * página sin capa de texto (la forma de una página escaneada
 * sin OCR).
 */
export function makePdf(pages: string[]): Uint8Array {
  return makePdfFromStreams(
    pages.map((text) => {
      const lines = text.length === 0 ? [] : text.split("\n");
      const ops = lines
        .map(
          (line, j) =>
            `${j === 0 ? "BT /F1 18 Tf 56 780 Td" : "0 -24 Td"} (${escapePdfText(line)}) Tj`,
        )
        .join("\n");
      return lines.length === 0 ? "" : `${ops}\nET`;
    }),
  );
}

/**
 * Un PDF escaneado de verdad: cada página es una IMAGEN (JPEG
 * del texto pintado con el lienzo empaquetado) sin capa de
 * texto — la forma que el OCR existe para leer. Una página por
 * cadena; la cadena vacía da una página en blanco.
 */
export function makeScannedPdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  let next = 4;
  const pageObjs: Array<{ page: number; content: number; image: number }> = [];
  const pageObjNums: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    pageObjs.push({ page: next++, content: next++, image: next++ });
    pageObjNums.push(pageObjs[i].page);
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  pages.forEach((text, i) => {
    const { page, content, image } = pageObjs[i];
    const W = 1224;
    const H = 1584;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "black";
    ctx.font = "44px sans-serif";
    text.split("\n").forEach((line, j) => ctx.fillText(line, 60, 120 + j * 64));
    const jpeg = canvas.toBuffer("image/jpeg");
    objects[page] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${content} 0 R /Resources << /XObject << /Im0 ${image} 0 R >> >> >>`;
    const stream = `q 612 0 0 792 0 0 cm /Im0 Do Q`;
    objects[content] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[image] =
      `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
      `stream\n${jpeg.toString("latin1")}\nendstream`;
  });
  return assemblePdf(objects);
}

/**
 * La forma cruda: una página por flujo de contenido ya escrito.
 * Sirve para las fixtures que makePdf no expresa (la bomba de
 * descompresión: muchas operaciones de texto reposicionadas
 * sobre la misma página, que es como un PDF pequeño escupe
 * mucho texto de verdad).
 */
export function makePdfFromStreams(streams: string[]): Uint8Array {
  const pages = streams;
  // Los desplazamientos de la xref se cuentan sobre la cadena:
  // los flujos son ASCII (la Helvetica base sin codificación
  // declarada no da más de sí, y así la cuenta de caracteres es
  // la de bytes).
  for (const p of pages) {
    if (/[^\x00-\x7F]/.test(p)) throw new Error("makePdf: solo texto ASCII");
  }
  const objects: string[] = [];
  const pageObjNums: number[] = [];
  // 1 = catálogo, 2 = árbol de páginas, 3 = fuente; las páginas
  // y sus contenidos van después, en orden.
  let next = 4;
  const pageObjs: Array<{ page: number; content: number }> = [];
  for (let i = 0; i < pages.length; i++) {
    pageObjs.push({ page: next++, content: next++ });
    pageObjNums.push(pageObjs[i].page);
  }
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  pages.forEach((stream, i) => {
    const { page, content } = pageObjs[i];
    objects[page] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${content} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[content] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  return assemblePdf(objects);
}

/**
 * Un PDF mixto de dos páginas: la primera con capa de texto y
 * la segunda escaneada (imagen sin capa), la forma del PDF
 * real que la detección de §3.3 reparte entre extracción y OCR.
 */
export function makeMixedPdf(texto: string, escaneado: string): Uint8Array {
  const objects: string[] = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  // Página 1: texto.
  objects[4] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
  const stream1 = `BT /F1 18 Tf 56 780 Td (${escapePdfText(texto)}) Tj ET`;
  objects[5] = `<< /Length ${stream1.length} >>\nstream\n${stream1}\nendstream`;
  // Página 2: la imagen escaneada.
  const W = 1224;
  const H = 1584;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "black";
  ctx.font = "44px sans-serif";
  ctx.fillText(escaneado, 60, 120);
  const jpeg = canvas.toBuffer("image/jpeg");
  objects[6] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Contents 7 0 R /Resources << /XObject << /Im0 8 0 R >> >> >>`;
  const stream2 = `q 612 0 0 792 0 0 cm /Im0 Do Q`;
  objects[7] = `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`;
  objects[8] =
    `<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
    `stream\n${jpeg.toString("latin1")}\nendstream`;
  return assemblePdf(objects);
}

/**
 * Ensambla los objetos con su xref. La codificación es latin1:
 * un carácter es un byte, que es lo que las fixtures con
 * binario incrustado (el JPEG del escaneado) necesitan y lo
 * que el texto ASCII ya cumplía.
 */
function assemblePdf(objects: string[]): Uint8Array {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n`;
  out += "0000000000 65535 f \n";
  for (let n = 1; n < objects.length; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
