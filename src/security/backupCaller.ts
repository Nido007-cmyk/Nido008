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
 */
import { createBackup, type BackupManifest } from "./backup.js";
import { rotateDatabaseKeys } from "./keyRotation.js";
import type { KeyCustodyProvider } from "./keyVault.js";
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
