/**
 * La guarda de la sede única del núcleo (decisión de apertura
 * de E4, vía C: estudios/E4-SEDE-NUCLEO.md §3, firmada en
 * estudios/E4-APERTURA.md §3.1). La raíz src/core/ es el único
 * árbol que se edita a mano; la copia de app/electron/core/ la
 * genera app/scripts/sync-core.mjs y no se edita nunca a mano.
 * Esta prueba recomputa el sha256 de cada pareja y exige
 * igualdad y el mismo censo de ficheros en ambos árboles:
 * editar la copia a mano, o editar la raíz y commitear sin
 * re-sincronizar, pone la batería de la casa en rojo antes de
 * que el desvío llegue a un paquete. Si la guarda cae, no hay
 * verde. La lista de sincronización es la misma que la del
 * script; crece por asiento, en los dos sitios a la vez.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SYNCED_CORE_FILES = [
  "ram.ts",
  "catalog.ts",
  "engine.ts",
  "loadPath.ts",
  "download.ts",
  "machine.ts",
  "modelCards.ts",
  "library.ts",
  "assetCatalog.ts",
];

const rootCoreDir = path.dirname(fileURLToPath(import.meta.url));
const copyCoreDir = path.resolve(rootCoreDir, "..", "..", "app", "electron", "core");

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

describe("guarda de la copia del núcleo (vía C)", () => {
  it("cada pareja raíz/copia tiene sha256 idéntico y el censo de la copia es exactamente la lista de sincronización", () => {
    const census = readdirSync(copyCoreDir)
      .filter((name) => name.endsWith(".ts"))
      .sort();
    expect(
      census,
      "el censo de app/electron/core/ debe ser exactamente la lista de sincronización de app/scripts/sync-core.mjs",
    ).toEqual([...SYNCED_CORE_FILES].sort());
    for (const name of SYNCED_CORE_FILES) {
      expect(
        sha256Of(path.join(copyCoreDir, name)),
        `${name}: la copia de la carcasa diverge de la raíz; la raíz src/core/ es la única sede y la copia se regenera con app/scripts/sync-core.mjs, nunca a mano`,
      ).toBe(sha256Of(path.join(rootCoreDir, name)));
    }
  });
});
