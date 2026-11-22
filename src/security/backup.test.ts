/**
 * Batería del paso 5 de E2 (respaldo y restauración): el T-3 DE
 * RESTAURACIÓN de la etapa (restaurar un respaldo en otro directorio y
 * abrir los datos con la custodia local), la puerta de bóveda (B-3 del
 * diseño: sin desbloqueo no hay respaldo), la normalización de la clave
 * (B-1/B-2 en su forma de esta casa: huella y versión) y el aviso previo.
 */

import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BackupError,
  BackupTooNewError,
  backupCreationNoticeText,
  createBackup,
  exportDatabaseKey,
  legacyBackupWarningText,
  normalizeBackupKey,
  readBackupContainer,
  restoreBackup,
  restoreNoticeText,
} from "./backup.js";
import {
  PasswordCustodyProvider,
  SCRYPT_MAXMEM,
  initializeVault,
  unlockVaultWith,
  vaultBlobPath,
  type WrappedBlob,
} from "./keyVault.js";
import { formatMarkerPath } from "./formatMarker.js";
import { openSecureDatabase } from "./secureDatabase.js";
import { VaultSession } from "./vaultSession.js";

const HEAVY = { timeout: 180_000 };
const HEAVY_MS = 180_000; // Los hooks toman el timeout como número.
const PASS_A = "contrasena-del-origen · prueba";
const PASS_B = "contrasena-del-destino · prueba distinta";
const PASS_BK = "contrasena-del-respaldo · prueba";
const CANARIO_ORIGEN = "CANARIO-RESPALDO-91c2::dato que viaja en el respaldo";
const DATO_DESTINO = "dato propio del destino que la restauración sustituye";
const DB = "nido.db";

let dirA: string;
let dirB: string;
let backupPath: string;
let sessionA: VaultSession;
let dekA: Buffer;

beforeAll(async () => {
  dirA = await mkdtemp(path.join(os.tmpdir(), "nido-e2-bk-a-"));
  dirB = await mkdtemp(path.join(os.tmpdir(), "nido-e2-bk-b-"));
  backupPath = path.join(dirA, "respaldo.nidobak");
  // Origen: bóveda + base con el canario.
  await initializeVault(dirA, new PasswordCustodyProvider(PASS_A));
  sessionA = await VaultSession.unlock(dirA, [new PasswordCustodyProvider(PASS_A)]);
  dekA = Buffer.from(sessionA.dek);
  const db = openSecureDatabase(path.join(dirA, DB), sessionA.dek);
  db.exec("CREATE TABLE t (v TEXT NOT NULL)");
  db.prepare("INSERT INTO t VALUES (?)").run(CANARIO_ORIGEN);
  db.close();
  // Destino: bóveda propia (otra contraseña) y su propio dato.
  await initializeVault(dirB, new PasswordCustodyProvider(PASS_B));
  const sessionB = await VaultSession.unlock(dirB, [new PasswordCustodyProvider(PASS_B)]);
  const dbB = openSecureDatabase(path.join(dirB, DB), sessionB.dek);
  dbB.exec("CREATE TABLE t (v TEXT NOT NULL)");
  dbB.prepare("INSERT INTO t VALUES (?)").run(DATO_DESTINO);
  dbB.close();
  sessionB.lock();
}, HEAVY_MS);

afterAll(async () => {
  sessionA.lock();
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
});

describe("puerta de bóveda y clave del respaldo", () => {
  it("sin la bóveda desbloqueada no se crea respaldo", HEAVY, async () => {
    const sessionBloqueada = await VaultSession.unlock(dirA, [new PasswordCustodyProvider(PASS_A)]);
    sessionBloqueada.lock();
    await expect(
      createBackup({ dir: dirA, dbNames: [DB], session: sessionBloqueada, destPath: backupPath, backupPassword: PASS_BK }),
    ).rejects.toThrow(BackupError);
    expect(existsSync(backupPath)).toBe(false);
  });

  it("la vía legada (formato 1): exportDatabaseKey da el hex en minúsculas y normalizeBackupKey lo acepta con espacios, guiones y mayúsculas", () => {
    const hex = exportDatabaseKey(dekA);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const conRuido = ` ${hex.toUpperCase().match(/.{1,8}/g)?.join("-")} `;
    expect(normalizeBackupKey(conRuido).equals(dekA)).toBe(true);
    expect(() => normalizeBackupKey("abcd")).toThrow(BackupError);
    expect(() => normalizeBackupKey("z".repeat(64))).toThrow(BackupError);
  });

  it("el manifiesto v2 declara sha256 sobre bytes, el marcador viaja y la DEK va envuelta (keyWrap), nunca en claro", async () => {
    const manifest = await createBackup({
      dir: dirA,
      dbNames: [DB],
      session: sessionA,
      destPath: backupPath,
      backupPassword: PASS_BK,
    });
    expect(manifest.version).toBe(2);
    expect(manifest.keyWrap.provider).toBe("contrasena");
    expect(manifest.keyWrap.params).toMatchObject({ kdf: "scrypt", n: 2 ** 17, r: 8, p: 1 });
    expect("databaseKeyHex" in manifest).toBe(false);
    expect(manifest.entries.map((e) => e.path)).toEqual([DB, `${DB}.format.json`]);
    for (const e of manifest.entries) expect(e.sha256Kind).toBe("bytes");
    const { payloads } = readBackupContainer(backupPath);
    expect(payloads.get(DB)?.length).toBeGreaterThan(0);
  });
});

