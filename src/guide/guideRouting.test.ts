/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * guideRouting.test.ts — la batería dueña de la guía integrada de PC.
 *
 * La garantía heredada del móvil, entera: ningún ejemplo de la guía
 * puede prometer una ruta que el turno real de PC no tome. Seis
 * cobros que no se compensan (GUIA-PC-CONSTRUCCION-PREP §5):
 *
 *  1. Paridad estructural trilingüe contra la estructura que PC
 *     declara en su catálogo (`src/guide/catalog.ts`), no contra
 *     las cifras del móvil.
 *  2. Cada ejemplo, en cada idioma, enrutado por el turno real de
 *     PC (`runTurn` de `src/turn/turnPipeline.ts`, la composición
 *     misma, con sus dobles de motor y de recuperación en la forma
 *     de `turnPipeline.test.ts`): la ruta obtenida es la declarada
 *     en el catálogo. La guarda de sincronía vive en este cobro:
 *     un test lee el pipeline y cobra que sus doce pasos y su
 *     unión de rutas siguen en la forma que esta batería conoce;
 *     si el orden del turno cambia y la batería no, la guarda cae
 *     aunque los ejemplos salgan verdes.
 *  3. El ejemplo se escribe en el compositor y nunca se envía: la
 *     mecánica pasa por la costura `exampleTap` que la superficie
 *     usa, y un censo sobre `App.tsx` cobra que el camino del
 *     toque no toca `turnSend`.
 *  4. Honestidad: con una herramienta apagada en los permisos del
 *     agente, su función no se ejecuta y ningún texto promete lo
 *     que PC no tiene (llamadas, SMS, P2P en la v1), por búsqueda
 *     en los textos y por la estructura del catálogo.
 *  5. Las etiquetas visibles citadas resuelven a una cadena real
 *     en ese idioma y a la superficie que nombran.
 *  6. Progreso: las marcas de visto persisten en los ajustes y
 *     perderlas no rompe nada; su camino servido (arranque y
 *     canal) existe en la carcasa.
 *
 * Alcance honesto de la fixture: la recuperación se sustituye por
 * trozos del corpus real del Esencial en la forma de
 * `guideAnswer.test.ts`; la búsqueda semántica misma (el cruce de
 * idioma dentro de `retrieve`) la cobran las baterías de E5 y la
 * pasada de aceptación sobre la instalación real. Lo que aquí se
 * cobra es que, con esos trozos, el turno sirve la respuesta con
 * su procedencia, en los tres idiomas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LANGS = ["es", "en", "pt"] as const;
type Lang = (typeof LANGS)[number];

// ---------------------------------------------------------------------
// Dobles del turno (la forma de turnPipeline.test.ts)
// ---------------------------------------------------------------------

const facade = vi.hoisted(() => ({
  generate: vi.fn(async (args: { messages?: unknown; prompt?: unknown }) => {
    const blob = JSON.stringify(args?.messages ?? args?.prompt ?? []);
    facade.lastPrompt = blob;
    // El doble del modelo responde como respondería un modelo
    // sano: contesta lo preguntado y se abstiene donde no sabe.
    if (/fútbol|football|futebol/i.test(blob)) {
      if (/portugu|futebol/i.test(blob)) return "Não sei: não tenho esse resultado.";
      if (/football/i.test(blob)) return "I don't know: I don't have that result.";
      return "No lo sé: no tengo ese resultado.";
    }
    if (/cielo|sky|céu/i.test(blob)) {
      return "El cielo se ve azul porque el aire dispersa la luz azul del sol más que los demás colores.";
    }
    if (/nubes|clouds|nuvens/i.test(blob)) {
      return "Las nubes se forman cuando el vapor de agua del aire se enfría y se condensa en gotas diminutas.";
    }
    return "Respuesta del modelo de prueba.";
  }),
  isLoaded: true,
  modelInfo: { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 } as { filename: string; nCtx: number } | null,
  lastPrompt: null as string | null,
  modelsDir: null as string | null,
  load: vi.fn(async (_filename: string) => undefined),
}));

vi.mock("../inference/LlamaEngine.js", () => ({
  llamaEngine: {
    generate: facade.generate,
    get isLoaded() {
      return facade.isLoaded;
    },
    getModelInfo: () => facade.modelInfo,
    get lastPromptSent() {
      return facade.lastPrompt;
    },
    countTokens: (text: string) => Math.max(1, Math.round(text.length / 4)),
    hasEmbeddedChatTemplate: () => true,
    load: facade.load,
    stop: () => undefined,
  },
  setLlamaModelsDir: () => undefined,
  llamaModelsDir: () => facade.modelsDir,
}));

