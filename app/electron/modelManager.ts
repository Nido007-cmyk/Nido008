/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El servicio gestor de modelos del proceso principal (E4,
 * paso 5): la cola serial por la que pasa toda operación
 * sobre los modelos (descargar, descartar, activar,
 * refrescar), el residente con su crédito, y el estado
 * honesto del que la superficie deriva sus tarjetas. Vive
 * en el proceso principal y consume la copia sincronizada
 * del núcleo (app/electron/core/), nunca la raíz.
 *
 * Lo que cobra, con su partida:
 *
 *   - Cola serial única y deduplicación por id (D-6):
 *     encolar una descarga de un id con transferencia viva
 *     devuelve la transferencia existente; dos activaciones
 *     nunca se pisan: la segunda carga empieza después de
 *     que la primera descarga al residente anterior.
 *   - El residente con su crédito: la foto con la que se
 *     derivan las tarjetas trae el conjunto de trabajo del
 *     residente como liberable (machineSnapshot), para que
 *     su tarjeta no se juzgue apilada sobre sí mismo.
 *   - Error de carga con reintento de peldaño: si la carga
 *     al contexto del plan falla, se reintenta una sola vez
 *     en el peldaño inferior; el doble fallo deja la tarjeta
 *     en estado de error con su causa.
 *   - El mapa de errores (D-8.2): los errores crudos (el
 *     TypeError de red, el ENOENT) no llegan a la superficie:
 *     se clasifican en causas honestas (red, integridad,
 *     huella de memoria, motor, disco, no descargado). Y el
 *     gestor crea el directorio de modelos al abrir: el
 *     ENOENT crudo de la sonda c18 no vuelve a existir.
 *   - La vigilancia de RSS del instrumento M-02 y el
 *     reciclado de su disparador firmado (apertura §3.3):
 *     residuo acumulado ≥ 256 MiB sobre la base en frío Y
 *     al menos 4 cambios desde el arranque o el último
 *     reciclado ⇒ en la siguiente activación (perezoso,
 *     nunca durante una generación) el residente se
 *     descarga y la base se re-mide. M-02 queda
 *     instrumentada y abierta, no cerrada.
 *
 * Las dependencias se inyectan (deps) para que su batería
 * corra sin red, sin disco y sin motor nativo; la forma de
 * producción cablea las piezas reales del núcleo.
 */

import { mkdir } from "node:fs/promises";
import { DESKTOP_CATALOG, type CatalogEntry } from "./core/catalog.js";
import {
  discardDownload,
  downloadModel,
  DownloadPaused,
  type DownloadOptions,
  type DownloadResult,
} from "./core/download.js";
import { LocalEngine } from "./core/engine.js";
import { censusModels, type DiskState } from "./core/library.js";
import { LoadRefusal } from "./core/loadPath.js";
import { canonicalBudgetBytes, machineSnapshot } from "./core/machine.js";
import { deriveCards, type ModelCard, type ModelTransfer } from "./core/modelCards.js";
import {
  estimateWorkingSet,
  MIN_CONTEXT,
  planDesktopContext,
  type MachineSnapshot,
} from "./core/ram.js";

/** Lo que el gestor necesita de un motor cargado. */
export interface EngineLike {
  unload(): Promise<void>;
  countTokens(text: string): number;
  /**
   * El contexto real con el que cargó, cuando el motor lo
   * sabe por su cuenta (la fachada de la carcasa planea el
   * suyo): manda sobre el pedido para la huella del residente.
   */
  contextSize?: number;
}

/** La causa honesta de un error de tarjeta (mapa D-8.2). */
export type CardErrorKind =
  | "network"
  | "integrity"
  | "footprint"
  | "engine"
  | "disk"
  | "not-downloaded";

export interface CardError {
  kind: CardErrorKind;
  message: string;
}

export interface ModelManagerDeps {
  loadEngine: (entry: CatalogEntry, contextSize: number) => Promise<EngineLike>;
  download: (entry: CatalogEntry, opts: DownloadOptions) => Promise<DownloadResult>;
  discard: (entry: CatalogEntry) => Promise<void>;
  census: () => Promise<Map<string, DiskState>>;
  snapshot: () => MachineSnapshot;
  rssBytes: () => number;
  /**
   * M-02-P: el asiento de la lectura de la válvula. Se invoca en el
   * único sitio donde la válvula dispara, con la lectura ANTERIOR
   * a la re-medición de la base y el contador ya sumado. Opcional:
   * sin cablear, el gestor se comporta exactamente como siempre.
   */
  onRecycle?: (info: { coldBaseRssBytes: number; residueBytes: number; switches: number; recycledCount: number }) => void;
}

