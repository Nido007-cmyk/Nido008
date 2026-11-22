/**
 * ScheduledTasksCard — crear, ver, pausar y borrar tareas
 * programadas. Porte de la tarjeta del móvil (E8, paso 8,
 * forma A del diseño de superficie): una tarjeta propia en
 * Ajustes, en la zona del ejecutor (la pestaña «Avisos»),
 * titulada por `scheduledTasks.title`.
 *
 * Una tarea es una instrucción que el agente ejecuta solo a
 * una hora fija, todos los días o ciertos días de la semana.
 * Corre dentro de NIDO, con las herramientas seguras por
 * defecto y sin poder confirmar nada por la persona; el
 * resultado queda aquí y, si se pide, en un aviso. La gestión
 * viaja por los canales de tareas; el armado del aviso de la
 * próxima ejecución lo hace el principal al guardar.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  buildSchedule,
  describeSchedule,
} from "../../../src/agent/scheduled/scheduledTasks.js";

/** Lunes primero; el valor es el día de la semana de JavaScript (0 = domingo). */
const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const MAX_TASKS = 10;

/** "7:05", "07:05", "7" o "705" → hora y minuto, o null. */
export function parseClock(input: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:[:.h ]?(\d{2}))?\s*$/.exec(input);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

type Strings = Record<string, unknown>;

function lookup(s: Strings, section: string, key: string): string {
  const sec = s[section] as Record<string, unknown> | undefined;
  const v = sec?.[key];
  return typeof v === "string" ? v : key;
}

