/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * platformResidue.test.ts — guarda permanente del residuo de
 * móvil en los textos de PC (censo del residuo, §9; acto 1 del
 * bloque de piezas sueltas, forma A del catálogo).
 *
 * La clase: todo texto visible o alcanzable por la persona en
 * la app de PC que nombra el móvil, la tableta, el teléfono o
 * Android COMO SI la app fuera esa, o que describe conducta de
 * la app móvil en vez de la de PC. En PC, desde la computadora
 * no se llama ni se envía SMS ni hoy ni en ninguna etapa: la
 * app enseña el número guardado para que la persona marque
 * desde su teléfono. Esta batería vigila que esa clase no
 * vuelva, con cuatro cobros:
 *
 * 1. Superficie limpia: cero términos de la clase en las
 *    secciones y claves que el renderizador consume (la lista
 *    del censo §0.2), en los tres idiomas, con las claves
 *    legítimas por diseño exentas por su nombre.
 * 2. Identidad: los tres asientos del clúster B (la línea del
 *    prompt, NIDO_IDENTITY y la respuesta enlatada) dicen
 *    computadora en su frase de identidad, y ningún asiento
 *    en código de src/agent/loop/ ni src/constants/ afirma
 *    que NIDO vive en un teléfono.
 * 3. Listas firmadas: toda clave de locales con un término de
 *    la clase pertenece a la lista dormida (con su etapa) o a
 *    la lista legítima por diseño; una clave nueva con
 *    residuo que no esté en ninguna falla el día que aterriza.
 * 4. Sin marcador en código servido: ninguna tabla de
 *    confirmación ni de resultados contiene «marcador»,
 *    «dialer» ni «discador» como acción de la app. Tras la
 *    forma A su objeto son las tablas que quedan (la de
 *    reserva de handlers.ts y confirmText.ts), como alambre
 *    de disparo: si las palabras vuelven, la batería falla
 *    ese día.
 *
 * El matcher está calibrado contra el censo con sus
 * artefactos nombrados: términos con frontera de palabra
 * (así «microphone» no caza «phone») y las siglas SMS/SIM
 * solo en mayúsculas (así el «Sim» portugués, sí, no caza, y
 * la lista de esquemas «https, tel, sms, mailto», en
 * minúsculas, tampoco; el ejemplo que fijó esta calibración
 * fue agentConfirm.openAppRejected, clave retirada por la
 * cura O-1 al salir open_app del catálogo de PC).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };

const locales = { es, en, pt } as const;
type Lang = keyof typeof locales;

/** Aplana un local a rutas con su valor (los arrays por índice). */
function flat(obj: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (obj !== null && typeof obj === "object") {
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => flat(v, `${path}[${i}]`, out));
    } else {
      for (const [k, v] of Object.entries(obj)) flat(v, path ? `${path}.${k}` : k, out);
    }
  } else if (typeof obj === "string") {
    out.set(path, obj);
  }
  return out;
}

const WORD_TERMS = [
  "mobile", "android", "smartphone", "tablet", "phone",
  "teléfono", "telefónica", "móvil", "celular", "tableta",
  "telefone", "telemóvel", "keystore", "marcador", "discador",
  "dialer", "táctil", "touchscreen",
];
const termCI = new RegExp(`\\b(?:${WORD_TERMS.join("|")})\\b|modo avión`, "i");
const termCS = /\b(?:SMS|SIM)\b/;
const hasTerm = (v: string): boolean => termCI.test(v) || termCS.test(v);

/**
 * La lista dormida firmada: claves con residuo que se quedan
 * porque una etapa nombrada las heredará, y cuya apertura las
 * retira o reescribe (su quite se cobra en el ACTO 0 de cada
 * etapa). Ninguna entrada sin etapa ni pieza.
 */
