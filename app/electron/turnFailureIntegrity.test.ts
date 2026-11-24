/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * TANDA BREVE N1: el mensaje de la persona no se pierde
 * si la generación falla (hallazgo N1 de la auditoría
 * profesional de PC; acto 0 en estudios/ACTO-0-N1.md).
 *
 * La batería instala los servicios reales sobre el doble
 * de Electron de la casa (el de turnSendDoor: captura los
 * manejadores y los invoca con un evento de la casa), con
 * la bóveda de escena y el 1.5B genuino sembrado por
 * enlace duro. El fallo se fuerza en la fachada:
 * `llamaEngine.generate` queda espiado desde el arranque
 * del arnés y una bandera de la batería decide si la
 * llamada corre la de verdad o lanza — la llamada real
 * del paso de generación del ejecutor, con todo lo demás
 * real (el pipeline, la composición, el sellado). La
 * bandera vuelve a falso en el `finally` de cada caso
 * que la levanta, para no heredarle un motor condenado
 * al caso siguiente.
 *
 * Los cargos, en el orden de la escena:
 *
 * 1. La escena: la bóveda nace y el 1.5B queda residente.
 * 2. El fallo en conversación existente: asentado un par
 *    bueno, el turno con la generación en rechazo
 *    responde `{ ok: false, reason: "error" }` (la
 *    respuesta de hoy) y la conversación servida trae el
 *    par entero del turno fallido: el mensaje de la
 *    persona y el asistente vacío con su marca `failed`.
 *    Tras bloquear y desbloquear, la conversación
 *    releída del blob sellado trae el mismo par: la
 *    persistencia cobrada es la de disco, no la de
 *    memoria.
 * 3. El fallo en conversación nueva: con la generación
 *    en rechazo desde el primer turno, la conversación
 *    nace con su par fallido (ni ausente ni fantasma
 *    vacía) y con el título de su mensaje.
 * 4. El turno siguiente no hereda el fantasma: servido
 *    bien el turno tras el fallo, la llamada a la
 *    fachada de ese turno lleva en su historial el texto
 *    que la persona escribió en el turno fallido y
 *    ningún mensaje de asistente vacío; la conversación
 *    cierra con cuatro turnos en orden y una sola marca
 *    `failed`.
 * 5. El bloqueo durante el turno fallido: con la
 *    generación en vuelo y condenada (el fallo llega
 *    tarde, tras el bloqueo), el par se retiene por la
 *    forma (c) y al desbloquear la conversación trae el
 *    par entero una sola vez — el empuje previo ya había
 *    sellado el mensaje, así que la aplicación completa
 *    el par sin duplicarlo. Este caso nació del anillo:
 *    la puerta (turnSendDoor) cazó la duplicación en su
 *    forma de asentamiento parado, y este caso la cobra
 *    en la forma del fallo.
 * 6. El éxito no se duplica: un turno limpio asienta
 *    exactamente un par, sin marca `failed` y con su
 *    título — la regresión del empuje previo.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
  events: [] as string[],
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
import { sceneSkipped } from "../../src/test/sceneGate.js";

const PASSWORD = "sonda-n1-25";
const ENSAYO = "Escribe un ensayo breve sobre la fotosíntesis.";
const ENSAYO2 = "Escribe un ensayo breve sobre la lluvia.";
const CORTA = "¿Cuál es la capital de Francia? Contesta en una frase.";

