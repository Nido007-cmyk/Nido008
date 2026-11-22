/**
 * Batería del paso 3 de E2 (migración en claro → cifrado): M-1 y M-2.
 * La principal nunca se sustituye hasta que la copia demuestra su
 * contenido (huella: esquema por sqlite_master + conteos por tabla);
 * tras un corte en cualquier estado, al rearrancar queda la original
 * en claro intacta o la cifrada completa, nunca un híbrido.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMarkerPath } from "./formatMarker.js";
import {
  RecoveryRequiredError,
  SimulatedCrashError,
  dbPaths,
  ensureEncryptedDatabase,
  getMigrationState,
  migratePlaintextToEncrypted,
  probeDbKind,
  recoverInterruptedMigration,
} from "./secureDatabase.js";

const NAME = "nido.db";
const CANARIO = "CANARIO-MIGRACION-3b7f::contenido que viaja de claro a cifrado::áéíóú";
const dek = randomBytes(32);

let dir: string;
let p: ReturnType<typeof dbPaths>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-mig-"));
  p = dbPaths(dir, NAME);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(`${dir}-ajena`, { recursive: true, force: true });
});

/** Una base en claro con esquema variado: AUTOINCREMENT, índice, FK y un blob. */
function createPlaintext(): void {
  const db = new Database(p.main);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE notas (id INTEGER PRIMARY KEY AUTOINCREMENT, cuerpo TEXT NOT NULL, datos BLOB);
    CREATE INDEX idx_cuerpo ON notas(cuerpo);
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE hijos (id INTEGER PRIMARY KEY, nota_id INTEGER NOT NULL REFERENCES notas(id), v TEXT);
  `);
  const ins = db.prepare("INSERT INTO notas (cuerpo, datos) VALUES (?, ?)");
  ins.run(CANARIO, Buffer.from([0, 1, 2, 250, 255]));
  ins.run("segunda nota", null);
  const tercera = ins.run("tercera que se borra", null);
  db.prepare("DELETE FROM notas WHERE id = ?").run(tercera.lastInsertRowid); // La secuencia queda por delante.
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("tema", "oscuro");
  db.prepare("INSERT INTO hijos (nota_id, v) VALUES (?, ?)").run(1, "hijo válido");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

function expectContentIntact(): void {
  const db = ensureEncryptedDatabase(dir, NAME, dek);
  const notas = db.prepare("SELECT id, cuerpo, datos FROM notas ORDER BY id").all() as Array<{
    id: number;
    cuerpo: string;
    datos: Buffer | null;
  }>;
  expect(notas.length).toBe(2);
  expect(notas[0].cuerpo).toBe(CANARIO);
  expect(notas[0].datos && [...notas[0].datos]).toEqual([0, 1, 2, 250, 255]);
  expect(notas[1].cuerpo).toBe("segunda nota");
  expect((db.prepare("SELECT v FROM meta WHERE k = 'tema'").get() as { v: string }).v).toBe("oscuro");
  expect((db.prepare("SELECT count(*) AS n FROM hijos").get() as { n: number }).n).toBe(1);
  // La secuencia de AUTOINCREMENT conserva el valor del origen (3), no el máximo id vivo (2).
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'notas'").get() as { seq: number };
  expect(seq.seq).toBe(3);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_cuerpo'").get();
  expect(idx).toBeTruthy();
  db.close();
}

describe("M-1 · migración completa", () => {
  it("en claro → cifrada: contenido íntegro, marcadores presentes, el claro desaparece y T-2 aplica", () => {
    createPlaintext();
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_REQUIRED");
    migratePlaintextToEncrypted(dir, NAME, dek);
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
    expect(existsSync(p.marker)).toBe(true);
    expect(existsSync(formatMarkerPath(p.main))).toBe(true);
    expect(existsSync(p.tmp)).toBe(false);
    expectContentIntact();
    // Ya no abre en claro ni con otra clave.
    expect(probeDbKind(p.main, null)).not.toBe("plaintext");
    expect(probeDbKind(p.main, randomBytes(32))).toBe("unreadable");
    // T-2 aplicable al resultado: el canario no está en los bytes.
    const raw = readFileSync(p.main);
    expect(raw.indexOf(Buffer.from(CANARIO, "utf8"))).toBe(-1);
    expect(raw.subarray(0, 16).toString("latin1")).not.toBe("SQLite format 3\0");
  });

  it("ensureEncryptedDatabase ejecuta la máquina entera desde el estado REQUIRED", () => {
    createPlaintext();
    expectContentIntact(); // ensure migra y abre.
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
  });

  it("sin base no hay migración: NOT_REQUIRED y ensure crea cifrada directamente", () => {
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_NOT_REQUIRED");
    const db = ensureEncryptedDatabase(dir, NAME, dek);
    db.exec("CREATE TABLE t (v TEXT)");
    db.close();
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
  });
});

describe("M-2 · migración interrumpida: nunca un híbrido ni una base vacía", () => {
  it("corte tras la copia (queda el temporal): la original en claro queda intacta y la recuperación completa", () => {
    createPlaintext();
    const bytesAntes = readFileSync(p.main);
    expect(() => migratePlaintextToEncrypted(dir, NAME, dek, { faultAt: "afterCopy" })).toThrow(SimulatedCrashError);
    // La original no se tocó y el estado se lee como en curso.
    expect(readFileSync(p.main).equals(bytesAntes)).toBe(true);
    expect(probeDbKind(p.main, null)).toBe("plaintext");
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_IN_PROGRESS");
    recoverInterruptedMigration(dir, NAME, dek);
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
    expectContentIntact();
    // Idempotente: recuperar otra vez (ya sin temporal) no rompe nada.
    expect(() => ensureEncryptedDatabase(dir, NAME, dek).close()).not.toThrow();
  });

  it("corte tras el rename (principal ya cifrada, sin marcadores): ensure cura los marcadores y abre", () => {
    createPlaintext();
    expect(() => migratePlaintextToEncrypted(dir, NAME, dek, { faultAt: "afterRename" })).toThrow(SimulatedCrashError);
    expect(existsSync(p.tmp)).toBe(false);
    expect(existsSync(p.marker)).toBe(false);
    expect(probeDbKind(p.main, dek)).toBe("encrypted");
    expectContentIntact(); // ensure verifica con la DEK y escribe los marcadores que faltan.
    expect(existsSync(formatMarkerPath(p.main))).toBe(true);
  });

  it("temporal que no abre con la DEK (basura): RECOVERY_REQUIRED y no se toca nada (arreglo D-1)", () => {
    createPlaintext();
    const bytesAntes = readFileSync(p.main);
    writeFileSync(p.tmp, randomBytes(8192)); // Basura no demostrable.
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_IN_PROGRESS");
    // Un temporal que no abre con la DEK dada es indistinguible de un
    // temporal VÁLIDO cifrado con otra clave: descartarlo y re-migrar
    // sellaría la principal con la clave que hubiera (D-1/E-02). La
    // recuperación falla cerrada y no toca ni la principal ni el temporal.
    expect(() => recoverInterruptedMigration(dir, NAME, dek)).toThrow(RecoveryRequiredError);
    expect(readFileSync(p.main).equals(bytesAntes)).toBe(true);
    expect(probeDbKind(p.main, null)).toBe("plaintext");
    expect(existsSync(p.tmp)).toBe(true);
  });

  it("D-1/E-02 · temporal VÁLIDO con la DEK buena y recuperación con la mala: RECOVERY_REQUIRED, nada se re-cifra y la buena completa después", () => {
    createPlaintext();
    const dekMala = randomBytes(32);
    const bytesAntes = readFileSync(p.main);
    // Corte tras la copia: queda el temporal cifrado válido con la DEK buena.
    expect(() => migratePlaintextToEncrypted(dir, NAME, dek, { faultAt: "afterCopy" })).toThrow(SimulatedCrashError);
    expect(existsSync(p.tmp)).toBe(true);
    // La recuperación con la DEK equivocada NO descarta el temporal ni
    // re-migra la principal con la clave mala (eso cazó la auditoría).
    expect(() => recoverInterruptedMigration(dir, NAME, dekMala)).toThrow(RecoveryRequiredError);
    expect(readFileSync(p.main).equals(bytesAntes)).toBe(true); // La principal sigue en claro, intacta.
    expect(probeDbKind(p.main, null)).toBe("plaintext");
    expect(existsSync(p.tmp)).toBe(true); // El temporal válido sigue ahí.
    // Y con la DEK buena, la misma recuperación completa la migración.
    recoverInterruptedMigration(dir, NAME, dek);
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
    expectContentIntact();
  });

  it("temporal que SÍ abre con la DEK pero es de otro contenido (E-10): se descarta y manda la principal", () => {
    createPlaintext();
    // Temporal válido de OTRA base con la misma DEK (construido migrando
    // otra principal en otro directorio y copiando su .migtmp).
    const dirAj = `${dir}-ajena`;
    mkdirSync(dirAj, { recursive: true });
    const pAj = dbPaths(dirAj, "otra.db");
    const plainAj = new Database(pAj.main);
    plainAj.exec("CREATE TABLE ajena (w TEXT)");
    plainAj.prepare("INSERT INTO ajena (w) VALUES (?)").run("dato-ajeno");
    plainAj.close();
    expect(() => migratePlaintextToEncrypted(dirAj, "otra.db", dek, { faultAt: "afterCopy" })).toThrow(SimulatedCrashError);
    writeFileSync(p.tmp, readFileSync(pAj.tmp));
    recoverInterruptedMigration(dir, NAME, dek);
    expect(getMigrationState(dir, NAME, dek)).toBe("MIGRATION_COMPLETE");
    expectContentIntact(); // El dato servido es el de la principal, no el ajeno.
  });

  it("principal ilegible con temporal presente: RECOVERY_REQUIRED y no se toca nada", () => {
    createPlaintext();
    // Deja un temporal válido (de esta principal antes de corromperla).
    expect(() => migratePlaintextToEncrypted(dir, NAME, dek, { faultAt: "afterCopy" })).toThrow(SimulatedCrashError);
    // La principal se sustituye por basura (ilegible): el temporal ya no
    // puede demostrar que contiene SU contenido.
    writeFileSync(p.main, randomBytes(8192));
    const mainAntes = readFileSync(p.main);
    expect(() => recoverInterruptedMigration(dir, NAME, dek)).toThrow(RecoveryRequiredError);
    expect(readFileSync(p.main).equals(mainAntes)).toBe(true); // Nada se promovió ni se borró.
    expect(existsSync(p.tmp)).toBe(true);
  });
});
