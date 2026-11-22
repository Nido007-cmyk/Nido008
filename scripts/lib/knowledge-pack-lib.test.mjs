/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería de la biblioteca de packs (F-PC77 a F-PC84): la
 * biblioteca con la que se construyen los paquetes deja de
 * aceptar en silencio lo que el producto rechaza. Cada bloque
 * nombra su hallazgo; los controles fijan la conducta que la
 * cura no puede romper, incluido el corpus real entero.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chunkIntro,
  daysSince,
  htmlToText,
  parseArgs,
  parseGuide,
  quantizeInt8,
  quoteIsPresent,
  validateFacts,
} from "./knowledge-pack-lib.mjs";

const guide = (meta, body = "Texto de introducción de la guía.") =>
  `---\n${meta}\n---\n${body}\n`;
const META = "title: Título\nlang: es\nsources: Fuente oficial";

const validDoc = () => ({
  regions: {
    ES: {
      names: { es: "España", en: "Spain", pt: "Espanha" },
      aliases: ["España", "Spain"],
    },
  },
  facts: [
    {
      key: "emergency.phone",
      region: "ES",
      value: "112",
      label: { es: "Emergencias", en: "Emergency", pt: "Emergência" },
      source: {
        title: "Fuente oficial",
        url: "https://example.com/oficial",
        quote: "Civil: 110",
        checked: "2026-03-01",
      },
    },
  ],
});

describe("F-PC77 · quantizeInt8 — la referencia lanza como el producto", () => {
  it("1 · un componente NaN lanza /non-finite/", () => {
    expect(() => quantizeInt8([0.5, Number.NaN], 2)).toThrow(/non-finite/);
  });
  it("2 · un componente Infinity lanza /non-finite/", () => {
    expect(() => quantizeInt8([Infinity, 0.5], 2)).toThrow(/non-finite/);
  });
  it("3 · 5 componentes con dims 2 lanzan /whole number/", () => {
    expect(() => quantizeInt8([1, 2, 3, 4, 5], 2)).toThrow(/whole number/);
  });
  it("4 · dims 1,5 lanza /dims/", () => {
    expect(() => quantizeInt8([1, 2, 3], 1.5)).toThrow(/dims/);
  });
  it("5 · dims 0 lanza /dims/ con su mensaje, no el RangeError crudo", () => {
    expect(() => quantizeInt8([1, 2], 0)).toThrow(/dims/);
  });
  it("6 · control: valores conocidos [0.5, -1, 0] con dims 3", () => {
    const { data, scales } = quantizeInt8([0.5, -1, 0], 3);
    expect(Array.from(data)).toEqual([64, -127, 0]);
    expect(scales).toHaveLength(1);
    expect(scales[0]).toBeCloseTo(1 / 127, 6);
  });
  it("7 · control: lote de dos vectores [3, 0, 0, -4] con dims 2", () => {
    const { data, scales } = quantizeInt8([3, 0, 0, -4], 2);
    expect(Array.from(data)).toEqual([127, 0, 0, -127]);
    expect(scales).toHaveLength(2);
  });
  it("8 · control: vector cero con escala 1 y lote vacío sin datos ni escalas", () => {
    const zero = quantizeInt8([0, 0], 2);
    expect(Array.from(zero.data)).toEqual([0, 0]);
    expect(zero.scales[0]).toBe(1);
    const empty = quantizeInt8([], 2);
    expect(empty.data).toHaveLength(0);
    expect(empty.scales).toHaveLength(0);
  });
});

describe("F-PC78 · chunkIntro — el último trozo no se filtra", () => {
  it("1 · una introducción de un solo enunciado corto sobrevive", () => {
    expect(chunkIntro("X is a village in Y.")).toEqual(["X is a village in Y."]);
  });
  it("2 · el cierre corto tras un trozo largo se conserva, con el objetivo por defecto", () => {
    const long = `${"a".repeat(650)}.`;
    const chunks = chunkIntro(`${long}\nClosing fact.`);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe("Closing fact.");
  });
  it("3 · el cierre aislado como trozo propio con objetivo 100 se conserva", () => {
    const s1 = `${"a".repeat(59)}.`;
    const s2 = `${"b".repeat(94)}.`;
    const chunks = chunkIntro(`${s1}\n${s2}\nClosing fact.`, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toBe("Closing fact.");
  });
  it("4 · control: el trozo intermedio residual corto sigue filtrado", () => {
    const s1 = `${"a".repeat(199)}.`;
    const mid = `${"m".repeat(29)}.`;
    const s2 = `${"b".repeat(199)}.`;
    const chunks = chunkIntro(`${s1}\n${mid}\n${s2}`, 210);
    expect(chunks).toHaveLength(2);
    expect(chunks.some((c) => c.includes("mmm"))).toBe(false);
  });
  it("5 · control: una introducción de solo espacios devuelve []", () => {
    expect(chunkIntro("   \n  ")).toEqual([]);
  });
  it("6 · control: dos enunciados largos dan dos trozos de 40 o más", () => {
    const s1 = `${"a".repeat(349)}.`;
    const s2 = `${"b".repeat(349)}.`;
    const chunks = chunkIntro(`${s1}\n${s2}`);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length >= 40)).toBe(true);
  });
});

