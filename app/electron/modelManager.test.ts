/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * La batería del gestor de proceso (E4, paso 5): las pruebas
 * 14 a 17 de la hoja de la etapa (estudios/MODELOS-ETAPA.md
 * §5), con la 14 extendida por D-6, y la válvula M-02 con su
 * disparador firmado. Sin red, sin disco real y sin motor
 * nativo: las dependencias del gestor se inyectan.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_CATALOG, type CatalogEntry } from "./core/catalog.js";
import { DownloadPaused, type DownloadResult } from "./core/download.js";
import type { DiskState } from "./core/library.js";
import { LoadRefusal } from "./core/loadPath.js";
import { estimateWorkingSet, planDesktopContext } from "./core/ram.js";
import {
  ModelManager,
  RECYCLE_RESIDUE_BYTES,
  type EngineLike,
  type ModelManagerDeps,
} from "./modelManager.js";

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;
const entry = (id: string): CatalogEntry => DESKTOP_CATALOG.find((e) => e.id === id)!;
const installed = (id: string): DiskState => ({
  kind: "installed",
  bytes: entry(id).fileBytes,
  verified: true,
  source: "scan",
});

const tmp = await mkdtemp(path.join(os.tmpdir(), "nido-manager-"));
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

interface Harness {
  events: string[];
  censusState: Map<string, DiskState>;
  rssNow: number;
  downloadCalls: number;
  loadAttempts: { id: string; contextSize: number }[];
  deps: Partial<ModelManagerDeps>;
}

function harness(): Harness {
  const h: Harness = {
    events: [],
    censusState: new Map(),
    rssNow: 500 * MiB,
    downloadCalls: 0,
    loadAttempts: [],
    deps: {},
  };
  h.deps = {
    loadEngine: async (e, contextSize) => {
      h.loadAttempts.push({ id: e.id, contextSize });
      h.events.push(`load:${e.id}@${contextSize}`);
      const engine: EngineLike = {
        unload: async () => {
          h.events.push(`unload:${e.id}`);
        },
        countTokens: () => 0,
      };
      return engine;
    },
    download: async (e): Promise<DownloadResult> => {
      h.downloadCalls += 1;
      h.censusState.set(e.id, installed(e.id));
      return {
        file: `/models/${e.id}.gguf`,
        bytes: e.fileBytes,
        resumedFrom: 0,
        repairedCorruptFinal: false,
      };
    },
    discard: async (e) => {
      h.censusState.set(e.id, { kind: "absent" });
    },
    census: async () => new Map(h.censusState),
    snapshot: () => ({ totalRamBytes: 16 * GiB }),
    rssBytes: () => h.rssNow,
  };
  return h;
}

const A = "qwen3-0.6b-q4km";
const B = "qwen3-1.7b-q4km";

