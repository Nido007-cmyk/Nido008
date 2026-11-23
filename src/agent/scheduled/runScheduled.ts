/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * runScheduled.ts — conecta el motor de tareas (runner.ts) con la app real:
 * la base cifrada, el bucle del agente, el modelo cargado y los avisos.
 *
 * Lo llama el chat cuando el modelo está listo y no hay una respuesta en
 * curso. Todo es local.
 *
 * Porte de PC (E8, paso 8): la línea adaptada era la memoria —
 * la costura en memoria no tenía `snapshot` y `loadMemory` componía
 * a mano. Con la cura H-01 el almacén es el persistente del móvil
 * y el `loadMemory` es su `snapshot`, como en la fuente. El aviso
 * de fin de tarea viaja por el `notifyNow` de la costura de PC,
 * que toma la carga entera.
 */

import i18n from "../../i18n/index.js";
import { runDueTasks, type TaskToolHandler } from "./runner.js";
import type { ScheduledTask, TaskRunResult } from "./scheduledTasks.js";
import { getDueTasks, recordTaskRun, updateTaskAfterRun } from "./taskStore.js";
import type { AgentEngine } from "../loop/agentLoop.js";

export interface ScheduledRunContext {
  engine: AgentEngine;
  nCtx?: number;
  // 0.1.24 (auditoría de alcanzabilidad, H-9): «pt» admitido — el
  // llamador colapsaba pt→es y las tareas de un usuario en portugués
  // respondían en español, a diferencia de la ruta del chat.
  lang: "es" | "en" | "pt";
  /** Textos ya traducidos para los avisos. */
  strings: {
    doneTitle(name: string): string;
    failedTitle(name: string): string;
    failedBody: string;
    dueTitle(name: string): string;
    dueBody: string;
  };
}

/** (Re)programa el aviso de la próxima ejecución de una tarea. */
export async function scheduleTaskReminder(
  task: Pick<ScheduledTask, "id" | "name" | "enabled">,
  nextRunAt: number | null,
  strings: Pick<ScheduledRunContext["strings"], "dueTitle" | "dueBody">,
): Promise<void> {
  const { scheduleTaskNotification } = await import("../../notify/notifications.js");
  await scheduleTaskNotification(
    task.id,
    strings.dueTitle(task.name),
    strings.dueBody,
    task.enabled && nextRunAt ? new Date(nextRunAt) : null,
  );
}

export async function runScheduledTasksNow(ctx: ScheduledRunContext): Promise<TaskRunResult[]> {
  // I18N-2: la vía programada fija el módulo i18n del núcleo con
  // el idioma del contexto (el prefs.lang de la carcasa), igual
  // que runTurn lo fija en la vía del chat: los textos del bucle
  // y de los handlers de la tarea se sirven en ese idioma.
  i18n.changeLanguage(ctx.lang);
  const [{ runAgentLoop }, { buildToolHandlers }, { snapshot, listNotes, listReminders }, { notifyNow }] = await Promise.all([
    import("../loop/agentLoop.js"),
    import("../tools/handlers.js"),
    import("../memory/memoryStore.js"),
    import("../../notify/notifications.js"),
  ]);
  // Sin canal de confirmación: cualquier acción que la pida se cancela.
  const allHandlers = buildToolHandlers({
    requestConfirm: async () => false,
  }) as Record<string, TaskToolHandler>;

  return runDueTasks({
    getDueTasks,
    recordTaskRun,
    updateTaskAfterRun,
    allHandlers,
    runInstruction: async (instruction, handlers) => {
      const out = await runAgentLoop(instruction, {
        engine: ctx.engine,
        handlers,
        restrictFastPathsToHandlers: true,
        // La memoria del turno programado es el snapshot entero
        // del almacén, como en el móvil (la composición a mano
        // con preferencias y diario vacíos era de la costura en
        // memoria; la cura H-01 la retira).
        loadMemory: () => snapshot().catch(() => null),
        // 0.1.24 (H-9): proveedores de SOLO LECTURA de notas y
        // recordatorios, los mismos que construye ChatScreen para el
        // chat. Sin ellos, una instrucción «busca en mis notas» caía
        // a la degradación de toolRouter y respondía «no hay notas»
        // HABIÉNDOLAS (negativo falso en segundo plano). El borrado
        // sigue siendo imposible en tareas: delete_note y
        // delete_reminder están en UNATTENDED_FORBIDDEN_TOOLS y el
        // router de recordatorios mapea a create_reminder, que no
        // está en DEFAULT_TASK_TOOLS — ninguno alcanza los handlers.
        listNoteTitles: async () => (await listNotes(50)).map((n) => ({ id: n.id, title: n.title })),
        listNotesFull: async () => (await listNotes(50)).map((n) => ({ id: n.id, title: n.title, body: n.body })),
        listReminders: async () => (await listReminders(50)).map((r) => ({ id: r.id, text: r.text, dueAt: r.due_at, repeat: r.repeat ?? null })),
        maxSteps: 3,
        nPredict: 384,
        lang: ctx.lang,
        nCtx: ctx.nCtx,
      });
      return { response: out.response, toolsUsed: out.toolUses.map((u) => u.name) };
    },
    notify: async (task, result) => {
      await notifyNow({
        title: result.success ? ctx.strings.doneTitle(task.name) : ctx.strings.failedTitle(task.name),
        body: result.success ? result.summary : ctx.strings.failedBody,
        kind: "task",
      });
    },
    scheduleNext: (task, nextRunAt) => scheduleTaskReminder(task, nextRunAt, ctx.strings),
  });
}
