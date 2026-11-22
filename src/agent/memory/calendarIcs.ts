/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * calendarIcs.ts — la `.ics` por la mano (paso 3 de E7;
 * AGENDA-PC §3.3): parser acotado al subconjunto de v1, resumen
 * previo con confirmación R4 y exportación.
 *
 * Subconjunto v1: VEVENT con DTSTART/DTEND o DURATION, día
 * completo (VALUE=DATE) y RRULE diaria/semanal/mensual/anual
 * con UNTIL o COUNT. Lo que el subconjunto no cubre no se
 * traga en silencio: EXDATE, VALARM y TZID se nombran en el
 * resumen; una RRULE fuera del subconjunto se descarta y se
 * nombra, y el evento entra como único.
 *
 * Las cifras de la firma 3, selladas antes de construirlo:
 * fichero ≤ 25 MB (aquí se aplica sobre el texto entero; el
 * lector que lo traiga de disco aplica el mismo tope durante
 * la lectura); ≤ 20.000 VEVENT; ventana de expansión de una
 * recurrencia sin fin de 5 años con ≤ 2.000 ocurrencias por
 * evento; propiedad desplegada ≤ 64 KB (la que pase se
 * descarta y el resumen lo nombra); línea física ≤ 1 MB (la
 * que pase rechaza el fichero entero con su razón); campos
 * guardados con tope (título, lugar y notas ≤ 2.000
 * caracteres, contados en el resumen si se recortan).
 *
 * El contenido importado es dato, nunca orden (R5): un título
 * con texto de inyección entra como título, literal.
 */

import {
  createEvent,
  listAllUids,
  type CalendarEvent,
} from "./calendarStore.js";
import { nextOccurrence, type ReminderRepeat } from "./reminderRepeat.js";

export const ICS_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxEvents: 20_000,
  maxLineBytes: 1024 * 1024,
  maxPropertyBytes: 64 * 1024,
  windowYears: 5,
  maxOccurrences: 2_000,
  fieldMax: 2_000,
} as const;

export interface IcsEventDraft {
  uid: string;
  title: string;
  notes: string;
  location: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  rrule: string | null;
  rruleUntil: number | null;
  alertOffsetMin: number | null;
}

export interface IcsImportSummary {
  /** Razón de rechazo entero del fichero, o null si se pudo leer. */
  rejected: string | null;
  /** VEVENT leídos en el fichero. */
  totalEvents: number;
  /** Los que entrarían (ni duplicados ni descartados). */
  enter: IcsEventDraft[];
  /** Los que ya estaban, por uid. */
  alreadyPresent: number;
  /** Lo descartado, con su razón: nada se descarta en silencio. */
  discarded: Array<{ what: string; reason: string }>;
  /** Lo presente que v1 no aplica pero nombra. */
  named: {
    exdate: string[];
    valarm: string[];
    unboundedRrule: string[];
    tzid: string[];
    withoutUid: number;
    truncatedFields: number;
  };
}

function emptySummary(): IcsImportSummary {
  return {
    rejected: null,
    totalEvents: 0,
    enter: [],
    alreadyPresent: 0,
    discarded: [],
    named: {
      exdate: [],
      valarm: [],
      unboundedRrule: [],
      tzid: [],
      withoutUid: 0,
      truncatedFields: 0,
    },
  };
}

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

function unescapeText(v: string): string {
  return v.replace(/\\(.)/g, (_m, c: string) =>
    c === "n" || c === "N" ? "\n" : c,
  );
}

function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

interface Prop {
  name: string;
  params: Map<string, string>;
  value: string;
}

function parsePropLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const params = new Map<string, string>();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1));
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** Instante de un valor DTSTART/DTEND/UNTIL; null si no casa con el subconjunto. */
function parseDateValue(
  value: string,
  isDate: boolean,
): { ms: number; allDay: boolean } | null {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    return {
      ms: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime(),
      allDay: true,
    };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(v);
  if (m) {
    const [, y, mo, d, hh, mm, ss, z] = m;
    const ms = z
      ? Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0))
      : new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0)).getTime();
    return { ms, allDay: isDate };
  }
  return null;
}

/** DURATION del subconjunto (P…W/D, PT…H/M/S) a milisegundos. */
function parseDurationMs(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, w, d, hh, mm, ss] = m;
  return (
    (Number(w ?? 0) * 7 * 24 * 3600 +
      Number(d ?? 0) * 24 * 3600 +
      Number(hh ?? 0) * 3600 +
      Number(mm ?? 0) * 60 +
      Number(ss ?? 0)) *
    1000
  );
}

/** TRIGGER relativo de VALARM (-PT30M y familia) a minutos antes; null si no aplica. */
function parseTriggerMinutes(value: string): number | null {
  const m = /^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, d, hh, mm, ss] = m;
  return (
    Number(d ?? 0) * 24 * 60 +
    Number(hh ?? 0) * 60 +
    Number(mm ?? 0) +
    Number(ss ?? 0) / 60
  );
}

