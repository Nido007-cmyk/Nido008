/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 3 de E8: el reloj del ejecutor contra un
 * arnés falso que mueve el reloj de pared y el monótono por
 * separado. Puerta: T-5 (un solo temporizador armado en todo
 * momento), T-6 (vencimiento a más de 24,8 días: armado al
 * tope y despertar silencioso) y T-7 (salto de reloj simulado:
 * la deriva pared contra monótono convierte el despertar en
 * pasada completa antes de rearmar).
 */

import { describe, expect, it } from "vitest";
import {
  NOTICE_TIMER_CAP_MS,
  NoticeClock,
  type NoticeClockDeps,
} from "./noticeClock.js";

const H = 3600 * 1000;
const D = 24 * H;

interface FakeTimer {
  fn: () => void;
  ms: number;
  live: boolean;
}

class Harness implements NoticeClockDeps {
  wall = 1_800_000_000_000;
  mono = 500_000_000;
  timers: FakeTimer[] = [];
  dueAt: number | null = null;
  wakes: Array<{ driftMs: number }> = [];
  order: string[] = [];

  now(): number {
    return this.wall;
  }
  monotonic(): number {
    return this.mono;
  }
  setTimer(fn: () => void, ms: number): unknown {
    const t: FakeTimer = { fn, ms, live: true };
    this.timers.push(t);
    this.order.push(`arm:${ms}`);
    return t;
  }
  clearTimer(handle: unknown): void {
    (handle as FakeTimer).live = false;
    this.order.push("clear");
  }
  async nextDueAt(): Promise<number | null> {
    return this.dueAt;
  }
  async onWake(info: { driftMs: number }): Promise<void> {
    this.wakes.push(info);
    this.order.push("wake");
  }
  liveCount(): number {
    return this.timers.filter((t) => t.live).length;
  }
  lastArmedMs(): number {
    const live = this.timers.filter((t) => t.live);
    return live[live.length - 1].ms;
  }
  /** Avanza los dos relojes y dispara el temporizador vivo. */
  fire(elapsedWall: number, elapsedMono: number): void {
    this.wall += elapsedWall;
    this.mono += elapsedMono;
    const t = this.timers.find((x) => x.live);
    if (!t) throw new Error("sin temporizador vivo que disparar");
    t.live = false;
    t.fn();
  }
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

describe("E8 paso 3 · el reloj del ejecutor", () => {
  it("T-5 · un solo temporizador armado en todo momento, también tras rearmar y al parar", async () => {
    const h = new Harness();
    h.dueAt = h.wall + H;
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    expect(h.liveCount()).toBe(1);
    expect(h.lastArmedMs()).toBe(H);
    await clock.recalculate();
    await clock.recalculate();
    expect(h.liveCount()).toBe(1);
    expect(clock.armed).toBe(true);
    clock.stop();
    expect(h.liveCount()).toBe(0);
    expect(clock.armed).toBe(false);
  });

  it("sin vencimientos no se arma nada; al aparecer uno, el aviso rearma", async () => {
    const h = new Harness();
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    expect(h.liveCount()).toBe(0);
    h.dueAt = h.wall + 30 * 60 * 1000;
    await clock.recalculate();
    expect(h.liveCount()).toBe(1);
    expect(h.lastArmedMs()).toBe(30 * 60 * 1000);
    clock.stop();
  });

  it("un vencimiento ya pasado arma a cero y despierta al momento", async () => {
    const h = new Harness();
    h.dueAt = h.wall - 1000;
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    expect(h.lastArmedMs()).toBe(0);
    h.fire(0, 0);
    await flush();
    expect(h.wakes).toHaveLength(1);
    clock.stop();
  });

  it("T-6 · un vencimiento a 40 días se arma al tope de 24 y el despertar silencioso recalcula y rearma sin pasar nada por alto", async () => {
    const h = new Harness();
    h.dueAt = h.wall + 40 * D;
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    expect(h.lastArmedMs()).toBe(NOTICE_TIMER_CAP_MS);
    expect(NOTICE_TIMER_CAP_MS).toBeLessThan(2 ** 31 - 1);
    // Llega el tope: ni pared ni monótono se desvían, y el
    // vencimiento sigue a 16 días: rearmado por el resto.
    h.fire(NOTICE_TIMER_CAP_MS, NOTICE_TIMER_CAP_MS);
    // El arnés movió la pared al disparar; el vencimiento real
    // queda a 40d − 24d = 16d desde la nueva pared.
    h.dueAt = h.wall + 16 * D;
    await flush();
    expect(h.wakes).toHaveLength(1);
    expect(Math.abs(h.wakes[0].driftMs)).toBeLessThan(60 * 1000);
    expect(h.liveCount()).toBe(1);
    expect(h.lastArmedMs()).toBe(16 * D);
    clock.stop();
  });

  it("T-7 · salto de reloj hacia delante (suspensión): la deriva llega al despertar y la pasada va antes del rearme", async () => {
    const h = new Harness();
    h.dueAt = h.wall + 30 * 60 * 1000;
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    // La máquina se suspende: la pared avanza 2 h, el monótono
    // solo los 30 min del temporizador.
    h.dueAt = null; // al volver, la pasada ya lo presentó todo
    h.fire(2 * H, 30 * 60 * 1000);
    await flush();
    expect(h.wakes).toHaveLength(1);
    expect(h.wakes[0].driftMs).toBe(2 * H - 30 * 60 * 1000);
    expect(h.wakes[0].driftMs).toBeGreaterThan(60 * 1000);
    expect(h.order.indexOf("wake")).toBeGreaterThanOrEqual(0);
    // Sin vencimientos tras la pasada: no hay ningún rearme
    // después del despertar (solo el armado inicial).
    expect(h.order.filter((o) => o.startsWith("arm:"))).toHaveLength(1);
    expect(h.liveCount()).toBe(0);
    clock.stop();
  });

  it("T-7 · salto hacia atrás: la deriva negativa también se entrega y el reloj rearma contra el vencimiento real", async () => {
    const h = new Harness();
    h.dueAt = h.wall + 30 * 60 * 1000;
    const clock = new NoticeClock(h);
    clock.start();
    await flush();
    // El sistema corrige su hora hacia atrás 1 h mientras el
    // temporizador cumple sus 30 min monótonos.
    h.fire(-H, 30 * 60 * 1000);
    await flush();
    expect(h.wakes).toHaveLength(1);
    expect(h.wakes[0].driftMs).toBe(-H - 30 * 60 * 1000);
    // El vencimiento sigue en el futuro de la nueva pared:
    // queda a 30 min + 1 h desde ahora.
    expect(h.liveCount()).toBe(1);
    expect(h.lastArmedMs()).toBe(30 * 60 * 1000 + H);
    clock.stop();
  });
});
