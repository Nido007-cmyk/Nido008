/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contactStore.ts — la agenda de contactos de NIDO PC (paso 4
 * de E7; AGENDA-PC §4.1): las fichas viven en la tabla
 * `contacts` de la base personal cifrada, nunca en una agenda
 * del sistema. Es la única escritura de las fichas, como
 * noticeStore lo es de la cola.
 *
 * El aviso del cumpleaños se materializa en la cola al crear
 * o corregir la ficha (kind `birthday`, `ref_id` a la ficha,
 * repetición anual, con los días de antelación de la ficha) y
 * se desarma al borrarla, todo en la misma transacción que la
 * fila: la ficha y su aviso nunca divergen.
 *
 * La búsqueda recrea la pieza pura del móvil (`filterContacts`
 * de contactSearch.ts: sin acentos, por nombre o por número,
 * tope 5, nunca la agenda entera) contra las fichas.
 */

import { randomUUID } from "node:crypto";
import { getDatabase } from "../../security/databaseManager.js";
import {
  buildNotice,
  deleteNoticesByRefWithin,
  insertNoticeWithin,
  syncAgendaAfterWrite,
  toBaseLocal,
  type NoticeDb,
} from "./noticeStore.js";
import {
  filterContacts,
  normalizeForContactSearch,
} from "../tools/contactSearch.js";
import type { ContactMatch } from "../loop/contactRouter.js";

export interface ContactPhone {
  label: string;
  number: string;
}

export interface ContactEmail {
  label: string;
  address: string;
}

export interface Contact {
  id: string;
  name: string;
  relation: string;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  birthdayYear: number | null;
  phones: ContactPhone[];
  emails: ContactEmail[];
  notes: string;
  /** Días de antelación del aviso de cumpleaños (0 = el mismo día). */
  alertLeadDays: number;
  origin: "chat" | "ui" | "vcf";
  createdAt: number;
  updatedAt: number;
}

export interface ContactInput {
  name: string;
  relation?: string;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  birthdayYear?: number | null;
  phones?: ContactPhone[];
  emails?: ContactEmail[];
  notes?: string;
  alertLeadDays?: number;
  origin?: Contact["origin"];
}

interface ContactRow {
  id: string;
  name: string;
  relation: string;
  birthday_month: number | null;
  birthday_day: number | null;
  birthday_year: number | null;
  phones: string;
  emails: string;
  notes: string;
  alert_lead_days: number;
  origin: string;
  created_at: number;
  updated_at: number;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    name: r.name,
    relation: r.relation,
    birthdayMonth: r.birthday_month,
    birthdayDay: r.birthday_day,
    birthdayYear: r.birthday_year,
    phones: parseJsonArray<ContactPhone>(r.phones),
    emails: parseJsonArray<ContactEmail>(r.emails),
    notes: r.notes,
    alertLeadDays: r.alert_lead_days,
    origin: (r.origin as Contact["origin"]) ?? "chat",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * La fecha local del próximo aviso de cumpleaños: el día y el
 * mes de la ficha, a las 09:00, adelantado por los días de
 * antelación; si esa fecha ya pasó, la del año siguiente.
 */
export function nextBirthdayBase(
  month: number,
  day: number,
  leadDays: number,
  now: Date = new Date(),
): Date {
  const at = (year: number) => {
    const d = new Date(year, month - 1, day, 9, 0, 0, 0);
    d.setDate(d.getDate() - leadDays);
    return d;
  };
  const thisYear = at(now.getFullYear());
  return thisYear.getTime() > now.getTime() ? thisYear : at(now.getFullYear() + 1);
}

/** Arma o rearma el aviso anual de la ficha, dentro de la transacción dada. */
async function armBirthdayWithin(
  db: NoticeDb,
  contact: Contact,
  now: Date,
): Promise<void> {
  await deleteNoticesByRefWithin(db, "birthday", contact.id);
  if (contact.birthdayMonth == null || contact.birthdayDay == null) return;
  const base = nextBirthdayBase(
    contact.birthdayMonth,
    contact.birthdayDay,
    contact.alertLeadDays,
    now,
  );
  // E8 (paso 7, §7): el cuerpo lleva el año de nacimiento si
  // la ficha lo guarda (la edad del aviso se calcula por
  // fechas al presentarlo; sin año no se inventa) y, cuando
  // el aviso principal cae el propio día (sin antelación), la
  // marca del previo derivado: la víspera a las 20:00, que la
  // agenda deriva de la ocurrencia vigente en cada
  // sincronización (un instante guardado envejecería al
  // avanzar la serie). Con antelación, el aviso de la persona
  // ya es su preparación y no hay previo (caería después del
  // principal).
  const body: Record<string, unknown> = { text: contact.name };
  if (contact.birthdayYear != null) body.birthdayYear = contact.birthdayYear;
  if (contact.alertLeadDays === 0) body.pre = true;
  const notice = buildNotice(
    {
      kind: "birthday",
      refId: contact.id,
      body,
      baseLocal: toBaseLocal(base),
      repeat: "year",
    },
    now.getTime(),
  );
  await insertNoticeWithin(db, notice);
}

export async function createContact(
  input: ContactInput,
  now: Date = new Date(),
): Promise<Contact> {
  const db = await getDatabase();
  const contact: Contact = {
    id: randomUUID(),
    name: input.name,
    relation: input.relation ?? "",
    birthdayMonth: input.birthdayMonth ?? null,
    birthdayDay: input.birthdayDay ?? null,
    birthdayYear: input.birthdayYear ?? null,
    phones: input.phones ?? [],
    emails: input.emails ?? [],
    notes: input.notes ?? "",
    alertLeadDays: input.alertLeadDays ?? 0,
    origin: input.origin ?? "chat",
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO contacts (id, name, relation, birthday_month, birthday_day,
         birthday_year, phones, emails, notes, alert_lead_days, origin,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contact.id,
        contact.name,
        contact.relation,
        contact.birthdayMonth,
        contact.birthdayDay,
        contact.birthdayYear,
        JSON.stringify(contact.phones),
        JSON.stringify(contact.emails),
        contact.notes,
        contact.alertLeadDays,
        contact.origin,
        contact.createdAt,
        contact.updatedAt,
      ],
    );
    await armBirthdayWithin(db, contact, now);
  });
  // El aviso entra en la agenda de disparo al escribir, como
  // los de la propia cola (la misma cura que en eventos).
  await syncAgendaAfterWrite();
  return contact;
}

