/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La foto de la máquina (E4, paso 1): la única función que lee el
 * sistema para componer el MachineSnapshot que juzga las tarjetas.
 * Lee y compone; no recrea ninguna cuenta: el total y el libre
 * salen de la hoja de lectura de ram.ts (la que lee la RAM real
 * con la firma del móvil), el presupuesto sale de
 * availableBudgetBytes, y el liberable entra como parámetro
 * porque lo conoce el servicio gestor (la huella del residente),
 * no el sistema operativo.
 *
 * Las lecturas son inyectables para la batería: la pieza es pura
 * salvo la lectura del SO por defecto. Si la lectura del total
 * no llega, la foto trae total 0 y la matemática devuelve plan
 * null aguas abajo: sin medición no se juzga ni se inventa. Si
 * la lectura del libre no llega, la foto no trae freeRamBytes y
 * la cuenta cae a la foto por el total, como availableBudgetBytes
 * ya hace.
 */

import {
  availableBudgetBytes,
  getAvailableMemory,
  getDeviceTotalRamBytes,
  type MachineSnapshot,
} from "./ram.js";

/** Las dos lecturas del sistema que la foto necesita. */
export interface MachineReaders {
  totalRamBytes(): number;
  /** RAM libre ahora; undefined si la lectura no llegó. */
  freeRamBytes(): number | undefined;
}

const systemReaders: MachineReaders = {
  totalRamBytes: () => getDeviceTotalRamBytes(),
  freeRamBytes: () => getAvailableMemory()?.availBytes,
};

/**
 * La foto de la máquina en este instante. `releasableBytes` es
 * la huella estimada del modelo residente que una sustitución
 * liberaría (el crédito de la lección 2 de la etapa); sin
 * residente, no se pasa y la foto no trae crédito.
 */
export function machineSnapshot(
  releasableBytes?: number,
  readers: MachineReaders = systemReaders,
): MachineSnapshot {
  const total = readers.totalRamBytes();
  const free = readers.freeRamBytes();
  const snapshot: MachineSnapshot = { totalRamBytes: Math.max(total, 0) };
  if (free !== undefined && free > 0) snapshot.freeRamBytes = free;
  if (releasableBytes !== undefined) {
    snapshot.releasableBytes = Math.max(releasableBytes, 0);
  }
  return snapshot;
}

/**
 * El presupuesto de la foto canónica (por el total, sin libre
 * ni liberable): el que decide el chip de recomendado y la
 * cabecera del gestor, porque el recomendado es una propiedad
 * de la máquina, no del instante (lección 3 de la etapa).
 */
export function canonicalBudgetBytes(totalRamBytes: number): number {
  return availableBudgetBytes({ totalRamBytes });
}
