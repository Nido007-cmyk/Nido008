import {ipcRenderer, contextBridge, webUtils} from "electron";

// Puente mínimo y nombrado (cierres D-2 y D-3 de la auditoría de
// ataque 3). El scaffold exponía el objeto ipcRenderer entero, y
// sus métodos on/off DEVOLVÍAN el propio ipcRenderer: cualquier
// lista de canales quedaba anulada si el puente proxificaba ese
// objeto devuelto. Aquí no se expone ipcRenderer en ninguna forma:
// la superficie del renderizador son funciones con nombre, una
// por gesto, que invocan los canales nombrados de la carcasa y de
// los servicios (tanda 14: la bóveda con su registro §8.9, el
// turno, los modelos, los ajustes y el Acerca de). Los oyentes
// devuelven solo su función de baja, que no devuelve nada. La vía
// de modelos del scaffold (su RPC por birpc) se retiró entera con
// el censo de herencia: esta ventana no carga modelos; el único
// cargador de la app es el núcleo de la casa en el proceso
// principal.
contextBridge.exposeInMainWorld("nido", {
    checkForUpdates: () => ipcRenderer.invoke("nido:check-for-updates"),
    bootstrap: () => ipcRenderer.invoke("nido:bootstrap"),
    vaultCreate: (password: string) => ipcRenderer.invoke("nido:vault-create", {password}),
    vaultUnlock: (password: string) => ipcRenderer.invoke("nido:vault-unlock", {password}),
    vaultLock: () => ipcRenderer.invoke("nido:vault-lock"),
    prefsSet: (patch: unknown) => ipcRenderer.invoke("nido:prefs-set", {patch}),
    turnSend: (args: unknown) => ipcRenderer.invoke("nido:turn-send", args),
    researchPlan: (args: unknown) => ipcRenderer.invoke("nido:research-plan", args),
    researchReportExport: (args: unknown) =>
      ipcRenderer.invoke("nido:research-report-export", args),
    exportSaveDialog: (args: unknown) => ipcRenderer.invoke("nido:export-save-dialog", args),
    exportWrite: (args: unknown) => ipcRenderer.invoke("nido:export-write", args),
    exportDragStart: (args: unknown) => ipcRenderer.invoke("nido:export-drag-start", args),
    researchSessions: () => ipcRenderer.invoke("nido:research-sessions"),
    researchSessionDelete: (args: unknown) =>
      ipcRenderer.invoke("nido:research-session-delete", args),
    turnStop: () => ipcRenderer.invoke("nido:turn-stop"),
    conversationDelete: (id: string) => ipcRenderer.invoke("nido:conversation-delete", {id}),
    modelsList: () => ipcRenderer.invoke("nido:models-list"),
    modelsListLight: () => ipcRenderer.invoke("nido:models-list", {light: true}),
    modelLoad: (id: string) => ipcRenderer.invoke("nido:model-load", {id}),
    modelLoadRetryLess: (id: string) => ipcRenderer.invoke("nido:model-load-retry-less", {id}),
    modelDownload: (id: string) => ipcRenderer.invoke("nido:model-download", {id}),
    modelDownloadPause: (id: string) => ipcRenderer.invoke("nido:model-download-pause", {id}),
    modelDiscard: (id: string) => ipcRenderer.invoke("nido:model-discard", {id}),
    settingsSet: (args: unknown) => ipcRenderer.invoke("nido:settings-set", args),
    guideMark: (key: string) => ipcRenderer.invoke("nido:guide-mark", {key}),
    packsList: () => ipcRenderer.invoke("nido:packs-list"),
    packInstall: (id: string) => ipcRenderer.invoke("nido:pack-install", {id}),
    packImportPath: (path: string) => ipcRenderer.invoke("nido:pack-import-path", {path}),
    packFilePath: (file: File) => webUtils.getPathForFile(file),
    docFilePath: (file: File) => webUtils.getPathForFile(file),
    documentsImport: (paths: string[], name?: string) =>
        ipcRenderer.invoke("nido:documents-import", {paths, name}),
    documentsList: () => ipcRenderer.invoke("nido:documents-list"),
    documentsSetActive: (id: string, active: boolean) =>
        ipcRenderer.invoke("nido:documents-set-active", {id, active}),
    documentsDelete: (id: string) => ipcRenderer.invoke("nido:documents-delete", {id}),
    documentsExport: (id: string) => ipcRenderer.invoke("nido:documents-export", {id}),
    packRemove: (filename: string) => ipcRenderer.invoke("nido:pack-remove", {filename}),
    packGuides: () => ipcRenderer.invoke("nido:pack-guides"),
    packGuideRead: (packId: string, guideId: number) =>
        ipcRenderer.invoke("nido:pack-guide-read", {packId, guideId}),
    libraryData: () => ipcRenderer.invoke("nido:library-data"),
    memoryList: () => ipcRenderer.invoke("nido:memory-list"),
    memoryDelete: (kind: string, id: string) => ipcRenderer.invoke("nido:memory-delete", {kind, id}),
    agendaData: () => ipcRenderer.invoke("nido:agenda-data"),
    agendaEventSave: (args: unknown) => ipcRenderer.invoke("nido:agenda-event-save", args),
    agendaEventDelete: (id: string) => ipcRenderer.invoke("nido:agenda-event-delete", {id}),
    agendaContactSave: (args: unknown) => ipcRenderer.invoke("nido:agenda-contact-save", args),
    agendaContactDelete: (id: string) => ipcRenderer.invoke("nido:agenda-contact-delete", {id}),
    agendaImportPreview: (kind: string, path: string) =>
        ipcRenderer.invoke("nido:agenda-import-preview", {kind, path}),
    agendaImportCommit: (kind: string, token: string) =>
        ipcRenderer.invoke("nido:agenda-import-commit", {kind, token}),
    agendaExport: (kind: string) => ipcRenderer.invoke("nido:agenda-export", {kind}),
    noticeAct: (args: unknown) => ipcRenderer.invoke("nido:notice-act", args),
    tasksList: () => ipcRenderer.invoke("nido:tasks-list"),
    tasksSave: (args: unknown) => ipcRenderer.invoke("nido:tasks-save", args),
    tasksDelete: (args: unknown) => ipcRenderer.invoke("nido:tasks-delete", args),
    actionLogList: () => ipcRenderer.invoke("nido:action-log-list"),
    actionLogUndo: (id: number) => ipcRenderer.invoke("nido:action-log-undo", {id}),
    actionLogClear: () => ipcRenderer.invoke("nido:action-log-clear"),
    copyText: (text: string) => ipcRenderer.invoke("nido:copy", {text}),
    openExternal: (url: string) => ipcRenderer.invoke("nido:open-external", {url}),
    confirmResponse: (id: string, approved: boolean) => {
        ipcRenderer.send("nido:confirm-response", {id, approved});
    },
    onTurnToken: (cb: (payload: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on("nido:turn-token", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:turn-token", listener as never);
        };
    },
    onTurnPhase: (cb: (payload: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on("nido:turn-phase", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:turn-phase", listener as never);
        };
    },
    onConfirmRequest: (cb: (payload: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on("nido:confirm-request", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:confirm-request", listener as never);
        };
    },
    onVaultLocked: (cb: () => void) => {
        const listener = () => cb();
        ipcRenderer.on("nido:vault-locked", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:vault-locked", listener as never);
        };
    },
    linkPending: (args: unknown) => ipcRenderer.invoke("nido:link-pending", args),
    conversationSearch: (args: unknown) =>
      ipcRenderer.invoke("nido:conversation-search", args),
    backupExport: (args: unknown) => ipcRenderer.invoke("nido:backup-export", args),
    vaultRotateRequest: (args: unknown) =>
      ipcRenderer.invoke("nido:vault-rotate-request", args),
    // Superficies de bóveda (S-1 + PAQ-2): la vuelta del
    // respaldo (vista previa y gesto) y el borrado total,
    // los tres gestos nuevos de la pestaña Seguridad.
    backupRestorePreview: (args: unknown) =>
      ipcRenderer.invoke("nido:backup-restore-preview", args),
    backupRestore: (args: unknown) => ipcRenderer.invoke("nido:backup-restore", args),
    vaultWipe: (args: unknown) => ipcRenderer.invoke("nido:vault-wipe", args),
    onLink: (cb: (payload: {seq?: number}) => void) => {
        const listener = (_event: unknown, payload: {seq?: number}) => cb(payload ?? {});
        ipcRenderer.on("nido:link", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:link", listener as never);
        };
    },
    onNoticesShow: (cb: (payload: {target?: string}) => void) => {
        const listener = (_event: unknown, payload: {target?: string}) => cb(payload ?? {});
        ipcRenderer.on("nido:notices-show", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:notices-show", listener as never);
        };
    },
    // La voz (E9 paso 1): el dictado. El audio sale en muestras
    // Float32 a 16 kHz por el canal de envío, sin respuesta (la
    // misma forma que confirm-response); los eventos de la
    // sesión vuelven por onVoiceEvent.
    voiceEngineState: () => ipcRenderer.invoke("nido:voice-engine-state"),
    voiceDictationStart: () => ipcRenderer.invoke("nido:voice-dictation-start"),
    voiceDictationStop: () => ipcRenderer.invoke("nido:voice-dictation-stop"),
    voiceSpeakState: () => ipcRenderer.invoke("nido:voice-speak-state"),
    voiceSynth: (text: string, lang: string) =>
        ipcRenderer.invoke("nido:voice-synth", {text, lang}),
    voiceSpeakRelease: () => ipcRenderer.invoke("nido:voice-speak-release"),
    voiceAssets: () => ipcRenderer.invoke("nido:voice-assets"),
    voiceAssetInstall: (id: string) => ipcRenderer.invoke("nido:voice-asset-install", {id}),
    onVoiceAssetProgress: (cb: (p: {id: string; done: number; total: number}) => void) => {
        const listener = (_e: unknown, p: {id: string; done: number; total: number}) => cb(p);
        ipcRenderer.on("nido:voice-asset-progress", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:voice-asset-progress", listener as never);
        };
    },
    voiceDictationAudio: (samples: ArrayBuffer) =>
        ipcRenderer.send("nido:voice-dictation-audio", samples),
    onVoiceEvent: (cb: (payload: unknown) => void) => {
        const listener = (_event: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on("nido:voice-event", listener as never);
        return () => {
            ipcRenderer.removeListener("nido:voice-event", listener as never);
        };
    }
});
