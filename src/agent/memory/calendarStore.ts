/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * calendarStore.ts — el dominio `calendar_events` de AGENDA-PC
 * §3.1 sobre la base personal cifrada de E2 (paso 2 de E7).
 *
 * El calendario de PC vive dentro de NIDO: no hay módulo de
 * calendario del sistema ni permiso que pedir. Los eventos
 * guardan instantes UTC; la hora local se calcula al armar
 * avisos y al enseñar, y la zona horaria no se guarda como dato.
 *
 * El aviso no vive en el evento: si el evento trae
 * `alertOffsetMin`, su aviso se materializa en la cola única
 * (kind `event`, `ref_id` al evento) por noticeStore, en la
 * misma transacción que la fila del evento. Corregir el evento
 * rearma su aviso y borrarlo lo desarma, en la misma operación.
 */

import { randomUUID } from "node:crypto";
import {
  getDatabase,
  writeTransaction,
} from "../../security/databaseManager.js";
import {
  buildNotice,
  deleteNoticesByRefWithin,
  deriveNextFireAt,
  insertNoticeWithin,
  syncAgendaAfterWrite,
  toBaseLocal,
  type NoticeDb,
} from "./noticeStore.js";
import { lastOccurrenceAt, parseStoredRule } from "./eventSeries.js";

export type CalendarOrigin = "chat" | "ui" | "ics";

export interface CalendarEvent {
  id: string;
  /** UID de iCalendar: clave de deduplicación al importar. */
  uid: string;
  title: string;
  notes: string;
  location: string;
  /** Instantes UTC (epoch ms). */
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  rrule: string | null;
  rruleUntil: number | null;
  /** Minutos antes del inicio a los que avisa; null = sin aviso. */
  alertOffsetMin: number | null;
  origin: CalendarOrigin;
  createdAt: number;
  updatedAt: number;
  /**
   * Solo en memoria, nunca una columna: lo pone la
   * expansión (eventSeries) en las copias de una serie
   * que no son su primera fecha, para que la vista las
   * pinte sin botones de editar ni borrar.
   */
  occurrence?: boolean;
}

interface CalendarEventRow {
  id: string;
  uid: string;
  title: string;
  notes: string;
  location: string;
  starts_at: number;
  ends_at: number;
  all_day: number;
  rrule: string | null;
  rrule_until: number | null;
  alert_offset_min: number | null;
  origin: string;
  created_at: number;
  updated_at: number;
}

