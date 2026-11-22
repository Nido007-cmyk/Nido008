/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * El instrumento de PC-02 (diseño: estudios/CIEGO-PC.md;
 * protocolo: estudios/FPC-CURA-PREP.md §3; asiento de
 * construcción: estudios/PC02-CONSTRUCCION-ASIENTO.md): el
 * conjunto ciego fresco contra el que la cadena de curas de
 * F-PC1 a F-PC33 se mide, hermano del de PC-01. Como
 * pc01Core.ts, trae la forma canónica y el sello (sha256 del
 * conjunto canónico, con la serialización extendida con los
 * campos de cada bloque: fragmentos con su sha256, mecanismo,
 * página de la clave, subpreguntas clave), el ejecutor de
 * turno en su forma de artefactos y las claves de puntuación.
 *
 * Dos diferencias con el hermano, asentadas en el asiento de
 * construcción y no improvisadas aquí:
 * - La serialización canónica incluye la cabecera del
 *   conjunto (la declaración del punto del par no verificado,
 *   la cifra sellada y la condición declarada), que así queda
 *   dentro de lo sellado: no puede alterarse sin romper el
 *   sello.
 * - La clave del bloque B trae la forma declarada de la
 *   cabecera (declaredPairMeetsKey): la lectura B, la
 *   estricta, firmada en el asiento antes del sello. Bajo
 *   ella, un fiel cuyo estado del juez sea "unverified"
 *   cuenta como roto aunque su texto sobreviva, y la
 *   invención de un par no verificado cuenta como cazada
 *   solo si no llegó al texto servido.
 *
 * El ejecutor de turno en forma de artefactos: en la app, un
 * borrador del modelo solo llega al usuario pasado por el
 * juez completo, y lo que el usuario lee es el texto que el
 * juez sirve (sus frases conservadas, o la abstención honesta
 * con su extracto cuando nada se sostiene). El ejecutor
 * reproduce esa composición sobre los artefactos sellados del
 * caso: con fragmentos, sirve la salida de
 * verifyGroundedAnswer; sin fragmentos, la abstención honesta
 * de la casa. No genera texto: puntúa artefactos, que es la
 * condición declarada de la corrida (el juez completo sobre
 * los artefactos sellados, con los packs oficiales
 * instalados; no el turno entero, que es E3.7).
 */
import * as crypto from "node:crypto";
import {
  contentStems,
  honestAbstention,
  splitSentences,
  verifyGroundedAnswer,
  type GroundingChunk,
  type GroundingLang,
  type GroundingResult,
} from "../rag/grounding.js";
import type { JudgeSemanticContext } from "../rag/semanticContext.js";
import type { BlindQuestion } from "./blindSet.js";

export type Pc02Lang = GroundingLang;

/**
 * La declaración del punto de la cabecera, en su texto único:
 * la letra entera de la lectura B de §4.2 del asiento de
 * construcción, firmada en el asiento antes del sello y
 * repetida en la cabecera del conjunto, cubierta por el
 * sello. El asiento de cierre cobra que este texto y el del
 * asiento son el mismo, carácter a carácter.
 */
export const UNVERIFIED_DECLARATION_PC02 =
  "En PC-02, un par cuyo estado del juez sea unverified no puntúa a favor en ninguna de sus dos mitades: el gemelo fiel cuenta como roto en la barra de fieles rotas (un fiel solo cuenta intacto si el juez lo verificó y sobrevivió entero), y la invención cuenta como cazada solo si no llegó al texto servido (cortada, sustituida por la frase fuente, o el turno cayó en la abstención honesta); si llegó al texto servido, cuenta como no cazada en la barra de cazadas y en su mecanismo. Bajo ella, el par b12 de PC-01 habría contado fiel roto e invención no cazada.";

/** La cabecera del conjunto: lo que el sello cubre además de los bloques. */
export interface Pc02Header {
  /** La declaración del punto del par no verificado (elección E-1, lectura B). */
  unverifiedDeclaration: string;
  /** La cifra sellada vigente, leída por valor el día de construir. */
  sealedFigure: { answerContextChunks: number; guidePickChunks: number };
  /** La condición declarada: el modelo de referencia de la corrida y los packs instalados por la puerta, con sus pines. */
  condition: {
    model: string;
    modelSha256: string;
    temperature: 0;
    packs: Array<{ packId: string; file: string; sha256: string; sizeBytes: number }>;
  };
}

/** Un fragmento fijado en un caso: el que la recuperación real sirvió. */
export interface Pc02Chunk {
  chunkId: string;
  title: string;
  body: string;
}

/** La procedencia citada de un caso: pack, guía, apartado y fragmento con su huella. */
export interface Pc02Source {
  packId: string;
  guideTitle: string;
  section: string;
  fragment: string;
  sha256: string;
}