export async function getContact(id: string): Promise<Contact | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ContactRow>(
    "SELECT * FROM contacts WHERE id = ?",
    [id],
  );
  return row ? rowToContact(row) : null;
}

export async function listContacts(): Promise<Contact[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ContactRow>(
    "SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC",
  );
  return rows.map(rowToContact);
}

/** La ficha con ese nombre normalizado (la clave de deduplicación al guardar). */
export async function findContactByName(name: string): Promise<Contact | null> {
  const target = normalizeForContactSearch(name);
  if (!target) return null;
  const all = await listContacts();
  return all.find((c) => normalizeForContactSearch(c.name) === target) ?? null;
}

export async function updateContact(
  id: string,
  patch: Partial<ContactInput>,
  now: Date = new Date(),
): Promise<Contact | null> {
  const db = await getDatabase();
  const current = await getContact(id);
  if (!current) return null;
  const next: Contact = {
    ...current,
    name: patch.name ?? current.name,
    relation: patch.relation ?? current.relation,
    birthdayMonth: patch.birthdayMonth !== undefined ? patch.birthdayMonth : current.birthdayMonth,
    birthdayDay: patch.birthdayDay !== undefined ? patch.birthdayDay : current.birthdayDay,
    birthdayYear: patch.birthdayYear !== undefined ? patch.birthdayYear : current.birthdayYear,
    phones: patch.phones ?? current.phones,
    emails: patch.emails ?? current.emails,
    notes: patch.notes ?? current.notes,
    alertLeadDays: patch.alertLeadDays ?? current.alertLeadDays,
    updatedAt: now.getTime(),
  };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE contacts SET name = ?, relation = ?, birthday_month = ?,
         birthday_day = ?, birthday_year = ?, phones = ?, emails = ?,
         notes = ?, alert_lead_days = ?, updated_at = ? WHERE id = ?`,
      [
        next.name,
        next.relation,
        next.birthdayMonth,
        next.birthdayDay,
        next.birthdayYear,
        JSON.stringify(next.phones),
        JSON.stringify(next.emails),
        next.notes,
        next.alertLeadDays,
        next.updatedAt,
        id,
      ],
    );
    // Corregir reemplaza el aviso: desarmar y rearmar en la misma operación.
    await armBirthdayWithin(db, next, now);
  });
  await syncAgendaAfterWrite();
  return next;
}

/** Borra la ficha y desarma su aviso en la misma transacción. */
export async function deleteContact(id: string): Promise<boolean> {
  const db = await getDatabase();
  let existed = false;
  await db.withTransactionAsync(async () => {
    await deleteNoticesByRefWithin(db, "birthday", id);
    const res = await db.runAsync("DELETE FROM contacts WHERE id = ?", [id]);
    existed = (res?.changes ?? 0) > 0;
  });
  if (existed) await syncAgendaAfterWrite();
  return existed;
}

/**
 * Búsqueda en la agenda de NIDO con la pieza pura de siempre:
 * por nombre (sin acentos) o por número, tope 5, nunca la
 * agenda entera.
 */
export async function searchContacts(query: string): Promise<ContactMatch[]> {
  const all = await listContacts();
  return filterContacts(
    all.map((c) => ({ name: c.name, phones: c.phones.map((p) => ({ number: p.number })) })),
    query,
  );
}
