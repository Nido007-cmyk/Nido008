/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El manifiesto de la capa de búsqueda: un ADAPTADOR sobre el
 * catálogo de E0 (`src/core/catalog.ts`), que sigue siendo la
 * única fuente de verdad de modelos de la casa. Este módulo no
 * declara ningún modelo: expone las entradas del catálogo con la
 * forma que las piezas portadas del móvil consumen
 * (`CatalogModel`), para que la capa de búsqueda hable el idioma
 * de su contrato sin que exista una segunda verdad que pueda
 * divergir (la casa ya pagó la copia gemela sin guarda en el
 * núcleo; aquí la guarda es que no hay copia: cada entrada se
 * deriva de la del catálogo al cargar el módulo).
 *
 * La verdad de PC que este adaptador expone, asentada en la
 * apertura de J-2 (estudios/E3-J2-APERTURA.md §4 y §5.3) y en el
 * dirimen de embeddings:
 *
 *   - Hay DOS entradas de embeddings desde el acto 2A de E4:
 *     el e5 (`multilingual-e5-small-q8`) y la bge
 *     (`bge-small-en-v1.5-q8`), que entró como dato resoluble
 *     por id — que es lo que la batería del interruptor mide —
 *     con sus bytes y su huella verificados en la línea móvil.
 *     Las dos llevan `required: true`, porque el adaptador lo
 *     deriva por clase para todo `kind: "embedding"`; lo que
 *     hace al e5 el modelo de búsqueda por defecto de PC no
 *     es el distintivo, es el orden: `defaultEmbeddingModel()`
 *     devuelve la primera entrada requerida y el e5 va
 *     primero en el catálogo, por el asiento de J-2. La bge
 *     sigue sin oferta en Ajustes y el interruptor sigue sin
 *     encenderse en PC: si algún día se enciende, será una
 *     tanda con su nombre, no un efecto de esta entrada.
 *   - `filename` es el nombre instalado de PC: `models/<id>.gguf`
 *     dentro del directorio de modelos, el mismo nombre que la
 *     vía única de carga resuelve para cada entrada.
 *   - `required` vale `false` para las entradas `llm` en esta
 *     capa: qué modelo de generación propone cada máquina lo
 *     decide la escalera de defaults del propio catálogo
 *     (`defaultModelForBudget`), no el manifiesto de búsqueda.
 *   - Alineación al móvil, cierre R2: la cadena de presupuesto
 *     del móvil (inference/ramBudget, memoryLadder,
 *     models/compatibility y defaultModel, routing/profiles) se
 *     adopta tal cual y lee del manifiesto la arquitectura, el
 *     contexto por defecto y las capacidades. La forma gana esos
 *     tres campos opcionales del manifiesto móvil, con sus tipos
 *     copiados. `arch` se deriva de la arquitectura del catálogo
 *     (`ModelSpec.arch`: layers, kvHeads, headDim), la misma
 *     verdad sin copia. El catálogo de PC no declara contexto por
 *     defecto: queda ausente, que el contrato del móvil lee como
 *     «sin valor propio». De las capacidades: la tanda 14 porta la
 *     curación del manifiesto móvil para los modelos que los dos
 *     catálogos comparten (tabla CURATED_CAPABILITIES, abajo, con
 *     su procedencia); los modelos solo de escritorio quedan sin
 *     capacidades declaradas, que el contrato lee como «aún no
 *     evaluado». Su curación NO es trabajo de E4: es la forma del
 *     adaptador, con sede en J-2 (dirimen de la tanda 14 sobre el
 *     conflicto que el refresco de la preparación de E4 asentó:
 *     el móvil no trae dato alguno para esos modelos, así que
 *     curarlos sería juicio nuevo, no un acto de datos).
 */

import { DESKTOP_CATALOG } from "../core/catalog.js";
import type { ModelCapabilities } from "../routing/types.js";

export type AssetKind = "llm" | "embedding" | "corpus";