const RRULE_FREQS: Record<string, ReminderRepeat> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

/** Cuenta ocurrencias de la serie en la ventana, con el tope de la firma. */
function countOccurrences(
  startsAt: number,
  repeat: ReminderRepeat,
  count: number | null,
  untilMs: number | null,
  windowEnd: number,
): number {
  const limit = Math.min(count ?? Infinity, ICS_LIMITS.maxOccurrences + 1);
  const end = Math.min(untilMs ?? Infinity, windowEnd);
  let n = 0;
  let cursor = new Date(startsAt - 1);
  const base = new Date(startsAt);
  while (n < limit) {
    const next = nextOccurrence(base, repeat, cursor).getTime();
    if (next > end) break;
    n += 1;
    cursor = new Date(next);
  }
  return n;
}

/**
 * El resumen previo de la importación (R4): lee el fichero
 * entero y dice cuántos entran, cuántos ya estaban, qué no
 * entra y por qué, y qué trae que v1 nombra sin aplicar. No
 * escribe nada.
 */
export function previewIcsImport(
  text: string,
  existingUids: ReadonlySet<string>,
): IcsImportSummary {
  const summary = emptySummary();
  if (byteLen(text) > ICS_LIMITS.maxBytes) {
    summary.rejected =
      "El fichero pasa de 25 MB: no se importó nada. Parte el calendario en ficheros más pequeños y vuelve a intentarlo.";
    return summary;
  }
  const physical = text.split(/\r\n|\r|\n/);
  for (const line of physical) {
    if (byteLen(line) > ICS_LIMITS.maxLineBytes) {
      summary.rejected =
        "El fichero trae una línea física que pasa de 1 MB: no se importó nada (un fichero .ics sano no trae líneas así).";
      return summary;
    }
  }
  // Despliegue de líneas (continuación: espacio o tabulador inicial).
  const lines: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  // Bloques VEVENT.
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT") {
      if (current) blocks.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  summary.totalEvents = blocks.length;
  if (blocks.length > ICS_LIMITS.maxEvents) {
    summary.rejected =
      "El fichero trae más de 20.000 eventos: no se importó nada. Parte el calendario y vuelve a intentarlo.";
    return summary;
  }

  const seen = new Set<string>();
  let generated = 0;
  for (const block of blocks) {
    const props: Prop[] = [];
    let inAlarm = false;
    let alarmTrigger: string | null = null;
    let hasAlarm = false;
    for (const line of block) {
      if (line === "BEGIN:VALARM") {
        inAlarm = true;
        hasAlarm = true;
        continue;
      }
      if (line === "END:VALARM") {
        inAlarm = false;
        continue;
      }
      const prop = parsePropLine(line);
      if (!prop) continue;
      if (inAlarm) {
        if (prop.name === "TRIGGER") alarmTrigger = prop.value;
        continue;
      }
      props.push(prop);
    }
    const get = (name: string) => props.find((p) => p.name === name);
    const rawTitle = get("SUMMARY") ? unescapeText(get("SUMMARY")!.value) : "";
    const label = rawTitle || get("UID")?.value || "(sin título)";

    // Propiedades que pasan de 64 KB desplegadas: se descartan
    // y se nombran; el evento sigue sin ellas.
    const usable = props.filter((p) => {
      if (byteLen(p.value) > ICS_LIMITS.maxPropertyBytes) {
        summary.discarded.push({
          what: `la propiedad ${p.name} de «${label}»`,
          reason: "pasa de 64 KB desplegada",
        });
        return false;
      }
      return true;
    });
    const uget = (name: string) => usable.find((p) => p.name === name);

    const startProp = uget("DTSTART");
    if (!startProp) {
      summary.discarded.push({ what: `el evento «${label}»`, reason: "sin DTSTART" });
      continue;
    }
    const start = parseDateValue(
      startProp.value,
      startProp.params.get("VALUE") === "DATE",
    );
    if (!start) {
      summary.discarded.push({
        what: `el evento «${label}»`,
        reason: "DTSTART fuera del subconjunto de v1",
      });
      continue;
    }
    if (startProp.params.has("TZID")) summary.named.tzid.push(label);

    let endsAt: number;
    const endProp = uget("DTEND");
    const durationProp = uget("DURATION");
    if (endProp) {
      const end = parseDateValue(endProp.value, endProp.params.get("VALUE") === "DATE");
      endsAt = end ? end.ms : start.ms + 3600_000;
    } else if (durationProp) {
      endsAt = start.ms + (parseDurationMs(durationProp.value) ?? 3600_000);
    } else {
      endsAt = start.ms + (start.allDay ? 24 * 3600_000 : 3600_000);
    }
    if (endsAt <= start.ms) endsAt = start.ms + (start.allDay ? 24 * 3600_000 : 3600_000);

    let uid = get("UID")?.value.trim() ?? "";
    if (!uid) {
      generated += 1;
      uid = `importado-${generated}-${start.ms}`;
      summary.named.withoutUid += 1;
    }
    if (existingUids.has(uid) || seen.has(uid)) {
      summary.alreadyPresent += 1;
      continue;
    }
    seen.add(uid);

    const cap = (v: string) => {
      if (v.length <= ICS_LIMITS.fieldMax) return v;
      summary.named.truncatedFields += 1;
      return v.slice(0, ICS_LIMITS.fieldMax);
    };

    // RRULE acotada al subconjunto.
    let rrule: string | null = null;
    let rruleUntil: number | null = null;
    const rruleProp = uget("RRULE");
    if (rruleProp) {
      const parts = new Map(
        rruleProp.value.split(";").map((kv) => {
          const eq = kv.indexOf("=");
          return [kv.slice(0, eq).toUpperCase(), kv.slice(eq + 1)] as const;
        }),
      );
      const freq = RRULE_FREQS[(parts.get("FREQ") ?? "").toUpperCase()];
      if (!freq) {
        summary.discarded.push({
          what: `la recurrencia de «${label}»`,
          reason: "RRULE fuera del subconjunto de v1 (diaria, semanal, mensual o anual); el evento entra como único",
        });
      } else {
        rrule = rruleProp.value;
        const untilRaw = parts.get("UNTIL");
        const countRaw = parts.get("COUNT");
        const until = untilRaw ? parseDateValue(untilRaw, false)?.ms ?? null : null;
        const count = countRaw ? Number.parseInt(countRaw, 10) || null : null;
        const windowEndDate = new Date(start.ms);
        windowEndDate.setFullYear(
          windowEndDate.getFullYear() + ICS_LIMITS.windowYears,
        );
        const windowEnd = windowEndDate.getTime();
        if (until == null && count == null) {
          // Sin fin: se acota a la ventana y el resumen lo dice.
          rruleUntil = windowEnd;
          summary.named.unboundedRrule.push(label);
        } else {
          rruleUntil = until;
        }
        const occurrences = countOccurrences(start.ms, freq, count, until, windowEnd);
        if (occurrences > ICS_LIMITS.maxOccurrences) {
          summary.discarded.push({
            what: `el evento «${label}»`,
            reason: "su recurrencia pasa de 2.000 ocurrencias en la ventana de 5 años",
          });
          continue;
        }
      }
    }

    if (props.some((p) => p.name === "EXDATE")) summary.named.exdate.push(label);
    let alertOffsetMin: number | null = null;
    if (hasAlarm) {
      summary.named.valarm.push(label);
      if (alarmTrigger != null) {
        const minutes = parseTriggerMinutes(alarmTrigger);
        if (minutes != null) alertOffsetMin = Math.round(minutes);
      }
    }

    summary.enter.push({
      uid,
      title: cap(rawTitle),
      notes: cap(uget("DESCRIPTION") ? unescapeText(uget("DESCRIPTION")!.value) : ""),
      location: cap(uget("LOCATION") ? unescapeText(uget("LOCATION")!.value) : ""),
      startsAt: start.ms,
      endsAt,
      allDay: start.allDay,
      rrule,
      rruleUntil,
      alertOffsetMin,
    });
  }
  return summary;
}

