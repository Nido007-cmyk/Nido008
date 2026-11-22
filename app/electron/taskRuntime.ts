/**
 * taskRuntime.ts — el disparo de las tareas programadas (E8,
 * paso 8): cuándo se revisa si hay tareas vencidas.
 *
 * La revisión corre al desbloquear, cada 60 segundos y cuando
 * la ventana vuelve a primer plano, y obedece las tres guardas
 * del móvil, en su orden: sin turno en vuelo, hay vencidas y
 * modelo cargado. Con la bóveda bloqueada no corre nada, ni
 * parcialmente (T-21): la pasada ni siquiera lee las tareas,
 * porque la base es ilegible; al desbloquear, la revisión de
 * apertura la corre una vez.
 *
 * La comprobación del efecto (la idea con sede en esta
 * etapa): una corrida solo se cuenta cuando su registro se
 * re-lee del historial de la tarea; una corrida que no quedó
 * registrada no se anuncia como hecha.
 */
import { getDueTasks, getTaskRuns } from "../../src/agent/scheduled/taskStore.js";
import {
  runScheduledTasksNow,
  type ScheduledRunContext,
} from "../../src/agent/scheduled/runScheduled.js";
import { productionAgentEngine } from "../../src/inference/agentEngine.js";

export interface TaskRuntimeDeps {
  isVaultOpen(): boolean;
  isTurnInFlight(): boolean;
  isModelReady(): boolean;
  lang(): "es" | "en" | "pt";
  strings(): unknown;
}

/** Los textos de los avisos de tarea desde la sección de locales. */
export function taskRunStringsFromStrings(strings: unknown): ScheduledRunContext["strings"] {
  const s = (strings as { scheduledTasks?: Record<string, string> })?.scheduledTasks ?? {};
  const named = (tpl: string | undefined, fallback: string) => (name: string) =>
    (tpl ?? fallback).replace("{{name}}", name);
  return {
    doneTitle: named(s.notifyDone, "NIDO · {{name}}"),
    failedTitle: named(s.notifyFailed, "NIDO · {{name}}"),
    failedBody: s.notifyFailedBody ?? "La tarea no se pudo completar.",
    dueTitle: named(s.notifyDue, "NIDO · {{name}}"),
    dueBody: s.notifyDueBody ?? "Una tarea programada está lista.",
  };
}

let deps: TaskRuntimeDeps | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let passing = false;

/**
 * Una pasada de revisión. Devuelve cuántas corridas quedaron
 * verificadas en el historial (la comprobación del efecto).
 * Nunca lanza.
 */
export async function runTaskPassOnce(): Promise<number> {
  if (!deps || passing) return 0;
  // T-21: con la bóveda bloqueada la tarea no corre ni
  // parcialmente — la pasada no toca ni la base.
  if (!deps.isVaultOpen()) return 0;
  passing = true;
  try {
    // Las tres guardas, en el orden del móvil.
    if (deps.isTurnInFlight()) return 0;
    const due = await getDueTasks().catch(() => []);
    if (due.length === 0) return 0;
    if (!deps.isModelReady()) return 0;
    const results = await runScheduledTasksNow({
      engine: productionAgentEngine,
      lang: deps.lang(),
      strings: taskRunStringsFromStrings(deps.strings()),
    }).catch(() => []);
    let verified = 0;
    for (const r of results) {
      const runs = await getTaskRuns(r.taskId, 5).catch(() => []);
      if (runs.some((x) => x.startedAt === r.startedAt)) verified++;
    }
    return verified;
  } catch {
    return 0;
  } finally {
    passing = false;
  }
}

/** Arranque con los servicios: la revisión periódica de 60 s. */
export function startTaskRuntime(d: TaskRuntimeDeps): void {
  deps = d;
  if (timer) clearInterval(timer);
  timer = setInterval(() => void runTaskPassOnce(), 60_000);
  timer.unref?.();
}

/** El aviso de «revísalo ahora»: desbloqueo y primer plano. */
export function pokeTaskRuntime(): void {
  void runTaskPassOnce();
}

/** Al bloquear: la revisión periódica sigue, pero la guarda de la bóveda la deja en nada. */
export function stopTaskRuntime(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
