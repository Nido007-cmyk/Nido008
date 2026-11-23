/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.dividida — E11 paso 8: la vista dividida sobre
 * el panel de fuentes ya construido (`src/desktop/dividida.ts`):
 * las tres divisiones (una fuente, un documento de la
 * biblioteca, dos conversaciones lado a lado), cada una con
 * su lectura y su cierre sin perder el sitio, y la caída a
 * la forma de hoja en régimen medio. Una generación de una
 * conversación no se come la pantalla de la otra: el estado
 * guarda las dos identidades separadas.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Dividida = typeof import("./dividida.js");
let pieza: Dividida | null = null;
beforeAll(async () => {
  pieza = await import("./dividida.js").catch(() => null);
});
function P(): Dividida {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/dividida.ts (la vista dividida de E11 paso 8 no está construida)",
    );
  return pieza;
}

describe("escritorio.dividida · las tres divisiones y su cierre sin perder el sitio", () => {
  it("una fuente dividida: se abre con su referencia, se lee y se cierra volviendo al sitio exacto", () => {
    const m = P();
    const start = m.closedSplit("msg-40");
    const open = m.openSplit(start, "source", "guia:esencial-rcp-adultos#3");
    expect(open.open).toBe("source");
    expect(open.ref).toBe("guia:esencial-rcp-adultos#3");
    expect(open.anchor).toBe("msg-40");
    const closed = m.closeSplit(open);
    expect(closed.open).toBeNull();
    expect(closed.anchor).toBe("msg-40");
  });

  it("un documento de la biblioteca dividido: se abre, se lee y se cierra sin perder el sitio", () => {
    const m = P();
    const start = m.closedSplit("msg-7");
    const open = m.openSplit(start, "library-doc", "doc:manual-huerta");
    expect(open.open).toBe("library-doc");
    expect(open.ref).toBe("doc:manual-huerta");
    const closed = m.closeSplit(open);
    expect(closed.open).toBeNull();
    expect(closed.anchor).toBe("msg-7");
  });

  it("dos conversaciones lado a lado: las dos identidades quedan separadas y el cierre vuelve a la principal", () => {
    const m = P();
    const start = m.closedSplit("msg-12", "conv-principal");
    const open = m.openSplit(start, "conversation", "conv-otra");
    expect(open.open).toBe("conversation");
    expect(open.ref).toBe("conv-otra");
    // La principal sigue siendo la principal: la división no
    // la sustituye ni mezcla sus mensajes con los de la otra.
    expect(open.mainConversationId).toBe("conv-principal");
    expect(open.ref).not.toBe(open.mainConversationId);
    const closed = m.closeSplit(open);
    expect(closed.open).toBeNull();
    expect(closed.anchor).toBe("msg-12");
    expect(closed.mainConversationId).toBe("conv-principal");
  });

  it("en régimen medio la dividida cae a la forma de hoja de la primera superficie; en ancho vive en el panel", () => {
    const m = P();
    const open = m.openSplit(m.closedSplit("msg-1"), "source", "guia:x#1");
    expect(m.splitPresentation(open, "wide")).toBe("panel");
    expect(m.splitPresentation(open, "medium")).toBe("sheet");
    expect(m.splitPresentation(m.closedSplit("msg-1"), "wide")).toBe("none");
  });
});
