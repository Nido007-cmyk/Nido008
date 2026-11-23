/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.respaldo — E11, entre los pasos 9 y 10: el
 * llamante de O-1·E11 (rama 2, adoptado por nombre en
 * Ajustes, en la sesión de la bóveda), contra el llamante
 * (`src/security/backupCaller.ts`) que cablea la pareja
 * sellada de E2 — `createBackup`/`restoreBackup` de
 * `backup.ts` y `rotateDatabaseKeys` de `keyRotation.ts` —
 * sin lógica nueva: las cablea, no las reescribe.
 *
 * El caso corre el loop entero contra el mecanismo real:
 * el `.nidbackup` exportado por el llamante restaura entero
 * por la vía de E2, y tras rotar por el llamante la base
 * abre con la clave nueva y no con la vieja. Con la bóveda
 * bloqueada, el llamante no ofrece ninguna de las dos
 * acciones: exportar cae con el error nombrado de E2.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreBackup } from "../security/backup.js";
import {
  PasswordCustodyProvider,
  initializeVault,
} from "../security/keyVault.js";
import {
  openSecureDatabase,
  rawOpenEncrypted,
  verifyHandle,
} from "../security/secureDatabase.js";
import { VaultSession } from "../security/vaultSession.js";

type Caller = typeof import("../security/backupCaller.js");
let pieza: Caller | null = null;
beforeAll(async () => {
  pieza = await import("../security/backupCaller.js").catch(() => null);
});
function P(): Caller {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/security/backupCaller.ts (el llamante de respaldo y rotación de O-1·E11 no está construido)",
    );
  return pieza;
}

const PASS_A = "contrasena-del-origen · prueba e11";
const PASS_B = "contrasena-del-destino · prueba e11";
const PASS_BK = "contrasena-del-respaldo · prueba e11";
const CANARIO = "CANARIO-E11-O1::el dato que viaja y sobrevive a la rotación";
const DB = "nido.db";
const HEAVY = { timeout: 180_000 };

describe("escritorio.respaldo · el llamante de O-1·E11", () => {
  it(
    "el loop entero por el llamante: exporta un .nidbackup que restaura entero por la vía de E2, y tras rotar la base abre con la clave nueva y no con la vieja; bloqueada, no ofrece nada",
    HEAVY,
    async () => {
      const caller = P();
      const dirA = await mkdtemp(path.join(os.tmpdir(), "nido-e11-o1-a-"));
      const dirB = await mkdtemp(path.join(os.tmpdir(), "nido-e11-o1-b-"));
      try {
        // La bóveda de origen con su base y su canario.
        await initializeVault(dirA, new PasswordCustodyProvider(PASS_A));
        const sessionA = await VaultSession.unlock(dirA, [
          new PasswordCustodyProvider(PASS_A),
        ]);
        const dbA = openSecureDatabase(path.join(dirA, DB), sessionA.dek);
        dbA.exec("CREATE TABLE IF NOT EXISTS t (v TEXT)");
        dbA.prepare("INSERT INTO t (v) VALUES (?)").run(CANARIO);
        dbA.close();

        // La exportación por el llamante, a un .nidbackup.
        const destPath = path.join(dirA, "respaldo.nidbackup");
        const manifest = await caller.exportVaultBackup({
          dir: dirA,
          dbNames: [DB],
          session: sessionA,
          destPath,
          backupPassword: PASS_BK,
        });
        expect(existsSync(destPath)).toBe(true);
        expect(manifest.entries.map((e) => e.path)).toContain(DB);

        // La restauración por la vía de E2 sobre una bóveda
        // destino con su propia contraseña: el canario llega
        // entero y la sesión destino adopta la DEK restaurada.
        await initializeVault(dirB, new PasswordCustodyProvider(PASS_B));
        const sessionB = await VaultSession.unlock(dirB, [
          new PasswordCustodyProvider(PASS_B),
        ]);
        await restoreBackup({
          dir: dirB,
          srcPath: destPath,
          session: sessionB,
          providers: [new PasswordCustodyProvider(PASS_B)],
          noticeAccepted: true,
          backupPassword: PASS_BK,
        });
        const dbB = openSecureDatabase(path.join(dirB, DB), sessionB.dek);
        const row = dbB.prepare("SELECT v FROM t").get() as { v: string };
        expect(row.v).toBe(CANARIO);
        dbB.close();

        // La rotación por el llamante: la base abre con la
        // clave nueva (la de la sesión tras rotar) y no con la
        // de antes de rotar.
        const dekAntes = Buffer.from(sessionB.dek);
        const rotated = await caller.rotateVaultKeys({
          dir: dirB,
          dbNames: [DB],
          session: sessionB,
          providers: [new PasswordCustodyProvider(PASS_B)],
        });
        expect(rotated.rotated).toContain(DB);
        expect(sessionB.dek.equals(dekAntes)).toBe(false);
        const dbNueva = rawOpenEncrypted(path.join(dirB, DB), sessionB.dek);
        const row2 = dbNueva.prepare("SELECT v FROM t").get() as { v: string };
        expect(row2.v).toBe(CANARIO);
        dbNueva.close();
        expect(() => {
          const d = rawOpenEncrypted(path.join(dirB, DB), dekAntes);
          try {
            verifyHandle(d);
          } finally {
            d.close();
          }
        }).toThrow();

        // Con la bóveda bloqueada, el llamante no ofrece la
        // exportación: cae con el error nombrado de la pareja.
        sessionB.lock();
        await expect(
          caller.exportVaultBackup({
            dir: dirB,
            dbNames: [DB],
            session: sessionB,
            destPath: path.join(dirB, "otro.nidbackup"),
            backupPassword: PASS_BK,
          }),
        ).rejects.toThrow(/bloqueada/);
      } finally {
        await rm(dirA, { recursive: true, force: true });
        await rm(dirB, { recursive: true, force: true });
      }
    },
  );
});
