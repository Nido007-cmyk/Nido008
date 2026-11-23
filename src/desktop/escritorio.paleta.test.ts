/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.paleta — E11, entre los pasos 9 y 10: la paleta
 * de comandos M-2 entera, crecida desde su semilla
 * (`src/desktop/paleta.ts`). Su índice se compone del mismo
 * mapa de atajos y de las secciones reales de la barra: la
 * paleta no crea una segunda lista de acciones. Sus clases,
 * con su dueño: acciones, secciones, conversaciones,
 * ajustes, lecciones de la guía y paquetes. La búsqueda es
 * léxica (la e5 no entra en la búsqueda de la paleta) y los
 * resultados se computan en local y en memoria. Su puerta
 * es el censo de cobertura al 100 %: toda acción de la hoja
 * de atajos alcanzable desde la paleta.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Paleta = typeof import("./paleta.js");
type Atajos = typeof import("./atajos.js");
let paleta: Paleta | null = null;
let atajos: Atajos | null = null;
beforeAll(async () => {
  paleta = await import("./paleta.js").catch(() => null);
  atajos = await import("./atajos.js").catch(() => null);
});
function P(): Paleta {
  if (!paleta)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/paleta.ts (la paleta M-2 de E11 no está construida)",
    );
  return paleta;
}
function A(): Atajos {
  if (!atajos)
    throw new Error("ausencia entera de la pieza: src/desktop/atajos.ts");
  return atajos;
}

type Input = import("./paleta.js").PaletteInput;
const input: Input = {
  sections: [
    { id: "chat", label: "Chat", icon: "chat" },
    { id: "emergency", label: "Emergencia", icon: "warning" },
    { id: "agenda", label: "Agenda", icon: "agenda" },
    { id: "library", label: "Biblioteca", icon: "knowledge" },
    { id: "memory", label: "Memoria", icon: "memory" },
    { id: "nido", label: "NIDO", icon: "pairing" },
    { id: "modelos", label: "Modelos", icon: "models" },
    { id: "settings", label: "Ajustes", icon: "settings" },
  ],
  conversations: [
    { id: "conv-1", title: "La huerta de marzo" },
    { id: "conv-2", title: "Receta de pan" },
  ],
  settingsTabs: [
    { id: "security", label: "Seguridad" },
    { id: "tone", label: "Tono" },
    { id: "knowledge", label: "Paquetes" },
    { id: "appearance", label: "Apariencia" },
    { id: "language", label: "Idioma" },
    { id: "voice", label: "Voz" },
    { id: "notices", label: "Avisos" },
    { id: "about", label: "Acerca de" },
  ],
  actions: [
    { id: "new-chat", label: "Chat nuevo", hint: "Ctrl+N" },
    { id: "global-search", label: "Buscar en todo", hint: "Ctrl+Mayús+F" },
    { id: "model-manager", label: "Gestor de modelos", hint: "Ctrl+M" },
  ],
  lessons: [
    { id: "hablar-con-nido", title: "Hablar con NIDO" },
    { id: "memoria-cifrada-y-su-puerta", title: "La memoria cifrada y su puerta" },
  ],
  packs: [
    { id: "esencial", name: "Esencial" },
    { id: "huerta", name: "Huerta y jardín" },
  ],
  vaultUnlocked: true,
};
const ofClass = (items: import("./paleta.js").PaletteItem[], cls: string) =>
  items.filter((i) => i.cls === cls);

describe("escritorio.paleta · las clases del índice, cada una con su dueño", () => {
  it("la clase de acciones: cada acción del mapa aparece con su pista vigente", () => {
    const items = P().composePaletteItems(input);
    const acts = ofClass(items, "action");
    expect(acts.map((a) => a.target)).toEqual(["new-chat", "global-search", "model-manager"]);
    expect(acts.find((a) => a.target === "new-chat")!.hint).toBe("Ctrl+N");
  });

  it("la clase de secciones: las ocho de la barra real, ni una más", () => {
    const secs = ofClass(P().composePaletteItems(input), "section");
    expect(secs.length).toBe(8);
    expect(secs.map((s) => s.target)).toContain("agenda");
    expect(secs.map((s) => s.target)).toContain("modelos");
  });

  it("la clase de conversaciones: las de la persona, por su título", () => {
    const convs = ofClass(P().composePaletteItems(input), "conversation");
    expect(convs.map((c) => c.target)).toEqual(["conv-1", "conv-2"]);
    expect(convs[0].label).toBe("La huerta de marzo");
  });

  it("la clase de ajustes: las ocho pestañas sin gemela de sección, con la de voz que la semilla no listaba", () => {
    const tabs = ofClass(P().composePaletteItems(input), "settings");
    expect(tabs.map((t) => t.target)).toEqual([
      "security",
      "tone",
      "knowledge",
      "appearance",
      "language",
      "voice",
      "notices",
      "about",
    ]);
  });

  it("la clase de la guía: las lecciones por su título, con su forma de fuente", () => {
    const lessons = ofClass(P().composePaletteItems(input), "guide");
    expect(lessons.map((l) => l.target)).toEqual(["hablar-con-nido", "memoria-cifrada-y-su-puerta"]);
  });

  it("la clase de paquetes: las entradas del catálogo en la forma que E5 las dejó", () => {
    const packs = ofClass(P().composePaletteItems(input), "pack");
    expect(packs.map((p) => p.target)).toEqual(["esencial", "huerta"]);
  });
});

