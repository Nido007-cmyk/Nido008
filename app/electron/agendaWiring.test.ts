/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * E7 (paso 6): la superficie Agenda se sirve por cinco canales
 * nuevos sobre los almacenes que el chat ya usa (calendarStore,
 * contactStore y la cola de noticeStore): `nido:agenda-data`
 * sirve eventos y fichas (la ficha, con el instante de su
 * próximo aviso), y los cuatro canales de guardado y borrado
 * escriben por los mismos almacenes, así que guardar un evento
 * con aviso lo arma y borrarlo lo desarma, igual que por el
 * chat.
 *
 * Los cargos, con el arnés de servicios reales de la casa
 * (doble de Electron y manejadores reales cobrados por canal):
 *
 * 1. agenda-data devuelve el evento y la ficha sembrados por
 *    sus almacenes, la ficha con su próximo aviso.
 * 2. agenda-event-save crea el evento (y arma su aviso) y lo
 *    corrige; agenda-event-delete lo borra y desarma su aviso.
 * 3. agenda-contact-save crea la ficha con cumpleaños (y arma
 *    el aviso anual); agenda-contact-delete la borra y lo
 *    desarma.
 * 4. Sin sesión, los cinco canales responden locked y nada
 *    se lee ni se escribe.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import { createEvent, listEvents } from "../../src/agent/memory/calendarStore.js";
import { createContact, listContacts } from "../../src/agent/memory/contactStore.js";
import { listArmed } from "../../src/agent/memory/noticeStore.js";

const PASSWORD = "sonda-e7-agenda";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type AgendaEventRow = { id: string; title: string; startsAt: number; alertOffsetMin: number | null };
type AgendaContactRow = { id: string; name: string; nextNoticeAt: number | null };
type DataReply = { ok: boolean; reason?: string; events?: AgendaEventRow[]; contacts?: AgendaContactRow[] };
type SaveReply = { ok: boolean; reason?: string; event?: AgendaEventRow; contact?: AgendaContactRow };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-e7-agenda-"));
  await installServices();
  const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("E7 paso 6 · los canales de la Agenda", () => {
  it("agenda-data devuelve el evento y la ficha sembrados, la ficha con su próximo aviso", async () => {
    const ev = await createEvent({
      title: "Dentista",
      startsAt: new Date(2027, 5, 8, 10, 0).getTime(),
      endsAt: new Date(2027, 5, 8, 11, 0).getTime(),
      alertOffsetMin: 30,
    });
    const ficha = await createContact(
      { name: "Carmen Ruiz", birthdayMonth: 6, birthdayDay: 8 },
      new Date(2027, 0, 15, 12, 0),
    );
    const r = await call<DataReply>("nido:agenda-data");
    expect(r.ok).toBe(true);
    expect(r.events?.map((e) => e.id)).toContain(ev.id);
    const row = r.contacts?.find((c) => c.id === ficha.id);
    expect(row?.name).toBe("Carmen Ruiz");
    expect(row?.nextNoticeAt).toBe(new Date(2027, 5, 8, 9, 0).getTime());
  });

  it("agenda-event-save crea y corrige (con su aviso), y agenda-event-delete borra y desarma", async () => {
    const startsAt = new Date(2027, 6, 1, 12, 0).getTime();
    const saved = await call<SaveReply>("nido:agenda-event-save", {
      title: "Revisión del coche",
      startsAt,
      endsAt: startsAt + 3600_000,
      alertOffsetMin: 60,
    });
    expect(saved.ok).toBe(true);
    const id = saved.event!.id;
    expect((await listArmed()).filter((n) => n.refId === id)).toHaveLength(1);

    const fixed = await call<SaveReply>("nido:agenda-event-save", {
      id,
      title: "Revisión del coche (movida)",
      startsAt: startsAt + 86400_000,
      endsAt: startsAt + 86400_000 + 3600_000,
      alertOffsetMin: 60,
    });
    expect(fixed.ok).toBe(true);
    expect(fixed.event?.title).toBe("Revisión del coche (movida)");
    expect((await listArmed()).filter((n) => n.refId === id)).toHaveLength(1);

    const del = await call<{ ok: boolean }>("nido:agenda-event-delete", { id });
    expect(del.ok).toBe(true);
    expect((await listEvents(0, Date.UTC(2100, 0, 1))).map((e) => e.id)).not.toContain(id);
    expect((await listArmed()).filter((n) => n.refId === id)).toHaveLength(0);
  });

  it("agenda-contact-save crea la ficha con su aviso anual, y agenda-contact-delete la borra y lo desarma", async () => {
    const saved = await call<SaveReply>("nido:agenda-contact-save", {
      name: "Bruno Díaz",
      birthdayMonth: 12,
      birthdayDay: 25,
      phones: [{ label: "móvil", number: "+34 611 222 333" }],
    });
    expect(saved.ok).toBe(true);
    const id = saved.contact!.id;
    expect((await listArmed()).filter((n) => n.refId === id && n.kind === "birthday")).toHaveLength(1);

    const del = await call<{ ok: boolean }>("nido:agenda-contact-delete", { id });
    expect(del.ok).toBe(true);
    expect((await listContacts()).map((c) => c.id)).not.toContain(id);
    expect((await listArmed()).filter((n) => n.refId === id)).toHaveLength(0);
  });

  it("sin sesión, los cinco canales responden locked", async () => {
    await call<{ ok: boolean }>("nido:vault-lock");
    for (const channel of [
      "nido:agenda-data",
      "nido:agenda-event-save",
      "nido:agenda-event-delete",
      "nido:agenda-contact-save",
      "nido:agenda-contact-delete",
    ]) {
      const r = await call<{ ok: boolean; reason?: string }>(channel, { id: "x", title: "X", name: "X" });
      expect(r.ok, channel).toBe(false);
      expect(r.reason, channel).toBe("locked");
    }
  });
});
