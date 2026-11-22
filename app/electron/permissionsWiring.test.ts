/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La pieza de permisos del agente (bloque de cableado, pieza 1):
 * la maquinaria de consumo de `disabledTools` ya vive en PC,
 * espejo del móvil y probada por sus propias baterías (la
 * compuerta del despachador, las vías rápidas del bucle, los
 * enrutadores), pero el conjunto en memoria nacía vacío en cada
 * proceso y la clave persistida no tenía ningún escritor: la
 * persona no podía apagar ninguna herramienta y la marca de
 * «herramienta apagada» de la guía era inerte. La pieza pone
 * los tres cables que faltan y esta batería los cobra sobre el
 * arnés de servicios reales de la casa (doble de Electron y
 * manejadores reales cobrados por canal):
 *
 * 1. La hidratación alimenta la compuerta. Con la bóveda
 *    creada y una clave persistida que apaga una herramienta
 *    (sembrada por `setDisabledToolNames` antes del
 *    desbloqueo), tras `nido:vault-unlock` el conjunto
 *    responde `isToolDisabled(name) === true` y un despacho
 *    de esa herramienta en el mismo proceso vuelve con
 *    estado `disabled` sin tocar su handler. Nace en rojo:
 *    sin la pieza nadie hidrata y el despacho se ejecuta.
 * 2. La escritura por el canal vale en el acto. Con la sesión
 *    viva, `nido:settings-set` con `disabledTools: [name]`
 *    persiste (releído por `getDisabledToolNames`) y alimenta
 *    el conjunto en el mismo gesto: el despacho siguiente
 *    vuelve `disabled` sin reiniciar ni redesbloquear. Nace
 *    en rojo en sustancia: sin la pieza el manejador ignora
 *    el campo y devuelve `ok: true` sin escribir nada; el
 *    caso cobra el efecto, no la respuesta.
 * 3. El bloqueo deja el conjunto vacío. Tras bloquear,
 *    `isToolDisabled` responde falso para las herramientas
 *    de los casos 1 y 2, y una escritura con la bóveda
 *    bloqueada vuelve `{ ok: false, reason: "locked" }` sin
 *    poblar ni el almacén ni el conjunto (el almacén se
 *    relee tras redesbloquear: la escritura rechazada no
 *    dejó rastro). Nace como regresión verde: la mitad del
 *    `locked` ya es verde sin la pieza (la guarda de sesión
 *    precede a los campos) y el invariante nuevo se asienta
 *    verde en las dos puntas.
 * 4. La foto del bootstrap trae la lista, y la marca con
 *    ella. Tras la escritura del caso 2, `nido:bootstrap`
 *    devuelve `disabledTools` con los nombres escritos: es
 *    la foto exacta que la vista de Aprende lee para su
 *    marca de herramienta apagada. Nace en rojo, por la
 *    misma causa que el caso 2.
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
import { getDisabledToolNames, setDisabledToolNames } from "../../src/models/settings.js";
import { isToolDisabled } from "../../src/agent/tools/toolPermissions.js";
import { dispatchToolCallDetailed } from "../../src/agent/tools/dispatcher.js";

const PASSWORD = "sonda-cableado1-permisos";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type Reply = { ok: boolean; reason?: string };
type BootReply = { disabledTools?: string[] };

function call(channel: string, args?: unknown): Promise<Reply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<Reply>;
}

function callBoot(): Promise<BootReply> {
  const fn = harness.handlers.get("nido:bootstrap");
  if (!fn) throw new Error("sin manejador registrado: nido:bootstrap");
  return fn(event, undefined) as Promise<BootReply>;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-cableado1-permisos-"));
  await installServices();
  const created = await call("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("permisos del agente: la hidratación, el escritor y la foto", () => {
  it(
    "la hidratación alimenta la compuerta: la clave persistida apaga la herramienta al desbloquear",
    async () => {
      // La siembra: la clave persistida apaga device_time,
      // escrita por el propio almacén con la sesión viva de la
      // creación, antes de este desbloqueo.
      await setDisabledToolNames(["device_time"]);
      expect(await getDisabledToolNames()).toEqual(["device_time"]);

      const locked = await call("nido:vault-lock");
      expect(locked.ok).toBe(true);
      const unlocked = await call("nido:vault-unlock", { password: PASSWORD });
      expect(unlocked.ok).toBe(true);

      // Tras el desbloqueo, el conjunto en memoria trae la lista.
      expect(isToolDisabled("device_time")).toBe(true);

      // Y la compuerta la cobra en el mismo proceso: el despacho
      // vuelve disabled sin tocar el handler.
      const handler = vi.fn(async () => "12:00");
      const out = await dispatchToolCallDetailed(
        { name: "device_time", arguments: {} },
        { device_time: handler },
      );
      expect(out.status).toBe("disabled");
      expect(handler).not.toHaveBeenCalled();
    },
    120_000,
  );

  it(
    "la escritura por el canal vale en el acto: persiste y alimenta el conjunto sin redesbloquear",
    async () => {
      const r = await call("nido:settings-set", {
        disabledTools: ["device_time", "list_notes"],
      });
      expect(r.ok).toBe(true);

      // Persiste: el almacén relee la lista entera, ordenada.
      expect(await getDisabledToolNames()).toEqual(["device_time", "list_notes"]);
      // Y el conjunto obedece en el mismo gesto.
      expect(isToolDisabled("list_notes")).toBe(true);

      const handler = vi.fn(async () => "notas");
      const out = await dispatchToolCallDetailed(
        { name: "list_notes", arguments: {} },
        { list_notes: handler },
      );
      expect(out.status).toBe("disabled");
      expect(handler).not.toHaveBeenCalled();
    },
    120_000,
  );

  it(
    "el bloqueo deja el conjunto vacío y la escritura bloqueada no puebla ni el almacén ni el conjunto",
    async () => {
      // La foto del almacén antes del bloqueo: la escritura
      // rechazada no debe moverla ni en un nombre.
      const before = await getDisabledToolNames();

      const locked = await call("nido:vault-lock");
      expect(locked.ok).toBe(true);

      // Sin sesión, conjunto vacío: el invariante nuevo.
      expect(isToolDisabled("device_time")).toBe(false);
      expect(isToolDisabled("list_notes")).toBe(false);

      // La escritura con la bóveda bloqueada vuelve locked…
      const r = await call("nido:settings-set", { disabledTools: ["calculate"] });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("locked");
      // …y no puebla el conjunto.
      expect(isToolDisabled("calculate")).toBe(false);

      // Ni el almacén: tras redesbloquear, la lista es la misma
      // de antes del bloqueo, sin rastro de la escritura
      // rechazada.
      const unlocked = await call("nido:vault-unlock", { password: PASSWORD });
      expect(unlocked.ok).toBe(true);
      expect(await getDisabledToolNames()).toEqual(before);
    },
    120_000,
  );

  it(
    "la foto del bootstrap trae la lista escrita, la que la marca de la guía lee",
    async () => {
      const boot = await callBoot();
      expect(boot.disabledTools).toEqual(["device_time", "list_notes"]);
    },
    120_000,
  );
});
