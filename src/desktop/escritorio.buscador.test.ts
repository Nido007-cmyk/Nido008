/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * escritorio.buscador — E11 paso 9: el buscador global de
 * conversaciones (Ctrl+Mayús+F), contra su índice de texto
 * (`src/services/conversationSearch.ts`): la misma forma
 * FTS que la casa usa para los fragmentos de conocimiento,
 * viviendo dentro del almacén cifrado de E2 y mantenido al
 * guardar cada mensaje (una escritura de índice por mensaje
 * guardado). El salto aterriza en el mensaje exacto. Con la
 * bóveda cerrada, ningún fichero fuera de ella contiene el
 * texto buscado ni su índice; con la bóveda bloqueada, la
 * búsqueda no está disponible y se dice.
 *
 * Nacimiento (acto 1 de E11): rojo por ausencia entera.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { openSecureDatabase, type SecureDb } from "../security/secureDatabase.js";

type Buscador = typeof import("../services/conversationSearch.js");
let pieza: Buscador | null = null;
beforeAll(async () => {
  pieza = await import("../services/conversationSearch.js").catch(() => null);
});
function P(): Buscador {
  if (!pieza)
    throw new Error(
      "ausencia entera de la pieza: src/services/conversationSearch.ts (el índice del buscador de E11 paso 9 no está construido)",
    );
  return pieza;
}

const TOKEN_A = "zafirobrillante";
const TOKEN_B = "molinodeviento";
let dir = "";
let db: SecureDb | null = null;

function seededDb(): SecureDb {
  const m = P();
  if (db) return db;
  dir = mkdtempSync(path.join(tmpdir(), "nido-e11-buscador-"));
  db = openSecureDatabase(path.join(dir, "nido_search.db"), randomBytes(32));
  m.ensureConversationSearchSchema(db);
  m.indexConversationMessages(
    db,
    "conv-a",
    [{ text: "hola, ¿qué tal?" }, { text: `el ${TOKEN_A} está en el segundo mensaje` }],
    0,
  );
  m.indexConversationMessages(
    db,
    "conv-b",
    [{ text: `un ${TOKEN_B} en el primer mensaje` }, { text: "nada por aquí" }],
    0,
  );
  return db;
}
afterAll(() => {
  try {
    db?.close();
  } catch {
    /* ya cerrada */
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("escritorio.buscador · el texto sembrado, alcanzado en su conversación y su mensaje", () => {
  it("el texto sembrado de la conversación A se alcanza en A, en su mensaje exacto", () => {
    const m = P();
    const hits = m.searchConversationIndex(seededDb(), TOKEN_A);
    expect(hits).toEqual([{ conversationId: "conv-a", messageIndex: 1 }]);
  });

  it("el texto sembrado de la conversación B se alcanza en B, en su mensaje exacto, sin cruzar con A; y el coste es el declarado: una escritura de índice por mensaje guardado", () => {
    const m = P();
    const d = seededDb();
    const hits = m.searchConversationIndex(d, TOKEN_B);
    expect(hits).toEqual([{ conversationId: "conv-b", messageIndex: 0 }]);
    // conv-a ya tiene 2 mensajes indexados: guardar uno más
    // escribe exactamente 1 fila nueva, ni una más.
    const writes = m.indexConversationMessages(
      d,
      "conv-a",
      [
        { text: "hola, ¿qué tal?" },
        { text: `el ${TOKEN_A} está en el segundo mensaje` },
        { text: "un tercer mensaje nuevo" },
      ],
      2,
    );
    expect(writes).toBe(1);
    expect(m.searchConversationIndex(d, "tercer")).toEqual([
      { conversationId: "conv-a", messageIndex: 2 },
    ]);
  });

  it("sin resultados: la búsqueda devuelve su estado diseñado vacío, ni error ni invención", () => {
    const m = P();
    expect(m.searchConversationIndex(seededDb(), "terminoquenoexiste")).toEqual([]);
  });

  it("censo de claro con la bóveda cerrada: ningún fichero fuera de ella contiene el texto buscado ni su índice", () => {
    const m = P();
    const d = seededDb();
    // Se cierra la base y se barre cada fichero del directorio
    // de la bóveda buscando los dos tokens sembrados.
    d.close();
    db = null;
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const bytes = readFileSync(path.join(dir, f));
      expect(bytes.includes(Buffer.from(TOKEN_A)), f).toBe(false);
      expect(bytes.includes(Buffer.from(TOKEN_B)), f).toBe(false);
    }
  });

  it("con la bóveda bloqueada la búsqueda no está disponible y se dice, con su error nombrado", () => {
    const m = P();
    seededDb();
    expect(() => m.searchConversationIndex(null, TOKEN_A)).toThrowError(
      /bloqueada|locked/i,
    );
  });
});
