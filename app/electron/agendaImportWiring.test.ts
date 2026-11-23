/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda PUERTA .ICS/.VCF: la puerta de ficheros de la
 * Agenda se sirve por tres canales nuevos sobre los
 * motores del núcleo (`calendarIcs` y `contactVcf`,
 * pasos 3 y 4 de E7), que hasta esta tanda no tenían
 * ningún llamante fuera de sus baterías (CARGO 1 de
 * AUDIT-CABLEADO-E7E8): `nido:agenda-import-preview`
 * lee el fichero elegido en el principal (con el tope
 * aplicado durante la lectura), retiene su texto en
 * un hueco de un solo uso y devuelve el resumen como
 * DTO con códigos; `nido:agenda-import-commit` guarda
 * exactamente lo que el resumen anunció;
 * `nido:agenda-export` compone el fichero de la
 * agenda entera para guardarlo por los canales de
 * exportación ya expuestos.
 *
 * Los cargos, con el arnés de servicios reales de la
 * casa (doble de Electron y manejadores reales
 * cobrados por canal):
 *
 * 1. La vista previa de `.ics` anuncia el resumen
 *    entero y no escribe nada.
 * 2. El commit de `.ics` guarda lo anunciado, con
 *    origen `ics` y el aviso del VALARM armado; el
 *    testigo no sirve dos veces.
 * 3. Reimportar el mismo `.ics`: todo ya presente.
 * 4. El `.ics` rechazado sale con su código y sin
 *    testigo: no hay commit posible.
 * 5. Los descartes de `.ics` traen su código y su
 *    etiqueta.
 * 6. La exportación de `.ics` y su ida y vuelta.
 * 7. La vista previa de `.vcf` anuncia el resumen
 *    (PHOTO y sin nombre, con sus códigos) y no
 *    escribe nada.
 * 8. El commit de `.vcf` guarda con origen `vcf` y
 *    el aviso anual armado; la duplicada no entra.
 * 9. La exportación de `.vcf` y su ida y vuelta.
 * 10. La ruta inexistente responde `unreadable`.
 * 11. El fichero que pasa de 25 MB sale rechazado
 *     con el código de tamaño.
 * 12. Sin sesión, los tres canales responden locked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { listEvents } from "../../src/agent/memory/calendarStore.js";
import { listContacts } from "../../src/agent/memory/contactStore.js";
import { listArmed } from "../../src/agent/memory/noticeStore.js";

const PASSWORD = "sonda-puerta-icsvcf";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

interface DiscardedDto {
  code: string;
  label: string | null;
  prop: string | null;
  text: string;
}
interface NamedGroup {
  count: number;
  names: string[];
}
interface SummaryDto {
  rejectedCode: string | null;
  rejectedText: string | null;
  total: number;
  enter: number;
  alreadyPresent: number;
  recurring: number;
  discarded: DiscardedDto[];
  named: {
    exdate: NamedGroup;
    valarm: NamedGroup;
    unboundedRrule: NamedGroup;
    tzid: NamedGroup;
    withoutUid: number;
    truncatedFields: number;
  } | null;
}
type PreviewReply = { ok: boolean; reason?: string; token?: string | null; summary?: SummaryDto };
type CommitReply = { ok: boolean; reason?: string; inserted?: number; summary?: SummaryDto };
type ExportReply = { ok: boolean; reason?: string; content?: string; defaultName?: string };
type DataReply = {
  ok: boolean;
  events?: Array<{ id: string; uid: string; title: string; origin: string }>;
  contacts?: Array<{ id: string; name: string; origin: string }>;
};

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

let fixtureDir = "";
function fixture(name: string, content: string | Buffer): string {
  const p = path.join(fixtureDir, name);
  writeFileSync(p, content);
  return p;
}

