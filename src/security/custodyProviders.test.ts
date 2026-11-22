/**
 * Batería de los pasos 6 y 7 de E2 (proveedores dpapi y tpm contra
 * dobles): C-1/C-2 en su forma de contrato. Lo real de Windows (DPAPI
 * vía safeStorage, TPM/CNG, Hello) queda DECLARADO, no ejecutado: aquí
 * corre el contrato entero, incluido el fallo, contra dobles que lo
 * reproducen.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DpapiCustodyProvider, type SafeStorageLike, custodyLevelLabel } from "./dpapiCustody.js";
import {
  PasswordCustodyProvider,
  VaultUnlockError,
  initializeVault,
  selectCustodyProvider,
  unlockVaultWith,
  vaultStatusFor,
} from "./keyVault.js";
import { TpmCustodyProvider, type TpmBindingLike } from "./tpmCustody.js";

/** Doble honesto de safeStorage: «cifra» con prefijo y deshace; sin prefijo, lanza. */
function fakeSafeStorage(opts?: { backend?: string; available?: boolean }): SafeStorageLike {
  return {
    isEncryptionAvailable: () => opts?.available ?? true,
    ...(opts?.backend !== undefined
      ? { getSelectedStorageBackend: () => opts.backend as string }
      : {}),
    encryptString: (plain) => Buffer.from(`FAKE-DPAPI:${plain}`, "utf8"),
    decryptString: (buf) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("FAKE-DPAPI:")) throw new Error("no se pudo descifrar");
      return s.slice("FAKE-DPAPI:".length);
    },
  };
}

/** Doble del binding TPM: sella con prefijo atado a «esta máquina». */
function fakeTpmBinding(opts?: { tpm?: boolean; unsealFails?: boolean }): TpmBindingLike {
  return {
    isTpmAvailable: () => opts?.tpm ?? true,
    sealKey: (dekB64) => Buffer.from(`FAKE-TPM:${dekB64}`, "utf8").toString("base64"),
    unsealKey: (sealed) => {
      if (opts?.unsealFails) throw new Error("el sello no verifica en esta máquina");
      const s = Buffer.from(sealed, "base64").toString("utf8");
      if (!s.startsWith("FAKE-TPM:")) throw new Error("el sello no verifica en esta máquina");
      return s.slice("FAKE-TPM:".length);
    },
  };
}

const dek = randomBytes(32);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-custody-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("C-2 · dpapi contra doble de safeStorage", () => {
  it("con cifrado real disponible, envuelve y desenvuelve la DEK entera", async () => {
    const provider = new DpapiCustodyProvider(fakeSafeStorage());
    expect(await provider.available()).toBe(true);
    const blob = await provider.wrap(dek);
    expect(blob.provider).toBe("dpapi");
    expect(Buffer.from(blob.wrapped, "base64").indexOf(dek)).toBe(-1);
    expect((await provider.unwrap(blob)).equals(dek)).toBe(true);
  });

  it("con el backend basic_text (la clave quedaría en claro) se declara NO disponible", async () => {
    const provider = new DpapiCustodyProvider(fakeSafeStorage({ backend: "basic_text" }));
    expect(await provider.available()).toBe(false);
    await expect(provider.wrap(dek)).rejects.toThrow();
  });

  it("con un backend de llavero real (gnome_libsecret) sí está disponible; sin safeStorage o sin cifrado, no", async () => {
    expect(await new DpapiCustodyProvider(fakeSafeStorage({ backend: "gnome_libsecret" })).available()).toBe(true);
    expect(await new DpapiCustodyProvider(null).available()).toBe(false);
    expect(await new DpapiCustodyProvider(fakeSafeStorage({ available: false })).available()).toBe(false);
  });

  it("la escalera con dpapi en basic_text baja a contraseña y lo DECLARA contraseña, jamás dpapi", async () => {
    const chosen = await selectCustodyProvider([
      new DpapiCustodyProvider(fakeSafeStorage({ backend: "basic_text" })),
      new PasswordCustodyProvider("contrasena-de-prueba"),
    ]);
    expect(chosen.id).toBe("contrasena");
    expect(vaultStatusFor(chosen).level).toBe("contrasena");
    expect(custodyLevelLabel(vaultStatusFor(chosen))).toContain("solo por tu contraseña");
  });

  it("la bóveda entera funciona con el proveedor dpapi (initialize + unlock)", async () => {
    const provider = new DpapiCustodyProvider(fakeSafeStorage());
    const { dek: creada } = await initializeVault(dir, provider);
    const { dek: abierta, provider: usado } = await unlockVaultWith(dir, [provider]);
    expect(usado.id).toBe("dpapi");
    expect(abierta.equals(creada)).toBe(true);
  });
});

describe("C-1 · tpm contra doble del binding", () => {
  it("con el binding cargado y TPM presente, sella y desella la DEK", async () => {
    const provider = new TpmCustodyProvider(() => fakeTpmBinding());
    expect(await provider.available()).toBe(true);
    const blob = await provider.wrap(dek);
    expect(blob.provider).toBe("tpm");
    expect((await provider.unwrap(blob)).equals(dek)).toBe(true);
  });

  it("sin binding (el caso de esta casa) o sin TPM, no disponible y la escalera baja sin ruido", async () => {
    expect(await new TpmCustodyProvider().available()).toBe(false);
    expect(await new TpmCustodyProvider(() => null).available()).toBe(false);
    expect(await new TpmCustodyProvider(() => { throw new Error("no carga"); }).available()).toBe(false);
    expect(await new TpmCustodyProvider(() => fakeTpmBinding({ tpm: false })).available()).toBe(false);
    const chosen = await selectCustodyProvider([
      new TpmCustodyProvider(),
      new DpapiCustodyProvider(fakeSafeStorage()),
      new PasswordCustodyProvider("contrasena-de-prueba"),
    ]);
    expect(chosen.id).toBe("dpapi"); // TPM ausente → DPAPI, declarado DPAPI.
  });

  it("si el TPM no desella (otro PC), unwrap lanza sin entregar DEK", async () => {
    const bueno = new TpmCustodyProvider(() => fakeTpmBinding());
    const blob = await bueno.wrap(dek);
    const otroPc = new TpmCustodyProvider(() => fakeTpmBinding({ unsealFails: true }));
    await expect(otroPc.unwrap(blob)).rejects.toThrow(VaultUnlockError);
  });
});

describe("frases honestas de custodia", () => {
  it("cada nivel se dice como lo que es, y Hello se declara como puerta, no como cifrado", () => {
    expect(custodyLevelLabel({ level: "tpm", hello: false })).toContain("TPM");
    expect(custodyLevelLabel({ level: "dpapi", hello: false })).toContain("DPAPI");
    expect(custodyLevelLabel({ level: "dpapi", hello: false })).not.toContain("TPM de este PC");
    expect(custodyLevelLabel({ level: "contrasena", hello: false })).toContain("solo por tu contraseña");
    expect(custodyLevelLabel({ level: "dpapi", hello: true })).toContain("Hello");
  });
});
