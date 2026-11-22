/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-21 (0.1.99, núcleo del juez): el contexto semántico de la caza
 * 0197, para que la batería ejerza las puertas semánticas en el
 * régimen en el que producción las sirve (perfil multilingüe activo).
 *
 * El fixture (`__fixtures__/caza0197-contexto.json`) guarda los
 * vectores e5 del GGUF servido (el mismo fichero que la app descarga,
 * verificado por sha256 en la tanda T-20) de cada texto de la caza
 * — preguntas, chunks enteros y cláusulas de fuentes y respuestas —
 * incrustados con llama.cpp y la receta del perfil (prefijos
 * «query: »/«passage: »), segmentados con las funciones del propio
 * juez (splitSentences tras stripInvalidCitations y
 * splitClausesWithSep): la alineación que usableSemanticContext
 * valida en cada llamada. Los vectores van cuantizados a int16 por
 * vector (escala = máximo/32767; el error de coseno resultante,
 * ~1e-5, queda muy por debajo de los márgenes más finos de las
 * puertas) y las similitudes pregunta→chunk van en float32 exacto.
 *
 * Sin entrada en el fixture (los casos sin fuentes, de contrato),
 * devuelve undefined y la batería juzga como sin contexto.
 *
 * Recreación de PC (E3, tanda 10 · J-9): réplica fiel de la fuente
 * 0.1.108 (73 líneas); su diff contra la fuente es solo esta nota y
 * la extensión `.js` de su importación del tipo. La fixture que lee
 * es la copia byte a byte sellada de la del árbol 0.1.108
 * (2.124.870 B, sha256 6af3d865…e4e), sin regeneración. Su
 * verificación vector a vector contra el e5 que PC sirve corrió en
 * esta misma tanda (scripts/j9VerificacionFixture.ts) y NO cobró:
 * la parada de J-9 cerró con dirimen escrito en el CHECKPOINT,
 * certificado por VERIFICACION-J9, y el re-cobro de la puerta en
 * la forma (c)+(d) de ese dirimen se detuvo con hallazgo (con la
 * geometría servida el residuo era 7, no 4), asentado en el
 * CHECKPOINT. La tanda 10C ejecutó la calibración firmada sobre
 * el dirimen de TIE2 (SEM_TIE_EPS 0,05 → 0,042) y la puerta
 * quedó cobrada en su forma final: esta fixture sostiene la
 * pierna (a) con el residuo re-firmado en 7 y fieles rotas 0, y
 * la geometría servida cobra su propio residuo de 5 con fieles
 * rotas 0 por el instrumento de la pierna (d).
 */
import { readFileSync } from "node:fs";
import type { JudgeSemanticContext } from "./semanticContext.js";

interface FixtureCaso {
  sims: number[];
  chunks: number[][];
  respuestas: number[][];
}

interface Fixture {
  dim: number;
  escalas: number[];
  vectoresB64: string;
  casos: Record<string, FixtureCaso>;
}

let cache: { fixture: Fixture; vectores: Float32Array[] } | null = null;

function carga(): { fixture: Fixture; vectores: Float32Array[] } {
  if (cache) return cache;
  const ruta = new URL("./__fixtures__/caza0197-contexto.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(ruta, "utf8")) as Fixture;
  const bytes = new Uint8Array(Buffer.from(fixture.vectoresB64, "base64"));
  const enteros = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const dim = fixture.dim;
  const vectores: Float32Array[] = fixture.escalas.map((escala, v) => {
    const out = new Float32Array(dim);
    for (let d = 0; d < dim; d++) out[d] = enteros[v * dim + d]! * escala;
    return out;
  });
  cache = { fixture, vectores };
  return cache;
}

/** El contexto semántico de un caso de la caza, o undefined si no tiene. */
export function contextoCaza0197(id: string): JudgeSemanticContext | undefined {
  const { fixture, vectores } = carga();
  const caso = fixture.casos[id];
  if (!caso) return undefined;
  return {
    chunkClauseVectors: caso.chunks.map((cls) => cls.map((v) => vectores[v]!)),
    answerClauseVectors: caso.respuestas.map((cls) => cls.map((v) => vectores[v]!)),
    questionChunkSims: Float32Array.from(caso.sims),
    profileId: "multilingual-e5-small",
  };
}
