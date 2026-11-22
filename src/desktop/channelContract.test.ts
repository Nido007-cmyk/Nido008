/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Censo del contrato de canales IPC (tanda 14, auditorías de la
 * carcasa y del §8.9): el contrato vive en tres sitios — el preload
 * que invoca/envía/escucha, los manejadores del proceso principal
 * (services.ts y la carcasa) y el tipo del puente en el renderer —
 * y ninguna batería lo nombraba. Este censo lee los ficheros reales
 * como texto y afirma las dos direcciones: todo canal que el
 * preload toca está atendido o emitido en el principal, y todo
 * canal atendido en el principal es invocado por el preload (sin
 * manejadores huérfanos). La prueba de persistencia de producción
 * del §8.9 es otra pieza (acto 6, sobre el paquete); este censo es
 * la guarda estática del contrato.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const preload = read("../../app/electron/preload.ts");
const indexSrc = read("../../app/electron/index.ts");
const appSrc = read("../../app/src/App/App.tsx");
const mainSrc =
  read("../../app/electron/services.ts") +
  "\n" +
  indexSrc +
  "\n" +
  read("../../app/electron/shell.ts") +
  "\n" +
  // E8 (paso 6): la carcasa de avisos emite nido:notices-show
  // desde noticeShell.ts; el censo la lee como parte del
  // principal, que es donde vive.
  read("../../app/electron/noticeShell.ts");

const grab = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]);

