/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * packImport.ts — el núcleo puro de confianza de la puerta
 * firmada de paquetes, recreado para PC en el paso 2 del
 * bloque puerta de E5. El adelanto de J-3 trajo solo las
 * constantes y el tipo de origen; este paso completa el
 * núcleo de juicio con el mismo orden y los mismos valores
 * de la fuente 0.1.108, sin copiar su código.
 *
 * La decisión que este módulo prueba, antes de que un solo
 * byte se copie a la carpeta de paquetes: el fichero es
 * nuestro y está intacto. Dos pruebas de origen, una por
 * clave que la app lleva:
 *
 * - SALVORA PACKS: el manifiesto compañero
 *   (`<pack>.sqlite.json`) declara la SHA-256 del fichero
 *   y trae una firma Ed25519 sobre la forma canónica del
 *   manifiesto (el JSON sin los campos de firma, claves
 *   ordenadas). La firma debe verificar contra la clave
 *   pública de SALVORA incrustada aquí, y la clave que el
 *   manifiesto declara para sí debe ser esa misma: un
 *   manifiesto nunca elige su propia ancla de confianza.
 *
 * - NIDO: los paquetes de NIDO no traen firma por fichero;
 *   los atestigua el pin de su SHA-256 dentro del catálogo
 *   de paquetes de PC (packCatalog.ts), que es parte del
 *   binario. Un fichero cuya huella es exactamente un pin
 *   del catálogo es, byte a byte, un paquete de NIDO.
 *   Cualquier otro manifiesto sin firma no prueba nada.
 *
 * Lo que una firma NO hace, dicho llanamente: prueba
 * origen e integridad, nunca calidad. La casa firma solo
 * lo que ya verificó línea a línea; ninguna clave de
 * terceros está en la lista, nunca, y no hay vía de
 * confianza por primer uso: un paquete firmado por otro
 * se rechaza, no se pregunta.
 *
 * Adaptaciones de PC asentadas en la apertura de la etapa:
 * la firma se verifica con el `crypto` de Node (Ed25519),
 * sin dependencia nueva (la fuente usa tweetnacl; aquí no
 * entra), y el pin de catálogo se lee de CORPUS_CATALOG
 * de packCatalog.ts, la verdad de paquetes de PC. La
 * forma canónica del manifiesto es contrato con el
 * firmante de la tienda: no se toca, y la batería de
 * bytes reales la fija contra el manifiesto real.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { CORPUS_CATALOG } from "./packCatalog.js";

/** Ed25519 public key of SALVORA PACKS (32 bytes, base64). PUBLIC — safe to embed. */
export const SALVORA_PACKS_PUBLIC_KEY_BASE64 =
  "HfH4rO39agZVzybigFmWW1PPjqwb9bAFZBHkMqz/sHQ=";

/** Quién publica un paquete que la puerta firmada acepta (M-35). */
export type PackOrigin = "nido" | "salvora";

/** Display name of each origin, exactly as the interface names it. */
export const PACK_ORIGIN_LABEL: Record<PackOrigin, string> = {
  nido: "NIDO",
  salvora: "SALVORA PACKS",
};

/** Tope de bytes de un paquete importable por la puerta (512 MiB). */
export const PACK_IMPORT_MAX_BYTES = 512 * 1024 * 1024;

/** The subset of a pack manifest the door reads. Extra fields are allowed
 *  (they are covered by the signature's canonical form) but never trusted
 *  beyond what verifyPackOrigin checks. */
export interface PackManifest {
  id?: unknown;
  file?: unknown;
  sizeBytes?: unknown;
  sha256?: unknown;
  signedBy?: unknown;
  signingPublicKey?: unknown;
  signature?: unknown;
  signedAt?: unknown;
  [key: string]: unknown;
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Parses a companion manifest. Returns null when the text is not a JSON
 * object with a well-formed sha256 — for the door, an unreadable manifest
 * is the same as a missing one (without a legible manifest the app cannot
 * check any signature).
 */
export function parsePackManifest(text: string): PackManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const m = parsed as PackManifest;
  if (typeof m.sha256 !== "string" || !SHA256_HEX.test(m.sha256)) return null;
  return m;
}

/** Fields the store's signer adds; excluded from its canonical form. */
const SIGN_FIELDS = ["signedBy", "signingPublicKey", "signature", "signedAt"];

