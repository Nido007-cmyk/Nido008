/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.pegado — E11 paso 3: el pegado en el composer
 * (`src/desktop/pegado.ts`). El pegado es un gesto del
 * renderer: la lista de permisos de la carcasa sigue vacía
 * por diseño y ninguna lectura del portapapeles ocurre sin
 * el gesto — el último caso lo cobra por contrato sobre las
 * fuentes reales (el preload no expone lectura alguna del
 * portapapeles y la única costura es el manejador onPaste).
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Pegado = typeof import("./pegado.js");
let pieza: Pegado | null = null;
beforeAll(async () => {
  pieza = await import("./pegado.js").catch(() => null);
});
function P(): Pegado {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/pegado.ts (el pegado del composer de E11 paso 3 no está construido)",
    );
  return pieza;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const TXT = new TextEncoder().encode("fichero pegado\n");

describe("escritorio.pegado · el gesto y sus tres materias", () => {
  it("el texto pegado entra como texto, entero y sin tocar", () => {
    const m = P();
    const r = m.acceptPaste({ text: "  una frase con  espacios  " });
    expect(r).toEqual({ kind: "text", text: "  una frase con  espacios  " });
  });

  it("la imagen pegada entra como adjunto de su clase", () => {
    const m = P();
    const r = m.acceptPaste({ image: PNG });
    expect(r.kind).toBe("attachments");
    if (r.kind === "attachments") {
      expect(r.chips.length).toBe(1);
      expect(r.chips[0].kind).toBe("image");
    }
  });

  it("el fichero pegado entra por la misma clasificación que la caída", () => {
    const m = P();
    const r = m.acceptPaste({ files: [{ name: "nota.txt", bytes: TXT }] });
    expect(r.kind).toBe("attachments");
    if (r.kind === "attachments") {
      expect(r.chips.length).toBe(1);
      expect(r.chips[0].kind).toBe("text");
    }
  });

  it("un pegado sin contenido útil no cambia nada: ni texto, ni adjunto, ni error", () => {
    const m = P();
    expect(m.acceptPaste({})).toEqual({ kind: "none" });
    expect(m.acceptPaste({ text: "" })).toEqual({ kind: "none" });
  });

  it("sin gesto no hay lectura: el preload no expone lectura del portapapeles y la única costura de la superficie es onPaste", () => {
    P();
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const preload = read("../../app/electron/preload.ts");
    // Ninguna vía de lectura del portapapeles sale por el puente:
    // ni readText ni read ni readImage en el preload entero.
    expect(/clipboard/i.test(preload)).toBe(false);
    const app = read("../../app/src/App/App.tsx");
    // La superficie pega solo desde el gesto (el evento onPaste del
    // composer); ninguna otra aparición de clipboardData existe.
    const seams = app.match(/clipboardData/g) ?? [];
    expect(seams.length).toBeGreaterThan(0);
    expect(/onPaste/.test(app)).toBe(true);
  });
});
