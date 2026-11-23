/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Batería de la cura O-12 (cadena de curas, acto 6): el historial
 * de acciones persiste en la base cifrada y lo creado se puede
 * deshacer. Las ocho primeras son las del móvil, tal cual: el
 * porte es fiel y su batería también. La novena cobra el
 * desenlace «denied» de PC (la política del turno, tanda 13):
 * nunca lleva referencia de deshacer. La décima cobra el
 * arranque: startActionLogPersistence conecta el registro con
 * la base y lo registrado queda guardado (sobre una base
 * fingida que ejecuta el SQL del almacén; la persistencia tras
 * reinicio de verdad la cobra la batería de canales).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../security/databaseManager.js", () => {
  const rows: Record<string, unknown>[] = [];
  let seq = 0;
  const db = {
    runAsync: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO agent_action_log")) {
        rows.push({
          id: ++seq,
          ts: params[0],
          tool: params[1],
          outcome: params[2],
          confirmed: params[3],
          undo_kind: params[4],
          undo_id: params[5],
          undone: 0,
        });
      } else if (sql.startsWith("DELETE FROM agent_action_log WHERE id NOT IN")) {
        const limit = params[0] as number;
        rows.splice(0, Math.max(0, rows.length - limit));
      } else if (sql.startsWith("DELETE FROM agent_action_log")) {
        rows.length = 0;
      } else if (sql.startsWith("UPDATE agent_action_log SET undone")) {
        const r = rows.find((x) => x.id === params[0]);
        if (r) r.undone = 1;
      }
      return { lastInsertRowId: seq, changes: 1 };
    },
    getAllAsync: async (_sql: string, params: unknown[] = []) => {
      const limit = (params[0] as number) ?? 50;
      return [...rows].sort((a, b) => (b.id as number) - (a.id as number)).slice(0, limit);
    },
  };
  return {
    getDatabase: async () => db,
    writeTransaction: async (work: (h: typeof db) => Promise<unknown>) => work(db),
  };
});

import { actionLog, setActionLogSink, type ActionLogEntry } from "./actionLog.js";
import {
  canUndo,
  listActions,
  startActionLogPersistence,
  undoActionWith,
  type StoredAction,
  type UndoDeps,
} from "./actionLogStore.js";

afterEach(() => {
  setActionLogSink(null);
  actionLog.clear();
});

function stored(over: Partial<StoredAction> = {}): StoredAction {
  return {
    id: 7,
    ts: "2026-10-10T00:00:00.000Z",
    tool: "save_note",
    outcome: "executed",
    confirmed: false,
    undone: false,
    undo: { kind: "note", id: "n1" },
    ...over,
  };
}

function deps(): UndoDeps {
  return {
    deleteNote: vi.fn(async () => {}),
    deleteReminder: vi.fn(async () => {}),
    cancelReminderNotification: vi.fn(async () => {}),
    markUndone: vi.fn(async () => {}),
  };
}

describe("action log undo", () => {
  it("a handler's created id is attached to the next executed entry of that tool only", () => {
    actionLog.noteUndo("save_note", { kind: "note", id: "n1" });
    actionLog.record("device_time", "executed");
    actionLog.record("save_note", "executed");
    actionLog.record("save_note", "executed");
    const [third, second, first] = actionLog.list();
    expect(first.undo).toBeUndefined();
    expect(second.undo).toEqual({ kind: "note", id: "n1" });
    expect(third.undo).toBeUndefined();
  });

  it("a failed or cancelled action never carries an undo reference", () => {
    actionLog.noteUndo("save_note", { kind: "note", id: "n1" });
    actionLog.record("save_note", "failed");
    actionLog.record("save_note", "executed");
    expect(actionLog.list().every((e) => e.undo === undefined)).toBe(true);
  });

  it("the sink receives each entry and a throwing sink does not break recording", () => {
    const seen: ActionLogEntry[] = [];
    setActionLogSink((e) => {
      seen.push(e);
      throw new Error("db down");
    });
    actionLog.record("device_time", "executed");
    expect(seen).toHaveLength(1);
    expect(actionLog.list()).toHaveLength(1);
  });

  it("only executed, not-yet-undone entries with a reference can be undone", () => {
    expect(canUndo(stored())).toBe(true);
    expect(canUndo(stored({ undone: true }))).toBe(false);
    expect(canUndo(stored({ outcome: "cancelled" }))).toBe(false);
    expect(canUndo(stored({ undo: undefined }))).toBe(false);
  });

  it("undoing a note deletes that note and marks the entry", async () => {
    const d = deps();
    expect(await undoActionWith(stored(), d)).toBe(true);
    expect(d.deleteNote).toHaveBeenCalledWith("n1");
    expect(d.deleteReminder).not.toHaveBeenCalled();
    expect(d.markUndone).toHaveBeenCalledWith(7);
  });

  it("undoing a reminder cancels its notification before deleting it", async () => {
    const d = deps();
    const order: string[] = [];
    (d.cancelReminderNotification as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push("cancel"));
    (d.deleteReminder as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push("delete"));
    await undoActionWith(stored({ tool: "create_reminder", undo: { kind: "reminder", id: "r1" } }), d);
    expect(order).toEqual(["cancel", "delete"]);
    expect(d.deleteNote).not.toHaveBeenCalled();
  });

  it("an entry that cannot be undone touches nothing", async () => {
    const d = deps();
    expect(await undoActionWith(stored({ undone: true }), d)).toBe(false);
    expect(d.deleteNote).not.toHaveBeenCalled();
    expect(d.markUndone).not.toHaveBeenCalled();
  });

  it("if deleting fails the entry is not marked as undone", async () => {
    const d = deps();
    (d.deleteNote as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db"));
    await expect(undoActionWith(stored(), d)).rejects.toThrow("db");
    expect(d.markUndone).not.toHaveBeenCalled();
  });

  it("a denied action never carries an undo reference and cannot be undone", () => {
    actionLog.noteUndo("save_note", { kind: "note", id: "n1" });
    actionLog.record("save_note", "denied");
    expect(actionLog.list()[0].undo).toBeUndefined();
    expect(canUndo(stored({ outcome: "denied" }))).toBe(false);
  });

  it("startActionLogPersistence: lo registrado queda guardado en la base", async () => {
    startActionLogPersistence();
    actionLog.noteUndo("save_note", { kind: "note", id: "n9" });
    actionLog.record("save_note", "executed", true);
    await vi.waitFor(async () => {
      expect(await listActions()).toHaveLength(1);
    });
    const [a] = await listActions();
    expect(a.tool).toBe("save_note");
    expect(a.outcome).toBe("executed");
    expect(a.confirmed).toBe(true);
    expect(a.undo).toEqual({ kind: "note", id: "n9" });
    expect(a.undone).toBe(false);
  });
});
