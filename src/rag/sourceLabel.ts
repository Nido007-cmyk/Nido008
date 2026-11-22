/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * sourceLabel.ts — la etiqueta de una fuente y la cabecera de
 * página del panel (E6, paso 7; contrato de etapa §7).
 *
 * La página vive SOLO en el metadato del fragmento que la
 * recuperación sirvió: la etiqueta la compone este código
 * desde ese metadato y el título del registro del documento,
 * en el idioma del turno. El modelo nunca escribe la página:
 * escribe marcadores [n] y el limpiador de citas retira los
 * que no casan con una fuente servida (stripInvalidCitations,
 * sin cambio de contrato). Sin página (txt, md, imágenes
 * sueltas, corpus y paquetes), la etiqueta es la del móvil:
 * solo el documento.
 */

export type SourceLabelLang = "es" | "en" | "pt";

/**
 * El título del documento sin el sufijo de pieza del
 * importador (« (part 3/12)»): ese sufijo es el convenio del
 * móvil para distinguir los trozos de un documento en sus
 * listas y vive en el título guardado por paridad, pero la
 * etiqueta de la cita (§7.1) lleva el título del documento
 * tal como la persona lo ve en su Biblioteca. Solo se retira
 * el sufijo exacto al final; cualquier otro título pasa
 * intacto.
 */
export function cleanDocTitle(title: string): string {
  return title.replace(/ \(part \d+\/\d+\)$/, "");
}

/** «{documento} · pág. {n}» (es/pt) · «{document} · p. {n}» (en). */
export function sourceLabel(
  title: string,
  page: number | null | undefined,
  lang: SourceLabelLang,
): string {
  if (page == null || !Number.isFinite(page) || page < 1) return title;
  return lang === "en" ? `${title} · p. ${page}` : `${title} · pág. ${page}`;
}

/**
 * La cabecera de la página en el panel de fuentes: «pág. 7 de
 * 128» con el total conocido, «pág. 7» sin él. El total sale
 * del registro de la base (page_count de la importación o el
 * máximo del propio documento), nunca de un texto generado.
 */
export function sourcePageHeader(
  page: number | null | undefined,
  total: number | null | undefined,
  lang: SourceLabelLang,
): string | null {
  if (page == null || !Number.isFinite(page) || page < 1) return null;
  const known = total != null && Number.isFinite(total) && total >= page;
  if (lang === "en") return known ? `p. ${page} of ${total}` : `p. ${page}`;
  return known ? `pág. ${page} de ${total}` : `pág. ${page}`;
}