describe("T-3 · restauración desde el respaldo", () => {
  it("sin aceptar el aviso no se restaura nada y el destino queda intacto", HEAVY, async () => {
    await expect(
      restoreBackup({
        srcPath: backupPath,
        dir: dirB,
        providers: [new PasswordCustodyProvider(PASS_B)],
        noticeAccepted: false,
        backupPassword: PASS_BK,
      }),
    ).rejects.toThrow(BackupError);
    const { dek } = await unlockVaultWith(dirB, [new PasswordCustodyProvider(PASS_B)]);
    const db = openSecureDatabase(path.join(dirB, DB), dek);
    expect((db.prepare("SELECT v FROM t").get() as { v: string }).v).toBe(DATO_DESTINO);
    db.close();
  });

  it("restaurar trae los datos del origen y la custodia LOCAL los abre con su credencial", HEAVY, async () => {
    const sessionB = await VaultSession.unlock(dirB, [new PasswordCustodyProvider(PASS_B)]);
    const result = await restoreBackup({
      srcPath: backupPath,
      dir: dirB,
      providers: [new PasswordCustodyProvider(PASS_B)],
      session: sessionB,
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.restored).toEqual([DB]);
    expect(result.legacyCleartextKey).toBe(false);
    // La sesión del destino adoptó la DEK restaurada (la del origen).
    expect(sessionB.dek.equals(dekA)).toBe(true);
    const db = openSecureDatabase(path.join(dirB, DB), sessionB.dek);
    expect((db.prepare("SELECT v FROM t").get() as { v: string }).v).toBe(CANARIO_ORIGEN);
    db.close();
    sessionB.lock();
    // Y la bóveda del destino, con SU contraseña, desenvuelve la DEK restaurada.
    const { dek } = await unlockVaultWith(dirB, [new PasswordCustodyProvider(PASS_B)]);
    expect(dek.equals(dekA)).toBe(true);
    // La contraseña del origen NO abre la bóveda del destino.
    await expect(unlockVaultWith(dirB, [new PasswordCustodyProvider(PASS_A)])).rejects.toThrow();
    // Sin ficheros de rollback colgando.
    expect(existsSync(path.join(dirB, `${DB}.pre-restore-bak`))).toBe(false);
  });
});

describe("integridad y versión del respaldo", () => {
  it("un byte manipulado en la carga: la huella lo caza y no se entrega nada", () => {
    const raw = Buffer.from(readFileSync(backupPath));
    raw[raw.length - 5] ^= 0xff;
    const tampered = path.join(dirA, "manipulado.nidobak");
    writeFileSync(tampered, raw);
    expect(() => readBackupContainer(tampered)).toThrow(BackupError);
  });

  it("una versión de respaldo más nueva se rechaza como tooNew, no se restaura a ciegas", () => {
    const raw = readFileSync(backupPath);
    const headerLen = raw.readUInt32LE(4);
    const manifest = JSON.parse(raw.subarray(8, 8 + headerLen).toString("utf8")) as { version: number };
    manifest.version = 99;
    const header = Buffer.from(JSON.stringify(manifest), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length, 0);
    const future = path.join(dirA, "futuro.nidobak");
    writeFileSync(future, Buffer.concat([raw.subarray(0, 4), len, header, raw.subarray(8 + headerLen)]));
    expect(() => readBackupContainer(future)).toThrow(BackupTooNewError);
  });

  it("el aviso de restauración dice lo que la restauración hace, y los dos textos nuevos de A-3 van en su letra exacta", () => {
    expect(restoreNoticeText()).toContain("sustituye");
    expect(backupCreationNoticeText()).toBe(
      "Este respaldo queda cerrado con su propia contraseña de respaldo: sin ella, el fichero no se abre y los datos no se pueden recuperar. Guárdala en un sitio seguro: NIDO no la conoce y no puede restablecerla. Quien tenga el fichero sin la contraseña no puede leer nada de lo que lleva.",
    );
    expect(legacyBackupWarningText()).toBe(
      "Este respaldo es de un formato antiguo: lleva su clave en claro dentro del fichero, así que cualquiera que lo tenga puede leer los datos que trae. Cuando termines de restaurar, crea un respaldo nuevo, que sí va cerrado con contraseña, y borra este fichero.",
    );
  });
});

describe("arreglos ATAQUE-4 · duplicados, lista blanca, rollback con sidecars, custodia verificada", () => {
  const PASS_V = "contrasena-de-la-victima · prueba";
  const extraDirs: string[] = [];

  /** Construye un contenedor LEGADO (formato 1) con entradas arbitrarias y huellas honestas. */
  function buildContainer(dest: string, keyHex: string, entries: Array<{ path: string; data: Buffer }>): void {
    const manifest = {
      format: "nido-pc-backup",
      version: 1,
      createdAt: "2026-11-16T00:00:00.000Z",
      app: "nido-pc",
      databaseKeyHex: keyHex,
      entries: entries.map((e) => ({
        path: e.path,
        bytes: e.data.length,
        sha256: createHash("sha256").update(e.data).digest("hex"),
        sha256Kind: "bytes",
      })),
    };
    const header = Buffer.from(JSON.stringify(manifest), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length, 0);
    writeFileSync(dest, Buffer.concat([Buffer.from("NID1", "latin1"), len, header, ...entries.map((e) => e.data)]));
  }

  /** Una víctima fresca: bóveda propia y una base con las filas dadas. */
  async function makeVictim(rows: string[]): Promise<{ dir: string; dek: Buffer }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-ataque4-bk-"));
    extraDirs.push(dir);
    await initializeVault(dir, new PasswordCustodyProvider(PASS_V));
    const s = await VaultSession.unlock(dir, [new PasswordCustodyProvider(PASS_V)]);
    const db = openSecureDatabase(path.join(dir, DB), s.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    for (const r of rows) db.prepare("INSERT INTO t VALUES (?)").run(r);
    db.close();
    const dek = Buffer.from(s.dek);
    s.lock();
    return { dir, dek };
  }

  function rowsOf(dir: string, dek: Buffer): string[] {
    const db = openSecureDatabase(path.join(dir, DB), dek);
    const rows = db.prepare("SELECT v FROM t ORDER BY rowid").all() as Array<{ v: string }>;
    db.close();
    return rows.map((r) => r.v);
  }

  afterAll(async () => {
    for (const d of extraDirs) await rm(d, { recursive: true, force: true });
  });

  it("D-3/F-08b · un manifiesto con la base DUPLICADA se rechaza en la lectura y la víctima queda intacta", HEAVY, async () => {
    const victim = await makeVictim(["dato-victima-d3"]);
    const dbBytes = readFileSync(path.join(dirA, DB));
    const dup = path.join(victim.dir, "duplicado.nidobak");
    buildContainer(dup, exportDatabaseKey(dekA), [
      { path: DB, data: dbBytes },
      { path: DB, data: dbBytes },
    ]);
    expect(() => readBackupContainer(dup)).toThrow(BackupError);
    await expect(
      restoreBackup({ srcPath: dup, dir: victim.dir, providers: [new PasswordCustodyProvider(PASS_V)], noticeAccepted: true }),
    ).rejects.toThrow(BackupError);
    expect(rowsOf(victim.dir, victim.dek)).toEqual(["dato-victima-d3"]);
    expect(readdirSync(victim.dir).some((n) => n.includes("pre-restore-bak"))).toBe(false);
  });

  it("D-7/F-13d · una entrada staging fuera de la lista blanca se rechaza y no se planta en la víctima", HEAVY, async () => {
    const victim = await makeVictim(["dato-victima-d7"]);
    const dbBytes = readFileSync(path.join(dirA, DB));
    const forged = path.join(victim.dir, "con-staging.nidobak");
    buildContainer(forged, exportDatabaseKey(dekA), [
      { path: DB, data: dbBytes },
      { path: `${DB}.format.json`, data: readFileSync(formatMarkerPath(path.join(dirA, DB))) },
      { path: "nido-rotation-staging.json", data: dbBytes }, // Carga de base válida, nombre prohibido.
    ]);
    await expect(
      restoreBackup({ srcPath: forged, dir: victim.dir, providers: [new PasswordCustodyProvider(PASS_V)], noticeAccepted: true }),
    ).rejects.toThrow(BackupError);
    expect(existsSync(path.join(victim.dir, "nido-rotation-staging.json"))).toBe(false);
    expect(rowsOf(victim.dir, victim.dek)).toEqual(["dato-victima-d7"]);
  });

  it("D-2/F-14 · un fallo TARDE (sin proveedores) deshace la sustitución y el destino conserva hasta su fila solo-en-WAL", HEAVY, async () => {
    // Víctima con una fila consolidada y otra SOLO en su -wal.
    const srcDir = await mkdtemp(path.join(os.tmpdir(), "nido-ataque4-wal-"));
    extraDirs.push(srcDir);
    await initializeVault(srcDir, new PasswordCustodyProvider(PASS_V));
    const sV = await VaultSession.unlock(srcDir, [new PasswordCustodyProvider(PASS_V)]);
    const dekV = Buffer.from(sV.dek);
    const db = openSecureDatabase(path.join(srcDir, DB), sV.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db.prepare("INSERT INTO t VALUES (?)").run("fila-consolidada");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("wal_autocheckpoint = 0");
    db.prepare("INSERT INTO t VALUES (?)").run("fila-solo-en-wal");
    // Copia en caliente a un directorio limpio, SIN cerrar el handle.
    const victimDir = await mkdtemp(path.join(os.tmpdir(), "nido-ataque4-wal-dest-"));
    extraDirs.push(victimDir);
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) copyFileSync(path.join(srcDir, f), path.join(victimDir, f));
    copyFileSync(formatMarkerPath(path.join(srcDir, DB)), formatMarkerPath(path.join(victimDir, DB)));
    copyFileSync(vaultBlobPath(srcDir), vaultBlobPath(victimDir));
    db.close();
    sV.lock();

    // La restauración sustituye y falla al final: sin proveedores no hay re-envoltura.
    await expect(
      restoreBackup({ srcPath: backupPath, dir: victimDir, providers: [], noticeAccepted: true, backupPassword: PASS_BK }),
    ).rejects.toThrow(BackupError);
    // El rollback devolvió principal, -wal y bóveda: las DOS filas viven.
    const { dek } = await unlockVaultWith(victimDir, [new PasswordCustodyProvider(PASS_V)]);
    expect(dek.equals(dekV)).toBe(true);
    expect(rowsOf(victimDir, dek)).toEqual(["fila-consolidada", "fila-solo-en-wal"]);
    expect(readdirSync(victimDir).some((n) => n.includes("pre-restore-bak"))).toBe(false);
  });

  it("D-4 · un proveedor que envuelve OTRA clave en la restauración: se rechaza y la víctima queda íntegra con su bóveda buena", HEAVY, async () => {
    class ProveedorMentiroso extends PasswordCustodyProvider {
      override async wrap(): Promise<WrappedBlob> {
        return super.wrap(randomBytes(32));
      }
    }
    const victim = await makeVictim(["dato-victima-d4"]);
    await expect(
      restoreBackup({
        srcPath: backupPath,
        dir: victim.dir,
        providers: [new ProveedorMentiroso(PASS_V)],
        noticeAccepted: true,
        backupPassword: PASS_BK,
      }),
    ).rejects.toThrow(BackupError);
    expect(rowsOf(victim.dir, victim.dek)).toEqual(["dato-victima-d4"]);
    const { dek } = await unlockVaultWith(victim.dir, [new PasswordCustodyProvider(PASS_V)]);
    expect(dek.equals(victim.dek)).toBe(true);
  });

  it("D-9 · el resultado de una restauración buena DECLARA el nivel de custodia usado", HEAVY, async () => {
    const victim = await makeVictim(["dato-victima-d9"]);
    const result = await restoreBackup({
      srcPath: backupPath,
      dir: victim.dir,
      providers: [new PasswordCustodyProvider(PASS_V)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.custodyLevel).toBe("contrasena");
    expect(result.restored).toEqual([DB]);
  });

  it("D-6 · el aviso previo nombra el límite de autenticidad del respaldo", () => {
    const aviso = restoreNoticeText();
    expect(aviso).toContain("sustituye");
    expect(aviso).toContain("bajo tu custodia");
    expect(aviso).toContain("no puede verificar quién lo creó");
  });
});

describe("A-3 · formato 2 (keyWrap) y M-3 · bases huérfanas en el destino", () => {
  const PASS_O = "contrasena-del-origen-v2 · prueba";
  const PASS_D = "contrasena-del-destino-v2 · prueba";
  const DB2 = "memoria.db";
  const CANARIO_O = "CANARIO-V2-ORIGEN::dato del origen en formato 2";
  const CANARIO_O2 = "CANARIO-V2-MEMORIA::segunda base del origen";
  const extraDirs: string[] = [];
  let dirO: string;
  let dekO: Buffer;
  let sessionO: VaultSession;
  let backupV2: string;
  let backupV2Solo: string;

  /** Envoltura construida en la batería con la derivación sellada y AES-GCM, sin pasar por el wrap() gobernado. */
  function fixtureWrap(dek: Buffer, password: string, n: number = 2 ** 17): WrappedBlob {
    const salt = randomBytes(16);
    const kek = scryptSync(password, salt, 32, { N: n, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, nonce);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    kek.fill(0);
    return {
      version: 1,
      provider: "contrasena",
      createdAt: new Date().toISOString(),
      params: { kdf: "scrypt", n, r: 8, p: 1, salt: salt.toString("base64") },
      wrapped: Buffer.concat([nonce, ct, tag]).toString("base64"),
    };
  }

  function buildContainerV2(dest: string, keyWrap: WrappedBlob, entries: Array<{ path: string; data: Buffer }>): void {
    const manifest = {
      format: "nido-pc-backup",
      version: 2,
      createdAt: "2026-11-19T00:00:00.000Z",
      app: "nido-pc",
      keyWrap,
      entries: entries.map((e) => ({
        path: e.path,
        bytes: e.data.length,
        sha256: createHash("sha256").update(e.data).digest("hex"),
        sha256Kind: "bytes",
      })),
    };
    const header = Buffer.from(JSON.stringify(manifest), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length, 0);
    writeFileSync(dest, Buffer.concat([Buffer.from("NID1", "latin1"), len, header, ...entries.map((e) => e.data)]));
  }

  function buildContainerV1(dest: string, keyHex: string, entries: Array<{ path: string; data: Buffer }>): void {
    const manifest = {
      format: "nido-pc-backup",
      version: 1,
      createdAt: "2026-11-19T00:00:00.000Z",
      app: "nido-pc",
      databaseKeyHex: keyHex,
      entries: entries.map((e) => ({
        path: e.path,
        bytes: e.data.length,
        sha256: createHash("sha256").update(e.data).digest("hex"),
        sha256Kind: "bytes",
      })),
    };
    const header = Buffer.from(JSON.stringify(manifest), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length, 0);
    writeFileSync(dest, Buffer.concat([Buffer.from("NID1", "latin1"), len, header, ...entries.map((e) => e.data)]));
  }

  /** Un destino fresco: bóveda propia y las bases dadas, cada una con sus filas. */
  async function makeDest(dbs: Array<{ name: string; rows: string[] }>): Promise<{ dir: string; dek: Buffer }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-a3-dest-"));
    extraDirs.push(dir);
    await initializeVault(dir, new PasswordCustodyProvider(PASS_D));
    const s = await VaultSession.unlock(dir, [new PasswordCustodyProvider(PASS_D)]);
    for (const { name, rows } of dbs) {
      const db = openSecureDatabase(path.join(dir, name), s.dek);
      db.exec("CREATE TABLE t (v TEXT NOT NULL)");
      for (const r of rows) db.prepare("INSERT INTO t VALUES (?)").run(r);
      db.close();
    }
    const dek = Buffer.from(s.dek);
    s.lock();
    return { dir, dek };
  }

  function rowsOf(dir: string, dek: Buffer, name: string = DB): string[] {
    const db = openSecureDatabase(path.join(dir, name), dek);
    const rows = db.prepare("SELECT v FROM t ORDER BY rowid").all() as Array<{ v: string }>;
    db.close();
    return rows.map((r) => r.v);
  }

  /** Huella de cada fichero del directorio: la foto para probar «intacto al byte». */
  function dirHashes(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const name of readdirSync(dir).sort()) {
      out.set(name, createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex"));
    }
    return out;
  }

  beforeAll(async () => {
    dirO = await mkdtemp(path.join(os.tmpdir(), "nido-a3-origen-"));
    extraDirs.push(dirO);
    await initializeVault(dirO, new PasswordCustodyProvider(PASS_O));
    sessionO = await VaultSession.unlock(dirO, [new PasswordCustodyProvider(PASS_O)]);
    dekO = Buffer.from(sessionO.dek);
    const db = openSecureDatabase(path.join(dirO, DB), sessionO.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db.prepare("INSERT INTO t VALUES (?)").run(CANARIO_O);
    db.close();
    const db2 = openSecureDatabase(path.join(dirO, DB2), sessionO.dek);
    db2.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db2.prepare("INSERT INTO t VALUES (?)").run(CANARIO_O2);
    db2.close();
    backupV2 = path.join(dirO, "respaldo-v2.nidobak");
    await createBackup({ dir: dirO, dbNames: [DB, DB2], session: sessionO, destPath: backupV2, backupPassword: PASS_BK });
    backupV2Solo = path.join(dirO, "respaldo-v2-solo.nidobak");
    await createBackup({ dir: dirO, dbNames: [DB], session: sessionO, destPath: backupV2Solo, backupPassword: PASS_BK });
  }, HEAVY_MS);

  afterAll(async () => {
    sessionO.lock();
    for (const d of extraDirs) await rm(d, { recursive: true, force: true });
  });

  it("A-3 · sin clave en claro en ninguna forma: el contenedor entero no lleva la DEK y el keyWrap va con los parámetros sellados", () => {
    const raw = readFileSync(backupV2);
    expect(raw.includes(Buffer.from(dekO.toString("hex"), "utf8"))).toBe(false);
    expect(raw.includes(Buffer.from(dekO.toString("base64"), "utf8"))).toBe(false);
    expect(raw.includes(Buffer.from("databaseKeyHex", "utf8"))).toBe(false);
    const { manifest } = readBackupContainer(backupV2);
    if (manifest.version !== 2) throw new Error("el respaldo creado no es formato 2");
    expect(manifest.keyWrap.provider).toBe("contrasena");
    expect(manifest.keyWrap.params).toMatchObject({ kdf: "scrypt", n: 2 ** 17, r: 8, p: 1 });
    expect(Buffer.from(manifest.keyWrap.params!.salt, "base64").length).toBe(16);
  });

  it("A-3 · T-3 en v2: restaurar con la contraseña de respaldo trae los datos y declara legacyCleartextKey false", HEAVY, async () => {
    const dest = await makeDest([{ name: DB, rows: ["dato-propio-del-destino"] }]);
    const result = await restoreBackup({
      srcPath: backupV2,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.restored).toEqual([DB, DB2]);
    expect(result.legacyCleartextKey).toBe(false);
    const { dek } = await unlockVaultWith(dest.dir, [new PasswordCustodyProvider(PASS_D)]);
    expect(dek.equals(dekO)).toBe(true);
    expect(rowsOf(dest.dir, dek, DB)).toEqual([CANARIO_O]);
    expect(rowsOf(dest.dir, dek, DB2)).toEqual([CANARIO_O2]);
  });

  it("A-3 · contraseña de respaldo equivocada: rechaza y el destino queda intacto al byte", HEAVY, async () => {
    const dest = await makeDest([{ name: DB, rows: ["dato-que-no-se-toca"] }]);
    const antes = dirHashes(dest.dir);
    await expect(
      restoreBackup({
        srcPath: backupV2Solo,
        dir: dest.dir,
        providers: [new PasswordCustodyProvider(PASS_D)],
        noticeAccepted: true,
        backupPassword: "contrasena-equivocada · prueba",
      }),
    ).rejects.toThrow(BackupError);
    expect(dirHashes(dest.dir)).toEqual(antes);
    expect(rowsOf(dest.dir, dest.dek)).toEqual(["dato-que-no-se-toca"]);
  });

  it("A-3 · un v2 sin contraseña de respaldo se rechaza antes de tocar nada", HEAVY, async () => {
    const dest = await makeDest([{ name: DB, rows: ["dato-sin-tocar"] }]);
    const antes = dirHashes(dest.dir);
    await expect(
      restoreBackup({
        srcPath: backupV2Solo,
        dir: dest.dir,
        providers: [new PasswordCustodyProvider(PASS_D)],
        noticeAccepted: true,
      }),
    ).rejects.toThrow(BackupError);
    expect(dirHashes(dest.dir)).toEqual(antes);
  });

  it("A-3 · el ataque del fichero solo: con todo campo con forma de clave del contenedor, ninguna vía abre la base", HEAVY, async () => {
    const { manifest, payloads } = readBackupContainer(backupV2);
    if (manifest.version !== 2) throw new Error("se esperaba un manifiesto v2");
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-a3-ataque-"));
    extraDirs.push(dir);
    const dbPath = path.join(dir, DB);
    writeFileSync(dbPath, payloads.get(DB) as Buffer);
    writeFileSync(formatMarkerPath(dbPath), payloads.get(`${DB}.format.json`) as Buffer);
    // Control: con la DEK de verdad, la copia abre y trae el canario.
    expect(rowsOf(dir, dekO)).toEqual([CANARIO_O]);
    const raw = readFileSync(backupV2);
    const headerLen = raw.readUInt32LE(4);
    const candidatos: Array<[string, Buffer]> = [
      ["la envoltura cruda (sus primeros 32 bytes)", Buffer.from(manifest.keyWrap.wrapped, "base64").subarray(0, 32)],
      ["la huella de la cabecera entera", createHash("sha256").update(raw.subarray(8, 8 + headerLen)).digest()],
      ["la huella de la envoltura en base64", createHash("sha256").update(manifest.keyWrap.wrapped, "utf8").digest()],
      ["la sal de la envoltura (16 bytes)", Buffer.from(manifest.keyWrap.params!.salt, "base64")],
    ];
    for (const [nombre, candidato] of candidatos) {
      expect(() => openSecureDatabase(dbPath, candidato), nombre).toThrow();
    }
  });

  it("A-3 · el legado v1 restaura desde su cabecera y el resultado declara legacyCleartextKey true", HEAVY, async () => {
    const legado = path.join(dirO, "respaldo-v1.nidobak");
    buildContainerV1(legado, exportDatabaseKey(dekO), [
      { path: DB, data: readFileSync(path.join(dirO, DB)) },
      { path: `${DB}.format.json`, data: readFileSync(formatMarkerPath(path.join(dirO, DB))) },
    ]);
    const dest = await makeDest([{ name: DB, rows: ["dato-del-destino-legado"] }]);
    const result = await restoreBackup({
      srcPath: legado,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
    });
    expect(result.legacyCleartextKey).toBe(true);
    expect(result.restored).toEqual([DB]);
    const { dek } = await unlockVaultWith(dest.dir, [new PasswordCustodyProvider(PASS_D)]);
    expect(rowsOf(dest.dir, dek)).toEqual([CANARIO_O]);
  });

  it("A-3 · crear sin contraseña de respaldo no crea fichero", HEAVY, async () => {
    const destPath = path.join(dirO, "sin-contrasena.nidobak");
    await expect(
      createBackup({ dir: dirO, dbNames: [DB], session: sessionO, destPath, backupPassword: "" }),
    ).rejects.toThrow(BackupError);
    expect(existsSync(destPath)).toBe(false);
  });

  it("A-3 · parámetros de derivación rebajados en el keyWrap: se rechazan en la lectura del contenedor, sin desenvolver", () => {
    const rebajado = path.join(dirO, "rebajado.nidobak");
    const { payloads } = readBackupContainer(backupV2);
    buildContainerV2(rebajado, fixtureWrap(dekO, PASS_BK, 2 ** 16), [
      { path: DB, data: payloads.get(DB) as Buffer },
      { path: `${DB}.format.json`, data: payloads.get(`${DB}.format.json`) as Buffer },
    ]);
    expect(() => readBackupContainer(rebajado)).toThrow(BackupError);
  });

  it("M-3 · una base huérfana en el destino se nombra en el rechazo y el destino queda intacto al byte", HEAVY, async () => {
    const dest = await makeDest([
      { name: DB, rows: ["dato-del-destino-m3"] },
      { name: "otra.db", rows: ["dato-huerfano"] },
    ]);
    const antes = dirHashes(dest.dir);
    const err = await restoreBackup({
      srcPath: backupV2Solo,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as Error).message).toContain("otra.db");
    expect(dirHashes(dest.dir)).toEqual(antes);
    expect(rowsOf(dest.dir, dest.dek, "otra.db")).toEqual(["dato-huerfano"]);
    expect(rowsOf(dest.dir, dest.dek, DB)).toEqual(["dato-del-destino-m3"]);
  });

  it("M-3 · control: si el destino solo guarda lo respaldado, la restauración pasa", HEAVY, async () => {
    const dest = await makeDest([{ name: DB, rows: ["dato-a-sustituir"] }]);
    const result = await restoreBackup({
      srcPath: backupV2Solo,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.restored).toEqual([DB]);
    const { dek } = await unlockVaultWith(dest.dir, [new PasswordCustodyProvider(PASS_D)]);
    expect(rowsOf(dest.dir, dek)).toEqual([CANARIO_O]);
  });

  it("M-3 · destino vacío (solo la bóveda): la restauración pasa y la base nace del respaldo", HEAVY, async () => {
    const dest = await makeDest([]);
    const result = await restoreBackup({
      srcPath: backupV2Solo,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.restored).toEqual([DB]);
    const { dek } = await unlockVaultWith(dest.dir, [new PasswordCustodyProvider(PASS_D)]);
    expect(rowsOf(dest.dir, dek)).toEqual([CANARIO_O]);
  });

  it("M-3 · todo lo gestionado del destino viaja en el respaldo: la restauración pasa y sustituye las dos bases", HEAVY, async () => {
    const dest = await makeDest([
      { name: DB, rows: ["propio-1"] },
      { name: DB2, rows: ["propio-2"] },
    ]);
    const result = await restoreBackup({
      srcPath: backupV2,
      dir: dest.dir,
      providers: [new PasswordCustodyProvider(PASS_D)],
      noticeAccepted: true,
      backupPassword: PASS_BK,
    });
    expect(result.restored).toEqual([DB, DB2]);
    const { dek } = await unlockVaultWith(dest.dir, [new PasswordCustodyProvider(PASS_D)]);
    expect(rowsOf(dest.dir, dek, DB)).toEqual([CANARIO_O]);
    expect(rowsOf(dest.dir, dek, DB2)).toEqual([CANARIO_O2]);
  });
});

describe("B-7 · el mínimo en el respaldo: al crearlo sí, al restaurarlo no", () => {
  const PASS_C = "contrasena-de-la-boveda-b7 · prueba";
  const PASS_E = "contrasena-del-destino-b7 · prueba";
  const CORTA = "1234567";
  const CANARIO_B7 = "CANARIO-B7::respaldo envuelto con contraseña corta";
  const extraDirs: string[] = [];

  /** Envoltura por la vía de fixture (derivación sellada + AES-GCM), sin pasar por el wrap() gobernado. */
  function fixtureWrapCorta(dek: Buffer, password: string): WrappedBlob {
    const salt = randomBytes(16);
    const kek = scryptSync(password, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, nonce);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    kek.fill(0);
    return {
      version: 1,
      provider: "contrasena",
      createdAt: new Date().toISOString(),
      params: { kdf: "scrypt", n: 2 ** 17, r: 8, p: 1, salt: salt.toString("base64") },
      wrapped: Buffer.concat([nonce, ct, tag]).toString("base64"),
    };
  }

  afterAll(async () => {
    for (const d of extraDirs) await rm(d, { recursive: true, force: true });
  });

  it("crear un respaldo v2 con contraseña de respaldo de menos de 8 rechaza y no deja respaldo", HEAVY, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-b7-bk-"));
    extraDirs.push(dir);
    await initializeVault(dir, new PasswordCustodyProvider(PASS_C));
    const session = await VaultSession.unlock(dir, [new PasswordCustodyProvider(PASS_C)]);
    const db = openSecureDatabase(path.join(dir, DB), session.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db.prepare("INSERT INTO t VALUES (?)").run(CANARIO_B7);
    db.close();
    const destPath = path.join(dir, "respaldo-corto.nidobak");
    await expect(
      createBackup({ dir, dbNames: [DB], session, destPath, backupPassword: CORTA }),
    ).rejects.toThrow();
    expect(existsSync(destPath)).toBe(false);
    session.lock();
  });

  it("la restauración no examina: un v2 cuya envoltura se hizo con contraseña corta por la vía de fixture restaura con esa contraseña", HEAVY, async () => {
    // Origen: una base con su DEK, y el contenedor v2 montado a mano
    // con la envoltura hecha por fixture con la contraseña corta.
    const dirOrigen = await mkdtemp(path.join(os.tmpdir(), "nido-b7-origen-"));
    extraDirs.push(dirOrigen);
    await initializeVault(dirOrigen, new PasswordCustodyProvider(PASS_C));
    const sO = await VaultSession.unlock(dirOrigen, [new PasswordCustodyProvider(PASS_C)]);
    const dek = Buffer.from(sO.dek);
    const db = openSecureDatabase(path.join(dirOrigen, DB), sO.dek);
    db.exec("CREATE TABLE t (v TEXT NOT NULL)");
    db.prepare("INSERT INTO t VALUES (?)").run(CANARIO_B7);
    db.close();
    sO.lock();
    const entries = [
      { path: DB, data: readFileSync(path.join(dirOrigen, DB)) },
      { path: `${DB}.format.json`, data: readFileSync(formatMarkerPath(path.join(dirOrigen, DB))) },
    ];
    const manifest = {
      format: "nido-pc-backup",
      version: 2,
      createdAt: "2026-11-19T00:00:00.000Z",
      app: "nido-pc",
      keyWrap: fixtureWrapCorta(dek, CORTA),
      entries: entries.map((e) => ({
        path: e.path,
        bytes: e.data.length,
        sha256: createHash("sha256").update(e.data).digest("hex"),
        sha256Kind: "bytes",
      })),
    };
    const header = Buffer.from(JSON.stringify(manifest), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length, 0);
    const container = path.join(dirOrigen, "respaldo-corto-fixture.nidobak");
    writeFileSync(container, Buffer.concat([Buffer.from("NID1", "latin1"), len, header, ...entries.map((e) => e.data)]));

    const dirDest = await mkdtemp(path.join(os.tmpdir(), "nido-b7-dest-"));
    extraDirs.push(dirDest);
    await initializeVault(dirDest, new PasswordCustodyProvider(PASS_E));
    const result = await restoreBackup({
      srcPath: container,
      dir: dirDest,
      providers: [new PasswordCustodyProvider(PASS_E)],
      noticeAccepted: true,
      backupPassword: CORTA,
    });
    expect(result.legacyCleartextKey).toBe(false);
    const { dek: dekDest } = await unlockVaultWith(dirDest, [new PasswordCustodyProvider(PASS_E)]);
    expect(dekDest.equals(dek)).toBe(true);
    const dbR = openSecureDatabase(path.join(dirDest, DB), dekDest);
    expect((dbR.prepare("SELECT v FROM t").get() as { v: string }).v).toBe(CANARIO_B7);
    dbR.close();
  });
});
