/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * documentImporter.exportSweep.test.ts — la batería SEC-04
 * del móvil recreada en PC (3 declaraciones, su aserción
 * entera), en su forma de PC: sistema de ficheros real en un
 * temporal y la base real, con las costuras de exportación
 * del importador (el directorio de caché y el entregador)
 * fijadas por la batería.
 *
 * SEC-04: el JSON de exportCollection lleva el texto entero
 * de la colección y vive en la caché hasta entregarse; si el
 * proceso muere a mitad, el finally no corre y el JSON en
 * claro queda huérfano. La cura: prefijo reservado
 * `nido-export-`, registro de exportaciones vivas y un
 * barrido que borra los *.json de nivel superior que ningún
 * proceso vivo posee, conservando por nombre la telemetría
 * y sin tocar directorios ni otros formatos.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  exportCollection,
  importDocuments,
  setCollectionShareHandler,
  setImportCacheDirProvider,
  sweepOrphanedCollectionExports,
  type PickedDocumentFile,
} from "./documentImporter.js";
import {
  listCustomCollections,
  resetDatabase,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../rag/db.js";
import { fixtureDekProvider } from "../rag/dbTestHarness.js";

let dir = "";
let cacheDir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-e6-sweep-"));
  cacheDir = join(dir, "cache");
  mkdirSync(cacheDir, { recursive: true });
  setKnowledgeDbDir(join(dir, "db"));
  setKnowledgeDbDekProvider(fixtureDekProvider);
  setImportCacheDirProvider(() => `${cacheDir}/`);
});
beforeEach(async () => {
  await resetDatabase();
  for (const name of readdirSync(cacheDir)) {
    rmSync(join(cacheDir, name), { recursive: true, force: true });
  }
  setCollectionShareHandler(null);
});
afterAll(async () => {
  await resetDatabase();
  setKnowledgeDbDekProvider(null);
  setKnowledgeDbDir(null);
  setImportCacheDirProvider(null);
  setCollectionShareHandler(null);
  rmSync(dir, { recursive: true, force: true });
});

const seed = (name: string, content = "{}") => writeFileSync(join(cacheDir, name), content);

describe("SEC-04: el barrido de exportaciones huérfanas", () => {
  it("borra exactamente los .json huérfanos y legados de nivel superior y conserva el resto", async () => {
    seed("nido-export-viejo.json", "[{\"title\":\"x\"}]");
    seed("legado.json", "{}");
    seed("execution_telemetry.json", "{}"); // conservado por nombre
    seed("notas.txt", "no es json");
    mkdirSync(join(cacheDir, "carpeta.json")); // un directorio no se toca
    const deleted = await sweepOrphanedCollectionExports();
    expect(deleted).toBe(2);
    expect(readdirSync(cacheDir).sort()).toEqual(["carpeta.json", "execution_telemetry.json", "notas.txt"]);
  });

  it("respeta una exportación viva en vuelo y su prefijo reservado; el finally sigue limpiando", async () => {
    const src = join(dir, "manual.txt");
    writeFileSync(src, "La caldera lleva dos bares. ".repeat(30));
    const file: PickedDocumentFile = { uri: src, name: "manual.txt", size: null };
    await importDocuments([file], "Manual");
    const [collection] = await listCustomCollections();

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let deliveredPath = "";
    setCollectionShareHandler(async (path) => {
      deliveredPath = path;
      await gate;
    });
    const exporting = exportCollection(collection);
    // La exportación está en vuelo: su fichero existe y es suyo.
    await vi.waitFor(() => expect(existsSync(deliveredPath || "nada")).toBe(true));
    expect(deliveredPath).toContain("nido-export-");
    expect(await sweepOrphanedCollectionExports()).toBe(0);
    expect(existsSync(deliveredPath)).toBe(true);
    release();
    await exporting;
    // Tras entregar, el finally borra el JSON en claro.
    expect(existsSync(deliveredPath)).toBe(false);
  });

  it("devuelve 0 y nunca lanza con la caché vacía o ilegible", async () => {
    expect(await sweepOrphanedCollectionExports()).toBe(0);
    setImportCacheDirProvider(() => join(dir, "no-existe") + "/");
    expect(await sweepOrphanedCollectionExports()).toBe(0);
    setImportCacheDirProvider(() => `${cacheDir}/`);
  });
});
