/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería del paso 1 de E7: el esquema de la agenda sobre la base
 * personal cifrada de E2. Puerta del paso, en la enumeración de
 * E7-DECISIONES §5.2 (grupo Esquema, 3 casos):
 * - las tres tablas de la etapa (calendar_events, contacts,
 *   notices) existen tras cerrar y reabrir la base, con sus filas;
 * - el marcador de formato corre con su prueba propia sobre esta
 *   base (estampa al abrir, se conserva al reabrir y una versión
 *   futura se rechaza fail-closed);
 * - el fichero en disco no contiene en claro ni un título de
 *   evento ni un nombre de contacto.
 *
 * Las tres tablas viven en nido_memory.db, la base personal que
 * el respaldo y la rotación de E2 ya nombran en su censo
 * multi-base: la agenda entra en ese censo por construcción, sin
 * fichero nuevo que pudiera quedar fuera.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setAppStoreDekProvider, setAppStoreDir } from "./appStore.js";
import { closeDatabase, getDatabase } from "./databaseManager.js";
import { MEMORY_DB_SCHEMA_VERSION, MemoryDbVersionError } from "./formatVersion.js";
import { armNotice } from "../agent/memory/noticeStore.js";

let dir: string;
const KEY = randomBytes(32);

beforeEach(async () => {
  await closeDatabase();
  dir = mkdtempSync(join(tmpdir(), "nido-e7schema-"));
  setAppStoreDir(dir);
  setAppStoreDekProvider(() => Buffer.from(KEY));
});

afterEach(async () => {
  await closeDatabase();
  setAppStoreDekProvider(null);
  setAppStoreDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const TITULO = "TituloSecretoE7-4f2a";
const NOMBRE = "NombreSecretoE7-9c1b";

async function seedRows(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO calendar_events (id, uid, title, notes, location, starts_at, ends_at, all_day, rrule, rrule_until, alert_offset_min, origin, created_at, updated_at) VALUES (?, ?, ?, '', '', ?, ?, 0, NULL, NULL, NULL, 'chat', ?, ?)",
    ["ev-1", "uid-e7-1", TITULO, 1_800_000_000_000, 1_800_003_600_000, 1_800_000_000_000, 1_800_000_000_000],
  );
  await db.runAsync(
    "INSERT INTO contacts (id, name, relation, birthday_month, birthday_day, birthday_year, phones, emails, notes, alert_lead_days, origin, created_at, updated_at) VALUES (?, ?, NULL, 6, 8, NULL, '[]', '[]', '', 0, 'chat', ?, ?)",
    ["ct-1", NOMBRE, 1_800_000_000_000, 1_800_000_000_000],
  );
  await armNotice({
    kind: "event",
    refId: "ev-1",
    body: { title: TITULO },
    baseLocal: "2027-01-15T09:00",
    now: 1_800_000_000_000,
  });
}

describe("E7 paso 1 · esquema de la agenda sobre E2", () => {
  it("las tres tablas existen tras cerrar y reabrir, con sus filas", async () => {
    await seedRows();
    await closeDatabase();
    const db = await getDatabase();
    const tables = (
      await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
    ).map((r) => r.name);
    for (const t of ["calendar_events", "contacts", "notices"]) {
      expect(tables).toContain(t);
    }
    const ev = await db.getFirstAsync<{ title: string }>(
      "SELECT title FROM calendar_events WHERE id = 'ev-1'",
    );
    expect(ev?.title).toBe(TITULO);
    const ct = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM contacts WHERE id = 'ct-1'",
    );
    expect(ct?.name).toBe(NOMBRE);
    const nt = await db.getFirstAsync<{ kind: string; ref_id: string; state: string }>(
      "SELECT kind, ref_id, state FROM notices WHERE ref_id = 'ev-1'",
    );
    expect(nt?.kind).toBe("event");
    expect(nt?.state).toBe("armed");
  });

  it("el marcador de formato corre con su prueba propia", async () => {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    expect(row?.value).toBe(String(MEMORY_DB_SCHEMA_VERSION));
    await closeDatabase();
    const db2 = await getDatabase();
    const row2 = await db2.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version'",
    );
    expect(row2?.value).toBe(String(MEMORY_DB_SCHEMA_VERSION));
    // Una versión futura se rechaza fail-closed: el marcador manda.
    await db2.runAsync("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    await closeDatabase();
    await expect(getDatabase()).rejects.toBeInstanceOf(MemoryDbVersionError);
  });

  it("el fichero en disco no contiene en claro ni el título ni el nombre", async () => {
    await seedRows();
    await closeDatabase();
    const main = readFileSync(join(dir, "nido_memory.db"));
    expect(main.subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
    expect(main.includes(Buffer.from(TITULO))).toBe(false);
    expect(main.includes(Buffer.from(NOMBRE))).toBe(false);
    const walPath = join(dir, "nido_memory.db-wal");
    if (existsSync(walPath)) {
      const wal = readFileSync(walPath);
      expect(wal.includes(Buffer.from(TITULO))).toBe(false);
      expect(wal.includes(Buffer.from(NOMBRE))).toBe(false);
    }
  });
});
