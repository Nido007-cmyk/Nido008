/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería del motor (nace en E4 paso 5 con F-PC63, en la
 * forma que su preparación firmó): `node-llama-cpp` se
 * sustituye en la costura del módulo por un doble cuya
 * sesión cuenta 3 tokens por `onToken` y se asienta en el
 * mismo tick, y el reloj fino se espía por caso. Su objeto
 * es la aritmética de las cifras, no la generación: ningún
 * modelo real se carga aquí. Los tres casos de F-PC63 son
 * los de su tabla (dos nacieron en rojo contra el cociente
 * sin suelo: Infinity y su null en JSON).
 *
 * El cuarto caso es la regresión de la tanda 1 que la
 * apertura cobra en la puerta del paso 5 (tras `unload()`,
 * `countTokens` falla como `ask`), asentado aquí sin sumar
 * a las cifras de la etapa.
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("node-llama-cpp", () => {
  class FakeSession {
    constructor(_opts: unknown) {}
    async prompt(
      _prompt: string,
      opts: { onToken?: () => void },
    ): Promise<string> {
      opts.onToken?.();
      opts.onToken?.();
      opts.onToken?.();
      return " respuesta ";
    }
    dispose(): void {}
  }
  const fakeModel = {
    tokenize: (text: string) => new Array(text.length).fill(0),
    createContext: async () => ({
      getSequence: () => ({}),
      dispose: async () => undefined,
    }),
    dispose: async () => undefined,
  };
  return {
    getLlama: async () => ({ loadModel: async () => fakeModel }),
    LlamaChatSession: FakeSession,
  };
});

import type { CatalogEntry } from "./catalog.js";
import { LocalEngine } from "./engine.js";

const payload = Buffer.from("gguf falso pero con su huella en regla");
const entry: CatalogEntry = {
  id: "motor-falso",
  label: "Motor falso",
  kind: "llm",
  fileBytes: payload.length,
  arch: { layers: 1, kvHeads: 1, headDim: 8, vocab: 100 },
  maxContext: 2048,
  license: "MIT",
  sourceUrl: "https://example.invalid/motor-falso.gguf",
  revision: "test",
  sha256: createHash("sha256").update(payload).digest("hex"),
  role: "light",
  note: "fixture",
};

const dir = await mkdtemp(path.join(os.tmpdir(), "nido-engine-"));
await writeFile(path.join(dir, "motor-falso.gguf"), payload);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** El reloj fino espiado: cada lectura cobra el siguiente valor dado. */
function spyClock(readings: number[]): void {
  let i = 0;
  vi.spyOn(performance, "now").mockImplementation(() => readings[Math.min(i++, readings.length - 1)]);
}

describe("F-PC63 · el cociente de velocidad de ask, con suelo", () => {
  it("reloj congelado (inicio = fin), 3 tokens: la velocidad es finita, 0, no medida", async () => {
    spyClock([1000, 1000]);
    const engine = await LocalEngine.load(dir, entry, 2048);
    const answer = await engine.ask("¿qué hora es?");
    expect(answer.stats.answerTokens).toBe(3);
    expect(answer.stats.generationSeconds).toBe(0);
    expect(answer.stats.tokensPerSecond).toBe(0);
    expect(Number.isFinite(answer.stats.tokensPerSecond)).toBe(true);
    await engine.unload();
  });

  it("el mismo caso, serializado: el JSON de stats conserva la cifra, no un null", async () => {
    spyClock([1000, 1000]);
    const engine = await LocalEngine.load(dir, entry, 2048);
    const answer = await engine.ask("¿qué hora es?");
    const json = JSON.stringify(answer.stats) as string;
    expect(json).toContain('"tokensPerSecond":0');
    expect(json).not.toContain("null");
    await engine.unload();
  });

  it("250 ms de transcurso, 3 tokens: 12 tok/s (control)", async () => {
    spyClock([1000, 1250]);
    const engine = await LocalEngine.load(dir, entry, 2048);
    const answer = await engine.ask("¿qué hora es?");
    expect(answer.stats.generationSeconds).toBeCloseTo(0.25, 10);
    expect(answer.stats.tokensPerSecond).toBeCloseTo(12, 10);
    await engine.unload();
  });

  it("regresión de la tanda 1: tras unload(), countTokens y ask fallan con «engine not loaded»", async () => {
    const engine = await LocalEngine.load(dir, entry, 2048);
    expect(engine.countTokens("hola")).toBe(4);
    await engine.unload();
    expect(() => engine.countTokens("hola")).toThrow("engine not loaded");
    await expect(engine.ask("hola")).rejects.toThrow("engine not loaded");
  });
});
