/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchReports.ts — E10 (paso 5): los informes de
 * investigación guardados en la memoria cifrada de la
 * persona (nido_memory.db, tabla `research_reports`).
 *
 * Una corrida servida deja su documento: la pregunta, el
 * estilo, la forma Completo del informe con sus fuentes y el
 * recibo de corrida en texto. El documento vive cifrado con
 * el resto de la memoria y sale solo por la acción explícita
 * de exportar (el canal de la carcasa lo escribe en las
 * Descargas de la persona); nada lo exporta solo, nada lo
 * sincroniza, nada sale a la red.
 */
import { randomUUID } from "node:crypto";
import { getDatabase, safeJsonParse } from "../security/databaseManager.js";
import type { ResearchStyle } from "./orchestrator.js";
import { renderRunReceipt, type ResearchReceipt } from "./researchReport.js";
import type { GateLang } from "../routing/emergencyGate.js";

export interface SavedResearchReport {
  id: string;
  query: string;
  style: ResearchStyle;
  createdAt: string;
  /** El documento en texto (la forma Completo + el recibo de corrida). */
  document: string;
  receipt: ResearchReceipt;
}

/** Compone el documento guardado de una corrida. */
export function composeReportDocument(input: {
  query: string;
  style: ResearchStyle;
  completoText: string;
  receipt: ResearchReceipt;
  lang: GateLang;
}): string {
  return `${input.query}\n\n${input.completoText}\n\n---\n${renderRunReceipt(input.receipt.run, input.lang)}`;
}

export async function saveResearchReport(input: {
  query: string;
  style: ResearchStyle;
  completoText: string;
  receipt: ResearchReceipt;
  lang: GateLang;
}): Promise<SavedResearchReport> {
  const db = await getDatabase();
  const report: SavedResearchReport = {
    id: randomUUID(),
    query: input.query,
    style: input.style,
    createdAt: new Date().toISOString(),
    document: composeReportDocument(input),
    receipt: input.receipt,
  };
  await db.runAsync(
    "INSERT INTO research_reports (id, query, style, created_at, document) VALUES (?, ?, ?, ?, ?);",
    [report.id, report.query, report.style, report.createdAt, JSON.stringify(report)],
  );
  return report;
}

export async function getResearchReport(id: string): Promise<SavedResearchReport | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ document: string }>(
    "SELECT document FROM research_reports WHERE id = ?;",
    [id],
  );
  if (!row) return null;
  return safeJsonParse<SavedResearchReport | null>(row.document, null);
}

export async function listResearchReports(limit = 50): Promise<SavedResearchReport[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ document: string }>(
    "SELECT document FROM research_reports ORDER BY created_at DESC LIMIT ?;",
    [limit],
  );
  return rows
    .map((r) => safeJsonParse<SavedResearchReport | null>(r.document, null))
    .filter((r): r is SavedResearchReport => r !== null);
}

export async function deleteResearchReport(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM research_reports WHERE id = ?;", [id]);
}