const event = {
  sender: {
    send: (channel: string, payload: { conversationId?: string; id?: string; chunk?: string }) => {
      harness.events.push(
        `${new Date().toISOString()} ${channel}${payload?.conversationId ? `:${payload.conversationId}` : ""}`,
      );
      if (harness.events.length > 80) harness.events.shift();
      // Sin renderizador no hay quien responda a una petición
      // de confirmación y el turno quedaría colgado antes de
      // generar: el arnés la deniega al momento por el canal
      // de respuesta, como el drenaje de la parada hace.
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
  result?: { stopped?: boolean; text?: string };
};
type StoredTurnView = {
  role: string;
  text: string;
  stopped?: boolean;
  failed?: boolean;
};
type Boot = {
  vault: { unlocked: boolean };
  conversations: {
    id: string;
    title: string;
    turns: StoredTurnView[];
  }[];
};

function call(channel: string, args?: unknown): Promise<TurnReply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<TurnReply>;
}

async function bootstrap(): Promise<Boot> {
  const fn = harness.handlers.get("nido:bootstrap");
  if (!fn) throw new Error("sin manejador registrado: nido:bootstrap");
  return fn(event, undefined) as Promise<Boot>;
}

const convDe = async (id: string) => (await bootstrap()).conversations.find((c) => c.id === id);

/** La fachada espiada: la bandera manda si la llamada
 * lanza (el fallo de la escena) o corre la de verdad. La
 * espía se instala una vez, en la escena, y no se retira:
 * con la bandera en falso es transparente. El fallo
 * puede llegar tarde (`falloLentoMs`) para que un
 * bloqueo coja el turno en vuelo, y `generacionEnCurso`
 * dice cuándo el turno está dentro de la llamada. */
let falloForzado = false;
let falloLentoMs = 0;
let generacionEnCurso = false;
type GenArgs = {
  messages?: { role: string; content: string }[];
  prompt?: string;
};
let genSpy: { mock: { calls: unknown[][] } } | null = null;

function instalarEspia(): void {
  const realGenerate = llamaEngine.generate.bind(llamaEngine);
  const spy = vi.spyOn(llamaEngine, "generate").mockImplementation((async (args: GenArgs) => {
    generacionEnCurso = true;
    try {
      if (falloForzado) {
        if (falloLentoMs > 0) await new Promise((r) => setTimeout(r, falloLentoMs));
        throw new Error("fallo de generación forzado por la escena N1");
      }
      return await realGenerate(args as never);
    } finally {
      generacionEnCurso = false;
    }
  }) as never);
  genSpy = spy as unknown as { mock: { calls: unknown[][] } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCENE_OFF = sceneSkipped("turnFailureIntegrity", [
  path.join(process.cwd(), "models", "qwen2.5-1.5b-instruct-q4km.gguf"),
]);

beforeAll(async () => {
  if (SCENE_OFF) return;
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-turn-n1-"));
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "models", "qwen2.5-1.5b-instruct-q4km.gguf"),
    path.join(modelsDir, "qwen2.5-1.5b-instruct-q4km.gguf"),
  );
  await installServices();
  // La espía se instala aquí, no en la escena: con la
  // bandera en falso es transparente, y su sitio no
  // depende de que ninguna aserción de escena viva o
  // muera (la primera corrida de nacimiento perdió los
  // rojos por esta costura: la escena murió antes de
  // instalarla y los turnos «fallidos» generaron de
  // verdad; ese nacimiento se descartó por no medir la
  // causa y se repitió).
  instalarEspia();
}, 60_000);

afterAll(() => {
  if (SCENE_OFF) return;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe.skipIf(SCENE_OFF)("N1: el mensaje de la persona no se pierde si la generación falla", () => {
  it("la escena: la bóveda nace y el 1.5B queda residente", async () => {
    const created = await call("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    // La residencia se sondea con plazo, no se exige al
    // instante: la primera corrida de nacimiento midió la
    // carga rechazada en caliente (la RAM libre del
    // momento) y el motor residió recién en el primer
    // turno. Si la respuesta de carga no es ok, se
    // reintenta una sola vez, declarado y registrado, y
    // el sondeo manda; si ni así reside, la escena cae
    // con las dos respuestas a la vista.
    let load = (await call("nido:model-load", { id: "qwen2.5-1.5b-instruct-q4km" })) as unknown as {
      ok: boolean;
      reason?: string;
    };
    if (!load.ok) {
      await new Promise((r) => setTimeout(r, 5_000));
      const segunda = (await call("nido:model-load", {
        id: "qwen2.5-1.5b-instruct-q4km",
      })) as unknown as { ok: boolean; reason?: string };
      console.log(
        `[turnFailureIntegrity] la primera carga respondió ${JSON.stringify(load)}; reintento declarado de escena: ${JSON.stringify(segunda)}`,
      );
      load = segunda;
    }
    const plazo = Date.now() + 120_000;
    while (!llamaEngine.isLoaded && Date.now() < plazo) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!llamaEngine.isLoaded) {
      throw new Error(`la escena no ocurrió: el 1.5B no residió; última respuesta de carga: ${JSON.stringify(load)}`);
    }
  }, 240_000);

  it("el fallo en conversación existente: el par fallido queda en la conversación y en el blob sellado", async () => {
    const id = "n1-existente";
    const r1 = await call("nido:turn-send", { conversationId: id, text: CORTA });
    expect(r1.ok).toBe(true);
    expect((await convDe(id))?.turns.length).toBe(2);
    let r2: TurnReply;
    falloForzado = true;
    try {
      r2 = await call("nido:turn-send", { conversationId: id, text: ENSAYO });
    } finally {
      falloForzado = false;
    }
    expect(r2).toMatchObject({ ok: false, reason: "error" });
    const conv = await convDe(id);
    expect(conv?.turns.length).toBe(4);
    expect(conv?.turns[2]).toMatchObject({ role: "user", text: ENSAYO });
    expect(conv?.turns[3].role).toBe("assistant");
    expect(conv?.turns[3].text).toBe("");
    expect(conv?.turns[3].failed).toBe(true);
    // La persistencia cobrada es la de disco: bloquear
    // desmonta la memoria y desbloquear relee el blob.
    await call("nido:vault-lock");
    const un = await call("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    const releida = await convDe(id);
    expect(releida?.turns.length).toBe(4);
    expect(releida?.turns[2]).toMatchObject({ role: "user", text: ENSAYO });
    expect(releida?.turns[3].failed).toBe(true);
  }, 600_000);

  it("el fallo en conversación nueva: nace con su par fallido y su título", async () => {
    const id = "n1-nueva";
    let r: TurnReply;
    falloForzado = true;
    try {
      r = await call("nido:turn-send", { conversationId: id, text: ENSAYO });
    } finally {
      falloForzado = false;
    }
    expect(r).toMatchObject({ ok: false, reason: "error" });
    const conv = await convDe(id);
    expect(conv).toBeDefined();
    expect(conv?.title).toBe(ENSAYO);
    expect(conv?.turns.length).toBe(2);
    expect(conv?.turns[0]).toMatchObject({ role: "user", text: ENSAYO });
    expect(conv?.turns[1].role).toBe("assistant");
    expect(conv?.turns[1].text).toBe("");
    expect(conv?.turns[1].failed).toBe(true);
  }, 300_000);

  it("el bloqueo durante el turno fallido: el par retenido se completa una sola vez al desbloquear", async () => {
    const id = "n1-bloqueo";
    falloForzado = true;
    falloLentoMs = 3_000;
    const turnP = call("nido:turn-send", { conversationId: id, text: ENSAYO2 });
    try {
      // El turno tiene que estar dentro de la generación
      // (con el empuje previo ya sellado) cuando el
      // bloqueo llega: se sondea la señal de la espía, no
      // una ventana fija.
      const plazo = Date.now() + 60_000;
      while (!generacionEnCurso && Date.now() < plazo) await sleep(100);
      expect(generacionEnCurso).toBe(true);
      await call("nido:vault-lock");
      const r = await turnP;
      expect(r).toMatchObject({ ok: false, reason: "error" });
    } finally {
      falloForzado = false;
      falloLentoMs = 0;
    }
    const un = await call("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    const conv = await convDe(id);
    expect(conv?.turns.length).toBe(2);
    expect(conv?.turns[0]).toMatchObject({ role: "user", text: ENSAYO2 });
    expect(conv?.turns[1].role).toBe("assistant");
    expect(conv?.turns[1].text).toBe("");
    expect(conv?.turns[1].failed).toBe(true);
  }, 300_000);

  it("el turno siguiente no hereda el fantasma: su historial trae lo que la persona dijo y ningún asistente vacío", async () => {
    const id = "n1-herencia";
    falloForzado = true;
    try {
      const r = await call("nido:turn-send", { conversationId: id, text: ENSAYO });
      expect(r).toMatchObject({ ok: false, reason: "error" });
    } finally {
      falloForzado = false;
    }
    const llamadasAntes = genSpy?.mock.calls.length ?? 0;
    const r2 = await call("nido:turn-send", { conversationId: id, text: ENSAYO2 });
    expect(r2.ok).toBe(true);
    const nuevas = (genSpy?.mock.calls ?? []).slice(llamadasAntes) as [GenArgs][];
    expect(nuevas.length).toBeGreaterThan(0);
    const mensajes = nuevas[nuevas.length - 1][0].messages;
    expect(mensajes).toBeDefined();
    const lista = mensajes as { role: string; content: string }[];
    expect(lista.some((m) => m.role === "user" && m.content === ENSAYO)).toBe(true);
    expect(lista.some((m) => m.role === "assistant" && m.content.trim() === "")).toBe(false);
    const conv = await convDe(id);
    expect(conv?.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conv?.turns.filter((t) => t.failed).length).toBe(1);
    expect(conv?.turns[1].failed).toBe(true);
  }, 900_000);

  it("el éxito no se duplica: un turno limpio asienta exactamente un par, sin marca", async () => {
    const id = "n1-limpia";
    const r = await call("nido:turn-send", { conversationId: id, text: CORTA });
    expect(r.ok).toBe(true);
    const conv = await convDe(id);
    expect(conv?.turns.length).toBe(2);
    expect(conv?.turns[0]).toMatchObject({ role: "user", text: CORTA });
    expect(conv?.turns[1].role).toBe("assistant");
    expect(conv?.turns.some((t) => t.failed)).toBe(false);
    expect(conv?.title).toBe(CORTA);
  }, 300_000);
});
