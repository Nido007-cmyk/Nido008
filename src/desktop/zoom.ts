/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * zoom.ts — E11 paso 6 (D-3, dirimido en forma A): el
 * tamaño del texto en cinco escalones nombrados sobre el
 * contrato FontScale del almacén cifrado, extendido de
 * tres a cinco valores. Una sola tabla escalón→factor
 * alimenta todo: el selector de Ajustes, las teclas
 * (Ctrl++, Ctrl+−, Ctrl+0) y la variable --font-scale de
 * la superficie. La tabla está acotada por las razones
 * medidas del móvil (cuerpo ≈ ×0,89 en compacto y ≈ ×1,21
 * en grande sobre el estándar); el extremo alto hereda el
 * tope que la vieja escala numérica permitía guardar
 * (1,4) y el bajo baja un paso más en la misma progresión.
 *
 * La escala numérica de las prefs de la carcasa se retira
 * con sus dos grampas: el número guardado se cobra una
 * sola vez, en el primer desbloqueo de la etapa, como el
 * escalón más cercano de esta tabla (empate: el escalón
 * menor), y sin número el arranque cae en standard.
 */
import type { FontScale } from "../models/settings.js";

export interface FontScaleStep {
  id: FontScale;
  factor: number;
}

export const FONT_SCALE_STEPS: FontScaleStep[] = [
  { id: "small", factor: 0.8 },
  { id: "compact", factor: 0.89 },
  { id: "standard", factor: 1 },
  { id: "large", factor: 1.21 },
  { id: "extra-large", factor: 1.4 },
];

export function fontScaleFactor(step: FontScale): number {
  return FONT_SCALE_STEPS.find((s) => s.id === step)?.factor ?? 1;
}

/** El escalón al que vuelve Ctrl+0: el central, el mismo por teclado que por ajustes. */
export function resetFontScaleStep(): FontScale {
  return "standard";
}

/** El escalón vecino al moverse por teclado; en los extremos, el mismo. */
export function stepFontScale(step: FontScale, dir: 1 | -1): FontScale {
  const i = FONT_SCALE_STEPS.findIndex((s) => s.id === step);
  const base = i >= 0 ? i : 2;
  const next = Math.min(FONT_SCALE_STEPS.length - 1, Math.max(0, base + dir));
  return FONT_SCALE_STEPS[next].id;
}

/**
 * La migración de la escala numérica retirada: el número
 * guardado se cobra como el escalón de factor más cercano
 * (empate: el menor); sin número, standard sin error.
 */
export function migrateNumericFontScale(saved: number | null | undefined): FontScale {
  if (typeof saved !== "number" || !Number.isFinite(saved)) return "standard";
  let best = FONT_SCALE_STEPS[0];
  for (const s of FONT_SCALE_STEPS) {
    if (Math.abs(s.factor - saved) < Math.abs(best.factor - saved)) best = s;
  }
  return best.id;
}
