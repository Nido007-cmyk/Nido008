/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeStore.ts — la capa base de la cola de avisos de E7
 * (AVISOS-ETAPA §3.1; decisión 1 de E7-DECISIONES: es la ÚNICA
 * escritura de la cola).
 *
 * Los avisos son datos de la persona y viven en la base personal
 * cifrada de E2 (nido_memory.db, tabla `notices` del paso 1),
 * junto a las notas y los recordatorios. Calendario, contactos y
 * recordatorios materializan por aquí: nadie escribe SQL de
 * `notices` por su cuenta.
 *
 * La verdad de un aviso es `base_local` + `repeat` (la hora local
 * pedida, sin huso, como en el móvil); `next_fire_at` es el epoch
 * derivado e indexado, nunca al revés. La derivación reutiliza
 * `nextOccurrence` de reminderRepeat (la lógica pura copiada del
 * móvil con su batería: la repetición conserva la hora pedida
 * tras un cambio de horario de verano).
 *
 * Frontera de la etapa: esta es la capa base. E8 paso 2 añade
 * el espejo de la agenda de disparo (noticeAgenda.ts, §3.2 de
 * AVISOS) sincronizado tras cada escritura de esta capa y la
 * reconciliación entre las dos; el reloj de producción y el
 * despacho llegan en los pasos 3 y 4 de E8. El estado
 * `fired-pending` existe en el esquema; lo produce el reloj
 * cuando dispara con la bóveda bloqueada.
 */

import { randomUUID } from "node:crypto";
import {
  getDatabase,
  safeJsonParse,
  writeTransaction,
} from "../../security/databaseManager.js";
import {
  readNoticeAgenda,
  syncNoticeAgenda,
  wipeNoticeAgenda,
  type NoticeAgendaEntry,
} from "./noticeAgenda.js";
import { isReminderRepeat, nextOccurrence, type ReminderRepeat } from "./reminderRepeat.js";

export type NoticeKind = "reminder" | "timer" | "event" | "birthday" | "task";
export type NoticeState =
  | "armed"
  | "fired"
  | "fired-pending"
  | "snoozed"
  | "missed"
  | "done";
export type NoticeRepeat = ReminderRepeat;

export interface Notice {
  id: string;
  kind: NoticeKind;
  refId: string | null;
  /** El cuerpo del aviso (texto, persona, instrucción), ya parseado. */
  body: unknown;
  /** Fecha/hora local pedida, ISO sin huso: la verdad del aviso. */
  baseLocal: string;
  repeat: NoticeRepeat | null;
  /** Epoch ms de la próxima ocurrencia: derivado de baseLocal+repeat. */
  nextFireAt: number;
  endsAt: number | null;
  state: NoticeState;
  snoozeUntil: number | null;
  lastFiredAt: number | null;
  missedCount: number;
  sourceChat: string | null;
  createdAt: number;
}

interface NoticeRow {
  id: string;
  kind: string;
  ref_id: string | null;
  body_json: string;
  base_local: string;
  repeat: string | null;
  next_fire_at: number;
  ends_at: number | null;
  state: string;
  snooze_until: number | null;
  last_fired_at: number | null;
  missed_count: number;
  source_chat: string | null;
  created_at: number;
}

function rowToNotice(r: NoticeRow): Notice {
  return {
    id: r.id,
    kind: r.kind as NoticeKind,
    refId: r.ref_id,
    body: safeJsonParse<unknown>(r.body_json, null),
    baseLocal: r.base_local,
    repeat: isReminderRepeat(r.repeat) ? r.repeat : null,
    nextFireAt: r.next_fire_at,
    endsAt: r.ends_at,
    state: r.state as NoticeState,
    snoozeUntil: r.snooze_until,
    lastFiredAt: r.last_fired_at,
    missedCount: r.missed_count,
    sourceChat: r.source_chat,
    createdAt: r.created_at,
  };
}

/**
 * Parsea `base_local` (ISO sin huso) como hora local de pared.
 * Se construye por componentes: `new Date("2027-01-15")` sería
 * UTC medianoche y correría la hora pedida en husos negativos.
 */
