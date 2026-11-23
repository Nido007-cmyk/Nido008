/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * F-UI-10, la forma (a-i): la puerta del envío cobra el
 * vuelo antes de crear conversación ni construir el turno.
 * La batería instala los servicios reales sobre el doble de
 * Electron de la casa (el de modelLoadGuard: captura los
 * manejadores y los invoca con un evento de la casa cuyo
 * `sender.send` registra los tokens del turno), con la
 * bóveda de escena y el 1.5B genuino sembrado por enlace
 * duro (la vía de carga D-3 rechaza simbólicos). El modelo
 * de escena es el 1.5B y no el 0.6B por una medida de la
 * pieza del turno perdido al bloquear: el 0.6B trae
 * `roles: []` en el catálogo, así que su paso de generación
 * solo se planifica cuando la escalera de fallback por
 * presupuesto (RAM libre en vivo, reconstruida por turno)
 * lo nombra, y con 2 GiB o más libres nombra a otro modelo
 * ausente de la escena: el turno se servía vacío y en
 * silencio (`no-generate-step:no-model-available`) con el
 * motor residente, y la generación de la escena dejaba de
 * ser determinista. El 1.5B es el modelo menor del catálogo
 * con rol curado («fast»): su paso de generación se
 * planifica siempre que está presente, llueva o truene
 * sobre la RAM libre de la máquina. Los tres cargos de la
 * pieza, en el orden de la escena:
 *
 * 1. El fantasma: con un turno generando, un envío con id
 *    nuevo se rechaza `turn-in-flight` y la lista de
 *    conversaciones NO gana ninguna entrada. Sin la puerta,
 *    el buscar-o-crear de runOneTurn corre antes que la
 *    guarda tardía y la conversación fantasma sí se crea.
 * 2. El orden de asentamiento: parado el turno en vuelo, el
 *    reenvío durante el drenaje se rechaza en la puerta sin
 *    efectos (ni su conversación nace), y el primer envío
 *    tras el asentamiento entra y sirve, con el par del
 *    parado delante y su marca `stopped` intacta.
 * 3. Regresión de la parada: el bloqueo durante el vuelo
 *    espera al turno antes de desmontar la sesión (el
 *    sello P-2 en la letra de su orden de verificación:
 *    la espera a `inFlightTurn` antes de desmontar).
 *    La persistencia del par parado al bloquear en vuelo
 *    se cobra en el bloque de la pieza del turno perdido
 *    al bloquear, más abajo: el par se retiene en memoria
 *    del proceso principal y se sella al siguiente
 *    desbloqueo (la forma (c)), sin tocar el borrado de
 *    la DEK, que sigue siendo inmediato a `lock()`.
 *
 * La pieza del turno perdido al bloquear añade abajo su
 * propio bloque con tres casos sobre esta misma escena:
 * el par retenido sobrevive al bloqueo en una conversación
 * existente y en una nueva (la forma (c): el par se retiene
 * en memoria del proceso principal y se sella al siguiente
 * desbloqueo), y el borrado de la DEK no se retrasa.
 *
 * A-U6 cobra el texto de ese par: la letra de la forma (c)
 * incluye «el texto parcial generado hasta el aborto», y la
 * punta lo perdía entero en la fachada (la vía sin plantilla
 * devolvía la cadena vacía por construcción y la de con
 * plantilla extraía del historial de la sesión, que nunca
 * contiene la respuesta en vuelo). El arnés registra desde
 * esta tanda el texto de los chunks por conversación, con
 * una marca por turno, y las aserciones de los dos casos
 * vivos de la forma (c) cobran el texto del par retenido
 * contra lo emitido; un caso nuevo, en su propio bloque,
 * cobra la parada con el botón, sin bloqueo, asentada en la
 * misma sesión, con su marca `stopped` leída de la
 * conversación servida.
 *
 * Los testigos de la batería son de estado, no de primer
 * token (re-fundación del paso 0 de la pieza del turno
 * perdido al bloquear, sobre el DIAGNOSTICO-TURNSENDDOOR):
 * cada espera de generación corre la carrera entre el
 * primer token y el asentamiento de la promesa del turno,
 * y cada caso exige la rama que su cargo necesita (sin
 * generación viva no hay puerta ni drenaje que cobrar);
 * si el turno se asienta sin generar, el caso cae ahí
 * mismo con esa frase, en el tiempo que el turno tardó en
 * asentarse, y solo el caso de asentamiento puede
 * reintentar su escena una sola vez sobre una conversación
 * nueva, para conseguir una generación viva antes de
 * cualquier aserción. Entre escenas, la batería espera el
 * asentamiento de la promesa anterior y una quietud del
 * chorro derivada de la cadencia medida en la propia
 * corrida (nunca una ventana fija por debajo de ella).
 * Cada caso, en su `finally`, asienta los turnos que abrió
 * y sigan vivos, para no heredarle un turno en vuelo al
 * caso siguiente.
 *
 * La parada de cada turno se pulsa tras el primer token.
 * Tres medidas de la punta que la batería respeta sin
 * cobrarlas como cargos propios: la marca `stopped` del
 * resultado depende de la frontera de paso donde cae el
 * aborto (el ejecutor la compone en la frontera,
 * `executor.ts:248`, y su batería la cobra ahí de forma
 * determinista; a mitad de paso el mismo aborto asienta
 * sin marca, medido en estas corridas en ambos sentidos);
 * la generación abandonada por un aborto puede seguir
 * emitiendo tokens un rato tras la pulsación de la parada
 * (medido: tokens de la conversación parada segundos
 * después de su respuesta), así que entre escenas la
 * batería espera el asentamiento y la quietud derivada
 * antes de pedir la siguiente generación; y un turno
 * puede asentarse en silencio, sin emitir un solo token,
 * cuando su generación muere por el plazo del paso
 * (120 s) sin entregar un trozo: su par se persiste con
 * su señal `timedOut` y ninguna espera de primer token
 * puede ser testigo de que ese turno vive.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
  tokens: [] as string[],
  tokenAt: [] as number[],
  tokenCount: 0,
  chunks: [] as { conversationId: string; chunk: string }[],
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
import {
  getMemorySettings,
  setMemorySettings,
  type MemorySettings,
} from "../../src/models/settings.js";
import { setSummarizeEngine } from "../../src/services/summarize.js";

const PASSWORD = "sonda-fui10-20";
const ENSAYO = "Escribe un ensayo breve sobre la fotosíntesis.";
const CORTA = "¿Cuál es la capital de Francia? Contesta en una frase.";

