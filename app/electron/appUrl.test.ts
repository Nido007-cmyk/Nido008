/**
 * Batería de F-PC76 (tanda de seguridad): la bendición de origen de la
 * carcasa. `nido:` no es un esquema especial WHATWG: su origen vale
 * "null" para TODO anfitrión, así que comparar orígenes no distingue
 * la casa de un anfitrión ajeno con el mismo esquema — cualquier
 * `nido://lo-que-sea/` pasaba por propio. La forma buena compara el
 * anfitrión exacto. La rama de desarrollo (http:, donde el origen sí
 * distingue) no se toca.
 */

import {describe, expect, it} from "vitest";
import {isAppUrl} from "./appUrl";

const DEV = "http://localhost:5173";

// [url, devServerUrl, esperado, nombre] — 16 casos: 3 de la casa,
// 7 anfitriones ajenos o disfrazados con el mismo esquema, 4 de otros
// esquemas o sin parsear, y los 2 de la rama de desarrollo.
const CASOS: Array<[string, string | undefined, boolean, string]> = [
    ["nido://app/index.html", undefined, true, "la página de la casa"],
    ["nido://app/", undefined, true, "la raíz de la casa"],
    ["nido://app/assets/index-x.js", undefined, true, "un recurso de la casa"],
    ["nido://app.evil.com/index.html", undefined, false, "dominio parecido con el mismo esquema"],
    ["nido://app@evil.com/", undefined, false, "userinfo que disfraza el anfitrión"],
    ["nido://app:9999/index.html", undefined, false, "el anfitrión de la casa con puerto"],
    ["nido:///index.html", undefined, false, "el esquema sin anfitrión"],
    ["nido://app./index.html", undefined, false, "el anfitrión con punto final (opaco, no se normaliza)"],
    ["nido://evil.com/", undefined, false, "otro anfitrión cualquiera con el mismo esquema"],
    ["nido://APP/index.html", undefined, false, "el anfitrión en mayúsculas (opaco, no se normaliza)"],
    ["https://app/index.html", undefined, false, "otro esquema con el mismo anfitrión"],
    ["file:///app/index.html", undefined, false, "file: no es la casa"],
    ["data:text/html,<h1>x</h1>", undefined, false, "data: no es la casa"],
    ["index.html", undefined, false, "una cadena sin parsear no es la casa"],
    ["http://localhost:5173/index.html", DEV, true, "desarrollo: el origen del servidor de Vite"],
    ["http://localhost:5174/", DEV, false, "desarrollo: otro puerto no es el servidor"],
];

describe("F-PC76 · isAppUrl: la casa es el anfitrión «app» del esquema propio, y ningún otro", () => {
    it.each(CASOS)("%s → %s (%s)", (url, dev, esperado) => {
        expect(isAppUrl(url, dev)).toBe(esperado);
    });
});
