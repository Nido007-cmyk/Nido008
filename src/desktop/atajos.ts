/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * atajos.ts — E11 paso 1: el mapa de atajos de la ventana,
 * como dato y como resolvedor puro. El mapa es el firmado
 * en la apertura (§4.2): once entradas de ventana, el envío
 * como ajuste propio y el envío de emergencia del crédito
 * de la tanda 14. Ningún atajo es global (DISENO-PC §9.4):
 * este módulo solo decide sobre eventos que la ventana ya
 * recibió con el foco dentro.
 *
 * El mismo dato alimenta tres superficies: el resolvedor
 * que la superficie aplica a cada tecla, la hoja de atajos
 * (Ctrl+/) que lo enseña en la posición vigente del ajuste
 * de envío, y las pistas de la paleta y de los menús (M-6).
 * Una sola lista: ninguna superficie mantiene la suya.
 */

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ShortcutContext {
  /** Hay una generación en curso. */
  generating: boolean;
  /** La pastilla de emergencia está presente (generación en curso con texto de emergencia detectado). */
  emergencyPill: boolean;
  /** Hay una hoja o panel abierto que Esc cierra. */
  sheetOpen: boolean;
  /** El foco está en el composer. */
  inComposer: boolean;
  /** Posición vigente del ajuste de envío: true = Intro envía. */
  sendOnEnter: boolean;
}

export type ShortcutAction =
  | { kind: "new-chat" }
  | { kind: "global-search" }
  | { kind: "search-in-chat" }
  | { kind: "go-end" }
  | { kind: "stop" }
  | { kind: "close-sheet" }
  | { kind: "section"; index: number }
  | { kind: "model-manager" }
  | { kind: "emergency-send" }
  | { kind: "shortcut-sheet" }
  | { kind: "zoom-in" }
  | { kind: "zoom-out" }
  | { kind: "zoom-reset" }
  | { kind: "send" }
  | { kind: "newline" };

const ev = (
  key: string,
  mods: Partial<{ ctrl: boolean; shift: boolean }> = {},
): ShortcutEvent => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: false,
  metaKey: false,
});

/**
 * La decisión del mapa para un evento en un contexto. null
 * cuando la tecla no es del mapa (o es del texto: Fin dentro
 * del composer sigue moviendo el cursor, y ninguna tecla
 * con Alt o Meta es de la casa). La precedencia de Esc va
 * escrita aquí y la hoja la enseña: con generación detiene;
 * sin generación cierra la hoja o el panel abierto; Esc no
 * deniega confirmaciones (eso vive en la tarjeta misma) ni
 * detiene nada fuera de la app.
 */
export function resolveShortcut(
  e: ShortcutEvent,
  ctx: ShortcutContext,
): ShortcutAction | null {
  if (e.metaKey || e.altKey) return null;
  const key = e.key;

  // El envío de emergencia manda sobre la posición del
  // ajuste: con la pastilla presente, la tecla que NO es la
  // de enviar es la de la emergencia.
  if (ctx.inComposer && ctx.emergencyPill && key === "Enter" && e.ctrlKey) {
    if (ctx.sendOnEnter && !e.shiftKey) return { kind: "emergency-send" };
    if (!ctx.sendOnEnter && e.shiftKey) return { kind: "emergency-send" };
  }

  if (e.ctrlKey) {
    const k = key.toLowerCase();
    if (k === "n") return { kind: "new-chat" };
    if (k === "f" && e.shiftKey) return { kind: "global-search" };
    if (k === "f") return { kind: "search-in-chat" };
    if (k === "m") return { kind: "model-manager" };
    if (key === "/") return { kind: "shortcut-sheet" };
    if (key === "+" || key === "=") return { kind: "zoom-in" };
    if (key === "-") return { kind: "zoom-out" };
    if (key === "0") return { kind: "zoom-reset" };
    if (/^[1-8]$/.test(key)) return { kind: "section", index: Number(key) - 1 };
    if (key === "Enter" && ctx.inComposer) {
      // Sin pastilla: Ctrl+Intro obedece la posición del ajuste.
      return ctx.sendOnEnter ? { kind: "newline" } : { kind: "send" };
    }
    return null;
  }

  if (key === "Escape") {
    if (ctx.generating) return { kind: "stop" };
    if (ctx.sheetOpen) return { kind: "close-sheet" };
    return null;
  }
  if (key === "End" && !ctx.inComposer) return { kind: "go-end" };
  if (key === "Enter" && ctx.inComposer) {
    if (e.shiftKey) return { kind: "newline" };
    return ctx.sendOnEnter ? { kind: "send" } : { kind: "newline" };
  }
  return null;
}

