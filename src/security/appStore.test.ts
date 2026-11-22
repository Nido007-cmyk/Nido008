/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de las costuras de suelo del cierre R3 (alineación al móvil):
 * el almacén cifrado de la app (appStore), el contrato de ficheros
 * (fileSystem) y el backend real del almacén seguro (keyManager). Mide el
 * suelo, no la lógica del móvil: lo sellado no toca el disco en claro,
 * sin DEK leer y escribir fallan cerrado, y una ruta fuera del directorio
 * de datos se rechaza.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { AppStoreLockedError, seal, setAppStoreDekProvider, setAppStoreDir, unseal } from "./appStore.js";
import * as FS from "./fileSystem.js";
import { readPrivateSetting, writePrivateSetting } from "../privacy/keyManager.js";

let dir: string;
const dek = randomBytes(32);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-appstore-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => dek);
});

afterEach(() => {
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("appStore · sellado", () => {
  it("abre lo que sella y rechaza otra clave o un byte cambiado", () => {
    const s = seal(dek, Buffer.from("hola"));
    expect(unseal(dek, s).toString()).toBe("hola");
    expect(() => unseal(randomBytes(32), s)).toThrow();
    const bad = Buffer.from(s);
    bad[bad.length - 1] ^= 1;
    expect(() => unseal(dek, bad)).toThrow();
  });
});

describe("fileSystem · contrato expo-file-system/legacy sobre E2", () => {
  const P = `${FS.documentDirectory}settings.json`;

  it("escribe, lee, mueve y borra; en disco no queda texto en claro", async () => {
    await FS.writeAsStringAsync(`${P}.tmp`, '{"secreto":"xyz-123"}');
    await FS.moveAsync({ from: `${P}.tmp`, to: P });
    expect((await FS.getInfoAsync(P)).exists).toBe(true);
    expect(await FS.readAsStringAsync(P)).toBe('{"secreto":"xyz-123"}');
    expect(readFileSync(join(dir, "settings.json")).includes(Buffer.from("xyz-123"))).toBe(false);
    await FS.deleteAsync(P, { idempotent: true });
    expect((await FS.getInfoAsync(P)).exists).toBe(false);
    await FS.deleteAsync(P, { idempotent: true });
    await expect(FS.deleteAsync(P)).rejects.toThrow();
  });

  it("sin DEK, leer y escribir fallan cerrado y no se crea ningún fichero", async () => {
    setAppStoreDekProvider(null);
    await expect(FS.writeAsStringAsync(P, "x")).rejects.toBeInstanceOf(AppStoreLockedError);
    expect(readdirSync(dir)).toEqual([]);
    setAppStoreDekProvider(() => null);
    await expect(FS.readAsStringAsync(P)).rejects.toBeInstanceOf(AppStoreLockedError);
  });

  it("una ruta fuera de la raíz de documentos o del directorio de datos se rechaza", async () => {
    await expect(FS.readAsStringAsync("file:///etc/passwd")).rejects.toBeInstanceOf(FS.AppFilePathRefusal);
    await expect(FS.writeAsStringAsync(`${FS.documentDirectory}../fuera.json`, "x")).rejects.toBeInstanceOf(
      FS.AppFilePathRefusal,
    );
  });
});

describe("keyManager · backend real sobre E2", () => {
  it("guarda, lee y borra un ajuste privado sellado", async () => {
    expect(await writePrivateSetting("nido_private_custom_prompt", "mi prompt")).toBe(true);
    expect(await readPrivateSetting("nido_private_custom_prompt")).toBe("mi prompt");
    const f = readFileSync(join(dir, "secure-store", "nido_private_custom_prompt.sealed"));
    expect(f.includes(Buffer.from("mi prompt"))).toBe(false);
    expect(await writePrivateSetting("nido_private_custom_prompt", null)).toBe(true);
    expect(await readPrivateSetting("nido_private_custom_prompt")).toBeNull();
  });

  it("sin proveedor de DEK no hay backend: lee undefined y escribe false, como el móvil sin SecureStore", async () => {
    setAppStoreDekProvider(null);
    expect(await readPrivateSetting("nido_private_custom_prompt")).toBeUndefined();
    expect(await writePrivateSetting("nido_private_custom_prompt", "x")).toBe(false);
  });
});