const DORMANT: Record<string, string> = {
  // E9 (voz): su apertura las retira o reescribe con la forma C de D-1.
  "voiceSettings.engineOnDevice": "E9",
  "voiceSettings.onDeviceOnlyValue": "E9",
  "voiceSettings.onDeviceOnlyLabel": "E9",
  "voiceSettings.onlineOnlyNote": "E9",
  "voiceInputAlert.onlineOnlyMessage": "E9",
  // E11 (respaldo): sus textos nacen con O-1 en esa tanda.
  "backup.restoreConfirm": "E11",
  "backup.restoreConfirmDated": "E11",
  "backup.keyNeedsLockBody": "E11",
  "backup.rotateErrors.noKey": "E11",
  "backup.errors.storage": "E11",
  "backup.errors.noDeviceKey": "E11",
  "backup.restoreWithKeyTitle": "E11",
  "backup.restoreWithKeyBody": "E11",
  // E7/E8 (tareas y avisos): su superficie escribe su letra al construirse.
  "scheduledTasks.body": "E7/E8",
  "exactAlarm.off": "E7/E8",
  "dailySummary.value": "E7/E8",
  "dailySummary.needsPermission": "E7/E8",
  // Etapa de emparejamiento: cobra esta clave y su asiento gemelo en código.
  "agentConfirm.pairInvalidChoice": "emparejamiento",
};

/**
 * La lista legítima por diseño: rutas del clúster D del censo.
 * Traen un término de la clase y se quedan, porque hablan del
 * teléfono como el otro aparato de la persona o como objeto
 * del mundo, no como esta app.
 */
const LEGITIMATE: Record<string, string> = {
  // La tarjeta cruzada del Acerca de: anuncia la app de Android como otro producto.
  "aboutScreen.mobileTitle": "tarjeta cruzada del Acerca de",
  "aboutScreen.mobileBody": "tarjeta cruzada del Acerca de",
  "aboutScreen.mobileOpen": "tarjeta cruzada del Acerca de",
  // La comparación honesta de la propia guía de PC.
  "guide.modules[0].lessons[0].tip": "la guía compara PC con una tableta",
  // La lección de emergencias declara la conducta sellada de PC.
  "guide.modules[2].lessons[0].what": "la lección de emergencias declara la conducta sellada",
  "guide.modules[2].lessons[0].steps[3]": "la lección de emergencias declara la conducta sellada",
  // E7 (paso 6): la lección de la Agenda declara la honestidad
  // de PC (H-1): en este PC no se llama; el teléfono de la
  // persona es el aparato desde el que se marca.
  "guide.modules[1].lessons[2].what": "la lección de la Agenda declara la honestidad de PC (H-1)",
  "guide.modules[1].lessons[2].steps[3]": "la lección de la Agenda declara la honestidad de PC (H-1)",
  // La etiqueta del campo de la ficha: el teléfono de la
  // persona guardado en su ficha, no esta app.
  "agenda.fieldPhone": "la etiqueta del teléfono de la ficha",
};

/** Las claves del Acerca de que el renderizador consume (lista cerrada, App.tsx). */
const ABOUT_CONSUMED = [
  "developmentBaseLabel", "developmentBody", "developmentCopied", "developmentCopy",
  "developmentSolanaLabel", "developmentTitle", "guideLink", "heroSubtitle",
  "licensesBody", "licensesTitle", "mobileBody", "mobileOpen", "mobileTitle",
  "repoBody", "repoTitle", "reportBody", "reportCopied", "reportCopy",
  "reportOpen", "reportTitle", "versionBadge",
];

/** ¿La ruta la consume el renderizador? (censo §0.2, por sección y clave). */
function isConsumed(route: string): boolean {
  if (route.startsWith("pcSurface.")) return true;
  if (["drawer.newChat", "drawer.recentSessions", "drawer.deleteConfirm"].includes(route)) return true;
  if (route === "drawerFooterStats.lastQuery") return true;
  if (route === "chatScreen.inputPlaceholder") return true;
  if (route === "personalitySettings.title") return true;
  if (/^personalities\.[^.]+\.(label|description)$/.test(route)) return true;
  if (route.startsWith("library.")) return true;
  if (route.startsWith("memorySettings.")) return true;
  if (route.startsWith("aboutScreen.") && ABOUT_CONSUMED.includes(route.slice("aboutScreen.".length))) return true;
  if (route.startsWith("guide.")) return true;
  return false;
}

