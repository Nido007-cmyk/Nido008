import React from "react";
import ReactDOM from "react-dom/client";
import {App} from "./App/App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// R-3 del censo de herencia: el oyente heredado
// window.ipcRenderer.on("main-process-message", …) salió con la vía
// del scaffold. El puente de la casa no expone ipcRenderer ni admite
// ese canal, y el proceso principal ya no emite mensajes de prueba:
// el arranque del renderizador no escucha ningún canal.
//
// B-3 (tanda 14): la fuente Inter ya no entra por el paquete
// fontsource (que traía también la itálica y todos los
// subconjuntos): la hoja de tokens declara sus dos @font-face
// rectos, latino y latino extendido, alojados en public/fonts.
