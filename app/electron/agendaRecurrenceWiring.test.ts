/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * CARGO-2 · la recurrencia importada gana sus
 * consumidores, probado por los canales reales y por el
 * almacén de avisos:
 *
 * 7. Una semanal con COUNT y VALARM arma UNA fila de
 *    aviso con la repetición y el fin de la serie
 *    (`endsAt` = el instante de disparo de la última
 *    ocurrencia), no un aviso suelto.
 * 8. `advanceAfterFire` avanza la serie y la cierra al
 *    pasar del fin: las tres primeras ocurrencias la
 *    dejan armada con el siguiente instante; la cuarta
 *    la deja `fired` y fuera de la agenda.
 * 9. La recuperación de perdidos también conoce el
 *    fin: pasada la serie entera presenta la última
 *    debida con su conteo de saltadas y cierra la fila
 *    en `done`.
 * 10. Una serie ya acabada no se arma, y su mirada
 *     atrás sí se enseña expandida en la Agenda.
 * 11. La lista de la Agenda expande la serie dentro de
 *     la ventana enseñada: la ocurrencia de la semana
 *     que viene va marcada y la fila declara su
 *     repetición (`repeatKey`).
 * 12. El chat encuentra la ocurrencia por su fecha: un
 *     rango que no contiene la primera fecha del evento
 *     nombra el evento con la fecha de su ocurrencia.
 * 13. No regresión: recurrente sin VALARM no crea fila
 *     en la cola y el evento está presente.
 * 14. No regresión: evento único con VALARM arma la
 *     fila de siempre y la lista lo devuelve intacto.
 *
 * Las fechas de las fixtures se construyen relativas al
 * ahora real: la ventana enseñada del canal y el armado
 * del aviso dependen de `Date.now()`.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
  },
  BrowserWindow: {
    fromWebContents: () => ({
      isDestroyed: () => false,
      webContents: { send: () => undefined },
    }),
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      harness.handlers.set(channel, fn as never);
    },
    on: (channel: string, fn: unknown) => {
      harness.listeners.set(channel, fn as never);
    },
  },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined },
}));

vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import {
  advanceAfterFire,
  advanceSeriesAfterMiss,
  getNotice,
  listArmed,
} from "../../src/agent/memory/noticeStore.ts";
import { listEvents, type CalendarEvent } from "../../src/agent/memory/calendarStore.ts";
import { listCalendarEventsHandler } from "../../src/agent/tools/handlers.ts";

const PASSWORD = "sonda-cargo2-recurrencia";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin handler para ${channel}`);
  return fn(event, args) as Promise<T>;
}

interface AgendaDataReply {
  ok: boolean;
  events: Array<CalendarEvent & { occurrence?: boolean; repeatKey?: string | null }>;
}

const MIN = 60_000;
const DIA = 86_400_000;

/** Hoy a las 10:00 UTC más `dias` días, en ms. */
function aLas10(dias: number): number {
  const d = new Date();
  d.setUTCHours(10, 0, 0, 0);
  return d.getTime() + dias * DIA;
}

function fmtIcs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function ics(lines: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n");
}

function vevent(uid: string, titulo: string, inicio: number, extra: string[]): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${fmtIcs(inicio)}`,
    `DTEND:${fmtIcs(inicio + 60 * MIN)}`,
    `SUMMARY:${titulo}`,
    ...extra,
    "END:VEVENT",
  ];
}

function valarm(minAntes: number): string[] {
  return ["BEGIN:VALARM", `TRIGGER:-PT${minAntes}M`, "ACTION:DISPLAY", "END:VALARM"];
}

let fixtureDir = "";

async function importar(nombre: string, texto: string): Promise<void> {
  const file = path.join(fixtureDir, nombre);
  writeFileSync(file, texto);
  const preview = await call<{ ok: boolean; token: string }>("nido:agenda-import-preview", {
    kind: "ics",
    path: file,
  });
  expect(preview.ok).toBe(true);
  const commit = await call<{ ok: boolean; inserted: number }>("nido:agenda-import-commit", {
    kind: "ics",
    token: preview.token,
  });
  expect(commit.ok).toBe(true);
  expect(commit.inserted).toBe(1);
}

