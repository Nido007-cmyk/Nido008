/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * catalog.ts — el catálogo de la guía integrada de PC.
 *
 * Declara la estructura y las promesas; nunca guarda prosa (el
 * contenido vive solo en el subárbol `guide.*` de los locales).
 * Por lección: su `id`, su módulo, las herramientas de las que
 * depende (para el aviso de herramienta apagada) y las etiquetas
 * visibles que su texto cita (claves de los locales que el cobro
 * 5 resuelve y cobra en su letra). Por ejemplo: la clase de ruta
 * que el turno real de PC toma, medida contra la app construida
 * el día de la pasada, y la cifra servida cuando la promesa es
 * una cifra. Sin ruta declarada, el ejemplo no entra.
 *
 * Las clases de ruta son las del turno construido
 * (`src/turn/turnPipeline.ts` en su composición): `canned` (la
 * capa determinista responde sin modelo), `device-time`,
 * `calculate` y `convert-units` (respuestas exactas de la app
 * por el bucle), `tool` (la herramienta nombrada en `tool`),
 * `guide-literal` (la guía servida tal cual, con su fuente),
 * `semantic-judged` (búsqueda con procedencia y juez),
 * `model-judged` (el modelo con el juez), `model-judged-tone`
 * (el modelo con el juez y el tono elegido aplicado),
 * `self-knowledge` (la identidad de la casa) y `abstention` (la
 * abstención honesta, sin fuente inventada).
 *
 * La bienvenida tiene su lista propia: sus ejemplos tocables son
 * promesas bajo la misma garantía, censados sobre la app
 * construida. Su ruta puede declararse por idioma cuando la capa
 * determinista responde distinto en cada uno. El primero entró
 * al bucle en los tres idiomas tras la cura H-GUIA-1, que abrió
 * la puerta de la bifurcación a la orden explícita de memoria:
 * la declaración cobra esa ruta medida, no la anterior a la cura.
 */

export type GuideLang = "es" | "en" | "pt";

export type GuideRouteClass =
  | "canned"
  | "device-time"
  | "calculate"
  | "convert-units"
  | "tool"
  | "agent-loop"
  | "guide-literal"
  | "semantic-judged"
  | "model-judged"
  | "model-judged-tone"
  | "self-knowledge"
  | "deep-research"
  | "abstention";

export interface GuideExampleDecl {
  route: GuideRouteClass;
  /** La herramienta que el turno ejecuta, cuando la clase es `tool`. */
  tool?: string;
  /** El corpus de la fixture que la batería sirve, cuando la ruta lo pide. */
  corpus?: "cpr" | "burn" | "aqueduct";
  /** La cifra que la respuesta servida trae, por idioma, cuando la promesa es una cifra. */
  expectContains?: Partial<Record<GuideLang, string>>;
}

export interface GuideLessonDecl {
  id: string;
  module: string;
  /** Herramientas reales de PC de las que la lección depende. */
  tools?: string[];
  /** Claves de los locales cuyas cadenas la lección cita en su letra. */
  labels?: string[];
  examples: GuideExampleDecl[];
}

export const GUIDE_MODULES: { id: string }[] = [
  { id: "empezar" },
  { id: "cada-dia" },
  { id: "seguridad" },
  { id: "conocimiento" },
  { id: "la-app" },
];

