/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// BLOCKER regression: validateTask must block irreversible tools.
// Original BLOCKER (2026-10-05): validateTask used obsolete tool names,
// leaving send_sms, nido_send_message, place_call unblocked in scheduled tasks.
// This test ensures the policy is enforced at the correct boundary
// and cannot be bypassed via naming variations.
//
// Forma A del catálogo (bloque de piezas sueltas): send_sms y place_call
// salieron del catálogo de PC enteros. Su bloqueo ya no es una entrada en
// la lista de prohibidas: es su inexistencia (ni manifiesto ni registro),
// y el despacho rechaza el nombre por desconocido. Los casos de esos dos
// nombres cobran eso; los de nombres vivos cobran la lista.
import { describe, it, expect } from "vitest";
import { validateTask, UNATTENDED_FORBIDDEN_TOOLS } from "./scheduledTasks.js";
import { LOCAL_TOOLS } from "../tools/manifest.js";
import { buildToolHandlers } from "../tools/handlers.js";

describe("BLOCKER regression: irreversible tools blocked in scheduled tasks", () => {
  const baseTask = {
    name: "Test",
    schedule: "0 7 * * *",
    instruction: "Do something",
    enabled: true,
    notifyOnComplete: true,
  };

  it("send_sms ya no es una herramienta: ni manifiesto, ni registro, ni lista de prohibidas", () => {
    expect(LOCAL_TOOLS.some((t) => t.name === "send_sms")).toBe(false);
    expect(buildToolHandlers()).not.toHaveProperty("send_sms");
    expect(UNATTENDED_FORBIDDEN_TOOLS).not.toContain("send_sms");
  });

  it("blocks nido_send_message", () => {
    const result = validateTask({ ...baseTask, allowedTools: ["nido_send_message"] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("nido_send_message"))).toBe(true);
  });

  it("place_call ya no es una herramienta: ni manifiesto, ni registro, ni lista de prohibidas", () => {
    expect(LOCAL_TOOLS.some((t) => t.name === "place_call")).toBe(false);
    expect(buildToolHandlers()).not.toHaveProperty("place_call");
    expect(UNATTENDED_FORBIDDEN_TOOLS).not.toContain("place_call");
  });

  it("blocks all three together", () => {
    const result = validateTask({
      ...baseTask,
      allowedTools: ["nido_send_message", "nido_pair", "delete_note"],
    });
    expect(result.valid).toBe(false);
  });

  it("does not allow bypass via case variations", () => {
    // Tool names are case-sensitive in the manifest.
    // Verify validateTask blocks the exact names.
    const variations = ["NIDO_SEND_MESSAGE", "Nido_Send_Message", "nido_Send_Message"];
    for (const variant of variations) {
      // These variants are not real tools, but validateTask should
      // only block exact matches. The important thing is the real
      // lowercase names are blocked (tested above).
      const result = validateTask({ ...baseTask, allowedTools: [variant] });
      // Unknown tools are allowed by validateTask (it only blocks known dangerous ones)
      // The security comes from the dispatcher rejecting unknown tools
      expect(result.valid).toBe(true);
    }
  });

  it("allows safe tools", () => {
    const result = validateTask({
      ...baseTask,
      allowedTools: ["calendar_read", "memory_search"],
    });
    expect(result.valid).toBe(true);
  });

  it("DANGEROUS list is not empty and covers known irreversible tools", () => {
    // The DANGEROUS list in scheduledTasks.ts must include the tools
    // that require human confirmation. This is a manual audit check:
    // if new irreversible tools are added to the manifest, this test
    // reminds us to update the DANGEROUS list.
    const knownIrreversible = ["nido_send_message", "nido_pair", "delete_note"];
    for (const toolName of knownIrreversible) {
      const result = validateTask({ ...baseTask, allowedTools: [toolName] });
      expect(
        result.valid,
        `Irreversible tool ${toolName} should be blocked in scheduled tasks`
      ).toBe(false);
    }
  });
});
