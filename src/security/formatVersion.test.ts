/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Primera batería propia de formatVersion.ts. Nace en la tanda 13
// con dos líneas que no se mezclan:
//
// · F-PC65 (15 casos): los parseos laxos de la puerta fail-closed.
//   La rama de cadena pasaba por Number() y colaba las formas no
//   decimales ("0x1", "1e0", "1.0") como el entero 1; y el
//   grandfathering (allowMissingAs) se devolvía sin contrastar con
//   el major soportado. La cura (FPC62-67-CURA-PREP §2.4): la forma
//   canónica /^\d+$/ antes de Number() y el contraste del
//   grandfathering. Controles deliberados de la cura: "01" y " 1 "
//   siguen aceptadas (son el entero decimal que la app escribe) y
//   el número 1.0 sigue aceptado (es el entero 1, no una
//   representación). Rojos de nacimiento: los casos 1, 2, 3 y 14.
//
// · D-4 (2 casos): la mitad de memoria del módulo, en la forma de
//   la fuente: la tabla de errores nombrados con
//   MemoryDbVersionError y su format id nido_memory.db, y
//   MEMORY_DB_SCHEMA_VERSION vale 1. El módulo ya traía la mitad
//   por el cierre R3 de la alineación: estos casos nacen verdes
//   como contrato, no como cura.
import { describe, it, expect } from "vitest";
import {
  checkFormatVersion,
  FormatVersionError,
  KnowledgeDbVersionError,
  MemoryDbVersionError,
  SettingsVersionError,
  InstallJournalVersionError,
  KNOWLEDGE_DB_SCHEMA_VERSION,
  MEMORY_DB_SCHEMA_VERSION,
  SETTINGS_FORMAT_VERSION,
  INSTALL_JOURNAL_VERSION,
} from "./formatVersion.js";

function check(found: unknown, allowMissingAs?: number): number {
  return checkFormatVersion({
    formatId: "nido_knowledge.db",
    found,
    supportedMajor: 1,
    ErrorClass: KnowledgeDbVersionError,
    allowMissingAs,
  });
}

describe("F-PC65 · la forma canónica y el contraste del grandfathering", () => {
  it("1. rechaza \"0x1\" (hexadecimal colado por Number())", () => {
    expect(() => check("0x1")).toThrowError(KnowledgeDbVersionError);
  });
  it("2. rechaza \"1e0\" (exponente colado por Number())", () => {
    expect(() => check("1e0")).toThrowError(KnowledgeDbVersionError);
  });
  it("3. rechaza \"1.0\" en cadena (punto decimal como representación)", () => {
    expect(() => check("1.0")).toThrowError(KnowledgeDbVersionError);
  });
  it("4. acepta \"1\" y devuelve 1", () => {
    expect(check("1")).toBe(1);
  });
  it("5. acepta el número 1", () => {
    expect(check(1)).toBe(1);
  });
  it("6. acepta \" 1 \" (los espacios alrededor son la forma escrita por la app)", () => {
    expect(check(" 1 ")).toBe(1);
  });
  it("7. acepta \"01\" (ceros a la izquierda, entero decimal)", () => {
    expect(check("01")).toBe(1);
  });
  it("8. acepta el número 1.0 (es el entero 1, no una representación)", () => {
    expect(check(1.0)).toBe(1);
  });
  it("9. rechaza \"2\" (major distinto del soportado)", () => {
    expect(() => check("2")).toThrowError(KnowledgeDbVersionError);
  });
  it("10. rechaza \"abc\"", () => {
    expect(() => check("abc")).toThrowError(KnowledgeDbVersionError);
  });
  it("11. rechaza la cadena vacía", () => {
    expect(() => check("")).toThrowError(KnowledgeDbVersionError);
  });
  it("12. rechaza \"1.5\"", () => {
    expect(() => check("1.5")).toThrowError(KnowledgeDbVersionError);
  });
  it("13. ausente con allowMissingAs 1: acepta y devuelve 1", () => {
    expect(check(undefined, 1)).toBe(1);
  });
  it("14. ausente con allowMissingAs 2: rechaza (no coincide con el soportado)", () => {
    expect(() => check(undefined, 2)).toThrowError(KnowledgeDbVersionError);
  });
  it("15. ausente sin allowMissingAs: rechaza", () => {
    expect(() => check(undefined)).toThrowError(KnowledgeDbVersionError);
  });
});

describe("D-4 · la mitad de memoria del módulo", () => {
  it("every named error carries its format id and is greppable", () => {
    const cases = [
      [KnowledgeDbVersionError, "nido_knowledge.db", "KnowledgeDbVersionError"],
      [MemoryDbVersionError, "nido_memory.db", "MemoryDbVersionError"],
      [SettingsVersionError, "settings.json", "SettingsVersionError"],
      [InstallJournalVersionError, "nido-install-state.json", "InstallJournalVersionError"],
    ] as const;
    for (const [Cls, id, name] of cases) {
      const err = new Cls(99, "probe");
      expect(err).toBeInstanceOf(FormatVersionError);
      expect(err.name).toBe(name);
      expect(err.message).toContain(id);
      expect(err.message).toContain("99");
      expect(err.formatId).toBe(id);
      expect(err.found).toBe(99);
    }
  });

  it("all supported majors are 1 in L1", () => {
    expect(KNOWLEDGE_DB_SCHEMA_VERSION).toBe(1);
    expect(MEMORY_DB_SCHEMA_VERSION).toBe(1);
    expect(SETTINGS_FORMAT_VERSION).toBe(1);
    expect(INSTALL_JOURNAL_VERSION).toBe(1);
  });
});
