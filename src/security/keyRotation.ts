/**
 * keyRotation.ts — rotación de la DEK, crash-safe (E2, paso 4).
 *
 * Diseño: estudios/MEMORIA-CIFRADA-ETAPA.md §3.4, espejo del móvil.
 * Orden de la casa, sin atajos:
 *   1. Re-autenticación: se desenvuelve la DEK actual con los
 *      proveedores dados (llevan la credencial recién introducida). Si
 *      no desenvuelve, no se ha tocado nada: ni staging ni bases.
 *      Y PRE-VUELO (ATAQUE4-P4): toda base nombrada existe y abre con
 *      la DEK actual antes de tocar nada.
 *   2. Se genera la DEK nueva y se escribe el STAGING SELLADO
 *      (stagingSeal.ts) ANTES de tocar ninguna base.
 *   3. `PRAGMA rekey` base a base.
 *   4. Se guarda la custodia con la DEK nueva envuelta y se VERIFICA
 *      desenvolviendo lo recién guardado (ATAQUE4-P3). Si ESTE paso
 *      falla, se revierten los rekeys ya hechos, se restaura el blob
 *      anterior y se limpia el staging: la rotación no deja un estado
 *      a medias por un fallo conocido.
 *   5. La sesión adopta la DEK nueva y se limpia el staging.
 * Un corte (apagón, kill) entre pasos lo recoge al arranque
 * `recoverPendingRotation`: la custodia manda. Si la bóveda ya envuelve
 * la DEK nueva, la rotación se COMPLETA (rekey de las bases que queden
 * con la vieja); si envuelve la vieja, se REVIERTE (rekey inverso de
 * las que ya iban con la nueva). Si la bóveda no envuelve ninguna de
 * las dos, fail-closed: no se toca nada.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileDurable } from "./durableFs.js";
import {
  type KeyCustodyProvider,
  VaultError,
  unlockVaultWith,
  vaultBlobPath,
  writeVaultBlobVerified,
} from "./keyVault.js";
import {
  SimulatedCrashError,
  rawOpenEncrypted,
  rekeyDatabaseFile,
  verifyHandle,
} from "./secureDatabase.js";
import {
  clearRotationStaging,
  readRotationStaging,
  sealRotationStaging,
} from "./stagingSeal.js";
import type { VaultSession } from "./vaultSession.js";

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RotationError";
  }
}

export class RotationRecoveryError extends RotationError {
  constructor(message: string) {
    super(message);
    this.name = "RotationRecoveryError";
  }
}

export type RotationFaultPoint = "duringRekey" | "custodySave" | "afterCustodySave";

export interface RotateOptions {
  /** Directorio de la bóveda (donde viven el blob y el staging). */
  dir: string;
  /** Nombres de las bases gestionadas (en el mismo directorio). */
  dbNames: string[];
  /** Sesión desbloqueada: su DEK debe ser la actual; adopta la nueva. */
  session: VaultSession;
  /** Proveedores con la credencial recién introducida (re-autenticación). */
  providers: readonly KeyCustodyProvider[];
  /** Solo para los tests de corte (R-2); en producción no se pasa. */
  faultAt?: RotationFaultPoint;
}

function dbPathOf(dir: string, name: string): string {
  return path.join(dir, name);
}

/** ¿Con qué DEK abre esta base? "old" | "new" | null (ninguna: fail-closed). */
function whichDekOpens(dbPath: string, oldDek: Buffer, newDek: Buffer): "old" | "new" | null {
  if (!existsSync(dbPath)) return null; // Una base ausente no se «verifica» creándola vacía.
  for (const [label, dek] of [["old", oldDek], ["new", newDek]] as const) {
    try {
      const db = rawOpenEncrypted(dbPath, dek);
      try {
        verifyHandle(db);
        return label;
      } finally {
        db.close();
      }
    } catch {
      // No abre con esta: se prueba la otra.
    }
  }
  return null;
}

