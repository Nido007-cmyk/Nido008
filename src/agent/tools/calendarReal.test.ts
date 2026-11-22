/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 2 de E7: el calendario real sobre la base
 * cifrada. Puerta del paso en la enumeración de E7-DECISIONES
 * §5.2 (grupo Calendario, los que no son de importación: 2):
 * - CRUD contra la base cifrada real con reapertura y el evento
 *   que sigue: el handler crea, el listado lo enseña, la base se
 *   cierra y se reabre y el evento sigue ahí; el evento con
 *   aviso materializa su fila en la cola (kind event, ref_id al
 *   evento, next_fire_at derivado); corregir rearma y borrar
 *   desarma en la misma operación.
 * - Zona horaria con reloj y zona inyectados: el instante
 *   guardado es UTC y no se mueve al cambiar la zona de lectura;
 *   la hora local se calcula al armar el aviso y al enseñar.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { buildToolHandlers, setHandlerLangForTest } from "./handlers.js";
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  updateEvent,
} from "../memory/calendarStore.js";
import { listArmed } from "../memory/noticeStore.js";

let dir: string;
const KEY = randomBytes(32);
const TZ_ORIG = process.env.TZ;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e7cal-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
  setHandlerLangForTest("es");
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  setHandlerLangForTest(null);
  if (TZ_ORIG === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIG;
  rmSync(dir, { recursive: true, force: true });
});

describe("E7 paso 2 · calendario real", () => {
  it("CRUD contra la base cifrada real con reapertura y el evento que sigue", async () => {
    const h = buildToolHandlers({ requestConfirm: async () => true });
    const created = await h["create_calendar_event"]({
      title: "Dentista",
      start: "2027-02-10T10:00:00",
      end: "2027-02-10T11:00:00",
    });
    expect(created).toContain("Evento creado");
    expect(created).toContain("Dentista");

    const listed = await h["list_calendar_events"]({
      from: "2027-02-10T00:00:00",
      to: "2027-02-10T23:59:59",
    });
    expect(listed).toContain("Dentista");

    // Reapertura: el evento sigue.
    await closeDatabase();
    const after = await listEvents(
      new Date("2027-02-10T00:00:00").getTime(),
      new Date("2027-02-10T23:59:59").getTime(),
    );
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("Dentista");
    expect(after[0].origin).toBe("chat");

    // El evento con aviso materializa su fila en la cola.
    const withAlert = await createEvent({
      title: "Vuelo",
      startsAt: new Date("2027-03-01T15:00:00").getTime(),
      endsAt: new Date("2027-03-01T18:00:00").getTime(),
      alertOffsetMin: 60,
      origin: "ui",
    });
    let armed = await listArmed();
    const notice = armed.find((n) => n.refId === withAlert.id);
    expect(notice?.kind).toBe("event");
    expect(notice?.nextFireAt).toBe(withAlert.startsAt - 60 * 60_000);

    // Corregir reemplaza y rearma con el nuevo instante.
    const moved = await updateEvent(withAlert.id, {
      startsAt: new Date("2027-03-02T15:00:00").getTime(),
    });
    expect(moved?.startsAt).toBe(new Date("2027-03-02T15:00:00").getTime());
    armed = await listArmed();
    const rearmed = armed.filter((n) => n.refId === withAlert.id);
    expect(rearmed).toHaveLength(1);
    expect(rearmed[0].nextFireAt).toBe(moved!.startsAt - 60 * 60_000);

    // Borrar desarma en la misma operación.
    await deleteEvent(withAlert.id);
    expect(await getEvent(withAlert.id)).toBeNull();
    armed = await listArmed();
    expect(armed.find((n) => n.refId === withAlert.id)).toBeUndefined();
  });

  it("zona horaria con reloj y zona inyectados: el instante no se mueve", async () => {
    process.env.TZ = "America/New_York";
    const h = buildToolHandlers({ requestConfirm: async () => true });
    await h["create_calendar_event"]({
      title: "Llamada",
      start: "2027-06-08T09:00:00",
      end: "2027-06-08T09:30:00",
      alert_offset_min: 30,
    });
    const day = await listEvents(
      Date.UTC(2027, 5, 8, 0, 0),
      Date.UTC(2027, 5, 9, 0, 0),
    );
    expect(day).toHaveLength(1);
    // 09:00 de Nueva York en junio es EDT (UTC-4): el instante
    // guardado es 13:00 UTC, y el aviso se arma a las 08:30 de
    // la hora local pedida.
    expect(day[0].startsAt).toBe(Date.UTC(2027, 5, 8, 13, 0));
    const armed = await listArmed();
    const notice = armed.find((n) => n.refId === day[0].id);
    expect(notice?.nextFireAt).toBe(Date.UTC(2027, 5, 8, 12, 30));
    expect(notice?.baseLocal).toBe("2027-06-08T08:30:00");

    // Con otra zona de lectura, el instante guardado es el mismo.
    process.env.TZ = "America/Phoenix";
    const reread = await getEvent(day[0].id);
    expect(reread?.startsAt).toBe(Date.UTC(2027, 5, 8, 13, 0));
    const armed2 = await listArmed();
    expect(
      armed2.find((n) => n.refId === day[0].id)?.nextFireAt,
    ).toBe(Date.UTC(2027, 5, 8, 12, 30));
  });
});
