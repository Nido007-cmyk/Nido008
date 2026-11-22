/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * nidoMessenger.ts — MENSAJERO EN MEMORIA (tanda 11, DET-11: la
 * mensajería NIDO con la honestidad de PC de la firma: la gramática y
 * la ceremonia corren enteras y la ejecución responde la verdad de
 * esta plataforma, jamás un éxito fingido).
 *
 * En la fuente, este módulo comparte el messenger P2P real (cifrado de
 * extremo a extremo, transporte Bluetooth, almacén persistente). En PC
 * no hay transporte en esta tanda: la identidad se genera de verdad
 * (p2p/crypto, formatos de la fuente), los contactos emparejados y la
 * cola de salida viven en memoria, y `sendChat` devuelve siempre
 * `queued: true` — el mensaje queda guardado en la cola de salida en
 * claro, en la memoria del proceso, y muere con él; eso es exactamente
 * lo que el handler declara al usuario. Nada se finge entregado ni
 * cifrado. La etapa P2P sustituye esta costura por el transporte
 * real sin cambiar la superficie que los handlers consumen.
 */

import {
  fingerprint,
  fromHex,
  generateIdentity,
  generateSigningKeypair,
  toHex,
  type KeyPair,
} from "../p2p/crypto.js";
import { decodePairingPayload, encodePairingPayload, isSafeContactName } from "../p2p/pairing.js";
import { normalizeContactName } from "../p2p/contactName.js";
import type { PairDisambiguation } from "../p2p/pairingCeremony.js";

/** La elección de desambiguación no se resolvió: hay colisión de nombre. */
export class PairingDisambiguationRequiredError extends Error {
  readonly candidates: Array<{ pkHex: string; name: string }>;
  constructor(candidates: Array<{ pkHex: string; name: string }>) {
    super("pairing disambiguation required");
    this.name = "PairingDisambiguationRequiredError";
    this.candidates = candidates;
  }
}

/** El reemplazo confirmado ya no corresponde al estado vivo. */
export class StaleReplaceConflictError extends Error {
  constructor() {
    super("stale replace conflict");
    this.name = "StaleReplaceConflictError";
  }
}

/** El código presentado es el del propio dispositivo (F-PC69). */
export class SelfPairingError extends Error {
  constructor() {
    super("Ese es tu propio QR.");
    this.name = "SelfPairingError";
  }
}

/** La elección de desambiguación no es ninguna de las tres válidas (F-PC70). */
export class InvalidPairingChoiceError extends Error {
  constructor() {
    super("invalid pairing choice");
    this.name = "InvalidPairingChoiceError";
  }
}

/** El nombre nuevo de different_person no pasa la validación (F-PC70); la causa va en el mensaje. */
export class PairingNameError extends Error {
  constructor(cause: string) {
    super(cause);
    this.name = "PairingNameError";
  }
}

/** La clave de firma presentada no es la guardada para esa pk (F-PC73): no se escribió nada. */
export class PairingKeyChangedError extends Error {
  readonly contactName: string;
  constructor(contactName: string) {
    super("pairing signing key changed");
    this.name = "PairingKeyChangedError";
    this.contactName = contactName;
  }
}

export interface NidoContactLike {
  pkHex: string;
  name: string;
  sigPkHex?: string | null;
}

interface InboxMessage {
  id: string;
  peerPk: string;
  text: string;
  ts: number;
  type: string;
  status: string;
}

export interface NidoMessenger {
  ensureIdentity(): Promise<{ fingerprint: string }>;
  sendChat(to: string, text: string): Promise<{ id: string; queued: boolean }>;
  contacts(): Promise<NidoContactLike[]>;
  readInboxWithHidden(): Promise<{ messages: InboxMessage[]; hiddenTemporal: number }>;
  myPairingCode(): Promise<string>;
  pairWith(
    code: string,
    opts?: { disambiguation?: PairDisambiguation; newName?: string; replaceTargets?: string[] },
  ): Promise<{ name: string } | null>;
}

class InMemoryNidoMessenger implements NidoMessenger {
  private identity: KeyPair | null = null;
  private signing: KeyPair | null = null;
  private displayName = "NIDO";
  private readonly contactList: NidoContactLike[] = [];
  private readonly outbox: Array<{ to: string; text: string }> = [];
  private seq = 0;

  async ensureIdentity(): Promise<{ fingerprint: string }> {
    if (!this.identity || !this.signing) {
      this.identity = generateIdentity();
      this.signing = generateSigningKeypair();
    }
    return { fingerprint: fingerprint(this.identity.publicKey, this.signing.publicKey) };
  }

  async sendChat(to: string, text: string): Promise<{ id: string; queued: boolean }> {
    this.seq += 1;
    this.outbox.push({ to, text });
    // Sin transporte en esta tanda: el mensaje queda en la cola de
    // salida (queued), que es lo que el handler declara. Nunca se
    // afirma una entrega que no ocurrió.
    return { id: `m${this.seq}`, queued: true };
  }

  async contacts(): Promise<NidoContactLike[]> {
    return [...this.contactList];
  }

  async readInboxWithHidden(): Promise<{ messages: InboxMessage[]; hiddenTemporal: number }> {
    return { messages: [], hiddenTemporal: 0 };
  }