function rowToEvent(r: CalendarEventRow): CalendarEvent {
  return {
    id: r.id,
    uid: r.uid,
    title: r.title,
    notes: r.notes,
    location: r.location,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    allDay: r.all_day !== 0,
    rrule: r.rrule,
    rruleUntil: r.rrule_until,
    alertOffsetMin: r.alert_offset_min,
    origin: r.origin as CalendarOrigin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateEventInput {
  title: string;
  startsAt: number;
  endsAt: number;
  notes?: string;
  location?: string;
  allDay?: boolean;
  rrule?: string | null;
  rruleUntil?: number | null;
  alertOffsetMin?: number | null;
  /** Origen de la fila (defecto: el chat). */
  origin?: CalendarOrigin;
  /** UID de iCalendar; si falta, NIDO lo genera. */
  uid?: string;
  /** Reloj inyectable (defecto: ahora). */
  now?: number;
}

/** Materializa (o rearma) el aviso de un evento dentro de la transacción. */
async function armEventNoticeWithin(
  db: NoticeDb,
  ev: CalendarEvent,
  now: number,
): Promise<void> {
  await deleteNoticesByRefWithin(db, "event", ev.id);
  if (ev.alertOffsetMin == null) return;
  const fireAt = ev.startsAt - ev.alertOffsetMin * 60_000;
  // CARGO-2: si el evento trae una regla interpretable,
  // su aviso es UNA fila de la cola con la repetición y
  // el fin de la serie en `endsAt` (el instante de
  // disparo de la última ocurrencia): la maquinaria de
  // series de la cola lo avanza y lo cierra. Una serie
  // ya acabada no se arma: no hace ruido de una
  // ocurrencia que no va a sonar.
  const rule = parseStoredRule(ev.rrule);
  if (rule) {
    const last = lastOccurrenceAt(ev);
    if (last == null) return;
    const endsAt = last - ev.alertOffsetMin * 60_000;
    const baseLocal = toBaseLocal(new Date(fireAt));
    if (deriveNextFireAt(baseLocal, rule.repeat, now) > endsAt) return;
    const notice = buildNotice(
      {
        kind: "event",
        refId: ev.id,
        body: { title: ev.title, startsAt: ev.startsAt },
        baseLocal,
        repeat: rule.repeat,
        endsAt,
        now,
      },
      now,
    );
    await insertNoticeWithin(db, notice);
    return;
  }
  const notice = buildNotice(
    {
      kind: "event",
      refId: ev.id,
      body: { title: ev.title, startsAt: ev.startsAt },
      baseLocal: toBaseLocal(new Date(fireAt)),
      now,
    },
    now,
  );
  await insertNoticeWithin(db, notice);
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const now = input.now ?? Date.now();
  const ev: CalendarEvent = {
    id: randomUUID(),
    uid: input.uid ?? randomUUID(),
    title: input.title,
    notes: input.notes ?? "",
    location: input.location ?? "",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay ?? false,
    rrule: input.rrule ?? null,
    rruleUntil: input.rruleUntil ?? null,
    alertOffsetMin: input.alertOffsetMin ?? null,
    origin: input.origin ?? "chat",
    createdAt: now,
    updatedAt: now,
  };
  await writeTransaction(async (db) => {
    await db.runAsync(
      `INSERT INTO calendar_events (id, uid, title, notes, location,
         starts_at, ends_at, all_day, rrule, rrule_until,
         alert_offset_min, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ev.id,
        ev.uid,
        ev.title,
        ev.notes,
        ev.location,
        ev.startsAt,
        ev.endsAt,
        ev.allDay ? 1 : 0,
        ev.rrule,
        ev.rruleUntil,
        ev.alertOffsetMin,
        ev.origin,
        ev.createdAt,
        ev.updatedAt,
      ],
    );
    await armEventNoticeWithin(db, ev, now);
  });
  // El aviso entra en la agenda de disparo al escribir, como
  // los de la propia cola: sin esto solo lo reponía la
  // reconciliación y no disparaba a su hora en la sesión.
  await syncAgendaAfterWrite();
  return ev;
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CalendarEventRow>(
    "SELECT * FROM calendar_events WHERE id = ?",
    [id],
  );
  return row ? rowToEvent(row) : null;
}

export async function getEventByUid(uid: string): Promise<CalendarEvent | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CalendarEventRow>(
    "SELECT * FROM calendar_events WHERE uid = ?",
    [uid],
  );
  return row ? rowToEvent(row) : null;
}

/** Eventos cuyo inicio cae en [fromMs, toMs), en orden de inicio. */
export async function listEvents(fromMs: number, toMs: number): Promise<CalendarEvent[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarEventRow>(
    "SELECT * FROM calendar_events WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at ASC",
    [fromMs, toMs],
  );
  return rows.map(rowToEvent);
}

/** Todos los UID guardados (la clave de deduplicación al importar). */
export async function listAllUids(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ uid: string }>(
    "SELECT uid FROM calendar_events",
  );
  return rows.map((r) => r.uid);
}

export interface UpdateEventPatch {
  title?: string;
  notes?: string;
  location?: string;
  startsAt?: number;
  endsAt?: number;
  allDay?: boolean;
  rrule?: string | null;
  rruleUntil?: number | null;
  alertOffsetMin?: number | null;
}

/** Corrige un evento y rearma su aviso, en la misma operación. */
export async function updateEvent(
  id: string,
  patch: UpdateEventPatch,
  now = Date.now(),
): Promise<CalendarEvent | null> {
  const ev = await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<CalendarEventRow>(
      "SELECT * FROM calendar_events WHERE id = ?",
      [id],
    );
    if (!row) return null;
    const cur = rowToEvent(row);
    const ev: CalendarEvent = {
      ...cur,
      title: patch.title ?? cur.title,
      notes: patch.notes ?? cur.notes,
      location: patch.location ?? cur.location,
      startsAt: patch.startsAt ?? cur.startsAt,
      endsAt: patch.endsAt ?? cur.endsAt,
      allDay: patch.allDay ?? cur.allDay,
      rrule: patch.rrule !== undefined ? patch.rrule : cur.rrule,
      rruleUntil: patch.rruleUntil !== undefined ? patch.rruleUntil : cur.rruleUntil,
      alertOffsetMin:
        patch.alertOffsetMin !== undefined ? patch.alertOffsetMin : cur.alertOffsetMin,
      updatedAt: now,
    };
    await db.runAsync(
      `UPDATE calendar_events SET title = ?, notes = ?, location = ?,
         starts_at = ?, ends_at = ?, all_day = ?, rrule = ?,
         rrule_until = ?, alert_offset_min = ?, updated_at = ?
       WHERE id = ?`,
      [
        ev.title,
        ev.notes,
        ev.location,
        ev.startsAt,
        ev.endsAt,
        ev.allDay ? 1 : 0,
        ev.rrule,
        ev.rruleUntil,
        ev.alertOffsetMin,
        ev.updatedAt,
        ev.id,
      ],
    );
    await armEventNoticeWithin(db, ev, now);
    return ev;
  });
  if (ev) await syncAgendaAfterWrite();
  return ev;
}

/** Borra un evento y desarma su aviso, en la misma operación. */
export async function deleteEvent(id: string): Promise<boolean> {
  const deleted = await writeTransaction(async (db) => {
    const info = await db.runAsync("DELETE FROM calendar_events WHERE id = ?", [id]);
    await deleteNoticesByRefWithin(db, "event", id);
    return info.changes > 0;
  });
  if (deleted) await syncAgendaAfterWrite();
  return deleted;
}
