/**
 * La superficie de NIDO PC (tanda 14, acto 5: S-1 a S-11).
 *
 * Sustituye a la ventana del banco de E1 sobre la misma carcasa.
 * Todo lo que la superficie enseña viene del proceso principal
 * por el puente nombrado: la bóveda con su registro §8.9, el
 * turno entero, los modelos medidos contra el disco y el Acerca
 * de con su fuente única. La superficie no calcula estados que el
 * núcleo ya declara: la línea del modelo (P-1) lee la residencia
 * real y el modo del juez se lee del resultado del turno (T14R-7).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons.tsx";
import { exampleTap } from "../../../src/guide/exampleTap.js";
import { lessons as GUIDE_LESSONS } from "../../../src/guide/catalog.js";
import { ScheduledTasksCard } from "./ScheduledTasksCard.tsx";
import { LOCAL_TOOLS } from "../../../src/agent/tools/manifest.js";
import { startListening, stopListening } from "../../../src/voice/voiceInput.js";
import { speakText, stopSpeaking } from "../../../src/voice/tts.js";
import { CPR_GUIDE } from "../../../src/cpr/cprCoach.js";
import { resolveShortcut, shortcutSheetRows } from "../../../src/desktop/atajos.js";
import {
  acceptDrop,
  discardAttachment,
  type AttachmentChip,
} from "../../../src/desktop/caida.js";
import { acceptPaste } from "../../../src/desktop/pegado.js";
import {
  conversationToMarkdown,
  conversationToPlainText,
  dragOutPayload,
  exportFileSlug,
  saveExport,
} from "../../../src/desktop/exportacion.js";
import { composePanelFigures } from "../../../src/desktop/panel.js";
import {
  closeSplit,
  closedSplit,
  openSplit,
  splitPresentation,
  type SplitState,
} from "../../../src/desktop/dividida.js";
import {
  FONT_SCALE_STEPS,
  fontScaleFactor,
  resetFontScaleStep,
  stepFontScale,
} from "../../../src/desktop/zoom.js";
import {
  composePaletteItems,
  searchPaletteItems,
  type PaletteItem,
} from "../../../src/desktop/paleta.js";
import { PACK_CATALOG } from "../../../src/models/packCatalog.js";
import type { FontScale } from "../../../src/models/settings.js";
import {
  installTtsPort,
  installVoicePort,
  releaseSpeechEngine,
  setReserveOffered,
  stopVoiceCapture,
  systemVoicePresent,
} from "./voicePort.ts";
import { voiceSurfaceState } from "../../../src/voice/voiceSurface.js";

// ---------------------------------------------------------------------
// El puente, tipado en su forma
// ---------------------------------------------------------------------

/** Una fila de la sección de paquetes (paso 8 de E5), en su forma servida. */
interface PackRowView {
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
}

/** Una guía del índice del lector (B-1), en la forma que el núcleo la sirve. */
interface PackGuideRow {
  id: number;
  key: string;
  lang: string;
  title: string;
  category: string;
  region: string;
  sources: string;
  verified: string;
}

interface LibraryDocRow {
  id: string;
  name: string;
  docs: string[];
  docCount: number;
  chunkCount: number;
  sizeBytes: number;
  pageCount: number | null;
  active: boolean;
  pendingVectors: number;
  createdAt: number;
  lastAccessed: number;
  /** Los avisos persistidos de su importación (B-2), en la forma que el núcleo compone. */
  warnings: { name: string; reason: string }[];
}

/** Las filas de la lista de Memoria (§2 del bloque del loop,
 * H-LOOP-5): la forma del almacén que el canal sirve, con la
 * fecha del recordatorio ya compuesta en palabras por el
 * proceso principal (`dueLabel`). */
interface MemoryFactRow {
  id: string;
  content: string;
}
interface MemoryNoteRow {
  id: string;
  title: string;
  body: string;
}
interface MemoryPersonRow {
  id: string;
  name: string;
  notes?: string;
}
interface MemoryReminderRow {
  id: string;
  text: string;
  due_at: string | null;
  repeat?: "day" | "week" | "month" | "year" | null;
  done: number;
  dueLabel: string | null;
}

/** Las filas del historial de acciones (O-12): la forma del
 * almacén guardado que el canal `nido:action-log-list` sirve. */
interface ActionLogRow {
  id: number;
  ts: string;
  tool: string;
  outcome: string;
  confirmed: boolean;
  undone: boolean;
  undo?: { kind: "note" | "reminder"; id: string };
}

// E7 (paso 6): las filas de la sección Agenda, en la forma que
// los canales `nido:agenda-*` sirven (los almacenes del chat).
interface AgendaEventRow {
  id: string;
  title: string;
  notes: string;
  location: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  rrule: string | null;
  alertOffsetMin: number | null;
}
interface AgendaNoticeRow {
  id: string;
  kind: string;
  refId: string | null;
  text: string;
  state: string;
  baseLocal: string;
  repeat: string | null;
  nextFireAt: number;
  snoozeUntil: number | null;
  lastFiredAt: number | null;
  missedCount: number;
  snoozeCount: number;
  seriesId: string | null;
  pending: boolean;
  endsAt: number | null;
  remainingMs: number | null;
}
interface AgendaContactRow {
  id: string;
  name: string;
  relation: string;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  birthdayYear: number | null;
  phones: { label: string; number: string }[];
  emails: { label: string; address: string }[];
  notes: string;
  alertLeadDays: number;
  nextNoticeAt: number | null;
}

// Puerta .ics/.vcf: el resumen de una importación como
// lo sirve el principal, con códigos que la superficie
// compone en el idioma de la persona.
interface AgendaImportDiscarded {
  code: string;
  label: string | null;
  prop: string | null;
  text: string;
}

interface AgendaImportNamedGroup {
  count: number;
  names: string[];
}

interface AgendaImportSummary {
  rejectedCode: string | null;
  rejectedText: string | null;
  total: number;
  enter: number;
  alreadyPresent: number;
  recurring: number;
  discarded: AgendaImportDiscarded[];
  named: {
    exdate: AgendaImportNamedGroup;
    valarm: AgendaImportNamedGroup;
    unboundedRrule: AgendaImportNamedGroup;
    tzid: AgendaImportNamedGroup;
    withoutUid: number;
    truncatedFields: number;
  } | null;
}

interface ModelInfo {
  id: string;
  label: string;
  plainLabel: string;
  kind: string;
  license: string;
  sizeBytes: number;
  installed: boolean;
  resident: boolean;
  fit: "green" | "yellow" | "red" | "unknown";
  contextSize: number | null;
  /** Los campos del gestor (E4 paso 6). De ellos, la cuenta
   * (breakdown y budgetBytes) la trae también el bootstrap
   * desde §5 del bloque del loop; el resto llega solo con la
   * lista del gestor. */
  role?: string;
  note?: string;
  breakdown?: {
    weights: number;
    kv: number;
    compute: number;
    logits: number;
    total: number;
  } | null;
  budgetBytes?: number | null;
  degradation?: "none" | "step-down" | "floor-q8";
  recommended?: boolean;
  state?:
    | "active"
    | "downloading"
    | "paused"
    | "partial"
    | "checking"
    | "on-disk"
    | "mismatch"
    | "not-downloaded";
  action?: "use" | "download" | "continue" | "redownload" | "pause" | "none";
  transfer?: { downloadedBytes: number; totalBytes: number; paused: boolean } | null;
  error?: string | null;
}

interface StoredTurn {
  role: "user" | "assistant";
  text: string;
  route?: string;
  judgeMode?: string;
  judgeStatus?: string;
  sources?: {
    title: string;
    /** E6 (paso 7): la etiqueta desde el metadato («Contrato · pág. 7»). */
    label?: string;
    body: string;
    truncated?: boolean;
    rawScore?: number;
    /** La cabecera de página («pág. 7 de 128») y el texto de la página, servidos desde la base. */
    pageHeader?: string;
    pageText?: string;
  }[];
  evidence?: {
    title: string;
    /** E6 (paso 7): la etiqueta de la fuente principal desde su metadato. */
    label?: string;
    highlight: string;
    index: number;
  } | null;
  warnings?: string[];
  timedOut?: boolean;
  researchPreempted?: boolean;
  /** E10 (paso 5): el informe de la investigación de este turno. */
  research?: ResearchTurnData;
  researchReportId?: string;
  stopped?: boolean;
  /** N1: el asistente que asienta un fallo de la generación. */
  failed?: boolean;
  contextNote?: "filling" | "dropping";
  at: string;
}

interface Conv {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: StoredTurn[];
  summary: string | null;
}

interface AboutData {
  version: string;
  build: string;
  repoUrl: string;
  repoOpenUrl: string;
  reportOpenUrl: string;
  copyrightLine: string;
  solanaAddress: string;
  baseAddress: string;
  salvoraNote: string;
  report: string;
  mobileCardUrl: string | null;
}

interface Boot {
  ok: boolean;
  vault: { exists: boolean; unlocked: boolean };
  prefs: {
    theme: "daylight" | "night";
    lang: "es" | "en" | "pt";
    sidebarWidth: number;
    sidebarCollapsed: boolean;
  };
  strings: Record<string, never>;
  models: ModelInfo[];
  recommendation: {
    budgetBytes: number;
    modelId: string;
    label: string;
    plainLabel: string;
    sizeBytes: number | null;
    fit: "green" | "yellow" | "red" | "unknown";
    totalRamBytes: number;
  };
  conversations: Conv[];
  guideVisited?: string[];
  disabledTools?: string[];
  personality?: string | null;
  customSystemPrompt?: string;
  noticesPermissionAsked?: boolean;
  voiceInputEnabled?: boolean;
  readAloudEnabled?: boolean;
  deepResearchMode?: boolean;
  sendOnEnter?: boolean;
  fontScaleStep?: string;
  rotationOutcome?: "done" | "recovered" | "failed" | null;
  voiceSystemReserveEnabled?: boolean;
  noticesShowText?: boolean;
  noticesResident?: boolean | null;
  noticesAutostart?: boolean;
  noticesCustody?: string;
  about: AboutData;
  stats: {
    ramUsedBytes: number;
    ramTotalBytes: number;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    lastGenRate: number | null;
    contextUsedFraction?: number | null;
    appMemoryBytes?: number;
  };
}

/**
 * E10 (paso 4): el plan de investigación tal como viaja por el
 * puente: la forma de `ResearchPlan` de la raíz, declarada aquí
 * porque la superficie solo lo lee y lo devuelve editado.
 */
interface ResearchPlanData {
  query: string;
  lang: string;
  scope: "packs" | "documents" | "both";
  subQuestions: string[];
  coverage: { covered: string[]; gaps: string[] };
  scopeCounts: { packs: number; documents: number; both: number };
  scopeEmpty: boolean;
  intercepted: boolean;
  /** E10 (paso 5): el estilo de informe elegido con el plan. */
  style: "completo" | "ejecutivo" | "comparativo" | "cronologico";
  estimatedTokens: number;
  estimatedSeconds: number;
}

type ResearchStyleId = ResearchPlanData["style"];

/** E10 (paso 6): el resumen de una sesión guardada, para la lista. */
interface ResearchSessionSummaryData {
  id: string;
  query: string;
  stage: "plan" | "passes" | "contrast" | "done";
  updatedAt: string;
  closedPasses: number;
  planSize: number;
}

/**
 * E10 (paso 5): el informe de un turno de investigación, tal
 * como viaja por el puente (la forma de `ResearchReceipt` de
 * la raíz): las cuatro formas de lectura y los dos recibos.
 */
interface ResearchTurnData {
  style: ResearchStyleId;
  styles: Record<ResearchStyleId, string>;
  receipt: {
    claims: {
      claim: string;
      citations: { n: number; chunkId: string; docId: string; title: string }[];
    }[];
    run: {
      model: string | null;
      style: ResearchStyleId;
      totalMs: number;
      totalTokens: number;
      stages: { stage: string; ms: number; tokens: number | null }[];
      passes: {
        subQuestion: string;
        sourceCount: number;
        verdict?: { status: string; kept: number; removed: number };
      }[];
      finalJudge: { kept: number; removed: number } | null;
      judgeMs: number;
      fragmentsConsulted: number;
      gapsDeclared: string[];
      gapRoundUsed: boolean;
      contrast: { conflicts: number; duplicates: number; gaps: number; failed: boolean } | null;
    };
  };
}

interface NidoBridge {
  bootstrap(): Promise<Boot>;
  vaultCreate(password: string): Promise<{ ok: boolean; reason?: string }>;
  vaultUnlock(password: string): Promise<{ ok: boolean; reason?: string }>;
  vaultLock(): Promise<{ ok: boolean }>;
  prefsSet(patch: unknown): Promise<{ ok: boolean; prefs: Boot["prefs"]; strings: Record<string, never> }>;
  turnSend(args: unknown): Promise<{
    ok: boolean;
    reason?: string;
    result?: {
      text: string;
      route: string;
      judgeMode: string | null;
      judgeStatus: string | null;
      warnings: string[];
      stopped: boolean;
      timedOut: boolean;
      contextNote: { droppedTurns: number; fractionUsed: number } | null;
    };
    conversation?: Conv;
  }>;
  turnStop(): Promise<{ ok: boolean }>;
  researchPlan(args: unknown): Promise<{
    ok: boolean;
    reason?: string;
    outcome?: { kind: "plan" | "preempted" | "not-deep"; plan?: ResearchPlanData };
  }>;
  researchReportExport(args: unknown): Promise<{
    ok: boolean;
    reason?: string;
    delivered?: string;
  }>;
  exportSaveDialog(args: { defaultName: string }): Promise<{
    ok: boolean;
    path?: string | null;
  }>;
  exportWrite(args: { path: string; content: string }): Promise<{ ok: boolean }>;
  exportDragStart(args: { fileName: string; content: string }): Promise<{ ok: boolean }>;
  researchSessions(): Promise<{
    ok: boolean;
    sessions?: ResearchSessionSummaryData[];
  }>;
  researchSessionDelete(args: unknown): Promise<{ ok: boolean }>;
  conversationDelete(id: string): Promise<{ ok: boolean }>;
  modelsList(): Promise<{ ok: boolean; models: ModelInfo[]; recommendation: Boot["recommendation"] }>;
  modelsListLight(): Promise<{ ok: boolean; models: ModelInfo[]; recommendation: Boot["recommendation"] }>;
  modelLoad(id: string): Promise<{ ok: boolean; reason?: string; error?: string; models?: ModelInfo[] }>;
  modelLoadRetryLess(id: string): Promise<{ ok: boolean; reason?: string; error?: string; models?: ModelInfo[] }>;
  modelDownload(id: string): Promise<{ ok: boolean; reason?: string; error?: string; paused?: boolean; models?: ModelInfo[] }>;
  modelDownloadPause(id: string): Promise<{ ok: boolean }>;
  modelDiscard(id: string): Promise<{ ok: boolean; models?: ModelInfo[] }>;
  settingsSet(args: unknown): Promise<{ ok: boolean }>;
  guideMark(key: string): Promise<{ ok: boolean; guideVisited?: string[] }>;
  packsList(): Promise<{ ok: boolean; rows?: PackRowView[]; note?: string }>;
  packInstall(id: string): Promise<{ ok: boolean; reason?: string; error?: string; rows?: PackRowView[]; note?: string }>;
  packImportPath(path: string): Promise<{
    ok: boolean;
    outcome?: { status: string; reason?: string };
    rows?: PackRowView[];
    note?: string;
  }>;
  packFilePath(file: File): string;
  docFilePath(file: File): string;
  documentsImport(
    paths: string[],
    name?: string,
  ): Promise<{
    ok: boolean;
    reason?: string;
    name?: string;
    chunkCount?: number;
    warnings?: { name: string; reason: string }[];
  }>;
  documentsList(): Promise<{
    ok: boolean;
    reason?: string;
    rows?: LibraryDocRow[];
    totalBytes?: number;
    budgetBytes?: number;
  }>;
  documentsSetActive(
    id: string,
    active: boolean,
  ): Promise<{ ok: boolean; reason?: string; rows?: LibraryDocRow[]; totalBytes?: number; budgetBytes?: number }>;
  documentsDelete(
    id: string,
  ): Promise<{ ok: boolean; reason?: string; rows?: LibraryDocRow[]; totalBytes?: number; budgetBytes?: number }>;
  documentsExport(id: string): Promise<{ ok: boolean; reason?: string; delivered?: string | null }>;
  packRemove(filename: string): Promise<{ ok: boolean; reason?: string; rows?: PackRowView[]; note?: string }>;
  packGuides(): Promise<{
    ok: boolean;
    reason?: string;
    sections?: { packId: string; name: string; guides: PackGuideRow[] }[];
  }>;
  packGuideRead(
    packId: string,
    guideId: number,
  ): Promise<{
    ok: boolean;
    reason?: string;
    doc?: { title: string; source: string; body: string } | null;
  }>;
  libraryData(): Promise<{
    ok: boolean;
    reason?: string;
    packs?: { id: string; name: string; outdated: boolean }[];
    factCount?: number;
  }>;
  memoryList(): Promise<{
    ok: boolean;
    reason?: string;
    facts?: MemoryFactRow[];
    notes?: MemoryNoteRow[];
    people?: MemoryPersonRow[];
    reminders?: MemoryReminderRow[];
  }>;
  memoryDelete(kind: string, id: string): Promise<{ ok: boolean; reason?: string }>;
  agendaData(): Promise<{
    ok: boolean;
    reason?: string;
    events?: AgendaEventRow[];
    contacts?: AgendaContactRow[];
    notices?: AgendaNoticeRow[];
  }>;
  noticeAct(args: unknown): Promise<{ ok: boolean; reason?: string }>;
  tasksList(): Promise<{ ok: boolean; reason?: string; tasks?: unknown[] }>;
  tasksSave(args: unknown): Promise<{ ok: boolean; reason?: string; errors?: string[] }>;
  tasksDelete(args: unknown): Promise<{ ok: boolean; reason?: string }>;
  actionLogList(): Promise<{ ok: boolean; reason?: string; actions?: ActionLogRow[] }>;
  actionLogUndo(id: number): Promise<{ ok: boolean; reason?: string }>;
  actionLogClear(): Promise<{ ok: boolean; reason?: string }>;
  agendaEventSave(args: unknown): Promise<{ ok: boolean; reason?: string; event?: AgendaEventRow }>;
  agendaEventDelete(id: string): Promise<{ ok: boolean; reason?: string }>;
  agendaContactSave(args: unknown): Promise<{ ok: boolean; reason?: string; contact?: AgendaContactRow }>;
  agendaContactDelete(id: string): Promise<{ ok: boolean; reason?: string }>;
  agendaImportPreview(
    kind: string,
    path: string,
  ): Promise<{ ok: boolean; reason?: string; token?: string | null; summary?: AgendaImportSummary }>;
  agendaImportCommit(
    kind: string,
    token: string,
  ): Promise<{ ok: boolean; reason?: string; inserted?: number; summary?: AgendaImportSummary }>;
  agendaExport(kind: string): Promise<{ ok: boolean; reason?: string; content?: string; defaultName?: string }>;
  copyText(text: string): Promise<{ ok: boolean }>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  confirmResponse(id: string, approved: boolean): void;
  onTurnToken(cb: (p: { conversationId: string; chunk: string }) => void): () => void;
  onTurnPhase(cb: (p: { phase: string }) => void): () => void;
  onConfirmRequest(cb: (p: ConfirmPayload) => void): () => void;
  onVaultLocked(cb: () => void): () => void;
  linkPending(args: { afterSeq: number }): Promise<{
    ok: boolean;
    seq?: number;
    resolution?: import("../../../src/desktop/enlaces.js").LinkResolution;
  }>;
  conversationSearch(args: { query: string }): Promise<{
    ok: boolean;
    reason?: string;
    hits?: { conversationId: string; messageIndex: number }[];
  }>;
  backupExport(args: { destPath: string; backupPassword: string }): Promise<{
    ok: boolean;
    reason?: string;
    message?: string;
    entries?: string[];
  }>;
  vaultRotateRequest(args: { password: string }): Promise<{ ok: boolean; reason?: string }>;
  onLink(cb: (payload: { seq?: number }) => void): () => void;
  onNoticesShow(cb: (p: { target?: string }) => void): () => void;
  checkForUpdates(): Promise<unknown>;
  // La voz (E9 paso 1): el dictado, por su proceso propio.
  voiceEngineState(): Promise<{ ok: boolean; state?: string }>;
  voiceDictationStart(): Promise<{ ok: boolean; reason?: string }>;
  voiceDictationStop(): Promise<{ ok: boolean }>;
  voiceDictationAudio(samples: ArrayBuffer): void;
  onVoiceEvent(cb: (p: VoiceSessionPayload) => void): () => void;
  // La lectura (E9 paso 2): Kokoro, en el mismo proceso de voz.
  voiceSpeakState(): Promise<{ ok: boolean; state?: string }>;
  voiceSynth(
    text: string,
    lang: string,
  ): Promise<{ ok: boolean; reason?: string; samples?: ArrayBuffer; sampleRate?: number }>;
  voiceSpeakRelease(): Promise<{ ok: boolean }>;
  // La tarjeta de activos de voz (E9 paso 5).
  voiceAssets(): Promise<{ ok: boolean; rows?: VoiceAssetRow[] }>;
  voiceAssetInstall(id: string): Promise<{ ok: boolean; reason?: string; error?: string }>;
  onVoiceAssetProgress(cb: (p: { id: string; done: number; total: number }) => void): () => void;
}

/** Una fila de la tarjeta de activos de voz. */
export interface VoiceAssetRow {
  id: string;
  label: string;
  kind: string;
  license: string;
  archiveBytes: number;
  state: string;
  verified: boolean;
}

/** El evento de sesión de dictado que llega del proceso de voz. */
export interface VoiceSessionPayload {
  type: "start" | "end" | "result" | "error";
  text?: string;
  code?: string;
  message?: string;
}

interface ConfirmPayload {
  id: string;
  kind: string;
  tool: string;
  title?: string | null;
  scope: string | null;
  message: string;
}

declare global {
  interface Window {
    nido: NidoBridge;
  }
}

// ---------------------------------------------------------------------
// Ayudas de texto
// ---------------------------------------------------------------------

type Strings = Record<string, Record<string, unknown>>;

function lookup(strings: Strings, section: string, key: string): string {
  let value: unknown = strings?.[section];
  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }
  return typeof value === "string" ? value : key;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

// B-2 del clúster de Biblioteca: la letra de los avisos de la
// importación, compartida por la tarjeta que importa y por el
// detalle de la Biblioteca. El mapa cubre el vocabulario
// entero de razones del importador (ImportWarningReason del
// núcleo); una razón fuera del mapa se pinta tal cual, nunca
// se esconde.
const WARNING_REASON_KEYS: Record<string, string> = {
  noText: "libDocsWarnNoText",
  ocrFailed: "libDocsWarnOcrFailed",
  ocrEmpty: "libDocsWarnOcrEmpty",
  imageNoOcr: "libDocsWarnImageNoOcr",
  unsupported: "libDocsWarnUnsupported",
  pdfPassword: "libDocsWarnPdfPassword",
  pdfUnreadable: "libDocsWarnPdfUnreadable",
  alreadyImported: "libDocsWarnAlreadyImported",
  similarImported: "libDocsWarnSimilarImported",
};

function warningLine(P: (k: string) => string, w: { name: string; reason: string }): string {
  const key = WARNING_REASON_KEYS[w.reason];
  return `${w.name} — ${key ? P(key) : w.reason}`;
}

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1).replace(".", ",");
}

type Section = "chat" | "emergency" | "agenda" | "library" | "memory" | "nido" | "modelos" | "settings";

// Las secciones de la barra: la Agenda de PC nace en E7
// (paso 6) y entra tercera, como su asiento de apertura dejó
// escrito contra E7-DECISIONES §4.2; su glifo `agenda` ya
// vivía en el registro desde la tanda 14.
const NAV: { id: Section; icon: string; key: string }[] = [
  { id: "chat", icon: "chat", key: "navChat" },
  { id: "emergency", icon: "warning", key: "navEmergency" },
  { id: "agenda", icon: "agenda", key: "navAgenda" },
  { id: "library", icon: "knowledge", key: "navLibrary" },
  { id: "memory", icon: "memory", key: "navMemory" },
  { id: "nido", icon: "pairing", key: "navNido" },
  { id: "modelos", icon: "models", key: "navModels" },
  { id: "settings", icon: "settings", key: "navSettings" },
];

// ---------------------------------------------------------------------
// La puerta de la bóveda
// ---------------------------------------------------------------------

