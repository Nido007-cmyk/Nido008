/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * CARGO-2 · el motor único de ocurrencias de los eventos
 * recurrentes (`eventSeries.ts`): la recurrencia que la
 * importación guarda (la RRULE cruda y su `rruleUntil`)
 * se interpreta en un solo sitio, con la misma primitiva
 * (`nextOccurrence`) y las mismas cotas que el conteo de
 * la importación (COUNT, el fin efectivo, la ventana de
 * 5 años, la red de 2.000 pasos), más el tope de
 * expansión por consulta (512) dicho en voz alta con
 * `truncated`. Los casos:
 *
 * 1. La expansión semanal con COUNT: la ventana de las
 *    semanas 2 y 3 devuelve exactamente esas dos
 *    ocurrencias, con `endsAt` corrido por el mismo
 *    delta; la copia de la primera fecha es la fila de
 *    la serie y las demás van marcadas `occurrence`.
 * 2. UNTIL y sin fin concuerdan con el fin efectivo: la
 *    regla con UNTIL no pasa de su instante (y la
 *    ocurrencia que cae en él entra); la sin fin se
 *    corta en el `rruleUntil` guardado (los 5 años) y
 *    no antes.
 * 3. El tope por consulta dice la verdad: una diaria en
 *    una ventana de 3 años devuelve 512 y
 *    `truncated: true`; en la ventana de la Agenda
 *    (428 días) devuelve todas y `truncated: false`.
 * 4. Mes con día inexistente: mensual desde el 31 de
 *    enero cae el 31 de enero, el 31 de marzo y el 31
 *    de mayo; ninguna en febrero ni abril.
 * 5. `lastOccurrenceAt` por clase de fin: con COUNT,
 *    la última contada; con UNTIL, la última que no lo
 *    pasa; sin regla, null; con una regla fuera del
 *    subconjunto, null y el evento se trata como único.
 * 6. Concordancia con el conteo de la importación:
 *    para las reglas de las fixtures de la puerta
 *    (diaria sin fin, semanal con COUNT, anual), lo
 *    que la expansión genera en la ventana de 5 años
 *    es lo que la importación contó para admitirlas.
 */
import { describe, it, expect } from "vitest";
import {
  EXPANSION_MAX_PER_QUERY,
  expandEvents,
  iterateOccurrences,
  lastOccurrenceAt,
  parseStoredRule,
} from "./eventSeries.js";
import { countOccurrences, ICS_LIMITS } from "./calendarIcs.js";
import type { CalendarEvent } from "./calendarStore.js";