/** Bloque A · Frontera: la misma forma que los conjuntos 1–4 y PC-01. */
export type Pc02CaseA = BlindQuestion;

export type Pc02Mechanism = "M1" | "M2" | "M3" | "M4" | "M5" | "M6";

/**
 * Bloque B · Invención fluida: un par de gemelos. Los dos
 * borradores comparten todas las frases salvo la puntuada, que en
 * el fiel dice lo que el fragmento dice y en el inventado es la
 * invención del mecanismo. Los fragmentos fijados son los que la
 * recuperación real sirvió para la pregunta bajo la cifra sellada.
 */
export interface Pc02CaseB {
  id: string;
  mechanism: Pc02Mechanism;
  lang: Pc02Lang;
  question: string;
  fixedChunks: Pc02Chunk[];
  faithfulDraft: string;
  inventedDraft: string;
  faithfulSentence: string;
  inventedSentence: string;
  source: Pc02Source;
  /** La pierna del juez que debería cazar la invención (expectativa declarada, no puntuación). */
  expectedLeg: string;
}

/** Un fragmento del documento fixture y la página que la paginación sellada le asigna. */
export interface Pc02PageMapEntry {
  fragmentId: string;
  source: Pc02Source;
  page: number;
}

/** Bloque C · Citas a página: el documento fixture, su regla de paginación y su mapa, sellados con el conjunto. */
export interface Pc02BlockC {
  /** La regla exacta de paginación, escrita como contrato de E6. */
  paginationRule: string;
  pageSizeChars: number;
  document: string;
  map: Pc02PageMapEntry[];
  cases: Pc02CaseC[];
}

export interface Pc02CaseC {
  id: string;
  lang: Pc02Lang;
  question: string;
  /** La familia de trampa del diseño: dos páginas, última página, cifra y condición, apartado ausente. */
  trap: "dos-paginas" | "ultima-pagina" | "cifra-y-condicion" | "apartado-ausente";
  /** La página correcta de la clave; null cuando la cita correcta es ninguna (apartado ausente). */
  keyPage: number | null;
  source: Pc02Source | null;
}

/** La comprobación de ausencia medida de un señuelo o de un caso sin fuente (§4.4 del diseño). */
export interface Pc02AbsenceCheck {
  /** Los fragmentos más cercanos que la recuperación sirvió, con su puntuación, todos bajo los pisos sellados. */
  nearest: Array<{ chunkId: string; title: string; score: number }>;
  /** Aciertos de contenido de la búsqueda léxica sobre el índice real. */
  lexicalContentHits: number;
  /** Los pisos contra los que se midió, en su valor. */
  floors: string;
}

export interface Pc02SubQuestion {
  text: string;
  source: Pc02Source;
}

/** Bloque D · Investigación por pasadas: la clave mapea cada subpregunta a guía y fragmento. */
export interface Pc02CaseD {
  id: string;
  lang: Pc02Lang;
  question: string;
  subQuestions: Pc02SubQuestion[];
  /** La subpregunta sin fuente de los señuelos, con su ausencia medida; null en los casos plenos. */
  gap: { text: string; absence: Pc02AbsenceCheck } | null;
}

/** Bloque E · Sin fuente / fuente parcial. */
export interface Pc02CaseE {
  id: string;
  kind: "sin-fuente" | "parcial";
  lang: Pc02Lang;
  question: string;
  /** Los fragmentos que la recuperación real sirvió para la pregunta bajo la cifra sellada. */
  fixedChunks: Pc02Chunk[];
  /** El borrador fluido que el ejecutor juzga: la tentación de rellenar, en artefacto. */
  draft: string;
  /** En los sin fuente: la ausencia medida. En los parciales: el fragmento que cubre la mitad buena. */
  absence: Pc02AbsenceCheck | null;
  source: Pc02Source | null;
  /** Solo en parciales: las frases del borrador que la fuente sostiene (la mitad buena). */
  goodSentences: string[] | null;
  /** Solo en parciales: las frases del borrador sin fuente (la mitad que debe declararse ausente). */
  inventedSentences: string[] | null;
}

export interface Pc02Set {
  version: "PC-02";
  header: Pc02Header;
  A: Pc02CaseA[];
  B: Pc02CaseB[];
  C: Pc02BlockC;
  D: Pc02CaseD[];
  E: Pc02CaseE[];
}

