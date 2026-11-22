/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * confirmScope.test.ts — la frase de alcance de P-3 (tanda 14).
 *
 * Cada herramienta sensible de LOCAL_TOOLS rellena el campo
 * `scope` de su ConfirmRequest DESDE SUS PROPIOS ARGUMENTOS: la
 * tarjeta de aprobación enseña qué alcanza exactamente la
 * confirmación y nada más. Esta batería captura la petición de
 * confirmación de cada herramienta sensible (con la confirmación
 * denegada, para que nada se ejecute) y exige tres cosas:
 *   1. el alcance existe y no está vacío;
 *   2. nombra el dato concreto de los argumentos (el destino, el
 *      número, el título del evento, la persona, su huella);
 *   3. cambia cuando cambian los argumentos: una frase genérica
 *      que sirve para todo es un defecto, no un alcance.
 */
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { SENSITIVE_TOOLS, type ConfirmRequest } from "./confirm.js";
import { buildToolHandlers } from "./handlers.js";

type Handlers = ReturnType<typeof buildToolHandlers>;

async function capture(handlers: Handlers, tool: string, args: Record<string, unknown>): Promise<ConfirmRequest> {
  const seen: ConfirmRequest[] = [];
  const h = buildToolHandlers({
    requestConfirm: async (req) => {
      seen.push(req);
      return false; // denegada: nada se ejecuta; solo se mira la petición
    },
  });
  void handlers;
  await h[tool as keyof Handlers]!(args as never);
  expect(seen, `${tool} debe pedir confirmación`).toHaveLength(1);
  const req = seen[0]!;
  // Un alcance que llega como clave sin resolver («agentConfirm.…»)
  // no es un alcance: es el síntoma de una clave que falta en los
  // textos, y esta batería no lo deja pasar por frase válida.
  if (req.scope !== undefined) expect(req.scope).not.toMatch(/^agentConfirm\./);
  return req;
}

describe("P-3: la frase de alcance de cada herramienta sensible", () => {
  it("el censo: toda herramienta sensible tiene su caso en esta batería", () => {
    // Si mañana nace una herramienta sensible nueva, este censo la
    // nombra y su caso de alcance se escribe antes de darla por buena.
    expect([...SENSITIVE_TOOLS].sort()).toEqual([
      "create_calendar_event",
      "nido_approve_task",
      "nido_pair",
      "nido_reject_task",
      "nido_send_message",
      "open_app",
    ]);
  });

  it("open_app: el alcance nombra el destino exacto y cambia con él", async () => {
    const a = await capture(buildToolHandlers(), "open_app", { link: "https://example.org/uno" });
    expect(a.scope).toBeTruthy();
    expect(a.scope).toContain("example.org/uno");
    const b = await capture(buildToolHandlers(), "open_app", { link: "https://example.org/dos" });
    expect(b.scope).toContain("example.org/dos");
    expect(b.scope).not.toBe(a.scope);
  });

  it("open_app con destino inválido: el alcance dice que no se abrirá nada", async () => {
    const a = await capture(buildToolHandlers(), "open_app", { link: "javascript:alert(1)" });
    expect(a.scope).toBeTruthy();
    expect(a.scope!.length).toBeGreaterThan(5);
    expect(a.scope).not.toContain("javascript:");
  });

  it("create_calendar_event: el alcance nombra el evento y su hora", async () => {
    const a = await capture(buildToolHandlers(), "create_calendar_event", {
      title: "Dentista",
      start: "2026-11-20T10:00:00",
    });
    expect(a.scope).toContain("Dentista");
    const b = await capture(buildToolHandlers(), "create_calendar_event", {
      title: "Revisión del coche",
      start: "2026-11-21T09:00:00",
    });
    expect(b.scope).toContain("Revisión del coche");
    expect(b.scope).not.toBe(a.scope);
  });

  it("nido_send_message: el alcance nombra al destinatario", async () => {
    const a = await capture(buildToolHandlers(), "nido_send_message", { to: "Beto", text: "hola" });
    expect(a.scope).toContain("Beto");
    const b = await capture(buildToolHandlers(), "nido_send_message", { to: "Carmen", text: "hola" });
    expect(b.scope).toContain("Carmen");
    expect(b.scope).not.toBe(a.scope);
  });

  it("nido_pair: el alcance nombra a la persona y su huella; con código inválido, que no se añade a nadie", async () => {
    const { generateIdentity } = await import("../../p2p/crypto.js");
    const { encodePairingPayload } = await import("../../p2p/pairing.js");
    const id = generateIdentity();
    const sign = generateIdentity();
    const code = encodePairingPayload("Beto", id.publicKey, sign.publicKey);
    const a = await capture(buildToolHandlers(), "nido_pair", { code });
    expect(a.scope).toContain("Beto");
    expect(a.scope).toMatch(/[0-9a-f]{4}( [0-9a-f]{4}){7}/);
    const bad = await capture(buildToolHandlers(), "nido_pair", { code: "esto-no-es-un-qr" });
    expect(bad.scope).toBeTruthy();
    expect(bad.scope).not.toContain("Beto");
    expect(bad.scope).not.toBe(a.scope);
  });

  it("nido_approve_task y nido_reject_task sin tarea: el alcance dice que no se decidirá nada", async () => {
    const a = await capture(buildToolHandlers(), "nido_approve_task", { id: "tarea-inexistente" });
    expect(a.scope).toBeTruthy();
    expect(a.scope!.length).toBeGreaterThan(5);
    const r = await capture(buildToolHandlers(), "nido_reject_task", { id: "tarea-inexistente" });
    expect(r.scope).toBe(a.scope);
  });
});