const invoked = new Set(grab(preload, /ipcRenderer\.invoke\("([^"]+)"/g));
const sent = new Set(grab(preload, /ipcRenderer\.send\("([^"]+)"/g));
const listened = new Set(grab(preload, /ipcRenderer\.on\("([^"]+)"/g));
const handled = new Set([
  ...grab(mainSrc, /\bhandle\("([^"]+)"/g),
  ...grab(mainSrc, /ipcMain\.handle\("([^"]+)"/g),
]);
const onMain = new Set(grab(mainSrc, /ipcMain\.on\("([^"]+)"/g));
const emitted = new Set(grab(mainSrc, /\.send\("([^"]+)"/g));

describe("IPC channel contract census (tanda 14)", () => {
  it("the preload surface is the signed one (50 invokes, 2 sends, 7 listeners)", () => {
    // Re-firmado en E4 (paso 6): la superficie del gestor
    // añadió tres canales (model-download, model-download-pause
    // y model-discard); modelsListLight reusa models-list.
    // Re-firmado en E5 (paso 8): la sección de paquetes añadió
    // cuatro canales (packs-list, pack-install, pack-import-path
    // y pack-remove).
    // Re-firmado en la pasada de la guía: las marcas de visto
    // de «Aprende» añaden un canal (guide-mark).
    // Re-firmado en E6 (paso 7): la importación de documentos
    // añade un canal (documents-import); docFilePath resuelve
    // la ruta por webUtils, sin invocación.
    // Re-firmado en E6 (paso 8): la Biblioteca de documentos
    // añade cuatro canales (documents-list,
    // documents-set-active, documents-delete y
    // documents-export).
    // Re-firmado en el bloque del loop (§2, H-LOOP-5): la
    // lista de la memoria añade dos canales (memory-list y
    // memory-delete).
    // Re-firmado en el bloque de cableado (B-1): el lector
    // de guías añade dos canales (pack-guides y
    // pack-guide-read) y la frescura de la tarjeta de
    // paquetes el suyo (library-data).
    // Re-firmado en el bloque de cableado (clúster de
    // Biblioteca, B-5): se retira about-data, el canal sin
    // llamante cuya fuente el bootstrap ya sirve.
    // Re-firmado en E7 (paso 6): la sección Agenda añade
    // cinco canales (agenda-data, agenda-event-save,
    // agenda-event-delete, agenda-contact-save y
    // agenda-contact-delete).
    // Re-firmado en E8 (paso 4): las acciones del aviso
    // interno añaden un canal (notice-act); la lista de
    // avisos viaja en la carga extendida de agenda-data.
    // Re-firmado en E8 (paso 8): las tareas programadas
    // añaden tres canales (tasks-list, tasks-save y
    // tasks-delete) para su tarjeta de Ajustes.
    // Re-firmado en E9 (paso 1): la espina de escucha añade
    // tres canales (voice-engine-state, voice-dictation-start
    // y voice-dictation-stop), un envío de audio sin
    // respuesta (voice-dictation-audio) y un evento de
    // dictado (voice-event).
    // Re-firmado en E9 (paso 2): la lectura añade tres
    // canales (voice-speak-state, voice-synth y
    // voice-speak-release).
    // Re-firmado en E9 (paso 5): la tarjeta de activos de
    // voz añade dos canales (voice-assets y
    // voice-asset-install) y un evento de progreso
    // (voice-asset-progress).
    expect(invoked.size).toBe(50);
    expect(sent).toEqual(new Set(["nido:confirm-response", "nido:voice-dictation-audio"]));
    // Re-firmado en E8 (paso 6): el clic de la notificación
    // del sistema y las acciones de la bandeja emiten
    // nido:notices-show hacia el renderizador.
    expect(listened).toEqual(
      new Set(["nido:turn-token", "nido:turn-phase", "nido:confirm-request", "nido:vault-locked", "nido:notices-show", "nido:voice-event", "nido:voice-asset-progress"]),
    );
  });

  it("every channel the preload invokes is handled in the main process", () => {
    const orphans = [...invoked].filter((c) => !handled.has(c));
    expect(orphans).toEqual([]);
  });

  it("every handled channel is invoked by the preload (no orphan handlers)", () => {
    const orphans = [...handled].filter((c) => !invoked.has(c));
    expect(orphans).toEqual([]);
  });

  it("the confirm-response send has its ipcMain.on, and every listened event is emitted in main", () => {
    for (const c of sent) expect(onMain.has(c), c).toBe(true);
    const silent = [...listened].filter((c) => !emitted.has(c));
    expect(silent).toEqual([]);
  });

  it("every handler is registered exactly once (R-3)", () => {
    const registrations = grab(mainSrc, /(?:ipcMain\.)?handle\("([^"]+)"/g).length;
    expect(registrations).toBe(handled.size);
    const onRegistrations = grab(mainSrc, /ipcMain\.on\("([^"]+)"/g).length;
    expect(onRegistrations).toBe(onMain.size);
  });

  it("the renderer's bridge type names exactly the members the preload exposes (R-1)", () => {
    const exposedBlock = preload.slice(preload.indexOf("exposeInMainWorld"));
    const exposed = new Set(grab(exposedBlock, /^\s{4}(\w+):/gm));
    // The interface block, cut by brace counting (its return types
    // carry nested braces, so a naive first-} cut truncates it).
    const start = appSrc.indexOf("interface NidoBridge");
    let depth = 0;
    let end = start;
    for (; end < appSrc.length; end++) {
      if (appSrc[end] === "{") depth++;
      else if (appSrc[end] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const typeBlock = appSrc.slice(start, end + 1);
    const typed = new Set(grab(typeBlock, /^\s{2}(\w+)\(/gm));
    // 21 → 25 en E4 (paso 6): modelsListLight, modelDownload,
    // modelDownloadPause y modelDiscard.
    // 25 → 29 en E5 (paso 8): packsList, packInstall,
    // packImportPick y packRemove.
    // 29 → 30 en E5 (paso 8, cura de la pasada): el selector del
    // sistema operativo sale del paquete por el censo D-1 del
    // endurecimiento; packImportPick se sustituye por
    // packImportPath (el mismo canal de invocación, otro nombre)
    // y packFilePath (la resolución de ruta de webUtils, sin
    // invocación: los invokes quedan en 23).
    // 30 → 31 en la pasada de la guía: guideMark.
    // 31 → 33 en E6 (paso 7): documentsImport y docFilePath,
    // la puerta de los documentos personales.
    // 33 → 37 en E6 (paso 8): documentsList, documentsSetActive,
    // documentsDelete y documentsExport, la Biblioteca.
    // 37 → 39 en el bloque del loop (§2, H-LOOP-5): memoryList
    // y memoryDelete, la lista de la memoria.
    // 39 → 42 en el bloque de cableado (B-1): packGuides,
    // packGuideRead y libraryData, el lector de guías y la
    // frescura de la tarjeta de paquetes.
    // 42 → 41 en el bloque de cableado (clúster de
    // Biblioteca, B-5): sale aboutData, retirado entero
    // (manejador, puente y miembro del tipo) por sin
    // llamante: el Acerca de lee boot.about, que el
    // bootstrap compone con la misma función del núcleo.
    // 41 → 46 en E7 (paso 6): agendaData, agendaEventSave,
    // agendaEventDelete, agendaContactSave y
    // agendaContactDelete, la sección Agenda.
    // 46 → 47 en E8 (paso 4): noticeAct, las acciones del
    // aviso interno (hecho, posponer, reprogramar, descartar).
    // 47 → 48 en E8 (paso 6): onNoticesShow, el «enseña la
    // vista» de la carcasa (clic de notificación y bandeja).
    // 48 → 51 en E8 (paso 8): tasksList, tasksSave y
    // tasksDelete, la tarjeta de tareas programadas.
    // 51 → 56 en E9 (paso 1): voiceEngineState,
    // voiceDictationStart, voiceDictationStop,
    // voiceDictationAudio y onVoiceEvent, la espina de
    // escucha.
    // 56 → 59 en E9 (paso 2): voiceSpeakState, voiceSynth y
    // voiceSpeakRelease, la lectura.
    // 59 → 62 en E9 (paso 5): voiceAssets, voiceAssetInstall
    // y onVoiceAssetProgress, la tarjeta de activos de voz.
    expect(exposed.size).toBe(62);
    expect([...typed].sort()).toEqual([...exposed].sort());
  });

  it("services install before the shell boots (R-2)", () => {
    const install = indexSrc.indexOf("await installServices()");
    const boot = indexSrc.indexOf("bootShell(");
    expect(install).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(install);
  });
});