/** ¿Abre esta base con esta DEK (apertura + integrity_check)? */
function opensWithDek(dbPath: string, dek: Buffer): boolean {
  if (!existsSync(dbPath)) return false;
  try {
    const db = rawOpenEncrypted(dbPath, dek);
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

export async function rotateDatabaseKeys(opts: RotateOptions): Promise<{ rotated: string[] }> {
  const { dir, dbNames, session, providers } = opts;
  // 1 · Re-autenticación. Sin desenvolver la DEK actual no hay rotación.
  let currentDek: Buffer;
  let provider: KeyCustodyProvider;
  try {
    ({ dek: currentDek, provider } = await unlockVaultWith(dir, providers));
  } catch (err) {
    throw new RotationError(`la re-autenticación falló: no se rotó nada. ${(err as Error).message}`);
  }
  if (!currentDek.equals(session.dek)) {
    throw new RotationError("la DEK desenvuelta no coincide con la de la sesión: no se rotó nada (fail-closed)");
  }
  // 1b · PRE-VUELO (arreglo ATAQUE4-P4, de D-5/E-04/E-05): toda base
  // nombrada EXISTE y ABRE con la DEK actual antes de sellar el staging
  // o tocar una sola base. Una base ausente no la crea el rekey en
  // silencio, y una base de otra clave se descubre aquí, no a mitad de
  // la rotación con la primera ya re-cifrada.
  for (const name of dbNames) {
    const dbPath = dbPathOf(dir, name);
    if (!existsSync(dbPath)) {
      throw new RotationError(`pre-vuelo de rotación: la base ${name} no existe; no se rotó nada (una rotación no crea bases)`);
    }
    if (!opensWithDek(dbPath, currentDek)) {
      throw new RotationError(
        `pre-vuelo de rotación: la base ${name} no abre con la DEK actual; no se rotó nada (fail-closed)`,
      );
    }
  }

  const newDek = randomBytes(32);
  const dbPaths = dbNames.map((n) => dbPathOf(dir, n));
  const rekeyed: string[] = [];
  try {
    // 2 · Staging sellado ANTES de tocar ninguna base.
    await sealRotationStaging(
      dir,
      {
        createdAt: new Date().toISOString(),
        oldDekHex: currentDek.toString("hex"),
        newDekHex: newDek.toString("hex"),
        dbPaths,
      },
      providers,
    );
    // 3 · Rekey base a base.
    for (const dbPath of dbPaths) {
      rekeyDatabaseFile(dbPath, currentDek, newDek);
      rekeyed.push(dbPath);
      if (opts.faultAt === "duringRekey") throw new SimulatedCrashError("duringRekey");
    }
    // 4 · Custodia con la DEK nueva, VERIFICADA desenvolviendo lo
    // recién guardado (ATAQUE4-P3, de D-4/E-06). Si el guardado o su
    // comprobación fallan, se revierten los rekeys ya hechos, se
    // RESTAURA el blob de custodia anterior byte a byte (el malo no
    // queda en disco) y se limpia el staging: la rotación no deja un
    // estado a medias por un fallo conocido.
    const blobPath = vaultBlobPath(dir);
    const prevBlobRaw = existsSync(blobPath) ? readFileSync(blobPath) : null;
    try {
      if (opts.faultAt === "custodySave") throw new VaultError("fallo simulado al guardar la custodia");
      await writeVaultBlobVerified(dir, provider, newDek);
    } catch (err) {
      for (const dbPath of rekeyed) rekeyDatabaseFile(dbPath, newDek, currentDek);
      if (prevBlobRaw) {
        const tmp = `${blobPath}.tmp-${process.pid}`;
        writeFileDurable(blobPath, prevBlobRaw, { tmpPath: tmp });
      } else {
        rmSync(blobPath, { force: true });
      }
      clearRotationStaging(dir);
      throw new RotationError(
        `guardar la custodia falló y los rekeys se revirtieron: ${(err as Error).message}`,
      );
    }
    if (opts.faultAt === "afterCustodySave") throw new SimulatedCrashError("afterCustodySave");
    // 5 · La sesión adopta la DEK nueva y el staging se limpia.
    session.adoptDek(newDek);
    clearRotationStaging(dir);
    return { rotated: dbNames };
  } finally {
    newDek.fill(0);
  }
}

export type RotationRecoveryOutcome = "none" | "completed" | "reverted";

/**
 * Recuperación al arranque de una rotación interrumpida. Idempotente.
 * La custodia manda: bóveda con la DEK nueva → completar; con la vieja
 * → revertir; con ninguna de las dos → RotationRecoveryError sin tocar
 * nada.
 */
export async function recoverPendingRotation(opts: {
  dir: string;
  providers: readonly KeyCustodyProvider[];
  session?: VaultSession;
}): Promise<RotationRecoveryOutcome> {
  const { dir, providers, session } = opts;
  const payload = await readRotationStaging(dir, providers);
  if (!payload) return "none";
  const oldDek = Buffer.from(payload.oldDekHex, "hex");
  const newDek = Buffer.from(payload.newDekHex, "hex");
  try {
    let vaultDek: Buffer;
    try {
      ({ dek: vaultDek } = await unlockVaultWith(dir, providers));
    } catch (err) {
      throw new RotationRecoveryError(`la bóveda no desenvuelve durante la recuperación: ${(err as Error).message}`);
    }
    const states = payload.dbPaths.map((dbPath) => ({ dbPath, opens: whichDekOpens(dbPath, oldDek, newDek) }));
    const unknown = states.find((s) => s.opens === null);
    if (unknown) {
      throw new RotationRecoveryError(
        `${unknown.dbPath} no abre ni con la DEK vieja ni con la nueva: no se toca nada (fail-closed)`,
      );
    }
    if (vaultDek.equals(newDek)) {
      for (const s of states) if (s.opens === "old") rekeyDatabaseFile(s.dbPath, oldDek, newDek);
      if (session && !session.locked && session.dek.equals(oldDek)) session.adoptDek(newDek);
      clearRotationStaging(dir);
      return "completed";
    }
    if (vaultDek.equals(oldDek)) {
      for (const s of states) if (s.opens === "new") rekeyDatabaseFile(s.dbPath, newDek, oldDek);
      if (session && !session.locked && session.dek.equals(newDek)) session.adoptDek(oldDek);
      clearRotationStaging(dir);
      return "reverted";
    }
    throw new RotationRecoveryError(
      "la bóveda no envuelve ni la DEK vieja ni la nueva del staging: no se toca nada (fail-closed)",
    );
  } finally {
    oldDek.fill(0);
    newDek.fill(0);
  }
}
