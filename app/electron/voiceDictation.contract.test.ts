/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Los dos cargos de superficie de la espina de escucha de E9
 * (paso 1), como contratos sobre la fuente en la forma de la
 * casa (PC no tiene arnés de componentes: cobran la cadena,
 * no el gesto en vivo; su fragilidad queda declarada aquí
 * como en chatWiring.contract.test.ts):
 *
 *   1. El dictado se enseña antes de enviar: el gesto del
 *      composer aplica el texto de la sesión con setDraft y
 *      en su región no hay envío alguno (ni send ni
 *      turnSend): lo dictado se revisa y lo manda la persona.
 *   2. El turno de voz pasa por el mismo enrutador y el
 *      mismo juez que el de texto: hay exactamente UNA
 *      puerta de turno (nido:turn-send) en los servicios, y
 *      la sección de canales de voz no toca el cauce del
 *      turno (ni runOneTurn ni turn-send): la voz no tiene
 *      atajo ni respuesta propia.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSrc = readFileSync(
  fileURLToPath(new URL("../src/App/App.tsx", import.meta.url)),
  "utf8",
);
const servicesSrc = readFileSync(
  fileURLToPath(new URL("./services.ts", import.meta.url)),
  "utf8",
);

/** La región entre dos marcas de la fuente. */
function region(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("el dictado en el composer (E9 paso 1)", () => {
  it("el dictado se enseña en el borrador antes de enviar, sin envío en su gesto", () => {
    const gesto = region(
      appSrc,
      "const toggleDictation = useCallback",
      "// La semilla de la guía",
    );
    expect(gesto).toContain("startListening()");
    expect(gesto).toContain("setDraft(");
    expect(gesto).not.toContain("turnSend");
    expect(gesto).not.toMatch(/[^a-zA-Z]send\(/);
    // El botón existe solo con la escucha presente (oferta y UI).
    expect(appSrc).toContain("voiceAvailable ? (");
    expect(appSrc).toContain("toggleDictation()");
  });

  it("el turno de voz entra por la misma puerta que el tecleado: una sola nido:turn-send y la voz sin atajos", () => {
    const puertas = servicesSrc.match(/handle\("nido:turn-send"/g) ?? [];
    expect(puertas).toHaveLength(1);
    const voz = region(
      servicesSrc,
      "// La voz (E9 paso 1): el dictado vive en su proceso propio",
      "\n}\n",
    );
    expect(voz).toContain("nido:voice-dictation-start");
    expect(voz).not.toContain("runOneTurn");
    expect(voz).not.toContain("turn-send");
    expect(voz).not.toContain("turnSend");
  });
});