async function eventoPorUid(uid: string): Promise<CalendarEvent> {
  const all = await listEvents(0, Date.UTC(2100, 0, 1));
  const found = all.find((e) => e.uid === uid);
  if (!found) throw new Error(`sin evento ${uid}`);
  return found;
}

async function filasDeAgenda(uid: string): Promise<AgendaDataReply["events"]> {
  const data = await call<AgendaDataReply>("nido:agenda-data");
  expect(data.ok).toBe(true);
  return data.events.filter((e) => e.uid === uid);
}

const T_SEMANAL = aLas10(2);
const T_CIERRE = aLas10(3);
const T_ACABADA = aLas10(-20);
const T_SIN_AVISO = aLas10(5);
const T_UNICO = aLas10(7);

const ICS_SEMANAL = ics([
  ...vevent("cargo2-semanal@sonda", "Semanal cargo", T_SEMANAL, [
    "RRULE:FREQ=WEEKLY;COUNT=4",
    ...valarm(30),
  ]),
]);
const ICS_CIERRE = ics([
  ...vevent("cargo2-cierre@sonda", "Cierre cargo", T_CIERRE, [
    "RRULE:FREQ=WEEKLY;COUNT=4",
    ...valarm(30),
  ]),
]);
const ICS_ACABADA = ics([
  ...vevent("cargo2-acabada@sonda", "Acabada cargo", T_ACABADA, [
    "RRULE:FREQ=DAILY;COUNT=3",
    ...valarm(30),
  ]),
]);
const ICS_SIN_AVISO = ics([
  ...vevent("cargo2-sin-aviso@sonda", "Sin aviso cargo", T_SIN_AVISO, [
    "RRULE:FREQ=WEEKLY;COUNT=2",
  ]),
]);
const ICS_UNICO = ics([
  ...vevent("cargo2-unico@sonda", "Único cargo", T_UNICO, [...valarm(15)]),
]);

