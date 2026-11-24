/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Superficies de bóveda (PAQ-2) · borrar todo desde la
 * superficie: la única primitiva que había,
 * `wipeDatabase`, borra un solo fichero y su delegado
 * no tenía ningún llamante. La cura es el canal
 * `nido:vault-wipe` sobre la primitiva extendida
 * (`src/security/vaultWipe.ts`: censo canónico entero,
 * marcador durable con recuperación al arranque,
 * triturado criptográfico primero, verificación que
 * nombra los restos): aceptación de alcance y
 * re-autenticación en el principal, desmontaje entero,
 * borrado y reinicio por la costura de la rotación. Si
 * quedan restos, la app NO se reinicia fingiendo
 * éxito: responde `wipe-incomplete` con los nombres y
 * el marcador queda puesto para que el arranque lo
 * complete.
 *
 * Los cargos, con el arnés de servicios reales de la
 * casa (doble de Electron con la costura de reinicio
 * registrada, manejadores reales cobrados por canal):
 *
 * 1. Escena: bóveda con datos sembrados en cada punto
 *    del censo (las tres bases, conversaciones
 *    selladas, packs, prefs, modelos con un fichero
 *    señuelo, temporales).
 * 2. Sin sesión → `locked`; sin aceptación de alcance
 *    → `scope-required`.
 * 3. Contraseña mala → `reauth-failed` y el censo
 *    intacto entero.
 * 4. Borrado bueno → el reinicio se pide por la
 *    costura; el censo verificado tras el borrado está
 *    vacío punto por punto; al «reabrir» no hay bóveda
 *    y `nido:vault-create` vuelve a funcionar (primer
 *    día de verdad).
 * 5. Un fichero que no se puede borrar (simulado por
 *    la costura de prueba de la primitiva, como el
 *    sabotaje de deleteAsync del móvil) →
 *    `wipe-incomplete` con su nombre, el marcador
 *    queda puesto, y la recuperación de arranque (la
 *    cabeza de installServices) lo completa en la
 *    segunda pasada.
 *
 * Nacimiento: rojo por la causa raíz declarada (el
 * canal no está registrado y la primitiva extendida
 * no existe); la escena pasa porque usa solo canales
 * que ya existían.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const harness = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, (event: unknown, args: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, args: unknown) => void>(),
  relaunched: 0,
  exited: -1,
  sabotageWipe: false,
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

// La costura de sabotaje: la primitiva corre entera
// (marcador, orden, verificación); solo la hoja que
// borra el punto `assets` finge fallar mientras la
// bandera del arnés esté puesta. Es la forma del
// sabotaje de deleteAsync en la batería del móvil.
vi.mock("../../src/security/vaultWipe.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/security/vaultWipe.ts")>();
  return {
    ...real,
    wipeAllState: (base: string) =>
      real.wipeAllState(base, (abs: string) => {
        if (harness.sabotageWipe && abs === path.join(base, "assets")) {
          throw new Error("sabotaje de la batería: assets no se deja borrar");
        }
        rmSync(abs, { recursive: true, force: true });
      }),
  };
});

vi.mock("./shell.ts", async () => {
  const real = await import("./appUrl.ts");
  return { isAppUrl: real.isAppUrl };
});

import { installServices } from "./services.ts";
import * as memoryStore from "../../src/agent/memory/memoryStore.js";

const PASSWORD = "sonda-boveda-borrar";
const HEAVY = { timeout: 180_000 };

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type WipeReply = { ok: boolean; reason?: string; names?: string[] };
type BootReply = { ok: boolean; vault?: { exists: boolean; unlocked: boolean } };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

/** Los puntos del censo con presencia comprobable en disco.
 * `store/conversations.sealed` no es punto sembrado: el
 * almacén sellado es un fichero vivo que la propia app
 * descarta al desbloquear si no lo puede abrir (un
 * señuelo de bytes no sobrevive al ciclo de
 * bloquear/desbloquear de los primeros casos), y su
 * destino lo cobra el caso del borrado bueno afirmando
 * que el directorio store/ entero desaparece. */
const CENSUS_POINTS = [
  "vault/nido-keyvault.json",
  "store/nido_memory.db",
  "store/nido_search.db",
  "store/packs",
  "knowledge/nido_knowledge.db",
  "nido-prefs.json",
  "models",
  "assets",
  "export-tmp",
  "paste-tmp",
];

