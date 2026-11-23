/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La batería de la cura de AU-1 (auditoría de usuario, asientos
 * 7.6 y 7.7): durante una descarga empezada en la propia vista
 * de Modelos, la fila mentía «sin descargar» durante toda la
 * transferencia, sin barra, sin cifras y sin botón de pausar, y
 * salir y volver no refrescaba nada. La causa, cobrada en el
 * código (PREP-CURA-AU1): el estado vivo de la descarga existe
 * en el principal durante toda la transferencia y el canal
 * para leerlo sin esperar existe, pero la vista nunca pregunta
 * mientras la transferencia corre — tres cerrojos en serie en
 * ModelsTab (el gesto espera la promesa entera antes de aplicar
 * nada, el sondeo se arma solo con la fila que debe descubrir,
 * y al montar solo se pide la forma completa, que espera tras
 * la cola de la descarga).
 *
 * La batería cobra las dos mitades de esa verdad:
 *
 * - Del principal (servicios reales con el doble de Electron
 *   de la casa y la red sustituida por un cuerpo lento del
 *   tamaño exacto del catálogo, la costura de
 *   modelDownloadLock.test.ts): la ligera cobra en vuelo y
 *   dice la verdad, y la pausa en vuelo asienta la promesa y
 *   la ligera la lee. Los dos casos nacen VERDES a propósito:
 *   sellan que el almacén y el canal ya decían la verdad y que
 *   la cura no tenía que tocar el principal.
 * - De la vista (contratos estáticos sobre la fuente de
 *   App.tsx, la forma de modelBootstrapBreakdown.test.ts: PC
 *   no tiene arnés de componentes, y su fragilidad queda
 *   declarada igual que en ellos — cobran la cadena, no el
 *   gesto en vivo; el gesto lo re-conduce la auditoría de
 *   usuario en los asientos 7.6 y 7.7 sobre la punta curada):
 *   el gesto pide la ligera sin esperar al asentamiento, el
 *   sondeo se arma con el gesto en vuelo, y al montar la
 *   ligera llega sin esperar a la cola. Los tres nacen en
 *   ROJO por ausencia. El sexto caso, de guarda, sella que el
 *   pintado de la fila en descarga (la barra con sus cifras y
 *   el botón de pausa) sigue entero: es el pintado que la
 *   cura alcanza, no uno que la cura rehaga.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

const ID = "qwen2.5-0.5b-instruct-q4km";
const entry = DESKTOP_CATALOG.find((e) => e.id === ID)!;
const modelsDir = () => path.join(harness.userData, "models");
const partPath = () => path.join(modelsDir(), `${ID}.gguf.part`);
const partSize = () => (existsSync(partPath()) ? statSync(partPath()).size : -1);

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`espera agotada: ${label}`);
    await sleep(100);
  }
}

const realFetch = globalThis.fetch;

/** La promesa de la descarga en vuelo, compartida por la escena. */
let downloadReply: Promise<Reply>;

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-download-live-"));
  await installServices();
}, 60_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("AU-1 · el principal ya dice la verdad en vuelo (guardas)", () => {
  it("la ligera cobra en vuelo y dice la verdad: la fila va en «downloading» con sus bytes y su total", async () => {
    const created = await call("nido:vault-create", { password: "sonda-descarga-viva" });
    expect(created.ok).toBe(true);

    // La red sustituida: cuerpo lento del tamaño exacto del
    // catálogo, con Range honrado y el aborto cobrado en el
    // cuerpo, como en modelDownloadLock.test.ts. Todo lo
    // demás es real.
    const TOTAL = entry.fileBytes;
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

    // La transferencia arranca SIN esperarla (ese es el gesto
    // cuya promesa la vista de hoy espera entera) y el .part
    // crece: la descarga está en vuelo de verdad.
    downloadReply = call("nido:model-download", { id: ID });
    await waitFor(() => partSize() >= 1_048_576, 60_000, "el .part supera 1 MiB");

    // La ligera se asienta mientras la promesa de la descarga
    // sigue pendiente: gana la carrera contra un plazo corto
    // y la promesa sigue viva al cobrarla.
    const light = await Promise.race([
      call("nido:models-list", { light: true }).then((r) => ({ kind: "reply" as const, reply: r })),
      sleep(10_000).then(() => ({ kind: "timeout" as const, reply: null })),
    ]);
    expect(light.kind).toBe("reply");
    const stillPending = await Promise.race([
      downloadReply.then(() => "settled" as const),
      sleep(50).then(() => "pending" as const),
    ]);
    expect(stillPending).toBe("pending");

    // Y dice la verdad: la fila va en «downloading», con
    // bytes contados y el total del catálogo.
    expect(light.reply?.ok).toBe(true);
    const card = light.reply?.models?.find((m) => m.id === ID);
    expect(card?.state).toBe("downloading");
    expect(card?.transfer?.downloadedBytes ?? 0).toBeGreaterThan(0);
    expect(card?.transfer?.totalBytes).toBe(TOTAL);
  }, 120_000);

  it("la pausa en vuelo asienta la promesa como pausada y la ligera lee la fila pausada con sus bytes", async () => {
    const pause = await call("nido:model-download-pause", { id: ID });
    expect(pause.ok).toBe(true);
    const settled = await Promise.race([
      downloadReply.then((r) => ({ kind: "reply" as const, reply: r })),
      sleep(15_000).then(() => ({ kind: "timeout" as const, reply: null })),
    ]);
    expect(settled.kind).toBe("reply");
    expect(settled.reply?.paused).toBe(true);

    const light = await call("nido:models-list", { light: true });
    expect(light.ok).toBe(true);
    const card = light.models?.find((m) => m.id === ID);
    expect(card?.state).toBe("paused");
    expect(card?.transfer?.downloadedBytes ?? 0).toBeGreaterThan(0);
  }, 60_000);
});

