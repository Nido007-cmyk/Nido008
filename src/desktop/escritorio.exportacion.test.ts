/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.exportacion — E11 paso 4: exportar la
 * conversación (`src/desktop/exportacion.ts`). Pieza nacida
 * en PC sin contrato heredado, por decisión firmada: nada
 * se exporta solo, ni por temporizador ni como efecto de
 * otra acción (R6: exportar y copiar, solo por acción
 * explícita de la persona). La verificación es abriendo el
 * fichero en disco: entero, en orden y sin nada ajeno.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";

type Exportacion = typeof import("./exportacion.js");
let pieza: Exportacion | null = null;
beforeAll(async () => {
  pieza = await import("./exportacion.js").catch(() => null);
});
function P(): Exportacion {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/desktop/exportacion.ts (la exportación de E11 paso 4 no está construida)",
    );
  return pieza;
}

const conv = {
  title: "La huerta de marzo",
  messages: [
    { role: "user", text: "¿Cuándo siembro los tomates?" },
    { role: "assistant", text: "Tras la última helada, con la luna creciente." },
    { role: "user", text: "¿Y el riego?" },
    { role: "assistant", text: "Temprano, sin mojar las hojas." },
  ],
};

describe("escritorio.exportacion · la conversación entera, en orden, sin nada ajeno", () => {
  it("el Markdown sale entero: título, los cuatro mensajes en su orden y ninguna otra cosa", () => {
    const m = P();
    const md = m.conversationToMarkdown(conv);
    expect(md).toContain("La huerta de marzo");
    const i1 = md.indexOf("¿Cuándo siembro los tomates?");
    const i2 = md.indexOf("Tras la última helada, con la luna creciente.");
    const i3 = md.indexOf("¿Y el riego?");
    const i4 = md.indexOf("Temprano, sin mojar las hojas.");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    // Nada ajeno: ni metadatos de la bóveda, ni datos del
    // sistema, ni otras conversaciones.
    expect(md).not.toMatch(/dek|vault|session|system prompt/i);
  });

  it("el texto llano sale entero y en el mismo orden, sin marcas", () => {
    const m = P();
    const txt = m.conversationToPlainText(conv);
    const i1 = txt.indexOf("¿Cuándo siembro los tomates?");
    const i2 = txt.indexOf("Tras la última helada, con la luna creciente.");
    const i3 = txt.indexOf("¿Y el riego?");
    const i4 = txt.indexOf("Temprano, sin mojar las hojas.");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    expect(txt).not.toContain("#");
    expect(txt).not.toContain("**");
  });

  it("arrastrar la respuesta fuera produce un fichero con nombre y contenido enteros", () => {
    const m = P();
    const payload = m.dragOutPayload(conv);
    expect(payload.fileName.endsWith(".md")).toBe(true);
    expect(payload.fileName).toContain("huerta");
    expect(payload.content).toBe(m.conversationToMarkdown(conv));
  });

  it("cancelar el diálogo de guardar no deja ningún fichero parcial: no se escribe nada", async () => {
    const m = P();
    let writes = 0;
    const r = await m.saveExport(
      {
        showSaveDialog: async () => null, // la persona cancela
        writeFile: async () => {
          writes++;
        },
      },
      "conversacion.md",
      "# contenido",
    );
    expect(r.saved).toBe(false);
    expect(writes).toBe(0);
    // Y con destino elegido, se escribe exactamente una vez.
    const ok = await m.saveExport(
      {
        showSaveDialog: async () => "/tmp/destino/conversacion.md",
        writeFile: async () => {
          writes++;
        },
      },
      "conversacion.md",
      "# contenido",
    );
    expect(ok.saved).toBe(true);
    expect(ok.path).toBe("/tmp/destino/conversacion.md");
    expect(writes).toBe(1);
  });
});