export function parseBaseLocal(baseLocal: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    baseLocal.trim(),
  );
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Deriva `next_fire_at` de la verdad (base_local + repeat): sin
 * repetición, el instante pedido; con repetición, la primera
 * ocurrencia de la serie a partir de `now` (la serie se extiende
 * en los dos sentidos desde la base, como en el móvil).
 */
export function deriveNextFireAt(
  baseLocal: string,
  repeat: NoticeRepeat | null,
  now: number,
): number {
  const base = parseBaseLocal(baseLocal);
  if (!base) {
    throw new Error(`noticeStore: base_local no parseable: ${baseLocal}`);
  }
  if (!repeat) return base.getTime();
  return nextOccurrence(base, repeat, new Date(now - 1)).getTime();
}

/** La hora local de pared de un instante, en la forma de base_local. */
export function toBaseLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * Subconjunto estructural del handle de la base que las
 * primitivas dentro-de-transacción necesitan (el mismo que
 * databaseManager pasa a writeTransaction).
 */
export interface NoticeDb {
  runAsync(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Construye la fila de un aviso (sin tocar disco). */
export function buildNotice(input: ArmNoticeInput, now: number): Notice {
  const repeat = isReminderRepeat(input.repeat) ? input.repeat : null;
  return {
    id: randomUUID(),
    kind: input.kind,
    refId: input.refId ?? null,
    body: input.body ?? null,
    baseLocal: input.baseLocal,
    repeat,
    nextFireAt: deriveNextFireAt(input.baseLocal, repeat, now),
    endsAt: input.endsAt ?? null,
    state: "armed",
    snoozeUntil: null,
    lastFiredAt: null,
    missedCount: 0,
    sourceChat: input.sourceChat ?? null,
    createdAt: now,
  };
}

/**
 * Inserta un aviso DENTRO de la transacción del llamante: la vía
 * sancionada para que un almacén dueño (calendario, contactos)
 * materialice el aviso en la misma operación que su fila. El SQL
 * de la cola vive solo aquí (decisión 1 de E7-DECISIONES).
 */
export async function insertNoticeWithin(
  db: NoticeDb,
  notice: Notice,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO notices (id, kind, ref_id, body_json, base_local, repeat,
       next_fire_at, ends_at, state, snooze_until, last_fired_at,
       missed_count, source_chat, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notice.id,
      notice.kind,
      notice.refId,
      JSON.stringify(notice.body),
      notice.baseLocal,
      notice.repeat,
      notice.nextFireAt,
      notice.endsAt,
      notice.state,
      notice.snoozeUntil,
      notice.lastFiredAt,
      notice.missedCount,
      notice.sourceChat,
      notice.createdAt,
    ],
  );
}

/** La mitad dentro-de-transacción de disarmByRef. */
export async function deleteNoticesByRefWithin(
  db: NoticeDb,
  kind: NoticeKind,
  refId: string,
): Promise<number> {
  const info = await db.runAsync(
    "DELETE FROM notices WHERE kind = ? AND ref_id = ?",
    [kind, refId],
  );
  return info.changes;
}

/**
 * E8 (paso 2): el gancho del tiempo de ejecución. Tras cada
 * escritura de la cola y su sincronización con la agenda, la
 * carcasa registrada aquí recibe un aviso sin argumentos (el
 * reloj de producción rearma desde la agenda; el disparo de
 * tareas revisa). Sin registrar, no hay reloj: la conducta de
 * E7. La desregistra quien la registró, al cerrar.
 */
let runtimePoke: (() => void) | null = null;

export function setNoticeRuntimePoke(fn: (() => void) | null): void {
  runtimePoke = fn;
}

function pokeRuntime(): void {
  try {
    runtimePoke?.();
  } catch {
    // El gancho es de la carcasa: su fallo no es de la cola.
  }
}

/**
 * El espejo de la agenda tras una escritura propia: los
 * armados de la base, en la forma mínima de la capa 2, y el
 * aviso al tiempo de ejecución. Nunca lanza (la agenda es
 * derivada; su divergencia la repone la reconciliación).
 *
 * Las materializaciones de los almacenes dueños (calendario y
 * contactos, por insertNoticeWithin dentro de su transacción)
 * no pasan por aquí: las cubre la reconciliación, que el
 * tiempo de ejecución corre al arrancar, al desbloquear y
 * antes de cada armado del reloj (T-9 es su puerta).
 */
/**
 * Las entradas de la agenda para un conjunto programado: el
 * espejo de cada fila y, por cada cumpleaños con previo, su
 * ocurrencia derivada (paso 7). Una sola construcción para la
 * sincronización y la reconciliación: si difirieran, la
 * reconciliación borraría el derivado en cada despertar.
 */
export function buildAgendaEntries(
  scheduled: Notice[],
  preFiredFor: Record<string, number>,
): NoticeAgendaEntry[] {
  const entries: NoticeAgendaEntry[] = scheduled.map((n) => ({
    id: n.id,
    kind: n.kind,
    nextFireAt: n.nextFireAt,
  }));
  for (const n of scheduled) {
    if (n.kind !== "birthday") continue;
    if ((n.body as { pre?: unknown })?.pre !== true) continue;
    if (preFiredFor[n.id] === n.nextFireAt) continue;
    // La víspera de la ocurrencia vigente, a las 20:00 de
    // pared: se deriva del próximo disparo, no de un instante
    // guardado, para que avance con la serie.
    const pre = new Date(n.nextFireAt);
    pre.setDate(pre.getDate() - 1);
    pre.setHours(20, 0, 0, 0);
    entries.push({ id: n.id, kind: n.kind, nextFireAt: pre.getTime(), pre: true });
  }
  entries.sort((a, b) => a.nextFireAt - b.nextFireAt);
  return entries;
}

/**
 * El espejo tras una escritura: reconstruye la agenda desde
 * la base y avisa al reloj. Lo llaman las escrituras de la
 * propia cola (armNotice y familia) y las materializaciones
 * de dueño de E7 (eventos y cumpleaños), que insertan su
 * aviso dentro de su transacción: sin esta llamada su aviso
 * quedaba en la base pero fuera de la agenda, y el reloj no
 * lo disparaba a su hora en la sesión (lo cazó T-22: el
 * evento creado en sesión nunca entró en la agenda).
 */
export async function syncAgendaAfterWrite(): Promise<void> {
  try {
    const scheduled = await listScheduled();
    const agenda = await readNoticeAgenda();
    await syncNoticeAgenda(buildAgendaEntries(scheduled, agenda.preFiredFor));
  } catch {
    // La base quedó escrita; la agenda se reconcilia después.
  }
  pokeRuntime();
}

/**
 * La reconciliación base/agenda de AVISOS §3.2 (puerta T-9):
 * la agenda queda exactamente como el conjunto de armados de
 * la base. Un aviso sin entrada se repone, una entrada huérfana
 * se borra y un instante derivado que difiere se corrige; el
 * informe dice los tres movimientos por id.
 */
export async function reconcileNoticeAgenda(): Promise<{
  added: string[];
  removed: string[];
  corrected: string[];
}> {
  const armed = await listScheduled();
  const agenda = await readNoticeAgenda();
  const byId = new Map(armed.map((n) => [n.id, n]));
  // Las entradas derivadas (`pre`) no se juzgan contra la
  // base: su verdad es la regla de derivación, y la
  // reescritura las reconstruye con buildAgendaEntries.
  const plain = agenda.entries.filter((e) => !e.pre);
  const inAgenda = new Set(plain.map((e) => e.id));
  const added = armed.filter((n) => !inAgenda.has(n.id)).map((n) => n.id);
  const removed = plain.filter((e) => !byId.has(e.id)).map((e) => e.id);
  const corrected = plain
    .filter((e) => byId.has(e.id) && byId.get(e.id)!.nextFireAt !== e.nextFireAt)
    .map((e) => e.id);
  if (added.length > 0 || removed.length > 0 || corrected.length > 0) {
    await syncNoticeAgenda(buildAgendaEntries(armed, agenda.preFiredFor));
    pokeRuntime();
  }
  return { added, removed, corrected };
}

/**
 * La pierna de avisos del borrado total (T-19): ninguna fila
 * de la cola y ningún fichero de agenda. El gancho que la
 * futura superficie de borrado total debe llamar; el paso 6
 * le suma el fichero de arranque y el residente.
 */
export async function wipeNoticeData(): Promise<void> {
  await writeTransaction(async (db) => {
    await db.runAsync("DELETE FROM notices");
  });
  await wipeNoticeAgenda();
  pokeRuntime();
}

export interface ArmNoticeInput {
  kind: NoticeKind;
  refId?: string | null;
  body: unknown;
  baseLocal: string;
  repeat?: NoticeRepeat | null;
  endsAt?: number | null;
  sourceChat?: string | null;
  /** Reloj inyectable (la pasada del ejecutor lo fija; defecto: ahora). */
  now?: number;
}

/**
 * Arma un aviso: inserta la fila entera en la cola, con su
 * `next_fire_at` derivado, en una sola transacción de la cola
 * única de escrituras de la base.
 */
export async function armNotice(input: ArmNoticeInput): Promise<Notice> {
  const now = input.now ?? Date.now();
  const notice = buildNotice(input, now);
  await writeTransaction(async (db) => {
    await insertNoticeWithin(db, notice);
  });
  await syncAgendaAfterWrite();
  return notice;
}

export async function getNotice(id: string): Promise<Notice | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NoticeRow>(
    "SELECT * FROM notices WHERE id = ?",
    [id],
  );
  return row ? rowToNotice(row) : null;
}

