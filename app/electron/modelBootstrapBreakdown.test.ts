/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * §5 del bloque del loop (H-LOOP-7, menor): la ficha del modelo
 * sin su cuenta en arranque limpio. Hay dos serializaciones de
 * la lista de modelos y no dicen lo mismo: `modelList()` (la
 * del `nido:bootstrap`) no emitía `breakdown` ni `budgetBytes`,
 * así que la ficha alimentada por ella solo podía enseñar la
 * licencia; y `pull` no tenía red: si la invocación entera de
 * la lista rechazaba, la promesa quedaba sin cazar y la vista
 * se quedaba con el bootstrap para siempre, sin ningún aviso.
 * La cuenta nunca estuvo rota (el plan se calcula en cada
 * llamada): lo que faltaba era que LLEGARA a la ficha.
 *
 * Los dos cargos:
 *
 * 1. Por el arnés de servicios reales, contra el manejador de
 *    `nido:bootstrap`: en arranque limpio (la escena siembra el
 *    GGUF genuino del 0.6B en el directorio de modelos y ningún
 *    modelo se carga), el payload para ese modelo instalado
 *    trae `breakdown` con `total > 0` y `budgetBytes` no nulo;
 *    un modelo no instalado los trae en nulo, como su plan.
 *    Hoy nace en rojo por ausencia del campo: ningún test vivo
 *    invocaba este canal.
 * 2. La red de `pull`, como caso de contrato estático sobre
 *    App.tsx (la forma de lectura de fuente de la casa para el
 *    renderizador: no existe batería de superficie para App):
 *    el cuerpo de `pull` caza el rechazo de la invocación
 *    entera y, en esa rama, cae a `modelsListLight()` antes de
 *    rendirse al bootstrap. Hoy nace en rojo: `pull` no trae
 *    ninguna caza y la ligera solo aparece en su rama directa.
 *
 * Sin canal nuevo: solo cambia el payload de uno existente,
 * que el censo de canales no cobra por forma de argumentos.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

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

const PASSWORD = "sonda-loop2-ficha";

const event = {
  sender: { send: () => undefined },
  senderFrame: { url: "nido://app/index.html" },
};

type BootModel = {
  id: string;
  installed: boolean;
  breakdown?: {
    weights: number;
    kv: number;
    compute: number;
    logits: number;
    total: number;
  } | null;
  budgetBytes?: number | null;
};
type BootReply = { ok: boolean; models?: BootModel[] };

function call<T>(channel: string, args?: unknown): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`sin manejador registrado: ${channel}`);
  return fn(event, args) as Promise<T>;
}

beforeAll(async () => {
  const fixtureBase = path.join(process.cwd(), "..", "nido-fixture-tmp");
  mkdirSync(fixtureBase, { recursive: true });
  harness.userData = mkdtempSync(path.join(fixtureBase, "nido-loop2-ficha-"));
  // El GGUF genuino del 0.6B sembrado por enlace duro en el
  // directorio de modelos de la escena: el modelo está
  // INSTALADO en el arranque limpio, sin cargar.
  const modelsDir = path.join(harness.userData, "models");
  mkdirSync(modelsDir, { recursive: true });
  linkSync(
    path.join(process.cwd(), "models", "qwen3-0.6b-q4km.gguf"),
    path.join(modelsDir, "qwen3-0.6b-q4km.gguf"),
  );
  await installServices();
  const created = await call<{ ok: boolean }>("nido:vault-create", { password: PASSWORD });
  expect(created.ok).toBe(true);
}, 120_000);

afterAll(() => {
  rmSync(harness.userData, { recursive: true, force: true });
});

describe("§5 · la cuenta de la ficha en arranque limpio", () => {
  it("el payload de nido:bootstrap trae la cuenta del modelo instalado, sin cargarlo", async () => {
    const boot = await call<BootReply>("nido:bootstrap");
    expect(boot.ok).toBe(true);
    const installed = boot.models?.find((m) => m.id === "qwen3-0.6b-q4km");
    expect(installed).toBeTruthy();
    expect(installed!.installed).toBe(true);
    expect(installed!.breakdown).not.toBeNull();
    expect(installed!.breakdown!.total).toBeGreaterThan(0);
    expect(installed!.breakdown!.weights).toBeGreaterThan(0);
    expect(typeof installed!.budgetBytes).toBe("number");
    expect(installed!.budgetBytes!).toBeGreaterThan(0);
    // Un modelo no instalado no trae cuenta: su plan es nulo.
    const absent = boot.models?.find((m) => m.id === "qwen3-32b-q4km");
    expect(absent).toBeTruthy();
    expect(absent!.installed).toBe(false);
    expect(absent!.breakdown ?? null).toBeNull();
    expect(absent!.budgetBytes ?? null).toBeNull();
  });

  it("pull caza el rechazo de la invocación entera y cae a la forma ligera (contrato estático)", () => {
    const appSrc = readFileSync(path.join(process.cwd(), "app", "src", "App", "App.tsx"), "utf8");
    const start = appSrc.indexOf("const pull = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = appSrc.indexOf("void pull(false);", start);
    expect(end).toBeGreaterThan(start);
    const pullSrc = appSrc.slice(start, end);
    // La caza existe y la rama del rechazo pide la ligera: la
    // palabra `catch` aparece y `modelsListLight()` se invoca
    // también DESPUÉS de ella (la primera aparición es la rama
    // directa de la forma ligera, que ya existía).
    const catchAt = pullSrc.indexOf("catch");
    expect(catchAt).toBeGreaterThan(-1);
    const lightAfterCatch = pullSrc.indexOf("modelsListLight()", catchAt);
    expect(lightAfterCatch).toBeGreaterThan(catchAt);
  });
});
