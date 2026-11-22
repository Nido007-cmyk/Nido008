import path from "node:path";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
import {$} from "zx";
import {flipFuses, FuseVersion, FuseV1Options} from "@electron/fuses";
import type {Configuration} from "electron-builder";

// Identidad del banco E1 de NIDO PC (la identidad de publicación se
// fija en la etapa de instalador completo, E12, con su firma).
const appId = "com.nido.pc";
const productName = "NIDO PC";
const executableName = "nido-pc";
const appxIdentityName = "com.nido.pc";

// Sabor de construcción (CARCASA-BANCO-FUERA, decisión D-5): se lee
// de la variable del propio build (NIDO_BUILD_FLAVOR, la fija el
// script dist:bench), nunca del entorno de ejecución de la app. En
// sabor banco el paquete sale a release-bench, admite la entrada
// del banco y la declara su principal; en producción la entrada
// del banco queda fuera de files y el principal es index.js, el
// del package.json.
const buildFlavor = process.env["NIDO_BUILD_FLAVOR"] === "bench" ? "bench" : "production";

/**
 * @see - https://www.electron.build/configuration/configuration
 */
export default {
    appId: appId,
    // Esquema de electron-builder v27: el desempaquetado del asar se
    // declara en asar.unpack (antes asarUnpack) y los ficheros en
    // fileOptions.files (antes files a nivel raíz).
    asar: {
        unpack: [
            "node_modules/node-llama-cpp/bins",
            "node_modules/node-llama-cpp/llama/localBuilds",
            "node_modules/@node-llama-cpp/*",
            // E2-11 (tanda 14): el .node de la base cifrada no puede
            // cargarse desde dentro del asar; viaja desempaquetado.
            "node_modules/better-sqlite3-multiple-ciphers",
            // E6 paso 6, por la cura F-E6-BUILD: el motor de OCR
            // carga en tiempo de ejecución piezas que no pueden
            // abrirse desde dentro del asar: el binario nativo de
            // Skia (dlopen exige una ruta real), el worker de
            // tesseract.js con su núcleo WASM y su detector (un
            // worker thread resuelve sus módulos en disco, sin la
            // resolución consciente del asar del proceso
            // principal), y el worker, los cmaps y las fuentes de
            // pdfjs-dist, que el motor abre por ruta de fichero.
            // Los dos patrones de tesseract van en forma de globo
            // entera a propósito: el empaquetador solo expande a
            // `/**/*` los patrones sin punto, y «tesseract.js»
            // lleva punto en el nombre, así que la forma de
            // directorio a secas no desempaquetaba nada (medido
            // en la cura: el paquete salía con el motor dentro
            // del asar).
            "node_modules/@napi-rs/canvas",
            "node_modules/@napi-rs/canvas-*",
            "node_modules/tesseract.js/**/*",
            "node_modules/tesseract.js-core/**/*",
            "node_modules/wasm-feature-detect",
            "node_modules/pdfjs-dist",
            // E9 paso 1: el runtime de voz (sherpa-onnx-node y su
            // paquete de plataforma) carga su .node y sus
            // bibliotecas ONNX por dlopen desde el proceso de
            // utilidad: no pueden abrirse desde dentro del asar.
            // El filtrado de binarios de otras plataformas de
            // estos paquetes es la pierna P-7 de E12, no de esta
            // etapa.
            "node_modules/sherpa-onnx-node",
            "node_modules/sherpa-onnx-*"
        ]
    },
    productName: productName,
    executableName: executableName,
    directories: {
        output: buildFlavor === "bench" ? "release-bench" : "release"
    },
    ...(buildFlavor === "bench"
        ? {extraMetadata: {main: "./dist-electron/bench.js"}}
        : {}),
    icon: "./public/app-icon.png",

    async afterPack(context) {
        // Fusibles de Electron (SEGURIDAD-PC §5.6), volcados en el
        // binario empaquetado en cada construcción: la suite de
        // endurecimiento los lee del binario (scripts/hardening.mjs)
        // y falla si alguno no está como aquí se declara. La tabla
        // completa de los ocho, con su valor esperado (la suite los
        // aserta uno a uno):
        //   0 RunAsNode .................................... fuera
        //   1 EnableCookieEncryption ....................... dentro (decisión D-1 de la tanda de arreglos)
        //   2 EnableNodeOptionsEnvironmentVariable ......... fuera
        //   3 EnableNodeCliInspectArguments ................ fuera
        //   4 EnableEmbeddedAsarIntegrityValidation ........ dentro (en Linux es estado, no imposición:
        //                                                      la plataforma no lo impone al cargar;
        //                                                      su prueba de imposición es de E12)
        //   5 OnlyLoadAppFromAsar .......................... dentro
        //   6 LoadBrowserProcessSpecificV8Snapshot ......... fuera
        //   7 GrantFileProtocolExtraPrivileges ............. fuera (CARCASA-F7: sin él, la página
        //                                                      no puede leer ficheros locales por fetch)
        const productFilename = context.packager.appInfo.productFilename;
        const electronBinaryPath = context.electronPlatformName === "darwin"
            ? path.join(context.appOutDir, `${productFilename}.app`)
            : context.electronPlatformName === "win32"
                ? path.join(context.appOutDir, `${productFilename}.exe`)
                : path.join(context.appOutDir, productFilename);
        await flipFuses(electronBinaryPath, {
            version: FuseVersion.V1,
            resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
            [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
        });

        // remove this once you set up your own code signing for macOS
        if (context.electronPlatformName === "darwin") {
            // check whether the app was already signed
            const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

            // this is needed for the app to not appear as "damaged" on Apple Silicon Macs
            // https://github.com/electron-userland/electron-builder/issues/5850#issuecomment-1821648559
            await $`codesign --force --deep --sign - ${appPath}`;
        }

        // El sello de construcción (pasada del banco, R-1), ciego
        // al sabor: este gancho es de la configuración compartida,
        // así que dist:bench y dist:dir sellan igual. La huella
        // del asar producido se calcula aquí, con el asar ya final
        // (el fusible de integridad de arriba se calcula sobre él
        // en este mismo gancho), y se asienta en build-seal.json
        // junto al directorio del paquete, con builtAt y la foto
        // del árbol repetidos desde el build-info.json que el
        // primer paso de la cadena capturó (scripts/buildPhoto.mjs):
        // un fichero dentro del asar no puede llevar la huella del
        // asar que lo contiene, y las dos copias de la foto deben
        // casar entre sí en la comparación de los orquestadores.
        // Si la cadena se invocó saltándose su primer paso no hay
        // build-info que repetir: el sello nace con photoCaptured
        // en falso y la comparación lo trata como no coincidencia.
        const asarPath = context.electronPlatformName === "darwin"
            ? path.join(context.appOutDir, `${productFilename}.app`, "Contents", "Resources", "app.asar")
            : path.join(context.appOutDir, "resources", "app.asar");
        const asarHash = createHash("sha256");
        for await (const chunk of createReadStream(asarPath))
            asarHash.update(chunk as Buffer);
        const seal: Record<string, unknown> = {asarSha256: asarHash.digest("hex"), photoCaptured: false};
        try {
            const projectDir = (context.packager as unknown as {projectDir?: string}).projectDir ?? process.cwd();
            const info = JSON.parse(await readFile(path.join(projectDir, "build-info.json"), "utf8")) as {
                builtAt?: unknown; head?: unknown; dirty?: unknown;
            };
            if (typeof info.builtAt === "string" && typeof info.head === "string" && typeof info.dirty === "boolean") {
                seal.builtAt = info.builtAt;
                seal.head = info.head;
                seal.dirty = info.dirty;
                seal.photoCaptured = true;
            }
        } catch {
            // Sin build-info legible: el sello nace sin foto.
        }
        await writeFile(path.join(context.appOutDir, "build-seal.json"), JSON.stringify(seal, null, 2) + "\n");
    },
    fileOptions: {
        files: [
            "dist",
            "dist-electron",
            // El build-info.json de la foto de construcción
            // (pasada del banco, R-1): lo captura el primer paso
            // de la cadena (scripts/buildPhoto.mjs) y lo lee la
            // app para su Acerca de; viaja en la raíz del asar.
            "build-info.json",
            // En producción la entrada del banco no viaja
            // (CARCASA-BANCO-FUERA); en sabor banco viaja entera.
            ...(buildFlavor === "bench" ? [] : ["!dist-electron/bench.js"]),
            "!node_modules/node-llama-cpp/bins/**/*",
            "node_modules/node-llama-cpp/bins/${os}-${arch}*/**/*",
            "!node_modules/node-llama-cpp/llama/localBuilds/**/*",
            "node_modules/node-llama-cpp/llama/localBuilds/${os}-${arch}*/**/*",
            "!node_modules/@node-llama-cpp/*/bins/**/*",
            "node_modules/@node-llama-cpp/${os}-${arch}*/bins/**/*",
            // La misma forma para los prebuilds de la base cifrada
            // (cura F-E6-BUILD, segundo filo): el paquete npm trae
            // los .node de todas las plataformas y la verificación
            // de binarios nativos de electron-builder v27 rechaza
            // el paquete entero por los ajenos al destino, aunque
            // nunca se carguen. Al paquete viaja solo el prebuild
            // de la plataforma y arquitectura del destino (y su
            // variante musl, que es ELF de la misma arquitectura).
            "!node_modules/better-sqlite3-multiple-ciphers/prebuilds/**/*",
            "node_modules/better-sqlite3-multiple-ciphers/prebuilds/${os}-${arch}.node",
            "node_modules/better-sqlite3-multiple-ciphers/prebuilds/${os}musl-${arch}.node",
            // Línea expresa para Windows: la macro ${os} se
            // expande a «win» para ese destino, pero el prebuild
            // del paquete se llama win32-x64.node; sin esta línea
            // el paquete de Windows salía sin el .node de la base
            // cifrada (cazado en la primera build del instalador,
            // 2026-11-21). En Linux la línea de la macro basta
            // porque allí ${os} y el nombre del fichero coinciden.
            // La línea va CONDICIONADA al destino Windows
            // (cura E9, 2026-11-22): sin condicionar, re-incluía
            // el prebuild win32 en las builds de Linux y la
            // verificación de binarios nativos rechazaba el
            // paquete entero del banco (medido en la puerta de
            // la escucha: win32-x64.node PE en el paquete linux).
            ...(process.argv.includes("--win")
                ? ["node_modules/better-sqlite3-multiple-ciphers/prebuilds/win32-${arch}.node"]
                : [])
        ]
    },
    mac: {
        target: [{
            target: "dmg",
            arch: [
                "arm64",
                "x64"
            ]
        }, {
            target: "zip",
            arch: [
                "arm64",
                "x64"
            ]
        }],

        artifactName: "${name}.macOS.${version}.${arch}.${ext}"
    },
    win: {
        target: [{
            target: "nsis",
            arch: [
                "x64",
                "arm64"
            ]
        }],

        artifactName: "${name}.Windows.${version}.${arch}.${ext}"
    },
    appx: {
        identityName: appxIdentityName,
        artifactName: "${name}.Windows.${version}.${arch}.${ext}"
    },
    nsis: {
        // Instalador asistido y por usuario, sin elevación
        // (INSTALADOR-ETAPA §2.2): la persona ve dónde se instala y
        // confirma; oneClick silencioso queda fuera de la casa.
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        deleteAppDataOnUninstall: true
    },
    linux: {
        target: [{
            target: "AppImage",
            arch: [
                "x64",
                "arm64"
            ]
        }, {
            target: "snap",
            arch: [
                "x64"
            ]
        }, {
            target: "deb",
            arch: [
                "x64",
                "arm64"
            ]
        }, {
            target: "tar.gz",
            arch: [
                "x64",
                "arm64"
            ]
        }],
        category: "Utility",

        artifactName: "${name}.Linux.${version}.${arch}.${ext}"
    }
} satisfies Configuration as Configuration;