describe("CARGO-2 · la recurrencia gana sus consumidores", () => {
  beforeAll(async () => {
    const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
    mkdirSync(fixtureBase, { recursive: true });
    harness.userData = mkdtempSync(path.join(fixtureBase, "nido-cargo2-"));
    fixtureDir = path.join(harness.userData, "ficheros");
    mkdirSync(fixtureDir, { recursive: true });
    await installServices();
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
  }, 120_000);

  it("una semanal con COUNT y VALARM arma una fila con repetición y fin de serie", async () => {
    await importar("cargo2-semanal.ics", ICS_SEMANAL);
    const ev = await eventoPorUid("cargo2-semanal@sonda");
    const armed = (await listArmed()).filter((n) => n.refId === ev.id);
    expect(armed).toHaveLength(1);
    expect(armed[0].repeat).toBe("week");
    expect(armed[0].nextFireAt).toBe(ev.startsAt - 30 * MIN);
    // El fin de la serie: el disparo de la cuarta ocurrencia.
    expect(armed[0].endsAt).toBe(ev.startsAt + 21 * DIA - 30 * MIN);
  });

  it("advanceAfterFire avanza la serie y la cierra al pasar del fin", async () => {
    const ev = await eventoPorUid("cargo2-semanal@sonda");
    const [fila] = (await listArmed()).filter((n) => n.refId === ev.id);
    const disparo = (i: number) => ev.startsAt + i * 7 * DIA - 30 * MIN;
    for (let i = 0; i < 3; i++) {
      const after = await advanceAfterFire(fila.id, disparo(i));
      expect(after?.state).toBe("armed");
      expect(after?.nextFireAt).toBe(disparo(i + 1));
    }
    const ultima = await advanceAfterFire(fila.id, disparo(3));
    expect(ultima?.state).toBe("fired");
    expect((await listArmed()).some((n) => n.id === fila.id)).toBe(false);
  });

  it("la recuperación de perdidos presenta la última debida y cierra la serie en done", async () => {
    await importar("cargo2-cierre.ics", ICS_CIERRE);
    const ev = await eventoPorUid("cargo2-cierre@sonda");
    const [fila] = (await listArmed()).filter((n) => n.refId === ev.id);
    expect(fila).toBeTruthy();
    const ultimoDisparo = ev.startsAt + 21 * DIA - 30 * MIN;
    const res = await advanceSeriesAfterMiss(fila.id, ultimoDisparo + 21 * DIA);
    expect(res?.presentedAt).toBe(ultimoDisparo);
    expect(res?.skipped).toBe(3);
    const cerrada = await getNotice(fila.id);
    expect(cerrada?.state).toBe("done");
    expect((await listArmed()).some((n) => n.id === fila.id)).toBe(false);
  });

  it("una serie ya acabada no se arma, y su mirada atrás se enseña expandida", async () => {
    await importar("cargo2-acabada.ics", ICS_ACABADA);
    const ev = await eventoPorUid("cargo2-acabada@sonda");
    expect((await listArmed()).filter((n) => n.refId === ev.id)).toEqual([]);
    const filas = await filasDeAgenda(ev.uid);
    expect(filas.map((e) => e.startsAt)).toEqual([T_ACABADA, T_ACABADA + DIA, T_ACABADA + 2 * DIA]);
    expect(filas[0].occurrence).toBeFalsy();
    expect(filas[1].occurrence).toBe(true);
  });

  it("la lista de la Agenda expande la serie y declara su repetición", async () => {
    const filas = await filasDeAgenda("cargo2-cierre@sonda");
    expect(filas.map((e) => e.startsAt)).toEqual([
      T_CIERRE,
      T_CIERRE + 7 * DIA,
      T_CIERRE + 14 * DIA,
      T_CIERRE + 21 * DIA,
    ]);
    expect(filas[0].occurrence).toBeFalsy();
    expect(filas[1].occurrence).toBe(true);
    expect(filas[0].repeatKey).toBe("repeatWeek");
  });

  it("el chat encuentra la ocurrencia por su fecha, sin la primera fecha en el rango", async () => {
    const res = await listCalendarEventsHandler({
      from: new Date(T_CIERRE + 7 * DIA - 12 * 60 * MIN).toISOString(),
      to: new Date(T_CIERRE + 7 * DIA + 12 * 60 * MIN).toISOString(),
    });
    expect(res).toContain("Cierre cargo");
    expect(res).not.toContain("No hay eventos en ese rango");
  });

  it("no regresión: recurrente sin VALARM no crea fila y el evento está presente", async () => {
    await importar("cargo2-sin-aviso.ics", ICS_SIN_AVISO);
    const ev = await eventoPorUid("cargo2-sin-aviso@sonda");
    expect((await listArmed()).filter((n) => n.refId === ev.id)).toEqual([]);
    const filas = await filasDeAgenda(ev.uid);
    expect(filas.length).toBeGreaterThanOrEqual(1);
    expect(filas[0].startsAt).toBe(ev.startsAt);
  });

  it("no regresión: evento único con VALARM arma la fila de siempre y la lista lo devuelve intacto", async () => {
    await importar("cargo2-unico.ics", ICS_UNICO);
    const ev = await eventoPorUid("cargo2-unico@sonda");
    const armed = (await listArmed()).filter((n) => n.refId === ev.id);
    expect(armed).toHaveLength(1);
    expect(armed[0].repeat).toBeNull();
    expect(armed[0].endsAt).toBeNull();
    expect(armed[0].nextFireAt).toBe(ev.startsAt - 15 * MIN);
    const filas = await filasDeAgenda(ev.uid);
    expect(filas).toHaveLength(1);
    expect(filas[0].startsAt).toBe(ev.startsAt);
    expect(filas[0].occurrence).toBeFalsy();
    expect(filas[0].repeatKey ?? null).toBeNull();
  });
});