describe("F-PC79 · parseGuide — las preguntas sin texto lanzan, no se reatribuyen", () => {
  it("1 · un apartado con solo su comentario de preguntas, con introducción previa, lanza", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\n<!-- preguntas: ¿Pregunta de A? -->",
    );
    expect(() => parseGuide(md)).toThrow(/declares questions but has no text/);
  });
  it("2 · un apartado con solo preguntas seguido de otro con texto, sin apartado anterior, lanza", () => {
    const md = guide(
      META,
      "## A\n<!-- preguntas: ¿Pregunta de A? -->\n\n## B\nTexto de B con su contenido.",
    );
    expect(() => parseGuide(md)).toThrow(/declares questions but has no text/);
  });
  it("3 · control: un encabezado final vacío sin preguntas no nace y no lanza", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\nTexto de A.\n\n## Final",
    );
    const g = parseGuide(md);
    expect(g.sections).toHaveLength(2);
  });
  it("4 · control: un apartado con texto y preguntas conserva sus preguntas", () => {
    const md = guide(
      META,
      "Texto de la introducción.\n\n## A\nTexto de A.\n<!-- preguntas: ¿Pregunta de A? -->",
    );
    const g = parseGuide(md);
    const a = g.sections.find((s) => s.heading === "A");
    expect(a.questions).toEqual(["¿Pregunta de A?"]);
  });
  it("5 · control de corpus: las 243 guías reales parsean sin lanzar y el facts.json real valida", () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "knowledge-packs",
    );
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md") && e.name !== "README.md") files.push(p);
      }
    };
    walk(root);
    expect(files).toHaveLength(243);
    let sections = 0;
    let sectionQuestions = 0;
    let guideQuestions = 0;
    const keys = new Set();
    for (const f of files) {
      const g = parseGuide(readFileSync(f, "utf8"), path.basename(f));
      sections += g.sections.length;
      sectionQuestions += g.sections.reduce((n, s) => n + s.questions.length, 0);
      guideQuestions += g.questions.length;
      if (g.key) keys.add(g.key);
    }
    expect(sections).toBe(1203);
    expect(sectionQuestions).toBe(216);
    expect(guideQuestions).toBe(1140);
    expect(keys.size).toBe(81);
    const facts = JSON.parse(
      readFileSync(path.join(root, "nido-local", "facts.json"), "utf8"),
    );
    const checked = validateFacts(facts);
    expect(Object.keys(checked.regions)).toHaveLength(69);
    expect(checked.facts).toHaveLength(155);
  });
});

