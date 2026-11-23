/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Carcasa compartida de NIDO PC: lo que la entrada de producción
 * (index.ts) y la entrada del banco (bench.ts) comparten, para que
 * el banco ejerza exactamente la misma carcasa que la app entrega.
 *
 * Sellos de la casa que viven aquí:
 *  - Ventana endurecida: contextIsolation sí, nodeIntegration no,
 *    sandbox sí y DevTools cerrado (devTools: false, C-ATQ-6 de la
 *    auditoría de carcasa) (SEGURIDAD-PC §5.6). La suite de
 *    endurecimiento lo comprueba contra el paquete, no contra
 *    este fichero.
 *  - Permisos denegados por defecto (CARCASA-PERMISOS, C-ATQ-2):
 *    sin manejador, Chromium concede todos los permisos en
 *    silencio; aquí los dos manejadores (petición y comprobación)
 *    deniegan todo lo que no esté en PERMISSION_ALLOWLIST: la
 *    app pide solo lo que usa, al usarlo (SEGURIDAD-PC §5.7).
 *    La lista nació vacía y su único contenido es «media»,
 *    añadido por E9 (paso 1) para el dictado, con su gesto, en
 *    esta constante y en ninguna otra parte. Las
 *    ventanas de la casa usan la sesión por defecto; si una etapa
 *    futura trajera una segunda sesión, hereda la obligación de
 *    instalar estos mismos manejadores sobre ella.
 *  - Arranque sin red silenciosa (CARCASA-RED-ARRANQUE, C-ATQ-3):
 *    el DoH integrado de Chromium apagado por
 *    configureHostResolver como primera llamada del ready (la API
 *    lo rechaza antes de ready), y la actualización de
 *    componentes de Chromium desactivada por interruptor (palanca
 *    de la decisión D-3 de la tanda de arreglos). La guardia
 *    permanente es el censo de red saliente del banco.
 *  - Guardia de arranque (decisión D-7): si el lanzamiento trae el
 *    interruptor de depuración remota de Chromium
 *    (--remote-debugging-port o --remote-debugging-pipe), la app
 *    escribe el asiento en su registro y sale sin crear ventana.
 *    La casa ya retiró el --inspect de Node por la misma clase de
 *    motivo (R-2 del censo de herencia); este interruptor no queda
 *    en silencio.
 *  - La variable de desarrollo no manda en producción
 *    (CARCASA-DEVURL, C-ATQ-4; decisión D-4, vía B):
 *    VITE_DEV_SERVER_URL solo se lee cuando la app no está
 *    empaquetada; en el binario entregado se ignora entera, como
 *    si no existiera.
 *  - Ninguna navegación ni window.open sale del contenido local:
 *    todo se deniega y queda registrado. (El scaffold abría los
 *    enlaces en el navegador del sistema; eso es justo lo que el
 *    sello prohíbe.)
 *  - Actualizador SOLO manual (SEGURIDAD-PC §6.2): sin descarga
 *    automática, sin instalación al salir y sin comprobación al
 *    arranque ni en segundo plano. Comprobar es una acción
 *    explícita de la persona por el canal IPC
 *    «nido:check-for-updates», y solo eso dispara una
 *    comprobación. El canal sigue el patrón de la decisión D-8:
 *    validación de emisor (solo la ventana de la casa, solo desde
 *    su propia URL; lo demás se rechaza y queda registrado), una
 *    sola comprobación en vuelo compartida por las invocaciones
 *    concurrentes, y estado honesto: sin fuente configurada (no
 *    existe app-update.yml junto a los recursos; la fuente es de
 *    E12) el canal responde «no-update-source» sin llamar al
 *    actualizador, en lugar del éxito vacío que devolvía antes.
 *    La verificación de firma de electron-updater queda en su
 *    valor seguro por defecto: verifyUpdateCodeSignature jamás se
 *    pone en false (lo vigila la suite sobre el paquete).
 *  - La insignia de actualización del scaffold, que consultaba la
 *    API de GitHub en segundo plano, se retiró de la ventana por
 *    la misma regla: aquí no hay red silenciosa.
 *  - La vía de carga de modelos del scaffold (su RPC por birpc, su
 *    estado y su selector libre de fichero) se RETIRÓ entera con
 *    el censo de herencia (defecto D-1 de la auditoría de ataque
 *    3): cargaba cualquier GGUF sin catálogo ni huella y llamaba a
 *    getLlama() sin skipDownload. No queda ninguna RPC de modelos:
 *    el único cargador de la app es el núcleo de la casa
 *    (LocalEngine + loadPath), el mismo que ejerce el banco.
 */
