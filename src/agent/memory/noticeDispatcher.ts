/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeDispatcher.ts — el despacho con la app abierta de E8
 * (AVISOS-ETAPA §5): la pasada que dispara a su hora lo que
 * acaba de vencer, por los dos canales de siempre.
 *
 * El orden es el de la etapa y no se negocia:
 *
 * 1. Primero se persiste el canal interno: la serie avanza y
 *    su fila de presentación queda guardada (o el único queda
 *    `fired`) ANTES de llamar al canal del SO. Un fallo al
 *    notificar no pierde la repetición (T-11).
 * 2. La comprobación del efecto (la idea con sede en esta
 *    etapa): lo avanzado se re-lee del almacén y solo si la
 *    transición quedó persistida se cuenta como despachado y
 *    se llama al SO. Un efecto no confirmado vuelve como
 *    fallo con su causa, nunca como éxito.
 * 3. El canal del SO recibe el contenido de §5.3: el texto del
 *    aviso solo con la bóveda abierta y el ajuste de enseñar
 *    texto encendido; en cualquier otro caso, el genérico por
 *    familia, sin texto ni nombres (T-10). Un lanzamiento del
 *    SO nunca se propaga: la presentación interna ya quedó.
 *
 * Lo vencido con más de un minuto no es de esta pasada: es de
 * la recuperación (noticeCatchUp), que lo presenta diciendo
 * que va tarde. Las tareas no se despachan aquí: su disparo
 * es el del paso 8.
 */

import type { CatchUpItem } from "./noticeCatchUp.js";
import { markPreFired, readNoticeAgenda } from "./noticeAgenda.js";
import {
  advanceAfterFire,
  getNotice,
  listMissed,
  listSnoozedDue,
  recordPresentation,
  type Notice,
  type NoticeKind,
} from "./noticeStore.js";

/** Más tarde que esto ya no es «a su hora»: es recuperación. */
export const ON_TIME_MS = 60 * 1000;

export type NoticeAction = "done" | "snooze" | "view" | "discard";

export interface OsPayload {
  title: string;
  body: string;
  noticeId: string;
  kind: NoticeKind;
  actions: NoticeAction[];
}

/**
 * Los textos del despacho, inyectados: el tiempo de ejecución
 * los sirve desde las cadenas de la app en el idioma de la
 * persona; la batería, desde sus literales. Ningún texto
 * genérico lleva datos de la persona, por construcción.
 */
export interface DispatchTexts {
  kindTitle(kind: NoticeKind): string;
  genericBody(kind: NoticeKind): string;
  summaryTitle(count: number): string;
  summaryBody(count: number): string;
  /**
   * E8 (paso 7): «{name} cumple {count} años», solo si la
   * memoria guarda el año. Opcional: sin esta pieza, el
   * aviso de cumpleaños lleva el nombre a secas.
   */
  birthdayAge?(name: string, age: number): string;
}

export interface DispatchDeps {
  vaultOpen: boolean;
  /** El ajuste «enseñar el texto en las notificaciones» (§5.3). */
  showText: boolean;
  texts: DispatchTexts;
  osSink(payload: OsPayload): Promise<void> | void;
}

export interface DispatchResult {
  /** Las filas presentadas (la de presentación en las series). */
  fired: Notice[];
  failed: Array<{ notice: Notice; error: string }>;
  /** Fallos del canal del SO: la presentación interna ya quedó. */
  osFailures: Array<{ notice: Notice; error: string }>;
}

/** El texto propio de un aviso, el que solo viaja con permiso. */
export function noticeOwnText(notice: Notice, texts?: DispatchTexts): string {
  const b = notice.body;
  if (b && typeof b === "object") {
    const r = b as Record<string, unknown>;
    for (const f of ["text", "title", "name"]) {
      if (typeof r[f] === "string" && r[f] !== "") {
        const own = r[f] as string;
        // E8 (paso 7): la edad del cumpleaños, solo con el
        // año guardado y la pieza de texto presente. La edad
        // es cuenta de fechas: el año de la ocurrencia (su
        // base local) menos el de nacimiento; sin año no se
        // inventa edad ni se resta nada.
        if (notice.kind === "birthday" && texts?.birthdayAge) {
          const year = r.birthdayYear;
          const occYear = Number(notice.baseLocal.slice(0, 4));
          if (typeof year === "number" && Number.isFinite(occYear) && occYear > year) {
            return texts.birthdayAge(own, occYear - year);
          }
        }
        return own;
      }
    }
  }
  return "";
}

/** Las acciones que un aviso ofrece, por familia (§5.2 y §6). */
export function noticeActions(notice: Notice): NoticeAction[] {
  if (notice.kind === "timer") return ["discard", "view"];
  if (notice.kind === "task") return ["view"];
  return ["done", "snooze", "view"];
}

