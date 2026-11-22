/**
 * Batería del paso 1 de E2 (custodia): T-1 en su variante de contraseña,
 * C-1 con dobles y C-3, la regresión permanente del `maxmem` cazado por
 * la prueba de pieza. Los parámetros de scrypt son los sellados
 * (N=2^17): cada derivación cuesta segundos en esta VM, así que la
 * batería comparte envolturas entre casos en vez de derivar de más.
 */

import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEK_BYTES,
  PasswordCustodyProvider,
  SCRYPT_MAXMEM,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  VaultBlobError,
  VaultError,
  VaultUnlockError,
  type KeyCustodyProvider,
  type WrappedBlob,
  deriveKekWithSealedParams,
  initializeVault,
  readVaultBlob,
  selectCustodyProvider,
  unlockVaultWith,
  vaultBlobPath,
  vaultStatusFor,
  writeVaultBlobVerified,
} from "./keyVault.js";

const PASSWORD = "Clave de prueba NIDO · ñandú 2026!";
const PASSWORD_WRONG = "Clave de prueba NIDO · ñandú 2026?";
const HEAVY = 180_000;

function fakeProvider(id: "tpm" | "dpapi", isAvailable: boolean): KeyCustodyProvider {
  return {
    id,
    available: async () => isAvailable,
    wrap: async () => {
      throw new Error("el doble no envuelve");
    },
    unwrap: async () => {
      throw new Error("el doble no desenvuelve");
    },
  };
}

describe("C-3 · la derivación sellada arranca a través de keyVault.ts (maxmem fijado)", () => {
  it(
    "deriva la KEK con N=2^17 sin ERR_CRYPTO_INVALID_SCRYPT_PARAMS",
    async () => {
      expect(SCRYPT_N).toBe(2 ** 17);
      // 136 MiB fijados explícitamente; el defecto de Node es 32 MiB.
      expect(SCRYPT_MAXMEM).toBe(136 * 1024 * 1024);
      const kek = await deriveKekWithSealedParams(PASSWORD, randomBytes(16));
      expect(kek.length).toBe(32);
      kek.fill(0);
    },
    HEAVY,
  );
});

describe("T-1 (variante contraseña) · KEK equivocada o blob manipulado: error sin DEK", () => {
  const provider = new PasswordCustodyProvider(PASSWORD);
  const dek = randomBytes(DEK_BYTES);
  let blob: WrappedBlob;

  beforeAll(async () => {
    blob = await provider.wrap(dek);
  }, 180_000);

  it(
    "la ida y vuelta con la contraseña correcta devuelve la DEK idéntica byte a byte",
    async () => {
      const out = await provider.unwrap(blob);
      expect(out.equals(dek)).toBe(true);
      out.fill(0);
    },
    HEAVY,
  );

  it(
    "contraseña equivocada: la etiqueta GCM rechaza y no se entrega DEK",
    async () => {
      const wrong = new PasswordCustodyProvider(PASSWORD_WRONG);
      await expect(wrong.unwrap(blob)).rejects.toBeInstanceOf(VaultUnlockError);
    },
    HEAVY,
  );

  it(
    "un byte manipulado (nonce, cifrado o etiqueta) se rechaza en los tres sitios",
    async () => {
      const raw = Buffer.from(blob.wrapped, "base64");
      const sitios: Array<[string, number]> = [
        ["nonce", 0],
        ["cifrado", 20],
        ["etiqueta", raw.length - 1],
      ];
      for (const [nombre, offset] of sitios) {
        const tocado = Buffer.from(raw);
        tocado[offset] = tocado[offset] ^ 0xff;
        await expect(provider.unwrap({ ...blob, wrapped: tocado.toString("base64") }), nombre).rejects.toBeInstanceOf(
          VaultUnlockError,
        );
      }
    },
    HEAVY,
  );

  it("dos envolturas de la misma DEK no se parecen y desenvuelven a la misma", async () => {
    const otra = await provider.wrap(dek);
    expect(otra.wrapped).not.toBe(blob.wrapped);
    expect(otra.params?.salt).not.toBe(blob.params?.salt);
    const out = await provider.unwrap(otra);
    expect(out.equals(dek)).toBe(true);
    out.fill(0);
  }, HEAVY);

  it("la DEK no aparece en el blob: ni en crudo, ni en hex, ni en base64", () => {
    const serialized = JSON.stringify(blob);
    expect(serialized.includes(dek.toString("hex"))).toBe(false);
    expect(serialized.includes(dek.toString("base64"))).toBe(false);
    const raw = Buffer.from(blob.wrapped, "base64");
    expect(raw.indexOf(dek)).toBe(-1);
  });

  it("un blob con parámetros rebajados se rechaza sin derivar (fail-closed)", async () => {
    const rebajado: WrappedBlob = { ...blob, params: { ...blob.params!, n: 2 ** 10 } };
    await expect(provider.unwrap(rebajado)).rejects.toBeInstanceOf(VaultBlobError);
  });
});

