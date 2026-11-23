/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 4 de E7: la agenda de contactos de NIDO.
 * Puerta del paso en la enumeración de E7-DECISIONES §5.2,
 * grupo Contactos, en la forma (B) del dirimen N-2: 9 casos
 * simples + 2 declaraciones de textos con it.each de 3 filas
 * (las letras H-1 y H-2 de HONESTIDAD.md, palabra a palabra)
 * = 15 ejecutados. La agenda vive en la base cifrada de NIDO;
 * ningún módulo de agenda del SO entra en el grafo.
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

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../../security/appStore.js";
import { closeDatabase } from "../../security/databaseManager.js";
import { buildToolHandlers, setHandlerLangForTest } from "../tools/handlers.js";
import { runContactAction, type ContactSearchResult } from "../loop/contactRouter.js";
import { answerMemoryQuery } from "../loop/memoryQuery.js";
import { getPeople } from "./memoryStore.js";
import {
  createContact,
  getContact,
  listContacts,
  searchContacts,
} from "./contactStore.js";
import { listArmed } from "./noticeStore.js";
import { exportVcf, importVcf } from "./contactVcf.js";

let dir: string;
const KEY = randomBytes(32);
const HERE = dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e7contactos-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  // I18N-2: la fijación de idioma de los handlers no sale del caso que la puso.
  setHandlerLangForTest(null);
  rmSync(dir, { recursive: true, force: true });
});

const PHONE = "+34 600 123 456";
const searchDep = async (query: string): Promise<ContactSearchResult> => ({
  ok: true,
  matches: await searchContacts(query),
});
const deps = { search: searchDep, isDisabled: () => false };