/**
 * Canonical form of a SALVORA PACKS manifest, byte-identical to the
 * store's signer: the manifest without the signing fields, top-level
 * keys sorted, JSON.stringify with no whitespace. If this ever drifts
 * from the signer, every real store pack stops verifying — the
 * real-bytes tests pin it.
 */
export function canonicalPackManifestJSON(manifest: PackManifest): string {
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(manifest).filter((k) => !SIGN_FIELDS.includes(k)).sort()) {
    clean[k] = manifest[k];
  }
  return JSON.stringify(clean);
}

const ED25519_SIGNATURE_BYTES = 64;
const ED25519_PUBLIC_KEY_BYTES = 32;
/** DER prefix of an Ed25519 SubjectPublicKeyInfo around the raw 32-byte key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function b64ToBytes(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

/** Ed25519 verification with Node's crypto: the PC form of the check. */
function ed25519Verify(message: Uint8Array, signature: Uint8Array, publicKeyRaw: Uint8Array): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyRaw)]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * True when the manifest carries a SALVORA PACKS signature that verifies
 * against the trusted key. The trusted key is ALWAYS the one embedded in
 * the app; the manifest's declared `signingPublicKey` must equal it too
 * (a manifest naming some other key as its signer is not ours, however it
 * is signed). The second parameter exists only as a test seam: unit tests
 * inject a fixture key generated in memory so signature acceptance is
 * covered everywhere, without the store's real zips. Production callers
 * never pass it — the default is the embedded key and the behavior is
 * identical.
 */
export function verifySalvoraManifestSignature(
  manifest: PackManifest,
  trustedPublicKeyBase64: string = SALVORA_PACKS_PUBLIC_KEY_BASE64
): boolean {
  if (typeof manifest.signature !== "string" || typeof manifest.signingPublicKey !== "string") {
    return false;
  }
  if (manifest.signingPublicKey !== trustedPublicKeyBase64) return false;
  let sig: Buffer;
  let pub: Buffer;
  try {
    sig = b64ToBytes(manifest.signature);
    pub = b64ToBytes(trustedPublicKeyBase64);
  } catch {
    return false;
  }
  if (sig.length !== ED25519_SIGNATURE_BYTES || pub.length !== ED25519_PUBLIC_KEY_BYTES) {
    return false;
  }
  const msg = new TextEncoder().encode(canonicalPackManifestJSON(manifest));
  return ed25519Verify(msg, sig, pub);
}

/** True when `sha256` is the pin of a corpus pack in the PC pack catalog. */
export function isCatalogCorpusPin(sha256: string): boolean {
  return CORPUS_CATALOG.some(
    (m) => m.format === "sqlite-pack" && m.sha256.toLowerCase() === sha256.toLowerCase()
  );
}

export type PackOriginRejection = "hash-mismatch" | "not-signed-by-us";
export type PackOriginResult =
  | { ok: true; origin: PackOrigin }
  | { ok: false; reason: PackOriginRejection };

/**
 * The door's judgment, in its sealed order: first the file's hash must
 * be exactly the one the manifest declares (a single changed byte fails
 * here), then the manifest must prove one of our two origins. A manifest
 * that carries signing fields is judged by the signature alone — NIDO's
 * real manifests carry none, so the catalog pin is their only path, and
 * a third party cannot borrow it by stapling a catalog hash onto a
 * manifest for different bytes (the hash step already bound the hash to
 * THIS file).
 *
 * The optional third parameter is the same test seam as in
 * verifySalvoraManifestSignature (an injected fixture key for unit
 * tests); production callers never pass it.
 */
export function verifyPackOrigin(
  manifest: PackManifest,
  fileSha256: string,
  trustedPublicKeyBase64: string = SALVORA_PACKS_PUBLIC_KEY_BASE64
): PackOriginResult {
  const declared = typeof manifest.sha256 === "string" ? manifest.sha256 : "";
  if (!SHA256_HEX.test(declared) || declared.toLowerCase() !== fileSha256.toLowerCase()) {
    return { ok: false, reason: "hash-mismatch" };
  }
  if (typeof manifest.signature === "string" || typeof manifest.signingPublicKey === "string") {
    return verifySalvoraManifestSignature(manifest, trustedPublicKeyBase64)
      ? { ok: true, origin: "salvora" }
      : { ok: false, reason: "not-signed-by-us" };
  }
  return isCatalogCorpusPin(declared)
    ? { ok: true, origin: "nido" }
    : { ok: false, reason: "not-signed-by-us" };
}

