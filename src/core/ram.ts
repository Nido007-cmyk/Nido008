/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Matemática de memoria de NIDO PC — implementación original para
 * escritorio de la misma contabilidad física que la casa ya usa en el
 * móvil (pesos + caché KV exacta + cómputo + logits), con la política
 * de presupuesto rehecha para un PC:
 *
 *  - No hay reserva telefónica de 2 GiB ni peldaño de emergencia de
 *    1024: un PC tiene sistema operativo de escritorio, swap y nadie
 *    lo mata por memoria como Android. La reserva es proporcional:
 *    máx(2 GiB, 20 % del total) con techo de 8 GiB — lo que el sistema
 *    y las demás apps necesitan para respirar.
 *  - La escalera de contexto sube hasta 32 768 (el escritorio sí
 *    puede pagar la KV) y el suelo sigue siendo 2048: por debajo, un
 *    chat con fuentes no respira, igual que en el móvil.
 *  - El veredicto de color es el mismo contrato honesto de la casa:
 *    verde = cabe en el techo con KV fp16; amarillo = cabe degradado
 *    (peldaño menor o KV q8); rojo = no cabe ni así. Y la insignia ES
 *    el veredicto de la vía de carga, no una segunda estimación.
 *
 * Todo es puro y testeable: ninguna función lee el sistema; la foto
 * de la máquina entra como parámetro. La única excepción es la hoja de
 * lectura del final (alineación al móvil, cierre R2), que sirve al
 * contrato `ram-monitor` del móvil para `inference/ramBudget.ts`.
 */

import { availableParallelism, cpus, freemem, totalmem } from "node:os";

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/** Arquitectura de un modelo, lo que la fórmula de KV necesita. */
export interface ArchProfile {
  layers: number;
  kvHeads: number;
  headDim: number;
  vocab: number;
  /**
   * Atención híbrida (p. ej. Gemma 3): de las `layers`, este número
   * son capas de ventana deslizante cuya KV crece solo hasta
   * `slidingWindowTokens`, no hasta el contexto. Sin estos campos el
   * perfil es de atención plena en todas las capas. Extensión pedida
   * por el estudio de catálogo grande (2026-11-16): sin ella, la KV
   * de un Gemma 3 salía como una cota muy por encima de la real y el
   * 27B se pintaba rojo en máquinas donde es verde.
   */
  slidingWindowLayers?: number;
  slidingWindowTokens?: number;
}

export interface ModelSpec {
  id: string;
  /** Tamaño del GGUF en disco, en bytes. */
  fileBytes: number;
  arch: ArchProfile;
  /** Contexto máximo que el modelo admite (su config, no un deseo). */
  maxContext: number;
}

/** Foto de la máquina en un momento dado. */
export interface MachineSnapshot {
  totalRamBytes: number;
  /** RAM libre ahora mismo; undefined si la lectura no llegó. */
  freeRamBytes?: number;
  /** Lo que un modelo residente liberaría al ser sustituido. */
  releasableBytes?: number;
}

/** Lo que la propia app de escritorio ocupa antes de cargar un modelo. */
export const APP_BASELINE_BYTES = 256 * MIB;

/** Micro-lote de referencia en escritorio (sin la presión térmica del móvil). */
export const DESKTOP_UBATCH = 512;

/** Bytes por elemento de KV: fp16 (defecto de llama.cpp) y q8_0. */
export const KV_FP16_BYTES = 2;
export const KV_Q8_BYTES = 1;

/** Escalera de contexto de escritorio, de mayor a menor. */
export const DESKTOP_CONTEXT_LADDER: readonly number[] = [
  32768, 16384, 8192, 6144, 4096, 3072, 2048,
];

/** Suelo de contexto: por debajo, un chat con fuentes no respira. */
export const MIN_CONTEXT = 2048;

/**
 * Techo de contexto prometido según el presupuesto de la máquina
 * (la misma idea que el techo por clase del móvil, con clases de
 * escritorio). La KV de los Qwen3 es pesada — 8 cabezas KV × 128 —
 * y a 32 768 tokens se come ella sola 3,5 GiB: prometer 32k en una
 * máquina de 8 GB condenaría a amarillo hasta al modelo ligero.
 * La promesa honesta por clase: presupuesto ≥ 8 GiB → 32 768;
 * ≥ 4 GiB → 16 384; por debajo → 8 192. «Verde» significa caber en
 * EL TECHO DE TU CLASE, y la escalera baja desde ahí.
 */
