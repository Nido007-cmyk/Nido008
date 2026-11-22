/**
 * Batería del paso 4 de E2 (rotación crash-safe): R-1 y R-2.
 * R-2 incluye el barrido de bytes del staging: ninguna DEK (vieja o
 * nueva) aparece en el fichero sellado en crudo, hex ni base64.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PasswordCustodyProvider, initializeVault, type WrappedBlob } from "./keyVault.js";
import {
  RotationError,
  recoverPendingRotation,
  rotateDatabaseKeys,
} from "./keyRotation.js";
import {
  SimulatedCrashError,
  openSecureDatabase,
  rawOpenEncrypted,
  verifyHandle,
} from "./secureDatabase.js";
import { hasRotationStaging, readRotationStaging, rotationStagingPath } from "./stagingSeal.js";
import { VaultSession } from "./vaultSession.js";

const HEAVY = 180_000;
const PASS = "contrasena-de-rotacion · prueba";
const CANARIO_A = "CANARIO-ROTACION-A::base a";
const CANARIO_B = "CANARIO-ROTACION-B::base b";
const DBS = ["a.db", "b.db"];

let dir: string;
let session: VaultSession;
let oldDek: Buffer;

const providers = () => [new PasswordCustodyProvider(PASS)];

async function setupVaultWithDbs(): Promise<void> {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-rot-"));
  const provider = new PasswordCustodyProvider(PASS);
  await initializeVault(dir, provider);
  session = await VaultSession.unlock(dir, providers());
  oldDek = Buffer.from(session.dek);
  for (const [name, canario] of [[DBS[0], CANARIO_A], [DBS[1], CANARIO_B]] as const) {
    const db = openSecureDatabase(path.join(dir, name), session.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db.prepare("INSERT INTO t VALUES (?)").run(canario);
    db.close();
  }
}

beforeEach(setupVaultWithDbs, HEAVY);

afterEach(async () => {
  session.lock();
  await rm(dir, { recursive: true, force: true });
});

function opensWith(dbName: string, dek: Buffer): boolean {
  try {
    const db = rawOpenEncrypted(path.join(dir, dbName), dek);
    try {
      verifyHandle(db);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function contentOf(dbName: string, dek: Buffer): string {
  const db = openSecureDatabase(path.join(dir, dbName), dek);
  const row = db.prepare("SELECT v FROM t").get() as { v: string };
  db.close();
  return row.v;
}

describe("R-1 · rotación multi-base", () => {
  it("todas las bases pasan a la DEK nueva, el contenido queda íntegro y la vieja deja de abrir", { timeout: HEAVY }, async () => {
    const result = await rotateDatabaseKeys({ dir, dbNames: DBS, session, providers: providers() });
    expect(result.rotated).toEqual(DBS);
    expect(hasRotationStaging(dir)).toBe(false);
    const newDek = Buffer.from(session.dek);
    expect(newDek.equals(oldDek)).toBe(false);
    for (const name of DBS) {
      expect(opensWith(name, newDek)).toBe(true);
      expect(opensWith(name, oldDek)).toBe(false);
    }
    expect(contentOf(DBS[0], newDek)).toBe(CANARIO_A);
    expect(contentOf(DBS[1], newDek)).toBe(CANARIO_B);
    // La bóveda desenvuelve a la DEK adoptada por la sesión.
    const otra = await VaultSession.unlock(dir, providers());
    expect(otra.dek.equals(newDek)).toBe(true);
    otra.lock();
  });

  it("sin re-autenticación no hay rotación: contraseña equivocada y nada se toca", { timeout: HEAVY }, async () => {
    await expect(
      rotateDatabaseKeys({
        dir,
        dbNames: DBS,
        session,
        providers: [new PasswordCustodyProvider("contrasena-equivocada")],
      }),
    ).rejects.toThrow(RotationError);
    expect(hasRotationStaging(dir)).toBe(false);
    for (const name of DBS) expect(opensWith(name, oldDek)).toBe(true);
  });
});

describe("R-2 · cortes a mitad de rotación", () => {
  it("corte tras el primer rekey: el staging no contiene ninguna DEK y la recuperación revierte", { timeout: HEAVY }, async () => {
    await expect(
      rotateDatabaseKeys({ dir, dbNames: DBS, session, providers: providers(), faultAt: "duringRekey" }),
    ).rejects.toThrow(SimulatedCrashError);
    expect(hasRotationStaging(dir)).toBe(true);
    // Estado partido: la primera base ya va con la nueva; la segunda, con la vieja.
    const payload = await readRotationStaging(dir, providers());
    const newDek = Buffer.from(payload!.newDekHex, "hex");
    expect(opensWith(DBS[0], newDek)).toBe(true);
    expect(opensWith(DBS[1], oldDek)).toBe(true);
    // Barrido de bytes del staging: ninguna DEK en crudo, hex ni base64.
    const raw = readFileSync(rotationStagingPath(dir));
    for (const dek of [oldDek, newDek]) {
      expect(raw.indexOf(dek)).toBe(-1);
      expect(raw.indexOf(Buffer.from(dek.toString("hex"), "utf8"))).toBe(-1);
      expect(raw.indexOf(Buffer.from(dek.toString("base64"), "utf8"))).toBe(-1);
    }
    // La custodia aún envuelve la vieja: la recuperación revierte.
    const outcome = await recoverPendingRotation({ dir, providers: providers(), session });
    expect(outcome).toBe("reverted");
    expect(hasRotationStaging(dir)).toBe(false);
    for (const name of DBS) expect(opensWith(name, oldDek)).toBe(true);
    expect(contentOf(DBS[0], oldDek)).toBe(CANARIO_A);
    expect(existsSync(rotationStagingPath(dir))).toBe(false);
  });

  it("fallo al guardar la custodia: los rekeys se revierten solos y no queda staging", { timeout: HEAVY }, async () => {
    await expect(
      rotateDatabaseKeys({ dir, dbNames: DBS, session, providers: providers(), faultAt: "custodySave" }),
    ).rejects.toThrow(RotationError);
    expect(hasRotationStaging(dir)).toBe(false);
    for (const name of DBS) expect(opensWith(name, oldDek)).toBe(true);
    expect(session.dek.equals(oldDek)).toBe(true);
  });

  it("corte tras guardar la custodia (antes de limpiar): la recuperación completa la rotación", { timeout: HEAVY }, async () => {
    await expect(
      rotateDatabaseKeys({ dir, dbNames: DBS, session, providers: providers(), faultAt: "afterCustodySave" }),
    ).rejects.toThrow(SimulatedCrashError);
    expect(hasRotationStaging(dir)).toBe(true);
    const outcome = await recoverPendingRotation({ dir, providers: providers(), session });
    expect(outcome).toBe("completed");
    expect(hasRotationStaging(dir)).toBe(false);
    const newDek = Buffer.from(session.dek);
    expect(newDek.equals(oldDek)).toBe(false);
    for (const name of DBS) {
      expect(opensWith(name, newDek)).toBe(true);
      expect(opensWith(name, oldDek)).toBe(false);
    }
    // Sin staging, recuperar otra vez es un no-op declarado.
    expect(await recoverPendingRotation({ dir, providers: providers() })).toBe("none");
  });
});

describe("arreglos ATAQUE-4 · pre-vuelo y custodia verificada", () => {
  it("D-5/E-04 · una base ausente en dbNames detiene la rotación: no se crea, no hay staging, la otra queda intacta", { timeout: HEAVY }, async () => {
    await expect(
      rotateDatabaseKeys({ dir, dbNames: [DBS[0], "fantasma.db"], session, providers: providers() }),
    ).rejects.toThrow(RotationError);
    expect(existsSync(path.join(dir, "fantasma.db"))).toBe(false); // El rekey ya no CREA bases vacías.
    expect(hasRotationStaging(dir)).toBe(false);
    expect(contentOf(DBS[0], oldDek)).toBe(CANARIO_A);
  });

  it("D-5/E-05 · una base que abre con OTRA clave detiene la rotación en el pre-vuelo, sin estado partido", { timeout: HEAVY }, async () => {
    const ajena = openSecureDatabase(path.join(dir, "ajena.db"), randomBytes(32));
    ajena.exec("CREATE TABLE t (v TEXT NOT NULL)");
    ajena.prepare("INSERT INTO t VALUES (?)").run("dato-ajeno");
    ajena.close();
    await expect(
      rotateDatabaseKeys({ dir, dbNames: [DBS[0], "ajena.db"], session, providers: providers() }),
    ).rejects.toThrow(RotationError);
    expect(hasRotationStaging(dir)).toBe(false);
    expect(contentOf(DBS[0], oldDek)).toBe(CANARIO_A); // La primera no quedó re-cifrada a medias.
    expect(session.dek.equals(oldDek)).toBe(true);
  });

  it("D-4/E-06 · un proveedor que envuelve OTRA clave: la rotación se declara fallida, las bases y la bóveda quedan con la DEK vieja", { timeout: HEAVY }, async () => {
    class ProveedorMentiroso extends PasswordCustodyProvider {
      override async wrap(): Promise<WrappedBlob> {
        return super.wrap(randomBytes(32)); // Envuelve basura, no la DEK dada.
      }
    }
    await expect(
      rotateDatabaseKeys({ dir, dbNames: DBS, session, providers: [new ProveedorMentiroso(PASS)] }),
    ).rejects.toThrow(RotationError);
    expect(hasRotationStaging(dir)).toBe(false);
    for (const name of DBS) expect(opensWith(name, oldDek)).toBe(true);
    expect(session.dek.equals(oldDek)).toBe(true);
    // La bóveda restaurada sigue desenvolviendo la DEK vieja (el blob
    // mentiroso no quedó en disco).
    const otra = await VaultSession.unlock(dir, providers());
    expect(otra.dek.equals(oldDek)).toBe(true);
    otra.lock();
  });
});
