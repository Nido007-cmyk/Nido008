/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * exportacion.ts — E11 paso 4: exportar la conversación.
 * Pieza nacida en PC, sin contrato heredado: la
 * conversación entera, en su orden, sin nada ajeno (ni
 * metadatos de la bóveda, ni datos del sistema, ni otras
 * conversaciones), en Markdown o en texto llano, por
 * acción expresa de la persona (R6): guardar con su
 * diálogo o arrastrar fuera. Nada se exporta solo, ni
 * por temporizador ni como efecto de otra acción.
 */

export interface ExportMessage {
  role: string;
  text: string;
}

export interface ExportConversation {
  title: string;
  messages: ExportMessage[];
}

export interface ExportLabels {
  user: string;
  assistant: string;
}

const DEFAULT_LABELS: ExportLabels = { user: "Tú", assistant: "NIDO" };

function labelFor(role: string, labels: ExportLabels): string {
  return role === "user" ? labels.user : labels.assistant;
}

export function conversationToMarkdown(
  conv: ExportConversation,
  labels: ExportLabels = DEFAULT_LABELS,
): string {
  const parts: string[] = [`# ${conv.title}`, ""];
  for (const m of conv.messages) {
    parts.push(`**${labelFor(m.role, labels)}**`, "", m.text, "");
  }
  return parts.join("\n");
}

export function conversationToPlainText(
  conv: ExportConversation,
  labels: ExportLabels = DEFAULT_LABELS,
): string {
  const parts: string[] = [conv.title, ""];
  for (const m of conv.messages) {
    parts.push(`${labelFor(m.role, labels)}: ${m.text}`, "");
  }
  return parts.join("\n");
}

/** El nombre de fichero desde el título: minúsculas, sin diacríticos, con guiones. */
export function exportFileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "conversacion";
}

export function dragOutPayload(
  conv: ExportConversation,
  labels: ExportLabels = DEFAULT_LABELS,
): { fileName: string; content: string } {
  return {
    fileName: `${exportFileSlug(conv.title)}.md`,
    content: conversationToMarkdown(conv, labels),
  };
}

export interface SaveExportDeps {
  showSaveDialog: (defaultName: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
}

/**
 * Guardar con su diálogo: si la persona cancela, no se
 * escribe nada (ningún fichero parcial); con destino
 * elegido, se escribe exactamente una vez.
 */
export async function saveExport(
  deps: SaveExportDeps,
  defaultName: string,
  content: string,
): Promise<{ saved: boolean; path?: string }> {
  const path = await deps.showSaveDialog(defaultName);
  if (!path) return { saved: false };
  await deps.writeFile(path, content);
  return { saved: true, path };
}