describe("E7 paso 4 · agenda de contactos", () => {
  it("test de dependencias: sin módulo de agenda del SO en el grafo de la ejecución", () => {
    const handlers = readFileSync(join(HERE, "..", "tools", "handlers.ts"), "utf8");
    const store = readFileSync(join(HERE, "contactStore.ts"), "utf8");
    for (const src of [handlers, store]) {
      expect(src).not.toContain("expo-contacts");
      expect(src).not.toContain("expo-calendar");
    }
    expect(handlers).not.toContain("ensureRuntimePermission");
  });

  it("el número enseñado es el de la ficha encontrada", async () => {
    await createContact({
      name: "Carmen Ruiz",
      phones: [
        { label: "móvil", number: PHONE },
        { label: "casa", number: "+34 910 000 000" },
      ],
    });
    const out = await runContactAction(
      { kind: "call", target: "Carmen Ruiz", lang: "es" },
      deps,
    );
    expect(out.response).toContain(PHONE);
    expect(out.response).not.toContain("+34 910 000 000");
  });

  it("sin ficha no se enseña ningún número", async () => {
    const out = await runContactAction(
      { kind: "call", target: "Nadie Guardado", lang: "es" },
      deps,
    );
    expect(out.response).toContain("No encontré");
    expect(out.response).not.toMatch(/\d{4,}/);
  });

  it.each([
    ["es", `En este PC no puedo llamar. El número de Carmen Ruiz que tengo guardado es ${PHONE}: márcalo desde tu teléfono.`],
    ["en", `On this PC I can't make calls. The number I have saved for Carmen Ruiz is ${PHONE}: dial it from your phone.`],
    ["pt", `Neste PC não consigo ligar. O número de Carmen Ruiz que tenho guardado é ${PHONE}: disque do seu telefone.`],
  ] as const)("texto exacto de no disponible de place_call en %s (H-1)", async (lang, expected) => {
    await createContact({ name: "Carmen Ruiz", phones: [{ label: "", number: PHONE }] });
    const out = await runContactAction({ kind: "call", target: "Carmen Ruiz", lang }, deps);
    expect(out.response).toBe(expected);
  });

  it.each([
    ["es", `En este PC no puedo mandar SMS. El número de Carmen Ruiz que tengo guardado es ${PHONE}: escríbele desde tu teléfono.`],
    ["en", `On this PC I can't send texts. The number I have saved for Carmen Ruiz is ${PHONE}: text them from your phone.`],
    ["pt", `Neste PC não consigo enviar SMS. O número de Carmen Ruiz que tenho guardado é ${PHONE}: escreva do seu telefone.`],
  ] as const)("texto exacto de no disponible de send_sms en %s (H-2)", async (lang, expected) => {
    await createContact({ name: "Carmen Ruiz", phones: [{ label: "", number: PHONE }] });
    const out = await runContactAction(
      { kind: "sms", target: "Carmen Ruiz", message: "llego tarde", lang },
      deps,
    );
    expect(out.response).toBe(expected);
  });

  it("save_person con cumpleaños crea la ficha y arma el aviso anual", async () => {
    const h = buildToolHandlers({});
    const out = await h["save_person"]({
      name: "Carmen Ruiz",
      relationship: "hermana",
      birthday: "1990-06-08",
      phone: PHONE,
    });
    expect(out).toContain("Carmen Ruiz");
    const all = await listContacts();
    expect(all).toHaveLength(1);
    expect(all[0].birthdayMonth).toBe(6);
    expect(all[0].birthdayDay).toBe(8);
    expect(all[0].birthdayYear).toBe(1990);
    expect(all[0].phones[0].number).toBe(PHONE);
    const armed = (await listArmed()).filter((n) => n.kind === "birthday");
    expect(armed).toHaveLength(1);
    expect(armed[0].refId).toBe(all[0].id);
    expect(armed[0].repeat).toBe("year");
  });

  it("memory_query responde desde la ficha", async () => {
    const h = buildToolHandlers({});
    await h["save_person"]({ name: "Carmen Ruiz", relationship: "hermana" });
    const people = await getPeople();
    const answer = answerMemoryQuery(
      "¿cómo se llama mi hermana?",
      { facts: [], people },
      "es",
    );
    expect(answer).toContain("Carmen Ruiz");
  });

  it("borrar sin confirmación no borra", async () => {
    // Reconciliación I18N-2 (con su causa): el caso cobra el
    // error servido por L() en español («no se borró nada») y
    // nunca fijaba el idioma de los handlers. Pasaba porque
    // uiLang() caía por el require perezoso muerto a su defecto
    // duro «es»; con el módulo i18n del núcleo vivo, uiLang()
    // lee el idioma del módulo, que en el banco nace en el del
    // dispositivo. El caso fija ahora setHandlerLangForTest("es"),
    // la forma de la extensión dirimida para confirm.test.ts.
    setHandlerLangForTest("es");
    const ficha = await createContact({
      name: "Carmen Ruiz",
      relation: "hermana",
      birthdayMonth: 6,
      birthdayDay: 8,
    });
    const h = buildToolHandlers({});
    await expect(
      h["delete_memory"]({ id: ficha.id, kind: "person", content: "otra cosa distinta" }),
    ).rejects.toThrow(/no se borró nada/);
    expect(await getContact(ficha.id)).not.toBeNull();
    expect((await listArmed()).filter((n) => n.refId === ficha.id)).toHaveLength(1);
  });

  it("borrar con confirmación desarma en la misma operación", async () => {
    const ficha = await createContact({
      name: "Carmen Ruiz",
      relation: "hermana",
      birthdayMonth: 6,
      birthdayDay: 8,
    });
    expect((await listArmed()).filter((n) => n.refId === ficha.id)).toHaveLength(1);
    const h = buildToolHandlers({});
    const out = await h["delete_memory"]({
      id: ficha.id,
      kind: "person",
      content: "Carmen Ruiz (hermana)",
    });
    expect(out).toContain("Carmen Ruiz");
    expect(await getContact(ficha.id)).toBeNull();
    expect((await listArmed()).filter((n) => n.refId === ficha.id)).toHaveLength(0);
  });

  it(".vcf ida y vuelta por nombre normalizado y teléfono, con su deduplicación", async () => {
    await createContact({
      name: "Carmen Ruiz",
      relation: "hermana",
      birthdayMonth: 6,
      birthdayDay: 8,
      phones: [{ label: "móvil", number: PHONE }],
      emails: [{ label: "", address: "carmen@example.com" }],
      notes: "Le gustan los tulipanes",
    });
    await createContact({ name: "Bruno Díaz", phones: [{ label: "", number: "+34 611 222 333" }] });
    const text = exportVcf(await listContacts());
    await closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "nido-e7vcf-b-"));
    setAppStoreDir(dir);
    const r1 = await importVcf(text, { confirmed: true });
    expect(r1.inserted).toBe(2);
    const back = await listContacts();
    expect(back.map((c) => c.name).sort()).toEqual(["Bruno Díaz", "Carmen Ruiz"]);
    const carmen = back.find((c) => c.name === "Carmen Ruiz")!;
    expect(carmen.phones[0].number).toBe(PHONE);
    expect(carmen.birthdayMonth).toBe(6);
    const r2 = await importVcf(text, { confirmed: true });
    expect(r2.inserted).toBe(0);
    expect(r2.summary.alreadyPresent).toBe(2);
    expect(await listContacts()).toHaveLength(2);
  });

  it(".vcf con el mismo trato hostil que la .ics", async () => {
    const withPhoto = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Carmen Ruiz",
      `PHOTO;ENCODING=b:${"QUJD".repeat(40)}`,
      "TEL:+34 600 123 456",
      "END:VCARD",
    ].join("\r\n");
    const summary = (await importVcf(withPhoto, { confirmed: false })).summary;
    expect(summary.discarded.some((d) => /PHOTO/.test(d.what))).toBe(true);

    const giant = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Grande",
      `NOTE:${"x".repeat(1_100_000)}`,
      "END:VCARD",
    ].join("\r\n");
    const r = await importVcf(giant, { confirmed: true });
    expect(r.inserted).toBe(0);
    expect(r.summary.rejected).toMatch(/línea/i);
    expect(await listContacts()).toHaveLength(0);
  });
});
