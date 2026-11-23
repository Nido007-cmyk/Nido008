/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * caida.ts — E11 paso 2: la caída de ficheros sobre la
 * conversación. Lo caído entra como materia del turno
 * (R5: materia, nunca órdenes), clasificado por el
 * contrato vivo de adjuntos (`attachmentPolicy`: el tipo
 * lo deciden los bytes, no el nombre), con sus fichas y
 * su descarte. Nada de lo caído se indexa en silencio:
 * unirse a la biblioteca pasa por la confirmación de E6,
 * no por la caída. Con la bóveda bloqueada la ventana no
 * acepta caídas más allá de lo que la primera superficie
 * permite: el resultado lo dice y nada entra.
 */
import {
  attachmentKind,
  type AttachmentKind,
} from "../services/attachmentPolicy.js";

export interface DroppedFile {
  name: string;
  bytes: Uint8Array;
}

export interface AttachmentChip {
  id: string;
  name: string;
  kind: Exclude<AttachmentKind, "unsupported">;
  bytes: Uint8Array;
}

export interface RejectedDrop {
  name: string;
  /** La razón del contrato (su código): la superficie la nombra en su idioma. */
  reason: string;
}

export interface DropOutcome {
  accepted: AttachmentChip[];
  rejected: RejectedDrop[];
  locked: boolean;
}

let seq = 0;
function chipId(): string {
  seq += 1;
  return `adj-${Date.now().toString(36)}-${seq}`;
}

/** Una ficha desde un fichero clasificado, o su rechazo con la razón del contrato. */
export function classifyDrop(f: DroppedFile): AttachmentChip | RejectedDrop {
  const d = attachmentKind(f.name, f.bytes);
  if (d.kind === "unsupported") {
    return { name: f.name, reason: d.reason ?? "unknown" };
  }
  return { id: chipId(), name: f.name, kind: d.kind, bytes: f.bytes };
}

export function acceptDrop(
  files: DroppedFile[],
  opts: { vaultUnlocked: boolean },
): DropOutcome {
  if (!opts.vaultUnlocked) {
    return { accepted: [], rejected: [], locked: true };
  }
  const accepted: AttachmentChip[] = [];
  const rejected: RejectedDrop[] = [];
  for (const f of files) {
    const r = classifyDrop(f);
    if ("id" in r) accepted.push(r);
    else rejected.push(r);
  }
  return { accepted, rejected, locked: false };
}

/** El descarte: una lista nueva sin esa ficha; la original queda entera. */
export function discardAttachment(
  chips: AttachmentChip[],
  id: string,
): AttachmentChip[] {
  return chips.filter((c) => c.id !== id);
}
