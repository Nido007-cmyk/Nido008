/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolPolicy.test.ts — Batería A de la pieza de política
 * configurable por herramienta (tanda 13, acto 7 / pieza
 * «política»): la composición pura.
 *
 * La ley de la composición es solo restrictiva: la política
 * configurada nunca puede aflojar al motor de reglas. Un AUTO
 * configurado es la identidad (no apaga la confirmación de una
 * irreversible, no desbloquea una inyección); ASK solo puede
 * añadir confirmación; DENY gana a la confirmación; y sobre un
 * bloqueo de seguridad manda el bloqueo en el registro.
 *
 * Los fixtures llevan la forma real de PolicyDecision
 * ({allowed, risk, reason, requiresConfirmation,
 * injectionOrigin?}): la decisión del motor no trae el nombre
 * de la herramienta —entra como parámetro de la composición—
 * ni marca de confirmación ya dada (enmienda
 * ENMIENDA-HECHO-DECISION de la apertura de la pieza).
 */
import { describe, it, expect } from "vitest";
import {
  composeToolPolicy,
  type ToolPolicyTable,
} from "./toolPolicy.js";
import type { PolicyDecision } from "./policyEngine.js";

const plainAllow: PolicyDecision = {
  allowed: true,
  risk: "low",
  reason: "Action passed policy checks.",
  requiresConfirmation: false,
};

const irreversible: PolicyDecision = {
  allowed: true,
  risk: "critical",
  reason: "Tool 'delete_note' is irreversible and requires human confirmation.",
  requiresConfirmation: true,
};

const injectionBlocked: PolicyDecision = {
  allowed: false,
  risk: "high",
  reason: "Potential prompt injection detected. Action blocked.",
  requiresConfirmation: false,
  injectionOrigin: "tool_result (read_note)",
};

describe("composeToolPolicy: sin política, la decisión es la misma", () => {
  it("sin tabla, tabla vacía y tabla sin la herramienta: identidad", () => {
    const noTable = composeToolPolicy("create_reminder", plainAllow, undefined);
    expect(noTable.decision).toBe(plainAllow);
    expect(noTable.deniedByConfig).toBe(false);

    const empty = composeToolPolicy("create_reminder", plainAllow, {});
    expect(empty.decision).toBe(plainAllow);
    expect(empty.deniedByConfig).toBe(false);

    const other: ToolPolicyTable = { delete_note: "DENY" };
    const missing = composeToolPolicy("create_reminder", plainAllow, other);
    expect(missing.decision).toBe(plainAllow);
    expect(missing.deniedByConfig).toBe(false);
  });
});

describe("composeToolPolicy: AUTO configurado es la identidad", () => {
  it("AUTO sobre una decisión que no pide confirmación: idéntica", () => {
    const r = composeToolPolicy("create_reminder", plainAllow, { create_reminder: "AUTO" });
    expect(r.decision).toBe(plainAllow);
    expect(r.deniedByConfig).toBe(false);
  });

  it("AUTO sobre una irreversible: sigue pidiendo confirmación", () => {
    const r = composeToolPolicy("delete_note", irreversible, { delete_note: "AUTO" });
    expect(r.decision).toBe(irreversible);
    expect(r.decision.requiresConfirmation).toBe(true);
    expect(r.deniedByConfig).toBe(false);
  });

  it("AUTO sobre un bloqueo por inyección: sigue bloqueada", () => {
    const r = composeToolPolicy("delete_note", injectionBlocked, { delete_note: "AUTO" });
    expect(r.decision).toBe(injectionBlocked);
    expect(r.decision.allowed).toBe(false);
    expect(r.deniedByConfig).toBe(false);
  });
});

describe("composeToolPolicy: ASK solo puede añadir confirmación", () => {
  it("ASK sobre una decisión que no pide confirmación: la pide, y la razón nombra la política configurada", () => {
    const r = composeToolPolicy("create_reminder", plainAllow, { create_reminder: "ASK" });
    expect(r.decision.allowed).toBe(true);
    expect(r.decision.requiresConfirmation).toBe(true);
    expect(r.decision.reason).toContain("política configurada");
    expect(r.deniedByConfig).toBe(false);
  });

  it("ASK sobre una decisión que ya pide confirmación: sigue pidiendo, sin perder el injectionOrigin", () => {
    const withOrigin: PolicyDecision = {
      ...irreversible,
      injectionOrigin: "tool_result (read_note)",
    };
    const r = composeToolPolicy("delete_note", withOrigin, { delete_note: "ASK" });
    expect(r.decision.requiresConfirmation).toBe(true);
    expect(r.decision.injectionOrigin).toBe("tool_result (read_note)");
    expect(r.deniedByConfig).toBe(false);
  });

  it("ASK sobre una decisión bloqueada: intacta (la mitad «ya confirmada» de la orden es vacua: ningún tipo del árbol porta esa marca)", () => {
    const onBlocked = composeToolPolicy("delete_note", injectionBlocked, { delete_note: "ASK" });
    expect(onBlocked.decision).toBe(injectionBlocked);
    expect(onBlocked.deniedByConfig).toBe(false);
  });
});

describe("composeToolPolicy: DENY gana a todo lo ejecutable", () => {
  it("DENY sobre una decisión que ejecutaría: denegada por configuración", () => {
    const r = composeToolPolicy("create_reminder", plainAllow, { create_reminder: "DENY" });
    expect(r.deniedByConfig).toBe(true);
  });

  it("DENY sobre una decisión pendiente de confirmación: el DENY gana a la confirmación", () => {
    const r = composeToolPolicy("delete_note", irreversible, { delete_note: "DENY" });
    expect(r.deniedByConfig).toBe(true);
  });

  it("DENY sobre un bloqueo por inyección: manda el bloqueo, no la configuración", () => {
    const r = composeToolPolicy("delete_note", injectionBlocked, { delete_note: "DENY" });
    expect(r.deniedByConfig).toBe(false);
    expect(r.decision).toBe(injectionBlocked);
  });
});
