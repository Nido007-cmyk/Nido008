/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryMigrations.ts — registro de migraciones de `nido_memory.db`.
 *
 * L1 nació vacío (sin migraciones v1→v2; `MEMORY_DB_SCHEMA_VERSION`
 * en 1) y `applyMigrations` se comportaba exactamente como el
 * `checkFormatVersion` anterior: acepta la versión, rechaza el
 * resto fail-closed.
 *
 * E10 (paso 6) registra la primera migración real, 1→2: la tabla
 * de las sesiones de investigación profunda. La misma sentencia
 * vive en el DDL unificado de `databaseManager.ts` (las
 * instalaciones nuevas nacen en v2 sin correr migración alguna,
 * porque la primera apertura estampa la versión soportada), y
 * aquí gobierna el camino de las instalaciones v1 que suben.
 * Las dos formas son la misma sentencia `IF NOT EXISTS`: la
 * tabla existe por cualquier camino y ninguna base se queda
 * sin ella.
 *
 * Cuando se necesite otro cambio de esquema no aditivo:
 *  1. subir `MEMORY_DB_SCHEMA_VERSION` en `formatVersion.ts`;
 *  2. añadir aquí `{ from: <vieja>, to: <nueva>, up }` con el DDL/DML;
 *  3. añadir un test en `dbMigrations.test.ts` (o un fixture) que abra una
 *     base vieja y verifique la migración.
 *
 * Ver `docs/architecture/TECH_DEBT.md` TD-5.
 */

import type { DbMigration, MigrationDb } from "./dbMigrations.js";

/** El DDL de las sesiones de investigación (E10, paso 6). */
export const RESEARCH_SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  lang TEXT NOT NULL,
  scope TEXT NOT NULL,
  style TEXT NOT NULL,
  stage TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

/** Migraciones de nido_memory.db, en orden de aplicación. */
export const MEMORY_MIGRATIONS: DbMigration[] = [
  {
    from: 1,
    to: 2,
    up: async (db: MigrationDb) => {
      await db.execAsync(RESEARCH_SESSIONS_DDL);
    },
  },
];
