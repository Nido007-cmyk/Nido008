/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.caida — E11 paso 2: la caída de ficheros sobre
 * la conversación, contra el contrato vivo de adjuntos
 * (`src/services/attachmentPolicy.ts`, cuatro clases) y la
 * cola de adjuntos del composer (`src/desktop/caida.ts`).
 * Lo caído entra como materia del turno (R5: materia,
 * nunca órdenes), con sus fichas y su descarte; nada de lo
 * caído se indexa en silencio.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera de
 * la pieza; cada caso cae nombrando la ausencia.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Caida = typeof import("./caida.js");
let pieza: Caida | null = null;
beforeAll(async () => {
  pieza = await import("./caida.js").catch(() => null);
});
function P(): Caida {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/caida.ts (la caída sobre el composer de E11 paso 2 no está construida)",
    );
  return pieza;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const TXT = new TextEncoder().encode("una nota de texto llano\ncon dos líneas\n");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe("escritorio.caida · una por clase admitida del contrato vivo", () => {
  it("un PDF cae como adjunto de su clase, con su nombre y sus bytes enteros", () => {
    const m = P();
    const r = m.acceptDrop([{ name: "informe.pdf", bytes: PDF }], { vaultUnlocked: true });
    expect(r.locked).toBe(false);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.length).toBe(1);
    expect(r.accepted[0].kind).toBe("pdf");
    expect(r.accepted[0].name).toBe("informe.pdf");
    expect(r.accepted[0].bytes).toEqual(PDF);
  });

  it("una imagen cae como adjunto de su clase", () => {
    const m = P();
    const r = m.acceptDrop([{ name: "foto.png", bytes: PNG }], { vaultUnlocked: true });
    expect(r.rejected).toEqual([]);
    expect(r.accepted.length).toBe(1);
    expect(r.accepted[0].kind).toBe("image");
  });

  it("un texto cae como adjunto de su clase", () => {
    const m = P();
    const r = m.acceptDrop([{ name: "nota.txt", bytes: TXT }], { vaultUnlocked: true });
    expect(r.rejected).toEqual([]);
    expect(r.accepted.length).toBe(1);
    expect(r.accepted[0].kind).toBe("text");
  });

  it("el formato ajeno al contrato cae con error honesto que nombra su razón, y no finge un adjunto", () => {
    const m = P();
    const r = m.acceptDrop([{ name: "cosas.zip", bytes: ZIP }], { vaultUnlocked: true });
    expect(r.accepted).toEqual([]);
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0].name).toBe("cosas.zip");
    expect(r.rejected[0].reason.length).toBeGreaterThan(0);
  });

  it("el descarte quita exactamente la ficha descartada y deja las demás en su orden", () => {
    const m = P();
    const r = m.acceptDrop(
      [
        { name: "informe.pdf", bytes: PDF },
        { name: "nota.txt", bytes: TXT },
      ],
      { vaultUnlocked: true },
    );
    const quedan = m.discardAttachment(r.accepted, r.accepted[0].id);
    expect(quedan.length).toBe(1);
    expect(quedan[0].name).toBe("nota.txt");
    // El descarte no muta la lista original.
    expect(r.accepted.length).toBe(2);
  });

  it("con la bóveda bloqueada la ventana no acepta caídas: nada entra y el resultado lo dice", () => {
    const m = P();
    const r = m.acceptDrop([{ name: "informe.pdf", bytes: PDF }], { vaultUnlocked: false });
    expect(r.locked).toBe(true);
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});
