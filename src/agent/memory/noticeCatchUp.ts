/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeCatchUp.ts — la pasada de recuperación de E8
 * (AVISOS-ETAPA §4.3): lo que la etapa hace en cada retorno a
 * la vida (arranque de la app, desbloqueo de la bóveda,
 * vuelta de suspensión, salto de reloj detectado) con lo que
 * debió sonar y no sonó.
 *
 * El trato por familia, contra la cola de noticeStore (la
 * única escritura):
 *
 * - Único vencido: se presenta como perdido con su antigüedad
 *   y la fila queda `missed` en la lista hasta que la persona
 *   la descarta o la reprograma. Nunca suena como si nada a
 *   otra hora y nunca se pierde en silencio.
 * - Serie vencida: se presenta una sola vez la ocurrencia más
 *   reciente como perdida (una fila de presentación), se anota
 *   `missed_count` con las saltadas y la serie queda armada en
 *   la siguiente estrictamente futura. Nada de ráfagas.
 * - Temporizador vencido: se anuncia como vencido y la fila
 *   queda `fired`, persistente hasta descarte expreso (§6).
 * - Cumpleaños: pasado reciente de 7 días (§7.3): dentro de la
 *   ventana se presenta como «fue el cumpleaños de…»; fuera,
 *   la serie se archiva en silencio a su siguiente año.
 * - Tarea: no se presenta ni se transiciona aquí; se devuelve
 *   en `tasksDue` para que el disparo de tareas del paso 8 la
 *   corra una sola vez (o la deje esperando desbloqueo).
 *
 * La pasada es idempotente: correrla dos veces seguidas no
 * presenta nada la segunda (T-8). Cada presentación se
 * persiste ANTES de entregarla al sumidero (el canal del SO
 * del despacho, §5.4: un resumen para varios perdidos), y un
 * fallo del sumidero no deshace lo persistido ni detiene al
 * resto: se devuelve con su causa.
 */

import {
  advanceAfterFire,
  advanceSeriesAfterMiss,
  getNotice,
  listMissed,
  listSnoozedDue,
  markMissed,
  recordPresentation,
  type Notice,
} from "./noticeStore.js";

/** La ventana de pasado reciente de un cumpleaños (§7.3). */
export const BIRTHDAY_RECENT_MS = 7 * 24 * 3600 * 1000;

export type CatchUpTreatment =
  | "missed"
  | "missed-series"
  | "timer-expired"
  | "birthday-recent";

export interface CatchUpItem {
  /** La fila que la vista de Avisos enseña (la de presentación en las series). */
  notice: Notice;
  treatment: CatchUpTreatment;
  /** Cuánto tarde va la ocurrencia presentada, en ms. */
  ageMs: number;
  /** Ocurrencias saltadas más allá de la presentada (series). */
  skipped: number;
}

export interface CatchUpResult {
  presented: CatchUpItem[];
  /** Tareas debidas, sin tocar: las corre el disparo del paso 8. */
  tasksDue: Notice[];
  sinkFailures: Array<{ notice: Notice; error: string }>;
}

export async function runCatchUpPass(
  nowMs: number,
  sink: (item: CatchUpItem) => Promise<void> | void,
): Promise<CatchUpResult> {
  // Los debidos: los armados vencidos y los pospuestos cuyo
  // momento llegó mientras no había nadie (su instante es el
  // snooze_until, que next_fire_at ya espeja).
  const due = [...(await listMissed(nowMs)), ...(await listSnoozedDue(nowMs))].sort(
    (a, b) => a.nextFireAt - b.nextFireAt,
  );
  const presented: CatchUpItem[] = [];
  const tasksDue: Notice[] = [];
  const sinkFailures: Array<{ notice: Notice; error: string }> = [];
  const deliver = async (item: CatchUpItem): Promise<void> => {
    presented.push(item);
    try {
      await sink(item);
    } catch (e) {
      sinkFailures.push({
        notice: item.notice,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  for (const notice of due) {
    if (notice.kind === "task") {
      tasksDue.push(notice);
      continue;
    }
    if (notice.kind === "timer") {
      const after = await advanceAfterFire(notice.id, notice.nextFireAt);
      if (after) {
        await deliver({
          notice: after,
          treatment: "timer-expired",
          ageMs: nowMs - notice.nextFireAt,
          skipped: 0,
        });
      }
      continue;
    }
    if (notice.repeat) {
      const advanced = await advanceSeriesAfterMiss(notice.id, nowMs);
      if (!advanced) continue;
      const ageMs = nowMs - advanced.presentedAt;
      if (notice.kind === "birthday") {
        if (ageMs > BIRTHDAY_RECENT_MS) continue; // archivado en silencio
        const row = await recordPresentation(notice, advanced.presentedAt, "missed", nowMs);
        await deliver({
          notice: row,
          treatment: "birthday-recent",
          ageMs,
          skipped: advanced.skipped,
        });
        continue;
      }
      const row = await recordPresentation(notice, advanced.presentedAt, "missed", nowMs);
      await deliver({
        notice: row,
        treatment: "missed-series",
        ageMs,
        skipped: advanced.skipped,
      });
      continue;
    }
    // Único vencido (recordatorio o evento sin repetición).
    if (await markMissed(notice.id)) {
      const row = (await getNotice(notice.id)) ?? notice;
      await deliver({
        notice: row,
        treatment: "missed",
        ageMs: nowMs - notice.nextFireAt,
        skipped: 0,
      });
    }
  }
  return { presented, tasksDue, sinkFailures };
}
