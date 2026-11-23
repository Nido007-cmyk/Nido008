/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * conversationSearch.ts — E11 paso 9: el índice de texto
 * del buscador global de conversaciones (Ctrl+Mayús+F).
 * La misma forma FTS que la casa usa para los fragmentos
 * de conocimiento (chunks_fts de rag/db.ts), viviendo
 * dentro del almacén cifrado de E2 (su propia base con la
 * DEK de la sesión): fuera de la bóveda no hay texto en
 * claro ni índice en claro. Se mantiene al guardar las
 * conversaciones, con el coste declarado y medido por su
 * batería: una escritura de índice por mensaje nuevo, ni
 * una más. El salto del buscador aterriza en el mensaje
 * exacto (conversación e índice). Con la bóveda
 * bloqueada la búsqueda no está disponible y se dice,
 * con su error nombrado.
 */
import type { SecureDb } from "../security/secureDatabase.js";

export interface ConversationSearchHit {
  conversationId: string;
  messageIndex: number;
}

export function ensureConversationSearchSchema(db: SecureDb): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_messages_fts USING fts5(
      conversation_id UNINDEXED,
      message_index UNINDEXED,
      text
    );
  `);
}

/**
 * Indexa los mensajes de una conversación desde el
 * último ya indexado: devuelve cuántas filas escribió.
 * Si la conversación encogió (un mensaje borrado o una
 * edición que acorta), su índice se rehace entero: las
 * filas viejas no pueden quedarse señalando a mensajes
 * que ya no son los que eran.
 */
export function indexConversationMessages(
  db: SecureDb,
  conversationId: string,
  messages: { text: string }[],
  alreadyIndexed: number,
): number {
  ensureConversationSearchSchema(db);
  let start = alreadyIndexed;
  if (alreadyIndexed > messages.length) {
    db.prepare(
      "DELETE FROM conversation_messages_fts WHERE conversation_id = ?",
    ).run(conversationId);
    start = 0;
  }
  if (start >= messages.length) return 0;
  const insert = db.prepare(
    "INSERT INTO conversation_messages_fts (conversation_id, message_index, text) VALUES (?, ?, ?)",
  );
  let writes = 0;
  const tx = db.transaction(() => {
    for (let i = start; i < messages.length; i++) {
      insert.run(conversationId, i, messages[i].text);
      writes += 1;
    }
  });
  tx();
  return writes;
}

/** Retira una conversación del índice (su borrado o su desaparición del guardado). */
export function dropConversationFromIndex(db: SecureDb, conversationId: string): void {
  ensureConversationSearchSchema(db);
  db.prepare(
    "DELETE FROM conversation_messages_fts WHERE conversation_id = ?",
  ).run(conversationId);
}

/** El conteo por conversación, para reconstruir el estado de mantenimiento al abrir la base. */
export function conversationIndexCounts(db: SecureDb): Map<string, number> {
  ensureConversationSearchSchema(db);
  const rows = db
    .prepare(
      "SELECT conversation_id AS id, COUNT(*) AS n FROM conversation_messages_fts GROUP BY conversation_id",
    )
    .all() as { id: string; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * La búsqueda: cada palabra de la consulta como prefijo,
 * todas a la vez (AND de FTS5). Sin base (bóveda
 * bloqueada) se niega con su error nombrado; sin
 * palabras, el estado vacío diseñado.
 */
export function searchConversationIndex(
  db: SecureDb | null,
  query: string,
): ConversationSearchHit[] {
  if (!db) {
    throw new Error(
      "búsqueda no disponible: la bóveda está bloqueada (search locked)",
    );
  }
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  const expr = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
  const rows = db
    .prepare(
      "SELECT conversation_id, message_index FROM conversation_messages_fts WHERE conversation_messages_fts MATCH ? ORDER BY conversation_id, message_index",
    )
    .all(expr) as { conversation_id: string; message_index: number | string }[];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    messageIndex: Number(r.message_index),
  }));
}