const event = {
  sender: {
    send: (channel: string, payload: { conversationId?: string; id?: string; chunk?: string }) => {
      harness.events.push(
        `${new Date().toISOString()} ${channel}${payload?.conversationId ? `:${payload.conversationId}` : ""}`,
      );
      if (harness.events.length > 80) harness.events.shift();
      if (channel === "nido:turn-token" && typeof payload?.conversationId === "string") {
        harness.tokens.push(payload.conversationId);
        harness.tokenAt.push(Date.now());
        harness.tokenCount += 1;
        // A-U6: el texto de los chunks viaja en el propio
        // evento; el arnés lo guarda por conversación y en
        // orden para poder cobrar el texto parcial de un
        // turno parado contra lo que de verdad se emitió.
        if (typeof payload.chunk === "string") {
          harness.chunks.push({ conversationId: payload.conversationId, chunk: payload.chunk });
        }
      }
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
type Boot = {
  vault: { unlocked: boolean };
  conversations: {
    id: string;
    title: string;
    turns: { role: string; text: string; stopped?: boolean }[];
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await sleep(150);
  }
  throw new Error(
    `espera agotada: ${label}; últimos eventos del arnés: ${harness.events.slice(-12).join(" | ")}`,
  );
}

const tokensDe = (conversationId: string) =>
  harness.tokens.reduce((n, t) => (t === conversationId ? n + 1 : n), 0);

/** A-U6: la marca de inicio de un turno en el registro de
 * chunks: se toma justo antes de abrir el turno y corta la
 * concatenación de ESE turno, para no cobrar como suyo el
 * texto de una respuesta anterior de la misma conversación. */
const marcaChunks = () => harness.chunks.length;

/** A-U6: el texto emitido para una conversación desde una
 * marca: la concatenación, en orden, de los chunks que el
 * arnés registró para ella desde que el turno empezó. */
const textoEmitido = (conversationId: string, desde: number) =>
  harness.chunks
    .slice(desde)
    .filter((c) => c.conversationId === conversationId)
    .map((c) => c.chunk)
    .join("");

/** A-U6: el cobro del texto parcial de un turno parado. El
 * texto sellado es el parcial emitido hasta la parada: no
 * vacío, y prefijo al carácter de lo registrado para ese
 * turno. Prefijo y no igualdad, por dos medidas de la casa:
 * la fachada acumula cada chunk ANTES de reenviarlo (todo lo
 * registrado fue antes acumulado, así que lo sellado no
 * puede pasar de lo registrado), y una generación abandonada
 * puede seguir emitiendo tras el asentamiento (la cola
 * zombi extiende lo registrado más allá de lo sellado). La
 * igualdad es el caso sin cola. */
function cobrarParcial(sellado: string | undefined, emitido: string): void {
  expect(emitido.length).toBeGreaterThan(0);
  expect(sellado).toBeDefined();
  expect((sellado as string).length).toBeGreaterThan(0);
  expect(emitido.startsWith(sellado as string)).toBe(true);
}

/** La carrera que sustituye a la espera de primer token:
 * sondea en el mismo ciclo el primer token NUEVO de la
 * conversación (contado desde la llamada: un segundo turno
 * sobre la misma conversación no hereda los tokens del
 * primero) y el asentamiento de la promesa del turno, y
 * devuelve cuál disparó. Un turno que se asienta en
 * silencio (su generación muerta por el plazo sin entregar
 * un trozo) ya no puede producir el token: sin esta carrera
 * la espera quemaba sus 300 s enteros contra un turno
 * asentado desde mucho antes, sin tocar una aserción. */
async function esperarGeneracion(
  turnPromise: Promise<unknown>,
  conversationId: string,
  timeoutMs: number,
): Promise<"token" | "asentado"> {
  const base = tokensDe(conversationId);
  let settled = false;
  void turnPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tokensDe(conversationId) > base) return "token";
    if (settled) return "asentado";
    await sleep(150);
  }
  throw new Error(
    `espera agotada: ni token ni asentamiento de ${conversationId}; últimos eventos del arnés: ${harness.events.slice(-12).join(" | ")}`,
  );
}

/** El índice en `tokenAt` desde el que se mide la cadencia
 * de «la generación anterior»: se fija cada vez que una
 * quietud se cobra, para que la ventana de la siguiente se
 * derive de la generación que acaba de correr. */
let quietBaseline = 0;

function p90(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.max(0, Math.ceil(0.9 * ordenados.length) - 1)];
}

/** La ventana de quietud: cuatro veces el p90 de los huecos
 * entre trozos medidos en la generación anterior de esta
 * misma corrida, con suelo de 3 s (la ventana de siempre en
 * máquina sana) y techo de 30 s. La ventana fija de 3 s se
 * disparaba dentro de una generación viva en cuanto la
 * cadencia degradada abría huecos de 1,3 a 6,9 s entre
 * trozos: derivarla de la cadencia medida cierra ese
 * disparo sin fingir una quietud que no hay. */
function ventanaQuietud(): number {
  const tiempos = harness.tokenAt.slice(quietBaseline);
  const huecos: number[] = [];
  for (let i = 1; i < tiempos.length; i++) huecos.push(tiempos[i] - tiempos[i - 1]);
  if (huecos.length < 2) return 3_000;
  return Math.min(30_000, Math.max(3_000, 4 * p90(huecos)));
}

function volcadoCadencia(): string {
  const ultimos = harness.tokenAt.slice(-12);
  return ultimos
    .map((t, i) => (i === 0 ? new Date(t).toISOString() : `+${t - ultimos[i - 1]}ms`))
    .join(" ");
}

/** Espera a que el turno anterior se asiente Y a que el
 * chorro se aquiete una ventana derivada de la cadencia.
 * La quietud sola nunca basta: la generación abandonada de
 * un turno parado puede pausar más que la ventana sin
 * haberse asentado, y pedir la siguiente generación con el
 * contexto único todavía ocupado era la contaminación que
 * esta firma cierra. Al expirar, el error vuelca los
 * últimos tiempos de token con sus huecos, para que la
 * cadencia quede en el log de la corrida. */
