/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 3 de E7: la `.ics` por la mano. Puerta del
 * paso en la enumeración de E7-DECISIONES §5.2 (grupo
 * Calendario, la parte de importación: 9 casos), contra las
 * cifras de la firma 3, selladas antes de construir el parser
 * (fichero ≤ 25 MB; ≤ 20.000 VEVENT; recurrencia sin fin
 * acotada a 5 años y ≤ 2.000 ocurrencias; propiedad desplegada
 * ≤ 64 KB descartada y nombrada; línea física ≤ 1 MB con
 * rechazo; campos guardados con su tope). Nada se descarta en
 * silencio: el resumen previo nombra lo que no entra y por qué,
 * y guardar exige la confirmación R4 sobre lo nombrado.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { exportIcs, importIcs, previewIcsImport } from "./calendarIcs.js";
import { listEvents } from "./calendarStore.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e7ics-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const FIXTURE_MIXTA = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:mix-1@x",
  "DTSTART:20270305T100000Z",
  "DTEND:20270305T110000Z",
  "SUMMARY:Cita con la dentista",
  "LOCATION:Clínica Sol",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:mix-2@x",
  "DTSTART;VALUE=DATE:20270306",
  "DTEND;VALUE=DATE:20270307",
  "SUMMARY:Día de campo",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:mix-3@x",
  "DTSTART:20270307T090000",
  "DURATION:PT2H",
  "SUMMARY:Taller",
  "DESCRIPTION:Traer el portátil",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:mix-4@x",
  "DTSTART:20270308T080000Z",
  "DTEND:20270308T083000Z",
  "SUMMARY:Paseo",
  "RRULE:FREQ=WEEKLY;COUNT=4",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const TODO = () => listEvents(0, Date.UTC(2100, 0, 1));