/**
 * Importa con la confirmación R4: sin `confirmed`, devuelve el
 * resumen y no guarda nada. Con ella, guarda exactamente lo que
 * el resumen anunció.
 */
export async function importIcs(
  text: string,
  opts: { confirmed: boolean },
): Promise<{ summary: IcsImportSummary; inserted: number }> {
  const existing = new Set(await listAllUids());
  const summary = previewIcsImport(text, existing);
  if (summary.rejected || !opts.confirmed) return { summary, inserted: 0 };
  let inserted = 0;
  for (const draft of summary.enter) {
    await createEvent({ ...draft, origin: "ics" });
    inserted += 1;
  }
  return { summary, inserted };
}

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Exporta los eventos como un calendario .ics (ida y vuelta por uid). */
export function exportIcs(events: CalendarEvent[]): string {
  const out: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NIDO//Agenda//ES"];
  for (const ev of events) {
    out.push("BEGIN:VEVENT");
    out.push(`UID:${ev.uid}`);
    if (ev.allDay) {
      out.push(`DTSTART;VALUE=DATE:${fmtDate(ev.startsAt)}`);
      out.push(`DTEND;VALUE=DATE:${fmtDate(ev.endsAt)}`);
    } else {
      out.push(`DTSTART:${fmtUtc(ev.startsAt)}`);
      out.push(`DTEND:${fmtUtc(ev.endsAt)}`);
    }
    out.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.notes) out.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    if (ev.rrule) out.push(`RRULE:${ev.rrule}`);
    out.push("END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.join("\r\n");
}