async function esperarQuieto(turnPromise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let settled = false;
  void turnPromise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const ventana = ventanaQuietud();
  const deadline = Date.now() + timeoutMs;
  let last = harness.tokenCount;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    if (harness.tokenCount !== last) {
      last = harness.tokenCount;
      quietSince = Date.now();
    } else if (settled && Date.now() - quietSince >= ventana) {
      quietBaseline = harness.tokenAt.length;
      return;
    }
  }
  throw new Error(
    `espera agotada: el turno anterior no se asentó o el chorro no se aquietó (ventana derivada ${ventana} ms, asentado: ${settled}); últimos tiempos de token con sus huecos: ${volcadoCadencia()}`,
  );
}

/** La higiene de casos: cada turno abierto por la batería
 * se registra aquí, y el `finally` de cada caso asienta los
 * que sigan vivos (parada primero, y la cota del producto:
 * el plazo del paso, 120 s, más 60 s de margen de guardado
 * y pasos) para que ningún caso herede un turno en vuelo
 * del anterior y un rojo declare la escena que falló, no
 * la contaminación de la vecina. */
type TurnoAbierto = { promise: Promise<TurnReply>; settled: boolean };
const turnosAbiertos: TurnoAbierto[] = [];
/** El registro del último turno con escena propia (el que
 * la escena siguiente espera en su `esperarQuieto`): los
 * envíos rechazados en la puerta no lo pisan. */
let registroPrevio: TurnoAbierto | null = null;

function abrirTurno(args: { conversationId: string; text: string }): {
  promise: Promise<TurnReply>;
  registro: TurnoAbierto;
} {
  const promise = call("nido:turn-send", args);
  const registro: TurnoAbierto = { promise, settled: false };
  void promise.then(
    () => { registro.settled = true; },
    () => { registro.settled = true; },
  );
  turnosAbiertos.push(registro);
  return { promise, registro };
}