export const lessons: GuideLessonDecl[] = [
  {
    id: "hablar-con-nido",
    module: "empezar",
    labels: ["pcSurface.judgeFull", "pcSurface.judgeLexical"],
    examples: [{ route: "canned" }, { route: "model-judged" }],
  },
  {
    id: "elegir-modelo",
    module: "empezar",
    labels: ["pcSurface.navModels"],
    examples: [{ route: "model-judged" }],
  },
  {
    id: "hora-calculos-y-conversiones",
    module: "cada-dia",
    tools: ["device_time", "calculate", "convert_units"],
    examples: [
      { route: "device-time" },
      { route: "calculate", expectContains: { es: "9310", en: "9310", pt: "9310" } },
      {
        route: "convert-units",
        expectContains: { es: "16.0934", en: "16.0934", pt: "16.0934" },
      },
    ],
  },
  {
    id: "recordatorios-notas-y-memoria",
    module: "cada-dia",
    tools: ["create_reminder", "save_note", "remember_fact", "list_notes"],
    examples: [
      { route: "tool", tool: "create_reminder" },
      { route: "tool", tool: "save_note" },
      { route: "tool", tool: "remember_fact" },
      { route: "tool", tool: "list_notes" },
    ],
  },
  {
    // E7 (paso 6): la lección de la Agenda nace con la etapa;
    // sus ejemplos corren por la gramática real de las dos
    // herramientas que declara.
    id: "calendario-y-contactos",
    module: "cada-dia",
    tools: ["create_calendar_event", "list_calendar_events", "find_contact", "save_person"],
    labels: ["pcSurface.navAgenda"],
    examples: [
      { route: "tool", tool: "create_calendar_event" },
      { route: "tool", tool: "find_contact" },
    ],
  },
  {
    // E8 (paso 9): la lección de las tareas programadas nace
    // con la etapa que las construye. Sin ejemplos de chat:
    // las tareas se crean en su tarjeta de Ajustes, no por el
    // chat, y la lección enseña esa tarjeta y su trato
    // honesto (corren con NIDO abierto y la bóveda
    // desbloqueada; si estaba cerrado, al abrir).
    id: "tareas-programadas",
    module: "cada-dia",
    labels: ["scheduledTasks.title"],
    examples: [],
  },
  {
    // E9 (paso 5): la lección de la voz nace con la etapa que
    // la construye. Sin ejemplos de chat: la voz se usa
    // hablando y tocando el altavoz, no escribiendo una
    // frase de ejemplo; la lección enseña el dictado por
    // frases (nunca «manos libres»), la lectura y el estado
    // honesto de la sección Voz.
    id: "hablar-y-escuchar",
    module: "cada-dia",
    labels: ["voiceSettings.title", "pcSurface.dictate", "pcSurface.readAloud"],
    examples: [],
  },
  {
    id: "emergencias",
    module: "seguridad",
    labels: ["pcSurface.navEmergency"],
    examples: [],
  },
  {
    id: "memoria-cifrada-y-su-puerta",
    module: "seguridad",
    examples: [],
  },
  {
    id: "preguntar-sin-internet",
    module: "conocimiento",
    examples: [
      { route: "guide-literal", corpus: "cpr" },
      { route: "abstention" },
    ],
  },
  {
    id: "busqueda-en-espanol-y-portugues",
    module: "conocimiento",
    examples: [{ route: "semantic-judged", corpus: "burn" }],
  },
  {
    id: "paquetes-y-salvora",
    module: "conocimiento",
    labels: ["pcSurface.packsTab", "pcSurface.packsAddFile"],
    examples: [],
  },
  {
    // E6 (paso 7): la lección de los documentos personales
    // nace con la etapa, en su forma honesta de este paso:
    // importar, preguntar y abrir la cita en su página ya
    // funciona; la gestión con su presupuesto (paso 8) cierra
    // su bucle y su letra entonces. Sin ejemplos de ruta: lo
    // que promete es la superficie, no un turno medido, y no
    // promete velocidades (las sella el paso 9) ni formatos
    // que no entran (HEIC/HEIF/AVIF quedan fuera en v1).
    id: "documentos-personales",
    module: "conocimiento",
    labels: ["pcSurface.packsTab", "pcSurface.docsTitle", "pcSurface.docsAdd"],
    examples: [],
  },
  {
    // E10 (paso 5): la lección de la investigación profunda
    // nace con su etapa, en la sede de su paso 5 (GUIA.md
    // §2): enseña los latidos 1 a 9 y el 11 — el modo y su
    // plan con coste, la edición y el ámbito, el juez por
    // pasada, el suelo sin fuentes, los huecos declarados,
    // los cuatro estilos, los dos recibos y la emergencia
    // que nunca se investiga. El latido 10 (parar y seguir
    // mañana) se escribió en el paso 6, cuando las sesiones
    // existieron: es el sexto paso de la letra, y con él el
    // loop de la lección queda cerrado.
    id: "investigacion-profunda",
    module: "conocimiento",
    labels: [
      "pcSurface.research",
      "pcSurface.researchPlanTitle",
      "pcSurface.researchStyleCompleto",
      "pcSurface.researchReceiptClaims",
    ],
    examples: [{ route: "deep-research", corpus: "aqueduct" }],
  },
  {
    id: "acerca-de-y-donaciones",
    module: "la-app",
    labels: [
      "pcSurface.about",
      "aboutScreen.developmentTitle",
      "aboutScreen.developmentCopy",
      "aboutScreen.developmentCopied",
      "aboutScreen.reportTitle",
      "aboutScreen.reportCopy",
    ],
    examples: [],
  },
  {
    id: "tono-y-si-algo-falla",
    module: "la-app",
    labels: [
      "personalitySettings.title",
      "personalities.succinct.label",
      "personalities.detailed.label",
      "personalities.summary.label",
      "personalities.custom.label",
      "pcSurface.about",
      "aboutScreen.reportTitle",
      "aboutScreen.reportCopy",
    ],
    examples: [{ route: "model-judged-tone" }],
  },
  {
    // E11 (paleta M-2): nace con la paleta crecida, en la
    // misma tanda que la construye.
    id: "paleta-de-comandos",
    module: "la-app",
    labels: ["pcSurface.palettePlaceholder", "pcSurface.paletteEmpty"],
    examples: [{ route: "model-judged" }],
  },
  {
    // E11 (paso 1 y paso 6): nace con el mapa de atajos y
    // su hoja, en la misma tanda que los construye.
    id: "atajos-de-teclado",
    module: "la-app",
    labels: ["pcSurface.shortcutsTitle"],
    examples: [{ route: "model-judged" }],
  },
];

/**
 * Los ejemplos tocables de la ventana de bienvenida, en el orden
 * en que `promptIdeasCarousel.items` los sirve. La ruta se
 * declara por idioma cuando la capa determinista responde
 * distinto en cada uno (así quedó medido el primero: la orden
 * compuesta de recordatorio y dato entra al bucle en inglés y
 * cae al modelo con juez en español y portugués).
 */
export interface GuideWelcomeDecl {
  route: GuideRouteClass | Partial<Record<GuideLang, GuideRouteClass>>;
  tool?: string;
}

export const welcome: GuideWelcomeDecl[] = [
  { route: "agent-loop" },
  { route: "self-knowledge" },
  { route: "model-judged" },
  { route: "agent-loop" },
  { route: "model-judged" },
  { route: "self-knowledge" },
];
