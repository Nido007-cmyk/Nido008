/**
 * dpapiCustody.ts — el proveedor `dpapi` (E2, paso 6).
 *
 * En Windows, la custodia fuerte accesible desde Electron es
 * `safeStorage`, que por debajo usa DPAPI: la DEK se envuelve con una
 * clave atada a la cuenta del sistema operativo. Aquí el proveedor se
 * construye contra una interfaz mínima (`SafeStorageLike`) para
 * probarlo entero contra un doble en esta máquina; el objeto real de
 * Electron se inyecta en la carcasa (E1/E12) sin cambiar esta pieza.
 *
 * C-2 (la trampa cazada en el diseño): si `safeStorage` reporta cifrado
 * básico — en Linux, el backend `basic_text` guarda la clave en claro
 * en el disco — el proveedor se declara NO disponible y la escalera
 * baja a contraseña. Declarar «dpapi» con cifrado básico sería mentir
 * sobre el nivel de custodia, y el nivel declarado es el que Ajustes
 * enseña.
 *
 * DECLARADO, NO EJECUTADO: el DPAPI real (Windows) no ha corrido en
 * esta máquina; lo probado aquí es el contrato entero contra el doble,
 * incluido el fallo. La pierna real vive en E12 (P-6).
 */

import {
  type KeyCustodyProvider,
  type VaultStatus,
  type WrappedBlob,
  DEK_BYTES,
  VaultError,
  VaultUnlockError,
} from "./keyVault.js";

/** La superficie de Electron `safeStorage` que esta pieza consume. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  /** Solo existe en Linux; en Windows/macOS puede no estar. */
  getSelectedStorageBackend?: () => string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class DpapiCustodyProvider implements KeyCustodyProvider {
  readonly id = "dpapi" as const;
  readonly #safeStorage: SafeStorageLike | null;

  constructor(safeStorage: SafeStorageLike | null) {
    this.#safeStorage = safeStorage;
  }

  async available(): Promise<boolean> {
    if (!this.#safeStorage) return false;
    try {
      if (!this.#safeStorage.isEncryptionAvailable()) return false;
      // C-2: cifrado básico = la clave quedaría en claro: no es custodia.
      const backend = this.#safeStorage.getSelectedStorageBackend?.();
      if (backend === "basic_text") return false;
      return true;
    } catch {
      return false;
    }
  }

  async wrap(dek: Buffer): Promise<WrappedBlob> {
    if (dek.length !== DEK_BYTES) throw new VaultError(`la DEK debe ser de ${DEK_BYTES} bytes`);
    if (!(await this.available())) {
      throw new VaultError("safeStorage no ofrece custodia real en este sistema (proveedor dpapi no disponible)");
    }
    const encrypted = this.#safeStorage!.encryptString(dek.toString("base64"));
    return {
      version: 1,
      provider: "dpapi",
      createdAt: new Date().toISOString(),
      wrapped: encrypted.toString("base64"),
    };
  }

  async unwrap(blob: WrappedBlob): Promise<Buffer> {
    if (blob.provider !== "dpapi") throw new VaultUnlockError("el blob no es una envoltura del proveedor dpapi");
    if (!(await this.available())) {
      throw new VaultUnlockError("safeStorage no ofrece custodia real en este sistema: no se desenvuelve");
    }
    try {
      const plain = this.#safeStorage!.decryptString(Buffer.from(blob.wrapped, "base64"));
      const dek = Buffer.from(plain, "base64");
      if (dek.length !== DEK_BYTES) throw new VaultUnlockError("la DEK desenvuelta tiene un tamaño inválido");
      return dek;
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultUnlockError("safeStorage no pudo desenvolver la DEK (¿otra cuenta de sistema?)");
    }
  }
}

/**
 * Las frases honestas de cada nivel de custodia, para Ajustes. El nivel
 * declarado es siempre el real: DPAPI jamás se etiqueta como TPM, y la
 * contraseña se dice como lo que es.
 */
export function custodyLevelLabel(status: VaultStatus): string {
  const base =
    status.level === "tpm"
      ? "Protegida por el chip TPM de este PC"
      : status.level === "dpapi"
        ? "Protegida por la custodia del sistema operativo (DPAPI)"
        : "Protegida solo por tu contraseña";
  return status.hello ? `${base} · Windows Hello actuó como puerta en este desbloqueo` : base;
}
