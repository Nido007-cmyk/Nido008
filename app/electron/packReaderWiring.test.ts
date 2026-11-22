/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * B-1 del bloque de cableado (Biblioteca): el lector de guías.
 * El núcleo ya vive en PC como copia fiel (listPackGuides y
 * readPackGuide en src/rag/packs.ts, con su batería de 7 casos)
 * pero ningún consumidor de producción lo alcanzaba: ni canal,
 * ni puente, ni vista. Esta pieza cablea el camino entero,
 * espejo de GuideLibraryScreen del móvil: dos canales nuevos
 * componen desde el núcleo sin implementar nada por su cuenta,
 * y B-4 se cobra dentro con su canal propio (rama β dirimida
 * en la apertura): la tarjeta de paquetes deriva su foto al
 * entrar por `nido:library-data`, el mismo `libraryData()` que
 * el bootstrap compone, con `boot.library` como foto inicial.
 *
 * Los cargos, con el arnés de servicios reales de la casa
 * (doble de Electron y manejadores reales cobrados por canal).
 * La escena: el pack real del Esencial enlazado en su sitio de
 * la casa (store/packs/corpus, como las escenas del bloque del
 * loop siembran sus paquetes) y un paquete v1 fabricado e
 * importado por el registro de su propio módulo, sin tabla de
 * guías, para el cargo de la exclusión:
 *
 * 1. Las secciones del índice se componen desde el núcleo:
 *    `nido:pack-guides` devuelve una sola sección, la del
 *    Esencial, con su id, su etiqueta del catálogo y sus 174
 *    guías con id, título y categoría en su orden.
 * 2. Un paquete sin guías queda fuera de las secciones: el
 *    paquete v1 importado de la escena no aparece.
 * 3. El documento entero vuelve por `nido:pack-guide-read`
 *    con su orden de lectura (el trozo sin apartado primero)
 *    y su fuente.
 * 4. La ausencia en la forma del patrón: una guía que no está
 *    y un paquete que no está devuelven `{ ok: true, doc:
 *    null }`, sin error.
 * 5. B-4 por su canal: `nido:library-data` sirve la misma
 *    composición que el bootstrap (la fila del Esencial con
 *    su nombre y su marca, y el conteo de datos).
 * 6. El cargo de la vista como contrato estático, declarado
 *    como tal (PC no tiene batería de superficie para App y
 *    esta orden no finge una): App.tsx consume los tres
 *    canales por el puente y nombra la entrada guideLibrary
 *    del gesto. El camino entero en vivo lo cobra la
 *    verificación de la pieza.
 * 7. Sin sesión, `locked` en los tres canales: con la bóveda
 *    cerrada responden `{ ok: false, reason: "locked" }`.
 *
 * Todos nacen en rojo contra la punta sin la pieza: los
 * canales no existen, el puente no los nombra y la vista no
 * los consume; el arnés lo cobra caso a caso.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (_name: string) => harness.userData,
    getAppPath: () => harness.userData,
    getVersion: () => "0.1.0",
    on: () => undefined,
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
import { writeImportedPacks } from "../../src/models/importedPacksRegistry.js";

const PASSWORD = "sonda-cableado3-lector";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type GuideRow = { id: number; title: string; category: string };
type Section = { packId: string; name: string; guides: GuideRow[] };
type GuidesReply = { ok: boolean; reason?: string; sections?: Section[] };
type DocReply = {
  ok: boolean;
  reason?: string;
  doc?: { title: string; source: string; body: string } | null;
};
type LibraryReply = {
  ok: boolean;
  reason?: string;
  packs?: { id: string; name: string; outdated: boolean }[];
  factCount?: number;
};
type Reply = { ok: boolean; reason?: string };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

