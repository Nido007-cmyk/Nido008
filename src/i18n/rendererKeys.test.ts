/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Censo estático de claves del renderer (tanda 14, auditoría de la
 * batería del renderer): el renderer no tiene arnés DOM, y su modo
 * de fallo abierto es que lookup() devuelve la propia clave cuando
 * falta, así que una clave perdida enseñaría «heroSubtitle» en
 * pantalla sin poner ninguna batería roja. Este censo camina el
 * fichero real de la superficie (app/src/App/App.tsx), extrae cada
 * clave que el renderer busca — llamadas literales a los ayudantes
 * por sección, llamadas directas a lookup, y las familias dinámicas
 * declaradas (claves de NAV, fases del turno, etiquetas de
 * personalidad, iconos) — y afirma que cada una existe como cadena
 * no vacía en es, en y pt, y que cada icono nombrado existe en el
 * registro de la superficie. El arnés de render y navegación entero
 * queda asentado como decisión nombrada en TANDA14-ASIENTO; este
 * censo caza exactamente el modo de fallo de la clave perdida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };

const locales = { en, es, pt } as const;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: any, k) => (acc == null ? acc : acc[k]), obj);
}

const appPath = fileURLToPath(new URL("../../app/src/App/App.tsx", import.meta.url));
const iconsPath = fileURLToPath(new URL("../../app/src/icons.tsx", import.meta.url));
const app = readFileSync(appPath, "utf8");
const iconsSrc = readFileSync(iconsPath, "utf8");

// Los ayudantes por sección: const X = (k: string) => lookup(s, "sección", k)
const helperSection = new Map<string, string>();
for (const m of app.matchAll(/const (\w+) = \(k: string\) => lookup\(s, "([^"]+)", k\)/g)) {
  const [, name, section] = m;
  const prev = helperSection.get(name);
  if (prev !== undefined && prev !== section) {
    throw new Error(`helper ${name} bound to two sections: ${prev} and ${section}`);
  }
  helperSection.set(name, section);
}

// Claves literales por (sección, clave)
const wanted = new Map<string, Set<string>>();
const add = (section: string, key: string) => {
  if (!wanted.has(section)) wanted.set(section, new Set());
  wanted.get(section)!.add(key);
};
for (const [name, section] of helperSection) {
  const re = new RegExp(`\\b${name}\\("([^"]+)"\\)`, "g");
  for (const m of app.matchAll(re)) add(section, m[1]);
}
// Llamadas directas lookup(s, "sección", "clave")
for (const m of app.matchAll(/lookup\(s, "([^"]+)", "([^"]+)"\)/g)) add(m[1], m[2]);

// Familias dinámicas declaradas:
// - NAV: key: "navX" consumidas por el ayudante de pcSurface (P(n.key))
const navBlock = app.slice(app.indexOf("const NAV"), app.indexOf("];", app.indexOf("const NAV")));
const navKeys = [...navBlock.matchAll(/key: "([^"]+)"/g)].map((m) => m[1]);
const navIcons = [...navBlock.matchAll(/icon: "([^"]+)"/g)].map((m) => m[1]);
for (const k of navKeys) add("pcSurface", k);
// - Fases del turno: setPhase("phaseX") pintadas con P(phase)
for (const m of app.matchAll(/setPhase\("([^"]+)"\)/g)) add("pcSurface", m[1]);
// - Personalidades: lookup(s, "personalities", `${id}.label|description`)
const persBlock = app.slice(app.indexOf("PERSONALITY_IDS"), app.indexOf("]", app.indexOf("PERSONALITY_IDS")));
const persIds = [...persBlock.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
for (const id of persIds) {
  add("personalities", `${id}.label`);
  add("personalities", `${id}.description`);
}
// - Vistas declaradas: titleKey/bodyKey literales
for (const m of app.matchAll(/titleKey="([^"]+)"/g)) add("pcSurface", m[1]);
for (const m of app.matchAll(/bodyKey="([^"]+)"/g)) add("pcSurface", m[1]);

// Iconos: literales <Icon name="…">, iconos de NAV e icon="…" de las vistas
const iconNames = new Set<string>(navIcons);
for (const m of app.matchAll(/<Icon name="([^"]+)"/g)) iconNames.add(m[1]);
for (const m of app.matchAll(/ icon="([^"]+)"/g)) iconNames.add(m[1]);
const iconRegistry = new Set(
  [...iconsSrc.matchAll(/^\s+"([a-z0-9-]+)":/gm)].map((m) => m[1]),
);

describe("renderer key census (tanda 14)", () => {
  it("the helper map is unambiguous and binds the surface helpers", () => {
    expect(helperSection.get("P")).toBe("pcSurface");
    expect(helperSection.get("D")).toBe("drawer");
    expect(helperSection.get("A")).toBe("aboutScreen");
    expect(wanted.get("pcSurface")!.size).toBeGreaterThan(100);
  });

  it("every literal key the renderer looks up exists non-empty in es/en/pt", () => {
    const missing: string[] = [];
    for (const [section, keys] of wanted) {
      for (const key of keys) {
        for (const [name, locale] of Object.entries(locales)) {
          const v = get(locale, `${section}.${key}`);
          if (typeof v !== "string" || v.trim().length === 0) {
            missing.push(`${name}:${section}.${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("the dynamic families are really in the census (NAV, phases, personalities)", () => {
    // 7 → 8 en E7 (paso 6): la Agenda entra en la barra como
    // tercera sección, con su clave navAgenda.
    expect(navKeys.length).toBe(8);
    expect(wanted.get("pcSurface")!.has("phaseWriting")).toBe(true);
    expect(persIds.length).toBe(4);
    expect(wanted.get("personalities")!.size).toBe(8);
  });

  it("every icon the renderer names exists in the surface registry", () => {
    const missing = [...iconNames].filter((n) => !iconRegistry.has(n));
    expect(missing).toEqual([]);
    expect(iconRegistry.size).toBeGreaterThanOrEqual(41);
  });

  it("the ideas carousel keeps its cast shape in every locale (H-R8)", () => {
    // App.tsx consume promptIdeasCarousel.items por cast directo:
    // si la forma cambiara en un idioma, el carrusel de la
    // bienvenida se vaciaría en silencio en ese idioma.
    for (const [name, locale] of Object.entries(locales)) {
      const items = get(locale, "promptIdeasCarousel.items") as
        | { category?: unknown; prompt?: unknown }[]
        | undefined;
      expect(Array.isArray(items), name).toBe(true);
      expect(items!.length, name).toBe(6);
      for (const item of items!) {
        expect(typeof item.category, name).toBe("string");
        expect((item.category as string).trim().length, name).toBeGreaterThan(0);
        expect(typeof item.prompt, name).toBe("string");
        expect((item.prompt as string).trim().length, name).toBeGreaterThan(0);
      }
    }
  });
});