export interface PackMetaSummary {
  format: string;
  formatVersion: number;
  /** meta.embeddingModelSha256; "" when the pack declares none. */
  embeddingModelSha256: string;
  /** meta.name: the pack's own display name, when it declares one. */
  name: string | null;
}

/**
 * The same format acceptance openPack applies when it opens a pack
 * (src/rag/packs.ts) — meta table present, format "nido-knowledge-pack",
 * and the declared embedding model read for the caller. Anything else
 * is not a knowledge pack, whatever its signature says.
 */
export function summarizePackMeta(meta: Record<string, string>): PackMetaSummary | null {
  const format = meta.format;
  if (format !== "nido-knowledge-pack") return null;
  const name = typeof meta.name === "string" && meta.name.trim().length > 0 ? meta.name : null;
  return {
    format,
    formatVersion: Number(meta.formatVersion) > 0 ? Number(meta.formatVersion) : 1,
    embeddingModelSha256: String(meta.embeddingModelSha256 ?? ""),
    name,
  };
}

// ---------------------------------------------------------------------------
// Row caps and the internal-schema check (M-35: m-91 y P-39/B7)
// ---------------------------------------------------------------------------

/**
 * Row caps for a pack's content tables, enforced in two places with the
 * same numbers: the signed door rejects a pack above them (m-91) and
 * openPack refuses to open one above them however it arrived (P-39) —
 * the import byte cap (512 MB) alone bounds bytes, not the indexing
 * work a pathological row count can demand at open time.
 *
 * Grounding: the largest pack this house ships, the Wikipedia Vital
 * pack, is ~156 MB and carries on the order of 10^5 chunks; the real
 * guide packs carry 174 guides (Esencial), 69 regions and 155 facts
 * (NIDO Local). Every cap sits far above those numbers — they exist to
 * stop a signed-but-absurd file, never to squeeze a real pack.
 */
export const PACK_MAX_CHUNKS = 1_000_000;
export const PACK_MAX_GUIDES = 100_000;
export const PACK_MAX_REGIONS = 10_000;
export const PACK_MAX_FACTS = 100_000;

/** A pack's internal schema as the door and the open path read it. */
export interface PackSchemaDescriptor {
  /** Column names per table; a table absent from the map does not exist. */
  tables: Record<string, string[]>;
  /** Row counts per content table (0 when the table does not exist). */
  counts: { chunks: number; guides: number; regions: number; facts: number };
}

/**
 * The tables and columns the readers actually select (rag/packs.ts):
 * meta and chunks at every format version; chunks' guide/keys link and
 * the guides/regions/facts tables from format v2 on. A pack whose
 * signed bytes declare a fine meta but lack what the readers query is
 * not a knowledge pack (m-91: the door used to validate the meta only).
 */
const PACK_SCHEMA_REQUIRED: Record<number, Record<string, string[]>> = {
  1: {
    meta: ["key", "value"],
    chunks: ["id", "title", "body", "source", "vec"],
  },
  2: {
    meta: ["key", "value"],
    chunks: ["id", "title", "body", "source", "vec", "guide", "keys"],
    guides: ["id", "key", "lang", "title", "category", "region", "sources", "verified"],
    regions: ["code", "names", "aliases", "phrases"],
    facts: ["region", "key", "value", "label", "note", "source_title", "source_url", "quote", "checked"],
  },
};

/**
 * True when the pack's internal schema is one the readers can use:
 * every required table and column present, at least one chunk of
 * content, and no row count above the caps. Format versions above 2
 * are judged by the v2 shape until a newer one is defined.
 */
export function validatePackSchema(formatVersion: number, schema: PackSchemaDescriptor): boolean {
  const required = PACK_SCHEMA_REQUIRED[formatVersion >= 2 ? 2 : 1];
  for (const [table, columns] of Object.entries(required)) {
    const present = schema.tables[table];
    if (!present) return false;
    for (const column of columns) {
      if (!present.includes(column)) return false;
    }
  }
  const { chunks, guides, regions, facts } = schema.counts;
  if (!Number.isFinite(chunks) || chunks < 1 || chunks > PACK_MAX_CHUNKS) return false;
  if (!Number.isFinite(guides) || guides < 0 || guides > PACK_MAX_GUIDES) return false;
  if (!Number.isFinite(regions) || regions < 0 || regions > PACK_MAX_REGIONS) return false;
  if (!Number.isFinite(facts) || facts < 0 || facts > PACK_MAX_FACTS) return false;
  return true;
}