/** Los avisos armados, en orden de disparo. */
export async function listArmed(): Promise<Notice[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NoticeRow>(
    "SELECT * FROM notices WHERE state = 'armed' ORDER BY next_fire_at ASC",
  );
  return rows.map(rowToNotice);
}

/**
 * Los perdidos a `now`: armados cuyo instante ya pasó y nadie
 * disparó. Se devuelven como lista, sin fingir ningún disparo
 * (la pasada de recuperación que los reconcilia es de E8).
 */
export async function listMissed(now: number): Promise<Notice[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NoticeRow>(
    "SELECT * FROM notices WHERE state = 'armed' AND next_fire_at <= ? ORDER BY next_fire_at ASC",
    [now],
  );
  return rows.map(rowToNotice);
}

/** Desarma borrando la fila, en la misma operación. */
export async function disarmNotice(id: string): Promise<boolean> {
  const removed = await writeTransaction(async (db) => {
    const info = await db.runAsync("DELETE FROM notices WHERE id = ?", [id]);
    return info.changes > 0;
  });
  if (removed) await syncAgendaAfterWrite();
  return removed;
}

/**
 * Desarma todos los avisos de una fila dueña (el evento que se
 * borra, la ficha que se borra): el borrado del dueño y el
 * desarme van en la misma operación que pida el llamante.
 */
