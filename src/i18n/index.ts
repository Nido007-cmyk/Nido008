/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };
import { deviceDefaultLanguage, type LanguageId } from "../models/settings.js";

/**
 * index.ts — el módulo i18n del núcleo (tanda breve I18N-2).
 *
 * El contrato es el del móvil (`src/i18n/index.ts` de su árbol):
 * un objeto por defecto con `t(key, opts)`, `language`,
 * `resolvedLanguage` y `changeLanguage`, sobre los tres JSON de
 * `locales/`, con el idioma inicial de `deviceDefaultLanguage()`
 * y la reserva en inglés para cualquier clave ausente. El móvil
 * lo sirve con i18next; PC no tiene esa dependencia en ninguno
 * de sus dos package.json y el contrato consumido no la
 * necesita, así que aquí el objeto se implementa directamente
 * sobre los JSON: búsqueda por ruta con puntos, interpolación
 * `{{var}}` (solo se sustituyen las variables presentes, como
 * hacen las tablas de reserva de los consumidores) y, si la
 * clave falta en los tres locales, la propia clave — nunca una
 * cadena vacía ni un undefined en pantalla.
 *
 * Por qué el import estático es seguro aquí (la medida de
 * I18N-1): este módulo solo importa los JSON y
 * `deviceDefaultLanguage`, cuyo grafo (settings → fileSystem)
 * es Node puro, sin módulos nativos. La pereza del móvil
 * protegía contra la cadena nativa de su settings; esa cadena
 * no existe en este módulo. Los cinco consumidores heredados
 * lo pedían con `require` perezoso, que en PC no resuelve ni
 * en el banco ni en el paquete (Metro sí lo resuelve al
 * empaquetar; vite/Rollup no): I18N-2 los pasa a import
 * estático, que es la vía que resuelve relativos en los dos
 * entornos.
 *
 * La alimentación: el idioma de la persona vive en
 * `prefs.lang` en la carcasa y entra al núcleo por turno; las
 * dos sedes de fijación llaman `changeLanguage` con ese
 * idioma — la entrada de `runTurn` (la vía del chat) y la de
 * `runScheduledTasksNow` (la vía programada) —, como la
 * carcasa del móvil lo llama desde su LanguageContext.
 * `changeLanguage` solo acepta es/en/pt (tras normalizar la
 * etiqueta, «es-ES» → «es»): otra etiqueta no mueve el idioma,
 * para que el módulo nunca declare un idioma cuyos textos
 * serviría enteros por la reserva.
 */

type ResourceDict = Record<string, unknown>;

const RESOURCES: Record<LanguageId, ResourceDict> = {
  en: en as ResourceDict,
  es: es as ResourceDict,
  pt: pt as ResourceDict,
};

let currentLanguage: LanguageId = deviceDefaultLanguage();

function lookup(dict: ResourceDict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(text: string, opts?: Record<string, unknown>): string {
  let out = text;
  for (const [name, value] of Object.entries(opts ?? {})) {
    out = out.split(`{{${name}}}`).join(String(value));
  }
  return out;
}

export interface NidoI18n {
  /** El idioma vigente del núcleo. */
  readonly language: LanguageId;
  /** El idioma resuelto: el mismo vigente (no hay cadena de reserva por idioma). */
  readonly resolvedLanguage: LanguageId;
  /** Traduce una clave con su interpolación; reserva en inglés y, en su defecto, la propia clave. */
  t(key: string, opts?: Record<string, unknown>): string;
  /** Fija el idioma vigente (solo es/en/pt); devuelve el idioma resultante. */
  changeLanguage(lng: string): LanguageId;
}

const i18n: NidoI18n = {
  get language(): LanguageId {
    return currentLanguage;
  },
  get resolvedLanguage(): LanguageId {
    return currentLanguage;
  },
  t(key: string, opts?: Record<string, unknown>): string {
    const text =
      lookup(RESOURCES[currentLanguage], key) ?? lookup(RESOURCES.en, key) ?? key;
    return interpolate(text, opts);
  },
  changeLanguage(lng: string): LanguageId {
    const tag = String(lng ?? "").toLowerCase().slice(0, 2);
    if (tag === "es" || tag === "en" || tag === "pt") currentLanguage = tag;
    return currentLanguage;
  },
};

export default i18n;
