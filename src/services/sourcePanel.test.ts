/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * sourcePanel.test.ts — las puertas D-1 y D-10 de E6 (paso 7)
 * contra la base real y los motores reales de texto:
 *
 * - D-1: el PDF de 12 páginas con la frase única solo en la
 *   pág. 7 se cita con «pág. 7»; la misma frase en dos
 *   páginas cita la del fragmento que sostuvo la respuesta;
 *   un txt cita sin página. El panel sirve el texto de la
 *   página citada desde la base, con su cabecera «pág. 7 de
 *   12».
 * - D-10: la respuesta que escribe «página 99» en prosa no
 *   gana ninguna cita ni etiqueta; el marcador fuera de
 *   rango cae por el limpiador de siempre y la única página
 *   visible es la del metadato.
 *
 * El motor de embeddings es el doble de vectores constantes
 * de la batería del paso 5: la discriminación entre páginas
 * la hace la vía léxica, que es la que la frase de control
 * ejercita.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../rag/embed.js", () => {
  const vector = () => {
    const v = new Float32Array(384).fill(1);
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };
  return {
    embeddingEngine: {
      get loadedModelSha256() {
        return null;
      },
      embedPassage: async () => vector(),
      embedPassageTagged: async () => ({ vector: vector(), modelSha256: null }),
      embedQueryTagged: async () => ({ vector: vector(), modelSha256: null }),
    },
  };
});

import { importDocuments, type PickedDocumentFile } from "./documentImporter.js";
import { sourcePanelData } from "./sourcePanel.js";
import { retrieve } from "../rag/retrieve.js";
import { buildEvidenceCard } from "../rag/evidenceCard.js";
import { stripInvalidCitations } from "../rag/grounding.js";
import {
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";
import { makePdf } from "./pdfTestFixtures.js";

let dir = "";
let seq = 0;

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, `${seq++}-${name}`);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

const FILLER =
  "Pagina de relleno del contrato con clausulas generales de la vivienda, el plazo, la fianza y las reparaciones menores de cada mes.";

function twelvePages(uniqueAt7: boolean, dupAt3and9 = false): string[] {
  const pages = Array.from({ length: 12 }, () => FILLER);
  if (uniqueAt7) pages[6] = "La presion maxima de la caldera es de dos bares segun la revision anual del tecnico.";
  if (dupAt3and9) {
    pages[2] = "El anexo menciona la presion de la caldera sin mas detalle.";
    pages[8] =
      "La presion de la caldera del sotano se revisa en marzo con la valvula nueva y queda anotada en el parte de mantenimiento firmado.";
  }
  return pages;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-d1-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("D-1 · la cita dice la página del fragmento que sostuvo la respuesta", () => {
  it("la frase única en la pág. 7 de 12: la tarjeta y el chip citan «pág. 7» y el panel sirve esa página", async () => {
    const pdf = write("Contrato de alquiler.pdf", makePdf(twelvePages(true)));
    await importDocuments([pdf], "Contrato");
    const chunks = await retrieve("¿Que presion maxima lleva la caldera segun la revision anual?", 5);
    expect(chunks.length).toBeGreaterThan(0);
    const card = buildEvidenceCard(chunks, "presion maxima caldera revision anual", null, { lang: "es" });
    expect(card?.page).toBe(7);
    expect(card?.label).toBe("Contrato de alquiler · pág. 7");

    const panel = await sourcePanelData(chunks[card!.index], "es");
    expect(panel.label).toBe("Contrato de alquiler · pág. 7");
    expect(panel.pageHeader).toBe("pág. 7 de 12");
    expect(panel.pageText).toContain("presion maxima de la caldera");
    // El texto servido es el de la página 7, no el del documento entero.
    expect(panel.pageText).not.toContain("Pagina de relleno");
  }, 60_000);

  it("la misma frase en dos páginas: cita la del fragmento que sostuvo la respuesta", async () => {
    const pdf = write("Contrato de alquiler.pdf", makePdf(twelvePages(false, true)));
    await importDocuments([pdf], "Contrato");
    const chunks = await retrieve("¿Cuando se revisa la presion de la caldera del sotano con la valvula nueva?", 5);
    const card = buildEvidenceCard(chunks, "presion caldera sotano valvula nueva marzo", null, { lang: "es" });
    expect(card?.page).toBe(9);
    expect(card?.label).toBe("Contrato de alquiler · pág. 9");
  }, 60_000);

  it("un txt cita sin página: la etiqueta es solo el documento y el panel no finge página", async () => {
    const txt = write("Notas de la caldera.txt", "La presion de la caldera es de dos bares y se revisa cada primavera con el tecnico de siempre.");
    await importDocuments([txt], "Notas");
    const chunks = await retrieve("¿Que presion lleva la caldera?", 5);
    expect(chunks.length).toBeGreaterThan(0);
    const card = buildEvidenceCard(chunks, "presion caldera", null, { lang: "es" });
    expect(card?.page).toBeNull();
    expect(card?.label).toBe("Notas de la caldera");
    const panel = await sourcePanelData(chunks[0], "es");
    expect(panel.pageHeader).toBeNull();
    expect(panel.pageText).toBeNull();
  }, 60_000);
});

describe("D-10 · la prosa del modelo no fabrica páginas", () => {
  it("«página 99» en prosa no gana cita ni etiqueta; el marcador fuera de rango cae y la única página visible es la del metadato", async () => {
    const pdf = write("Contrato de alquiler.pdf", makePdf(twelvePages(true)));
    await importDocuments([pdf], "Contrato");
    const chunks = await retrieve("¿Que presion maxima lleva la caldera segun la revision anual?", 5);
    const answer =
      "La presion maxima es de dos bares [1]. Como dice la página 99 del manual, conviene revisar la valvula cada año [99].";
    const cleaned = stripInvalidCitations(answer, chunks.length);
    // El marcador válido se queda; el [99] sin fuente cae.
    expect(cleaned).toContain("[1]");
    expect(cleaned).not.toContain("[99]");
    // La prosa sigue siendo prosa: ninguna superficie de cita la
    // convierte en página. Las etiquetas del turno salen solo
    // del metadato, y ninguna dice 99.
    const labels = await Promise.all(chunks.map((c) => sourcePanelData(c, "es")));
    expect(labels.every((l) => !l.label.includes("99"))).toBe(true);
    expect(labels.some((l) => l.label === "Contrato de alquiler · pág. 7")).toBe(true);
  }, 60_000);
});
