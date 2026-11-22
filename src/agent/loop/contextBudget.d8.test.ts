/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Regresión D-8 (tanda 13, crédito aparte: 1 caso). El espécimen es
// el de la auditoría (sonda-presupuesto 2a): un historial
// [user, assistant, assistant, user, assistant] cuyo corte deja
// conservados los dos assistant seguidos en el borde antiguo. La
// retirada anti-huérfano de la base era un `if` único: retiraba el
// primer assistant y dejaba el historial empezando en el segundo,
// un turno de asistente sin su pregunta. La cura: la retirada es
// un bucle, con el ajuste de `used` en cada retirada, y nada más
// en la pieza.
//
// Sonda de vacuidad: contra la pieza sin el arreglo (el `if`
// único) este mismo caso cae — el historial devuelto empieza en
// «assistant» —; si pasara también sin arreglo, el caso no
// fijaría nada y el cobro no cobraría. Cobrada al nacer: rojo
// contra la base, verde tras la cura.
import { describe, it, expect } from "vitest";
import { applyContextBudget, type BudgetMessage } from "./contextBudget.js";

const byLength = (text: string): number => text.length;
const msg = (role: string, content: string): BudgetMessage => ({ role, content });

describe("D-8 · la retirada anti-huérfano no deja un assistant al frente", () => {
  it("historial [user, assistant, assistant, user, assistant] con el corte tras los dos assistant: el devuelto no empieza en assistant", () => {
    const history: BudgetMessage[] = [
      msg("user", "u1" + "x".repeat(98)), // 100: el que no cabe
      msg("assistant", "a2" + "x".repeat(8)), // 10
      msg("assistant", "a3" + "x".repeat(8)), // 10
      msg("user", "u4" + "x".repeat(8)), // 10
      msg("assistant", "a5" + "x".repeat(8)), // 10
    ];
    // Presupuesto de historial = 42 − 0 − 1 (sistema) − 1 (actual) = 40:
    // caben los cuatro turnos nuevos (40) y no el user antiguo (100).
    const result = applyContextBudget(msg("system", "s"), history, msg("user", "c"), {
      nCtx: 42,
      reserveGeneration: 0,
      maxSystemTokens: 21,
    }, byLength);

    // Los dos assistant huérfanos del borde se retiran; queda la
    // pareja íntegra [user, assistant] más reciente.
    expect(result.history.map((m) => m.content)).toEqual([
      "u4" + "x".repeat(8),
      "a5" + "x".repeat(8),
    ]);
    expect(result.history[0].role).toBe("user");
    expect(result.droppedTurns).toBe(3);
    // La cuenta de `used` descuenta cada retirada: 1 + 1 + 20 + 0.
    expect(result.estimatedTotalTokens).toBe(22);
  });
});
