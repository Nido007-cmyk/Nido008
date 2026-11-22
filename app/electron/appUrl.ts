/**
 * appUrl.ts — el origen de la casa de la carcasa, como módulo PURO
 * (F-PC76, tanda de seguridad): sin una sola importación de Electron,
 * para que la batería lo ejercite sin la carcasa entera.
 *
 * La página de la casa se sirve por el esquema propio `nido:` con
 * anfitrión `app` (shell.ts registra el esquema y su manejador). La
 * pregunta que esta pieza responde —«¿es esta URL de la casa?»— la
 * consumen la bendición del emisor IPC y el guardia de navegación:
 * una respuesta de más es un origen ajeno tratado como propio.
 */

export const APP_SCHEME = "nido";
export const APP_PAGE_URL = `${APP_SCHEME}://app/index.html`;

/**
 * ¿Es `rawUrl` una URL de la casa? En desarrollo manda el origen del
 * servidor de Vite (D-5: comparación de origen parseado, nunca de
 * prefijos). En producción, el esquema propio con su anfitrión.
 */
export function isAppUrl(rawUrl: string, devServerUrl: string | undefined): boolean {
    try {
        const url = new URL(rawUrl);
        if (devServerUrl)
            // D-5 de la auditoría de ataque 3: nada de prefijos de
            // cadena (http://localhost:5173.evil.example/ pasaba);
            // se compara el origen parseado, exacto.
            return url.origin === new URL(devServerUrl).origin;
        if (url.protocol !== `${APP_SCHEME}:`)
            return false;
        // F-PC76: `nido:` no es un esquema especial WHATWG, así que su
        // origen vale "null" para TODO anfitrión y comparar orígenes
        // no distingue nada (cualquier nido://lo-que-sea/ pasaba por
        // propio). La casa es el ANFITRIÓN exacto `app`: con puerto,
        // con userinfo, con punto final o en mayúsculas —el anfitrión
        // opaco no se normaliza— no es el anfitrión de la casa. Es la
        // misma comparación que el manejador del protocolo ya hacía.
        return url.host === "app";
    } catch {
        return false;
    }
}
