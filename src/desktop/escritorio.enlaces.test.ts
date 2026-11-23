/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.enlaces — E11 paso 7: los enlaces `nido://` y su
 * tabla cerrada de rutas, contra el enrutador puro
 * (`src/desktop/enlaces.ts`) y su asiento de reconciliación
 * (un solo registro del esquema, dos gramáticas que no se
 * cruzan, la bendición de origen sin ensanchar). El enlace
 * navega, nunca actúa (R4); la bóveda manda: con ella
 * bloqueada la ruta se retiene y se resuelve tras
 * desbloquear, sin distinguir si el id existe.
 *
 * La descomposición es la del suelo firmado: 4 rutas × 2
 * llegadas (8), lo malformado que cae cerrado (4), el
 * enlace más hostil sin acción de efecto (1) y la ruta tras
 * desbloquear sin saltarse el bloqueo (1).
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Enlaces = typeof import("./enlaces.js");
let pieza: Enlaces | null = null;
beforeAll(async () => {
  pieza = await import("./enlaces.js").catch(() => null);
});
function P(): Enlaces {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/enlaces.ts (el enrutador de enlaces de E11 paso 7 no está construido)",
    );
  return pieza;
}

type World = import("./enlaces.js").LinkWorld;
const world: World = {
  vaultUnlocked: true,
  conversationIds: ["conv-1", "conv-2"],
  installedGuideIds: ["esencial-rcp-adultos"],
  guideCatalogIds: ["esencial-rcp-adultos", "esencial-quemaduras"],
};
// La llegada con la app cerrada: el enlace viaja en los
// argumentos del arranque y la instancia lo entrega.
const cold = (raw: string, w: World) => {
  const m = P();
  const found = m.extractLinkFromArgv(["nido", "--flag", raw, "--otra"]);
  expect(found).toBe(raw);
  return m.resolveLink(m.parseLink(found as string), w);
};
// La llegada con la app abierta: la instancia viva lo recibe.
const warm = (raw: string, w: World) => {
  const m = P();
  return m.resolveLink(m.parseLink(raw), w);
};

describe("escritorio.enlaces · las cuatro rutas en las dos llegadas (8)", () => {
  it("nido://emergencia, app cerrada: aterriza en la pantalla de emergencia", () => {
    expect(cold("nido://emergencia", world)).toEqual({ kind: "navigate", section: "emergency" });
  });

  it("nido://emergencia, app abierta: aterriza en la pantalla de emergencia", () => {
    expect(warm("nido://emergencia", world)).toEqual({ kind: "navigate", section: "emergency" });
  });

  it("nido://chat, app cerrada: aterriza en la conversación tal como la persona la dejó", () => {
    expect(cold("nido://chat", world)).toEqual({ kind: "navigate", section: "chat" });
  });

  it("nido://chat, app abierta: aterriza en la conversación tal como la persona la dejó", () => {
    expect(warm("nido://chat", world)).toEqual({ kind: "navigate", section: "chat" });
  });

  it("nido://chat/<id>, app cerrada: aterriza en esa conversación", () => {
    expect(cold("nido://chat/conv-2", world)).toEqual({
      kind: "navigate",
      section: "chat",
      conversationId: "conv-2",
    });
  });

  it("nido://chat/<id>, app abierta: aterriza en esa conversación", () => {
    expect(warm("nido://chat/conv-2", world)).toEqual({
      kind: "navigate",
      section: "chat",
      conversationId: "conv-2",
    });
  });

  it("nido://guia/<id>, app cerrada: aterriza en esa guía por su id estable del catálogo", () => {
    expect(cold("nido://guia/esencial-rcp-adultos", world)).toEqual({
      kind: "navigate",
      section: "library",
      guideId: "esencial-rcp-adultos",
    });
  });

  it("nido://guia/<id>, app abierta: aterriza en la guía; sin el paquete instalado, el aviso lo dice y ofrece su sitio en la biblioteca, sin instalar nada", () => {
    expect(warm("nido://guia/esencial-rcp-adultos", world)).toEqual({
      kind: "navigate",
      section: "library",
      guideId: "esencial-rcp-adultos",
    });
    expect(warm("nido://guia/esencial-quemaduras", world)).toEqual({
      kind: "notice",
      notice: "guide-not-installed",
      section: "library",
    });
  });
});

describe("escritorio.enlaces · lo malformado cae cerrado (4)", () => {
  it("un esquema ajeno no es un enlace de la casa", () => {
    expect(warm("https://chat/conv-1", world)).toEqual({
      kind: "notice",
      notice: "malformed",
      section: "chat",
    });
  });

  it("una ruta fuera de la tabla cerrada cae cerrada (sin rutas de ajustes, modelos ni agenda; el anfitrión app es contenido, no ruta)", () => {
    for (const raw of ["nido://ajustes", "nido://modelos", "nido://agenda", "nido://app/chat/conv-1"]) {
      const r = warm(raw, world);
      expect(r.kind, raw).toBe("notice");
      if (r.kind === "notice") expect(r.notice).toBe("malformed");
    }
  });

  it("un id inexistente cae en aviso llano y su lista, nunca en una conversación o guía «similar»", () => {
    expect(warm("nido://chat/conv-99", world)).toEqual({
      kind: "notice",
      notice: "chat-missing",
      section: "chat",
    });
    expect(warm("nido://guia/no-existe", world)).toEqual({
      kind: "notice",
      notice: "guide-missing",
      section: "library",
    });
  });

  it("un enlace con cadena de consulta o fragmento es malformado y cae cerrado", () => {
    for (const raw of ["nido://chat/conv-1?x=1", "nido://chat#conv-1", "nido://emergencia?urgente=1"]) {
      const r = warm(raw, world);
      expect(r.kind, raw).toBe("notice");
      if (r.kind === "notice") expect(r.notice).toBe("malformed");
    }
  });
});

describe("escritorio.enlaces · el hostil y el bloqueo (2)", () => {
  it("el enlace más hostil no dispara ninguna acción de efecto: la resolución solo navega o avisa, con su vocabulario cerrado", () => {
    const hostile = "nido://chat/..%2f..%2fconversaciones%00; rm -rf";
    const r = warm(hostile, world);
    expect(["navigate", "notice", "hold"]).toContain(r.kind);
    for (const key of Object.keys(r)) {
      expect(["kind", "section", "conversationId", "guideId", "notice"]).toContain(key);
    }
    const e = warm("nido://emergencia", world);
    for (const key of Object.keys(e)) {
      expect(["kind", "section", "conversationId", "guideId", "notice"]).toContain(key);
    }
  });

  it("la ruta tras desbloquear, sin saltarse el bloqueo: bloqueada se retiene igual exista o no el id; desbloqueada resuelve", () => {
    const locked: World = { ...world, vaultUnlocked: false };
    const withId = warm("nido://chat/conv-1", locked);
    const withoutId = warm("nido://chat/conv-99", locked);
    expect(withId).toEqual({ kind: "hold" });
    // Antes de desbloquear, existente e inexistente son
    // indistinguibles: la misma retención, sin fuga.
    expect(withoutId).toEqual(withId);
    expect(warm("nido://chat/conv-1", world)).toEqual({
      kind: "navigate",
      section: "chat",
      conversationId: "conv-1",
    });
    expect(warm("nido://chat/conv-99", world)).toEqual({
      kind: "notice",
      notice: "chat-missing",
      section: "chat",
    });
  });
});