export function ceilingForBudget(budgetBytes: number): number {
  if (budgetBytes >= 8 * GIB) return 32768;
  if (budgetBytes >= 4 * GIB) return 16384;
  return 8192;
}

/**
 * Reserva para el sistema operativo y las demás aplicaciones.
 * Proporcional con suelo y techo: una máquina de 8 GiB reserva 2 GiB;
 * una de 16, 3,2 GiB; una de 32, 6,4 GiB; una de 64 no pasa de 8 GiB.
 */
export function systemReserveBytes(totalRamBytes: number): number {
  if (totalRamBytes <= 0) return 0;
  const proportional = Math.floor(totalRamBytes * 0.2);
  return Math.min(Math.max(proportional, 2 * GIB), 8 * GIB);
}

/** Huella exacta de la caché KV de un contexto. */
export function kvCacheBytes(
  arch: ArchProfile,
  contextSize: number,
  bytesPerElement: number = KV_FP16_BYTES,
): number {
  const windowLayers = Math.min(arch.slidingWindowLayers ?? 0, arch.layers);
  const fullLayers = arch.layers - windowLayers;
  const windowTokens = Math.min(contextSize, arch.slidingWindowTokens ?? contextSize);
  const positions = fullLayers * contextSize + windowLayers * windowTokens;
  return 2 * positions * arch.kvHeads * arch.headDim * bytesPerElement;
}

/**
 * Término de cómputo: el búfer de logits del micro-lote
 * (ubatch × vocabulario × fp32) más un espacio de trabajo del grafo
 * de 128 MiB a 4096 de contexto, escalado linealmente. Es una
 * asignación deliberadamente conservadora — un pre-flight que se
 * adelanta molesta; uno que se retrasa, rompe — y queda pendiente de
 * calibración contra cargas reales en PC (ver CHECKPOINT).
 */
const GRAPH_WORKSPACE_AT_4K = 128 * MIB;

export function computeBytes(
  contextSize: number,
  ubatch: number = DESKTOP_UBATCH,
  vocab: number = 152064,
): number {
  const batchLogits = ubatch * vocab * 4;
  const graph = Math.ceil((GRAPH_WORKSPACE_AT_4K * Math.max(contextSize, 0)) / 4096);
  return batchLogits + graph;
}

/** Logits de salida: una fila por llamada de decodificación. */
export function logitsBytes(vocab: number): number {
  return Math.max(vocab, 0) * 4;
}

export interface WorkingSet {
  weightsBytes: number;
  kvBytes: number;
  computeBytes: number;
  logitsBytes: number;
  totalBytes: number;
}

/** El conjunto de trabajo estimado de un modelo a un contexto dado. */
export function estimateWorkingSet(
  spec: ModelSpec,
  contextSize: number,
  kvBytesPerElement: number = KV_FP16_BYTES,
): WorkingSet {
  const weightsBytes = Math.max(spec.fileBytes, 0);
  const kv = kvCacheBytes(spec.arch, contextSize, kvBytesPerElement);
  const compute = computeBytes(contextSize, DESKTOP_UBATCH, spec.arch.vocab);
  const logits = logitsBytes(spec.arch.vocab);
  return {
    weightsBytes,
    kvBytes: kv,
    computeBytes: compute,
    logitsBytes: logits,
    totalBytes: weightsBytes + kv + compute + logits,
  };
}

/**
 * Presupuesto disponible para modelos en esta foto de la máquina:
 * la menor de (total − reserva − base de la app) y (libre +
 * liberable), cuando la lectura en vivo existe. Sin lectura en vivo
 * manda la cuenta por el total. Nunca negativo.
 */
export function availableBudgetBytes(snapshot: MachineSnapshot): number {
  if (snapshot.totalRamBytes <= 0) return 0;
  const byTotal =
    snapshot.totalRamBytes - systemReserveBytes(snapshot.totalRamBytes) - APP_BASELINE_BYTES;
  let available = byTotal;
  if (snapshot.freeRamBytes !== undefined) {
    const releasable = Math.max(snapshot.releasableBytes ?? 0, 0);
    available = Math.min(byTotal, snapshot.freeRamBytes + releasable);
  }
  return Math.max(available, 0);
}

export type Fit = "green" | "yellow" | "red" | "unknown";

