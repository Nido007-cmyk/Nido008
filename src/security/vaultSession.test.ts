/**
 * Tests del ciclo de vida de la DEK (E2, §3.5): el bloqueo pone la DEK a
 * ceros y suelta la referencia; con la bóveda cerrada no hay DEK que
 * pedir; el bloqueo por inactividad llega solo y la actividad lo rearma.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasswordCustodyProvider, initializeVault } from "./keyVault.js";
import { VaultLockedError, VaultSession } from "./vaultSession.js";

const PASSWORD = "Clave de prueba NIDO · ñandú 2026!";
const HEAVY = 180_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-session-"));
  await initializeVault(dir, new PasswordCustodyProvider(PASSWORD));
}, 180_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("VaultSession", () => {
  it(
    "desbloquea con el nivel declarado y lock() pone la DEK a ceros",
    async () => {
      const session = await VaultSession.unlock(dir, [new PasswordCustodyProvider(PASSWORD)]);
      expect(session.locked).toBe(false);
      expect(session.status).toEqual({ level: "contrasena", hello: false });
      const ref = session.dek;
      expect(ref.length).toBe(32);
      let notified = false;
      session.onLock(() => {
        notified = true;
      });
      session.lock();
      expect(session.locked).toBe(true);
      expect(notified).toBe(true);
      // El buffer que el llamador estuviera mirando quedó a ceros.
      expect(ref.every((b) => b === 0)).toBe(true);
      expect(() => session.dek).toThrow(VaultLockedError);
      session.lock(); // Idempotente: bloquear dos veces no rompe nada.
      expect(session.locked).toBe(true);
    },
    HEAVY,
  );

  it(
    "el bloqueo por inactividad llega solo; la actividad lo rearma",
    async () => {
      const session = await VaultSession.unlock(dir, [new PasswordCustodyProvider(PASSWORD)], {
        idleTimeoutMs: 120,
      });
      await sleep(60);
      session.touch();
      await sleep(60);
      expect(session.locked).toBe(false);
      await sleep(200);
      expect(session.locked).toBe(true);
      expect(() => session.dek).toThrow(VaultLockedError);
    },
    HEAVY,
  );
});