export async function disarmByRef(
  kind: NoticeKind,
  refId: string,
): Promise<number> {
  const removed = await writeTransaction(async (db) =>
    deleteNoticesByRefWithin(db, kind, refId),
  );
  if (removed > 0) await syncAgendaAfterWrite();
  return removed;
}

/**
 * Desarma el aviso de un recordatorio (kind `reminder`): su
 * `ref_id` es NULL por la forma de AVISOS §3.1 (el aviso es el
 * propio objeto), así que el desarme casa por su verdad: el
 * texto del cuerpo y su `base_local`.
 */
export async function disarmReminder(
  text: string,
  baseLocal: string,
): Promise<number> {
  const removed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "DELETE FROM notices WHERE kind = 'reminder' AND base_local = ? AND json_extract(body_json, '$.text') = ?",
      [baseLocal, text],
    );
    return info.changes;
  });
  if (removed > 0) await syncAgendaAfterWrite();
  return removed;
}

/**
 * E8 (pasos 2 a 4): el enlace entre el recordatorio de la vía
 * rápida (que vive en el almacén en memoria con su id propio)
 * y su aviso en la cola. La sustitución de la costura S-1 arma
 * el aviso estampando `body.reminderId`; si el aviso ya existía
 * sin enlace (lo armó el handler de herramientas para el mismo
 * recordatorio), se le estampa aquí en vez de duplicarlo.
 */
