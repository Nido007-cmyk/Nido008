/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * approvalInbox.ts — REGISTRO EN MEMORIA (tanda 11, DET-11).
 *
 * En la fuente, la bandeja de aprobación lee las tareas remotas
 * encoladas del almacén P2P. En PC, en esta tanda, no hay transporte
 * ni almacén P2P: ninguna tarea remota puede llegar, y el registro en
 * memoria nace vacío y así se queda (las lecturas devuelven la
 * bandeja vacía y las decisiones devuelven «no encontrada», que son
 * las respuestas verdaderas de este estado). La superficie exportada
 * espeja la de la fuente; su sede de sustitución es la etapa P2P.
 */

export interface AgentTaskRequest {
  /** Id del mensaje (para aprobar/rechazar). */
  id: string;
  /** Clave pública del NIDO que la envió. */
  peerPkHex: string;
  /** Identidad del remitente (resuelta por clave exacta). */
  senderName: string;
  /** Prefijo de la clave del remitente, para cotejo. */
  senderPkShort: string;
  /** Acción solicitada + contexto (kind, texto, args resumidos). */
  actionText: string;
  /** Cuándo llegó (epoch ms). */
  receivedAt: number;
}

const pending: AgentTaskRequest[] = [];

/** Tareas remotas pendientes de decisión humana, ordenadas por llegada. */
export async function listPendingAgentTasks(): Promise<AgentTaskRequest[]> {
  return [...pending];
}

export async function getPendingAgentTask(id: string): Promise<AgentTaskRequest | null> {
  return pending.find((t) => t.id === id) ?? null;
}

export async function approveAgentTask(id: string): Promise<boolean> {
  const i = pending.findIndex((t) => t.id === id);
  if (i < 0) return false;
  pending.splice(i, 1);
  return true;
}

export async function rejectAgentTask(id: string): Promise<boolean> {
  const i = pending.findIndex((t) => t.id === id);
  if (i < 0) return false;
  pending.splice(i, 1);
  return true;
}

export async function pendingAgentTaskCount(): Promise<number> {
  return pending.length;
}
