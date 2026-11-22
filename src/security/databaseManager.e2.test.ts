/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la recreación de PC de databaseManager (alineación al móvil,
 * cierre R1). La base de la app vive sobre la base cifrada de E2 y nunca
 * sobre la de conocimiento. Mide el suelo y las garantías del contrato:
 * - la apertura cifrada con la DEK del almacén de la app y el DDL
 *   unificado del móvil;
 * - la cola única de escrituras;
 * - el epoch, que invalida los handles tras cerrar;
 * - el borrado con su barrera;
 * - y el fallo cerrado sin clave.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir, AppStoreLockedError } from "./appStore.js";
import {
  closeDatabase,
  DbLifecycleEndedError,
  getDatabase,
  getDatabaseEpoch,
  wipeDatabase,
  writeTransaction,
} from "./databaseManager.js";

let dir: string;

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-appdb-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const KEY = randomBytes(32);

describe("databaseManager sobre E2", () => {
  it("abre nido_memory.db cifrada con el DDL unificado del móvil", async () => {
    const db = await getDatabase();
    const tables = (await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )).map((r) => r.name);
    for (const t of ["meta", "facts", "agent_reminders", "agent_reminder_repeat", "learned_skills", "scheduled_tasks", "agent_action_log"]) {
      expect(tables).toContain(t);
    }
    await writeTransaction(async (h) => {
      await h.runAsync("INSERT INTO preferences (key, value) VALUES (?, ?)", ["clave", "valor-secreto-77"]);
    });
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM preferences WHERE key = ?", ["clave"]);
    expect(row?.value).toBe("valor-secreto-77");
    await closeDatabase();
    const bytes = readFileSync(join(dir, "nido_memory.db"));
    expect(bytes.subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
    expect(bytes.includes(Buffer.from("valor-secreto-77"))).toBe(false);
  });

  it("sin DEK la apertura falla cerrada y no crea base", async () => {
    setAppStoreDekProvider(null);
    await expect(getDatabase()).rejects.toBeInstanceOf(AppStoreLockedError);
    expect(existsSync(join(dir, "nido_memory.db"))).toBe(false);
  });

  it("las escrituras se serializan en una sola cola", async () => {
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        writeTransaction(async (h) => {
          await h.runAsync("INSERT INTO daily_log (id, day, entry) VALUES (?, ?, ?)", [`d${n}`, "2026-11-19", `e${n}`]);
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("cerrar avanza el epoch: una escritura encolada del ciclo viejo falla con DbLifecycleEndedError", async () => {
    await getDatabase();
    const before = getDatabaseEpoch();
    const blocker = writeTransaction(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const stale = writeTransaction(async () => {});
    await closeDatabase();
    expect(getDatabaseEpoch()).toBe(before + 1);
    await blocker.catch(() => {});
    await expect(stale).rejects.toBeInstanceOf(DbLifecycleEndedError);
    expect(await getDatabase()).toBeTruthy();
  });

  it("wipeDatabase borra la base y la siguiente apertura empieza vacía", async () => {
    await writeTransaction(async (h) => {
      await h.runAsync("INSERT INTO preferences (key, value) VALUES (?, ?)", ["k", "v"]);
    });
    await wipeDatabase();
    expect(existsSync(join(dir, "nido_memory.db"))).toBe(false);
    const db = await getDatabase();
    expect(await db.getFirstAsync("SELECT value FROM preferences WHERE key = ?", ["k"])).toBeNull();
  });
});