export async function stampReminderLink(
  noticeId: string,
  reminderId: string,
): Promise<void> {
  await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<NoticeRow>(
      "SELECT * FROM notices WHERE id = ?",
      [noticeId],
    );
    if (!row) return;
    const body = (safeJsonParse<Record<string, unknown>>(row.body_json, {}) ??
      {}) as Record<string, unknown>;
    body.reminderId = reminderId;
    await db.runAsync("UPDATE notices SET body_json = ? WHERE id = ?", [
      JSON.stringify(body),
      noticeId,
    ]);
  });
}

/** Desarma los avisos de recordatorio enlazados a un id de la vía rápida. */
export async function disarmReminderByLink(reminderId: string): Promise<number> {
  const removed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "DELETE FROM notices WHERE kind = 'reminder' AND json_extract(body_json, '$.reminderId') = ?",
      [reminderId],
    );
    return info.changes;
  });
  if (removed > 0) await syncAgendaAfterWrite();
  return removed;
}

/** Desarma el aviso de temporizador enlazado a un id de la vía rápida. */
export async function disarmTimerByLink(timerId: string): Promise<number> {
  const removed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "DELETE FROM notices WHERE kind = 'timer' AND json_extract(body_json, '$.timerId') = ?",
      [timerId],
    );
    return info.changes;
  });
  if (removed > 0) await syncAgendaAfterWrite();
  return removed;
}

/**
 * E8 (paso 5): pausar un temporizador (§6). El fin absoluto se
 * retira y el restante queda en el cuerpo: la fila pasa a
 * `snoozed` sin `snooze_until` (no es una posposición: no
 * volverá a sonar sola) y sale de la agenda. Pausar un
 * temporizador vencido no existe: si su fin ya pasó o ya
 * disparó, devuelve null sin tocarlo (T-15).
 */
export async function pauseTimer(id: string, now: number): Promise<Notice | null> {
  const row = await getNotice(id);
  if (!row || row.kind !== "timer" || row.state !== "armed") return null;
  if (row.endsAt === null || row.endsAt <= now) return null;
  const remainingMs = row.endsAt - now;
  const changed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "UPDATE notices SET state = 'snoozed', ends_at = NULL, next_fire_at = ?, snooze_until = NULL, body_json = ? WHERE id = ?",
      [
        Number.MAX_SAFE_INTEGER,
        JSON.stringify(bodyWithCount(row.body, { remainingMs })),
        id,
      ],
    );
    return info.changes > 0;
  });
  if (!changed) return null;
  await syncAgendaAfterWrite();
  return getNotice(id);
}

/**
 * E8 (paso 5): reanudar un temporizador en pausa: fija un fin
 * nuevo (ahora + el restante guardado) y la fila vuelve a
 * `armed` y a la agenda. El restante sale del cuerpo.
 */
export async function resumeTimer(id: string, now: number): Promise<Notice | null> {
  const row = await getNotice(id);
  if (!row || row.kind !== "timer" || row.state !== "snoozed") return null;
  const remaining = (row.body as { remainingMs?: unknown })?.remainingMs;
  if (typeof remaining !== "number" || remaining <= 0) return null;
  const endsAt = now + remaining;
  const body = bodyWithCount(row.body, {});
  delete (body as { remainingMs?: unknown }).remainingMs;
  const changed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "UPDATE notices SET state = 'armed', ends_at = ?, next_fire_at = ?, base_local = ?, body_json = ? WHERE id = ?",
      [endsAt, endsAt, toBaseLocal(new Date(endsAt)), JSON.stringify(body), id],
    );
    return info.changes > 0;
  });
  if (!changed) return null;
  await syncAgendaAfterWrite();
  return getNotice(id);
}

/**
 * La transacción de repetición: tras un disparo en `firedAt`,
 * avanzar y marcar en la MISMA operación. Con repetición, la
 * fila queda armada con el siguiente `next_fire_at` derivado de
 * la verdad (base_local + repeat) y `last_fired_at` marcado;
 * sin repetición, la fila queda `fired`. Matar el proceso entre
 * el disparo y el rearme no pierde el siguiente ni duplica el
 * actual: o la transacción entera se aplica, o no se aplica.
 */