/** Siembra presencia en cada punto del censo (señuelos donde el dato real es caro). */
function seedCensus(): void {
  const base = harness.userData;
  const put = (rel: string, content = "semilla") => {
    const abs = path.join(base, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  put("store/packs/paquete.nidopack", "paquete-senuelo");
  put("knowledge/nido_knowledge.db", "conocimiento-senuelo");
  put("knowledge/nido_knowledge.db.format.json", "{}");
  put("models/modelo.gguf", "modelo-senuelo");
  put("assets/voz.onnx", "voz-senuelo");
  put("export-tmp/exportacion.json", "{}");
  put("paste-tmp/pegado.txt", "pegado");
  put("vault/nido-rotation-staging.json", "{}");
}

function censusPresent(): string[] {
  return CENSUS_POINTS.filter((rel) => existsSync(path.join(harness.userData, rel)));
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-boveda-wipe-"));
  await installServices();
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("Superficies de bóveda · borrar todo por la superficie (PAQ-2)", () => {
  it("escena: bóveda creada por su canal, una nota real, las prefs escritas y presencia en cada punto del censo", HEAVY, async () => {
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    await memoryStore.saveNote({ title: "nota-del-borrado", body: "esto también se borra" });
    await call<{ ok: boolean }>("nido:prefs-set", { patch: { lang: "es" } });
    seedCensus();
    expect(censusPresent()).toEqual(CENSUS_POINTS);
  });

  it("sin sesión responde locked, y sin aceptación de alcance responde scope-required", HEAVY, async () => {
    await call<{ ok: boolean }>("nido:vault-lock");
    const locked = await call<WipeReply>("nido:vault-wipe", {
      password: PASSWORD,
      scopeAccepted: true,
    });
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe("locked");
    const un = await call<{ ok: boolean }>("nido:vault-unlock", { password: PASSWORD });
    expect(un.ok).toBe(true);
    const scope = await call<WipeReply>("nido:vault-wipe", {
      password: PASSWORD,
      scopeAccepted: false,
    });
    expect(scope.ok).toBe(false);
    expect(scope.reason).toBe("scope-required");
    expect(censusPresent()).toEqual(CENSUS_POINTS);
  });

  it("contraseña mala: reauth-failed y el censo intacto entero", HEAVY, async () => {
    const r = await call<WipeReply>("nido:vault-wipe", {
      password: "esta-no-es-la-contrasena",
      scopeAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("reauth-failed");
    expect(censusPresent()).toEqual(CENSUS_POINTS);
    const notes = await memoryStore.listNotes(50);
    expect(notes.map((n) => n.title)).toContain("nota-del-borrado");
  });

  it("borrado bueno: el reinicio se pide, el censo queda vacío punto por punto y el primer día vuelve de verdad", HEAVY, async () => {
    const relaunchedBefore = harness.relaunched;
    const r = await call<WipeReply>("nido:vault-wipe", {
      password: PASSWORD,
      scopeAccepted: true,
    });
    expect(r.ok).toBe(true);
    expect(harness.relaunched).toBe(relaunchedBefore + 1);
    expect(harness.exited).toBe(0);
    expect(censusPresent()).toEqual([]);
    // Los directorios del censo desaparecen enteros, el
    // de store/ incluido: el almacén sellado de
    // conversaciones se va con él.
    expect(existsSync(path.join(harness.userData, "store"))).toBe(false);
    expect(existsSync(path.join(harness.userData, "knowledge"))).toBe(false);
    expect(existsSync(path.join(harness.userData, ".nido-wipe-in-progress"))).toBe(false);
    // La reapertura simulada tras el reinicio: installServices
    // vuelve a correr (recrea los directorios de la casa, como
    // en el arranque real) y la superficie lee el mundo nuevo.
    await installServices();
    const boot = await call<BootReply>("nido:bootstrap");
    expect(boot.vault?.exists).toBe(false);
    // Primer día de verdad: crear la bóveda vuelve a funcionar.
    const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
    expect(created.ok).toBe(true);
    const boot2 = await call<BootReply>("nido:bootstrap");
    expect(boot2.vault?.exists).toBe(true);
    expect(boot2.vault?.unlocked).toBe(true);
  });

  it("un punto que no se puede borrar: wipe-incomplete con su nombre, el marcador queda puesto y la recuperación de arranque lo completa", HEAVY, async () => {
    // Mini-escena sobre la bóveda nueva del caso anterior.
    await memoryStore.saveNote({ title: "nota-del-incompleto", body: "queda a medias" });
    await call<{ ok: boolean }>("nido:prefs-set", { patch: { lang: "es" } });
    seedCensus();
    expect(censusPresent()).toEqual(CENSUS_POINTS);
    harness.sabotageWipe = true;
    const relaunchedBefore = harness.relaunched;
    const r = await call<WipeReply>("nido:vault-wipe", {
      password: PASSWORD,
      scopeAccepted: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("wipe-incomplete");
    expect(r.names).toEqual(["assets"]);
    // Sin reinicio fingido sobre un borrado a medias.
    expect(harness.relaunched).toBe(relaunchedBefore);
    expect(existsSync(path.join(harness.userData, ".nido-wipe-in-progress"))).toBe(true);
    expect(existsSync(path.join(harness.userData, "assets"))).toBe(true);
    // La segunda pasada: el arranque completa el borrado
    // antes de enseñar nada (la cabeza de installServices;
    // si algún runtime posterior se queja de la doble
    // instalación del arnés, el borrado ya corrió).
    harness.sabotageWipe = false;
    await installServices().catch(() => undefined);
    expect(existsSync(path.join(harness.userData, "assets"))).toBe(false);
    expect(existsSync(path.join(harness.userData, ".nido-wipe-in-progress"))).toBe(false);
    // Del censo solo reaparece models, y vacío: es el
    // directorio que el propio arranque recrea siempre,
    // el estado de un primer día, no un resto del borrado.
    expect(censusPresent()).toEqual(["models"]);
    expect(readdirSync(path.join(harness.userData, "models"))).toEqual([]);
  });
});
