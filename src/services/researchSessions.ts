/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * researchSessions.ts — E10 (paso 6): las sesiones de
 * investigación que sobreviven, sobre la memoria cifrada de
 * la persona (nido_memory.db, tabla `research_sessions` de
 * la migración 1→2).
 *
 * El pipeline entrega la foto de la sesión al cerrar cada
 * etapa y este almacén la guarda tal cual: ni la pregunta ni
 * una subrespuesta viven fuera de la bóveda. Parar una
 * corrida es pausarla: la sesión queda en su última etapa
 * cerrada y la reanudación reentra en el pipeline desde ahí.
 * Borrar una sesión es borrar un documento de la persona:
 * la superficie lo confirma con la misma puerta del chat.
 */
import { getDatabase, safeJsonParse } from "../security/databaseManager.js";
import type { ResearchSessionSnapshot } from "./orchestrator.js";

export interface ResearchSessionRow {
  id: string;
  query: string;
  lang: string;
  scope: string;
  style: string;
  stage: ResearchSessionSnapshot["stage"];
  snapshot: ResearchSessionSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSessionSummary {
  id: string;
  query: string;
  stage: ResearchSessionSnapshot["stage"];
  updatedAt: string;
  /** Pasadas cerradas que la sesión ya tiene investigadas. */
  closedPasses: number;
  /** Subpreguntas del plan, para enseñar el avance (x de y). */
  planSize: number;
}

/**
 * Guarda la foto de una etapa cerrada. La primera foto crea
 * la fila; las siguientes la actualizan. Nunca se llama a
 * mitad de una etapa: eso lo gobierna el pipeline, que solo
 * entrega fotos al cerrar.
 */
export async function saveResearchSessionStage(input: {
  id: string;
  query: string;
  lang: string;
  scope: string;
  style: string;
  snapshot: ResearchSessionSnapshot;
}): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM research_sessions WHERE id = ?;",
    [input.id],
  );
  const snapshotJson = JSON.stringify(input.snapshot);
  if (existing) {
    await db.runAsync(
      "UPDATE research_sessions SET stage = ?, snapshot = ?, updated_at = ? WHERE id = ?;",
      [input.snapshot.stage, snapshotJson, now, input.id],
    );
  } else {
    await db.runAsync(
      "INSERT INTO research_sessions (id, query, lang, scope, style, stage, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [
        input.id,
        input.query,
        input.lang,
        input.scope,
        input.style,
        input.snapshot.stage,
        snapshotJson,
        now,
        now,
      ],
    );
  }
}

export async function getResearchSession(id: string): Promise<ResearchSessionRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    query: string;
    lang: string;
    scope: string;
    style: string;
    stage: string;
    snapshot: string;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM research_sessions WHERE id = ?;", [id]);
  if (!row) return null;
  const snapshot = safeJsonParse<ResearchSessionSnapshot | null>(row.snapshot, null);
  if (!snapshot) return null;
  return {
    id: row.id,
    query: row.query,
    lang: row.lang,
    scope: row.scope,
    style: row.style,
    stage: row.stage as ResearchSessionSnapshot["stage"],
    snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listResearchSessions(limit = 50): Promise<ResearchSessionSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    query: string;
    stage: string;
    snapshot: string;
    updated_at: string;
  }>(
    "SELECT id, query, stage, snapshot, updated_at FROM research_sessions ORDER BY updated_at DESC LIMIT ?;",
    [limit],
  );
  return rows.map((r) => {
    const snapshot = safeJsonParse<ResearchSessionSnapshot | null>(r.snapshot, null);
    return {
      id: r.id,
      query: r.query,
      stage: r.stage as ResearchSessionSnapshot["stage"],
      updatedAt: r.updated_at,
      closedPasses: snapshot?.passes.length ?? 0,
      planSize: snapshot?.subQuestions.length ?? 0,
    };
  });
}

export async function deleteResearchSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM research_sessions WHERE id = ?;", [id]);
}