import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs";
import {app, BrowserWindow, ipcMain, Menu, protocol, screen, session} from "electron";
import {autoUpdater} from "electron-updater";
import {APP_PAGE_URL, APP_SCHEME, isAppUrl as isAppUrlPure} from "./appUrl";

export {APP_PAGE_URL, APP_SCHEME};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ ├─┬ dist-electron
// │ │ ├── index.js
// │ │ └── preload.mjs
//
process.env.APP_ROOT = path.join(__dirname, "..");

// CARCASA-DEVURL (decisión D-4, vía B): la guarda isPackaged cubre
// la lectura y, por tanto, sus tres consumos (la bendición de
// origen en isAppUrl, el loadURL de la ventana y VITE_PUBLIC).
export const VITE_DEV_SERVER_URL = app.isPackaged
    ? undefined
    : process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT, "public")
    : RENDERER_DIST;

// La página de la casa se sirve por un esquema propio y
// privilegiado (nido://), no por file://. Motivo (CARCASA-F7,
// desviación asentada de la tanda de arreglos): con el fusible
// GrantFileProtocolExtraPrivileges en DISABLE, que es el arreglo
// de C-ATQ-1, Chromium retira también la vía con la que la ventana
// cargaba su propia página desde el asar (loadFile muere con
// ERR_FILE_NOT_FOUND, probado sobre el paquete construido; la
// evidencia de volteo de la auditoría no comprobó el DOM de la
// página servida). Servir la interfaz por el esquema propio es la
// compensación: la página vive en un origen estándar y seguro sin
// ningún privilegio sobre file://, y un fetch suyo a ficheros
// locales sigue rechazado. El registro del esquema va a nivel de
// módulo porque Electron exige declararlo antes de ready.
protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
    }
}]);

const APP_MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm"
};

// Sirve los ficheros de dist/ bajo el esquema de la casa. La ruta
// pedida se contiene dentro de RENDERER_DIST (ningún «..» sale) y
// lo que no existe responde 404: el manejador no es una ventana a
// disco, es la carpeta pública de la app y nada más. La lectura va
// por fs del proceso principal, que lee dentro del asar por la
// integración de Electron, sin pasar por el protocolo file:.
function installAppProtocol() {
    protocol.handle(APP_SCHEME, async (request) => {
        try {
            const url = new URL(request.url);
            if (url.host !== "app")
                return new Response("not found", {status: 404});
            const pathname = decodeURIComponent(url.pathname);
            const relative = pathname === "/" || pathname === ""
                ? "index.html"
                : pathname.replace(/^\/+/, "");
            const filePath = path.join(RENDERER_DIST, relative);
            if (filePath !== RENDERER_DIST &&
                !filePath.startsWith(RENDERER_DIST + path.sep))
                return new Response("not found", {status: 404});
            const data = await fs.promises.readFile(filePath);
            const contentType = APP_MIME_TYPES[path.extname(filePath).toLowerCase()] ??
                "application/octet-stream";
            return new Response(new Uint8Array(data), {
                headers: {"content-type": contentType}
            });
        } catch {
            return new Response("not found", {status: 404});
        }
    });
}

// La configuración de ventana que la suite de endurecimiento exige.
// Vive en una constante para que el informe del banco registre
// exactamente lo que el código empaquetado pasa a BrowserWindow.
export const WEB_PREFERENCES = {
    preload: path.join(__dirname, "preload.mjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: false,
    scrollBounce: true
} as const;

// Registros de la carcasa: los intentos que los guardias frenan y
// los rechazos del canal. El banco los vuelca en su informe; en
// producción quedan como el registro en memoria de la sesión.
export const windowOpenAttempts: {url: string, decision: string}[] = [];
export const navigationAttempts: {url: string, blocked: boolean}[] = [];
export const ipcRejectedAttempts: {channel: string, at: string}[] = [];

let win: BrowserWindow | null = null;

// E8 (paso 6): una salida de verdad en curso (before-quit):
// el cierre de la ventana que la acompaña no es un gesto de
// «ocultar a la bandeja».
let quitting = false;

export function isAppUrl(rawUrl: string): boolean {
    // La lógica vive en el módulo puro appUrl.ts (F-PC76); esta es su
    // envoltura con la URL de desarrollo de la carcasa ya resuelta.
    return isAppUrlPure(rawUrl, VITE_DEV_SERVER_URL);
}

// ---------------------------------------------------------------------
// Permisos (CARCASA-PERMISOS): denegar por defecto, en petición y
// en comprobación. La lista nace vacía; su único sitio es esta
// constante. Su primer y único contenido llega con E9 (paso 1):
// «media», para el dictado por voz, y solo se pide desde su
// gesto — el botón de dictado del composer, que es el único
// sitio de la app que llama a getUserMedia, al pulsarlo y
// nunca antes.
// ---------------------------------------------------------------------
export const PERMISSION_ALLOWLIST: ReadonlySet<string> = new Set(["media"]);

function installPermissionHandlers() {
    session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback) => {
            callback(PERMISSION_ALLOWLIST.has(permission));
        });
    session.defaultSession.setPermissionCheckHandler(
        (_webContents, permission) => PERMISSION_ALLOWLIST.has(permission));
}

