/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * backupCaller.ts — E11 (O-1·E11, rama 2): el llamante
 * que adopta la pareja de E2 (respaldo y rotación) y la
 * pone al alcance de la persona en Ajustes, en la sesión
 * de la bóveda. Es una adopción por nombre, sin lógica
 * nueva: cada función llama a la pieza de E2 con los
 * argumentos de la superficie (el directorio de la
 * bóveda, las bases gestionadas que existen, la sesión
 * viva y las credenciales del gesto) y devuelve lo que
 * la pieza devuelve. La pareja manda en todo: su
 * re-autenticación, su pre-vuelo, su staging y su
 * recuperación son los suyos.
 *
 * Superficies de bóveda (S-1): el llamante gana la
 * vuelta que faltaba — la inspección previa y la
 * restauración — sobre la misma pareja y con el
 * contrato de la breve de núcleo del respaldo (la base
 * de userData y la bóveda como dos argumentos
 * separados). El motor ya estaba completo y probado;
 * lo que no existía era este cable.
 */
import {
  createBackup,
  readBackupContainer,
  restoreBackup,
  type BackupManifest,
} from "./backup.js";
import { rotateDatabaseKeys } from "./keyRotation.js";
import type { CustodyLevel, KeyCustodyProvider } from "./keyVault.js";
import type { VaultSession } from "./vaultSession.js";

/**
 * Exportar el respaldo: un .nidbackup cerrado con su
 * contraseña de respaldo (distinta de la de la bóveda),
 * con las bases gestionadas nombradas.
 */
export async function exportVaultBackup(opts: {
  dir: string;
  dbNames: string[];
  session: VaultSession;
  destPath: string;
  backupPassword: string;
}): Promise<BackupManifest> {
  return createBackup(opts);
}

/**
 * Rotar la clave de la bóveda: la pareja re-autentica con
 * los proveedores del gesto, re-cifra las bases nombradas
 * y la sesión adopta la clave nueva.
 */
export async function rotateVaultKeys(opts: {
  dir: string;
  dbNames: string[];
  session: VaultSession;
  providers: readonly KeyCustodyProvider[];
}): Promise<{ rotated: string[] }> {
  return rotateDatabaseKeys(opts);
}

/**
 * Inspeccionar un respaldo sin tocar nada (S-1): lee el
 * contenedor por la vía del núcleo, que verifica la
 * huella de cada entrada antes de devolver un solo
 * byte, y anuncia lo que la superficie enseña antes de
 * restaurar: la versión del formato, cuándo se hizo y
 * qué bases trae. Si el contenedor no se lee, lanza el
 * error del núcleo (el manejador lo traduce a su
 * razón). `legacy` dice si es de la vía 1, la que lleva
 * su clave en claro dentro del fichero.
 */
export function inspectVaultBackup(srcPath: string): {
  version: number;
  createdAt: string;
  entries: string[];
  legacy: boolean;
} {
  const { manifest } = readBackupContainer(srcPath);
  return {
    version: manifest.version,
    createdAt: manifest.createdAt,
    entries: manifest.entries.map((e) => e.path),
    legacy: manifest.version === 1,
  };
}

/**
 * Restaurar un respaldo (S-1), con el contrato de la
 * breve de núcleo del respaldo: `dir` es la BASE de
 * userData (los nombres del respaldo resuelven dentro
 * de ella) y `vaultDir` es la bóveda, donde vive la
 * custodia que re-envuelve la DEK restaurada. Sin
 * sesión a propósito: la restauración corre con todo
 * desmontado y la app se reinicia detrás; nadie adopta
 * la DEK en vivo. El `noticeAccepted: true` lo pone
 * este llamante SOLO porque el manejador ya exigió la
 * aceptación expresa en la superficie: el principal es
 * la puerta, no la interfaz.
 */
export async function restoreVaultBackup(opts: {
  dir: string;
  vaultDir: string;
  srcPath: string;
  providers: readonly KeyCustodyProvider[];
  backupPassword?: string;
}): Promise<{ restored: string[]; custodyLevel: CustodyLevel; legacyCleartextKey: boolean }> {
  return restoreBackup({ ...opts, session: undefined, noticeAccepted: true });
}
