/**
 * Batería del paso 2 de E2 (almacén cifrado): T-1, T-2 con su pierna del
 * WAL vivo, F-1 y la reapertura de F-2 como test propio de la etapa,
 * más la puerta del marcador de formato corriendo por primera vez en la
 * función única de apertura y la sonda DbKind.
 */

import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FormatMarkerError, formatMarkerPath, readFormatMarker } from "./formatMarker.js";
import {
  SecureDbOpenError,
  openSecureDatabase,
  probeDbKind,
} from "./secureDatabase.js";

const CANARIO_1 = "CANARIO-NIDO-PC-7f3a9c1e::esto no debe leerse en disco jamas::áéíóú-ñ-0123456789";
const CANARIO_2 = "CANARIO-DOCUMENTO-55bd02aa::conversación privada de prueba, segundo canario::9876543210";
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function countOccurrences(haystack: Buffer, needle: string): number {
  let n = 0;
  for (const enc of ["utf8", "utf16le"] as const) {
    const bytes = Buffer.from(needle, enc);
    let i = haystack.indexOf(bytes);
    while (i !== -1) {
      n++;
      i = haystack.indexOf(bytes, i + 1);
    }
  }
  return n;
}

let dir: string;
const dek = randomBytes(32);
const dekMala = randomBytes(32);
let dbPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-e2-store-"));
  dbPath = path.join(dir, "nido.db");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createWithCanaries(): void {
  const db = openSecureDatabase(dbPath, dek);
  db.exec("CREATE TABLE notas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, cuerpo TEXT NOT NULL)");
  const ins = db.prepare("INSERT INTO notas (titulo, cuerpo) VALUES (?, ?)");
  ins.run("nota uno", CANARIO_1);
  ins.run("nota dos", CANARIO_2);
  ins.run("nota tres", "Texto ordinario de relleno.");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

describe("función única de apertura y marcador (paso 2)", () => {
  it("crea la base cifrada y escribe su marcador con la configuración sellada", () => {
    createWithCanaries();
    const marker = readFormatMarker(dbPath);
    expect(marker).not.toBeNull();
    expect(marker?.cipher).toBe("sqlcipher");
    expect(marker?.legacy).toBe(4);
    expect(marker?.pageSize).toBe(4096);
    expect(marker?.libraryVersion).toBe("13.1.1");
    const db = openSecureDatabase(dbPath, dek);
    const rows = db.prepare("SELECT cuerpo FROM notas ORDER BY id").all() as Array<{ cuerpo: string }>;
    expect(rows.map((r) => r.cuerpo)).toEqual([CANARIO_1, CANARIO_2, "Texto ordinario de relleno."]);
    db.close();
  });

  it("la puerta del marcador corre en la apertura: marcador manipulado o ausente = fail-closed", () => {
    const markerPath = formatMarkerPath(dbPath);
    const bueno = readFileSync(markerPath, "utf8");
    const manipulado = JSON.parse(bueno) as Record<string, unknown>;
    manipulado.libraryVersion = "99.0.0";
    writeFileSync(markerPath, JSON.stringify(manipulado), "utf8");
    expect(() => openSecureDatabase(dbPath, dek)).toThrow(FormatMarkerError);
    rmSync(markerPath);
    expect(() => openSecureDatabase(dbPath, dek)).toThrow(FormatMarkerError);
    writeFileSync(markerPath, bueno, "utf8");
    const db = openSecureDatabase(dbPath, dek);
    db.close();
  });
});

describe("T-1 · clave equivocada falla cerrada", () => {
  it("la apertura lanza, el fichero queda byte a byte intacto y no aparece base nueva vacía", () => {
    const antes = readFileSync(dbPath);
    const hashAntes = sha256(antes);
    const ficherosAntes = readdirSync(dir).sort();
    expect(() => openSecureDatabase(dbPath, dekMala)).toThrow(SecureDbOpenError);
    expect(sha256(readFileSync(dbPath))).toBe(hashAntes);
    // Ningún fichero nuevo con pinta de base: solo pueden variar sidecars.
    const nuevos = readdirSync(dir).filter((f) => !ficherosAntes.includes(f) && !f.startsWith("nido.db-"));
    expect(nuevos).toEqual([]);
    // Y la base sigue abriendo con su DEK: no quedó sustituida ni rota.
    const db = openSecureDatabase(dbPath, dek);
    expect((db.prepare("SELECT count(*) AS n FROM notas").get() as { n: number }).n).toBe(3);
    db.close();
  });
});

describe("T-2 · cero texto en claro en disco, con la pierna del WAL vivo", () => {
  it("el canario escrito sin cerrar no aparece en el -wal vivo; tras cerrar, en ningún fichero", () => {
    const walPath = path.join(dir, "wal.db");
    const db = openSecureDatabase(walPath, dek);
    db.exec("CREATE TABLE notas (id INTEGER PRIMARY KEY, cuerpo TEXT NOT NULL)");
    db.prepare("INSERT INTO notas (cuerpo) VALUES (?)").run(CANARIO_1);
    // Sin checkpoint ni cierre: el canario vive solo en el -wal ahora.
    const walVivo = readFileSync(`${walPath}-wal`);
    expect(walVivo.length).toBeGreaterThan(0);
    expect(countOccurrences(walVivo, CANARIO_1)).toBe(0);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();

    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${walPath}${suffix}`;
      if (existsSync(p)) expect(countOccurrences(readFileSync(p), CANARIO_1), p).toBe(0);
    }
    const cabecera = readFileSync(walPath).subarray(0, 16).toString("latin1");
    expect(cabecera).not.toBe("SQLite format 3\0");
  });

  it("los canarios de la base principal tampoco aparecen tras el cierre con checkpoint", () => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) {
        expect(countOccurrences(readFileSync(p), CANARIO_1), p).toBe(0);
        expect(countOccurrences(readFileSync(p), CANARIO_2), p).toBe(0);
      }
    }
  });
});

describe("F-1 · el formato se fija, no se hereda", () => {
  it("el marcador declara sqlcipher/legacy 4 y abrir con el cipher por defecto (sqleet) falla", () => {
    const db = new Database(dbPath);
    try {
      db.pragma(`key = "x'${dek.toString("hex")}'"`);
      expect(() => db.prepare("SELECT count(*) FROM sqlite_master").get()).toThrow();
    } finally {
      db.close();
    }
  });
});

describe("F-2 (test propio de la etapa) · reapertura tras reinstalar desde el lockfile", () => {
  it("la base creada por la versión fijada se reabre íntegra y su sha256 no cambia al reabrir", () => {
    // La pierna de reinstalación (npm ci desde el lockfile) la ejecuta el
    // procedimiento scripts/f2-*.ts asentado en el checkpoint; aquí corre
    // la pierna de reapertura: mismo contenido, integrity ok, bytes
    // estables entre cierre y reapertura.
    const hashTrasCreacion = sha256(readFileSync(dbPath));
    const db = openSecureDatabase(dbPath, dek);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((db.prepare("SELECT count(*) AS n FROM notas").get() as { n: number }).n).toBe(3);
    db.close();
    expect(sha256(readFileSync(dbPath))).toBe(hashTrasCreacion);
  });
});

describe("sonda DbKind", () => {
  it("distingue en claro / cifrada / ilegible", () => {
    const plainPath = path.join(dir, "claro.db");
    const plain = new Database(plainPath);
    plain.exec("CREATE TABLE t (v TEXT)");
    plain.close();
    expect(probeDbKind(plainPath, null)).toBe("plaintext");
    expect(probeDbKind(dbPath, dek)).toBe("encrypted");
    expect(probeDbKind(dbPath, null)).toBe("unreadable"); // Sin DEK no se distingue de ilegible.
    expect(probeDbKind(dbPath, dekMala)).toBe("unreadable");
    const garbagePath = path.join(dir, "basura.db");
    writeFileSync(garbagePath, randomBytes(8192));
    expect(probeDbKind(garbagePath, dek)).toBe("unreadable");
  });
});

describe("D-10 · el pageSize del marcador se contrasta contra el real (ATAQUE4-P9)", () => {
  it("un marcador que miente el pageSize (1024 sobre una base de 4096) abre fail-closed", () => {
    const markerPath = formatMarkerPath(dbPath);
    const bueno = readFileSync(markerPath, "utf8");
    try {
      const mentido = JSON.parse(bueno) as Record<string, unknown>;
      mentido.pageSize = 1024;
      writeFileSync(markerPath, JSON.stringify(mentido), "utf8");
      expect(() => openSecureDatabase(dbPath, dek)).toThrow(FormatMarkerError);
    } finally {
      writeFileSync(markerPath, bueno, "utf8");
    }
    const db = openSecureDatabase(dbPath, dek); // Con el marcador bueno vuelve a abrir.
    db.close();
  });

  it("la mentira en el otro sentido también falla cerrada: marcador de 8192 sobre la base real de 4096", () => {
    // La dirección «base real de 8192» no se puede montar como fixture
    // con la build fijada: su capa cipher fija el tamaño de página en
    // 4096 (cipher_page_size previo a la clave se ignora, y page_size
    // tras la clave deja un fichero que ni la propia build reabre,
    // probado en las variantes de pragmas y con VACUUM). El contraste
    // es una desigualdad simétrica, así que ambas direcciones de
    // mentira se ejercen contra la base real.
    const markerPath = formatMarkerPath(dbPath);
    const bueno = readFileSync(markerPath, "utf8");
    try {
      const mentido = JSON.parse(bueno) as Record<string, unknown>;
      mentido.pageSize = 8192;
      writeFileSync(markerPath, JSON.stringify(mentido), "utf8");
      expect(() => openSecureDatabase(dbPath, dek)).toThrow(FormatMarkerError);
    } finally {
      writeFileSync(markerPath, bueno, "utf8");
    }
  });
});

describe("M-2 · la frontera de la integridad por página, declarada (tanda de seguridad)", () => {
  // La frontera que esta batería fija, medida en esta máquina y en la
  // auditoría (AUD-CLAUDE-VERIF §6, con la misma forma de banco: 121
  // copias abren y 6 se rechazan, las 5 vivas y una libre): la apertura
  // verifica las páginas VIVAS (integrity_check las recorre y su HMAC
  // las sella); las páginas LIBRES no se leen al abrir y su byte no se
  // detecta, sin que ningún dato vivo se altere. La única página libre
  // que sí se lee es la página TRONCO de la lista libre (integrity_check
  // la recorre para contar la lista): su byte sí se caza, y por eso el
  // caso de libres espera exactamente una rechazada entre las libres.
  const FILA = "z".repeat(300);

  function buildDb(name: string, total: number, keep: number): { dbPath: string; pages: number; freelist: number } {
    const dbPath = path.join(dir, name);
    const db = openSecureDatabase(dbPath, dek);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
    const ins = db.prepare("INSERT INTO t VALUES (?, ?)");
    for (let i = 0; i < total; i++) ins.run(i, FILA);
    if (keep < total) db.prepare("DELETE FROM t WHERE id >= ?").run(keep);
    const pages = Number(db.pragma("page_count", { simple: true }));
    const freelist = Number(db.pragma("freelist_count", { simple: true }));
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    return { dbPath, pages, freelist };
  }

  function flipCopy(srcPath: string, name: string, pageIndex: number, pageSize: number): string {
    const copia = path.join(dir, name);
    const tocado = Buffer.from(readFileSync(srcPath));
    tocado[pageIndex * pageSize + 2048] ^= 0xff;
    writeFileSync(copia, tocado);
    copyFileSync(formatMarkerPath(srcPath), formatMarkerPath(copia));
    return copia;
  }

  it("un byte tocado en cualquier página VIVA se caza al abrir: ninguna copia abre", () => {
    const { dbPath, pages, freelist } = buildDb("m2-viva.db", 120, 120);
    expect(freelist).toBe(0);
    expect(pages).toBeGreaterThanOrEqual(3);
    const pageSize = readFormatMarker(dbPath)?.pageSize ?? 4096;
    for (let i = 0; i < pages; i++) {
      const copia = flipCopy(dbPath, `m2-viva-${i}.db`, i, pageSize);
      expect(() => openSecureDatabase(copia, dek), `página ${i}`).toThrow();
    }
    // Control: la base intacta abre y trae sus filas.
    const db = openSecureDatabase(dbPath, dek);
    expect((db.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n).toBe(120);
    db.close();
  });

  it("un byte en una página libre no se detecta al abrir y no altera ningún dato vivo (frontera: la página tronco de la lista libre sí se lee, y su byte sí se caza)", () => {
    const { dbPath, pages, freelist } = buildDb("m2-libre.db", 500, 10);
    expect(freelist).toBeGreaterThanOrEqual(20);
    const pageSize = readFormatMarker(dbPath)?.pageSize ?? 4096;
    const chk = openSecureDatabase(dbPath, dek);
    const vivas = new Set(
      (chk.prepare("SELECT DISTINCT pageno FROM dbstat").all() as Array<{ pageno: number }>).map((r) => r.pageno - 1),
    );
    chk.close();
    let abren = 0;
    let rechazanLibres = 0;
    for (let i = 0; i < pages; i++) {
      if (vivas.has(i)) continue;
      const copia = flipCopy(dbPath, `m2-libre-${i}.db`, i, pageSize);
      let db: ReturnType<typeof openSecureDatabase> | null = null;
      try {
        db = openSecureDatabase(copia, dek);
      } catch {
        rechazanLibres++;
      }
      if (db) {
        abren++;
        // Los datos vivos, íntegros en cada copia que abre: conteo y contenido.
        const rows = db.prepare("SELECT v FROM t ORDER BY id").all() as Array<{ v: string }>;
        expect(rows.length).toBe(10);
        expect(rows.every((r) => r.v === FILA)).toBe(true);
        db.close();
      }
    }
    // Exactamente las libres que no son tronco abren; la tronco rechaza.
    expect(abren).toBe(freelist - 1);
    expect(rechazanLibres).toBe(1);
  });
});
