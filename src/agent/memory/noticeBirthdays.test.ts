/**
 * E8 (paso 7): la batería de los cumpleaños (AVISOS §7).
 *
 * - El previo derivado: vive solo en la agenda (mismo id de
 *   serie, ocurrencia marcada `pre`, la víspera a las 20:00),
 *   se entrega una sola vez cuando su instante llega y el
 *   principal aún está por venir, y se vuelve a derivar para
 *   la ocurrencia siguiente cuando la serie avanza. Con
 *   antelación en la ficha no hay previo.
 * - La edad: el aviso dice los años que cumple solo si la
 *   memoria guarda el año; sin año, el nombre a secas.
 * - El archivo: la presentación de un cumpleaños sale de la
 *   vista a los 7 días; dentro de la ventana, se queda.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import {
  configureNoticeAgenda,
  readNoticeAgenda,
  type NoticeAgendaCipher,
} from "./noticeAgenda.js";
import { createContact } from "./contactStore.js";
import {
  composeOsPayload,
  runDispatchPass,
  runPrePass,
  type DispatchTexts,
  type OsPayload,
} from "./noticeDispatcher.js";
import {
  armNotice,
  getNotice,
  listArmed,
  listNoticeView,
  toBaseLocal,
} from "./noticeStore.js";

const KEY = randomBytes(32);
const AGENDA_KEY = randomBytes(32);
const testCipher: NoticeAgendaCipher = {
  seal(plain) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", AGENDA_KEY, iv);
    const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
  },
  unseal(sealed) {
    try {
      const raw = Buffer.from(sealed, "base64");
      const d = createDecipheriv("aes-256-gcm", AGENDA_KEY, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    } catch {
      return null;
    }
  },
};

let dir: string;
beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e8birthdays-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
  configureNoticeAgenda({ filePath: join(dir, "agenda.bin"), cipher: testCipher });
});
afterEach(async () => {
  configureNoticeAgenda(null);
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const TEXTS: DispatchTexts = {
  kindTitle: () => "Cumpleaños",
  genericBody: () => "Tienes un aviso de NIDO",
  summaryTitle: (n) => `${n} avisos`,
  summaryBody: (n) => `${n} avisos`,
  birthdayAge: (name, age) => `${name} cumple ${age} años`,
};

describe("E8 paso 7: cumpleaños", () => {
  it("el previo se deriva en la agenda (víspera 20:00, mismo id, marcado pre) y se entrega una sola vez", async () => {
    // Cumpleaños el 10 de junio; hoy es 1 de junio de 2026.
    const contact = await createContact(
      { name: "Carmen Ruiz", birthdayMonth: 6, birthdayDay: 10, birthdayYear: 1990 },
      new Date(2026, 5, 1, 12, 0),
    );
    const series = (await listArmed()).find((n) => n.kind === "birthday");
    expect(series?.refId).toBe(contact.id);
    expect(series?.nextFireAt).toBe(new Date(2026, 5, 10, 9, 0).getTime());
    // La base sigue teniendo UNA fila de cumpleaños.
    expect((await listArmed()).filter((n) => n.kind === "birthday")).toHaveLength(1);

    // La materialización de la ficha sincroniza la agenda por
    // la reconciliación (el camino de producción: cada
    // retorno a la vida reconcilia antes de mirar la agenda).
    const { reconcileNoticeAgenda } = await import("./noticeStore.js");
    await reconcileNoticeAgenda();
    const agenda = await readNoticeAgenda();
    const pre = agenda.entries.find((e) => e.pre === true);
    expect(pre?.id).toBe(series!.id);
    expect(pre?.nextFireAt).toBe(new Date(2026, 5, 9, 20, 0).getTime());
    // El fichero de la agenda no enseña el nombre.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(dir, "agenda.bin"), "utf8")).not.toContain("Carmen");

    const sent: OsPayload[] = [];
    const deps = {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: (p: OsPayload) => {
        sent.push(p);
      },
    };
    // Antes de la víspera: nada.
    await runPrePass(new Date(2026, 5, 9, 19, 0).getTime(), deps);
    expect(sent).toHaveLength(0);
    // A las 20:00 de la víspera: el previo, con la edad.
    const pass = await runPrePass(new Date(2026, 5, 9, 20, 0).getTime(), deps);
    expect(pass.presented).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("birthday");
    expect(sent[0].body).toBe("Carmen Ruiz cumple 36 años");
    // Otra pasada no lo repite (la marca de consumo vive en
    // la agenda) y la sincronización ya no lo deriva.
    await runPrePass(new Date(2026, 5, 9, 21, 0).getTime(), deps);
    expect(sent).toHaveLength(1);
    const agenda2 = await readNoticeAgenda();
    expect(agenda2.preFiredFor[series!.id]).toBe(series!.nextFireAt);
  });

  it("con antelación en la ficha no hay previo: el aviso de la persona ya es su preparación", async () => {
    await createContact(
      { name: "Luis Paz", birthdayMonth: 6, birthdayDay: 10, alertLeadDays: 2 },
      new Date(2026, 5, 1, 12, 0),
    );
    const series = (await listArmed()).find((n) => n.kind === "birthday");
    expect(series?.nextFireAt).toBe(new Date(2026, 5, 8, 9, 0).getTime());
    const agenda = await readNoticeAgenda();
    expect(agenda.entries.some((e) => e.pre === true)).toBe(false);
  });

  it("tras el principal, la serie avanza y el previo se deriva para la ocurrencia siguiente", async () => {
    await createContact(
      { name: "Carmen Ruiz", birthdayMonth: 6, birthdayDay: 10 },
      new Date(2026, 5, 1, 12, 0),
    );
    const sent: OsPayload[] = [];
    const deps = {
      vaultOpen: true,
      showText: true,
      texts: TEXTS,
      osSink: (p: OsPayload) => {
        sent.push(p);
      },
    };
    // El principal suena a su hora (sin año: el nombre a secas).
    const fired = await runDispatchPass(new Date(2026, 5, 10, 9, 0, 30).getTime(), deps);
    expect(fired.fired).toHaveLength(1);
    expect(sent[0].body).toBe("Carmen Ruiz");
    const series = (await listArmed()).find((n) => n.kind === "birthday");
    const next = await getNotice(series!.id);
    expect(next?.nextFireAt).toBe(new Date(2027, 5, 10, 9, 0).getTime());
    const agenda = await readNoticeAgenda();
    const pre = agenda.entries.find((e) => e.pre === true);
    expect(pre?.nextFireAt).toBe(new Date(2027, 5, 9, 20, 0).getTime());
  });

  it("la edad solo con año guardado: composeOsPayload con y sin año", async () => {
    const withYear = await armNotice({
      kind: "birthday",
      body: { text: "Carmen Ruiz", birthdayYear: 1990 },
      baseLocal: toBaseLocal(new Date(2026, 5, 10, 9, 0)),
      repeat: "year",
    });
    expect(composeOsPayload(withYear, true, TEXTS).body).toBe("Carmen Ruiz cumple 36 años");
    const noYear = await armNotice({
      kind: "birthday",
      body: { text: "Luis Paz" },
      baseLocal: toBaseLocal(new Date(2026, 5, 10, 9, 0)),
      repeat: "year",
    });
    expect(composeOsPayload(noYear, true, TEXTS).body).toBe("Luis Paz");
    // Sin texto (§5.3): ni nombre ni edad, el genérico.
    expect(composeOsPayload(withYear, false, TEXTS).body).toBe("Tienes un aviso de NIDO");
  });

  it("el archivo de la vista: el cumpleaños presentado sale a los 7 días; dentro, se queda", async () => {
    const now = Date.now();
    const recent = await armNotice({
      kind: "birthday",
      body: { text: "Reciente" },
      baseLocal: toBaseLocal(new Date(now - 3 * 24 * 3600_000)),
    });
    const old = await armNotice({
      kind: "birthday",
      body: { text: "Antiguo" },
      baseLocal: toBaseLocal(new Date(now - 8 * 24 * 3600_000)),
    });
    // Ambos quedan presentados como perdidos (su estado en
    // la vista es el de la fila; aquí se fuerza el estado por
    // la vía del almacén que la recuperación usa).
    const { markMissed } = await import("./noticeStore.js");
    await markMissed(recent.id);
    await markMissed(old.id);
    const view = await listNoticeView(now);
    expect(view.some((n) => n.id === recent.id)).toBe(true);
    expect(view.some((n) => n.id === old.id)).toBe(false);
  });
});
