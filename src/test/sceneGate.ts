import { existsSync } from "node:fs";

/** ¿La corrida declara que los recursos de la casa no
 *  publicados (GGUF de models/, papeles internos) pueden
 *  faltar? Solo la pone el workflow público de Nido008. */
export const ALLOW_MISSING_RESOURCES =
  process.env.NIDO_TEST_ALLOW_MISSING_RESOURCES === "1";

/**
 * La puerta de escena: devuelve true cuando los recursos
 * no están Y la corrida declaró el salto (la suite se
 * salta con aviso nombrado). Con los recursos presentes
 * devuelve false y todo corre. Sin recursos y sin
 * declaración, lanza: el fallo ruidoso de siempre, con el
 * mensaje que nombra la variable (la forma de llama.cpp).
 */
export function sceneSkipped(suite: string, resources: string[]): boolean {
  const missing = resources.filter((p) => !existsSync(p));
  if (missing.length === 0) return false;
  if (ALLOW_MISSING_RESOURCES) {
    console.warn(
      `[sceneGate] SALTO DECLARADO · ${suite}: faltan ` +
        `${missing.join(", ")} (recursos de la casa no ` +
        `publicados). Con los ficheros presentes esta suite ` +
        `corre entera; el salto lo declara ` +
        `NIDO_TEST_ALLOW_MISSING_RESOURCES=1.`,
    );
    return true;
  }
  throw new Error(
    `${suite}: faltan los recursos de escena: ` +
      `${missing.join(", ")}. En la casa deben estar; en ` +
      `un clon sin ellos, declara ` +
      `NIDO_TEST_ALLOW_MISSING_RESOURCES=1 para saltar ` +
      `esta suite de forma declarada.`,
  );
}
