/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contactVcf.ts — la `.vcf` por la mano (paso 4 de E7;
 * AGENDA-PC §4.2): el mismo trato que la `.ics` del paso 3.
 * Resumen previo con confirmación R4, deduplicación por
 * nombre normalizado y teléfono, y los topes hostiles de la
 * firma 3 (los mismos números, importados de calendarIcs).
 *
 * Subconjunto v1: FN, TEL, EMAIL, BDAY, NOTE y X-RELATION.
 * La ficha de AGENDA §4.1 no tiene campo de foto: una PHOTO
 * se descarta siempre y el resumen lo nombra, pase o no del
 * tope de propiedad. El contenido es dato, nunca orden (R5).
 */

import { ICS_LIMITS } from "./calendarIcs.js";
import {
  createContact,
  listContacts,
  type Contact,
  type ContactInput,
} from "./contactStore.js";
import { normalizeForContactSearch } from "../tools/contactSearch.js";

export interface VcfImportSummary {
  rejected: string | null;
  totalCards: number;
  enter: ContactInput[];
  alreadyPresent: number;
  discarded: Array<{ what: string; reason: string }>;
}

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");
const digits = (s: string) => s.replace(/\D/g, "");

function unescapeText(v: string): string {
  return v.replace(/\\(.)/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

function escapeText(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

interface StoredKey {
  name: string;
  phonesDigits: Set<string>;
}

function keyOf(name: string, phones: Array<{ number: string }>): StoredKey {
  return {
    name: normalizeForContactSearch(name),
    phonesDigits: new Set(phones.map((p) => digits(p.number)).filter(Boolean)),
  };
}

function isDuplicate(a: StoredKey, b: StoredKey): boolean {
  if (a.name !== b.name) return false;
  if (a.phonesDigits.size === 0 || b.phonesDigits.size === 0) return true;
  for (const d of a.phonesDigits) if (b.phonesDigits.has(d)) return true;
  return false;
}

/** El resumen previo de la importación de fichas (R4). No escribe nada. */
export function previewVcfImport(
  text: string,
  existing: StoredKey[],
): VcfImportSummary {
  const summary: VcfImportSummary = {
    rejected: null,
    totalCards: 0,
    enter: [],
    alreadyPresent: 0,
    discarded: [],
  };
  if (byteLen(text) > ICS_LIMITS.maxBytes) {
    summary.rejected =
      "El fichero pasa de 25 MB: no se importó nada. Parte la agenda en ficheros más pequeños y vuelve a intentarlo.";
    return summary;
  }
  const physical = text.split(/\r\n|\r|\n/);
  for (const line of physical) {
    if (byteLen(line) > ICS_LIMITS.maxLineBytes) {
      summary.rejected =
        "El fichero trae una línea física que pasa de 1 MB: no se importó nada (un fichero .vcf sano no trae líneas así).";
      return summary;
    }
  }
  const lines: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VCARD") current = [];
    else if (line === "END:VCARD") {
      if (current) blocks.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  summary.totalCards = blocks.length;
  if (blocks.length > ICS_LIMITS.maxEvents) {
    summary.rejected =
      "El fichero trae más de 20.000 fichas: no se importó nada. Parte la agenda y vuelve a intentarlo.";
    return summary;
  }

  const seen: StoredKey[] = [...existing];
  for (const block of blocks) {
    let name = "";
    let relation = "";
    let notes = "";
    let birthdayMonth: number | null = null;
    let birthdayDay: number | null = null;
    let birthdayYear: number | null = null;
    const phones: Array<{ label: string; number: string }> = [];
    const emails: Array<{ label: string; address: string }> = [];
    for (const line of block) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const head = line.slice(0, colon);
      const value = line.slice(colon + 1);
      const [propName, ...paramParts] = head.split(";");
      const prop = propName.toUpperCase();
      const label = labelOf(paramParts);
      if (prop === "PHOTO") {
        summary.discarded.push({
          what: `la PHOTO de «${name || "(sin nombre)"}»`,
          reason: "la ficha de NIDO no guarda fotos en v1",
        });
        continue;
      }
      if (byteLen(value) > ICS_LIMITS.maxPropertyBytes) {
        summary.discarded.push({
          what: `la propiedad ${prop} de «${name || "(sin nombre)"}»`,
          reason: "pasa de 64 KB desplegada",
        });
        continue;
      }
      switch (prop) {
        case "FN":
          name = unescapeText(value).trim();
          break;
        case "X-RELATION":
          relation = unescapeText(value).trim();
          break;
        case "NOTE":
          notes = unescapeText(value).trim();
          break;
        case "TEL":
          phones.push({ label, number: value.trim() });
          break;
        case "EMAIL":
          emails.push({ label, address: value.trim() });
          break;
        case "BDAY": {
          const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim()) ?? /^--(\d{2})(\d{2})$/.exec(value.trim());
          if (m) {
            if (m.length === 4) {
              birthdayYear = Number(m[1]);
              birthdayMonth = Number(m[2]);
              birthdayDay = Number(m[3]);
            } else {
              birthdayMonth = Number(m[1]);
              birthdayDay = Number(m[2]);
            }
          }
          break;
        }
        default:
          break;
      }
    }
    if (!name) {
      summary.discarded.push({ what: "una ficha sin nombre", reason: "sin FN" });
      continue;
    }
    const key = keyOf(name, phones);
    if (seen.some((k) => isDuplicate(k, key))) {
      summary.alreadyPresent += 1;
      continue;
    }
    seen.push(key);
    const cap = (v: string) => v.slice(0, ICS_LIMITS.fieldMax);
    summary.enter.push({
      name: cap(name),
      relation: cap(relation),
      birthdayMonth,
      birthdayDay,
      birthdayYear,
      phones: phones.map((p) => ({ label: p.label.slice(0, 100), number: p.number.slice(0, 100) })),
      emails: emails.map((e) => ({ label: e.label.slice(0, 100), address: e.address.slice(0, 100) })),
      notes: cap(notes),
      origin: "vcf",
    });
  }
  return summary;
}

function labelOf(paramParts: string[]): string {
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0 && p.slice(0, eq).toUpperCase() === "TYPE") {
      return p.slice(eq + 1).split(",")[0].toLowerCase();
    }
    if (eq < 0 && p) return p.toLowerCase();
  }
  return "";
}