describe("F-PC80 · fechas reales — un solo ayudante para los cuatro sitios", () => {
  it("1 · verified 2026-02-30 en una guía lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 2026-02-30`))).toThrow(/verified/);
  });
  it("2 · verified 9999-99-99 lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 9999-99-99`))).toThrow(/verified/);
  });
  it("3 · verified 2026-02-29 (no bisiesto) lanza /verified/", () => {
    expect(() => parseGuide(guide(`${META}\nverified: 2026-02-29`))).toThrow(/verified/);
  });
  it("4 · control: verified 2024-02-29 (bisiesto) parsea y la fecha sale", () => {
    const g = parseGuide(guide(`${META}\nverified: 2024-02-29`));
    expect(g.verified).toBe("2024-02-29");
  });
  it("5 · control: verified 2026-11-07 parsea", () => {
    const g = parseGuide(guide(`${META}\nverified: 2026-11-07`));
    expect(g.verified).toBe("2026-11-07");
  });
  it("6 · source.checked 2026-02-30 en un hecho válido lanza /source.checked/", () => {
    const doc = validDoc();
    doc.facts[0].source.checked = "2026-02-30";
    expect(() => validateFacts(doc)).toThrow(/source.checked/);
  });
  it("7 · --built-at 2026-02-30 lanza /built-at/", () => {
    expect(() => parseArgs(["--built-at", "2026-02-30"])).toThrow(/built-at/);
  });
  it("8 · control: --built-at 2026-03-05 se acepta y sale en las opciones", () => {
    expect(parseArgs(["--built-at", "2026-03-05"]).builtAt).toBe("2026-03-05");
  });
  it("9 · control: --built-at not-a-date lanza, como ya lanzaba", () => {
    expect(() => parseArgs(["--built-at", "not-a-date"])).toThrow(/built-at/);
  });
  it("10 · daysSince de 9999-99-99 lanza /daysSince/", () => {
    expect(() => daysSince("9999-99-99", new Date("2026-03-05T00:00:00Z"))).toThrow(/daysSince/);
  });
  it("11 · daysSince de 2026-02-30 lanza /daysSince/, no cuenta desde la fecha rodada", () => {
    expect(() => daysSince("2026-02-30", new Date("2026-03-05T00:00:00Z"))).toThrow(/daysSince/);
  });
  it("12 · control: daysSince de 2026-03-01 al 2026-03-05 devuelve 4", () => {
    expect(daysSince("2026-03-01", new Date("2026-03-05T00:00:00Z"))).toBe(4);
  });
});

describe("F-PC81 · validateFacts — el contenedor mal formado lanza y el texto se valida como texto", () => {
  it("1 · facts como cadena lanza /facts must be an array/", () => {
    const doc = validDoc();
    doc.facts = "no-es-una-lista";
    expect(() => validateFacts(doc)).toThrow(/facts must be an array/);
  });
  it("2 · facts como objeto lanza /facts must be an array/", () => {
    const doc = validDoc();
    doc.facts = { key: "emergency.phone" };
    expect(() => validateFacts(doc)).toThrow(/facts must be an array/);
  });
  it("3 · el documento es un array []: lanza /not an object/", () => {
    expect(() => validateFacts([])).toThrow(/not an object/);
  });
  it("4 · el documento es {}: lanza /facts must be an array/", () => {
    expect(() => validateFacts({})).toThrow(/facts must be an array/);
  });
  it("5 · regions como array [] lanza /regions must be an object/", () => {
    const doc = validDoc();
    doc.regions = [];
    expect(() => validateFacts(doc)).toThrow(/regions must be an object/);
  });
  it("6 · aliases [123, \"\"] lanza /aliases/", () => {
    const doc = validDoc();
    doc.regions.ES.aliases = [123, ""];
    expect(() => validateFacts(doc)).toThrow(/aliases/);
  });
  it("7 · names.es 123 lanza /names.es/", () => {
    const doc = validDoc();
    doc.regions.ES.names.es = 123;
    expect(() => validateFacts(doc)).toThrow(/names\.es/);
  });
  it("8 · label.en 42 lanza /label.en/", () => {
    const doc = validDoc();
    doc.facts[0].label.en = 42;
    expect(() => validateFacts(doc)).toThrow(/label\.en/);
  });
  it("9 · source.url \"https://\" sin anfitrión lanza /source.url/", () => {
    const doc = validDoc();
    doc.facts[0].source.url = "https://";
    expect(() => validateFacts(doc)).toThrow(/source\.url/);
  });
  it("10 · source.url \"https:// not a url\" lanza /source.url/", () => {
    const doc = validDoc();
    doc.facts[0].source.url = "https:// not a url";
    expect(() => validateFacts(doc)).toThrow(/source\.url/);
  });
  it("11 · control: el documento sintético válido entero valida con 1 región y 1 hecho", () => {
    const checked = validateFacts(validDoc());
    expect(Object.keys(checked.regions)).toHaveLength(1);
    expect(checked.facts).toHaveLength(1);
  });
  it("12 · control: un hecho sin source lanza, como ya lanzaba", () => {
    const doc = validDoc();
    delete doc.facts[0].source;
    expect(() => validateFacts(doc)).toThrow(/source/);
  });
});

