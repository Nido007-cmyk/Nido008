/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La pieza de cableado de chat (C-1 a C-5): los contratos
 * de superficie y de principal de la pieza, en la forma
 * que el §5 del loop firmó para sus cargos de vista (PC
 * no tiene arnés de componentes: cero .test.tsx, sin
 * jsdom; los cargos se cobran como contratos sobre la
 * fuente, y su fragilidad queda declarada: cobran la
 * cadena, no el gesto en vivo). La rama de C-4 es la A
 * (la fase se sirve), dirimida en la apertura por sus
 * dos mitades cobradas contra la punta; el caso de la
 * emisión del núcleo vive en `turnPipeline.test.ts`,
 * fichero vivo, junto a este arnés.
 *
 * El arnés crece acto a acto: cada commit de la pieza
 * suma los contratos de su acto, en verde sobre su
 * cura, y el nacimiento entero (los siete contratos y
 * el caso del núcleo, en rojo cada uno por su causa)
 * quedó cobrado en copia de desecho antes de la
 * primera cura. Los cargos:
 *
 * 1. C-2, la silla del chat: la chip de idea pasa por
 *    la costura sellada `exampleTap` y aplica su texto
 *    con `setDraft`; el envío directo del prompt
 *    (`send(idea.prompt)`) sale de la superficie
 *    entera.
 * 2. C-2, la silla de la bienvenida: el `onIdea` de la
 *    carcasa pasa por la misma costura y aterriza en
 *    `guideDraft`, sin llamar a `turnSend` ni crear
 *    conversación alguna.
 * 3. C-1, la persistencia: el principal importa la
 *    decisión pura `decideContextNote`, la cobra en
 *    `runOneTurn` desde los turnos guardados y guarda
 *    el tipo decidido en el turno de asistente, cuyo
 *    tipo (`StoredTurn`) gana el campo.
 * 4. C-1, el pintado: la rama del asistente pinta
 *    `t.contextNote` con las dos letras, y la vista ya
 *    no trae la maquinaria local de la decisión (el
 *    estado `noteState` y el reinicio mueren enteros).
 * 5. C-3, la tarjeta en Emergencia: EmergencyView
 *    escucha `onConfirmRequest` filtrando los kinds
 *    del turno (`tool` y `policy`), pinta la misma
 *    tarjeta de confirmación y responde por
 *    `confirmResponse`. El contrato nace contra el
 *    hecho cobrado en la apertura: la escucha de
 *    ChatView no filtra por kind hoy; la filtrada del
 *    precedente (paso 8 de E5) es la de PacksTab, y el
 *    rojo de este caso es la ausencia de escucha en
 *    EmergencyView.
 * 6. C-5, la cabecera: la línea del modelo distingue
 *    residente, instalado sin cargar (con la clave
 *    nueva `modelNotLoaded`) y ninguno (`modelNone`),
 *    y la clave vive en los tres locales con su letra
 *    prescrita (es «sin cargar», en «not loaded», pt
 *    «sem carregar»).
 * 7. C-4, la lectura: la escucha `onTurnPhase` del
 *    renderizador lee el paquete y mapea las dos
 *    fases a sus dos claves (`searching` →
 *    `phaseSearching`, `writing` → `phaseWriting`);
 *    la forma que ignoraba el paquete muere.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSrc = readFileSync(fileURLToPath(new URL("../src/App/App.tsx", import.meta.url)), "utf8");
const servicesSrc = readFileSync(fileURLToPath(new URL("./services.ts", import.meta.url)), "utf8");

function locale(lang: string): Record<string, Record<string, string>> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url)), "utf8"),
  ) as Record<string, Record<string, string>>;
}

/** La región de una componente: de su declaración a la siguiente función de primer nivel. */
function region(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `la componente ${startMarker} existe`).toBeGreaterThan(-1);
  const next = src.indexOf("\nfunction ", start + startMarker.length);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("cableado de chat · contratos de superficie y de principal (C-1 a C-5)", () => {
  it("C-2 · la chip del chat pasa por exampleTap y el envío directo del prompt muere", () => {
    const chat = region(appSrc, "function ChatView");
    expect(chat).toContain("exampleTap(idea.prompt)");
    expect(appSrc).not.toContain("send(idea.prompt)");
  });

  it("C-2 · el onIdea de la bienvenida aterriza en guideDraft por la costura, sin turnSend", () => {
    const start = appSrc.indexOf("onIdea={(prompt) => {");
    expect(start, "el manejador onIdea de la bienvenida existe").toBeGreaterThan(-1);
    const block = appSrc.slice(start, start + 500);
    expect(block).toContain("exampleTap(prompt)");
    expect(block).toContain("setGuideDraft");
    expect(block).not.toContain("turnSend");
    expect(appSrc).not.toContain("text: prompt");
  });

  it("C-1 · el principal decide la nota desde los turnos guardados y la persiste con el turno", () => {
    expect(servicesSrc).toContain('from "../../src/turn/contextNote.js"');
    expect(servicesSrc).toContain("decideContextNote(");
    const stored = region(servicesSrc, "interface StoredTurn");
    expect(stored).toContain("contextNote?:");
    const run = region(servicesSrc, "async function runOneTurn");
    expect(run).toMatch(/contextNote:\s*decided\.note/);
  });

  it("C-1 · la vista pinta t.contextNote y su maquinaria local de la decisión muere entera", () => {
    const chat = region(appSrc, "function ChatView");
    expect(chat).toContain("t.contextNote");
    expect(appSrc).not.toContain("noteState");
    expect(appSrc).not.toContain("EMPTY_CONTEXT_NOTE_STATE");
  });

  it("C-3 · EmergencyView escucha la confirmación filtrada a los kinds del turno y pinta la tarjeta", () => {
    const emergency = region(appSrc, "function EmergencyView");
    expect(emergency).toContain("onConfirmRequest");
    expect(emergency).toContain('p.kind === "tool"');
    expect(emergency).toContain('p.kind === "policy"');
    expect(emergency).toContain("confirm-card");
    expect(emergency).toContain("confirmResponse");
  });

  it("C-5 · la cabecera distingue el modelo instalado sin cargar, con su clave en los tres locales", () => {
    const chat = region(appSrc, "function ChatView");
    expect(chat).toContain("modelNotLoaded");
    expect(locale("es").pcSurface.modelNotLoaded).toBe("sin cargar");
    expect(locale("en").pcSurface.modelNotLoaded).toBe("not loaded");
    expect(locale("pt").pcSurface.modelNotLoaded).toBe("sem carregar");
  });

  it("C-4 · la escucha de fase lee el paquete y mapea las dos fases a sus dos claves", () => {
    expect(appSrc).toContain("onTurnPhase((p)");
    expect(appSrc).toContain('p.phase === "searching"');
    expect(appSrc).toContain("phaseSearching");
    expect(appSrc).not.toContain('onTurnPhase(() => setPhase("phaseWriting"))');
  });
});