interface ChunkFixture {
  chunkId: string;
  docId: string;
  title: string;
  body: string;
  score: number;
  rawScore?: number;
  matchType: "lexical" | "semantic" | "hybrid";
}
const retrieval = vi.hoisted(() => ({ chunks: [] as ChunkFixture[] }));

vi.mock("../rag/retrieve.js", async () => {
  const profile = await import("../rag/embeddingProfile.js");
  return {
    retrieve: vi.fn(async () => retrieval.chunks),
    activeRetrievalProfile: () => profile.MULTILINGUAL_E5_SMALL_PROFILE,
  };
});

// La fuente del pack: la guía entera de la fixture, por id de trozo.
// Los títulos y las líneas son los de las guías reales del Esencial
// en la forma en que guideAnswer.test.ts las fija.
const PACK_DOCS: Record<string, { title: string; source: string; parts: { id: number; body: string }[] }> = {};
function registerDoc(chunkId: string, title: string, source: string, parts: string[]): void {
  PACK_DOCS[chunkId] = { title, source, parts: parts.map((body, i) => ({ id: i + 1, body })) };
}
vi.mock("../rag/packs.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    readPackSource: async (chunkId: string) => {
      const doc = PACK_DOCS[chunkId];
      if (!doc) return null;
      return { title: doc.title, source: doc.source, parts: doc.parts.map((p) => ({ ...p, used: true })) };
    },
  };
});

// El almacén de memoria en memoria: los handlers reales escriben
// aquí, y la batería cobra el estado, no la palabra del handler.
const mem = vi.hoisted(() => ({
  notes: [] as { id: string; title: string; body: string }[],
  reminders: [] as { id: string; text: string; dueAt?: string }[],
  facts: [] as { id: string; content: string; category: string }[],
  people: [] as { id: string; name: string }[],
  reset() {
    mem.notes = [];
    mem.reminders = [];
    mem.facts = [];
    mem.people = [];
  },
}));
vi.mock("../agent/memory/memoryStore.js", () => ({
  MAX_FACT_CONTENT_CHARS: 500,
  MAX_PERSON_NOTES_CHARS: 500,
  saveNote: async (input: { title: string; body: string }) => {
    const note = { id: `n${mem.notes.length + 1}`, ...input };
    mem.notes.push(note);
    return note;
  },
  listNotes: async (limit: number) => mem.notes.slice(0, limit),
  getNote: async (id: string) => mem.notes.find((n) => n.id === id) ?? null,
  deleteNote: async (id: string) => {
    mem.notes = mem.notes.filter((n) => n.id !== id);
  },
  saveReminder: async (input: { text: string; dueAt?: string }) => {
    const r = { id: `r${mem.reminders.length + 1}`, ...input };
    mem.reminders.push(r);
    return r;
  },
  listReminders: async (limit: number) => mem.reminders.slice(0, limit),
  deleteReminder: async (id: string) => {
    mem.reminders = mem.reminders.filter((r) => r.id !== id);
  },
  saveFact: async (input: { content: string; category: string }) => {
    const f = { id: `f${mem.facts.length + 1}`, ...input };
    mem.facts.push(f);
    return f;
  },
  getFacts: async (limit: number) => mem.facts.slice(0, limit),
  deleteFact: async (id: string) => {
    mem.facts = mem.facts.filter((f) => f.id !== id);
  },
  savePerson: async (input: { name: string }) => {
    const p = { id: `p${mem.people.length + 1}`, ...input };
    mem.people.push(p);
    return p;
  },
  getPeople: async () => mem.people,
  deletePerson: async (id: string) => {
    mem.people = mem.people.filter((p) => p.id !== id);
  },
}));

// El sistema de ficheros de los ajustes, en memoria (la forma de
// settings.concurrency.test.ts): el cobro 6 ejerce las marcas
// contra el lector real de settings.ts.
const fsWorld = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("../security/fileSystem.js", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (path: string) => ({ exists: fsWorld.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fsWorld.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fsWorld.files.set(path, content);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const v = fsWorld.files.get(from);
    if (v === undefined) throw new Error(`no existe: ${from}`);
    fsWorld.files.set(to, v);
    fsWorld.files.delete(from);
  },
  deleteAsync: async (path: string) => {
    fsWorld.files.delete(path);
  },
}));

// ---------------------------------------------------------------------
// Lectura de locales y del catálogo
// ---------------------------------------------------------------------