function ev(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "ev-sonda",
    uid: "sonda@x",
    title: "Sonda",
    notes: "",
    location: "",
    startsAt: 0,
    endsAt: 0,
    allDay: false,
    rrule: null,
    rruleUntil: null,
    alertOffsetMin: null,
    origin: "ics",
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const HORA = 3600_000;
const DIA = 86_400_000;
/** Lunes 2027-01-04 09:00 local. */
const LUNES = new Date(2027, 0, 4, 9, 0).getTime();

function mas5Anos(ms: number): number {
  const d = new Date(ms);
  d.setFullYear(d.getFullYear() + ICS_LIMITS.windowYears);
  return d.getTime();
}

describe("CARGO-2 · eventSeries, el motor de ocurrencias", () => {
  it("la expansión semanal con COUNT: la ventana de las semanas 2 y 3, con el fin corrido y las marcas", () => {
    const semanal = ev({
      startsAt: LUNES,
      endsAt: LUNES + HORA,
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    const desde = new Date(2027, 0, 11).getTime();
    const hasta = new Date(2027, 0, 25).getTime();
    const { events, truncatedSeries } = expandEvents([semanal], desde, hasta);
    expect(truncatedSeries).toBe(0);
    expect(events.map((e) => e.startsAt)).toEqual([LUNES + 7 * DIA, LUNES + 14 * DIA]);
    // La duración se conserva: el fin corre por el mismo delta.
    expect(events.map((e) => e.endsAt)).toEqual([LUNES + 7 * DIA + HORA, LUNES + 14 * DIA + HORA]);
    // Ninguna de las dos es la primera fecha: las dos son ocurrencias.
    expect(events.every((e) => e.occurrence === true)).toBe(true);
    // El motor de instantes concuerda con la expansión.
    expect(iterateOccurrences(semanal, desde, hasta)).toEqual({
      startsAt: [LUNES + 7 * DIA, LUNES + 14 * DIA],
      truncated: false,
    });
    // Con la primera fecha en la ventana, esa copia es la
    // fila de la serie (sin marca) y la siguiente, ocurrencia.
    const conPrimera = expandEvents([semanal], new Date(2027, 0, 4).getTime(), new Date(2027, 0, 12).getTime());
    expect(conPrimera.events.map((e) => e.startsAt)).toEqual([LUNES, LUNES + 7 * DIA]);
    expect(conPrimera.events[0].occurrence).toBeFalsy();
    expect(conPrimera.events[1].occurrence).toBe(true);
  });

  it("UNTIL y sin fin concuerdan con el fin efectivo", () => {
    const hasta18 = new Date(2027, 0, 18, 9, 0).getTime();
    const conUntil = ev({
      startsAt: LUNES,
      endsAt: LUNES + HORA,
      rrule: "FREQ=WEEKLY;UNTIL=20270118T090000",
      rruleUntil: hasta18,
    });
    const ventana = iterateOccurrences(conUntil, new Date(2027, 0, 1).getTime(), new Date(2027, 2, 1).getTime());
    // La ocurrencia que cae en el UNTIL entra; la siguiente, no.
    expect(ventana.startsAt).toEqual([LUNES, LUNES + 7 * DIA, LUNES + 14 * DIA]);
    expect(ventana.truncated).toBe(false);

    const sinFin = ev({
      startsAt: LUNES,
      endsAt: LUNES + HORA,
      rrule: "FREQ=WEEKLY",
      rruleUntil: mas5Anos(LUNES),
    });
    const seisAnos = iterateOccurrences(sinFin, LUNES, mas5Anos(LUNES) + 366 * DIA);
    expect(seisAnos.truncated).toBe(false);
    expect(seisAnos.startsAt.length).toBeGreaterThanOrEqual(260);
    const ultima = seisAnos.startsAt[seisAnos.startsAt.length - 1];
    // Se corta en el fin guardado, y no antes: la última
    // cae dentro de la semana anterior al fin.
    expect(ultima).toBeLessThanOrEqual(sinFin.rruleUntil!);
    expect(ultima).toBeGreaterThan(sinFin.rruleUntil! - 7 * DIA);
  });

  it("el tope por consulta dice la verdad", () => {
    const inicio = new Date(2027, 0, 1, 9, 0).getTime();
    const diaria = ev({
      startsAt: inicio,
      endsAt: inicio + HORA,
      rrule: "FREQ=DAILY",
      rruleUntil: mas5Anos(inicio),
    });
    const tresAnos = iterateOccurrences(diaria, inicio, new Date(2030, 0, 1, 9, 0).getTime());
    expect(tresAnos.startsAt).toHaveLength(EXPANSION_MAX_PER_QUERY);
    expect(tresAnos.startsAt[0]).toBe(inicio);
    expect(tresAnos.truncated).toBe(true);
    // La ventana de la Agenda (428 días): todas, sin truncar.
    const agenda = iterateOccurrences(diaria, inicio, inicio + 428 * DIA);
    expect(agenda.startsAt).toHaveLength(428);
    expect(agenda.truncated).toBe(false);
  });

  it("mes con día inexistente: el 31 salta los meses sin 31", () => {
    const mensual = ev({
      startsAt: new Date(2027, 0, 31, 9, 0).getTime(),
      endsAt: new Date(2027, 0, 31, 10, 0).getTime(),
      rrule: "FREQ=MONTHLY",
      rruleUntil: mas5Anos(new Date(2027, 0, 31, 9, 0).getTime()),
    });
    const { startsAt } = iterateOccurrences(
      mensual,
      new Date(2027, 0, 1).getTime(),
      new Date(2027, 5, 1).getTime(),
    );
    expect(startsAt.map((ms) => [new Date(ms).getMonth(), new Date(ms).getDate()])).toEqual([
      [0, 31],
      [2, 31],
      [4, 31],
    ]);
  });

  it("lastOccurrenceAt por clase de fin, y la caída honesta fuera del subconjunto", () => {
    expect(
      lastOccurrenceAt(ev({ startsAt: LUNES, endsAt: LUNES + HORA, rrule: "FREQ=WEEKLY;COUNT=4" })),
    ).toBe(LUNES + 21 * DIA);
    const hasta18 = new Date(2027, 0, 18, 9, 0).getTime();
    expect(
      lastOccurrenceAt(
        ev({
          startsAt: LUNES,
          endsAt: LUNES + HORA,
          rrule: "FREQ=WEEKLY;UNTIL=20270118T090000",
          rruleUntil: hasta18,
        }),
      ),
    ).toBe(hasta18);
    expect(lastOccurrenceAt(ev({ startsAt: LUNES, endsAt: LUNES + HORA }))).toBeNull();
    // Una cadena fuera del subconjunto, puesta a mano: la
    // regla no se interpreta y el evento se trata como único.
    const rara = ev({ startsAt: LUNES, endsAt: LUNES + HORA, rrule: "FREQ=HOURLY" });
    expect(parseStoredRule("FREQ=HOURLY")).toBeNull();
    expect(lastOccurrenceAt(rara)).toBeNull();
    const { events } = expandEvents([rara], new Date(2027, 0, 1).getTime(), new Date(2027, 1, 1).getTime());
    expect(events).toHaveLength(1);
    expect(events[0].startsAt).toBe(LUNES);
    expect(events[0].occurrence).toBeFalsy();
  });

  it("concordancia con el conteo de la importación en la ventana de 5 años", () => {
    // Las reglas de las fixtures de la puerta: la diaria
    // sin fin y la semanal COUNT=4 de calendarIcs.test.ts
    // (sin-fin@x y mix-4@x) y la anual de
    // agendaImportWiring.test.ts (Cumpleaños puerta).
    const fixtures: Array<{
      nombre: string;
      evento: CalendarEvent;
      repeat: "day" | "week" | "year";
      count: number | null;
      until: number | null;
    }> = [
      {
        nombre: "diaria sin fin",
        evento: ev({
          startsAt: Date.UTC(2027, 2, 1, 9, 0),
          endsAt: Date.UTC(2027, 2, 1, 9, 30),
          rrule: "FREQ=DAILY",
          rruleUntil: mas5Anos(Date.UTC(2027, 2, 1, 9, 0)),
        }),
        repeat: "day",
        count: null,
        until: null,
      },
      {
        nombre: "semanal con COUNT=4",
        evento: ev({
          startsAt: Date.UTC(2027, 2, 8, 8, 0),
          endsAt: Date.UTC(2027, 2, 8, 8, 30),
          rrule: "FREQ=WEEKLY;COUNT=4",
          rruleUntil: null,
        }),
        repeat: "week",
        count: 4,
        until: null,
      },
      {
        nombre: "anual",
        evento: ev({
          startsAt: new Date(2027, 5, 10).getTime(),
          endsAt: new Date(2027, 5, 11).getTime(),
          allDay: true,
          rrule: "FREQ=YEARLY",
          rruleUntil: mas5Anos(new Date(2027, 5, 10).getTime()),
        }),
        repeat: "year",
        count: null,
        until: null,
      },
    ];
    for (const f of fixtures) {
      const windowEnd = mas5Anos(f.evento.startsAt);
      const contado = countOccurrences(f.evento.startsAt, f.repeat, f.count, f.until, windowEnd);
      // La expansión camina la misma ventana por trozos
      // anuales (cada trozo bajo el tope por consulta) y
      // suma: ningún motor expande lo que el otro no contó.
      let generado = 0;
      for (let k = 0; k < ICS_LIMITS.windowYears; k++) {
        const desde = (() => {
          const d = new Date(f.evento.startsAt);
          d.setFullYear(d.getFullYear() + k);
          return d.getTime();
        })();
        const hasta =
          k === ICS_LIMITS.windowYears - 1
            ? windowEnd + 1
            : (() => {
                const d = new Date(f.evento.startsAt);
                d.setFullYear(d.getFullYear() + k + 1);
                return d.getTime();
              })();
        const trozo = iterateOccurrences(f.evento, desde, hasta);
        expect(trozo.truncated, f.nombre).toBe(false);
        generado += trozo.startsAt.length;
      }
      expect(generado, f.nombre).toBe(contado);
    }
  });
});
