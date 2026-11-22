/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * §1 pieza A del bloque del loop (H-LOOP-1 y H-LOOP-3): los
 * botones de Emergencia DICEN su guía y el turno la sirve
 * literal, sin pasar por la elección.
 *
 * La escena es la de la pasada en vivo en su estado débil:
 * el pack real del Esencial instalado en la casa del arnés y
 * NINGÚN motor residente — ni el de embeddings ni un modelo
 * de generación —, así que la elección del paso 6 no puede
 * elegir (sin cosenos no hay vara que pasar: la medición del
 * paso 0 del bloque lo cobró sobre el pack real) y sin la
 * pieza el turno cae a la ruta del modelo, que aquí no tiene
 * ni modelo que la sirva. Los dos cargos, con el arnés de
 * servicios reales de la casa (doble de Electron y
 * manejadores reales cobrados por canal):
 *
 * 1. `turnSend` con `guideKey: "esencial-rcp-adultos"` y la
 *    pregunta fija del botón sirve el texto de la guía de
 *    RCP, con su cabecera literal y su ruta `guide-forced`.
 * 2. Lo mismo con `esencial-hemorragias-graves` y la
 *    pregunta de sangrado: la guía de hemorragias, no la de
 *    la nariz que la mezcla léxica corona.
 *
 * Los dos nacen en rojo contra la punta sin la pieza: el
 * campo `guideKey` no existe en ningún punto del camino y
 * el turno lo ignora entero.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

const PASSWORD = "sonda-loop1-guia";

const event = {
  sender: {
    send: (channel: string, payload: { conversationId?: string; id?: string }) => {
      // Sin renderizador no hay quien responda a una petición
      // de confirmación: el arnés la deniega al momento por el
      // canal de respuesta, como el arnés de la puerta hace.
      if (channel === "nido:confirm-request" && typeof payload?.id === "string") {
        const id = payload.id;
        setTimeout(() => {
          const fn = harness.listeners.get("nido:confirm-response");
          fn?.(
            { sender: { getURL: () => "nido://app/index.html" } },
            { id, approved: false },
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
  result?: { text?: string; route?: string };
};

function call(channel: string, args?: unknown): Promise<TurnReply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<TurnReply>;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-loop1-guia-"));
  // El pack real del Esencial, en su sitio de la casa
  // (store/packs/corpus, el que onUnlocked registra): la
  // vía de packs rechaza simbólicos, así que enlace duro
  // desde el paquete incluido en el árbol, como las escenas
  // de la casa siembran sus modelos.
  const corpusDir = path.join(harness.userData, "store", "packs", "corpus");
  mkdirSync(corpusDir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "assets", "bundled-packs", "nido-esencial.sqlite"),
    path.join(corpusDir, "nido-esencial.sqlite"),
  );
  await installServices();
  const created = await call("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("§1 pieza A · la guía forzada de los botones de Emergencia", () => {
  it("el botón de RCP sirve su guía literal por la ruta guide-forced, sin elección", async () => {
    const r = await call("nido:turn-send", {
      conversationId: "loop1-a-rcp",
      text: "¿Cómo se hace la RCP en un adulto?",
      guideKey: "esencial-rcp-adultos",
    });
    expect(r.ok).toBe(true);
    expect(r.result?.route).toBe("guide-forced");
    expect(r.result?.text).toContain(
      "Guía «RCP (reanimación) en adultos y niños mayores» de NIDO Esencial, tal como está escrita (sin modelo):",
    );
    expect(r.result?.text).toContain("Compresiones en el pecho");
    expect(r.result?.text).toContain("30 compresiones y 2 respiraciones");
  }, 120_000);

  it("el botón de sangrado sirve la guía de hemorragias, no la de la nariz", async () => {
    const r = await call("nido:turn-send", {
      conversationId: "loop1-a-sangrado",
      text: "¿Cómo detengo un sangrado fuerte?",
      guideKey: "esencial-hemorragias-graves",
    });
    expect(r.ok).toBe(true);
    expect(r.result?.route).toBe("guide-forced");
    expect(r.result?.text).toContain(
      "Guía «Hemorragias graves: cómo parar la sangre» de NIDO Esencial, tal como está escrita (sin modelo):",
    );
    expect(r.result?.text).toContain("morir desangrada en pocos minutos");
    expect(r.result?.text).toContain("Torniquete (brazos y piernas)");
    expect(r.result?.text).not.toContain("parte blanda de la nariz");
  }, 120_000);
});