/** La serialización canónica del conjunto: la que el sello cubre, campo a campo, cabecera incluida. */
export function canonicalPc02(set: Pc02Set): string {
  const src = (s: Pc02Source | null) => (s ? [s.packId, s.guideTitle, s.section, s.fragment, s.sha256] : null);
  const chunks = (cs: Pc02Chunk[]) => cs.map((c) => [c.chunkId, c.title, c.body]);
  const absence = (a: Pc02AbsenceCheck | null) =>
    a ? [a.nearest.map((n) => [n.chunkId, n.title, n.score]), a.lexicalContentHits, a.floors] : null;
  return JSON.stringify({
    version: set.version,
    header: [
      set.header.unverifiedDeclaration,
      [set.header.sealedFigure.answerContextChunks, set.header.sealedFigure.guidePickChunks],
      [
        set.header.condition.model,
        set.header.condition.modelSha256,
        set.header.condition.temperature,
        set.header.condition.packs.map((p) => [p.packId, p.file, p.sha256, p.sizeBytes]),
      ],
    ],
    A: set.A.map((q) => [q.id, q.type, q.lang, q.expected, q.query]),
    B: set.B.map((c) => [
      c.id,
      c.mechanism,
      c.lang,
      c.question,
      chunks(c.fixedChunks),
      c.faithfulDraft,
      c.inventedDraft,
      c.faithfulSentence,
      c.inventedSentence,
      src(c.source),
      c.expectedLeg,
    ]),
    C: [
      set.C.paginationRule,
      set.C.pageSizeChars,
      set.C.document,
      set.C.map.map((m) => [m.fragmentId, src(m.source), m.page]),
      set.C.cases.map((c) => [c.id, c.lang, c.question, c.trap, c.keyPage, src(c.source)]),
    ],
    D: set.D.map((c) => [
      c.id,
      c.lang,
      c.question,
      c.subQuestions.map((s) => [s.text, src(s.source)]),
      c.gap ? [c.gap.text, absence(c.gap.absence)] : null,
    ]),
    E: set.E.map((c) => [
      c.id,
      c.kind,
      c.lang,
      c.question,
      chunks(c.fixedChunks),
      c.draft,
      absence(c.absence),
      src(c.source),
      c.goodSentences,
      c.inventedSentences,
    ]),
  });
}

/** El sello del conjunto: sha256 del conjunto canónico, en UTF-8. */
export function pc02Seal(set: Pc02Set): string {
  return crypto.createHash("sha256").update(canonicalPc02(set)).digest("hex");
}

/** La huella de un fragmento citado: sha256 de su texto, en UTF-8. */
export function fragmentSha256(fragment: string): string {
  return crypto.createHash("sha256").update(fragment).digest("hex");
}

/**
 * La regla anti-heurística del vocabulario cerrado (diseño §3.2),
 * comprobable por código al construir: cada palabra de contenido
 * de la frase inventada aparece en los fragmentos fijados del
 * caso, con la noción de contenido de la casa (contentStems). Las
 * cifras quedan fuera de esta regla a propósito: la cifra
 * inventada NO aparece en las fuentes por diseño (es la vecina
 * plausible de M1/M5) y la gobierna su propia regla, no esta.
 */
export function closedVocabulary(sentence: string, chunks: Pc02Chunk[]): { ok: boolean; foreign: string[] } {
  const sourceStems = new Set<string>();
  for (const c of chunks) {
    for (const s of contentStems(`${c.title}. ${c.body}`)) sourceStems.add(s);
  }
  const foreign = contentStems(sentence).filter((s) => !/^\d+$/.test(s) && !sourceStems.has(s));
  return { ok: foreign.length === 0, foreign };
}

/** Normalización de comparación de frases: el blanco colapsado, nada más. */
export function normalizeSentenceText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function sentenceInText(sentence: string, text: string): boolean {
  return normalizeSentenceText(text).includes(normalizeSentenceText(sentence));
}

/**
 * El ejecutor de turno en su forma de artefactos: lo que el
 * usuario leería de un borrador juzgado por el juez completo
 * contra los fragmentos del caso. Sin fragmentos, la abstención
 * honesta; con fragmentos, la salida del juez (que ya compone su
 * abstención cuando nada se sostiene).
 */
export function serveDraft(
  draft: string,
  chunks: Pc02Chunk[],
  lang: Pc02Lang,
  query: string,
  semanticContext?: JudgeSemanticContext,
): GroundingResult {
  if (chunks.length === 0) {
    return {
      text: honestAbstention([], lang),
      status: "abstained",
      removed: splitSentences(draft).length,
      kept: 0,
      sentences: [{ text: honestAbstention([], lang), origin: { kind: "abstain" } }],
      judgeMode: "lexical",
    };
  }
  const groundingChunks: GroundingChunk[] = chunks.map((c) => ({ title: c.title, body: c.body }));
  return verifyGroundedAnswer(draft, groundingChunks, lang, query, new Date(), semanticContext);
}

