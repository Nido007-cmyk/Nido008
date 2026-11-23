/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.atajos — E11 paso 1: el mapa de atajos de la
 * ventana firmado en la apertura (§4.2), ejercido contra su
 * resolvedor puro (`src/desktop/atajos.ts`): una entrada por
 * caso, el envío en sus dos posiciones, la persistencia del
 * ajuste y la hoja contrastada línea a línea contra el mapa.
 * El crédito heredado de la tanda 14 (el atajo de emergencia
 * en sus dos posiciones) cierra la batería.
 *
 * Nacimiento (acto 1 de E11): la batería nace en rojo por
 * ausencia entera de la pieza — el resolvedor no existe y
 * cada caso cae nombrando la ausencia, en la forma de la
 * hoja de ejecución. Ningún caso toca la base.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// El almacén de ajustes se ejerce sobre el mismo doble de
// sistema de ficheros que usan las baterías de settings de la
// casa: un mapa en memoria, sin tocar ningún fichero real.
const fx = vi.hoisted(() => {
  const files = new Map<string, string>();
  return { DOC: "file:///docs/", files, reset: () => files.clear() };
});
vi.mock("../security/fileSystem.js", () => ({
  documentDirectory: fx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fx.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const v = fx.files.get(from);
    if (v !== undefined) {
      fx.files.set(to, v);
      fx.files.delete(from);
    }
  },
}));

type Atajos = typeof import("./atajos.js");
let pieza: Atajos | null = null;
beforeAll(async () => {
  pieza = await import("./atajos.js").catch(() => null);
});
function P(): Atajos {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/atajos.ts (el mapa de atajos de E11 paso 1 no está construido)",
    );
  return pieza;
}

type Ctx = import("./atajos.js").ShortcutContext;
const base: Ctx = {
  generating: false,
  emergencyPill: false,
  sheetOpen: false,
  inComposer: false,
  sendOnEnter: true,
};
const ev = (key: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: false,
  metaKey: false,
});

describe("escritorio.atajos · el mapa, entrada a entrada", () => {
  it("Ctrl+N abre un chat nuevo desde cualquier sección", () => {
    const m = P();
    expect(m.resolveShortcut(ev("n", { ctrl: true }), base)).toEqual({ kind: "new-chat" });
    expect(
      m.resolveShortcut(ev("n", { ctrl: true }), { ...base, inComposer: true }),
    ).toEqual({ kind: "new-chat" });
  });

  it("Ctrl+Mayús+F abre el buscador global", () => {
    const m = P();
    expect(m.resolveShortcut(ev("F", { ctrl: true, shift: true }), base)).toEqual({
      kind: "global-search",
    });
  });

  it("Ctrl+F busca dentro de la conversación", () => {
    const m = P();
    expect(m.resolveShortcut(ev("f", { ctrl: true }), base)).toEqual({
      kind: "search-in-chat",
    });
  });

  it("Fin va al final de la conversación; dentro del composer la tecla sigue siendo del texto", () => {
    const m = P();
    expect(m.resolveShortcut(ev("End"), base)).toEqual({ kind: "go-end" });
    expect(m.resolveShortcut(ev("End"), { ...base, inComposer: true })).toBeNull();
  });

  it("Esc con precedencia: con generación detiene; sin generación cierra la hoja abierta; sin nada, no hace nada", () => {
    const m = P();
    expect(m.resolveShortcut(ev("Escape"), { ...base, generating: true, sheetOpen: true })).toEqual({
      kind: "stop",
    });
    expect(m.resolveShortcut(ev("Escape"), { ...base, sheetOpen: true })).toEqual({
      kind: "close-sheet",
    });
    expect(m.resolveShortcut(ev("Escape"), base)).toBeNull();
  });

  it("Ctrl+1…Ctrl+8 recorre las ocho paradas de la barra en su orden; Ctrl+9 no existe", () => {
    const m = P();
    for (let i = 1; i <= 8; i++) {
      expect(m.resolveShortcut(ev(String(i), { ctrl: true }), base)).toEqual({
        kind: "section",
        index: i - 1,
      });
    }
    expect(m.resolveShortcut(ev("9", { ctrl: true }), base)).toBeNull();
  });

  it("Ctrl+M abre el gestor de modelos", () => {
    const m = P();
    expect(m.resolveShortcut(ev("m", { ctrl: true }), base)).toEqual({
      kind: "model-manager",
    });
  });

  it("Ctrl+/ abre la hoja de atajos", () => {
    const m = P();
    expect(m.resolveShortcut(ev("/", { ctrl: true }), base)).toEqual({
      kind: "shortcut-sheet",
    });
  });

  it("Ctrl++ acerca el zoom", () => {
    const m = P();
    expect(m.resolveShortcut(ev("+", { ctrl: true }), base)).toEqual({ kind: "zoom-in" });
    expect(m.resolveShortcut(ev("=", { ctrl: true }), base)).toEqual({ kind: "zoom-in" });
  });

  it("Ctrl+− aleja el zoom", () => {
    const m = P();
    expect(m.resolveShortcut(ev("-", { ctrl: true }), base)).toEqual({ kind: "zoom-out" });
  });

  it("Ctrl+0 vuelve el zoom al escalón central", () => {
    const m = P();
    expect(m.resolveShortcut(ev("0", { ctrl: true }), base)).toEqual({ kind: "zoom-reset" });
  });
});

