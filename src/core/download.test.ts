/**
 * Tests del descargador (auditoría de ataque 1, M-3) contra un
 * servidor HTTP en loopback: nada sale de esta máquina. El patrón
 * probado: descarga a .part, verificación sobre el .part, rename
 * atómico solo tras verificar; corrupto = rechazo y .part borrado;
 * reanudación con Range.
 */

import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog.js";
import { discardDownload, downloadModel, DownloadPaused } from "./download.js";
import { LoadRefusal } from "./loadPath.js";

const payload = Buffer.from(Array.from({ length: 10_000 }, (_, i) => i % 251));
const sha = createHash("sha256").update(payload).digest("hex");

let server: http.Server;
let baseUrl: string;
let dir: string;
let lastRange: string | undefined;
let serveCorrupt = false;
let requestCount = 0;
// Los modos del 206 de la ampliación F-PC74/F-PC75 (§3.1 de la
// preparación). El modo "honesto" es el del servidor dueño de
// siempre: 206 sin Content-Range y la longitud del resto exacto.
// Los demás declaran lo que cada caso pide.
let rangeMode:
  | "honesto"
  | "rango-honrado"
  | "miente-inicio"
  | "desde-cero"
  | "longitud-rara" = "honesto";

function entryFor(id: string): CatalogEntry {
  return {
    id,
    label: id,
    kind: "llm",
    fileBytes: payload.length,
    arch: { layers: 1, kvHeads: 1, headDim: 1, vocab: 1 },
    maxContext: 2048,
    license: "MIT",
    sourceUrl: `${baseUrl}/${id}.gguf`,
    revision: "test",
    sha256: sha,
    role: "light",
    note: "test",
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nido-download-"));
  server = http.createServer((req, res) => {
    requestCount++;
    lastRange = req.headers.range;
    const body = serveCorrupt ? Buffer.alloc(payload.length, 9) : payload;
    if (req.headers.range) {
      const start = Number(req.headers.range.replace("bytes=", "").split("-")[0]);
      if (rangeMode === "rango-honrado") {
        const slice = body.subarray(start);
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
          "Content-Length": slice.length,
        });
        res.end(slice);
        return;
      }
      if (rangeMode === "miente-inicio") {
        // Declara continuar en el byte 5000 y entrega desde el 0.
        const slice = body.subarray(0, body.length - 5000);
        res.writeHead(206, {
          "Content-Range": `bytes 5000-${body.length - 1}/${body.length}`,
          "Content-Length": slice.length,
        });
        res.end(slice);
        return;
      }
      if (rangeMode === "desde-cero") {
        // Se declara el fichero entero desde su byte 0.
        res.writeHead(206, {
          "Content-Range": `bytes 0-${body.length - 1}/${body.length}`,
          "Content-Length": body.length,
        });
        res.end(body);
        return;
      }
      if (rangeMode === "longitud-rara") {
        // 206 sin Content-Range y una longitud que no es ni el
        // resto que falta (6000) ni el fichero entero (10000).
        const slice = body.subarray(0, 5000);
        res.writeHead(206, { "Content-Length": slice.length });
        res.end(slice);
        return;
      }
      const slice = body.subarray(start);
      res.writeHead(206, { "Content-Length": slice.length });
      res.end(slice);
      return;
    }
    res.writeHead(200, { "Content-Length": body.length });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

describe("downloadModel — .part, verificación y rename atómico", () => {
  it("descarga, verifica y deja el fichero con su nombre final", async () => {
    serveCorrupt = false;
    const result = await downloadModel(entryFor("descarga-buena"), dir);
    expect(result.bytes).toBe(payload.length);
    const onDisk = await readFile(path.join(dir, "descarga-buena.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
    await expect(stat(path.join(dir, "descarga-buena.gguf.part"))).rejects.toThrow();
  });

  it("un contenido corrupto se rechaza: ni nombre final ni .part", async () => {
    serveCorrupt = true;
    await expect(downloadModel(entryFor("descarga-corrupta"), dir)).rejects.toBeInstanceOf(
      LoadRefusal,
    );
    await expect(stat(path.join(dir, "descarga-corrupta.gguf"))).rejects.toThrow();
    await expect(stat(path.join(dir, "descarga-corrupta.gguf.part"))).rejects.toThrow();
    serveCorrupt = false;
  });

  it("un .part completo pero corrupto se borra al fallar la verificación (auditoría 2)", async () => {
    const entry = entryFor("descarga-atascada");
    // .part preexistente del tamaño exacto, contenido falso.
    await writeFile(path.join(dir, "descarga-atascada.gguf.part"), Buffer.alloc(payload.length, 3));
    await expect(downloadModel(entry, dir)).rejects.toBeInstanceOf(LoadRefusal);
    // Borrado: la entrada no queda atascada contra el mismo fichero.
    await expect(stat(path.join(dir, "descarga-atascada.gguf.part"))).rejects.toThrow();
    // Y la siguiente llamada descarga de cero y termina bien.
    serveCorrupt = false;
    const result = await downloadModel(entry, dir);
    expect(result.bytes).toBe(payload.length);
    const onDisk = await readFile(path.join(dir, "descarga-atascada.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("reanuda un .part sano con Range en vez de empezar de cero", async () => {
    const entry = entryFor("descarga-reanudada");
    await writeFile(path.join(dir, "descarga-reanudada.gguf.part"), payload.subarray(0, 4000));
    lastRange = undefined;
    const result = await downloadModel(entry, dir);
    expect(lastRange).toBe("bytes=4000-");
    expect(result.resumedFrom).toBe(4000);
    const onDisk = await readFile(path.join(dir, "descarga-reanudada.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Ampliación de la tanda de la vía de descarga (FPC74-76-CURA-PREP
// §3.1): el final preexistente que no verifica (F-PC74, A1–A5) y
// el 206 que no continúa donde el .part quedó (F-PC75, B1–B5).
// La escala es la del fichero dueño: fichero de 10.000 B y .part
// sano de 4.000 B, la misma proporción de la preparación
// (400 de 1.000). Los casos de control (A4, B4, B5) nacen en
// verde y fijan la conducta que la cura no puede romper.
// ---------------------------------------------------------------------
describe("downloadModel — final preexistente (F-PC74) y 206 que no continúa (F-PC75)", () => {
  it("A1 · un final con un byte cambiado se retira y se baja de cero", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("final-byte-cambiado");
    const bad = Buffer.from(payload);
    bad[123] = (bad[123] ?? 0) ^ 0xff;
    await writeFile(path.join(dir, "final-byte-cambiado.gguf"), bad);
    const result = await downloadModel(entry, dir);
    expect(result.bytes).toBe(payload.length);
    const onDisk = await readFile(path.join(dir, "final-byte-cambiado.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("A2 · un final truncado se retira y se baja de cero", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("final-truncado");
    await writeFile(path.join(dir, "final-truncado.gguf"), payload.subarray(0, 4000));
    const result = await downloadModel(entry, dir);
    expect(result.bytes).toBe(payload.length);
    const onDisk = await readFile(path.join(dir, "final-truncado.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("A3 · final corrupto y servidor corrupto: lanza y no queda ni final ni .part", async () => {
    rangeMode = "honesto";
    const entry = entryFor("final-y-servidor-corruptos");
    await writeFile(
      path.join(dir, "final-y-servidor-corruptos.gguf"),
      Buffer.alloc(payload.length, 7),
    );
    serveCorrupt = true;
    await expect(downloadModel(entry, dir)).rejects.toBeInstanceOf(LoadRefusal);
    serveCorrupt = false;
    await expect(stat(path.join(dir, "final-y-servidor-corruptos.gguf"))).rejects.toThrow();
    await expect(stat(path.join(dir, "final-y-servidor-corruptos.gguf.part"))).rejects.toThrow();
  });

  it("A4 · un final verificado preexistente se devuelve sin una sola petición (control)", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("final-verificado");
    await writeFile(path.join(dir, "final-verificado.gguf"), payload);
    requestCount = 0;
    const result = await downloadModel(entry, dir);
    expect(result.resumedFrom).toBe(payload.length);
    expect(requestCount).toBe(0);
  });

  it("A5 · final corrupto con .part sano: retira el final y reanuda el .part", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("final-corrupto-part-sano");
    await writeFile(
      path.join(dir, "final-corrupto-part-sano.gguf"),
      Buffer.alloc(payload.length, 7),
    );
    await writeFile(
      path.join(dir, "final-corrupto-part-sano.gguf.part"),
      payload.subarray(0, 4000),
    );
    lastRange = undefined;
    const result = await downloadModel(entry, dir);
    expect(lastRange).toBe("bytes=4000-");
    expect(result.resumedFrom).toBe(4000);
    const onDisk = await readFile(path.join(dir, "final-corrupto-part-sano.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("B1 · 206 que declara continuar en otro byte: rechaza y el .part sano se conserva", async () => {
    rangeMode = "miente-inicio";
    serveCorrupt = false;
    const entry = entryFor("rango-miente-inicio");
    await writeFile(
      path.join(dir, "rango-miente-inicio.gguf.part"),
      payload.subarray(0, 4000),
    );
    await expect(downloadModel(entry, dir)).rejects.toBeInstanceOf(LoadRefusal);
    const part = await readFile(path.join(dir, "rango-miente-inicio.gguf.part"));
    expect(part.equals(payload.subarray(0, 4000))).toBe(true);
    rangeMode = "honesto";
  });

  it("B2 · 206 que se declara desde cero: escribe desde cero y el final queda exacto", async () => {
    rangeMode = "desde-cero";
    serveCorrupt = false;
    const entry = entryFor("rango-desde-cero");
    await writeFile(path.join(dir, "rango-desde-cero.gguf.part"), payload.subarray(0, 4000));
    const result = await downloadModel(entry, dir);
    expect(result.resumedFrom).toBe(0);
    const onDisk = await readFile(path.join(dir, "rango-desde-cero.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
    rangeMode = "honesto";
  });

  it("B3 · 206 sin Content-Range y longitud que no declara nada: rechaza y el .part se conserva", async () => {
    rangeMode = "longitud-rara";
    serveCorrupt = false;
    const entry = entryFor("rango-longitud-rara");
    await writeFile(
      path.join(dir, "rango-longitud-rara.gguf.part"),
      payload.subarray(0, 4000),
    );
    await expect(downloadModel(entry, dir)).rejects.toBeInstanceOf(LoadRefusal);
    const part = await readFile(path.join(dir, "rango-longitud-rara.gguf.part"));
    expect(part.equals(payload.subarray(0, 4000))).toBe(true);
    rangeMode = "honesto";
  });

  it("B4 · 206 honrado con Content-Range exacto: reanuda y el final queda exacto (control)", async () => {
    rangeMode = "rango-honrado";
    serveCorrupt = false;
    const entry = entryFor("rango-honrado");
    await writeFile(path.join(dir, "rango-honrado.gguf.part"), payload.subarray(0, 4000));
    const result = await downloadModel(entry, dir);
    expect(result.resumedFrom).toBe(4000);
    const onDisk = await readFile(path.join(dir, "rango-honrado.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
    rangeMode = "honesto";
  });

  it("B5 · 206 sin Content-Range y longitud del resto exacto: reanuda por el respaldo (control)", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("rango-respaldo-longitud");
    await writeFile(
      path.join(dir, "rango-respaldo-longitud.gguf.part"),
      payload.subarray(0, 4000),
    );
    const result = await downloadModel(entry, dir);
    expect(result.resumedFrom).toBe(4000);
    const onDisk = await readFile(path.join(dir, "rango-respaldo-longitud.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Extensión de E4 (paso 4): progreso contado, pausa, descarte
// (pruebas 10 a 12 de la hoja; la 13 es la guarda de la copia
// sincronizada, en coreCopy.test.ts) y los cinco casos de las
// partidas de la auditoría de descarga: el tope en vuelo (D-1),
// el .part y el final como enlaces (D-3) y la reanudación no
// regresiva (D-7). Segundo servidor con sus propios modos.
// ---------------------------------------------------------------------
let server2: http.Server;
let base2 = "";
let dir2 = "";
let requests2 = 0;
let mode2: "normal" | "doble-cuerpo" | "ignora-y-corta" | "a-gotas" = "normal";

function entry2(id: string): CatalogEntry {
  return { ...entryFor(id), sourceUrl: `${base2}/${id}.gguf` };
}

beforeAll(async () => {
  dir2 = await mkdtemp(path.join(os.tmpdir(), "nido-download2-"));
  server2 = http.createServer((req, res) => {
    requests2++;
    if (mode2 === "doble-cuerpo") {
      const doble = Buffer.concat([payload, payload]);
      res.writeHead(200, { "Content-Length": doble.length });
      res.end(doble);
      return;
    }
    if (mode2 === "a-gotas") {
      res.writeHead(200, { "Content-Length": payload.length });
      let offset = 0;
      const timer = setInterval(() => {
        const next = Math.min(offset + 1000, payload.length);
        res.write(payload.subarray(offset, next));
        offset = next;
        if (offset >= payload.length) {
          clearInterval(timer);
          res.end();
        }
      }, 25);
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (req.headers.range) {
      const start = Number(req.headers.range.replace("bytes=", "").split("-")[0]);
      if (mode2 === "ignora-y-corta") {
        // Ignora el Range, declara el fichero entero y corta a
        // los 1.000 B: el cuerpo nuevo no demuestra nada.
        res.writeHead(200, { "Content-Length": payload.length });
        res.write(payload.subarray(0, 1000), () => res.socket?.destroy());
        return;
      }
      const slice = payload.subarray(start);
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${payload.length - 1}/${payload.length}`,
        "Content-Length": slice.length,
      });
      res.end(slice);
      return;
    }
    res.writeHead(200, { "Content-Length": payload.length });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
  const address = server2.address();
  base2 = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  server2.close();
  await rm(dir2, { recursive: true, force: true });
});

describe("downloadModel — extensión de E4 (paso 4)", () => {
  it("prueba 10 · el progreso se cuenta con el desplazamiento de la reanudación y nunca pasa del total", async () => {
    mode2 = "normal";
    const entry = entry2("progreso-contado");
    await writeFile(path.join(dir2, "progreso-contado.gguf.part"), payload.subarray(0, 4000));
    const events: number[] = [];
    const result = await downloadModel(entry, dir2, {
      onProgress: (downloaded) => events.push(downloaded),
    });
    expect(result.resumedFrom).toBe(4000);
    expect(events[0]).toBe(4000);
    expect(events[events.length - 1]).toBe(payload.length);
    for (let i = 0; i < events.length; i++) {
      expect(events[i]).toBeLessThanOrEqual(payload.length);
      if (i > 0) expect(events[i]).toBeGreaterThanOrEqual(events[i - 1]);
    }
  });

  it("prueba 11 · pausar conserva el .part y lanza DownloadPaused, sin confundirlo con un fallo", async () => {
    mode2 = "a-gotas";
    const entry = entry2("pausa-a-mitad");
    const controller = new AbortController();
    await expect(
      downloadModel(entry, dir2, {
        signal: controller.signal,
        // Pausa con varios trozos ya en vuelo: los primeros han
        // llegado al disco cuando la señal corta la corriente.
        onProgress: (downloaded) => {
          if (downloaded >= 3000) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(DownloadPaused);
    const part = await stat(path.join(dir2, "pausa-a-mitad.gguf.part"));
    expect(part.size).toBeGreaterThan(0);
    expect(part.size).toBeLessThan(payload.length);
    await expect(stat(path.join(dir2, "pausa-a-mitad.gguf"))).rejects.toThrow();
    mode2 = "normal";
  });

  it("prueba 11 (antes de empezar) · una señal ya abortada no hace ni una petición", async () => {
    mode2 = "normal";
    const entry = entry2("pausa-previa");
    await writeFile(path.join(dir2, "pausa-previa.gguf.part"), payload.subarray(0, 4000));
    const controller = new AbortController();
    controller.abort();
    requests2 = 0;
    await expect(
      downloadModel(entry, dir2, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(DownloadPaused);
    expect(requests2).toBe(0);
    const part = await readFile(path.join(dir2, "pausa-previa.gguf.part"));
    expect(part.equals(payload.subarray(0, 4000))).toBe(true);
  });

  it("prueba 12 · el descarte borra solo el .part: el final verificado queda byte a byte", async () => {
    mode2 = "normal";
    const entry = entry2("descarte-solo-part");
    await writeFile(path.join(dir2, "descarte-solo-part.gguf"), payload);
    await writeFile(path.join(dir2, "descarte-solo-part.gguf.part"), payload.subarray(0, 3000));
    await discardDownload(entry, dir2);
    await expect(stat(path.join(dir2, "descarte-solo-part.gguf.part"))).rejects.toThrow();
    const onDisk = await readFile(path.join(dir2, "descarte-solo-part.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
    // Descartar sin nada que descartar no es un error.
    await discardDownload(entry2("descarte-vacio"), dir2);
  });

  it("D-1 · un cuerpo que supera los bytes declarados aborta en vuelo y su destino es el borrado", async () => {
    mode2 = "doble-cuerpo";
    const entry = entry2("tope-en-vuelo");
    await expect(downloadModel(entry, dir2)).rejects.toBeInstanceOf(LoadRefusal);
    await expect(stat(path.join(dir2, "tope-en-vuelo.gguf"))).rejects.toThrow();
    await expect(stat(path.join(dir2, "tope-en-vuelo.gguf.part"))).rejects.toThrow();
    mode2 = "normal";
  });

  it("D-3 · un .part que es un enlace se rechaza sin escribir un byte sobre su destino", async () => {
    mode2 = "normal";
    const entry = entry2("part-enlace");
    const victim = path.join(dir2, "victima-part.bin");
    const victimBytes = Buffer.from("bytes ajenos que no se tocan");
    await writeFile(victim, victimBytes);
    await symlink(victim, path.join(dir2, "part-enlace.gguf.part"));
    requests2 = 0;
    await expect(downloadModel(entry, dir2)).rejects.toBeInstanceOf(LoadRefusal);
    expect(requests2).toBe(0);
    expect((await readFile(victim)).equals(victimBytes)).toBe(true);
    expect((await lstat(path.join(dir2, "part-enlace.gguf.part"))).isSymbolicLink()).toBe(true);
  });

  it("D-3 · un final que es un enlace se rechaza sin tocar su destino", async () => {
    mode2 = "normal";
    const entry = entry2("final-enlace");
    const victim = path.join(dir2, "victima-final.bin");
    const victimBytes = Buffer.from("otros bytes ajenos");
    await writeFile(victim, victimBytes);
    await symlink(victim, path.join(dir2, "final-enlace.gguf"));
    requests2 = 0;
    await expect(downloadModel(entry, dir2)).rejects.toBeInstanceOf(LoadRefusal);
    expect(requests2).toBe(0);
    expect((await readFile(victim)).equals(victimBytes)).toBe(true);
  });

  it("D-7 · si el servidor ignora el Range y corta, el prefijo bueno sobrevive byte a byte", async () => {
    const entry = entry2("reanudacion-no-regresiva");
    await writeFile(
      path.join(dir2, "reanudacion-no-regresiva.gguf.part"),
      payload.subarray(0, 4000),
    );
    mode2 = "ignora-y-corta";
    await expect(downloadModel(entry, dir2)).rejects.toThrow();
    const part = await readFile(path.join(dir2, "reanudacion-no-regresiva.gguf.part"));
    expect(part.equals(payload.subarray(0, 4000))).toBe(true);
    await expect(
      stat(path.join(dir2, "reanudacion-no-regresiva.gguf.part.fresh")),
    ).rejects.toThrow();
    // Y el siguiente intento honesto reanuda desde el prefijo.
    mode2 = "normal";
    const result = await downloadModel(entry, dir2);
    expect(result.resumedFrom).toBe(4000);
    const onDisk = await readFile(path.join(dir2, "reanudacion-no-regresiva.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// La declaración de reparación de D-2 (paso 5; política de la
// apertura §3.4): el resultado nombra la reparación cuando la
// llamada retiró un final que no verificaba y bajó de cero.
// Los dos casos que la tabla de la apertura firma.
// ---------------------------------------------------------------------
describe("downloadModel — la reparación declarada (D-2)", () => {
  it("un final de 12 B de basura se repara y el resultado lo declara", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("reparacion-basura");
    await writeFile(path.join(dir, "reparacion-basura.gguf"), Buffer.alloc(12, 5));
    const result = await downloadModel(entry, dir);
    expect(result.repairedCorruptFinal).toBe(true);
    const onDisk = await readFile(path.join(dir, "reparacion-basura.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("un gemelo de tamaño exacto con un byte cambiado se repara y se declara", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const entry = entryFor("reparacion-gemelo");
    const bad = Buffer.from(payload);
    bad[9999] = (bad[9999] ?? 0) ^ 0xff;
    await writeFile(path.join(dir, "reparacion-gemelo.gguf"), bad);
    const result = await downloadModel(entry, dir);
    expect(result.repairedCorruptFinal).toBe(true);
    const onDisk = await readFile(path.join(dir, "reparacion-gemelo.gguf"));
    expect(onDisk.equals(payload)).toBe(true);
  });

  it("una descarga limpia declara repairedCorruptFinal en falso", async () => {
    rangeMode = "honesto";
    serveCorrupt = false;
    const result = await downloadModel(entryFor("reparacion-limpia"), dir);
    expect(result.repairedCorruptFinal).toBe(false);
  });
});
