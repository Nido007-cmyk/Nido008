/**
 * Batería de A-4 (tanda de seguridad): la escritura durable de la capa.
 * El orden exacto se cobra con un fs fingido que registra cada llamada
 * semántica; la ida y vuelta y los movimientos, contra disco real; y la
 * guardia de censo cierra la capa: ningún renameSync directo queda en
 * src/security/ fuera de durableFs.ts (las fuentes leídas como texto).
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moveDurable, renameDurable, writeFileDurable, type DurableFsDeps } from "./durableFs.js";

/** Un fs fingido que registra las operaciones semánticas en orden. */
function fakeFs(opts?: { failFsync?: boolean }): { ops: string[]; deps: DurableFsDeps } {
  const ops: string[] = [];
  const fds = new Map<number, string>();
  let nextFd = 10;
  const deps: DurableFsDeps = {
    writeFileSync: ((p: unknown) => {
      ops.push(`write:${String(p)}`);
    }) as typeof writeFileSync,
    openSync: ((p: unknown) => {
      const fd = nextFd++;
      fds.set(fd, String(p));
      return fd;
    }) as typeof openSync,
    fsyncSync: ((fd: number) => {
      if (opts?.failFsync) throw new Error("fsync simulado que falla");
      ops.push(fds.get(fd)?.endsWith("dir") ? "fsync-dir" : "fsync-file");
    }) as typeof fsyncSync,
    closeSync: (() => {}) as typeof closeSync,
    renameSync: ((from: unknown, to: unknown) => {
      ops.push(`rename:${String(from)}->${String(to)}`);
    }) as typeof renameSync,
  };
  return { ops, deps };
}

/** Deps reales envueltas en un registro, para los movimientos en disco. */
function spyingRealDeps(ops: string[]): DurableFsDeps {
  const fds = new Map<number, string>();
  return {
    writeFileSync,
    openSync: ((p: unknown, flags: unknown) => {
      const fd = (openSync as (...a: unknown[]) => number)(p, flags);
      fds.set(fd, String(p));
      return fd;
    }) as typeof openSync,
    fsyncSync: ((fd: number) => {
      ops.push(`fsync:${fds.get(fd) ?? fd}`);
      return fsyncSync(fd);
    }) as typeof fsyncSync,
    closeSync,
    renameSync: ((from: unknown, to: unknown) => {
      ops.push(`rename:${String(from)}->${String(to)}`);
      return (renameSync as (...a: unknown[]) => void)(from, to);
    }) as typeof renameSync,
  };
}

describe("A-4 · escritura durable (durableFs)", () => {
  it("el orden exacto: escribir → fsync del fichero → rename → fsync del directorio, sin ninguna llamada de más", () => {
    const { ops, deps } = fakeFs();
    writeFileDurable("/datos/dir/fichero.json", "contenido", { deps });
    expect(ops).toEqual([
      `write:/datos/dir/fichero.json.tmp-${process.pid}`,
      "fsync-file",
      `rename:/datos/dir/fichero.json.tmp-${process.pid}->/datos/dir/fichero.json`,
      "fsync-dir",
    ]);
  });

  it("ida y vuelta en disco real: el contenido queda exacto y ningún temporal cuelga", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-a4-"));
    try {
      const dest = path.join(dir, "fichero.json");
      writeFileDurable(dest, "primera versión");
      expect(readFileSync(dest, "utf8")).toBe("primera versión");
      writeFileDurable(dest, "segunda versión, sobre la primera");
      expect(readFileSync(dest, "utf8")).toBe("segunda versión, sobre la primera");
      expect(readdirSync(dir)).toEqual(["fichero.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("un fsync que falla hace fallar la escritura entera y el rename no ocurre", () => {
    const { ops, deps } = fakeFs({ failFsync: true });
    expect(() => writeFileDurable("/datos/dir/fichero.json", "contenido", { deps })).toThrow("fsync simulado");
    expect(ops.some((op) => op.startsWith("rename:"))).toBe(false);
  });

  it("guardia de censo: ningún renameSync directo queda en src/security/ fuera de durableFs.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    for (const name of readdirSync(here)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "durableFs.ts") continue;
      if (readFileSync(path.join(here, name), "utf8").includes("renameSync")) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("renameDurable y moveDurable mueven de verdad, con el fsync del directorio tras el rename", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nido-a4-mov-"));
    try {
      const a = path.join(dir, "a.db");
      const b = path.join(dir, "b.db");
      const c = path.join(dir, "c.db");
      writeFileSync(a, "contenido que se mueve", "utf8");
      const ops: string[] = [];
      const deps = spyingRealDeps(ops);
      renameDurable(a, b, deps);
      expect(existsSync(a)).toBe(false);
      expect(readFileSync(b, "utf8")).toBe("contenido que se mueve");
      // Sustitución (clase P): fsync del fichero antes del rename, fsync del directorio después.
      expect(ops).toEqual([`fsync:${a}`, `rename:${a}->${b}`, `fsync:${dir}`]);
      ops.length = 0;
      moveDurable(b, c, deps);
      expect(existsSync(b)).toBe(false);
      expect(readFileSync(c, "utf8")).toBe("contenido que se mueve");
      // Movimiento (clase M): rename y fsync del directorio, sin fsync previo del fichero.
      expect(ops).toEqual([`rename:${b}->${c}`, `fsync:${dir}`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