describe("paso 5 · el gestor de proceso", () => {
  it("prueba 14 · la cola es serial: la segunda activación carga tras descargar al residente anterior", async () => {
    const h = harness();
    h.censusState.set(A, installed(A));
    h.censusState.set(B, installed(B));
    const manager = await ModelManager.open(tmp, h.deps);
    const first = manager.activate(A);
    const second = manager.activate(B);
    await Promise.all([first, second]);
    const loads = h.events.filter((e) => e.startsWith("load:"));
    expect(loads).toHaveLength(2);
    expect(h.events.indexOf(`unload:${A}`)).toBeGreaterThan(h.events.indexOf(loads[0]));
    expect(h.events.indexOf(loads[1])).toBeGreaterThan(h.events.indexOf(`unload:${A}`));
    expect(manager.residentId()).toBe(B);
  });

  it("prueba 14 extendida (D-6) · el mismo id encolado dos veces es una sola transferencia", async () => {
    const h = harness();
    const manager = await ModelManager.open(tmp, h.deps);
    const [r1, r2] = await Promise.all([manager.download(A), manager.download(A)]);
    expect(h.downloadCalls).toBe(1);
    expect(r1).toBe(r2);
  });

  it("prueba 15 · los disparadores de refresco: tras descargar, tras descartar y tras un borrado externo", async () => {
    const h = harness();
    const manager = await ModelManager.open(tmp, h.deps);
    const cardOf = (id: string) => manager.cards().find((c) => c.entry.id === id)!;
    expect(cardOf(A).state).toBe("not-downloaded");
    await manager.download(A);
    expect(cardOf(A).state).toBe("on-disk");
    await manager.discard(A);
    expect(cardOf(A).state).toBe("not-downloaded");
    // Borrado externo: el hecho cambia fuera y el refresco lo cobra.
    await manager.download(A);
    expect(cardOf(A).state).toBe("on-disk");
    h.censusState.set(A, { kind: "absent" });
    await manager.refresh();
    expect(cardOf(A).state).toBe("not-downloaded");
  });

  it("prueba 16 · la carga que falla reintenta una vez en el peldaño inferior; el doble fallo deja error con causa", async () => {
    const h = harness();
    h.censusState.set(B, installed(B));
    let failuresLeft = 1;
    h.deps.loadEngine = async (e, contextSize) => {
      h.loadAttempts.push({ id: e.id, contextSize });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("context creation failed");
      }
      return { unload: async () => undefined, countTokens: () => 0 };
    };
    const manager = await ModelManager.open(tmp, h.deps);
    await manager.activate(B);
    expect(h.loadAttempts).toHaveLength(2);
    expect(h.loadAttempts[1].contextSize).toBeLessThan(h.loadAttempts[0].contextSize);
    expect(manager.residentId()).toBe(B);
    expect(manager.errorFor(B)).toBeNull();

    const h2 = harness();
    h2.censusState.set(B, installed(B));
    h2.deps.loadEngine = async (e, contextSize) => {
      h2.loadAttempts.push({ id: e.id, contextSize });
      throw new Error("siempre falla");
    };
    const manager2 = await ModelManager.open(tmp, h2.deps);
    await expect(manager2.activate(B)).rejects.toThrow();
    expect(h2.loadAttempts).toHaveLength(2);
    expect(manager2.errorFor(B)?.kind).toBe("engine");
    expect(manager2.residentId()).toBeNull();
  });

  it("prueba 16 (huella) · un modelo que no cabe en ningún peldaño da error de huella sin intentar la carga", async () => {
    const h = harness();
    const big = "qwen3-32b-q4km";
    h.censusState.set(big, installed(big));
    h.deps.snapshot = () => ({ totalRamBytes: 8 * GiB });
    const manager = await ModelManager.open(tmp, h.deps);
    await expect(manager.activate(big)).rejects.toThrow();
    expect(manager.errorFor(big)?.kind).toBe("footprint");
    expect(h.loadAttempts).toHaveLength(0);
  });

  it("prueba 17 · el mapa de errores: red e integridad son causas distintas y no se mezclan", async () => {
    const h = harness();
    h.deps.download = async () => {
      throw new TypeError("fetch failed");
    };
    const manager = await ModelManager.open(tmp, h.deps);
    await expect(manager.download(A)).rejects.toBeInstanceOf(TypeError);
    expect(manager.errorFor(A)?.kind).toBe("network");

    const h2 = harness();
    h2.deps.download = async () => {
      throw new LoadRefusal("refused: sha256 mismatch. Nothing was loaded.");
    };
    const manager2 = await ModelManager.open(tmp, h2.deps);
    await expect(manager2.download(A)).rejects.toBeInstanceOf(LoadRefusal);
    expect(manager2.errorFor(A)?.kind).toBe("integrity");
  });

  it("prueba 18 · la pausa deja la transferencia pausada con los bytes contados hasta el corte, sin error", async () => {
    const h = harness();
    h.deps.download = async (e, opts) => {
      opts.onProgress?.(123_456, e.fileBytes);
      await new Promise<void>((resolve) => {
        if (opts.signal?.aborted) return resolve();
        opts.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new DownloadPaused(e.id);
    };
    const manager = await ModelManager.open(tmp, h.deps);
    const pending = manager.download(A);
    // La pausa llega con la transferencia ya viva y con progreso.
    await new Promise((r) => setTimeout(r, 10));
    manager.pauseDownload(A);
    await expect(pending).rejects.toBeInstanceOf(DownloadPaused);
    const card = manager.cards().find((c) => c.entry.id === A);
    expect(card?.state).toBe("paused");
    expect(card?.transfer?.downloadedBytes).toBe(123_456);
    expect(card?.transfer?.paused).toBe(true);
    expect(manager.errorFor(A)).toBeNull();
  });

  it("la válvula M-02 · con 4 cambios y el residuo sobre el disparador, la siguiente activación recicla", async () => {
    const h = harness();
    const ids = [A, B, "qwen2.5-1.5b-instruct-q4km", "qwen3-4b-instruct-2507-q4km", "qwen2.5-7b-instruct-q4km"];
    for (const id of ids) h.censusState.set(id, installed(id));
    const manager = await ModelManager.open(tmp, h.deps);
    for (const id of ids.slice(0, 4)) await manager.activate(id);
    expect(manager.recycleInfo().switches).toBe(4);
    expect(manager.recycleInfo().recycledCount).toBe(0);
    // Sin residuo sobre el disparador, la quinta activación no recicla.
    h.rssNow += RECYCLE_RESIDUE_BYTES + 64 * MiB;
    await manager.activate(ids[4]);
    expect(manager.recycleInfo().recycledCount).toBe(1);
    expect(manager.recycleInfo().switches).toBe(1);
    expect(manager.residentId()).toBe(ids[4]);
  });

  it("M-02-P · al reciclar, la dependencia onRecycle recibe la lectura anterior a la re-medición de la base", async () => {
    const h = harness();
    const calls: { coldBaseRssBytes: number; residueBytes: number; switches: number; recycledCount: number }[] = [];
    h.deps = { ...h.deps, onRecycle: (info) => { calls.push(info); } };
    const ids = [A, B, "qwen2.5-1.5b-instruct-q4km", "qwen3-4b-instruct-2507-q4km", "qwen2.5-7b-instruct-q4km"];
    for (const id of ids) h.censusState.set(id, installed(id));
    const manager = await ModelManager.open(tmp, h.deps);
    // 4 cambios sin residuo sobre el disparador: ninguna llamada.
    for (const id of ids.slice(0, 4)) await manager.activate(id);
    expect(calls).toHaveLength(0);
    // Al sumar el residuo y activar, la válvula dispara y la
    // lectura asentada es la de ANTES de re-medir la base, con el
    // contador ya sumado.
    h.rssNow += RECYCLE_RESIDUE_BYTES + 64 * MiB;
    await manager.activate(ids[4]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      coldBaseRssBytes: 500 * MiB,
      residueBytes: RECYCLE_RESIDUE_BYTES + 64 * MiB,
      switches: 4,
      recycledCount: 1,
    });
  });

  it("M-02-P · sin la dependencia cableada, el recorrido de la válvula es el de hoy y no rompe nada", async () => {
    const h = harness();
    const ids = [A, B, "qwen2.5-1.5b-instruct-q4km", "qwen3-4b-instruct-2507-q4km", "qwen2.5-7b-instruct-q4km"];
    for (const id of ids) h.censusState.set(id, installed(id));
    const manager = await ModelManager.open(tmp, h.deps);
    for (const id of ids.slice(0, 4)) await manager.activate(id);
    h.rssNow += RECYCLE_RESIDUE_BYTES + 64 * MiB;
    await manager.activate(ids[4]);
    expect(manager.recycleInfo().recycledCount).toBe(1);
    expect(manager.residentId()).toBe(ids[4]);
  });

  it("M-02-P · una segunda acumulación que vuelve a cumplir las dos condiciones asienta una segunda lectura", async () => {
    const h = harness();
    const calls: { coldBaseRssBytes: number; residueBytes: number; switches: number; recycledCount: number }[] = [];
    h.deps = { ...h.deps, onRecycle: (info) => { calls.push(info); } };
    h.censusState.set(A, installed(A));
    h.censusState.set(B, installed(B));
    const manager = await ModelManager.open(tmp, h.deps);
    await manager.activate(A);
    await manager.activate(B);
    await manager.activate(A);
    await manager.activate(B);
    h.rssNow += RECYCLE_RESIDUE_BYTES + 64 * MiB;
    await manager.activate(A);
    expect(calls).toHaveLength(1);
    expect(calls[0].recycledCount).toBe(1);
    // La base ya se re-midio: la segunda acumulacion se mide
    // contra ella y produce su propia lectura.
    await manager.activate(B);
    await manager.activate(A);
    await manager.activate(B);
    h.rssNow += RECYCLE_RESIDUE_BYTES + 64 * MiB;
    await manager.activate(A);
    expect(calls).toHaveLength(2);
    expect(calls[1].recycledCount).toBe(2);
    expect(calls[1].residueBytes).toBe(RECYCLE_RESIDUE_BYTES + 64 * MiB);
  });

  it("§6 (guarda) · deactivate descarga por el gestor: el libro queda sin residente y la siguiente activación se juzga sin crédito", async () => {
    const h = harness();
    // El asiento de la observación del crédito, fijado en la
    // apertura de la cura (§0.5.4 de su orden): la foto de serie
    // del arnés no trae libre, y sin libre el liberable nunca
    // entra en el presupuesto (availableBudgetBytes solo lo suma
    // con la foto completa), así que el crédito no movería
    // ningún plan. Con la foto ajustada (libre definido, y el
    // presupuesto por el total, ≈12,55 GiB, sin recortar), el
    // crédito se cobra por las dos sedes: el plan de la tarjeta
    // y el contexto de la activación.
    const FREE = 4 * GiB;
    h.deps.snapshot = () => ({ totalRamBytes: 16 * GiB, freeRamBytes: FREE });
    h.censusState.set(A, installed(A));
    h.censusState.set(B, installed(B));
    const manager = await ModelManager.open(tmp, h.deps);
    await manager.activate(A);
    expect(manager.residentId()).toBe(A);
    const ctxA = h.loadAttempts.find((a) => a.id === A)!.contextSize;
    const footprintA = estimateWorkingSet(entry(A), ctxA).totalBytes;
    const cardB = () => manager.cards().find((c) => c.entry.id === B)!;
    // Con A residente, el plan de la tarjeta de B se juzga con
    // la huella de A como liberable: el crédito, cobrado al byte.
    expect(cardB().plan?.budgetBytes).toBe(FREE + footprintA);
    await manager.deactivate();
    // La descarga por el gestor: el evento de descarga tras el
    // de carga, el libro sin residente y ninguna tarjeta activa.
    expect(manager.residentId()).toBeNull();
    expect(h.events.indexOf(`unload:${A}`)).toBeGreaterThan(h.events.indexOf(`load:${A}@${ctxA}`));
    expect(manager.cards().some((c) => c.state === "active")).toBe(false);
    // Sin residente, el libro queda sin crédito: el plan de la
    // tarjeta cae al libre a secas.
    expect(cardB().plan?.budgetBytes).toBe(FREE);
    // Y la activación siguiente se juzga con esa misma foto sin
    // crédito: su contexto es el del plan sin liberable,
    // calculado por la función pura sobre la misma foto.
    await manager.activate(B);
    const sinCredito = planDesktopContext(entry(B), {
      totalRamBytes: 16 * GiB,
      freeRamBytes: FREE,
    });
    expect(sinCredito).not.toBeNull();
    expect(h.loadAttempts.find((a) => a.id === B)?.contextSize).toBe(sinCredito!.contextSize);
  });

  it("§6 · la compuerta de arranque: la descarga encolada tras la pausa se asienta pausada sin transferir, y una petición nueva la desarma", async () => {
    const h = harness();
    h.censusState.set(A, installed(A));
    // La activación que ocupa la cola se retiene con una
    // promesa manual del arnés: la descarga de B queda encolada
    // detrás, sin arrancar (sin controlador que pausar), cuando
    // la pausa del bloqueo llega.
    let releaseLoad!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    h.deps.loadEngine = async (e, contextSize) => {
      h.loadAttempts.push({ id: e.id, contextSize });
      h.events.push(`load:${e.id}@${contextSize}`);
      await held;
      return {
        unload: async () => {
          h.events.push(`unload:${e.id}`);
        },
        countTokens: () => 0,
      };
    };
    const manager = await ModelManager.open(tmp, h.deps);
    const activation = manager.activate(A);
    const download = manager.download(B);
    // La pausa, con la descarga aún encolada tras la activación.
    manager.pauseAllDownloads();
    releaseLoad();
    await activation;
    const settled = await download.then(
      () => null,
      (err: unknown) => err,
    );
    // Sin transferir: la transferencia ni se invocó, la promesa
    // se asienta con DownloadPaused y la tarjeta lee la pausa
    // con 0 bytes, la forma de una pausa real a los 0 bytes.
    expect(h.downloadCalls).toBe(0);
    expect(settled).toBeInstanceOf(DownloadPaused);
    const paused = manager.cards().find((c) => c.entry.id === B);
    expect(paused?.state).toBe("paused");
    expect(paused?.transfer?.downloadedBytes).toBe(0);
    expect(paused?.transfer?.paused).toBe(true);
    // Una petición nueva desarma la compuerta y la descarga corre.
    await manager.download(B);
    expect(h.downloadCalls).toBe(1);
    expect(manager.cards().find((c) => c.entry.id === B)?.state).toBe("on-disk");
  });
});