type LocaleTree = Record<string, unknown>;
function loadLocale(lang: Lang): LocaleTree {
  return JSON.parse(readFileSync(join(ROOT, "src", "i18n", "locales", `${lang}.json`), "utf8")) as LocaleTree;
}
function dig(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), tree);
}
interface GuideLessonText {
  id: string;
  title: string;
  what: string;
  steps: string[];
  examples: string[];
  tip: string;
}
function guideLessons(lang: Lang): GuideLessonText[] {
  const guide = dig(loadLocale(lang), "guide") as { modules?: { id: string; lessons?: GuideLessonText[] }[] } | undefined;
  const out: GuideLessonText[] = [];
  for (const m of guide?.modules ?? []) for (const l of m.lessons ?? []) out.push(l);
  return out;
}
function lessonText(lang: Lang, id: string): GuideLessonText | undefined {
  return guideLessons(lang).find((l) => l.id === id);
}
function welcomePrompts(lang: Lang): string[] {
  const items = dig(loadLocale(lang), "promptIdeasCarousel.items") as { prompt?: string }[] | undefined;
  return (items ?? []).map((i) => i.prompt ?? "");
}

interface CatalogModule {
  lessons: { id: string; module: string; tools?: string[]; labels?: string[]; examples: { route: string; tool?: string; expectContains?: Partial<Record<Lang, string>> }[] }[];
  welcome: { route: string | Partial<Record<Lang, string>>; tool?: string }[];
}
async function loadCatalog(): Promise<CatalogModule> {
  return (await import("./catalog.js")) as unknown as CatalogModule;
}

beforeEach(() => {
  facade.generate.mockClear();
  facade.load.mockClear();
  facade.isLoaded = true;
  facade.modelInfo = { filename: "models/qwen3-0.6b-q4km.gguf", nCtx: 4096 };
  facade.lastPrompt = null;
  retrieval.chunks = [];
  mem.reset();
});

// ---------------------------------------------------------------------
// Cobro 4 (primera mitad, sin catálogo): los textos no prometen lo
// que PC no tiene. Este cobro nace en rojo POR PRESENCIA: cae sobre
// el residuo guide.* que la sustitución del ACTO 1 retira.
// ---------------------------------------------------------------------

const ABSENT_PROMISES: { pattern: RegExp; what: string }[] = [
  { pattern: /bluetooth/i, what: "Bluetooth (P2P entre dispositivos)" },
  { pattern: /chip de seguridad/i, what: "el chip de seguridad de la tablet como custodia" },
  { pattern: /security chip/i, what: "the tablet security chip as custody" },
  { pattern: /chip de segurança/i, what: "o chip de segurança do tablet como custódia" },
  { pattern: /otro NIDO por/i, what: "hablar con otro NIDO como función de PC" },
  { pattern: /another NIDO over/i, what: "talking to another NIDO as a PC feature" },
  { pattern: /outro NIDO por/i, what: "falar com outro NIDO como função do PC" },
];

function allGuideStrings(lang: Lang): string[] {
  const guide = dig(loadLocale(lang), "guide");
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(guide);
  return out;
}

describe("cobro 4 · honestidad: los textos no prometen funciones ausentes en PC", () => {
  for (const lang of LANGS) {
    it(`ningún texto de la guía promete lo ausente (${lang})`, () => {
      const all = allGuideStrings(lang).join("\n");
      for (const { pattern, what } of ABSENT_PROMISES) {
        expect(all, `la guía en ${lang} promete ${what}`).not.toMatch(pattern);
      }
    });
  }

  it("la lección de emergencias dice que la llamada se hace desde el teléfono, en los tres idiomas", async () => {
    await loadCatalog();
    const phoneWord: Record<Lang, RegExp> = { es: /teléfono/, en: /phone/, pt: /telefone/ };
    for (const lang of LANGS) {
      const lesson = lessonText(lang, "emergencias");
      expect(lesson, `falta la lección de emergencias en ${lang}`).toBeDefined();
      const text = [lesson!.what, ...lesson!.steps, lesson!.tip].join("\n");
      expect(text).toMatch(phoneWord[lang]);
      expect(text).not.toMatch(/NIDO (llama|marca|llamar)|NIDO (calls|dials)|O NIDO (liga|marca)/);
    }
  });

  it("la lección de la puerta no promete TPM, ni Hello, ni recuperación de contraseña", async () => {
    await loadCatalog();
    for (const lang of LANGS) {
      const lesson = lessonText(lang, "memoria-cifrada-y-su-puerta");
      expect(lesson, `falta la lección de la puerta en ${lang}`).toBeDefined();
      const text = [lesson!.what, ...lesson!.steps, lesson!.tip].join("\n");
      expect(text).not.toMatch(/\bTPM\b|Windows Hello/);
    }
    const es = lessonText("es", "memoria-cifrada-y-su-puerta")!;
    expect([es.what, ...es.steps, es.tip].join("\n")).toMatch(/no hay forma de recuperar/);
    const en = lessonText("en", "memoria-cifrada-y-su-puerta")!;
    expect([en.what, ...en.steps, en.tip].join("\n")).toMatch(/no way to recover/);
    const pt = lessonText("pt", "memoria-cifrada-y-su-puerta")!;
    expect([pt.what, ...pt.steps, pt.tip].join("\n")).toMatch(/não há forma de recuperar/);
  });
});