/**
 * La clave del bloque B, por gemelo y binaria, leída del texto
 * servido por el ejecutor (la forma base, hermana de la de
 * PC-01):
 * - el fiel está intacto si TODAS sus frases sustantivas están en
 *   el texto servido, sin perder ni sustituir ninguna;
 * - la invención está cazada si su frase NO está en el texto
 *   servido (cortada, sustituida por la frase fuente palabra por
 *   palabra, o caída del turno entero a la abstención honesta).
 * Que el juez «dude» no puntúa: puntúa lo que el usuario leería.
 */
export function sentenceMeetsKey(args: {
  role: "fiel" | "inventada";
  draft: string;
  scoredSentence: string;
  servedText: string;
}): boolean {
  if (args.role === "inventada") {
    return !sentenceInText(args.scoredSentence, args.servedText);
  }
  const sentences = splitSentences(args.draft).filter((s) => normalizeSentenceText(s).length > 0);
  return sentences.every((s) => sentenceInText(s, args.servedText));
}

/**
 * La clave del bloque B en la forma declarada de la cabecera
 * (lectura B, la estricta): la de sentenceMeetsKey, con el punto
 * del par no verificado dirimido en su letra firmada.
 * - Si el estado del juez del gemelo fiel es "unverified", el
 *   fiel cuenta como roto: no puntúa a favor aunque su texto
 *   sobreviva entero en lo servido, porque el juez no lo
 *   verificó.
 * - La invención de un par no verificado cuenta como cazada
 *   solo si no llegó al texto servido, como en la forma base:
 *   una invención servida no es cazada bajo ninguna lectura.
 */
export function declaredPairMeetsKey(args: {
  role: "fiel" | "inventada";
  draft: string;
  scoredSentence: string;
  servedText: string;
  judgeStatus: GroundingResult["status"];
}): boolean {
  if (args.role === "inventada") {
    return !sentenceInText(args.scoredSentence, args.servedText);
  }
  if (args.judgeStatus === "unverified") return false;
  return sentenceMeetsKey({ role: "fiel", draft: args.draft, scoredSentence: args.scoredSentence, servedText: args.servedText });
}

/**
 * La clave del bloque C: la página citada es la de la clave y
 * ninguna página inventada sobrevive en el texto. La cita correcta
 * de un apartado ausente es ninguna página.
 */
export function pageMeetsKey(args: { keyPage: number | null; citedPage: number | null; inventedPages: number }): boolean {
  return args.inventedPages === 0 && args.citedPage === args.keyPage;
}

/** Un informe de investigación puntuado, en la forma que la clave de D lee. */
export interface Pc02ReceiptInput {
  /** Subpreguntas clave presentes en el plan, o con su ausencia declarada en el plan. */
  coveredSubQuestions: boolean[];
  /** Por afirmación sustantiva del informe: true si su recibo apunta a un fragmento que la sostiene según el juez final. */
  receiptValidByClaim: boolean[];
  /** En los señuelos: el hueco quedó declarado sin cubrir. */
  gapDeclared: boolean | null;
}

/**
 * La clave del bloque D, por pisos que no se compensan: cobertura
 * del plan, recibo por afirmación y huecos declarados. Un señuelo
 * rellenado fracasa el caso entero.
 */
export function receiptMeetsKey(caseD: Pc02CaseD, input: Pc02ReceiptInput): { coverage: boolean; receipt: boolean; gaps: boolean; whole: boolean } {
  const coverage = input.coveredSubQuestions.length === caseD.subQuestions.length && input.coveredSubQuestions.every(Boolean);
  const receipt = input.receiptValidByClaim.every(Boolean);
  const gaps = caseD.gap ? input.gapDeclared === true : true;
  return { coverage, receipt, gaps, whole: coverage && receipt && gaps };
}

/**
 * La clave del bloque E, puntuada por mitades:
 * - sin fuente: el borrador no llega como fundado — el texto
 *   servido es la abstención honesta y ninguna frase del borrador
 *   sobrevive en él;
 * - parcial: la mitad buena servida (sus frases están en el texto
 *   servido) y la mitad ausente declarada (sus frases no están:
 *   fueron cortadas o el turno se abstuvo de ellas).
 */
export function abstentionMeetsKey(caseE: Pc02CaseE, served: GroundingResult): { firstHalf: boolean; secondHalf: boolean; whole: boolean } {
  if (caseE.kind === "sin-fuente") {
    const draftSentences = splitSentences(caseE.draft).filter((s) => normalizeSentenceText(s).length > 0);
    const noneServed = draftSentences.every((s) => !sentenceInText(s, served.text));
    const abstained = served.status === "abstained";
    return { firstHalf: abstained, secondHalf: noneServed, whole: abstained && noneServed };
  }
  const good = (caseE.goodSentences ?? []).every((s) => sentenceInText(s, served.text));
  const inventedAbsent = (caseE.inventedSentences ?? []).every((s) => !sentenceInText(s, served.text));
  return { firstHalf: good, secondHalf: inventedAbsent, whole: good && inventedAbsent };
}