const srcPath = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const readSrc = (rel: string) => readFileSync(srcPath(rel), "utf8");

describe("guarda del residuo de móvil en PC (censo §9)", () => {
  // Cobro 1 · Superficie limpia, una pasada por idioma.
  for (const lang of Object.keys(locales) as Lang[]) {
    it(`cobro 1 · superficie limpia (${lang}): cero términos de la clase en lo que el renderizador consume`, () => {
      const bad: string[] = [];
      for (const [route, value] of flat(locales[lang])) {
        if (route in LEGITIMATE) continue;
        if (isConsumed(route) && hasTerm(value)) bad.push(route);
      }
      expect(bad, `rutas consumidas con residuo en ${lang}`).toEqual([]);
    });
  }

  // Cobro 3 · Listas firmadas, una pasada por idioma.
  for (const lang of Object.keys(locales) as Lang[]) {
    it(`cobro 3 · listas firmadas (${lang}): toda clave con término está en la lista dormida o en la legítima`, () => {
      const bad: string[] = [];
      for (const [route, value] of flat(locales[lang])) {
        if (hasTerm(value) && !(route in DORMANT) && !(route in LEGITIMATE)) bad.push(route);
      }
      expect(bad, `claves con residuo fuera de las listas firmadas en ${lang}`).toEqual([]);
    });
  }

  // Cobro 2 · Identidad, un caso por asiento y el barrido de la afirmación.
  it("cobro 2 · la línea de identidad del prompt dice computadora en los tres idiomas", () => {
    const src = readSrc("agent/loop/agentLoop.ts");
    expect(src).toContain("on the user's computer");
    expect(src).toContain("en la computadora del usuario");
    expect(src).toContain("no computador do usuário");
    expect(src).not.toContain("on the user's phone");
    expect(src).not.toContain("en el teléfono del usuario");
    expect(src).not.toContain("no telefone do usuário");
  });

  it("cobro 2 · NIDO_IDENTITY dice computadora y no teléfono", () => {
    const src = readSrc("constants/personalities.ts");
    expect(src).toContain("on the user's computer");
    expect(src).not.toContain("on the user's phone");
  });

  it("cobro 2 · la respuesta enlatada de identidad dice computadora en los tres idiomas", () => {
    const src = readSrc("agent/loop/cannedResponses.ts");
    expect(src).toContain("Vivo en tu computadora");
    expect(src).toContain("I live on your computer");
    expect(src).toContain("Moro no seu computador");
    expect(src).not.toContain("Vivo en tu teléfono");
    expect(src).not.toContain("I live on your phone");
    expect(src).not.toContain("Moro no seu telefone");
  });

  it("cobro 2 · ningún asiento en código del loop ni de constants afirma que NIDO vive en un teléfono", () => {
    const claim = /en tu teléfono|on your phone|no seu telefone|teléfono del usuario|user's phone|telefone do usuário/i;
    const bad: string[] = [];
    for (const dir of ["agent/loop", "constants"]) {
      for (const name of readdirSync(srcPath(dir))) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const src = readFileSync(srcPath(`${dir}/${name}`), "utf8");
        if (claim.test(src)) bad.push(`${dir}/${name}`);
      }
    }
    expect(bad, "ficheros con la afirmación de identidad en un teléfono").toEqual([]);
  });

  // Cobro 4 · Sin marcador en las tablas servidas que quedan.
  it("cobro 4 · ninguna tabla de confirmación ni de resultados nombra el marcador como acción de la app", () => {
    const bad: string[] = [];
    for (const rel of ["agent/tools/handlers.ts", "agent/policy/confirmText.ts"]) {
      if (/marcador|dialer|discador/i.test(readSrc(rel))) bad.push(rel);
    }
    expect(bad, "ficheros con marcador/dialer/discador en sus tablas").toEqual([]);
  });
});
