/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La derivación de tarjetas del gestor de modelos: función
 * pura que compone, para cada entrada del catálogo, el plan
 * de contexto sobre la foto de la máquina, el estado de
 * disco del censo, si es el residente y si hay una
 * transferencia en curso, y de ahí el estado de la tarjeta
 * y su acción principal. Su sede y su diseño viven en
 * estudios/MODELOS-ETAPA.md §3.3 y en DISENO-PC.md §4.3:
 *
 *   - El color y el contexto salen del plan
 *     (`planDesktopContext`), nunca de una segunda
 *     matemática: la insignia y la carga no pueden
 *     discrepar porque son la misma cuenta.
 *   - El recomendado es exactamente
 *     `defaultModelForBudget(presupuesto canónico)`: un
 *     solo recomendado, el de la escalera.
 *   - El residente no se juzga apilado sobre sí mismo: la
 *     foto que entra ya trae su crédito liberable (la
 *     compone quien llama, con `machineSnapshot`), y la
 *     derivación juzga a todas las tarjetas contra esa
 *     misma foto, porque la memoria del residente vuelve
 *     al cambiar de modelo.
 *   - Sin lectura de RAM el plan es null y la tarjeta lo
 *     dice con su estado, no con un color inventado.
 *
 * La degradación se deriva de los campos del plan, no de
 * su nota: amarillo de peldaño (bajó un contexto de la
 * escalera en fp16) o amarillo de suelo (solo cupo en el
 * contexto mínimo con la KV comprimida a q8). La capa de
 * interfaz construye su línea localizada desde estos
 * campos; la nota del plan es diagnóstico en inglés y
 * nunca se enseña.
 */

import {
  DESKTOP_CATALOG,
  defaultModelForBudget,
  type CatalogEntry,
} from "./catalog.js";
import {
  KV_Q8_BYTES,
  MIN_CONTEXT,
  kvCacheBytes,
  planDesktopContext,
  type ContextPlan,
  type MachineSnapshot,
} from "./ram.js";
import type { DiskState } from "./library.js";

/** Una transferencia en curso, tal como la conoce el gestor. */
export interface ModelTransfer {
  downloadedBytes: number;
  paused: boolean;
}

/**
 * El estado de la tarjeta, por la precedencia de DISENO
 * §4.3: activo > descargando/pausado > parcial >
 * comprobando > en disco > no coincide > no descargado.
 */
export type CardState =
  | "active"
  | "downloading"
  | "paused"
  | "partial"
  | "checking"
  | "on-disk"
  | "mismatch"
  | "not-downloaded";

/** La acción principal que el estado ofrece. */
export type CardAction =
  | "use"
  | "download"
  | "continue"
  | "redownload"
  | "pause"
  | "none";

/** Cómo degrada un amarillo: peldaño de la escalera o suelo q8. */
export type CardDegradation = "none" | "step-down" | "floor-q8";

export interface ModelCard {
  entry: CatalogEntry;
  /** El plan sobre la foto dada; null sin lectura de RAM. */
  plan: ContextPlan | null;
  recommended: boolean;
  disk: DiskState;
  resident: boolean;
  state: CardState;
  action: CardAction;
  degradation: CardDegradation;
  transfer?: { downloadedBytes: number; totalBytes: number; paused: boolean };
}

function stateFor(
  disk: DiskState,
  resident: boolean,
  transfer: ModelTransfer | undefined,
): CardState {
  if (resident) return "active";
  if (transfer) return transfer.paused ? "paused" : "downloading";
  switch (disk.kind) {
    case "partial":
      return "partial";
    case "checking":
      return "checking";
    case "installed":
      return disk.verified ? "on-disk" : "mismatch";
    case "absent":
      return "not-downloaded";
  }
}

function actionFor(state: CardState): CardAction {
  switch (state) {
    case "active":
    case "on-disk":
      return "use";
    case "downloading":
      return "pause";
    case "paused":
    case "partial":
      return "continue";
    case "mismatch":
      return "redownload";
    case "not-downloaded":
      return "download";
    case "checking":
      return "none";
  }
}

function degradationFor(
  entry: CatalogEntry,
  plan: ContextPlan | null,
): CardDegradation {
  if (!plan || plan.fit !== "yellow") return "none";
  const q8KvAtFloor = kvCacheBytes(entry.arch, MIN_CONTEXT, KV_Q8_BYTES);
  return plan.contextSize === MIN_CONTEXT && plan.workingSet.kvBytes === q8KvAtFloor
    ? "floor-q8"
    : "step-down";
}

export function deriveCards(args: {
  catalog?: readonly CatalogEntry[];
  snapshot: MachineSnapshot;
  canonicalBudget: number;
  census: ReadonlyMap<string, DiskState>;
  residentId: string | null;
  transfers: ReadonlyMap<string, ModelTransfer>;
}): ModelCard[] {
  const catalog = args.catalog ?? DESKTOP_CATALOG;
  const recommendedId = defaultModelForBudget(args.canonicalBudget).id;
  return catalog.map((entry) => {
    const disk: DiskState = args.census.get(entry.id) ?? { kind: "absent" };
    const resident = args.residentId === entry.id;
    const transfer = args.transfers.get(entry.id);
    const plan = planDesktopContext(entry, args.snapshot);
    const state = stateFor(disk, resident, transfer);
    return {
      entry,
      plan,
      recommended: entry.id === recommendedId,
      disk,
      resident,
      state,
      action: actionFor(state),
      degradation: degradationFor(entry, plan),
      ...(transfer
        ? {
            transfer: {
              downloadedBytes: transfer.downloadedBytes,
              totalBytes: entry.fileBytes,
              paused: transfer.paused,
            },
          }
        : {}),
    };
  });
}
