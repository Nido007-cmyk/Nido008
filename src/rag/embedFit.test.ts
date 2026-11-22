/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * embedFit.test.ts — H-E6-4 (E6, paso 9): la entrada que pasa
 * del contexto usable del modelo de embeddings.
 *
 * El hecho, medido en la pasada del paso 9 sobre los fixtures
 * sellados: node-llama-cpp RECHAZA con «Input is longer than
 * the usable context size» cualquier entrada de más de 512
 * tokens, y 23 de los 27 fragmentos de 2.000 caracteres de los
 * documentos sellados pasan de 512 tokens en español. La capa
 * nativa del móvil (llama.rn, n_ctx 512) trunca en silencio:
 * el mismo fragmento se incrusta allí y aquí rompía la
 * importación entera, porque el importador solo degrada ante
 * «native embedding unavailable».
 *
 * La batería fija la costura alineada: el motor recorta la
 * entrada a los tokens que caben (el vector es el de ese
 * prefijo, como en el móvil) y el texto que cabe va byte a
 * byte intacto. El doble de plataforma reproduce el hecho:
 * tokeniza por palabras, su getEmbeddingFor lanza el error
 * real si recibe más de 512, y registra lo recibido.
 */
import { describe, it, expect, vi } from "vitest";

let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;

const E5_SHA256 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const BGE_SHA256 = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";

/** Las palabras del último texto tokenizado (el registro del doble). */
let palabras: string[] = [];
/** El último texto que el contexto recibió. */
let recibido: string | null = null;

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
      // Un «token» por palabra: tokenizar es partir, y
      // destokenizar es volver a juntar las primeras n.
      tokenize: (text: string) => {
        palabras = text.split(" ");
        return palabras.map((_, i) => i);
      },
      detokenize: (tokens: readonly number[]) => tokens.map((i) => palabras[i]).join(" "),
      createEmbeddingContext: async () => ({
        getEmbeddingFor: async (text: string) => {
          recibido = text;
          // Como la binding real medida: con contexto de 512
          // acepta 510 y rechaza 511 (reserva 2).
          if (text.split(" ").length > 510) {
            throw new Error(
              "Input is longer than the usable context size. Try to increase the context size or use another model that supports longer contexts.",
            );
          }
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

vi.mock("../core/loadPath.js", () => ({
  resolveModelFile: async (_modelsDir: string, fileName: string) => `/modelos/${fileName}`,
  verifyModelFile: async () => {},
  sha256OfFile: async (file: string) =>
    file.endsWith("embedding-multilingual.gguf") ? E5_SHA256 : BGE_SHA256,
}));

import { EmbeddingEngine } from "./embed.js";

function palabrasN(n: number): string {
  return Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");
}

describe("EmbeddingEngine — ajuste al contexto usable (H-E6-4)", () => {
  it("un fragmento de más de 512 tokens se incrusta recortado a lo que cabe, no rompe", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding-multilingual.gguf");
    const vector = await engine.embedPassage(palabrasN(600));
    expect(vector.length).toBe(1);
    expect(recibido).not.toBeNull();
    expect(recibido!.split(" ").length).toBeLessThanOrEqual(510);
    // El prefijo del perfil e5 viaja dentro del texto ajustado.
    expect(recibido!.startsWith("passage:")).toBe(true);
  });

  it("el texto que cabe va byte a byte intacto", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding-multilingual.gguf");
    const texto = palabrasN(120);
    await engine.embedPassage(texto);
    expect(recibido).toBe(`passage: ${texto}`);
  });

  it("la vía de consulta también se ajusta", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding-multilingual.gguf");
    await engine.embedQuery(palabrasN(700));
    expect(recibido!.split(" ").length).toBeLessThanOrEqual(510);
  });
});