// ---------------------------------------------------------------------
// Actualizador en modo manual (ver cabecera). Los contadores
// existen para que el banco pueda probar que al arrancar no se
// comprueba nada, y distinguen peticiones de la persona de
// comprobaciones lanzadas de verdad (patrón D-8).
// ---------------------------------------------------------------------
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
let updateChecksRequested = 0;
let updateChecksLaunched = 0;
let updateCheckInFlight: Promise<unknown> | null = null;

export function updaterState() {
    return {
        autoDownload: autoUpdater.autoDownload,
        autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
        updateChecksRequested,
        updateChecksLaunched
    };
}

function updateSourceConfigured(): boolean {
    // En desarrollo (sin empaquetar) la comprobación pasa a
    // electron-updater, que usa su vía de desarrollo. Empaquetada,
    // la fuente existe solo si E12 dejó su app-update.yml junto a
    // los recursos del paquete.
    if (!app.isPackaged)
        return true;
    return fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function installUpdateChannel() {
    ipcMain.handle("nido:check-for-updates", async (event) => {
        // Validación de emisor: solo la ventana de la casa y solo
        // desde la URL de la app. Lo que no casa se rechaza y
        // queda registrado, sin contar como petición.
        const senderIsHouseWindow = win != null &&
            event.sender === win.webContents &&
            event.senderFrame != null &&
            isAppUrl(event.senderFrame.url);
        if (!senderIsHouseWindow) {
            ipcRejectedAttempts.push({
                channel: "nido:check-for-updates",
                at: new Date().toISOString()
            });
            return {state: "rejected-sender"};
        }
        updateChecksRequested += 1;
        // Estado honesto: sin fuente no hay comprobación que
        // lanzar, y el canal lo dice en vez de resolver un éxito
        // vacío.
        if (!updateSourceConfigured())
            return {state: "no-update-source"};
        // Single-flight: las invocaciones concurrentes comparten
        // la comprobación en vuelo.
        if (!updateCheckInFlight) {
            updateChecksLaunched += 1;
            updateCheckInFlight = autoUpdater.checkForUpdates()
                .then((result) => ({
                    state: "checked",
                    version: result?.updateInfo?.version ?? null
                }))
                .catch((err) => ({state: "check-failed", error: String(err)}))
                .finally(() => {
                    updateCheckInFlight = null;
                });
        }
        return updateCheckInFlight;
    });
}

// ---------------------------------------------------------------------
// La ventana de la casa, con sus guardias.
// ---------------------------------------------------------------------
export interface ShellHooks {
    // Se llama una sola vez por ventana, cuando la página se
    // asienta: did-finish-load en el camino normal, o
    // did-fail-load si la navegación murió antes (la corrida
    // hostil del banco termina en página de error sin finish-load
    // y aun así necesita su única corrida).
    onPageSettled?: (window: BrowserWindow) => void;
    // Instancia única (VENTANA-LINUX §4.2): solo la entrada de
    // producción la pide; el banco lanza cuantas instancias
    // necesite su arnés sin pelearse con esta cerradura.
    singleInstance?: boolean;
    // E11 (paso 7): la segunda instancia entrega sus
    // argumentos a la primera (el enlace nido:// viaja en
    // ellos); la primera ya despertó y enfocó su ventana
    // en el manejador de abajo. Sin este gancho, la
    // llegada en caliente perdería el enlace.
    onSecondInstanceArgv?: (argv: string[]) => void;
    // E11 (paso 7): la llegada por open-url de macOS. Se
    // registra siempre; en Windows y Linux el sistema
    // entrega el enlace por los argumentos y este camino
    // no se ejecuta (su prueba es de la plataforma, con
    // sede en E12).
    onOpenUrl?: (url: string) => void;
    // E8 (paso 6): el residente en bandeja, consultado al
    // cerrar la ventana y en window-all-closed. Con residente,
    // cerrar oculta la ventana y el proceso sigue (es el mismo
    // proceso principal, con la ventana oculta); sin residente,
    // cerrar sale, como siempre. Salir de verdad (app.quit,
    // desde el menú de la bandeja o el SO) pasa por before-quit
    // y nunca queda atrapado por este gancho.
    residentEnabled?: () => boolean;
}

// E8 (paso 6): la ventana principal, para la bandeja y el clic
// de la notificación (enseñarla es su «Ver»).
export function getMainWindow(): BrowserWindow | null {
    return win;
}

export function showMainWindow(): void {
    if (!win)
        return;
    if (win.isMinimized())
        win.restore();
    win.show();
    win.focus();
}

// ---------------------------------------------------------------------
// El estado de la ventana (VENTANA-LINUX §4.2, tanda 14): fuera de
// la bóveda, en su propio fichero, con exactamente cinco claves
// (x, y, ancho, alto, maximizado). La primera ventana nace a
// 1200×800 (la cifra dirimida de I-06) con mínimo 640×480; un
// fichero corrupto o unos límites fuera de pantalla caen a la
// geometría por defecto, en claro y sin ruido.
// ---------------------------------------------------------------------
interface WindowState {
    x: number | null;
    y: number | null;
    width: number;
    height: number;
    maximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = {
    x: null,
    y: null,
    width: 1200,
    height: 800,
    maximized: false
};

function windowStatePath(): string {
    return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState(): WindowState {
    try {
        const parsed = JSON.parse(fs.readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>;
        const width = typeof parsed.width === "number" ? Math.max(640, Math.round(parsed.width)) : 1200;
        const height = typeof parsed.height === "number" ? Math.max(480, Math.round(parsed.height)) : 800;
        const x = typeof parsed.x === "number" ? Math.round(parsed.x) : null;
        const y = typeof parsed.y === "number" ? Math.round(parsed.y) : null;
        if (x != null && y != null) {
            const onScreen = screen.getAllDisplays().some((d) => {
                const a = d.workArea;
                return x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y;
            });
            if (!onScreen)
                return {...DEFAULT_WINDOW_STATE};
        }
        return {x, y, width, height, maximized: parsed.maximized === true};
    } catch {
        return {...DEFAULT_WINDOW_STATE};
    }
}

function saveWindowState(win: BrowserWindow): void {
    try {
        const bounds = win.getNormalBounds();
        const state: WindowState = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            maximized: win.isMaximized()
        };
        fs.writeFileSync(windowStatePath(), JSON.stringify(state), "utf8");
    } catch {
        // El estado de la ventana es una comodidad, no un dato: si
        // no se puede guardar, la próxima ventana nace por defecto.
    }
}

function createWindow(hooks: ShellHooks) {
    const state = loadWindowState();
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC, "app-icon.png"),
        webPreferences: WEB_PREFERENCES,
        title: "NIDO PC",
        backgroundColor: "#F7F5F0",
        width: state.width,
        height: state.height,
        ...(state.x != null && state.y != null ? {x: state.x, y: state.y} : {}),
        minWidth: 640,
        minHeight: 480
    });
    if (state.maximized)
        win.maximize();
    win.on("close", (event) => {
        if (win)
            saveWindowState(win);
        // E8 (paso 6): con el residente encendido, cerrar la
        // ventana la oculta a la bandeja y el proceso sigue;
        // una salida de verdad (before-quit ya disparado) no
        // se intercepta.
        if (!quitting && hooks.residentEnabled?.()) {
            event.preventDefault();
            win?.hide();
        }
    });

    // Ninguna ventana nueva: ni a contenido local ni a fuera. Todo
    // intento queda registrado para la suite de endurecimiento.
    win.webContents.setWindowOpenHandler(({url}) => {
        windowOpenAttempts.push({url, decision: "deny"});
        console.log(`NIDO-SHELL WINDOW-OPEN-DENIED ${url}`);
        return {action: "deny"};
    });

    // Ninguna navegación fuera de la propia página de la app.
    win.webContents.on("will-navigate", (event, url) => {
        if (!isAppUrl(url)) {
            event.preventDefault();
            navigationAttempts.push({url, blocked: true});
            console.log(`NIDO-SHELL NAVIGATION-BLOCKED ${url}`);
        }
    });

    if (hooks.onPageSettled) {
        const onPageSettled = hooks.onPageSettled;
        let settled = false;
        const settle = () => {
            if (settled)
                return;
            settled = true;
            onPageSettled(win!);
        };
        win.webContents.on("did-finish-load", settle);
        win.webContents.on("did-fail-load", settle);
    }

    if (VITE_DEV_SERVER_URL)
        void win.loadURL(VITE_DEV_SERVER_URL);
    else
        void win.loadURL(APP_PAGE_URL);
}