async function asentarTurnosAbiertos(): Promise<void> {
  for (const registro of turnosAbiertos) {
    if (registro.settled) continue;
    await call("nido:turn-stop").catch(() => undefined);
    await Promise.race([registro.promise.catch(() => undefined), sleep(180_000)]);
  }
  turnosAbiertos.length = 0;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-turn-door-"));
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

describe("F-UI-10 (a-i): la puerta del envío cobra el vuelo en el manejador", () => {
  it("la escena: la bóveda nace y el 1.5B queda residente", async () => {
    const created = await call("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    // La carga responde con los datos del gestor, no con un
    // ok: su prueba es la residencia en el motor.
    await call("nido:model-load", { id: "qwen2.5-1.5b-instruct-q4km" });
    expect(llamaEngine.isLoaded).toBe(true);
  }, 240_000);

  it("el fantasma: un envío con id nuevo durante el vuelo se rechaza y no crea conversación", async () => {
    const { promise: a, registro: regA } = abrirTurno({ conversationId: "fui10-a", text: ENSAYO });
    registroPrevio = regA;
    try {
      const rama = await esperarGeneracion(a, "fui10-a", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno A se asentó sin generar: la escena no ocurrió");
      }
      const g = await call("nido:turn-send", { conversationId: "fui10-fantasma", text: CORTA });
      const b = await bootstrap();
      await call("nido:turn-stop");
      const ra = await a;
      expect(g).toEqual({ ok: false, reason: "turn-in-flight" });
      expect(b.conversations.some((c) => c.id === "fui10-fantasma")).toBe(false);
      expect(ra.ok).toBe(true);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 420_000);

  it("el orden de asentamiento: el reenvío durante el drenaje se rechaza sin efectos y el primer envío tras el asentamiento sirve tras el par parado", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    let bId = "fui10-b";
    let turnoC = abrirTurno({ conversationId: bId, text: ENSAYO });
    try {
      let rama = await esperarGeneracion(turnoC.promise, bId, 300_000);
      if (rama === "asentado") {
        // La escena no ocurrió: el turno se asentó en silencio
        // y no hay drenaje que cobrar. Reintento declarado,
        // uno solo, sobre una conversación nueva, y solo para
        // conseguir una generación viva antes de cualquier
        // aserción; el reintento queda escrito en el log.
        const census = await bootstrap();
        console.log(
          `[turnSendDoor] el turno C se asentó sin generar en ${bId}: reintento de escena declarado (uno solo) sobre fui10-b2; censo: ${JSON.stringify(
            census.conversations.map((x) => ({ id: x.id, turns: x.turns.length })),
          )}`,
        );
        bId = "fui10-b2";
        turnoC = abrirTurno({ conversationId: bId, text: ENSAYO });
        rama = await esperarGeneracion(turnoC.promise, bId, 300_000);
        if (rama === "asentado") {
          const census2 = await bootstrap();
          throw new Error(
            `el turno C se asentó sin generar: la escena no ocurrió (reintento agotado); censo: ${JSON.stringify(
              census2.conversations.map((x) => ({ id: x.id, turns: x.turns.length })),
            )}`,
          );
        }
      }
      const c = turnoC.promise;
      const stopP = call("nido:turn-stop");
      const dP = call("nido:turn-send", { conversationId: "fui10-drenaje", text: CORTA });
      await stopP;
      const d = await dP;
      const b1 = await bootstrap();
      const rc = await c;
      const turnoE = abrirTurno({ conversationId: bId, text: CORTA });
      registroPrevio = turnoE.registro;
      const e = await turnoE.promise;
      const b2 = await bootstrap();
      expect(d).toEqual({ ok: false, reason: "turn-in-flight" });
      expect(b1.conversations.some((x) => x.id === "fui10-drenaje")).toBe(false);
      expect(rc.ok).toBe(true);
      expect(e.ok).toBe(true);
      const conv = b2.conversations.find((x) => x.id === bId);
      expect(conv?.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("regresión de la parada: el bloqueo espera al turno en vuelo antes de desmontar (P-2)", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    const { promise: f } = abrirTurno({ conversationId: "fui10-c", text: ENSAYO });
    try {
      const rama = await esperarGeneracion(f, "fui10-c", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno F se asentó sin generar: la escena no ocurrió");
      }
      let fSettled = false;
      void f.then(
        () => { fSettled = true; },
        () => { fSettled = true; },
      );
      const lockP = call("nido:vault-lock");
      // Mientras el turno no se ha asentado, el desmontaje no
      // puede haber terminado: el bootstrap sigue en sesión en
      // cada sondeo. Esa espera es el sello.
      while (!fSettled) {
        const b = await bootstrap();
        expect(b.vault.unlocked).toBe(true);
        await sleep(120);
      }
      await lockP;
      await waitFor(async () => (await bootstrap()).vault.unlocked === false, 300_000, "la bóveda bloqueada tras el drenaje");
      const rf = await f;
      // La respuesta del turno bloqueado en vuelo no es de
      // éxito (medida en la punta: reason "error", con el
      // mensaje de la bóveda ya bloqueada).
      expect(rf.ok).toBe(false);
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);
});

describe("La pieza del turno perdido al bloquear: el par retenido se sella al desbloquear (forma c)", () => {
  it("el par sobrevive al bloqueo: conversación existente, tras su historial intacto", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    // La historia previa, guardada y sellada: un turno corto
    // que se asienta por la vía normal antes de la escena.
    const previa = abrirTurno({ conversationId: "fui10-bloqueo", text: CORTA });
    try {
      const rp = await previa.promise;
      expect(rp.ok).toBe(true);
      const b0 = await bootstrap();
      const previaConv = b0.conversations.find((x) => x.id === "fui10-bloqueo");
      expect(previaConv?.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      // El turno que queda en vuelo sobre esa conversación.
      // La marca de A-U6 se toma justo antes de abrirlo: la
      // concatenación que se cobra es la de este turno, no
      // la de la respuesta previa de la misma conversación.
      const marca = marcaChunks();
      const vuelo = abrirTurno({ conversationId: "fui10-bloqueo", text: ENSAYO });
      registroPrevio = vuelo.registro;
      const rama = await esperarGeneracion(vuelo.promise, "fui10-bloqueo", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno en vuelo se asentó sin generar: la escena no ocurrió");
      }
      // La escena del hallazgo grave: el turno se para y el
      // bloqueo llega con el turno dentro. La marca `stopped`
      // del par NO se cobra en este bloque: el ejecutor solo
      // honra la parada entre pasos y el plan de un ensayo no
      // trae paso tras el de generación, así que el par nace
      // sin marca aunque se pare (el defecto de la parada es
      // de §3.4 del bloque del loop, ya sentado). El par se
      // retiene tal cual se produjo, con la marca que traiga.
      await call("nido:turn-stop");
      await call("nido:vault-lock");
      await waitFor(async () => (await bootstrap()).vault.unlocked === false, 300_000, "la bóveda bloqueada tras el drenaje");
      const rv = await vuelo.promise;
      // La respuesta del turno no cambia con la cura: en el
      // momento de responder, la bóveda está bloqueada.
      expect(rv.ok).toBe(false);
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
      const b = await bootstrap();
      const conv = b.conversations.find((x) => x.id === "fui10-bloqueo");
      // La aserción diseñada de la pieza: tras desbloquear, el
      // par entero está, tras el historial previo intacto, con
      // la pregunta carácter a carácter.
      expect(conv?.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(conv?.turns[0]?.text).toBe(CORTA);
      expect(conv?.turns[2]?.text).toBe(ENSAYO);
      // A-U6: el texto del par retenido es el parcial emitido
      // hasta la parada, no la cadena vacía: la letra de la
      // forma (c) lo incluye en el resultado parado.
      cobrarParcial(conv?.turns[3]?.text, textoEmitido("fui10-bloqueo", marca));
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("el par sobrevive al bloqueo: la conversación nueva existe en la lista con su par y su título", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    const marca = marcaChunks();
    const vuelo = abrirTurno({ conversationId: "fui10-bloqueo-nueva", text: ENSAYO });
    registroPrevio = vuelo.registro;
    try {
      const rama = await esperarGeneracion(vuelo.promise, "fui10-bloqueo-nueva", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno en vuelo se asentó sin generar: la escena no ocurrió");
      }
      await call("nido:turn-stop");
      await call("nido:vault-lock");
      await waitFor(async () => (await bootstrap()).vault.unlocked === false, 300_000, "la bóveda bloqueada tras el drenaje");
      const rv = await vuelo.promise;
      expect(rv.ok).toBe(false);
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
      const b = await bootstrap();
      // La aserción diseñada de la pieza: la conversación que
      // nació con el turno en vuelo no desaparece con el
      // desmontaje; está en la lista, con su título y su par.
      const conv = b.conversations.find((x) => x.id === "fui10-bloqueo-nueva");
      expect(conv).toBeDefined();
      expect(conv?.title).toBe(ENSAYO.slice(0, 60));
      expect(conv?.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      expect(conv?.turns[0]?.text).toBe(ENSAYO);
      // A-U6: también en la conversación nacida con el turno,
      // el texto sellado del par es el parcial emitido.
      cobrarParcial(conv?.turns[1]?.text, textoEmitido("fui10-bloqueo-nueva", marca));
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("el borrado no se retrasa: lock() vuelve con el turno aún en vuelo y sin resto en claro (regresión del sello)", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    const storeDir = path.join(harness.userData, "store");
    const ficherosAntes = readdirSync(storeDir).sort();
    const vuelo = abrirTurno({ conversationId: "fui10-bloqueo-sello", text: ENSAYO });
    registroPrevio = vuelo.registro;
    try {
      const rama = await esperarGeneracion(vuelo.promise, "fui10-bloqueo-sello", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno en vuelo se asentó sin generar: la escena no ocurrió");
      }
      let vueloSettled = false;
      void vuelo.promise.then(
        () => { vueloSettled = true; },
        () => { vueloSettled = true; },
      );
      // lock() pone la DEK a ceros ANTES de avisar a los
      // oyentes y el manejador vuelve en el acto: si el
      // borrado esperara al drenaje, esta llamada no podría
      // volver con el turno todavía en vuelo. Que vuelva es
      // la inmediatez del borrado, cobrada en vivo.
      await call("nido:vault-lock");
      expect(vueloSettled).toBe(false);
      await waitFor(async () => (await bootstrap()).vault.unlocked === false, 300_000, "la bóveda bloqueada tras el drenaje");
      const rv = await vuelo.promise;
      expect(rv.ok).toBe(false);
      // Con la sesión desmontada, la DEK es inaccesible: un
      // envío nuevo no encuentra sesión (pedir la clave por
      // cualquier vía de guardado lanzaría VaultLockedError).
      const cerrado = await call("nido:turn-send", { conversationId: "fui10-bloqueo-sello", text: CORTA });
      expect(cerrado).toEqual({ ok: false, reason: "locked" });
      // El hueco vive solo en memoria: durante la ventana
      // bloqueada el almacén no gana ningún fichero, y ningún
      // fichero suyo contiene el par en claro.
      const ficherosDurante = readdirSync(storeDir).sort();
      expect(ficherosDurante).toEqual(ficherosAntes);
      for (const f of ficherosDurante) {
        const contenido = readFileSync(path.join(storeDir, f));
        expect(contenido.includes(Buffer.from("fotosíntesis", "utf8"))).toBe(false);
      }
      // El desbloqueo posterior exige autenticarse por la vía
      // de contraseña del arnés: la mala no abre, la buena sí.
      const bad = await call("nido:vault-unlock", { password: "no-es-esta" });
      expect(bad.ok).toBe(false);
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);
});

// ---------------------------------------------------------------------
// A-U6: la parada con el botón, sin bloqueo. La vía del
// bloqueo no es la única que perdía el texto: la fachada
// resolvía la cadena vacía ante cualquier aborto, así que
// también el gesto corriente de parar una respuesta a mitad
// dejaba la burbuja en 0 caracteres al asentarse. Este caso
// cobra esa vía en la misma sesión, sin tocar la bóveda: el
// par se asienta por la vía normal y su turno de asistente
// guarda el texto parcial emitido, con su marca `stopped`
// (la del cierre del ejecutor, que la deriva de la señal en
// su última consulta: un plan sin paso tras el interrumpido
// la trae igual).
// ---------------------------------------------------------------------

describe("A-U6: el texto parcial de un turno parado con el botón se asienta con su marca", () => {
  it("la parada sin bloqueo: el par asentado en la misma sesión trae el texto emitido y su marca stopped", async () => {
    await esperarQuieto(registroPrevio!.promise, 300_000);
    const marca = marcaChunks();
    const vuelo = abrirTurno({ conversationId: "au6-boton", text: ENSAYO });
    registroPrevio = vuelo.registro;
    try {
      const rama = await esperarGeneracion(vuelo.promise, "au6-boton", 300_000);
      if (rama === "asentado") {
        throw new Error("el turno en vuelo se asentó sin generar: la escena no ocurrió");
      }
      await call("nido:turn-stop");
      const rv = await vuelo.promise;
      expect(rv.ok).toBe(true);
      const emitido = textoEmitido("au6-boton", marca);
      // La respuesta del turno ya trae el parcial: es el
      // producto directo de la fachada, antes de todo
      // asentamiento.
      cobrarParcial(rv.result?.text, emitido);
      const b = await bootstrap();
      const conv = b.conversations.find((x) => x.id === "au6-boton");
      expect(conv?.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      expect(conv?.turns[0]?.text).toBe(ENSAYO);
      // El par guardado es la respuesta del turno, carácter a
      // carácter, y su marca de parada viaja con él.
      expect(conv?.turns[1]?.text).toBe(rv.result?.text);
      expect(conv?.turns[1]?.stopped).toBe(true);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);
});

// ---------------------------------------------------------------------
// Cableado, pieza 2: los campos de memoria gobiernan. El contrato
// de `MemorySettings` vive entero en el almacén (defectos 6/10/
// true, guarda m-32) y el bootstrap ya sirve los cuatro campos,
// pero tres de ellos están muertos en PC: la puerta del
// resumidor corre con un literal 10 sin fuente en el móvil,
// ninguna poda acota el blob sellado que cada turno reescribe
// entero, y las dos asignaciones de título corren siempre. La
// pieza pone los tres cables en la forma del móvil y este
// bloque los cobra sobre la misma escena de la casa (la
// batería de carcasa que F-UI-10 estrenó en este fichero: su
// residencia es la declarada en la apertura de la pieza, con
// Δ de ficheros 0).
//
// La escena del bloque: la bóveda y el 1.5B son los de la
// escena del fichero (en una corrida filtrada a este bloque,
// el propio bloque los levanta). El productor de resúmenes se
// siembra por su costura (`setSummarizeEngine`) con un motor
// falso que cuenta sus llamadas y devuelve siempre el mismo
// texto: el resumen cobrado es el del asentamiento, no una
// generación. Cada turno del bloque es una pregunta corta que
// se para tras su primer token, como en la escena de la
// puerta: el par se asienta igual y la generación no se paga
// entera. Los testigos son el bootstrap (la foto servida: el
// resumen, el título y la lista de conversaciones) y el
// contador del motor falso.
//
// Los casos, en el orden de la orden de la pieza: el umbral
// (+3: el campo, el defecto y el interruptor), la poda (+3:
// el tope, el sin límite y la del turno), los títulos (+2: el
// campo apagado y el encendido) y el canal con la superficie
// (+2). El respaldo de la lista para una conversación sin
// título generado es el declarado en la apertura: la cadena
// `pcSurface.untitledChat` que los dos sitios de la lista ya
// enseñan cuando el título está vacío.
// ---------------------------------------------------------------------

describe("Cableado, pieza 2 (campos de memoria): el umbral, la poda y los títulos gobiernan", () => {
  const RESUMEN = "Resumen de escena (motor falso de la batería).";
  const QB = "¿Cuál es la capital de España? Contesta en una frase.";
  const TA1 =
    "Primera pregunta de títulos de la batería de cableado, con su texto completo y su corte";
  const TA2 =
    "Segunda pregunta de títulos de la batería de cableado, con su texto completo y su corte";
  let resumenLlamadas = 0;

  type BootMem = {
    vault: { exists: boolean; unlocked: boolean };
    conversations: { id: string; title: string; summary: string | null }[];
    memorySettings: {
      autoSummarize: boolean;
      historyTurnThreshold: number;
      maxSavedSessions: number;
      autoGenerateTitles: boolean;
    } | null;
  };

  const bootMem = async (): Promise<BootMem> => (await bootstrap()) as unknown as BootMem;
  const convDe = async (id: string) =>
    (await bootMem()).conversations.find((c) => c.id === id);

  /** Un turno corto de la escena: se para tras el primer
   * token si lo hay y se cobra asentado en los dos casos (un
   * asentamiento en silencio también asienta el par). */
  async function turnoCorto(conversationId: string, text: string): Promise<TurnReply> {
    const { promise } = abrirTurno({ conversationId, text });
    const rama = await esperarGeneracion(promise, conversationId, 300_000);
    if (rama === "token") await call("nido:turn-stop");
    return promise;
  }

  /** El resumen servido en el bootstrap, esperado hasta el
   * plazo: devuelve el texto si aparece y null si la ventana
   * entera pasa sin resumen. */
  async function esperarResumen(id: string, ms: number): Promise<string | null> {
    const deadline = Date.now() + ms;
    for (;;) {
      const c = await convDe(id);
      if (c && c.summary) return c.summary;
      if (Date.now() >= deadline) return null;
      await sleep(250);
    }
  }

  beforeAll(async () => {
    // La escena del fichero puede traer un turno anterior
    // asentándose: se espera su quietud derivada, como entre
    // las escenas de la puerta. En una corrida filtrada a
    // este bloque no hay escena previa y este paso no corre.
    if (registroPrevio) {
      await esperarQuieto(registroPrevio.promise, 300_000).catch((err: unknown) => {
        console.log(
          `[campos-memoria] la quietud previa no se cobró entera: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    const b = await bootMem();
    if (!b.vault.exists) {
      const created = await call("nido:vault-create", { password: PASSWORD });
      expect(created.ok).toBe(true);
    } else if (!b.vault.unlocked) {
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
    }
    if (!llamaEngine.isLoaded) {
      // La residencia se cobra por la fachada del motor, la
      // misma que el gestor usa para cargar: tras la escena de
      // la puerta la bóveda se bloqueó, y el bloqueo descarga
      // el motor por la vía directa sin pasar por el gestor,
      // cuyo residente sigue apuntando a este modelo; la
      // activación del mismo modelo por el canal vuelve
      // entonces sin hacer nada (el gestor lo da por
      // residente) y la residencia no se cobra jamás por esa
      // vía. Cobrado en la descarga en aislado del cierre de
      // la pieza: los siete casos de la puerta en verde y este
      // bloque saltado por su beforeAll antes de esta forma.
      await llamaEngine.load("qwen2.5-1.5b-instruct-q4km.gguf");
      expect(llamaEngine.isLoaded).toBe(true);
    }
    // La costura del productor, sembrada tras el último
    // desbloqueo (cada desbloqueo recablea el motor de
    // producción): desde aquí, resumir es contar una llamada
    // y servir el texto de la escena.
    setSummarizeEngine({
      generate: async () => {
        resumenLlamadas += 1;
        return RESUMEN;
      },
      hasEmbeddedChatTemplate: () => true,
    });
  }, 420_000);

  it("umbral (a): la puerta cobra el campo: con 10 no resume y con 4 resume, sobre la misma conversación", async () => {
    await setMemorySettings({ autoSummarize: true, historyTurnThreshold: 10 });
    const id = "cableado2-umbral-a";
    try {
      for (let i = 0; i < 4; i++) await turnoCorto(id, i % 2 ? QB : CORTA);
      // Ocho turnos sin resumir contra la puerta en 10: no
      // resume, ni en la foto ni en el contador del productor.
      const base = resumenLlamadas;
      expect(await esperarResumen(id, 3_000)).toBeNull();
      expect(resumenLlamadas).toBe(base);
      // La misma conversación, la puerta en 4 y un turno más:
      // resume, y el resumen servido es el del productor.
      await setMemorySettings({ historyTurnThreshold: 4 });
      await turnoCorto(id, CORTA);
      expect(await esperarResumen(id, 30_000)).toBe(RESUMEN);
      expect(resumenLlamadas).toBeGreaterThan(base);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 420_000);

  it("umbral (b): el defecto manda: sin ajuste escrito la puerta es 6 y no 10", async () => {
    // Sin ajuste escrito: el campo se retira del almacén (la
    // serialización lo deja caer) y el compuesto cobra el
    // defecto del contrato, 6. Este es el caso que nace en
    // rojo contra el literal 10 de la carcasa: su rojo es el
    // certificado del cambio de conducta de la pieza.
    const sinUmbral = { historyTurnThreshold: undefined } as unknown as Partial<MemorySettings>;
    await setMemorySettings(sinUmbral);
    expect((await getMemorySettings()).historyTurnThreshold).toBe(6);
    await setMemorySettings({ autoSummarize: true });
    const id = "cableado2-umbral-b";
    try {
      for (let i = 0; i < 4; i++) await turnoCorto(id, i % 2 ? QB : CORTA);
      // Ocho turnos sin resumir contra la puerta del defecto:
      // resume. Contra el literal 10 no resumiría jamás.
      expect(await esperarResumen(id, 30_000)).toBe(RESUMEN);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 420_000);

  it("umbral (c): el interruptor gobierna primero: con autoSummarize apagado no se resume a ningún umbral", async () => {
    await setMemorySettings({ autoSummarize: false, historyTurnThreshold: 4 });
    const id = "cableado2-umbral-c";
    try {
      for (let i = 0; i < 4; i++) await turnoCorto(id, i % 2 ? QB : CORTA);
      // Ocho turnos sin resumir y la puerta en su mínimo: el
      // interruptor apagado lo gobierna todo y no hay resumen.
      // Nace en verde (regresión): la cura A-2 ya dio ese
      // gobierno y esta pieza no lo mueve.
      const base = resumenLlamadas;
      expect(await esperarResumen(id, 3_000)).toBeNull();
      expect(resumenLlamadas).toBe(base);
    } finally {
      await setMemorySettings({ autoSummarize: true, historyTurnThreshold: 6 });
      await asentarTurnosAbiertos();
    }
  }, 420_000);

  it("poda (a): el tope cobra: con 10 y 12 conversaciones asentadas quedan 10 y salen las dos de updatedAt más viejo", async () => {
    await setMemorySettings({ maxSavedSessions: 10 });
    const ids = Array.from({ length: 12 }, (_, i) => `cableado2-poda-a-${String(i + 1).padStart(2, "0")}`);
    try {
      for (const id of ids) await turnoCorto(id, CORTA);
      const mias = (await bootMem()).conversations.map((c) => c.id).filter((x) => ids.includes(x));
      expect(mias.length).toBe(10);
      expect(mias).not.toContain(ids[0]);
      expect(mias).not.toContain(ids[1]);
      expect(mias).toContain(ids[11]);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("poda (b): sin límite es sin límite: con el campo en 0 no sale ninguna, y al poner el tope salen las viejas", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `cableado2-poda-b-${String(i + 1).padStart(2, "0")}`);
    try {
      await setMemorySettings({ maxSavedSessions: 0 });
      for (const id of ids) await turnoCorto(id, CORTA);
      // Sin límite, como en el móvil: las once quedan.
      const sinLimite = (await bootMem()).conversations.map((c) => c.id).filter((x) => ids.includes(x));
      expect(sinLimite.length).toBe(11);
      // Con el tope puesto, el siguiente asentamiento poda:
      // quedan diez y las dos que salen son las más viejas
      // de esta tanda.
      await setMemorySettings({ maxSavedSessions: 10 });
      const id12 = "cableado2-poda-b-12";
      await turnoCorto(id12, CORTA);
      const todas = [...ids, id12];
      const mias = (await bootMem()).conversations.map((c) => c.id).filter((x) => todas.includes(x));
      expect(mias.length).toBe(10);
      expect(mias).not.toContain(ids[0]);
      expect(mias).not.toContain(ids[1]);
      expect(mias).toContain(id12);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("poda (c): la del turno nunca sale: ni con el tope en su mínimo ni tras refrescar su updatedAt", async () => {
    await setMemorySettings({ maxSavedSessions: 10 });
    const ids = Array.from({ length: 11 }, (_, i) => `cableado2-poda-c-${String(i + 1).padStart(2, "0")}`);
    try {
      for (const id of ids) await turnoCorto(id, CORTA);
      let mias = (await bootMem()).conversations.map((c) => c.id).filter((x) => ids.includes(x));
      expect(mias.length).toBe(10);
      // La conversación del último turno, la que disparó la
      // poda, está dentro; la que salió es la más vieja.
      expect(mias).toContain(ids[10]);
      expect(mias).not.toContain(ids[0]);
      // Y la propiedad se cobra también sobre la vieja que se
      // refresca: un turno suyo la deja dentro, y el siguiente
      // asentamiento poda a otra, no a ella ni a la nueva.
      await turnoCorto(ids[1], QB);
      const idNueva = "cableado2-poda-c-12";
      await turnoCorto(idNueva, CORTA);
      const todas = [...ids, idNueva];
      mias = (await bootMem()).conversations.map((c) => c.id).filter((x) => todas.includes(x));
      expect(mias.length).toBe(10);
      expect(mias).toContain(ids[1]);
      expect(mias).toContain(idNueva);
      expect(mias).not.toContain(ids[2]);
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 900_000);

  it("títulos (a): campo apagado, sin título: ni al crear ni al segundo turno, y la lista enseña su respaldo", async () => {
    await setMemorySettings({ autoGenerateTitles: false });
    const id = "cableado2-titulos-a";
    try {
      await turnoCorto(id, TA1);
      expect((await convDe(id))?.title).toBe("");
      await turnoCorto(id, TA2);
      expect((await convDe(id))?.title).toBe("");
      // El respaldo declarado en la apertura: los dos sitios
      // que enseñan la conversación en lista (Recientes y la
      // paleta) ya enseñan la cadena de pcSurface cuando el
      // título está vacío.
      // Re-firmado en E11 (paso 8): el menú de dividir es un
      // tercer sitio de lista y enseña el mismo respaldo;
      // el censo pasa a tres sin tocar la conducta.
      const appTsx = readFileSync(path.join(process.cwd(), "app/src/App/App.tsx"), "utf8");
      expect(appTsx.split('c.title || P("untitledChat")').length - 1).toBe(3);
    } finally {
      await setMemorySettings({ autoGenerateTitles: true });
      await asentarTurnosAbiertos();
    }
  }, 300_000);

  it("títulos (b): campo encendido, la conducta de hoy intacta: el título es el del primer texto y el segundo envío no lo mueve", async () => {
    // La conducta de hoy, cobrada contra la punta real en el
    // nacimiento de esta batería (dirimen asentado en el
    // checkpoint de la pieza): el segundo sitio reafirma
    // cuando el PRIMER par se asienta (turns.length === 2 son
    // dos entradas, usuario y asistente), con el texto de ese
    // mismo envío, de modo que el texto que gobierna el
    // título es siempre el primero. La lectura de la
    // preparación («el título del segundo envío») no
    // sobrevivió a la punta: el caso se corrigió, no la
    // pieza, cuyo contrato es gobernar los dos sitios
    // conservando intacta la conducta con el campo encendido.
    await setMemorySettings({ autoGenerateTitles: true });
    const id = "cableado2-titulos-b";
    try {
      await turnoCorto(id, TA1);
      expect((await convDe(id))?.title).toBe(TA1.slice(0, 60));
      await turnoCorto(id, TA2);
      expect((await convDe(id))?.title).toBe(TA1.slice(0, 60));
    } finally {
      await asentarTurnosAbiertos();
    }
  }, 300_000);

  it("canal (a): las tres claves entran por nido:settings-set, persisten, se cobran en el bootstrap y fuera de conjunto no persisten", async () => {
    const w = await call("nido:settings-set", {
      memoryHistoryTurnThreshold: 8,
      memoryMaxSavedSessions: 25,
      memoryAutoGenerateTitles: false,
    });
    expect(w.ok).toBe(true);
    // Persisten en el almacén…
    const m = await getMemorySettings();
    expect(m.historyTurnThreshold).toBe(8);
    expect(m.maxSavedSessions).toBe(25);
    expect(m.autoGenerateTitles).toBe(false);
    // …y se cobran en la foto del bootstrap siguiente.
    const b = await bootMem();
    expect(b.memorySettings?.historyTurnThreshold).toBe(8);
    expect(b.memorySettings?.maxSavedSessions).toBe(25);
    expect(b.memorySettings?.autoGenerateTitles).toBe(false);
    // Fuera de su conjunto, un valor no persiste.
    await call("nido:settings-set", { memoryHistoryTurnThreshold: 5 });
    await call("nido:settings-set", { memoryMaxSavedSessions: 7 });
    const m2 = await getMemorySettings();
    expect(m2.historyTurnThreshold).toBe(8);
    expect(m2.maxSavedSessions).toBe(25);
    // La sesión se exige, como en todo el manejador: bloqueada,
    // la escritura vuelve locked y no deja rastro.
    await call("nido:vault-lock");
    const wl = await call("nido:settings-set", { memoryHistoryTurnThreshold: 6 });
    expect(wl.ok).toBe(false);
    expect(wl.reason).toBe("locked");
    const un = await call("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    expect((await getMemorySettings()).historyTurnThreshold).toBe(8);
  }, 180_000);

  it("superficie (b): MemoryView pinta los tres controles desde el bootstrap y escribe por el canal con el patrón de la casilla viva", async () => {
    // Sin DOM en esta casa, la superficie se cobra como
    // contrato sobre la fuente de la vista, en la forma de las
    // baterías de contrato de la casa: los tres controles
    // existen en MemoryView, leen sus etiquetas de la sección
    // que ya vive en los tres locales y escriben por el canal
    // con los tres argumentos de la pieza.
    const appTsx = readFileSync(path.join(process.cwd(), "app/src/App/App.tsx"), "utf8");
    const inicio = appTsx.indexOf("function MemoryView");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const resto = appTsx.slice(inicio);
    const fin = resto.indexOf("\nfunction ", 10);
    const vista = fin > 0 ? resto.slice(0, fin) : resto;
    expect(vista).toContain("settingsSet({ memoryHistoryTurnThreshold");
    expect(vista).toContain("settingsSet({ memoryMaxSavedSessions");
    expect(vista).toContain("settingsSet({ memoryAutoGenerateTitles");
    expect(vista).toContain('M("turnsBeforeSummarizing")');
    expect(vista).toContain('M("maxSavedSessions")');
    expect(vista).toContain('M("unlimited")');
    expect(vista).toContain('M("autoTitlesLabel")');
    expect(vista).toContain("[4, 6, 8, 10]");
    expect(vista).toContain("[10, 25, 50, 0]");
  }, 60_000);
});

// ---------------------------------------------------------------------
// Cura §6: el libro del gestor y el motor no divergen al
// bloquear. La observación nació en la pieza 2 de este bloque
// (su §6: el bloqueo descargaba el motor por la vía directa sin
// pasar por el gestor, el residente del libro seguía apuntando
// al 1.5B y la activación del mismo modelo volvía ok sin hacer
// nada) y VERIFICACION-CABLEADO-2 la clasificó defecto vivo
// acotado: tras desbloquear, el gestor declara residente un
// modelo que el motor no tiene, activarlo vuelve ok: true sin
// cargar nada, el reintento con menos memoria libera todo y
// «activa» nada, y la primera activación genuina juzga su
// contexto con un crédito fantasma. La cura (la forma (a) del
// dirimen de la casa): al bloquear, el residente se descarga
// por el gestor, que anula su libro antes de descargar, y la
// descarga directa de la fachada queda intacta detrás como
// garantía del motor vacío.
//
// La escena del bloque es la del fichero, como la del bloque
// de la pieza 2: la bóveda y el 1.5B de la escena, con la
// residencia cobrada en los dos estados (si la bóveda no
// existe se crea, si está bloqueada se desbloquea, la
// residencia del libro por el canal y la de la fachada por la
// fachada, el rodeo de la pieza 2: antes de la cura el canal
// no puede cobrar una residencia que el libro da por hecha, y
// el bloque no depende de la cura para nacer). Cada caso deja
// la bóveda desbloqueada y sin turno en vuelo, como la
// recibe: este bloque no abre ningún turno.
// ---------------------------------------------------------------------

describe("Cura §6: el libro del gestor y el motor no divergen al bloquear", () => {
  const ID = "qwen2.5-1.5b-instruct-q4km";

  type ModelsReply = {
    ok: boolean;
    reason?: string;
    models: { id: string; resident: boolean; state: string }[];
  };

  const modelsList = async (): Promise<ModelsReply> =>
    (await call("nido:models-list")) as unknown as ModelsReply;
  const cardOf = async (id: string) =>
    (await modelsList()).models.find((m) => m.id === id);

  /** El ciclo entero del cargo: bloquear y desbloquear, con
   * los dos ok cobrados. */
  async function cicloBloqueo(): Promise<void> {
    const lock = await call("nido:vault-lock");
    expect(lock.ok).toBe(true);
    const unlock = await call("nido:vault-unlock", { password: PASSWORD });
    expect(unlock.ok).toBe(true);
  }

  beforeAll(async () => {
    // La escena del fichero puede traer un turno anterior
    // asentándose: se espera su quietud derivada, como entre
    // las escenas de la puerta. En una corrida filtrada a
    // este bloque no hay escena previa y este paso no corre.
    if (registroPrevio) {
      await esperarQuieto(registroPrevio.promise, 300_000).catch((err: unknown) => {
        console.log(
          `[cura-s6] la quietud previa no se cobró entera: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    type BootS6 = { vault: { exists: boolean; unlocked: boolean } };
    const b = (await bootstrap()) as unknown as BootS6;
    if (!b.vault.exists) {
      const created = await call("nido:vault-create", { password: PASSWORD });
      expect(created.ok).toBe(true);
    } else if (!b.vault.unlocked) {
      const un = await call("nido:vault-unlock", { password: PASSWORD });
      expect(un.ok).toBe(true);
    }
    // La residencia del libro, por el canal; la de la fachada,
    // por la fachada (el rodeo asentado en el beforeAll del
    // bloque de la pieza 2): antes de la cura el libro puede
    // dar por residente lo que el motor no tiene, y entonces
    // el canal no carga nada; el bloque cobra su escena en
    // los dos estados sin depender de la cura.
    if (!(await cardOf(ID))?.resident) {
      await call("nido:model-load", { id: ID });
    }
    if (!llamaEngine.isLoaded) {
      await llamaEngine.load("qwen2.5-1.5b-instruct-q4km.gguf");
      expect(llamaEngine.isLoaded).toBe(true);
    }
    expect((await cardOf(ID))?.resident).toBe(true);
  }, 420_000);

  it("el libro queda limpio al bloquear: tras el ciclo, ninguna tarjeta declara residente", async () => {
    // La escena del cargo, cobrada dentro del caso: el 1.5B
    // residente por el gestor, con su tarjeta residente en la
    // lista, antes de bloquear.
    expect((await cardOf(ID))?.resident).toBe(true);
    await cicloBloqueo();
    const list = await modelsList();
    expect(list.models.some((m) => m.resident)).toBe(false);
  }, 240_000);

  it("la activación del mismo modelo tras desbloquear carga de verdad", async () => {
    await cicloBloqueo();
    const reply = (await call("nido:model-load", { id: ID })) as unknown as ModelsReply;
    expect(reply.ok).toBe(true);
    // La prueba de la carga es el motor, no la respuesta: el
    // canal volvía ok con el motor vacío por el retorno
    // temprano del libro rancio.
    expect(llamaEngine.isLoaded).toBe(true);
    expect(reply.models.find((m) => m.id === ID)?.resident).toBe(true);
  }, 240_000);

  it("el reintento con menos memoria tras desbloquear carga de verdad", async () => {
    await cicloBloqueo();
    const reply = (await call("nido:model-load-retry-less", {
      id: ID,
    })) as unknown as ModelsReply;
    expect(reply.ok).toBe(true);
    expect(llamaEngine.isLoaded).toBe(true);
  }, 240_000);
});