export async function advanceAfterFire(
  id: string,
  firedAt: number,
): Promise<Notice | null> {
  const after = await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<NoticeRow>(
      "SELECT * FROM notices WHERE id = ?",
      [id],
    );
    if (!row || (row.state !== "armed" && row.state !== "snoozed")) return null;
    const repeat = isReminderRepeat(row.repeat) ? row.repeat : null;
    if (repeat) {
      const base = parseBaseLocal(row.base_local);
      if (!base) return null;
      const next = nextOccurrence(base, repeat, new Date(firedAt)).getTime();
      await db.runAsync(
        "UPDATE notices SET next_fire_at = ?, last_fired_at = ? WHERE id = ?",
        [next, firedAt, id],
      );
      return rowToNotice({ ...row, next_fire_at: next, last_fired_at: firedAt });
    }
    await db.runAsync(
      "UPDATE notices SET state = 'fired', last_fired_at = ? WHERE id = ?",
      [firedAt, id],
    );
    return rowToNotice({ ...row, state: "fired", last_fired_at: firedAt });
  });
  if (after) await syncAgendaAfterWrite();
  return after;
}

/**
 * La pasada del ejecutor (el suelo del paso 5 de E7): con el
 * reloj inyectado en `nowMs` y el sumidero de despacho
 * inyectado, entrega cada aviso armado cuyo instante ya llegó
 * (en orden de instante) y aplica su transición en la misma
 * operación (advanceAfterFire: los de repetición avanzan y
 * quedan armados; los únicos quedan fired). Si el sumidero
 * falla con un aviso, ese aviso NO se transiciona (sigue
 * armado para la próxima pasada) y el fallo se devuelve con
 * su causa; la pasada sigue con el resto.
 *
 * Esto es la semántica, no el reloj: quién llama a la pasada
 * y con qué sumidero real (el reloj de producción, el
 * despacho al SO y la pasada extendida) es de E8.
 */
export async function runNoticePass(
  nowMs: number,
  sink: (notice: Notice) => Promise<void> | void,
): Promise<{ fired: Notice[]; failed: Array<{ notice: Notice; error: string }> }> {
  const due = await listMissed(nowMs);
  const fired: Notice[] = [];
  const failed: Array<{ notice: Notice; error: string }> = [];
  for (const notice of due) {
    try {
      await sink(notice);
    } catch (e) {
      failed.push({
        notice,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const after = await advanceAfterFire(notice.id, notice.nextFireAt);
    if (after) fired.push(after);
  }
  return { fired, failed };
}

/**
 * E8 (paso 3): marca un aviso único vencido como `missed`: la
 * fila queda en la lista de Avisos como perdida hasta que la
 * persona la descarta o la reprograma (§4.3.2). Solo si sigue
 * armado; si otro camino ya lo transicionó, no lo toca.
 */
export async function markMissed(id: string): Promise<boolean> {
  const changed = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "UPDATE notices SET state = 'missed' WHERE id = ? AND state IN ('armed', 'snoozed')",
      [id],
    );
    return info.changes > 0;
  });
  if (changed) await syncAgendaAfterWrite();
  return changed;
}

/**
 * E8 (paso 3): el avance de una serie vencida en la pasada de
 * recuperación (§4.3.3). Cuenta las ocurrencias debidas desde
 * el `next_fire_at` guardado hasta `nowMs`, deja la serie
 * armada en la siguiente estrictamente futura y anota en
 * `missed_count` las saltadas más allá de la presentada (la
 * más reciente). Devuelve la ocurrencia presentada y el
 * conteo, o null si la fila no es una serie armada o aún no
 * debe nada.
 */
export async function advanceSeriesAfterMiss(
  id: string,
  nowMs: number,
): Promise<{ presentedAt: number; skipped: number; nextFireAt: number } | null> {
  const result = await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<NoticeRow>(
      "SELECT * FROM notices WHERE id = ?",
      [id],
    );
    if (!row || row.state !== "armed") return null;
    const repeat = isReminderRepeat(row.repeat) ? row.repeat : null;
    if (!repeat) return null;
    const base = parseBaseLocal(row.base_local);
    if (!base) return null;
    let cursor = row.next_fire_at;
    if (cursor > nowMs) return null;
    let count = 0;
    let latest = cursor;
    while (cursor <= nowMs && count < 10000) {
      count++;
      latest = cursor;
      cursor = nextOccurrence(base, repeat, new Date(cursor)).getTime();
    }
    const skipped = count - 1;
    await db.runAsync(
      "UPDATE notices SET next_fire_at = ?, missed_count = missed_count + ? WHERE id = ?",
      [cursor, skipped, id],
    );
    return { presentedAt: latest, skipped, nextFireAt: cursor };
  });
  if (result) await syncAgendaAfterWrite();
  return result;
}

