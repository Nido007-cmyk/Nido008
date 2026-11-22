/**
 * Informe del catálogo de escritorio: para cada modelo y cada clase
 * de máquina (8 / 16 / 32 GB), el plan que la matemática de ram.ts
 * aprueba. Es la tabla que ARQUITECTURA.md cita; sale de ejecutar el
 * código, no de escribirla a mano.
 *
 * Uso: npm run catalog
 */

import { DESKTOP_CATALOG, defaultModelForBudget } from "../src/core/catalog.js";
import {
  availableBudgetBytes,
  planDesktopContext,
  toGib,
  type MachineSnapshot,
} from "../src/core/ram.js";

const GIB = 1024 * 1024 * 1024;
for (const gb of [8, 16, 32]) {
  const snapshot: MachineSnapshot = { totalRamBytes: gb * GIB };
  const budget = availableBudgetBytes(snapshot);
  console.log(`\n== machine with ${gb} GiB RAM (budget ${toGib(budget)} GiB)`);
  console.log(`   default: ${defaultModelForBudget(budget).label}`);
  for (const entry of DESKTOP_CATALOG) {
    if (entry.kind !== "llm") continue;
    const plan = planDesktopContext(entry, snapshot)!;
    console.log(
      `   ${entry.label.padEnd(36)} fit=${plan.fit.padEnd(6)} ctx=${String(plan.contextSize).padStart(5)} set=${toGib(plan.workingSet.totalBytes)} GiB`,
    );
  }
}