/** El disparador firmado de la válvula M-02 (apertura §3.3). */
export const RECYCLE_RESIDUE_BYTES = 256 * 1024 * 1024;
export const RECYCLE_MIN_SWITCHES = 4;

interface Resident {
  entry: CatalogEntry;
  engine: EngineLike;
  contextSize: number;
  /** Su conjunto de trabajo: el crédito liberable de la foto. */
  footprintBytes: number;
}

/** El peldaño inferior de la escalera de contextos (potencias de dos hasta el mínimo). */
function nextLowerContext(contextSize: number): number {
  let rung = MIN_CONTEXT;
  while (rung * 2 < contextSize) rung *= 2;
  return rung;
}

export function classifyError(err: unknown): CardError {
  if (err instanceof LoadRefusal) {
    return { kind: "integrity", message: err.message };
  }
  if (err instanceof TypeError) {
    return { kind: "network", message: err.message };
  }
  const code = (err as { code?: unknown })?.code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return { kind: "disk", message: err instanceof Error ? err.message : String(err) };
  }
  return { kind: "engine", message: err instanceof Error ? err.message : String(err) };
}

export class ModelManager {
  private readonly modelsDir: string;
  private readonly deps: ModelManagerDeps;
  private tail: Promise<unknown> = Promise.resolve();
  private census = new Map<string, DiskState>();
  private resident: Resident | null = null;
  private transfers = new Map<string, ModelTransfer>();
  private inFlightDownloads = new Map<string, Promise<DownloadResult>>();
  private downloadAborts = new Map<string, AbortController>();
  /** La compuerta de arranque de la cura §6: la arma la pausa y la desarma una petición nueva. */
  private downloadsHalted = false;
  private errors = new Map<string, CardError>();
  private coldBaseRssBytes = 0;
  private switches = 0;
  private recycledCount = 0;

  private constructor(modelsDir: string, deps: ModelManagerDeps) {
    this.modelsDir = modelsDir;
    this.deps = deps;
  }