describe("AU-1 · la vista lee el almacén vivo mientras la transferencia corre", () => {
  const appSrc = readFileSync(path.join(process.cwd(), "app", "src", "App", "App.tsx"), "utf8");
  const tabStart = appSrc.indexOf("function ModelsTab(");
  const tabSrc = appSrc.slice(tabStart);

  it("el gesto pide la ligera sin esperar al asentamiento: captura la promesa y lee en el acto", () => {
    expect(tabStart).toBeGreaterThan(-1);
    const start = tabSrc.indexOf("const download = async (id: string) => {");
    expect(start).toBeGreaterThan(-1);
    const end = tabSrc.indexOf("const discard = async", start);
    expect(end).toBeGreaterThan(start);
    const body = tabSrc.slice(start, end);
    // La promesa se captura, la ligera se pide entre la
    // captura y el await: ese orden es la cura del cerrojo 1.
    const capture = body.indexOf("const pending = window.nido.modelDownload(id);");
    expect(capture).toBeGreaterThan(-1);
    const pullAt = body.indexOf("void pull(true);", capture);
    expect(pullAt).toBeGreaterThan(capture);
    const awaitAt = body.indexOf("await pending", pullAt);
    expect(awaitAt).toBeGreaterThan(pullAt);
  });

  it("el sondeo se arma con el gesto en vuelo, no solo con la fila descubierta", () => {
    const start = tabSrc.indexOf("const anyDownloading =");
    expect(start).toBeGreaterThan(-1);
    const end = tabSrc.indexOf(";", start);
    expect(end).toBeGreaterThan(start);
    const expr = tabSrc.slice(start, end);
    // La pierna del vuelo local en O con la cláusula de la
    // fila: sin ella, el intervalo solo existe cuando la
    // fila ya dice «downloading», que es lo que el sondeo
    // debe descubrir (el huevo y la gallina de AU-1).
    expect(expr).toContain("busy !== null");
    expect(expr).toContain("||");
    expect(expr).toContain('state === "downloading"');
  });

  it("al montar, la ligera llega sin esperar a la cola: el efecto pide las dos formas", () => {
    const start = tabSrc.indexOf("useEffect(() => {");
    expect(start).toBeGreaterThan(-1);
    const end = tabSrc.indexOf("}, [pull]);", start);
    expect(end).toBeGreaterThan(start);
    const body = tabSrc.slice(start, end);
    // La ligera junto a la completa: la completa espera tras
    // la cola de la descarga y una vista recién montada no
    // puede quedarse con la foto del arranque hasta que la
    // transferencia termine (el cerrojo 3).
    expect(body).toContain("void pull(true);");
    expect(body).toContain("void pull(false);");
  });

  it("el pintado de la fila en descarga sigue entero: la barra con sus cifras y el botón de pausa (guarda)", () => {
    // La barra ligada a la transferencia, con sus cifras.
    const barAt = tabSrc.indexOf('className="progress-track"');
    expect(barAt).toBeGreaterThan(-1);
    const bar = tabSrc.slice(Math.max(0, barAt - 200), barAt + 800);
    expect(bar).toContain("m.transfer.downloadedBytes");
    expect(bar).toContain("m.transfer.totalBytes");
    // El botón de pausa en el caso «downloading» de
    // actionButton: es el pintado que la auditoría encontró
    // inalcanzable y que esta cura alcanza sin rehacerlo.
    const abStart = tabSrc.indexOf("const actionButton = (m: ModelInfo) => {");
    expect(abStart).toBeGreaterThan(-1);
    // El corte va hasta el return del componente: el primer
    // «return (» tras actionButton es el del propio caso
    // «downloading», no el fin de la función.
    const abEnd = tabSrc.indexOf("  return (\n    <>", abStart);
    expect(abEnd).toBeGreaterThan(abStart);
    const ab = tabSrc.slice(abStart, abEnd);
    const caseAt = ab.indexOf('case "downloading":');
    expect(caseAt).toBeGreaterThan(-1);
    const caseBody = ab.slice(caseAt, ab.indexOf('case "paused":', caseAt));
    expect(caseBody).toContain("modelDownloadPause");
    expect(caseBody).toContain("actionPause");
  });
});
