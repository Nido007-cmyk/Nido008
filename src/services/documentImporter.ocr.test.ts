/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.ocr.test.ts — la puerta D-5 de E6 (paso 6)
 * contra la base real y el motor de OCR real:
 *
 * - El PDF escaneado entra por OCR: la marca de procedencia va
 *   dentro del texto del primer fragmento de cada página
 *   reconocida, origen 'ocr' y la página real en cada
 *   fragmento.
 * - El PDF mixto reparte: su página de texto entra como texto
 *   y la escaneada como OCR, en el mismo documento.
 * - Una imagen entra por su texto reconocido, con su
 *   procedencia.
 * - Sin motor (la costura en null), el escaneado se nombra
 *   scannedNoOcr, nunca un documento vacío.
 * - HEIC sin decodificador confirmado se nombra imageNoOcr
 *   sin intentarlo (el dirimen de la firma 4).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

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
  listCollectionChunks,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { _setOcrNativeForTests, OCR_PROVENANCE_NOTE } from "./ocr.js";
import { terminateOcrEngine } from "./ocrEngine.js";
import { makeMixedPdf, makeScannedPdf } from "./pdfTestFixtures.js";

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const NOTES = Object.values(OCR_PROVENANCE_NOTE);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-d5-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
  _setOcrNativeForTests(undefined);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  _setOcrNativeForTests(undefined);
  await terminateOcrEngine();
  rmSync(dir, { recursive: true, force: true });
});

describe("D-5 · el escaneado entra por OCR", () => {
  it("el PDF escaneado entra con procedencia en el primer fragmento de cada página, origen ocr y su página", async () => {
    const pdf = write(
      "escaneado.pdf",
      makeScannedPdf(["El jarabe se toma dos veces al dia", "La cita es el martes a las nueve"]),
    );
    const created = await importDocuments([pdf], "Escaneado");
    expect(created.importWarnings ?? []).toEqual([]);
    const rows = await listCollectionChunks(created.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const p1 = rows.filter((r) => r.page === 1);
    const p2 = rows.filter((r) => r.page === 2);
    expect(p1.length).toBeGreaterThanOrEqual(1);
    expect(p2.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.origen === "ocr")).toBe(true);
    // La procedencia abre el primer fragmento de CADA página.
    expect(NOTES.some((n) => p1[0].body.startsWith(n))).toBe(true);
    expect(NOTES.some((n) => p2[0].body.startsWith(n))).toBe(true);
    expect(flat(p1.map((r) => r.body).join(" "))).toContain("jarabe");
    expect(flat(p2.map((r) => r.body).join(" "))).toContain("martes");
  }, 180_000);

  it("el PDF mixto reparte: la página de texto entra como texto y la escaneada como ocr", async () => {
    const pdf = write(
      "mixto.pdf",
      makeMixedPdf("Portada del informe anual del ejercicio", "El balance escaneado del ejercicio"),
    );
    const created = await importDocuments([pdf], "Mixto");
    const rows = await listCollectionChunks(created.id);
    const p1 = rows.filter((r) => r.page === 1);
    const p2 = rows.filter((r) => r.page === 2);
    expect(p1.length).toBeGreaterThanOrEqual(1);
    expect(p1.every((r) => r.origen === "texto")).toBe(true);
    expect(flat(p1[0].body)).toContain("portada del informe");
    expect(p2.length).toBeGreaterThanOrEqual(1);
    expect(p2.every((r) => r.origen === "ocr")).toBe(true);
    expect(flat(p2.map((r) => r.body).join(" "))).toContain("balance");
  }, 180_000);

  it("una imagen entra por su texto reconocido, con su procedencia y sin página", async () => {
    const canvas = createCanvas(1100, 220);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1100, 220);
    ctx.fillStyle = "black";
    ctx.font = "46px sans-serif";
    ctx.fillText("La receta de la abuela lleva cilantro", 40, 110);
    const foto = write("foto.png", canvas.toBuffer("image/png"));
    const created = await importDocuments([foto], "Foto");
    const rows = await listCollectionChunks(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].origen).toBe("ocr");
    expect(rows[0].page).toBeNull();
    expect(NOTES.some((n) => rows[0].body.startsWith(n))).toBe(true);
    expect(flat(rows[0].body)).toContain("cilantro");
  }, 180_000);

  it("sin motor, el escaneado se nombra scannedNoOcr, nunca un documento vacío", async () => {
    _setOcrNativeForTests(null);
    const pdf = write("escaneado.pdf", makeScannedPdf(["El jarabe se toma dos veces al dia"]));
    await expect(importDocuments([pdf], "Escaneado")).rejects.toMatchObject({
      code: "scannedNoOcr",
    });
  }, 60_000);

  it("HEIC sin decodificador confirmado se nombra imageNoOcr sin intentarlo", async () => {
    // Una muestra ftyp con marca heic: la familia del dirimen.
    const sample = new Uint8Array(32);
    sample.set([0, 0, 0, 24], 0);
    sample.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    sample.set([0x68, 0x65, 0x69, 0x63], 8); // heic
    const foto = write("foto.heic", sample);
    await expect(importDocuments([foto], "Foto")).rejects.toMatchObject({ code: "imageNoOcr" });
  }, 60_000);
});
