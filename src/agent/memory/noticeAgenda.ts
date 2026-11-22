/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeAgenda.ts — la agenda de disparo de E8 (AVISOS-ETAPA
 * §3.2): la segunda capa de la cola de avisos, fuera de la
 * bóveda, en un fichero propio cifrado con la clave de máquina.
 *
 * Contiene solo lo que el ejecutor necesita para saber qué
 * vence y cuándo con la bóveda bloqueada: `id`, `kind` y
 * `next_fire_at` de cada aviso armado, más la lista de ids que
 * dispararon con la bóveda bloqueada (`pending`, que la pasada
 * de desbloqueo presenta enteros). Sin texto, sin nombres, sin
 * instrucciones: es el equivalente exacto de lo que Android
 * sabe de una alarma del móvil, cuándo suena y no qué dice. Su
 * nivel de custodia es menor que el de la bóveda y se declara
 * en Ajustes, en la fila del ejecutor (paso 6).
 *
 * La verdad sigue siendo la base cifrada: esta capa es un
 * espejo derivado. noticeStore sincroniza tras cada escritura
 * suya y la reconciliación (en noticeStore) repone cualquier
 * divergencia en los dos sentidos. Sin configurar (ninguna
 * batería de E7 la configura) todo es un no-op silencioso y la
 * conducta de la cola es la de E7.
 *
 * El cifrado se inyecta: la producción lo respalda con
 * safeStorage del SO (app/electron/noticeRuntime.ts) y declara
 * su nivel; aquí solo se exige que selle y abra.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NoticeKind } from "./noticeStore.js";

export interface NoticeAgendaEntry {
  id: string;
  kind: NoticeKind;
  nextFireAt: number;
  /**
   * E8 (paso 7): la ocurrencia previa derivada de un
   * cumpleaños (§7): vive solo en la agenda, con el mismo id
   * de la serie; no es una segunda fila de la base.
   */
  pre?: boolean;
}

export interface NoticeAgendaData {
  entries: NoticeAgendaEntry[];
  /** Ids que dispararon con la bóveda bloqueada, por presentar. */
  pending: string[];
  /**
   * E8 (paso 7): por serie, el instante principal para el que
   * su previo ya se entregó (la marca de consumo del derivado:
   * sin ella, cada despertar lo repetiría).
   */
  preFiredFor: Record<string, number>;
}

export interface NoticeAgendaCipher {
  seal(plainUtf8: string): Promise<string> | string;
  unseal(sealed: string): Promise<string | null> | string | null;
}

export interface NoticeAgendaConfig {
  filePath: string;
  cipher: NoticeAgendaCipher;
}

let config: NoticeAgendaConfig | null = null;

/**
 * Configura la agenda (la carcasa al arrancar; las baterías con
 * su doble). `null` la desconfigura: vuelve el no-op de E7.
 */
export function configureNoticeAgenda(cfg: NoticeAgendaConfig | null): void {
  config = cfg;
}

export function noticeAgendaConfigured(): boolean {
  return config !== null;
}

const EMPTY: NoticeAgendaData = { entries: [], pending: [], preFiredFor: {} };

/**
 * Lee la agenda. Sin configurar, sin fichero o con un contenido
 * que no abre o no parsea, devuelve la agenda vacía: la
 * reconciliación contra la base la repone, y un fichero
 * corrupto nunca deja al ejecutor peor que sin agenda.
 */
export async function readNoticeAgenda(): Promise<NoticeAgendaData> {
  if (!config) return { entries: [], pending: [], preFiredFor: {} };
  try {
    const sealed = await readFile(config.filePath, "utf8");
    const plain = await config.cipher.unseal(sealed);
    if (plain == null) return { entries: [], pending: [], preFiredFor: {} };
    const parsed = JSON.parse(plain) as Partial<NoticeAgendaData>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(
          (e): e is NoticeAgendaEntry =>
            !!e &&
            typeof e.id === "string" &&
            typeof e.kind === "string" &&
            typeof e.nextFireAt === "number",
        )
      : [];
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter((p): p is string => typeof p === "string")
      : [];
    const preFiredFor: Record<string, number> = {};
    if (parsed.preFiredFor && typeof parsed.preFiredFor === "object") {
      for (const [k, v] of Object.entries(parsed.preFiredFor)) {
        if (typeof v === "number") preFiredFor[k] = v;
      }
    }
    return { entries, pending, preFiredFor };
  } catch {
    return { entries: [], pending: [], preFiredFor: {} };
  }
}

/** Escribe la agenda entera, atómico por renombre. */
export async function writeNoticeAgenda(data: NoticeAgendaData): Promise<void> {
  if (!config) return;
  const plain = JSON.stringify({
    v: 1,
    entries: data.entries,
    pending: data.pending,
    preFiredFor: data.preFiredFor,
  });
  const sealed = await config.cipher.seal(plain);
  await mkdir(dirname(config.filePath), { recursive: true });
  const tmp = `${config.filePath}.tmp`;
  await writeFile(tmp, sealed, "utf8");
  await rename(tmp, config.filePath);
}

/**
 * Sincroniza las entradas con el conjunto dado (el espejo de
 * los armados de la base), conservando la lista `pending` y
 * las marcas de previo entregado que sigan vivas (las de una
 * ocurrencia que ya no es la siguiente se podan solas).
 * Nunca lanza: un fallo de escritura lo repone la
 * reconciliación, y el llamante (noticeStore tras su
 * transacción) no debe fallar por la capa derivada.
 */
export async function syncNoticeAgenda(entries: NoticeAgendaEntry[]): Promise<void> {
  if (!config) return;
  try {
    const current = await readNoticeAgenda();
    const live = new Map(entries.filter((e) => !e.pre).map((e) => [e.id, e.nextFireAt]));
    const preFiredFor: Record<string, number> = {};
    for (const [id, mainAt] of Object.entries(current.preFiredFor)) {
      if (live.get(id) === mainAt) preFiredFor[id] = mainAt;
    }
    await writeNoticeAgenda({ entries, pending: current.pending, preFiredFor });
  } catch {
    // La base manda: la divergencia la reconcilia la pasada.
  }
}

/** Sustituye la lista de disparados con la bóveda bloqueada. */
export async function setAgendaPending(ids: string[]): Promise<void> {
  if (!config) return;
  try {
    const current = await readNoticeAgenda();
    await writeNoticeAgenda({ entries: current.entries, pending: ids, preFiredFor: current.preFiredFor });
  } catch {
    // Como arriba: la capa derivada nunca rompe al llamante.
  }
}

/**
 * E8 (paso 7): marca el previo de una serie como entregado
 * para su ocurrencia principal dada. La sincronización poda
 * la marca cuando la serie avanza a otra ocurrencia.
 */
export async function markPreFired(seriesId: string, mainAt: number): Promise<void> {
  if (!config) return;
  try {
    const current = await readNoticeAgenda();
    await writeNoticeAgenda({
      entries: current.entries,
      pending: current.pending,
      preFiredFor: { ...current.preFiredFor, [seriesId]: mainAt },
    });
  } catch {
    // La capa derivada nunca rompe al llamante.
  }
}

/** Borra el fichero de la agenda (la pierna de T-19). */
export async function wipeNoticeAgenda(): Promise<void> {
  if (!config) return;
  await rm(config.filePath, { force: true });
}
