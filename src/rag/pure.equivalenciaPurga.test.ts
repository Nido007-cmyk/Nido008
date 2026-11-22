/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Batería de equivalencia de la purga (su preparación, §3.1) para la
 * pareja serializeEmbedding/deserializeEmbedding de pure.ts, escrita
 * contra el FORMATO y no contra ninguna implementación: los bytes
 * esperados son literales hex derivados de la definición del formato
 * (float32 IEEE-754, little-endian, 4 bytes por componente), de modo
 * que la batería seguiría en pie aunque la pieza se reescribiera otra
 * vez. El formato en disco por la vía real de la base lo gobierna
 * db.vectorFormat.test.ts; esta batería añade el cruce de la pieza
 * con un BLOB leído de una base SQLite del formato vigente.
 */
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { serializeEmbedding, deserializeEmbedding } from "./pure.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Vectores dorados: valor -> bytes float32 LE según la definición del
// formato. El menor normal es 2^-126 (patrón 0x00800000) y el NaN
// lleva su patrón de bits declarado (0x7FC00000, NaN silencioso
// canónico).
const GOLDEN: Array<[number, string]> = [
  [0, "00000000"],
  [1, "0000803f"],
  [-1, "000080bf"],
  [0.5, "0000003f"],
  [2 ** -126, "00008000"],
];

describe("vectores dorados de la pareja ser/de (formato float32 LE)", () => {
  it("serialize produce los bytes del formato, valor a valor", () => {
    for (const [value, expected] of GOLDEN) {
      expect(hex(serializeEmbedding(new Float32Array([value])))).toBe(expected);
    }
  });

  it("deserialize lee los bytes del formato, valor a valor", () => {
    for (const [value, bytes] of GOLDEN) {
      const restored = deserializeEmbedding(fromHex(bytes), 1);
      expect(restored).toHaveLength(1);
      expect(restored[0]).toBe(value);
    }
  });

  it("un vector compuesto va y vuelve byte a byte en los dos sentidos", () => {
    const values = GOLDEN.map(([v]) => v);
    const bytes = GOLDEN.map(([, b]) => b).join("");
    expect(hex(serializeEmbedding(new Float32Array(values)))).toBe(bytes);
    const restored = deserializeEmbedding(fromHex(bytes), values.length);
    expect(Array.from(restored)).toEqual(values);
    expect(hex(serializeEmbedding(restored))).toBe(bytes);
  });

  it("el NaN conserva su patrón de bits declarado en la ida y la vuelta", () => {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, 0x7fc00000, true);
    const nanVector = new Float32Array(buffer);
    expect(Number.isNaN(nanVector[0])).toBe(true);
    expect(hex(serializeEmbedding(nanVector))).toBe("0000c07f");
    const restored = deserializeEmbedding(fromHex("0000c07f"), 1);
    expect(Number.isNaN(restored[0])).toBe(true);
    expect(hex(serializeEmbedding(restored))).toBe("0000c07f");
  });

  it("serialize respeta el tramo de una vista sobre un búfer mayor", () => {
    const backing = new Float32Array([9, 9, 1, 0.5, 9]);
    const view = backing.subarray(2, 4);
    expect(hex(serializeEmbedding(view))).toBe("0000803f" + "0000003f");
  });

  it("deserialize devuelve una vista sobre el búfer de entrada", () => {
    const backing = new Uint8Array(4 + 8);
    backing.set(fromHex("0000803f" + "0000003f"), 4);
    const restored = deserializeEmbedding(backing.subarray(4), 2);
    expect(restored.byteOffset).toBe(4);
    expect(Array.from(restored)).toEqual([1, 0.5]);
  });

  it("lee un BLOB real de una base SQLite del formato vigente", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE chunks (vec BLOB)");
      const golden = GOLDEN.map(([, b]) => b).join("");
      const insert = db.prepare("INSERT INTO chunks (vec) VALUES (?)");
      insert.run(Buffer.from(fromHex(golden)));
      const row = db
        .prepare("SELECT vec FROM chunks")
        .get() as { vec: Uint8Array };
      const restored = deserializeEmbedding(row.vec, GOLDEN.length);
      expect(Array.from(restored)).toEqual(GOLDEN.map(([v]) => v));
      // Y lo que la pieza serializa es lo que la base guarda, byte a byte.
      expect(hex(serializeEmbedding(restored))).toBe(golden);
    } finally {
      db.close();
    }
  });
});
