/**
 * problemReport.ts · El resumen de «Reportar un problema» (S-9,
 * bloque 5; hoja S9-CONTENIDO §4 y orden de E13 §4).
 *
 * La forma honesta es la del móvil y no se negocia: la app prepara,
 * la persona envía; la app nunca envía nada por red. El resumen se
 * compone solo de datos de la app y de la máquina (versión, sistema,
 * clase de máquina, modelo en uso y último error registrado) y la
 * persona lo ve entero antes de copiarlo. Por construcción no lee
 * mensajes, notas, memoria ni contactos; el motivo del error se
 * sanea al componer (una línea, sin rutas ni direcciones, con tope),
 * como el móvil sanea al copiar (SEC-05).
 *
 * La plantilla vive en los locales (`aboutScreen.reportTpl*`), en la
 * forma exacta que el formulario de bugs del repo espera.
 */
import en from "../i18n/locales/en.json" with { type: "json" };
import es from "../i18n/locales/es.json" with { type: "json" };
import pt from "../i18n/locales/pt.json" with { type: "json" };

export type ReportLang = "es" | "en" | "pt";

export interface ProblemReportFacts {
  /** Versión de la app construida (dato vivo). */
  version: string;
  /** Sistema y su versión, p. ej. «Windows 11» o «Linux 6.8». */
  system: string;
  /** Clase de máquina, p. ej. «16 GB». */
  memoryClass: string;
  /** Nombre llano del modelo en uso, o null. */
  modelName: string | null;
  /** Último error registrado («motivo · fecha»), o null. */
  lastError: string | null;
}

const LOCALES = { es, en, pt } as const;

/**
 * Sanea el motivo de un error para el informe: una sola línea, sin
 * rutas del sistema ni direcciones, con tope de longitud. Lo que
 * pudiera parecer traza de la persona sale aquí, al componer.
 */
export function sanitizeErrorReason(raw: string): string {
  let s = raw.replace(/[\r\n\t]+/g, " ");
  // Fuera rutas y direcciones: cortan el texto desde su aparición.
  const cut = s.search(/(https?:\/\/|file:\/\/|[A-Za-z]:\\|\/(home|Users|tmp|var)\/)/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/\s{2,}/g, " ").trim();
  if (s.length > 200) s = s.slice(0, 200).trimEnd() + "…";
  return s;
}

export function composeProblemReport(
  lang: ReportLang,
  facts: ProblemReportFacts,
): string {
  const t = LOCALES[lang].aboutScreen as Record<string, string>;
  const none = t.reportTplNone;
  const model = facts.modelName?.trim() ? facts.modelName.trim() : none;
  const error = facts.lastError?.trim()
    ? sanitizeErrorReason(facts.lastError)
    : none;
  return [
    t.reportTplTitle,
    `${t.reportTplVersion}: ${facts.version}`,
    `${t.reportTplSystem}: ${facts.system} · ${t.reportTplMemory}: ${facts.memoryClass}`,
    `${t.reportTplModel}: ${model}`,
    `${t.reportTplError}: ${error}`,
  ].join("\n");
}
