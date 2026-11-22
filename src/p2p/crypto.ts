/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * crypto.ts — SUPERFICIE MÍNIMA (tanda 11, DET-11, adaptación
 * A-P2P-CONFIRM asentada en la apertura).
 *
 * La fuente trae la pila criptográfica P2P entera (cifrado de caja,
 * firmas, ratchet) sobre tweetnacl, que no existe en PC. Esta tanda
 * recrea SOLO lo que su puerta consume, con respaldo `node:crypto` y
 * formatos byte a byte idénticos a la fuente:
 *
 * - `KeyPair`, `toHex` / `fromHex`: las formas de la fuente.
 * - `generateIdentity()`: par X25519 (en la fuente, `nacl.box.keyPair()`).
 * - `generateSigningKeypair()`: par Ed25519 (en la fuente, `nacl.sign.keyPair()`).
 * - `fingerprint(pk, spk)`: SHA-512("nido-fingerprint-v2" ‖ pk ‖ spk),
 *   primeros 16 bytes en hex, 8 grupos de 4; legado v1 sin spk: prefijo
 *   del hex de la clave de identidad, en el mismo formato visual.
 *
 * El resto de la pila (mensajería, handshake, store) NO se recrea en
 * esta tanda: no es su objeto.
 */

import { createHash, generateKeyPairSync } from "node:crypto";

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

const HEX = "0123456789abcdef";

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += HEX[(bytes[i] >> 4) & 0xf] + HEX[bytes[i] & 0xf];
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error("Hex inválido.");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function jwkPair(pair: {
  publicKey: { export(opts: { format: "jwk" }): unknown };
  privateKey: { export(opts: { format: "jwk" }): unknown };
}): KeyPair {
  const pubJwk = pair.publicKey.export({ format: "jwk" }) as { x: string };
  const secJwk = pair.privateKey.export({ format: "jwk" }) as { d: string };
  return {
    publicKey: new Uint8Array(Buffer.from(pubJwk.x, "base64url")),
    secretKey: new Uint8Array(Buffer.from(secJwk.d, "base64url")),
  };
}

function rawKeyPair(kind: "x25519" | "ed25519"): KeyPair {
  return kind === "x25519"
    ? jwkPair(generateKeyPairSync("x25519"))
    : jwkPair(generateKeyPairSync("ed25519"));
}

/** Identidad X25519 del NIDO (clave de caja en la fuente). */
export function generateIdentity(): KeyPair {
  return rawKeyPair("x25519");
}

/** Clave de firma Ed25519 (autentica el handshake en la fuente). */
export function generateSigningKeypair(): KeyPair {
  return rawKeyPair("ed25519");
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function sha512(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha512").update(data).digest());
}

/**
 * Huella para cotejo verbal en persona: 8 grupos de 4 hex.
 * Con clave de firma: SHA-512(dominio ‖ identidad ‖ firma), primeros
 * 16 bytes. Sin ella (legado v1): prefijo de la clave de identidad.
 */
export function fingerprint(publicKey: Uint8Array, signingPublicKey?: Uint8Array | null): string {
  if (publicKey.length !== 32) throw new Error("Clave pública inválida (debe ser 32 bytes).");
  if (!signingPublicKey) {
    // Legado (QR v1, sin clave de firma): prefijo de la clave de identidad.
    const hex = toHex(publicKey);
    const groups: string[] = [];
    for (let i = 0; i < 8; i++) groups.push(hex.slice(i * 4, i * 4 + 4));
    return groups.join(" ");
  }
  if (signingPublicKey.length !== 32) throw new Error("Clave de firma inválida (debe ser 32 bytes).");
  // La huella cubre la clave que autentica el handshake (la de FIRMA):
  // SHA-512(dominio ‖ identidad ‖ firma), primeros 16 bytes (128 bits),
  // en 8 grupos de 4 hex (el formato visual de la fuente).
  const domain = utf8Encode("nido-fingerprint-v2");
  const buf = new Uint8Array(domain.length + 64);
  buf.set(domain, 0);
  buf.set(publicKey, domain.length);
  buf.set(signingPublicKey, domain.length + 32);
  const hex = toHex(sha512(buf).slice(0, 16));
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) groups.push(hex.slice(i * 4, i * 4 + 4));
  return groups.join(" ");
}
