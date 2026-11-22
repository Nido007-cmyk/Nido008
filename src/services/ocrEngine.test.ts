/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * ocrEngine.test.ts — el motor de OCR de PC contra ficheros
 * reales (E6, paso 6): tesseract.js con los datos locales lee
 * una imagen pintada y las páginas escaneadas de un PDF
 * pintándolas en memoria; la detección de escaneadas es la de
 * §3.3 y la contraseña se nombra por el contrato. Sin red: los
 * datos salen de los paquetes instalados.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import {
  isOcrAvailable,
  recognizeImageText,
  recognizeScannedPdfPages,
} from "./ocr.js";
import { terminateOcrEngine } from "./ocrEngine.js";
import { makePdf, makeScannedPdf } from "./pdfTestFixtures.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
let dir = "";

function write(name: string, content: string | Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function textImage(text: string): Buffer {
  const canvas = createCanvas(1100, 220);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1100, 220);
  ctx.fillStyle = "black";
  ctx.font = "46px sans-serif";
  ctx.fillText(text, 40, 110);
  return canvas.toBuffer("image/png");
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-ocr-"));
});
afterAll(async () => {
  await terminateOcrEngine();
  rmSync(dir, { recursive: true, force: true });
});

describe("el motor de OCR empaquetado", () => {
  it("está disponible y reconoce el texto de una imagen", async () => {
    expect(await isOcrAvailable()).toBe(true);
    const uri = write("nota.png", textImage("La presion de la caldera es dos bares"));
    const text = await recognizeImageText(uri, "es");
    expect(flat(text)).toContain("presion de la caldera");
    expect(flat(text)).toContain("dos bares");
  }, 120_000);

  it("detecta las páginas escaneadas y las reconoce con su número y su origen", async () => {
    const uri = write(
      "escaneado.pdf",
      makeScannedPdf(["El jarabe se toma dos veces al dia", "La cita es el martes a las nueve"]),
    );
    const pages = await recognizeScannedPdfPages(uri, "es");
    expect(pages).not.toBeNull();
    expect(pages?.map((p) => p.pagina)).toEqual([1, 2]);
    expect(pages?.every((p) => p.origen === "ocr")).toBe(true);
    expect(flat(pages?.[0].texto ?? "")).toContain("jarabe");
    expect(flat(pages?.[1].texto ?? "")).toContain("martes");
  }, 120_000);

  it("un PDF de solo texto no tiene páginas escaneadas: null, sin aviso", async () => {
    const uri = write("texto.pdf", makePdf(["Pagina con capa de texto completa y normal."]));
    expect(await recognizeScannedPdfPages(uri, "es")).toBeNull();
  }, 60_000);

  it("la contraseña se nombra por el contrato: PASSWORD_REQUIRED", async () => {
    await expect(
      recognizeScannedPdfPages(join(FIXTURES, "pdf-cifrado.pdf"), "es"),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
  }, 60_000);
});
