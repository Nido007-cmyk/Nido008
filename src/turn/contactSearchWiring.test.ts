/**
 * Acto de cura de E8 (VERIFICACION-E7, R-4/R-5.3): el cable
 * del proveedor de búsqueda de contactos al turno.
 *
 * El proveedor existía desde E7 (`contactStore.searchContacts`,
 * ejercido por contactsReal) pero las opciones del turno de PC
 * nunca lo pasaban: «busca el contacto Laura» caía al modelo y
 * el modelo respondía «No supe qué acción hacer con eso…» con
 * la ficha creada. En el móvil el mismo turno lo pasa
 * (ChatScreen: `contactSearch: searchPhoneContacts`) y la frase
 * se resuelve por la vía determinista, sin modelo.
 *
 * Los cargos:
 * 1. Los deps de producción del turno traen `contactSearch` y
 *    el adaptador encuentra la ficha sembrada en la base real.
 * 2. Con esas opciones, «busca el contacto Laura» se resuelve
 *    determinista y la respuesta trae la ficha (nombre y
 *    número), sin llamar al motor: el doble del motor lanza si
 *    se le habla.
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
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "../security/appStore.js";
import { closeDatabase } from "../security/databaseManager.js";
import { createContact } from "../agent/memory/contactStore.js";
import { productionTurnDeps } from "./turnPipeline.js";
import { runAgentLoop, type AgentEngine } from "../agent/loop/agentLoop.js";

const KEY = randomBytes(32);
let dir: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-cura-contactsearch-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});
afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const PHONE = "+34 612 345 678";

async function deps() {
  return productionTurnDeps({
    handlers: {},
    packFacts: async () => ({ regions: [], facts: [] }),
  });
}

describe("cura R-4/R-5.3: contactSearch cosido al turno", () => {
  it("los deps de producción traen el adaptador y encuentra la ficha en la base real", async () => {
    await createContact({ name: "Laura Prueba", phones: [{ number: PHONE, label: "móvil" }] });
    const d = await deps();
    expect(typeof d.contactSearch).toBe("function");
    const res = await d.contactSearch!("Laura");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matches).toHaveLength(1);
      expect(res.matches[0].name).toBe("Laura Prueba");
      expect(res.matches[0].phones[0]).toBe(PHONE);
    }
  });

  it("«busca el contacto Laura» se resuelve determinista con la ficha, sin hablar al motor", async () => {
    await createContact({ name: "Laura Prueba", phones: [{ number: PHONE, label: "móvil" }] });
    const d = await deps();
    let engineCalls = 0;
    const engine: AgentEngine = {
      generate: async () => {
        engineCalls++;
        throw new Error("el motor no debe hablar en esta vía");
      },
    };
    const out = await runAgentLoop("busca el contacto Laura", {
      engine,
      handlers: {},
      lang: "es",
      contactSearch: d.contactSearch,
    });
    expect(engineCalls).toBe(0);
    expect(out.deterministic).toBe(true);
    expect(out.response).toContain("Laura Prueba");
    expect(out.response).toContain(PHONE);
  });
});
