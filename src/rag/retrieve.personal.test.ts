/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * retrieve.personal.test.ts — la puerta del paso 5 de E6
 * (indexado y búsqueda) contra la base real:
 *
 * - Una pregunta se responde SOLO con un documento personal
 *   activo: la base nace vacía, el único contenido es el
 *   documento importado, y la recuperación lo sirve con su
 *   procedencia entera (colección, página, origen) hasta la
 *   tarjeta de evidencia.
 * - El interruptor `active` manda: desactivada la colección,
 *   la misma pregunta no sirve nada; reactivada, vuelve.
 * - D-8: con el sello cambiado por la vía explícita (los
 *   vectores del modelo anterior caen y la base se re-sella),
 *   ningún resultado sale de un índice de otro modelo, el
 *   estado de reindexado pendiente se lee por colección, y
 *   tras reembebber la pregunta vuelve a servirse.
 *
 * El motor de embeddings es un doble de vectores constantes
 * (coseno 1 con todo): lo que se juzga es la fontanería del
 * sello, del interruptor y de la procedencia, no la calidad
 * semántica — esa la juzgan las baterías del motor real.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const world = ((globalThis as Record<string, unknown>).__nidoE6Search ??= {
  sha: "",
}) as { sha: string };

vi.mock("./embed.js", () => {
  const vector = () => {
    const v = new Float32Array(384).fill(1);
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };
  return {
    embeddingEngine: {
      // La propiedad que el reembebido lee para saber qué modelo
      // está cargado: sigue al mundo, como el motor real sigue al
      // cambio de modelo.
      get loadedModelSha256() {
        return world.sha || null;
      },
      embedPassage: async () => vector(),
      embedPassageTagged: async () => ({ vector: vector(), modelSha256: world.sha }),
      embedQueryTagged: async () => ({ vector: vector(), modelSha256: world.sha }),
    },
  };
});

import { retrieve } from "./retrieve.js";
import { buildEvidenceCard } from "./evidenceCard.js";
import {
  countCollectionVectors,
  getEmbeddingStamp,
  resetDatabase,
  resetEmbeddingsForModel,
  setCustomCollectionActive,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "./db.js";
import { reembedMissing } from "./reembed.js";
import { fixtureDekProvider } from "./dbTestHarness.js";
import {
  BGE_SMALL_EN_SHA256,
  MULTILINGUAL_E5_SMALL_SHA256,
} from "./embeddingProfile.js";
import { importDocuments, type PickedDocumentFile } from "../services/documentImporter.js";
import { makePdf } from "../services/pdfTestFixtures.js";

let dir = "";

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(dir, name);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

const QUERY = "¿Que presion lleva la caldera de casa?";
const SYNONYM_QUERY = "¿Que marca el manometro del circuito de calefaccion?";

async function importManual(): Promise<string> {
  const pdf = write(
    "manual.pdf",
    makePdf([
      "Manual de la caldera de casa. Portada.",
      "La presion de la caldera debe marcar dos bares en frio.",
    ]),
  );
  const created = await importDocuments([pdf], "Manual de casa");
  return created.id;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-busqueda-"));
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
});
beforeEach(async () => {
  await resetDatabase();
  world.sha = MULTILINGUAL_E5_SMALL_SHA256;
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("paso 5 · la pregunta y el interruptor", () => {
  it("la pregunta se responde solo con el documento personal activo, con su procedencia entera", async () => {
    const collectionId = await importManual();
    const hits = await retrieve(QUERY);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.collectionId === collectionId)).toBe(true);
    expect(hits.every((h) => h.sourceKind === "user")).toBe(true);
    const deLaPaginaDos = hits.find((h) => h.body.includes("dos bares"));
    expect(deLaPaginaDos?.page).toBe(2);
    expect(deLaPaginaDos?.origen).toBe("texto");
    // La tarjeta de evidencia corona el documento personal.
    const card = buildEvidenceCard(hits, QUERY);
    expect(card?.chunkId).toBe(deLaPaginaDos?.chunkId);
  }, 30_000);

  it("con la colección desactivada la misma pregunta no sirve nada; reactivada, vuelve", async () => {
    const collectionId = await importManual();
    expect((await retrieve(QUERY)).length).toBeGreaterThan(0);
    await setCustomCollectionActive(collectionId, false);
    expect(await retrieve(QUERY)).toEqual([]);
    expect(await retrieve(SYNONYM_QUERY)).toEqual([]);
    await setCustomCollectionActive(collectionId, true);
    expect((await retrieve(QUERY)).length).toBeGreaterThan(0);
  }, 30_000);
});

describe("D-8 · el sello manda sobre el índice", () => {
  it("sello cambiado: ningún resultado de otro modelo, reindexado pendiente, y tras reembebber vuelve", async () => {
    const collectionId = await importManual();
    expect(await getEmbeddingStamp()).toBe(MULTILINGUAL_E5_SMALL_SHA256);
    expect(await countCollectionVectors(collectionId)).toMatchObject({ pending: 0 });
    // Antes del cambio, la pregunta por sinónimos (sin solape
    // léxico con el documento) se sirve por la vía semántica.
    expect((await retrieve(SYNONYM_QUERY)).length).toBeGreaterThan(0);

    // La vía explícita de cambio de modelo: los vectores caen y
    // la base se re-sella al otro modelo del catálogo.
    await resetEmbeddingsForModel(BGE_SMALL_EN_SHA256);
    world.sha = BGE_SMALL_EN_SHA256;
    expect(await getEmbeddingStamp()).toBe(BGE_SMALL_EN_SHA256);
    const state = await countCollectionVectors(collectionId);
    expect(state.chunks).toBeGreaterThan(0);
    expect(state.withVector).toBe(0);
    expect(state.pending).toBe(state.chunks);
    // Ningún resultado sale del índice del modelo anterior.
    expect(await retrieve(SYNONYM_QUERY)).toEqual([]);

    // El reembebido reconstruye bajo el sello nuevo y la
    // pregunta vuelve a servirse, con la procedencia intacta.
    await reembedMissing();
    const after = await countCollectionVectors(collectionId);
    expect(after.pending).toBe(0);
    const hits = await retrieve(SYNONYM_QUERY);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.collectionId === collectionId)).toBe(true);
    expect(hits.find((h) => h.body.includes("dos bares"))?.page).toBe(2);
  }, 60_000);
});
