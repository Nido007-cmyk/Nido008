/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Superficies de bóveda (S-1) · restaurar un respaldo
 * desde la superficie: el motor de E2 estaba completo
 * y probado (28 casos), pero ningún canal lo alcanzaba:
 * la tarjeta prometía la vuelta y no se podía cumplir
 * (ALTA de AUDIT-CABLEADO). La cura son dos canales
 * sobre el llamante nuevo de la carcasa
 * (`restoreVaultBackup`/`inspectVaultBackup` de
 * backupCaller.ts, con el contrato de la breve de
 * núcleo: dir = la base de userData, vaultDir =
 * dirs().vault): `nido:backup-restore-preview` (elegir
 * el fichero y enseñar qué trae, sin escribir nada) y
 * `nido:backup-restore` (aviso aceptado en el
 * principal, re-autenticación, pre-vuelo, desmontaje
 * entero, restauración y reinicio por la costura de la
 * rotación).
 *
 * Los cargos, con el arnés de servicios reales de la
 * casa (doble de Electron con la costura de reinicio
 * registrada, manejadores reales cobrados por canal):
 *
 * 1. Escena: bóveda creada y desbloqueada por los
 *    canales reales, una nota sembrada, respaldo
 *    exportado por `nido:backup-export` (v2, con su
 *    contraseña), un cambio posterior al respaldo
 *    (otra nota) que la restauración debe deshacer, y
 *    los accesorios: un v1 construido a mano con la
 *    clave en claro y un v3 (demasiado nuevo).
 * 2. Sin sesión, preview y restore responden `locked`.
 * 3. El preview de un v2 anuncia versión, fecha,
 *    entradas y `legacy:false`, y no escribe nada
 *    (censo del directorio idéntico antes y después).
 * 4. El preview de un fichero corrupto responde
 *    `corrupt` y no escribe.
 * 5. El preview de un v1 anuncia `legacy:true`.
 * 6. Restore sin `noticeAccepted` → `notice-required`,
 *    destino intacto.
 * 7. Restore con la contraseña de la bóveda mala →
 *    `reauth-failed`, destino intacto.
 * 8. Restore v2 con la contraseña del respaldo mala →
 *    `backup-password-wrong`, y la huella del destino
 *    idéntica a antes.
 * 9. Restore v2 bueno → el reinicio se pide por la
 *    costura; tras la re-apertura simulada (desbloquear
 *    con la contraseña de siempre), lo servido es lo
 *    del respaldo: la nota sembrada está y la posterior
 *    no.
 * 10. Restore de un respaldo demasiado nuevo →
 *     `too-new`, intacto.
 * 11. Restore con una base gestionada en el destino
 *     que no viaja en el respaldo → `orphans`
 *     nombrándola, intacto.
 * 12. Restore de un v1 sin contraseña de respaldo →
 *     bueno, y el DTO previo a la salida declara
 *     `legacy:true`.
 *
 * Nacimiento: rojo por la causa raíz declarada (los
 * canales no están registrados y el llamante no
 * existe); la escena pasa porque usa solo canales que
 * ya existían.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
  relaunched: 0,
  exited: -1,
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
    relaunch: () => {
      harness.relaunched += 1;
    },
    exit: (code: number) => {
      harness.exited = code;
    },
  },
  BrowserWindow: {
    fromWebContents: () => ({
      isDestroyed: () => false,
      webContents: { send: () => undefined },
    }),
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      harness.handlers.set(channel, fn as never);
    },
    on: (channel: string, fn: unknown) => {
      harness.listeners.set(channel, fn as never);
    },
  },
  clipboard: { writeText: () => undefined },
  shell: { openExternal: async () => undefined },
}));

vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import * as memoryStore from "../../src/agent/memory/memoryStore.js";
import { PasswordCustodyProvider } from "../../src/security/keyVault.js";
import { VaultSession } from "../../src/security/vaultSession.js";
import { openSecureDatabase } from "../../src/security/secureDatabase.js";
import { readBackupContainer } from "../../src/security/backup.js";

