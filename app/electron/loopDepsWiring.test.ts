/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * CABLE-1: las dependencias de memoria del bucle, cableadas
 * en los turnos de chat de producción. La batería instala
 * los servicios reales sobre el doble de Electron de la
 * casa y conduce los turnos por `nido:turn-send`, que
 * construye sus dependencias con `productionTurnDeps` en
 * cada envío: ninguna dependencia se inyecta a mano. Es
 * el arnés que cobra el hueco que la sonda de CONF-1
 * encontró en vivo (con la nota sembrada y visible, «Borra
 * la nota Receta de la abuela» respondía «No encontré
 * ninguna nota…» sin despachar nada): la llamada de
 * producción a `runAgentLoop` no pasaba `listNoteTitles`,
 * `listNotesFull`, `listReminders`, `listMemories` ni
 * `choiceStore`, y las rutas deterministas de notas,
 * recordatorios y recuerdos estaban muertas en el chat.
 *
 * La escena siembra por el almacén real del app tres
 * notas de títulos conocidos, un recordatorio y un hecho.
 * Los casos cobran, por la vía de producción entera: leer
 * una nota por título, buscar dentro de su cuerpo, la
 * elección pendiente («¿cuál?») consumida por el turno
 * siguiente, el listado de recordatorios, y los tres
 * borrados con su petición de confirmación (un recuerdo,
 * un recordatorio y una nota por título, con la frase
 * exacta del descubrimiento). El listado de notas es la
 * guarda: sin proveedor la ruta cae a la herramienta
 * `list_notes` y sirve igual, así que nace verde y se
 * queda cobrando que el listado nombra los títulos.
 *
 * Nacimiento sin la cura: los casos de leer, buscar,
 * elegir, listar recordatorios, olvidar y los dos
 * borrados restantes en rojo por su causa exacta (la
 * respuesta «no encontré» o el texto de fallo, cero
 * peticiones de confirmación y el dato intacto).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
  confirmRequests: [] as Array<Record<string, unknown>>,
  confirmVerdict: true,
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
import { llamaEngine } from "../../src/inference/LlamaEngine.js";
import * as memoryStore from "../../src/agent/memory/memoryStore.js";

const PASSWORD = "sonda-cable1-20";
const NOTA_ABUELA = "Receta de la abuela";
const NOTA_COMPRAS = "compras del acuario";
const NOTA_PAN = "receta de pan casero";
const RECORDATORIO = "comprar pan";
const HECHO = "Mi color favorito es el azul";

const event = {
  sender: {
    send: (channel: string, payload: { id?: string }) => {
      if (channel === "nido:confirm-request" && typeof payload?.id === "string") {
        harness.confirmRequests.push({ ...payload });
        const id = payload.id;
        setTimeout(() => {
          const fn = harness.listeners.get("nido:confirm-response");
          fn?.(
            { sender: { getURL: () => "nido://app/index.html" } },
            { id, approved: harness.confirmVerdict },
          );
        }, 10);
      }
    },
  },
  senderFrame: { url: "nido://app/index.html" },
};

type TurnReply = {
  ok: boolean;
  reason?: string;
  result?: { text: string; route: string };
};
type ListReply = {
  ok: boolean;
  notes?: Array<{ id: string; title: string }>;
};

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

async function titulosDeNotas(): Promise<string[]> {
  const r = await call<ListReply>("nido:memory-list");
  expect(r.ok).toBe(true);
  return (r.notes ?? []).map((n) => n.title);
}

