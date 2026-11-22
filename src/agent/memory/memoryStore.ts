/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryStore.ts — ALMACÉN EN MEMORIA (tanda 11, DET-11: los handlers
 * falsos en memoria por diseño declarado, apertura §6).
 *
 * En la fuente este módulo es la memoria persistente sobre SQLite
 * cifrado. Aquí es la costura en memoria que consumen los handlers
 * falsos de esta tanda, con las mismas formas y constantes que la
 * fuente exporta (notas, recordatorios, hechos con su tope, personas
 * con su tope y su dedup por nombre). Nada persiste entre procesos:
 * el almacén real de PC es la memoria cifrada de E2 y su cableado con
 * la capa de herramientas llega en su etapa (E7 paso 2 sustituye los
 * handlers sin cambiar el contrato).
 *
 * Alineación al móvil, cierre R4: la costura se completa a las firmas del
 * 0.1.108 que consume el bucle adoptado. `AgentReminder` lleva `repeat` y
 * `saveReminder` lo acepta, con la regla de la fuente copiada: se guarda
 * solo si es un ritmo válido y el recordatorio tiene fecha. También se
 * copia la deduplicación de la fuente: un pendiente con el mismo texto
 * normalizado, la misma fecha y el mismo ritmo se devuelve en vez de
 * crear otro.
 */

import { isReminderRepeat, type ReminderRepeat } from "./reminderRepeat.js";

export const MAX_FACT_CONTENT_CHARS = 500;
export const MAX_PERSON_NOTES_CHARS = 500;

export interface AgentNote {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AgentReminder {
  id: string;
  text: string;
  due_at: string | null;
  done: number;
  created_at: string;
  /** 0.1.32: «day»/«week» si se repite; null si es de una vez. */
  repeat?: ReminderRepeat | null;
}

export interface Fact {
  id: string;
  content: string;
  category: "general" | "preference" | "goal" | "event";
  source: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
  relationship?: string;
  notes?: string;
  updatedAt: string;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

const notes: AgentNote[] = [];
const reminders: AgentReminder[] = [];
const facts: Fact[] = [];
const people: Person[] = [];

// ---------------------------------------------------------------- notes

export async function saveNote(input: { title: string; body: string }): Promise<AgentNote> {
  const now = new Date().toISOString();
  const note: AgentNote = {
    id: nextId("n"),
    title: input.title,
    body: input.body,
    created_at: now,
    updated_at: now,
  };
  notes.unshift(note);
  return note;
}

export async function listNotes(limit: number): Promise<AgentNote[]> {
  return notes.slice(0, limit);
}

export async function getNote(id: string): Promise<AgentNote | null> {
  return notes.find((n) => n.id === id) ?? null;
}

export async function deleteNote(id: string): Promise<void> {
  const i = notes.findIndex((n) => n.id === id);
  if (i >= 0) notes.splice(i, 1);
}

// ---------------------------------------------------------------- reminders

export async function saveReminder(input: {
  text: string;
  dueAt?: string | null;
  /** 0.1.32: se repite cada día/semana (necesita fecha). */
  repeat?: ReminderRepeat | null;
}): Promise<AgentReminder> {
  // DEDUP 2026-10-07: no crear duplicado si ya existe uno pendiente similar.
  // M6 FIX: también comparar dueAt. Si el texto coincide pero la fecha es
  // diferente, no es duplicado (el usuario cambió la fecha).
  const existing = await listReminders(50);
  const normalized = input.text.toLowerCase().trim();
  const dueAtNorm = input.dueAt ?? null;
  const repeat = isReminderRepeat(input.repeat) && dueAtNorm ? input.repeat : null;
  const dup = existing.find(
    (r) =>
      !r.done &&
      r.text.toLowerCase().trim() === normalized &&
      (r.due_at ?? null) === dueAtNorm &&
      (r.repeat ?? null) === repeat
  );
  if (dup) return dup;

  const reminder: AgentReminder = {
    id: nextId("r"),
    text: input.text,
    due_at: input.dueAt ?? null,
    done: 0,
    created_at: new Date().toISOString(),
    repeat,
  };
  reminders.unshift(reminder);
  return reminder;
}

export async function listReminders(limit: number): Promise<AgentReminder[]> {
  return reminders.slice(0, limit);
}

export async function deleteReminder(id: string): Promise<void> {
  const i = reminders.findIndex((r) => r.id === id);
  if (i >= 0) reminders.splice(i, 1);
}

// ---------------------------------------------------------------- facts

export async function saveFact(input: {
  content: string;
  category?: Fact["category"];
  confidence?: number;
  source?: string;
}): Promise<Fact> {
  // Cap por ítem de la fuente: el contenido se recorta a
  // MAX_FACT_CONTENT_CHARS y el handler avisa del recorte.
  const content = (input.content ?? "").slice(0, MAX_FACT_CONTENT_CHARS);
  const fact: Fact = {
    id: nextId("f"),
    content,
    category: input.category ?? "general",
    source: input.source ?? "user",
    updatedAt: new Date().toISOString(),
  };
  facts.unshift(fact);
  return fact;
}

export async function getFacts(limit: number): Promise<Fact[]> {
  return facts.slice(0, limit);
}

export async function deleteFact(id: string): Promise<void> {
  const i = facts.findIndex((f) => f.id === id);
  if (i >= 0) facts.splice(i, 1);
}

// ---------------------------------------------------------------- people

export async function savePerson(input: {
  name: string;
  relationship?: string;
  notes?: string;
}): Promise<Person> {
  // Dedup de la fuente: mismo nombre (case-insensitive) actualiza.
  const normalized = input.name.toLowerCase().trim();
  const dup = people.find((p) => p.name.toLowerCase().trim() === normalized);
  if (dup) {
    dup.relationship = input.relationship ?? dup.relationship;
    dup.notes = input.notes?.slice(0, MAX_PERSON_NOTES_CHARS) ?? dup.notes;
    dup.updatedAt = new Date().toISOString();
    return dup;
  }
  const person: Person = {
    id: nextId("p"),
    name: input.name,
    relationship: input.relationship,
    notes: input.notes?.slice(0, MAX_PERSON_NOTES_CHARS),
    updatedAt: new Date().toISOString(),
  };
  people.unshift(person);
  return person;
}

export async function getPeople(): Promise<Person[]> {
  return [...people];
}

export async function deletePerson(id: string): Promise<void> {
  const i = people.findIndex((p) => p.id === id);
  if (i >= 0) people.splice(i, 1);
}