/**
 * E8 (paso 3): la fila de presentación de una ocurrencia de
 * una serie: una copia de una sola vez, ya en su estado final
 * (`missed` en la recuperación; `fired` la usará el despacho),
 * con el cuerpo de la serie más su `seriesId`, para que la
 * vista de Avisos la enseñe como la ocurrencia que fue sin
 * tocar la serie, que sigue su ritmo. No se arma: nunca entra
 * en la agenda.
 */
export async function recordPresentation(
  source: Notice,
  occurrenceAt: number,
  state: "missed" | "fired",
  now: number,
): Promise<Notice> {
  const baseBody =
    source.body && typeof source.body === "object"
      ? (source.body as Record<string, unknown>)
      : { value: source.body };
  const presentation: Notice = {
    id: randomUUID(),
    kind: source.kind,
    refId: source.refId,
    body: { ...baseBody, seriesId: source.id },
    baseLocal: toBaseLocal(new Date(occurrenceAt)),
    repeat: null,
    nextFireAt: occurrenceAt,
    endsAt: null,
    state,
    snoozeUntil: null,
    lastFiredAt: state === "fired" ? occurrenceAt : null,
    missedCount: 0,
    sourceChat: source.sourceChat,
    createdAt: now,
  };
  await writeTransaction(async (db) => {
    await insertNoticeWithin(db, presentation);
  });
  return presentation;
}

/**
 * E8: lo que tiene un disparo futuro en la agenda: los armados
 * y los pospuestos (un pospuesto vuelve a sonar a su hora). Es
 * el conjunto que la agenda de disparo espeja.
 */
export async function listScheduled(): Promise<Notice[]> {
  const db = await getDatabase();
  // Un temporizador en pausa vive en `snoozed` sin
  // `snooze_until`: no tiene disparo y no entra en la agenda.
  const rows = await db.getAllAsync<NoticeRow>(
    "SELECT * FROM notices WHERE state = 'armed' OR (state = 'snoozed' AND snooze_until IS NOT NULL) ORDER BY next_fire_at ASC",
  );
  return rows.map(rowToNotice);
}

/** Los pospuestos cuyo momento ya llegó: debidos como un armado. */
export async function listSnoozedDue(now: number): Promise<Notice[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NoticeRow>(
    "SELECT * FROM notices WHERE state = 'snoozed' AND snooze_until <= ? ORDER BY snooze_until ASC",
    [now],
  );
  return rows.map(rowToNotice);
}

/**
 * La lista de la vista de Avisos: todo lo que no está cerrado
 * (`done`), en orden de disparo. La vista decide la
 * presentación por estado; aquí solo sale la verdad guardada.
 */
/** Los días que un cumpleaños pasado se enseña como reciente (§7). */
export const BIRTHDAY_RECENT_VIEW_MS = 7 * 24 * 3600 * 1000;

export async function listNoticeView(now: number = Date.now()): Promise<Notice[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NoticeRow>(
    "SELECT * FROM notices WHERE state != 'done' ORDER BY next_fire_at ASC",
  );
  // E8 (paso 7): el cumpleaños presentado hace más de 7 días
  // se archiva solo: sale de la vista (la fila queda en la
  // base como historia y la serie sigue armada para el año
  // siguiente). Las demás familias no se archivan por edad.
  return rows
    .map(rowToNotice)
    .filter(
      (n) =>
        !(
          n.kind === "birthday" &&
          (n.state === "missed" || n.state === "fired") &&
          now - n.nextFireAt > BIRTHDAY_RECENT_VIEW_MS
        ),
    );
}

