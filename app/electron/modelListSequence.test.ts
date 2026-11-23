/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La batería de la cura de AU-2 (auditoría de usuario, la
 * escena de sdiag2): tras pulsar «Usar este modelo», la fila
 * dice «Activo» a los ~60 s, vuelve a «En disco» a los ~70 s
 * y así se queda sin enmienda, con el modelo cargado y
 * residente probado por dos rutas independientes. La causa,
 * cobrada en el código (PREP-CURA-AU2): la vista de Modelos
 * escribe su estado por dos sitios sin orden ni guardia (el
 * apply de pull y applyModels), la foto completa del montaje
 * nace vieja por construcción (su refresh se encola en la
 * cola serie del gestor por delante de la activación del
 * clic, y su contenido queda fijado ahí, llegue su
 * aplicación cuando llegue), y tras la carga nada vuelve a
 * leer la lista: la pintura enterrada no se enmienda. El
 * principal no puede producir el retroceso: una vez fijado
 * el residente, ningún refresco lo baja, y la respuesta de
 * la propia carga trae la verdad posterior.
 *
 * La batería cobra las dos orillas:
 *
 * - Del principal (servicios reales con el doble de
 *   Electron de la casa, el GGUF genuino del 1.5B como
 *   fichero real en la escena — la costura de activación
 *   de turnSendDoor.test.ts — y la red sustituida por un
 *   cuerpo lento que honra Range y la señal de aborto, la
 *   costura de modelDownloadLock.test.ts): la verdad tras
 *   activar está en las dos formas y no retrocede, y la
 *   foto vieja existe y viene fechada de antes. Los dos
 *   casos nacen VERDES a propósito: sellan que el
 *   principal dice la verdad y fabrica el veneno fechado;
 *   lo único que puede convertirlo en mentira pintada es
 *   la aplicación tardía en la vista. La escena es una y
 *   el orden de los casos es la escena: primero se fabrica
 *   la foto vieja contra la activación real (que de paso
 *   cobra la respuesta de la carga), y después se cobra la
 *   verdad asentada en las dos formas.
 * - De la vista (contratos estáticos sobre el cuerpo de
 *   ModelsTab, cortado por sus marcas, como
 *   modelBootstrapBreakdown.test.ts: PC no tiene arnés de
 *   componentes, y su fragilidad queda declarada igual que
 *   en ellos; cobran la cadena, no el gesto en vivo, y el
 *   gesto lo re-conduce la auditoría de usuario en la
 *   escena de sdiag2 sobre la punta curada): pull sella al
 *   emitir y su apply solo escribe con el sello vigente;
 *   los gestos sellan al emitir y applyModels no escribe
 *   con sello viejo; y la caída a la ligera hereda el
 *   sello de su emisión, sin segundo incremento. Los tres
 *   nacen en ROJO por ausencia. El sexto caso, de guarda,
 *   sella que no hay un tercer escritor de los datos y que
 *   la conducta de asentamiento de los gestos conserva su
 *   forma: la cura no la reescribe ni deja una puerta sin
 *   sellar.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
  },
  BrowserWindow: {
    fromWebContents: () => ({ isDestroyed: () => false }),
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      harness.handlers.set(channel, fn as never);
    },
    on: () => undefined,
  },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined },
}));

// La bendición de origen entra por su sede real (appUrl.ts, la
// misma que shell.ts re-exporta), como en modelLoadGuard.test.ts.
vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import { DESKTOP_CATALOG } from "../../src/core/catalog.ts";

const event = { sender: {}, senderFrame: { url: "nido://app/index.html" } };

type Reply = {
  ok: boolean;
  reason?: string;
  paused?: boolean;
  models?: {
    id: string;
    state: string;
    resident: boolean;
    transfer: { downloadedBytes: number; totalBytes: number; paused: boolean } | null;
    installed: boolean;
  }[];
};