function VaultGate({ boot, onDone }: { boot: Boot; onDone: () => void }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = !boot.vault.exists;

  const submit = async () => {
    setError(null);
    if (creating) {
      // Length in CODE POINTS, the core's own count: wrap() counts code
      // points, so UTF-16 units would let an astral password pass this
      // gate and throw inside wrap(). And the one form whose copy says
      // there is no recovery confirms what was typed before creating.
      if ([...password].length < 8) {
        setError(P("vaultShort"));
        return;
      }
      if (password !== password2) {
        setError(P("vaultMismatch"));
        return;
      }
    }
    setBusy(true);
    const r = creating
      ? await window.nido.vaultCreate(password)
      : await window.nido.vaultUnlock(password);
    setBusy(false);
    if (r.ok) onDone();
    else if (!creating && r.reason === "vault-corrupt") setError(P("vaultCorrupt"));
    else if (creating && r.reason === "already-exists") setError(P("vaultExists"));
    else if (creating && r.reason === "password-too-short") setError(P("vaultShort"));
    else setError(P("vaultWrong"));
  };

  return (
    <div className="vault-gate">
      <div className="card vault-card">
        <img src="/mascot-nido.png" alt="" />
        <h2>{creating ? P("vaultCreateTitle") : P("vaultUnlockTitle")}</h2>
        <p>{creating ? P("vaultCreateBody") : P("vaultUnlockBody")}</p>
        <input
          type={showPw ? "text" : "password"}
          value={password}
          placeholder={P("vaultPassword")}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          autoFocus
        />
        {creating && (
          <input
            type={showPw ? "text" : "password"}
            value={password2}
            placeholder={P("vaultPasswordConfirm")}
            onChange={(e) => setPassword2(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        )}
        <label className="check-row">
          <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
          <span>{P("vaultShow")}</span>
        </label>
        {error && <p className="vault-error">{error}</p>}
        <button className="btn primary" disabled={busy || password.length === 0} onClick={() => void submit()}>
          {creating ? P("vaultCreate") : P("vaultUnlock")}
        </button>
      </div>
    </div>
  );
}

/**
 * La capa de texto para personas de los avisos del turno (§1.5:
 * ningún código crudo en pantalla). Los avisos conocidos se dicen
 * en llano; uno desconocido se enseña como aviso interno genérico,
 * nunca como su código. El dato crudo queda en el resultado del
 * turno, que es donde la pasada lo cobra.
 */
/** El veredicto de encaje en llano (H-M4): cuatro estados. */
function fitText(fit: string, P: (k: string) => string): string {
  if (fit === "green") return P("recommendationFit");
  if (fit === "yellow") return P("fitYellow");
  if (fit === "red") return P("recommendationNoFit");
  return P("fitUnknown");
}

function warningText(warnings: string[], P: (k: string) => string): string {
  const texts: string[] = [];
  for (const w of warnings) {
    if (w.startsWith("model-unavailable")) texts.push(P("warnModelUnavailable"));
    else if (w.includes("no-model-available") || w.includes("no-model"))
      texts.push(P("warnNoModel"));
    else texts.push(P("warnGeneric"));
  }
  return [...new Set(texts)].join(" · ");
}

// ---------------------------------------------------------------------
// La app entera
// ---------------------------------------------------------------------

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootFailed, setBootFailed] = useState(false);
  const [section, setSection] = useState<Section>("chat");
  const [settingsTab, setSettingsTab] = useState<string>("about");
  const [currentId, setCurrentId] = useState<string | null>(null);
  // F-UI-10 (a-i): el estado de vuelo del turno vive en la
  // raíz, no en la instancia del chat: la vista se desmonta
  // al navegar y la instancia nueva nacía con «sin vuelo»
  // mientras el principal seguía drenando el turno parado,
  // con lo que el reenvío salía y moría en la guarda tardía.
  // En la raíz, la remonta hereda el vuelo y el asentamiento
  // del envío lo libera sea cual sea la vista montada.
  const [sending, setSending] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // E11 (paso 1): la hoja de atajos y el buscador global
  // viven en la raíz con la paleta: el mapa de la ventana
  // se decide aquí, y la vista del chat registra sus
  // costuras (ir al final, buscar dentro) en la referencia.
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const chatKeysRef = useRef<{ goEnd?: () => void; openFind?: () => void }>({});
  // E11 (paso 7): el enlace nido:// que llega de fuera. El
  // principal lo retiene y lo resuelve contra el mundo de
  // la sesión; aquí solo se aplica su resolución (navegar
  // o avisar) y se recuerda el último número aplicado.
  const [guideLink, setGuideLink] = useState<{ id: string; seq: number } | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const lastLinkSeq = useRef(0);
  // E11 (paso 9): el salto pedido por el buscador global:
  // la vista del chat lo cobra al montar o al cambiar.
  const [jumpRequest, setJumpRequest] = useState<{ index: number; seq: number } | null>(null);
  // E7 (paso 6): la ruta interna de la ficha,
  // `#/agenda/contacto/<id>`, abre la Agenda con esa ficha.
  const [agendaContactId, setAgendaContactId] = useState<string | null>(null);
  useEffect(() => {
    const applyHash = () => {
      const m = /^#\/agenda\/contacto\/(.+)$/.exec(window.location.hash);
      if (m) {
        setAgendaContactId(decodeURIComponent(m[1]));
        setSection("agenda");
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  const [welcomeSeen, setWelcomeSeen] = useState(false);
  const [guideDraft, setGuideDraft] = useState<{ text: string; seq: number } | null>(null);
  const [learnSignal, setLearnSignal] = useState(0);

  const refresh = useCallback(async () => {
    let b: Boot;
    try {
      b = await window.nido.bootstrap();
    } catch {
      // El arranque no se traga su propio fallo (auditoría del
      // arranque): sin bootstrap no hay ni idioma cargado, así
      // que la pantalla de fallo habla el idioma del sistema y
      // ofrece reintentar.
      setBootFailed(true);
      return;
    }
    setBootFailed(false);
    // H-M2, la mitad del renderizador: un bootstrap que vuelve
    // sin sus listas no puede tumbar la app en blanco; se lee
    // con las listas vacías y la puerta de la bóveda manda.
    if (!Array.isArray(b.conversations)) b.conversations = [];
    if (!Array.isArray(b.models)) b.models = [];
    setBoot(b);
    if (b.conversations.length > 0 && currentId == null) {
      setCurrentId(b.conversations[0].id);
    }
  }, [currentId]);

  // La guía (pasada de la guía): el toque de un ejemplo pasa por
  // la costura exampleTap, que escribe en el compositor y nunca
  // envía; y las vías del gancho (el pie del Acerca de y la
  // entrada de Ajustes) aterrizan en Biblioteca con la sección
  // «Aprende» en su índice. Viven con los demás hooks, antes de
  // cualquier retorno temprano: tras un retorno serían más hooks
  // que en el render de la puerta y React tumba la app (error
  // 310, cazado por la pasada de aceptación en vivo).
  const onGuideExample = useCallback((text: string) => {
    const outcome = exampleTap(text);
    setGuideDraft({ text: outcome.composerText, seq: Date.now() });
    setWelcomeSeen(true);
    setSection(outcome.navigateTo);
  }, []);
  const goLearn = useCallback(() => {
    setLearnSignal((n) => n + 1);
    setSection("library");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // E11 (paso 7): la recogida del enlace retenido: al
  // aviso en caliente, al arrancar y tras desbloquear (la
  // resolución «hold» no se marca aplicada: la ruta se
  // dirime cuando la bóveda abre, sin que un id existente
  // y uno inexistente se distingan antes).
  const pullLink = useCallback(async () => {
    if (!boot) return;
    const r = await window.nido
      .linkPending({ afterSeq: lastLinkSeq.current })
      .catch(() => null);
    if (!r?.ok || !r.resolution || typeof r.seq !== "number") return;
    const res = r.resolution;
    if (res.kind === "hold") return;
    lastLinkSeq.current = r.seq;
    if (res.kind === "navigate") {
      if (res.conversationId) setCurrentId(res.conversationId);
      if (res.guideId) setGuideLink({ id: res.guideId, seq: r.seq });
      setSection(res.section);
    } else {
      setSection(res.section);
      const keys: Record<string, string> = {
        malformed: "linkMalformed",
        "chat-missing": "linkChatMissing",
        "guide-missing": "linkGuideMissing",
        "guide-not-installed": "linkGuideNotInstalled",
      };
      setLinkNotice(
        lookup(boot.strings as Strings, "pcSurface", keys[res.notice] ?? "linkMalformed"),
      );
    }
  }, [boot]);

  useEffect(() => {
    const off = window.nido?.onLink(() => {
      void pullLink();
    });
    return off;
  }, [pullLink]);

  useEffect(() => {
    if (boot?.vault.unlocked) void pullLink();
  }, [boot?.vault.unlocked, pullLink]);

  // E9 (paso 5): la oferta de la reserva del sistema gobierna
  // el adaptador de lectura desde el bootstrap.
  useEffect(() => {
    setReserveOffered(boot?.voiceSystemReserveEnabled ?? true);
  }, [boot?.voiceSystemReserveEnabled]);

  useEffect(() => {
    const off = window.nido?.onVaultLocked(() => {
      setPaletteOpen(false);
      void refresh();
    });
    return off;
  }, [refresh]);

  // E8 (paso 6): la carcasa pide enseñar una superficie (el
  // clic de la notificación del sistema lleva a la vista de
  // Avisos; la bandeja, a un chat nuevo o a Emergencia).
  const [noticesSignal, setNoticesSignal] = useState(0);
  useEffect(() => {
    const off = window.nido?.onNoticesShow((p) => {
      if (p.target === "chat-new") {
        setCurrentId(`conv-${Date.now()}`);
        setSection("chat");
      } else if (p.target === "emergency") {
        setSection("emergency");
      } else {
        setNoticesSignal((n) => n + 1);
        setSection("agenda");
      }
    });
    return off;
  }, []);

  useEffect(() => {
    if (!boot) return;
    const root = document.documentElement;
    if (boot.prefs.theme === "night") root.dataset.theme = "night";
    else delete root.dataset.theme;
    // E11 (paso 6): la escala sale del escalón del almacén
    // y de su única tabla (zoom.ts); la preferencia
    // numérica de la carcasa quedó retirada con D-3.
    root.style.setProperty(
      "--font-scale",
      String(fontScaleFactor((boot.fontScaleStep ?? "standard") as FontScale)),
    );
    root.style.setProperty("--sidebar-width", `${boot.prefs.sidebarWidth}px`);
  }, [boot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // La aplicación de una acción del mapa: la comparten el
  // enrutador de teclas y la paleta (que invoca las mismas
  // acciones por su id de la hoja), para que un gesto y su
  // entrada en la paleta hagan exactamente lo mismo.
  const applyShortcutAction = useCallback(
    (action: import("../../../src/desktop/atajos.js").ShortcutAction) => {
      if (!boot) return;
      switch (action.kind) {
        case "new-chat":
          setCurrentId(`conv-${Date.now()}`);
          setSection("chat");
          break;
        case "global-search":
          setSearchOpen(true);
          break;
        case "search-in-chat":
          if (section === "chat") chatKeysRef.current.openFind?.();
          break;
        case "go-end":
          if (section === "chat") chatKeysRef.current.goEnd?.();
          break;
        case "stop":
          void window.nido.turnStop();
          break;
        case "close-sheet":
          setPaletteOpen(false);
          setShortcutSheetOpen(false);
          setSearchOpen(false);
          break;
        case "section":
          setSection(NAV[action.index].id);
          break;
        case "model-manager":
          setSection("modelos");
          break;
        case "shortcut-sheet":
          setShortcutSheetOpen(true);
          break;
        case "zoom-in":
        case "zoom-out":
        case "zoom-reset": {
          // E11 (paso 6): el zoom mueve el escalón del
          // almacén por su única tabla y lo persiste por
          // el canal de ajustes.
          const current = (boot.fontScaleStep ?? "standard") as FontScale;
          const next =
            action.kind === "zoom-reset"
              ? resetFontScaleStep()
              : stepFontScale(current, action.kind === "zoom-in" ? 1 : -1);
          if (next !== current) {
            void window.nido.settingsSet({ fontScaleStep: next }).then(() => refresh());
          }
          break;
        }
        default:
          break; // el envío vive en el composer
      }
    },
    [boot, section, refresh],
  );

  // La invocación desde la paleta: el id de la hoja se
  // traduce a su acción por la misma lista (la fila de la
  // hoja trae su acción), sin una segunda lista.
  const runPaletteAction = useCallback(
    (id: string) => {
      if (!boot) return;
      const row = shortcutSheetRows(boot.sendOnEnter ?? true).find((r) => r.id === id);
      if (row) applyShortcutAction(row.action);
    },
    [boot, applyShortcutAction],
  );

  // E11 (paso 1): el mapa de atajos de la ventana, decidido
  // por el resolvedor de la pieza (src/desktop/atajos.ts)
  // contra el contexto vivo. Intro lo posee el composer
  // (su propio manejador decide enviar, saltar o la
  // emergencia) y Fin dentro de un campo de texto es del
  // texto; aquí vive el resto del mapa. Ningún atajo es
  // global: sin el foco en la ventana, este escuchador no
  // produce efecto alguno, y con la bóveda cerrada el mapa
  // entero duerme.
  useEffect(() => {
    if (!boot?.vault.unlocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") return;
      const el = document.activeElement as HTMLElement | null;
      const inComposer = el?.dataset?.composer === "true";
      const inTextField =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "End" && (inComposer || inTextField)) return;
      const action = resolveShortcut(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        },
        {
          generating: sending,
          emergencyPill: false,
          sheetOpen: paletteOpen || shortcutSheetOpen || searchOpen,
          inComposer,
          sendOnEnter: boot.sendOnEnter ?? true,
        },
      );
      if (!action) return;
      e.preventDefault();
      applyShortcutAction(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boot, sending, paletteOpen, shortcutSheetOpen, searchOpen, applyShortcutAction]);

  if (!boot) {
    if (!bootFailed) return null;
    const lang = navigator.language.toLowerCase().startsWith("en")
      ? "en"
      : navigator.language.toLowerCase().startsWith("pt")
        ? "pt"
        : "es";
    const bootText = {
      es: { title: "NIDO no pudo arrancar", body: "Algo falló al preparar la app en este dispositivo.", retry: "Intentar otra vez" },
      en: { title: "NIDO could not start", body: "Something failed while preparing the app on this device.", retry: "Try again" },
      pt: { title: "O NIDO não pôde arrancar", body: "Algo falhou ao preparar o app neste dispositivo.", retry: "Tentar outra vez" },
    }[lang];
    return (
      <div className="vault-gate">
        <div className="card vault-card">
          <img src="/mascot-nido.png" alt="" width={56} height={56} />
          <h2>{bootText.title}</h2>
          <p>{bootText.body}</p>
          <button className="btn primary" onClick={() => void refresh()}>
            {bootText.retry}
          </button>
        </div>
      </div>
    );
  }
  if (!boot.vault.unlocked) {
    return <VaultGate boot={boot} onDone={() => void refresh()} />;
  }

  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const resident = boot.models.find((m) => m.resident);
  const anyInstalled = boot.models.some((m) => m.installed && m.kind === "llm");

  const openSettings = (tab: string) => {
    setSettingsTab(tab);
    setSection("settings");
  };



  return (
    <div className="app-shell">
      <Sidebar
        boot={boot}
        section={section}
        setSection={setSection}
        currentId={currentId}
        setCurrentId={setCurrentId}
        refresh={refresh}
        goLearn={goLearn}
      />
      <div className="main-column">
        {linkNotice && (
          <div className="link-notice">
            <span>{linkNotice}</span>
            <button onClick={() => setLinkNotice(null)} aria-label={P("findClose")}>
              ×
            </button>
          </div>
        )}
        {section === "chat" &&
          (!anyInstalled && !resident && boot.conversations.length === 0 ? (
            <NoModelView boot={boot} goModels={() => setSection("modelos")} refresh={refresh} />
          ) : !welcomeSeen && boot.conversations.length === 0 ? (
            <WelcomeView
              boot={boot}
              onStart={() => setWelcomeSeen(true)}
              onIdea={(prompt) => {
                const outcome = exampleTap(prompt);
                setGuideDraft({ text: outcome.composerText, seq: Date.now() });
                setWelcomeSeen(true);
                setSection(outcome.navigateTo);
              }}
            />
          ) : (
            <ChatView
              boot={boot}
              currentId={currentId}
              setCurrentId={setCurrentId}
              sending={sending}
              onSendingChange={setSending}
              refresh={refresh}
              guideDraft={guideDraft}
              keysRef={chatKeysRef}
              jumpRequest={jumpRequest}
              goModels={() => setSection("modelos")}
              goTone={() => { setSettingsTab("tone"); setSection("settings"); }}
              goVoice={() => { setSettingsTab("voice"); setSection("settings"); }}
            />
          ))}
        {section === "emergency" && (
          <EmergencyView boot={boot} goChat={(id) => { setCurrentId(id); setSection("chat"); }} refresh={refresh} />
        )}
        {section === "agenda" && <AgendaView boot={boot} contactId={agendaContactId} noticesSignal={noticesSignal} />}
        {section === "modelos" && <ModelsView boot={boot} refresh={refresh} />}
        {section === "nido" && <DeclaredView boot={boot} titleKey="nidoDeclaredTitle" bodyKey="nidoDeclaredBody" icon="pairing" />}
        {section === "library" && (
          <LibraryView
            boot={boot}
            onGuideExample={onGuideExample}
            learnSignal={learnSignal}
            guideLink={guideLink}
          />
        )}
        {section === "memory" && <MemoryView boot={boot} />}
        {section === "settings" && (
          <SettingsView
            boot={boot}
            tab={settingsTab}
            setTab={setSettingsTab}
            refresh={refresh}
            goLibrary={goLearn}
            goModels={() => setSection("modelos")}
          />
        )}
      </div>
      {paletteOpen && boot.vault.unlocked && (
        <Palette
          boot={boot}
          canWrite={anyInstalled || resident !== null || boot.conversations.length > 0}
          close={() => setPaletteOpen(false)}
          go={(sec, convId) => {
            if (convId) setCurrentId(convId);
            setSection(sec);
            setPaletteOpen(false);
          }}
          openSettings={openSettings}
          runAction={runPaletteAction}
          openGuide={(lessonId) => {
            setGuideLink({ id: lessonId, seq: Date.now() });
            setSection("library");
            setPaletteOpen(false);
          }}
          openPack={() => {
            setSection("library");
            setPaletteOpen(false);
          }}
        />
      )}
      {shortcutSheetOpen && boot.vault.unlocked && (
        <ShortcutSheet
          P={P}
          sendOnEnter={boot.sendOnEnter ?? true}
          close={() => setShortcutSheetOpen(false)}
        />
      )}
      {searchOpen && boot.vault.unlocked && (
        <GlobalSearch
          boot={boot}
          P={P}
          close={() => setSearchOpen(false)}
          onJump={(convId, index) => {
            setCurrentId(convId);
            setSection("chat");
            setJumpRequest({ index, seq: Date.now() });
            setSearchOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// E11 (paso 9) · El buscador global (Ctrl+Mayús+F): busca
// en el índice cifrado y cada resultado salta a su
// conversación, a su mensaje exacto. Los resultados se
// calculan en el principal sobre la base de la bóveda:
// con ella bloqueada el buscador lo dice, no finge una
// lista vacía.
// ---------------------------------------------------------------------

function GlobalSearch({
  boot,
  P,
  close,
  onJump,
}: {
  boot: Boot;
  P: (k: string) => string;
  close: () => void;
  onJump: (conversationId: string, messageIndex: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ conversationId: string; messageIndex: number }[]>([]);
  const [lockedNote, setLockedNote] = useState(false);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setLockedNote(false);
      setSearched(false);
      return;
    }
    const t = setTimeout(() => {
      void window.nido.conversationSearch({ query }).then((r) => {
        setSearched(true);
        if (!r.ok) {
          setLockedNote(true);
          setHits([]);
          return;
        }
        setLockedNote(false);
        setHits(r.hits ?? []);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query]);
  const convOf = (id: string) => boot.conversations.find((c) => c.id === id);
  return (
    <div className="palette-veil" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={P("searchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {lockedNote && <div className="drop-note">{P("searchLocked")}</div>}
        {searched && !lockedNote && hits.length === 0 && (
          <div className="muted">{P("searchNoResults")}</div>
        )}
        {hits.map((h, i) => {
          const conv = convOf(h.conversationId);
          const text = conv?.turns[h.messageIndex]?.text ?? "";
          return (
            <button
              key={`${h.conversationId}-${h.messageIndex}-${i}`}
              className="palette-item"
              onClick={() => onJump(h.conversationId, h.messageIndex)}
            >
              <Icon name="search" size={16} />
              <span>
                <strong>{conv?.title || P("untitledChat")}</strong>
                {" · "}
                {text.length > 90 ? `${text.slice(0, 90)}…` : text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// E11 (paso 1) · La hoja de atajos: enseña el mapa entero
// en la posición vigente del ajuste de envío. Sus líneas
// salen de la misma lista que el resolvedor aplica
// (shortcutSheetRows): la hoja no mantiene un mapa suyo.
// ---------------------------------------------------------------------

function ShortcutSheet({
  P,
  sendOnEnter,
  close,
}: {
  P: (k: string) => string;
  sendOnEnter: boolean;
  close: () => void;
}) {
  const rows = shortcutSheetRows(sendOnEnter);
  return (
    <div className="palette-veil" onClick={close}>
      <div className="shortcut-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="shortcut-sheet-head">
          <h3>{P("shortcutsTitle")}</h3>
          <button className="shortcut-sheet-close" onClick={close} aria-label={P("findClose")}>
            ×
          </button>
        </div>
        <table className="shortcut-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="shortcut-keys">{row.keys}</td>
                <td>{P(row.labelKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// E11 (paso 4) · Exportar la conversación abierta: guardar
// como Markdown o como texto llano, con el diálogo del
// sistema, o arrastrar el botón fuera para soltar el .md
// donde la persona lo suelte. Solo por su gesto expreso:
// nada se exporta solo. La pieza (exportacion.ts) compone
// el contenido entero y decide el guardado; aquí viven
// los gestos y las vías del puente.
// ---------------------------------------------------------------------

function ExportControl({
  P,
  title,
  messages,
}: {
  P: (k: string) => string;
  title: string;
  messages: { role: string; text: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const conv = { title, messages };
  const labels = { user: P("exportYou"), assistant: "NIDO" };

  const save = async (kind: "md" | "txt") => {
    setOpen(false);
    const content =
      kind === "md"
        ? conversationToMarkdown(conv, labels)
        : conversationToPlainText(conv, labels);
    const defaultName = `${exportFileSlug(title)}.${kind}`;
    const r = await saveExport(
      {
        showSaveDialog: async (name) => {
          const d = await window.nido.exportSaveDialog({ defaultName: name });
          return d.ok ? (d.path ?? null) : null;
        },
        writeFile: async (path, text) => {
          await window.nido.exportWrite({ path, content: text });
        },
      },
      defaultName,
      content,
    );
    if (r.saved && r.path) setNote(fill(P("exportedTo"), { path: r.path }));
  };

  return (
    <div className="export-control">
      <button
        className="export-button"
        draggable

        onDragStart={() => {
          const payload = dragOutPayload(conv, labels);
          void window.nido.exportDragStart({
            fileName: payload.fileName,
            content: payload.content,
          });
        }}
        onClick={() => setOpen((v) => !v)}
        title={P("exportConversation")}
      >
        <Icon name="download" size={16} /> {P("exportConversation")}
      </button>
      {open && (
        <div className="export-menu">
          <button onClick={() => void save("md")}>{P("exportAsMarkdown")}</button>
          <button onClick={() => void save("txt")}>{P("exportAsText")}</button>
        </div>
      )}
      {note && <div className="export-note">{note}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// E11 (paso 8) · Dividir: leer otra conversación al lado
// de la principal, en el panel. La principal no se
// sustituye: la división es solo lectura y el composer
// sigue siendo de la conversación abierta.
// ---------------------------------------------------------------------

function SplitControl({
  P,
  others,
  onPick,
}: {
  P: (k: string) => string;
  others: { id: string; title: string }[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-control">
      <button
        className="export-button"
        onClick={() => setOpen((v) => !v)}
        title={P("splitOpen")}
      >
        <Icon name="menu" size={16} /> {P("splitOpen")}
      </button>
      {open && (
        <div className="export-menu">
          {others.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false);
                onPick(c.id);
              }}
            >
              {c.title || P("untitledChat")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// S-1 · La barra
// ---------------------------------------------------------------------

function Sidebar({
  boot,
  section,
  setSection,
  currentId,
  setCurrentId,
  refresh,
  goLearn,
}: {
  boot: Boot;
  section: Section;
  setSection: (s: Section) => void;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  refresh: () => Promise<void>;
  goLearn: () => void;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const D = (k: string) => lookup(s, "drawer", k);
  // E11 (M-5): el nombre de la entrada de la guía es el
  // título del propio árbol de la guía, en su idioma.
  const guideTitle =
    ((s as Record<string, unknown>).guide as GuideTree | undefined)?.title ?? "Aprende";
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const collapsed = boot.prefs.sidebarCollapsed;
  const dragging = useRef(false);

  const newChat = () => {
    setCurrentId(`conv-${Date.now()}`);
    setSection("chat");
  };

  const onResizeDown = (e: React.MouseEvent) => {
    dragging.current = true;
    const startX = e.clientX;
    const startW = boot.prefs.sidebarWidth;
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(360, Math.max(240, startW + (ev.clientX - startX)));
      document.documentElement.style.setProperty("--sidebar-width", `${w}px`);
    };
    const up = (ev: MouseEvent) => {
      dragging.current = false;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const w = Math.min(360, Math.max(240, startW + (ev.clientX - startX)));
      void window.nido.prefsSet({ sidebarWidth: w }).then(() => refresh());
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (collapsed) {
    return (
      <aside className="sidebar rail">
        <img src="/mascot-nido.png" alt="" width={32} height={32} />
        {NAV.map((n, i) => (
          <button
            key={n.id}
            className={`nav-item${section === n.id ? " active" : ""}`}
            title={`${P(n.key)} · Ctrl+${i + 1}`}
            onClick={() => setSection(n.id)}
          >
            <Icon name={n.icon} size={20} />
          </button>
        ))}
        {/* E11 (M-5): la entrada permanente de la guía,
            también en el riel: una sola, sin parada de
            Ctrl+número. */}
        <button className="nav-item" title={guideTitle} onClick={goLearn}>
          <Icon name="ideas" size={20} />
        </button>
        <button
          className="nav-item"
          title={P("expandRail")}
          onClick={() => void window.nido.prefsSet({ sidebarCollapsed: false }).then(() => refresh())}
        >
          <Icon name="chev-right" size={20} />
        </button>
      </aside>
    );
  }

  // E11 (paso 5): el panel crece sobre este pie: las cifras
  // se componen en la pieza (panel.ts) desde sus fuentes
  // vivas del bootstrap y del modelo residente, y el pie
  // las pinta sin calcular las suyas. En el régimen medio
  // la regla de la barra esconde los span del pie, como
  // hoy: el panel es del régimen ancho.
  const residentModel = boot.models.find((m) => m.resident) ?? null;
  const panelFigures = composePanelFigures({
    ramUsedBytes: boot.stats.ramUsedBytes,
    ramTotalBytes: boot.stats.ramTotalBytes,
    diskUsedBytes: boot.stats.diskUsedBytes,
    diskTotalBytes: boot.stats.diskTotalBytes,
    lastGenRate: boot.stats.lastGenRate,
    modelName: residentModel?.plainLabel ?? null,
    modelSizeBytes: residentModel?.sizeBytes ?? null,
    contextSize: residentModel?.contextSize ?? null,
    contextUsedFraction: boot.stats.contextUsedFraction ?? null,
    memoryUsedBytes: () => boot.stats.appMemoryBytes ?? 0,
  });
  const panelFig = (id: string) => panelFigures.find((f) => f.id === id);

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/mascot-nido.png" alt="" />
        <span className="brand-name">NIDO</span>
      </div>
      <div className="brand-status">
        <span className="status-dot" />
        <span>{P("statusLocal")}</span>
      </div>
      <button className="btn primary" onClick={newChat} title="Ctrl+N">
        <Icon name="new-chat" size={20} /> {D("newChat")}
      </button>
      {NAV.map((n, i) => (
        <button
          key={n.id}
          className={`nav-item${section === n.id ? " active" : ""}`}
          title={`Ctrl+${i + 1}`}
          onClick={() => setSection(n.id)}
        >
          <Icon name={n.icon} size={20} /> {P(n.key)}
        </button>
      ))}
      {/* E11 (M-5): la entrada permanente de la barra a la
          guía: una sola, visible en todo régimen en que la
          barra vive, sin parada de Ctrl+número (el mapa
          sigue en n = 8) y sin duplicar los enlaces por
          sección, que siguen en su sitio. Aterriza en el
          índice de «Aprende» por la vía del gancho. */}
      <button className="nav-item" onClick={goLearn}>
        <Icon name="ideas" size={20} /> {guideTitle}
      </button>
      <div className="recents">
        <span className="recents-title">{D("recentSessions")}</span>
        {boot.conversations.length === 0 && (
          <div className="rail-guide">
            <img src="/mascot-nido.png" alt="" width={96} height={96} />
            <p>{P("railGuideEmpty")}</p>
          </div>
        )}
        {boot.conversations.map((c) => (
          <div key={c.id} className={`recent-item${currentId === c.id ? " active" : ""}`}>
            <button
              className="recent-title"
              style={{ textAlign: "left", flex: "1 1 auto" }}
              onClick={() => {
                setCurrentId(c.id);
                setSection("chat");
              }}
            >
              <span className="recent-title">{c.title || P("untitledChat")}</span>
            </button>
            <span className="recent-date">{c.updatedAt.slice(0, 10)}</span>
            {confirmDelete === c.id ? (
              <button
                className="btn danger"
                onClick={() =>
                  void window.nido.conversationDelete(c.id).then(() => {
                    setConfirmDelete(null);
                    if (currentId === c.id) setCurrentId(null);
                    void refresh();
                  })
                }
              >
                {D("deleteConfirm")}
              </button>
            ) : (
              <button title={P("deleteChat")} onClick={() => setConfirmDelete(c.id)}>
                <Icon name="delete" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <span>RAM {panelFig("ram")?.text}</span>
        <span>
          {P("diskUsed")}: {panelFig("disk")?.text}
        </span>
        <span>
          {boot.stats.lastGenRate != null
            ? fill(lookup(s, "drawerFooterStats", "lastQuery"), { rate: boot.stats.lastGenRate })
            : P("lastRateNone")}
        </span>
        {panelFig("model") && !panelFig("model")!.hole && <span>{panelFig("model")!.text}</span>}
        {panelFig("context") && !panelFig("context")!.hole && (
          <span>
            {P("panelContext")}: {panelFig("context")!.text}
          </span>
        )}
        <span>
          {P("panelMemory")}: {panelFig("memory")?.text}
        </span>
        <button
          className="nav-item"
          onClick={() => void window.nido.prefsSet({ sidebarCollapsed: true }).then(() => refresh())}
        >
          <Icon name="chev-down" size={16} /> {P("collapse")}
        </button>
      </div>
      <div className="sidebar-resizer" onMouseDown={onResizeDown} />
    </aside>
  );
}

// ---------------------------------------------------------------------
// S-7 · La bienvenida
// ---------------------------------------------------------------------

function WelcomeView({
  boot,
  onStart,
  onIdea,
}: {
  boot: Boot;
  onStart: () => void;
  onIdea: (prompt: string) => void;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const carousel = (s as Record<string, { title?: string; items?: { category: string; prompt: string }[] }>)
    .promptIdeasCarousel;
  const ideas = Array.isArray(carousel?.items) ? carousel.items.slice(0, 6) : [];
  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card welcome-hero">
          <img src="/mascot-nido.png" alt="" />
          <h2 className="screen-title">{P("welcomeTitle")}</h2>
          <p>{P("welcomeBody")}</p>
          <p>{P("welcomePoint1")}</p>
          <p>{P("welcomePoint2")}</p>
          <p>{P("welcomePoint3")}</p>
          <button className="btn primary" onClick={onStart}>
            {P("welcomeStart")}
          </button>
          {ideas.length > 0 && (
            <>
              <span className="section-label">{carousel?.title ?? ""}</span>
              <div className="ideas-row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                {ideas.map((idea, i) => (
                  <button key={i} className="idea-chip" onClick={() => onIdea(idea.prompt)}>
                    {idea.category}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// S-8 · Sin modelo y error de carga
// ---------------------------------------------------------------------

function NoModelView({
  boot,
  goModels,
  refresh,
}: {
  boot: Boot;
  goModels: () => void;
  refresh: () => Promise<void>;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const rec = boot.recommendation;

  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card">
          <img src="/mascot-nido.png" alt="" width={120} height={120} />
          <h2>{P("noModelTitle")}</h2>
          <p>{P("noModelBody")}</p>
          <div>
            <span className="section-label">{P("recommendationTitle")}</span>
            <p>
              <strong>{rec.plainLabel}</strong>
            </p>
            <p>
              {fill(P("recommendationBudget"), {
                gb: gb(rec.budgetBytes),
                total: gb(rec.totalRamBytes),
              })}
            </p>
            {rec.sizeBytes != null && <p>{fill(P("recommendationSize"), { gb: gb(rec.sizeBytes) })}</p>}
            <p>{fitText(rec.fit, P)}</p>
          </div>
          <button className="btn primary" onClick={goModels}>
            {P("noModelOpen")}
          </button>
        </div>
        <div className="composer-column" style={{ width: "100%" }}>
          <div className="composer composer-box" aria-disabled="true">
            <textarea rows={1} disabled placeholder={P("noModelComposerWhy")} />
            <button className="send-box" disabled title={P("send")}>
              <Icon name="send" size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// La vista de emergencia: temas que se preguntan por el turno real
// ---------------------------------------------------------------------

function EmergencyView({
  boot,
  goChat,
  refresh,
}: {
  boot: Boot;
  goChat: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  // C-3 del cableado de chat: la tarjeta de confirmación
  // también vive en esta vista, en la forma del paso 8 de
  // E5. Un turno lanzado desde Emergencia puede pedir
  // confirmación a mitad de camino (una herramienta, una
  // política) y la persona ya navegó aquí tras enviar:
  // sin esta escucha, la petición esperaba en una vista
  // desmontada y solo el drenaje del bloqueo, de la
  // parada o del cierre la resolvía. La escucha filtra
  // los kinds del turno (tool y policy); el de los
  // paquetes sigue siendo de la pestaña de Paquetes, y
  // la respuesta va por el mismo canal de siempre.
  useEffect(() => {
    const off = window.nido.onConfirmRequest((p) => {
      if (p.kind === "tool" || p.kind === "policy") setConfirm(p);
    });
    return off;
  }, []);
  // La guía de RCP se puede escuchar entera (paso 2 de E9):
  // el texto es el de la guía del porte (CPR_GUIDE, palabra
  // por palabra la de NIDO Esencial), leído con la voz del
  // idioma por el mismo camino de lectura que todo lo demás.
  const speechAvailable = useSpeechAvailable();
  const { readingId, toggleRead } = useReading(boot.prefs.lang);
  // El orden de la superficie sigue el de la tabla fija sellada:
  // autolesión primero, monóxido después, el número al final.
  // §1 pieza A del bloque del loop: cada tema que depende de
  // la elección dice su guía por su clave, y el turno la sirve
  // literal sin pasar por ella. Los temas con vía fija sellada
  // (autolesión, monóxido, número) no traen clave: su orden en
  // el pipeline ya manda antes que el bloque de la clave.
  const topics: { label: string; query: string; guideKey?: string }[] = [
    { label: P("emergencyTopicSelfHarm"), query: P("emergencyQuerySelfHarm") },
    { label: P("emergencyTopicCo"), query: P("emergencyQueryCo") },
    { label: P("emergencyTopicRcp"), query: P("emergencyQueryRcp"), guideKey: "esencial-rcp-adultos" },
    { label: P("emergencyTopicChoking"), query: P("emergencyQueryChoking"), guideKey: "esencial-atragantamiento" },
    { label: P("emergencyTopicBleeding"), query: P("emergencyQueryBleeding"), guideKey: "esencial-hemorragias-graves" },
    { label: P("emergencyTopicBurns"), query: P("emergencyQueryBurns"), guideKey: "esencial-quemaduras" },
    { label: P("emergencyTopicNumber"), query: P("emergencyQueryNumber") },
  ];
  const ask = async (query: string, guideKey?: string) => {
    // E-2: un toque, un turno; y el resultado se mira: un fallo
    // del puente se enseña aquí, no se confunde con un éxito.
    if (busy || query.trim() === "") return;
    setBusy(true);
    setFailed(false);
    const id = `conv-${Date.now()}`;
    const r = (await window.nido.turnSend({ conversationId: id, text: query, guideKey })) as { ok: boolean };
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      return;
    }
    await refresh();
    goChat(id);
  };
  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card">
          <h2>{P("emergencyTitle")}</h2>
          <p>{P("emergencyBody")}</p>
          {topics.map((t) => (
            <button key={t.label} className="btn" disabled={busy} onClick={() => void ask(t.query, t.guideKey)}>
              <Icon name="warning" size={20} /> {t.label}
            </button>
          ))}
          {speechAvailable && (
            <button
              className="btn"
              onClick={() => {
                const guide = CPR_GUIDE[boot.prefs.lang];
                void toggleRead(
                  "cpr-guide",
                  [
                    guide.title,
                    guide.headings.before,
                    ...guide.before,
                    guide.headings.compressions,
                    ...guide.compressions,
                    guide.headings.breaths,
                    ...guide.breaths,
                    guide.headings.stop,
                    ...guide.stop,
                  ]
                    .map((piece) => {
                      const t = piece.trim();
                      return /[.!?…:]$/.test(t) ? t : `${t}.`;
                    })
                    .join(" "),
                );
              }}
              aria-pressed={readingId === "cpr-guide"}
            >
              <Icon name="speaker" size={20} />{" "}
              {readingId === "cpr-guide" ? P("stopReading") : P("readCprGuide")}
            </button>
          )}
          <div className="field">
            <label htmlFor="emergency-free">{P("emergencyFreeLabel")}</label>
            <input
              id="emergency-free"
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void ask(freeText);
              }}
            />
          </div>
          <button className="btn primary" disabled={busy || freeText.trim() === ""} onClick={() => void ask(freeText)}>
            {P("send")}
          </button>
          {failed && <p className="vault-error">{P("phaseFailed")}</p>}
          {confirm && (
            <div className="confirm-card">
              <div>{confirm.title ?? P("confirmTitle")}</div>
              {confirm.scope && <div className="scope">{confirm.scope}</div>}
              <div>{confirm.message}</div>
              <div className="confirm-actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    window.nido.confirmResponse(confirm.id, true);
                    setConfirm(null);
                  }}
                >
                  {P("confirmApprove")}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    window.nido.confirmResponse(confirm.id, false);
                    setConfirm(null);
                  }}
                >
                  {P("confirmReject")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Secciones declaradas (Agenda y NIDO en esta tanda)
// ---------------------------------------------------------------------

function DeclaredView({
  boot,
  titleKey,
  bodyKey,
  icon,
}: {
  boot: Boot;
  titleKey: string;
  bodyKey: string;
  icon: string;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card">
          <h2>
            <Icon name={icon} size={24} /> {P(titleKey)}
          </h2>
          <p>{P(bodyKey)}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * La lectura en voz alta (E9 paso 2), compartida por las
 * superficies que leen: un solo identificador de lectura en
 * curso por vista; pulsar el mismo control detiene, pulsar
 * otro cambia de texto (speakText corta lo anterior). Al
 * terminar o detenerse, el motor de lectura se suelta en su
 * proceso. Lo que se lee es siempre texto ya asentado (la
 * respuesta tras el juez, la lección entera, la guía de
 * RCP del porte): esta casa no lee borradores.
 */
function useReading(lang: string) {
  const [readingId, setReadingId] = useState<string | null>(null);
  const readingRef = useRef<string | null>(null);
  const toggleRead = useCallback(
    async (id: string, text: string) => {
      if (readingRef.current === id) {
        stopSpeaking();
        return;
      }
      installTtsPort();
      readingRef.current = id;
      setReadingId(id);
      try {
        await speakText(text, lang);
      } finally {
        if (readingRef.current === id) {
          readingRef.current = null;
          setReadingId(null);
          releaseSpeechEngine();
        }
      }
    },
    [lang],
  );
  return { readingId, toggleRead };
}

/** La presencia de la voz de lectura, cobrada al montar la vista. */
function useSpeechAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void window.nido
      .voiceSpeakState()
      .then((r) => {
        if (live) setAvailable(r?.ok === true && r.state === "onDevice");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return available;
}

// ---------------------------------------------------------------------
// S-2 a S-6 · El chat
// ---------------------------------------------------------------------

function ChatView({
  boot,
  currentId,
  setCurrentId,
  sending,
  onSendingChange,
  refresh,
  guideDraft,
  goModels,
  goTone,
  goVoice,
  keysRef,
  jumpRequest,
}: {
  boot: Boot;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  sending: boolean;
  onSendingChange: (v: boolean) => void;
  refresh: () => Promise<void>;
  guideDraft: { text: string; seq: number } | null;
  goModels: () => void;
  goTone: () => void;
  goVoice: () => void;
  keysRef: React.MutableRefObject<{ goEnd?: () => void; openFind?: () => void }>;
  jumpRequest?: { index: number; seq: number } | null;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const C = (k: string) => lookup(s, "chatScreen", k);
  const conv = boot.conversations.find((c) => c.id === currentId) ?? null;
  const [draft, setDraft] = useState("");
  const [streamed, setStreamed] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  // E10 (paso 1): el chip de investigación nace del ajuste
  // persistido (apagado por defecto) y cada toque lo persiste
  // por el canal de ajustes: la superficie y el turno leen la
  // misma verdad, como en el móvil.
  const [research, setResearch] = useState(boot.deepResearchMode ?? false);
  // E10 (paso 4): el plan pendiente de aprobación. Mientras
  // existe, el envío está en pausa: la persona ve el plan, lo
  // edita y decide si la corrida gasta en él.
  const [pendingPlan, setPendingPlan] = useState<{ plan: ResearchPlanData; text: string } | null>(null);
  const [planning, setPlanning] = useState(false);
  // E10 (paso 5): la forma de lectura elegida para un informe
  // ya servido, por conversación y turno. Es solo de lectura:
  // el turno guardado conserva la forma servida y sus cuatro
  // formas; esto cambia cuál se enseña, nunca el documento.
  const [styleOverrides, setStyleOverrides] = useState<Record<string, string>>({});
  // E10 (paso 6): las sesiones de investigación guardadas y
  // la confirmación de borrado en curso (la misma puerta de
  // doble toque del chat: primer toque arma, segundo borra).
  const [researchSessionsList, setResearchSessionsList] = useState<ResearchSessionSummaryData[]>([]);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<string | null>(null);
  const loadResearchSessions = useCallback(async () => {
    try {
      const r = await window.nido.researchSessions();
      if (r?.ok && r.sessions) setResearchSessionsList(r.sessions);
    } catch {
      // Sin lista (el puente falló), la superficie sigue.
    }
  }, []);
  useEffect(() => {
    if (research) void loadResearchSessions();
  }, [research, loadResearchSessions]);
  const toggleResearch = () => {
    setResearch((v) => {
      const next = !v;
      void window.nido.settingsSet({ deepResearchMode: next });
      return next;
    });
  };
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  const [panelSource, setPanelSource] = useState<{
    title: string;
    label?: string;
    body: string;
    truncated?: boolean;
    rawScore?: number;
    pageHeader?: string;
    pageText?: string;
  } | null>(null);
  // E11 (paso 8): la vista dividida sobre este panel. El
  // estado de la pieza (dividida.ts) guarda el ancla y la
  // conversación principal; el panel pinta la división
  // abierta (una fuente, un documento de la biblioteca o
  // otra conversación) y al cerrar vuelve al sitio.
  const [split, setSplit] = useState<SplitState>(() => closedSplit("msg-0"));
  const [mediumRegime, setMediumRegime] = useState(
    () => window.matchMedia("(max-width: 1199px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1199px)");
    const onChange = () => setMediumRegime(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Cambiar de conversación cierra la división: era de la otra.
  useEffect(() => {
    setSplit(closedSplit("msg-0"));
    setPanelSource(null);
  }, [currentId]);

  const currentAnchorId = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return "msg-0";
    const top = box.getBoundingClientRect().top;
    for (const n of Array.from(box.querySelectorAll("[data-turn]"))) {
      if (n.getBoundingClientRect().bottom > top + 8) {
        return `msg-${n.getAttribute("data-turn")}`;
      }
    }
    return "msg-0";
  }, []);

  const openSourceSplit = (
    src: NonNullable<StoredTurn["sources"]>[number],
    turnIndex: number,
  ) => {
    // La forma servida dirime la división: un documento
    // personal paginado se lee como documento de la
    // biblioteca; un fragmento de paquete, como fuente.
    const kind = src.pageText ? "library-doc" : "source";
    setSplit(
      openSplit(
        closedSplit(`msg-${turnIndex}`, currentId ?? undefined),
        kind,
        `fuente:${src.label ?? src.title}`,
      ),
    );
    setPanelSource(src);
  };

  const openConversationSplit = (otherId: string) => {
    setSplit(
      openSplit(
        closedSplit(currentAnchorId(), currentId ?? undefined),
        "conversation",
        otherId,
      ),
    );
    setPanelSource(null);
  };

  const closeSplitSurface = () => {
    const anchorIdx = Number(split.anchor.replace("msg-", ""));
    setSplit(closeSplit(split));
    setPanelSource(null);
    if (Number.isFinite(anchorIdx)) {
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector(`[data-turn="${anchorIdx}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    }
  };
  const [noModelTurn, setNoModelTurn] = useState(false);
  // El dictado por voz (E9 paso 1): el botón vive solo si la
  // escucha local está presente (el estado del motor se cobra
  // al montar la vista), y el texto dictado aterriza en el
  // borrador para que la persona lo revise antes de enviar.
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [dictating, setDictating] = useState(false);
  // La lectura (paso 2): su botón vive solo si Kokoro está
  // presente, y lee los turnos ya asentados del asistente.
  const speechAvailable = useSpeechAvailable();
  const { readingId, toggleRead } = useReading(boot.prefs.lang);
  const activeTurnConv = useRef<string | null>(null);
  const [showGoEnd, setShowGoEnd] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingEmergency = useRef(false);

  const resident = boot.models.find((m) => m.resident);
  const anyInstalled = boot.models.some((m) => m.installed && m.kind === "llm");
  const turns = conv?.turns ?? [];
  // L-1: la señal propia del pipeline tiene estado en la
  // superficie también cuando el turno llegó por otra vista (la
  // de emergencia): se deriva del último turno guardado, no solo
  // del envío hecho desde esta vista.
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  const storedNoModel =
    lastAssistant != null &&
    lastAssistant.text.trim() === "" &&
    (lastAssistant.warnings ?? []).includes("no-generate-step:no-model-available");
  const ideas = useMemo(() => {
    const items = (s as Record<string, { items?: { category: string; prompt: string }[] }>).promptIdeasCarousel?.items;
    return Array.isArray(items) ? items.slice(0, 6) : [];
  }, [s]);

  // La presencia de la escucha local, al montar la vista: sin
  // motor presente no hay botón (oferta y UI, siempre juntas).
  useEffect(() => {
    let live = true;
    void window.nido
      .voiceEngineState()
      .then((r) => {
        if (live) setVoiceAvailable(r?.ok === true && r.state === "onDevice");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // La lectura automática (readAloudEnabled, la forma del
  // móvil): al asentarse una respuesta NUEVA se lee; abrir
  // una conversación vieja no lee su última respuesta (la
  // primera observación solo registra la marca).
  const autoReadKey = useRef<string | null>(null);
  useEffect(() => {
    const lastIdx = turns.length - 1;
    const last = turns[lastIdx];
    const key = `${currentId}:${lastIdx}`;
    if (autoReadKey.current === null) {
      autoReadKey.current = key;
      return;
    }
    if (!(boot.readAloudEnabled ?? false) || sending) return;
    if (!last || last.role !== "assistant" || last.text.trim() === "") return;
    if (autoReadKey.current === key) return;
    autoReadKey.current = key;
    void toggleRead(`turn:${currentId}:${lastIdx}`, last.text);
  }, [sending, turns, currentId, boot.readAloudEnabled, toggleRead]);

  // El gesto del dictado: al pulsar se abre la sesión (la
  // escucha se carga en su proceso y el micrófono se abre
  // tras la carga); el VAD corta la frase; el texto llega al
  // borrador y NO se envía: lo revisa la persona y lo manda
  // con el mismo envío de siempre, por el mismo cauce. Al
  // pulsar otra vez, la sesión se para y vale lo oído.
  const toggleDictation = useCallback(async () => {
    if (dictating) {
      await stopListening();
      return;
    }
    // Hablar interrumpe la lectura: quien dicta, manda.
    stopSpeaking();
    installVoicePort();
    setDictating(true);
    try {
      const text = await startListening();
      if (text) {
        setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${text}` : text));
        composerRef.current?.focus();
      }
    } finally {
      stopVoiceCapture();
      setDictating(false);
    }
  }, [dictating]);

  // La semilla de la guía: un ejemplo tocado en «Aprende» se
  // escribe en el compositor al llegar a esta vista, sin enviar.
  useEffect(() => {
    if (!guideDraft) return;
    setDraft(guideDraft.text);
    composerRef.current?.focus();
  }, [guideDraft]);

  const sendingRef = useRef(false);
  sendingRef.current = sending;
  useEffect(() => {
    // Al desmontar la vista con un turno en vuelo (la persona
    // navegó a otra sección), el turno se para: su tarjeta de
    // confirmación ya no está en pantalla y el principal drena
    // lo pendiente en falso (H-1 del loop de confirmación).
    return () => {
      if (sendingRef.current) void window.nido.turnStop();
    };
  }, []);

  useEffect(() => {
    const offToken = window.nido.onTurnToken((p) => {
      // L-5: los trozos son de la conversación que los pidió; si
      // la persona cambió de conversación a mitad de turno, no se
      // pintan en la equivocada.
      if (p.conversationId !== activeTurnConv.current) return;
      setStreamed((prev) => prev + p.chunk);
    });
    const offPhase = window.nido.onTurnPhase((p) => {
      if (p.phase === "searching") setPhase("phaseSearching");
      else setPhase("phaseWriting");
    });
    const offConfirm = window.nido.onConfirmRequest((p) => {
      setConfirm(p);
      setPhase("phaseApproval");
    });
    return () => {
      offToken();
      offPhase();
      offConfirm();
    };
  }, []);

  // F-UI-02: el área de texto crece con el borrador hasta el
  // tope de 160 px que ya declara la hoja; al vaciarse (envío
  // o restauración) vuelve a una línea, porque todo pasa por
  // setDraft.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowGoEnd(false);
  }, []);

  // E11 (paso 1): buscar dentro de la conversación (Ctrl+F).
  // El índice es la propia conversación abierta: cada salto
  // cae en el mensaje exacto que contiene el texto, y la
  // barra se cierra sin dejar rastro en el turno.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findMatches = useMemo(() => {
    if (!findOpen || !findQuery.trim()) return [] as number[];
    const q = findQuery.toLocaleLowerCase();
    const out: number[] = [];
    turns.forEach((t, i) => {
      if (t.text.toLocaleLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [findOpen, findQuery, turns]);
  const findHit =
    findMatches.length > 0
      ? findMatches[Math.min(findIdx, findMatches.length - 1)]
      : null;
  // E11 (paso 9): el salto del buscador global aterriza en
  // el mensaje exacto y lo marca un momento, sin dejar
  // estado en el turno.
  const [jumpHit, setJumpHit] = useState<number | null>(null);
  useEffect(() => {
    if (!jumpRequest) return;
    const i = jumpRequest.index;
    const raf = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-turn="${i}"]`)
        ?.scrollIntoView({ block: "center" });
      setJumpHit(i);
    });
    const t = setTimeout(() => setJumpHit(null), 2400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [jumpRequest]);
  useEffect(() => {
    if (findHit == null) return;
    scrollRef.current
      ?.querySelector(`[data-turn="${findHit}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [findHit]);
  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (findMatches.length === 0) return;
      setFindIdx((v) => (v + dir + findMatches.length) % findMatches.length);
    },
    [findMatches.length],
  );

  // Las costuras que el mapa de la raíz invoca sobre esta
  // vista: ir al final (Fin) y abrir la búsqueda (Ctrl+F).
  useEffect(() => {
    keysRef.current.goEnd = scrollToEnd;
    keysRef.current.openFind = () => {
      setFindOpen(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
    };
    return () => {
      keysRef.current.goEnd = undefined;
      keysRef.current.openFind = undefined;
    };
  }, [keysRef, scrollToEnd]);

  // E11 (pasos 2 y 3): la materia adjunta del composer. Lo
  // caído y lo pegado entra por las piezas (caida/pegado),
  // clasificado por sus bytes contra el contrato vivo; la
  // superficie guarda con cada ficha su ruta (la extracción
  // del turno es por ruta, como la importación de E6) o sus
  // bytes si no la tiene (la imagen pegada). Nada de lo
  // adjunto se indexa: unirse a la Biblioteca pasa por la
  // confirmación de E6, no por esta cola.
  type ChipEntry = { chip: AttachmentChip; path?: string; dataBase64?: string };
  const [chipEntries, setChipEntries] = useState<ChipEntry[]>([]);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const chipEntriesRef = useRef<ChipEntry[]>([]);
  useEffect(() => {
    chipEntriesRef.current = chipEntries;
  }, [chipEntries]);
  const attachNextRef = useRef(false);

  const noteRejections = (rejected: { name: string; reason: string }[]) => {
    if (rejected.length === 0) return;
    const reasonKeys: Record<string, string> = {
      archive: "dropReasonArchive",
      spreadsheet: "dropReasonSpreadsheet",
      "old-office": "dropReasonOldOffice",
      unknown: "dropReasonUnknown",
    };
    setDropNote(
      rejected
        .map((x) => `${x.name}: ${P(reasonKeys[x.reason] ?? "dropReasonUnknown")}`)
        .join(" · "),
    );
  };

  const addDroppedFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const dropped: { name: string; bytes: Uint8Array; path?: string }[] = [];
    for (const f of files) {
      const sample = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
      dropped.push({
        name: f.name,
        bytes: sample,
        path: window.nido.docFilePath(f) || undefined,
      });
    }
    const r = acceptDrop(
      dropped.map(({ name, bytes }) => ({ name, bytes })),
      { vaultUnlocked: boot.vault.unlocked },
    );
    const byName = new Map(dropped.map((d) => [d.name, d]));
    setChipEntries((prev) => [
      ...prev,
      ...r.accepted.map((chip) => ({ chip, path: byName.get(chip.name)?.path })),
    ]);
    noteRejections(r.rejected);
  };

  const removeChip = (id: string) => {
    setChipEntries((prev) => {
      const kept = discardAttachment(
        prev.map((e) => e.chip),
        id,
      );
      return prev.filter((e) => kept.some((c) => c.id === e.chip.id));
    });
  };

  const base64Of = (bytes: Uint8Array): string => {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files ?? []);
    const imageItem = Array.from(cd.items ?? []).find((it) =>
      it.type.startsWith("image/"),
    );
    // El texto pegado es el gesto nativo del campo: la casa
    // solo intercepta la materia que el campo no sabe poner.
    if (files.length === 0 && !imageItem) return;
    e.preventDefault();
    void (async () => {
      const dropped: { name: string; bytes: Uint8Array; path?: string }[] = [];
      for (const f of files) {
        const sample = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
        dropped.push({
          name: f.name,
          bytes: sample,
          path: window.nido.docFilePath(f) || undefined,
        });
      }
      let image: Uint8Array | undefined;
      const imgFile = files.length === 0 ? imageItem?.getAsFile() : null;
      if (imgFile) image = new Uint8Array(await imgFile.arrayBuffer());
      const r = acceptPaste({
        files: dropped.map(({ name, bytes }) => ({ name, bytes })),
        image,
      });
      if (r.kind !== "attachments") return;
      const byName = new Map(dropped.map((d) => [d.name, d]));
      setChipEntries((prev) => [
        ...prev,
        ...r.chips.map((chip) => {
          const src = byName.get(chip.name);
          if (src) return { chip, path: src.path };
          return { chip, dataBase64: image ? base64Of(image) : undefined };
        }),
      ]);
    })();
  };

  useEffect(() => {
    if (sending) scrollToEnd();
  }, [streamed, sending, scrollToEnd]);

  const send = useCallback(
    async (text: string, planOverride?: ResearchPlanData, sessionId?: string) => {
      const clean = text.trim();
      if (!clean || sending || planning) return;
      // E10 (paso 4): con el modo de investigación activo y sin
      // plan aprobado, el envío pide primero el plan. Si el
      // turno se sirve por otra ruta o la segunda red
      // intercepta, el envío sigue normal; si hay plan, la
      // persona lo ve y lo edita antes de gastar en la corrida.
      // E10 (paso 6): reanudar una sesión no pide plan: la
      // sesión ya lo trae cerrado.
      if (research && !planOverride && !sessionId) {
        setPlanning(true);
        setPhase("researchPlanPlanning");
        try {
          const rp = await window.nido.researchPlan({ text: clean });
          if (rp?.ok && rp.outcome?.kind === "plan" && rp.outcome.plan) {
            setPendingPlan({ plan: rp.outcome.plan, text: clean });
            setDraft("");
            setPhase(null);
            setPlanning(false);
            return;
          }
        } catch {
          // Sin plan (el puente falló), el envío corre normal.
        }
        setPlanning(false);
        setPhase(null);
      }
      const id = currentId ?? `conv-${Date.now()}`;
      if (!currentId) setCurrentId(id);
      activeTurnConv.current = id;
      setNoModelTurn(false);
      onSendingChange(true);
      setStreamed("");
      setPhase("phaseThinking");
      setLoadError(false);
      try {
      // E11 (pasos 2 y 3): la materia del composer viaja con
      // su turno y solo con el suyo: la marca la pone el
      // gesto del composer y se consume aquí, en el envío
      // real (tras el plan, si lo hubo); la emergencia y las
      // reanudaciones no la heredan.
      const attach = attachNextRef.current;
      attachNextRef.current = false;
      const r = (await window.nido.turnSend({
        conversationId: id,
        text: clean,
        researchMode: research,
        researchPlan: planOverride,
        researchSessionId: sessionId,
        attachments: attach
          ? chipEntriesRef.current.map((e) => ({
              name: e.chip.name,
              kind: e.chip.kind,
              path: e.path,
              dataBase64: e.dataBase64,
            }))
          : undefined,
      })) as {
        ok: boolean;
        result?: {
          warnings: string[];
          stopped: boolean;
          timedOut: boolean;
          contextNote: { droppedTurns: number; fractionUsed: number } | null;
        };
      };
      onSendingChange(false);
      setPhase(null);
      if (!r.ok) {
        setPhase("phaseFailed");
        return;
      }
      if (r.result?.stopped || r.result?.timedOut) setPhase("phaseStopped");
      const warnings = r.result?.warnings ?? [];
      const loadFailed = warnings.some((w) => w.startsWith("model-unavailable"));
      const noGenerate = warnings.some((w) => w === "no-generate-step:no-model-available");
      if (loadFailed) setLoadError(true);
      if (noGenerate) setNoModelTurn(true);
      // S-8 (y la auditoría del loop, L-2): si el turno no generó,
      // el texto de la persona queda intacto en el campo, carácter
      // a carácter; solo un turno servido lo limpia.
      if (loadFailed || noGenerate) setDraft(clean);
      else {
        setDraft("");
        // La materia servida se va con su turno; la de un
        // turno no generado se queda, como el borrador.
        if (attach) setChipEntries([]);
      }
      await refresh();
      if (research) void loadResearchSessions();
      } catch {
        // F-UI-10: si el puente lanza, el envío se asienta
        // como fallido en la línea de fase en vez de morir en
        // silencio con el vuelo puesto; la liberación del
        // vuelo vive en el finally, que corre en toda salida.
        setPhase("phaseFailed");
      } finally {
        onSendingChange(false);
      }
      // La cola de emergencia corre tras el finally: el
      // reenvío pone su propio vuelo y el finally de este
      // envío no puede pisarlo.
      if (pendingEmergency.current) {
        pendingEmergency.current = false;
        void send(P("emergencyQuery"));
      }
    },
    [currentId, sending, planning, onSendingChange, research, refresh, P],
  );

  // El envío del composer: marca que la materia adjunta
  // viaja con este turno (la emergencia no pasa por aquí).
  const sendFromComposer = () => {
    attachNextRef.current = true;
    void send(draft);
  };

  const emergencyNow = async () => {
    if (!sending) {
      void send(P("emergencyQuery"));
      return;
    }
    pendingEmergency.current = true;
    await window.nido.turnStop();
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowGoEnd(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  };

  return (
    <>
      <div className="chat-header">
        <div className="local-line">{P("statusLocal")}</div>
        {conv && turns.length > 0 && (
          <ExportControl
            P={P}
            title={conv.title || P("untitledChat")}
            messages={turns.map((t) => ({ role: t.role, text: t.text }))}
          />
        )}
        {conv && boot.conversations.length > 1 && (
          <SplitControl
            P={P}
            others={boot.conversations.filter((c) => c.id !== currentId)}
            onPick={openConversationSplit}
          />
        )}
        <div className="model-line">
          {resident ? (
            <>
              {resident.plainLabel} · {P("modelReady")}
            </>
          ) : anyInstalled ? (
            P("modelNotLoaded")
          ) : (
            P("modelNone")
          )}
        </div>
      </div>
      <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0, position: "relative" }}>
        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll} style={{ flex: "1 1 auto" }}>
          <div className="chat-column">
            {turns.length === 0 && (
              <>
                <img src="/mascot-nido.png" alt="" width={120} height={120} style={{ display: "block", margin: "0 auto" }} />
                <h2 style={{ textAlign: "center" }}>{P("chatEmptyTitle")}</h2>
                <p style={{ textAlign: "center" }}>{P("chatEmptyBody")}</p>
              </>
            )}
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className={`turn-user${(findHit === i || jumpHit === i) ? " find-hit" : ""}`} data-turn={i}>
                  {t.text}
                </div>
              ) : (
                <div key={i} className={`turn-assistant${(findHit === i || jumpHit === i) ? " find-hit" : ""}`} data-turn={i}>
                  {t.evidence && (
                    <div className="evidence-card">
                      <div className="key-phrase">{t.evidence.highlight}</div>
                      <div className="source-notes">
                        {t.evidence.label ?? t.evidence.title}
                        {t.sources && t.sources.length > 0
                          ? ` · ${t.sources.length} ${P("sourcesLabel").toLowerCase()}`
                          : ""}
                      </div>
                    </div>
                  )}
                  {!(t.text.trim() === "" && (t.warnings ?? []).includes("no-generate-step:no-model-available")) && (
                    <div className="bubble">{styleOverrides[`${currentId}:${i}`] ?? t.text}</div>
                  )}
                  <div className="meta-row">
                    {speechAvailable && t.text.trim() !== "" && (
                      <button
                        className="read-btn"
                        onClick={() => void toggleRead(`turn:${currentId}:${i}`, t.text)}
                        title={readingId === `turn:${currentId}:${i}` ? P("stopReading") : P("readAloud")}
                        aria-label={readingId === `turn:${currentId}:${i}` ? P("stopReading") : P("readAloud")}
                        aria-pressed={readingId === `turn:${currentId}:${i}`}
                      >
                        <Icon name="speaker" size={16} />
                      </button>
                    )}
                    {t.judgeMode && (
                      <span>{t.judgeMode === "full" ? P("judgeFull") : P("judgeLexical")}</span>
                    )}
                    {t.warnings && t.warnings.length > 0 && (
                      <span>{warningText(t.warnings, P)}</span>
                    )}
                    {(t.timedOut || t.stopped) && <span>{P("phaseStopped")}</span>}
                    {t.failed && <span>{P("phaseFailed")}</span>}
                    {t.researchPreempted && <span>{P("researchPreempted")}</span>}
                  </div>
                  {t.sources && t.sources.length > 0 && (
                    <div>
                      {t.sources.map((src, j) => (
                        <button key={j} className="source-chip" onClick={() => openSourceSplit(src, i)}>
                          <Icon name="knowledge" size={16} /> {src.label ?? src.title}
                          {typeof src.rawScore === "number" && src.rawScore >= 0 && src.rawScore <= 1
                            ? ` · ${fill(P("sourceRelevance"), { pct: Math.round(src.rawScore * 100) })}`
                            : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {t.contextNote && (
                    <div className="context-note">
                      {t.contextNote === "dropping" ? P("contextDropping") : P("contextFilling")}
                    </div>
                  )}
                  {t.research && (
                    <ResearchTurnExtras
                      P={P}
                      research={t.research}
                      reportId={t.researchReportId}
                      sources={t.sources ?? []}
                      onOpenSource={(src) => openSourceSplit(src, i)}
                      onShowText={(text) =>
                        setStyleOverrides((v) => ({ ...v, [`${currentId}:${i}`]: text }))
                      }
                    />
                  )}
                </div>
              ),
            )}
            {sending && streamed && activeTurnConv.current === currentId && (
              <div className="turn-assistant">
                <div className="bubble">{streamed}</div>
              </div>
            )}
            {(noModelTurn || storedNoModel) && (
              <div className="card">
                <strong>{P("noModelTitle")}</strong>
                <p>{P("noModelBody")}</p>
                <button className="btn primary" onClick={goModels}>
                  {P("noModelOpen")}
                </button>
              </div>
            )}
            {confirm && (
              <div className="confirm-card">
                <div>{confirm.title ?? P("confirmTitle")}</div>
                {confirm.scope && <div className="scope">{confirm.scope}</div>}
                <div>{confirm.message}</div>
                <div className="confirm-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      window.nido.confirmResponse(confirm.id, true);
                      setConfirm(null);
                      setPhase("phaseThinking");
                    }}
                  >
                    {P("confirmApprove")}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      window.nido.confirmResponse(confirm.id, false);
                      setConfirm(null);
                      setPhase("phaseThinking");
                    }}
                  >
                    {P("confirmReject")}
                  </button>
                </div>
              </div>
            )}
            {loadError && (
              <div className="card">
                <strong>{P("loadErrorTitle")}</strong>
                <p>{P("loadErrorBody")}</p>
                <div className="confirm-actions">
                  <button
                    className="btn"
                    onClick={() => {
                      const installed = boot.models.find((m) => m.installed && m.kind === "llm");
                      if (installed) void window.nido.modelLoad(installed.id).then(() => refresh());
                    }}
                  >
                    {P("loadErrorRetry")}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const installed = boot.models.find((m) => m.installed && m.kind === "llm");
                      if (installed)
                        void window.nido.modelLoadRetryLess(installed.id).then(() => refresh());
                    }}
                  >
                    {P("loadErrorRetryLess")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {splitPresentation(split, mediumRegime ? "medium" : "wide") !== "none" && (
          <aside
            className="sources-panel"
            data-presentation={splitPresentation(split, mediumRegime ? "medium" : "wide")}
          >
            {split.open === "conversation" ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3>
                    {boot.conversations.find((c) => c.id === split.ref)?.title ||
                      P("untitledChat")}
                  </h3>
                  <button onClick={closeSplitSurface} aria-label="close">
                    <Icon name="close" size={20} />
                  </button>
                </div>
                <span className="section-label">{P("splitReadBeside")}</span>
                <div className="split-turns">
                  {(boot.conversations.find((c) => c.id === split.ref)?.turns ?? []).map(
                    (t, j) => (
                      <div key={j} className={t.role === "user" ? "turn-user" : "turn-assistant"}>
                        <div className="bubble">{t.text}</div>
                      </div>
                    ),
                  )}
                </div>
              </>
            ) : panelSource ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3>{panelSource.label ?? panelSource.title}</h3>
                  <button onClick={closeSplitSurface} aria-label="close">
                    <Icon name="close" size={20} />
                  </button>
                </div>
                <span className="section-label">{P("sourcesLabel")}</span>
                {panelSource.pageHeader && <div className="section-label">{panelSource.pageHeader}</div>}
                <div className="passage">{panelSource.pageText ?? panelSource.body}</div>
                {panelSource.truncated && <span className="truncated-note">…</span>}
              </>
            ) : null}
          </aside>
        )}
      </div>
      {showGoEnd && (
        <button className="go-end" onClick={scrollToEnd} title={P("goToEnd")}>
          <Icon name="chev-down" size={20} />
        </button>
      )}
      <div
        className="composer-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addDroppedFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <div className="composer-column">
          {turns.length === 0 && ideas.length > 0 && (
            <div className="ideas-row">
              {ideas.map((idea, i) => (
                <button
                  key={i}
                  className="idea-chip"
                  onClick={() => {
                    const outcome = exampleTap(idea.prompt);
                    setDraft(outcome.composerText);
                    composerRef.current?.focus();
                  }}
                >
                  {idea.category}
                </button>
              ))}
            </div>
          )}
          <div className="phase-line">
            {phase && (
              <>
                <span>{P(phase)}</span>
                <span className="phase-dots">
                  <span>·</span>
                  <span>·</span>
                  <span>·</span>
                </span>
              </>
            )}
          </div>
          {sending && (
            <button className="emergency-pill" onClick={() => void emergencyNow()}>
              <Icon name="warning" size={20} /> {P("emergencyPill")}
            </button>
          )}
          {research && researchSessionsList.length > 0 && (
            <div className="research-sessions">
              <div className="research-plan-title">{P("researchSessionsTitle")}</div>
              {researchSessionsList.map((s) => (
                <div key={s.id} className="research-session-row">
                  <span className="research-session-query">{s.query}</span>
                  <span className="research-session-progress">
                    {s.stage === "done"
                      ? P("researchSessionDone")
                      : P("researchSessionProgress")
                          .replace("{{done}}", String(s.closedPasses))
                          .replace("{{total}}", String(s.planSize))}
                  </span>
                  {s.stage !== "done" && (
                    <button onClick={() => void send(s.query, undefined, s.id)}>
                      {P("researchSessionResume")}
                    </button>
                  )}
                  {confirmDeleteSession === s.id ? (
                    <button
                      className="btn danger"
                      onClick={() =>
                        void window.nido.researchSessionDelete({ id: s.id }).then(() => {
                          setConfirmDeleteSession(null);
                          void loadResearchSessions();
                        })
                      }
                    >
                      {P("researchSessionDeleteConfirm")}
                    </button>
                  ) : (
                    <button onClick={() => setConfirmDeleteSession(s.id)}>
                      {P("researchSessionDelete")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {pendingPlan && (
            <ResearchPlanPanel
              P={P}
              plan={pendingPlan.plan}
              onRun={(edited) => {
                const text = pendingPlan.text;
                setPendingPlan(null);
                void send(text, edited);
              }}
              onCancel={() => {
                setDraft(pendingPlan.text);
                setPendingPlan(null);
              }}
            />
          )}
          {chipEntries.length > 0 && (
            <div className="chip-row">
              {chipEntries.map(({ chip }) => (
                <span key={chip.id} className="attachment-chip">
                  <Icon name="knowledge" size={14} /> {chip.name}
                  <button
                    onClick={() => removeChip(chip.id)}
                    aria-label={P("attachmentRemove")}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {dropNote && <div className="drop-note">{dropNote}</div>}
          {findOpen && (
            <div className="find-bar">
              <input
                ref={findInputRef}
                value={findQuery}
                placeholder={P("findPlaceholder")}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setFindIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepFind(e.shiftKey ? -1 : 1);
                  }
                  if (e.key === "Escape") setFindOpen(false);
                }}
              />
              <span className="find-count">
                {findQuery.trim()
                  ? `${findMatches.length > 0 ? Math.min(findIdx, findMatches.length - 1) + 1 : 0}/${findMatches.length}`
                  : ""}
              </span>
              <button onClick={() => stepFind(-1)} aria-label={P("findPrevious")}>
                ↑
              </button>
              <button onClick={() => stepFind(1)} aria-label={P("findNext")}>
                ↓
              </button>
              <button onClick={() => setFindOpen(false)} aria-label={P("findClose")}>
                ×
              </button>
            </div>
          )}
          <div className="composer-toggles">
            <button
              className={`chip-toggle${research ? " on" : ""}`}
              onClick={toggleResearch}
              title={P("research")}
            >
              <Icon name="deep-research" size={16} /> {P("research")}
            </button>
            {boot.personality ? (
              <button className="chip-toggle" onClick={goTone} title={lookup(s, "personalitySettings", "title")}>
                {lookup(s, "personalities", `${boot.personality}.label`)}
              </button>
            ) : null}
          </div>
          <div className="composer composer-box">
            <textarea
              ref={composerRef}
              rows={1}
              value={draft}
              data-composer="true"
              placeholder={C("inputPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "End" && e.ctrlKey) {
                  scrollToEnd();
                  return;
                }
                // E11 (paso 1): Intro lo decide el mapa, en
                // la posición vigente del ajuste de envío y
                // con la precedencia de la emergencia: enviar,
                // saltar de línea o enviar la emergencia son
                // las tres salidas del resolvedor; el salto
                // y el cursor son el gesto propio del texto.
                const action = resolveShortcut(
                  {
                    key: e.key,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    altKey: e.altKey,
                    metaKey: e.metaKey,
                  },
                  {
                    generating: sending,
                    emergencyPill: sending,
                    sheetOpen: false,
                    inComposer: true,
                    sendOnEnter: boot.sendOnEnter ?? true,
                  },
                );
                if (action?.kind === "send") {
                  e.preventDefault();
                  sendFromComposer();
                } else if (action?.kind === "emergency-send") {
                  e.preventDefault();
                  void emergencyNow();
                }
              }}
            />
            {(boot.voiceInputEnabled ?? true) && voiceAvailable ? (
              <button
                className={`send-box voice${dictating ? " on" : ""}`}
                onClick={() => void toggleDictation()}
                title={dictating ? P("listening") : P("dictate")}
                aria-label={dictating ? P("listening") : P("dictate")}
                aria-pressed={dictating}
              >
                <Icon name="mic" size={20} />
              </button>
            ) : (boot.voiceInputEnabled ?? true) ? (
              // H-1: sin el modelo de escucha descargado, el
              // botón no promete un dictado que no hay: lleva
              // al estado honesto de la sección Voz (H-5).
              <button
                className="send-box voice"
                onClick={() => goVoice()}
                title={P("dictate")}
                aria-label={P("dictate")}
              >
                <Icon name="mic" size={20} />
              </button>
            ) : null}
            {sending ? (
              <button className="send-box stop" onClick={() => void window.nido.turnStop()} title={P("stop")}>
                <Icon name="stop" size={20} />
              </button>
            ) : (
              <button className="send-box" onClick={() => sendFromComposer()} title={P("send")}>
                <Icon name="send" size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// E10 (paso 5) · Los extras del informe bajo su turno: el
// selector de estilo reenseña la forma elegida del MISMO
// material ya producido (sin correr nada de nuevo; el cambio
// es solo de lectura y no toca el documento guardado), el
// recibo por afirmación navega de cada afirmación a su
// fragmento en el panel de fuentes, el recibo de corrida
// enseña lo que la corrida hizo, y la exportación escribe el
// documento guardado en las Descargas solo al pulsarla.
// ---------------------------------------------------------------------

function ResearchTurnExtras({
  P,
  research,
  reportId,
  sources,
  onOpenSource,
  onShowText,
}: {
  P: (k: string) => string;
  research: ResearchTurnData;
  reportId?: string;
  sources: NonNullable<StoredTurn["sources"]>;
  onOpenSource: (src: NonNullable<StoredTurn["sources"]>[number]) => void;
  onShowText: (text: string) => void;
}) {
  const [shown, setShown] = useState<ResearchStyleId>(research.style);
  const [showReceipt, setShowReceipt] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const run = research.receipt.run;
  const styleChips: { id: ResearchStyleId; label: string }[] = [
    { id: "completo", label: P("researchStyleCompleto") },
    { id: "ejecutivo", label: P("researchStyleEjecutivo") },
    { id: "comparativo", label: P("researchStyleComparativo") },
    { id: "cronologico", label: P("researchStyleCronologico") },
  ];
  const pick = (id: ResearchStyleId) => {
    setShown(id);
    onShowText(research.styles[id]);
  };
  return (
    <div className="research-extras">
      <div className="research-plan-meta">
        <span>{P("researchStyleLabel")}:</span>
        {styleChips.map((st) => (
          <button
            key={st.id}
            className={`chip-toggle${shown === st.id ? " on" : ""}`}
            onClick={() => pick(st.id)}
          >
            {st.label}
          </button>
        ))}
      </div>
      <div className="research-receipt">
        <div className="research-receipt-title">{P("researchReceiptClaims")}</div>
        <ul className="research-claims">
          {research.receipt.claims.map((c, i) => (
            <li key={i}>
              <button
                className="research-claim"
                onClick={() => {
                  const first = c.citations[0];
                  const src = first ? sources[first.n - 1] : undefined;
                  if (src) onOpenSource(src);
                }}
              >
                {c.claim}
                <span className="research-claim-refs">
                  {c.citations.map((r) => `[${r.n}]`).join(" ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button className="research-receipt-toggle" onClick={() => setShowReceipt((v) => !v)}>
          {P("researchReceiptRun")}
        </button>
        {showReceipt && (
          <div className="research-run-receipt">
            <div>
              {P("researchReceiptModel")}: {run.model ?? "—"}
            </div>
            <div>
              {P("researchReceiptTime")}: {Math.round(run.totalMs / 1000)}s · {run.totalTokens}{" "}
              tokens
            </div>
            <div>
              {P("researchReceiptFragments")}: {run.fragmentsConsulted}
            </div>
            {run.finalJudge && (
              <div>
                {P("researchReceiptJudge")}: {run.finalJudge.kept} / {run.finalJudge.removed}
              </div>
            )}
            {run.gapsDeclared.length > 0 && (
              <div>
                {P("researchReceiptGaps")}: {run.gapsDeclared.join(" · ")}
              </div>
            )}
          </div>
        )}
        {reportId && (
          <div className="research-export">
            <button
              onClick={() => {
                void window.nido
                  .researchReportExport({ id: reportId })
                  .then((r) => setExported(r.ok ? (r.delivered ?? "") : null));
              }}
            >
              {P("researchExport")}
            </button>
            {exported !== null && exported !== "" && (
              <span>
                {P("researchExported")}: {exported}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// E10 (paso 4) · El panel del plan de investigación: la persona
// ve el plan antes de que la corrida gaste (la cobertura sin
// modelo con sus huecos, el conteo de fuentes del ámbito y el
// coste estimado) y lo edita: quita subpreguntas, añade las
// suyas y elige el ámbito. La corrida sigue el plan editado.
// ---------------------------------------------------------------------

function ResearchPlanPanel({
  P,
  plan,
  onRun,
  onCancel,
}: {
  P: (k: string) => string;
  plan: ResearchPlanData;
  onRun: (edited: ResearchPlanData) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<string[]>(plan.subQuestions);
  const [scope, setScope] = useState<ResearchPlanData["scope"]>(plan.scope);
  const [style, setStyle] = useState<ResearchStyleId>(plan.style);
  const [extra, setExtra] = useState("");
  const scopeEmpty = plan.scopeCounts[scope] === 0;
  const minutes = Math.max(1, Math.round(plan.estimatedSeconds / 60));
  const estimate = P("researchPlanEstimate")
    .replace("{{tokens}}", String(plan.estimatedTokens))
    .replace("{{minutes}}", String(minutes));
  const addExtra = () => {
    const clean = extra.trim();
    if (!clean) return;
    setItems((v) => [...v, clean]);
    setExtra("");
  };
  const scopes: { id: ResearchPlanData["scope"]; label: string }[] = [
    { id: "packs", label: P("researchPlanScopePacks") },
    { id: "documents", label: P("researchPlanScopeDocuments") },
    { id: "both", label: P("researchPlanScopeBoth") },
  ];
  const styles: { id: ResearchStyleId; label: string }[] = [
    { id: "completo", label: P("researchStyleCompleto") },
    { id: "ejecutivo", label: P("researchStyleEjecutivo") },
    { id: "comparativo", label: P("researchStyleComparativo") },
    { id: "cronologico", label: P("researchStyleCronologico") },
  ];
  return (
    <div className="research-plan">
      <div className="research-plan-title">{P("researchPlanTitle")}</div>
      <div className="research-plan-question">{plan.query}</div>
      <ul className="research-plan-items">
        {items.map((q, i) => (
          <li key={`${i}-${q}`}>
            <span>{q}</span>
            <button
              className="research-plan-remove"
              onClick={() => setItems((v) => v.filter((_, j) => j !== i))}
              title={P("researchPlanRemove")}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="research-plan-add">
        <input
          value={extra}
          placeholder={P("researchPlanAddPlaceholder")}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addExtra();
            }
          }}
        />
        <button onClick={addExtra}>{P("researchPlanAdd")}</button>
      </div>
      <div className="research-plan-meta">
        <span>
          {P("researchPlanCovered")}: {plan.coverage.covered.join(", ") || P("researchPlanNone")}
        </span>
        <span>
          {P("researchPlanGaps")}: {plan.coverage.gaps.join(", ") || P("researchPlanNone")}
        </span>
      </div>
      <div className="research-plan-meta">
        <span>{P("researchPlanSources")}:</span>
        {scopes.map((sc) => (
          <button
            key={sc.id}
            className={`chip-toggle${scope === sc.id ? " on" : ""}`}
            onClick={() => setScope(sc.id)}
          >
            {sc.label} · {plan.scopeCounts[sc.id]}
          </button>
        ))}
      </div>
      <div className="research-plan-meta">
        <span>{P("researchStyleLabel")}:</span>
        {styles.map((st) => (
          <button
            key={st.id}
            className={`chip-toggle${style === st.id ? " on" : ""}`}
            onClick={() => setStyle(st.id)}
          >
            {st.label}
          </button>
        ))}
      </div>
      {scopeEmpty ? (
        <div className="research-plan-empty">{P("researchPlanScopeEmpty")}</div>
      ) : (
        <div className="research-plan-meta">{estimate}</div>
      )}
      <div className="research-plan-actions">
        <button
          className="research-plan-run"
          disabled={items.length === 0 || scopeEmpty}
          onClick={() => onRun({ ...plan, subQuestions: items, scope, style })}
        >
          {P("researchPlanRun")}
        </button>
        <button onClick={onCancel}>{P("researchPlanCancel")}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// S-10 · Biblioteca y el gancho de la guía
// ---------------------------------------------------------------------

function LibraryView({
  boot,
  onGuideExample,
  learnSignal,
  guideLink,
}: {
  boot: Boot;
  onGuideExample: (text: string) => void;
  learnSignal: number;
  guideLink?: { id: string; seq: number } | null;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const L = (k: string) => lookup(s, "library", k);
  const G = (k: string) => lookup(s, "guideLibrary", k);
  // B-4 (bloque de cableado, rama β): la foto de la tarjeta
  // nace del bootstrap y se deriva al entrar por su canal,
  // la misma regla de frescura que la sección de documentos:
  // instalar o quitar un paquete en Ajustes se cobra al
  // volver a entrar, sin gestos nuevos en la pestaña de
  // paquetes.
  const [lib, setLib] = useState(
    (
      boot as Boot & {
        library?: { packs: { id: string; name: string; outdated: boolean }[]; factCount: number };
      }
    ).library,
  );
  useEffect(() => {
    let live = true;
    void window.nido.libraryData().then((r) => {
      if (live && r.ok && r.packs && typeof r.factCount === "number") {
        setLib({ packs: r.packs, factCount: r.factCount });
      }
    });
    return () => {
      live = false;
    };
  }, []);
  const [readerOpen, setReaderOpen] = useState(false);

  if (readerOpen) {
    return <GuideReaderView boot={boot} onClose={() => setReaderOpen(false)} />;
  }
  return (
    <div className="view-scroll">
      <div className="view-column">
        <h2>{L("title")}</h2>
        <div className="card">
          <span className="section-label">{L("tabPacks")}</span>
          {lib && lib.packs.length > 0 ? (
            <>
              {lib.packs.map((pack) => (
                <div key={pack.id} className="row-line">
                  <span>{pack.name}</span>
                  {pack.outdated && <span>{P("packOutdated")}</span>}
                </div>
              ))}
              <p style={{ color: "var(--muted)" }}>
                {fill(P("libraryFacts"), { count: lib.factCount })}
              </p>
            </>
          ) : (
            <p>{P("libraryEmpty")}</p>
          )}
          <div className="row-line">
            <button type="button" className="btn" onClick={() => setReaderOpen(true)}>
              {G("open")}
            </button>
          </div>
        </div>
        <LibraryDocsSection boot={boot} />
        <LearnSection
          boot={boot}
          onGuideExample={onGuideExample}
          learnSignal={learnSignal}
          guideLink={guideLink}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// B-1 · El lector de guías de la Biblioteca: las guías de los
// paquetes instalados, abiertas como documentos para leerlas
// de principio a fin, sin cargar el modelo. Espejo de la
// pantalla GuideLibraryScreen del móvil en la forma de PC:
// una sub-vista de la columna de la Biblioteca que deriva su
// índice por el canal al entrar, como la sección de
// documentos. Leer no carga ningún motor: los dos canales
// componen desde el núcleo de paquetes.
// ---------------------------------------------------------------------

/**
 * Tope de pintado del lector (espejo del móvil): montar un
 * texto gigante de una vez puede tumbar una máquina modesta,
 * así que el cuerpo se recorta en pantalla por encima de
 * este tamaño y se avisa con su cadena. La guía guardada no
 * se toca: el recorte es solo de pantalla.
 */
const MAX_PAINTED_BODY_CHARS = 100_000;

function GuideReaderView({ boot, onClose }: { boot: Boot; onClose: () => void }) {
  const s = boot.strings as Strings;
  const G = (k: string) => lookup(s, "guideLibrary", k);
  const [sections, setSections] = useState<
    { packId: string; name: string; guides: PackGuideRow[] }[] | null
  >(null);
  const [selection, setSelection] = useState<{ packId: string; guideId: number } | null>(null);
  const [doc, setDoc] = useState<{ title: string; source: string; body: string } | null>(null);
  const [docState, setDocState] = useState<"idle" | "loading" | "ready" | "missing">("idle");

  useEffect(() => {
    let live = true;
    void window.nido.packGuides().then((r) => {
      if (live) setSections(r.ok && r.sections ? r.sections : []);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    setDocState("loading");
    setDoc(null);
    void window.nido.packGuideRead(selection.packId, selection.guideId).then((r) => {
      if (!live) return;
      setDoc(r.ok ? (r.doc ?? null) : null);
      setDocState(r.ok && r.doc ? "ready" : "missing");
    });
    return () => {
      live = false;
    };
  }, [selection]);

  if (selection) {
    return (
      <div className="view-scroll">
        <div className="view-column">
          <div className="row-line">
            <h2>{doc?.title ?? G("title")}</h2>
            <button type="button" className="btn" onClick={() => setSelection(null)}>
              {G("back")}
            </button>
          </div>
          {docState === "loading" ? (
            <p>{G("loading")}</p>
          ) : docState === "missing" || !doc ? (
            <p>{G("readError")}</p>
          ) : (
            <div className="card">
              <div style={{ whiteSpace: "pre-wrap" }}>
                {doc.body.length > MAX_PAINTED_BODY_CHARS
                  ? doc.body.slice(0, MAX_PAINTED_BODY_CHARS)
                  : doc.body}
              </div>
              {doc.body.length > MAX_PAINTED_BODY_CHARS && (
                <p style={{ color: "var(--muted)" }}>{G("truncated")}</p>
              )}
              {doc.source ? (
                <p style={{ color: "var(--muted)" }}>
                  {fill(lookup(s, "sourceReader", "source"), { source: doc.source })}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="row-line">
          <h2>{G("title")}</h2>
          <button type="button" className="btn" onClick={onClose}>
            {G("back")}
          </button>
        </div>
        <p style={{ color: "var(--muted)" }}>{G("intro")}</p>
        {sections === null ? (
          <p>{G("loading")}</p>
        ) : sections.length === 0 ? (
          <p>{G("noPacks")}</p>
        ) : (
          sections.map((section) => (
            <div key={section.packId} className="card">
              <span className="section-label">{section.name}</span>
              {section.guides.map((guide) => (
                <button
                  key={`${section.packId}:${guide.id}`}
                  type="button"
                  className="row-line"
                  onClick={() => setSelection({ packId: section.packId, guideId: guide.id })}
                >
                  <span>{guide.title}</span>
                  {guide.category ? (
                    <span style={{ color: "var(--muted)" }}>{guide.category}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// E6 (paso 8) · La Biblioteca de documentos personales: dos
// columnas bajo DISENO-PC. A la izquierda, las colecciones
// con su medida real (la que la base cobra, nunca una
// estimación); a la derecha, el detalle de la elegida: sus
// documentos desde el registro, sus páginas, sus fragmentos
// pendientes de reindexado y sus tres gestos (activar o
// desactivar, exportar, borrar con confirmación). Si el
// espacio se llena, la importación expulsa sola la colección
// menos reciente, nunca la que se acaba de añadir.
// ---------------------------------------------------------------------

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function LibraryDocsSection({ boot }: { boot: Boot }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [rows, setRows] = useState<LibraryDocRow[] | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [budgetBytes, setBudgetBytes] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const adopt = (r: { rows?: LibraryDocRow[]; totalBytes?: number; budgetBytes?: number }) => {
    if (!r.rows) return;
    setRows(r.rows);
    setTotalBytes(r.totalBytes ?? 0);
    setBudgetBytes(r.budgetBytes ?? 0);
    setSelectedId((prev) => (prev && r.rows!.some((x) => x.id === prev) ? prev : (r.rows![0]?.id ?? null)));
  };

  useEffect(() => {
    let live = true;
    void window.nido.documentsList().then((r) => {
      if (live && r.ok) adopt(r);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = rows?.find((r) => r.id === selectedId) ?? null;

  const toggleActive = async () => {
    if (!selected) return;
    // B-7: el gesto no falla en silencio; en el rechazo y en
    // el { ok: false } la nota nombra el fallo.
    try {
      const r = await window.nido.documentsSetActive(selected.id, !selected.active);
      if (r.ok) adopt(r);
      else setNote(P("libDocsActivateFailed"));
    } catch {
      setNote(P("libDocsActivateFailed"));
    }
  };
  const doExport = async () => {
    if (!selected) return;
    // B-7: la misma regla que activar; el éxito conserva la
    // nota con el destino nombrado.
    try {
      const r = await window.nido.documentsExport(selected.id);
      if (r.ok) setNote(r.delivered ? fill(P("libDocsExported"), { name: r.delivered }) : null);
      else setNote(P("libDocsExportFailed"));
    } catch {
      setNote(P("libDocsExportFailed"));
    }
  };
  const doDelete = async () => {
    if (!selected) return;
    const r = await window.nido.documentsDelete(selected.id);
    if (r.ok) {
      setConfirming(false);
      setNote(null);
      adopt(r);
    }
  };

  return (
    <div className="card">
      <span className="section-label">{P("docsTitle")}</span>
      {rows === null ? (
        <p>{P("libDocsLoading")}</p>
      ) : rows.length === 0 ? (
        <p>{P("libDocsEmpty")}</p>
      ) : (
        <>
          <p style={{ color: "var(--muted)" }}>
            {fill(P("libDocsUsage"), { used: fmtBytes(totalBytes), budget: fmtBytes(budgetBytes) })}
          </p>
          <div className="lib-docs">
            <div className="lib-docs-list">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`lib-docs-item${r.id === selectedId ? " selected" : ""}`}
                  onClick={() => {
                    setSelectedId(r.id);
                    setConfirming(false);
                    setNote(null);
                  }}
                >
                  <span className="lib-docs-name">{r.name}</span>
                  <span className="lib-docs-meta">
                    {fmtBytes(r.sizeBytes)} · {r.active ? P("libDocsOn") : P("libDocsOff")}
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <div className="lib-docs-detail">
                <h3>{selected.name}</h3>
                <p style={{ color: "var(--muted)" }}>
                  {fill(P("libDocsDocs"), { count: selected.docCount })}
                  {selected.pageCount != null && <> · {fill(P("libDocsPages"), { count: selected.pageCount })}</>}
                  {" · "}
                  {fmtBytes(selected.sizeBytes)}
                </p>
                {selected.pendingVectors > 0 && (
                  <p style={{ color: "var(--muted)" }}>{fill(P("libDocsPending"), { count: selected.pendingVectors })}</p>
                )}
                <ul className="lib-docs-files">
                  {selected.docs.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                {selected.warnings.length > 0 && (
                  <>
                    <p style={{ color: "var(--muted)" }}>{P("libDocsWarnings")}</p>
                    <ul className="lib-docs-files">
                      {selected.warnings.map((w, i) => (
                        <li key={`${i}-${w.name}`}>{warningLine(P, w)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {confirming ? (
                  <>
                    <p>{fill(P("libDocsDeleteAsk"), { name: selected.name })}</p>
                    <div className="row-line">
                      <button type="button" className="btn danger" onClick={doDelete}>
                        {P("libDocsDelete")}
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirming(false)}>
                        {P("libDocsCancel")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="row-line">
                    <button type="button" className="btn" onClick={toggleActive}>
                      {selected.active ? P("libDocsDeactivate") : P("libDocsActivate")}
                    </button>
                    <button type="button" className="btn" onClick={doExport}>
                      {P("libDocsExport")}
                    </button>
                    <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
                      {P("libDocsDelete")}
                    </button>
                  </div>
                )}
                {note && <p style={{ color: "var(--muted)" }}>{note}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// S-6 · Aprende: la guía integrada de PC. Compone catálogo y
// locales por índice y sirve sin red, sin cuentas, sin modelo
// cargado y sin paquetes: abre aunque nada más esté listo. Las
// marcas de visto viven en los ajustes cifrados (canal
// nido:guide-mark) y son cosméticas si se pierden.
// ---------------------------------------------------------------------

interface GuideLessonNode {
  id: string;
  title: string;
  what: string;
  steps: string[];
  examples: string[];
  tip: string;
}
interface GuideModuleNode {
  id: string;
  title: string;
  lessons: GuideLessonNode[];
}
interface GuideTree {
  title: string;
  subtitle: string;
  try: string;
  steps: string;
  tip: string;
  progress: string;
  toolOff: string;
  back: string;
  seen: string;
  modules: GuideModuleNode[];
}

function LearnSection({
  boot,
  onGuideExample,
  learnSignal,
  guideLink,
}: {
  boot: Boot;
  onGuideExample: (text: string) => void;
  learnSignal: number;
  guideLink?: { id: string; seq: number } | null;
}) {
  const s = boot.strings as Strings;
  const L = (k: string) => lookup(s, "library", k);
  const guide = (s as Record<string, unknown>).guide as GuideTree | undefined;
  const [openId, setOpenId] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>(() => boot.guideVisited ?? []);
  useEffect(() => {
    setOpenId(null);
  }, [learnSignal]);
  // E11 (paso 7): el aterrizaje de un enlace nido://guia/:
  // la lección nombrada se abre en su sitio, como si la
  // persona la hubiera tocado en el índice.
  useEffect(() => {
    if (!guideLink || !guide) return;
    for (const m of guide.modules) {
      if (m.lessons.some((lesson) => lesson.id === guideLink.id)) {
        setOpenId(guideLink.id);
        const key = `${m.id}.${guideLink.id}`;
        setVisited((v) => (v.includes(key) ? v : [...v, key]));
        void window.nido.guideMark(key).catch(() => undefined);
        break;
      }
    }
  }, [guideLink, guide]);
  // La lectura de la lección entera (paso 2 de E9).
  const speechAvailable = useSpeechAvailable();
  const { readingId, toggleRead } = useReading(boot.prefs.lang);
  if (!guide) return null;
  const flat = guide.modules.flatMap((m) => m.lessons.map((lesson) => ({ module: m, lesson })));
  const total = flat.length;
  const done = flat.filter(({ module, lesson }) => visited.includes(`${module.id}.${lesson.id}`)).length;
  const open = flat.find(({ lesson }) => lesson.id === openId) ?? null;
  const openLesson = (moduleId: string, lessonId: string) => {
    setOpenId(lessonId);
    const key = `${moduleId}.${lessonId}`;
    setVisited((v) => (v.includes(key) ? v : [...v, key]));
    void window.nido.guideMark(key).catch(() => undefined);
  };
  const decl = open ? GUIDE_LESSONS.find((l) => l.id === open.lesson.id) : undefined;
  const toolOff = decl?.tools?.some((t) => (boot.disabledTools ?? []).includes(t)) ?? false;
  return (
    <div className="card">
      <span className="section-label">{L("tabLearn")}</span>
      {!open ? (
        <>
          <h3>{guide.title}</h3>
          <p>{guide.subtitle}</p>
          <p style={{ color: "var(--muted)" }}>{fill(guide.progress, { done, total })}</p>
          {guide.modules.map((m) => (
            <div key={m.id}>
              <span className="section-label">{m.title}</span>
              {m.lessons.map((lesson) => (
                <button key={lesson.id} className="row-line" onClick={() => openLesson(m.id, lesson.id)}>
                  <span>{lesson.title}</span>
                  {visited.includes(`${m.id}.${lesson.id}`) && <span>{guide.seen}</span>}
                </button>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <button className="btn" onClick={() => setOpenId(null)}>
            {guide.back}
          </button>
          {speechAvailable && (
            <button
              className="btn"
              onClick={() =>
                void toggleRead(
                  `guide:${open.lesson.id}`,
                  [open.lesson.title, open.lesson.what, ...open.lesson.steps, open.lesson.tip]
                    .map((piece) => {
                      const t = piece.trim();
                      return /[.!?…]$/.test(t) ? t : `${t}.`;
                    })
                    .join(" "),
                )
              }
              aria-pressed={readingId === `guide:${open.lesson.id}`}
            >
              <Icon name="speaker" size={16} />{" "}
              {readingId === `guide:${open.lesson.id}`
                ? lookup(s, "pcSurface", "stopReading")
                : lookup(s, "pcSurface", "readAloud")}
            </button>
          )}
          <h3>{open.lesson.title}</h3>
          <p>{open.lesson.what}</p>
          {open.lesson.steps.length > 0 && (
            <>
              <span className="section-label">{guide.steps}</span>
              <ol>
                {open.lesson.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </>
          )}
          {open.lesson.examples.length > 0 && (
            <>
              <p style={{ color: "var(--muted)" }}>{guide.try}</p>
              {open.lesson.examples.map((ex, i) => (
                <button key={i} className="row-line" onClick={() => onGuideExample(ex)}>
                  <span>{ex}</span>
                </button>
              ))}
            </>
          )}
          {toolOff && <p>{guide.toolOff}</p>}
          <span className="section-label">{guide.tip}</span>
          <p>{open.lesson.tip}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------

type MemoryTab = "facts" | "notes" | "people" | "reminders";
const MEMORY_TABS: MemoryTab[] = ["facts", "notes", "people", "reminders"];

// ---------------------------------------------------------------------
// E7 (paso 6): la sección Agenda. Dos pestañas sobre los
// canales `nido:agenda-*`, que despachan a los mismos
// almacenes que el chat usa: Calendario (el mes en rejilla
// sencilla y la lista, con su editor) y Contactos (las fichas
// con su cumpleaños y su próximo aviso, con su editor). La
// ficha se abre por su id estable: la ruta interna
// `#/agenda/contacto/<id>` la trae abierta (App la escucha).
// ---------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");
function agendaDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function agendaTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function agendaWhen(ms: number, allDay: boolean): string {
  return allDay ? agendaDay(ms) : `${agendaDay(ms)} · ${agendaTime(ms)}`;
}
function parseLocalDay(date: string, time: string): number {
  const [y, m, dd] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return new Date(y || 1970, (m || 1) - 1, dd || 1, hh || 0, mm || 0).getTime();
}

type AgendaTab = "calendar" | "contacts" | "notices";

interface EventDraft {
  id: string | null;
  title: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  place: string;
  notes: string;
  alert: string; // "none" o los minutos en texto
}

interface ContactDraft {
  id: string | null;
  name: string;
  relation: string;
  month: string;
  day: string;
  year: string;
  phone: string;
  phoneLabel: string;
  email: string;
  emailLabel: string;
  lead: string;
  notes: string;
}

function AgendaView({ boot, contactId, noticesSignal }: { boot: Boot; contactId: string | null; noticesSignal?: number }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const AG = (k: string) => lookup(s, "agenda", k);
  const AM = (k: string) => lookup(s, "agenda", `months.${k}`);
  const AW = (k: string) => lookup(s, "agenda", `weekdays.${k}`);
  const NV = (k: string) => lookup(s, "noticesView", k);
  const ND = (k: string) => lookup(s, "noticesDispatch", k);
  const [tab, setTab] = useState<AgendaTab>("calendar");
  const [data, setData] = useState<{ events: AgendaEventRow[]; contacts: AgendaContactRow[]; notices: AgendaNoticeRow[] } | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null);
  // Puerta .ics/.vcf: la vista previa de una importación
  // espera la confirmación de la persona (la regla R4:
  // nada se guarda sin ver el resumen y aprobarlo).
  const [importPreview, setImportPreview] = useState<{
    kind: "ics" | "vcf";
    token: string | null;
    summary: AgendaImportSummary;
  } | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);
  const vcfInputRef = useRef<HTMLInputElement>(null);
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await window.nido.agendaData();
    if (r.ok) setData({ events: r.events ?? [], contacts: r.contacts ?? [], notices: r.notices ?? [] });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // E8: la vista de Avisos se relee cada 30 s mientras la
  // Agenda está abierta (el patrón de la tarjeta del móvil):
  // lo que dispara con la app abierta aparece sin tocar nada.
  useEffect(() => {
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const actOnNotice = async (args: { id: string; action: string; snoozeMinutes?: number; at?: number }) => {
    setSnoozeFor(null);
    await window.nido.noticeAct(args);
    await load();
  };

  // E8 (paso 6): la carcasa pidió la vista de Avisos (el clic
  // de la notificación): la pestaña se abre y la lista se
  // relee.
  useEffect(() => {
    if (!noticesSignal) return;
    setTab("notices");
    void load();
  }, [noticesSignal, load]);

  // La tarjeta del primer aviso: hay avisos armados y el
  // residente aún no está decidido.
  const RC = (k: string) => lookup(s, "noticesResidentCard", k);
  const [residentChoice, setResidentChoice] = useState<boolean | null>(boot.noticesResident ?? null);
  const [residentDecidedLocal, setResidentDecidedLocal] = useState<boolean>(boot.noticesResident !== null && boot.noticesResident !== undefined);
  const chooseResident = async (on: boolean) => {
    const r = await window.nido.settingsSet({ noticesResident: on });
    if (r.ok) {
      setResidentChoice(on);
      setResidentDecidedLocal(true);
    }
  };

  // La ruta de la ficha: con los datos cargados, la pestaña de
  // contactos se abre con esa ficha en su editor.
  useEffect(() => {
    if (!contactId || !data) return;
    const c = data.contacts.find((x) => x.id === contactId);
    if (c) {
      setTab("contacts");
      setContactDraft(contactToDraft(c));
    }
  }, [contactId, data]);

  function contactToDraft(c: AgendaContactRow): ContactDraft {
    return {
      id: c.id,
      name: c.name,
      relation: c.relation,
      month: c.birthdayMonth != null ? String(c.birthdayMonth) : "",
      day: c.birthdayDay != null ? String(c.birthdayDay) : "",
      year: c.birthdayYear != null ? String(c.birthdayYear) : "",
      phone: c.phones[0]?.number ?? "",
      phoneLabel: c.phones[0]?.label ?? "",
      email: c.emails[0]?.address ?? "",
      emailLabel: c.emails[0]?.label ?? "",
      lead: String(c.alertLeadDays),
      notes: c.notes,
    };
  }

  const saveEvent = async () => {
    if (!eventDraft || eventDraft.title.trim() === "") return;
    const startsAt = eventDraft.allDay
      ? parseLocalDay(eventDraft.date, "00:00")
      : parseLocalDay(eventDraft.date, eventDraft.start);
    const endsAt = eventDraft.allDay
      ? parseLocalDay(eventDraft.date, "23:59")
      : parseLocalDay(eventDraft.date, eventDraft.end);
    const r = await window.nido.agendaEventSave({
      id: eventDraft.id ?? undefined,
      title: eventDraft.title.trim(),
      notes: eventDraft.notes,
      location: eventDraft.place,
      startsAt,
      endsAt: Math.max(endsAt, startsAt),
      allDay: eventDraft.allDay,
      alertOffsetMin: eventDraft.alert === "none" ? null : Number(eventDraft.alert),
    });
    if (r.ok) {
      setEventDraft(null);
      await load();
    }
  };

  const saveContact = async () => {
    if (!contactDraft || contactDraft.name.trim() === "") return;
    const month = contactDraft.month === "" ? null : Number(contactDraft.month);
    const day = contactDraft.day === "" ? null : Number(contactDraft.day);
    const r = await window.nido.agendaContactSave({
      id: contactDraft.id ?? undefined,
      name: contactDraft.name.trim(),
      relation: contactDraft.relation,
      birthdayMonth: month,
      birthdayDay: day,
      birthdayYear: contactDraft.year === "" ? null : Number(contactDraft.year),
      phones: contactDraft.phone.trim() === "" ? [] : [{ label: contactDraft.phoneLabel, number: contactDraft.phone.trim() }],
      emails: contactDraft.email.trim() === "" ? [] : [{ label: contactDraft.emailLabel, address: contactDraft.email.trim() }],
      notes: contactDraft.notes,
      alertLeadDays: Math.max(0, Number(contactDraft.lead) || 0),
    });
    if (r.ok) {
      setContactDraft(null);
      await load();
    }
  };

  // Puerta .ics/.vcf: elegir el fichero enseña primero
  // el resumen; Guardar es la confirmación que guarda
  // exactamente lo anunciado. Exportar compone el
  // fichero entero de la clase y lo guarda donde la
  // persona diga, por los canales de guardado de la casa.
  const pickImportFile = async (kind: "ics" | "vcf", files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setImportNote(null);
    const p = window.nido.docFilePath(f);
    if (!p) return;
    const r = await window.nido.agendaImportPreview(kind, p);
    if (!r.ok || !r.summary) {
      setImportPreview(null);
      setImportNote(AG("importUnreadable"));
      return;
    }
    setImportPreview({ kind, token: r.token ?? null, summary: r.summary });
  };

  const confirmImport = async () => {
    if (!importPreview || !importPreview.token) return;
    const r = await window.nido.agendaImportCommit(importPreview.kind, importPreview.token);
    setImportPreview(null);
    if (r.ok) {
      setImportNote(fill(AG("importDone"), { n: r.inserted ?? 0 }));
      await load();
    }
  };

  const exportAgendaFile = async (kind: "ics" | "vcf") => {
    const r = await window.nido.agendaExport(kind);
    if (!r.ok || r.content === undefined) return;
    const d = await window.nido.exportSaveDialog({
      defaultName: r.defaultName ?? (kind === "ics" ? "nido-calendario.ics" : "nido-contactos.vcf"),
    });
    if (d.ok && d.path) {
      await window.nido.exportWrite({ path: d.path, content: r.content });
      setImportNote(fill(AG("exportDone"), { path: d.path }));
    }
  };

  const importSummaryLines = (sp: { kind: "ics" | "vcf"; summary: AgendaImportSummary }): string[] => {
    const sm = sp.summary;
    const lines: string[] = [];
    if (sm.rejectedCode || sm.rejectedText) {
      const key =
        sm.rejectedCode === "too-large"
          ? "importRejectedTooLarge"
          : sm.rejectedCode === "line-too-long"
            ? "importRejectedLineTooLong"
            : sm.rejectedCode === "too-many"
              ? "importRejectedTooMany"
              : null;
      lines.push(key ? AG(key) : (sm.rejectedText ?? AG("importUnreadable")));
      return lines;
    }
    lines.push(
      fill(AG(sp.kind === "ics" ? "importCountsEvents" : "importCountsContacts"), {
        enter: sm.enter,
        total: sm.total,
        already: sm.alreadyPresent,
      }),
    );
    if (sp.kind === "ics" && sm.recurring > 0) lines.push(fill(AG("importRecurring"), { n: sm.recurring }));
    const namedLine = (group: AgendaImportNamedGroup, key: string) => {
      if (group.count <= 0) return;
      const shown = group.names.slice(0, 3).join(", ");
      const rest = group.count - Math.min(3, group.names.length);
      lines.push(fill(AG(key), { names: rest > 0 ? `${shown} +${rest}` : shown }));
    };
    if (sm.named) {
      namedLine(sm.named.exdate, "importNamedExdate");
      namedLine(sm.named.valarm, "importNamedValarm");
      namedLine(sm.named.unboundedRrule, "importNamedUnbounded");
      namedLine(sm.named.tzid, "importNamedTzid");
      if (sm.named.withoutUid > 0) lines.push(fill(AG("importWithoutUid"), { n: sm.named.withoutUid }));
      if (sm.named.truncatedFields > 0) lines.push(fill(AG("importTruncated"), { n: sm.named.truncatedFields }));
    }
    for (const d of sm.discarded) {
      const key =
        d.code === "property-too-large"
          ? "importDiscardProperty"
          : d.code === "event-no-start"
            ? "importDiscardNoStart"
            : d.code === "event-start-out-of-subset"
              ? "importDiscardBadStart"
              : d.code === "event-too-many-occurrences"
                ? "importDiscardTooManyOccurrences"
                : d.code === "recurrence-out-of-subset"
                  ? "importDiscardRecurrence"
                  : d.code === "photo-not-stored"
                    ? "importDiscardPhoto"
                    : d.code === "card-no-name"
                      ? "importDiscardNoName"
                      : null;
      if (!key) {
        lines.push(d.text);
      } else if (key === "importDiscardProperty") {
        lines.push(fill(AG(key), { prop: d.prop ?? "", name: d.label ?? "" }));
      } else if (key === "importDiscardNoName") {
        lines.push(AG(key));
      } else {
        lines.push(fill(AG(key), { name: d.label ?? "" }));
      }
    }
    return lines;
  };

  const importPanel = importPreview && (
    <div className="card">
      <h3>{AG(importPreview.kind === "ics" ? "importTitleEvents" : "importTitleContacts")}</h3>
      <ul className="lib-docs-files">
        {importSummaryLines(importPreview).map((l, i) => (
          <li key={`${i}-${l}`}>{l}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 6 }}>
        {importPreview.token && (
          <button className="btn primary" onClick={() => void confirmImport()}>
            {AG("importSave")}
          </button>
        )}
        <button className="btn" onClick={() => setImportPreview(null)}>
          {AG("importCancel")}
        </button>
      </div>
    </div>
  );

  const remove = async (kind: "ev" | "ct", id: string) => {
    const r = kind === "ev" ? await window.nido.agendaEventDelete(id) : await window.nido.agendaContactDelete(id);
    if (r.ok) {
      setConfirmDelete(null);
      await load();
    }
  };

  const deleteButton = (kind: "ev" | "ct", id: string) => {
    const key = `${kind}:${id}`;
    return confirmDelete === key ? (
      <button className="btn danger" onClick={() => void remove(kind, id)}>
        {AG("confirmDelete")}
      </button>
    ) : (
      <button title={AG("delete")} onClick={() => setConfirmDelete(key)}>
        <Icon name="delete" size={16} />
      </button>
    );
  };

  const events = data?.events ?? [];
  const contacts = data?.contacts ?? [];
  const todayStr = agendaDay(Date.now());
  const visibleEvents = events
    .filter((e) => (selectedDay ? agendaDay(e.startsAt) === selectedDay : e.endsAt >= parseLocalDay(todayStr, "00:00")))
    .sort((a, b) => a.startsAt - b.startsAt);
  const firstOfMonth = new Date(cursor.y, cursor.m, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const eventsOn = (dayNum: number) =>
    events.filter((e) => agendaDay(e.startsAt) === `${cursor.y}-${pad2(cursor.m + 1)}-${pad2(dayNum)}`);

  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card">
          <h2>{P("navAgenda")}</h2>
          <p>{AG("intro")}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`chip-toggle${tab === "calendar" ? " on" : ""}`} onClick={() => setTab("calendar")}>
              {AG("tabCalendar")}
            </button>
            <button className={`chip-toggle${tab === "contacts" ? " on" : ""}`} onClick={() => setTab("contacts")}>
              {AG("tabContacts")}
            </button>
            <button className={`chip-toggle${tab === "notices" ? " on" : ""}`} onClick={() => setTab("notices")}>
              {NV("tab")}
            </button>
          </div>
        </div>

        {importPanel}
        {importNote && <p>{importNote}</p>}
        <input
          ref={icsInputRef}
          type="file"
          accept=".ics"
          style={{ display: "none" }}
          onChange={(e) => {
            void pickImportFile("ics", e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={vcfInputRef}
          type="file"
          accept=".vcf"
          style={{ display: "none" }}
          onChange={(e) => {
            void pickImportFile("vcf", e.target.files);
            e.target.value = "";
          }}
        />

        {!residentDecidedLocal &&
          (data?.notices ?? []).some((n) => n.state === "armed" || n.state === "snoozed") && (
            <div className="card">
              <h3>{RC("title")}</h3>
              <p>{RC("body")}</p>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary" onClick={() => void chooseResident(true)}>
                  {RC("enable")}
                </button>
                <button className="btn" onClick={() => void chooseResident(false)}>
                  {RC("dismiss")}
                </button>
              </div>
            </div>
          )}

        {tab === "calendar" && (
          <>
            <div className="card">
              <div className="row-line">
                <button
                  title={AG("monthPrev")}
                  onClick={() => setCursor((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}
                >
                  <Icon name="back" size={16} />
                </button>
                <span>
                  {AM(`m${cursor.m + 1}`)} {cursor.y}
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button
                    className="chip-toggle"
                    onClick={() => {
                      const t = new Date();
                      setCursor({ y: t.getFullYear(), m: t.getMonth() });
                      setSelectedDay(null);
                    }}
                  >
                    {AG("today")}
                  </button>
                  <button
                    title={AG("monthNext")}
                    onClick={() => setCursor((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}
                  >
                    <Icon name="chev-right" size={16} />
                  </button>
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: 4,
                  textAlign: "center",
                  marginTop: 8,
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                  <span key={w} style={{ color: "var(--muted)", fontSize: "0.85em" }}>
                    {AW(`wd${w}`)}
                  </span>
                ))}
                {cells.map((d, i) => {
                  if (d === null) return <span key={i} />;
                  const dayStr = `${cursor.y}-${pad2(cursor.m + 1)}-${pad2(d)}`;
                  const count = eventsOn(d).length;
                  return (
                    <button
                      key={i}
                      className={`chip-toggle${selectedDay === dayStr ? " on" : ""}`}
                      style={dayStr === todayStr ? { fontWeight: 700 } : undefined}
                      onClick={() => setSelectedDay(selectedDay === dayStr ? null : dayStr)}
                    >
                      {d}
                      {count > 0 ? ` ·${count}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="row-line">
                <h3>{AG("tabCalendar")}</h3>
                <button
                  className="btn"
                  onClick={() =>
                    setEventDraft({
                      id: null,
                      title: "",
                      date: selectedDay ?? todayStr,
                      start: "10:00",
                      end: "11:00",
                      allDay: false,
                      place: "",
                      notes: "",
                      alert: "none",
                    })
                  }
                >
                  {AG("newEvent")}
                </button>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => icsInputRef.current?.click()}>
                    {AG("importEvents")}
                  </button>
                  <button className="btn" onClick={() => void exportAgendaFile("ics")}>
                    {AG("exportFile")}
                  </button>
                </span>
              </div>
              {eventDraft && (
                <div>
                  <div className="field">
                    <label>{AG("fieldTitle")}</label>
                    <input value={eventDraft.title} onChange={(e) => setEventDraft({ ...eventDraft, title: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{AG("fieldDate")}</label>
                    <input type="date" value={eventDraft.date} onChange={(e) => setEventDraft({ ...eventDraft, date: e.target.value })} />
                  </div>
                  <div className="row-line">
                    <span>{AG("allDay")}</span>
                    <input
                      type="checkbox"
                      checked={eventDraft.allDay}
                      onChange={(e) => setEventDraft({ ...eventDraft, allDay: e.target.checked })}
                    />
                  </div>
                  {!eventDraft.allDay && (
                    <>
                      <div className="field">
                        <label>{AG("fieldStart")}</label>
                        <input type="time" value={eventDraft.start} onChange={(e) => setEventDraft({ ...eventDraft, start: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>{AG("fieldEnd")}</label>
                        <input type="time" value={eventDraft.end} onChange={(e) => setEventDraft({ ...eventDraft, end: e.target.value })} />
                      </div>
                    </>
                  )}
                  <div className="field">
                    <label>{AG("fieldPlace")}</label>
                    <input value={eventDraft.place} onChange={(e) => setEventDraft({ ...eventDraft, place: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{AG("fieldNotes")}</label>
                    <input value={eventDraft.notes} onChange={(e) => setEventDraft({ ...eventDraft, notes: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>{AG("fieldAlert")}</label>
                    <select value={eventDraft.alert} onChange={(e) => setEventDraft({ ...eventDraft, alert: e.target.value })}>
                      <option value="none">{AG("alertNone")}</option>
                      <option value="0">{AG("alertAtStart")}</option>
                      <option value="15">{AG("alert15")}</option>
                      <option value="30">{AG("alert30")}</option>
                      <option value="60">{AG("alert60")}</option>
                      <option value="1440">{AG("alertDay")}</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={() => void saveEvent()}>
                      {AG("save")}
                    </button>
                    <button onClick={() => setEventDraft(null)}>{AG("cancel")}</button>
                  </div>
                </div>
              )}
              {visibleEvents.length === 0 && <p style={{ color: "var(--muted)" }}>{AG("emptyEvents")}</p>}
              {visibleEvents.map((e) => (
                <div key={e.id} className="row-line">
                  <span>
                    {e.title}
                    <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                      {agendaWhen(e.startsAt, e.allDay)}
                      {e.location ? ` · ${e.location}` : ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button
                      title={AG("edit")}
                      onClick={() =>
                        setEventDraft({
                          id: e.id,
                          title: e.title,
                          date: agendaDay(e.startsAt),
                          start: agendaTime(e.startsAt),
                          end: agendaTime(e.endsAt),
                          allDay: e.allDay,
                          place: e.location,
                          notes: e.notes,
                          alert: e.alertOffsetMin == null ? "none" : String(e.alertOffsetMin),
                        })
                      }
                    >
                      {AG("edit")}
                    </button>
                    {deleteButton("ev", e.id)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "contacts" && (
          <div className="card">
            <div className="row-line">
              <h3>{AG("tabContacts")}</h3>
              <button
                className="btn"
                onClick={() =>
                  setContactDraft({ id: null, name: "", relation: "", month: "", day: "", year: "", phone: "", phoneLabel: "", email: "", emailLabel: "", lead: "0", notes: "" })
                }
              >
                {AG("newContact")}
              </button>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => vcfInputRef.current?.click()}>
                  {AG("importContacts")}
                </button>
                <button className="btn" onClick={() => void exportAgendaFile("vcf")}>
                  {AG("exportFile")}
                </button>
              </span>
            </div>
            {contactDraft && (
              <div>
                <div className="field">
                  <label>{AG("fieldName")}</label>
                  <input value={contactDraft.name} onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })} />
                </div>
                <div className="field">
                  <label>{AG("fieldRelation")}</label>
                  <input value={contactDraft.relation} onChange={(e) => setContactDraft({ ...contactDraft, relation: e.target.value })} />
                </div>
                <div className="field">
                  <label>{AG("fieldBirthday")}</label>
                  <span style={{ display: "flex", gap: 6 }}>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      placeholder="DD"
                      value={contactDraft.day}
                      onChange={(e) => setContactDraft({ ...contactDraft, day: e.target.value })}
                    />
                    <input
                      type="number"
                      min={1}
                      max={12}
                      placeholder="MM"
                      value={contactDraft.month}
                      onChange={(e) => setContactDraft({ ...contactDraft, month: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="AAAA"
                      value={contactDraft.year}
                      onChange={(e) => setContactDraft({ ...contactDraft, year: e.target.value })}
                    />
                  </span>
                </div>
                <div className="field">
                  <label>{AG("fieldPhone")}</label>
                  <input value={contactDraft.phone} onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })} />
                </div>
                <div className="field">
                  <label>{AG("fieldEmail")}</label>
                  <input value={contactDraft.email} onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })} />
                </div>
                <div className="field">
                  <label>{AG("fieldLead")}</label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={contactDraft.lead}
                    onChange={(e) => setContactDraft({ ...contactDraft, lead: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{AG("fieldNotes")}</label>
                  <input value={contactDraft.notes} onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn" onClick={() => void saveContact()}>
                    {AG("save")}
                  </button>
                  <button onClick={() => setContactDraft(null)}>{AG("cancel")}</button>
                </div>
              </div>
            )}
            {contacts.length === 0 && <p style={{ color: "var(--muted)" }}>{AG("emptyContacts")}</p>}
            {contacts.map((c) => (
              <div key={c.id} className="row-line">
                <span>
                  {c.name}
                  <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                    {c.relation ? `${c.relation} · ` : ""}
                    {c.birthdayMonth != null && c.birthdayDay != null
                      ? fill(AG("birthdayLine"), {
                          date: `${c.birthdayYear != null ? `${c.birthdayYear}-` : ""}${pad2(c.birthdayMonth)}-${pad2(c.birthdayDay)}`,
                        })
                      : ""}
                    {c.nextNoticeAt != null ? ` · ${fill(AG("nextNotice"), { date: agendaDay(c.nextNoticeAt) })}` : ""}
                    {c.birthdayMonth === 2 && c.birthdayDay === 29 ? (
                      <span style={{ display: "block" }}>{AG("birthdayLeapNote")}</span>
                    ) : null}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button title={AG("edit")} onClick={() => setContactDraft(contactToDraft(c))}>
                    {AG("edit")}
                  </button>
                  {deleteButton("ct", c.id)}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "notices" && (
          <div className="card">
            {(() => {
              const notices = data?.notices ?? [];
              const fmtTime = (ms: number) => {
                const d = new Date(ms);
                const p = (n: number) => String(n).padStart(2, "0");
                return `${p(d.getHours())}:${p(d.getMinutes())}`;
              };
              const ageText = (ms: number) => {
                const diff = Date.now() - ms;
                if (diff < 60 * 60_000) return NV("ageMinutes").replace("{count}", String(Math.max(1, Math.floor(diff / 60_000))));
                if (diff < 24 * 3600_000) return NV("ageHours").replace("{count}", String(Math.floor(diff / 3600_000)));
                return NV("ageDays").replace("{count}", String(Math.floor(diff / (24 * 3600_000))));
              };
              const waiting = notices.filter((n) => n.state === "fired" || n.state === "missed" || n.state === "fired-pending");
              const upcoming = notices.filter((n) => n.state === "armed" || n.state === "snoozed");
              const kindLabel = (k: string) => ND(`${k}Title`);
              const row = (n: AgendaNoticeRow) => (
                <div key={n.id} className="row-line" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div>
                      <strong>{kindLabel(n.kind)}</strong>
                      {n.text ? <span>{` · ${n.text}`}</span> : null}
                    </div>
                    <div className="muted">
                      {n.state === "missed" && (
                        <span>{`${NV("lateLine").replace("{time}", fmtTime(n.nextFireAt))} · ${ageText(n.nextFireAt)}`}</span>
                      )}
                      {n.state === "fired" && (
                        <span>{NV("firedLine").replace("{time}", fmtTime(n.lastFiredAt ?? n.nextFireAt))}</span>
                      )}
                      {n.state === "fired-pending" && <span>{NV("pendingLocked")}</span>}
                      {n.kind === "timer" && n.state === "armed" && (
                        <span>{NV("endsLine").replace("{time}", fmtTime(n.endsAt ?? n.nextFireAt))}</span>
                      )}
                      {n.kind !== "timer" && n.state === "armed" && (
                        <span>{NV("firesLine").replace("{time}", fmtTime(n.nextFireAt))}</span>
                      )}
                      {n.kind === "timer" && n.state === "snoozed" && <span>{NV("paused")}</span>}
                      {n.kind !== "timer" && n.state === "snoozed" && (
                        <span>{NV("snoozedUntil").replace("{time}", fmtTime(n.snoozeUntil ?? n.nextFireAt))}</span>
                      )}
                      {n.pending && n.state !== "fired-pending" ? <span>{` · ${NV("pendingLocked")}`}</span> : null}
                      {n.snoozeCount === 1 ? <span>{` · ${NV("snoozedOnce")}`}</span> : null}
                      {n.snoozeCount > 1 ? (
                        <span>{` · ${NV("snoozedTimes").replace("{count}", String(n.snoozeCount))}`}</span>
                      ) : null}
                    </div>
                    {snoozeFor === n.id && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "snooze", snoozeMinutes: 10 })}>
                          {NV("snooze10")}
                        </button>
                        <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "snooze", snoozeMinutes: 60 })}>
                          {NV("snooze60")}
                        </button>
                        <button
                          className="chip-toggle"
                          onClick={() => {
                            const t = new Date(n.nextFireAt);
                            t.setDate(t.getDate() + 1);
                            void actOnNotice({ id: n.id, action: "snooze", at: t.getTime() });
                          }}
                        >
                          {NV("snoozeTomorrow")}
                        </button>
                      </div>
                    )}
                  </div>
                  <span style={{ display: "flex", gap: 6 }}>
                    {n.kind === "timer" ? (
                      <>
                        {n.state === "armed" && (
                          <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "timer-pause" })}>
                            {NV("pause")}
                          </button>
                        )}
                        {n.state === "snoozed" && (
                          <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "timer-resume" })}>
                            {NV("resume")}
                          </button>
                        )}
                        <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "discard" })}>
                          {NV("discard")}
                        </button>
                      </>
                    ) : (
                      <>
                        {(n.state === "fired" || n.state === "missed" || n.state === "fired-pending" || n.state === "snoozed") && (
                          <button className="chip-toggle" onClick={() => setSnoozeFor(snoozeFor === n.id ? null : n.id)}>
                            {NV("snooze")}
                          </button>
                        )}
                        {!(n.state === "armed" && n.repeat) && (
                          <button className="chip-toggle" onClick={() => void actOnNotice({ id: n.id, action: "done" })}>
                            {NV("done")}
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              );
              if (notices.length === 0) return <p>{NV("empty")}</p>;
              return (
                <>
                  {waiting.length > 0 && (
                    <>
                      <h3>{NV("waiting")}</h3>
                      {waiting.map(row)}
                    </>
                  )}
                  {upcoming.length > 0 && (
                    <>
                      <h3>{NV("upcoming")}</h3>
                      {upcoming.map(row)}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryView({ boot }: { boot: Boot }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const M = (k: string) => lookup(s, "memorySettings", k);
  const MM = (k: string) => lookup(s, "memoryManager", k);
  const D = (k: string) => lookup(s, "drawer", k);
  const initial = (boot as Boot & {
    memorySettings?: {
      autoSummarize: boolean;
      historyTurnThreshold: number;
      maxSavedSessions: number;
      autoGenerateTitles: boolean;
    } | null;
  }).memorySettings;
  const [autoSummarize, setAutoSummarize] = useState(initial?.autoSummarize ?? true);
  // Cableado, pieza 2: los tres campos restantes del ajuste de
  // memoria, con el mismo patrón que la casilla viva de arriba:
  // el estado nace de la foto del bootstrap y una escritura solo
  // se aplica si el canal la cobra (si falla, el control se
  // queda en su valor guardado). Las etiquetas son las de la
  // sección memorySettings, que ya vive en los tres locales.
  const [threshold, setThreshold] = useState(initial?.historyTurnThreshold ?? 6);
  const [maxSessions, setMaxSessions] = useState(initial?.maxSavedSessions ?? 10);
  const [autoTitles, setAutoTitles] = useState(initial?.autoGenerateTitles ?? true);
  // §2 del bloque del loop (H-LOOP-5): la lista de lo guardado,
  // espejo de la pantalla «Mi memoria» del móvil: cuatro
  // pestañas en su orden, los campos de cada fila y solo esos,
  // el estado vacío por clase y el borrado por fila con la
  // confirmación en línea de PC (la forma de borrar chats) y
  // relectura entera tras cada borrado. Sin marcar hecho (el
  // almacén de PC aún no lo tiene) y sin «borrar todo» (el
  // móvil no lo tiene): la superficie no promete lo que no hay.
  const [tab, setTab] = useState<MemoryTab>("facts");
  const [data, setData] = useState<{
    facts: MemoryFactRow[];
    notes: MemoryNoteRow[];
    people: MemoryPersonRow[];
    reminders: MemoryReminderRow[];
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await window.nido.memoryList();
    if (r.ok) {
      setData({
        facts: r.facts ?? [],
        notes: r.notes ?? [],
        people: r.people ?? [],
        reminders: r.reminders ?? [],
      });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (kind: MemoryTab, id: string) => {
    const singular = kind === "facts" ? "fact" : kind === "notes" ? "note" : kind === "people" ? "person" : "reminder";
    const r = await window.nido.memoryDelete(singular, id);
    if (r.ok) {
      setConfirmDelete(null);
      await load();
    }
  };

  const deleteButton = (kind: MemoryTab, id: string) => {
    const key = `${kind}:${id}`;
    return confirmDelete === key ? (
      <button className="btn danger" onClick={() => void remove(kind, id)}>
        {D("deleteConfirm")}
      </button>
    ) : (
      <button title={MM("deleteTitle")} onClick={() => setConfirmDelete(key)}>
        <Icon name="delete" size={16} />
      </button>
    );
  };

  const emptyState = (t: MemoryTab) => (
    <>
      <p>{MM(`${t}.emptyTitle`)}</p>
      <p style={{ color: "var(--muted)" }}>{MM(`${t}.emptyDescription`)}</p>
    </>
  );

  return (
    <div className="view-scroll">
      <div className="view-column">
        <div className="card">
          <h2>{P("navMemory")}</h2>
          <p>{P("memoryBody")}</p>
          {initial != null && (
            <>
              <div className="row-line">
                <span>{M("autoSummarizeLabel")}</span>
                <input
                  type="checkbox"
                  checked={autoSummarize}
                  onChange={(e) => {
                    const next = e.target.checked;
                    // A-3: el resultado se cobra; si la escritura
                    // falla, la casilla vuelve a su valor guardado.
                    void window.nido
                      .settingsSet({ memoryAutoSummarize: next })
                      .then((r) => {
                        if (r.ok) setAutoSummarize(next);
                      });
                  }}
                />
              </div>
              <p style={{ color: "var(--muted)" }}>{M("autoSummarizeValue")}</p>
              <div className="row-line">
                <span>{M("turnsBeforeSummarizing")}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  {[4, 6, 8, 10].map((opt) => (
                    <button
                      key={opt}
                      className={`chip-toggle${threshold === opt ? " on" : ""}`}
                      onClick={() => {
                        void window.nido
                          .settingsSet({ memoryHistoryTurnThreshold: opt })
                          .then((r) => {
                            if (r.ok) setThreshold(opt);
                          });
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </span>
              </div>
              <div className="row-line">
                <span>{M("maxSavedSessions")}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  {[10, 25, 50, 0].map((opt) => (
                    <button
                      key={opt}
                      className={`chip-toggle${maxSessions === opt ? " on" : ""}`}
                      onClick={() => {
                        void window.nido
                          .settingsSet({ memoryMaxSavedSessions: opt })
                          .then((r) => {
                            if (r.ok) setMaxSessions(opt);
                          });
                      }}
                    >
                      {opt === 0 ? M("unlimited") : opt}
                    </button>
                  ))}
                </span>
              </div>
              <div className="row-line">
                <span>{M("autoTitlesLabel")}</span>
                <input
                  type="checkbox"
                  checked={autoTitles}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void window.nido
                      .settingsSet({ memoryAutoGenerateTitles: next })
                      .then((r) => {
                        if (r.ok) setAutoTitles(next);
                      });
                  }}
                />
              </div>
              <p style={{ color: "var(--muted)" }}>{M("autoTitlesValue")}</p>
            </>
          )}
        </div>
        <div className="card">
          <h2>{MM("title")}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MEMORY_TABS.map((t) => (
              <button
                key={t}
                className={`chip-toggle${tab === t ? " on" : ""}`}
                onClick={() => {
                  setTab(t);
                  setConfirmDelete(null);
                }}
              >
                {MM(`tabs.${t}`)}
              </button>
            ))}
          </div>
          {data !== null && tab === "facts" && (
            <>
              {data.facts.length === 0
                ? emptyState("facts")
                : data.facts.map((f) => (
                    <div key={f.id} className="row-line">
                      <span style={{ flex: "1 1 auto" }}>{f.content}</span>
                      {deleteButton("facts", f.id)}
                    </div>
                  ))}
            </>
          )}
          {data !== null && tab === "notes" && (
            <>
              {data.notes.length === 0
                ? emptyState("notes")
                : data.notes.map((n) => (
                    <div key={n.id} className="row-line">
                      <span style={{ flex: "1 1 auto" }}>
                        {n.title}
                        {n.body ? (
                          <>
                            <br />
                            <span style={{ color: "var(--muted)" }}>{n.body}</span>
                          </>
                        ) : null}
                      </span>
                      {deleteButton("notes", n.id)}
                    </div>
                  ))}
            </>
          )}
          {data !== null && tab === "people" && (
            <>
              {data.people.length === 0
                ? emptyState("people")
                : data.people.map((p) => (
                    <div key={p.id} className="row-line">
                      <span style={{ flex: "1 1 auto" }}>
                        {p.name}
                        {p.notes ? (
                          <>
                            <br />
                            <span style={{ color: "var(--muted)" }}>{p.notes}</span>
                          </>
                        ) : null}
                      </span>
                      {deleteButton("people", p.id)}
                    </div>
                  ))}
            </>
          )}
          {data !== null && tab === "reminders" && (
            <>
              {data.reminders.length === 0
                ? emptyState("reminders")
                : data.reminders.map((r) => (
                    <div key={r.id} className="row-line">
                      <span
                        style={{
                          flex: "1 1 auto",
                          ...(r.done === 1
                            ? { opacity: 0.55, textDecoration: "line-through" }
                            : {}),
                        }}
                      >
                        {r.text}
                        {r.dueLabel ? (
                          <>
                            <br />
                            <span style={{ color: "var(--muted)" }}>{r.dueLabel}</span>
                          </>
                        ) : null}
                        {r.repeat ? (
                          <>
                            <br />
                            <span style={{ color: "var(--muted)" }}>
                              {MM(
                                r.repeat === "day"
                                  ? "repeatDay"
                                  : r.repeat === "week"
                                    ? "repeatWeek"
                                    : r.repeat === "month"
                                      ? "repeatMonth"
                                      : "repeatYear",
                              )}
                            </span>
                          </>
                        ) : null}
                      </span>
                      {deleteButton("reminders", r.id)}
                    </div>
                  ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// S-9 · Ajustes de dos paneles y el Acerca de
// ---------------------------------------------------------------------

const SETTINGS_TABS = ["security", "tone", "models", "knowledge", "appearance", "language", "voice", "memory", "notices", "about"] as const;

// E11 (paso 6): los nombres de los cinco escalones de
// tamaño, en el grupo pcSurface de los locales.
const FONT_STEP_LABELS: Record<string, string> = {
  small: "fontStepSmall",
  compact: "fontStepCompact",
  standard: "fontStepStandard",
  large: "fontStepLarge",
  "extra-large": "fontStepExtraLarge",
};

const PERSONALITY_IDS = ["succinct", "detailed", "summary", "custom"] as const;

/**
 * La sección Voz de Ajustes (E9 paso 5): los tres gobiernos
 * (dictado, lectura en voz alta, oferta de la reserva del
 * sistema), el estado honesto de la voz con su nombre
 * (H-5) y la tarjeta de activos de voz (firma 3) con la
 * cuenta antes de descargar (H-7). La reserva es solo de
 * lectura: el dictado de PC es local por construcción y no
 * tiene reserva del sistema en ninguna forma (D-1 forma C).
 */
function VoiceSection({ boot, refresh }: { boot: Boot; refresh: () => Promise<void> }) {
  const s = boot.strings as Strings;
  const V = (k: string) => lookup(s, "voiceSettings", k);
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [dictate, setDictate] = useState(boot.voiceInputEnabled ?? true);
  const [readAloud, setReadAloud] = useState(boot.readAloudEnabled ?? false);
  const [reserve, setReserve] = useState(boot.voiceSystemReserveEnabled ?? true);
  const [speechLocal, setSpeechLocal] = useState(false);
  const [systemPresent, setSystemPresent] = useState(false);
  const [rows, setRows] = useState<VoiceAssetRow[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.nido
      .voiceSpeakState()
      .then((r) => {
        if (live) setSpeechLocal(r?.ok === true && r.state === "onDevice");
      })
      .catch(() => {});
    const checkVoices = () => {
      if (live) setSystemPresent(systemVoicePresent());
    };
    checkVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", checkVoices);
    return () => {
      live = false;
      window.speechSynthesis?.removeEventListener?.("voiceschanged", checkVoices);
    };
  }, []);

  const loadRows = useCallback(async () => {
    const r = await window.nido.voiceAssets().catch(() => null);
    if (r?.ok && r.rows) setRows(r.rows);
  }, []);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);
  useEffect(() => {
    const off = window.nido.onVoiceAssetProgress((p) => {
      setProgress((cur) => ({
        ...cur,
        [p.id]: p.total > 0 ? Math.floor((p.done / p.total) * 100) : 0,
      }));
    });
    return off;
  }, []);

  const state = voiceSurfaceState({
    speechLocal,
    reserveOffered: reserve,
    systemVoicePresent: systemPresent,
  });

  const toggle = (
    key: "voiceInputEnabled" | "readAloudEnabled" | "voiceSystemReserveEnabled",
    next: boolean,
    apply: (v: boolean) => void,
  ) => {
    apply(next);
    if (key === "voiceSystemReserveEnabled") setReserveOffered(next);
    void window.nido.settingsSet({ [key]: next }).then(() => refresh());
  };

  const install = async (id: string) => {
    setInstalling(id);
    setInstallError(null);
    const r = await window.nido.voiceAssetInstall(id).catch(() => null);
    setInstalling(null);
    setProgress((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    if (!r?.ok) setInstallError(r?.error ?? r?.reason ?? "error");
    await loadRows();
    // El estado de los motores puede haber nacido con la descarga.
    const st = await window.nido.voiceSpeakState().catch(() => null);
    if (st?.ok) setSpeechLocal(st.state === "onDevice");
  };

  const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

  return (
    <div className="card">
      <h3>{V("title")}</h3>
      <p>
        {state === "local" && V("stateLocal")}
        {state === "reserve" && V("stateReserve")}
        {state === "none" && V("stateNone")}
      </p>
      <div className="row-line">
        <span>
          {V("dictateLabel")}
          <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
            {V("dictateBody")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={dictate}
          onChange={(e) => toggle("voiceInputEnabled", e.target.checked, setDictate)}
        />
      </div>
      <div className="row-line">
        <span>
          {V("readAloudLabel")}
          <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
            {V("readAloudBody")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={readAloud}
          onChange={(e) => toggle("readAloudEnabled", e.target.checked, setReadAloud)}
        />
      </div>
      <div className="row-line">
        <span>
          {V("reserveLabel")}
          <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
            {V("reserveBody")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={reserve}
          onChange={(e) =>
            toggle("voiceSystemReserveEnabled", e.target.checked, setReserve)
          }
        />
      </div>
      <span className="section-label">{V("assetsTitle")}</span>
      <p style={{ color: "var(--muted)" }}>{V("assetsNote")}</p>
      {rows.map((row) => (
        <div key={row.id} className="row-line">
          <span>
            {row.label}
            <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
              {mb(row.archiveBytes)} · {row.license}
            </span>
          </span>
          {row.state === "installed" && row.verified ? (
            <span>{V("installed")}</span>
          ) : installing === row.id ? (
            <span>{progress[row.id] ?? 0}%</span>
          ) : (
            <button className="btn" onClick={() => void install(row.id)}>
              {P("actionDownload")}
            </button>
          )}
        </div>
      ))}
      {installError && <p className="vault-error">{installError}</p>}
      <p style={{ color: "var(--muted)" }}>{V("memoryNote")}</p>
      <p style={{ color: "var(--muted)" }}>{V("provisionalNote")}</p>
      <p style={{ color: "var(--muted)" }}>{V("ptChainNote")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// E11 (O-1·E11) · El respaldo y la rotación en Seguridad,
// dentro de la sesión de la bóveda: dos gestos expresos
// de la persona y ninguno más. El respaldo pide su
// contraseña propia (distinta de la de la bóveda) y el
// destino en el diálogo de guardar; la rotación pide la
// credencial otra vez y su confirmación, y termina en
// reinicio: se ejecuta al desbloquear, antes de abrir
// ninguna base. Con la bóveda bloqueada la tarjeta ni se
// ofrece (la monta solo la sesión abierta).
// ---------------------------------------------------------------------

function VaultBackupCard({
  P,
  rotationOutcome,
}: {
  P: (k: string) => string;
  rotationOutcome: "done" | "recovered" | "failed" | null;
}) {
  const [backupPassword, setBackupPassword] = useState("");
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [rotatePassword, setRotatePassword] = useState("");
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotateNote, setRotateNote] = useState<string | null>(null);

  const doExport = async () => {
    if (backupPassword.length < 8) {
      setBackupNote(P("vaultBackupPasswordShort"));
      return;
    }
    const d = await window.nido.exportSaveDialog({ defaultName: "nido-respaldo.nidbackup" });
    if (!d.ok || !d.path) return; // cancelado: no se escribe nada
    const r = await window.nido.backupExport({
      destPath: d.path,
      backupPassword,
    });
    if (r.ok) {
      setBackupPassword("");
      setBackupNote(fill(P("vaultBackupDone"), { path: d.path }));
    } else {
      setBackupNote(r.message ?? P("vaultBackupFailed"));
    }
  };

  const doRotate = async () => {
    const r = await window.nido
      .vaultRotateRequest({ password: rotatePassword })
      .catch(() => null);
    // Si la app no salió, la petición fue rechazada.
    if (r && !r.ok) setRotateNote(P("vaultRotateReauthFailed"));
  };

  return (
    <div className="card vault-backup-card">
      <h3>{P("vaultBackupTitle")}</h3>
      <p>{P("vaultBackupBody")}</p>
      <div className="field">
        <span>{P("vaultBackupPassword")}</span>
        <input
          type="password"
          value={backupPassword}
          onChange={(e) => setBackupPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <button className="btn" onClick={() => void doExport()}>
        {P("vaultBackupExport")}
      </button>
      {backupNote && <p>{backupNote}</p>}
      <h3>{P("vaultRotateTitle")}</h3>
      <p>{P("vaultRotateBody")}</p>
      {rotationOutcome === "done" && <p>{P("vaultRotateDone")}</p>}
      {rotationOutcome === "recovered" && <p>{P("vaultRotateRecovered")}</p>}
      {rotationOutcome === "failed" && <p>{P("vaultRotateFailed")}</p>}
      <div className="field">
        <span>{P("vaultRotatePassword")}</span>
        <input
          type="password"
          value={rotatePassword}
          onChange={(e) => setRotatePassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <div className="row-line">
        <span>{P("vaultRotateConfirm")}</span>
        <input
          type="checkbox"
          checked={rotateConfirm}
          onChange={(e) => setRotateConfirm(e.target.checked)}
        />
      </div>
      <button
        className="btn"
        disabled={!rotateConfirm || rotatePassword.length === 0}
        onClick={() => void doRotate()}
      >
        {P("vaultRotateButton")}
      </button>
      {rotateNote && <p>{rotateNote}</p>}
    </div>
  );
}

/** La mitad de historial de la tarjeta de permisos (O-12): lo
 * que el agente hizo, leído del historial guardado por su canal,
 * con el deshacer de lo que creó (nota o recordatorio) tras la
 * confirmación en línea de la casa y el borrado del historial
 * entero. Es la mitad que la tarjeta del móvil ya tenía y que
 * en PC faltaba porque no existía el almacén; la cura O-12 lo
 * porta y esta pieza lo enseña. */
function AgentHistory({ s }: { s: Strings }) {
  const H = (k: string) => lookup(s, "agentPermissions", k);
  const [actions, setActions] = useState<ActionLogRow[] | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await window.nido.actionLogList();
    if (r.ok) setActions(r.actions ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const undo = async (a: ActionLogRow) => {
    const r = await window.nido.actionLogUndo(a.id);
    setConfirmUndo(null);
    if (r.ok) {
      setUndoFailed(false);
      await load();
    } else {
      setUndoFailed(true);
    }
  };

  const clear = async () => {
    const r = await window.nido.actionLogClear();
    setConfirmClear(false);
    if (r.ok) await load();
  };

  const canUndo = (a: ActionLogRow) => a.outcome === "executed" && !!a.undo && !a.undone;

  return (
    <>
      <h3>{H("historyTitle")}</h3>
      <p>{H("historyBody")}</p>
      {actions !== null && actions.length === 0 && <p>{H("historyEmpty")}</p>}
      {actions?.map((a) => (
        <div key={a.id} className="row-line">
          <span>
            {a.tool}
            <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
              {H(`outcome.${a.outcome}`)}
              {a.confirmed ? ` · ${H("confirmed")}` : ""}
              {a.undone ? ` · ${H("undone")}` : ""}
              {` · ${new Date(a.ts).toLocaleString()}`}
            </span>
          </span>
          {canUndo(a) &&
            (confirmUndo === a.id ? (
              <span>
                <span style={{ display: "block", fontSize: "0.85em" }}>
                  {a.undo?.kind === "note" ? H("undoNoteBody") : H("undoReminderBody")}
                </span>
                <button className="btn danger" onClick={() => void undo(a)}>
                  {H("undo")}
                </button>
              </span>
            ) : (
              <button aria-label={fill(H("undoLabel"), { tool: a.tool })} onClick={() => setConfirmUndo(a.id)}>
                {H("undo")}
              </button>
            ))}
        </div>
      ))}
      {undoFailed && <p>{H("undoFailed")}</p>}
      {actions !== null &&
        actions.length > 0 &&
        (confirmClear ? (
          <div className="row-line">
            <span>{H("clearBody")}</span>
            <button className="btn danger" onClick={() => void clear()}>
              {H("clearTitle")}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmClear(true)}>{H("clearTitle")}</button>
        ))}
    </>
  );
}

function SettingsView({
  boot,
  tab,
  setTab,
  refresh,
  goLibrary,
  goModels,
}: {
  boot: Boot;
  tab: string;
  setTab: (t: string) => void;
  refresh: () => Promise<void>;
  goLibrary: () => void;
  goModels: () => void;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [query, setQuery] = useState("");
  const [customText, setCustomText] = useState<string | null>(null);
  // E7 (paso 6): la zona «Avisos»: el permiso de notificaciones
  // se pide una vez desde su fila y su estado queda declarado;
  // que ya se pidió vive en los ajustes (sin canal nuevo).
  const [noticePerm, setNoticePerm] = useState<string>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [noticeAsked, setNoticeAsked] = useState<boolean>(boot.noticesPermissionAsked ?? false);
  // E8: las filas de la zona «Avisos» que la etapa añade: el
  // texto en las notificaciones (§5.3), el residente y el
  // arranque con el sistema (paso 6, en el orden de la
  // decisión 3). El arranque enseña el estado leído de su
  // fuente real del SO, que el bootstrap sirve.
  const [noticeShowText, setNoticeShowText] = useState<boolean>(boot.noticesShowText ?? true);
  const [noticeResident, setNoticeResident] = useState<boolean>(boot.noticesResident ?? false);
  const [noticeResidentUndecided] = useState<boolean>(boot.noticesResident === null || boot.noticesResident === undefined);
  const [noticeAutostart, setNoticeAutostart] = useState<boolean>(boot.noticesAutostart ?? false);
  const names: Record<string, string> = {
    security: P("security"),
    tone: lookup(s, "personalitySettings", "title"),
    models: P("models"),
    knowledge: P("packsTab"),
    appearance: P("appearance"),
    language: P("language"),
    voice: lookup(s, "voiceSettings", "title"),
    memory: P("navMemory"),
    notices: lookup(s, "noticesSettings", "title"),
    about: P("about"),
  };
  const visible = SETTINGS_TABS.filter(
    (t) => query.trim() === "" || names[t].toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="settings-shell">
      <nav className="settings-nav">
        <div className="field">
          <input
            type="search"
            placeholder={P("settingsSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {visible.map((t) => (
          <button key={t} className={`nav-item${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {names[t]}
          </button>
        ))}
        {visible.length === 0 && <p style={{ color: "var(--muted)" }}>{P("settingsEmpty")}</p>}
        <button className="nav-item" onClick={goLibrary}>
          <Icon name="knowledge" size={20} /> {lookup(s, "aboutScreen", "guideLink")}
        </button>
      </nav>
      <div className="settings-body">
        <div className="view-column">
          {tab === "security" && (
            <div className="card">
              <h3>{P("security")}</h3>
              <p>{P("securityBody")}</p>
              <p>{P("passwordFixedNote")}</p>
              <button className="btn" onClick={() => void window.nido.vaultLock()}>
                {P("vaultLock")}
              </button>
            </div>
          )}
          {tab === "security" && boot.vault.unlocked && (
            <VaultBackupCard P={P} rotationOutcome={boot.rotationOutcome ?? null} />
          )}
          {tab === "tone" && (
            <div className="card">
              <h3>{lookup(s, "personalitySettings", "title")}</h3>
              {PERSONALITY_IDS.map((id) => (
                <div key={id} className="row-line">
                  <span>
                    {lookup(s, "personalities", `${id}.label`)}
                    <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                      {lookup(s, "personalities", `${id}.description`)}
                    </span>
                  </span>
                  <input
                    type="radio"
                    name="personality"
                    checked={boot.personality === id}
                    onChange={() =>
                      void window.nido.settingsSet({ personality: id }).then(() => refresh())
                    }
                  />
                </div>
              ))}
              {boot.personality === "custom" && (
                <div className="field" style={{ marginTop: "var(--sp-3)" }}>
                  <span>{P("toneCustomLabel")}</span>
                  <textarea
                    rows={5}
                    value={customText ?? boot.customSystemPrompt ?? ""}
                    placeholder={P("toneCustomPlaceholder")}
                    onChange={(e) => setCustomText(e.target.value)}
                  />
                  <button
                    className="btn primary"
                    onClick={() =>
                      void window.nido
                        .settingsSet({ customSystemPrompt: customText ?? boot.customSystemPrompt ?? "" })
                        .then((r) => {
                          if (r.ok) setCustomText(null);
                          return refresh();
                        })
                    }
                  >
                    {P("toneCustomSave")}
                  </button>
                </div>
              )}
            </div>
          )}
          {tab === "tone" && (
            <div className="card">
              {/* La tarjeta del agente entera, como la del móvil:
                  la mitad de historial (O-12: el almacén guardado
                  y su deshacer, por los canales nido:action-log-*)
                  sobre la mitad de permisos (bloque de cableado,
                  pieza 1). La lista de permisos es la viva del
                  manifiesto (LOCAL_TOOLS) y el estado es la foto
                  del bootstrap, la misma que la marca de la guía
                  lee. El interruptor es controlado por esa foto:
                  al moverlo se escribe por el canal y se relee el
                  bootstrap; si la escritura vuelve ok: false, la
                  foto no cambia y el interruptor vuelve a su
                  estado anterior, sin fingir el cambio. */}
              <AgentHistory s={s} />
              <h3>{lookup(s, "agentPermissions", "toolsTitle")}</h3>
              <p>{lookup(s, "agentPermissions", "toolsBody")}</p>
              {LOCAL_TOOLS.map((tool) => {
                const current = boot.disabledTools ?? [];
                const enabled = !current.includes(tool.name);
                return (
                  <div key={tool.name} className="row-line">
                    <span>
                      {tool.name}
                      <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                        {tool.description}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      aria-label={fill(lookup(s, "agentPermissions", "toggleLabel"), { tool: tool.name })}
                      onChange={() => {
                        const next = enabled
                          ? [...current, tool.name]
                          : current.filter((n) => n !== tool.name);
                        void window.nido.settingsSet({ disabledTools: next }).then(() => refresh());
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {tab === "models" && (
            <div className="card">
              <h3>{P("models")}</h3>
              <button className="btn primary" onClick={goModels}>
                {P("navModels")}
              </button>
            </div>
          )}
          {tab === "knowledge" && (
            <>
              <PacksTab boot={boot} />
              <DocumentsCard boot={boot} />
            </>
          )}
          {tab === "appearance" && (
            <div className="card">
              <h3>{P("appearance")}</h3>
              <div className="row-line">
                <span>{P("themeDaylight")}</span>
                <input
                  type="radio"
                  name="theme"
                  checked={boot.prefs.theme === "daylight"}
                  onChange={() => void window.nido.prefsSet({ theme: "daylight" }).then(() => refresh())}
                />
              </div>
              <div className="row-line">
                <span>{P("themeNight")}</span>
                <input
                  type="radio"
                  name="theme"
                  checked={boot.prefs.theme === "night"}
                  onChange={() => void window.nido.prefsSet({ theme: "night" }).then(() => refresh())}
                />
              </div>
              <div className="row-line">
                <span>{P("fontSize")}</span>
                <span />
              </div>
              {FONT_SCALE_STEPS.map((step) => (
                <div key={step.id} className="row-line">
                  <span>{P(FONT_STEP_LABELS[step.id])}</span>
                  <input
                    type="radio"
                    name="font-scale"
                    checked={(boot.fontScaleStep ?? "standard") === step.id}
                    onChange={() =>
                      void window.nido
                        .settingsSet({ fontScaleStep: step.id })
                        .then(() => refresh())
                    }
                  />
                </div>
              ))}
              <div className="row-line">
                <span>{P("sendWithEnter")}</span>
                <input
                  type="checkbox"
                  checked={boot.sendOnEnter ?? true}
                  onChange={(e) =>
                    void window.nido.settingsSet({ sendOnEnter: e.target.checked }).then(() => refresh())
                  }
                />
              </div>
              <div className="muted">{P("sendWithEnterHint")}</div>
            </div>
          )}
          {tab === "language" && (
            <div className="card">
              <h3>{P("language")}</h3>
              {(["es", "en", "pt"] as const).map((lang) => (
                <div key={lang} className="row-line">
                  <span>{lang === "es" ? "Español" : lang === "en" ? "English" : "Português"}</span>
                  <input
                    type="radio"
                    name="lang"
                    checked={boot.prefs.lang === lang}
                    onChange={() => void window.nido.prefsSet({ lang }).then(() => refresh())}
                  />
                </div>
              ))}
            </div>
          )}
          {tab === "voice" && <VoiceSection boot={boot} refresh={refresh} />}
          {tab === "memory" && <MemoryView boot={boot} />}
          {tab === "notices" && (
            <>
            <div className="card">
              <h3>{lookup(s, "noticesSettings", "title")}</h3>
              <div className="row-line">
                <span>{lookup(s, "noticesSettings", "permissionTitle")}</span>
                <span>
                  {noticePerm === "granted"
                    ? lookup(s, "noticesSettings", "stateGranted")
                    : noticePerm === "denied"
                      ? lookup(s, "noticesSettings", "stateDenied")
                      : noticeAsked
                        ? lookup(s, "noticesSettings", "stateAsked")
                        : lookup(s, "noticesSettings", "stateDefault")}
                </span>
              </div>
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "permissionBody")}</p>
              {noticePerm === "default" && !noticeAsked && (
                <button
                  className="btn"
                  onClick={() => {
                    void (async () => {
                      let result = "default";
                      try {
                        result = await Notification.requestPermission();
                      } catch {
                        result = "default";
                      }
                      setNoticePerm(result);
                      const r = await window.nido.settingsSet({ noticesPermissionAsked: true });
                      if (r.ok) setNoticeAsked(true);
                    })();
                  }}
                >
                  {lookup(s, "noticesSettings", "permissionAsk")}
                </button>
              )}
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "intervalNote")}</p>
              <div className="row-line">
                <span>{lookup(s, "noticesSettings", "showTextTitle")}</span>
                <input
                  type="checkbox"
                  checked={noticeShowText}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void window.nido.settingsSet({ noticesShowText: next }).then((r) => {
                      if (r.ok) setNoticeShowText(next);
                    });
                  }}
                />
              </div>
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "showTextBody")}</p>
              <div className="row-line">
                <span>{lookup(s, "noticesSettings", "residentTitle")}</span>
                <input
                  type="checkbox"
                  checked={noticeResident}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void window.nido.settingsSet({ noticesResident: next }).then((r) => {
                      if (r.ok) setNoticeResident(next);
                    });
                  }}
                />
              </div>
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "residentBody")}</p>
              {noticeResidentUndecided && (
                <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "residentUndecided")}</p>
              )}
              <div className="row-line">
                <span>{lookup(s, "noticesSettings", "autostartTitle")}</span>
                <input
                  type="checkbox"
                  checked={noticeAutostart}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void window.nido.settingsSet({ noticesAutostart: next }).then((r) => {
                      if (r.ok) setNoticeAutostart(next);
                    });
                  }}
                />
              </div>
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "autostartBody")}</p>
              <p style={{ color: "var(--muted)" }}>{lookup(s, "noticesSettings", "residentCost")}</p>
              <div className="row-line">
                <span>{lookup(s, "noticesSettings", "custodyTitle")}</span>
                <span>
                  {boot.noticesCustody && boot.noticesCustody !== "unavailable"
                    ? lookup(s, "noticesSettings", "custodyBody").replace("{backend}", boot.noticesCustody)
                    : lookup(s, "noticesSettings", "custodyUnavailable")}
                </span>
              </div>
            </div>
            {/* E8 (paso 8, forma A): la tarjeta de tareas
                programadas, en esta misma zona del ejecutor,
                titulada por scheduledTasks.title. */}
            <ScheduledTasksCard strings={s} lang={boot.prefs.lang} />
            </>
          )}
          {tab === "about" && <AboutTab boot={boot} goLibrary={goLibrary} />}
        </div>
      </div>
    </div>
  );
}

// La tarjeta de documentos personales de «base de
// conocimiento y documentos» (E6, paso 7): el gesto de
// añadir — el selector es el input del renderizador y las
// rutas viajan por webUtils, como en los paquetes — y el
// resultado con su nombre. La gestión de lo importado (la
// Biblioteca con su presupuesto) es la superficie del paso 8;
// esta tarjeta promete solo lo que ya funciona: importar,
// preguntar y abrir la cita en su página.
function DocumentsCard({ boot }: { boot: Boot }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnLines, setWarnLines] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const paths = Array.from(files).map((f) => window.nido.docFilePath(f)).filter((p) => p.length > 0);
    if (paths.length === 0) return;
    setBusy(true);
    setNotice(null);
    setWarnLines([]);
    const r = await window.nido.documentsImport(paths);
    setBusy(false);
    if (r.ok) {
      setNotice(
        r.warnings && r.warnings.length > 0
          ? fill(P("docsImportedWarn"), { name: r.name ?? "" })
          : fill(P("docsImported"), { name: r.name ?? "" }),
      );
      // B-2: bajo el titular, las líneas por fichero que la
      // misma respuesta ya trae (nombre y razón en letra).
      setWarnLines((r.warnings ?? []).map((w) => warningLine(P, w)));
    } else {
      setNotice(P("docsFailed"));
    }
  };

  return (
    <div className="card">
      <h3>{P("docsTitle")}</h3>
      <p>{P("docsRule")}</p>
      {notice && <p>{notice}</p>}
      {warnLines.length > 0 && (
        <ul className="lib-docs-files">
          {warnLines.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: "var(--sp-3)" }}>
        <button className="btn primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {P("docsAdd")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.log,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp"
          style={{ display: "none" }}
          onChange={(e) => {
            void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// La sección de paquetes de «base de conocimiento y
// documentos» (paso 8 de E5): cada fila con su nombre, su
// origen como la interfaz lo nombra, su edición y su estado
// derivado en el proceso principal; las acciones corren por la
// puerta real y la lista se re-deriva tras cada acto. La regla
// de superficie va en su letra: una firma prueba origen e
// integridad, nunca calidad. La nota de SALVORA es texto de la
// sección, servido de su fuente única: no es una fila, no es
// un botón de compra y no trae las direcciones de la tarjeta.
function PacksTab({ boot }: { boot: Boot }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [data, setData] = useState<{ rows: PackRowView[]; note: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [packConfirm, setPackConfirm] = useState<ConfirmPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const apply = (r: { rows?: PackRowView[]; note?: string }) => {
    if (r.rows) setData({ rows: r.rows, note: r.note ?? "" });
  };
  useEffect(() => {
    void window.nido.packsList().then((r) => {
      if (r.ok) apply(r);
    });
  }, []);

  // El diálogo de confirmación de la carcasa, en esta sede: la
  // petición de confirmación del proceso principal solo la
  // escucha la vista de chat (su tarjeta vive allí, acoplada a
  // la fase del turno), así que una importación pedida desde
  // esta sección quedaba sin tarjeta y colgada hasta el drenaje
  // (hallazgo de la pasada del paso 8 de E5). Esta sección
  // escucha la misma petición y pinta la misma tarjeta donde la
  // persona está: el origen que nombra es el que la puerta
  // verificó en la misma corrida que copia, y la respuesta va
  // por el mismo canal de la carcasa.
  useEffect(() => {
    const off = window.nido.onConfirmRequest((p) => {
      if (p.kind === "pack-import") setPackConfirm(p);
    });
    return off;
  }, []);

  const stateLabel = (row: PackRowView): string => {
    if (row.kind === "imported") return P("packsStateImported");
    switch (row.state) {
      case "current":
        return P("packsStateCurrent");
      case "outdated":
        return P("packsStateOutdated");
      case "unusable":
        return P("packsStateUnusable");
      default:
        return P("packsStateAvailable");
    }
  };
  const reasonLabel = (reason: string): string => {
    const map: Record<string, string> = {
      "missing-manifest": "packsReasonMissingManifest",
      "hash-mismatch": "packsReasonHashMismatch",
      "not-signed-by-us": "packsReasonNotSignedByUs",
      "not-a-pack": "packsReasonNotAPack",
      damaged: "packsReasonDamaged",
      "too-large": "packsReasonTooLarge",
    };
    return P(map[reason] ?? "packsReasonDamaged");
  };
  const install = async (row: PackRowView) => {
    setBusy(row.key);
    setNotice(null);
    const r = await window.nido.packInstall(row.key);
    setBusy(null);
    apply(r);
    if (!r.ok) setNotice(fill(P("packsInstallFailed"), { error: r.error ?? r.reason ?? "" }));
  };
  // El fichero entra por esta vista (el input de fichero o el
  // arrastre sobre la sección) y su ruta viaja al proceso
  // principal, que la pasa por la puerta firmada: el paquete no
  // contiene ningún selector libre del proceso principal
  // (censo D-1 del endurecimiento de la carcasa).
  const importFromPath = async (path: string) => {
    if (!path) return;
    setBusy("import");
    setNotice(null);
    const r = await window.nido.packImportPath(path);
    setBusy(null);
    apply(r);
    const o = r.outcome;
    if (!o) return;
    if (o.status === "imported") setNotice(P("packsOutcomeImported"));
    else if (o.status === "already-imported") setNotice(P("packsOutcomeAlready"));
    else if (o.status === "cancelled") setNotice(P("packsOutcomeCancelled"));
    else if (o.status === "rejected")
      setNotice(fill(P("packsOutcomeRejected"), { reason: reasonLabel(o.reason ?? "") }));
  };
  const importFromFile = (file: File | null | undefined) => {
    if (!file) return;
    void importFromPath(window.nido.packFilePath(file));
  };
  const remove = async (row: PackRowView) => {
    // B-7: el gesto captura el rechazo (el manejador no
    // captura lo que removePackRow lance), libera busy en
    // finally y nombra su frase de fallo; con filas que
    // aplicar, el camino de respuesta es el de siempre.
    setBusy(row.key);
    setNotice(null);
    try {
      const r = await window.nido.packRemove(row.key);
      if (r.rows) apply(r);
      else setNotice(fill(P("packsRemoveFailed"), { error: r.reason ?? "" }));
    } catch (e) {
      setNotice(fill(P("packsRemoveFailed"), { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="card"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        importFromFile(e.dataTransfer.files?.[0]);
      }}
    >
      <h3>{P("packsTitle")}</h3>
      <p>{P("packsRule")}</p>
      {data?.rows.map((row) => (
        <div key={`${row.kind}:${row.key}`} className="row-line">
          <span>
            {row.name}
            <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
              {row.originLabel}
              {row.edition ? ` · ${row.edition}` : ""}
              {row.kind === "imported" && row.importedAt
                ? ` · ${fill(P("packsImportedOn"), { date: row.importedAt.slice(0, 10) })}`
                : ""}
              {` · ${stateLabel(row)}`}
            </span>
            {row.embeddingWarning && (
              <span style={{ color: "var(--muted)", display: "block", fontSize: "0.85em" }}>
                {P("packsEmbeddingWarning")}
              </span>
            )}
          </span>
          {row.canInstall && (
            <button className="btn" disabled={busy != null} onClick={() => void install(row)}>
              {row.state === "outdated" ? P("packsUpdate") : P("packsInstall")}
            </button>
          )}
          {row.canRemove && (
            <button className="btn" disabled={busy != null} onClick={() => void remove(row)}>
              {P("packsRemove")}
            </button>
          )}
        </div>
      ))}
      <div style={{ marginTop: "var(--sp-3)" }}>
        <button
          className="btn primary"
          disabled={busy != null}
          onClick={() => fileInputRef.current?.click()}
        >
          {P("packsAddFile")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sqlite"
          style={{ display: "none" }}
          onChange={(e) => {
            importFromFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {packConfirm && (
        <div className="confirm-card">
          <div>{P("confirmTitle")}</div>
          {packConfirm.scope && <div className="scope">{packConfirm.scope}</div>}
          <div>{packConfirm.message}</div>
          <div className="confirm-actions">
            <button
              className="btn primary"
              onClick={() => {
                window.nido.confirmResponse(packConfirm.id, true);
                setPackConfirm(null);
              }}
            >
              {P("confirmApprove")}
            </button>
            <button
              className="btn"
              onClick={() => {
                window.nido.confirmResponse(packConfirm.id, false);
                setPackConfirm(null);
              }}
            >
              {P("confirmReject")}
            </button>
          </div>
        </div>
      )}
      {notice && <p>{notice}</p>}
      <div style={{ marginTop: "var(--sp-3)" }}>
        <span className="section-label">{P("packsNoteLabel")}</span>
        <p>{data?.note ?? ""}</p>
      </div>
    </div>
  );
}

// La sección Modelos de la barra: el gestor en la forma de esta
// tanda (la lista con sus estados reales y la carga por la vía
// única); el gestor entero con su cola de descargas es de E4.
function ModelsView({ boot, refresh }: { boot: Boot; refresh: () => Promise<void> }) {
  return (
    <div className="view-scroll">
      <div className="view-column">
        <ModelsTab boot={boot} refresh={refresh} />
      </div>
    </div>
  );
}

/**
 * El gestor de modelos (E4 paso 6, DISENO-PC §4): cabecera de
 * la máquina, la lista con sus insignias honestas y sus
 * estados de descarga, y la ficha con la cuenta de memoria
 * desglosada. Los datos son los del gestor del proceso
 * principal (censo con huella y tarjetas derivadas); el
 * bootstrap solo cubre el primer instante.
 */
function ModelsTab({ boot, refresh }: { boot: Boot; refresh: () => Promise<void> }) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [data, setData] = useState<{
    models: ModelInfo[];
    recommendation: Boot["recommendation"];
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  // El sello de emisión de la guardia de secuencia (AU-2):
  // cada lectura y cada gesto toman el siguiente número al
  // emitir, y una respuesta solo escribe si su sello sigue
  // siendo el vigente al volver. Una foto generada antes de
  // una operación (la completa del montaje, cuyo refresh se
  // encola por delante de la activación del clic) no puede
  // así enterrar el resultado de la operación aterrizando
  // después: superada, se descarta en silencio.
  const applySeq = useRef(0);
  const models = data?.models ?? boot.models;
  const recommendation = data?.recommendation ?? boot.recommendation;

  const pull = useCallback(
    async (light: boolean) => {
      const seq = ++applySeq.current;
      const apply = (r: { ok: boolean; models: ModelInfo[]; recommendation: Boot["recommendation"] }) => {
        if (r.ok && seq === applySeq.current)
          setData({ models: r.models, recommendation: r.recommendation });
      };
      try {
        apply(light ? await window.nido.modelsListLight() : await window.nido.modelsList());
      } catch {
        // La red de §5 del bloque del loop (H-LOOP-7): si la
        // invocación entera rechaza, la vista cae a la forma
        // ligera (que no paga el censo) antes de rendirse al
        // bootstrap, en vez de quedarse con él para siempre y
        // sin aviso con la promesa sin cazar. Si la ligera
        // también rechaza, la vista se queda con el bootstrap,
        // que ya trae su cuenta.
        if (light) return;
        try {
          apply(await window.nido.modelsListLight());
        } catch {
          /* sin red posible: manda el bootstrap */
        }
      }
    },
    [],
  );
  useEffect(() => {
    // Al montar llegan las dos formas (AU-1): la ligera
    // aterriza en milisegundos con las tarjetas vivas — si
    // hay una transferencia en curso empezada antes de
    // entrar, su fila entra en «downloading» y el sondeo se
    // arma — y la completa aterriza cuando la cola se
    // libera, con el censo fresco, que es su papel. Pedir
    // solo la completa dejaba a la vista recién montada con
    // la foto del arranque hasta que la transferencia
    // terminara, porque la completa espera tras la cola
    // serie que la descarga entera ocupa.
    void pull(true);
    void pull(false);
  }, [pull]);
  // El sondeo se arma también con el gesto en vuelo
  // (busy), no solo con la fila ya en «downloading»:
  // armarlo solo con la fila descubierta es el huevo y la
  // gallina de AU-1, porque la fila solo llega a decir
  // «downloading» si alguien lee el almacén vivo mientras
  // la transferencia corre, y el gesto es lo primero que
  // sabe que corre. La pierna cubre también la carga y el
  // descarte: son lecturas ligeras de solo lectura, sin
  // censo ni cola, inofensivas ahí y útiles en el
  // descarte, que sí espera tras la cola.
  const anyDownloading =
    busy !== null || models.some((m) => m.state === "downloading");
  useEffect(() => {
    if (!anyDownloading) return;
    const t = setInterval(() => void pull(true), 600);
    return () => clearInterval(t);
  }, [anyDownloading, pull]);

  const applyModels = (r: { models?: ModelInfo[] }, seq: number) => {
    // Con sello viejo, la vuelta es en silencio y entera
    // (AU-2): ni escribe los datos ni dispara el pull de la
    // rama sin modelos, porque una emisión más nueva ya
    // está en vuelo y traerá la verdad.
    if (seq !== applySeq.current) return;
    if (r.models) {
      setData((d) => ({
        models: r.models as ModelInfo[],
        recommendation: d?.recommendation ?? boot.recommendation,
      }));
    } else void pull(true);
  };
  const download = async (id: string) => {
    setBusy(id);
    const seq = ++applySeq.current;
    // La promesa se captura y la ligera se pide en el
    // acto, antes del await (AU-1): la llamada del canal
    // no responde hasta que la transferencia entera
    // termina, y esperar su asentamiento antes de leer
    // nada dejaba la fila en «sin descargar» durante
    // minutos, sin barra ni pausa. La semántica de
    // asentamiento no cambia: misma espera, mismo
    // applyModels al final. Es la forma del móvil
    // traducida a esta carcasa: allí el gesto pone la
    // fila en el almacén observable en síncrono; aquí,
    // la vista pide la foto viva del almacén del
    // principal en el mismo gesto.
    const pending = window.nido.modelDownload(id);
    void pull(true);
    const r = await pending;
    setBusy(null);
    applyModels(r, seq);
  };
  const discard = async (id: string) => {
    setBusy(id);
    const seq = ++applySeq.current;
    const r = await window.nido.modelDiscard(id);
    setBusy(null);
    applyModels(r, seq);
  };
  const load = async (id: string, retryLess: boolean) => {
    setBusy(id);
    const seq = ++applySeq.current;
    const r = retryLess ? await window.nido.modelLoadRetryLess(id) : await window.nido.modelLoad(id);
    setBusy(null);
    if (r.ok) {
      setLoadError(null);
      applyModels(r, seq);
      void refresh();
    } else setLoadError({ id, message: r.error ?? r.reason ?? "" });
  };

  const roleText = (role?: string): string => {
    switch (role) {
      case "light":
        return P("roleLight");
      case "balanced":
        return P("roleBalanced");
      case "strong":
        return P("roleStrong");
      case "fast-moe":
        return P("roleFastMoe");
      case "alternative":
        return P("roleAlternative");
      case "search":
        return P("roleSearch");
      default:
        return "";
    }
  };
  const stateText = (m: ModelInfo): string => {
    switch (m.state) {
      case "active":
        return P("stateActive");
      case "downloading":
        return P("stateDownloading");
      case "paused":
        return P("statePaused");
      case "partial":
        return P("statePartial");
      case "checking":
        return P("stateChecking");
      case "on-disk":
        return P("stateOnDisk");
      case "mismatch":
        return P("stateMismatch");
      case "not-downloaded":
        return P("modelNotInstalled");
      default:
        return m.resident ? P("modelReady") : m.installed ? fitText(m.fit, P) : P("modelNotInstalled");
    }
  };
  const errorText = (kind: string): string => {
    switch (kind) {
      case "network":
        return P("errorNetwork");
      case "integrity":
        return P("errorIntegrity");
      case "footprint":
        return P("errorFootprint");
      case "engine":
        return P("errorEngine");
      case "disk":
        return P("errorDisk");
      case "not-downloaded":
        return P("errorNotDownloaded");
      default:
        return kind;
    }
  };

  const llms = models.filter((m) => m.kind === "llm");
  const search = models.filter((m) => m.kind === "embedding");
  const resident = models.find((m) => m.resident);
  const detail = models.find((m) => m.id === selected) ?? null;
  // Con los datos del gestor en la mano, el recomendado de la
  // cabecera es el suyo (el de la clase de la máquina, el mismo
  // que lleva la insignia en la lista): una sola noción en la
  // superficie. El bootstrap solo cubre el primer instante.
  const recCard = data?.models.find((m) => m.recommended);
  const recLabel = recCard?.plainLabel ?? recommendation.plainLabel;
  const recFit = recCard?.fit ?? recommendation.fit;

  const actionButton = (m: ModelInfo) => {
    if (m.kind !== "llm") return null;
    const disabled = busy === m.id;
    switch (m.state) {
      case "active":
        return <span className="source-chip">{P("stateActive")}</span>;
      case "downloading":
        return (
          <button className="btn" onClick={() => void window.nido.modelDownloadPause(m.id)}>
            {P("actionPause")}
          </button>
        );
      case "paused":
      case "partial":
        return (
          <>
            <button className="btn" disabled={disabled} onClick={() => void download(m.id)}>
              {P("actionContinue")}
            </button>
            <button className="btn" disabled={disabled} onClick={() => void discard(m.id)}>
              {P("actionDiscard")}
            </button>
          </>
        );
      case "checking":
        return null;
      case "on-disk":
        return (
          <button className="btn primary" disabled={disabled} onClick={() => void load(m.id, false)}>
            {P("actionUse")}
          </button>
        );
      case "mismatch":
        return (
          <button className="btn" disabled={disabled} onClick={() => void download(m.id)}>
            {P("actionRedownload")}
          </button>
        );
      case "not-downloaded":
        return m.error ? (
          <button className="btn" disabled={disabled} onClick={() => void download(m.id)}>
            {P("actionRetry")}
          </button>
        ) : (
          <button className="btn" disabled={disabled} onClick={() => void download(m.id)}>
            {P("actionDownload")}
          </button>
        );
      default:
        return m.installed && !m.resident ? (
          <button className="btn primary" disabled={disabled} onClick={() => void load(m.id, false)}>
            {P("actionUse")}
          </button>
        ) : null;
    }
  };

  return (
    <>
      <div className="card">
        <h3>{P("machineTitle")}</h3>
        <div className="row-line">
          <span>{P("machineTotal")}</span>
          <span>{gb(recommendation.totalRamBytes)} GB</span>
        </div>
        <div className="row-line">
          <span>{P("machineUsable")}</span>
          <span>{gb(recommendation.budgetBytes)} GB</span>
        </div>
        <div className="row-line">
          <span>{P("recommendationTitle")}</span>
          <span>
            {recLabel} · {fitText(recFit, P)}
          </span>
        </div>
      </div>

      <div className="card">
        <h3>{P("models")}</h3>
        {llms.map((m) => (
          <div key={m.id} className="model-row">
            <button className="model-row-main" onClick={() => setSelected(m.id === selected ? null : m.id)}>
              <span className="model-row-title">
                {m.label}
                {(m.recommended ?? m.id === recommendation.modelId) && (
                  <span className="source-chip">{P("recommendationTitle")}</span>
                )}
              </span>
              <span className="model-row-meta">
                {gb(m.sizeBytes)} GB · {roleText(m.role)} · {m.license} · {stateText(m)}
              </span>
              <span className={`fit-badge fit-${m.fit}`}>{fitText(m.fit, P)}</span>
              {m.state === "on-disk" && resident && !m.resident && (
                <span className="model-row-note">{P("freesCurrent")}</span>
              )}
              {m.error && <span className="model-row-error">{errorText(m.error)}</span>}
            </button>
            {m.state === "downloading" && m.transfer && (
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, (m.transfer.downloadedBytes / m.transfer.totalBytes) * 100)}%`,
                  }}
                />
                <span className="progress-text">
                  {gb(m.transfer.downloadedBytes)} / {gb(m.transfer.totalBytes)} GB
                </span>
              </div>
            )}
            <div className="confirm-actions">{actionButton(m)}</div>
          </div>
        ))}
        {search.length > 0 && (
          <>
            <p className="model-row-note">{P("searchNote")}</p>
            {search.map((m) => (
              <div key={m.id} className="row-line">
                <span>
                  {m.label} · {gb(m.sizeBytes)} GB · {roleText(m.role)}
                </span>
                <span>{stateText(m)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {detail && (
        <div className="card">
          <h3>
            {P("detailTitle")} · {detail.label}
          </h3>
          {detail.note && <p>{detail.note}</p>}
          <div className="row-line">
            <span>{P("detailLicense")}</span>
            <span>{detail.license}</span>
          </div>
          {detail.breakdown && (
            <>
              <p>
                <strong>{P("detailMemory")}</strong>
              </p>
              <div className="row-line">
                <span>{P("detailWeights")}</span>
                <span>{gb(detail.breakdown.weights)} GB</span>
              </div>
              <div className="row-line">
                <span>
                  {P("detailKv")} · {detail.contextSize}
                </span>
                <span>{gb(detail.breakdown.kv)} GB</span>
              </div>
              <div className="row-line">
                <span>{P("detailCompute")}</span>
                <span>{gb(detail.breakdown.compute)} GB</span>
              </div>
              <div className="row-line">
                <span>{P("detailLogits")}</span>
                <span>{gb(detail.breakdown.logits)} GB</span>
              </div>
              <div className="row-line">
                <span>{P("detailTotal")}</span>
                <span>{gb(detail.breakdown.total)} GB</span>
              </div>
              {detail.budgetBytes != null && (
                <div className="row-line">
                  <span>{P("detailBudget")}</span>
                  <span>{gb(detail.budgetBytes)} GB</span>
                </div>
              )}
            </>
          )}
          {detail.degradation === "step-down" && (
            <p>{fill(P("degradeStep"), { context: detail.contextSize ?? 0 })}</p>
          )}
          {detail.degradation === "floor-q8" && <p>{P("degradeFloor")}</p>}
        </div>
      )}

      {loadError && (
        <div className="card">
          <p>
            <strong>{P("loadErrorTitle")}</strong>
          </p>
          <p>{P("loadErrorBody")}</p>
          {loadError.message && <p className="mono-box">{loadError.message}</p>}
          <div className="confirm-actions">
            <button className="btn" onClick={() => void load(loadError.id, false)}>
              {P("loadErrorRetry")}
            </button>
            <button className="btn" onClick={() => void load(loadError.id, true)}>
              {P("loadErrorRetryLess")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function AboutTab({ boot, goLibrary }: { boot: Boot; goLibrary: () => void }) {
  const s = boot.strings as Strings;
  const A = (k: string) => lookup(s, "aboutScreen", k);
  const P = (k: string) => lookup(s, "pcSurface", k);
  const about = boot.about;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, mark: string) => {
    await window.nido.copyText(text);
    setCopied(mark);
  };
  return (
    <>
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <img src="/mascot-nido.png" alt="" width={120} height={120} />
        <h2>NIDO</h2>
        <p>{A("heroSubtitle")}</p>
        <span className="source-chip">
          {fill(A("versionBadge"), { version: about.version, build: about.build })}
        </span>
      </div>
      <div className="card">
        <h3>{A("repoTitle")}</h3>
        <p>{A("repoBody")}</p>
        <p>{about.copyrightLine}</p>
        <button className="mono-box" onClick={() => void window.nido.openExternal(about.repoOpenUrl)}>
          {about.repoUrl}
        </button>
        <h3>{A("licensesTitle")}</h3>
        <p>{A("licensesBody")}</p>
        <p style={{ color: "var(--muted)" }}>{P("licensesOpenNote")}</p>
        {/* E8 (paso 9, §9): el trato honesto de los avisos en
            un PC, también en el Acerca de. */}
        <h3>{A("noticesTitle")}</h3>
        <p>{A("noticesBody")}</p>
      </div>
      <div className="card">
        <h3>{A("developmentTitle")}</h3>
        <p>{A("developmentBody")}</p>
        <span className="section-label">{A("developmentSolanaLabel")}</span>
        <button className="mono-box" onClick={() => void copy(about.solanaAddress, "sol")}>
          {about.solanaAddress}
        </button>
        <span className="section-label">{A("developmentBaseLabel")}</span>
        <button className="mono-box" onClick={() => void copy(about.baseAddress, "base")}>
          {about.baseAddress}
        </button>
        <div className="confirm-actions">
          <button className="btn" onClick={() => void copy(about.solanaAddress, "sol")}>
            {A("developmentCopy")} · Solana
          </button>
          <button className="btn" onClick={() => void copy(about.baseAddress, "base")}>
            {A("developmentCopy")} · Base
          </button>
        </div>
        {copied && <p>{A("developmentCopied")}</p>}
      </div>
      <div className="card">
        <p>{about.salvoraNote}</p>
      </div>
      <div className="card">
        <h3>{A("reportTitle")}</h3>
        <p>{A("reportBody")}</p>
        <pre className="mono-box" style={{ whiteSpace: "pre-wrap" }}>
          {about.report}
        </pre>
        <div className="confirm-actions">
          <button className="btn" onClick={() => void copy(about.report, "report")}>
            {A("reportCopy")}
          </button>
          <button className="btn" onClick={() => void window.nido.openExternal(about.reportOpenUrl)}>
            {A("reportOpen")}
          </button>
        </div>
        {copied === "report" && <p>{A("reportCopied")}</p>}
      </div>
      <div className="card">
        <h3>{A("mobileTitle")}</h3>
        <p>{A("mobileBody")}</p>
        {about.mobileCardUrl && (
          <button className="btn" onClick={() => void window.nido.openExternal(about.mobileCardUrl as string)}>
            {A("mobileOpen")}
          </button>
        )}
      </div>
      <button className="btn" onClick={goLibrary}>
        {A("guideLink")}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------
// P-7 · La paleta
// ---------------------------------------------------------------------

function Palette({
  boot,
  close,
  go,
  openSettings,
  canWrite,
  runAction,
  openGuide,
  openPack,
}: {
  boot: Boot;
  close: () => void;
  go: (sec: Section, convId?: string) => void;
  openSettings: (tab: string) => void;
  canWrite: boolean;
  runAction: (id: string) => void;
  openGuide: (lessonId: string) => void;
  openPack: () => void;
}) {
  const s = boot.strings as Strings;
  const P = (k: string) => lookup(s, "pcSurface", k);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // E11 (paleta M-2): el índice se compone en la pieza
  // (paleta.ts) desde las mismas fuentes de las demás
  // superficies: las acciones salen de la hoja de atajos
  // (con su pista en la posición vigente), las secciones
  // de la barra real, las pestañas sin gemela de sección
  // (con la de voz, que la semilla no listaba), las
  // lecciones del árbol de la guía y los paquetes de la
  // biblioteca. La búsqueda es la léxica de la pieza.
  const tabNames: Record<string, string> = {
    security: P("security"),
    tone: lookup(s, "personalitySettings", "title"),
    models: P("models"),
    knowledge: P("packsTab"),
    appearance: P("appearance"),
    language: P("language"),
    voice: lookup(s, "voiceSettings", "title"),
    memory: P("navMemory"),
    notices: lookup(s, "noticesSettings", "title"),
    about: P("about"),
  };
  const guideTree = (s as Record<string, unknown>).guide as GuideTree | undefined;
  const bootLibrary = (
    boot as Boot & {
      library?: { packs: { id: string; name: string; outdated: boolean }[]; factCount: number };
    }
  ).library;
  const composed = composePaletteItems({
    sections: NAV.map((n) => ({ id: n.id, label: P(n.key), icon: n.icon })),
    conversations: boot.conversations.map((c) => ({
      id: c.id,
      title: c.title || P("untitledChat"),
    })),
    settingsTabs: SETTINGS_TABS.map((t) => ({ id: t, label: tabNames[t] ?? t })),
    actions: shortcutSheetRows(boot.sendOnEnter ?? true)
      .filter((r) => r.inPalette)
      .map((r) => ({ id: r.id, label: P(r.labelKey), hint: r.keys })),
    lessons: (guideTree?.modules ?? []).flatMap((m) =>
      m.lessons.map((l) => ({ id: l.id, title: l.title })),
    ),
    packs: bootLibrary
      ? bootLibrary.packs.map((p) => ({ id: p.id, name: p.name }))
      : PACK_CATALOG.map((p) => ({ id: p.id, name: p.label })),
    vaultUnlocked: boot.vault.unlocked,
  });
  const found = searchPaletteItems(composed, query);
  const iconFor = (it: PaletteItem): string => {
    switch (it.cls) {
      case "section":
        return NAV.find((n) => n.id === it.target)?.icon ?? "menu";
      case "conversation":
        return "chat";
      case "settings":
        return "settings";
      case "guide":
        return "ideas";
      case "pack":
        return "knowledge";
      default:
        return "compass";
    }
  };
  const items = found.map((it) => ({
    key: it.key,
    label: it.label,
    hint: it.hint,
    icon: iconFor(it),
    run: () => {
      switch (it.cls) {
        case "action":
          runAction(it.target);
          close();
          break;
        case "section":
          go(it.target as Section);
          break;
        case "conversation":
          go("chat", it.target);
          break;
        case "settings":
          openSettings(it.target);
          close();
          break;
        case "guide":
          openGuide(it.target);
          break;
        case "pack":
          openPack();
          break;
      }
    },
  }));
  const idx = Math.min(active, Math.max(0, items.length - 1));
  return (
    <div className="palette-veil" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder={P("palettePlaceholder")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(idx + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(idx - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); items[idx]?.run(); }
          }}
        />
        {items.map((it, i) => (
          <button key={it.key} className={"palette-item" + (i === idx ? " active" : "")} onMouseEnter={() => setActive(i)} onClick={it.run}>
            <Icon name={it.icon} size={20} /> {it.label}
            {it.hint && <span className="palette-hint">{it.hint}</span>}
          </button>
        ))}
        {items.length === 0 && <p style={{ color: "var(--muted)" }}>{P("paletteEmpty")}</p>}
        {canWrite && (
          <button
            className="btn"
            onClick={() => {
              go("chat");
              setTimeout(() => {
                document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
              }, 50);
            }}
          >
            {P("goToWrite")}
          </button>
        )}
      </div>
    </div>
  );
}