/**
 * E8 (paso 4): la acción «Hecho» (y el descarte de un
 * temporizador): la fila queda `done` y sale de la agenda. Una
 * serie armada no se cierra desde aquí (su «Hecho» es el de su
 * fila de presentación): devuelve false sin tocarla.
 */
export async function markDone(id: string): Promise<boolean> {
  const changed = await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<NoticeRow>(
      "SELECT * FROM notices WHERE id = ?",
      [id],
    );
    if (!row || row.state === "done") return false;
    if (row.state === "armed" && row.repeat) return false;
    const info = await db.runAsync(
      "UPDATE notices SET state = 'done' WHERE id = ?",
      [id],
    );
    return info.changes > 0;
  });
  if (changed) await syncAgendaAfterWrite();
  return changed;
}

function bodyWithCount(body: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base =
    body && typeof body === "object" ? (body as Record<string, unknown>) : { value: body };
  return { ...base, ...patch };
}

/**
 * E8 (paso 4): posponer (§5.2). Sobre una serie armada crea la
 * ocurrencia derivada de una sola vez a la hora pedida y NO
 * toca la serie (T-12); sobre cualquier otra fila (la de
 * presentación, un único disparado o perdido, un temporizador
 * vencido no: un temporizador no se pospone) mueve la propia
 * fila a `snoozed` hasta la hora pedida. El cuerpo anota
 * `snoozeCount`, que la tarjeta enseña, y `snoozedFrom` en la
 * derivada. Devuelve la fila que sonará, o null si la fila no
 * admite posposición (cerrada o temporizador).
 */
export async function snoozeNotice(
  id: string,
  targetMs: number,
  now: number,
): Promise<Notice | null> {
  const source = await getNotice(id);
  if (!source || source.state === "done" || source.kind === "timer") return null;
  const count =
    (typeof (source.body as { snoozeCount?: unknown })?.snoozeCount === "number"
      ? ((source.body as { snoozeCount: number }).snoozeCount as number)
      : 0) + 1;
  if (source.repeat && source.state === "armed") {
    const derived: Notice = {
      id: randomUUID(),
      kind: source.kind,
      refId: source.refId,
      body: bodyWithCount(source.body, { snoozedFrom: source.id, snoozeCount: count }),
      baseLocal: toBaseLocal(new Date(targetMs)),
      repeat: null,
      nextFireAt: targetMs,
      endsAt: null,
      state: "armed",
      snoozeUntil: null,
      lastFiredAt: null,
      missedCount: 0,
      sourceChat: source.sourceChat,
      createdAt: now,
    };
    await writeTransaction(async (db) => {
      await insertNoticeWithin(db, derived);
    });
    await syncAgendaAfterWrite();
    return derived;
  }
  const moved = await writeTransaction(async (db) => {
    const info = await db.runAsync(
      "UPDATE notices SET state = 'snoozed', base_local = ?, next_fire_at = ?, snooze_until = ?, body_json = ? WHERE id = ?",
      [
        toBaseLocal(new Date(targetMs)),
        targetMs,
        targetMs,
        JSON.stringify(bodyWithCount(source.body, { snoozeCount: count })),
        id,
      ],
    );
    return info.changes > 0;
  });
  if (!moved) return null;
  await syncAgendaAfterWrite();
  return getNotice(id);
}

/**
 * E8 (paso 4): reprogramar un aviso único perdido o disparado:
 * vuelve a `armed` con la nueva hora pedida como su verdad.
 * Una serie no se reprograma desde aquí (su ritmo es su
 * verdad): devuelve false sin tocarla.
 */
export async function rescheduleNotice(
  id: string,
  baseLocal: string,
  now: number,
): Promise<boolean> {
  const changed = await writeTransaction(async (db) => {
    const row = await db.getFirstAsync<NoticeRow>(
      "SELECT * FROM notices WHERE id = ?",
      [id],
    );
    if (!row || row.repeat || row.state === "done") return false;
    const next = deriveNextFireAt(baseLocal, null, now);
    const info = await db.runAsync(
      "UPDATE notices SET state = 'armed', base_local = ?, next_fire_at = ?, snooze_until = NULL WHERE id = ?",
      [baseLocal, next, id],
    );
    return info.changes > 0;
  });
  if (changed) await syncAgendaAfterWrite();
  return changed;
}
