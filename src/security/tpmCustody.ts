/**
 * tpmCustody.ts — el proveedor `tpm` (E2, paso 7).
 *
 * El nivel más alto de la escalera: la DEK se sella contra el TPM 2.0
 * del PC (NCrypt con clave atada a la plataforma), de modo que el blob
 * no desenvuelve fuera de esta máquina. El binding nativo (módulo
 * N-API contra NCrypt) es código de Windows real: NO existe en esta
 * casa y NO ha corrido aquí. Esta pieza define el contrato entero y se
 * prueba contra un doble; el cargador del binding falla cerrado
 * (`available()` → false, la escalera baja) mientras el módulo no esté,
 * que es exactamente el comportamiento sellado para cualquier PC sin
 * TPM usable.
 *
 * DECLARADO, NO EJECUTADO: TPM/CNG real queda para la pierna de
 * Windows (E12, P-6, partidas W-01/W-02 del plan).
 */

import {
  type KeyCustodyProvider,
  type WrappedBlob,
  DEK_BYTES,
  VaultError,
  VaultUnlockError,
} from "./keyVault.js";

/** El contrato del binding nativo contra NCrypt/TPM. */
export interface TpmBindingLike {
  isTpmAvailable(): boolean;
  /** Sella la DEK (en base64) contra el TPM; devuelve el blob sellado en base64. */
  sealKey(dekBase64: string): string;
  /** Desella; lanza si el sello no verifica en esta máquina. */
  unsealKey(sealedBase64: string): string;
}

export type TpmBindingLoader = () => TpmBindingLike | null;

/**
 * El cargador por defecto: el módulo nativo no forma parte de esta
 * casa (es de Windows real, E12). Devuelve null y el proveedor se
 * declara no disponible: fail-closed, sin excepciones raras.
 */
const defaultLoader: TpmBindingLoader = () => null;

export class TpmCustodyProvider implements KeyCustodyProvider {
  readonly id = "tpm" as const;
  readonly #loader: TpmBindingLoader;
  #binding: TpmBindingLike | null | undefined; // undefined = aún no intentado

  constructor(loader: TpmBindingLoader = defaultLoader) {
    this.#loader = loader;
  }

  #get(): TpmBindingLike | null {
    if (this.#binding === undefined) {
      try {
        this.#binding = this.#loader();
      } catch {
        this.#binding = null; // El binding no cargó: no disponible, sin ruido.
      }
    }
    return this.#binding;
  }

  async available(): Promise<boolean> {
    const binding = this.#get();
    if (!binding) return false;
    try {
      return binding.isTpmAvailable();
    } catch {
      return false;
    }
  }

  async wrap(dek: Buffer): Promise<WrappedBlob> {
    if (dek.length !== DEK_BYTES) throw new VaultError(`la DEK debe ser de ${DEK_BYTES} bytes`);
    const binding = this.#get();
    if (!binding || !(await this.available())) {
      throw new VaultError("el TPM no está disponible en este PC (proveedor tpm no disponible)");
    }
    return {
      version: 1,
      provider: "tpm",
      createdAt: new Date().toISOString(),
      wrapped: binding.sealKey(dek.toString("base64")),
    };
  }

  async unwrap(blob: WrappedBlob): Promise<Buffer> {
    if (blob.provider !== "tpm") throw new VaultUnlockError("el blob no es una envoltura del proveedor tpm");
    const binding = this.#get();
    if (!binding || !(await this.available())) {
      throw new VaultUnlockError("el TPM no está disponible en este PC: no se desenvuelve");
    }
    try {
      const dek = Buffer.from(binding.unsealKey(blob.wrapped), "base64");
      if (dek.length !== DEK_BYTES) throw new VaultUnlockError("la DEK desellada tiene un tamaño inválido");
      return dek;
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultUnlockError("el TPM no deselló la DEK (¿otro PC o sello manipulado?)");
    }
  }
}
