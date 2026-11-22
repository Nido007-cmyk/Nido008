/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.d2.test.ts — D-2 repetido en el paso 8,
 * con presupuesto y borrados ejercitados: cero texto en
 * claro.
 *
 * El canario vive en un documento importado de verdad (un
 * texto y una imagen que entra por OCR). Tras importar,
 * tras reiniciar la base y tras borrar la colección, el
 * barrido de bytes no lo encuentra en NINGÚN fichero de los
 * directorios que la app usa (el de la base — fuera de los
 * ficheros de la propia base —, el de datos del OCR y el de
 * caché de exportaciones, que es donde un resto podría
 * quedar). La exportación, que sí escribe el texto en un
 * JSON para entregarlo, lo borra al terminar: el barrido lo
 * comprueba también.
 *
 * La pata de dentro de la base se cobra dos veces: esta
 * batería NO instala el driver de fixture en claro, así que
 * su base de conocimiento es el fichero cifrado real de
 * producción y el barrido lo incluye entero (la búsqueda en
 * claro sobre él da cero); y una segunda vez, como unidad,
 * contra openSecureDatabase con una DEK efímera.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";

vi.mock("../rag/embed.js", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({
      vector: new Float32Array([0.1, 0.2, 0.3]),
      modelSha256: null,
    }),
  },
}));

import {
  deleteCustomCollection,
  exportCollection,
  importDocuments,
  setCollectionShareHandler,
  setImportCacheDirProvider,
  type PickedDocumentFile,
} from "./documentImporter.js";
import { setOcrDataDir, terminateOcrEngine } from "./ocrEngine.js";
import { openSecureDatabase } from "../security/secureDatabase.js";
import {
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

const CANARY = "CANARIO-D2-E6-9f27c1::el zorro marron salta sobre el perro perezoso::31415926";

let root = "";
let dbDir = "";
let cacheDir = "";
let ocrDir = "";
let srcDir = "";

function scanForCanary(dir: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (readFileSync(p).includes(CANARY)) {
        hits.push(p);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return hits;
}

function scanAll(): string[] {
  // La base de esta batería es el fichero cifrado real: el
  // barrido lo incluye entero, sin exenciones.
  return [...scanForCanary(dbDir), ...scanForCanary(cacheDir), ...scanForCanary(ocrDir)];
}

function write(name: string, content: string | Uint8Array): PickedDocumentFile {
  const path = join(srcDir, name);
  writeFileSync(path, content);
  return { uri: path, name, size: null };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nido-e6-d2-"));
  dbDir = join(root, "db");
  cacheDir = join(root, "cache");
  ocrDir = join(root, "ocr-data");
  srcDir = join(root, "fuentes");
  for (const d of [cacheDir, ocrDir, srcDir]) mkdirSync(d, { recursive: true });
  setKnowledgeDbDir(dbDir);
  setKnowledgeDbDekProvider(fixtureDekProvider);
  setImportCacheDirProvider(() => `${cacheDir}/`);
  setOcrDataDir(ocrDir);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  setImportCacheDirProvider(null);
  setOcrDataDir(null);
  setCollectionShareHandler(null);
  await terminateOcrEngine();
  rmSync(root, { recursive: true, force: true });
});

describe("D-2 repetido · cero texto en claro", () => {
  it("el canario no aparece en bytes fuera de la base: tras importar, tras reiniciar, tras exportar y tras borrar", async () => {
    const txt = write("canario.txt", `El documento del canario. ${CANARY} Y sigue el texto del documento con mas contenido para trocear bien.`);
    // La imagen con el canario pintado entra por OCR: su
    // píxel tampoco puede quedar en claro en ningún sitio.
    const canvas = createCanvas(1400, 200);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 1400, 200);
    ctx.fillStyle = "black";
    ctx.font = "34px sans-serif";
    ctx.fillText("CANARIO-D2-E6-9f27c1 el zorro marron", 30, 100);
    const img = write("canario.png", canvas.toBuffer("image/png"));

    const created = await importDocuments([txt, img], "Canario");
    expect(created.chunkCount).toBeGreaterThan(0);
    expect(scanAll()).toEqual([]);

    // Reinicio: el fichero cifrado se vuelve a abrir con su
    // DEK (la reapertura que la app hace al arrancar) y la
    // colección sigue dentro, sin derrames.
    const reopened = openSecureDatabase(join(dbDir, "nido_knowledge.db"), fixtureDekProvider());
    const row = reopened
      .prepare(`SELECT id FROM custom_collections WHERE id = ?`)
      .get(created.id) as { id: string } | undefined;
    expect(row?.id).toBe(created.id);
    reopened.close();
    expect(scanAll()).toEqual([]);

    // La exportación entrega y borra su JSON en claro.
    let delivered = "";
    setCollectionShareHandler(async (path) => {
      delivered = path;
    });
    const [collection] = await listCustomCollections();
    await exportCollection(collection);
    expect(delivered).toContain("nido-export-");
    expect(existsSync(delivered)).toBe(false);
    expect(scanAll()).toEqual([]);

    // El borrado no deja restos tampoco.
    await deleteCustomCollection(created.id);
    expect(scanAll()).toEqual([]);
  }, 180_000);

  it("dentro de la base cifrada real, la búsqueda en claro del canario da cero", () => {
    const cipherDir = join(root, "cifrada");
    mkdirSync(cipherDir, { recursive: true });
    const dbPath = join(cipherDir, "nido_knowledge.db");
    const db = openSecureDatabase(dbPath, randomBytes(32));
    db.exec("CREATE TABLE notas (id INTEGER PRIMARY KEY, cuerpo TEXT NOT NULL)");
    db.prepare("INSERT INTO notas (cuerpo) VALUES (?)").run(CANARY);
    db.close();
    // Ni el fichero principal ni sus sidecars lo llevan.
    expect(scanForCanary(cipherDir)).toEqual([]);
  });
});