describe("C-1 · escalera con dobles: el nivel más alto disponible, declarado tal cual", () => {
  const password = new PasswordCustodyProvider(PASSWORD);

  it("con TPM disponible, la escalera elige TPM", async () => {
    const chosen = await selectCustodyProvider([fakeProvider("tpm", true), fakeProvider("dpapi", true), password]);
    expect(chosen.id).toBe("tpm");
    expect(vaultStatusFor(chosen)).toEqual({ level: "tpm", hello: false });
  });

  it("sin TPM, elige DPAPI y vaultStatus lo declara DPAPI, jamás TPM", async () => {
    const chosen = await selectCustodyProvider([fakeProvider("tpm", false), fakeProvider("dpapi", true), password]);
    expect(chosen.id).toBe("dpapi");
    expect(vaultStatusFor(chosen).level).toBe("dpapi");
  });

  it("sin TPM ni DPAPI, baja a contraseña; sin ninguno, lanza", async () => {
    const chosen = await selectCustodyProvider([fakeProvider("tpm", false), fakeProvider("dpapi", false), password]);
    expect(chosen.id).toBe("contrasena");
    await expect(selectCustodyProvider([fakeProvider("tpm", false), fakeProvider("dpapi", false)])).rejects.toThrow();
  });

  it("D-9/H-05 · una lista DESORDENADA no pierde el nivel alto: la selección ordena por la escalera", async () => {
    const chosen = await selectCustodyProvider([password, fakeProvider("tpm", true)]);
    expect(chosen.id).toBe("tpm");
    const chosen2 = await selectCustodyProvider([password, fakeProvider("dpapi", true), fakeProvider("tpm", false)]);
    expect(chosen2.id).toBe("dpapi");
  });
});

describe("el fichero de custodia nido-keyvault.json", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-vault-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "initializeVault genera la DEK una vez y el fichero no contiene la DEK en ninguna forma",
    async () => {
      const provider = new PasswordCustodyProvider(PASSWORD);
      const { dek, blob } = await initializeVault(dir, provider);
      expect(dek.length).toBe(DEK_BYTES);
      expect(blob.provider).toBe("contrasena");
      const fileText = readFileSync(path.join(dir, "nido-keyvault.json"), "utf8");
      expect(fileText.includes(dek.toString("hex"))).toBe(false);
      expect(fileText.includes(dek.toString("base64"))).toBe(false);
      expect(readVaultBlob(dir)).toEqual(blob);

      const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD)]);
      expect(unlocked.dek.equals(dek)).toBe(true);
      expect(unlocked.provider.id).toBe("contrasena");
      unlocked.dek.fill(0);
      dek.fill(0);
    },
    HEAVY,
  );

  it(
    "unlockVaultWith con la contraseña equivocada lanza sin DEK; sin el proveedor del blob, también",
    async () => {
      await expect(unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD_WRONG)])).rejects.toBeInstanceOf(
        VaultUnlockError,
      );
      await expect(unlockVaultWith(dir, [fakeProvider("dpapi", true)])).rejects.toThrow();
      expect(existsSync(path.join(dir, "nido-keyvault.json"))).toBe(true);
    },
    HEAVY,
  );

  it(
    "D-4 · initializeVault con un proveedor que envuelve OTRA clave: se declara fallido y no queda blob en disco",
    async () => {
      class ProveedorMentiroso extends PasswordCustodyProvider {
        override async wrap(): Promise<WrappedBlob> {
          return super.wrap(randomBytes(32));
        }
      }
      const dirMalo = await mkdtemp(path.join(os.tmpdir(), "nido-ataque4-vault-"));
      try {
        await expect(initializeVault(dirMalo, new ProveedorMentiroso(PASSWORD))).rejects.toThrow(VaultError);
        expect(existsSync(path.join(dirMalo, "nido-keyvault.json"))).toBe(false);
      } finally {
        await rm(dirMalo, { recursive: true, force: true });
      }
    },
    HEAVY,
  );
});