const ESENCIAL_LABEL = "NIDO Essentials: first aid, health, disasters, survival";

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-cableado3-lector-"));
  const corpusDir = path.join(harness.userData, "store", "packs", "corpus");
  mkdirSync(corpusDir, { recursive: true });
  // El pack real del Esencial, en su sitio de la casa: la vía
  // de packs rechaza simbólicos, así que enlace duro desde el
  // paquete incluido en el árbol, como la escena de §1 del
  // bloque del loop.
  linkSync(
    path.join(process.cwd(), "assets", "bundled-packs", "nido-esencial.sqlite"),
    path.join(corpusDir, "nido-esencial.sqlite"),
  );
  // El paquete sin guías de la escena: un v1 fabricado (meta y
  // trozos, sin tabla de guías), que la apertura cobra por el
  // registro de importación de su propio módulo tras crear la
  // bóveda, con la huella de sus bytes reales como pin.
  const noGuidesPath = path.join(corpusDir, "sin-guias.sqlite");
  const db = new DatabaseSync(noGuidesPath);
  db.exec(
    "CREATE TABLE meta (key TEXT, value TEXT);" +
      "CREATE TABLE chunks (id INTEGER, title TEXT, body TEXT, source TEXT);",
  );
  const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  insMeta.run("format", "nido-knowledge-pack");
  insMeta.run("formatVersion", "1");
  insMeta.run("dims", "384");
  insMeta.run(
    "embeddingModelSha256",
    "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
  );
  db.prepare("INSERT INTO chunks (id, title, body, source) VALUES (?, ?, ?, ?)").run(
    1,
    "Nota suelta",
    "Un trozo sin guía.",
    "Escena",
  );
  db.close();

  await installServices();
  const created = await call<Reply>("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);

  const bytes = readFileSync(noGuidesPath);
  await writeImportedPacks({
    "sin-guias.sqlite": {
      origin: "nido",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: statSync(noGuidesPath).size,
      name: "Escena sin guías",
      importedAt: "2026-11-21T00:00:00.000Z",
    },
  });
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("B-1 · el lector de guías: canales, composición y B-4", () => {
  it("las secciones se componen desde el núcleo: el Esencial, su etiqueta y sus guías en orden", async () => {
    const r = await call<GuidesReply>("nido:pack-guides");
    expect(r.ok).toBe(true);
    expect(r.sections).toHaveLength(1);
    const s = r.sections![0];
    expect(s.packId).toBe("nido-esencial");
    expect(s.name).toBe(ESENCIAL_LABEL);
    expect(s.guides).toHaveLength(174);
    expect(s.guides[0]).toMatchObject({
      id: 1,
      title: "What to do in an emergency",
      category: "First aid",
    });
    expect(s.guides[1]).toMatchObject({
      id: 2,
      title: "CPR for adults and older children",
      category: "First aid",
    });
  });

  it("un paquete sin guías queda fuera de las secciones", async () => {
    const r = await call<GuidesReply>("nido:pack-guides");
    expect(r.ok).toBe(true);
    const ids = (r.sections ?? []).map((s) => s.packId);
    expect(ids).not.toContain("local-sin-guias");
    expect(ids).toEqual(["nido-esencial"]);
  });

  it("el documento entero vuelve con su orden de lectura y su fuente", async () => {
    const r = await call<DocReply>("nido:pack-guide-read", {
      packId: "nido-esencial",
      guideId: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.doc).not.toBeNull();
    expect(r.doc!.title).toBe("CPR for adults and older children");
    // El trozo sin apartado va primero: el cuerpo abre con él,
    // y los apartados le siguen en su orden.
    expect(
      r.doc!.body.startsWith(
        "If someone collapses, does not respond and is not breathing normally",
      ),
    ).toBe(true);
    expect(r.doc!.body).toContain("Chest compressions");
    expect(r.doc!.source).toContain("NIDO — CPR for adults and older children");
  });

  it("la ausencia en la forma del patrón: guía que no está y paquete que no está dan doc null", async () => {
    const noGuide = await call<DocReply>("nido:pack-guide-read", {
      packId: "nido-esencial",
      guideId: 999999,
    });
    expect(noGuide.ok).toBe(true);
    expect(noGuide.doc).toBeNull();

    const noPack = await call<DocReply>("nido:pack-guide-read", {
      packId: "paquete-que-no-esta",
      guideId: 1,
    });
    expect(noPack.ok).toBe(true);
    expect(noPack.doc).toBeNull();
  });

  it("B-4: library-data sirve la composición del bootstrap por su canal", async () => {
    const r = await call<LibraryReply>("nido:library-data");
    expect(r.ok).toBe(true);
    const row = (r.packs ?? []).find((p) => p.id === "nido-esencial");
    expect(row).toBeDefined();
    expect(row!.name).toBe(ESENCIAL_LABEL);
    expect(typeof row!.outdated).toBe("boolean");
    expect(typeof r.factCount).toBe("number");
  });

  it("la vista consume los tres canales por el puente y nombra la entrada (contrato estático)", () => {
    const appSrc = readFileSync(
      fileURLToPath(new URL("../src/App/App.tsx", import.meta.url)),
      "utf8",
    );
    expect(appSrc).toContain("window.nido.packGuides(");
    expect(appSrc).toContain("window.nido.packGuideRead(");
    expect(appSrc).toContain("window.nido.libraryData(");
    expect(appSrc).toContain("guideLibrary");
  });

  it("sin sesión, los tres canales responden locked", async () => {
    const locked = await call<Reply>("nido:vault-lock");
    expect(locked.ok).toBe(true);

    const guides = await call<GuidesReply>("nido:pack-guides");
    expect(guides.ok).toBe(false);
    expect(guides.reason).toBe("locked");

    const doc = await call<DocReply>("nido:pack-guide-read", {
      packId: "nido-esencial",
      guideId: 2,
    });
    expect(doc.ok).toBe(false);
    expect(doc.reason).toBe("locked");

    const lib = await call<LibraryReply>("nido:library-data");
    expect(lib.ok).toBe(false);
    expect(lib.reason).toBe("locked");
  });
});
