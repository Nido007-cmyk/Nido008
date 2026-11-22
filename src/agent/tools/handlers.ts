/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * handlers.ts — EL REGISTRO DE HERRAMIENTAS (tanda 11, DET-11:
 * nació como registro falso en memoria por diseño declarado;
 * las etapas lo van sustituyendo pieza a pieza sin cambiar el
 * contrato).
 *
 * Estado tras E7 paso 2: el calendario es REAL (calendarStore
 * sobre la base cifrada de E2; el aviso del evento se
 * materializa en la cola única por noticeStore) y los
 * recordatorios materializan su aviso en `notices` desde este
 * paso. Notas, hechos y personas siguen sobre la costura en
 * memoria (../memory/memoryStore) hasta su tanda, declarado:
 * nada de lo que sigue volátil se da por persistente.
 *
 * Recrea la superficie y las conductas de los handlers de la fuente
 * 0.1.108 sobre las piezas de la capa (confirm, contactSearch,
 * externalLink, calc, convert, analyze). Las conductas
 * que la puerta ejercita son las de la fuente: confirmación con el
 * payload completo y paridad N2 vía withConfirmation, el bucle M-3
 * fail-closed sin canal, y la honestidad de PC en lo que esta
 * plataforma aún no tiene (contactos del teléfono,
 * selector de archivos: el módulo nativo no existe y el handler
 * devuelve el texto de no disponible de la fuente, jamás un éxito
 * fingido).
 *
 * La nota de «la identidad volvió» del diálogo de emparejamiento lee
 * en la fuente el almacén P2P (findContactRowAny); la costura del
 * mensajero responde la verdad de PC (sin almacén, no hay fila).
 */

import {
  deleteNote,
  deleteReminder,
  getNote,
  listNotes,
  saveFact,
  saveNote,
  saveReminder,
  MAX_FACT_CONTENT_CHARS,
  MAX_PERSON_NOTES_CHARS,
} from "../memory/memoryStore.js";
import { LOCAL_TOOLS } from "./manifest.js";
import type { ToolHandler } from "./dispatcher.js";
import { withConfirmation, type RequestConfirm } from "./confirm.js";
import { actionLog } from "../actionLog.js";
import {
  classifyOpenAppTarget,
  type OpenAppRejectReason,
} from "./externalLink.js";
import { evaluateExpression, formatNumber, isApproximate } from "./calc.js";
import { convertUnits, ConvertError, validUnits } from "./convert.js";
import { loadSkill, listSkills } from "../skills/registry.js";
import { analyzeTable } from "./analyze.js";
import {
  PairingDisambiguationRequiredError,
  PairingKeyChangedError,
  StaleReplaceConflictError,
  findContactRowAny,
  getSharedNidoMessenger,
  type NidoMessenger,
} from "../../services/nidoMessenger.js";
import { decodePairingPayload } from "../../p2p/pairing.js";
import { normalizeContactName } from "../../p2p/contactName.js";
import { pairingBindingWarning, findPairingCollision } from "../../p2p/pairingCeremony.js";
import { fingerprint, fromHex } from "../../p2p/crypto.js";
import { withPermissionRequest } from "../../p2p/permissionGuard.js";
import type { ContactSearchResult } from "../loop/contactRouter.js";
import { formatDay, formatTime, type RouterLang } from "../loop/toolRouter.js";
import {
  listPendingAgentTasks,
  getPendingAgentTask,
  approveAgentTask,
  rejectAgentTask,
} from "../../p2p/approvalInbox.js";

/**
 * Textos de los diálogos de confirmación. En la fuente se resuelven
 * por i18n con reserva en inglés si la resolución falla; en PC la
 * cadena i18n de `src/` aún no existe en esta tanda, así que la
 * resolución cae siempre a la reserva, que es la conducta diseñada
 * de la fuente para ese caso.
 */
type ConfirmT = (key: string, opts?: Record<string, string>) => string;
const EN_CONFIRM_FALLBACK: Record<string, string> = {
  "agentConfirm.createEventTitle": "Create event",
  "agentConfirm.createEventMessage": "Create “{{title}}” in your calendar on {{start}}?",
  "agentConfirm.createEventMessageWithEnd":
    "Create “{{title}}” in your calendar on {{start}} until {{end}}?",
  "agentConfirm.sendMessageTitle": "Send NIDO message",
  "agentConfirm.sendMessageMessage": "Save a message for “{{to}}” in this session's outbox (unencrypted)?\n\n“{{text}}”",
  "agentConfirm.pairTitle": "Pair NIDO contact",
  "agentConfirm.pairMessage":
    "Pair with “{{name}}”?\nFingerprint: {{fingerprint}}\n\nOnly confirm if you scanned this code in person.",
  "agentConfirm.pairInvalidCode":
    "This code doesn't look like a valid NIDO pairing code.",
  // TD-12b: advertencias de ligadura nombre↔identidad (M-5).
  "agentConfirm.pairBindingKnownSameName":
    "This identity is already paired as “{{known}}”.",
  "agentConfirm.pairBindingKnownOtherName":
    "This identity is already paired as “{{known}}” (not as “{{name}}”).",
  "agentConfirm.pairBindingNameConflict":
    "Warning: you already have a contact named “{{name}}” with a DIFFERENT identity. Only confirm if you scanned this code in person, from the real device.",
  // UNIT B (F-4/F-5/F-6): desambiguación explícita de emparejamiento.
  "agentConfirm.pairDisambiguationTitle": "Disambiguate pairing",
  "agentConfirm.pairAmbiguousAsk":
    "This code is for “{{name}}” (fingerprint {{fingerprint}}), but you already have {{count}} live contact(s) with that name under a DIFFERENT identity: {{candidates}}. A name is not an identity — I cannot assume this is the same person.\n\nTell me explicitly (in chat):\n• “replace” — the same person with a new device: removes the old identity from your contact list (destructive);\n• “different person” — a different person: give me a unique name for the new contact;\n• “cancel” — do nothing.\n\nIf you don't choose, I cancel. Nothing has been paired yet.",
  "agentConfirm.pairReplaceConfirmMessage":
    "REPLACE the identity of “{{name}}”?\nFingerprint: {{fingerprint}}\n\nThis removes the old identity from this session's contact list. Any messages you had in the outbox for this name stay in the outbox under the same name. This cannot be undone. Confirm only if you verified this code in person.",
  "agentConfirm.pairDifferentPersonConfirmMessage":
    "Pair “{{name}}” as a DIFFERENT PERSON named “{{newName}}”?\nFingerprint: {{fingerprint}}\n\nBoth identities stay live. Confirm only if you scanned this code in person.",
  "agentConfirm.pairCancelled": "Pairing cancelled — nothing was written.",
  "agentConfirm.pairInvalidChoice":
    "The answer \"{{choice}}\" doesn't settle the pairing question: nothing has been done. Ask again and accept only \"replace\" (the same person with a new phone), \"different person\" (a different person) or \"cancel\" (do nothing).",
  // M-6: diálogos de decisión sobre tareas remotas encoladas.
  "agentConfirm.approveTaskTitle": "Approve NIDO task",
  "agentConfirm.approveTaskMessage":
    "Approve this task from “{{sender}}”?\n\n{{action}}\n\nReceived: {{when}}.\nApproval only records your decision; the task is not executed automatically.",
  "agentConfirm.rejectTaskTitle": "Reject NIDO task",
  "agentConfirm.rejectTaskMessage": "Reject this task from “{{sender}}”?\n\n{{action}}",
  "agentConfirm.taskNotFound":
    "There is no pending task with that id (it may already have been decided).",
  // M-6: salidas de las herramientas de revisión/decisión.
  "agentTasks.reviewEmpty": "There are no NIDO tasks pending approval.",
  "agentTasks.reviewHeader": "NIDO tasks pending your approval ({{count}}):",
  "agentTasks.reviewItem":
    "• id {{id}}\n  From: {{sender}} (id {{pkShort}}…)\n  Asks: {{action}}\n  Received: {{when}}",
  "agentTasks.reviewFooter":
    "To decide, use nido_approve_task or nido_reject_task with the id.",
  "agentTasks.decideMissingId":
    "Error: provide the task id (see nido_review_tasks).",
  "agentTasks.decideApproved":
    "Task {{id}} approved and recorded. Nothing was executed automatically.",
  "agentTasks.decideRejected": "Task {{id}} rejected and recorded.",
  "agentTasks.decideNotFound":
    "There is no pending task with id “{{id}}” (it may already have been decided).",
  "agentTasks.unknownSender": "Unknown NIDO contact",
  // P-F1: confirmación y rechazo explícito para open_app.
  "agentConfirm.openAppTitle": "Open external link",
  "agentConfirm.openAppMessage": "Open this link outside NIDO?\n\n{{target}}",
  "agentConfirm.openAppRejected":
    "NIDO can't open this link ({{reason}}). Allowed schemes: https, tel, sms, mailto.",
  "agentConfirm.openAppReason.empty": "it's empty",
  "agentConfirm.openAppReason.no-scheme": "it doesn't start with a valid scheme",
  "agentConfirm.openAppReason.scheme-not-allowed": "its scheme isn't allowed",
  "agentConfirm.openAppReason.unsafe-chars": "it contains unsafe characters",
  "agentConfirm.openAppReason.insecure-http":
    "it is an unencrypted http link; the https version is the one to open",
  // P-3 (tanda 14): las frases de alcance de la tarjeta de aprobación.
  "agentConfirm.scopeOpenApp": "Scope: only this destination: {{target}}",
  "agentConfirm.scopeOpenAppRejected": "Scope: nothing will be opened.",
  "agentConfirm.scopeCreateEvent": "Scope: only this event: “{{title}}” ({{start}})",
  "agentConfirm.scopePlaceCall": "Scope: only this number: {{phone}}",
  "agentConfirm.scopeSendSms": "Scope: only this message, only to {{phone}}",
  "agentConfirm.scopeSendMessage": "Scope: only this message, only to {{to}}",
  "agentConfirm.scopePair": "Scope: only this person: {{name}} ({{fingerprint}})",
  "agentConfirm.scopePairInvalid": "Scope: no one will be added.",
  "agentConfirm.scopeTask": "Scope: only this task: the one from {{sender}}",
  "agentConfirm.scopeTaskNotFound": "Scope: nothing will be decided.",
};