function call(channel: string, args?: unknown): Promise<Reply> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<Reply>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ID = "qwen2.5-1.5b-instruct-q4km";
const OTHER = "qwen2.5-0.5b-instruct-q4km";
const otherEntry = DESKTOP_CATALOG.find((e) => e.id === OTHER)!;
const modelsDir = () => path.join(harness.userData, "models");
const partPath = () => path.join(modelsDir(), `${OTHER}.gguf.part`);
const partSize = () => (existsSync(partPath()) ? statSync(partPath()).size : -1);

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`espera agotada: ${label}`);
    await sleep(100);
  }
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-list-sequence-"));
  // El GGUF genuino del 1.5B sembrado por enlace duro en el
  // directorio de modelos de la escena: el modelo está
  // INSTALADO y su activación es real, como en
  // turnSendDoor.test.ts.
  const dir = modelsDir();
  mkdirSync(dir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "models", "qwen2.5-1.5b-instruct-q4km.gguf"),
    path.join(dir, "qwen2.5-1.5b-instruct-q4km.gguf"),
  );
  await installServices();
}, 60_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("AU-2 · el principal dice la verdad y la foto vieja viene fechada (guardas)", () => {
  it("la foto vieja existe y viene fechada de antes: emitida antes de la activación, su tarjeta del 1.5B no dice activa", async () => {
    const created = await call("nido:vault-create", { password: "sonda-secuencia-lista" });
    expect(created.ok).toBe(true);

    // La red sustituida: cuerpo lento del tamaño exacto del
    // catálogo para OTRO modelo, con Range honrado y el
    // aborto cobrado en el cuerpo, como en
    // modelDownloadLock.test.ts. Su descarga ocupa la cola
    // serie del gestor durante toda la transferencia: es la
    // máquina ocupada de la escena.
    const TOTAL = otherEntry.fileBytes;
    const chunk = new Uint8Array(128 * 1024);
    globalThis.fetch = (async (_url: unknown, opts?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      let start = 0;
      let status = 200;
      const headers = new Headers();
      const range = opts?.headers?.Range;
      if (range) {
        const m = /^bytes=(\d+)-$/.exec(range);
        if (m) {
          start = Number(m[1]);
          status = 206;
          headers.set("content-range", `bytes ${start}-${TOTAL - 1}/${TOTAL}`);
        }
      }
      headers.set("content-length", String(TOTAL - start));
      let sent = start;
      let stopped = false;
      const bodyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          opts?.signal?.addEventListener("abort", () => {
            stopped = true;
            try {
              controller.error(new Error("aborted"));
            } catch {
              /* ya cerrada */
            }
          });
        },
        async pull(controller) {
          if (stopped || sent >= TOTAL) {
            try {
              controller.close();
            } catch {
              /* ya cerrada */
            }
            return;
          }
          await sleep(8);
          const n = Math.min(chunk.length, TOTAL - sent);
          sent += n;
          try {
            controller.enqueue(chunk.subarray(0, n) as Uint8Array);
          } catch {
            /* cerrada por el consumidor */
          }
        },
        cancel() {
          stopped = true;
        },
      });
      return new Response(bodyStream, { status, headers });
    }) as typeof fetch;

    // La descarga de OTRO modelo arranca y ocupa la cola.
    const downloadReply = call("nido:model-download", { id: OTHER });
    await waitFor(() => partSize() >= 1_048_576, 60_000, "el .part del otro modelo supera 1 MiB");

    // Sin esperar, en este orden: la lista completa (su
    // refresh se encola tras la descarga y por delante de
    // la activación: su foto nace del mundo de antes de
    // cargar) y la activación del 1.5B.
    const staleReply = call("nido:models-list");
    const loadReply = call("nido:model-load", { id: ID });

    // La pausa asienta la descarga y libera la cola: el
    // refresh de la completa corre entonces (antes de la
    // activación encolada tras él) y la activación después.
    const pause = await call("nido:model-download-pause", { id: OTHER });
    expect(pause.ok).toBe(true);
    const dl = await Promise.race([
      downloadReply.then((r) => ({ kind: "reply" as const, reply: r })),
      sleep(30_000).then(() => ({ kind: "timeout" as const, reply: null })),
    ]);
    expect(dl.kind).toBe("reply");
    expect(dl.reply?.paused).toBe(true);

    // La activación se asienta, y su propia respuesta ya
    // trae la verdad posterior: la tarjeta activa y
    // residente (es también el cobro (a) del caso de la
    // verdad tras activar).
    const load = await Promise.race([
      loadReply.then((r) => ({ kind: "reply" as const, reply: r })),
      sleep(240_000).then(() => ({ kind: "timeout" as const, reply: null })),
    ]);
    expect(load.kind).toBe("reply");
    expect(load.reply?.ok).toBe(true);
    const loadCard = load.reply?.models?.find((m) => m.id === ID);
    expect(loadCard?.state).toBe("active");
    expect(loadCard?.resident).toBe(true);

    // La foto vieja, recogida ahora: su tarjeta del 1.5B NO
    // dice activa (dice en disco, sin residente), aunque ya
    // aterriza después de la activación. Ese es el veneno
    // fechado: solo la aplicación tardía en la vista puede
    // convertirlo en la mentira de sdiag2.
    const stale = await staleReply;
    expect(stale.ok).toBe(true);
    const staleCard = stale.models?.find((m) => m.id === ID);
    expect(staleCard).toBeTruthy();
    expect(staleCard?.state).not.toBe("active");
    expect(staleCard?.resident).toBe(false);

    // Y la ligera fresca dice la verdad que la vieja no
    // trae: activa y residente.
    const light = await call("nido:models-list", { light: true });
    const lightCard = light.models?.find((m) => m.id === ID);
    expect(lightCard?.state).toBe("active");
    expect(lightCard?.resident).toBe(true);
  }, 300_000);

  it("tras activar, la verdad está en las dos formas y no retrocede: la ligera y la completa dicen activa y residente", async () => {
    const light = await call("nido:models-list", { light: true });
    expect(light.ok).toBe(true);
    const lightCard = light.models?.find((m) => m.id === ID);
    expect(lightCard?.state).toBe("active");
    expect(lightCard?.resident).toBe(true);

    const full = await call("nido:models-list");
    expect(full.ok).toBe(true);
    const fullCard = full.models?.find((m) => m.id === ID);
    expect(fullCard?.state).toBe("active");
    expect(fullCard?.resident).toBe(true);
  }, 60_000);
});

