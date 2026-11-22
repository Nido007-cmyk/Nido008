/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La fixture evalSetV2 se consume sellada en PC (tanda 12 · J-10):
 * esta batería guarda su sello — censo, reparto, versión y huella
 * del fichero — y la caracterización de foldForEval de la fuente.
 * La batería de la fuente validaba además cada caso contra el
 * árbol de paquetes en Markdown (knowledge-packs/), que en PC no
 * existe: los packs de PC son los SQLite instalados por la puerta
 * de E5, y esa verdad la miden el arnés de la re-derivación y la
 * construcción de PC-01 contra el índice real, no esta batería.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EVAL_SET_V2, EVAL_SET_V2_VERSION, foldForEval } from "./evalSetV2.js";

const FIXTURE_SHA256 = "37904546221a62164629aa6bed05e4641d731cab777b7d78ce3bc0d7b59339a0";

describe("evaluación v2: la fixture consumida sellada", () => {
  it("la huella del fichero es la sellada", () => {
    const bytes = readFileSync(fileURLToPath(new URL("./cases/v2.json", import.meta.url)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
  });

  it("censo: 118 casos exactos, version 2", () => {
    expect(EVAL_SET_V2.length).toBe(118);
    expect(EVAL_SET_V2_VERSION).toBe("2");
  });

  it("reparto de runners: device 53, ci-router 27, ci-safety 20, pack-retrieval+device 18", () => {
    const byRunner = new Map<string, number>();
    for (const c of EVAL_SET_V2) byRunner.set(c.runner, (byRunner.get(c.runner) ?? 0) + 1);
    expect(byRunner.get("device")).toBe(53);
    expect(byRunner.get("ci-router")).toBe(27);
    expect(byRunner.get("ci-safety")).toBe(20);
    expect(byRunner.get("pack-retrieval+device")).toBe(18);
  });

  it("ids únicos", () => {
    const ids = EVAL_SET_V2.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runners y grupos válidos", () => {
    for (const c of EVAL_SET_V2) {
      expect(["ci-router", "ci-safety", "pack-retrieval+device", "device"]).toContain(c.runner);
      expect(["es", "en", "pt"]).toContain(c.lang);
    }
  });

  it("caracterización de foldForEval (de la fuente): solo quita tildes y mayúsculas; puntuación y blanco intactos", () => {
    expect(foldForEval("¡Emergencia, MÉDICO!")).toBe("¡emergencia, medico!");
    expect(foldForEval("Calle   50\tNorte")).toBe("calle   50\tnorte");
  });
});