describe("B-7 · mínimo de 8 caracteres en puntos de código Unicode, solo a contraseña nueva", () => {
  it(
    "crear la bóveda con 7 caracteres rechaza y no deja fichero de custodia; el conteo es en puntos de código (7 puntos con un carácter astral también rechazan)",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-b7-corta-"));
      try {
        await expect(initializeVault(dir, new PasswordCustodyProvider("1234567"))).rejects.toBeInstanceOf(VaultError);
        expect(existsSync(path.join(dir, "nido-keyvault.json"))).toBe(false);
        // «clave😀1» son 7 puntos de código y 8 unidades UTF-16: si el
        // conteo fuera por .length pasaría; en puntos de código rechaza.
        await expect(initializeVault(dir, new PasswordCustodyProvider("clave😀1"))).rejects.toBeInstanceOf(VaultError);
        expect(existsSync(path.join(dir, "nido-keyvault.json"))).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    "la legada abre: una bóveda envuelta con contraseña corta por la vía de fixture abre con esa contraseña tras el cambio",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-b7-legada-"));
      try {
        // Envoltura construida en la batería con la derivación sellada
        // y AES-GCM, SIN pasar por el wrap() ya gobernado: la forma en
        // que una bóveda anterior a la política existiría en disco.
        const corta = "corta";
        const dek = randomBytes(DEK_BYTES);
        const salt = randomBytes(16);
        const kek = await deriveKekWithSealedParams(corta, salt);
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", kek, nonce);
        const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
        const tag = cipher.getAuthTag();
        kek.fill(0);
        const blob: WrappedBlob = {
          version: 1,
          provider: "contrasena",
          createdAt: new Date().toISOString(),
          params: { kdf: "scrypt", n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt: salt.toString("base64") },
          wrapped: Buffer.concat([nonce, ct, tag]).toString("base64"),
        };
        writeFileSync(vaultBlobPath(dir), JSON.stringify(blob, null, 2) + "\n", "utf8");
        const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(corta)]);
        expect(unlocked.dek.equals(dek)).toBe(true);
        unlocked.dek.fill(0);
        dek.fill(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    "cambiar la contraseña a una corta (re-envoltura verificada con proveedor nuevo) rechaza, y la bóveda sigue abriendo con la anterior",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-b7-cambio-"));
      try {
        const { dek } = await initializeVault(dir, new PasswordCustodyProvider(PASSWORD));
        const antes = readFileSync(vaultBlobPath(dir));
        await expect(writeVaultBlobVerified(dir, new PasswordCustodyProvider("1234567"), dek)).rejects.toBeInstanceOf(
          VaultError,
        );
        expect(readFileSync(vaultBlobPath(dir)).equals(antes)).toBe(true);
        const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD)]);
        expect(unlocked.dek.equals(dek)).toBe(true);
        unlocked.dek.fill(0);
        dek.fill(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );
});

describe("F-PC64 · initializeVault es solo de primera instalación", () => {
  it(
    "primera instalación en directorio vacío: nace y desenvuelve la misma DEK (control)",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-fpc64-primera-"));
      try {
        const { dek } = await initializeVault(dir, new PasswordCustodyProvider(PASSWORD));
        const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD)]);
        expect(unlocked.dek.equals(dek)).toBe(true);
        unlocked.dek.fill(0);
        dek.fill(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    "segunda initializeVault con proveedor sano: rechaza con VaultBlobError, el blob queda byte a byte y la DEK original sigue desenvolviendo",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-fpc64-segunda-"));
      try {
        const { dek } = await initializeVault(dir, new PasswordCustodyProvider(PASSWORD));
        const antes = readFileSync(vaultBlobPath(dir));
        await expect(initializeVault(dir, new PasswordCustodyProvider(PASSWORD))).rejects.toBeInstanceOf(VaultBlobError);
        expect(readFileSync(vaultBlobPath(dir)).equals(antes)).toBe(true);
        const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD)]);
        expect(unlocked.dek.equals(dek)).toBe(true);
        unlocked.dek.fill(0);
        dek.fill(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    "segunda initializeVault con un proveedor cuyo wrap lanza: rechaza y el blob válido anterior sigue en disco y desenvolviendo",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-fpc64-roto-"));
      try {
        const { dek } = await initializeVault(dir, new PasswordCustodyProvider(PASSWORD));
        const antes = readFileSync(vaultBlobPath(dir));
        const roto: KeyCustodyProvider = {
          id: "contrasena",
          available: async () => true,
          wrap: async () => {
            throw new Error("wrap simulado que falla");
          },
          unwrap: async () => {
            throw new Error("el doble no desenvuelve");
          },
        };
        await expect(initializeVault(dir, roto)).rejects.toThrow();
        expect(readFileSync(vaultBlobPath(dir)).equals(antes)).toBe(true);
        const unlocked = await unlockVaultWith(dir, [new PasswordCustodyProvider(PASSWORD)]);
        expect(unlocked.dek.equals(dek)).toBe(true);
        unlocked.dek.fill(0);
        dek.fill(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );

  it(
    "un fichero basura preexistente en la ruta del blob: rechaza con VaultBlobError y el fichero queda intacto",
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "nido-fpc64-basura-"));
      try {
        writeFileSync(vaultBlobPath(dir), "esto no es una bóveda", "utf8");
        await expect(initializeVault(dir, new PasswordCustodyProvider(PASSWORD))).rejects.toBeInstanceOf(VaultBlobError);
        expect(readFileSync(vaultBlobPath(dir), "utf8")).toBe("esto no es una bóveda");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    HEAVY,
  );
});