describe("AU-2 · la vista no aplica fotos viejas sobre operaciones nuevas", () => {
  const appSrc = readFileSync(path.join(process.cwd(), "app", "src", "App", "App.tsx"), "utf8");
  const tabStart = appSrc.indexOf("function ModelsTab(");
  // El cuerpo de ModelsTab, cortado donde nace el siguiente
  // componente: el censo de escritores del sexto caso cuenta
  // solo sobre este cuerpo, no sobre el fichero entero.
  const tabEnd = appSrc.indexOf("function AboutTab(", tabStart);
  const tabSrc = appSrc.slice(tabStart, tabEnd > tabStart ? tabEnd : undefined);
  const pullStart = tabSrc.indexOf("const pull = useCallback(");
  const pullEnd = tabSrc.indexOf("useEffect(() => {", pullStart);
  const pullSrc = tabSrc.slice(pullStart, pullEnd);

  it("pull sella al emitir y su apply solo escribe con el sello vigente", () => {
    expect(tabStart).toBeGreaterThan(-1);
    expect(pullStart).toBeGreaterThan(-1);
    expect(pullEnd).toBeGreaterThan(pullStart);
    // El incremento va antes del primer await de la
    // emisión: el sello se toma al emitir, no al volver.
    const seal = pullSrc.indexOf("const seq = ++applySeq.current;");
    expect(seal).toBeGreaterThan(-1);
    const firstAwait = pullSrc.indexOf("await window.nido");
    expect(firstAwait).toBeGreaterThan(seal);
    // Y el setData de su apply vive bajo la comparación de
    // vigencia del sello capturado: una respuesta superada
    // se descarta en silencio.
    expect(pullSrc).toContain("if (r.ok && seq === applySeq.current)");
  });

  it("los gestos sellan al emitir y applyModels no escribe con sello viejo", () => {
    // applyModels abre con la vuelta en silencio si el
    // sello recibido no es el vigente: ni escribe los
    // datos ni dispara el pull de su rama sin modelos.
    const amStart = tabSrc.indexOf("const applyModels = (r:");
    expect(amStart).toBeGreaterThan(-1);
    const amEnd = tabSrc.indexOf("const download = async", amStart);
    expect(amEnd).toBeGreaterThan(amStart);
    const am = tabSrc.slice(amStart, amEnd);
    expect(am).toContain("seq: number");
    const guard = am.indexOf("if (seq !== applySeq.current) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(am.indexOf("if (r.models)"));
    // Los tres gestos toman el sello al emitir y lo pasan.
    const gestures: Array<[string, string]> = [
      ["const download = async (id: string) => {", "const discard = async"],
      ["const discard = async (id: string) => {", "const load = async"],
      ["const load = async (id: string, retryLess: boolean) => {", "const roleText"],
    ];
    for (const [from, to] of gestures) {
      const gStart = tabSrc.indexOf(from);
      expect(gStart).toBeGreaterThan(-1);
      const gEnd = tabSrc.indexOf(to, gStart);
      expect(gEnd).toBeGreaterThan(gStart);
      const g = tabSrc.slice(gStart, gEnd);
      expect(g).toContain("const seq = ++applySeq.current;");
      expect(g).toContain("applyModels(r, seq)");
    }
  });

  it("la caída a la ligera hereda el sello de su emisión: no hay un segundo incremento en pull", () => {
    // Un sello por emisión: si la caída del catch sellara
    // de nuevo, una lectura superada podría resucitar como
    // vigente. El cuerpo entero de pull incrementa una
    // sola vez, y la ligera de la caída pasa por la misma
    // clausura apply sellada de la emisión.
    const seals = pullSrc.match(/\+\+applySeq\.current/g) ?? [];
    expect(seals.length).toBe(1);
    const catchAt = pullSrc.indexOf("catch");
    expect(catchAt).toBeGreaterThan(-1);
    expect(pullSrc.indexOf("apply(await window.nido.modelsListLight())", catchAt)).toBeGreaterThan(catchAt);
  });

  it("el asentamiento conserva su forma y no hay un tercer escritor (guarda)", () => {
    // (a) Censo de escritores: todo setData( del cuerpo de
    // ModelsTab ocurre dentro de los dos aplicadores (el
    // apply de pull y applyModels). La guardia no deja
    // ninguna puerta fuera.
    const writes = tabSrc.match(/setData\(/g) ?? [];
    expect(writes.length).toBe(2);
    expect(pullSrc).toContain("setData(");
    const amStart = tabSrc.indexOf("const applyModels = (r:");
    const amEnd = tabSrc.indexOf("const download = async", amStart);
    expect(tabSrc.slice(amStart, amEnd)).toContain("setData(");
    // (b) La conducta de asentamiento no se reescribe:
    // load en éxito limpia loadError y refresca el
    // bootstrap del padre; en fracaso fija loadError sin
    // tocar los datos; los tres gestos ponen y quitan
    // setBusy alrededor de su espera.
    const loadStart = tabSrc.indexOf("const load = async (id: string, retryLess: boolean) => {");
    const loadEnd = tabSrc.indexOf("const roleText", loadStart);
    const load = tabSrc.slice(loadStart, loadEnd);
    expect(load).toContain("setLoadError(null)");
    expect(load).toContain("void refresh();");
    expect(load).toContain("setLoadError({ id, message:");
    const gestureBounds: Array<[string, string]> = [
      ["const download = async (id: string) => {", "const discard = async"],
      ["const discard = async (id: string) => {", "const load = async"],
      ["const load = async (id: string, retryLess: boolean) => {", "const roleText"],
    ];
    for (const [from, to] of gestureBounds) {
      const gStart = tabSrc.indexOf(from);
      expect(gStart).toBeGreaterThan(-1);
      const gEnd = tabSrc.indexOf(to, gStart);
      expect(gEnd).toBeGreaterThan(gStart);
      const g = tabSrc.slice(gStart, gEnd);
      expect(g).toContain("setBusy(id);");
      expect(g).toContain("setBusy(null);");
    }
  });
});
