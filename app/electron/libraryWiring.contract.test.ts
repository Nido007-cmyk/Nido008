/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * El clúster de Biblioteca del bloque de cableado (B-2, B-7,
 * B-8): los contratos de superficie de la pieza, en la forma
 * que el §5 del loop firmó para sus cargos de vista (PC no
 * tiene arnés de componentes: cero .test.tsx, sin jsdom; los
 * cargos se cobran como contratos sobre la fuente, y su
 * fragilidad queda declarada: cobran la cadena, no el gesto
 * en vivo). La rama de la pieza es la Q: B-4 ya se cobró
 * dentro de la pieza de B-1 (su canal `nido:library-data`),
 * así que este arnés nace sin su caso, declarado en la
 * apertura.
 *
 * Los cargos:
 *
 * 1. B-2, la tarjeta de importación: DocumentsCard compone
 *    las líneas por fichero desde `r.warnings` (nombre y
 *    razón en letra, por el ayudante compartido), y el mapa
 *    de razones cubre el vocabulario entero del importador
 *    con su clave en los tres locales.
 * 2. B-2, el detalle de la Biblioteca: la fila elegida de
 *    LibraryDocsSection pinta los `warnings` de su fila
 *    bajo la cabecera `libDocsWarnings`, con la misma
 *    letra por fichero.
 * 3. B-7, el gesto de quitar un paquete: PacksTab.remove
 *    captura el rechazo, libera `busy` en `finally` y
 *    nombra su frase de fallo `packsRemoveFailed`.
 * 4. B-7, exportar y activar: los dos gestos de
 *    LibraryDocsSection nombran su frase en el camino de
 *    fallo (`libDocsExportFailed`, `libDocsActivateFailed`),
 *    y las tres frases de B-7 viven en los tres locales.
 * 5. B-8, el selector: el `accept` del input de
 *    DocumentsCard contiene cada extensión de
 *    `TEXT_EXTENSIONS` (el espejo exacto que la prep
 *    prescribe), cobrado contra la fuente de
 *    attachmentPolicy, no contra una copia de la lista.
 *
 * Todos nacen en rojo contra la punta sin la pieza: la
 * tarjeta reduce los avisos a la frase genérica, el
 * detalle no puede pintar lo que la fila no trae, ningún
 * gesto nombra una frase de fallo porque ninguna existe,
 * y al selector le faltan siete extensiones.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSrc = readFileSync(fileURLToPath(new URL("../src/App/App.tsx", import.meta.url)), "utf8");
const policySrc = readFileSync(
  fileURLToPath(new URL("../../src/services/attachmentPolicy.ts", import.meta.url)),
  "utf8",
);

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

const REASON_KEYS: Record<string, string> = {
  noText: "libDocsWarnNoText",
  ocrFailed: "libDocsWarnOcrFailed",
  ocrEmpty: "libDocsWarnOcrEmpty",
  imageNoOcr: "libDocsWarnImageNoOcr",
  unsupported: "libDocsWarnUnsupported",
  pdfPassword: "libDocsWarnPdfPassword",
  pdfUnreadable: "libDocsWarnPdfUnreadable",
  alreadyImported: "libDocsWarnAlreadyImported",
  similarImported: "libDocsWarnSimilarImported",
};

describe("clúster de Biblioteca · contratos de superficie (B-2, B-7, B-8)", () => {
  it("B-2 · la tarjeta de importación compone las líneas por fichero desde r.warnings", () => {
    const card = region(appSrc, "function DocumentsCard");
    expect(card).toContain("setWarnLines");
    expect(card).toContain("warningLine(");
    expect(card).toContain("r.warnings");
    // El mapa de razones cubre el vocabulario entero, y cada
    // clave del mapa vive en los tres locales.
    for (const key of Object.values(REASON_KEYS)) {
      expect(appSrc).toContain(key);
      for (const lang of ["es", "en", "pt"]) {
        expect(locale(lang).pcSurface[key], `${key} en ${lang}`).toBeTruthy();
      }
    }
    expect(locale("en").pcSurface.libDocsWarnings).toBeTruthy();
  });

  it("B-2 · el detalle de la Biblioteca pinta los warnings de la fila bajo su cabecera", () => {
    const section = region(appSrc, "function LibraryDocsSection");
    expect(section).toContain("libDocsWarnings");
    expect(section).toContain("selected.warnings");
    expect(section).toContain("warningLine(");
  });

  it("B-7 · el gesto de quitar captura el rechazo, libera busy en finally y nombra su frase", () => {
    const tab = region(appSrc, "function PacksTab");
    expect(tab).toContain("packsRemoveFailed");
    expect(tab).toContain("finally");
    expect(tab).toContain("setBusy(null)");
  });

  it("B-7 · exportar y activar nombran su frase en el camino de fallo, y las tres viven ×3", () => {
    const section = region(appSrc, "function LibraryDocsSection");
    expect(section).toContain("libDocsExportFailed");
    expect(section).toContain("libDocsActivateFailed");
    for (const key of ["packsRemoveFailed", "libDocsExportFailed", "libDocsActivateFailed"]) {
      for (const lang of ["es", "en", "pt"]) {
        expect(locale(lang).pcSurface[key], `${key} en ${lang}`).toBeTruthy();
      }
    }
  });

  it("B-8 · el accept del selector contiene cada extensión de TEXT_EXTENSIONS", () => {
    const card = region(appSrc, "function DocumentsCard");
    const acceptMatch = card.match(/accept="([^"]+)"/);
    expect(acceptMatch, "el input trae accept").not.toBeNull();
    const accepted = new Set((acceptMatch?.[1] ?? "").split(",").map((x) => x.trim().replace(/^\./, "")));
    const setMatch = policySrc.match(/TEXT_EXTENSIONS = new Set\(\[([^\]]+)\]\)/);
    expect(setMatch, "TEXT_EXTENSIONS se lee de su fuente").not.toBeNull();
    const extensions = [...(setMatch?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(extensions.length).toBeGreaterThan(0);
    for (const ext of extensions) {
      expect(accepted.has(ext), `el selector admite .${ext}`).toBe(true);
    }
  });
});
