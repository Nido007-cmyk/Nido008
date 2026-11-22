/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asiento de PC (E3, tanda 3 · J-2): batería recreada del 0.1.108
 * bajo la decisión de puerta firmada en la apertura de la tanda
 * (estudios/E3-J2-APERTURA.md §2.2.1 y §3). Sus 11 casos corren
 * LITERALES: ni el texto ni las afirmaciones cambian. Lo que
 * cambia es la plataforma que el andamiaje sustituye, como la
 * apertura firma: los cuatro puntos de sustitución del original
 * (`llama.rn`, `expo-file-system/legacy`, `ram-monitor` y
 * `../models/modelTrust`) se sustituyen por la envoltura del
 * motor de PC:
 *
 *   - `llama.rn` (initLlama) → `node-llama-cpp` (getLlama →
 *     loadModel → createEmbeddingContext), con el mismo contexto
 *     falso del original: una llamada mientras otra corre se
 *     rechaza («Context is busy») y el vector es `[text.length]`.
 *   - `expo-file-system/legacy` (existencia y tamaño) →
 *     `node:fs/promises` (`stat`), y la resolución del fichero
 *     dentro del directorio de modelos, que vive en la vía.
 *   - `ram-monitor` (las lecturas de RAM) → `node:os`
 *     (`totalmem`/`freemem`); la matemática que las juzga es la
 *     real de la casa (`src/core/ram.ts`), como `ramBudget`
 *     corría real en el original. Las variables del andamiaje
 *     conservan su nombre y su sentido: la RAM libre que la
 *     pieza ve es total − rss, la foto que el monitor del móvil
 *     resumía.
 *   - `../models/modelTrust` (la puerta de integridad) →
 *     `../core/loadPath.js`, la vía única de carga de la casa:
 *     resolución contenida, tamaño y huella verificados. Aquí se
 *     sustituye por su forma de andamiaje: el fichero falso
 *     «existe» en el directorio de modelos y su huella es la de
 *     su nombre (la del e5 para el fichero multilingüe, la de
 *     bge para `embedding.gguf`), que es el hecho de plataforma
 *     que el original fijaba con el manifiesto real: en el móvil
 *     la etiqueta salía de buscar el nombre en el catálogo; en
 *     PC la identidad del modelo cargado es la huella verificada
 *     del fichero (ver el asiento de apertura de la tanda), y el
 *     andamiaje la fija por nombre como el original fijaba la
 *     suya por catálogo.
 *
 * El resto del entorno corre real, como en el original: la
 * puerta de carga (`../inference/nativeGate`), el manifiesto
 * adaptador (`../models/manifest`) y los perfiles.
 */

import { describe, it, expect, vi } from "vitest";

let busy = false;

let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;

const BGE_SHA256 = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
const E5_SHA256 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    totalmem: () => mockTotalRamBytes,
    freemem: () => Math.max(0, mockTotalRamBytes - mockRssBytes),
  };
});

vi.mock("node-llama-cpp", () => ({
  getLlama: async () => ({
    loadModel: async () => ({
      createEmbeddingContext: async () => ({
        // Like llama.rn: a second call while one is running is rejected.
        getEmbeddingFor: async (text: string) => {
          if (busy) throw new Error("Context is busy");
          busy = true;
          await new Promise((r) => setTimeout(r, 5));
          busy = false;
          return { vector: [text.length] };
        },
        dispose: async () => {},
      }),
      dispose: async () => {},
    }),
  }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async () => ({ isFile: () => true, size: 132_441_664 }),
  };
});

// The integrity gate is the load path of the house; here it is
// stubbed so engine behavior is tested in isolation (the path
// itself is covered by src/core/loadPath.test.ts).
vi.mock("../core/loadPath.js", () => ({
  resolveModelFile: async (_modelsDir: string, fileName: string) => `/modelos/${fileName}`,
  verifyModelFile: async () => {},
  sha256OfFile: async (file: string) =>
    file.endsWith("embedding-multilingual.gguf") ? E5_SHA256 : BGE_SHA256,
}));

import { EmbeddingEngine } from "./embed.js";

describe("EmbeddingEngine", () => {
  it("runs overlapping embed calls one at a time", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    const results = await Promise.all(["a", "bb", "ccc"].map((t) => engine.embed(t)));
    expect(results.map((r) => r[0])).toEqual([1, 2, 3]);
  });

  it("waits for a load that's still in progress before embedding", async () => {
    const engine = new EmbeddingEngine();
    const load = engine.load("models/embedding.gguf");
    const embedded = engine.embed("abcd");
    await load;
    expect((await embedded)[0]).toBe(4);
  });

  it("refuses to load with a clear RAM error when the device cannot fit it", async () => {
    // 2 GiB device fully crowded: nothing fits, not even the small embedding context.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 2 * 1024 ** 3;
    try {
      const engine = new EmbeddingEngine();
      await expect(engine.load("models/embedding.gguf")).rejects.toThrow(/RAM/);
    } finally {
      mockTotalRamBytes = 12 * 1024 ** 3;
      mockRssBytes = 1024 ** 3;
    }
  });
});

