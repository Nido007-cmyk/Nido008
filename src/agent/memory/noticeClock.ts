/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * noticeClock.ts — el reloj del ejecutor de E8 (AVISOS-ETAPA
 * §4 y E8-ARRANQUE paso 3): un solo `setTimeout` encadenado
 * contra el vencimiento más próximo de la agenda de disparo,
 * rearmado ante cualquier cambio (el gancho de noticeStore lo
 * llama por `recalculate`).
 *
 * - Tope de armado de 24 días: el desborde de 2³¹−1 ms
 *   (~24,8 días) haría disparar al momento un temporizador
 *   demasiado largo; al llegar el tope sin nada debido, el
 *   despertar es silencioso: recalcula y rearma.
 * - Salto de reloj: en cada despertar se compara lo que avanzó
 *   el reloj de pared con lo que avanzó el monótono desde el
 *   armado. Una diferencia mayor de 60 s (suspensión, hibernación
 *   o un cambio de hora del sistema) convierte el despertar en
 *   el mismo camino que un `powerMonitor resume`: la pasada
 *   completa antes de rearmar. El aviso al despertar lleva la
 *   deriva medida para que el camino la asiente si quiere.
 * - Invariante de T-5: hay como mucho un temporizador armado
 *   en todo momento; rearmar desarma primero el anterior.
 *
 * Las dependencias se inyectan enteras (relojes, temporizador,
 * lectura del próximo vencimiento y el camino de despertar):
 * la producción las sirve desde la agenda y el proceso
 * principal; la batería, desde un arnés falso que mueve los
 * dos relojes por separado.
 */

export const NOTICE_TIMER_CAP_MS = 24 * 24 * 3600 * 1000;
export const NOTICE_DRIFT_THRESHOLD_MS = 60 * 1000;

export interface NoticeClockDeps {
  now(): number;
  monotonic(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** El próximo vencimiento según la agenda, o null si no hay. */
  nextDueAt(): Promise<number | null>;
  /** El camino de despertar: pasada y recuperación. */
  onWake(info: { driftMs: number }): Promise<void>;
}

export class NoticeClock {
  private deps: NoticeClockDeps;
  private handle: unknown = null;
  private armedAtWall = 0;
  private armedAtMono = 0;
  private waking = false;
  private dirty = false;
  private stopped = true;

  constructor(deps: NoticeClockDeps) {
    this.deps = deps;
  }

  /** ¿Hay un temporizador armado ahora mismo? (La invariante de T-5.) */
  get armed(): boolean {
    return this.handle !== null;
  }

  start(): void {
    this.stopped = false;
    void this.recalculate();
  }

  stop(): void {
    this.stopped = true;
    this.disarm();
  }

  private disarm(): void {
    if (this.handle !== null) {
      this.deps.clearTimer(this.handle);
      this.handle = null;
    }
  }

  /**
   * Rearma contra el vencimiento más próximo. Es el punto al
   * que llama el gancho de la cola tras cada escritura y los
   * eventos de energía de la carcasa.
   */
  async recalculate(): Promise<void> {
    if (this.stopped) return;
    if (this.waking) {
      this.dirty = true;
      return;
    }
    this.disarm();
    const due = await this.deps.nextDueAt();
    if (this.stopped) return;
    if (due === null) return;
    const delay = due - this.deps.now();
    const armMs = delay <= 0 ? 0 : Math.min(delay, NOTICE_TIMER_CAP_MS);
    this.armedAtWall = this.deps.now();
    this.armedAtMono = this.deps.monotonic();
    this.handle = this.deps.setTimer(() => {
      this.handle = null;
      void this.wake();
    }, armMs);
  }

  private async wake(): Promise<void> {
    if (this.stopped) return;
    this.waking = true;
    const driftMs =
      this.deps.now() - this.armedAtWall - (this.deps.monotonic() - this.armedAtMono);
    try {
      await this.deps.onWake({ driftMs });
    } catch {
      // El camino de despertar asienta sus propios fallos; el
      // reloj sigue y rearma contra el siguiente vencimiento.
    }
    this.waking = false;
    this.dirty = false;
    if (!this.stopped) await this.recalculate();
  }
}