const PASSWORD = "sonda-boveda-restaurar";
const BACKUP_PASSWORD = "sonda-respaldo-v2";
const NOTA_A = "CANARIO-BOVEDA-A";
const NOTA_B = "POSTERIOR-BOVEDA-B";
const HEAVY = { timeout: 180_000 };

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type PreviewReply = {
  ok: boolean;
  reason?: string;
  version?: number;
  createdAt?: string;
  entries?: string[];
  legacy?: boolean;
};
type RestoreReply = { ok: boolean; reason?: string; names?: string[]; legacy?: boolean };
type ExportReply = { ok: boolean; reason?: string; entries?: string[] };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

let fixtureDir = "";
let backupV2 = "";
let backupV1 = "";
let backupV3 = "";
let backupCorrupt = "";

function census(dir: string, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    const abs = path.join(dir, name.name);
    if (name.isDirectory()) {
      for (const [k, v] of census(abs, rel)) out.set(k, v);
    } else {
      out.set(rel, createHash("sha256").update(readFileSync(abs)).digest("hex"));
    }
  }
  return out;
}

async function noteTitles(): Promise<string[]> {
  const notes = await memoryStore.listNotes(50);
  return notes.map((n) => n.title).sort();
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-boveda-restore-"));
  fixtureDir = mkdtempSync(path.join(fixtureBase, "nido-boveda-ficheros-"));
  backupV2 = path.join(fixtureDir, "respaldo-v2.nidbackup");
  backupV1 = path.join(fixtureDir, "respaldo-v1.nidbackup");
  backupV3 = path.join(fixtureDir, "respaldo-v3.nidbackup");
  backupCorrupt = path.join(fixtureDir, "corrupto.nidbackup");
  await installServices();
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe("Superficies de bóveda · restaurar por la superficie (S-1)", () => {
  it("escena: bóveda por los canales reales, nota sembrada, respaldo v2 exportado por su canal, cambio posterior y los accesorios v1 y v3", HEAVY, async () => {
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    await memoryStore.saveNote({ title: NOTA_A, body: "la nota que el respaldo guarda" });
    const exp = await call<ExportReply>("nido:backup-export", {
      destPath: backupV2,
      backupPassword: BACKUP_PASSWORD,
    });
    expect(exp.ok).toBe(true);
    expect(exp.entries).toContain("store/nido_memory.db");
    expect(existsSync(backupV2)).toBe(true);
    // El cambio posterior al respaldo: la restauración debe deshacerlo.
    await memoryStore.saveNote({ title: NOTA_B, body: "la nota que el respaldo no conoce" });
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());

    // El accesorio v1: una segunda exportación por el canal
    // (con las dos notas) transcodificada a un contenedor
    // de formato 1 con la clave en claro en la cabecera
    // (la construcción local de la batería de E2): las
    // cargas son las del propio exportador, ya
    // consolidadas, y la clave es la DEK viva de la bóveda.
    const backupV2b = path.join(fixtureDir, "respaldo-v2b.nidbackup");
    const exp2 = await call<ExportReply>("nido:backup-export", {
      destPath: backupV2b,
      backupPassword: BACKUP_PASSWORD,
    });
    expect(exp2.ok).toBe(true);
    const vaultDir = path.join(harness.userData, "vault");
    const testSession = await VaultSession.unlock(vaultDir, [
      new PasswordCustodyProvider(PASSWORD),
    ]);
    const dek = Buffer.from(testSession.dek);
    testSession.lock();
    const container = readBackupContainer(backupV2b);
    const v1Entries = [...container.payloads.entries()].map(([p, data]) => ({
      path: p,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      sha256Kind: "bytes",
      data,
    }));
    const v1Manifest = {
      format: "nido-pc-backup",
      version: 1,
      createdAt: "2026-11-16T00:00:00.000Z",
      app: "nido-pc",
      databaseKeyHex: dek.toString("hex"),
      entries: v1Entries.map(({ data: _data, ...rest }) => rest),
    };
    const v1Header = Buffer.from(JSON.stringify(v1Manifest), "utf8");
    const v1Len = Buffer.alloc(4);
    v1Len.writeUInt32LE(v1Header.length, 0);
    writeFileSync(
      backupV1,
      Buffer.concat([
        Buffer.from("NID1", "latin1"),
        v1Len,
        v1Header,
        ...v1Entries.map((e) => e.data),
      ]),
    );

    // El accesorio v3: el mismo v2 con la versión subida
    // en la cabecera (la huella de la carga no cambia).
    const raw = readFileSync(backupV2);
    const headerLen = raw.readUInt32LE(4);
    const manifest = JSON.parse(raw.subarray(8, 8 + headerLen).toString("utf8")) as Record<string, unknown>;
    manifest.version = 99;
    const v3Header = Buffer.from(JSON.stringify(manifest), "utf8");
    const v3Len = Buffer.alloc(4);
    v3Len.writeUInt32LE(v3Header.length, 0);
    writeFileSync(backupV3, Buffer.concat([raw.subarray(0, 4), v3Len, v3Header, raw.subarray(8 + headerLen)]));

    writeFileSync(backupCorrupt, Buffer.from("esto no es un respaldo de NIDO"));
    expect(existsSync(backupV1)).toBe(true);
    expect(existsSync(backupV3)).toBe(true);
  });

  it("sin sesión, preview y restore responden locked", HEAVY, async () => {
    await call<{ ok: boolean }>("nido:vault-lock");
    const prev = await call<PreviewReply>("nido:backup-restore-preview", { srcPath: backupV2 });
    expect(prev.ok).toBe(false);
    expect(prev.reason).toBe("locked");
    const res = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV2,
      backupPassword: BACKUP_PASSWORD,
      vaultPassword: PASSWORD,
      noticeAccepted: true,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("locked");
    const un = await call<{ ok: boolean }>("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
  });

  it("el preview de un v2 anuncia versión, fecha, entradas y legacy:false, y no escribe nada", HEAVY, async () => {
    const before = census(harness.userData);
    const r = await call<PreviewReply>("nido:backup-restore-preview", { srcPath: backupV2 });
    expect(r.ok).toBe(true);
    expect(r.version).toBe(2);
    expect(typeof r.createdAt).toBe("string");
    expect(r.entries).toContain("store/nido_memory.db");
    expect(r.legacy).toBe(false);
    expect(census(harness.userData)).toEqual(before);
  });

  it("el preview de un fichero corrupto responde corrupt y no escribe", HEAVY, async () => {
    const before = census(harness.userData);
    const r = await call<PreviewReply>("nido:backup-restore-preview", { srcPath: backupCorrupt });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("corrupt");
    expect(census(harness.userData)).toEqual(before);
    const missing = await call<PreviewReply>("nido:backup-restore-preview", {
      srcPath: path.join(fixtureDir, "no-existe.nidbackup"),
    });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe("unreadable");
  });

  it("el preview de un v1 anuncia legacy:true", HEAVY, async () => {
    const r = await call<PreviewReply>("nido:backup-restore-preview", { srcPath: backupV1 });
    expect(r.ok).toBe(true);
    expect(r.version).toBe(1);
    expect(r.legacy).toBe(true);
    expect(r.entries).toContain("store/nido_memory.db");
  });

  it("restore sin noticeAccepted responde notice-required y el destino queda intacto", HEAVY, async () => {
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV2,
      backupPassword: BACKUP_PASSWORD,
      vaultPassword: PASSWORD,
      noticeAccepted: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("notice-required");
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());
  });

  it("restore con la contraseña de la bóveda mala responde reauth-failed y el destino queda intacto", HEAVY, async () => {
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV2,
      backupPassword: BACKUP_PASSWORD,
      vaultPassword: "esta-no-es-la-contrasena",
      noticeAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("reauth-failed");
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());
  });

  it("restore v2 con la contraseña del respaldo mala responde backup-password-wrong y la huella del destino es idéntica", HEAVY, async () => {
    const before = census(harness.userData);
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV2,
      backupPassword: "esta-no-abre-el-respaldo",
      vaultPassword: PASSWORD,
      noticeAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("backup-password-wrong");
    expect(census(harness.userData)).toEqual(before);
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());
  });

  it("restore de un respaldo demasiado nuevo responde too-new y el destino queda intacto", HEAVY, async () => {
    const prev = await call<PreviewReply>("nido:backup-restore-preview", { srcPath: backupV3 });
    expect(prev.ok).toBe(false);
    expect(prev.reason).toBe("too-new");
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV3,
      backupPassword: BACKUP_PASSWORD,
      vaultPassword: PASSWORD,
      noticeAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("too-new");
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());
  });

  it("restore v2 bueno: el reinicio se pide por la costura y, tras reabrir con la contraseña de siempre, lo servido es lo del respaldo", HEAVY, async () => {
    const relaunchedBefore = harness.relaunched;
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV2,
      backupPassword: BACKUP_PASSWORD,
      vaultPassword: PASSWORD,
      noticeAccepted: true,
    });
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(false);
    expect(harness.relaunched).toBe(relaunchedBefore + 1);
    expect(harness.exited).toBe(0);
    // La re-apertura simulada: desbloquear con la contraseña
    // de siempre (la DEK restaurada quedó envuelta con la
    // custodia local por la pareja del núcleo).
    const un = await call<{ ok: boolean }>("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    expect(await noteTitles()).toEqual([NOTA_A]);
  });

  it("restore con una base gestionada del destino que no viaja en el respaldo responde orphans nombrándola, y el destino queda intacto", HEAVY, async () => {
    // La base de conocimiento nace en el destino (con su
    // marcador) y no viaja en el respaldo v2 de la escena.
    const vaultDir = path.join(harness.userData, "vault");
    const testSession = await VaultSession.unlock(vaultDir, [
      new PasswordCustodyProvider(PASSWORD),
    ]);
    const knowledgePath = path.join(harness.userData, "knowledge", "nido_knowledge.db");
    mkdirSync(path.dirname(knowledgePath), { recursive: true });
    const db = openSecureDatabase(knowledgePath, testSession.dek);
    db.close();
    testSession.lock();
    expect(existsSync(`${knowledgePath}.format.json`)).toBe(true);
    try {
      const r = await call<RestoreReply>("nido:backup-restore", {
        srcPath: backupV2,
        backupPassword: BACKUP_PASSWORD,
        vaultPassword: PASSWORD,
        noticeAccepted: true,
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("orphans");
      expect(r.names).toEqual(["knowledge/nido_knowledge.db"]);
      // El destino intacto se cobra tras reabrir, abajo:
      // el intento desmontó la sesión, y sin sesión no
      // hay lectura posible (fail-closed, como debe ser).
    } finally {
      // El destino vuelve a su estado: la base sembrada se
      // aparta a mano, que es justo lo que el aviso manda.
      rmSync(knowledgePath, { force: true });
      rmSync(`${knowledgePath}.format.json`, { force: true });
    }
    // El intento desmontó la sesión (el desmontaje va antes
    // que la restauración, y el rechazo de huérfanas llega
    // del núcleo): se reabre para los casos que siguen.
    const un = await call<{ ok: boolean }>("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    expect(await noteTitles()).toEqual([NOTA_A]);
  });

  it("restore de un v1 sin contraseña de respaldo: bueno, y el DTO previo a la salida declara legacy:true", HEAVY, async () => {
    const relaunchedBefore = harness.relaunched;
    const r = await call<RestoreReply>("nido:backup-restore", {
      srcPath: backupV1,
      vaultPassword: PASSWORD,
      noticeAccepted: true,
    });
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(true);
    expect(harness.relaunched).toBe(relaunchedBefore + 1);
    const un = await call<{ ok: boolean }>("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    // El v1 traía el estado del momento de su construcción:
    // las dos notas de la escena.
    expect(await noteTitles()).toEqual([NOTA_A, NOTA_B].sort());
    expect(statSync(backupV1).size).toBeGreaterThan(0);
  });
});
