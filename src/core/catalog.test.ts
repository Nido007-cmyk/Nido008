/**
 * Integridad del catálogo: la puerta que el carril de seguridad exigió
 * en la tanda 1. Sin huella válida no hay entrada (fail-closed, como
 * en el móvil): cada entrada trae un sha256 en formato válido, ids
 * únicos, tamaños reales y fuentes https. Si mañana alguien añade un
 * modelo «de momento sin hash», esta batería se lo impide.
 */

import { describe, expect, it } from "vitest";
import { DESKTOP_CATALOG } from "./catalog.js";

const SHA256_FORMAT = /^[0-9a-f]{64}$/;

describe("integridad del catálogo", () => {
  it("toda entrada trae un sha256 en formato válido (64 hex)", () => {
    for (const entry of DESKTOP_CATALOG) {
      expect(entry.sha256, entry.id).toMatch(SHA256_FORMAT);
    }
  });

  it("los ids son únicos", () => {
    const ids = DESKTOP_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda entrada trae tamaño real, arquitectura sana y fuente https", () => {
    for (const entry of DESKTOP_CATALOG) {
      expect(entry.fileBytes, entry.id).toBeGreaterThan(0);
      expect(entry.arch.layers, entry.id).toBeGreaterThan(0);
      expect(entry.arch.kvHeads, entry.id).toBeGreaterThan(0);
      expect(entry.arch.headDim, entry.id).toBeGreaterThan(0);
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\//);
      expect(entry.license.length, entry.id).toBeGreaterThan(0);
      expect(entry.revision.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("toda URL está fijada a su revisión declarada (auditoría M-1)", () => {
    for (const entry of DESKTOP_CATALOG) {
      if (entry.sourceUrl.includes("huggingface.co")) {
        // La revisión es un commit y la URL lo lleva en el camino:
        // la rama móvil (main) no puede divorciar huella y fichero.
        expect(entry.revision, entry.id).toMatch(/^[0-9a-f]{40}$/);
        expect(entry.sourceUrl, entry.id).toContain(`/resolve/${entry.revision}/`);
      } else {
        // Descarga de release con etiqueta: la etiqueta ES la fijación.
        expect(entry.sourceUrl, entry.id).toContain(`/releases/download/${entry.revision}/`);
      }
    }
  });

  it("las capas de ventana nunca superan las capas totales", () => {
    for (const entry of DESKTOP_CATALOG) {
      const window = entry.arch.slidingWindowLayers ?? 0;
      expect(window, entry.id).toBeLessThanOrEqual(entry.arch.layers);
      if (window > 0) expect(entry.arch.slidingWindowTokens, entry.id).toBeGreaterThan(0);
    }
  });
});