/** Idioma vigente de la UI para formatear fechas en los diálogos. */
function confirmLang(): RouterLang {
  try {
    const i18n = require("../../i18n").default as { language?: string };
    const l = (i18n.language ?? "").slice(0, 2);
    if (l === "es" || l === "en" || l === "pt") return l;
  } catch { /* sin i18n: se cae al idioma de los textos de reserva */ }
  return "en";
}

/**
 * 0.1.25: el diálogo de crear evento muestra el instante en fecha
 * local legible, no el ISO crudo UTC. Se formatea con los helpers sin
 * Intl de toolRouter, en el idioma de la UI y en la hora local.
 */
function fmtDialogWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const lang = confirmLang();
  const at = lang === "en" ? "at" : lang === "pt" ? "às" : "a las";
  return `${formatDay(d, lang)} ${at} ${formatTime(d, lang)}`;
}

function agentConfirmT(): ConfirmT {
  try {
    const i18n = require("../../i18n").default as {
      t(k: string, o?: unknown): string;
    };
    return (key, opts) => i18n.t(key, opts);
  } catch {
    return (key, opts) => {
      let s = EN_CONFIRM_FALLBACK[key] ?? key;
      for (const [k, v] of Object.entries(opts ?? {}))
        s = s.split(`{{${k}}}`).join(v);
      return s;
    };
  }
}

let langOverrideForTest: RouterLang | null = null;
/** Solo tests: fija el idioma de la UI que ven los handlers (null = el real). */
export function setHandlerLangForTest(lang: RouterLang | null): void {
  langOverrideForTest = lang;
}

function uiLang(): RouterLang {
  if (langOverrideForTest) return langOverrideForTest;
  try {
    const i18n = require("../../i18n").default as { language?: string };
    const l = (i18n.language ?? "").slice(0, 2);
    if (l === "es" || l === "en" || l === "pt") return l;
  } catch { /* sin i18n */ }
  return "es";
}
const L = (es: string, en: string, pt: string): string => {
  const l = uiLang();
  return l === "en" ? en : l === "pt" ? pt : es;
};

export function fmtDateTime(iso: string | null): string {
  if (!iso) return L("sin fecha", "no date", "sem data");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Sin Intl (la lección de Hermes en la fuente): solo getters de Date
  // vía los helpers de toolRouter.
  const lang = uiLang();
  return `${formatDay(d, lang)}, ${formatTime(d, lang)}`;
}

/** Hora actual del dispositivo, en el idioma de la UI. */
const deviceTime: ToolHandler = async () => {
  const now = new Date();
  const lang = uiLang();
  const time = formatTime(now, lang);
  const day = formatDay(now, lang);
  const year = now.getFullYear();
  return L(
    `Ahora son las ${time} del ${day} de ${year} (hora del dispositivo).`,
    `It is now ${time} on ${day}, ${year} (device time).`,
    `Agora são ${time} de ${day} de ${year} (hora do dispositivo).`,
  );
};

const saveNoteHandler: ToolHandler = async (args) => {
  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "");
  if (!title) return L("Error: falta el título de la nota.", "Error: the note title is missing.", "Erro: falta o título da nota.");
  const note = await saveNote({ title, body });
  actionLog.noteUndo("save_note", { kind: "note", id: note.id });
  return L(
    `Nota guardada: «${note.title}» (id ${note.id}).`,
    `Note saved: “${note.title}” (id ${note.id}).`,
    `Nota guardada: «${note.title}» (id ${note.id}).`,
  );
};

const listNotesHandler: ToolHandler = async () => {
  const notes = await listNotes(20);
  if (notes.length === 0) return L("No hay notas guardadas todavía.", "There are no saved notes yet.", "Ainda não há notas guardadas.");
  return (
    L("Notas guardadas:", "Saved notes:", "Notas guardadas:") +
    "\n" +
    notes.map((n) => `- «${n.title}» (id ${n.id}, ${fmtDateTime(n.created_at)})`).join("\n") +
    "\n" +
    L("Usa read_note con el id para leer una completa.", "Use read_note with the id to read one in full.", "Usa read_note com o id para ler uma completa.")
  );
};

const readNoteHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id de la nota.", "Error: the note id is missing.", "Erro: falta o id da nota.");
  const note = await getNote(id);
  if (!note) return L(`No encontré ninguna nota con id ${id}.`, `I couldn't find any note with id ${id}.`, `Não encontrei nenhuma nota com id ${id}.`);
  return `«${note.title}» (${fmtDateTime(note.created_at)}):\n${note.body || L("(sin contenido)", "(empty)", "(sem conteúdo)")}`;
};

/**
 * Solo se borra si la etiqueta que el usuario confirmó coincide con
 * la guardada (NFC, espacios colapsados, minúsculas); si no, no se
 * borra nada y se lanza (el dispatcher lo reporta como fallo).
 */
function sameLabel(shown: unknown, stored: string): boolean {
  const n = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return typeof shown === "string" && n(shown).length > 0 && n(shown) === n(stored);
}

const deleteNoteHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id de la nota.", "Error: the note id is missing.", "Erro: falta o id da nota.");
  const note = await getNote(id);
  if (!note) return L(`No encontré ninguna nota con id ${id}.`, `I couldn't find any note with id ${id}.`, `Não encontrei nenhuma nota com id ${id}.`);
  if (!sameLabel(args.title, note.title)) {
    throw new Error(L("la nota confirmada no coincide con la guardada; no se borró nada", "the confirmed note doesn't match the saved one; nothing was deleted", "a nota confirmada não coincide com a guardada; nada foi apagado"));
  }
  await deleteNote(id);
  return L(`Nota borrada: «${note.title}».`, `Note deleted: “${note.title}”.`, `Nota apagada: «${note.title}».`);
};

const deleteMemoryHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  const kind = args.kind === "person" ? "person" : "fact";
  if (!id) return L("Error: falta el id del recuerdo.", "Error: the memory id is missing.", "Erro: falta o id da lembrança.");
  const store = await import("../memory/memoryStore.js");
  if (kind === "person") {
    // E7 paso 4: la persona puede ser una FICHA de la agenda
    // (la verdad desde este paso) o una fila heredada de la
    // costura. Borrar desarma el aviso de cumpleaños en la
    // misma operación (contactStore.deleteContact) y retira
    // el espejo de la costura.
    const contacts = await import("../memory/contactStore.js");
    const ficha = await contacts.getContact(id);
    if (ficha) {
      const label = ficha.relation ? `${ficha.name} (${ficha.relation})` : ficha.name;
      if (!sameLabel(args.content, label)) throw new Error(L("el recuerdo confirmado no coincide con el guardado; no se borró nada", "the confirmed memory doesn't match the saved one; nothing was deleted", "a lembrança confirmada não coincide com a guardada; nada foi apagado"));
      await contacts.deleteContact(id);
      const mirror = (await store.getPeople()).find(
        (p) => p.name.toLowerCase().trim() === ficha.name.toLowerCase().trim(),
      );
      if (mirror) await store.deletePerson(mirror.id);
      return L(`Recuerdo borrado: «${label}».`, `Memory deleted: “${label}”.`, `Lembrança apagada: «${label}».`);
    }
    const person = (await store.getPeople()).find((p) => p.id === id);
    if (!person) return L(`No encontré ese recuerdo (id ${id}).`, `I couldn't find that memory (id ${id}).`, `Não encontrei essa lembrança (id ${id}).`);
    const label = person.relationship ? `${person.name} (${person.relationship})` : person.name;
    if (!sameLabel(args.content, label)) throw new Error(L("el recuerdo confirmado no coincide con el guardado; no se borró nada", "the confirmed memory doesn't match the saved one; nothing was deleted", "a lembrança confirmada não coincide com a guardada; nada foi apagado"));
    await store.deletePerson(id);
    // Si la fila de la costura tenía ficha (guardada antes de
    // este paso por otra vía), la ficha cae con ella.
    const linked = await contacts.findContactByName(person.name);
    if (linked) await contacts.deleteContact(linked.id);
    return L(`Recuerdo borrado: «${label}».`, `Memory deleted: “${label}”.`, `Lembrança apagada: «${label}».`);
  }
  const fact = (await store.getFacts(500)).find((f) => f.id === id);
  if (!fact) return L(`No encontré ese recuerdo (id ${id}).`, `I couldn't find that memory (id ${id}).`, `Não encontrei essa lembrança (id ${id}).`);
  if (!sameLabel(args.content, fact.content)) throw new Error(L("el recuerdo confirmado no coincide con el guardado; no se borró nada", "the confirmed memory doesn't match the saved one; nothing was deleted", "a lembrança confirmada não coincide com a guardada; nada foi apagado"));
  await store.deleteFact(id);
  return L(`Recuerdo borrado: «${fact.content}».`, `Memory deleted: “${fact.content}”.`, `Lembrança apagada: «${fact.content}».`);
};

const deleteReminderHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id del recordatorio.", "Error: the reminder id is missing.", "Erro: falta o id do lembrete.");
  const { listReminders } = await import("../memory/memoryStore.js");
  const reminder = (await listReminders(200)).find((r) => r.id === id);
  if (!reminder) return L(`No encontré ningún recordatorio con id ${id}.`, `I couldn't find any reminder with id ${id}.`, `Não encontrei nenhum lembrete com id ${id}.`);
  if (!sameLabel(args.text, reminder.text)) {
    throw new Error(L("el recordatorio confirmado no coincide con el guardado; no se borró nada", "the confirmed reminder doesn't match the saved one; nothing was deleted", "o lembrete confirmado não coincide com o guardado; nada foi apagado"));
  }
  // Cancelar el aviso del sistema ANTES de borrar.
  try {
    const { cancelReminderNotification } = await import("../../notify/notifications.js");
    await cancelReminderNotification(id);
  } catch {
    // Sin módulo de notificaciones disponible: el borrado sigue.
  }
  // E7 paso 2 (fila V-2): desarmar también el aviso de la cola
  // única, en la misma operación que el borrado.
  if (reminder.due_at) {
    try {
      const { disarmReminder, toBaseLocal } = await import("../memory/noticeStore.js");
      await disarmReminder(reminder.text, toBaseLocal(new Date(reminder.due_at)));
    } catch {
      // Sin base abierta: no hay cola que desarmar.
    }
  }
  await deleteReminder(id);
  return L(`Recordatorio borrado: «${reminder.text}».`, `Reminder deleted: “${reminder.text}”.`, `Lembrete apagado: «${reminder.text}».`);
};

const createReminderHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "").trim();
  if (!text) return L("Error: falta el texto del recordatorio.", "Error: the reminder text is missing.", "Erro: falta o texto do lembrete.");
  let dueAt: string | null = null;
  const at = args.at != null ? String(args.at).trim() : "";
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      // Rechazar fechas en el pasado (la misma regla del path determinista).
      if (d.getTime() < Date.now() - 60_000) {
        return L("Error: la fecha del recordatorio está en el pasado. Usa una fecha futura.", "Error: the reminder date is in the past. Use a future date.", "Erro: a data do lembrete está no passado. Use uma data futura.");
      }
      dueAt = d.toISOString();
    } else {
      // Un `at` no vacío e imposible es un error observable y no se
      // guarda nada (P-10b de la fuente).
      return L(
        `Error: no pude interpretar la fecha «${at}» y no guardé el recordatorio. Pide la fecha en un formato claro, por ejemplo 2026-11-20T09:00.`,
        `Error: I couldn't parse the date "${at}" and the reminder was NOT saved. Ask for the date in a clear format, for example 2026-11-20T09:00.`,
        `Erro: não consegui interpretar a data "${at}" e o lembrete NÃO foi guardado. Peça a data num formato claro, por exemplo 2026-11-20T09:00.`,
      );
    }
  }
  const reminder = await saveReminder({ text, dueAt });
  actionLog.noteUndo("create_reminder", { kind: "reminder", id: reminder.id });
  const cuando = dueAt
    ? L(` para ${fmtDateTime(dueAt)}`, ` for ${fmtDateTime(dueAt)}`, ` para ${fmtDateTime(dueAt)}`)
    : L(" (sin fecha)", " (no date)", " (sem data)");
  let aviso = L("Te avisaré al abrir NIDO cuando llegue la hora.", "I'll remind you when you open NIDO once it's time.", "Aviso você ao abrir o NIDO quando chegar a hora.");
  if (dueAt) {
    // E7 paso 2 (fila V-2): el aviso del recordatorio se
    // materializa en la cola única (kind reminder) por
    // noticeStore. Si la base está cerrada, el recordatorio
    // sigue guardado y la letra no cambia: hasta que E8
    // aterrice el ejecutor, la app promete rearme y lista de
    // perdidos, no disparo en hora (la letra de H-4).
    try {
      const { armNotice, toBaseLocal } = await import("../memory/noticeStore.js");
      await armNotice({
        kind: "reminder",
        body: { text: reminder.text },
        baseLocal: toBaseLocal(new Date(dueAt)),
        repeat: reminder.repeat ?? null,
      });
    } catch {
      // Sin base abierta: no hay cola donde materializar.
    }
    // Aviso real del sistema, programado en el dispositivo (Fase C).
    // En PC la promesa es condicional (§9 de AVISOS): el aviso
    // del sistema a su hora solo es verdad con el residente
    // encendido, y lo que el residente sobrevive es el cierre
    // de la ventana, no el apagado de la app.
    try {
      const { scheduleReminderNotification, osNoticeWillFire } = await import("../../notify/notifications.js");
      const ok = await scheduleReminderNotification(reminder.id, reminder.text, new Date(dueAt));
      if (ok && (await osNoticeWillFire())) {
        aviso = L("Te llegará un aviso del sistema a esa hora, aunque cierres la ventana.", "You'll get a system notification at that time, even if you close the window.", "Você receberá um aviso do sistema nessa hora, mesmo se fechar a janela.");
      }
    } catch {
      // Sin notificaciones: el recordatorio sigue guardado y se muestra al abrir.
    }
  }
  return L(
    `Recordatorio guardado${cuando}: «${reminder.text}». ${aviso}`,
    `Reminder saved${cuando}: “${reminder.text}”. ${aviso}`,
    `Lembrete guardado${cuando}: «${reminder.text}». ${aviso}`,
  );
};

