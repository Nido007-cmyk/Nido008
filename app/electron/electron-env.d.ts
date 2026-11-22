/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
    interface ProcessEnv {
        /**
         * The built directory structure
         *
         * ```tree
         * ├─┬─┬ dist
         * │ │ └── index.html
         * │ │
         * │ ├─┬ dist-electron
         * │ │ ├── index.js
         * │ │ └── preload.mjs
         * │
         * ```
         */
        APP_ROOT: string,
        /** /dist/ or /public/ */
        VITE_PUBLIC: string
    }
}

// La declaración `interface Window { ipcRenderer }` del scaffold se
// retiró en la tanda de arreglos de la carcasa (CARCASA-RESTOS,
// C-ATQ-10): prometía a los tipos un ipcRenderer que la ejecución
// niega (el preload expone solo el puente nombrado window.nido, y
// typeof window.ipcRenderer === "undefined" en la ventana real).
