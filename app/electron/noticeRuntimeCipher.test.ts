/**
 * noticeRuntimeCipher.test.ts — E8 (paso 9, la cura que cazó
 * T-22): la custodia de la agenda en un Linux sin almacén de
 * secretos (decisión 5, vía A firmada).
 *
 * En esta VM, safeStorage reporta el backend `basic_text`,
 * `isEncryptionAvailable()` es falso y `encryptString` lanza:
 * con la cifra original la agenda nunca se escribía y ningún
 * aviso disparaba a su hora en la sesión, en silencio (la vía
 * B que la decisión descartó). La cura: el nivel básico se
 * aplica y se nombra, no se finge cifrado ni se pierde la
 * función. Aquí el doble de Electron degrada como la VM real
 * y la cifra hace su viaje de ida y vuelta en los dos
 * peldaños; la custodia nombra el backend real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sec = vi.hoisted(() => ({ available: false }));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", on: () => undefined },
  powerMonitor: { on: () => undefined },
  safeStorage: {
    isEncryptionAvailable: () => sec.available,
    getSelectedStorageBackend: () => (sec.available ? "gnome_libsecret" : "basic_text"),
    encryptString: (plain: string) => {
      if (!sec.available) throw new Error("Encryption is not available.");
      return Buffer.from(`sealed:${plain}`, "utf8");
    },
    decryptString: (buf: Buffer) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("sealed:")) throw new Error("cannot decrypt");
      return s.slice("sealed:".length);
    },
  },
}));

import { BASIC_AGENDA_PREFIX, noticeAgendaCustody, safeStorageCipher } from "./noticeRuntime.ts";

describe("la custodia de la agenda (decisión 5, vía A)", () => {
  beforeEach(() => {
    sec.available = false;
  });

  it("sin almacén de secretos, el nivel básico sella y abre, con su marca y sin fingir cifrado", () => {
    const plain = JSON.stringify({ v: 1, entries: [{ id: "n1", kind: "event", nextFireAt: 123 }] });
    const sealed = safeStorageCipher.seal(plain);
    expect(sealed.startsWith(BASIC_AGENDA_PREFIX)).toBe(true);
    expect(safeStorageCipher.unseal(sealed)).toBe(plain);
    expect(noticeAgendaCustody()).toBe("basic_text");
  });

  it("con almacén de secretos, sella el SO y la custodia lo nombra", () => {
    sec.available = true;
    const sealed = safeStorageCipher.seal("la agenda");
    expect(sealed.startsWith(BASIC_AGENDA_PREFIX)).toBe(false);
    expect(safeStorageCipher.unseal(sealed)).toBe("la agenda");
    expect(noticeAgendaCustody()).toBe("gnome_libsecret");
  });

  it("lo que no abre, no abre: unseal devuelve null y la agenda se repone por reconciliación", () => {
    expect(safeStorageCipher.unseal("esto-no-es-una-agenda")).toBeNull();
    expect(safeStorageCipher.unseal(BASIC_AGENDA_PREFIX + "%%%")).toBeNull();
  });
});