// ---------------------------------------------------------------------
// Arranque compartido: lo llaman las dos entradas, y solo ellas.
// ---------------------------------------------------------------------
export function bootShell(hooks: ShellHooks = {}) {
    // Guardia de arranque (decisión D-7): el interruptor de
    // depuración remota entrega la página a cualquier proceso
    // local que lo pida; con él presente, la app lo asienta en su
    // registro y sale sin crear ventana.
    if (app.commandLine.hasSwitch("remote-debugging-port") ||
        app.commandLine.hasSwitch("remote-debugging-pipe")) {
        console.error("NIDO-SHELL GUARDIA D-7: interruptor de depuración " +
            "remota presente en el lanzamiento; la app sale sin crear ventana");
        app.exit(1);
        return;
    }

    // Instancia única (VENTANA-LINUX §4.2): la segunda instancia
    // no abre otra ventana ni otra bóveda; despierta a la primera
    // y sale. El menú de la aplicación se retira entero: la
    // superficie de NIDO no vive en una barra de menús.
    Menu.setApplicationMenu(null);
    if (hooks.singleInstance) {
        if (!app.requestSingleInstanceLock()) {
            app.quit();
            return;
        }
        app.on("second-instance", (_event, argv) => {
            if (win) {
                if (win.isMinimized())
                    win.restore();
                win.focus();
            }
            // E11 (paso 7): el enlace de la segunda
            // instancia se entrega a la primera por el
            // gancho; la instancia que sale no resuelve
            // nada por su cuenta.
            hooks.onSecondInstanceArgv?.(argv);
        });
    }

    // E11 (paso 7): el cliente de protocolo declarado del
    // esquema nido. La app se anuncia al sistema como la
    // que abre los enlaces nido:// (su registro en el
    // sistema instalado es la partida de E12; aquí vive la
    // declaración y el manejo). La llegada es por los
    // argumentos (instancia única) en Windows y Linux, y
    // por open-url en macOS.
    if (process.defaultApp) {
        app.setAsDefaultProtocolClient("nido", process.execPath, [
            path.resolve(process.argv[1]),
        ]);
    } else {
        app.setAsDefaultProtocolClient("nido");
    }
    app.on("open-url", (event, url) => {
        event.preventDefault();
        hooks.onOpenUrl?.(url);
    });

    // Arranque sin red silenciosa (CARCASA-RED-ARRANQUE): la
    // actualización de componentes de Chromium, desactivada por
    // interruptor antes de ready, que es donde Chromium lo lee
    // (primera palanca de la decisión D-3). El censo saliente la
    // vio insuficiente sobre la app ya viva (la consulta a
    // redirector.gvt1.com seguía saliendo), así que la tanda
    // agota también la segunda palanca de D-3,
    // disable-background-networking, que apaga de una pieza la
    // red de fondo de Chromium (no solo los componentes); el
    // censo dirime si con las dos basta o queda residuo firmado.
    // El DoH integrado se apaga en el whenReady de más abajo: la
    // API de Electron 45 rechaza configureHostResolver antes de
    // ready («cannot be called before the app is ready», cazado
    // en la primera corrida de esta tanda: la app moría en el
    // arranque sin crear ventana), así que va como primera
    // llamada del ready, antes de crear ninguna ventana y de que
    // la casa resuelva nombre alguno.
    app.commandLine.appendSwitch("disable-component-update");
    app.commandLine.appendSwitch("disable-background-networking");

    installUpdateChannel();

    // La salida de verdad marca su bandera antes de que
    // ninguna ventana se cierre: el residente no la atrapa.
    app.on("before-quit", () => {
        quitting = true;
    });

    // Quit when all windows are closed, except on macOS — and
    // except with the resident on (E8, paso 6): the process is
    // the resident, and it leaves through Quit, not through
    // the window.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin" && !hooks.residentEnabled?.()) {
            app.quit();
            win = null;
        }
    });

    app.on("activate", () => {
        // On OS X it's common to re-create a window in the app when
        // the dock icon is clicked and there are no other windows
        // open.
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow(hooks);
    });

    app.whenReady().then(() => {
        app.configureHostResolver({secureDnsMode: "off"});
        installPermissionHandlers();
        if (!VITE_DEV_SERVER_URL)
            installAppProtocol();
        createWindow(hooks);
    });
}