async function enviar(conversationId: string, text: string): Promise<TurnReply> {
  const reply = await call<TurnReply>("nido:turn-send", { conversationId, text });
  expect(reply.ok).toBe(true);
  return reply;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-cable1-"));
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "models", "qwen2.5-1.5b-instruct-q4km.gguf"),
    path.join(modelsDir, "qwen2.5-1.5b-instruct-q4km.gguf"),
  );
  await installServices();
}, 60_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("CABLE-1: las rutas de memoria del bucle, vivas en el chat de producción", () => {
  it("la escena: la bóveda nace, el 1.5B queda residente y la memoria se siembra", async () => {
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    await call("nido:model-load", { id: "qwen2.5-1.5b-instruct-q4km" });
    expect(llamaEngine.isLoaded).toBe(true);
    await memoryStore.saveNote({ title: NOTA_ABUELA, body: "Lleva comino y pimentón" });
    await memoryStore.saveNote({ title: NOTA_COMPRAS, body: "Comprar filtros y comida para los peces" });
    await memoryStore.saveNote({ title: NOTA_PAN, body: "Harina, agua, sal y levadura" });
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(9, 0, 0, 0);
    await memoryStore.saveReminder({ text: RECORDATORIO, dueAt: manana.toISOString() });
    await memoryStore.saveFact({ content: HECHO });
    expect(await titulosDeNotas()).toEqual(expect.arrayContaining([NOTA_ABUELA, NOTA_COMPRAS, NOTA_PAN]));
  }, 240_000);

  it("guarda: «¿qué notas tengo?» nombra los tres títulos", async () => {
    const reply = await enviar("cable-lista-notas", "¿qué notas tengo?");
    const text = reply.result?.text ?? "";
    expect(text).toContain(NOTA_ABUELA);
    expect(text).toContain(NOTA_COMPRAS);
    expect(text).toContain(NOTA_PAN);
  }, 300_000);

  it("leer por título: «lee la nota de compras» sirve su cuerpo", async () => {
    const reply = await enviar("cable-leer", "lee la nota de compras");
    const text = reply.result?.text ?? "";
    expect(text).toContain("filtros");
    expect(text).not.toContain("No encontré ninguna nota");
  }, 300_000);

  it("buscar en el cuerpo: «busca en mis notas algo sobre comino» encuentra la nota por su cuerpo", async () => {
    const reply = await enviar("cable-buscar", "busca en mis notas algo sobre comino");
    const text = reply.result?.text ?? "";
    expect(text).toContain(NOTA_ABUELA);
  }, 300_000);

  it("la elección pendiente: «lee la nota de la receta» pregunta cuál, y el turno siguiente la resuelve", async () => {
    const t1 = await enviar("cable-eleccion", "lee la nota de la receta");
    const text1 = t1.result?.text ?? "";
    expect(text1).toContain("¿Cuál?");
    expect(text1).toContain(NOTA_ABUELA);
    expect(text1).toContain(NOTA_PAN);
    const t2 = await enviar("cable-eleccion", NOTA_PAN);
    const text2 = t2.result?.text ?? "";
    expect(text2).toContain("Harina");
  }, 300_000);

  it("listar recordatorios: «¿qué recordatorios tengo?» nombra el que hay", async () => {
    const reply = await enviar("cable-lista-recordatorios", "¿qué recordatorios tengo?");
    const text = reply.result?.text ?? "";
    expect(text).toContain(RECORDATORIO);
  }, 300_000);

  it("olvidar con confirmación: «olvida mi color favorito» pide confirmación y el hecho desaparece", async () => {
    harness.confirmVerdict = true;
    const antes = harness.confirmRequests.length;
    const reply = await enviar("cable-olvido", "olvida mi color favorito");
    expect(reply.ok).toBe(true);
    const cargas = harness.confirmRequests.slice(antes);
    expect(cargas).toHaveLength(1);
    expect(cargas[0].tool).toBe("delete_memory");
    const facts = await memoryStore.getOwnerFacts(100);
    expect(facts.map((f) => f.content)).not.toContain(HECHO);
  }, 300_000);

  it("borrar un recordatorio con confirmación: «borra el recordatorio de comprar pan» lo borra", async () => {
    harness.confirmVerdict = true;
    const antes = harness.confirmRequests.length;
    const reply = await enviar("cable-borra-recordatorio", "borra el recordatorio de comprar pan");
    expect(reply.ok).toBe(true);
    const cargas = harness.confirmRequests.slice(antes);
    expect(cargas).toHaveLength(1);
    expect(cargas[0].tool).toBe("delete_reminder");
    const restantes = await memoryStore.listReminders(50);
    expect(restantes.map((r) => r.text)).not.toContain(RECORDATORIO);
  }, 300_000);

  it("borrar una nota por título: «Borra la nota Receta de la abuela» pide confirmación y la borra", async () => {
    harness.confirmVerdict = true;
    const antes = harness.confirmRequests.length;
    const reply = await enviar("cable-borra-nota", `Borra la nota ${NOTA_ABUELA}`);
    expect(reply.ok).toBe(true);
    const cargas = harness.confirmRequests.slice(antes);
    expect(cargas).toHaveLength(1);
    expect(cargas[0].tool).toBe("delete_note");
    const titulos = await titulosDeNotas();
    expect(titulos).not.toContain(NOTA_ABUELA);
    expect(titulos).toContain(NOTA_COMPRAS);
    expect(titulos).toContain(NOTA_PAN);
  }, 300_000);
});