describe("F-PC82 · quoteIsPresent — presencia por secuencia de tokens y cita vacía rechazada", () => {
  it("1 · «Civil: 110» dentro de «Civil: 1100» está ausente", () => {
    expect(quoteIsPresent("Civil: 1100", "Civil: 110")).toBe(false);
  });
  it("2 · «emergency 911» dentro de «emergency 9110» está ausente", () => {
    expect(quoteIsPresent("emergency 9110", "emergency 911")).toBe(false);
  });
  it("3 · la cita \"---\" está ausente en todas partes", () => {
    expect(quoteIsPresent("completely unrelated page text", "---")).toBe(false);
  });
  it("4 · la cita vacía está ausente en todas partes", () => {
    expect(quoteIsPresent("any page", "")).toBe(false);
  });
  it("5 · un hecho válido con source.quote \"---\" lanza /source.quote/ en su validación", () => {
    const doc = validDoc();
    doc.facts[0].source.quote = "---";
    expect(() => validateFacts(doc)).toThrow(/source\.quote/);
  });
  it("6 · control: la cita exacta con otra puntuación y caso está presente", () => {
    expect(quoteIsPresent("Civil: 110, según la fuente oficial", "CIVIL: 110,")).toBe(true);
  });
  it("7 · control: la cita como tokens enteros dentro de una página larga está presente", () => {
    const page =
      "Lorem ipsum dolor sit amet, el teléfono de emergencias es el 112 en toda la Unión Europea, y también el texto que sigue después.";
    expect(quoteIsPresent(page, "el teléfono de emergencias es el 112")).toBe(true);
  });
  it("8 · control: la cita ausente de la página no está presente", () => {
    expect(quoteIsPresent("una página cualquiera con otro texto", "cita que no aparece")).toBe(false);
  });
});

describe("F-PC83 · htmlToText — la entidad fuera de rango no cae la comprobación y el bloque sin cerrar no es texto", () => {
  it("1 · \"a &#x110000; b\" no lanza y el texto trae a y b", () => {
    const text = htmlToText("a &#x110000; b");
    expect(text).toContain("a");
    expect(text).toContain("b");
  });
  it("2 · \"a &#9999999999; b\" no lanza y el texto trae a y b", () => {
    const text = htmlToText("a &#9999999999; b");
    expect(text).toContain("a");
    expect(text).toContain("b");
  });
  it("3 · un <script> sin cerrar no vierte su contenido en el texto visible", () => {
    const text = htmlToText("visible <script>var secret=1;");
    expect(text).toContain("visible");
    expect(text).not.toContain("secret");
  });
  it("4 · control: un script bien cerrado se retira y el texto de alrededor queda", () => {
    const text = htmlToText("before <script>var x=1;</script> after");
    expect(text).toContain("before");
    expect(text).toContain("after");
    expect(text).not.toContain("var x");
  });
  it("5 · control: &eacute; se pliega a «e»", () => {
    expect(htmlToText("caf&eacute;")).toBe("cafe");
  });
  it("6 · control: &#65; es «A»", () => {
    expect(htmlToText("&#65;")).toBe("A");
  });
});

describe("F-PC84 · parseGuide — idioma de la lista cerrada, clave duplicada como error e id estricto", () => {
  it("1 · lang xx-long lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: xx-long\nsources: S"))).toThrow(/lang/);
  });
  it("2 · lang 123 lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: 123\nsources: S"))).toThrow(/lang/);
  });
  it("3 · lang ES en mayúsculas lanza /lang/", () => {
    expect(() => parseGuide(guide("title: T\nlang: ES\nsources: S"))).toThrow(/lang/);
  });
  it("4 · title declarado dos veces lanza /duplicated/", () => {
    expect(() =>
      parseGuide(guide("title: Uno\ntitle: Dos\nlang: es\nsources: S")),
    ).toThrow(/duplicated/);
  });
  it("5 · id BAD ID WITH SPACES!! lanza /id/", () => {
    expect(() => parseGuide(guide(`${META}\nid: BAD ID WITH SPACES!!`))).toThrow(/id/);
  });
  it("6 · control: lang es, en y pt parsean y el idioma sale", () => {
    for (const lang of ["es", "en", "pt"]) {
      const g = parseGuide(guide(`title: T\nlang: ${lang}\nsources: S`));
      expect(g.lang).toBe(lang);
    }
  });
  it("7 · control: id local-cuba parsea y key es esa", () => {
    const g = parseGuide(guide(`${META}\nid: local-cuba`));
    expect(g.key).toBe("local-cuba");
  });
  it("8 · control: una guía sin id sale con key vacía", () => {
    const g = parseGuide(guide(META));
    expect(g.key).toBe("");
  });
});