/** La forma que las piezas portadas consumen (la del manifiesto móvil). */
export interface CatalogModel {
  id: string;
  kind: AssetKind;
  label: string;
  /** Nombre instalado, relativo al directorio de modelos. */
  filename: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string;
  /** Revisión fijada del publicador a la que se verificó la entrada. */
  revision?: string;
  license: string;
  description: string;
  /** Debe estar presente para que la app se pueda usar; el modelo por defecto de su clase. */
  required: boolean;
  /**
   * Which adaptive-routing roles this model is hand-curated as suitable
   * for (see src/routing/types.ts's ModelCapabilities doc comment — a
   * maintainer's judgment call based on parameter count/class, not a
   * benchmark result). Absent/undefined for entries added before this field
   * existed — routing resolution must treat "no capabilities" as "not yet
   * assessed", never assume a role.
   */
  capabilities?: ModelCapabilities;
  /**
   * Transformer architecture profile for the RAM pre-flight
   * (src/inference/ramBudget.ts): layer count, GQA KV-head count and head
   * dimension drive the KV-cache term. Verified against the model's
   * config.json. When absent, the pre-flight falls back to the bundled
   * default's profile — fine for the catalog's historical entries, but every
   * model that can become the active default MUST declare it.
   */
  arch?: { nLayer: number; nKvHeads: number; headDim: number };
  /**
   * Recommended llama.cpp context length for this model. The engine uses it
   * when the caller doesn't pass an explicit nCtx (see LlamaEngine.load).
   * Smaller models ship with a smaller default: context is the second
   * biggest RAM term after the weights, and short on-device chat doesn't
   * need 4k.
   */
  defaultNCtx?: number;
}

/**
 * La curación de capacidades del manifiesto móvil (0.1.108), portada
 * en la tanda 14 para los modelos que los dos catálogos comparten:
 * es el juicio del mantenedor sobre el papel de cada modelo, y la
 * verdad base de ese juicio es el móvil. Los modelos que solo
 * existen en el catálogo de escritorio no aparecen aquí: quedan
 * «aún no evaluados»; su curación tiene sede en J-2 (la forma del
 * adaptador), no en E4.
 */
const CURATED_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  "qwen3-0.6b-q4km": { roles: [], usesChatTemplate: true, noThink: true, sampling: { topP: 0.8, topK: 20 } },
  "qwen2.5-1.5b-instruct-q4km": { roles: ["fast"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  "qwen2.5-7b-instruct-q4km": { roles: ["reasoning", "verifier"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  "lfm2.5-8b-a1b-q4km": {
    roles: [],
    usesChatTemplate: true,
    stripReasoning: true,
    minGenerationTokens: 2048,
    sampling: { temperature: 0.2, topK: 80, repeatPenalty: 1.05 },
  },
  "gemma-4-e4b-it-q4_0": { roles: [], sampling: { topP: 0.95, topK: 64 } },
  "multilingual-e5-small-q8": { roles: ["embedding"] },
};

export const MODEL_CATALOG: CatalogModel[] = DESKTOP_CATALOG.map((entry) => ({
  id: entry.id,
  kind: entry.kind,
  label: entry.label,
  filename: `models/${entry.id}.gguf`,
  sizeBytes: entry.fileBytes,
  sha256: entry.sha256,
  sourceUrl: entry.sourceUrl,
  revision: entry.revision,
  license: entry.license,
  description: entry.note,
  required: entry.kind === "embedding",
  capabilities: CURATED_CAPABILITIES[entry.id],
  arch: { nLayer: entry.arch.layers, nKvHeads: entry.arch.kvHeads, headDim: entry.arch.headDim },
}));

/**
 * The download URL pinned to `revision` for branch-pointer sources (copia
 * del manifiesto móvil 0.1.108, lógica pura).
 */
export function pinnedSourceUrl(asset: CatalogModel): string {
  if (!asset.revision) return asset.sourceUrl;
  return asset.sourceUrl
    .replace("/resolve/main/", `/resolve/${asset.revision}/`)
    .replace(
      /^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)main\//,
      `$1${asset.revision}/`
    );
}
