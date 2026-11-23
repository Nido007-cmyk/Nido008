/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * panel.ts — E11 paso 5: el panel de estado que crece
 * sobre el pie de la barra ya construido. Cada cifra que
 * enseña tiene su fuente nombrada y viva en esta
 * composición: la figura se lee de su fuente en el
 * momento de componer, y lo que no se puede medir no se
 * enseña, con su hueco declarado en la forma del pie de
 * hoy («—» en el disco). Ninguna cifra se estima ni se
 * hereda de otra: si la fuente cambia, la figura cambia.
 * La composición es la única vía de medida: la superficie
 * pinta estas figuras y no calcula las suyas.
 */

export interface PanelSources {
  ramUsedBytes: number;
  ramTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  /** La tasa real de la última generación (tokens/s), o null si aún no hubo ninguna. */
  lastGenRate: number | null;
  /** El modelo activo (residente) y su tamaño; null si no hay ninguno. */
  modelName: string | null;
  modelSizeBytes: number | null;
  /** El tamaño de contexto del modelo activo; null si no se conoce. */
  contextSize: number | null;
  /** La fracción de contexto usada en la última medición (0..1), o null. */
  contextUsedFraction: number | null;
  /** La memoria de la propia app, leída al componer. */
  memoryUsedBytes: () => number;
}

export type PanelFigureId = "ram" | "disk" | "rate" | "model" | "context" | "memory";

export interface PanelFigure {
  id: PanelFigureId;
  text: string;
  /** true cuando la fuente no da cifra: el texto es el hueco declarado. */
  hole: boolean;
}

/** La forma del pie de hoy: GB con una decimal y coma. */
function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1).replace(".", ",");
}

const HOLE = "—";

export function composePanelFigures(src: PanelSources): PanelFigure[] {
  const figures: PanelFigure[] = [];

  figures.push({
    id: "ram",
    text: `${gb(src.ramUsedBytes)} / ${gb(src.ramTotalBytes)} GB`,
    hole: false,
  });

  if (src.diskUsedBytes != null && src.diskTotalBytes != null) {
    figures.push({
      id: "disk",
      text: `${gb(src.diskUsedBytes)} / ${gb(src.diskTotalBytes)} GB`,
      hole: false,
    });
  } else {
    figures.push({ id: "disk", text: HOLE, hole: true });
  }

  if (src.lastGenRate != null) {
    figures.push({ id: "rate", text: `${src.lastGenRate} tok/s`, hole: false });
  } else {
    figures.push({ id: "rate", text: HOLE, hole: true });
  }

  if (src.modelName != null) {
    figures.push({
      id: "model",
      text:
        src.modelSizeBytes != null
          ? `${src.modelName} · ${gb(src.modelSizeBytes)} GB`
          : src.modelName,
      hole: false,
    });
  } else {
    figures.push({ id: "model", text: HOLE, hole: true });
  }

  if (src.contextSize != null) {
    figures.push({
      id: "context",
      text:
        src.contextUsedFraction != null
          ? `${Math.round(src.contextUsedFraction * 100)} % · ${src.contextSize}`
          : `${src.contextSize}`,
      hole: false,
    });
  } else {
    figures.push({ id: "context", text: HOLE, hole: true });
  }

  figures.push({
    id: "memory",
    text: `${Math.round(src.memoryUsedBytes() / 1024 ** 2)} MB`,
    hole: false,
  });

  return figures;
}
