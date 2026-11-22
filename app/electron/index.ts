/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Entrada de producción del proceso principal de NIDO PC.
 *
 * La carcasa entera vive en shell.ts (ventana endurecida, permisos
 * denegados por defecto, arranque sin red silenciosa, guardia
 * contra la depuración remota, actualizador manual con su canal).
 * Los servicios de la app (services.ts: la bóveda con el registro
 * §8.9, el turno, los modelos, los ajustes) se instalan antes de
 * arrancar la carcasa, para que ningún canal quede sin atender
 * cuando la página despierte. El banco de pruebas tiene su
 * propia entrada (bench.ts) y su propio paquete
 * (CARCASA-BANCO-FUERA): esta entrada no lee ninguna variable
 * NIDO_BENCH*; el artefacto que E12 convertirá en instalador no
 * lleva el banco dentro.
 */
import {app, dialog} from "electron";
import {bootShell} from "./shell.ts";
import {installServices} from "./services.ts";
import {residentEnabledSync} from "./noticeShell.ts";

void (async () => {
    try {
        await installServices();
    } catch (err) {
        // El arranque no muere en silencio (auditoría del
        // arranque): si los servicios no se pueden instalar
        // (el directorio de datos no es escribible, por
        // ejemplo), la persona lo lee en un diálogo del sistema
        // antes de que la app se cierre, no una ventana que
        // nunca llega.
        const detail = err instanceof Error ? err.message : String(err);
        const spanish = app.getLocale().toLowerCase().startsWith("es");
        await app.whenReady().catch(() => undefined);
        dialog.showErrorBox(
            "NIDO PC",
            spanish
                ? `NIDO no pudo preparar sus datos en este dispositivo y se va a cerrar.\n\n${detail}`
                : `NIDO could not prepare its data on this device and will close.\n\n${detail}`,
        );
        app.quit();
        return;
    }
    bootShell({singleInstance: true, residentEnabled: () => residentEnabledSync()});
})();
