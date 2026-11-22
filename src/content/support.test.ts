/**
 * support.test.ts · Guarda de la fuente única de apoyo (tanda 14).
 *
 * Las direcciones y la nota se transcriben aquí por segunda vez, de
 * forma independiente (la segunda transcripción que la hoja de S-9
 * exige dentro de la batería), y el censo cobra que cada dirección
 * aparezca una sola vez en el código fuera de las baterías.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_ADDRESS,
  SALVORA_NOTE,
  SOLANA_ADDRESS,
} from "./support.js";

// Segunda transcripción independiente (del Acerca de del móvil,
// verificada en la apertura de la tanda contra sus dos baterías).
const SOLANA_TRANSCRITA = "G74aAtEB41eFAcXtRbBVcRVpZDgELBCoFeUo9AyTnjRK";
const BASE_TRANSCRITA = "0x5c030688FAcF0c74a5fF5eB00686A0021d95c1fC";

const NOTA_TRANSCRITA = {
  es: "NIDO es gratuito, sin cuentas y sin funciones de pago. Quien quiera apoyar su desarrollo puede comprar paquetes de guías de SALVORA en salvorapacks.com: cada compra ayuda a seguir desarrollando NIDO. Comprar no desbloquea nada, porque en NIDO no hay contenido bloqueado. Los paquetes son conocimiento que entra en tu biblioteca por la puerta firmada de siempre, igual que los demás paquetes de esta lista.",
  en: "NIDO is free, with no accounts and no paid features. If you would like to support its development, you can buy SALVORA guide packs at salvorapacks.com: every purchase helps NIDO keep growing. Buying unlocks nothing, because NIDO has no locked content. The packs are knowledge that joins your library through the same signed door as always, just like the other packs on this list.",
  pt: "O NIDO é gratuito, sem contas e sem recursos pagos. Quem quiser apoiar o seu desenvolvimento pode comprar pacotes de guias da SALVORA em salvorapacks.com: cada compra ajuda o NIDO a continuar crescendo. Comprar não desbloqueia nada, porque no NIDO não há conteúdo bloqueado. Os pacotes são conhecimento que entra na sua biblioteca pela porta assinada de sempre, igual aos outros pacotes desta lista.",
} as const;

describe("fuente única de apoyo", () => {
  it("las direcciones casan con la transcripción independiente", () => {
    expect(SOLANA_ADDRESS).toBe(SOLANA_TRANSCRITA);
    expect(BASE_ADDRESS).toBe(BASE_TRANSCRITA);
    expect(SOLANA_ADDRESS).toHaveLength(44);
    expect(BASE_ADDRESS).toHaveLength(42);
    expect(BASE_ADDRESS.startsWith("0x")).toBe(true);
  });

  it("la nota casa carácter a carácter en los tres idiomas", () => {
    expect(SALVORA_NOTE.es).toBe(NOTA_TRANSCRITA.es);
    expect(SALVORA_NOTE.en).toBe(NOTA_TRANSCRITA.en);
    expect(SALVORA_NOTE.pt).toBe(NOTA_TRANSCRITA.pt);
  });

  it("la nota no trae direcciones ni promesas de desbloqueo", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      expect(SALVORA_NOTE[lang]).not.toContain(SOLANA_ADDRESS);
      expect(SALVORA_NOTE[lang]).not.toContain(BASE_ADDRESS);
      expect(SALVORA_NOTE[lang]).toContain("salvorapacks.com");
    }
  });

  it("censo: cada dirección aparece una sola vez fuera de baterías", () => {
    const root = join(__dirname, "..");
    const hits: Record<string, string[]> = {
      [SOLANA_ADDRESS]: [],
      [BASE_ADDRESS]: [],
    };
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules") continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (/\.test\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(p, "utf8");
        for (const addr of Object.keys(hits)) {
          if (text.includes(addr)) hits[addr].push(p);
        }
      }
    };
    walk(root);
    for (const addr of Object.keys(hits)) {
      expect(hits[addr]).toHaveLength(1);
      expect(hits[addr][0].endsWith("content/support.ts")).toBe(true);
    }
  });
});
