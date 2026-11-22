/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * packDownloader.test.ts — el descargador de paquetes de catálogo
 * (bloque puerta de E5, paso 5; la parte de descarga de la batería
 * §5.4 de la etapa), contra un servidor local de fixtures. Cobra
 * el patrón firmado: `.part` y reanudación con Range,
 * verificación completa contra el pin antes del renombrado
 * atómico, el `.part` borrado cuando el contenido no casa (y
 * ningún fichero con el nombre final), la edición anterior
 * sirviendo tras un corte a mitad, y el asiento del diario de
 * instalación tras cada instalación verificada. El gemelo de
 * modelos (download.ts) no se toca en este bloque: su diff es
 * vacío y su batería sigue en su sitio.
 *
 * Las entradas de la batería son fabricadas (su URL apunta al
 * servidor local); las instalaciones reales del bloque contra
 * los pins del catálogo se cobran en el asiento del paso, no
 * aquí.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { downloadPack } from "./packDownloader.js";
import { setPacksDataDir } from "../models/dataDir.js";
import { packFileState } from "../models/packTrust.js";
import type { PackCatalogEntry } from "../models/packCatalog.js";

const V1 = Buffer.from("edicion-uno-del-paquete-de-fixtures, bytes verificables 0123456789");
const V2 = Buffer.from("edicion-dos-del-paquete-de-fixtures, bytes verificables 9876543210");
const WRONG = Buffer.from("contenido-que-no-casa-con-el-pin, del mismo tamano que la v1......");
expect(WRONG.length).toBe(V1.length);

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let root = "";
let corpus = "";
let server: Server;
let baseUrl = "";
let requests: Array<{ url: string; range: string | null }> = [];
let handler: (url: string, range: string | null, res: import("node:http").ServerResponse) => void;

function entryFor(bytes: Buffer, id = "fixture-pack"): PackCatalogEntry {
  return {
    id,
    kind: "corpus",
    format: "sqlite-pack",
    label: "Fixture",
    filename: "corpus/fixture-pack.sqlite",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    sourceUrl: `${baseUrl}/fixture-pack.sqlite`,
    license: "",
    description: "",
    required: false,
  };
}

function serveBytes(bytes: Buffer, honorRange = true) {
  return (_url: string, range: string | null, res: import("node:http").ServerResponse) => {
    if (honorRange && range) {
      const from = Number(range.replace("bytes=", "").split("-")[0]);
      res.writeHead(206, { "Content-Range": `bytes ${from}-${bytes.length - 1}/${bytes.length}` });
      res.end(bytes.subarray(from));
      return;
    }
    res.writeHead(200, { "Content-Length": bytes.length });
    res.end(bytes);
  };
}

beforeAll(async () => {
  mkdirSync(join(process.cwd(), ".tmp-vitest"), { recursive: true });
  root = mkdtempSync(join(process.cwd(), ".tmp-vitest", "packdl-"));
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  setPacksDataDir(root);
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? "", range: req.headers.range ?? null });
    handler(req.url ?? "", req.headers.range ?? null, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => {
  requests = [];
  rmSync(join(corpus, "fixture-pack.sqlite"), { force: true });
  rmSync(join(corpus, "fixture-pack.sqlite.part"), { force: true });
  rmSync(join(corpus, "pack-install-records.json"), { force: true });
});

