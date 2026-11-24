/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Superficies de bóveda (PAQ-2) · la primitiva extendida
 * de borrado, `src/security/vaultWipe.ts`: el censo
 * canónico del estado entero de NIDO en esta computadora
 * (los 10 puntos de §1 de PREP-SUPERFICIES-BOVEDA), el
 * marcador durable que se escribe ANTES de la primera
 * operación destructiva y solo se retira tras verificar,
 * el triturado criptográfico primero (el blob de
 * custodia muere antes que las bases) y la verificación
 * final que nombra lo que quede, sin callar nada.
 * Espejo reducido de `appReset.ts` del móvil, en su
 * forma: censo único, marcador con recuperación,
 * verificación con nombres.
 *
 * Los cuatro cargos:
 *
 * 1. La lista canónica WIPE_CENSUS cubre cada nombre
 *    del censo de §1 (guardia de inventario: cada
 *    productor nombrado en el papel está en la lista,
 *    por su nombre o por su directorio).
 * 2. wipeAllState sobre un árbol sembrado lo deja
 *    vacío y devuelve cero restos; el marcador se
 *    retira solo tras verificar.
 * 3. Un resto imborrable se devuelve por su nombre y
 *    el marcador permanece (wipeInterrupted lo ve).
 * 4. El blob de custodia se borra antes que las bases:
 *    con un borrado que falla en la base de memoria,
 *    el blob ya no está y lo que queda es cifrado sin
 *    clave.
 *
 * Nacimiento: rojo por ausencia entera de la pieza
 * (cada caso lo cobra por su nombre, con el P() de la
 * casa). El sabotaje de 3 y 4 va por la costura de
 * prueba de la primitiva (el removedor inyectado), la
 * misma forma que el sabotaje de deleteAsync del
 * móvil: la primitiva corre entera; solo la hoja que
 * borra finge fallar donde el caso lo pide.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

type Pieza = typeof import("./vaultWipe.js");
let pieza: Pieza | null = null;
beforeAll(async () => {
  pieza = await import("./vaultWipe.js").catch(() => null);
});
function P(): Pieza {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/security/vaultWipe.ts (la primitiva extendida de borrado de PAQ-2 no está construida)",
    );
  return pieza;
}

const dirs: string[] = [];
function freshBase(): string {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  const base = mkdtempSync(path.join(fixtureBase, "wipe-"));
  dirs.push(base);
  return base;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function seed(base: string, rel: string, content = "semilla"): void {
  const abs = path.join(base, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** El árbol sembrado de los casos: un fichero por punto del censo y sus restos típicos. */
function seedTree(base: string): string[] {
  const files = [
    "vault/nido-keyvault.json",
    "vault/nido-rotation-staging.json",
    "store/nido_memory.db",
    "store/nido_memory.db.format.json",
    "store/nido_memory.db-wal",
    "store/nido_memory.db.pre-restore-bak",
    "store/nido_search.db",
    "store/nido_search.db.format.json",
    "store/conversations.sealed",
    "store/conversations.sealed.corrupt-1",
    "store/packs/paquete.nidopack",
    "knowledge/nido_knowledge.db",
    "knowledge/nido_knowledge.db.format.json",
    "nido-prefs.json",
    "models/modelo.gguf",
    "assets/voz.onnx",
    "export-tmp/exportacion.json",
    "paste-tmp/pegado.txt",
  ];
  for (const f of files) seed(base, f);
  return files;
}

describe("vaultWipe · la primitiva extendida de borrado (PAQ-2)", () => {
  it("la lista canónica cubre cada nombre del censo de §1, y el marcador tiene su nombre propio", () => {
    const { WIPE_CENSUS, WIPE_MARKER } = P();
    expect(WIPE_MARKER).toBe(".nido-wipe-in-progress");
    const covered = (name: string) =>
      WIPE_CENSUS.some((e) => e === name || name.startsWith(`${e}/`));
    const census = [
      "vault/nido-keyvault.json",
      "vault/nido-rotation-staging.json",
      "store/nido_memory.db",
      "store/nido_memory.db.format.json",
      "store/nido_search.db",
      "store/conversations.sealed",
      "store/packs",
      "knowledge/nido_knowledge.db",
      "nido-prefs.json",
      "models",
      "assets",
      "export-tmp",
      "paste-tmp",
    ];
    for (const name of census) expect(covered(name), name).toBe(true);
    // El triturado manda en la propia lista: el blob es la
    // primera entrada, no una convención del llamante.
    expect(WIPE_CENSUS[0]).toBe("vault/nido-keyvault.json");
  });

  it("wipeAllState sobre un árbol sembrado lo deja vacío, devuelve cero restos y retira el marcador", () => {
    const { wipeAllState, wipeInterrupted } = P();
    const base = freshBase();
    const files = seedTree(base);
    expect(wipeInterrupted(base)).toBe(false);
    const leftovers = wipeAllState(base);
    expect(leftovers).toEqual([]);
    for (const f of files) expect(existsSync(path.join(base, f)), f).toBe(false);
    expect(wipeInterrupted(base)).toBe(false);
    // La base misma queda, vacía de estado de NIDO.
    expect(readdirSync(base)).toEqual([]);
  });

  it("un resto imborrable se devuelve por su nombre y el marcador permanece", () => {
    const { wipeAllState, wipeInterrupted, WIPE_MARKER } = P();
    const base = freshBase();
    seedTree(base);
    const refused = path.join(base, "nido-prefs.json");
    const leftovers = wipeAllState(base, (abs) => {
      if (abs === refused) throw new Error("sabotaje de la batería: no se puede borrar");
      rmSync(abs, { recursive: true, force: true });
    });
    expect(leftovers).toEqual(["nido-prefs.json"]);
    expect(existsSync(refused)).toBe(true);
    expect(existsSync(path.join(base, WIPE_MARKER))).toBe(true);
    expect(wipeInterrupted(base)).toBe(true);
  });

  it("el blob de custodia se borra antes que las bases: si el borrado falla en la memoria, la clave ya murió", () => {
    const { wipeAllState } = P();
    const base = freshBase();
    seedTree(base);
    const order: string[] = [];
    const storeAbs = path.join(base, "store");
    const leftovers = wipeAllState(base, (abs) => {
      order.push(abs);
      if (abs === storeAbs) throw new Error("sabotaje de la batería: la base no se deja borrar");
      rmSync(abs, { recursive: true, force: true });
    });
    expect(order[0]).toBe(path.join(base, "vault/nido-keyvault.json"));
    expect(existsSync(path.join(base, "vault/nido-keyvault.json"))).toBe(false);
    expect(existsSync(path.join(base, "store/nido_memory.db"))).toBe(true);
    expect(leftovers).toContain("store");
  });
});