/** Importa con la confirmación R4: sin ella no se guarda nada. */
export async function importVcf(
  text: string,
  opts: { confirmed: boolean },
): Promise<{ summary: VcfImportSummary; inserted: number }> {
  const existing = (await listContacts()).map((c) => keyOf(c.name, c.phones));
  const summary = previewVcfImport(text, existing);
  if (summary.rejected || !opts.confirmed) return { summary, inserted: 0 };
  let inserted = 0;
  for (const draft of summary.enter) {
    await createContact(draft);
    inserted += 1;
  }
  return { summary, inserted };
}

/** Exporta las fichas como .vcf (ida y vuelta por nombre y teléfono). */
export function exportVcf(contacts: Contact[]): string {
  const out: string[] = [];
  for (const c of contacts) {
    out.push("BEGIN:VCARD");
    out.push("VERSION:3.0");
    out.push(`FN:${escapeText(c.name)}`);
    if (c.relation) out.push(`X-RELATION:${escapeText(c.relation)}`);
    for (const p of c.phones) {
      out.push(`TEL${p.label ? `;TYPE=${p.label.toUpperCase()}` : ""}:${p.number}`);
    }
    for (const e of c.emails) {
      out.push(`EMAIL${e.label ? `;TYPE=${e.label.toUpperCase()}` : ""}:${e.address}`);
    }
    if (c.birthdayMonth != null && c.birthdayDay != null) {
      const p2 = (n: number) => String(n).padStart(2, "0");
      out.push(
        c.birthdayYear != null
          ? `BDAY:${c.birthdayYear}${p2(c.birthdayMonth)}${p2(c.birthdayDay)}`
          : `BDAY:--${p2(c.birthdayMonth)}${p2(c.birthdayDay)}`,
      );
    }
    if (c.notes) out.push(`NOTE:${escapeText(c.notes)}`);
    out.push("END:VCARD");
  }
  return out.join("\r\n");
}
