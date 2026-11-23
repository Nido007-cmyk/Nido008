/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * pegado.ts — E11 paso 3: el pegado en el composer. El
 * portapapeles se lee solo desde el gesto de pegar de la
 * persona (el evento onPaste del composer): la carcasa no
 * expone lectura alguna del portapapeles por el puente y
 * la lista de permisos sigue vacía por diseño. Lo pegado
 * entra por la misma clasificación que la caída: el texto
 * como texto, entero y sin tocar; la imagen y los ficheros
 * como adjuntos de su clase, decidida por sus bytes.
 */
import { acceptDrop, type AttachmentChip, type DroppedFile } from "./caida.js";

export interface PasteInput {
  text?: string;
  image?: Uint8Array;
  files?: DroppedFile[];
}

export type PasteOutcome =
  | { kind: "text"; text: string }
  | { kind: "attachments"; chips: AttachmentChip[] }
  | { kind: "none" };

/** El nombre de una imagen pegada, por su magia: la imagen no trae nombre. */
function pastedImageName(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "imagen-pegada.jpg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
  ) {
    return "imagen-pegada.gif";
  }
  return "imagen-pegada.png";
}

export function acceptPaste(input: PasteInput): PasteOutcome {
  const chips: AttachmentChip[] = [];
  if (input.image && input.image.length > 0) {
    const r = acceptDrop(
      [{ name: pastedImageName(input.image), bytes: input.image }],
      { vaultUnlocked: true },
    );
    chips.push(...r.accepted);
  }
  if (input.files && input.files.length > 0) {
    const r = acceptDrop(input.files, { vaultUnlocked: true });
    chips.push(...r.accepted);
  }
  if (chips.length > 0) return { kind: "attachments", chips };
  if (input.text) return { kind: "text", text: input.text };
  return { kind: "none" };
}
