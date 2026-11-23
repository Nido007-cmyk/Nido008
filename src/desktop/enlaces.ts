/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * enlaces.ts — E11 paso 7: los enlaces nido:// que llegan
 * desde fuera. La tabla de rutas es cerrada y está
 * reconciliada con la carcasa (el asiento de apertura la
 * trae en su letra): emergencia, chat, chat/<id> y
 * guia/<id>, con el esquema `nido`, la familia como
 * anfitrión y los ids como segmentos opacos. Sin cadena
 * de consulta y sin fragmento: un enlace que los trae es
 * malformado y cae cerrado. No hay rutas de ajustes,
 * modelos ni agenda, y el anfitrión `app` es el contenido
 * servido, no una ruta.
 *
 * El enlace navega, nunca actúa: la resolución solo
 * produce navegación o un aviso llano, en un vocabulario
 * cerrado. La bóveda manda: bloqueada, la ruta se retiene
 * y un id existente y uno inexistente son
 * indistinguibles; desbloqueada, un id que no está cae en
 * su aviso y su lista, nunca en un «similar». Una guía
 * cuyo paquete no está instalado lo dice su aviso y
 * ofrece su sitio en la biblioteca, sin instalar nada
 * (R4).
 */

export type LinkRoute =
  | { family: "emergencia" }
  | { family: "chat"; id?: string }
  | { family: "guia"; id: string };

export interface LinkWorld {
  vaultUnlocked: boolean;
  conversationIds: string[];
  installedGuideIds: string[];
  guideCatalogIds: string[];
}

export type LinkNotice = "malformed" | "chat-missing" | "guide-missing" | "guide-not-installed";

export type LinkResolution =
  | { kind: "navigate"; section: "chat" | "emergency" | "library"; conversationId?: string; guideId?: string }
  | { kind: "notice"; notice: LinkNotice; section: "chat" | "library" }
  | { kind: "hold" };

const PREFIX = "nido://";

/** Un segmento de id: opaco, sin espacios ni controles ni separadores. */
function isIdSegment(seg: string): boolean {
  if (seg.length === 0) return false;
  for (const ch of seg) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || ch === "/" || ch === "?" || ch === "#") {
      return false;
    }
  }
  return true;
}

/**
 * El análisis del enlace crudo contra la tabla cerrada.
 * null cuando el enlace es malformado: esquema ajeno o
 * con otra grafía, anfitrión fuera de la tabla o con
 * puerto o credenciales, cadena de consulta, fragmento,
 * segmentos de más o de menos. No se normaliza nada: lo
 * que no es la forma exacta cae cerrado.
 */
export function parseLink(raw: string): LinkRoute | null {
  if (typeof raw !== "string") return null;
  if (raw.includes("?") || raw.includes("#")) return null;
  if (!raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length);
  const parts = rest.split("/");
  const host = parts[0];
  const segments = parts.slice(1);
  if (host === "emergencia") {
    if (segments.length !== 0) return null;
    return { family: "emergencia" };
  }
  if (host === "chat") {
    if (segments.length === 0) return { family: "chat" };
    if (segments.length === 1 && isIdSegment(segments[0])) {
      return { family: "chat", id: segments[0] };
    }
    return null;
  }
  if (host === "guia") {
    if (segments.length === 1 && isIdSegment(segments[0])) {
      return { family: "guia", id: segments[0] };
    }
    return null;
  }
  return null;
}

/**
 * La resolución contra el mundo de la sesión. El orden
 * es el de la letra: lo malformado cae en su aviso (no
 * lleva nada de la bóveda y no espera al desbloqueo); la
 * ruta bien formada se retiene con la bóveda bloqueada,
 * igual exista o no su id; desbloqueada, navega o avisa.
 */
export function resolveLink(route: LinkRoute | null, world: LinkWorld): LinkResolution {
  if (route === null) {
    return { kind: "notice", notice: "malformed", section: "chat" };
  }
  if (!world.vaultUnlocked) return { kind: "hold" };
  switch (route.family) {
    case "emergencia":
      return { kind: "navigate", section: "emergency" };
    case "chat": {
      if (route.id === undefined) return { kind: "navigate", section: "chat" };
      if (world.conversationIds.includes(route.id)) {
        return { kind: "navigate", section: "chat", conversationId: route.id };
      }
      return { kind: "notice", notice: "chat-missing", section: "chat" };
    }
    case "guia": {
      if (world.installedGuideIds.includes(route.id)) {
        return { kind: "navigate", section: "library", guideId: route.id };
      }
      if (world.guideCatalogIds.includes(route.id)) {
        return { kind: "notice", notice: "guide-not-installed", section: "library" };
      }
      return { kind: "notice", notice: "guide-missing", section: "library" };
    }
  }
}

/**
 * La llegada fría: el enlace viaja como un argumento más
 * del arranque y esta extracción lo encuentra sin tocar
 * los demás. La forma buscada es la del esquema de la
 * casa; el análisis decide después si es una ruta.
 */
export function extractLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(PREFIX)) return arg;
  }
  return null;
}
