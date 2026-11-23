/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * O-1 (cadena de curas) · open_app sale del catálogo de PC, forma A.
 *
 * Como place_call y send_sms en su precedente: la herramienta se
 * retira entera (manifiesto, handler, clasificador, listas de
 * política y las diez hojas de sus textos en los tres locales)
 * porque en PC su único camino de apertura era
 * `await import("react-native")`, que no es dependencia de este
 * paquete ni está empaquetado: el handler vivía de un catch que
 * devolvía su texto de fallo y la ruta prometía abrir lo que esta
 * plataforma no abre.
 *
 * La DETECCIÓN no se retira: «abre <url>» sigue produciendo la
 * acción openLink, y el enrutador la responde honesto con la
 * dirección escrita, sin despachar herramienta alguna. Esta
 * batería fija el retiro entero y esa respuesta.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { LOCAL_TOOLS } from "./manifest.js";
import { buildToolHandlers } from "./handlers.js";
import { SENSITIVE_TOOLS } from "./confirm.js";
import { UNATTENDED_FORBIDDEN_TOOLS } from "../scheduled/scheduledTasks.js";
import { IRREVERSIBLE_TOOLS } from "../policy/irreversibleTools.js";
import {
  runToolAction,
  toolForAction,
  type ToolRouterDeps,
} from "../loop/toolRouter.js";
import es from "../../i18n/locales/es.json" with { type: "json" };
import en from "../../i18n/locales/en.json" with { type: "json" };
import pt from "../../i18n/locales/pt.json" with { type: "json" };

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

const LOCALES = { es, en, pt } as const;
type Lang = keyof typeof LOCALES;

/** La letra sellada de la ruta, por idioma, con la dirección escrita. */
const LINK_UNAVAILABLE: Record<Lang, (url: string) => string> = {
  es: (url) =>
    `Desde la computadora no puedo abrir enlaces. La dirección es ${url}: ábrela en tu navegador.`,
  en: (url) =>
    `I can't open links from this computer. The address is ${url}: open it in your browser.`,
  pt: (url) =>
    `Deste computador não consigo abrir links. O endereço é ${url}: abra no seu navegador.`,
};

function harness() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: ToolRouterDeps = {
    dispatch: async (name, args) => {
      calls.push({ name, args });
      return { status: "executed", text: "ok" };
    },
    isDisabled: () => false,
    listNotes: async () => [],
    now: () => new Date("2026-10-11T10:30:00"),
  };
  return { deps, calls };
}

describe("O-1 · open_app retirada del catálogo de PC (forma A)", () => {
  it("el manifiesto no contiene open_app y el catálogo queda en 25", () => {
    expect(LOCAL_TOOLS.map((t) => t.name)).not.toContain("open_app");
    expect(LOCAL_TOOLS).toHaveLength(25);
  });

  it("ningún handler construido responde a open_app", () => {
    expect(Object.keys(buildToolHandlers())).not.toContain("open_app");
  });

  it("ninguna lista de política nombra open_app", () => {
    expect(SENSITIVE_TOOLS.has("open_app")).toBe(false);
    expect(UNATTENDED_FORBIDDEN_TOOLS).not.toContain("open_app");
    expect(IRREVERSIBLE_TOOLS.has("open_app")).toBe(false);
  });

  it.each(["es", "en", "pt"] as const)(
    "la ruta openLink responde honesto y no despacha · %s",
    async (lang) => {
      const { deps, calls } = harness();
      const url = "https://example.com/pagina";
      const out = await runToolAction({ kind: "openLink", url, lang }, deps);
      expect(out.response).toBe(LINK_UNAVAILABLE[lang](url));
      expect(calls).toEqual([]);
      expect(out.toolUses).toEqual([]);
    },
  );

  it.each(["es", "en", "pt"] as const)(
    "el local no guarda ninguna clave de open_app · %s",
    (lang) => {
      const paths: string[] = [];
      const walk = (o: unknown, prefix: string) => {
        if (o && typeof o === "object") {
          for (const [k, v] of Object.entries(o)) {
            const p = prefix ? `${prefix}.${k}` : k;
            paths.push(p);
            walk(v, p);
          }
        }
      };
      walk(LOCALES[lang], "");
      expect(paths.filter((p) => p.includes("openApp"))).toEqual([]);
    },
  );

  it("externalLink.ts ya no existe", () => {
    expect(existsSync(new URL("./externalLink.ts", import.meta.url))).toBe(false);
  });

  it("toolForAction(openLink) es null: la acción la responde el enrutador", () => {
    expect(
      toolForAction({ kind: "openLink", url: "https://a.b", lang: "es" }),
    ).toBeNull();
  });
});
