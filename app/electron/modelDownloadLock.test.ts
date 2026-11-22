/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La batería de la cura del bloqueo a mitad de descarga: la
 * secuencia de la sonda nueva (b) de la auditoría de ataque de
 * E4 (VERIFICACION-AUDITORIA-ATAQUE-E4), corrida contra los
 * servicios reales de la carcasa con el doble de Electron de la
 * casa y la red sustituida por un cuerpo lento del tamaño exacto
 * del catálogo. La sonda midió el defecto: bloqueada la bóveda a
 * mitad de transferencia, el `.part` seguía creciendo (2.752.512
 * → 13.762.560 B y 2.883.584 → 13.893.632 B en sus dos corridas),
 * porque el bloqueo no cancelaba la descarga en vuelo. Esta
 * batería cobra la conducta curada: el bloqueo detiene la
 * transferencia por el mismo mecanismo de la pausa, la promesa
 * de la descarga se asienta pausada sin que nadie pulse pausar,
 * el `.part` queda quieto y contado, la tarjeta lee la pausa, y
 * tras desbloquear el descarte cobra y limpia. El orden de los
 * casos es la escena: una sola descarga, un solo bloqueo.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
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
    transfer: { downloadedBytes: number; paused: boolean } | null;
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
const finalPath = () => path.join(modelsDir(), `${ID}.gguf`);
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
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-download-lock-"));
  await installServices();
}, 60_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("el bloqueo a mitad de descarga detiene la transferencia", () => {
  it("la descarga arranca y crece; el bloqueo llega a mitad y la promesa se asienta pausada sin tocar la pausa", async () => {
    const created = await call("nido:vault-create", { password: "sonda-bloqueo-descarga" });
    expect(created.ok).toBe(true);

    // La red sustituida: cuerpo lento del tamaño exacto del
    // catálogo, con Range honrado y el aborto cobrado en el
    // cuerpo, como en la sonda (b). Todo lo demás es real.
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

    // La transferencia arranca y el .part crece.
    downloadReply = call("nido:model-download", { id: ID });
    await waitFor(() => partSize() >= 1_048_576, 60_000, "el .part supera 1 MiB");

    // Bloqueo de la bóveda a mitad de transferencia.
    const lock = await call("nido:vault-lock");
    expect(lock.ok).toBe(true);

    // La conducta curada: la descarga se asienta como pausada
    // por el solo bloqueo, sin llamada a model-download-pause.
    // La carrera acota el rojo del nacimiento: sin la cura, la
    // promesa no se asienta nunca y gana el centinela.
    const settled = await Promise.race([
      downloadReply.then((r) => ({ kind: "reply" as const, reply: r })),
      sleep(15_000).then(() => ({ kind: "timeout" as const, reply: null })),
    ]);
    expect(settled.kind).toBe("reply");
    expect(settled.reply?.paused).toBe(true);
  }, 120_000);

  it("tras el bloqueo, el .part queda quieto y contado, la tarjeta lee la pausa y los canales cobran la sesión", async () => {
    // Con la bóveda bloqueada, descargar y descartar responden
    // locked (la sonda lo cobraba por sondeo: el desmontaje es
    // asíncrono y su primera lectura puede adelantarlo).
    let lockedDiscard: Reply | null = null;
    for (let i = 0; i < 20; i++) {
      const probe = await call("nido:model-discard", { id: ID });
      if (probe.reason === "locked") {
        lockedDiscard = probe;
        break;
      }
      await sleep(250);
    }
    expect(lockedDiscard).toEqual({ ok: false, reason: "locked" });
    const dl = await call("nido:model-download", { id: ID });
    expect(dl).toEqual({ ok: false, reason: "locked" });

    // El hecho que la sonda midió al revés: tras el bloqueo, el
    // .part NO crece. Dos lecturas a 700 ms, idénticas.
    const g1 = partSize();
    expect(g1).toBeGreaterThanOrEqual(1_048_576);
    await sleep(700);
    expect(partSize()).toBe(g1);

    // La tarjeta, leída después de todo: pausa coherente con el
    // .part, sin final instalado.
    const list = await call("nido:models-list");
    expect(list.ok).toBe(true);
    const card = list.models?.find((m) => m.id === ID);
    expect(card?.transfer?.paused).toBe(true);
    expect(Math.abs((card?.transfer?.downloadedBytes ?? -1) - g1)).toBeLessThan(1_048_576);
    expect(card?.installed).toBe(false);
    expect(existsSync(finalPath())).toBe(false);
  }, 60_000);

  it("tras desbloquear, el descarte cobra y el .part desaparece con la tarjeta limpia", async () => {
    // Higiene de la escena, no de la conducta: en el mundo sin
    // curar la transferencia seguiría viva al llegar aquí, y la
    // pausa la asienta en cualquier mundo (en el curado ya se
    // asentó en el primer caso y esta llamada no toca nada).
    await call("nido:model-download-pause", { id: ID });
    await Promise.race([downloadReply.catch(() => null), sleep(15_000)]);
    const unlocked = await call("nido:vault-unlock", { password: "sonda-bloqueo-descarga" });
    expect(unlocked.ok).toBe(true);
    const discarded = await call("nido:model-discard", { id: ID });
    expect(discarded.ok).toBe(true);
    expect(existsSync(partPath())).toBe(false);
    const list = await call("nido:models-list");
    const card = list.models?.find((m) => m.id === ID);
    expect(card?.transfer ?? null).toBe(null);
  }, 60_000);
});
