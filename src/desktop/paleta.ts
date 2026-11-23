/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * paleta.ts — E11 (entre los pasos 9 y 10): la paleta de
 * comandos M-2 entera, crecida desde su semilla. Su
 * índice se compone de las mismas fuentes que las demás
 * superficies (el mapa de atajos para las acciones, la
 * barra real para las secciones, y los catálogos vivos
 * para la guía y los paquetes): la paleta no crea una
 * segunda lista de acciones. Sus clases, cada una con su
 * dueño: acciones, secciones, conversaciones, ajustes,
 * lecciones de la guía y paquetes. Sin clase de modelos:
 * la búsqueda es léxica (la e5 no entra en la búsqueda de
 * la paleta) y los resultados se computan en local y en
 * memoria, sin una sola petición de red. Con la bóveda
 * bloqueada el índice no fuga contenido de la persona:
 * sus conversaciones no aparecen; las clases sin su
 * contenido siguen ofrecidas.
 */

export type PaletteClass = "action" | "section" | "conversation" | "settings" | "guide" | "pack";

export interface PaletteItem {
  key: string;
  cls: PaletteClass;
  label: string;
  /** La pista del atajo, en la posición vigente del ajuste que la gobierna. */
  hint?: string;
  target: string;
}

export interface PaletteInput {
  sections: { id: string; label: string; icon: string }[];
  conversations: { id: string; title: string }[];
  settingsTabs: { id: string; label: string }[];
  actions: { id: string; label: string; hint?: string }[];
  lessons: { id: string; title: string }[];
  packs: { id: string; name: string }[];
  vaultUnlocked: boolean;
}

/**
 * Las pestañas que ya viven como sección no se ofrecen
 * dos veces con el mismo nombre: Modelos y Memoria son
 * secciones, y su pestaña gemela sale del índice (la
 * regla de la propia semilla).
 */
const SECTION_TWIN_TABS = new Set(["models", "memory"]);

export function composePaletteItems(input: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const a of input.actions) {
    items.push({ key: `action:${a.id}`, cls: "action", label: a.label, hint: a.hint, target: a.id });
  }
  for (const s of input.sections) {
    items.push({ key: `section:${s.id}`, cls: "section", label: s.label, target: s.id });
  }
  if (input.vaultUnlocked) {
    for (const c of input.conversations) {
      items.push({ key: `conversation:${c.id}`, cls: "conversation", label: c.title, target: c.id });
    }
  }
  for (const t of input.settingsTabs) {
    if (SECTION_TWIN_TABS.has(t.id)) continue;
    items.push({ key: `settings:${t.id}`, cls: "settings", label: t.label, target: t.id });
  }
  for (const l of input.lessons) {
    items.push({ key: `guide:${l.id}`, cls: "guide", label: l.title, target: l.id });
  }
  for (const p of input.packs) {
    items.push({ key: `pack:${p.id}`, cls: "pack", label: p.name, target: p.id });
  }
  return items;
}

/** El plegado de la casa: minúsculas y sin diacríticos, en los dos lados. */
export function foldPaletteText(x: string): string {
  return x
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * La búsqueda léxica sobre las etiquetas: la consulta y
 * las etiquetas se pliegan igual, y una consulta vacía
 * devuelve el índice entero, como la semilla enseñaba.
 */
export function searchPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = foldPaletteText(query.trim());
  if (q === "") return items;
  return items.filter((i) => foldPaletteText(i.label).includes(q));
}