/**
 * Compone la carga del canal del SO para un aviso: el título
 * es el de su familia (sin datos) y el cuerpo es el texto
 * propio solo si el contenido va con texto; si no, el
 * genérico de su familia.
 */
export function composeOsPayload(
  notice: Notice,
  withText: boolean,
  texts: DispatchTexts,
): OsPayload {
  return {
    title: texts.kindTitle(notice.kind),
    body: withText ? noticeOwnText(notice, texts) : texts.genericBody(notice.kind),
    noticeId: notice.id,
    kind: notice.kind,
    actions: noticeActions(notice),
  };
}

/**
 * La agrupación de §5.4 para la pasada de recuperación: con
 * varios perdidos, el canal del SO recibe UNA carga resumen;
 * con uno solo, la suya; con ninguno, ninguna. El canal
 * interno los lista siempre todos (eso es la pasada misma).
 */
export function summarizeCatchUp(
  items: CatchUpItem[],
  withText: boolean,
  texts: DispatchTexts,
): OsPayload[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [composeOsPayload(items[0].notice, withText, texts)];
  return [
    {
      title: texts.summaryTitle(items.length),
      body: texts.summaryBody(items.length),
      noticeId: items[0].notice.id,
      kind: items[0].notice.kind,
      actions: ["view"],
    },
  ];
}

export async function runDispatchPass(
  nowMs: number,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const due = [...(await listMissed(nowMs)), ...(await listSnoozedDue(nowMs))]
    .filter((n) => n.kind !== "task")
    .filter((n) => nowMs - n.nextFireAt <= ON_TIME_MS)
    .sort((a, b) => a.nextFireAt - b.nextFireAt);
  const fired: Notice[] = [];
  const failed: Array<{ notice: Notice; error: string }> = [];
  const osFailures: Array<{ notice: Notice; error: string }> = [];
  const withText = deps.vaultOpen && deps.showText;
  for (const notice of due) {
    const firedAt = notice.nextFireAt;
    // 1 · El canal interno primero: la transición, persistida.
    const after = await advanceAfterFire(notice.id, firedAt);
    if (!after) {
      failed.push({ notice, error: "la fila ya no estaba armada al despachar" });
      continue;
    }
    let presented: Notice = after;
    if (notice.repeat) {
      presented = await recordPresentation(after, firedAt, "fired", nowMs);
    }
    // 2 · La comprobación del efecto: re-leer antes de contar.
    const check = await getNotice(notice.id);
    const persisted = notice.repeat
      ? check !== null &&
        check.state === "armed" &&
        check.nextFireAt > firedAt &&
        (await getNotice(presented.id))?.state === "fired"
      : check !== null && check.state === "fired";
    if (!persisted) {
      failed.push({ notice, error: "el efecto del disparo no quedó persistido" });
      continue;
    }
    fired.push(presented);
    // 3 · El canal del SO: su fallo nunca se propaga.
    try {
      await deps.osSink(composeOsPayload(presented, withText, deps.texts));
    } catch (e) {
      osFailures.push({
        notice: presented,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { fired, failed, osFailures };
}

export interface PrePassResult {
  /** Las series cuyo previo se entregó en esta pasada. */
  presented: Notice[];
}

/**
 * E8 (paso 7): la pasada del previo del cumpleaños (§7). El
 * previo vive solo en la agenda como ocurrencia derivada de
 * la serie; esta pasada lo entrega al canal del SO cuando su
 * instante llega y la ocurrencia principal aún está por
 * venir, y lo marca como entregado en la propia agenda (la
 * marca es su consumo: sin ella se repetiría en cada
 * despertar). No crea ninguna fila: el registro del
 * cumpleaños es su aviso principal. Si el principal ya pasó,
 * el previo caducó en silencio: lo trata la recuperación como
 * pasado reciente, no esta pasada.
 */
export async function runPrePass(nowMs: number, deps: DispatchDeps): Promise<PrePassResult> {
  const presented: Notice[] = [];
  const agenda = await readNoticeAgenda();
  const due = agenda.entries.filter((e) => e.pre === true && e.nextFireAt <= nowMs);
  for (const entry of due) {
    if (agenda.preFiredFor[entry.id] !== undefined) continue;
    const series = await getNotice(entry.id);
    if (!series || series.kind !== "birthday" || series.state !== "armed") continue;
    if (series.nextFireAt <= nowMs) continue;
    await markPreFired(series.id, series.nextFireAt);
    try {
      await deps.osSink(composeOsPayload(series, deps.vaultOpen && deps.showText, deps.texts));
    } catch {
      // El canal del SO nunca tumba la pasada; el previo ya
      // quedó marcado como entregado en la agenda.
    }
    presented.push(series);
  }
  return { presented };
}
