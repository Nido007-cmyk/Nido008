/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Declaración de tipos de PC para `knowledge-pack-lib.mjs`, la
 * referencia de cuantización del constructor de packs que la tanda 2
 * de E3 (J-1) adoptó como fixture sellada de la batería
 * `pure.quantizeInt8` (adelanto A3 de la decisión de puerta,
 * estudios/E3-J1-PUERTA.md; huella sha256 del .mjs:
 * 2c2c42f7c7d7b9cbf22f1aa0c5f0f0ca06729f15fcca7b6f07546af2a1955cba).
 * Resellada en la tanda de la biblioteca de la serie de curas
 * (F-PC77 a F-PC84): la referencia dejó de ser byte a byte la del
 * árbol 0.1.108 y pasó a ser la misma convención con las
 * validaciones que el producto ya tenía, divergencia deliberada y
 * acotada a la entrada enferma o mal formada.
 *
 * El .mjs no se toca: esta declaración solo da tipos a la superficie
 * que la puerta consume (`quantizeInt8`), para que el typecheck de
 * PC la vea sin reescribir la fixture. Su sede de etapa es E5, que
 * adopta la pieza entera; si E5 amplía el consumo, amplía aquí.
 *
 * Ampliación de la tanda 4 (J-3): las baterías del contrato de
 * recuperación (retrieve.coverageGate, retrieve.noSourceSignals)
 * consumen también `parseGuide` y `chunkGuide` del constructor —
 * la dependencia que la apertura de la tanda declaró satisfecha
 * por la identidad byte a byte del .mjs — y sus tipos entran aquí
 * con la forma que el .mjs devuelve de verdad.
 */
export declare function quantizeInt8(
  vectors: ArrayLike<number>,
  dims: number
): { data: Int8Array; scales: Float32Array };

/** Una sección de guía tal como `parseGuide` la devuelve. */
export interface ParsedGuideSection {
  heading: string;
  text: string;
  questions: string[];
}

/** Una guía parseada por el constructor (formato v2 incluido). */
export interface ParsedGuide {
  title: string;
  category: string;
  lang: string;
  sources: string;
  key: string;
  region: string;
  verified: string;
  questions: string[];
  sections: ParsedGuideSection[];
}

export declare function parseGuide(markdown: string, file?: string): ParsedGuide;

export declare function chunkGuide(
  guide: ParsedGuide,
  target?: number,
  minChars?: number
): Array<{ heading: string; body: string; questions: string[] }>;
