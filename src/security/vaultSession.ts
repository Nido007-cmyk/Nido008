/**
 * vaultSession.ts — el ciclo de vida de la DEK desbloqueada (E2, §3.5).
 *
 * La DEK vive en claro solo en memoria del proceso principal y solo
 * mientras la bóveda está desbloqueada. Al bloquear (a petición o por
 * inactividad), el buffer se sobrescribe con ceros y la referencia se
 * suelta: quien pida la DEK con la bóveda cerrada recibe
 * VaultLockedError, nunca una copia vieja. El estado declarado
 * (`vaultStatus`) dice el nivel real de custodia y si Hello actuó de
 * puerta, para que Ajustes lo enseñe con su frase honesta.
 */

import {
  type KeyCustodyProvider,
  type VaultStatus,
  unlockVaultWith,
  vaultStatusFor,
} from "./keyVault.js";

export class VaultLockedError extends Error {
  constructor(message = "la bóveda está bloqueada: hay que autenticarse otra vez") {
    super(message);
    this.name = "VaultLockedError";
  }
}

export interface VaultSessionOptions {
  /** Bloqueo por inactividad en ms; `null` = sin bloqueo automático. */
  idleTimeoutMs?: number | null;
  /** Hello actuó como puerta de este desbloqueo (se declara, no cifra). */
  hello?: boolean;
}

export class VaultSession {
  #dek: Buffer | null;
  readonly status: VaultStatus;
  #idleTimeoutMs: number | null;
  #idleTimer: NodeJS.Timeout | null = null;
  #lockListeners = new Set<() => void>();

  private constructor(dek: Buffer, status: VaultStatus, idleTimeoutMs: number | null) {
    this.#dek = dek;
    this.status = status;
    this.#idleTimeoutMs = idleTimeoutMs;
    this.#armIdleTimer();
  }

  /** Desbloquea la bóveda del directorio con los proveedores candidatos. */
  static async unlock(
    dir: string,
    providers: readonly KeyCustodyProvider[],
    opts?: VaultSessionOptions,
  ): Promise<VaultSession> {
    const { dek, provider } = await unlockVaultWith(dir, providers);
    return new VaultSession(dek, vaultStatusFor(provider, opts?.hello ?? false), opts?.idleTimeoutMs ?? null);
  }

  get locked(): boolean {
    return this.#dek === null;
  }

  /**
   * La DEK en claro, solo con la bóveda abierta. Cada acceso cuenta como
   * actividad y rearma el bloqueo por inactividad. El llamador no debe
   * guardar el buffer más allá del uso inmediato: al bloquear se pone a
   * ceros, incluido para quien lo estuviera mirando.
   */
  get dek(): Buffer {
    if (!this.#dek) throw new VaultLockedError();
    this.touch();
    return this.#dek;
  }

  /** Registra actividad y rearma el temporizador de inactividad. */
  touch(): void {
    this.#armIdleTimer();
  }

  setIdleTimeoutMs(ms: number | null): void {
    this.#idleTimeoutMs = ms;
    this.#armIdleTimer();
  }

  /**
   * Adopta una DEK nueva (rotación completada): la anterior se pone a
   * ceros antes de soltarla. Con la bóveda bloqueada, lanza.
   */
  adoptDek(newDek: Buffer): void {
    if (!this.#dek) throw new VaultLockedError();
    if (newDek.length !== 32) throw new VaultLockedError("la DEK nueva debe ser de 32 bytes");
    this.#dek.fill(0);
    this.#dek = Buffer.from(newDek);
    this.touch();
  }

  /** Suscripción al bloqueo (para cerrar handles y limpiar la interfaz). */
  onLock(listener: () => void): () => void {
    this.#lockListeners.add(listener);
    return () => this.#lockListeners.delete(listener);
  }

  /** Bloquea: DEK a ceros, referencia soltada, temporizador fuera. */
  lock(): void {
    if (!this.#dek) return;
    this.#dek.fill(0);
    this.#dek = null;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    for (const listener of this.#lockListeners) listener();
  }

  #armIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    if (this.#idleTimeoutMs !== null && this.#dek) {
      this.#idleTimer = setTimeout(() => this.lock(), this.#idleTimeoutMs);
      this.#idleTimer.unref?.();
    }
  }
}