  static async open(
    modelsDir: string,
    deps?: Partial<ModelManagerDeps>,
  ): Promise<ModelManager> {
    const full: ModelManagerDeps = {
      loadEngine: (entry, contextSize) => LocalEngine.load(modelsDir, entry, contextSize),
      download: (entry, opts) => downloadModel(entry, modelsDir, opts),
      discard: (entry) => discardDownload(entry, modelsDir),
      // El censo del gestor es el de post-descarga: verifica
      // huellas. Con el censo de escaneo (sin huella), toda
      // tarjeta saldría «no coincide» sin que nada haya
      // fallado: la distinción de la hoja §3.2 existe para
      // quien escanea, y el gestor no escanea, cobra.
      census: () => censusModels(modelsDir, { verifyHashes: true }),
      snapshot: () => machineSnapshot(),
      rssBytes: () => process.memoryUsage().rss,
      ...deps,
    };
    // D-8.2: el gestor crea el directorio al abrir; el ENOENT
    // crudo contra un directorio que nadie creó no existe.
    await mkdir(modelsDir, { recursive: true });
    const manager = new ModelManager(modelsDir, full);
    manager.coldBaseRssBytes = full.rssBytes();
    await manager.refreshNow();
    return manager;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(op);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private entry(id: string): CatalogEntry {
    const entry = DESKTOP_CATALOG.find((e) => e.id === id);
    if (!entry) throw new Error(`model manager: «${id}» no es un modelo del catálogo`);
    return entry;
  }

  /** La foto con el crédito del residente, la de las tarjetas. */
  private photo(): MachineSnapshot {
    const base = this.deps.snapshot();
    return machineSnapshot(this.resident?.footprintBytes, {
      totalRamBytes: () => base.totalRamBytes,
      freeRamBytes: () => base.freeRamBytes,
    });
  }

  /** Las tarjetas derivadas del estado de ahora mismo. */
  cards(): ModelCard[] {
    const base = this.deps.snapshot();
    return deriveCards({
      snapshot: this.photo(),
      canonicalBudget: canonicalBudgetBytes(base.totalRamBytes),
      census: this.census,
      residentId: this.resident?.entry.id ?? null,
      transfers: this.transfers,
    });
  }

  residentId(): string | null {
    return this.resident?.entry.id ?? null;
  }

  errorFor(id: string): CardError | null {
    return this.errors.get(id) ?? null;
  }

  /** El instrumento M-02: su lectura, para la pasada y el cierre. */
  recycleInfo(): { coldBaseRssBytes: number; residueBytes: number; switches: number; recycledCount: number } {
    return {
      coldBaseRssBytes: this.coldBaseRssBytes,
      residueBytes: Math.max(0, this.deps.rssBytes() - this.coldBaseRssBytes),
      switches: this.switches,
      recycledCount: this.recycledCount,
    };
  }

  /** Disparador de refresco: re-censar (tras una descarga, un descarte, un borrado externo). */
  refresh(): Promise<void> {
    return this.enqueue(() => this.refreshNow());
  }

  private async refreshNow(): Promise<void> {
    this.census = await this.deps.census();
  }

  /**
   * Descargar un modelo. D-6: si ya hay una transferencia
   * viva de este id, se devuelve esa misma; no nace una
   * segunda.
   */
  download(id: string): Promise<DownloadResult> {
    // Una petición nueva desarma la compuerta de arranque
    // (cura §6): toda llamada llega del canal
    // nido:model-download, que cobra la sesión antes de
    // llegar al gestor, así que una petición en sesión viva
    // es la palabra que desarma; con la bóveda bloqueada
    // ninguna llamada llega aquí y la compuerta no se
    // desarma en silencio a mitad de un bloqueo.
    this.downloadsHalted = false;
    const existing = this.inFlightDownloads.get(id);
    if (existing) return existing;
    const promise = this.enqueue(() => this.downloadNow(id));
    this.inFlightDownloads.set(id, promise);
    const clear = () => {
      if (this.inFlightDownloads.get(id) === promise) this.inFlightDownloads.delete(id);
    };
    promise.then(clear, clear);
    return promise;
  }

  /** Pausar la descarga viva de un id: su `.part` se queda para continuar. */
  pauseDownload(id: string): void {
    this.downloadAborts.get(id)?.abort();
  }

  /**
   * Pausar todas las descargas vivas, por el mismo mecanismo de
   * la pausa (el AbortController de cada una): es la mitad del
   * gestor de la cura del bloqueo a mitad de descarga. Cada
   * transferencia se asienta como pausada con sus bytes contados,
   * como si la persona hubiera pulsado pausar en cada tarjeta.
   */
  pauseAllDownloads(): void {
    // La compuerta de arranque de la cura §6: la pausa también
    // arma el alto de arranques. Su único llamante de
    // producción es el bloqueo, así que la compuerta queda
    // armada exactamente por el bloqueo y por ningún otro
    // gesto: la descarga que aún no arrancó cuando la pausa
    // llega no tiene controlador que abortar, y sin compuerta
    // arrancaría después y correría entera por delante de la
    // desactivación que el bloqueo espera.
    this.downloadsHalted = true;
    for (const controller of this.downloadAborts.values()) controller.abort();
  }

  private async downloadNow(id: string): Promise<DownloadResult> {
    const entry = this.entry(id);
    this.errors.delete(id);
    this.transfers.set(id, { downloadedBytes: 0, paused: false });
    let lastProgress = 0;
    let controller: AbortController | undefined;
    try {
      // La compuerta de arranque (cura §6) se cobra primero,
      // antes de crear el controlador y de invocar la
      // transferencia: si el bloqueo la armó, esta descarga se
      // asienta pausada con 0 bytes por el catch de siempre,
      // la misma forma que una pausa real, y su `.part` ni
      // nace. Ninguna forma nueva de asentamiento se inventa.
      if (this.downloadsHalted) throw new DownloadPaused(id);
      controller = new AbortController();
      this.downloadAborts.set(id, controller);
      const result = await this.deps.download(entry, {
        signal: controller.signal,
        onProgress: (downloadedBytes) => {
          lastProgress = downloadedBytes;
          this.transfers.set(id, { downloadedBytes, paused: false });
        },
      });
      this.transfers.delete(id);
      await this.refreshNow();
      return result;
    } catch (err) {
      this.transfers.delete(id);
      if (err instanceof DownloadPaused) {
        // La pausa deja la transferencia visible como pausada,
        // con los bytes contados hasta el corte, no como error.
        this.transfers.set(id, { downloadedBytes: lastProgress, paused: true });
        throw err;
      }
      this.errors.set(id, classifyError(err));
      throw err;
    } finally {
      if (controller && this.downloadAborts.get(id) === controller) this.downloadAborts.delete(id);
    }
  }

  /** Descartar la descarga a medias de un modelo: solo su `.part`. */
  discard(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.deps.discard(this.entry(id));
      this.transfers.delete(id);
      this.errors.delete(id);
      await this.refreshNow();
    });
  }

  /** Activar un modelo: pasa a ser el residente, liberando al anterior. */
  activate(id: string): Promise<void> {
    return this.enqueue(() => this.activateNow(id));
  }

  private async activateNow(id: string): Promise<void> {
    const entry = this.entry(id);
    if (this.resident?.entry.id === id) return;
    this.errors.delete(id);

    // La válvula M-02, perezosa en la activación: nunca
    // durante una generación (el gestor no genera; activa).
    const residue = this.deps.rssBytes() - this.coldBaseRssBytes;
    if (this.switches >= RECYCLE_MIN_SWITCHES && residue >= RECYCLE_RESIDUE_BYTES) {
      // M-02-P: la lectura del evento es la anterior a la
      // re-medición (la que recycleInfo() habría dado un instante
      // antes), con recycledCount ya sumado.
      const info = {
        coldBaseRssBytes: this.coldBaseRssBytes,
        residueBytes: Math.max(0, residue),
        switches: this.switches,
        recycledCount: this.recycledCount + 1,
      };
      await this.unloadResident();
      this.coldBaseRssBytes = this.deps.rssBytes();
      this.switches = 0;
      this.recycledCount += 1;
      this.deps.onRecycle?.(info);
    }

    const state = this.census.get(id);
    if (state?.kind !== "installed") {
      const error: CardError = {
        kind: "not-downloaded",
        message: `«${entry.label}» aún no está descargado: la activación no descarga en silencio.`,
      };
      this.errors.set(id, error);
      throw new Error(error.message);
    }

    // El plan se juzga contra la foto con el crédito del
    // residente saliente: su memoria vuelve al cambiar, que
    // es exactamente lo que esta activación hace.
    const outgoingFootprint = this.resident?.footprintBytes;
    await this.unloadResident();
    const base = this.deps.snapshot();
    const photo = machineSnapshot(outgoingFootprint, {
      totalRamBytes: () => base.totalRamBytes,
      freeRamBytes: () => base.freeRamBytes,
    });
    const plan = planDesktopContext(entry, photo);
    if (!plan || plan.fit === "red") {
      const error: CardError = {
        kind: "footprint",
        message: `«${entry.label}» no cabe en la memoria de esta máquina ni en su contexto mínimo.`,
      };
      this.errors.set(id, error);
      throw new Error(error.message);
    }

    let engine: EngineLike;
    let contextSize = plan.contextSize;
    try {
      engine = await this.deps.loadEngine(entry, contextSize);
    } catch {
      // Reintento de peldaño: una sola vez, en el peldaño inferior.
      const lower = nextLowerContext(contextSize);
      if (lower >= contextSize) {
        const error: CardError = {
          kind: "engine",
          message: `«${entry.label}» no cargó en su contexto mínimo.`,
        };
        this.errors.set(id, error);
        throw new Error(error.message);
      }
      contextSize = lower;
      try {
        engine = await this.deps.loadEngine(entry, contextSize);
      } catch (err) {
        const error = classifyError(err);
        this.errors.set(id, error);
        throw err;
      }
    }

    const realContext = engine.contextSize ?? contextSize;
    this.resident = {
      entry,
      engine,
      contextSize: realContext,
      footprintBytes: estimateWorkingSet(entry, realContext).totalBytes,
    };
    this.switches += 1;
  }

  /** Descargar el residente actual, si lo hay. */
  deactivate(): Promise<void> {
    return this.enqueue(() => this.unloadResident());
  }

  private async unloadResident(): Promise<void> {
    const resident = this.resident;
    this.resident = null;
    if (resident) await resident.engine.unload();
  }
}
