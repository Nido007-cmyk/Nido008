import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import electron from "vite-plugin-electron/simple";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// These modules won't be bundled as part of the Vite build of the Electron (main) side,
// but they'll be included in the final Electron app build inside the asar file.
// Performance and efficiency wise, this is absolutely fine and has no real drawbacks
// electron-updater se suma por necesidad probada (E1, 2026-11-16): si se
// empaqueta en el bundle, sus require relativos por plataforma
// (./AppImageUpdater.js y hermanos) no existen dentro del bundle y el
// proceso principal muere al arrancar. Como externo viaja en
// node_modules dentro del asar y carga su pieza por plataforma.
// better-sqlite3-multiple-ciphers se suma por E2-11 (tanda 14): es
// un módulo nativo (.node) que el proceso principal carga desde
// node_modules, desempaquetado del asar (electron-builder.ts).
// react-native y la familia expo-* se suman en la misma tanda: el
// código heredado del móvil solo los importa de forma dinámica
// tras sus costuras de plataforma (handlers.ts: Linking,
// calendario, contactos, documentos), caminos que en PC no se
// ejecutan (censo de imports dinámicos de src/: react-native,
// expo-calendar, expo-contacts, expo-document-picker,
// expo-file-system); como externos, esos imports quedan en tiempo
// de ejecución y el paquete no los arrastra.
// Los motores de E6 (paso 6) se suman por la cura F-E6-BUILD: se
// declararon en package.json sin entrar en esta lista y Rollup
// intentaba empaquetar el binario nativo de @napi-rs/canvas, así
// que ninguna construcción posterior al paso 6 terminaba. Son
// motores que se cargan en tiempo de ejecución, no código propio:
// @napi-rs/canvas es un binario nativo (.node en su paquete de
// plataforma), tesseract.js corre en su propio worker con el
// núcleo WASM de tesseract.js-core, y pdfjs-dist lee su worker,
// sus cmaps y sus fuentes del paquete en disco (su subruta
// legacy/build/pdf.mjs es el import real de ocrEngine y de
// pdfTextEngine, y entra nombrada entera). Viajan en node_modules
// y desempaquetados del asar (electron-builder.ts).
const electronExternalModules = ["node-llama-cpp", "lifecycle-utils", "electron-updater", "better-sqlite3-multiple-ciphers", "react-native", "expo-calendar", "expo-contacts", "expo-document-picker", "expo-file-system", "@napi-rs/canvas", "tesseract.js", "pdfjs-dist", "pdfjs-dist/legacy/build/pdf.mjs"];

// https://vitejs.dev/config/
export default defineConfig({
    esbuild: {
        target: "es2022"
    },
    optimizeDeps: {
        exclude: electronExternalModules,
        esbuildOptions: {
            target: "es2022"
        }
    },
    build: {
        outDir: path.join(__dirname, "dist"),
        target: "es2022"
    },
    root: path.join(__dirname, "src"),
    publicDir: path.join(__dirname, "public"),
    plugins: [
        react(),
        electron({
            main: {
                // Shortcut of `build.lib.entry`.
                entry: path.join(__dirname, "electron/index.ts"),
                // R-2 del censo de herencia, dirimido el 2026-11-16:
                // el scaffold arrancaba Electron con --inspect si
                // existía la variable ENABLE_INSPECT. La casa no
                // hereda interruptores de depuración remota en
                // silencio: el gancho se retiró y el arranque en
                // desarrollo es el normal, sin inspector. Si un día
                // hace falta depurar, se pedirá y se registrará como
                // decisión, no como herencia.
                onstart({startup}) {
                    return startup(["."]);
                },
                vite: {
                    build: {
                        target: "es2022",
                        outDir: path.join(__dirname, "dist-electron"),
                        rollupOptions: {
                            external: electronExternalModules,
                            // Dos entradas (CARCASA-BANCO-FUERA): la de
                            // producción (index) y la del banco (bench),
                            // que comparten la carcasa (shell) en un
                            // chunk común. electron-builder decide qué
                            // entrada viaja en cada paquete por el sabor
                            // de construcción (electron-builder.ts).
                            input: {
                                index: path.join(__dirname, "electron/index.ts"),
                                bench: path.join(__dirname, "electron/bench.ts")
                            }
                        }
                    }
                }
            },
            preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: path.join(__dirname, "electron/preload.ts"),
                vite: {
                    build: {
                        target: "es2022",
                        outDir: path.join(__dirname, "dist-electron")
                    }
                }
            },
            // Polyfill the Electron and Node.js API for Renderer process.
            // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
            // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: process.env.NODE_ENV === "test"
            // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
                ? undefined
                : {}
        })
    ]
});