describe("E7 paso 3 · .ics por la mano", () => {
  it("fixture mixta con su conteo de lo guardado", async () => {
    const r = await importIcs(FIXTURE_MIXTA, { confirmed: true });
    expect(r.summary.rejected).toBeNull();
    expect(r.summary.totalEvents).toBe(4);
    expect(r.inserted).toBe(4);
    const all = await TODO();
    expect(all.map((e) => e.uid).sort()).toEqual([
      "mix-1@x",
      "mix-2@x",
      "mix-3@x",
      "mix-4@x",
    ]);
    const timed = all.find((e) => e.uid === "mix-1@x")!;
    expect(timed.startsAt).toBe(Date.UTC(2027, 2, 5, 10, 0));
    expect(timed.endsAt).toBe(Date.UTC(2027, 2, 5, 11, 0));
    expect(timed.origin).toBe("ics");
    const allDay = all.find((e) => e.uid === "mix-2@x")!;
    expect(allDay.allDay).toBe(true);
    const byDuration = all.find((e) => e.uid === "mix-3@x")!;
    expect(byDuration.endsAt - byDuration.startsAt).toBe(2 * 3600_000);
    expect(byDuration.notes).toBe("Traer el portátil");
    const recurring = all.find((e) => e.uid === "mix-4@x")!;
    expect(recurring.rrule).toContain("FREQ=WEEKLY");
  });

  it("reimportar no duplica por uid", async () => {
    await importIcs(FIXTURE_MIXTA, { confirmed: true });
    const again = await importIcs(FIXTURE_MIXTA, { confirmed: true });
    expect(again.inserted).toBe(0);
    expect(again.summary.alreadyPresent).toBe(4);
    expect(await TODO()).toHaveLength(4);
  });

  it("exportar y reimportar devuelve el mismo conjunto por uid", async () => {
    await importIcs(FIXTURE_MIXTA, { confirmed: true });
    const exported = exportIcs(await TODO());
    await closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "nido-e7ics-b-"));
    setAppStoreDir(dir);
    const r = await importIcs(exported, { confirmed: true });
    expect(r.inserted).toBe(4);
    const back = await TODO();
    expect(back.map((e) => e.uid).sort()).toEqual([
      "mix-1@x",
      "mix-2@x",
      "mix-3@x",
      "mix-4@x",
    ]);
    const timed = back.find((e) => e.uid === "mix-1@x")!;
    expect(timed.startsAt).toBe(Date.UTC(2027, 2, 5, 10, 0));
    expect(timed.title).toBe("Cita con la dentista");
  });

  it("hostil de tamaño: el fichero que pasa de 25 MB se rechaza entero con su razón", async () => {
    const pad = `X-PAD:${"p".repeat(60_000)}`;
    const big = ["BEGIN:VCALENDAR", ...Array.from({ length: 450 }, () => pad), "END:VCALENDAR"].join("\r\n");
    expect(Buffer.byteLength(big)).toBeGreaterThan(25 * 1024 * 1024);
    const r = await importIcs(big, { confirmed: true });
    expect(r.inserted).toBe(0);
    expect(r.summary.rejected).toMatch(/25 MB/);
    expect(await TODO()).toHaveLength(0);
  });

  it("hostil de registros: más de 20.000 VEVENT se rechaza entero con su razón", async () => {
    const ev = (i: number) =>
      `BEGIN:VEVENT\r\nUID:h-${i}@x\r\nDTSTART:20270305T100000Z\r\nDTEND:20270305T110000Z\r\nSUMMARY:H${i}\r\nEND:VEVENT`;
    const big = `BEGIN:VCALENDAR\r\n${Array.from({ length: 20_001 }, (_, i) => ev(i)).join("\r\n")}\r\nEND:VCALENDAR`;
    const r = await importIcs(big, { confirmed: true });
    expect(r.inserted).toBe(0);
    expect(r.summary.rejected).toMatch(/20\.000/);
    expect(await TODO()).toHaveLength(0);
  });

  it("RRULE sin fin acotada a la ventana y el resumen lo dice", async () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:sin-fin@x",
      "DTSTART:20270301T090000Z",
      "DTEND:20270301T093000Z",
      "SUMMARY:Diario sin fin",
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const summary = previewIcsImport(text, new Set());
    expect(summary.named.unboundedRrule).toEqual(["Diario sin fin"]);
    const r = await importIcs(text, { confirmed: true });
    expect(r.inserted).toBe(1);
    const ev = (await TODO())[0];
    // Acotada: rrule_until cae a los 5 años del inicio.
    expect(ev.rruleUntil).toBe(Date.UTC(2032, 2, 1, 9, 0));
  });

  it("EXDATE y VALARM nombrados en el resumen", async () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:con-nombres@x",
      "DTSTART:20270401T100000Z",
      "DTEND:20270401T110000Z",
      "SUMMARY:Reunión semanal",
      "RRULE:FREQ=WEEKLY;COUNT=6",
      "EXDATE:20270415T100000Z",
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const summary = previewIcsImport(text, new Set());
    expect(summary.named.exdate).toEqual(["Reunión semanal"]);
    expect(summary.named.valarm).toEqual(["Reunión semanal"]);
    const r = await importIcs(text, { confirmed: true });
    expect(r.inserted).toBe(1);
    const ev = (await TODO())[0];
    expect(ev.alertOffsetMin).toBe(30);
  });

  it("líneas gigantes rechazan el fichero; el texto de inyección en el título entra como título", async () => {
    const giant = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:gigante@x",
      "DTSTART:20270305T100000Z",
      "DTEND:20270305T110000Z",
      `DESCRIPTION:${"x".repeat(1_100_000)}`,
      "SUMMARY:Grande",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r1 = await importIcs(giant, { confirmed: true });
    expect(r1.inserted).toBe(0);
    expect(r1.summary.rejected).toMatch(/línea/i);

    const injection = 'x"; DROP TABLE calendar_events; --';
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:inyeccion@x",
      "DTSTART:20270305T100000Z",
      "DTEND:20270305T110000Z",
      `SUMMARY:${injection}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r2 = await importIcs(text, { confirmed: true });
    expect(r2.inserted).toBe(1);
    const all = await TODO();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe(injection);
  });

  it("resumen previo con confirmación R4: sin confirmar no se guarda nada", async () => {
    const summary = previewIcsImport(FIXTURE_MIXTA, new Set());
    expect(summary.totalEvents).toBe(4);
    expect(summary.enter).toHaveLength(4);
    expect(summary.alreadyPresent).toBe(0);
    const notConfirmed = await importIcs(FIXTURE_MIXTA, { confirmed: false });
    expect(notConfirmed.inserted).toBe(0);
    expect(await TODO()).toHaveLength(0);
    const confirmed = await importIcs(FIXTURE_MIXTA, { confirmed: true });
    expect(confirmed.inserted).toBe(4);
    expect(await TODO()).toHaveLength(4);
  });
});
