/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSurface = (rel: string) => readFileSync(path.resolve(here, rel), "utf8");

// D/F3 deterministic titles — deterministic/self-knowledge responses.
//
// INVARIANT: if NIDO produces a deterministic self-knowledge response
// without invoking the model for the answer, creating or displaying that
// conversation must not invoke the model merely to generate its title.
//
// Forma PC (tanda 13, asiento de la apertura): la batería trae 7
// declaraciones y cobra 5 casos aquí. Los casos 2 y 6 leían la rama de
// autoconocimiento de la pantalla (ChatScreen), que en PC no existe:
// quedaron DIFERIDOS CON NOMBRE a la tanda 14, que cerró sin
// cobrarlos. Se cobran en el acto 4 del bloque de piezas sueltas
// contra las superficies donde PC sostiene el
// invariante: PC titula cada conversación desde el texto, con el
// recorte determinista `args.text.slice(0, 60)` (al crearla en
// `runOneTurn`, `app/electron/services.ts`, y re-recortado con la
// misma forma al completarse el primer par), y no
// existe vía de títulos por modelo a la que llegar
// (`generateSessionTitle` y `titleFromQuestion` se retiraron de
// `summarize.ts` en la auditoría I-1; `knowledgeSessionTitle` no
// tiene ningún consumidor en la producción de PC). La mitad positiva
// cambia con honestidad: en PC el título de una conversación de
// autoconocimiento es el recorte de su primera pregunta, no el título
// por categoría del móvil; el invariante que los casos guardan (cero
// llamadas al modelo para el título) es el mismo. La mitad de
// pantalla del caso 3 se cobra dentro de la forma PC del caso 2 (la
// pantalla titula desde la pregunta: en PC, el recorte de la
// creación), y su diferido muere con esta pieza.
//
// Belt-and-braces en su forma PC: selfKnowledge.ts no importa ningún
// motor (solo la marca), y la única costura de motor vecina es la del
// productor del resumen. Si algún ayudante de título o respuesta
// pasara a generar a través de esa costura, estos casos fallan en voz
// alta en vez de reintroducir la dependencia en silencio.
//
// Re-fijado en el cableado, pieza 2 (los campos de memoria): la
// creación y la reafirmación pasaron a estar gobernadas por el campo
// `autoGenerateTitles`: la creación es hoy
// `title: autoTitles ? args.text.slice(0, 60) : ""` y la reafirmación
// corre bajo la misma condición. El invariante no se mueve y se
// extiende: con el campo encendido el título es el recorte
// determinista de siempre, y con el campo apagado es la cadena vacía;
// en ninguna de las dos formas hay una llamada al modelo para
// titular. Los casos 2 y 6 cobran la forma nueva, como el acto 4
// cobró la suya contra la medición superada.
const generateMock = vi.fn();

import {
  answerKnowledgeQueryWithCategory,
  knowledgeSessionTitle,
  titleForKnowledgeCategory,
  classifyKnowledgeQuery,
} from "./selfKnowledge.js";
import * as summarizeModule from "../services/summarize.js";
import { setSummarizeEngine } from "../services/summarize.js";
import { APP_DISPLAY_NAME } from "../brand.js";

setSummarizeEngine({
  generate: (opts: any) => generateMock(opts),
  hasEmbeddedChatTemplate: () => false,
});