describe("EmbeddingEngine — residencia bajo demanda (optimización 2026-11-08, fase 4)", () => {
  it("tras descargar, el siguiente uso recarga solo con la memoria de la sesión", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    expect(engine.isLoaded).toBe(false);
    expect((await engine.embed("ab"))[0]).toBe(2);
    expect(engine.isLoaded).toBe(true);
  });

  it("sin memoria ni proveedor, ensureLoaded devuelve false y embed sigue lanzando «model not loaded»", async () => {
    const engine = new EmbeddingEngine();
    await expect(engine.ensureLoaded()).resolves.toBe(false);
    await expect(engine.embed("ab")).rejects.toThrow(/model not loaded/);
  });

  it("el vuelo falso no se pega: un proveedor registrado DESPUÉS de un false carga (E6 paso 7)", async () => {
    // El defecto: sin proveedor ni memoria, el cuerpo del
    // vuelo se completa en síncrono y su finally limpiaba
    // `ensuring` ANTES de la asignación — el vuelo resuelto en
    // false quedaba pegado y ningún registro posterior del
    // proveedor volvía a intentar la carga.
    const engine = new EmbeddingEngine();
    await expect(engine.ensureLoaded()).resolves.toBe(false);
    engine.setEnsureLoadedProvider(async () => "models/embedding.gguf");
    await expect(engine.ensureLoaded()).resolves.toBe(true);
    expect(engine.isLoaded).toBe(true);
  });

  it("el proveedor registrado resuelve el fichero la primera vez", async () => {
    const engine = new EmbeddingEngine();
    engine.setEnsureLoadedProvider(async () => "models/embedding.gguf");
    await expect(engine.ensureLoaded()).resolves.toBe(true);
    expect(engine.isLoaded).toBe(true);
    expect((await engine.embedQuery("ab"))[0]).toBe(2);
  });

  it("las recargas concurrentes comparten un solo vuelo", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    const [a, b] = await Promise.all([engine.embed("a"), engine.embed("bb")]);
    expect([a[0], b[0]]).toEqual([1, 2]);
    expect(engine.isLoaded).toBe(true);
  });

  it("la marca de último uso vive en el motor y la renueva cada búsqueda (0.1.84)", async () => {
    // Cierre de la desviación de la fase 4: antes la marca solo la
    // ponía ChatScreen al arrancar y las búsquedas no la renovaban,
    // así que el pulso descargaba el motor pese a uso reciente.
    const engine = new EmbeddingEngine();
    expect(engine.lastUsedAtMs).toBeNull();
    await engine.load("models/embedding.gguf");
    const afterLoad = engine.lastUsedAtMs;
    expect(afterLoad).not.toBeNull();
    const realNow = Date.now;
    let fake = afterLoad! + 60_000;
    Date.now = () => fake;
    try {
      await engine.embed("ab");
      expect(engine.lastUsedAtMs).toBe(fake);
      fake += 60_000;
      await engine.embedQuery("ab");
      expect(engine.lastUsedAtMs).toBe(fake);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("EmbeddingEngine — per-model prefixes (multilingual search)", () => {
  it("e5: questions get 'query: ', stored texts 'passage: ', tagged with the model", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding-multilingual.gguf");
    expect((await engine.embedQuery("ab"))[0]).toBe("query: ab".length);
    expect((await engine.embedPassage("ab"))[0]).toBe("passage: ab".length);
    const tagged = await engine.embedPassageTagged("ab");
    expect(tagged.modelSha256).toBe("802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde");
    expect(engine.profile.id).toBe("multilingual-e5-small");
  });

  it("bge: no prefixes, exactly as before", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    expect((await engine.embedQuery("ab"))[0]).toBe(2);
    expect((await engine.embedPassage("ab"))[0]).toBe(2);
    expect((await engine.embedQueryTagged("ab")).modelSha256).toBe(
      "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514"
    );
    expect(engine.profile.id).toBe("bge-small-en");
  });

  it("unloaded → no model tag", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    expect(engine.loadedModelSha256).toBeNull();
  });
});