describe("escritorio.paleta · cobertura, búsqueda y fronteras", () => {
  it("el censo de cobertura: toda acción de la hoja de atajos es alcanzable desde la paleta", () => {
    const m = P();
    const a = A();
    for (const sendOnEnter of [true, false]) {
      const rows = a.shortcutSheetRows(sendOnEnter);
      const withActions = {
        ...input,
        actions: rows
          .filter((r) => r.inPalette)
          .map((r) => ({ id: r.id, label: r.id, hint: r.keys })),
      };
      const items = m.composePaletteItems(withActions);
      const reachable = new Set(ofClass(items, "action").map((i) => i.target));
      for (const r of rows) {
        if (!r.inPalette) continue;
        expect(reachable.has(r.id), `la acción ${r.id} de la hoja debe estar en la paleta`).toBe(true);
      }
    }
  });

  it("la búsqueda es léxica y encuentra sin acentos lo que lleva acentos, en los dos lados", () => {
    const m = P();
    const items = m.composePaletteItems({
      ...input,
      sections: [{ id: "settings", label: "Configuración", icon: "settings" }],
    });
    expect(m.searchPaletteItems(items, "configuracion").length).toBe(1);
    expect(m.searchPaletteItems(items, "configuración").length).toBe(1);
    expect(m.searchPaletteItems(items, "CONFIGURACION").length).toBe(1);
  });

  it("la e5 no entra en la búsqueda: el índice no tiene clase de modelos y buscar su nombre no devuelve nada", () => {
    const m = P();
    const items = m.composePaletteItems(input);
    const classes = new Set(items.map((i) => i.cls));
    expect([...classes].sort()).toEqual(["action", "conversation", "guide", "pack", "section", "settings"]);
    expect(m.searchPaletteItems(items, "e5")).toEqual([]);
    expect(m.searchPaletteItems(items, "embedding")).toEqual([]);
  });

  it("cada resultado con atajo enseña su pista, y la pista del envío sigue la posición vigente del ajuste", () => {
    const m = P();
    const a = A();
    const rowsDefault = a.shortcutSheetRows(true);
    const sendRow = rowsDefault.find((r) => r.id === "shortcutSend");
    expect(sendRow).toBeDefined();
    const items = m.composePaletteItems({
      ...input,
      actions: [{ id: "shortcutSend", label: "Enviar", hint: sendRow!.keys }],
    });
    expect(ofClass(items, "action")[0].hint).toBe("Intro");
    const rowsInverted = a.shortcutSheetRows(false);
    const sendRowInv = rowsInverted.find((r) => r.id === "shortcutSend");
    const itemsInv = m.composePaletteItems({
      ...input,
      actions: [{ id: "shortcutSend", label: "Enviar", hint: sendRowInv!.keys }],
    });
    expect(ofClass(itemsInv, "action")[0].hint).toBe("Ctrl+Intro");
  });

  it("ningún destino se ofrece dos veces con el mismo nombre: Modelos y Memoria viven como secciones y no se duplican como pestañas", () => {
    const m = P();
    const items = m.composePaletteItems({
      ...input,
      settingsTabs: [
        ...input.settingsTabs,
        { id: "models", label: "Modelos" },
        { id: "memory", label: "Memoria" },
      ],
    });
    const labels = items.map((i) => i.label);
    expect(labels.filter((l) => l === "Modelos").length).toBe(1);
    expect(labels.filter((l) => l === "Memoria").length).toBe(1);
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("con la bóveda bloqueada el índice no fuga contenido: ningún título de conversación aparece", () => {
    const m = P();
    const items = m.composePaletteItems({ ...input, vaultUnlocked: false });
    expect(ofClass(items, "conversation")).toEqual([]);
    // Las clases sin contenido de la persona siguen ofrecidas.
    expect(ofClass(items, "section").length).toBe(8);
    expect(ofClass(items, "action").length).toBe(3);
  });
});