function fill(tpl: string, vars: Record<string, string | number>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{{${k}}}`, String(v));
  return out;
}

export interface TaskRow {
  id: string;
  name: string;
  schedule: string;
  instruction: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastRun: { success: boolean; completedAt: number; summary: string; error: string | null } | null;
}

interface TasksBridge {
  tasksList(): Promise<{ ok: boolean; tasks?: TaskRow[] }>;
  tasksSave(args: unknown): Promise<{ ok: boolean; reason?: string }>;
  tasksDelete(args: unknown): Promise<{ ok: boolean }>;
}

function bridge(): TasksBridge {
  return (window as unknown as { nido: TasksBridge }).nido;
}

export function ScheduledTasksCard({ strings, lang }: { strings: Strings; lang: string }) {
  const s = strings;
  const T = (key: string) => lookup(s, "scheduledTasks", key);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [clock, setClock] = useState("08:00");
  const [days, setDays] = useState<number[]>([...WEEK]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await bridge().tasksList();
      if (r.ok && r.tasks) {
        setTasks(r.tasks);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Las tareas corren mientras la app está abierta: refrescar el resultado.
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const scheduleLabel = (task: TaskRow): string => {
    const d = describeSchedule(task.schedule);
    if (!d) return task.schedule;
    const time = `${pad(d.hour)}:${pad(d.minute)}`;
    if (d.weekdays.length === 7) return fill(T("everyDayAt"), { time });
    const names = WEEK.filter((w) => d.weekdays.includes(w))
      .map((w) => {
        const sec = s.scheduledTasks as Record<string, unknown>;
        const dayShort = sec?.dayShort as Record<string, string> | undefined;
        return dayShort?.[String(w)] ?? String(w);
      })
      .join(", ");
    return fill(T("daysAt"), { days: names, time });
  };

  const fmtWhen = (ms: number): string =>
    new Date(ms).toLocaleString(lang === "en" ? "en-US" : lang === "pt" ? "pt-PT" : "es-ES");

  const handleCreate = async () => {
    const time = parseClock(clock);
    if (!time) {
      setError(T("badTime"));
      return;
    }
    if (!name.trim() || !instruction.trim()) {
      setError(T("missingFields"));
      return;
    }
    if (days.length === 0) {
      setError(T("noDays"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await bridge().tasksSave({
        name: name.trim().slice(0, 60),
        instruction: instruction.trim().slice(0, 500),
        schedule: buildSchedule(time.hour, time.minute, days),
        enabled: true,
        notifyOnComplete: true,
      });
      if (!r.ok) {
        setError(r.reason === "limit" ? fill(T("limit"), { max: MAX_TASKS }) : T("createFailed"));
        return;
      }
      setCreating(false);
      setName("");
      setInstruction("");
      await reload();
    } catch {
      setError(T("createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (task: TaskRow, enabled: boolean) => {
    // El recálculo de la próxima ejecución lo hace el
    // principal al guardar (la misma función del programador);
    // la fila se relee tras guardar y enseña su hora nueva.
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, enabled } : x)));
    const r = await bridge().tasksSave({
      id: task.id,
      name: task.name,
      schedule: task.schedule,
      instruction: task.instruction,
      enabled,
      notifyOnComplete: true,
    }).catch(() => ({ ok: false }));
    if (!r.ok) await reload();
    else await reload();
  };

  const handleDelete = async (task: TaskRow) => {
    try {
      await bridge().tasksDelete({ id: task.id });
    } finally {
      setConfirmingDelete(null);
      await reload();
    }
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <div className="card">
      <h3>{T("title")}</h3>
      <p style={{ color: "var(--muted)" }}>{T("body")}</p>
      {loadFailed && <p>{T("loadFailed")}</p>}
      {!loadFailed && tasks.length === 0 && !creating && <p style={{ color: "var(--muted)" }}>{T("empty")}</p>}

      {tasks.map((task) => (
        <div key={task.id} className="row-block">
          <div className="row-line">
            <span>
              <strong>{task.name}</strong>
              <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                {scheduleLabel(task)}
              </span>
            </span>
            <input
              type="checkbox"
              checked={task.enabled}
              aria-label={fill(T("toggleLabel"), { name: task.name })}
              onChange={(e) => void handleToggle(task, e.target.checked)}
            />
          </div>
          <p style={{ margin: "4px 0" }}>{task.instruction}</p>
          {task.enabled && task.nextRunAt ? (
            <p style={{ color: "var(--muted)", margin: "4px 0" }}>
              {fill(T("nextRun"), { when: fmtWhen(task.nextRunAt) })}
            </p>
          ) : null}
          {task.lastRun ? (
            <p style={{ margin: "4px 0" }}>
              <strong>{task.lastRun.success ? T("lastOk") : T("lastFailed")}</strong>
              {" · "}
              {fmtWhen(task.lastRun.completedAt)}
              {task.lastRun.success && task.lastRun.summary ? (
                <span style={{ display: "block" }}>{task.lastRun.summary}</span>
              ) : null}
            </p>
          ) : (
            <p style={{ color: "var(--muted)", margin: "4px 0" }}>{T("neverRan")}</p>
          )}
          {confirmingDelete === task.id ? (
            <div className="row-line">
              <span>{fill(T("deleteBody"), { name: task.name })}</span>
              <span>
                <button className="btn danger" onClick={() => void handleDelete(task)}>
                  {lookup(s, "common", "delete")}
                </button>{" "}
                <button className="btn" onClick={() => setConfirmingDelete(null)}>
                  {lookup(s, "common", "cancel")}
                </button>
              </span>
            </div>
          ) : (
            <button
              className="btn danger-ghost"
              aria-label={fill(T("deleteLabel"), { name: task.name })}
              onClick={() => setConfirmingDelete(task.id)}
            >
              {lookup(s, "common", "delete")}
            </button>
          )}
        </div>
      ))}

      {creating ? (
        <div>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={T("namePlaceholder")}
            aria-label={T("namePlaceholder")}
            maxLength={60}
          />
          <textarea
            className="field"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={T("instructionPlaceholder")}
            aria-label={T("instructionPlaceholder")}
            maxLength={500}
            rows={3}
          />
          <p>
            <strong>{T("timeLabel")}</strong>
          </p>
          <input
            className="field"
            value={clock}
            onChange={(e) => setClock(e.target.value)}
            placeholder="08:00"
            aria-label={T("timeLabel")}
            maxLength={5}
          />
          <p>
            <strong>{T("daysLabel")}</strong>
          </p>
          <div className="row-line" style={{ flexWrap: "wrap", gap: 6, justifyContent: "flex-start" }}>
            {WEEK.map((d) => {
              const on = days.includes(d);
              const sec = s.scheduledTasks as Record<string, unknown>;
              const dayShort = sec?.dayShort as Record<string, string> | undefined;
              const dayLong = sec?.dayLong as Record<string, string> | undefined;
              return (
                <button
                  key={d}
                  className={`chip-toggle${on ? " on" : ""}`}
                  aria-pressed={on}
                  aria-label={dayLong?.[String(d)] ?? String(d)}
                  onClick={() => toggleDay(d)}
                >
                  {dayShort?.[String(d)] ?? String(d)}
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert">
              <strong>{T("errorTitle")}</strong> {error}
            </p>
          )}
          <div className="row-line">
            <button className="btn primary" disabled={busy} onClick={() => void handleCreate()}>
              {T("save")}
            </button>
            <button className="btn" onClick={() => setCreating(false)}>
              {lookup(s, "common", "cancel")}
            </button>
          </div>
        </div>
      ) : tasks.length < MAX_TASKS ? (
        <button className="btn" onClick={() => setCreating(true)}>
          {T("add")}
        </button>
      ) : (
        <p style={{ color: "var(--muted)" }}>{fill(T("limit"), { max: MAX_TASKS })}</p>
      )}
      {!creating && error && (
        <p role="alert">
          <strong>{T("errorTitle")}</strong> {error}
        </p>
      )}
    </div>
  );
}
