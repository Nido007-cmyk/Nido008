/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * eventSeries.ts — el motor único de ocurrencias de los
 * eventos recurrentes (CARGO-2).
 *
 * La importación guarda la recurrencia cruda (la cadena
 * RRULE) y, para las series sin fin, su `rruleUntil`
 * acotado a la ventana de 5 años. Hasta esta tanda nadie
 * interpretaba esa regla guardada: la lista enseñaba
 * solo la primera fecha y su aviso sonaba una sola vez.
 * Este módulo es el único intérprete: lo usan el armado
 * del aviso del evento (su fin de serie), la lista de la
 * Agenda y la herramienta de calendario del chat.
 *
 * La caminata usa la misma primitiva de la casa
 * (`nextOccurrence`, hora de pared con salto del día
 * inexistente) y las mismas cotas que el conteo de la
 * importación: el COUNT, el fin efectivo y la red de
 * 2.000 pasos de `ICS_LIMITS.maxOccurrences`. El fin
 * efectivo de una serie es el primero que llegue de:
 * `rruleUntil` (la columna guardada manda), el UNTIL de
 * la cadena, y — para la serie sin COUNT y sin ningún
 * fin guardado, solo posible escrita a mano — la
 * ventana de 5 años desde su inicio, la misma de la
 * importación. El COUNT acota además siempre.
 *
 * La expansión por consulta tiene su propio tope
 * (`EXPANSION_MAX_PER_QUERY`): si una serie trae más
 * ocurrencias que el tope dentro de la ventana pedida,
 * se devuelven las primeras y la truncación se dice
 * (`truncated`), nunca se corta en silencio.
 *
 * EXDATE no se honra: es la deuda nombrada de la puerta
 * y su tanda propia; las frases de la importación ya lo
 * dicen así desde esta tanda.
 */

import { ICS_LIMITS, parseDateValue } from "./calendarIcs.js";
import { nextOccurrence, type ReminderRepeat } from "./reminderRepeat.js";
import type { CalendarEvent } from "./calendarStore.js";

/** Tope de ocurrencias por serie y consulta al expandir. */
export const EXPANSION_MAX_PER_QUERY = 512;

const FREQ_TO_REPEAT: Record<string, ReminderRepeat> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

export interface StoredRule {
  repeat: ReminderRepeat;
  count: number | null;
  untilMs: number | null;
}

/**
 * Interpreta la RRULE guardada con el mismo lector de
 * la importación (mapa FREQ propio, COUNT con
 * `Number.parseInt(...) || null`, UNTIL por
 * `parseDateValue`). Una FREQ fuera del subconjunto —
 * o una cadena ilegible — devuelve null y el evento se
 * trata como único: la caída honesta de la casa.
 */
export function parseStoredRule(rrule: string | null): StoredRule | null {
  if (!rrule) return null;
  const parts = new Map<string, string>();
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) parts.set(part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim());
  }
  const freq = parts.get("FREQ");
  const repeat = freq ? FREQ_TO_REPEAT[freq] : undefined;
  if (!repeat) return null;
  const rawCount = parts.get("COUNT");
  const count = rawCount != null ? Number.parseInt(rawCount, 10) || null : null;
  const rawUntil = parts.get("UNTIL");
  const untilMs = rawUntil ? parseDateValue(rawUntil, false)?.ms ?? null : null;
  return { repeat, count, untilMs };
}

/** El fin efectivo de la serie: ver la cabecera. */
function effectiveEndMs(ev: CalendarEvent, rule: StoredRule): number {
  let end = Infinity;
  if (ev.rruleUntil != null) end = Math.min(end, ev.rruleUntil);
  if (rule.untilMs != null) end = Math.min(end, rule.untilMs);
  if (rule.count == null && rule.untilMs == null && ev.rruleUntil == null) {
    const d = new Date(ev.startsAt);
    d.setFullYear(d.getFullYear() + ICS_LIMITS.windowYears);
    end = d.getTime();
  }
  return end;
}

/**
 * La caminata entera de la serie desde su primera
 * fecha, acotada por el fin efectivo, el COUNT y la red
 * de 2.000 pasos. La primera fecha siempre entra si la
 * serie tiene al menos una ocurrencia.
 */
function walkSeries(ev: CalendarEvent, rule: StoredRule): number[] {
  const end = effectiveEndMs(ev, rule);
  const out: number[] = [];
  let t = ev.startsAt;
  while (t <= end && out.length < ICS_LIMITS.maxOccurrences) {
    if (rule.count != null && out.length >= rule.count) break;
    out.push(t);
    const next = nextOccurrence(new Date(t), rule.repeat, new Date(t)).getTime();
    if (!(next > t)) break;
    t = next;
  }
  return out;
}

/**
 * Las ocurrencias de un evento dentro de [fromMs, toMs),
 * con el tope por consulta dicho en voz alta. Sin regla
 * interpretable, el evento es único: entra solo si su
 * fecha cae en la ventana.
 */
export function iterateOccurrences(
  ev: CalendarEvent,
  fromMs: number,
  toMs: number,
): { startsAt: number[]; truncated: boolean } {
  const rule = parseStoredRule(ev.rrule);
  if (!rule) {
    return {
      startsAt: ev.startsAt >= fromMs && ev.startsAt < toMs ? [ev.startsAt] : [],
      truncated: false,
    };
  }
  const inWindow = walkSeries(ev, rule).filter((t) => t >= fromMs && t < toMs);
  if (inWindow.length > EXPANSION_MAX_PER_QUERY) {
    return { startsAt: inWindow.slice(0, EXPANSION_MAX_PER_QUERY), truncated: true };
  }
  return { startsAt: inWindow, truncated: false };
}

/**
 * El inicio de la última ocurrencia de la serie, o null
 * si el evento no trae regla interpretable o la serie
 * no tiene ocurrencias. Es el fin que el armado del
 * aviso traduce a `endsAt` de la cola.
 */
export function lastOccurrenceAt(ev: CalendarEvent): number | null {
  const rule = parseStoredRule(ev.rrule);
  if (!rule) return null;
  const all = walkSeries(ev, rule);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * La lista expandida dentro de la ventana enseñada:
 * cada serie se sustituye por sus ocurrencias en la
 * ventana (copias con inicio y fin corridos por el
 * mismo delta, la duración conservada); la copia de la
 * primera fecha es la fila de la serie y las demás van
 * marcadas `occurrence: true`; los eventos únicos pasan
 * intactos solo si su fecha cae en la ventana. El
 * resultado va ordenado por inicio, y `truncatedSeries`
 * cuenta las series que el tope cortó, para que el
 * llamante lo diga.
 */
export function expandEvents(
  events: CalendarEvent[],
  fromMs: number,
  toMs: number,
): { events: CalendarEvent[]; truncatedSeries: number } {
  const out: CalendarEvent[] = [];
  let truncatedSeries = 0;
  for (const ev of events) {
    if (!parseStoredRule(ev.rrule)) {
      if (ev.startsAt >= fromMs && ev.startsAt < toMs) out.push(ev);
      continue;
    }
    const { startsAt, truncated } = iterateOccurrences(ev, fromMs, toMs);
    if (truncated) truncatedSeries++;
    const duration = ev.endsAt - ev.startsAt;
    for (const t of startsAt) {
      if (t === ev.startsAt) out.push(ev);
      else out.push({ ...ev, startsAt: t, endsAt: t + duration, occurrence: true });
    }
  }
  out.sort((a, b) => a.startsAt - b.startsAt);
  return { events: out, truncatedSeries };
}