// ---------------------------------------------------------------------
// Cobro 1 · Paridad estructural trilingüe contra el catálogo de PC
// ---------------------------------------------------------------------

describe("cobro 1 · paridad estructural trilingüe", () => {
  for (const lang of LANGS) {
    it(`los módulos y las lecciones de los locales casan con el catálogo, por id y en orden (${lang})`, async () => {
      const catalog = await loadCatalog();
      const declared = catalog.lessons.map((l) => l.id);
      expect(declared.length).toBeGreaterThan(0);
      expect(guideLessons(lang).map((l) => l.id), `orden de lecciones en ${lang}`).toEqual(declared);
      const guide = dig(loadLocale(lang), "guide") as { modules?: { id: string }[] } | undefined;
      expect((guide?.modules ?? []).map((m) => m.id), `orden de módulos en ${lang}`).toEqual([
        ...new Set(catalog.lessons.map((l) => l.module)),
      ]);
    });

    it(`la lista de la bienvenida sirve sus ejemplos declarados (${lang})`, async () => {
      const catalog = await loadCatalog();
      expect(welcomePrompts(lang).length, `ejemplos de la bienvenida en ${lang}`).toBe(catalog.welcome.length);
      for (const p of welcomePrompts(lang)) expect(p.trim().length).toBeGreaterThan(0);
    });
  }
});

// La paridad por lección e idioma se registra al cargar el
// catálogo: un caso por unidad, en la forma de la fórmula de
// conteo de la pasada (una lección por idioma).
const catalogForUnits = await loadCatalog();
describe("cobro 1 · paridad por lección e idioma (unidades)", () => {
  for (const decl of catalogForUnits.lessons) {
    for (const lang of LANGS) {
      it(`paridad · ${decl.id} · ${lang}`, () => {
        const lesson = lessonText(lang, decl.id);
        expect(lesson, `falta ${decl.id} en ${lang}`).toBeDefined();
        expect(lesson!.title.trim().length).toBeGreaterThan(0);
        expect(lesson!.what.trim().length).toBeGreaterThan(0);
        expect(lesson!.examples.length, `ejemplos de ${decl.id} en ${lang}`).toBe(decl.examples.length);
        for (const ex of lesson!.examples) expect(ex.trim().length).toBeGreaterThan(0);
        const es = lessonText("es", decl.id)!;
        expect(lesson!.steps.length, `pasos de ${decl.id} en ${lang}`).toBe(es.steps.length);
      });
    }
  }
});

// ---------------------------------------------------------------------
// Cobro 5 · Las etiquetas visibles citadas resuelven
// ---------------------------------------------------------------------

