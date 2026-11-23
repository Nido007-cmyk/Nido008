/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Servicios de producción del proceso principal (tanda 14, actos 5
 * y 6): la puerta de la bóveda con el registro §8.9, el turno
 * entero sobre el pipeline, las conversaciones selladas, los
 * modelos, los ajustes y los datos del Acerca de. La superficie
 * (el renderizador) no toca el núcleo: pide por estos canales
 * nombrados y el proceso principal valida al emisor como la
 * carcasa valida el suyo (ventana de la casa + URL de la app).
 *
 * §8.9 (condición de cierre): al tener éxito el desbloqueo de la
 * bóveda se registran, con la DEK de la sesión, el proveedor de la
 * base de conocimiento, el proveedor del almacén de la app y su
 * directorio; al bloquear se retiran y se cierran los handles que
 * los consumen (D-8), para que ningún turno lea por un handle
 * muerto en silencio.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { freemem, hostname, release as osRelease, totalmem, type as osType } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import { isAppUrl } from "./shell.ts";
import {
  dispatchTextsFromStrings,
  noticeAgendaCustody,
  noticeVaultUnlocked,
  startNoticeRuntime,
} from "./noticeRuntime.ts";
import {
  applyAutostart,
  applyResidentSetting,
  autostartEnabledNow,
  installNoticeShell,
  refreshTrayMenu,
  trayTextsFromStrings,
} from "./noticeShell.ts";
import { pokeTaskRuntime, startTaskRuntime, taskRunStringsFromStrings } from "./taskRuntime.ts";
import { voiceHostFactory, VoiceProcessManager } from "./voiceProcess.ts";

import {
  initializeVault,
  PasswordCustodyProvider,
  unlockVaultWith,
  vaultBlobPath,
  VaultBlobError,
} from "../../src/security/keyVault.js";
import {
  knowledgePacks,
  listPackGuides,
  readPackGuide,
  type PackGuideEntry,
} from "../../src/rag/packs.js";
import { packsDataPath, setPacksDataDir } from "../../src/models/dataDir.js";
import { VaultLockedError, VaultSession } from "../../src/security/vaultSession.js";
import { seal, setAppStoreDekProvider, setAppStoreDir, unseal } from "../../src/security/appStore.js";
import { renameDurable, writeFileDurable } from "../../src/security/durableFs.js";
import {
  deleteCustomCollection,
  listCustomCollections,
  resetDatabase,
  setCustomCollectionActive,
  setKnowledgeDbDekProvider,
  setKnowledgeDbDir,
} from "../../src/rag/db.js";
import { sourcePanelData } from "../../src/services/sourcePanel.js";
import {
  exportCollection,
  importDocuments,
  setCollectionShareHandler,
  setImportCacheDirProvider,
  sweepOrphanedCollectionExports,
  type PickedDocumentFile,
} from "../../src/services/documentImporter.js";
import { listLibraryCollections } from "../../src/services/libraryDocs.js";
import { setOcrDataDir } from "../../src/services/ocrEngine.js";
import { extractPdfPages } from "../../src/services/pdfText.js";
import { isOcrAvailable, recognizeImageText, type OcrLang } from "../../src/services/ocr.js";
import { MAX_IMPORT_PDF_PAGES } from "../../src/services/attachmentPolicy.js";
import { migrateNumericFontScale } from "../../src/desktop/zoom.js";
import {
  extractLinkFromArgv,
  parseLink,
  resolveLink,
  type LinkResolution,
} from "../../src/desktop/enlaces.js";
import { lessons as GUIDE_LESSONS } from "../../src/guide/catalog.js";
import {
  openSecureDatabase,
  type SecureDb,
} from "../../src/security/secureDatabase.js";
import {
  conversationIndexCounts,
  dropConversationFromIndex,
  indexConversationMessages,
  searchConversationIndex,
} from "../../src/services/conversationSearch.js";
import {
  exportVaultBackup,
  rotateVaultKeys,
} from "../../src/security/backupCaller.js";
import { recoverPendingRotation } from "../../src/security/keyRotation.js";
import { embeddingEngine, setEmbeddingModelsDir } from "../../src/rag/embed.js";
import { activeEmbeddingModel } from "../../src/rag/embeddingSwitch.js";
import { llamaEngine, setLlamaModelsDir } from "../../src/inference/LlamaEngine.js";
import { wireProductionEngines } from "../../src/inference/agentEngine.js";
import { buildToolHandlers } from "../../src/agent/tools/handlers.js";
import {
  deleteFact,
  deleteNote,
  deletePerson,
  deleteReminder,
  getFacts,
  getPeople,
  listNotes,
  listReminders,
} from "../../src/agent/memory/memoryStore.js";
import { startActionLogPersistence } from "../../src/agent/actionLogStore.js";
import { reminderWhen } from "../../src/agent/loop/toolRouter.js";
import {
  buildPolicyConfirmText,
  planTurn,
  productionTurnDeps,
  runTurn,
  type TurnInput,
  type TurnResult,
} from "../../src/turn/turnPipeline.js";
import type { PolicyDecision } from "../../src/agent/policy/policyEngine.js";
import type { ResearchStyle } from "../../src/services/orchestrator.js";
import {
  deleteResearchSession,
  getResearchSession,
  listResearchSessions,
  saveResearchSessionStage,
} from "../../src/services/researchSessions.js";
import type { ResearchPlan } from "../../src/services/researchPlan.js";
import {
  getResearchReport,
  saveResearchReport,
} from "../../src/services/researchReports.js";
import { decideContextNote } from "../../src/turn/contextNote.js";
import { loadAllPackFacts } from "../../src/rag/packs.js";

import { summarizeConversation } from "../../src/services/summarize.js";
import { ModelManager } from "./modelManager.ts";
import { DownloadPaused, downloadAsset } from "./core/download.ts";
import { ASSET_CATALOG } from "./core/assetCatalog.ts";
import { censusAssets } from "./core/library.ts";
import type { ModelCard } from "../../src/core/modelCards.js";
import { DESKTOP_CATALOG, defaultModelForBudget } from "../../src/core/catalog.js";
import {
  availableBudgetBytes,
  planDesktopContext,
  type MachineSnapshot,
} from "../../src/core/ram.js";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/core/engine.js";

import {
  DEFAULT_MEMORY_SETTINGS,
  getCustomSystemPrompt,
  getDisabledToolNames,
  getDeepResearchMode,
  getGuideVisited,
  getPersonalityId,
  getMemorySettings,
  getNoticesPermissionAsked,
  getNoticesResident,
  getNoticesShowText,
  getFontScale,
  getReadAloudEnabled,
  getSendOnEnter,
  getVoiceInputEnabled,
  getVoiceSystemReserveEnabled,
  markGuideVisited,
  setActiveModelId,
  setCustomSystemPrompt,
  setDeepResearchMode,
  setDisabledToolNames,
  setLanguageId,
  setMemorySettings,
  setNoticesAutostart,
  setNoticesPermissionAsked,
  setNoticesResident,
  setNoticesShowText,
  setPersonalityId,
  setFontScale,
  setReadAloudEnabled,
  setSendOnEnter,
  setVoiceInputEnabled,
  setVoiceSystemReserveEnabled,
} from "../../src/models/settings.js";
import { setDisabledTools } from "../../src/agent/tools/toolPermissions.js";
import { PERSONALITIES } from "../../src/constants/personalities.js";
import en from "../../src/i18n/locales/en.json" with { type: "json" };
import es from "../../src/i18n/locales/es.json" with { type: "json" };
import pt from "../../src/i18n/locales/pt.json" with { type: "json" };
import { BASE_ADDRESS, SALVORA_NOTE, SOLANA_ADDRESS, type SupportLang } from "../../src/content/support.js";
import { PACK_CATALOG } from "../../src/models/packCatalog.js";
import { PACK_ORIGIN_LABEL } from "../../src/models/packImport.js";
import {
  derivePackSectionRows,
  importPackRow,
  installPackRow,
  packSectionNote,
  removePackRow,
} from "../../src/services/packSection.js";
import { composeProblemReport } from "../../src/content/problemReport.js";

// ---------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------

type Lang = "es" | "en" | "pt";

interface Prefs {
  theme: "daylight" | "night";
  lang: Lang;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** E11 (O-1·E11): la rotación pedida y confirmada, a ejecutar en el próximo desbloqueo antes de abrir ninguna base. */
  pendingRotation?: boolean;
}

interface StoredTurn {
  role: "user" | "assistant";
  text: string;
  route?: string;
  judgeMode?: string;
  judgeStatus?: string;
  sources?: { title: string; body: string; truncated?: boolean; rawScore?: number }[];
  evidence?: unknown;
  warnings?: string[];
  timedOut?: boolean;
  researchPreempted?: boolean;
  /** E10 (paso 5): el informe de la investigación de este turno. */
  research?: unknown;
  researchReportId?: string;
  stopped?: boolean;
  /** N1: el turno de asistente que asienta un fallo de la
   * generación (texto vacío, la marca en su sitio): el
   * mensaje de la persona queda en la conversación con su
   * error al lado en vez de perderse con la respuesta. */
  failed?: boolean;
  contextNote?: "filling" | "dropping";
  at: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  summarizedTurns: number;
  turns: StoredTurn[];
}

const LOCALES = { es, en, pt } as const;

let session: VaultSession | null = null;
let prefs: Prefs = {
  theme: "daylight",
  lang: "es",
  sidebarWidth: 280,
  sidebarCollapsed: false,
};

/**
 * E11 (paso 6, D-3): el número de la escala retirada,
 * capturado tal cual del fichero de prefs al cargarlas
 * (sin grampa: la migración lo cobra entero como el
 * escalón más cercano). Se consume en el primer
 * desbloqueo de la etapa y el fichero queda sin él al
 * reescribirse las prefs, que ya no lo conocen.
 */
let legacyFontScale: number | null = null;
let conversations: Conversation[] = [];
let currentAbort: AbortController | null = null;
let lastError: { reason: string; at: string } | null = null;
// El turno en vuelo, para que el bloqueo lo drene antes de
// desmontar la sesión (P-2): el drenaje espera a que el turno
// se asiente, pero su sellado no ocurre en el acto: la DEK ya
// es ceros cuando el drenaje empieza, así que el guardado del
// par muere con VaultLockedError y el par queda retenido en
// el hueco de módulo (retainedPair) para sellarse por la vía
// normal al siguiente desbloqueo.
let inFlightTurn: Promise<unknown> | null = null;
// El hueco de la forma (c) de la pieza del turno perdido al
// bloquear: un solo turno en vuelo existe (la puerta de
// F-UI-10 y la guarda L-4), así que un solo hueco basta, y se
// sobrescribe solo desde la captura del guardado muerto.
// Vive solo en memoria del proceso principal: jamás se
// escribe a disco en claro, y si el proceso muere con la
// bóveda bloqueada, el par retenido muere con él (la pérdida
// vuelve a ser la de antes de la pieza, declarada, no
// escondida).
interface RetainedPair {
  conversationId: string;
  /** Si la conversación nació con este turno: al reaplicarla
   * y no estar en la lista, se recrea con su identidad. */
  bornWithThisTurn: boolean;
  createdAt: string;
  title: string;
  updatedAt: string;
  /** El par empujado, tal cual quedó en memoria. */
  pair: [StoredTurn, StoredTurn];
}
let retainedPair: RetainedPair | null = null;
// El desmontaje del bloqueo es idempotente (P-3): el oyente de
// la sesión y el manejador manual no lo corren dos veces.
let tornDown = true;
// La carga de modelos: una cada vez y con época (P-4). La época
// sube al bloquear; una carga que cruza un bloqueo no asigna su
// modelo al final con la bóveda ya cerrada.
let loadInFlight = false;
let loadEpoch = 0;
// El bloqueo por inactividad que E2 diseñó (P-8): el mecanismo
// es de la sesión; el valor no lo selló ninguna etapa y lo fija
// esta tanda en 10 minutos, declarado en su asiento. Su ajuste
// desde Ajustes es pieza de una superficie posterior.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let lastGenRate: number | null = null;
/** E11 (paso 5): la fracción de contexto usada en el último turno medido, la fuente viva de la cifra de contexto del panel. */
let lastContextFraction: number | null = null;
const pendingConfirms = new Map<string, (approved: boolean) => void>();
let confirmSeq = 0;

// Puerta .ics/.vcf: la vista previa de una importación
// retiene el texto leído en un hueco por clase, con su
// testigo de un solo uso, hasta que la persona confirma
// o el hueco se sustituye por otra vista previa de la
// misma clase: el commit guarda exactamente lo que el
// resumen anunció, aunque el fichero cambie entre tanto.
const pendingAgendaImports = new Map<
  "ics" | "vcf",
  { token: string; text: string }
>();
export const ipcRejectedAttempts: { channel: string; at: string }[] = [];

function dirs() {
  const base = app.getPath("userData");
  return {
    base,
    vault: path.join(base, "vault"),
    store: path.join(base, "store"),
    knowledge: path.join(base, "knowledge"),
    models: path.join(base, "models"),
    assets: path.join(base, "assets"),
  };
}

function prefsPath(): string {
  return path.join(app.getPath("userData"), "nido-prefs.json");
}

async function loadPrefs(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(prefsPath(), "utf8");
  } catch {
    /* primera vez: los valores por defecto mandan */
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // E11 (paso 6): la escala numérica se retira de las
    // prefs; su último valor se captura para la migración
    // del primer desbloqueo, y ningún camino lo reescribe.
    const legacy = (parsed as Record<string, unknown>).fontScale;
    legacyFontScale = typeof legacy === "number" ? legacy : null;
    prefs = {
      theme: parsed.theme === "night" ? "night" : "daylight",
      lang: parsed.lang === "en" || parsed.lang === "pt" ? parsed.lang : "es",
      pendingRotation: parsed.pendingRotation === true,
      sidebarWidth:
        typeof parsed.sidebarWidth === "number"
          ? Math.min(360, Math.max(240, parsed.sidebarWidth))
          : 280,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
    };
  } catch {
    // A-5: existe pero no parsea — no es «primera vez». Se pone
    // en cuarentena con su nombre y el hecho queda registrado;
    // los defaults mandan solo sobre la copia viva.
    lastError = { reason: "prefs-corrupt-quarantined", at: new Date().toISOString() };
    try {
      renameDurable(prefsPath(), `${prefsPath()}.corrupt-${Date.now()}`);
    } catch {
      /* la cuarentena no pudo moverse; el registro queda */
    }
  }
}

async function savePrefs(): Promise<void> {
  // A-5: la vía durable también en el fichero propio; con
  // writeFile llano una escritura cortada dejaba las prefs
  // truncadas y la siguiente lectura caía a defaults enteros.
  writeFileDurable(prefsPath(), JSON.stringify(prefs));
}

// El gestor del proceso de voz: nace al primer uso (el estado
// del motor o el primer dictado), nunca al arrancar, porque la
// escucha se carga al pulsar y no antes (E9 paso 1).
let voiceProcessManager: VoiceProcessManager | null = null;
function voiceManager(): VoiceProcessManager {
  if (!voiceProcessManager) {
    voiceProcessManager = new VoiceProcessManager({
      assetsDir: dirs().assets,
      hostFactory: voiceHostFactory(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "voiceHost.js"),
      ),
    });
  }
  return voiceProcessManager;
}

function senderOk(event: Electron.IpcMainInvokeEvent, channel: string): boolean {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ok =
    win != null &&
    !win.isDestroyed() &&
    event.senderFrame != null &&
    isAppUrl(event.senderFrame.url);
  if (!ok) ipcRejectedAttempts.push({ channel, at: new Date().toISOString() });
  return ok;
}