export interface ContextPlan {
  /** Contexto elegido (el techo si es verde; un peldaño si es amarillo). */
  contextSize: number;
  /** El techo: nunca por encima del máximo del modelo ni de 32 768. */
  ceiling: number;
  fit: Fit;
  /** Conjunto de trabajo del plan elegido. */
  workingSet: WorkingSet;
  /** Presupuesto contra el que se juzgó. */
  budgetBytes: number;
  /** Qué se degradó y por qué, en una frase; "" si el plan es el techo. */
  note: string;
}

/**
 * El plan de contexto para cargar un modelo en esta máquina.
 * null si la foto no trae RAM usable: sin medición no se juzga.
 */
export function planDesktopContext(
  spec: ModelSpec,
  snapshot: MachineSnapshot,
): ContextPlan | null {
  if (snapshot.totalRamBytes <= 0) return null;
  const budget = availableBudgetBytes(snapshot);
  const ceiling = Math.min(spec.maxContext, ceilingForBudget(budget));
  const rungs = [ceiling, ...DESKTOP_CONTEXT_LADDER.filter((c) => c < ceiling)];

  for (const contextSize of rungs) {
    const ws = estimateWorkingSet(spec, contextSize, KV_FP16_BYTES);
    if (ws.totalBytes <= budget) {
      return {
        contextSize,
        ceiling,
        fit: contextSize === ceiling ? "green" : "yellow",
        workingSet: ws,
        budgetBytes: budget,
        note:
          contextSize === ceiling
            ? ""
            : `context stepped down from ${ceiling} to ${contextSize} to fit this machine's RAM`,
      };
    }
  }
  // Última palabra de la vía de carga: el suelo con KV q8_0.
  const floorQ8 = estimateWorkingSet(spec, MIN_CONTEXT, KV_Q8_BYTES);
  if (floorQ8.totalBytes <= budget) {
    return {
      contextSize: MIN_CONTEXT,
      ceiling,
      fit: "yellow",
      workingSet: floorQ8,
      budgetBytes: budget,
      note: `fits only at the ${MIN_CONTEXT} floor with q8 KV cache`,
    };
  }
  const floor = estimateWorkingSet(spec, MIN_CONTEXT, KV_FP16_BYTES);
  return {
    contextSize: MIN_CONTEXT,
    ceiling,
    fit: "red",
    workingSet: floor,
    budgetBytes: budget,
    note: "does not fit even at the floor with q8 KV cache",
  };
}

/** Formato corto para diagnósticos: "5.4". */
export function toGib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

// ---------------------------------------------------------------------------
// Hoja de lectura de la RAM real (alineación al móvil, cierre R2)
// ---------------------------------------------------------------------------
//
// `inference/ramBudget.ts` se adopta del 0.1.108 tal cual y su única hoja
// de plataforma es el módulo nativo `ram-monitor` del móvil. Estas cuatro
// funciones son esa hoja en el escritorio, con las firmas y los tipos del
// contrato del móvil (modules/ram-monitor/index.ts): la lógica y las
// entradas del presupuesto son las del móvil; aquí solo se lee la máquina.

/** Lo que el sistema tiene libre ahora (contrato `AvailableMemory` del móvil). */
export interface AvailableMemory {
  availBytes: number;
  thresholdBytes: number;
  lowMemory: boolean;
}

/** Memoria del proceso (contrato `MemoryInfo` del móvil). */
export interface MemoryInfo {
  rssBytes: number;
  totalPssBytes: number;
}

/** RAM total de la máquina; 0 si no se puede leer (como el móvil). */
export function getDeviceTotalRamBytes(): number {
  try {
    return totalmem();
  } catch {
    return 0;
  }
}

/**
 * RSS del proceso. El escritorio no tiene la cifra PSS de Android: se
 * declara 0, que el contrato del móvil lee como «sin cifra de cruce».
 */
export function getMemoryInfo(): MemoryInfo {
  return { rssBytes: process.memoryUsage().rss, totalPssBytes: 0 };
}

/**
 * Memoria disponible ahora (libuv: MemAvailable en Linux, la disponible
 * del sistema en Windows y macOS); null sin lectura, como el móvil. El
 * escritorio no tiene el umbral de cierre de apps de Android: umbral 0 y
 * `lowMemory` falso.
 */
export function getAvailableMemory(): AvailableMemory | null {
  try {
    const availBytes = freemem();
    return availBytes > 0 ? { availBytes, thresholdBytes: 0, lowMemory: false } : null;
  } catch {
    return null;
  }
}

/** Núcleos lógicos de la máquina; null sin lectura, como el móvil. */
export function getProcessorCount(): number | null {
  try {
    const n = typeof availableParallelism === "function" ? availableParallelism() : cpus().length;
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