describe("cobro 5 · las etiquetas visibles resuelven a cadena real y a su superficie (unidades)", () => {
  for (const decl of catalogForUnits.lessons) {
    for (const key of decl.labels ?? []) {
      for (const lang of LANGS) {
        it(`etiqueta · ${decl.id} · ${key} · ${lang}`, () => {
          const resolved = dig(loadLocale(lang), key);
          expect(typeof resolved, `la etiqueta ${key} no resuelve en ${lang}`).toBe("string");
          expect((resolved as string).trim().length).toBeGreaterThan(0);
          const lesson = lessonText(lang, decl.id)!;
          const text = [lesson.title, lesson.what, ...lesson.steps, lesson.tip].join("\n");
          expect(text, `la lección ${decl.id} (${lang}) no usa la etiqueta ${key} en su letra servida`).toContain(resolved as string);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------
// Cobro 2 · Cada ejemplo hace lo que la guía promete, por el turno real
// ---------------------------------------------------------------------

import { productionTurnDeps, runTurn, type TurnResult } from "../turn/turnPipeline.js";
import { MODEL_CATALOG } from "../models/manifest.js";
import { buildToolHandlers } from "../agent/tools/handlers.js";
import { setDisabledTools } from "../agent/tools/toolPermissions.js";
import { PERSONALITIES } from "../constants/personalities.js";

const entry06 = MODEL_CATALOG.find((m) => m.id === "qwen3-0.6b-q4km")!;
const toolCalls: string[] = [];

function recordingHandlers(): Record<string, never> {
  const real = buildToolHandlers({ requestConfirm: async () => true });
  const wrapped: Record<string, unknown> = {};
  for (const [name, h] of Object.entries(real)) {
    wrapped[name] = async (args: unknown) => {
      toolCalls.push(name);
      return (h as (a: unknown) => Promise<unknown>)(args);
    };
  }
  return wrapped as Record<string, never>;
}

async function runExample(text: string, lang: Lang, opts: { tone?: boolean } = {}): Promise<TurnResult> {
  toolCalls.length = 0;
  const personality = PERSONALITIES.find((p) => p.id === (opts.tone ? "summary" : "succinct"))!;
  const deps = await productionTurnDeps({
    handlers: recordingHandlers(),
    packFacts: async () => ({ regions: [], facts: [] }),
    availableModels: [{ model: entry06, present: true }],
    fallbackModelId: entry06.id,
    ensureEmbeddings: async () => true,
    buildSemanticContext: async () => null,
    semanticDanger: async () => false,
    verifiedImportedPackIds: async () => new Set<string>(),
    onConfirmTool: async () => true,
  });
  return runTurn(
    { query: text, lang, systemPrompt: personality.systemPrompt, styleReminder: personality.styleReminder, history: [] },
    deps,
  );
}

// Las fixtures del corpus: trozos de las guías reales del Esencial,
// con su documento registrado para la vía literal.
function cprChunks(lang: Lang): ChunkFixture[] {
  const data: Record<Lang, { title: string; parts: string[] }> = {
    es: {
      title: "RCP (reanimación) en adultos y niños mayores",
      parts: [
        "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Comprueba si la persona responde: háblale fuerte y sacude sus hombros.\n- Si no responde, pide ayuda y llama al número de emergencias.",
        "Compresiones\n- Coloca el talón de una mano en el centro del pecho del adulto y la otra mano encima.\n- Comprime fuerte y rápido, de 100 a 120 compresiones por minuto, dejando que el pecho se recupere entre compresiones.",
        "Respiraciones (solo si sabes hacerlas)\n- Si sabes hacerlas, da 2 respiraciones tras cada 30 compresiones.\n- Si no sabes, sigue solo con las compresiones hasta que llegue ayuda.",
      ],
    },
    en: {
      title: "CPR (resuscitation) in adults and older children",
      parts: [
        "Before you start\n- Check that the place is safe.\n- Check whether the person responds: speak loudly and shake their shoulders.\n- If they do not respond, call for help and call the emergency number.",
        "Compressions\n- Place the heel of one hand in the center of the adult's chest and the other hand on top.\n- Push hard and fast, 100 to 120 compressions per minute, letting the chest recover between compressions.",
        "Breaths (only if you know how)\n- If you know how, give 2 breaths after every 30 compressions.\n- If you do not, keep going with compressions only until help arrives.",
      ],
    },
    pt: {
      title: "RCP (reanimação) em adultos e crianças maiores",
      parts: [
        "Antes de começar\n- Verifique se o local é seguro.\n- Verifique se a pessoa responde: fale alto e sacuda os ombros dela.\n- Se não responder, peça ajuda e ligue para o número de emergência.",
        "Compressões\n- Coloque a base de uma mão no centro do peito do adulto e a outra mão por cima.\n- Comprima forte e rápido, de 100 a 120 compressões por minuto, deixando o peito recuperar entre compressões.",
        "Respirações (só se souber fazer)\n- Se souber fazer, dê 2 respirações após cada 30 compressões.\n- Se não souber, continue só com as compressões até chegar ajuda.",
      ],
    },
  };
  const d = data[lang];
  return d.parts.map((body, i) => {
    const chunkId = `pack:nido-esencial-e5:${100 + i}`;
    registerDoc(chunkId, d.title, "NIDO Esencial", d.parts);
    return { chunkId, docId: chunkId, title: `${d.title} — ${body.split("\n")[0]}`, body, score: 1, rawScore: 0.92, matchType: "semantic" as const };
  });
}

function burnChunks(lang: Lang): ChunkFixture[] {
  const data: Record<Lang, { title: string; parts: string[] }> = {
    es: {
      title: "Quemaduras",
      parts: [
        "Qué hacer\n1. Enfría la quemadura con agua fresca corriente durante al menos 10 minutos.\n2. Quita anillos y ropa suelta cerca de la quemadura, sin despegar lo que esté pegado a la piel.\n3. Cubre la quemadura con un paño limpio y seco.",
        "Qué no hacer\n- No pongas hielo, mantequilla ni pasta de dientes sobre la quemadura.\n- No revientes las ampollas.",
      ],
    },
    en: {
      title: "Burns",
      parts: [
        "What to do\n1. Cool the burn with cool running water for at least 10 minutes.\n2. Remove rings and loose clothing near the burn, without pulling off anything stuck to the skin.\n3. Cover the burn with a clean, dry cloth.",
        "What not to do\n- Do not put ice, butter or toothpaste on the burn.\n- Do not burst blisters.",
      ],
    },
    pt: {
      title: "Queimaduras",
      parts: [
        "O que fazer\n1. Arrefece a queimadura com água fresca corrente durante pelo menos 10 minutos.\n2. Retira anéis e roupa solta perto da queimadura, sem descolar o que estiver colado à pele.\n3. Cobre a queimadura com um pano limpo e seco.",
        "O que não fazer\n- Não ponhas gelo, manteiga nem pasta de dentes sobre a queimadura.\n- Não rebentes as bolhas.",
      ],
    },
  };
  const d = data[lang];
  return d.parts.map((body, i) => {
    const chunkId = `pack:nido-esencial-e5:${200 + i}`;
    registerDoc(chunkId, d.title, "NIDO Esencial", d.parts);
    return { chunkId, docId: chunkId, title: `${d.title} — ${body.split("\n")[0]}`, body, score: 1, rawScore: 0.92, matchType: "semantic" as const };
  });
}

interface Decl {
  route: string | Partial<Record<Lang, string>>;
  tool?: string;
  corpus?: string;
  expectContains?: Partial<Record<Lang, string>>;
}

async function expectRoute(decl: Decl, lessonId: string, lang: Lang, text: string): Promise<void> {
  if (decl.corpus === "cpr") retrieval.chunks = cprChunks(lang);
  if (decl.corpus === "burn") retrieval.chunks = burnChunks(lang);
  if (decl.tool === "list_notes") {
    mem.notes.push({ id: "seed", title: "Nota del taller", body: "el taller cierra los lunes" });
  }
  const routeClass = typeof decl.route === "string" ? decl.route : decl.route[lang];
  const r = await runExample(text, lang, { tone: routeClass === "model-judged-tone" });
  const where = `${lessonId} (${lang}): «${text}»`;
  switch (routeClass) {
    case "canned":
      expect(r.route, where).toBe("canned");
      expect(facade.generate, where).not.toHaveBeenCalled();
      break;
    case "self-knowledge":
      expect(r.route, where).toBe("self-knowledge");
      break;
    case "model-judged":
      expect(r.route, where).toBe("model");
      expect(r.judgeMode, `${where} · el juez no corrió`).toBeDefined();
      break;
    case "model-judged-tone": {
      expect(r.route, where).toBe("model");
      const summary = PERSONALITIES.find((p) => p.id === "summary")!;
      expect(facade.lastPrompt ?? "", `${where} · el tono elegido no entró en la petición`).toContain(
        (summary.styleReminder ?? "").slice(0, 24),
      );
      break;
    }
    case "device-time":
      expect(r.route, where).toBe("agent-loop");
      expect(r.text, where).toMatch(/\d{1,2}:\d{2}/);
      break;
    case "calculate":
    case "convert-units":
      expect(r.route, where).toBe("agent-loop");
      expect(r.text, `${where} · la cifra servida no es la prometida`).toContain(decl.expectContains?.[lang] ?? "");
      break;
    case "tool":
      expect(r.route, where).toBe("agent-loop");
      // Las herramientas se ejecutan por dos caminos reales del
      // bucle: `save_note` y `list_notes` pasan por el registro de
      // handlers (y el espía las ve), mientras `create_reminder` y
      // `remember_fact` escriben por la vía rápida determinista,
      // directa al almacén. Para las primeras se cobra la llamada;
      // para todas, el estado guardado, que es lo que la lección
      // promete.
      if (decl.tool === "save_note" || decl.tool === "list_notes") {
        expect(toolCalls, `${where} · la herramienta ejecutada no es la declarada`).toContain(decl.tool);
      }
      if (decl.tool === "create_reminder") expect(mem.reminders.length, where).toBeGreaterThan(0);
      if (decl.tool === "save_note") expect(mem.notes.length, where).toBeGreaterThan(0);
      if (decl.tool === "remember_fact") expect(mem.facts.length, where).toBeGreaterThan(0);
      if (decl.tool === "list_notes") expect(r.text, where).toMatch(/taller|oficina|workshop/i);
      break;
    case "agent-loop":
      expect(r.route, where).toBe("agent-loop");
      break;
    case "guide-literal":
      expect(r.route, where).toBe("guide-literal");
      expect(r.sources.length, `${where} · la respuesta no trae su fuente`).toBeGreaterThan(0);
      expect(r.evidence, `${where} · sin tarjeta de evidencia`).not.toBeNull();
      break;
    case "semantic-judged":
      expect(r.sources.length, `${where} · la respuesta no trae procedencia`).toBeGreaterThan(0);
      expect(r.evidence, `${where} · sin tarjeta de evidencia`).not.toBeNull();
      expect(["guide-literal", "model"], where).toContain(r.route);
      break;
    case "abstention":
      expect(r.sources.length, `${where} · sirvió una fuente inventada`).toBe(0);
      expect(r.route, where).toBe("model");
      break;
    default:
      throw new Error(`clase de ruta no conocida en el catálogo: ${decl.route}`);
  }
}

describe("cobro 2 · cada ejemplo toma la ruta declarada, por el turno real (unidades)", () => {
  for (const lesson of catalogForUnits.lessons) {
    for (const [i, decl] of lesson.examples.entries()) {
      for (const lang of LANGS) {
        it(`ruta · ${lesson.id} · ejemplo ${i} · ${lang}`, async () => {
          const text = lessonText(lang, lesson.id)!.examples[i];
          await expectRoute(decl as Decl, lesson.id, lang, text);
        });
      }
    }
  }
  for (const [i, decl] of catalogForUnits.welcome.entries()) {
    for (const lang of LANGS) {
      it(`ruta · bienvenida · ejemplo ${i} · ${lang}`, async () => {
        const text = welcomePrompts(lang)[i];
        expect(text, `la bienvenida no sirve su ejemplo ${i} en ${lang}`).toBeTruthy();
        await expectRoute(decl as Decl, "bienvenida", lang, text);
      });
    }
  }

  it("guarda de sincronía: el orden del turno y su unión de rutas, en su forma conocida", () => {
    const src = readFileSync(join(ROOT, "src", "turn", "turnPipeline.ts"), "utf8");
    const steps = [
      "1. Las respuestas fijas de seguridad",
      "2. La identidad de la casa",
      "3. Los hechos de los packs",
      "4. La bifurcación del agente",
      "5. La puerta antes de la bifurcación",
      "6. La guía literal",
      "7. La puerta previa sin fuentes",
      "8. El presupuesto de contexto",
      "9. La generación por el ejecutor",
      "10. El juez",
      "11. Los post-chequeos",
      "12. La tarjeta de evidencia",
    ];
    let at = -1;
    for (const step of steps) {
      const next = src.indexOf(step, at + 1);
      expect(next, `el paso «${step}» no está en su sitio en turnPipeline.ts`).toBeGreaterThan(at);
      at = next;
    }
    const union = src.match(/export type TurnRoute =([^;]+);/);
    expect(union).not.toBeNull();
    const members = [...union![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(members).toEqual(
      [
        "agent-loop",
        "canned",
        "emergency-situation",
        "guide-coherence",
        "guide-forced",
        "guide-literal",
        "health-gate",
        "model",
        "model-safe-substituted",
        "pack-facts",
        "safe-text",
        "safety",
        "self-knowledge",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------
// Cobro 4 (segunda mitad): con la herramienta apagada, la función no
// se ejecuta; y el catálogo no declara dependencias imposibles en PC.
// ---------------------------------------------------------------------

describe("cobro 4 · honestidad de herramientas apagadas", () => {
  it("con create_reminder apagada, el ejemplo de la lección 04 no guarda ningún recordatorio", async () => {
    const catalog = await loadCatalog();
    const lesson = catalog.lessons.find((l) => l.id === "recordatorios-notas-y-memoria")!;
    const idx = lesson.examples.findIndex((e) => (e as Decl).tool === "create_reminder");
    expect(idx).toBeGreaterThanOrEqual(0);
    setDisabledTools(["create_reminder"]);
    try {
      const r = await runExample(lessonText("es", lesson.id)!.examples[idx], "es");
      // Lo cobrado es la no ejecución: ni la llamada ni el estado.
      // La ruta puede seguir siendo el bucle (es donde el turno
      // sirve su respuesta honesta sin la herramienta); prometer
      // otra ruta sería cobrar una forma que el producto no tiene.
      void r;
      expect(toolCalls).not.toContain("create_reminder");
      expect(mem.reminders.length).toBe(0);
    } finally {
      setDisabledTools([]);
    }
  });

  it("ninguna lección declara dependencia de una herramienta que PC no tiene", async () => {
    const catalog = await loadCatalog();
    const { LOCAL_TOOLS } = await import("../agent/tools/manifest.js");
    const existing = new Set(LOCAL_TOOLS.map((t) => t.name));
    for (const lesson of catalog.lessons) {
      for (const tool of lesson.tools ?? []) {
        expect(existing.has(tool), `la lección ${lesson.id} depende de «${tool}», que no existe en PC`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------
// Cobro 3 · El ejemplo se escribe en el compositor y nunca se envía
// ---------------------------------------------------------------------

describe("cobro 3 · el ejemplo se escribe, nunca se envía", () => {
  it("la costura del toque devuelve escribir sin enviar, para cada ejemplo del catálogo", async () => {
    const { exampleTap } = await import("./exampleTap.js");
    const catalog = await loadCatalog();
    for (const lesson of catalog.lessons) {
      for (const [i] of lesson.examples.entries()) {
        for (const lang of LANGS) {
          const text = lessonText(lang, lesson.id)!.examples[i];
          const outcome = exampleTap(text);
          expect(outcome.send, `${lesson.id} (${lang}) enviaría solo`).toBe(false);
          expect(outcome.navigateTo).toBe("chat");
          expect(outcome.composerText).toBe(text);
        }
      }
    }
  });

  it("la superficie cablea el toque por la costura y ese camino no llama a turnSend", () => {
    const app = readFileSync(join(ROOT, "app", "src", "App", "App.tsx"), "utf8");
    expect(app).toContain("exampleTap(");
    const at = app.indexOf("onGuideExample");
    expect(at, "App.tsx no trae el camino del ejemplo de la guía").toBeGreaterThanOrEqual(0);
    const body = app.slice(at, at + 600);
    expect(body).toContain("exampleTap(");
    expect(body, "el camino del ejemplo de la guía envía el turno").not.toContain("turnSend");
  });
});

// ---------------------------------------------------------------------
// Cobro 6 · Progreso: las marcas persisten y perderlas no rompe nada
// ---------------------------------------------------------------------

describe("cobro 6 · progreso en los ajustes", () => {
  it("el camino servido existe: el arranque trae las marcas y el canal de marcar está en la carcasa", () => {
    const services = readFileSync(join(ROOT, "app", "electron", "services.ts"), "utf8");
    const preload = readFileSync(join(ROOT, "app", "electron", "preload.ts"), "utf8");
    expect(services).toContain("nido:guide-mark");
    expect(services).toContain("guideVisited");
    expect(preload).toContain("guideMark");
  });

  it("las marcas se guardan, se leen de vuelta y su pérdida no rompe nada", async () => {
    const settings = await import("../models/settings.js");
    fsWorld.files.clear();
    await settings.markGuideVisited("empezar.hablar-con-nido");
    await settings.markGuideVisited("empezar.elegir-modelo");
    await settings.markGuideVisited("empezar.hablar-con-nido");
    expect(await settings.getGuideVisited()).toEqual(["empezar.hablar-con-nido", "empezar.elegir-modelo"]);
    // Perder las marcas (el fichero desaparece) no rompe: se lee
    // vacío y se puede volver a marcar.
    fsWorld.files.clear();
    expect(await settings.getGuideVisited()).toEqual([]);
    await settings.markGuideVisited("empezar.hablar-con-nido");
    expect(await settings.getGuideVisited()).toEqual(["empezar.hablar-con-nido"]);
  });

  it("el tope de 200 marcas se cobra en su forma", async () => {
    const settings = await import("../models/settings.js");
    fsWorld.files.clear();
    for (let i = 0; i < 205; i++) await settings.markGuideVisited(`m.l${i}`);
    const visited = await settings.getGuideVisited();
    expect(visited.length).toBe(200);
    expect(visited[0]).toBe("m.l5");
  });
});
