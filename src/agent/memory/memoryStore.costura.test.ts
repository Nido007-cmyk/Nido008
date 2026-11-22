/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la costura en memoria completada en el cierre R4 (alineación
 * al móvil): saveReminder con la firma y la regla del 0.1.108 (el ritmo
 * solo con fecha, y la deduplicación de pendientes), y la firma de
 * scheduleReminderNotification con su ritmo, que en esta tanda no
 * programa nada.
 */

import { describe, expect, it } from "vitest";
import { listReminders, saveReminder } from "./memoryStore.js";
import { scheduleReminderNotification } from "../../notify/notifications.js";

describe("memoryStore · recordatorios con la firma del 0.1.108", () => {
  it("guarda el ritmo solo si es válido y hay fecha", async () => {
    const a = await saveReminder({ text: "regar", dueAt: "2026-12-01T09:00:00.000Z", repeat: "week" });
    expect(a.repeat).toBe("week");
    const b = await saveReminder({ text: "llamar", dueAt: null, repeat: "day" });
    expect(b.repeat).toBeNull();
    const c = await saveReminder({ text: "pagar", dueAt: "2026-12-02T09:00:00.000Z", repeat: "hourly" as never });
    expect(c.repeat).toBeNull();
  });

  it("no duplica un pendiente con el mismo texto, fecha y ritmo; sí si cambia la fecha", async () => {
    const due = "2026-12-03T10:00:00.000Z";
    const a = await saveReminder({ text: "Pastillas ", dueAt: due, repeat: "day" });
    const b = await saveReminder({ text: "pastillas", dueAt: due, repeat: "day" });
    expect(b.id).toBe(a.id);
    const c = await saveReminder({ text: "pastillas", dueAt: "2026-12-04T10:00:00.000Z", repeat: "day" });
    expect(c.id).not.toBe(a.id);
    expect((await listReminders(50)).filter((r) => r.text.toLowerCase().trim() === "pastillas")).toHaveLength(2);
  });
});

describe("notifications · firma con ritmo", () => {
  it("acepta el ritmo y no finge programar nada", async () => {
    expect(await scheduleReminderNotification("r-1", "x", new Date(Date.now() + 60_000), "week")).toBe(false);
  });
});