afterAll(async () => {
  setPacksDataDir(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("packDownloader (§5.4, descarga)", () => {
  it("descarga fresca: verifica, renombra, asienta el diario y no deja .part", async () => {
    handler = serveBytes(V1);
    const entry = entryFor(V1);
    const result = await downloadPack(entry);
    expect(result.bytes).toBe(V1.length);
    expect(result.resumedFrom).toBe(0);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V1);
    expect(existsSync(join(corpus, "fixture-pack.sqlite.part"))).toBe(false);
    const journal = JSON.parse(readFileSync(join(corpus, "pack-install-records.json"), "utf8"));
    expect(journal["fixture-pack"].sha256).toBe(sha256Hex(V1));
    expect(journal["fixture-pack"].sizeBytes).toBe(V1.length);
    expect(journal["fixture-pack"].mtimeMs).toBe(statSync(join(corpus, "fixture-pack.sqlite")).mtimeMs);
    expect(await packFileState(entry)).toBe("current");
  });

  it("ya instalado y verificado: no baja nada", async () => {
    handler = serveBytes(V1);
    const entry = entryFor(V1);
    await downloadPack(entry);
    requests = [];
    const again = await downloadPack(entry);
    expect(again.resumedFrom).toBe(V1.length);
    expect(requests.length).toBe(0);
  });

  it("reanudación con Range: el .part sano se continúa, no se tira", async () => {
    const cut = 20;
    writeFileSync(join(corpus, "fixture-pack.sqlite.part"), V1.subarray(0, cut));
    handler = serveBytes(V1);
    const result = await downloadPack(entryFor(V1));
    expect(result.resumedFrom).toBe(cut);
    expect(requests[0]!.range).toBe(`bytes=${cut}-`);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V1);
  });

  it("si el servidor ignora el Range (200), el cuerpo entero se escribe desde cero", async () => {
    const cut = 20;
    writeFileSync(join(corpus, "fixture-pack.sqlite.part"), V1.subarray(0, cut));
    handler = serveBytes(V1, false);
    const result = await downloadPack(entryFor(V1));
    expect(result.resumedFrom).toBe(0);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V1);
  });

  it("un .part mayor que el fichero entero se descarta y se descarga de cero", async () => {
    writeFileSync(join(corpus, "fixture-pack.sqlite.part"), Buffer.alloc(V1.length + 50, 3));
    handler = serveBytes(V1);
    const result = await downloadPack(entryFor(V1));
    expect(result.resumedFrom).toBe(0);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V1);
  });

  it("contenido que no casa con el pin: el .part se borra y no existe fichero con el nombre final", async () => {
    handler = serveBytes(WRONG);
    await expect(downloadPack(entryFor(V1))).rejects.toThrow(/sha256 mismatch/);
    expect(existsSync(join(corpus, "fixture-pack.sqlite"))).toBe(false);
    expect(existsSync(join(corpus, "fixture-pack.sqlite.part"))).toBe(false);
    expect(existsSync(join(corpus, "pack-install-records.json"))).toBe(false);
  });

  it("corte a mitad: la edición anterior sigue sirviendo; al reanudar, verifica y cambia", async () => {
    // Edición 1 instalada.
    handler = serveBytes(V1);
    const entryV1 = entryFor(V1);
    await downloadPack(entryV1);
    expect(await packFileState(entryV1)).toBe("current");

    // La actualización a la edición 2 se corta a mitad de cuerpo.
    const entryV2 = entryFor(V2);
    handler = (_url, _range, res) => {
      res.writeHead(200, { "Content-Length": V2.length });
      res.write(V2.subarray(0, 25));
      // El corte se dispara cuando el trozo está probado en disco,
      // no cuando salió del servidor: el callback de un `write` solo
      // certifica la salida hacia el kernel, y el vaciado del
      // WriteStream del cliente compite con la ruptura del pipeline
      // (bajo carga pierde, y el `.part` queda a 0 B sin que el
      // producto incumpla su contrato: la clasificación y las sondas
      // viven en estudios/INVESTIGACION-DESCARGADOR-CARRERA.md). Se
      // vigila el `.part` hasta que su tamaño es el del trozo; con
      // plazo de guarda, se destruye igual y el caso cae por su
      // aserción, a la vista, en vez de colgar la batería.
      const partPath = join(corpus, "fixture-pack.sqlite.part");
      const deadline = Date.now() + 5000;
      const watch = setInterval(() => {
        let size = -1;
        try {
          size = statSync(partPath).size;
        } catch {
          // El `.part` aún no existe: el cliente no ha abierto el flujo.
        }
        if (size >= 25 || Date.now() >= deadline) {
          clearInterval(watch);
          res.socket?.destroy();
        }
      }, 5);
    };
    // La edición 2 tiene otro nombre de fichero en el catálogo real;
    // aquí comparte nombre para ejercer el cambio en el sitio.
    await expect(downloadPack(entryV2)).rejects.toThrow();
    // La anterior sigue en su sitio, byte a byte, y sirviendo.
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V1);
    expect(await packFileState(entryV1)).toBe("current");
    const part = readFileSync(join(corpus, "fixture-pack.sqlite.part"));
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThan(V2.length);

    // Al reanudar contra el servidor sano, la descarga verifica y cambia.
    handler = serveBytes(V2);
    const done = await downloadPack(entryV2);
    expect(done.bytes).toBe(V2.length);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(V2);
    const journal = JSON.parse(readFileSync(join(corpus, "pack-install-records.json"), "utf8"));
    expect(journal["fixture-pack"].sha256).toBe(sha256Hex(V2));
  });
});

// ---------------------------------------------------------------------
// Ampliación de la tanda de la vía de descarga (FPC74-76-CURA-PREP
// §3.2): el asiento plegado de F-PC75 en esta pieza. La escala es
// la de la preparación: fichero de 300 B y .part sano de 100 B.
// El control en pie es el caso de reanudación de la batería dueña
// («el .part sano se continúa, no se tira»), que no se duplica.
// ---------------------------------------------------------------------
describe("packDownloader — el 206 que no continúa (F-PC75, asiento plegado)", () => {
  const CB = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 251));

  it("C1 · 206 que declara continuar en otro byte: rechaza y el .part sano se conserva", async () => {
    writeFileSync(join(corpus, "fixture-pack.sqlite.part"), CB.subarray(0, 100));
    handler = (_url, _range, res) => {
      // Declara bytes 150-299/300 y entrega el cuerpo entero.
      res.writeHead(206, { "Content-Range": "bytes 150-299/300", "Content-Length": CB.length });
      res.end(CB);
    };
    await expect(downloadPack(entryFor(CB))).rejects.toThrow(/does not continue at byte 100/);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite.part"))).toEqual(CB.subarray(0, 100));
  });

  it("C2 · 206 que se declara desde cero: escribe desde cero, final exacto y asiento en el diario", async () => {
    writeFileSync(join(corpus, "fixture-pack.sqlite.part"), CB.subarray(0, 100));
    handler = (_url, _range, res) => {
      res.writeHead(206, { "Content-Range": "bytes 0-299/300", "Content-Length": CB.length });
      res.end(CB);
    };
    const result = await downloadPack(entryFor(CB));
    expect(result.resumedFrom).toBe(0);
    expect(readFileSync(join(corpus, "fixture-pack.sqlite"))).toEqual(CB);
    const journal = JSON.parse(readFileSync(join(corpus, "pack-install-records.json"), "utf8"));
    expect(journal["fixture-pack"].sha256).toBe(sha256Hex(CB));
  });
});
