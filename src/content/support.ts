/**
 * support.ts · Fuente única del apoyo voluntario en PC (tanda 14, S-9).
 *
 * Aquí viven UNA SOLA VEZ en el código de PC:
 *  - las dos direcciones de aportación de la tarjeta «Desarrollo de
 *    NIDO», recreadas de la fuente única del móvil
 *    (`src/ui/aboutSupport.ts` del árbol 0.1.108) y verificadas contra
 *    las dos transcripciones independientes de sus baterías;
 *  - la nota de SALVORA en los tres idiomas, citada carácter a
 *    carácter de su redacción sellada (`DIRECTIVA-SALVORA-DONACIONES`
 *    §6.2; redacción preparada en `e5p8-prep/SALVORA.md` §3). La nota
 *    NACE en PC: no se recrea del móvil. Su primera sede es el Acerca
 *    de (S-9); el paso 8 de E5 la consume para la sección de paquetes
 *    sin escribir el texto por segunda vez.
 *
 * Los textos de la tarjeta de donaciones (título, cuerpo, etiquetas,
 * botón y aviso) viven en los locales (`aboutScreen.development*`),
 * verificados idénticos a la hoja firmada; aquí solo viven las
 * direcciones y la nota, que son lo que exige fuente única de código.
 *
 * La batería `support.test.ts` transcribe direcciones y nota por
 * segunda vez, de forma independiente, y censura que cada dirección
 * aparezca una sola vez en `src/` fuera de las baterías.
 */

export type SupportLang = "es" | "en" | "pt";

/** Dirección de aportación en la red Solana (USDC u otro token). */
export const SOLANA_ADDRESS = "G74aAtEB41eFAcXtRbBVcRVpZDgELBCoFeUo9AyTnjRK";

/** Dirección de aportación en la red Base (USDC u otro token). */
export const BASE_ADDRESS = "0x5c030688FAcF0c74a5fF5eB00686A0021d95c1fC";

/** La web de SALVORA, enseñada como texto en la nota. */
export const SALVORA_SITE = "salvorapacks.com";

/**
 * La nota de SALVORA, citada de su redacción sellada. Sin direcciones
 * ni botón de copiar en ninguna sede: eso vive solo en la tarjeta de
 * donaciones.
 */
export const SALVORA_NOTE: Record<SupportLang, string> = {
  es: "NIDO es gratuito, sin cuentas y sin funciones de pago. Quien quiera apoyar su desarrollo puede comprar paquetes de guías de SALVORA en salvorapacks.com: cada compra ayuda a seguir desarrollando NIDO. Comprar no desbloquea nada, porque en NIDO no hay contenido bloqueado. Los paquetes son conocimiento que entra en tu biblioteca por la puerta firmada de siempre, igual que los demás paquetes de esta lista.",
  en: "NIDO is free, with no accounts and no paid features. If you would like to support its development, you can buy SALVORA guide packs at salvorapacks.com: every purchase helps NIDO keep growing. Buying unlocks nothing, because NIDO has no locked content. The packs are knowledge that joins your library through the same signed door as always, just like the other packs on this list.",
  pt: "O NIDO é gratuito, sem contas e sem recursos pagos. Quem quiser apoiar o seu desenvolvimento pode comprar pacotes de guias da SALVORA em salvorapacks.com: cada compra ajuda o NIDO a continuar crescendo. Comprar não desbloqueia nada, porque no NIDO não há conteúdo bloqueado. Os pacotes são conhecimento que entra na sua biblioteca pela porta assinada de sempre, igual aos outros pacotes desta lista.",
};

export function salvoraNote(lang: SupportLang): string {
  return SALVORA_NOTE[lang] ?? SALVORA_NOTE.es;
}