describe("D/F3 deterministic self-knowledge titles", () => {
  it("1. new self-knowledge session: answer + title with zero model calls", () => {
    const query = "what is nido app";
    const meta = answerKnowledgeQueryWithCategory(query, "en");
    expect(meta).not.toBeNull();
    expect(meta!.category).toBe("identity");
    expect(meta!.answer.length).toBeGreaterThan(0);

    const title = knowledgeSessionTitle(query, "en");
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain(APP_DISPLAY_NAME);

    expect(generateMock).not.toHaveBeenCalled();
  });

  it("1b. every self-knowledge category yields a deterministic title, zero model calls", () => {
    const queries: Array<[string, string]> = [
      ["what is nido app", "identity"],
      ["what can you do", "capabilities"],
      ["why should I use Nido", "advantages"],
      ["what is the product roadmap", "roadmap"],
      ["how do I use Nido", "usage"],
    ];
    for (const [query, category] of queries) {
      expect(classifyKnowledgeQuery(query)).toBe(category);
      const first = knowledgeSessionTitle(query, "en");
      const second = knowledgeSessionTitle(query, "en");
      expect(first).toBe(second); // deterministic
      expect(first.length).toBeGreaterThan(0);
    }
    expect(generateMock).not.toHaveBeenCalled();
  });

  // Forma PC del caso 2 (acto 4 de piezas sueltas): el original leía
  // la sección de autoconocimiento de ChatScreen y exigía que
  // contuviera knowledgeSessionTitle y no contuviera
  // generateSessionTitle ni una llamada al motor. En PC la rama vive
  // en el pipeline del turno y el título en la creación de la
  // conversación; el caso cobra el invariante en esas superficies.
  it("2. self-knowledge branch never reaches a model title path (forma PC: el título nace en la creación, desde el texto)", () => {
    const services = readSurface("../../app/electron/services.ts");
    const pipeline = readSurface("../turn/turnPipeline.ts");
    // El título nace en la creación, desde el texto del primer
    // mensaje: es la única forma de título que la app conoce,
    // gobernada desde el cableado (pieza 2) por el campo de
    // títulos automáticos: el recorte, o la cadena vacía con el
    // campo apagado; nunca el modelo.
    expect(services).toContain('title: autoTitles ? args.text.slice(0, 60) : ""');
    // La rama de autoconocimiento corre en el paso 2 del turno y
    // cierra su turno sin tocar título ni generación.
    expect(pipeline).toContain('answerKnowledgeQuery(query, lang)');
    expect(pipeline).toContain('route: "self-knowledge"');
    expect(pipeline).not.toContain("knowledgeSessionTitle(");
    expect(pipeline).not.toContain(".title =");
    // Ninguna de las dos superficies conoce una vía de título por
    // modelo (forma de llamada; los nombres a secas viven solo en el
    // comentario de la retirada de summarize.ts).
    for (const surface of [services, pipeline]) {
      expect(surface).not.toContain("generateSessionTitle(");
      expect(surface).not.toContain("knowledgeSessionTitle(");
    }
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("3. ordinary conversations get a model-free title too (0.1.61; vía retirada en la auditoría I-1) — mitad de superficie", () => {
    // Hasta la auditoría completa de 2026-10-31 (I-1), summarize.ts
    // aún exportaba generateSessionTitle sin ningún llamante: la
    // vía de títulos por modelo llevaba muerta desde 0.1.61 y su
    // presencia sugería una ruta viva. Retirada; esta prueba fija
    // la retirada y lo que la sustituyó.
    expect((summarizeModule as Record<string, unknown>).generateSessionTitle).toBeUndefined();
    expect(typeof summarizeModule.summarizeConversation).toBe("function");
    // La mitad de pantalla del caso (la pantalla titula desde la
    // pregunta, con cero llamadas a generateSessionTitle) se cobra
    // en la forma PC del caso 2: en PC la pantalla titula con el
    // recorte de la creación (gobernado por el campo de títulos
    // automáticos desde el cableado, pieza 2). Su
    // diferido a la tanda 14 muere en el acto 4 de piezas sueltas.
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("4. titles are coherent across en/es/pt", () => {
    const queries: Record<string, string> = {
      en: "what is nido app",
      es: "¿Qué es Nido?",
      pt: "o que é o Nido",
    };
    const locales = ["en", "es", "pt"] as const;
    for (const locale of locales) {
      const meta = answerKnowledgeQueryWithCategory(queries[locale], locale);
      expect(meta, locale).not.toBeNull();
      const title = knowledgeSessionTitle(queries[locale], locale);
      expect(title.length, locale).toBeGreaterThan(0);
      expect(title, locale).toContain(APP_DISPLAY_NAME);
      // Deterministic per locale.
      expect(knowledgeSessionTitle(queries[locale], locale), locale).toBe(title);
    }
    // Locales are not all identical (real localization, not a stub).
    const titles = locales.map((l) => titleForKnowledgeCategory("identity", l));
    expect(new Set(titles).size).toBe(3);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("5. malformed/unknown metadata falls back safely, never empty, never throws", () => {
    const fallbacks = { en: "New chat", es: "Nuevo chat", pt: "Nova conversa" } as const;
    for (const locale of ["en", "es", "pt"] as const) {
      for (const bad of ["bogus", "", null, undefined, 42, {}, []] as const) {
        const title = titleForKnowledgeCategory(bad, locale);
        expect(title, `${locale}/${String(bad)}`).toBe(fallbacks[locale]);
      }
      // A non-self-question has no category: still a safe fallback title.
      const plain = knowledgeSessionTitle("what is the weather today", locale);
      expect(plain, locale).toBe(fallbacks[locale]);
    }
    expect(generateMock).not.toHaveBeenCalled();
  });

  // Forma PC del caso 6 (acto 4 de piezas sueltas): el original
  // exigía que el título se fijara directo, sin cadena de reintento
  // que pudiera caer al modelo. La medición de la prep afirmó que
  // la creación era la única escritura de título; la punta real
  // trae una segunda, de la tanda 14: al completarse el primer par
  // (`conv.turns.length === 2`) el título se re-recorta del mismo
  // texto. Las dos escrituras son el MISMO recorte determinista y
  // ninguna cadena cae al modelo, que es el invariante: el caso lo
  // cobra en esa forma verdadera (toda asignación de título de la
  // producción es el recorte del texto), no en la forma de la
  // medición superada. El cableado (pieza 2) puso el campo
  // `autoGenerateTitles` sobre las dos escrituras: la creación
  // escribe el recorte o la cadena vacía y la reafirmación corre
  // bajo la misma condición; el invariante se cobra en esa forma,
  // que sigue siendo determinista y sin modelo.
  it("6. failure/retry paths cannot invoke the model (forma PC: toda asignación de título es el recorte determinista del texto)", () => {
    const services = readSurface("../../app/electron/services.ts");
    const pipeline = readSurface("../turn/turnPipeline.ts");
    const summarize = readSurface("../services/summarize.ts");
    // El título nace en la creación, desde el texto (con el
    // gobierno del campo: el recorte o la cadena vacía).
    expect(services).toContain('title: autoTitles ? args.text.slice(0, 60) : ""');
    // Y toda reescritura posterior en producción es ese mismo
    // recorte: cualquier asignación nueva en otra forma (y sobre
    // todo, una que llame al modelo) cae aquí en rojo.
    for (const surface of [services, pipeline]) {
      const assignments = surface.match(/\.title = [^;\n]+/g) ?? [];
      for (const assignment of assignments) {
        expect(assignment).toBe(".title = args.text.slice(0, 60)");
      }
    }
    // Ninguna cadena de reintento o reserva hacia un título por
    // modelo: ni la vía retirada vuelve como exportación, ni el
    // título por categoría se consume en producción.
    expect(summarize).not.toContain("export function generateSessionTitle");
    expect(summarize).not.toContain("export const generateSessionTitle");
    expect(summarize).not.toContain("export function titleFromQuestion");
    expect(summarize).not.toContain("export const titleFromQuestion");
    for (const surface of [services, pipeline, summarize]) {
      expect(surface).not.toContain("knowledgeSessionTitle(");
    }
    expect(generateMock).not.toHaveBeenCalled();
  });
});
