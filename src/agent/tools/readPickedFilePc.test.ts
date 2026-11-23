/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la cura H-02 (cadena de curas, acto 8):
 * read_picked_file en PC, degradación honesta en la forma del
 * precedente NIDO. La herramienta se queda en el catálogo
 * diciendo la verdad: su descripción declara el estado de PC
 * y la vía de la Biblioteca, su handler responde el texto
 * sellado de no disponible en vez del error con el mensaje
 * interno del import imposible, la ruta pickFile sirve ese
 * texto sin encadenar un análisis fingido, y las dos skills
 * que la prescribían dejan de prescribir el selector.
 *
 * Nace en rojo contra la punta sin curar (la descripción
 * promete el selector, el handler sirve el error con
 * tripas, las skills prescriben el paso imposible); el
 * primer caso es la guarda de que no es un retiro.
 */

import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS } from "./manifest.js";
import { buildToolHandlers, setHandlerLangForTest } from "./handlers.js";
import { runToolAction, type ToolRouterDeps } from "../loop/toolRouter.js";
import { BUILT_IN_SKILLS } from "../skills/builtIn.js";

const DESCRIPCION =
  "Lee el contenido como texto de un archivo que el usuario elija (máx. 200 KB). " +
  "En PC el selector de archivos todavía no está disponible en esta etapa: la herramienta " +
  "responde eso mismo y remite a importar el documento desde la Biblioteca de NIDO " +
  "o a pegar su texto en el chat.";

const SELLADO_ES =
  "En esta computadora todavía no puedo abrir el selector de archivos. Importa el documento desde la Biblioteca de NIDO y pídeme que lo use, o pega su texto aquí.";

describe("cura H-02 · read_picked_file en PC: degradación honesta", () => {
  it("la herramienta sigue en el catálogo (no es un retiro)", () => {
    expect(LOCAL_TOOLS.map((t) => t.name)).toContain("read_picked_file");
  });

  it("su descripción declara el estado de PC y la vía de la Biblioteca", () => {
    const entry = LOCAL_TOOLS.find((t) => t.name === "read_picked_file");
    expect(entry?.description).toBe(DESCRIPCION);
  });

  it("la ruta pickFile sirve el texto sellado y no encadena analyze_table", async () => {
    setHandlerLangForTest("es");
    try {
      const handlers = buildToolHandlers({});
      const calls: string[] = [];
      const deps: ToolRouterDeps = {
        dispatch: async (name, args) => {
          calls.push(name);
          const h = handlers[name];
          return { status: "executed", text: h ? await h(args) : "ok" };
        },
        isDisabled: () => false,
        listNotes: async () => [],
        now: () => new Date(),
      };
      const out = await runToolAction({ kind: "pickFile", analyze: true, lang: "es" }, deps);
      expect(out.response).toBe(SELLADO_ES);
      expect(calls).toEqual(["read_picked_file"]);
    } finally {
      setHandlerLangForTest(null);
    }
  });

  it("la skill analiza-datos ya no prescribe el selector y nombra la Biblioteca", () => {
    const skill = BUILT_IN_SKILLS.find((s) => s.name === "analiza-datos");
    const text = skill?.instructions ?? "";
    expect(text).not.toContain("usa `read_picked_file`");
    expect(text).toContain("Biblioteca");
  });

  it("la skill resume-archivo ya no prescribe el selector y nombra la Biblioteca", () => {
    const skill = BUILT_IN_SKILLS.find((s) => s.name === "resume-archivo");
    const text = skill?.instructions ?? "";
    expect(text).not.toContain("`read_picked_file` para que elija el archivo");
    expect(text).toContain("Biblioteca");
  });
});