  async myPairingCode(): Promise<string> {
    await this.ensureIdentity();
    return encodePairingPayload(this.displayName, this.identity!.publicKey, this.signing!.publicKey);
  }

  async pairWith(
    code: string,
    opts?: { disambiguation?: PairDisambiguation; newName?: string; replaceTargets?: string[] },
  ): Promise<{ name: string } | null> {
    const payload = decodePairingPayload(code);
    const pkHex = payload.pk.toLowerCase();
    // F-PC69: el propio QR se rechaza por pk, antes de cualquier
    // cálculo de colisión, como la documentación de la ceremonia
    // promete de esta vía («rechazo de self-QR como defensa en
    // profundidad»). El nombre presentado no entra en la comparación.
    await this.ensureIdentity();
    const selfPkHex = toHex(this.identity!.publicKey).toLowerCase();
    if (pkHex === selfPkHex) {
      throw new SelfPairingError();
    }
    const needle = normalizeContactName(payload.name);
    const collision = this.contactList.filter(
      (c) => normalizeContactName(c.name) === needle && c.pkHex.toLowerCase() !== pkHex,
    );
    const choice = opts?.disambiguation;
    if (collision.length > 0 && !choice) {
      throw new PairingDisambiguationRequiredError(
        collision.map((c) => ({ pkHex: c.pkHex, name: c.name })),
      );
    }
    if (choice === "cancel") return null;
    // F-PC70(a): una elección definida que no es ninguna de las tres
    // falla cerrado, sin tocar la lista.
    if (choice !== undefined && choice !== "replace" && choice !== "different_person") {
      throw new InvalidPairingChoiceError();
    }
    if (choice === "replace") {
      // F-PC71: el conjunto confirmado es la única vía. La igualdad
      // de conjuntos cobra las dos direcciones: si entró una
      // identidad nunca mostrada, el conjunto vigente es mayor; si
      // la confirmada cambió de nombre y salió de la colisión, es
      // menor; y un objetivo ya no vivo tampoco está en la colisión.
      const targets = opts?.replaceTargets;
      if (!targets || targets.length === 0) throw new StaleReplaceConflictError();
      const targetSet = new Set(targets.map((pk) => pk.toLowerCase()));
      const collisionSet = new Set(collision.map((c) => c.pkHex.toLowerCase()));
      if (
        targetSet.size !== collisionSet.size ||
        [...targetSet].some((pk) => !collisionSet.has(pk))
      ) {
        throw new StaleReplaceConflictError();
      }
      for (const c of collision) {
        const i = this.contactList.indexOf(c);
        if (i >= 0) this.contactList.splice(i, 1);
      }
    }
    // F-PC70(b): con different_person, el nombre nuevo se exige
    // entero antes de asignarlo a ninguna rama (creación o
    // renombrado): presente, con el tope de 40 del payload, seguro
    // según la guarda P5 del propio subsistema, no vacío tras
    // normalizar y único contra la lista entera salvo la propia pk.
    let name = payload.name;
    if (choice === "different_person") {
      const candidate = (opts?.newName ?? "").trim();
      if (!candidate) throw new PairingNameError("sin nombre nuevo");
      if (candidate.length > 40) throw new PairingNameError("nombre demasiado largo");
      if (!isSafeContactName(candidate)) throw new PairingNameError("nombre con caracteres no permitidos");
      const needleNew = normalizeContactName(candidate);
      if (!needleNew) throw new PairingNameError("nombre vacío tras normalizar");
      const taken = this.contactList.some(
        (c) => c.pkHex.toLowerCase() !== pkHex && normalizeContactName(c.name) === needleNew,
      );
      if (taken) throw new PairingNameError("nombre ya en uso");
      name = candidate;
    }
    const existing = this.contactList.find((c) => c.pkHex.toLowerCase() === pkHex);
    if (existing) {
      // F-PC73: para una pk conocida, cualquier diferencia entre la
      // clave de firma guardada y la presentada (distinta, aparecida
      // o desaparecida) es un cambio de la identidad que autentica:
      // falla cerrado y no se escribe nada.
      const storedSpk = existing.sigPkHex?.toLowerCase() ?? null;
      const presentedSpk = payload.spk?.toLowerCase() ?? null;
      if (storedSpk !== presentedSpk) throw new PairingKeyChangedError(payload.name);
      existing.name = name;
      return { name };
    }
    const contact: NidoContactLike = {
      pkHex: toHex(fromHex(payload.pk)),
      name,
      sigPkHex: payload.spk ?? null,
    };
    this.contactList.push(contact);
    return { name };
  }
}

let shared: InMemoryNidoMessenger | null = null;

/** Singleton compartido con la UI (misma razón que en la fuente). */
export function getSharedNidoMessenger(): NidoMessenger {
  if (!shared) shared = new InMemoryNidoMessenger();
  return shared;
}

/**
 * Fila de contacto sin filtro de ciclo de vida (la usa el diálogo de
 * emparejamiento para la nota de «la identidad volvió»). En la fuente
 * lee el almacén P2P; en PC no hay almacén P2P en esta tanda, así que
 * la respuesta verdadera es que no hay fila: la nota nunca se finge.
 */
export async function findContactRowAny(
  _pkHex: string,
): Promise<{ name: string; supersededBy: string | null } | null> {
  return null;
}