function handle(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, args: never) => Promise<unknown> | unknown,
): void {
  ipcMain.handle(channel, async (event, args) => {
    if (!senderOk(event, channel)) return { ok: false, reason: "rejected-sender" };
    // Toda petición del renderizador es actividad de la persona:
    // el temporizador de inactividad se rearma (P-8).
    session?.touch();
    try {
      return await fn(event, args as never);
    } catch (err) {
      lastError = {
        reason: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      return { ok: false, reason: "error", error: lastError.reason };
    }
  });
}

// ---------------------------------------------------------------------
// La bóveda y el registro §8.9
// ---------------------------------------------------------------------

function vaultExists(): boolean {
  return existsSync(vaultBlobPath(dirs().vault));
}

/** El destino de la última exportación entregada (lo escribe
 * el entregador registrado en onUnlocked; el canal de
 * exportación lo lee para nombrar dónde quedó el fichero). */
let lastExportDest: string | null = null;
function takeLastExportDest(): string | null {
  const dest = lastExportDest;
  lastExportDest = null;
  return dest;
}

async function onUnlocked(sess: VaultSession): Promise<void> {
  session = sess;
  tornDown = false;
  const d = dirs();
  // §8.9: el registro, en la forma probada de las baterías (al
  // abrir, la DEK de la sesión; al cerrar, null).
  setKnowledgeDbDekProvider(() => sess.dek);
  setKnowledgeDbDir(d.knowledge);
  setAppStoreDekProvider(() => sess.dek);
  setAppStoreDir(d.store);
  setLlamaModelsDir(d.models);
  // Los permisos del agente (bloque de cableado, pieza 1): el
  // conjunto en memoria que la compuerta del despachador y el
  // bucle consultan se hidrata de la clave persistida en cada
  // desbloqueo, espejo de App.tsx:321-322 del móvil (allí al
  // arrancar; aquí la silla es el desbloqueo, el camino único
  // de la sesión). Si la lectura falla, el conjunto queda
  // vacío: la dirección segura de este ajuste en su forma de
  // arranque, la misma del bootstrap.
  setDisabledTools(await getDisabledToolNames().catch(() => []));
  // E11 (paso 6, D-3): la migración de la escala numérica
  // retirada, una sola vez: el número capturado al cargar
  // las prefs se cobra como el escalón más cercano en el
  // almacén, la captura se consume y el fichero de prefs
  // se reescribe sin el número (las prefs ya no lo
  // conocen). Sin número capturado no hay nada que migrar
  // y el almacén manda con su standard por defecto.
  if (legacyFontScale != null) {
    const captured = legacyFontScale;
    legacyFontScale = null;
    await setFontScale(migrateNumericFontScale(captured)).catch(() => undefined);
    await savePrefs().catch(() => undefined);
  }
  // E3.7 (la fijación que la cabecera de dataDir.ts declaraba
  // pendiente de esta etapa): el directorio de paquetes y el de
  // embeddings también se fijan a los datos de la app. Sin estas
  // dos llamadas, los paquetes se resolvían contra el directorio
  // de trabajo del proceso y el e5 se buscaba en «<cwd>/models»:
  // la puerta podía importar sin que el turno leyera jamás lo
  // importado en el sitio de la app.
  setPacksDataDir(path.join(d.store, "packs"));
  setEmbeddingModelsDir(d.models);
  // E6: los datos de idioma del OCR viven bajo los datos de la
  // app, no en el temporal del sistema: son tres ficheros del
  // paquete copiados una vez, y su sitio es el de la app.
  setOcrDataDir(path.join(d.store, "ocr-data"));
  // E6 (paso 8): la caché de exportaciones de colecciones vive
  // bajo los datos de la app (el JSON en claro de una
  // exportación existe solo durante su entrega y se borra al
  // terminar; la barrida de apertura recoge los huérfanos de
  // un cierre a mitad de entrega), y el entregador de la
  // carcasa copia la exportación a las Descargas del usuario:
  // en un PC, entregar es dejar el fichero donde la persona
  // lo espera, no abrir la hoja de compartir del teléfono.
  setImportCacheDirProvider(() => `${path.join(d.store, "import-cache")}${path.sep}`);
  setCollectionShareHandler(async (filePath) => {
    const downloads = app.getPath("downloads");
    const base = path.basename(filePath);
    let dest = path.join(downloads, base);
    for (let i = 2; await stat(dest).catch(() => null); i++) {
      dest = path.join(downloads, base.replace(/\.json$/, `-${i}.json`));
    }
    await copyFile(filePath, dest);
    lastExportDest = dest;
  });
  void sweepOrphanedCollectionExports().catch(() => undefined);
  // Pieza 3 de la carcasa (H-EMB-A): el registro del proveedor de
  // residencia del e5, dentro del bloque del §8.9 y tras el
  // directorio — la carga que el proveedor habilita resuelve el
  // fichero contra ese directorio, y el proveedor resuelve el
  // modelo activo por el mismo resolvedor del conmutador
  // (activeEmbeddingModel), para que el registro y el conmutador
  // nunca nombren dos activos distintos. Sin este registro, la
  // garantía de residencia del pipeline resolvía siempre falso
  // en una sesión nueva y la pata semántica nacía muerta.
  embeddingEngine.setEnsureLoadedProvider(async () => {
    const model = await activeEmbeddingModel().catch(() => null);
    return model ? model.filename : null;
  });
  wireProductionEngines();
  // A-1, el cobro del idioma, en su TERCERA FORMA (asentada en
  // TANDA14-ASIENTO): ni cobrar la lectura sellada tras el registro
  // ni retirar la doble escritura; el flujo se invierte y el almacén
  // sellado se sincroniza DESDE el fichero llano (prefs.lang, el que
  // la persona eligió y prefs-set persiste), para que los dos
  // almacenes nunca diverjan (la clase de A-7). Hoy ningún llamador
  // de producción lee getLanguageId fuera de settings.ts: la
  // escritura queda viva e inofensiva hasta que un lector del núcleo
  // la cobre, y entonces cobrará el idioma de la superficie. Si la
  // escritura falla, el hecho queda registrado, no tragado.
  try {
    await setLanguageId(prefs.lang);
  } catch (err) {
    lastError = {
      reason: `language-sync: ${err instanceof Error ? err.message : String(err)}`,
      at: new Date().toISOString(),
    };
  }
  sess.onLock(() => {
    void onLocked();
  });
  await loadConversations();
  // E11 (paso 9): la base del índice se abre con la sesión
  // y su mantenimiento inicial cobra lo ya guardado (una
  // escritura por mensaje la primera vez; después, solo
  // los nuevos al guardar). Si la base no abre, la
  // búsqueda se niega con su razón y el hecho queda aquí.
  try {
    // El mango anterior (de una sesión previa, quizá con
    // la clave anterior a una rotación) se cierra aquí,
    // al renovarlo: nunca conviven dos sobre la misma base.
    try {
      searchDb?.close();
    } catch {
      /* ya cerrado */
    }
    searchDb = openSecureDatabase(path.join(d.store, "nido_search.db"), sess.dek);
    searchCounts = conversationIndexCounts(searchDb);
    maintainSearchIndex();
  } catch (err) {
    searchDb = null;
    console.error(
      `NIDO-BUSCADOR: la base del índice no abrió: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // La aplicación del hueco (la forma (c) de la pieza del
  // turno perdido al bloquear): si un par quedó retenido por
  // un bloqueo en vuelo, se aplica sobre la lista recargada
  // (la conversación se busca por id; si no está, se recrea
  // con la identidad guardada) y se guarda por la vía normal,
  // con la DEK viva. Idempotente por identidad del par (sus
  // textos y sus marcas de tiempo): si ya estuviera, no se
  // duplica; y desde N1 el par puede venir medio sellado (el
  // empuje previo ya selló el turno de la persona), así que
  // la aplicación también completa el par al que solo le
  // falta el asistente, sin duplicar su primera mitad. Si el guardado de la aplicación falla, el hueco
  // se conserva y el hecho queda en lastError, como la
  // cuarentena de blobs: nunca se pierde en silencio. El
  // registro guarda el hecho, jamás el texto del par.
  if (retainedPair) {
    const slot = retainedPair;
    try {
      let target = conversations.find((c) => c.id === slot.conversationId);
      if (!target) {
        target = {
          id: slot.conversationId,
          title: slot.title,
          createdAt: slot.createdAt,
          updatedAt: slot.updatedAt,
          summary: null,
          summarizedTurns: 0,
          turns: [],
        };
        conversations.unshift(target);
      }
      const alreadyApplied = target.turns.some(
        (t, i) =>
          t.role === "user" &&
          target.turns[i + 1]?.role === "assistant" &&
          t.text === slot.pair[0].text &&
          target.turns[i + 1].text === slot.pair[1].text &&
          t.at === slot.pair[0].at &&
          target.turns[i + 1].at === slot.pair[1].at,
      );
      if (!alreadyApplied) {
        // N1: el empuje previo del turno sella el mensaje
        // de la persona ANTES de generar, así que si la
        // bóveda se bloqueó a mitad de ese turno, el blob
        // ya trae su mitad del par retenido: si el último
        // turno de la conversación ES ese turno, por la
        // misma identidad (texto y marca de tiempo), se
        // empuja solo el asistente que falta; empujar el
        // par entero duplicaría el mensaje. El par es
        // siempre la cola de su conversación: con la
        // bóveda bloqueada ningún otro turno pudo correr
        // entre el asentamiento y este desbloqueo.
        const last = target.turns[target.turns.length - 1];
        const userAlreadySealed =
          last !== undefined &&
          last.role === "user" &&
          last.text === slot.pair[0].text &&
          last.at === slot.pair[0].at;
        if (userAlreadySealed) {
          target.turns.push(slot.pair[1]);
        } else {
          target.turns.push(slot.pair[0], slot.pair[1]);
        }
        target.updatedAt = slot.updatedAt;
      }
      await saveConversations();
      retainedPair = null;
    } catch {
      lastError = {
        reason: "retained-pair-apply-failed",
        at: new Date().toISOString(),
      };
    }
  }
  // E8 (paso 3): con la base ya abierta, el ejecutor reconcilia
  // su agenda y corre la pasada de recuperación: lo que venció
  // con la bóveda bloqueada se presenta ahora, entero.
  void noticeVaultUnlocked();
  // E8 (paso 6): el menú de la bandeja relee su estado tras
  // el desbloqueo (el contador de sin atender ya es real).
  refreshTrayMenu();
  // E8 (paso 8, T-21): lo que venció con la bóveda bloqueada
  // corre una vez tras desbloquear, por la revisión de
  // apertura del disparo de tareas.
  pokeTaskRuntime();
}

async function onLocked(): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  loadEpoch += 1;
  drainPendingConfirms();
  currentAbort?.abort();
  // Los permisos del agente: sin sesión, conjunto vacío. El
  // móvil no tiene bloqueo de bóveda y PC sí; la limpieza deja
  // el invariante verdad siempre y el siguiente desbloqueo
  // rehidrata desde la clave persistida. Sin sesión ningún
  // turno corre, así que no cambia conducta: deja el estado
  // honesto.
  setDisabledTools([]);
  // La cura del bloqueo a mitad de descarga (la observación de la
  // sonda (b) de la auditoría de ataque de E4): el bloqueo también
  // detiene las transferencias de modelos en vuelo, por el mismo
  // mecanismo de la pausa, para que cada `.part` quede quieto y
  // contado y su tarjeta en pausa. Va aquí, síncrono con el aborto
  // del turno y antes de todo await. El gestor se toca solo si ya
  // nació: abrirlo en pleno bloqueo crearía el directorio y el
  // censo, y sin gestor no hay descarga viva que detener.
  modelManager?.pauseAllDownloads();
  // P-2 / C-4: el turno en vuelo se drena ANTES de desmontar la
  // sesión: la espera es en el acto; el sellado del par, no.
  // La DEK ya es ceros cuando el drenaje empieza, así que el
  // guardado del turno muere con VaultLockedError y el par
  // queda retenido en el hueco de módulo para sellarse por la
  // vía normal al siguiente desbloqueo (la forma (c) de la
  // pieza del turno perdido al bloquear). Desaparecer sin
  // sello era la conducta no declarada; prometer el sello en
  // el acto sería la misma promesa rota con otra letra.
  if (inFlightTurn) await inFlightTurn.catch(() => undefined);
  session = null;
  conversations = [];
  // E11 (paso 9): la base del índice sigue la forma de
  // las demás bases de la casa al bloquear: su mango no
  // se cierra aquí (los proveedores de clave se anulan y
  // la búsqueda se niega sin sesión, que es el corte);
  // cerrarla borraría sus ficheros laterales y el censo
  // del almacén durante el bloqueo cambiaría, que es lo
  // que la regresión del sello de la puerta cobra. El
  // mango se renueva en el siguiente desbloqueo.
  setKnowledgeDbDekProvider(null);
  setAppStoreDekProvider(null);
  // La forma de las baterías al cerrar: los directorios también se
  // desregistran, no solo los proveedores de clave (auditoría §8.9
  // en vuelo, diferencia de forma igualada en esta tanda).
  setKnowledgeDbDir(null);
  setAppStoreDir(null);
  setPacksDataDir(null);
  // Pieza 3 de la carcasa (H-EMB-A): el desregistro del proveedor
  // de residencia del e5, en la simetría entera del bloque de
  // nulos — el registrador acepta null por su propia firma. El
  // directorio de embeddings no se toca: dice dónde se busca el
  // fichero; el registro era el qué.
  embeddingEngine.setEnsureLoadedProvider(null);
  // D-8: los handles que consumían la clave se cierran al bloquear;
  // ningún turno lee por un handle muerto en silencio.
  await resetDatabase().catch(() => undefined);
  // Cura §6: el residente se descarga primero por el gestor,
  // que anula su libro antes de descargar (deactivate sobre
  // unloadResident), para que libro y motor no diverjan tras
  // el bloqueo; la descarga directa de detrás queda intacta
  // como garantía de la fachada vacía para lo que un turno
  // cargó sin pasar por el gestor. El gestor se toca con la
  // misma cadena opcional de la pausa: si nunca nació, no hay
  // libro que limpiar y no se abre en pleno bloqueo. Esperar
  // aquí es seguro por la compuerta de arranque del gestor:
  // la cola por delante solo trae operaciones acotadas o
  // asentadas, y el drenaje del turno en vuelo ya ocurrió.
  await modelManager?.deactivate().catch(() => undefined);
  await llamaEngine.unload().catch(() => undefined);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("nido:vault-locked");
  }
}

// ---------------------------------------------------------------------
// E11 (paso 7) · Los enlaces nido:// que llegan de fuera
// ---------------------------------------------------------------------

/**
 * El enlace retenido: una sola ranura (el último manda) y
 * su número de llegada. La resolución se hace al
 * entregarlo, contra el mundo de ese momento: bloqueada
 * la bóveda, la resolución es la retención misma y el
 * enlace sigue retenido para tras el desbloqueo.
 */
let pendingLink: { raw: string; seq: number } | null = null;
let linkSeq = 0;

/** El mundo contra el que la pieza resuelve: la sesión, las conversaciones y la guía integrada (instalada con la app). */
function linkWorld() {
  const guideIds = GUIDE_LESSONS.map((l) => l.id);
  return {
    vaultUnlocked: session != null,
    conversationIds: conversations.map((c) => c.id),
    installedGuideIds: guideIds,
    guideCatalogIds: guideIds,
  };
}

function resolvePendingLink(): { seq: number; resolution: LinkResolution } | null {
  if (!pendingLink) return null;
  const resolution = resolveLink(parseLink(pendingLink.raw), linkWorld());
  // La ruta resuelta queda en el registro del principal:
  // es la línea que las sondas de la etapa leen para
  // cobrar que cada ruta cayó en su destino.
  console.log(
    `NIDO-ENLACE seq=${pendingLink.seq} resolucion=${resolution.kind}` +
      (resolution.kind !== "hold" ? `:${resolution.section}` : ""),
  );
  return { seq: pendingLink.seq, resolution };
}

/**
 * La anotación de un enlace que llega de fuera (los
 * argumentos de la segunda instancia, open-url, o el
 * arranque en frío): se retiene y se avisa a la ventana
 * para que lo recoja; la ventana también lo recoge al
 * arrancar y al desbloquear, por el mismo canal.
 */
export function noteExternalLink(raw: string): void {
  if (typeof raw !== "string" || raw.length === 0) return;
  linkSeq += 1;
  pendingLink = { raw, seq: linkSeq };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("nido:link", { seq: linkSeq });
  }
}

/** La llegada por argumentos (arranque en frío y segunda instancia comparten la extracción). */
export function noteLinkFromArgv(argv: string[]): void {
  const raw = extractLinkFromArgv(argv);
  if (raw) noteExternalLink(raw);
}

// ---------------------------------------------------------------------
// E11 (paso 9) · El índice del buscador global
// ---------------------------------------------------------------------

/**
 * La base del índice (nido_search.db, con la DEK de la
 * sesión, dentro del almacén) y su estado de
 * mantenimiento: cuántos mensajes de cada conversación
 * ya están indexados, reconstruido de la propia base al
 * abrirla. Sin sesión no hay base: la búsqueda se niega
 * con su razón y ningún texto vive fuera de la bóveda.
 */
let searchDb: SecureDb | null = null;
let searchCounts = new Map<string, number>();

/**
 * El mantenimiento, llamado al guardar las
 * conversaciones: una escritura de índice por mensaje
 * nuevo (el coste declarado del paso), las conversaciones
 * desaparecidas salen del índice y las que encogieron se
 * rehacen dentro de la propia pieza. Un fallo del índice
 * no tumba el guardado (el blob sellado es la verdad; el
 * índice es derivado y se reconstruye), pero queda en el
 * registro, nunca tragado.
 */
/**
 * E11 (O-1·E11): las bases gestionadas que existen, con
 * su nombre relativo al directorio de la bóveda (la
 * pareja de E2 trabaja sobre un directorio y sus nombres;
 * las bases de la app viven en store/ y knowledge/, y su
 * nombre relativo es su dirección exacta desde la
 * bóveda). Una base que aún no existe no está gestionada
 * todavía: no se nombra (el pre-vuelo de la rotación y la
 * lectura del respaldo exigen que exista).
 */
function managedDbNames(): string[] {
  const d = dirs();
  const candidates = [
    path.join(d.store, "nido_memory.db"),
    path.join(d.store, "nido_search.db"),
    path.join(d.knowledge, "nido_knowledge.db"),
  ];
  return candidates
    .filter((p) => existsSync(p))
    .map((p) => path.relative(d.vault, p));
}

/** El desenlace de la rotación del último desbloqueo, para la superficie: done | recovered | failed | null. */
let rotationOutcome: "done" | "recovered" | "failed" | null = null;

/**
 * El asiento de la rotación en el desbloqueo, ANTES de
 * que onUnlocked abra ninguna base: primero la
 * recuperación de E2 (una rotación cortada se completa o
 * se revierte aquí, con la custodia mandando); después,
 * si hay una rotación pedida y confirmada, se ejecuta
 * por el llamante con la credencial recién introducida.
 * Las conversaciones se cargan con la clave vieja antes
 * de rotar y se re-sellan con la nueva al volver: el blob
 * sellado no es una base de la pareja y su re-sello es
 * deber de este asiento. Un fallo no encierra a la
 * persona fuera de sus datos: la bóveda sigue con su
 * clave de siempre, el hecho queda registrado y la
 * superficie lo enseña.
 */
async function settlePendingRotation(
  sess: VaultSession,
  provider: PasswordCustodyProvider,
): Promise<void> {
  const d = dirs();
  try {
    const outcome = await recoverPendingRotation({
      dir: d.vault,
      providers: [provider],
      session: sess,
    });
    if (outcome !== "none") {
      rotationOutcome = "recovered";
      if (prefs.pendingRotation) {
        prefs.pendingRotation = false;
        await savePrefs().catch(() => undefined);
      }
      return;
    }
  } catch (err) {
    rotationOutcome = "failed";
    lastError = {
      reason: `rotation-recovery: ${err instanceof Error ? err.message : String(err)}`,
      at: new Date().toISOString(),
    };
    return;
  }
  if (!prefs.pendingRotation) return;
  prefs.pendingRotation = false;
  await savePrefs().catch(() => undefined);
  session = sess;
  await loadConversations();
  try {
    await rotateVaultKeys({
      dir: d.vault,
      dbNames: managedDbNames(),
      session: sess,
      providers: [provider],
    });
    rotationOutcome = "done";
    await saveConversations().catch(() => undefined);
  } catch (err) {
    rotationOutcome = "failed";
    lastError = {
      reason: `rotation: ${err instanceof Error ? err.message : String(err)}`,
      at: new Date().toISOString(),
    };
  }
}

function maintainSearchIndex(): void {
  if (!searchDb) return;
  try {
    const alive = new Set(conversations.map((c) => c.id));
    for (const id of [...searchCounts.keys()]) {
      if (!alive.has(id)) {
        dropConversationFromIndex(searchDb, id);
        searchCounts.delete(id);
      }
    }
    for (const c of conversations) {
      const writes = indexConversationMessages(
        searchDb,
        c.id,
        c.turns,
        searchCounts.get(c.id) ?? 0,
      );
      if (writes > 0 || (searchCounts.get(c.id) ?? 0) > c.turns.length) {
        searchCounts.set(c.id, c.turns.length);
      }
    }
  } catch (err) {
    console.error(
      `NIDO-BUSCADOR: el mantenimiento del índice falló: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function loadConversations(): Promise<void> {
  if (!session) return;
  const file = path.join(dirs().store, "conversations.sealed");
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    // No existe: primera apertura, lista vacía sin más.
    conversations = [];
    return;
  }
  try {
    const plain = unseal(session.dek, raw);
    conversations = JSON.parse(plain.toString("utf8")) as Conversation[];
  } catch {
    // Existe pero no abre (auditoría del ciclo de
    // conversaciones): no es lo mismo que «no existe». El blob
    // dañado se pone en cuarentena con su nombre, el hecho queda
    // registrado para el informe de problema, y la app abre con
    // la lista vacía SIN sobrescribir el dañado: el primer
    // guardado posterior escribe un blob nuevo y la pérdida no
    // se sella.
    conversations = [];
    lastError = { reason: "conversations-corrupt-quarantined", at: new Date().toISOString() };
    try {
      renameDurable(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // Si ni la cuarentena puede moverse, el blob queda donde
      // está y el registro queda hecho; no se borra en silencio.
    }
  }
}

async function saveConversations(): Promise<void> {
  if (!session) return;
  const d = dirs();
  await mkdir(d.store, { recursive: true });
  const sealed = seal(session.dek, Buffer.from(JSON.stringify(conversations), "utf8"));
  // P-7: la vía durable de la casa (temporal, fsync, rename,
  // fsync del directorio). Una escritura cortada deja el blob
  // anterior intacto; con writeFile llano dejaba el sellado
  // truncado y la siguiente apertura perdía el historial entero.
  writeFileDurable(path.join(d.store, "conversations.sealed"), sealed);
  // E11 (paso 9): el índice se mantiene en el mismo
  // guardado, con su coste declarado (una escritura por
  // mensaje nuevo).
  maintainSearchIndex();
}

/**
 * El guardado de un par asentado, compartido por el
 * asentamiento del éxito y por el del fallo (N1): los dos
 * sellan el mismo blob con la misma disciplina, y la
 * retención de la forma (c) es una sola implementación,
 * no dos copias que puedan divergir.
 *
 * La poda del campo corre aquí, en su sitio (cableado,
 * pieza 2): tras el asentamiento y antes del guardado,
 * para que el blob que se sella ya sea el podado. Solo el
 * VaultLockedError de ESTE guardado (el que sigue a
 * empujar el par) deja el par en el hueco de módulo, para
 * sellarlo al siguiente desbloqueo. El error sigue su
 * camino (la respuesta del turno no cambia) y cualquier
 * otro error sigue lanzando como hasta hoy, sin captura.
 */
async function saveSettledTurns(conv: Conversation, bornWithThisTurn: boolean): Promise<void> {
  await pruneSavedSessions(conv.id);
  try {
    await saveConversations();
  } catch (err) {
    if (err instanceof VaultLockedError) {
      retainedPair = {
        conversationId: conv.id,
        bornWithThisTurn,
        createdAt: conv.createdAt,
        title: conv.title,
        updatedAt: conv.updatedAt,
        pair: [
          conv.turns[conv.turns.length - 2],
          conv.turns[conv.turns.length - 1],
        ],
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------
// El turno
// ---------------------------------------------------------------------

function stringsFor(lang: Lang): Record<string, unknown> {
  return LOCALES[lang] as Record<string, unknown>;
}

function surfaceString(lang: Lang, key: string): string {
  const pc = (stringsFor(lang) as Record<string, unknown>).pcSurface as
    | Record<string, unknown>
    | undefined;
  const v = pc?.[key];
  return typeof v === "string" ? v : key;
}

/** El tope de materia por adjunto en un turno: lo que pasa de ahí se nombra recortado en el propio bloque, nunca se corta en silencio. */
const ATTACHMENT_MATERIAL_CAP = 24_000;

/**
 * E11 (pasos 2 y 3): la materia adjunta del composer se
 * compone en el texto del turno, en un bloque visible que
 * nombra cada fichero: lo que la persona ve en su mensaje
 * es lo que el modelo recibe. Nada se indexa en silencio
 * (la Biblioteca tiene su confirmación de E6) y nada se
 * esconde: la extracción es la de la casa (el texto se lee
 * con su tope, el PDF pasa por el lector del importador,
 * la imagen por el OCR si está disponible) y lo que no da
 * texto lo dice el propio bloque. El título de la
 * conversación y las consultas guardadas de las sesiones
 * quedan con las palabras de la persona; la materia vive
 * en el turno.
 */
async function composeTurnMaterial(
  text: string,
  attachments:
    | { name: string; kind: string; path?: string; dataBase64?: string }[]
    | undefined,
  lang: Lang,
): Promise<string> {
  if (!attachments || attachments.length === 0) return text;
  const blocks: string[] = [];
  for (const att of attachments) {
    let body = "";
    let tmpPath: string | null = null;
    try {
      let filePath =
        typeof att.path === "string" && att.path.length > 0 ? att.path : null;
      if (!filePath && typeof att.dataBase64 === "string" && att.dataBase64.length > 0) {
        const dir = path.join(app.getPath("userData"), "paste-tmp");
        await mkdir(dir, { recursive: true });
        tmpPath = path.join(
          dir,
          `pegado-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        );
        await writeFile(tmpPath, Buffer.from(att.dataBase64, "base64"));
        filePath = tmpPath;
      }
      if (filePath) {
        if (att.kind === "text") {
          const buf = await readFile(filePath);
          body = new TextDecoder().decode(buf.subarray(0, ATTACHMENT_MATERIAL_CAP * 4));
        } else if (att.kind === "pdf") {
          const pages = await extractPdfPages(
            filePath,
            MAX_IMPORT_PDF_PAGES,
            ATTACHMENT_MATERIAL_CAP,
          ).catch(() => []);
          body = pages.map((p) => p.texto).join("\n");
        } else if (att.kind === "image") {
          if (await isOcrAvailable().catch(() => false)) {
            body = await recognizeImageText(filePath, lang as OcrLang).catch(() => "");
          }
        }
      }
    } catch {
      body = "";
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => undefined);
    }
    let shown = body.trim();
    let truncatedNote = "";
    if (shown.length > ATTACHMENT_MATERIAL_CAP) {
      shown = shown.slice(0, ATTACHMENT_MATERIAL_CAP);
      truncatedNote = `\n[${surfaceString(lang, "attachedTruncated")}]`;
    }
    if (shown.length === 0) shown = surfaceString(lang, "attachedNoText");
    blocks.push(
      `[${surfaceString(lang, "attachedMaterial")}: ${att.name}]\n${shown}${truncatedNote}`,
    );
  }
  return `${text}\n\n${blocks.join("\n\n")}`;
}

async function askConfirm(
  event: Electron.IpcMainInvokeEvent,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const id = `c${++confirmSeq}`;
  return new Promise<boolean>((resolve) => {
    pendingConfirms.set(id, resolve);
    event.sender.send("nido:confirm-request", { id, ...payload });
  });
}

/**
 * El drenaje de las confirmaciones pendientes (auditoría del
 * loop de confirmación, H-1): una tarjeta sin responder no puede
 * dejar el turno colgado para siempre. Al bloquear la bóveda, al
 * parar el turno y al cerrar la ventana, todo lo pendiente se
 * resuelve en falso: la acción no se ejecuta y el mapa no
 * acumula entradas muertas.
 */
function drainPendingConfirms(): void {
  for (const resolve of pendingConfirms.values()) resolve(false);
  pendingConfirms.clear();
}

/**
 * CONF-1: la carga de la tarjeta de política. El texto lo
 * construye describePolicyConfirmation (vía
 * buildPolicyConfirmText) desde la decisión y los args
 * validados: la tarjeta nombra lo que se aprueba, en el
 * idioma del turno, con el aviso de procedencia cuando la
 * decisión lo trae. Antes de esta cura el cable mandaba el
 * decision.reason crudo del motor, en inglés y sin el dato.
 * El constructor nunca devuelve un título vacío: cada rama
 * del constructor de textos fija el suyo.
 */
export function policyConfirmPayload(
  decision: PolicyDecision,
  action: { tool: string; args: Record<string, unknown> } | undefined,
  lang: Lang,
): Record<string, unknown> {
  const dialog = buildPolicyConfirmText(decision, action, lang);
  return {
    kind: "policy",
    tool: action?.tool ?? "",
    scope: null,
    title: dialog.title,
    message: dialog.message,
  };
}

async function runOneTurn(
  event: Electron.IpcMainInvokeEvent,
  args: {
    conversationId: string;
    text: string;
    researchMode?: boolean;
    guideKey?: string;
    researchPlan?: ResearchPlan;
    /** E10 (paso 6): la sesión que este turno reanuda, si la trae. */
    researchSessionId?: string;
    /** E11 (pasos 2 y 3): la materia adjunta del composer (caída y pegado), por su ruta o por sus bytes si no la tiene. */
    attachments?: { name: string; kind: string; path?: string; dataBase64?: string }[];
  },
): Promise<unknown> {
  if (!session) return { ok: false, reason: "locked" };
  // Cableado, pieza 2: el campo `autoGenerateTitles` gobierna
  // las dos asignaciones de título del turno, la de la
  // creación (abajo) y la reafirmación del asentamiento. Se
  // lee una vez por turno, antes de crear, para que las dos
  // obedezcan al mismo valor; si el almacén no responde manda
  // el defecto del contrato (títulos encendidos), el mismo
  // espíritu que el resto de lecturas de esta carcasa.
  const memorySettings = await getMemorySettings().catch(() => DEFAULT_MEMORY_SETTINGS);
  const autoTitles = memorySettings.autoGenerateTitles;
  let bornWithThisTurn = false;
  const conv =
    conversations.find((c) => c.id === args.conversationId) ??
    (() => {
      bornWithThisTurn = true;
      const created: Conversation = {
        id: args.conversationId,
        // Con el campo apagado la conversación nace sin título
        // generado (la cadena vacía): la lista enseña su
        // respaldo, la cadena de pcSurface para «sin título»,
        // que sus dos sitios ya cobran cuando el título está
        // vacío.
        title: autoTitles ? args.text.slice(0, 60) : "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        summary: null,
        summarizedTurns: 0,
        turns: [],
      };
      conversations.unshift(created);
      return created;
    })();
  const lang = prefs.lang;
  // E11 (pasos 2 y 3): la materia adjunta se compone en el
  // texto del turno antes de servirlo: la consulta y el
  // turno guardado llevan el mismo texto compuesto.
  const turnText = await composeTurnMaterial(args.text, args.attachments, lang);
  // A-4, su otra mitad: el tono elegido GOBIERNA el turno. La
  // composición es la del móvil: el prompt de sistema es el de la
  // personalidad elegida y su recordatorio de estilo viaja junto a
  // la pregunta; con el tono «custom», el prompt es el que la
  // persona escribió (y sin texto propio, el de por defecto). Antes
  // de esta cura la personalidad persistía sin aplicarse a ninguna
  // respuesta y las instrucciones propias no tenían escritor.
  const personalityId = await getPersonalityId().catch(() => "succinct" as const);
  const personality = PERSONALITIES.find((p) => p.id === personalityId);
  const customPrompt = await getCustomSystemPrompt().catch(() => "");
  const systemPrompt =
    personalityId === "custom"
      ? customPrompt.trim().length > 0
        ? customPrompt
        : DEFAULT_SYSTEM_PROMPT
      : (personality?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const styleReminder = personalityId === "custom" ? undefined : personality?.styleReminder;
  // Las dependencias se reconstruyen POR TURNO: el censo de
  // presencia de la fábrica (H-1) se mide al construirlas, y un
  // modelo descargado a mitad de sesión entra en el siguiente
  // turno sin reiniciar nada (obligación del llamador, §2.1 de la
  // preparación de la cura).
  const deps = await productionTurnDeps({
    handlers: buildToolHandlers({
      requestConfirm: (req) =>
        askConfirm(event, {
          kind: "tool",
          tool: req.tool,
          title: req.title,
          scope: req.scope ?? null,
          message: req.message,
        }),
    }),
    packFacts: async () => {
      const all = await loadAllPackFacts();
      return { regions: all.regions, facts: all.facts };
    },
    onConfirmTool: (decision, action) =>
      askConfirm(event, policyConfirmPayload(decision, action, lang)),
  });
  // L-4: un solo turno en vuelo. Sin esta guarda, un segundo
  // envío pisaba el AbortController del primero y el stop caía
  // sobre el turno equivocado; el segundo envío se rechaza en
  // llano y el primero sigue siendo el dueño de la señal.
  if (currentAbort) return { ok: false, reason: "turn-in-flight" };
  const abort = new AbortController();
  currentAbort = abort;
  // E10 (paso 6): la sesión de la corrida profunda. Si el
  // turno reanuda una sesión guardada, su foto entra como
  // punto de partida y sus datos (pregunta, ámbito, estilo)
  // gobiernan; si es una corrida nueva con el modo activo,
  // nace una sesión nueva y el pipeline va guardando su foto
  // al cerrar cada etapa. Un fallo del almacén no tumba el
  // turno: la corrida sigue sin sesión, como antes del paso.
  let researchSession: TurnInput["researchSession"];
  let researchSessionId: string | null = null;
  if (args.researchSessionId) {
    const row = await getResearchSession(args.researchSessionId).catch(() => null);
    if (row && row.stage !== "done") {
      researchSessionId = row.id;
      researchSession = {
        resume: row.snapshot,
        scope: row.scope as "packs" | "documents" | "both",
        style: row.style as ResearchStyle,
        onStageClosed: (snapshot) =>
          saveResearchSessionStage({
            id: row.id,
            query: row.query,
            lang: row.lang,
            scope: row.scope,
            style: row.style,
            snapshot,
          }).catch(() => undefined),
      };
    }
  }
  if (!researchSession && args.researchMode === true) {
    researchSessionId = randomUUID();
    const newId = researchSessionId;
    researchSession = {
      onStageClosed: (snapshot) =>
        saveResearchSessionStage({
          id: newId,
          query: args.text,
          lang,
          scope: args.researchPlan?.scope ?? "both",
          style: args.researchPlan?.style ?? "completo",
          snapshot,
        }).catch(() => undefined),
    };
  }
  // N1 (la integridad del turno, en la forma del móvil):
  // el mensaje de la persona se empuja y se sella ANTES de
  // generar, como el `persistMessage` de su pantalla, para
  // que un fallo del motor no se lo lleve con la respuesta
  // que no llegó. El historial del turno se compone aquí,
  // con los turnos de antes del empuje (la pregunta entra
  // una vez, como consulta, no dos) y fuera los asistentes
  // marcados `failed` de turnos anteriores: el modelo oye
  // lo que la persona dijo, no una respuesta fantasma
  // vacía. El guardado previo no es el del asentamiento:
  // un VaultLockedError no tumba el turno (la bóveda se
  // está bloqueando; el drenaje lo abortará y su
  // asentamiento retendrá el par por la forma (c), como
  // hoy) y cualquier otro error sigue lanzando, con el
  // turno ya en memoria.
  const history = conv.turns
    .slice(conv.summarizedTurns)
    .filter((t) => !(t.role === "assistant" && t.failed))
    .map((t) => ({
      role: t.role,
      content: t.text,
    }));
  const sentAt = new Date().toISOString();
  conv.turns.push({ role: "user", text: turnText, at: sentAt });
  conv.updatedAt = sentAt;
  try {
    await saveConversations();
  } catch (err) {
    if (!(err instanceof VaultLockedError)) throw err;
  }
  let firstTokenSeen = false;
  let result: TurnResult;
  const turnStartedAt = Date.now();
  try {
    result = await runTurn(
      {
        query: turnText,
        lang,
        systemPrompt,
        styleReminder,
        history,
        summary: conv.summary,
        researchMode: args.researchMode === true,
        researchPlan: args.researchPlan,
        researchSession,
        guideKey: args.guideKey,
        signal: abort.signal,
        onToken: (chunk) => {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            event.sender.send("nido:turn-phase", { phase: "writing" });
          }
          event.sender.send("nido:turn-token", { conversationId: conv.id, chunk });
        },
        // C-4 del cableado de chat: la fase de búsqueda del
        // turno viaja por el mismo canal firmado que la de
        // escritura, sin canal nuevo.
        onPhase: (phase) => {
          event.sender.send("nido:turn-phase", { phase });
        },
      },
      deps,
    );
  } catch (err) {
    // N1, el asentamiento del fallo: el turno de la
    // persona ya está empujado y sellado (el empuje
    // previo); al lado se asienta su asistente del fallo,
    // vacío y marcado `failed`, el borrador interrumpido
    // del móvil con los materiales de esta carcasa, y el
    // par se sella por la misma vía del asentamiento del
    // éxito. Un fallo de ESTE guardado no tapa el error
    // original (la retención de la forma (c) ya ocurrió
    // dentro si era de bóveda; si no lo era, el par queda
    // en memoria y lo sella cualquier guardado posterior
    // que viva, la conducta de hoy para los guardados que
    // no son de bóveda). El resumen no corre: es mejora
    // del éxito, no condición del turno. Y el error
    // original sigue su camino de siempre: la respuesta
    // del canal no cambia, y la conversación, al
    // refrescar o reabrir, enseña el mensaje con su marca
    // al lado en vez de no enseñar nada.
    const failedAt = new Date().toISOString();
    conv.turns.push({ role: "assistant", text: "", failed: true, at: failedAt });
    conv.updatedAt = failedAt;
    await saveSettledTurns(conv, bornWithThisTurn).catch(() => undefined);
    throw err;
  } finally {
    if (currentAbort === abort) currentAbort = null;
  }
  // E10 (paso 5): el informe de una investigación servida se
  // guarda como documento en la memoria cifrada, con sus dos
  // recibos; su id viaja con el turno para que la superficie
  // lo exporte solo por acción explícita. Un fallo al guardar
  // no tumba el turno: el informe ya se sirvió en el chat.
  let researchReportId: string | null = null;
  if (result.research) {
    researchReportId = await saveResearchReport({
      query: args.text,
      style: result.research.style,
      completoText: result.research.styles.completo,
      receipt: result.research.receipt,
      lang,
    })
      .then((r) => r.id)
      .catch(() => null);
  }
  // La última tasa real de la barra (S-1): tokens del texto
  // servido entre el tiempo del turno, medida en esta máquina;
  // sin generación no se toca (la barra enseña la anterior o
  // ninguna, nunca una inventada).
  if (result.text.trim().length > 0 && llamaEngine.isLoaded) {
    const seconds = Math.max(0.001, (Date.now() - turnStartedAt) / 1000);
    const tokens = llamaEngine.countTokens(result.text);
    if (tokens > 0) lastGenRate = Math.round((tokens / seconds) * 10) / 10;
  }
  // E11 (paso 5): la fracción de contexto del turno, medida
  // por el propio turno; sin dato no se toca (el panel
  // enseña la anterior o su hueco, nunca una inventada).
  if (result.contextNote) lastContextFraction = result.contextNote.fractionUsed;
  const now = new Date().toISOString();
  // E6 (paso 7): cada fuente guardada lleva su etiqueta desde
  // el metadato («Contrato · pág. 7») y, si es de un documento
  // personal paginado, el texto de su página y su cabecera
  // servidos desde la base cifrada para el panel (Tiempo 1 de
  // §7.3). Un fallo al servir el panel degrada a la forma de
  // antes (título y cuerpo del fragmento), nunca rompe el
  // guardado del turno.
  const panelSources = await Promise.all(
    result.sources.map(async (s) => {
      const panel = await sourcePanelData(s, lang).catch(() => null);
      return {
        title: s.title,
        label: panel?.label ?? s.title,
        body: s.body,
        truncated: s.truncated,
        // El porcentaje de relevancia de §1.5 viaja con la fuente:
        // es el rawScore absoluto (coseno acotado), nunca el score
        // fusionado relativo, como la letra de retrieve.types
        // manda («the UI renders rawScore, never score»). Las
        // fuentes solo léxicas no traen rawScore y no enseñan
        // porcentaje: no existe uno honesto para ellas.
        rawScore: typeof s.rawScore === "number" ? s.rawScore : undefined,
        pageHeader: panel?.pageHeader ?? undefined,
        pageText: panel?.pageText ?? undefined,
      };
    }),
  );
  // C-1 del cableado de chat: la nota de contexto se decide
  // aquí, en el principal, y desde los turnos guardados: el
  // estado de la decisión se deriva de las notas ya
  // persistidas (una de cualquier tipo ya enseñó la de
  // llenado; una de cesión ya enseñó la de cesión), no de un
  // estado de sesión que muere con la vista. El tipo
  // decidido se guarda con el turno, en la forma de L-7,
  // para que la superficie lo pinte de él al servir la
  // conversación, también tras reabrirla.
  const noteState = {
    fillingShown: conv.turns.some((t) => t.role === "assistant" && t.contextNote),
    droppingShown: conv.turns.some((t) => t.role === "assistant" && t.contextNote === "dropping"),
  };
  // Los turnos que vuelven antes del presupuesto (las rutas
  // fijas, la guía forzada, la bifurcación del agente) no
  // traen el dato: sin dato no hay decisión y no se guarda
  // nota, la misma tolerancia que la vista tenía.
  const decided: { note: "filling" | "dropping" | null } = result.contextNote
    ? decideContextNote(noteState, result.contextNote)
    : { note: null };
  // N1: el turno de la persona ya está empujado desde
  // antes de generar (el empuje previo); el asentamiento
  // empuja solo el asistente, y el par queda el mismo.
  conv.turns.push(
    {
      role: "assistant",
      text: result.text,
      route: result.route,
      judgeMode: result.judgeMode,
      judgeStatus: result.judgeStatus,
      sources: panelSources,
      evidence: result.evidence,
      warnings: result.warnings,
      // L-7: las señales del resultado se guardan con el turno
      // para que la superficie las enseñe; no cruzan el puente
      // para morir sin lector.
      timedOut: result.timedOut,
      researchPreempted: result.researchPreempted,
      // E10 (paso 5): el informe de la investigación, con su
      // estilo, sus cuatro formas y sus recibos, y el id de su
      // documento guardado en la memoria cifrada.
      research: result.research,
      researchReportId: researchReportId ?? undefined,
      // G-1 en su variante A-2 (dirimen del asiento): la marca de
      // parada se persiste como sus hermanas, para que el turno
      // parado por el bloqueo o por el botón enseñe su estado al
      // reabrir la conversación, no solo en la sesión en que paró.
      stopped: result.stopped,
      contextNote: decided.note ?? undefined,
      at: now,
    },
  );
  conv.updatedAt = now;
  if (autoTitles && conv.turns.length === 2) conv.title = args.text.slice(0, 60);
  // El guardado del par asentado, con su poda y su
  // retención de la forma (c), vive en el ayudante que el
  // asentamiento del fallo comparte (saveSettledTurns).
  await saveSettledTurns(conv, bornWithThisTurn);
  // El resumen guardado: al crecer la conversación, los turnos
  // viejos se condensan con el productor de resúmenes (la misma
  // fachada, E-6) y quedan en el almacén cifrado.
  void maybeSummarize(conv, lang);
  return {
    ok: true,
    result: {
      text: result.text,
      route: result.route,
      judgeMode: result.judgeMode ?? null,
      judgeStatus: result.judgeStatus ?? null,
      sources: result.sources,
      evidence: result.evidence,
      warnings: result.warnings,
      stopped: result.stopped,
      timedOut: result.timedOut,
      contextNote: result.contextNote ?? null,
      researchPreempted: result.researchPreempted,
      research: result.research,
      researchReportId: researchReportId ?? undefined,
      researchSessionId: researchSessionId ?? undefined,
      generationModelResident: result.generationModelResident,
    },
    conversation: conv,
  };
}

/**
 * La poda de las sesiones guardadas, espejo del móvil
 * (MainActivity: podarSesionesGuardadas): si el campo
 * `maxSavedSessions` pone un tope y la lista lo excede, se
 * conservan las de `updatedAt` más reciente hasta el tope y
 * siempre la del turno en curso; con el campo en 0 no hay
 * tope y no sale ninguna. Corre en el asentamiento del
 * turno, antes del guardado que sigue, de modo que el blob
 * sellado ya es el podado; no corre al desbloquear ni en
 * ningún otro guardado, y la lista en memoria y el blob no
 * divergen jamás. Si el almacén no responde, manda el
 * compuesto por defecto (tope 10), el mismo espíritu que la
 * puerta del resumidor. Podar es orden de la casa, no
 * condición del turno: un fallo aquí deja la lista intacta
 * y el turno sigue.
 */
async function pruneSavedSessions(currentId: string): Promise<void> {
  try {
    const memory = await getMemorySettings().catch(() => DEFAULT_MEMORY_SETTINGS);
    const max = memory.maxSavedSessions;
    if (max <= 0 || conversations.length <= max) return;
    const keep = new Set(
      [...conversations]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, max)
        .map((c) => c.id),
    );
    keep.add(currentId);
    conversations = conversations.filter((c) => keep.has(c.id));
  } catch {
    /* la poda es orden de la casa, no condición del turno */
  }
}

async function maybeSummarize(conv: Conversation, lang: Lang): Promise<void> {
  // A-2: el ajuste de resumen automático GOBIERNA: apagado, no
  // se resume. Antes la casilla escribía y releía su valor en un
  // circuito cerrado y esta función resumía sin leerla jamás.
  // Cableado, pieza 2: la puerta cobra el campo
  // `historyTurnThreshold` del ajuste, en la forma del móvil
  // (ChatScreen.kt: tal vez resumir lee el umbral del ajuste y
  // la puerta es `<= umbral`). El literal 10 que corría aquí no
  // tenía fuente en el móvil. CAMBIO DE CONDUCTA DECLARADO:
  // sin ajuste escrito, la puerta pasa de 10 a 6 turnos sin
  // resumir, el espejo del defecto del móvil; la batería de la
  // pieza lo certifica con su caso del defecto. Si el almacén
  // no responde, manda el compuesto por defecto entero, el
  // mismo espíritu que el resto de lecturas de esta carcasa.
  const memory = await getMemorySettings().catch(() => DEFAULT_MEMORY_SETTINGS);
  if (memory.autoSummarize === false) return;
  const unsummarized = conv.turns.length - conv.summarizedTurns;
  if (unsummarized <= memory.historyTurnThreshold) return;
  const slice = conv.turns.slice(conv.summarizedTurns, conv.turns.length - 6);
  if (slice.length === 0) return;
  try {
    const summary = await summarizeConversation(
      slice.map((t) => ({ role: t.role, text: t.text })),
      conv.summary,
      lang,
    );
    conv.summary = summary;
    conv.summarizedTurns += slice.length;
    await saveConversations();
  } catch {
    /* el resumen es una mejora, no una condición del turno */
  }
}

// ---------------------------------------------------------------------
// Modelos, ajustes y el Acerca de
// ---------------------------------------------------------------------

function machineSnapshot(): MachineSnapshot {
  return { totalRamBytes: totalmem(), freeRamBytes: freemem() };
}

/**
 * El nombre llano del modelo (P-1, DISENO-PC §1.5): la cabecera
 * del chat y el bloque de la recomendación enseñan la familia y
 * el tamaño, sin cuantización ni sufijos técnicos; el nombre
 * técnico entero vive en el gestor de modelos. La derivación es
 * mecánica sobre la etiqueta de catálogo: fuera el paréntesis de
 * cuantización, fuera «Instruct», la fecha de la revisión y los
 * sufijos de arquitectura, y el guion de familia pasa a espacio.
 */
export function plainModelLabel(label: string): string {
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/-A\d+B\b/g, "")
    .replace(/\bInstruct\b/g, "")
    .replace(/-?2507\b/g, "")
    .replace(/\bIT\b/g, "")
    .replace(/^([A-Za-z][A-Za-z]*[0-9.]*)-/, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function modelList(): unknown {
  const d = dirs();
  const resident = llamaEngine.getModelInfo()?.filename ?? null;
  const residentBase = resident ? resident.split("/").pop() : null;
  return DESKTOP_CATALOG.map((entry) => {
    const installed = existsSync(path.join(d.models, `${entry.id}.gguf`));
    const plan = installed ? planDesktopContext(entry, machineSnapshot()) : null;
    const w = plan?.workingSet;
    return {
      id: entry.id,
      label: entry.label,
      plainLabel: plainModelLabel(entry.label),
      kind: entry.kind,
      license: entry.license,
      sizeBytes: entry.fileBytes,
      installed,
      resident: residentBase === `${entry.id}.gguf`,
      // El veredicto de encaje entero (H-M4): green/yellow/red/
      // unknown de planDesktopContext, no un booleano que llama
      // «cabe» a cualquier plan medido.
      fit: plan?.fit ?? "unknown",
      contextSize: plan?.contextSize ?? null,
      // §5 del bloque del loop (H-LOOP-7): la cuenta que el plan
      // ya calcula, con la forma de serializeCard, también en
      // esta serialización: la ficha la enseña desde el
      // bootstrap, en arranque limpio, sin esperar a la lista
      // del gestor (que paga el censo) ni a cargar el modelo.
      breakdown: w
        ? {
            weights: w.weightsBytes,
            kv: w.kvBytes,
            compute: w.computeBytes,
            logits: w.logitsBytes,
            total: w.totalBytes,
          }
        : null,
      budgetBytes: plan?.budgetBytes ?? null,
    };
  });
}

function recommendation(): unknown {
  const snapshot = machineSnapshot();
  const budget = availableBudgetBytes(snapshot);
  // El incumplimiento de P-R2, en su mitad de superficie
  // (auditoría de modelos, H-M1 y H-M3): la recomendación
  // enseñada es la calculada firmada, la escalera de escritorio
  // sobre el mismo presupuesto que el bloque enseña en su cuenta.
  // La función del móvil recomendaba siempre el 1.5B (o el 0.5B
  // ausente, con su undefined alcanzable: H-M2) tuviera la
  // máquina 6 o 64 GiB. La diferencia aceptada P-R2 en sí sigue
  // cerrando en E4.
  const recommended = defaultModelForBudget(budget);
  const entry = DESKTOP_CATALOG.find((e) => e.id === recommended.id);
  const plan = entry ? planDesktopContext(entry, snapshot) : null;
  return {
    budgetBytes: budget,
    modelId: recommended.id,
    label: entry?.label ?? recommended.id,
    plainLabel: entry ? plainModelLabel(entry.label) : recommended.id,
    sizeBytes: entry?.fileBytes ?? null,
    fit: plan?.fit ?? "unknown",
    contextSize: plan?.contextSize ?? null,
    totalRamBytes: snapshot.totalRamBytes,
  };
}

/**
 * El gestor de modelos de E4 (paso 6): singleton perezoso del
 * proceso principal. Su `loadEngine` se cablea a la fachada del
 * turno, para que el residente de la superficie sea el mismo
 * que conversa (un solo residente en la app, como manda
 * DISENO §4.1); la fachada planea su propio contexto y lo
 * reporta al gestor por `contextSize`. El gestor aporta lo
 * que la carcasa no tenía: censo con huella, descargas con
 * progreso y pausa, descarte, y las tarjetas derivadas.
 */
let modelManager: ModelManager | null = null;
async function manager(): Promise<ModelManager> {
  if (!modelManager) {
    modelManager = await ModelManager.open(dirs().models, {
      loadEngine: async (entry) => {
        await llamaEngine.load(`${entry.id}.gguf`);
        return {
          unload: () => llamaEngine.unload(),
          countTokens: (text: string) => llamaEngine.countTokens(text),
          contextSize: llamaEngine.getModelInfo()?.nCtx,
        };
      },
      // M-02-P: cada reciclado de la válvula deja su lectura
      // asentada en el registro local (una línea JSON por evento,
      // junto a los demás datos de la app), para que el dirimen de
      // M-02 tenga uso real acumulado que leer. Solo eventos: en
      // una sesión sin deriva el fichero ni nace. Un fallo del
      // apéndice no toca la activación que lo disparó.
      onRecycle: (info) => {
        const line = JSON.stringify({ at: new Date().toISOString(), ...info }) + "\n";
        void appendFile(path.join(dirs().base, "m02-registro.jsonl"), line, "utf8").catch(() => undefined);
      },
    });
  }
  return modelManager;
}

/** La tarjeta del gestor, serializada para la superficie. */
function serializeCard(m: ModelManager, card: ModelCard): unknown {
  const w = card.plan?.workingSet;
  return {
    id: card.entry.id,
    label: card.entry.label,
    plainLabel: plainModelLabel(card.entry.label),
    kind: card.entry.kind,
    role: card.entry.role,
    license: card.entry.license,
    note: card.entry.note,
    sizeBytes: card.entry.fileBytes,
    installed: card.disk.kind === "installed",
    resident: card.resident,
    fit: card.plan?.fit ?? "unknown",
    contextSize: card.plan?.contextSize ?? null,
    breakdown: w
      ? {
          weights: w.weightsBytes,
          kv: w.kvBytes,
          compute: w.computeBytes,
          logits: w.logitsBytes,
          total: w.totalBytes,
        }
      : null,
    budgetBytes: card.plan?.budgetBytes ?? null,
    degradation: card.degradation,
    recommended: card.recommended,
    state: card.state,
    action: card.action,
    transfer: card.transfer ?? null,
    error: m.errorFor(card.entry.id)?.kind ?? null,
  };
}

async function modelManagerData(light = false): Promise<Record<string, unknown>> {
  const m = await manager();
  if (!light) await m.refresh();
  return {
    ok: true,
    models: m.cards().map((c) => serializeCard(m, c)),
    recommendation: recommendation(),
  };
}

function systemName(): string {
  const t = osType();
  if (t === "Windows_NT") return `Windows ${osRelease()}`;
  if (t === "Darwin") return `macOS ${osRelease()}`;
  return `${t} ${osRelease()}`;
}

async function buildInfo(): Promise<string> {
  try {
    const raw = await readFile(path.join(app.getAppPath(), "build-info.json"), "utf8");
    const parsed = JSON.parse(raw) as { build?: string };
    return typeof parsed.build === "string" ? parsed.build : "dev";
  } catch {
    return "dev";
  }
}

async function aboutData(): Promise<unknown> {
  const lang = prefs.lang as SupportLang;
  const resident = llamaEngine.getModelInfo()?.filename ?? null;
  const residentBase = resident ? resident.split("/").pop() : null;
  const residentEntry = residentBase
    ? DESKTOP_CATALOG.find((e) => residentBase === `${e.id}.gguf`)
    : undefined;
  const report = composeProblemReport(lang, {
    version: app.getVersion(),
    system: systemName(),
    memoryClass: `${Math.max(1, Math.round(totalmem() / 1024 ** 3))} GB`,
    modelName: residentEntry?.label ?? null,
    lastError: lastError ? `${lastError.reason} · ${lastError.at}` : null,
  });
  return {
    version: app.getVersion(),
    build: await buildInfo(),
    repoUrl: "github.com/Nido007-cmyk/Nido008",
    repoOpenUrl: "https://github.com/Nido007-cmyk/Nido008",
    reportOpenUrl: "https://github.com/Nido007-cmyk/Nido008/issues/new",
    copyrightLine: "Copyright (c) 2026 NIDO contributors",
    solanaAddress: SOLANA_ADDRESS,
    baseAddress: BASE_ADDRESS,
    salvoraNote: SALVORA_NOTE[lang],
    report,
    // La tarjeta del móvil nace SIN enlace en esta tanda: su
    // dirección es dato vivo que fija E13 en sus pasos 2 y 3, y
    // un artefacto con un enlace provisional es NO CONFORME.
    mobileCardUrl: null,
    machine: hostname(),
  };
}

/**
 * La vista de la sección de paquetes (paso 8 de E5): las filas
 * de la derivación del núcleo en su forma serializable, con la
 * nota de SALVORA servida de la fuente única en el idioma de la
 * interfaz (su segunda sede). El aviso de otro modelo de
 * embeddings viaja como bandera: es un aviso, no un estado.
 */
async function packsData(): Promise<{
  rows: {
    kind: string;
    key: string;
    name: string;
    origin: string;
    originLabel: string;
    edition: string | null;
    state: string;
    canInstall: boolean;
    canRemove: boolean;
    filename: string;
    importedAt: string | null;
    verified: boolean | null;
    embeddingWarning: boolean;
  }[];
  note: string;
}> {
  const lang = prefs.lang as SupportLang;
  const rows = await derivePackSectionRows();
  return {
    rows: rows.map((r) => ({
      kind: r.kind,
      key: r.key,
      name: r.name,
      origin: r.origin,
      originLabel: r.originLabel,
      edition: r.edition,
      state: r.state,
      canInstall: r.canInstall,
      canRemove: r.canRemove,
      filename: r.filename,
      importedAt: r.importedAt,
      verified: r.verified,
      embeddingWarning: r.embeddingWarning != null,
    })),
    note: packSectionNote(lang),
  };
}

/**
 * Las secciones del lector de guías (B-1): por cada paquete
 * instalado con guías, su id, su etiqueta y sus guías desde
 * el núcleo, en su orden. Un paquete sin guías no abre
 * sección y un fallo de lectura de un paquete lo deja fuera,
 * nunca tumba el índice entero: la misma composición que la
 * pantalla del móvil hace sobre el mismo núcleo.
 */
async function packGuideSections(): Promise<
  { packId: string; name: string; guides: PackGuideEntry[] }[]
> {
  const known = await knowledgePacks();
  const sections: { packId: string; name: string; guides: PackGuideEntry[] }[] = [];
  for (const pack of known) {
    const guides = await listPackGuides(pack.id).catch(() => [] as PackGuideEntry[]);
    if (guides.length > 0) sections.push({ packId: pack.id, name: pack.label, guides });
  }
  return sections;
}

async function libraryData(): Promise<{
  packs: { id: string; name: string; outdated: boolean }[];
  factCount: number;
}> {
  // El censo honesto de la Biblioteca (auditoría de la
  // Biblioteca): los paquetes que están en el dispositivo, por
  // su nombre para personas — los de catálogo que la puerta de
  // E5 descarga y los importados por fichero, que knowledgePacks
  // ya reúne con el nombre del registro de importación — y el
  // total de datos verificados una sola vez, no un contador
  // idéntico pintado en cada fila. Un paquete desactualizado se
  // enseña con su estado, no desaparece en silencio.
  try {
    const all = await loadAllPackFacts();
    const outdated = new Set(all.outdatedPacks);
    const known = await knowledgePacks();
    const rows: { id: string; name: string; outdated: boolean }[] = [];
    for (const pack of known) {
      let present = false;
      try {
        present = existsSync(packsDataPath(pack.filename));
      } catch {
        present = false;
      }
      if (!present) continue;
      rows.push({ id: pack.id, name: pack.label, outdated: outdated.has(pack.label) });
    }
    return { packs: rows, factCount: all.facts.length };
  } catch {
    return { packs: [], factCount: 0 };
  }
}

async function diskStats(): Promise<{ diskUsedBytes: number | null; diskTotalBytes: number | null }> {
  try {
    const { statfs } = await import("node:fs/promises");
    const st = await statfs(app.getPath("userData"));
    const total = Number(st.blocks) * Number(st.bsize);
    const free = Number(st.bfree) * Number(st.bsize);
    return { diskUsedBytes: total - free, diskTotalBytes: total };
  } catch {
    return { diskUsedBytes: null, diskTotalBytes: null };
  }
}

const EXTERNAL_ALLOWLIST = [
  "https://github.com/Nido007-cmyk/Nido008",
  "https://github.com/Nido007-cmyk/Nido/releases",
  "https://salvorapacks.com",
];

// ---------------------------------------------------------------------
// Instalación de los canales
// ---------------------------------------------------------------------

// Puerta .ics/.vcf: la forma común de los dos resúmenes
// del núcleo, para viajar al renderizador como DTO con
// códigos. El núcleo describe en español; la superficie
// compone en el idioma de la persona, así que cada
// descarte conocido se clasifica por su razón exacta y
// solo el desconocido viaja con el texto del núcleo
// como caída. Los conteos viajan como números y los
// grupos nombrados como cuenta entera con los primeros
// 50 nombres: el núcleo los trae como listas sin
// cortar, y el corte vive en este DTO.
interface AgendaImportRawSummary {
  rejected: string | null;
  total: number;
  enterCount: number;
  recurring: number;
  alreadyPresent: number;
  discarded: Array<{ what: string; reason: string }>;
  named: {
    exdate: string[];
    valarm: string[];
    unboundedRrule: string[];
    tzid: string[];
    withoutUid: number;
    truncatedFields: number;
  } | null;
}

function agendaDiscardedDto(what: string, reason: string): {
  code: string;
  label: string | null;
  prop: string | null;
  text: string;
} {
  const label = /«([^»]*)»/.exec(what)?.[1] ?? null;
  let code = "other";
  let prop: string | null = null;
  if (reason === "sin DTSTART") code = "event-no-start";
  else if (reason === "DTSTART fuera del subconjunto de v1") code = "event-start-out-of-subset";
  else if (reason.startsWith("su recurrencia pasa de 2.000")) code = "event-too-many-occurrences";
  else if (reason.startsWith("RRULE fuera del subconjunto")) code = "recurrence-out-of-subset";
  else if (reason === "pasa de 64 KB desplegada") {
    code = "property-too-large";
    prop = /^la propiedad (\S+) de/.exec(what)?.[1] ?? null;
  } else if (reason === "la ficha de NIDO no guarda fotos en v1") code = "photo-not-stored";
  else if (reason === "sin FN") code = "card-no-name";
  return { code, label, prop, text: `${what} — ${reason}` };
}

function agendaImportSummaryDto(raw: AgendaImportRawSummary): {
  rejectedCode: string | null;
  rejectedText: string | null;
  total: number;
  enter: number;
  alreadyPresent: number;
  recurring: number;
  discarded: ReturnType<typeof agendaDiscardedDto>[];
  named: {
    exdate: { count: number; names: string[] };
    valarm: { count: number; names: string[] };
    unboundedRrule: { count: number; names: string[] };
    tzid: { count: number; names: string[] };
    withoutUid: number;
    truncatedFields: number;
  } | null;
} {
  let rejectedCode: string | null = null;
  let rejectedText: string | null = null;
  if (raw.rejected) {
    if (raw.rejected.includes("25 MB")) rejectedCode = "too-large";
    else if (raw.rejected.includes("línea física")) rejectedCode = "line-too-long";
    else if (raw.rejected.includes("20.000")) rejectedCode = "too-many";
    else rejectedText = raw.rejected;
  }
  const capGroup = (names: string[]) => ({ count: names.length, names: names.slice(0, 50) });
  return {
    rejectedCode,
    rejectedText,
    total: raw.total,
    enter: raw.enterCount,
    alreadyPresent: raw.alreadyPresent,
    recurring: raw.recurring,
    discarded: raw.discarded.map((d) => agendaDiscardedDto(d.what, d.reason)),
    named: raw.named
      ? {
          exdate: capGroup(raw.named.exdate),
          valarm: capGroup(raw.named.valarm),
          unboundedRrule: capGroup(raw.named.unboundedRrule),
          tzid: capGroup(raw.named.tzid),
          withoutUid: raw.named.withoutUid,
          truncatedFields: raw.named.truncatedFields,
        }
      : null,
  };
}

// La vista previa y el commit comparten el motor: el
// núcleo con `confirmed: false` no escribe nada (su
// resumen R4), y con `confirmed: true` guarda y arma
// los avisos en la misma transacción de cada almacén.
async function runAgendaImport(
  kind: "ics" | "vcf",
  text: string,
  confirmed: boolean,
): Promise<{ raw: AgendaImportRawSummary; inserted: number }> {
  if (kind === "ics") {
    const { importIcs } = await import("../../src/agent/memory/calendarIcs.js");
    const { summary, inserted } = await importIcs(text, { confirmed });
    return {
      inserted,
      raw: {
        rejected: summary.rejected,
        total: summary.totalEvents,
        enterCount: summary.enter.length,
        recurring: summary.enter.filter((d) => d.rrule !== null).length,
        alreadyPresent: summary.alreadyPresent,
        discarded: summary.discarded,
        named: summary.named,
      },
    };
  }
  const { importVcf } = await import("../../src/agent/memory/contactVcf.js");
  const { summary, inserted } = await importVcf(text, { confirmed });
  return {
    inserted,
    raw: {
      rejected: summary.rejected,
      total: summary.totalCards,
      enterCount: summary.enter.length,
      recurring: 0,
      alreadyPresent: summary.alreadyPresent,
      discarded: summary.discarded,
      named: null,
    },
  };
}

export async function installServices(): Promise<void> {
  // El cierre de la ventana drena las confirmaciones pendientes
  // (H-1): ninguna promesa del loop queda colgada sin proceso.
  app.on("before-quit", () => drainPendingConfirms());
  app.on("window-all-closed", () => drainPendingConfirms());
  // E11 (paso 7): la llegada en frío: si el arranque trae
  // un enlace en sus argumentos, queda retenido antes de
  // que exista ventana, para entregarlo tras el desbloqueo.
  noteLinkFromArgv(process.argv);
  await mkdir(dirs().vault, { recursive: true });
  await mkdir(dirs().store, { recursive: true });
  await mkdir(dirs().knowledge, { recursive: true });
  await mkdir(dirs().models, { recursive: true });
  await loadPrefs();
  // O-12: el historial de acciones persiste desde el arranque
  // de los servicios: el sumidero del registro queda conectado
  // y cada entrada se guarda en la base cifrada cuando la
  // bóveda está abierta (sin base, queda solo en memoria).
  startActionLogPersistence();
  // E8 (paso 3): el ejecutor de avisos arranca con los servicios:
  // su reloj corre desde la agenda de disparo también con la
  // bóveda bloqueada, que es su razón de ser. El paso 4 le da
  // además los textos del despacho en el idioma de la persona
  // y el ajuste de enseñar texto de §5.3.
  startNoticeRuntime({
    isVaultOpen: () => session != null,
    texts: () => dispatchTextsFromStrings(stringsFor(prefs.lang)),
    showText: async () => {
      const { getNoticesShowText } = await import("../../src/models/settings.js");
      return getNoticesShowText();
    },
  });
  // E8 (paso 8): el disparo de tareas programadas — revisión
  // al desbloquear, cada 60 s y al volver la ventana a primer
  // plano, con las tres guardas del móvil en su módulo.
  startTaskRuntime({
    isVaultOpen: () => session != null,
    isTurnInFlight: () => inFlightTurn != null,
    isModelReady: () => llamaEngine.isLoaded,
    lang: () => prefs.lang,
    strings: () => stringsFor(prefs.lang),
  });
  app.on("browser-window-focus", () => pokeTaskRuntime());
  // E8 (paso 6): la carcasa de avisos — la bandeja del
  // residente y el canal del SO — se instala con los
  // servicios: registra el sumidero de las notificaciones y
  // obedece el residente ya decidido. El estado de su menú
  // sale de la agenda (horas y números, nunca contenido) y
  // del contador de avisos sin atender.
  {
    const { getNoticesResident, getNoticesAutostart } = await import("../../src/models/settings.js");
    const residentOn = (await getNoticesResident().catch(() => undefined)) === true;
    // El arranque con el sistema se reaplica desde su
    // interruptor: si su fuente real se borró por fuera, la
    // elección de la persona vuelve a escribirse.
    const autostartOn = await getNoticesAutostart().catch(() => false);
    try {
      if (autostartEnabledNow() !== autostartOn) applyAutostart(autostartOn);
    } catch { /* la fuente del SO manda; Ajustes enseña su estado real */ }
    installNoticeShell(
      {
        texts: () => trayTextsFromStrings(stringsFor(prefs.lang)),
        status: async () => {
          const { readNoticeAgenda } = await import("../../src/agent/memory/noticeAgenda.js");
          const agenda = await readNoticeAgenda().catch(() => ({ entries: [], pending: [], preFiredFor: {} }));
          const now = Date.now();
          const future = agenda.entries.filter((e) => e.nextFireAt > now).sort((a, b) => a.nextFireAt - b.nextFireAt);
          const timerEnd = future.find((e) => e.kind === "timer");
          let unattended = agenda.pending.length;
          if (session) {
            const { listNoticeView } = await import("../../src/agent/memory/noticeStore.js");
            const rows = await listNoticeView().catch(() => []);
            unattended = rows.filter((n) => n.state === "fired" || n.state === "missed" || n.state === "fired-pending").length;
          }
          return {
            nextFireAt: future[0]?.nextFireAt ?? null,
            nearestTimerEnd: timerEnd?.nextFireAt ?? null,
            unattended,
            now,
          };
        },
        onNotificationAction: async (noticeId, action) => {
          const store = await import("../../src/agent/memory/noticeStore.js");
          const now = Date.now();
          if (action === "done" || action === "discard") await store.markDone(noticeId);
          else if (action === "snooze") await store.snoozeNotice(noticeId, now + 10 * 60_000, now);
          else if (action === "pause") await store.pauseTimer(noticeId, now);
          else if (action === "resume") await store.resumeTimer(noticeId, now);
          refreshTrayMenu();
        },
      },
      residentOn,
    );
  }
  // El directorio de modelos se registra ya: el censo de presencia
  // y la recomendación de S-8 se miden antes de desbloquear.
  setLlamaModelsDir(dirs().models);
  // A-1: aquí NO se lee el idioma sellado. Antes del registro
  // §8.9 la lectura cae al directorio por defecto y degrada al
  // idioma del dispositivo, que pisaba prefs.lang en cada
  // arranque: la app abría en el idioma del dispositivo desde la
  // puerta. El idioma se cobra al desbloquear (onUnlocked), con
  // los proveedores ya registrados.

  handle("nido:bootstrap", async () => ({
    ok: true,
    vault: { exists: vaultExists(), unlocked: session != null },
    prefs,
    strings: stringsFor(prefs.lang),
    models: modelList(),
    recommendation: recommendation(),
    conversations: session
      ? // C-3: «Recientes» ordena por actividad, no por creación.
        [...conversations]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            turns: c.turns,
            summary: c.summary,
          }))
      : [],
    about: await aboutData(),
    library: await libraryData(),
    memorySettings: session ? await getMemorySettings().catch(() => null) : null,
    noticesPermissionAsked: session ? await getNoticesPermissionAsked().catch(() => false) : false,
    noticesShowText: session ? await getNoticesShowText().catch(() => true) : true,
    // E8 (paso 6): el residente (null = aún no decidido), el
    // arranque leído de su fuente real del SO y la custodia
    // de las horas de la agenda.
    noticesResident: await getNoticesResident().catch(() => undefined) ?? null,
    noticesAutostart: autostartEnabledNow(),
    noticesCustody: noticeAgendaCustody(),
    // E9 (paso 5): los tres gobiernos de la sección Voz.
    voiceInputEnabled: session ? await getVoiceInputEnabled().catch(() => true) : true,
    readAloudEnabled: session ? await getReadAloudEnabled().catch(() => false) : false,
    voiceSystemReserveEnabled: session
      ? await getVoiceSystemReserveEnabled().catch(() => true)
      : true,
    // E10 (paso 1): el modo de investigación profunda, leído de
    // su ajuste (apagado por defecto, como en el móvil): la
    // superficie lo enseña en su chip y lo honra en cada turno.
    deepResearchMode: session ? await getDeepResearchMode().catch(() => false) : false,
    // E11 (paso 1): la posición del ajuste de envío, leída
    // de su ajuste (Intro envía por defecto): el composer
    // y la hoja de atajos la honran en la posición vigente.
    sendOnEnter: session ? await getSendOnEnter().catch(() => true) : true,
    // E11 (paso 6): el escalón de tamaño del texto, leído
    // del almacén: la superficie aplica su factor a
    // --font-scale y el selector lo enseña en su sitio.
    fontScaleStep: session ? await getFontScale().catch(() => "standard" as const) : "standard",
    // E11 (O-1·E11): el desenlace de la rotación del
    // último desbloqueo, para que Seguridad lo enseñe.
    rotationOutcome,
    personality: session ? await getPersonalityId().catch(() => null) : null,
    guideVisited: session ? await getGuideVisited().catch(() => []) : [],
    disabledTools: session ? await getDisabledToolNames().catch(() => []) : [],
    customSystemPrompt: session ? await getCustomSystemPrompt().catch(() => "") : "",
    stats: {
      ramUsedBytes: totalmem() - freemem(),
      ramTotalBytes: totalmem(),
      ...(await diskStats()),
      lastGenRate,
      // E11 (paso 5): las dos fuentes que el panel suma a
      // las del pie: la fracción de contexto del último
      // turno medido y la memoria de la propia app, leída
      // en este principal al componer el bootstrap.
      contextUsedFraction: lastContextFraction,
      appMemoryBytes: process.memoryUsage().rss,
    },
  }));

  handle("nido:vault-create", async (_e, args: { password: string }) => {
    if (vaultExists()) return { ok: false, reason: "already-exists" };
    if (typeof args?.password !== "string" || [...args.password].length < 8) {
      return { ok: false, reason: "password-too-short" };
    }
    const provider = new PasswordCustodyProvider(args.password);
    await initializeVault(dirs().vault, provider);
    const sess = await VaultSession.unlock(dirs().vault, [provider], {
      idleTimeoutMs: IDLE_TIMEOUT_MS,
    });
    await onUnlocked(sess);
    return { ok: true };
  });

  handle("nido:vault-unlock", async (_e, args: { password: string }) => {
    if (!vaultExists()) return { ok: false, reason: "no-vault" };
    try {
      const provider = new PasswordCustodyProvider(args.password);
      const sess = await VaultSession.unlock(dirs().vault, [provider], {
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      });
      // E11 (O-1·E11): la recuperación y la rotación
      // pedida se asientan aquí, antes de que onUnlocked
      // abra ninguna base con la sesión.
      await settlePendingRotation(sess, provider);
      await onUnlocked(sess);
      return { ok: true };
    } catch (err) {
      // Las causas no se funden (auditoría del arranque): un
      // blob dañado no es una contraseña equivocada, y decirlo
      // mal condena a la persona a reintentar para siempre.
      if (err instanceof VaultBlobError) return { ok: false, reason: "vault-corrupt" };
      return { ok: false, reason: "wrong-password" };
    }
  });

  handle("nido:vault-lock", async () => {
    session?.lock();
    if (session == null) await onLocked();
    return { ok: true };
  });

  handle("nido:prefs-set", async (_e, args: { patch: Partial<Prefs> }) => {
    const patch = args?.patch ?? {};
    if (patch.theme === "daylight" || patch.theme === "night") prefs.theme = patch.theme;
    if (patch.lang === "es" || patch.lang === "en" || patch.lang === "pt") {
      prefs.lang = patch.lang;
      if (session) await setLanguageId(patch.lang).catch(() => undefined);
    }
    if (typeof patch.sidebarWidth === "number") {
      prefs.sidebarWidth = Math.min(360, Math.max(240, patch.sidebarWidth));
    }
    if (typeof patch.sidebarCollapsed === "boolean") {
      prefs.sidebarCollapsed = patch.sidebarCollapsed;
    }
    await savePrefs();
    return { ok: true, prefs, strings: stringsFor(prefs.lang) };
  });

  handle("nido:turn-send", async (event, args: never) => {
    // F-UI-10 (a-i): la puerta cobra el vuelo como primera
    // línea, en la forma de la guarda del borrado (C-7/C-8):
    // el rechazo llega antes de crear conversación ni
    // construir dependencias, y ninguna conversación
    // fantasma nace de un envío condenado. La guarda tardía
    // de runOneTurn queda como red de la ventana entre el
    // asentamiento de runTurn y la liberación de
    // inFlightTurn.
    if (inFlightTurn) return { ok: false, reason: "turn-in-flight" };
    const p = runOneTurn(event, args);
    inFlightTurn = p;
    try {
      return await p;
    } finally {
      if (inFlightTurn === p) inFlightTurn = null;
    }
  });
  handle("nido:turn-stop", async () => {
    currentAbort?.abort();
    drainPendingConfirms();
    return { ok: true };
  });

  // E10 (paso 4): el plan de investigación de un turno, antes
  // de enviarlo. La superficie lo pide con el modo activo: si
  // el turno se serviría por otra ruta o la segunda red
  // intercepta, el resultado lo dice y el envío corre normal;
  // si hay plan, la persona lo ve, lo edita y el envío lo trae
  // de vuelta en el payload de turn-send. Planear no crea
  // conversación ni toca el historial.
  handle("nido:research-plan", async (_event, args: { text: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (inFlightTurn) return { ok: false, reason: "turn-in-flight" };
    const deps = await productionTurnDeps({
      handlers: buildToolHandlers({
        requestConfirm: async () => false,
      }),
      packFacts: async () => {
        const all = await loadAllPackFacts();
        return { regions: all.regions, facts: all.facts };
      },
    });
    const outcome = await planTurn(
      {
        query: args.text,
        lang: prefs.lang,
        systemPrompt: "",
        researchMode: true,
      },
      deps,
    );
    return { ok: true, outcome };
  });

  // E10 (paso 5): la exportación del informe guardado, solo
  // por acción explícita de la persona sobre su turno: lee el
  // documento de la memoria cifrada y lo escribe como .md en
  // sus Descargas, con nombre desduplicado como el entregador
  // de colecciones. Nada se exporta solo.
  handle("nido:research-report-export", async (_event, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const report = await getResearchReport(args.id).catch(() => null);
    if (!report) return { ok: false, reason: "not-found" };
    const downloads = app.getPath("downloads");
    const stamp = report.createdAt.slice(0, 10);
    let filename = `nido-investigacion-${stamp}.md`;
    let n = 2;
    while (existsSync(path.join(downloads, filename))) {
      filename = `nido-investigacion-${stamp}-${n}.md`;
      n += 1;
    }
    await writeFile(path.join(downloads, filename), report.document, "utf8");
    return { ok: true, delivered: filename };
  });

  // E11 (paso 4): la exportación de la conversación, solo
  // por acción expresa de la persona (R6). Tres gestos con
  // su canal: el diálogo de guardar (la persona elige el
  // destino; cancelar no escribe nada), la escritura en el
  // destino elegido y el arrastre fuera (la carcasa
  // necesita el fichero real en disco y su icono para
  // empezar el arrastre del sistema). Nada se exporta
  // solo, ni por temporizador ni como efecto de otro gesto.
  // E11 (paso 7): la entrega del enlace retenido. La
  // ventana dice el último número que ya aplicó; si el
  // retenido es más nuevo, se resuelve contra el mundo de
  // ahora y se devuelve con su número. Con la bóveda
  // bloqueada la resolución es la retención misma: la
  // ventana no lo marca aplicado y lo vuelve a pedir tras
  // desbloquear, cuando el mundo ya puede dirimirlo.
  // E11 (paso 9): la búsqueda global en las
  // conversaciones, sobre el índice cifrado. Sin sesión
  // (o sin su base) se niega con su razón: la superficie
  // enseña el estado honesto, no una lista vacía fingida.
  // E11 (O-1·E11): el respaldo de la bóveda, por gesto
  // expreso en la sesión: el llamante de E2 cierra las
  // bases gestionadas en un .nidbackup con su contraseña
  // de respaldo (distinta de la de la bóveda; el destino
  // lo eligió la persona en el diálogo de guardar).
  handle("nido:backup-export", async (_e, args: { destPath: string; backupPassword: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.destPath !== "string" || args.destPath.length === 0) {
      return { ok: false, reason: "no-dest" };
    }
    if (typeof args?.backupPassword !== "string" || args.backupPassword.length < 8) {
      return { ok: false, reason: "backup-password-short" };
    }
    try {
      const manifest = await exportVaultBackup({
        dir: dirs().vault,
        dbNames: managedDbNames(),
        session,
        destPath: args.destPath,
        backupPassword: args.backupPassword,
      });
      return { ok: true, entries: manifest.entries.map((e) => e.path) };
    } catch (err) {
      return {
        ok: false,
        reason: "backup-failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // E11 (O-1·E11): pedir la rotación de la clave. El
  // gesto re-autentica aquí mismo (la credencial debe
  // desenvolver la DEK de la sesión: si no, no se pide
  // nada), deja la intención guardada y reinicia la app:
  // la rotación se ejecuta en el próximo desbloqueo,
  // antes de que se abra ninguna base, que es la única
  // posición en la que ningún mango vivo guarda la clave
  // vieja. La respuesta no vuelve: el proceso sale.
  handle("nido:vault-rotate-request", async (_e, args: { password: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.password !== "string" || args.password.length === 0) {
      return { ok: false, reason: "no-password" };
    }
    try {
      const { dek } = await unlockVaultWith(dirs().vault, [
        new PasswordCustodyProvider(args.password),
      ]);
      if (!dek.equals(session.dek)) return { ok: false, reason: "reauth-failed" };
    } catch {
      return { ok: false, reason: "reauth-failed" };
    }
    prefs.pendingRotation = true;
    await savePrefs().catch(() => undefined);
    session.lock();
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  handle("nido:conversation-search", async (_e, args: { query: string }) => {
    if (!session || !searchDb) return { ok: false, reason: "locked" };
    const hits = searchConversationIndex(
      searchDb,
      typeof args?.query === "string" ? args.query : "",
    );
    return { ok: true, hits };
  });

  handle("nido:link-pending", async (_e, args: { afterSeq?: number }) => {
    const after = typeof args?.afterSeq === "number" ? args.afterSeq : 0;
    if (!pendingLink || pendingLink.seq <= after) {
      return { ok: true, seq: linkSeq, resolution: null };
    }
    const r = resolvePendingLink();
    return { ok: true, seq: r?.seq ?? linkSeq, resolution: r?.resolution ?? null };
  });

  handle("nido:export-save-dialog", async (event, args: { defaultName: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts = {
      defaultPath: typeof args?.defaultName === "string" ? args.defaultName : "conversacion.md",
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    return { ok: true, path: r.canceled || !r.filePath ? null : r.filePath };
  });

  handle("nido:export-write", async (_e, args: { path: string; content: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.path !== "string" || args.path.length === 0) {
      return { ok: false, reason: "no-path" };
    }
    if (typeof args?.content !== "string") return { ok: false, reason: "no-content" };
    await writeFile(args.path, args.content, "utf8");
    return { ok: true };
  });

  handle("nido:export-drag-start", async (event, args: { fileName: string; content: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.fileName !== "string" || typeof args?.content !== "string") {
      return { ok: false, reason: "bad-payload" };
    }
    const safeName = path.basename(args.fileName);
    const dir = path.join(app.getPath("userData"), "export-tmp");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName);
    await writeFile(file, args.content, "utf8");
    const iconCandidates = [
      path.join(app.getAppPath(), "public", "mascot-nido.png"),
      path.join(app.getAppPath(), "dist", "mascot-nido.png"),
    ];
    const iconPath = iconCandidates.find((p) => existsSync(p));
    if (!iconPath) return { ok: false, reason: "no-icon" };
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return { ok: false, reason: "no-icon" };
    event.sender.startDrag({ file, icon });
    return { ok: true };
  });

  // E10 (paso 6): las sesiones de investigación guardadas:
  // la lista para la superficie (reanudar o borrar) y el
  // borrado, que la superficie confirma con la misma puerta
  // de doble toque del chat antes de llamar aquí.
  handle("nido:research-sessions", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const sessions = await listResearchSessions().catch(() => []);
    return { ok: true, sessions };
  });

  handle("nido:research-session-delete", async (_event, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    await deleteResearchSession(args.id).catch(() => undefined);
    return { ok: true };
  });

  ipcMain.on("nido:confirm-response", (event, args: { id: string; approved: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !isAppUrl(event.sender.getURL())) return;
    const resolve = pendingConfirms.get(args?.id);
    if (resolve) {
      pendingConfirms.delete(args.id);
      resolve(args.approved === true);
    }
  });

  handle("nido:conversation-delete", async (_e, args: { id: string }) => {
    // C-7/C-8: el canal cobra sesión y existencia, y no borra la
    // conversación que un turno en vuelo está sirviendo (su guardado
    // la resucitaría o descartaría el turno en silencio).
    if (!session) return { ok: false, reason: "locked" };
    if (inFlightTurn) return { ok: false, reason: "turn-in-flight" };
    const existed = conversations.some((c) => c.id === args.id);
    if (!existed) return { ok: false, reason: "not-found" };
    conversations = conversations.filter((c) => c.id !== args.id);
    await saveConversations();
    return { ok: true };
  });

  handle("nido:models-list", async (_e, args?: { light?: boolean }) =>
    modelManagerData(args?.light === true),
  );
  handle("nido:model-download", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const entry = DESKTOP_CATALOG.find((e) => e.id === args.id);
    if (!entry) return { ok: false, reason: "unknown-model" };
    const m = await manager();
    try {
      await m.download(args.id);
      return await modelManagerData(true);
    } catch (err) {
      // Pausar no es fallar: la tarjeta queda en su estado.
      if (err instanceof DownloadPaused) {
        return { ...(await modelManagerData(true)), paused: true };
      }
      return {
        ok: false,
        reason: "download-failed",
        error: err instanceof Error ? err.message : String(err),
        ...(await modelManagerData(true)),
      };
    }
  });
  handle("nido:model-download-pause", async (_e, args: { id: string }) => {
    const m = await manager();
    m.pauseDownload(args.id);
    return { ok: true };
  });
  handle("nido:model-discard", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const m = await manager();
    await m.discard(args.id);
    return await modelManagerData(true);
  });
  handle("nido:model-load", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const entry = DESKTOP_CATALOG.find((e) => e.id === args.id);
    if (!entry) return { ok: false, reason: "unknown-model" };
    // P-4: una carga cada vez, y con época de bloqueo. Con un
    // turno generando, la activación descargaría el contexto
    // bajo la generación en curso: se rechaza como el reintento.
    if (loadInFlight) return { ok: false, reason: "load-in-flight" };
    if (currentAbort) return { ok: false, reason: "turn-in-flight" };
    loadInFlight = true;
    const epoch = loadEpoch;
    try {
      const m = await manager();
      await m.activate(args.id);
      if (epoch !== loadEpoch) {
        await llamaEngine.unload().catch(() => undefined);
        return { ok: false, reason: "locked-during-load" };
      }
      // A-20: la carga escribe el ajuste de modelo activo. Sin
      // esta escritura el gestor activaba y el turno, que lee
      // el activo de los ajustes en cada turno, volvía al
      // modelo por defecto tras un reinicio: la elección de la
      // persona se perdía. El fallo de la escritura no se
      // traga: la carga se reporta fallida y se reintenta.
      if (entry.kind === "llm") await setActiveModelId("llm", args.id);
      return await modelManagerData(true);
    } catch (err) {
      lastError = {
        reason: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      return { ok: false, reason: "load-failed", error: lastError.reason };
    } finally {
      loadInFlight = false;
    }
  });
  handle("nido:model-load-retry-less", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    // Reintento con menos memoria: se libera lo residente que no
    // es el modelo pedido (la residencia del e5 y cualquier otro
    // modelo) y se vuelve a intentar la carga por la vía única.
    const entry = DESKTOP_CATALOG.find((e) => e.id === args.id);
    if (!entry) return { ok: false, reason: "unknown-model" };
    if (loadInFlight) return { ok: false, reason: "load-in-flight" };
    // P-4: con un turno generando, el unload del reintento
    // dispondría el contexto bajo la generación en curso.
    if (currentAbort) return { ok: false, reason: "turn-in-flight" };
    loadInFlight = true;
    const epoch = loadEpoch;
    try {
      await llamaEngine.unload().catch(() => undefined);
      await embeddingEngine.unload().catch(() => undefined);
      const m = await manager();
      await m.activate(args.id);
      if (epoch !== loadEpoch) {
        await llamaEngine.unload().catch(() => undefined);
        return { ok: false, reason: "locked-during-load" };
      }
      // A-20: el reintento escribe el mismo ajuste que la
      // carga normal (ver nido:model-load).
      if (entry.kind === "llm") await setActiveModelId("llm", args.id);
      return await modelManagerData(true);
    } catch (err) {
      return {
        ok: false,
        reason: "load-failed",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      loadInFlight = false;
    }
  });

  handle("nido:settings-set", async (_e, args: { personality?: string; memoryAutoSummarize?: boolean; memoryHistoryTurnThreshold?: number; memoryMaxSavedSessions?: number; memoryAutoGenerateTitles?: boolean; customSystemPrompt?: string; disabledTools?: unknown; noticesPermissionAsked?: boolean; noticesShowText?: boolean; noticesResident?: boolean; noticesAutostart?: boolean; voiceInputEnabled?: boolean; readAloudEnabled?: boolean; voiceSystemReserveEnabled?: boolean; deepResearchMode?: boolean; sendOnEnter?: boolean; fontScaleStep?: string }) => {
    // A-3 y A-7: las escrituras selladas exigen la sesión viva
    // (una escritura desde una lectura degradada reescribiría el
    // fichero sellado desde defaults) y su resultado se cobra:
    // un fallo vuelve como fallo, no como un ok tragado.
    if (!session) return { ok: false, reason: "locked" };
    try {
      if (typeof args?.personality === "string") {
        await setPersonalityId(args.personality as never);
      }
      if (typeof args?.customSystemPrompt === "string") {
        // El escritor de las instrucciones propias (A-4): sin él,
        // el tono «custom» no tenía forma de existir en la app.
        await setCustomSystemPrompt(args.customSystemPrompt);
      }
      if (typeof args?.memoryAutoSummarize === "boolean") {
        await setMemorySettings({ autoSummarize: args.memoryAutoSummarize });
      }
      // Cableado, pieza 2: los tres campos de memoria restantes
      // entran como argumentos hermanos por el mismo canal (sin
      // canal nuevo: el censo queda en 39). Los dos numéricos se
      // validan contra su conjunto, el de sus píldoras en la
      // vista: un valor fuera de conjunto no persiste (ese campo
      // se salta y el resto de la escritura aplica), el espíritu
      // de la guarda m-32 llevado al canal: lo no válido se
      // ignora, no se guarda.
      if (
        typeof args?.memoryHistoryTurnThreshold === "number" &&
        [4, 6, 8, 10].includes(args.memoryHistoryTurnThreshold)
      ) {
        await setMemorySettings({ historyTurnThreshold: args.memoryHistoryTurnThreshold });
      }
      if (
        typeof args?.memoryMaxSavedSessions === "number" &&
        [10, 25, 50, 0].includes(args.memoryMaxSavedSessions)
      ) {
        await setMemorySettings({ maxSavedSessions: args.memoryMaxSavedSessions });
      }
      if (typeof args?.memoryAutoGenerateTitles === "boolean") {
        await setMemorySettings({ autoGenerateTitles: args.memoryAutoGenerateTitles });
      }
      if (typeof args?.noticesPermissionAsked === "boolean") {
        // E7 (paso 6): la fila de permiso de la zona «Avisos»
        // entra por el canal que ya existe (sin canal nuevo):
        // guarda que el permiso ya se pidió una vez.
        await setNoticesPermissionAsked(args.noticesPermissionAsked);
      }
      if (typeof args?.noticesShowText === "boolean") {
        // E8 (§5.3): el ajuste de enseñar el texto en las
        // notificaciones, por el mismo canal existente.
        await setNoticesShowText(args.noticesShowText);
      }
      if (typeof args?.noticesResident === "boolean") {
        // E8 (paso 6): el residente, por el mismo canal: se
        // guarda la decisión y la carcasa la obedece en el
        // acto (la bandeja nace o se retira sin reiniciar).
        await setNoticesResident(args.noticesResident);
        applyResidentSetting(args.noticesResident);
      }
      if (typeof args?.noticesAutostart === "boolean") {
        // E8 (paso 6): el arranque con el sistema se escribe
        // en su fuente real del SO; el ajuste guarda la
        // elección y el bootstrap lee el estado de la fuente.
        await setNoticesAutostart(args.noticesAutostart);
        try {
          applyAutostart(args.noticesAutostart);
        } catch { /* la fuente manda: el bootstrap enseña su estado real */ }
      }
      // E9 (paso 5): los tres gobiernos de la sección Voz, por
      // el canal que ya existe (sin canal nuevo).
      if (typeof args?.voiceInputEnabled === "boolean") {
        await setVoiceInputEnabled(args.voiceInputEnabled);
      }
      if (typeof args?.readAloudEnabled === "boolean") {
        await setReadAloudEnabled(args.readAloudEnabled);
      }
      if (typeof args?.voiceSystemReserveEnabled === "boolean") {
        await setVoiceSystemReserveEnabled(args.voiceSystemReserveEnabled);
      }
      // E10 (paso 1): el chip de investigación profunda persiste
      // su estado en el ajuste, por el canal que ya existe (sin
      // canal nuevo): la superficie lo lee al arrancar y el
      // turno lo honra en el mismo gesto, como en el móvil.
      if (typeof args?.deepResearchMode === "boolean") {
        await setDeepResearchMode(args.deepResearchMode);
      }
      // E11 (paso 1): el ajuste de envío persiste por el
      // canal que ya existe (sin canal nuevo), en la forma
      // del modo de investigación: la superficie lo lee al
      // arrancar y el composer lo honra en el mismo gesto.
      if (typeof args?.sendOnEnter === "boolean") {
        await setSendOnEnter(args.sendOnEnter);
      }
      // E11 (paso 6): el escalón de tamaño persiste por el
      // canal que ya existe (sin canal nuevo), validado
      // contra los cinco valores del contrato.
      if (
        args?.fontScaleStep === "small" ||
        args?.fontScaleStep === "compact" ||
        args?.fontScaleStep === "standard" ||
        args?.fontScaleStep === "large" ||
        args?.fontScaleStep === "extra-large"
      ) {
        await setFontScale(args.fontScaleStep);
      }
      if (Array.isArray(args?.disabledTools)) {
        // Los permisos del agente: el cuarto campo del canal que
        // ya existe (sin canal nuevo, el censo no se mueve). Se
        // persiste primero y el conjunto en memoria se alimenta
        // desde lo persistido: una sola verdad, la del almacén,
        // y el turno siguiente obedece sin reiniciar la app,
        // como en el móvil el toggle actualiza memoria y disco
        // en el mismo gesto. La validación espeja la del lector
        // y la ordenación la pone el propio setDisabledToolNames.
        const names = args.disabledTools.filter(
          (n): n is string => typeof n === "string" && n.length > 0,
        );
        await setDisabledToolNames(names);
        setDisabledTools(await getDisabledToolNames());
      }
    } catch (err) {
      lastError = {
        reason: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      return { ok: false, reason: "settings-write-failed", error: lastError.reason };
    }
    return { ok: true };
  });

  // Las marcas de visto de la guía (pasada de la guía): viven en
  // los ajustes cifrados, cosméticas si se pierden; la escritura
  // exige la sesión viva, como las demás escrituras selladas.
  handle("nido:guide-mark", async (_e, args: { key?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.key !== "string" || args.key.length === 0) {
      return { ok: false, reason: "bad-key" };
    }
    await markGuideVisited(args.key);
    return { ok: true, guideVisited: await getGuideVisited().catch(() => []) };
  });

  // La sección de paquetes de Ajustes (paso 8 de E5): la lista
  // se deriva en cada gesto desde las tres fuentes por la
  // derivación del núcleo, y las acciones corren por la puerta
  // real (descarga verificada, importación con confirmación que
  // nombra el origen verificado, retirada con sus tres
  // borrados). La carcasa no implementa descarga ni verifica
  // nada por su cuenta.
  handle("nido:packs-list", async () => {
    if (!session) return { ok: false, reason: "locked" };
    return { ok: true, ...(await packsData()) };
  });

  // El lector de guías de la Biblioteca (B-1 del bloque de
  // cableado): el índice y el documento se componen desde el
  // núcleo (listPackGuides / readPackGuide), que nunca carga
  // un motor; un paquete sin guías no abre sección, como en
  // la pantalla del móvil. Y el canal de B-4 en su rama β
  // dirimida: la tarjeta de paquetes deriva su foto al
  // entrar desde el mismo libraryData() que el bootstrap
  // compone, con boot.library como foto inicial.
  handle("nido:pack-guides", async () => {
    if (!session) return { ok: false, reason: "locked" };
    return { ok: true, sections: await packGuideSections() };
  });

  handle("nido:pack-guide-read", async (_e, args: { packId?: string; guideId?: number }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.packId !== "string" || typeof args?.guideId !== "number") {
      return { ok: true, doc: null };
    }
    return { ok: true, doc: await readPackGuide(args.packId, args.guideId) };
  });

  handle("nido:library-data", async () => {
    if (!session) return { ok: false, reason: "locked" };
    return { ok: true, ...(await libraryData()) };
  });

  handle("nido:pack-install", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const entry = PACK_CATALOG.find((e) => e.id === args.id);
    if (!entry) return { ok: false, reason: "unknown-pack" };
    const rows = await derivePackSectionRows();
    const row = rows.find((r) => r.kind === "catalog" && r.key === entry.id);
    if (!row) return { ok: false, reason: "unknown-pack" };
    try {
      await installPackRow(row);
    } catch (err) {
      return {
        ok: false,
        reason: "install-failed",
        error: err instanceof Error ? err.message : String(err),
        ...(await packsData()),
      };
    }
    return { ok: true, ...(await packsData()) };
  });

  // La ruta del fichero llega del renderizador (su input de
  // fichero o el arrastre sobre la sección, resueltos por
  // webUtils en el preload): el paquete no contiene ningún
  // selector libre del proceso principal (censo D-1 del
  // endurecimiento de la carcasa). La puerta firmada juzga el
  // fichero igual: la confirmación nombra el origen verificado
  // antes de copiar.
  handle("nido:pack-import-path", async (event, args: { path: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const chosen = typeof args?.path === "string" ? args.path : "";
    if (chosen === "") return { ok: false, reason: "no-path", ...(await packsData()) };
    const outcome = await importPackRow(chosen, (origin) =>
      askConfirm(event, {
        kind: "pack-import",
        scope: PACK_ORIGIN_LABEL[origin],
        message: `${chosen.split(/[\\/]/).pop() ?? chosen} · ${PACK_ORIGIN_LABEL[origin]}`,
      }),
    );
    return { ok: true, outcome, ...(await packsData()) };
  });

  // E6 (paso 7): la importación de documentos personales. Las
  // rutas llegan del renderizador (su input de fichero,
  // resuelto por webUtils en el preload), como las de los
  // paquetes: el proceso principal no abre ningún selector
  // libre. El lote entra como UNA colección con el nombre del
  // primer fichero (o el que la superficie pase), y el
  // resultado lleva sus avisos por fichero en su vocabulario.
  handle("nido:documents-import", async (_e, args: { paths: string[]; name?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const paths = Array.isArray(args?.paths)
      ? args.paths.filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];
    if (paths.length === 0) return { ok: false, reason: "no-paths" };
    const files: PickedDocumentFile[] = [];
    for (const p of paths) {
      const st = await stat(p).catch(() => null);
      files.push({ uri: p, name: p.split(/[\\/]/).pop() ?? p, size: st ? st.size : null });
    }
    const fallback = files[0].name.replace(/\.[^.]+$/, "");
    const name = typeof args?.name === "string" && args.name.trim().length > 0 ? args.name.trim() : fallback;
    try {
      const created = await importDocuments(files, name);
      return {
        ok: true,
        name: created.name,
        chunkCount: created.chunkCount,
        warnings: created.importWarnings ?? [],
      };
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      return {
        ok: false,
        reason: typeof code === "string" ? code : "import-failed",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  // E6 (paso 8): la Biblioteca de documentos personales. La
  // lista lleva la medida real de cada colección (la suma
  // viva de M-32, nunca la estimación del selector), sus
  // documentos desde el registro y sus vectores pendientes
  // de reindexado; activar, borrar y exportar devuelven la
  // lista fresca para que la superficie enseñe el estado
  // nuevo sin otra vuelta.
  handle("nido:documents-list", async () => {
    if (!session) return { ok: false, reason: "locked" };
    return { ok: true, ...(await listLibraryCollections()) };
  });

  handle("nido:documents-set-active", async (_e, args: { id: string; active: boolean }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || typeof args?.active !== "boolean") {
      return { ok: false, reason: "bad-args" };
    }
    await setCustomCollectionActive(args.id, args.active);
    return { ok: true, ...(await listLibraryCollections()) };
  });

  handle("nido:documents-delete", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string") return { ok: false, reason: "bad-args" };
    await deleteCustomCollection(args.id);
    return { ok: true, ...(await listLibraryCollections()) };
  });

  handle("nido:documents-export", async (_e, args: { id: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string") return { ok: false, reason: "bad-args" };
    const collections = await listCustomCollections();
    const collection = collections.find((c) => c.id === args.id);
    if (!collection) return { ok: false, reason: "not-found" };
    lastExportDest = null;
    await exportCollection(collection);
    const dest = takeLastExportDest();
    return { ok: true, delivered: dest ? dest.split(/[\\/]/).pop() : null };
  });

  // §2 del bloque del loop (H-LOOP-5): la lista de la memoria.
  // Lo guardado por el chat vive en el almacén que los handlers
  // de herramientas ya despachan; estos dos canales son su
  // puente a la sección Memoria, con los topes de la pantalla
  // del móvil (hechos 100, notas 50, personas todas,
  // recordatorios 50) y las filas en la forma del almacén. La
  // fecha del recordatorio se compone AQUÍ, con la misma
  // `reminderWhen` del chat y el idioma de la sesión, porque el
  // renderizador es un paquete aparte y no debe arrastrar el
  // enrutador entero: la fila trae su `dueLabel` lista para
  // pintar (recortada y con la primera letra en mayúscula,
  // como la pinta el móvil).
  handle("nido:memory-list", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const [facts, notes, people, reminders] = await Promise.all([
      getFacts(100),
      listNotes(50),
      getPeople(),
      listReminders(50),
    ]);
    return {
      ok: true,
      facts,
      notes,
      people,
      reminders: reminders.map((r) => {
        const when = r.due_at ? reminderWhen(r.due_at, prefs.lang).trim() : "";
        return {
          ...r,
          dueLabel: when ? when.charAt(0).toUpperCase() + when.slice(1) : null,
        };
      }),
    };
  });

  handle("nido:memory-delete", async (_e, args: { kind?: string; id?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || args.id === "") {
      return { ok: false, reason: "bad-args" };
    }
    switch (args?.kind) {
      case "fact":
        await deleteFact(args.id);
        break;
      case "note":
        await deleteNote(args.id);
        break;
      case "person": {
        // E7 paso 4: la fila de la costura puede tener su ficha
        // en la agenda; borrar a la persona borra también la
        // ficha y desarma su aviso de cumpleaños, para que las
        // dos vistas no diverjan.
        const personRow = (await getPeople()).find((p) => p.id === args.id);
        await deletePerson(args.id);
        if (personRow) {
          const { findContactByName, deleteContact } = await import(
            "../../src/agent/memory/contactStore.js"
          );
          const ficha = await findContactByName(personRow.name).catch(() => null);
          if (ficha) await deleteContact(ficha.id).catch(() => undefined);
        }
        break;
      }
      case "reminder":
        await deleteReminder(args.id);
        break;
      default:
        return { ok: false, reason: "unknown-kind" };
    }
    return { ok: true };
  });

  // E7 (paso 6): los canales de la sección Agenda, sobre los
  // mismos almacenes que el chat usa (calendarStore,
  // contactStore y la cola de noticeStore): guardar por la
  // superficie es guardar por el almacén, con su aviso armado
  // o desarmado en la misma operación. La ventana de eventos
  // que se sirve es la de la agenda personal (un año vista,
  // un mes atrás); la ficha viaja con el instante de su
  // próximo aviso armado, para enseñarlo en su fila.
  handle("nido:agenda-data", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const { listEvents } = await import("../../src/agent/memory/calendarStore.js");
    const { listContacts } = await import("../../src/agent/memory/contactStore.js");
    const { listArmed, listNoticeView } = await import("../../src/agent/memory/noticeStore.js");
    const { readNoticeAgenda } = await import("../../src/agent/memory/noticeAgenda.js");
    const { noticeOwnText } = await import("../../src/agent/memory/noticeDispatcher.js");
    const now = Date.now();
    const events = await listEvents(now - 31 * 86400_000, now + 366 * 86400_000);
    const armed = await listArmed();
    const nextByRef = new Map<string, number>();
    for (const n of armed) {
      if (n.refId && !nextByRef.has(n.refId)) nextByRef.set(n.refId, n.nextFireAt);
    }
    const contacts = (await listContacts()).map((c) => ({
      ...c,
      nextNoticeAt: nextByRef.get(c.id) ?? null,
    }));
    // E8 (paso 4): el canal interno de los avisos. La lista
    // entera que no está cerrada, con lo que la vista necesita
    // para enseñarla y actuar sobre ella; `pending` marca los
    // que sonaron con la bóveda bloqueada (la lista pending de
    // la agenda), que la pasada de desbloqueo ya presentó.
    const pending = new Set((await readNoticeAgenda().catch(() => ({ pending: [] as string[] }))).pending);
    const notices = (await listNoticeView()).map((n) => ({
      id: n.id,
      kind: n.kind,
      refId: n.refId,
      text: noticeOwnText(n),
      state: n.state,
      baseLocal: n.baseLocal,
      repeat: n.repeat,
      nextFireAt: n.nextFireAt,
      snoozeUntil: n.snoozeUntil,
      lastFiredAt: n.lastFiredAt,
      missedCount: n.missedCount,
      snoozeCount:
        n.body && typeof n.body === "object" && typeof (n.body as { snoozeCount?: unknown }).snoozeCount === "number"
          ? ((n.body as { snoozeCount: number }).snoozeCount as number)
          : 0,
      seriesId:
        n.body && typeof n.body === "object" && typeof (n.body as { seriesId?: unknown }).seriesId === "string"
          ? ((n.body as { seriesId: string }).seriesId as string)
          : null,
      // E8 (paso 5): el fin absoluto y el restante en pausa
      // del temporizador, para su línea y sus botones.
      endsAt: n.endsAt,
      remainingMs:
        n.body && typeof n.body === "object" && typeof (n.body as { remainingMs?: unknown }).remainingMs === "number"
          ? ((n.body as { remainingMs: number }).remainingMs as number)
          : null,
      pending: pending.has(n.id),
    }));
    return { ok: true, events, contacts, notices };
  });

  handle("nido:notice-act", async (_e, args: {
    id?: string;
    action?: string;
    snoozeMinutes?: number;
    at?: number;
  }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || args.id === "") return { ok: false, reason: "bad-args" };
    const store = await import("../../src/agent/memory/noticeStore.js");
    const now = Date.now();
    let done = false;
    if (args.action === "done" || args.action === "discard") {
      done = await store.markDone(args.id);
    } else if (args.action === "snooze") {
      const target =
        typeof args.at === "number"
          ? args.at
          : now + (typeof args.snoozeMinutes === "number" ? args.snoozeMinutes : 10) * 60_000;
      done = (await store.snoozeNotice(args.id, target, now)) !== null;
    } else if (args.action === "reschedule" && typeof args.at === "number") {
      done = await store.rescheduleNotice(args.id, store.toBaseLocal(new Date(args.at)), now);
    } else if (args.action === "timer-pause") {
      done = (await store.pauseTimer(args.id, now)) !== null;
    } else if (args.action === "timer-resume") {
      done = (await store.resumeTimer(args.id, now)) !== null;
    } else {
      return { ok: false, reason: "bad-args" };
    }
    if (!done) return { ok: false, reason: "not-actionable" };
    // La vista relee por nido:agenda-data tras cada acción.
    return { ok: true };
  });

  // E8 (paso 8): las tareas programadas, con la misma forma
  // que los canales de agenda (sesión primero, fallo cerrado).
  handle("nido:tasks-list", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const { listTasks, getTaskRuns } = await import("../../src/agent/scheduled/taskStore.js");
    const tasks = await listTasks();
    const rows = [];
    for (const task of tasks) {
      const runs = await getTaskRuns(task.id, 1).catch(() => []);
      const last = runs[0];
      rows.push({
        ...task,
        lastRun: last
          ? { success: last.success, completedAt: last.completedAt, summary: last.summary, error: last.error ?? null }
          : null,
      });
    }
    return { ok: true, tasks: rows };
  });

  handle("nido:tasks-save", async (_e, args: {
    id?: string; name?: string; schedule?: string; instruction?: string;
    enabled?: boolean; allowedTools?: string[]; notifyOnComplete?: boolean;
  }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (
      typeof args?.name !== "string" || typeof args?.schedule !== "string" ||
      typeof args?.instruction !== "string"
    ) {
      return { ok: false, reason: "bad-args" };
    }
    const store = await import("../../src/agent/scheduled/taskStore.js");
    const pure = await import("../../src/agent/scheduled/scheduledTasks.js");
    const enabled = args.enabled ?? true;
    const fields = {
      name: args.name,
      schedule: args.schedule,
      instruction: args.instruction,
      enabled,
      allowedTools: Array.isArray(args.allowedTools) && args.allowedTools.length > 0
        ? args.allowedTools
        : [...pure.DEFAULT_TASK_TOOLS],
      notifyOnComplete: args.notifyOnComplete ?? true,
    };
    let task: import("../../src/agent/scheduled/scheduledTasks.js").ScheduledTask | null = null;
    if (typeof args.id === "string" && args.id !== "") {
      const existing = await store.getTask(args.id);
      if (!existing) return { ok: false, reason: "not-found" };
      const check = pure.validateTask(fields);
      if (!check.valid) return { ok: false, reason: "invalid", errors: check.errors };
      task = {
        ...existing,
        ...fields,
        nextRunAt: enabled ? pure.getNextRunTime(fields.schedule, Date.now()) : null,
      };
    } else {
      const existing = await store.listTasks();
      if (existing.length >= 10) return { ok: false, reason: "limit" };
      const made = pure.createTask(fields);
      if (!made.task) return { ok: false, reason: "invalid", errors: made.errors };
      task = made.task;
    }
    await store.saveTask(task);
    // El aviso de la próxima ejecución se (re)arma o se
    // desarma con la tarea, por la misma costura de siempre.
    const { scheduleTaskReminder } = await import("../../src/agent/scheduled/runScheduled.js");
    await scheduleTaskReminder(task, task.nextRunAt, taskRunStringsFromStrings(stringsFor(prefs.lang))).catch(() => undefined);
    return { ok: true, task };
  });

  handle("nido:tasks-delete", async (_e, args: { id?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || args.id === "") return { ok: false, reason: "bad-args" };
    const { deleteTask } = await import("../../src/agent/scheduled/taskStore.js");
    await deleteTask(args.id);
    const { cancelTaskNotification } = await import("../../src/notify/notifications.js");
    await cancelTaskNotification(args.id).catch(() => undefined);
    return { ok: true };
  });

  // O-12: el historial de acciones del agente, con la misma
  // forma que los canales de memoria y tareas (sesión primero,
  // fallo cerrado). La lista es la guardada en la base cifrada;
  // el deshacer cobra sobre la entrada guardada; el borrado
  // vacía el historial y no toca notas ni recordatorios.
  handle("nido:action-log-list", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const { listActions } = await import("../../src/agent/actionLogStore.js");
    return { ok: true, actions: await listActions() };
  });

  handle("nido:action-log-undo", async (_e, args: { id?: number }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "number") return { ok: false, reason: "bad-args" };
    const { listActions, undoAction } = await import("../../src/agent/actionLogStore.js");
    const entry = (await listActions(500)).find((a) => a.id === args.id);
    if (!entry) return { ok: false, reason: "not-found" };
    const done = await undoAction(entry);
    return done ? { ok: true } : { ok: false, reason: "not-actionable" };
  });

  handle("nido:action-log-clear", async () => {
    if (!session) return { ok: false, reason: "locked" };
    const { clearActions } = await import("../../src/agent/actionLogStore.js");
    await clearActions();
    // Como en el móvil: el registro en memoria se vacía con el
    // guardado, para que las dos vistas del historial coincidan.
    const { actionLog } = await import("../../src/agent/actionLog.js");
    actionLog.clear();
    return { ok: true };
  });

  handle("nido:agenda-event-save", async (_e, args: {
    id?: string; title?: string; notes?: string; location?: string;
    startsAt?: number; endsAt?: number; allDay?: boolean;
    alertOffsetMin?: number | null;
  }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.title !== "string" || typeof args?.startsAt !== "number" || typeof args?.endsAt !== "number") {
      return { ok: false, reason: "bad-args" };
    }
    const store = await import("../../src/agent/memory/calendarStore.js");
    const input = {
      title: args.title,
      notes: args.notes ?? "",
      location: args.location ?? "",
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      allDay: args.allDay ?? false,
      alertOffsetMin: args.alertOffsetMin ?? null,
    };
    const event = typeof args.id === "string" && args.id
      ? await store.updateEvent(args.id, input)
      : await store.createEvent({ ...input, origin: "ui" });
    if (!event) return { ok: false, reason: "not-found" };
    return { ok: true, event };
  });

  handle("nido:agenda-event-delete", async (_e, args: { id?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || args.id === "") return { ok: false, reason: "bad-args" };
    const { deleteEvent } = await import("../../src/agent/memory/calendarStore.js");
    await deleteEvent(args.id);
    return { ok: true };
  });

  handle("nido:agenda-contact-save", async (_e, args: {
    id?: string; name?: string; relation?: string;
    birthdayMonth?: number | null; birthdayDay?: number | null; birthdayYear?: number | null;
    phones?: Array<{ label: string; number: string }>;
    emails?: Array<{ label: string; address: string }>;
    notes?: string; alertLeadDays?: number;
  }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.name !== "string" || args.name.trim() === "") {
      return { ok: false, reason: "bad-args" };
    }
    const store = await import("../../src/agent/memory/contactStore.js");
    const input = {
      name: args.name,
      relation: args.relation ?? "",
      birthdayMonth: args.birthdayMonth ?? null,
      birthdayDay: args.birthdayDay ?? null,
      birthdayYear: args.birthdayYear ?? null,
      phones: Array.isArray(args.phones) ? args.phones : [],
      emails: Array.isArray(args.emails) ? args.emails : [],
      notes: args.notes ?? "",
      alertLeadDays: typeof args.alertLeadDays === "number" ? args.alertLeadDays : 0,
    };
    const contact = typeof args.id === "string" && args.id
      ? await store.updateContact(args.id, input)
      : await store.createContact({ ...input, origin: "ui" });
    if (!contact) return { ok: false, reason: "not-found" };
    return { ok: true, contact };
  });

  handle("nido:agenda-contact-delete", async (_e, args: { id?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    if (typeof args?.id !== "string" || args.id === "") return { ok: false, reason: "bad-args" };
    const { deleteContact } = await import("../../src/agent/memory/contactStore.js");
    await deleteContact(args.id);
    return { ok: true };
  });

  // Puerta .ics/.vcf: la importación por fichero de la
  // Agenda (el CARGO 1 de AUDIT-CABLEADO-E7E8: los
  // motores existían sin ningún llamante). La persona
  // elige el fichero en el renderizador y su ruta llega
  // por el argumento, como en documentos y paquetes;
  // el principal lo lee él mismo, con el tope aplicado
  // durante la lectura (el tamaño se mira antes de
  // leer), y retiene el texto en el hueco de su clase
  // con un testigo de un solo uso: el commit guarda
  // exactamente lo que el resumen anunció.
  handle("nido:agenda-import-preview", async (_e, args: { kind?: string; path?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const kind = args?.kind === "ics" || args?.kind === "vcf" ? args.kind : null;
    if (!kind || typeof args?.path !== "string" || args.path.length === 0) {
      return { ok: false, reason: "bad-args" };
    }
    const { ICS_LIMITS } = await import("../../src/agent/memory/calendarIcs.js");
    const st = await stat(args.path).catch(() => null);
    if (!st || !st.isFile()) return { ok: false, reason: "unreadable" };
    if (st.size > ICS_LIMITS.maxBytes) {
      // El mismo veredicto que el núcleo da sobre el
      // texto, sin leer un solo byte del fichero.
      pendingAgendaImports.delete(kind);
      return {
        ok: true,
        token: null,
        summary: agendaImportSummaryDto({
          rejected: "El fichero pasa de 25 MB: no se importó nada.",
          total: 0,
          enterCount: 0,
          recurring: 0,
          alreadyPresent: 0,
          discarded: [],
          named: null,
        }),
      };
    }
    const text = await readFile(args.path, "utf8").catch(() => null);
    if (text === null) return { ok: false, reason: "unreadable" };
    const { raw } = await runAgendaImport(kind, text, false);
    const summary = agendaImportSummaryDto(raw);
    if (summary.rejectedCode || summary.rejectedText) {
      pendingAgendaImports.delete(kind);
      return { ok: true, token: null, summary };
    }
    const token = randomUUID();
    pendingAgendaImports.set(kind, { token, text });
    return { ok: true, token, summary };
  });

  handle("nido:agenda-import-commit", async (_e, args: { kind?: string; token?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const kind = args?.kind === "ics" || args?.kind === "vcf" ? args.kind : null;
    if (!kind || typeof args?.token !== "string") return { ok: false, reason: "bad-token" };
    const pending = pendingAgendaImports.get(kind);
    if (!pending || pending.token !== args.token) return { ok: false, reason: "bad-token" };
    pendingAgendaImports.delete(kind);
    const { raw, inserted } = await runAgendaImport(kind, pending.text, true);
    return { ok: true, inserted, summary: agendaImportSummaryDto(raw) };
  });

  // La exportación simétrica: el fichero entero de la
  // clase, compuesto por el núcleo, para guardarlo por
  // los canales de guardado ya expuestos.
  handle("nido:agenda-export", async (_e, args: { kind?: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const kind = args?.kind === "ics" || args?.kind === "vcf" ? args.kind : null;
    if (!kind) return { ok: false, reason: "bad-args" };
    if (kind === "ics") {
      const { listEvents } = await import("../../src/agent/memory/calendarStore.js");
      const { exportIcs } = await import("../../src/agent/memory/calendarIcs.js");
      const events = await listEvents(0, Date.UTC(2100, 0, 1));
      return { ok: true, content: exportIcs(events), defaultName: "nido-calendario.ics" };
    }
    const { listContacts } = await import("../../src/agent/memory/contactStore.js");
    const { exportVcf } = await import("../../src/agent/memory/contactVcf.js");
    const contacts = await listContacts();
    return { ok: true, content: exportVcf(contacts), defaultName: "nido-contactos.vcf" };
  });

  handle("nido:pack-remove", async (_e, args: { filename: string }) => {
    if (!session) return { ok: false, reason: "locked" };
    const rows = await derivePackSectionRows();
    const row = rows.find((r) => r.kind === "imported" && r.key === args.filename);
    if (!row) return { ok: false, reason: "not-imported", ...(await packsData()) };
    await removePackRow(row);
    return { ok: true, ...(await packsData()) };
  });

  handle("nido:copy", async (_e, args: { text: string }) => {
    if (typeof args?.text === "string") clipboard.writeText(args.text);
    return { ok: true };
  });

  handle("nido:open-external", async (_e, args: { url: string }) => {
    const url = typeof args?.url === "string" ? args.url : "";
    if (!EXTERNAL_ALLOWLIST.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"))) {
      return { ok: false, reason: "not-allowed" };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  // -------------------------------------------------------------------
  // La voz (E9 paso 1): el dictado vive en su proceso propio
  // (voiceProcess.ts); estos canales son su única puerta. El
  // audio viaja del renderizador al gestor en muestras Float32
  // a 16 kHz por el canal de envío (sin respuesta, como
  // confirm-response), y los eventos de la sesión vuelven por
  // nido:voice-event al remitente que abrió la sesión. Nada de
  // esto toca el cauce del turno: el texto dictado aterriza en
  // el borrador del composer y entra, si la persona lo envía,
  // por la puerta del turno como cualquier texto tecleado.
  // -------------------------------------------------------------------
  handle("nido:voice-engine-state", async () => ({
    ok: true,
    state: await voiceManager().engineState(),
  }));

  handle("nido:voice-dictation-start", async (event) => {
    if (!session) return { ok: false, reason: "locked" };
    const sender = event.sender;
    await voiceManager().startSession((voiceEvent) => {
      if (!sender.isDestroyed()) sender.send("nido:voice-event", voiceEvent);
    });
    return { ok: true };
  });

  handle("nido:voice-dictation-stop", async () => {
    voiceManager().stopSession();
    return { ok: true };
  });

  ipcMain.on("nido:voice-dictation-audio", (event, chunk: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !isAppUrl(event.sender.getURL())) return;
    if (chunk instanceof ArrayBuffer) {
      voiceManager().pushAudio(new Float32Array(chunk));
    }
  });

  // -------------------------------------------------------------------
  // La lectura (E9 paso 2): Kokoro vive en el mismo proceso de
  // voz. La síntesis es por frases y vuelve en muestras por la
  // invocación (la orquestación y la reproducción son del
  // renderizador: src/voice/tts.ts y su adaptador); la suelta
  // la pide la superficie al terminar o detener la lectura.
  // -------------------------------------------------------------------
  handle("nido:voice-speak-state", async () => ({
    ok: true,
    state: await voiceManager().speechState(),
  }));

  handle("nido:voice-synth", async (_event, args: unknown) => {
    if (!session) return { ok: false, reason: "locked" };
    const a = (args ?? {}) as { text?: unknown; lang?: unknown };
    if (typeof a.text !== "string" || a.text.trim() === "") {
      return { ok: false, reason: "bad-request" };
    }
    const audio = await voiceManager().synthesize(
      a.text,
      typeof a.lang === "string" ? a.lang : "",
    );
    if (!audio) return { ok: false, reason: "unavailable" };
    return {
      ok: true,
      samples: audio.samples.buffer as ArrayBuffer,
      sampleRate: audio.sampleRate,
    };
  });

  handle("nido:voice-speak-release", async () => {
    await voiceManager().releaseSpeech();
    return { ok: true };
  });

  // -------------------------------------------------------------------
  // La tarjeta de activos de voz (E9 paso 5, firma 3): vive
  // en la sección Voz de Ajustes, no en el gestor de
  // modelos. Enseña cada activo con su tamaño ANTES de
  // descargar (la cuenta de H-7) y su estado del censo; la
  // instalación baja por la puerta del paso 0
  // (downloadAsset) al directorio de activos, con su
  // progreso empujado al remitente.
  // -------------------------------------------------------------------
  handle("nido:voice-assets", async () => {
    const census = await censusAssets(dirs().assets).catch(() => null);
    const rows = ASSET_CATALOG.map((entry) => {
      const state = census?.get(entry.id)?.state;
      return {
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        license: entry.license,
        archiveBytes: entry.archiveBytes,
        state: state?.kind ?? "absent",
        verified: state?.kind === "installed" ? state.verified : false,
      };
    });
    return { ok: true, rows };
  });

  const voiceInstallsInFlight = new Set<string>();
  handle("nido:voice-asset-install", async (event, args: unknown) => {
    if (!session) return { ok: false, reason: "locked" };
    const id = (args as { id?: unknown })?.id;
    const entry = ASSET_CATALOG.find((e) => e.id === id);
    if (!entry) return { ok: false, reason: "unknown-asset" };
    if (voiceInstallsInFlight.has(entry.id)) {
      return { ok: false, reason: "already-installing" };
    }
    voiceInstallsInFlight.add(entry.id);
    const sender = event.sender;
    try {
      await downloadAsset(entry, dirs().assets, {
        onProgress: (done, total) => {
          if (!sender.isDestroyed()) {
            sender.send("nido:voice-asset-progress", { id: entry.id, done, total });
          }
        },
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "install-failed",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      voiceInstallsInFlight.delete(entry.id);
    }
  });
}