export interface ShortcutSheetRow {
  id: string;
  /** Ruta de la etiqueta en los locales (grupo pcSurface). */
  labelKey: string;
  /** La combinación tal como la hoja la enseña, en la posición vigente. */
  keys: string;
  /** El evento representativo de la línea: debe resolver a `action`. */
  event: ShortcutEvent;
  /** El contexto representativo de la línea. */
  context: Partial<ShortcutContext>;
  action: ShortcutAction;
  /** Si la acción es invocable desde la paleta de comandos. */
  inPalette: boolean;
}

/**
 * Las líneas de la hoja de atajos, en su orden de enseñanza,
 * compuestas desde el mismo mapa que el resolvedor aplica.
 * Trece líneas: las once entradas, el envío y la emergencia,
 * las dos últimas en la posición vigente del ajuste. Ni
 * Ctrl+W ni ninguna tecla de cierre de ventana entra: son
 * del sistema y de la carcasa, y el mapa no las reasigna.
 */
export function shortcutSheetRows(sendOnEnter: boolean): ShortcutSheetRow[] {
  return [
    {
      id: "new-chat",
      labelKey: "shortcutNewChat",
      keys: "Ctrl+N",
      event: ev("n", { ctrl: true }),
      context: {},
      action: { kind: "new-chat" },
      inPalette: true,
    },
    {
      id: "global-search",
      labelKey: "shortcutGlobalSearch",
      keys: "Ctrl+Mayús+F",
      event: ev("F", { ctrl: true, shift: true }),
      context: {},
      action: { kind: "global-search" },
      inPalette: true,
    },
    {
      id: "search-in-chat",
      labelKey: "shortcutSearchInChat",
      keys: "Ctrl+F",
      event: ev("f", { ctrl: true }),
      context: {},
      action: { kind: "search-in-chat" },
      inPalette: true,
    },
    {
      id: "go-end",
      labelKey: "shortcutGoEnd",
      keys: "Fin",
      event: ev("End"),
      context: {},
      action: { kind: "go-end" },
      inPalette: true,
    },
    {
      id: "stop-or-close",
      labelKey: "shortcutStopOrClose",
      keys: "Esc",
      event: ev("Escape"),
      context: { generating: true },
      action: { kind: "stop" },
      inPalette: true,
    },
    {
      id: "shortcutSection",
      labelKey: "shortcutSection",
      keys: "Ctrl+1…Ctrl+8",
      event: ev("1", { ctrl: true }),
      context: {},
      action: { kind: "section", index: 0 },
      inPalette: false,
    },
    {
      id: "model-manager",
      labelKey: "shortcutModelManager",
      keys: "Ctrl+M",
      event: ev("m", { ctrl: true }),
      context: {},
      action: { kind: "model-manager" },
      inPalette: true,
    },
    {
      id: "shortcutSend",
      labelKey: "shortcutSend",
      keys: sendOnEnter ? "Intro" : "Ctrl+Intro",
      event: sendOnEnter ? ev("Enter") : ev("Enter", { ctrl: true }),
      context: { inComposer: true },
      action: { kind: "send" },
      inPalette: false,
    },
    {
      id: "emergency-send",
      labelKey: "shortcutEmergencySend",
      keys: sendOnEnter ? "Ctrl+Intro" : "Ctrl+Mayús+Intro",
      event: sendOnEnter
        ? ev("Enter", { ctrl: true })
        : ev("Enter", { ctrl: true, shift: true }),
      context: { inComposer: true, generating: true, emergencyPill: true },
      action: { kind: "emergency-send" },
      inPalette: false,
    },
    {
      id: "shortcut-sheet",
      labelKey: "shortcutOpenSheet",
      keys: "Ctrl+/",
      event: ev("/", { ctrl: true }),
      context: {},
      action: { kind: "shortcut-sheet" },
      inPalette: true,
    },
    {
      id: "zoom-in",
      labelKey: "shortcutZoomIn",
      keys: "Ctrl++",
      event: ev("+", { ctrl: true }),
      context: {},
      action: { kind: "zoom-in" },
      inPalette: true,
    },
    {
      id: "zoom-out",
      labelKey: "shortcutZoomOut",
      keys: "Ctrl+−",
      event: ev("-", { ctrl: true }),
      context: {},
      action: { kind: "zoom-out" },
      inPalette: true,
    },
    {
      id: "zoom-reset",
      labelKey: "shortcutZoomReset",
      keys: "Ctrl+0",
      event: ev("0", { ctrl: true }),
      context: {},
      action: { kind: "zoom-reset" },
      inPalette: true,
    },
  ];
}