/** Detector simple de fechas en texto (ES/EN/PT) de la fuente. */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i,
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre) \d{1,2}\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}\b/i,
  /\b\d{1,2}(?:st|nd|rd|th)? (?:of )?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b\d{1,2} de (janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
];

export function containsDatePattern(text: string): boolean {
  return DATE_PATTERNS.some((re) => re.test(text));
}

const rememberFactHandler: ToolHandler = async (args) => {
  const content = String(args.content ?? "").trim();
  if (!content) return L("Error: falta el contenido del hecho.", "Error: the fact content is missing.", "Erro: falta o conteúdo do fato.");
  // Allowlist de categorías de la fuente.
  const VALID_CATEGORIES = ["general", "preference", "goal", "event"] as const;
  const rawCategory = String(args.category ?? "general").trim() || "general";
  const category = (VALID_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : "general";
  // La confirmación cita lo GUARDADO (el almacén recorta al tope y se
  // avisa del recorte, m-15 de la fuente).
  const saved = await saveFact({ content, category: category as "general", source: "user" });
  let result = L(
    `Guardado en mi memoria: «${saved.content}» (categoría: ${category}).`,
    `Saved in my memory: “${saved.content}” (category: ${category}).`,
    `Guardado na minha memória: «${saved.content}» (categoria: ${category}).`,
  );
  if (content.length > MAX_FACT_CONTENT_CHARS) {
    result += L(
      ` Aviso: el texto superaba el máximo de ${MAX_FACT_CONTENT_CHARS} caracteres y se guardó recortado.`,
      ` Note: the text exceeded the ${MAX_FACT_CONTENT_CHARS}-character maximum and was saved trimmed.`,
      ` Aviso: o texto excedia o máximo de ${MAX_FACT_CONTENT_CHARS} caracteres e foi guardado cortado.`,
    );
  }
  if (containsDatePattern(saved.content)) {
    result += L(
      ` Veo que menciona una fecha — si quieres que te avise con tiempo, pídeme "créame un recordatorio para..."`,
      ` I see it mentions a date — if you want me to warn you ahead of time, ask me "create a reminder for..."`,
      ` Vejo que menciona uma data — se você quiser que eu avise com antecedência, peça "crie um lembrete para..."`,
    );
  }
  return result;
};

/** Cumpleaños de save_person: «1990-06-08» o «06-08»; null si no casa. */
function parseBirthdayArg(raw: string): { year: number | null; month: number; day: number } | null {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (full) return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  const md = /^(\d{2})-(\d{2})$/.exec(raw.trim());
  if (md) return { year: null, month: Number(md[1]), day: Number(md[2]) };
  return null;
}

const savePersonHandler: ToolHandler = async (args) => {
  const name = String(args.name ?? "").trim();
  if (!name) return L("Error: falta el nombre de la persona.", "Error: the person's name is missing.", "Erro: falta o nome da pessoa.");
  const relationship = args.relationship ? String(args.relationship).trim() : undefined;
  const notes = args.notes ? String(args.notes).trim() : undefined;
  const phone = args.phone ? String(args.phone).trim() : undefined;
  const birthdayRaw = args.birthday ? String(args.birthday).trim() : undefined;
  const birthday = birthdayRaw ? parseBirthdayArg(birthdayRaw) : null;

  // E7 paso 4: la persona se guarda como FICHA de la agenda de
  // NIDO (su base cifrada), con su aviso de cumpleaños armado
  // por contactStore. La costura en memoria recibe el espejo
  // (nombre, relación, notas) para que el Gestor de memoria y
  // memory_query sigan viendo a la persona; la verdad es la
  // ficha, y borrar por cualquiera de las dos vías borra las
  // dos (deleteMemoryHandler y el canal del Gestor).
  const store = await import("../memory/contactStore.js");
  const existing = await store.findContactByName(name);
  const patch = {
    relation: relationship ?? existing?.relation ?? "",
    notes: notes ?? existing?.notes ?? "",
    ...(birthday
      ? { birthdayMonth: birthday.month, birthdayDay: birthday.day, birthdayYear: birthday.year }
      : {}),
    ...(phone ? { phones: [{ label: "", number: phone }] } : {}),
  };
  const person = existing
    ? ((await store.updateContact(existing.id, patch)) ?? existing)
    : await store.createContact({ name, ...patch, origin: "chat" });
  const { savePerson } = await import("../memory/memoryStore.js");
  await savePerson({
    name: person.name,
    relationship: person.relation || undefined,
    notes: person.notes || undefined,
  });

  const rel = person.relation ? ` (${person.relation})` : "";
  let result = L(
    `Persona guardada: «${person.name}»${rel}.`,
    `Person saved: “${person.name}”${rel}.`,
    `Pessoa guardada: «${person.name}»${rel}.`,
  );
  if (notes && notes.length > MAX_PERSON_NOTES_CHARS) {
    result += L(
      ` Aviso: las notas superaban el máximo de ${MAX_PERSON_NOTES_CHARS} caracteres y se guardaron recortadas.`,
      ` Note: the notes exceeded the ${MAX_PERSON_NOTES_CHARS}-character maximum and were saved trimmed.`,
      ` Aviso: as notas excediam o máximo de ${MAX_PERSON_NOTES_CHARS} caracteres e foram guardadas cortadas.`,
    );
  }
  if (birthdayRaw && !birthday) {
    result += L(
      " Aviso: no entendí el cumpleaños (usa AAAA-MM-DD o MM-DD) y no lo guardé.",
      " Note: I didn't understand the birthday (use YYYY-MM-DD or MM-DD) and didn't save it.",
      " Aviso: não entendi o aniversário (use AAAA-MM-DD ou MM-DD) e não o guardei.",
    );
  }
  return result;
};

const openAppHandler: ToolHandler = async (args) => {
  // P-F1: se vuelve a clasificar aquí aunque el diálogo ya lo haya
  // hecho; nunca se confía en el path.
  const c = classifyOpenAppTarget(args.link);
  if (!c.ok) {
    const t = agentConfirmT();
    return t("agentConfirm.openAppRejected", {
      reason: t(`agentConfirm.openAppReason.${c.reason}`),
    });
  }
  try {
    const { Linking } = await import("react-native");
    await Linking.openURL(c.normalized);
    return L(`Abriendo ${c.normalized}…`, `Opening ${c.normalized}…`, `Abrindo ${c.normalized}…`);
  } catch {
    return L(`No pude abrir ${c.normalized} desde NIDO.`, `I couldn't open ${c.normalized} from NIDO.`, `Não consegui abrir ${c.normalized} do NIDO.`);
  }
};

/** Clave i18n del motivo de rechazo de open_app según la clasificación. */
function openAppRejectReasonKey(reason: OpenAppRejectReason): string {
  return `agentConfirm.openAppReason.${reason}`;
}

// ---------------------------------------------------------------- Fase B
// Calendario, contactos, archivos, calculadora, llamadas/SMS.
// Los módulos nativos se importan de forma diferida: solo se cargan
// cuando la herramienta se usa de verdad, no al arrancar el chat.

const calculateHandler: ToolHandler = async (args) => {
  const expr = String(args.expression ?? "").trim();
  if (!expr) return L("Error: falta la expresión a calcular.", "Error: the expression to calculate is missing.", "Erro: falta a expressão a calcular.");
  try {
    const value = evaluateExpression(expr);
    return `${expr} ${isApproximate(value) ? "≈" : "="} ${formatNumber(value)}`;
  } catch (e) {
    return `${L("No pude calcular eso: ", "I couldn't calculate that: ", "Não consegui calcular isso: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const convertUnitsHandler: ToolHandler = async (args) => {
  const value = Number(args.value);
  const from = String(args.from ?? "").trim();
  const to = String(args.to ?? "").trim();
  if (!Number.isFinite(value)) return L("Error: el valor a convertir debe ser un número.", "Error: the value to convert must be a number.", "Erro: o valor a converter deve ser um número.");
  if (!from || !to) return L("Error: indica la unidad de origen y la de destino.", "Error: give the source unit and the target unit.", "Erro: indica a unidade de origem e a de destino.");
  try {
    const r = convertUnits(value, from, to);
    const shown = Math.abs(r.value) >= 0.01 || r.value === 0 ? Number(r.value.toFixed(4)) : Number(r.value.toPrecision(4));
    return `${formatNumber(value)} ${r.from} = ${formatNumber(shown)} ${r.to}`;
  } catch (e) {
    const prefix = L("No pude convertir eso", "I couldn't convert that", "Não consegui converter isso");
    if (e instanceof ConvertError) {
      const d = e.detail;
      const why =
        e.code === "belowAbsoluteZero"
          ? L("está por debajo del cero absoluto (−273,15 °C); esa temperatura no existe", "it is below absolute zero (−273.15 °C); that temperature doesn't exist", "está abaixo do zero absoluto (−273,15 °C); essa temperatura não existe")
          : e.code === "unknownUnit"
            ? L(`no conozco la unidad «${d.unit}». Válidas: ${validUnits().join(", ")}`, `I don't know the unit “${d.unit}”. Valid: ${validUnits().join(", ")}`, `não conheço a unidade “${d.unit}”. Válidas: ${validUnits().join(", ")}`)
            : e.code === "mismatch"
              ? L(`${d.from} y ${d.to} miden cosas distintas`, `${d.from} and ${d.to} measure different things`, `${d.from} e ${d.to} medem coisas diferentes`)
              : L("el valor no es un número", "the value isn't a number", "o valor não é um número");
      return `${prefix}: ${why}.`;
    }
    return `${prefix}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

// E7 paso 2: el calendario de PC es el de NIDO, dentro de la app
// y sobre la base cifrada (calendarStore). No hay módulo de
// calendario del sistema ni permiso que pedir: las filas C-1 y
// C-2 del censo de éxitos fingidos mueren aquí. El aviso del
// evento, si lo trae, se materializa en la cola única por
// noticeStore dentro de calendarStore.
const createCalendarEventHandler: ToolHandler = async (args) => {
  const title = String(args.title ?? "").trim();
  if (!title) return L("Error: falta el título del evento.", "Error: the event title is missing.", "Erro: falta o título do evento.");
  const start = new Date(String(args.start ?? ""));
  if (Number.isNaN(start.getTime())) {
    return L("Error: la fecha de inicio no es válida. Usa formato ISO, p.ej. 2026-09-27T10:00:00.", "Error: the start date isn't valid. Use ISO format, e.g. 2026-09-27T10:00:00.", "Erro: a data de início não é válida. Use o formato ISO, p.ex. 2026-09-27T10:00:00.");
  }
  const endRaw = args.end != null ? String(args.end).trim() : "";
  const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end <= start) {
    return L("Error: la fecha de fin no es válida o es anterior al inicio.", "Error: the end date isn't valid or is before the start.", "Erro: a data de fim não é válida ou é anterior ao início.");
  }
  try {
    const { createEvent } = await import("../memory/calendarStore.js");
    const alertRaw = args.alert_offset_min != null ? Number(args.alert_offset_min) : NaN;
    await createEvent({
      title,
      startsAt: start.getTime(),
      endsAt: end.getTime(),
      notes: args.notes != null ? String(args.notes) : undefined,
      location: args.location != null ? String(args.location) : undefined,
      alertOffsetMin: Number.isFinite(alertRaw) ? Math.floor(alertRaw) : null,
      origin: "chat",
    });
    return L(
      `Evento creado: «${title}», ${fmtDateTime(start.toISOString())}.`,
      `Event created: “${title}”, ${fmtDateTime(start.toISOString())}.`,
      `Evento criado: «${title}», ${fmtDateTime(start.toISOString())}.`,
    );
  } catch (e) {
    return `${L("No pude crear el evento: ", "I couldn't create the event: ", "Não consegui criar o evento: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

/** Exportado para las rutinas proactivas (resumen diario). */
export const listCalendarEventsHandler: ToolHandler = async (args) => {
  const now = new Date();
  const fromRaw = args.from != null ? String(args.from).trim() : "";
  const toRaw = args.to != null ? String(args.to).trim() : "";
  const from = fromRaw ? new Date(fromRaw) : now;
  const to = toRaw ? new Date(toRaw) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return L("Error: rango de fechas inválido. Usa formato ISO.", "Error: invalid date range. Use ISO format.", "Erro: intervalo de datas inválido. Use o formato ISO.");
  }
  const limit = Number(args.limit) > 0 ? Math.min(Math.floor(Number(args.limit)), 50) : 20;
  try {
    const { listEvents } = await import("../memory/calendarStore.js");
    const events = await listEvents(from.getTime(), to.getTime());
    const hidden = Math.max(0, events.length - limit);
    const upcoming = events
      .slice(0, limit)
      .map((e) => {
        const s = new Date(e.startsAt);
        return `- «${e.title || L("(sin título)", "(untitled)", "(sem título)")}» — ${fmtDateTime(s.toISOString())}${e.location ? ` @ ${e.location}` : ""}`;
      });
    if (upcoming.length === 0) return L("No hay eventos en ese rango.", "There are no events in that range.", "Não há eventos nesse intervalo.");
    const more = hidden > 0 ? `\n${L(`… y ${hidden} más.`, `… and ${hidden} more.`, `… e mais ${hidden}.`)}` : "";
    return `${L("Próximos eventos:", "Upcoming events:", "Próximos eventos:")}\n${upcoming.join("\n")}${more}`;
  } catch (e) {
    return `${L("No pude leer el calendario", "I couldn't read the calendar", "Não consegui ler o calendário")}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

/**
 * Búsqueda estructurada en la agenda de NIDO (la usa el
 * pre-router determinístico de contactos y también
 * find_contact). Desde el paso 4 de E7 la agenda es la de
 * NIDO: las fichas de su base cifrada, sin permiso del
 * sistema ni agenda del teléfono que pedir (H-3: la
 * situación del permiso desaparece, no se renombra).
 */
export async function searchSavedContacts(query: string): Promise<ContactSearchResult> {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, message: L("Error: falta el nombre a buscar.", "Error: the name to search for is missing.", "Erro: falta o nome a buscar.") };
  try {
    const { searchContacts } = await import("../memory/contactStore.js");
    return { ok: true, matches: await searchContacts(q) };
  } catch (e) {
    return { ok: false, message: `${L("No pude buscar en tu agenda de NIDO: ", "I couldn't search your NIDO address book: ", "Não consegui buscar na sua agenda do NIDO: ")}${e instanceof Error ? e.message : String(e)}` };
  }
}

const findContactHandler: ToolHandler = async (args) => {
  const res = await searchSavedContacts(String(args.query ?? ""));
  if (!res.ok) return res.message;
  if (res.matches.length === 0) return L(`No encontré ningún contacto que coincida con «${args.query}» en tu agenda de NIDO.`, `I couldn't find any contact matching “${args.query}” in your NIDO address book.`, `Não encontrei nenhum contato que corresponda a «${args.query}» na sua agenda do NIDO.`);
  return (
    L("En tu agenda de NIDO encontré:", "In your NIDO address book I found:", "Na sua agenda do NIDO encontrei:") +
    "\n" +
    res.matches.map((c) => `- ${c.name} — ${c.phones[0] ?? L("sin teléfono", "no phone", "sem telefone")}`).join("\n")
  );
};

const MAX_PICKED_FILE_BYTES = 200 * 1024;

const readPickedFileHandler: ToolHandler = async () => {
  try {
    const DocumentPicker = await import("expo-document-picker");
    const picked = await withPermissionRequest(() =>
      DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      }),
    );
    if (picked.canceled || !picked.assets?.length) {
      return L("No elegiste ningún archivo.", "You didn't choose any file.", "Você não escolheu nenhum arquivo.");
    }
    const asset = picked.assets[0];
    const fallbackName = asset.name ?? L("archivo", "file", "arquivo");
    if (asset.size != null && asset.size > MAX_PICKED_FILE_BYTES) {
      return L(
        `«${fallbackName}» pesa más de 200 KB; elige un archivo de texto más pequeño.`,
        `“${fallbackName}” is over 200 KB; choose a smaller text file.`,
        `«${fallbackName}» pesa mais de 200 KB; escolha um arquivo de texto menor.`,
      );
    }
    const FS = await import("expo-file-system");
    const buf = await new FS.File(asset.uri).arrayBuffer();
    if (buf.byteLength > MAX_PICKED_FILE_BYTES) {
      return L(
        `«${fallbackName}» es demasiado grande para leerlo aquí (máx. 200 KB).`,
        `“${fallbackName}” is too large to read here (max. 200 KB).`,
        `«${fallbackName}» é grande demais para ler aqui (máx. 200 KB).`,
      );
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!text.trim()) return L(`«${fallbackName}» está vacío o no es texto legible.`, `“${fallbackName}” is empty or isn't readable text.`, `«${fallbackName}» está vazio ou não é texto legível.`);
    const shown = text.slice(0, 8000);
    const shownName = asset.name ?? L("sin nombre", "unnamed", "sem nome");
    return `${L(`Archivo «${shownName}»`, `File “${shownName}”`, `Arquivo «${shownName}»`)} (${Math.round(buf.byteLength / 1024)} KB):\n${shown}${text.length > shown.length ? L("\n…(recortado)", "\n…(trimmed)", "\n…(cortado)") : ""}`;
  } catch (e) {
    return `${L("No pude leer el archivo: ", "I couldn't read the file: ", "Não consegui ler o arquivo: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

// ---------------------------------------------------------------- Fase D
// Skills reutilizables e intérprete de datos.

const useSkillHandler: ToolHandler = async (args) => {
  const name = String(args.name ?? "").trim();
  if (!name) {
    const available = listSkills().map((s) => s.name).join(", ");
    return L(`Indica el nombre de la skill. Disponibles: ${available}.`, `Give the skill name. Available: ${available}.`, `Indica o nome da skill. Disponíveis: ${available}.`);
  }
  const skill = loadSkill(name);
  if (!skill) {
    const available = listSkills().map((s) => s.name).join(", ");
    return L(`No conozco la skill «${name}». Disponibles: ${available}.`, `I don't know the skill “${name}”. Available: ${available}.`, `Não conheço a skill «${name}». Disponíveis: ${available}.`);
  }
  // El contenido se presenta como lo que es — el documento de
  // procedimiento de la skill — sin moverlo a un canal confiable.
  return L(
    `Skill «${skill.name}» cargada. Este es su procedimiento:\n\n${skill.instructions}`,
    `Skill “${skill.name}” loaded. Here is its procedure:\n\n${skill.instructions}`,
    `Skill «${skill.name}» carregada. Este é o seu procedimento:\n\n${skill.instructions}`,
  );
};

const analyzeTableHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "");
  if (!text.trim()) return L("Error: falta el texto de la tabla a analizar.", "Error: the table text to analyze is missing.", "Erro: falta o texto da tabela a analisar.");
  if (text.length > 200 * 1024) {
    return L("Error: la tabla supera los 200 KB. Pide al usuario un archivo más pequeño.", "Error: the table exceeds 200 KB. Ask the user for a smaller file.", "Erro: a tabela ultrapassa os 200 KB. Peça ao usuário um arquivo menor.");
  }
  try {
    return analyzeTable(text, {
      filter: args.filter != null ? String(args.filter) : undefined,
      sortBy: args.sort_by != null ? String(args.sort_by) : undefined,
      topN: args.top_n != null ? Number(args.top_n) : undefined,
    });
  } catch (e) {
    return `${L("No pude analizar la tabla: ", "I couldn't analyze the table: ", "Não consegui analisar a tabela: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

// ---------------------------------------------------------------- Fase E
// Mensajería NIDO a NIDO sobre el mensajero en memoria de la costura:
// los mensajes quedan en la cola de salida hasta que exista
// transporte. Nada se finge enviado.

function getNidoMessenger(): NidoMessenger {
  return getSharedNidoMessenger();
}

/**
 * Derivación canónica del payload de nido_send_message: la
 * descripción del diálogo Y el handler usan esta MISMA función
 * (paridad N2 de la fuente).
 */
export function nidoSendMessagePayload(args: Record<string, unknown>): {
  to: string;
  text: string;
} {
  return {
    to: String(args.to ?? "").trim(),
    text: String(args.text ?? "").trim(),
  };
}

const nidoSendMessageHandler: ToolHandler = async (args) => {
  const { to, text } = nidoSendMessagePayload(args);
  if (!to) return L("Error: indica el nombre del contacto NIDO.", "Error: give the NIDO contact name.", "Erro: indica o nome do contato NIDO.");
  if (!text) return L("Error: el mensaje está vacío.", "Error: the message is empty.", "Erro: a mensagem está vazia.");
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    // F-PC68: el destinatario se contrasta contra los contactos
    // emparejados (con la normalización única) antes de encolar:
    // sin contacto que case no se llama a sendChat y se sirve el
    // rechazo verdadero. No es la resolución de transporte de la
    // etapa P2P: es dejar de aceptar lo que la pieza no puede ni
    // guardar con sentido.
    const needle = normalizeContactName(to);
    const paired = (await m.contacts()).some(
      (c) => normalizeContactName(c.name) === needle,
    );
    if (!paired) {
      return L(
        `No tienes ningún contacto NIDO emparejado con el nombre «${to}», así que no he guardado el mensaje. Empareja primero el código de esa persona y vuelve a intentarlo.`,
        `You have no paired NIDO contact named “${to}”, so I didn't save the message. Pair that person's code first, then try again.`,
        `Você não tem nenhum contato NIDO emparelhado com o nome “${to}”, então não salvei a mensagem. Emparelhe primeiro o código dessa pessoa e tente de novo.`,
      );
    }
    const { queued } = await m.sendChat(to, text);
    // F-PC68: la rama de la entrega salió de la pieza (era texto
    // falso inalcanzable: sendChat devuelve siempre queued: true).
    // Un queued: false futuro cae en el error neutro de este
    // handler, sin frase de entrega: la frase nacerá en la etapa
    // P2P, cuando entregar sea una conducta que exista.
    if (!queued) {
      throw new Error(
        L(
          "el mensaje no quedó en la cola de salida",
          "the message was not queued in the outbox",
          "a mensagem não ficou na fila de saída",
        ),
      );
    }
    return L(
      `Mensaje para «${to}» guardado en la cola de salida de esta sesión, sin cifrar. Se queda ahí mientras la app esté abierta: en PC todavía no hay transporte NIDO a NIDO que lo entregue.`,
      `Message for “${to}” saved in this session's outbox, unencrypted. It stays there while the app is open: on PC there is no NIDO-to-NIDO transport yet to deliver it.`,
      `Mensagem para “${to}” salva na fila de saída desta sessão, sem criptografia. Ela fica ali enquanto o app estiver aberto: no PC ainda não há transporte NIDO a NIDO que a entregue.`,
    );
  } catch (e) {
    return `${L("No pude enviar el mensaje NIDO: ", "I couldn't send the NIDO message: ", "Não consegui enviar a mensagem NIDO: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoReadInboxHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    const contacts = await m.contacts();
    const names = new Map(contacts.map((c) => [c.pkHex.toLowerCase(), c.name]));
    const { messages: unread, hiddenTemporal } = await m.readInboxWithHidden();
    const temporalNote =
      hiddenTemporal > 0
        ? L(
            `Hay ${hiddenTemporal} mensaje(s) temporal(es) sin leer: ábrelos en el chat NIDO.`,
            `There are ${hiddenTemporal} unread disappearing message(s): open them in the NIDO chat.`,
            `Há ${hiddenTemporal} mensagem(ns) temporária(s) não lida(s): abra-as no chat NIDO.`,
          )
        : "";
    if (unread.length === 0) return temporalNote || L("No tienes mensajes NIDO sin leer.", "You have no unread NIDO messages.", "Você não tem mensagens NIDO não lidas.");
    return unread
      .map((msg) => {
        const who = names.get(msg.peerPk.toLowerCase()) ?? L("Contacto NIDO", "NIDO contact", "Contato NIDO");
        const when = fmtDateTime(new Date(msg.ts).toISOString());
        if (msg.type === "agent_task" && msg.status === "queued") {
          return (
            `• ${who} (${when}): ${msg.text}\n` +
            L(
              `  Pendiente de tu aprobación — revísala con nido_review_tasks (id ${msg.id}).`,
              `  Pending your approval — review it with nido_review_tasks (id ${msg.id}).`,
              `  Pendente da sua aprovação — revise com nido_review_tasks (id ${msg.id}).`,
            )
          );
        }
        return `• ${who} (${when}): ${msg.text}`;
      })
      .join("\n") + (temporalNote ? `\n${temporalNote}` : "");
  } catch (e) {
    return `${L("No pude leer la bandeja NIDO", "I couldn't read the NIDO inbox", "Não consegui ler a caixa do NIDO")}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoMyCodeHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    const { fingerprint: fp } = await m.ensureIdentity();
    const code = await m.myPairingCode();
    return L(
      `Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\n${code}\nHuella para verificar en persona: ${fp}`,
      `Your NIDO pairing code (show it as a QR so the other phone can scan it):\n${code}\nFingerprint to verify in person: ${fp}`,
      `Seu código de emparelhamento NIDO (mostre-o como QR para que o outro telefone o escaneie):\n${code}\nImpressão digital para verificar em pessoa: ${fp}`,
    );
  } catch (e) {
    return `${L("No pude generar tu código: ", "I couldn't generate your code: ", "Não consegui gerar seu código: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoPairHandler: ToolHandler = async (args) => {
  const code = String(args.code ?? "").trim();
  if (!code) return L("Error: falta el código del otro NIDO.", "Error: the other NIDO's code is missing.", "Erro: falta o código do outro NIDO.");
  const t = agentConfirmT();
  const rawChoice = String(args.disambiguation ?? "").trim().toLowerCase();
  const disambiguation =
    rawChoice === ""
      ? undefined
      : rawChoice === "replace" || rawChoice === "different_person" || rawChoice === "cancel"
        ? rawChoice
        : "invalid";
  if (disambiguation === "invalid") {
    return t("agentConfirm.pairInvalidChoice", { choice: String(args.disambiguation) });
  }
  const newName = String(args.new_name ?? "").trim();
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    let replaceTargets: string[] | undefined;
    if (disambiguation === "replace") {
      try {
        const payload = decodePairingPayload(code);
        const collision = await findPairingCollision(
          payload.pk,
          payload.name,
          () => m.contacts(),
        );
        replaceTargets = (collision ?? []).map((c) => c.pkHex);
      } catch {
        // F-PC71: sin conjunto confirmado no hay replace. La
        // consulta que lo fija es parte de la confirmación, no un
        // adorno opcional: si lanza, la operación se cierra con el
        // mismo texto que sirve la StaleReplaceConflictError, sin
        // llamar a pairWith.
        return L(
          "No pude emparejar: la identidad que se pretendía reemplazar ya fue retirada por otro emparejamiento. Nada se escribió. Revisa tus contactos y, si aún quieres emparejar este código, hazlo de nuevo con la información actualizada.",
          "I couldn't pair: the identity that was to be replaced was already retired by another pairing. Nothing was written. Check your contacts and, if you still want to pair this code, do it again with the updated information.",
          "Não consegui emparelhar: a identidade que se pretendia substituir já foi retirada por outro emparelhamento. Nada foi escrito. Verifique seus contatos e, se ainda quiser emparelhar este código, faça de novo com as informações atualizadas.",
        );
      }
    }
    const contact = await m.pairWith(
      code,
      disambiguation ? { disambiguation, newName, replaceTargets } : undefined,
    );
    // null = el usuario eligió "cancel": nada se escribió.
    if (!contact) return t("agentConfirm.pairCancelled");
    const replacedNote =
      disambiguation === "replace"
        ? L(
            ` La identidad anterior salió de tu lista de contactos. Los mensajes que tuvieras en la cola de salida para el nombre «${contact.name}» siguen en la cola bajo ese nombre.`,
            ` The previous identity left your contact list. Any messages you had in the outbox for the name “${contact.name}” stay in the outbox under that name.`,
            ` A identidade anterior saiu da sua lista de contatos. As mensagens que você tinha na fila de saída para o nome “${contact.name}” continuam na fila com esse nome.`,
          )
        : "";
    return L(
      `Contacto «${contact.name}» emparejado, sin verificar todavía. Queda en tu lista de contactos de esta sesión. Para verificarlo, comparen la huella en persona.${replacedNote}`,
      `Contact “${contact.name}” paired, not verified yet. It stays in this session's contact list. To verify it, compare the fingerprint in person.${replacedNote}`,
      `Contato «${contact.name}» emparelhado, ainda não verificado. Ele fica na sua lista de contatos desta sessão. Para verificar, comparem a impressão digital em pessoa.${replacedNote}`,
    );
  } catch (e) {
    if (e instanceof StaleReplaceConflictError) {
      return L(
        "No pude emparejar: la identidad que se pretendía reemplazar ya fue retirada por otro emparejamiento. Nada se escribió. Revisa tus contactos y, si aún quieres emparejar este código, hazlo de nuevo con la información actualizada.",
        "I couldn't pair: the identity that was to be replaced was already retired by another pairing. Nothing was written. Check your contacts and, if you still want to pair this code, do it again with the updated information.",
        "Não consegui emparelhar: a identidade que se pretendia substituir já foi retirada por outro emparelhamento. Nada foi escrito. Verifique seus contatos e, se ainda quiser emparelhar este código, faça de novo com as informações atualizadas.",
      );
    }
    if (e instanceof PairingKeyChangedError) {
      // F-PC73: el aviso propio de la clave cambiada, por L().
      return L(
        "La clave de firma de este contacto cambió y no he guardado nada. Si no lo esperabas, no continúes: alguien podría estar haciéndose pasar por tu contacto. Si sabes que reinstaló NIDO, empareja de nuevo comparando la huella en persona.",
        "This contact's signing key changed and I saved nothing. If you didn't expect that, do not continue: someone could be impersonating your contact. If you know they reinstalled NIDO, pair again comparing the fingerprint in person.",
        "A chave de assinatura deste contato mudou e eu não salvei nada. Se você não esperava isso, não continue: alguém pode estar se passando pelo seu contato. Se você sabe que ele reinstalou o NIDO, emparelhe de novo comparando a impressão digital pessoalmente.",
      );
    }
    if (e instanceof PairingDisambiguationRequiredError) {
      let payloadName = "?";
      let fp = "?";
      try {
        const payload = decodePairingPayload(code);
        payloadName = payload.name;
        fp = fingerprint(fromHex(payload.pk), payload.spk ? fromHex(payload.spk) : null);
      } catch {
        return `${L("No pude emparejar: ", "I couldn't pair: ", "Não consegui emparelhar: ")}${e instanceof Error ? e.message : String(e)}`;
      }
      const candidates = e.candidates.map((c) => `«${c.name}»`).join(", ");
      return t("agentConfirm.pairAmbiguousAsk", {
        name: payloadName,
        fingerprint: fp,
        count: String(e.candidates.length),
        candidates,
      });
    }
    return `${L("No pude emparejar: ", "I couldn't pair: ", "Não consegui emparelhar: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

/** Handlers listos para inyectar en runAgentLoop(). */
export function buildToolHandlers(opts?: {
  /** Canal de confirmación (la UI lo inyecta con su diálogo). */
  requestConfirm?: RequestConfirm;
}): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {
    device_time: deviceTime,
    save_note: saveNoteHandler,
    list_notes: listNotesHandler,
    read_note: readNoteHandler,
    delete_note: deleteNoteHandler,
    create_reminder: createReminderHandler,
    delete_reminder: deleteReminderHandler,
    delete_memory: deleteMemoryHandler,
    remember_fact: rememberFactHandler,
    save_person: savePersonHandler,
    // propose_negotiation NO se registra (P-09 de la fuente): nunca
    // estuvo en el manifiesto y la negociación es territorio P2P.
    open_app: withConfirmation(
      "open_app",
      openAppHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const c = classifyOpenAppTarget(args.link);
        if (!c.ok) {
          return {
            tool: "open_app",
            title: t("agentConfirm.openAppTitle"),
            message: t("agentConfirm.openAppRejected", {
              reason: t(openAppRejectReasonKey(c.reason)),
            }),
            scope: t("agentConfirm.scopeOpenAppRejected"),
          };
        }
        return {
          tool: "open_app",
          title: t("agentConfirm.openAppTitle"),
          message: t("agentConfirm.openAppMessage", { target: c.normalized }),
          scope: t("agentConfirm.scopeOpenApp", { target: c.normalized }),
        };
      },
    ),
    // Fase B
    calculate: calculateHandler,
    convert_units: convertUnitsHandler,
    create_calendar_event: withConfirmation(
      "create_calendar_event",
      createCalendarEventHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const title = String(args.title ?? "").trim();
        const start = fmtDialogWhen(String(args.start ?? "").trim());
        const end = args.end ? fmtDialogWhen(String(args.end).trim()) : "";
        return {
          tool: "create_calendar_event",
          title: t("agentConfirm.createEventTitle"),
          message: end
            ? t("agentConfirm.createEventMessageWithEnd", { title, start, end })
            : t("agentConfirm.createEventMessage", { title, start }),
          scope: t("agentConfirm.scopeCreateEvent", { title, start }),
        };
      },
    ),
    list_calendar_events: listCalendarEventsHandler,
    find_contact: findContactHandler,
    read_picked_file: readPickedFileHandler, // el picker del sistema confirma
    // Fase D
    use_skill: useSkillHandler,
    analyze_table: analyzeTableHandler,
    // Fase E
    nido_send_message: withConfirmation(
      "nido_send_message",
      nidoSendMessageHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const payload = nidoSendMessagePayload(args);
        return {
          tool: "nido_send_message",
          title: t("agentConfirm.sendMessageTitle"),
          message: t("agentConfirm.sendMessageMessage", {
            to: payload.to,
            text: payload.text,
          }),
          scope: t("agentConfirm.scopeSendMessage", { to: payload.to }),
        };
      },
    ),
    nido_read_inbox: nidoReadInboxHandler,
    nido_my_code: nidoMyCodeHandler,
    nido_pair: withConfirmation(
      "nido_pair",
      nidoPairHandler,
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const code = String(args.code ?? "").trim();
        const choice = String(args.disambiguation ?? "").trim().toLowerCase();
        const newName = String(args.new_name ?? "").trim();
        try {
          const payload = decodePairingPayload(code);
          const fp = fingerprint(fromHex(payload.pk), payload.spk ? fromHex(payload.spk) : null);
          const warning = await pairingBindingWarning(
            t,
            payload.pk,
            payload.name,
            () => getNidoMessenger().contacts(),
          );
          let revivalNote = "";
          try {
            const anyRow = await findContactRowAny(payload.pk);
            if (anyRow && anyRow.supersededBy) {
              revivalNote = t("agentConfirm.pairBindingWasRetired", { name: anyRow.name });
            }
          } catch {
            revivalNote = "";
          }
          const fullWarning = [warning, revivalNote].filter(Boolean).join("\n");
          const collision = await findPairingCollision(
            payload.pk,
            payload.name,
            () => getNidoMessenger().contacts(),
          );
          if (collision && !choice) {
            const candidates = collision.map((c) => `«${c.name}»`).join(", ");
            return {
              tool: "nido_pair",
              title: t("agentConfirm.pairDisambiguationTitle"),
              message: t("agentConfirm.pairAmbiguousAsk", {
                name: payload.name,
                fingerprint: fp,
                count: String(collision.length),
                candidates,
              }),
              scope: t("agentConfirm.scopePair", { name: payload.name, fingerprint: fp }),
            };
          }
          let message =
            t("agentConfirm.pairMessage", {
              name: payload.name,
              fingerprint: fp,
            }) + (fullWarning ? `\n\n${fullWarning}` : "");
          if (choice === "replace") {
            message +=
              "\n\n" +
              t("agentConfirm.pairReplaceConfirmMessage", {
                name: payload.name,
                fingerprint: fp,
              });
          } else if (choice === "different_person") {
            message +=
              "\n\n" +
              t("agentConfirm.pairDifferentPersonConfirmMessage", {
                name: payload.name,
                fingerprint: fp,
                newName: newName || payload.name,
              });
          } else if (choice === "cancel") {
            message += `\n\n${t("agentConfirm.pairCancelled")}`;
          }
          return {
            tool: "nido_pair",
            title: choice
              ? t("agentConfirm.pairDisambiguationTitle")
              : t("agentConfirm.pairTitle"),
            message,
            scope: t("agentConfirm.scopePair", { name: payload.name, fingerprint: fp }),
          };
        } catch {
          // QR inválido: se muestra igual el diálogo y el handler
          // devolverá el error concreto si el usuario confirma.
          return {
            tool: "nido_pair",
            title: t("agentConfirm.pairTitle"),
            message: t("agentConfirm.pairInvalidCode"),
            scope: t("agentConfirm.scopePairInvalid"),
          };
        }
      },
    ),
    // M-6: bandeja de aprobación de tareas remotas encoladas.
    nido_review_tasks: async () => {
      const t = agentConfirmT();
      const pending = await listPendingAgentTasks();
      if (pending.length === 0) return t("agentTasks.reviewEmpty");
      return (
        t("agentTasks.reviewHeader", { count: String(pending.length) }) +
        "\n" +
        pending
          .map((task) => {
            const when = fmtDateTime(new Date(task.receivedAt).toISOString());
            return t("agentTasks.reviewItem", {
              id: task.id,
              sender: task.senderName,
              pkShort: task.senderPkShort,
              action: task.actionText,
              when,
            });
          })
          .join("\n") +
        "\n" +
        t("agentTasks.reviewFooter")
      );
    },
    nido_approve_task: withConfirmation(
      "nido_approve_task",
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        if (!id) return t("agentTasks.decideMissingId");
        const ok = await approveAgentTask(id);
        return ok
          ? t("agentTasks.decideApproved", { id })
          : t("agentTasks.decideNotFound", { id });
      },
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        const task = id ? await getPendingAgentTask(id) : null;
        if (!task) {
          return {
            tool: "nido_approve_task",
            title: t("agentConfirm.approveTaskTitle"),
            message: t("agentConfirm.taskNotFound"),
            scope: t("agentConfirm.scopeTaskNotFound"),
          };
        }
        return {
          tool: "nido_approve_task",
          title: t("agentConfirm.approveTaskTitle"),
          message: t("agentConfirm.approveTaskMessage", {
            sender: `${task.senderName} (${task.senderPkShort}…)`,
            action: task.actionText,
            when: fmtDateTime(new Date(task.receivedAt).toISOString()),
          }),
          scope: t("agentConfirm.scopeTask", { sender: task.senderName }),
        };
      },
    ),
    nido_reject_task: withConfirmation(
      "nido_reject_task",
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        if (!id) return t("agentTasks.decideMissingId");
        const ok = await rejectAgentTask(id);
        return ok
          ? t("agentTasks.decideRejected", { id })
          : t("agentTasks.decideNotFound", { id });
      },
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        const task = id ? await getPendingAgentTask(id) : null;
        if (!task) {
          return {
            tool: "nido_reject_task",
            title: t("agentConfirm.rejectTaskTitle"),
            message: t("agentConfirm.taskNotFound"),
            scope: t("agentConfirm.scopeTaskNotFound"),
          };
        }
        return {
          tool: "nido_reject_task",
          title: t("agentConfirm.rejectTaskTitle"),
          message: t("agentConfirm.rejectTaskMessage", {
            sender: `${task.senderName} (${task.senderPkShort}…)`,
            action: task.actionText,
          }),
          scope: t("agentConfirm.scopeTask", { sender: task.senderName }),
        };
      },
    ),
  };
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // Contrato manifiesto <-> handlers: ninguna herramienta declarada
    // debe quedarse sin implementación real.
    for (const tool of LOCAL_TOOLS) {
      if (!handlers[tool.name]) {
        console.warn(`[handlers] herramienta sin handler real: ${tool.name}`);
      }
    }
  }
  return handlers;
}
