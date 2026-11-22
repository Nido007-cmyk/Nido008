/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Asiento de PC (E3, tanda 3 · J-2): equivalente fiel mínimo de
 * la sesión nativa del móvil, recreado en su ruta de origen
 * según la apertura de la tanda (§2.2.2 y §5.2). La superficie
 * recreada es exactamente la que las piezas de J-2 ejercitan:
 * el trío de la bandera M3 (el fondo apagado esta sesión), que
 * `reembed.ts` consulta y su batería ejercita. El resto del
 * módulo del móvil (el registro del cruce de arranques y la
 * detección de la muerte nativa que levanta esta bandera)
 * pertenece al mundo del motor y la carcasa, que lo recreará o
 * adoptará declarándolo; aquí la bandera nace sin levantar y
 * solo la levantan las llamadas a `holdBackgroundIndexingForSession`.
 */

// ------------------------------------------------------------ M3: el fondo apagado esta sesión

/**
 * La bandera de sesión de M3: el cruce la levanta y la consultan los
 * indexadores dentro de sus propios llamados (como la puerta nativa
 * de M1), así ningún lanzador puede saltársela. Vive solo en memoria:
 * es una degradación de UNA sesión, no un ajuste del usuario; el
 * siguiente arranque sin muerte nueva arranca con el fondo normal.
 */
let backgroundHeld = false;

export function holdBackgroundIndexingForSession(): void {
  backgroundHeld = true;
}

export function isBackgroundIndexingHeld(): boolean {
  return backgroundHeld;
}

/** Borrado total y tests: la sesión degradada se olvida con todo lo demás. */
export function resetBackgroundIndexingHold(): void {
  backgroundHeld = false;
}