const ICS_BASICO = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Sonda//Puerta//ES",
  "BEGIN:VEVENT",
  "UID:puerta-1@sonda",
  "DTSTART:20270608T100000Z",
  "DTEND:20270608T110000Z",
  "SUMMARY:Dentista puerta",
  "LOCATION:Clínica",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:puerta-2@sonda",
  "DTSTART;VALUE=DATE:20270610",
  "SUMMARY:Cumpleaños puerta",
  "RRULE:FREQ=YEARLY",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:puerta-3@sonda",
  "DTSTART:20270612T090000Z",
  "DTEND:20270612T093000Z",
  "SUMMARY:Sin alarma",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const ICS_DESCARTES = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:descartes-1@sonda",
  "SUMMARY:Sin inicio",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:descartes-2@sonda",
  "DTSTART:20270701T100000Z",
  "DTEND:20270701T110000Z",
  "SUMMARY:Descripción gigante",
  `DESCRIPTION:${"x".repeat(70_000)}`,
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:descartes-3@sonda",
  "DTSTART:20270702T100000Z",
  "DTEND:20270702T110000Z",
  "SUMMARY:Cada hora",
  "RRULE:FREQ=HOURLY",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const VCF_BASICA = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Carmen Puerta",
  "TEL;TYPE=cell:+34 600 111 222",
  "BDAY:19850608",
  "PHOTO;ENCODING=b:AAAA",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "TEL:+34 600 333 444",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Bruno Puerta",
  "EMAIL:bruno@example.com",
  "END:VCARD",
  "",
].join("\r\n");

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-puerta-"));
  fixtureDir = path.join(harness.userData, "ficheros");
  mkdirSync(fixtureDir, { recursive: true });
  await installServices();
  const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("Puerta .ics/.vcf · los canales de importar y exportar la Agenda", () => {
  it("la vista previa de .ics anuncia el resumen entero y no escribe nada", async () => {
    const p = fixture("basico.ics", ICS_BASICO);
    const r = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(r.ok).toBe(true);
    expect(typeof r.token).toBe("string");
    const s = r.summary!;
    expect(s.rejectedCode).toBeNull();
    expect(s.total).toBe(3);
    expect(s.enter).toBe(3);
    expect(s.alreadyPresent).toBe(0);
    expect(s.recurring).toBe(1);
    expect(s.discarded).toEqual([]);
    expect(s.named?.valarm.names).toEqual(["Dentista puerta"]);
    expect(s.named?.unboundedRrule.names).toEqual(["Cumpleaños puerta"]);
    // Nada se escribió: ni en el almacén ni en la vista.
    expect(await listEvents(0, Date.UTC(2100, 0, 1))).toEqual([]);
    const data = await call<DataReply>("nido:agenda-data");
    expect(data.events).toEqual([]);
  });

  it("el commit de .ics guarda lo anunciado, con origen ics y el aviso armado; el testigo no sirve dos veces", async () => {
    const p = fixture("basico.ics", ICS_BASICO);
    const prev = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    const r = await call<CommitReply>("nido:agenda-import-commit", { kind: "ics", token: prev.token });
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(3);
    const events = await listEvents(0, Date.UTC(2100, 0, 1));
    expect(events.map((e) => e.uid).sort()).toEqual(["puerta-1@sonda", "puerta-2@sonda", "puerta-3@sonda"]);
    expect(events.every((e) => e.origin === "ics")).toBe(true);
    const conAlarma = events.find((e) => e.uid === "puerta-1@sonda")!;
    expect(conAlarma.alertOffsetMin).toBe(15);
    expect((await listArmed()).filter((n) => n.refId === conAlarma.id)).toHaveLength(1);
    // El testigo era de un solo uso.
    const otra = await call<CommitReply>("nido:agenda-import-commit", { kind: "ics", token: prev.token });
    expect(otra.ok).toBe(false);
    expect(otra.reason).toBe("bad-token");
    expect(await listEvents(0, Date.UTC(2100, 0, 1))).toHaveLength(3);
  });

  it("reimportar el mismo .ics: todo ya presente, nada duplicado", async () => {
    const p = fixture("basico.ics", ICS_BASICO);
    const prev = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(prev.summary?.alreadyPresent).toBe(3);
    expect(prev.summary?.enter).toBe(0);
    const r = await call<CommitReply>("nido:agenda-import-commit", { kind: "ics", token: prev.token });
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(0);
    expect(await listEvents(0, Date.UTC(2100, 0, 1))).toHaveLength(3);
  });

  it("el .ics rechazado sale con su código y sin testigo: no hay commit posible", async () => {
    const p = fixture("linea-larga.ics", `BEGIN:VCALENDAR\r\nSUMMARY:${"x".repeat(1_100_000)}\r\nEND:VCALENDAR\r\n`);
    const r = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(r.ok).toBe(true);
    expect(r.summary?.rejectedCode).toBe("line-too-long");
    expect(r.token).toBeNull();
    const commit = await call<CommitReply>("nido:agenda-import-commit", { kind: "ics", token: r.token });
    expect(commit.ok).toBe(false);
    expect(commit.reason).toBe("bad-token");
  });

  it("los descartes de .ics traen su código y su etiqueta", async () => {
    const p = fixture("descartes.ics", ICS_DESCARTES);
    const r = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(r.ok).toBe(true);
    const s = r.summary!;
    expect(s.total).toBe(3);
    expect(s.enter).toBe(2);
    const byCode = new Map(s.discarded.map((d) => [d.code, d]));
    expect(byCode.get("event-no-start")?.label).toBe("Sin inicio");
    expect(byCode.get("property-too-large")?.label).toBe("Descripción gigante");
    expect(byCode.get("property-too-large")?.prop).toBe("DESCRIPTION");
    expect(byCode.get("recurrence-out-of-subset")?.label).toBe("Cada hora");
    // La vista previa no escribió ninguno.
    const events = await listEvents(0, Date.UTC(2100, 0, 1));
    expect(events.map((e) => e.uid)).not.toContain("descartes-3@sonda");
  });

  it("la exportación de .ics trae el calendario con sus uid, y lo exportado se reimporta como ya presente", async () => {
    const r = await call<ExportReply>("nido:agenda-export", { kind: "ics" });
    expect(r.ok).toBe(true);
    expect(r.defaultName).toBe("nido-calendario.ics");
    expect(r.content).toContain("BEGIN:VCALENDAR");
    expect(r.content).toContain("UID:puerta-1@sonda");
    expect(r.content).toContain("UID:puerta-2@sonda");
    const p = fixture("exportado.ics", r.content!);
    const prev = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(prev.summary?.enter).toBe(0);
    expect(prev.summary?.alreadyPresent).toBe(3);
  });

  it("la vista previa de .vcf anuncia el resumen (PHOTO y sin nombre, con sus códigos) y no escribe nada", async () => {
    const p = fixture("basica.vcf", VCF_BASICA);
    const r = await call<PreviewReply>("nido:agenda-import-preview", { kind: "vcf", path: p });
    expect(r.ok).toBe(true);
    const s = r.summary!;
    expect(s.rejectedCode).toBeNull();
    expect(s.total).toBe(3);
    expect(s.enter).toBe(2);
    expect(s.alreadyPresent).toBe(0);
    const byCode = new Map(s.discarded.map((d) => [d.code, d]));
    expect(byCode.get("photo-not-stored")?.label).toBe("Carmen Puerta");
    expect(byCode.get("card-no-name")?.label).toBeNull();
    expect(await listContacts()).toEqual([]);
  });

  it("el commit de .vcf guarda con origen vcf y el aviso anual armado; la duplicada no entra", async () => {
    const p = fixture("basica.vcf", VCF_BASICA);
    const prev = await call<PreviewReply>("nido:agenda-import-preview", { kind: "vcf", path: p });
    const r = await call<CommitReply>("nido:agenda-import-commit", { kind: "vcf", token: prev.token });
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(2);
    const contacts = await listContacts();
    expect(contacts.map((c) => c.name).sort()).toEqual(["Bruno Puerta", "Carmen Puerta"]);
    expect(contacts.every((c) => c.origin === "vcf")).toBe(true);
    const carmen = contacts.find((c) => c.name === "Carmen Puerta")!;
    expect((await listArmed()).filter((n) => n.refId === carmen.id && n.kind === "birthday")).toHaveLength(1);
    // La segunda importación del mismo fichero no duplica.
    const prev2 = await call<PreviewReply>("nido:agenda-import-preview", { kind: "vcf", path: p });
    expect(prev2.summary?.alreadyPresent).toBe(2);
    expect(prev2.summary?.enter).toBe(0);
    const r2 = await call<CommitReply>("nido:agenda-import-commit", { kind: "vcf", token: prev2.token });
    expect(r2.inserted).toBe(0);
    expect(await listContacts()).toHaveLength(2);
  });

  it("la exportación de .vcf trae las fichas, y lo exportado se reimporta como ya presente", async () => {
    const r = await call<ExportReply>("nido:agenda-export", { kind: "vcf" });
    expect(r.ok).toBe(true);
    expect(r.defaultName).toBe("nido-contactos.vcf");
    expect(r.content).toContain("BEGIN:VCARD");
    expect(r.content).toContain("FN:Carmen Puerta");
    const p = fixture("exportada.vcf", r.content!);
    const prev = await call<PreviewReply>("nido:agenda-import-preview", { kind: "vcf", path: p });
    expect(prev.summary?.enter).toBe(0);
    expect(prev.summary?.alreadyPresent).toBe(2);
  });

  it("la ruta inexistente responde unreadable en los dos formatos, sin escribir nada", async () => {
    for (const kind of ["ics", "vcf"] as const) {
      const r = await call<PreviewReply>("nido:agenda-import-preview", {
        kind,
        path: path.join(fixtureDir, `no-existe.${kind}`),
      });
      expect(r.ok, kind).toBe(false);
      expect(r.reason, kind).toBe("unreadable");
    }
  });

  it("el fichero que pasa de 25 MB sale rechazado con el código de tamaño, sin commit posible", async () => {
    const p = fixture("gigante.ics", Buffer.alloc(25 * 1024 * 1024 + 1024, 0x61));
    const r = await call<PreviewReply>("nido:agenda-import-preview", { kind: "ics", path: p });
    expect(r.ok).toBe(true);
    expect(r.summary?.rejectedCode).toBe("too-large");
    expect(r.token).toBeNull();
  });

  it("sin sesión, los tres canales responden locked", async () => {
    await call<{ ok: boolean }>("nido:vault-lock");
    const p = fixture("basico.ics", ICS_BASICO);
    for (const [channel, args] of [
      ["nido:agenda-import-preview", { kind: "ics", path: p }],
      ["nido:agenda-import-commit", { kind: "ics", token: "x" }],
      ["nido:agenda-export", { kind: "ics" }],
    ] as const) {
      const r = await call<{ ok: boolean; reason?: string }>(channel, args);
      expect(r.ok, channel).toBe(false);
      expect(r.reason, channel).toBe("locked");
    }
  });
});
