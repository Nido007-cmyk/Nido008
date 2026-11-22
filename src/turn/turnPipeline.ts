/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * turnPipeline.ts — el pipeline del turno entero de NIDO PC
 * (tanda 14). Es la composición, en el orden firmado por
 * PUERTAS-TURNO §2 y la listeza de la tanda, de las piezas que el
 * árbol ya trae portadas del móvil; ninguna regla nace aquí: este
 * módulo pone cada pieza en su sitio del turno y devuelve a la
 * superficie todo lo que ella enseña (texto servido, fuentes,
 * tarjeta de evidencia, modo del juez, nota de contexto).
 *
 * El orden del turno:
 *   1. Las respuestas fijas de seguridad (`matchSafetyAnswer`)
 *      con su orden interno sellado (autolesión primero, antes
 *      del tope de longitud; monóxido después): sirven sin
 *      modelo, sin recuperación y sin puertas posteriores. Su
 *      clase del número queda en espera hasta el paso 3: el
 *      número que sirve es el de los packs si un pack respondió,
 *      y el de la tabla solo como respaldo (así lo compone
 *      ChatScreen: «número de los packs si ningún pack
 *      respondió»). Los escalones de situación y de salud de la
 *      escalera de precedencia no sirven aquí: su sede en el
 *      turno de la app es la puerta sin fuentes del paso 7 (con
 *      guía, la guía manda; sin fuentes, el texto seguro), y el
 *      escalón de hechos no abstiene (ley del dueño de
 *      2026-11-09, 0.1.90: la pregunta de hechos sin peligro
 *      genera).
 *   2. La identidad de la casa (`answerKnowledgeQuery`) y la
 *      charla fija (`matchCanned`): sin modelo.
 *   3. Los hechos de los packs (`composeFactsAnswer`), leídos
 *      frescos en cada turno por el proveedor inyectado; si
 *      ningún pack respondió y la clase del número quedó en
 *      espera, sirve el texto de la tabla de seguridad.
 *   4. La bifurcación del agente: clasificación determinista
 *      (`classifyIntent`) y sonda de memoria; si la puerta abre,
 *      el bucle (`runAgentLoop`) sirve el turno con el adaptador
 *      de producción y los handlers reales, con la confirmación
 *      de política construida por `describePolicyConfirmation`
 *      (cláusula H-3: el diálogo del turno nace de esa pieza,
 *      sobre la decisión de política, en el idioma del turno).
 *   5. La puerta antes de la bifurcación (segunda red, mitad del
 *      turno): `gatePreemptsDeepResearch` decide si el modo de
 *      investigación de este turno queda preemptado y el turno
 *      cae a la ruta protegida con los post-chequeos activos; el
 *      conmutador de la persona no se toca (la decisión es por
 *      turno). La mitad del orquestador es de E10: aquí no se
 *      monta orquestador alguno, ni provisional.
 *   6. La guía literal (`answerFromGuide`): recupera una vez y,
 *      si una guía es la mejor clara, sirve su texto palabra por
 *      palabra; la recuperación se reutiliza en lo que sigue.
 *   7. La puerta previa sin fuentes: la lista léxica primero
 *      (`isHealthQuestion` || `isEmergencySituation`); la capa
 *      por significado solo si la lista no cerró y no hay
 *      fuentes; `noSourcesOutcome` decide: texto seguro servido
 *      SIN cargar el modelo de generación, o generar.
 *   8. El presupuesto de contexto verificado (`applyContextBudget`
 *      con el conteo real del motor residente): la conversación
 *      que se genera es la presupuestada, y su cifra alimenta la
 *      nota de contexto P-2 (el cruce del 80 % y el de turnos
 *      dejados, contados aquí; la superficie decide la nota).
 *   9. La generación por el ejecutor (`planRoute` +
 *      `executeRoutingPlan`): elige plan, no juzga.
 *  10. El juez (`verifyGroundedAnswer`) con el contexto semántico
 *      construido en su forma firmada (cláusula H-1): tras
 *      generar, en el mismo bloque que juzga, con el texto final
 *      y los fragmentos que el juez va a mirar; antes de juzgar,
 *      el cableado garantiza la residencia del e5
 *      (`embeddingEngine.ensureLoaded`) y el constructor, que
 *      nunca carga el motor, devuelve el contexto o null; el
 *      resultado (o undefined) entra como ÚLTIMO argumento del
 *      juez. Sin e5 residente, el juez juzga en su modo léxico
 *      válido y el turno responde igual. La descarga por
 *      inactividad del e5 se decide con `embeddingIdleUnloadDue`
 *      en `maybeUnloadEmbeddings` (cláusula H-1/E-1), que la
 *      carcasa invoca en su pulso.
 *  11. Los post-chequeos (solo si el turno no fue de
 *      investigación servida): primero el de sin fuentes
 *      (`noSourcesOutcome` con la misma unión lista/significado)
 *      y después la sustitución con fuentes
 *      (`shouldSubstituteSafeText` con el veredicto, la
 *      procedencia frase a frase y los packs importados
 *      verificados leídos frescos este turno).
 *  12. La tarjeta de evidencia (`buildEvidenceCard`) sobre las
 *      fuentes servidas, con la fuente coronada por el juez
 *      cuando la hay; con texto fijo servido, sin tarjeta.
 *
 * El resumen de la conversación crecida lo produce el llamador
 * con `summarizeConversation` sobre la misma costura del motor
 * (E-6) y lo persiste sobre el almacén de E2: es pieza del
 * registro de integración, no de este orden.
 */

import { existsSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import { runAgentLoop, type AgentEngine, type AgentLoopOptions } from "../agent/loop/agentLoop.js";
import { matchCanned } from "../agent/loop/cannedResponses.js";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers.js";
import {
  applyContextBudget,
  budgetConfigFor,
  type BudgetMessage,
} from "../agent/loop/contextBudget.js";
import { classifyIntent } from "../agent/loop/intent.js";
import { isGenericMemoryQuestionShape, memoryGateHit, type MemoryQueryData } from "../agent/loop/memoryQuery.js";
import { extractRememberFact } from "../agent/loop/rememberRouter.js";
import { describePolicyConfirmation } from "../agent/policy/confirmText.js";
import type { PolicyDecision } from "../agent/policy/policyEngine.js";
import type { ToolHandler } from "../agent/tools/dispatcher.js";
import { productionAgentEngine } from "../inference/agentEngine.js";
import { llamaEngine, llamaModelsDir } from "../inference/LlamaEngine.js";
import { MODEL_CATALOG } from "../models/manifest.js";
import {
  getActiveModelId,
  getModelRoleAssignments,
  getRoutingPreset,
} from "../models/settings.js";
import { embeddingEngine } from "../rag/embed.js";
import { embeddingIdleUnloadDue } from "../rag/embedPolicy.js";
import { buildEvidenceCard, type EvidenceCardData } from "../rag/evidenceCard.js";
import { verifyGroundedAnswer, type GroundingChunk, type GroundingResult } from "../rag/grounding.js";
import { answerFromGuide, answerFromGuideKey, coherenceSubstitute, type GuideAnswer } from "../rag/guideAnswerRun.js";
import {
  composeFactsAnswer,
  type PackFact,
  type PackRegion,
} from "../rag/packFacts.js";
import { contextualizeQuery } from "../rag/pure.js";
import type { RetrievedChunk } from "../rag/retrieve.types.js";
import { buildJudgeSemanticContext, type JudgeSemanticContext } from "../rag/semanticContext.js";
import { answerKnowledgeQuery } from "../rag/selfKnowledge.js";
import { semanticDanger } from "../services/semanticDanger.js";
import { verifiedImportedPacks } from "../services/packImporter.js";
import {
  gatePreemptsDeepResearch,
  healthSafeText,
  isEmergencySituation,
  isHealthQuestion,
  noSourcesOutcome,
  shouldSubstituteSafeText,
} from "../routing/emergencyGate.js";
import { executeRoutingPlan, type ExecutableModel } from "../routing/executor.js";
import { buildModelProfiles, type AvailableModel } from "../routing/profiles.js";
import { planRoute } from "../routing/router.js";
import type { ModelRole, RoutingPreset, TaskType } from "../routing/types.js";

export type TurnLang = "es" | "en" | "pt";

export interface TurnHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TurnInput {
  query: string;
  lang: TurnLang;
  /** El prompt de sistema vigente (persona + tono de Ajustes). */
  systemPrompt: string;
  /**
   * El recordatorio de estilo del tono elegido
   * (Personality.styleReminder): el ejecutor lo cose junto a la
   * pregunta, que es donde el modelo pequeño lo sigue. Sin este
   * hilo, el tono de Ajustes persistía sin gobernar ninguna
   * respuesta (la otra mitad de A-4, tanda 14).
   */
  styleReminder?: string;
  /** Turnos recientes en claro, del más antiguo al más nuevo. */
  history?: TurnHistoryTurn[];
  /** Resumen condensado de los turnos viejos, si la conversación lo tiene. */
  summary?: string | null;
  /** El modo de investigación de la persona para ESTE turno. */
  researchMode?: boolean;
  /**
   * La clave de la guía que el llamante ya eligió (los botones
   * de Emergencia, que saben su tema): si resuelve en el pack
   * instalado, el turno sirve esa guía literal por la ruta
   * `guide-forced`, sin pasar por la elección. Sin clave, o con
   * una clave que no resuelve, el turno es el de siempre.
   */
  guideKey?: string;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
  /**
   * C-4 del cableado de chat: el aviso de fase del turno.
   * Hoy declara una sola fase, «searching», emitida una
   * vez al entrar en el bloque de recuperación (paso 6),
   * antes del presupuesto y de la generación: es el único
   * sitio de emisión, y todo turno que llega a generación
   * lo atraviesa (los que vuelven antes — rutas fijas,
   * guía forzada, la bifurcación del agente — no hacen
   * recuperación de fuentes y nunca lo emiten). Opcional:
   * sin el gancho, el turno corre idéntico.
   */
  onPhase?: (phase: "searching") => void;
  /** La fecha del turno (el juez juzga las fechas contra ella). */
  now?: Date;
}

export interface TurnDeps {
  /** El motor del bucle y del ejecutor: en producción, el adaptador. */
  engine: AgentEngine;
  /** Los handlers reales de las herramientas (con su confirmación). */
  handlers: Record<string, ToolHandler>;
  /**
   * La confirmación a nivel de política (la del dispatcher): la
   * superficie la responde; el texto del diálogo lo construye
   * `describePolicyConfirmation` (H-3) antes de preguntar.
   */
  onConfirmTool?: AgentLoopOptions["onConfirmTool"];
  loadMemory?: AgentLoopOptions["loadMemory"];
  /**
   * La búsqueda de contactos del turno (la vía determinista
   * de «busca el contacto X» / «llama a X»): el móvil la pasa
   * en su pantalla de chat; aquí la traen los deps de
   * producción (el adaptador sobre contactStore). Sin ella la
   * vía queda cerrada por su propia puerta y la frase cae al
   * modelo (el defecto R-4/R-5.3 que VERIFICACION-E7 cobró).
   */
  contactSearch?: AgentLoopOptions["contactSearch"];
  /** La sonda de memoria de la bifurcación (hechos y personas). */
  loadMemoryQueryData?: () => Promise<MemoryQueryData | null>;
  /** Resuelve el modelo del catálogo para el ejecutor. */
  resolveModel: (modelId: string) => ExecutableModel | undefined;
  /** Los modelos presentes en disco, para los perfiles del plan. */
  availableModels: AvailableModel[];
  /** El modelo por defecto de la máquina (respaldo de los perfiles). */
  fallbackModelId?: string;
  preset?: RoutingPreset;
  /** Las asignaciones de rol de la persona (Ajustes), leídas al construir los deps. */
  roleAssignments?: Partial<Record<ModelRole, string>>;
  /** Hechos de los packs instalados, leídos frescos en cada turno. */
  packFacts: () => Promise<{ regions: PackRegion[]; facts: PackFact[] }>;
  /** Conteo real de tokens (el del motor residente; si no, el estimador). */
  countTokens: (text: string) => number;
  /** Residencia del modelo de generación (para el registro del turno). */
  modelResident: () => boolean;
  /** Garantiza la residencia del e5; false si no se pudo. */
  ensureEmbeddings: () => Promise<boolean>;
  /** El constructor del contexto semántico (nunca carga el motor). */
  buildSemanticContext: (args: {
    answer: string;
    chunks: readonly GroundingChunk[];
    query: string;
  }) => Promise<JudgeSemanticContext | null>;
  /** La capa por significado de la puerta (nunca lanza). */
  semanticDanger: (query: string) => Promise<boolean>;
  /** Packs importados verificados, leídos frescos en cada turno. */
  verifiedImportedPackIds: () => Promise<ReadonlySet<string>>;
}

export type TurnRoute =
  | "safety"
  | "emergency-situation"
  | "health-gate"
  | "self-knowledge"
  | "canned"
  | "pack-facts"
  | "agent-loop"
  | "guide-literal"
  | "guide-forced"
  | "guide-coherence"
  | "safe-text"
  | "model"
  | "model-safe-substituted";

export interface TurnResult {
  /** El texto servido, ya juzgado y con las sustituciones aplicadas. */
  text: string;
  route: TurnRoute;
  /** Las fuentes del turno (las que el juez miró), en su orden. */
  sources: RetrievedChunk[];
  /** La tarjeta de evidencia sobre la fuente principal, o null. */
  evidence: EvidenceCardData | null;
  /** El modo del juez servido, leído de su resultado (T14R-7). */
  judgeMode?: "lexical" | "full";
  /** El estado del juez servido («grounded», «partial», …). */
  judgeStatus?: GroundingResult["status"];
  /** ¿El modelo de generación quedó residente al cerrar el turno? */
  generationModelResident: boolean;
  /** ¿El turno cargó el modelo de generación (no residía al abrir)? */
  generationModelLoadedByTurn: boolean;
  /** El modo de investigación fue preemptado por la puerta en este turno. */
  researchPreempted: boolean;
  /**
   * La nota de contexto P-2, en datos: turnos dejados por el
   * presupuesto y fracción de la ventana usada. La superficie
   * decide la nota (un cruce, una nota por conversación).
   */
  contextNote?: { droppedTurns: number; fractionUsed: number };
  /** El prompt efectivamente enviado en la última generación del turno. */
  promptSent: string | null;
  /**
   * Las señales del ejecutor, propagadas tal cual (H-3 de la caza de
   * errores de la tanda 14): «model-unavailable:<id>» cuando un
   * modelo no cargó, «generate-step-failed-no-model» cuando el paso
   * de generación no tuvo modelo, y «no-generate-step:no-model-
   * available» (señal del propio pipeline) cuando el plan ni
   * siquiera traía paso de generación. Una generación no ejecutada nunca
   * se presenta con la forma de una ejecutada: la superficie lee
   * estas señales y enseña su estado (S-8), no un turno vacío.
   */
  warnings: string[];
  /** La generación se detuvo a petición de la persona. */
  stopped: boolean;
  /** La generación cerró por plazo. */
  timedOut: boolean;
}

const DEFAULT_PRESET: RoutingPreset = "balanced";

/** ¿Está el fichero instalado del modelo en el directorio registrado? */
function modelOnDisk(modelId: string): boolean {
  const dir = llamaModelsDir();
  if (!dir) return false;
  try {
    return existsSync(join(dir, `${modelId}.gguf`));
  } catch {
    return false;
  }
}

/** Las dependencias de producción, sobre las piezas reales del árbol. */
export async function productionTurnDeps(
  partial: Pick<TurnDeps, "handlers" | "packFacts"> &
    Partial<Omit<TurnDeps, "handlers" | "packFacts">>,
): Promise<TurnDeps> {
  // Los ajustes de la persona se leen AL CONSTRUIR los deps,
  // que en producción es en cada turno (el llamador los
  // reconstruye por envío): el activo, el preset y las
  // asignaciones que gobiernan el plan son los vigentes en
  // ese momento, no una foto del arranque. Cada lectura
  // degrada a su valor por defecto si falla, como las demás
  // lecturas de ajustes del principal.
  const activeModelId = await getActiveModelId("llm").catch(() => null);
  const routingPreset = await getRoutingPreset().catch(() => DEFAULT_PRESET);
  const roleAssignments = await getModelRoleAssignments().catch(
    () => ({}) as Partial<Record<ModelRole, string>>,
  );
  return {
    engine: productionAgentEngine,
    onConfirmTool: undefined,
    loadMemory: undefined,
    loadMemoryQueryData: undefined,
    // El adaptador de contactos, en la forma del móvil: la
    // búsqueda estructurada sobre la agenda de NIDO que el
    // almacén de contactos ya trae (E7), envuelta en el
    // resultado que la vía determinista consume. En PC no hay
    // permiso de agenda del SO que denegar: la agenda es la
    // de la propia app, así que la búsqueda siempre puede
    // responder (ok con sus coincidencias, también vacías).
    contactSearch: async (query) => {
      const { searchContacts } = await import("../agent/memory/contactStore.js");
      return { ok: true, matches: await searchContacts(query) };
    },
    resolveModel: (modelId) => {
      const entry = MODEL_CATALOG.find((m) => m.id === modelId);
      if (!entry) return undefined;
      return {
        id: entry.id,
        filename: entry.filename,
        usesChatTemplate: entry.capabilities?.usesChatTemplate,
        defaultNCtx: entry.defaultNCtx,
        minGenerationTokens: entry.capabilities?.minGenerationTokens,
      };
    },
    // La presencia se MIDE contra el disco (H-1 de la caza de
    // errores de la tanda 14): un modelo está presente si su
    // fichero instalado (`<id>.gguf`) está en el directorio
    // registrado en la fachada. Declararla en falso sin leer el
    // disco dejaba todos los roles deshabilitados y el turno de
    // modelo se servía vacío y en silencio.
    availableModels: MODEL_CATALOG.filter((m) => m.kind === "llm").map((model) => ({
      model,
      present: modelOnDisk(model.id),
    })),
    // El respaldo del planificador es el modelo ACTIVO de la
    // persona, en la forma del móvil (su ruta adaptativa
    // nombra getActiveModelId("llm") como respaldo), no la
    // escalera de presupuesto sobre la RAM libre viva que
    // este asiento traía desde H-M1: la escalera podía
    // nombrar a un modelo ausente por encima de uno
    // presente, y el turno se servía vacío declarándose
    // «sin modelo» habiéndolo (la pieza de los modelos sin
    // roles). La escalera conserva sus dos asientos de
    // recomendación (el gestor de modelos y la insignia de
    // la tarjeta); como respaldo ya no nombra nada. Sin
    // activo declarado el respaldo queda sin nombrar:
    // ningún nombre ausente gobierna el plan, y la red del
    // paso 9 resuelve el rol de generación a un presente.
    fallbackModelId: activeModelId ?? undefined,
    preset: routingPreset,
    roleAssignments,
    countTokens: (text) => {
      // El conteo real manda cuando el motor reside; sin motor, el
      // estimador del presupuesto (el de contextBudget por defecto
      // se aplica dentro si este lanzara, así que aquí se estima
      // por caracteres como respaldo honesto).
      if (llamaEngine.isLoaded) return llamaEngine.countTokens(text);
      return Math.max(1, Math.round(text.length / 4));
    },
    modelResident: () => llamaEngine.isLoaded,
    ensureEmbeddings: () => embeddingEngine.ensureLoaded(),
    buildSemanticContext: (args) =>
      buildJudgeSemanticContext({
        answer: args.answer,
        chunks: args.chunks as GroundingChunk[],
        query: args.query,
      }).catch(() => null),
    semanticDanger: (query) => semanticDanger(query),
    verifiedImportedPackIds: async () => {
      const imported = await verifiedImportedPacks().catch(() => null);
      return imported ? new Set(imported.keys()) : new Set<string>();
    },
    ...partial,
  };
}

/**
 * La decisión de descarga del e5 por inactividad (H-1/E-1): el
 * mismo cableado que garantiza su residencia antes de juzgar
 * decide su descarga con la política portada, en la forma del
 * pulso del móvil (EMBED_IDLE_MS = 600_000).
 */
export const EMBED_IDLE_MS = 600_000;

export async function maybeUnloadEmbeddings(
  nowMs: number,
  lastBackgroundDoneAtMs: number | null,
): Promise<boolean> {
  const due = embeddingIdleUnloadDue(nowMs, embeddingEngine.lastUsedAtMs, lastBackgroundDoneAtMs, EMBED_IDLE_MS);
  if (due) await embeddingEngine.unload();
  return due;
}

/** El diálogo de confirmación de política, construido por H-3. */
export function buildPolicyConfirmText(
  decision: PolicyDecision,
  action: { tool: string; args: Record<string, unknown> } | undefined,
  lang: TurnLang,
): { title: string; message: string } {
  return describePolicyConfirmation(decision, action, lang);
}

function toGroundingChunks(chunks: readonly RetrievedChunk[]): GroundingChunk[] {
  return chunks.map((c) => ({ title: c.title, body: c.body, truncated: c.truncated }));
}

export async function runTurn(input: TurnInput, deps: TurnDeps): Promise<TurnResult> {
  const { query, lang } = input;
  const residentAtOpen = deps.modelResident();
  // H-2 de la caza de errores de la tanda 14: el prompt del turno es
  // el que ESTE turno envió. La fachada guarda el de la última
  // generación del proceso; sin la foto de la apertura, las rutas
  // que no generan atribuirían a este turno el prompt de otro.
  // Borde nombrado: dos generaciones seguidas con el prompt
  // idéntico al carácter dejan el campo en null (infra-declara);
  // la dirección es la conservadora, nunca atribuir a un turno el
  // prompt de otro, que es lo que el cerco de I-1 no puede consentir.
  const promptAtOpen = llamaEngine.lastPromptSent;
  const base = {
    sources: [] as RetrievedChunk[],
    evidence: null as EvidenceCardData | null,
    generationModelResident: residentAtOpen,
    generationModelLoadedByTurn: false,
    researchPreempted: false,
    promptSent: null as string | null,
    warnings: [] as string[],
    stopped: false,
    timedOut: false,
  };
  // Pieza 3 de la carcasa (H-EMB-A): la garantía de residencia
  // del e5 deja de tirarse. Los dos sitios que la cobran (la
  // puerta previa sin fuentes, paso 7, y el juez, paso 10) la
  // leen por este ayudante: si resuelve falso, el resultado del
  // turno asienta el aviso «embeddings-not-loaded», una sola vez
  // por turno aunque los dos sitios corran y fallen. La
  // degradación no cambia en nada más — el mismo texto y la
  // misma ruta sin capa semántica —: lo que muere es el silencio.
  let embeddingsNotLoaded = false;
  const ensureEmbeddings = async (): Promise<void> => {
    const ok = await deps.ensureEmbeddings().catch(() => false);
    if (!ok) embeddingsNotLoaded = true;
  };
  const finish = (r: Partial<TurnResult> & { text: string; route: TurnRoute }): TurnResult => {
    const warnings = [...(r.warnings ?? base.warnings)];
    if (embeddingsNotLoaded && !warnings.includes("embeddings-not-loaded")) {
      warnings.push("embeddings-not-loaded");
    }
    return {
      ...base,
      ...r,
      warnings,
      generationModelResident: deps.modelResident(),
      generationModelLoadedByTurn: !residentAtOpen && deps.modelResident(),
      promptSent:
        llamaEngine.lastPromptSent !== promptAtOpen ? llamaEngine.lastPromptSent : null,
    };
  };

  // 1. Las respuestas fijas de seguridad, con su orden interno.
  //    La clase del número espera al paso 3 (manda el pack).
  const safety = matchSafetyAnswer(query, lang);
  if (safety && safety.kind !== "emergency-number") {
    return finish({ text: safety.text, route: "safety" });
  }

  // 2. La identidad de la casa y la charla fija.
  const knowledge = answerKnowledgeQuery(query, lang);
  if (knowledge) return finish({ text: knowledge, route: "self-knowledge" });
  const canned = matchCanned(query);
  if (canned) return finish({ text: canned.text, route: "canned" });

  // 3. Los hechos de los packs, frescos en este turno; sin pack,
  //    el número de la tabla de seguridad como respaldo.
  const { regions, facts } = await deps.packFacts().catch(() => ({ regions: [], facts: [] }));
  const factsAnswer = composeFactsAnswer(query, lang, regions, facts);
  if (factsAnswer) return finish({ text: factsAnswer.text, route: "pack-facts" });
  if (safety) return finish({ text: safety.text, route: "safety" });

  // La guía forzada de los botones de Emergencia (§1 pieza A
  // del bloque del loop): el botón ya dijo su tema con su
  // clave, así que la guía se resuelve por la clave en el pack
  // instalado y se sirve literal, sin pasar por la elección —
  // con o sin motor de embeddings, que es el estado en que la
  // elección no puede elegir y la pasada en vivo sirvió la
  // guía vecina. Si la clave no resuelve (pack ausente o guía
  // retirada), el turno sigue su camino normal: la degradación
  // es el comportamiento de hoy entero. Los temas con vía fija
  // sellada (autolesión, monóxido, número) ya volvieron en los
  // pasos anteriores: este bloque solo cubre los que hoy
  // dependen de la elección (RCP, atragantamiento, sangrado,
  // quemaduras). Sin encabezado numerado: los doce pasos
  // quedan intactos y en su orden.
  if (input.guideKey) {
    const forced = await answerFromGuideKey(input.guideKey, lang).catch(() => null);
    if (forced) {
      return finish({
        text: forced.text,
        route: "guide-forced",
        sources: forced.chunks,
        evidence: buildEvidenceCard(forced.chunks, query),
      });
    }
  }

  // 4. La bifurcación del agente (clasificación + sonda de memoria).
  const intent = classifyIntent(query);
  if (intent === "actuar" || intent === "recordar") {
    let gateOpen = intent === "actuar";
    if (!gateOpen) {
      const mem = deps.loadMemoryQueryData ? await deps.loadMemoryQueryData().catch(() => null) : null;
      // H-GUIA-1 (pasada de la guía, 2026-11-20): la puerta de las
      // preguntas de memoria no puede cerrar una ORDEN explícita
      // de guardar un dato. «remember that…» y «lembra que…»
      // clasifican «recordar» y morían aquí (la puerta exige la
      // sonda de memoria, que ningún llamador de producción
      // provee), mientras su gemela española («recuerda que…»)
      // clasifica «actuar» y se guarda. La medida de la orden es
      // el propio extractor: si el loop va a extraer un dato, la
      // orden entra; las preguntas («do you remember when…?») no
      // casan con sus patrones anclados y siguen por su puerta.
      gateOpen =
        isGenericMemoryQuestionShape(query) ||
        (mem !== null && memoryGateHit(query, mem)) ||
        extractRememberFact(query) !== null;
    }
    if (gateOpen) {
      const loopResult = await runAgentLoop(query, {
        engine: deps.engine,
        handlers: deps.handlers,
        lang,
        loadMemory: deps.loadMemory,
        contactSearch: deps.contactSearch,
        onConfirmTool: deps.onConfirmTool,
        signal: input.signal,
        onToken: input.onToken,
      });
      return finish({ text: loopResult.response, route: "agent-loop" });
    }
  }

  // 5. La puerta antes de la bifurcación (segunda red, mitad del turno).
  const gateHit = gatePreemptsDeepResearch(query, lang);
  const deepTurn = (input.researchMode ?? false) && !gateHit;
  const researchPreempted = (input.researchMode ?? false) && gateHit;

  // 6. La guía literal, con la recuperación reutilizable.
  // C-4: al entrar en este bloque el turno pasa a buscar en
  // sus fuentes; el aviso sale aquí, una sola vez, antes de
  // la primera recuperación y muy antes del primer token.
  input.onPhase?.("searching");
  const historyForContext = {
    summary: input.summary ?? null,
    turns: (input.history ?? []).map((t) => ({ role: t.role, text: t.content })),
  };
  const retrievalQuery = contextualizeQuery(query, historyForContext);
  const guide = await answerFromGuide(query, lang, retrievalQuery).catch(() => ({
    answer: null,
    retrieved: null,
  }));
  if (guide.answer) {
    return finish({
      text: guide.answer.text,
      route: "guide-literal",
      sources: guide.answer.chunks,
      evidence: buildEvidenceCard(guide.answer.chunks, query),
      researchPreempted,
    });
  }
  const retrieved: RetrievedChunk[] = guide.retrieved ?? [];

  // 7. La puerta previa sin fuentes.
  let preGated = false;
  if (retrieved.length === 0) {
    const lexical = isHealthQuestion(query) || isEmergencySituation(query);
    let danger = lexical;
    if (!danger) {
      await ensureEmbeddings();
      danger = await deps.semanticDanger(query).catch(() => false);
    }
    if (noSourcesOutcome({ isHealth: danger, isEmergency: isEmergencySituation(query) }) === "safe-text") {
      return finish({ text: healthSafeText(lang), route: "safe-text", researchPreempted });
    }
    preGated = true;
  }

  // 8. El presupuesto de contexto verificado (P-2 en datos).
  const modelInfo = llamaEngine.getModelInfo();
  const nCtx = modelInfo?.nCtx ?? 4096;
  const reserveGeneration = 512;
  const systemMsg: BudgetMessage = { role: "system", content: input.systemPrompt };
  const historyMsgs: BudgetMessage[] = (input.history ?? []).map((t) => ({
    role: t.role,
    content: t.content,
  }));
  const currentMsg: BudgetMessage = { role: "user", content: query };
  let budgeted = applyContextBudget(systemMsg, historyMsgs, currentMsg, budgetConfigFor(nCtx, reserveGeneration), deps.countTokens);
  const contextNote = {
    droppedTurns: budgeted.droppedTurns,
    fractionUsed: budgeted.estimatedTotalTokens / nCtx,
  };

  // 9. La generación por el ejecutor (elige plan, no juzga).
  const taskType: TaskType = deepTurn ? "research" : "chat";
  const preset = deps.preset ?? DEFAULT_PRESET;
  let profiles = buildModelProfiles(
    preset,
    deps.availableModels,
    deps.roleAssignments ?? {},
    totalmem(),
    deps.fallbackModelId,
  );
  // La red de vacío de la pieza de los modelos sin roles
  // (D-3): si ningún perfil quedó habilitado y hay al menos
  // un LLM presente, el rol de generación se resuelve a un
  // modelo presente, en este orden declarado: el residente
  // primero (el que el motor ya tiene cargado, por el
  // filename leído en el paso 8), tras él el respaldo de
  // los deps si está presente (en producción, el modelo
  // activo de la persona), tras él cualquier presente por
  // orden de catálogo (la lista de los deps nace en ese
  // orden). El invariante que queda en pie es el contrato:
  // modelo presente ⇒ paso de generación. Sin ningún LLM
  // presente no se toca nada: el estado «sin modelo» de
  // hoy es la verdad y el aviso lo declara.
  if (!profiles.some((p) => p.enabled)) {
    const present = deps.availableModels.filter((a) => a.present);
    if (present.length > 0) {
      const resident = modelInfo?.filename
        ? present.find((a) => a.model.filename === modelInfo.filename)
        : undefined;
      const fallbackPresent = deps.fallbackModelId
        ? present.find((a) => a.model.id === deps.fallbackModelId)
        : undefined;
      const netModel = resident ?? fallbackPresent ?? present[0];
      profiles = buildModelProfiles(
        preset,
        deps.availableModels,
        deps.roleAssignments ?? {},
        totalmem(),
        netModel.model.id,
      );
    }
  }
  const plan = planRoute({
    taskType,
    query,
    hasLocalKnowledgeBase: retrieved.length > 0,
    retrievalAvailable: true,
    availableModels: profiles,
    preset,
    budget: { maxTokens: 2048, maxTotalLatencyMs: 120_000, allowVerification: true, allowRetrieval: true },
  });
  const execResult = await executeRoutingPlan(
    plan,
    {
      query,
      systemPrompt: input.systemPrompt,
      styleReminder: input.styleReminder,
      history: {
        summary: input.summary ?? null,
        turns: budgeted.history.map((t) => ({
          role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
          text: t.content,
        })),
      },
    },
    deps.resolveModel,
    {
      onToken: input.onToken,
      shouldStop: () => input.signal?.aborted ?? false,
      // §3.4 del bloque del loop: la señal misma, en forma getter,
      // para que el ejecutor la entregue a sus llamadas a generate
      // y la parada entre en la generación en vuelo (M-20).
      signal: () => input.signal,
    },
  );
  const sources = execResult.citations.length > 0 ? execResult.citations : retrieved;
  let servedText = execResult.answer;
  let judge: GroundingResult | undefined;

  // 10. El juez, con el contexto semántico en su forma (H-1).
  if (servedText.trim().length > 0) {
    const groundingChunks = toGroundingChunks(sources);
    let semanticCtx: JudgeSemanticContext | null = null;
    if (sources.length > 0) {
      // La residencia del e5 se garantiza ANTES de juzgar; el
      // constructor nunca lo carga y devuelve null sin él.
      await ensureEmbeddings();
      semanticCtx = await deps
        .buildSemanticContext({ answer: servedText, chunks: groundingChunks, query })
        .catch(() => null);
    }
    judge = verifyGroundedAnswer(
      servedText,
      groundingChunks,
      lang,
      query,
      input.now ?? new Date(),
      semanticCtx ?? undefined,
    );
    servedText = judge.text;
  }

  // 11. Los post-chequeos (nunca sobre un turno de investigación servida).
  let substituted = false;
  let coherence: GuideAnswer | null = null;
  if (!deepTurn && servedText.trim().length > 0) {
    if (sources.length === 0 && !preGated) {
      // El espejo de la puerta previa para la ruta sin pre-puerta.
      const lexical = isHealthQuestion(query) || isEmergencySituation(query);
      let danger = lexical;
      if (!danger) danger = await deps.semanticDanger(query).catch(() => false);
      if (noSourcesOutcome({ isHealth: danger, isEmergency: isEmergencySituation(query) }) === "safe-text") {
        servedText = healthSafeText(lang);
        substituted = true;
      }
    }
    if (!substituted && sources.length > 0 && judge) {
      const imported = await deps.verifiedImportedPackIds().catch(() => new Set<string>());
      if (
        shouldSubstituteSafeText({
          deepTurn: false,
          sources,
          grounding: judge.status,
          isHealth: isHealthQuestion(query),
          isEmergency: isEmergencySituation(query),
          provenance: judge.sentences,
          verifiedImportedPackIds: imported,
        })
      ) {
        servedText = healthSafeText(lang);
        substituted = true;
      }
    }
    if (!substituted && sources.length > 0 && judge) {
      // La puerta de coherencia de guía (§1 pieza B del bloque
      // del loop): el juez dejó pasar una composición hecha
      // entera de OTRA guía literal (cada frase con respaldo,
      // pero en la vecina). Si la pregunta tiene guía ganadora
      // por su identidad y ninguna frase citada descansa en
      // ella, se sirve la ganadora tal cual, con su ruta.
      coherence = await coherenceSubstitute({
        query,
        lang,
        sources,
        sentences: judge.sentences ?? [],
        status: judge.status,
      }).catch(() => null);
    }
  }

  // 12. La tarjeta de evidencia (sin tarjeta sobre texto fijo).
  const evidence = coherence
    ? buildEvidenceCard(coherence.chunks, query, null, { lang })
    : substituted
      ? buildEvidenceCard(sources, query, null, { servedFixedText: true })
      : buildEvidenceCard(sources, query, null, { lang });

  return finish({
    text: coherence ? coherence.text : servedText,
    route: coherence ? "guide-coherence" : substituted ? "model-safe-substituted" : "model",
    sources: coherence ? coherence.chunks : sources,
    evidence,
    judgeMode: judge?.judgeMode,
    judgeStatus: judge?.status,
    researchPreempted,
    contextNote,
    // H-3: las señales del ejecutor viajan en el resultado; un
    // modelo que no cargó se declara, no se sirve como turno vacío.
    // Y si el plan ni siquiera traía paso de generación (ningún
    // modelo presente al planear), el pipeline lo declara con su
    // propia señal: el ejecutor no avisa de un paso que no existe.
    warnings: plan.steps.some((s) => s.type === "generate")
      ? execResult.warnings
      : [...execResult.warnings, "no-generate-step:no-model-available"],
    stopped: execResult.stopped,
    timedOut: execResult.timedOut,
  });
}
