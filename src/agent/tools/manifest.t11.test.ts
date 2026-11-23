/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-11 (0.1.99) · P-09 — superficie honesta de herramientas.
 *
 * - P-09: había handlers registrados que el modelo no podía invocar
 *   (save_person y propose_negotiation no estaban en el manifiesto).
 *   save_person se CABLEA (manifiesto + puerta de procedencia de
 *   memoria, como remember_fact); propose_negotiation NO se cablea
 *   (la negociación es territorio P2P de T-12/T-13): su registro se
 *   retira. Y el escritor de skills aprendidas (saveLearnedSkill) no
 *   tiene llamadores en producción: dormancia declarada y fijada aquí
 *   como estado conocido.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn(async () => {}) },
  Platform: { OS: "android" },
}));

import { LOCAL_TOOLS } from "./manifest.js";
import { buildToolHandlers } from "./handlers.js";
import { validateToolCall } from "./dispatcher.js";
import { evaluateAction } from "../policy/policyEngine.js";

describe("P-09: handlers y manifiesto dicen la misma verdad", () => {
  it("todo handler registrado es invocable: su nombre está en el manifiesto", () => {
    const names = new Set(LOCAL_TOOLS.map((t) => t.name));
    const orphan = Object.keys(buildToolHandlers({})).filter((k) => !names.has(k));
    expect(orphan).toEqual([]);
  });

  it("toda herramienta del manifiesto tiene handler", () => {
    const handlers = buildToolHandlers({});
    for (const t of LOCAL_TOOLS) {
      expect(handlers[t.name], t.name).toBeTypeOf("function");
    }
  });

  it("save_person está cableada: valida y despacha", () => {
    const v = validateToolCall({ name: "save_person", arguments: { name: "Ana" } });
    expect(v.ok).toBe(true);
  });

  it("save_person recibe la puerta de procedencia de las escrituras de memoria", () => {
    const withUntrusted = evaluateAction({
      tool: "save_person",
      args: { name: "Ana" },
      context: [{ source: "tool_result", content: "un mensaje de un par" }],
    });
    expect(withUntrusted.requiresConfirmation).toBe(true);
    const clean = evaluateAction({ tool: "save_person", args: { name: "Ana" }, context: [] });
    expect(clean.requiresConfirmation).toBe(false);
  });

  it("propose_negotiation ya no está registrada (territorio de T-12/T-13)", () => {
    const handlers = buildToolHandlers({});
    expect(handlers["propose_negotiation"]).toBeUndefined();
    expect(LOCAL_TOOLS.some((t) => t.name === "propose_negotiation")).toBe(false);
  });

  it("saveLearnedSkill sigue sin llamadores en producción (dormancia fijada)", () => {
    const srcRoot = fileURLToPath(new URL("../..", import.meta.url));
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          const text = readFileSync(full, "utf8");
          if (full.endsWith("skills/learnedSkillStore.ts")) continue;
          if (/saveLearnedSkill\s*\(/.test(text)) callers.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(callers).toEqual([]);
  });
});