describe("escritorio.atajos · el envío como ajuste", () => {
  it("posición por defecto: Intro envía y Ctrl+Intro inserta un salto de línea", () => {
    const m = P();
    const ctx = { ...base, inComposer: true, sendOnEnter: true };
    expect(m.resolveShortcut(ev("Enter"), ctx)).toEqual({ kind: "send" });
    expect(m.resolveShortcut(ev("Enter", { ctrl: true }), ctx)).toEqual({ kind: "newline" });
  });

  it("posición invertida: Intro inserta un salto y Ctrl+Intro envía", () => {
    const m = P();
    const ctx = { ...base, inComposer: true, sendOnEnter: false };
    expect(m.resolveShortcut(ev("Enter"), ctx)).toEqual({ kind: "newline" });
    expect(m.resolveShortcut(ev("Enter", { ctrl: true }), ctx)).toEqual({ kind: "send" });
  });

  it("el ajuste de envío persiste entre arranques en el almacén de ajustes", async () => {
    P();
    const settings = await import("../models/settings.js").catch(() => null);
    const s = settings as unknown as Record<string, unknown> | null;
    if (!s || typeof s.getSendOnEnter !== "function" || typeof s.setSendOnEnter !== "function")
      throw new Error(
        "ausencia entera de la pieza: el ajuste de envío no vive en el almacén (getSendOnEnter/setSendOnEnter)",
      );
    const get = s.getSendOnEnter as () => Promise<boolean>;
    const set = s.setSendOnEnter as (v: boolean) => Promise<void>;
    expect(await get()).toBe(true); // el defecto firmado: Intro envía
    await set(false);
    expect(await get()).toBe(false);
    await set(true);
    expect(await get()).toBe(true);
  });

  it("la hoja de atajos, contrastada línea a línea contra el mapa en las dos posiciones del ajuste", () => {
    const m = P();
    for (const sendOnEnter of [true, false]) {
      const rows = m.shortcutSheetRows(sendOnEnter);
      // Trece líneas: las once entradas, el envío y la emergencia,
      // cada una en su posición vigente. Ni Ctrl+W ni ninguna tecla
      // de cierre de ventana aparece en la hoja.
      expect(rows.length).toBe(13);
      expect(rows.some((r) => /Ctrl\+W/i.test(r.keys))).toBe(false);
      for (const row of rows) {
        const action = m.resolveShortcut(row.event, { ...base, ...row.context, sendOnEnter });
        expect(action, `la línea ${row.id} (${row.keys}) debe resolver a su acción`).toEqual(
          row.action,
        );
      }
    }
  });
});

describe("escritorio.atajos · el crédito heredado de la tanda 14", () => {
  it("crédito (a): con la pastilla presente y el ajuste por defecto, Ctrl+Intro detiene, espera y envía la emergencia", () => {
    const m = P();
    const ctx = { ...base, inComposer: true, generating: true, emergencyPill: true, sendOnEnter: true };
    expect(m.resolveShortcut(ev("Enter", { ctrl: true }), ctx)).toEqual({
      kind: "emergency-send",
    });
    // Sin pastilla, la misma tecla en la posición por defecto es
    // el salto de línea de siempre: el crédito no se cobra dos veces.
    expect(
      m.resolveShortcut(ev("Enter", { ctrl: true }), { ...ctx, emergencyPill: false }),
    ).toEqual({ kind: "newline" });
  });

  it("crédito (b): con el ajuste invertido, el atajo de emergencia pasa a Ctrl+Mayús+Intro y Ctrl+Intro sigue enviando", () => {
    const m = P();
    const ctx = { ...base, inComposer: true, generating: true, emergencyPill: true, sendOnEnter: false };
    expect(m.resolveShortcut(ev("Enter", { ctrl: true, shift: true }), ctx)).toEqual({
      kind: "emergency-send",
    });
    expect(m.resolveShortcut(ev("Enter", { ctrl: true }), ctx)).toEqual({ kind: "send" });
  });
});
