/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Catálogo de modelos de NIDO PC v1 — datos, no código de nadie:
 * cada entrada trae su tamaño exacto, su arquitectura (del config
 * público del publicador) y su licencia, verificados en la fuente el
 * 2026-11-16. Las cuentas de RAM NO viven aquí: salen de la
 * matemática de src/core/ram.ts aplicada a cada máquina, para que la
 * cifra que ve la persona sea la de su PC y no una media inventada.
 *
 * Criterio de inclusión: licencia apta para el uso de NIDO (el
 * usuario descarga el modelo de su publicador; NIDO no redistribuye
 * pesos), GGUF Q4_K_M servido por el publicador o su cuenta oficial,
 * y arquitectura soportada por llama.cpp.
 */

import type { ModelSpec } from "./ram.js";

export interface CatalogEntry extends ModelSpec {
  label: string;
  kind: "llm" | "embedding";
  license: string;
  /** URL del publicador; la descarga inicial es la única red de NIDO. */
  sourceUrl: string;
  /** Revisión (commit de HF) a la que se verificaron tamaño y licencia. */
  revision: string;
  /**
   * sha256 del fichero, OBLIGATORIO y en formato válido (64 hex).
   * Regla de la casa, heredada del móvil: sin huella válida no hay
   * entrada en el catálogo — nunca se declara «sin hash» como estado
   * válido. Lo vigila src/core/catalog.test.ts sobre el catálogo
   * entero, y la sonda verifica fail-closed antes de cargar nada.
   */
  sha256: string;
  /** Papel en la escalera de defaults por RAM. */
  role: "light" | "balanced" | "strong" | "fast-moe" | "alternative" | "search";
  note: string;
}

export const DESKTOP_CATALOG: readonly CatalogEntry[] = [
  {
    id: "qwen3-0.6b-q4km",
    label: "Qwen3-0.6B (Q4_K_M)",
    kind: "llm",
    fileBytes: 396_705_472,
    arch: { layers: 28, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 32768,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf",
    revision: "50968a4468ef4233ed78cd7c3de230dd1d61a56b",
    sha256: "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a",
    role: "light",
    note: "El ligero: el mismo modelo que la línea móvil usa de activo. En PC es el suelo para máquinas de 8 GB o con la RAM ocupada, y el modelo de las pruebas de esta casa.",
  },
  {
    id: "qwen2.5-0.5b-instruct-q4km",
    label: "Qwen2.5-0.5B-Instruct (Q4_K_M)",
    kind: "llm",
    fileBytes: 397_808_192,
    arch: { layers: 24, kvHeads: 2, headDim: 64, vocab: 151936 },
    maxContext: 32768,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/41ba88dbac95fed2528c92514c131d73eb5a174b/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
    revision: "41ba88dbac95fed2528c92514c131d73eb5a174b",
    sha256: "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653",
    role: "light",
    note: "El suelo ligero: es el modelo que la línea móvil usa de defecto en los aparatos pequeños (su LIGHT_LLM_ID), con los bytes verificados de aquella línea. En PC no es el defecto de ninguna clase (la escalera por presupuesto empieza en el Qwen3-0.6B); entra porque la cadena de defecto adoptada lo nombra por id, y como opción mínima para máquinas muy justas.",
  },
  {
    id: "qwen2.5-1.5b-instruct-q4km",
    label: "Qwen2.5-1.5B-Instruct (Q4_K_M)",
    kind: "llm",
    fileBytes: 986_048_768,
    arch: { layers: 28, kvHeads: 2, headDim: 128, vocab: 151936 },
    maxContext: 32768,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc66189c7641e1ddd226b8267a9119b2ce2d4/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    revision: "9eadc66189c7641e1ddd226b8267a9119b2ce2d4",
    sha256: "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
    role: "balanced",
    note: "El 1.5B de la generación Qwen2.5: en la tableta del dueño es el «Default» marcado «Too heavy» por la política de teléfono; en PC es una opción ligera más, y uno de los peldaños de la escalera de pruebas de esta casa.",
  },
  {
    id: "qwen3-1.7b-q4km",
    label: "Qwen3-1.7B (Q4_K_M)",
    kind: "llm",
    fileBytes: 1_107_409_472,
    arch: { layers: 28, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf",
    revision: "d7f544eead698dbd1f15126ef60b45a1e1933222",
    sha256: "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897",
    role: "balanced",
    note: "El equilibrio para máquinas de 8 GB: generación nueva de Qwen3, con contexto amplio de sobra.",
  },
  {
    id: "qwen3-4b-instruct-2507-q4km",
    label: "Qwen3-4B-Instruct-2507 (Q4_K_M)",
    kind: "llm",
    fileBytes: 2_497_281_120,
    arch: { layers: 36, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    revision: "a06e946bb6b655725eafa393f4a9745d460374c9",
    sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
    role: "balanced",
    note: "El default de las máquinas de 16 GB: 4B denso de la generación 2507, el salto claro sobre todo lo que un teléfono puede cargar.",
  },
  {
    id: "qwen2.5-7b-instruct-q4km",
    label: "Qwen2.5-7B-Instruct (Q4_K_M)",
    kind: "llm",
    fileBytes: 4_683_074_240,
    arch: { layers: 28, kvHeads: 4, headDim: 128, vocab: 151936 },
    maxContext: 32768,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/8911e8a47f92bac19d6f5c64a2e2095bd2f7d031/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    revision: "8911e8a47f92bac19d6f5c64a2e2095bd2f7d031",
    sha256: "65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423",
    role: "strong",
    note: "Uno de los dos de la foto del dueño: «Too heavy» en su tableta, en PC es el default fuerte de 16 GB en adelante. El de mayor razonamiento del catálogo móvil, con roles de razonamiento y verificación ya asignados en aquella línea.",
  },
  {
    id: "lfm2.5-8b-a1b-q4km",
    label: "LFM2.5-8B-A1B (Q4_K_M)",
    kind: "llm",
    fileBytes: 5_155_564_768,
    arch: { layers: 24, kvHeads: 8, headDim: 64, vocab: 128000 },
    maxContext: 32768,
    license: "LFM Open License v1.0",
    sourceUrl:
      "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/49c14831707011e64d70b2ebd8462ba08d608434/LFM2.5-8B-A1B-Q4_K_M.gguf",
    revision: "49c14831707011e64d70b2ebd8462ba08d608434",
    sha256: "4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0",
    role: "fast-moe",
    note: "El otro de la foto del dueño. MoE de 8B con ~1,5B activos por token: el más rápido de la evaluación de la casa en móvil (~15 tok/s en un teléfono de 12 GB). Su arquitectura declarada es cota conservadora: solo 6 de sus 24 capas son de atención, así que la KV real es ~4× menor que la estimada — se declara, no se esconde. Ojo a su licencia: no es Apache; el uso comercial está limitado a entidades bajo 10 M USD de ingresos anuales (§5) y NIDO lo descarga del repo de LiquidAI, nunca lo redistribuye. Razona antes de responder: su cadena se retira del texto asentado, como en el móvil.",
  },
  {
    id: "gemma-4-e4b-it-q4_0",
    label: "Gemma 4 E4B IT (QAT Q4_0)",
    kind: "llm",
    fileBytes: 5_154_941_280,
    arch: { layers: 42, kvHeads: 2, headDim: 320, vocab: 262144 },
    maxContext: 32768,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf",
    revision: "4b4a2c1d584be7264f87aac328a1bc739ce81b6c",
    sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
    role: "alternative",
    note: "La alternativa de Google, GGUF oficial con cuantización QAT. Su KV por token es la más pesada del catálogo (headDim 320): la matemática lo cobra entero.",
  },
  {
    id: "qwen3-8b-q4km",
    label: "Qwen3-8B (Q4_K_M)",
    kind: "llm",
    fileBytes: 5_027_783_488,
    arch: { layers: 36, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf",
    revision: "7c41481f57cb95916b40956ab2f0b139b296d974",
    sha256: "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
    role: "strong",
    note: "El fuerte moderno (estudio de catálogo grande, 2026-11-16): misma clase que el Qwen2.5-7B de la foto, una generación después, Apache puro. Default fuerte con presupuestos altos. Su KV es pesada (36 capas × 8 cabezas): la cuenta lo cobra entero.",
  },
  {
    id: "qwen3-14b-q4km",
    label: "Qwen3-14B (Q4_K_M)",
    kind: "llm",
    fileBytes: 9_001_752_960,
    arch: { layers: 40, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/530227a7d994db8eca5ab5ced2fb692b614357fd/Qwen3-14B-Q4_K_M.gguf",
    revision: "530227a7d994db8eca5ab5ced2fb692b614357fd",
    sha256: "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
    role: "strong",
    note: "El peldaño denso intermedio: verde solo en 32 GiB, amarillo a 16k en 16 GiB, rojo en 8 (sus pesos solos superan ese presupuesto).",
  },
  {
    id: "qwen3-32b-q4km",
    label: "Qwen3-32B (Q4_K_M)",
    kind: "llm",
    fileBytes: 19_762_149_024,
    arch: { layers: 64, kvHeads: 8, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/Qwen/Qwen3-32B-GGUF/resolve/938a7432affaec9157f883a87164e2646ae17555/Qwen3-32B-Q4_K_M.gguf",
    revision: "938a7432affaec9157f883a87164e2646ae17555",
    sha256: "efd971561896866f0e910cce52761ca77b1b138090c7f15fe284676d57d1f689",
    role: "strong",
    note: "El techo denso: ni en 32 GiB sale verde (amarillo a 16.384); en esa clase manda el MoE 30B-A3B-2507, que sí es verde a 32.768. Entra para quien prefiera denso a MoE, con su amarillo declarado.",
  },
  {
    id: "qwen3-30b-a3b-q4km",
    label: "Qwen3-30B-A3B (Q4_K_M)",
    kind: "llm",
    fileBytes: 18_556_686_240,
    arch: { layers: 48, kvHeads: 4, headDim: 128, vocab: 151936 },
    maxContext: 40960,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/ggml-org/Qwen3-30B-A3B-GGUF/resolve/5e715e4820c9800095ca3e0b217139ceb2ba38f0/Qwen3-30B-A3B-Q4_K_M.gguf",
    revision: "5e715e4820c9800095ca3e0b217139ceb2ba38f0",
    sha256: "642a1eda167db5f55de673cbd19fd8b4aac69c766d01bdbeaf5820f457c7790d",
    role: "alternative",
    note: "El MoE original de 30B (3,3B activos por token), con modo pensamiento híbrido. Su variante Instruct-2507 es la preferida para chat; esta queda para quien quiera la generación original.",
  },
  {
    id: "qwen3-30b-a3b-instruct-2507-q4km",
    label: "Qwen3-30B-A3B-Instruct-2507 (Q4_K_M)",
    kind: "llm",
    fileBytes: 18_556_686_752,
    arch: { layers: 48, kvHeads: 4, headDim: 128, vocab: 151936 },
    maxContext: 262144,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF/resolve/eea7b2be5805a5f151f8847ede8e5f9a9284bf77/Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
    revision: "eea7b2be5805a5f151f8847ede8e5f9a9284bf77",
    sha256: "6c997b8af17debdfb01d890214400ccbab00db6acc0ba8da5de1cc906c4774d0",
    role: "strong",
    note: "El recomendado del peldaño 32 GiB (estudio de catálogo grande): el modelo de chat más capaz que esa clase carga en verde a 32.768, sin modo pensamiento y sin condiciones de licencia. Default de las máquinas de 32 GiB.",
  },
  {
    id: "mistral-small-3.1-24b-q4km",
    label: "Mistral Small 3.1 24B Instruct (Q4_K_M)",
    kind: "llm",
    fileBytes: 14_333_910_496,
    arch: { layers: 40, kvHeads: 8, headDim: 128, vocab: 131072 },
    maxContext: 128000,
    license: "Apache-2.0",
    sourceUrl:
      "https://huggingface.co/bartowski/mistralai_Mistral-Small-3.1-24B-Instruct-2503-GGUF/resolve/f73dfd9e812922fb503a993e3fa5671424f486d3/mistralai_Mistral-Small-3.1-24B-Instruct-2503-Q4_K_M.gguf",
    revision: "f73dfd9e812922fb503a993e3fa5671424f486d3",
    sha256: "c5743c1bf39db0ae8a5ade5df0374b8e9e492754a199cfdad7ef393c1590f7c0",
    role: "alternative",
    note: "La alternativa europea de 24B, solo para 32 GiB: en 16 GiB sale rojo por la política de presupuesto de la casa (sus pesos solos superan el presupuesto tras la reserva), declarado sin maquillar. Apache-2.0 verificado en la fuente; su sucesor Small 3.2 NO entra hasta verificar el LICENSE de su repo (posible conflicto de metadatos señalado por una auditoría externa).",
  },
  {
    id: "phi-4-q4km",
    label: "Phi-4 (Q4_K_M)",
    kind: "llm",
    fileBytes: 9_053_114_816,
    arch: { layers: 40, kvHeads: 10, headDim: 128, vocab: 100352 },
    maxContext: 16384,
    license: "MIT",
    sourceUrl:
      "https://huggingface.co/bartowski/phi-4-GGUF/resolve/19cd65f97c2f1712a81c506611d3f9c94b16a1e1/phi-4-Q4_K_M.gguf",
    revision: "19cd65f97c2f1712a81c506611d3f9c94b16a1e1",
    sha256: "009aba717c09d4a35890c7d35eb59d54e1dba884c7c526e7197d9c13ab5911d9",
    role: "alternative",
    note: "El razonador MIT de 14B para máquinas de 16 GiB, donde el Qwen3-14B solo llega en amarillo. Su límite real, declarado: contexto máximo de 16.384, la mitad del techo de su clase.",
  },
  {
    id: "llama-3.1-8b-instruct-q4km",
    label: "Llama 3.1 8B Instruct (Q4_K_M)",
    kind: "llm",
    fileBytes: 4_920_739_232,
    arch: { layers: 32, kvHeads: 8, headDim: 128, vocab: 128256 },
    maxContext: 131072,
    license: "Llama 3.1 Community License",
    sourceUrl:
      "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/bf5b95e96dac0462e2a09145ec66cae9a3f12067/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    revision: "bf5b95e96dac0462e2a09145ec66cae9a3f12067",
    sha256: "7b064f5842bf9532c91456deda288a1b672397a54fa729aa665952863033557c",
    role: "alternative",
    note: "ENTRA CONDICIONADO (estudio de catálogo grande): su licencia no es OSI. Uso comercial libre por debajo de 700 millones de usuarios activos mensuales; la ficha del modelo en la app debe enseñar la atribución «Built with Llama», el acuerdo y la Acceptable Use Policy de Meta, y la descarga oficial es con puerta (la aceptación es de la persona ante Meta). Alternativa, nunca default: a igual tamaño, Qwen3-8B es Apache puro y posterior.",
  },
  {
    id: "gemma-3-12b-it-q4km",
    label: "Gemma 3 12B IT (Q4_K_M)",
    kind: "llm",
    fileBytes: 7_300_575_264,
    arch: {
      layers: 48,
      kvHeads: 8,
      headDim: 256,
      vocab: 262144,
      slidingWindowLayers: 40,
      slidingWindowTokens: 1024,
    },
    maxContext: 131072,
    license: "Gemma Terms of Use",
    sourceUrl:
      "https://huggingface.co/bartowski/google_gemma-3-12b-it-GGUF/resolve/648e3a36a77c8a9f12d86e741f9dcb9089c769c4/google_gemma-3-12b-it-Q4_K_M.gguf",
    revision: "648e3a36a77c8a9f12d86e741f9dcb9089c769c4",
    sha256: "fc57f67efa46d711c346e587cbef7d049e95f3df8db2eb2271153343ef0acc7b",
    role: "alternative",
    note: "ENTRA CONDICIONADO: Gemma Terms of Use (no es la Apache de Gemma 4): la Gemma Prohibited Use Policy viaja con el modelo y la ficha debe enseñarla; la descarga oficial es con puerta y la aceptación es de la persona ante Google. Su atención es híbrida (40 de 48 capas con ventana de 1.024): la matemática la modela desde la extensión de ArchProfile, con su KV real, no con la cota.",
  },
  {
    id: "gemma-3-27b-it-qat-q4_0",
    label: "Gemma 3 27B IT QAT (Q4_0)",
    kind: "llm",
    fileBytes: 15_617_974_272,
    arch: {
      layers: 62,
      kvHeads: 16,
      headDim: 128,
      vocab: 262144,
      slidingWindowLayers: 52,
      slidingWindowTokens: 1024,
    },
    maxContext: 131072,
    license: "Gemma Terms of Use",
    sourceUrl:
      "https://huggingface.co/bartowski/google_gemma-3-27b-it-qat-GGUF/resolve/8c31a52c0476b564d0f9a9da2a5f3e759d1fd6a8/google_gemma-3-27b-it-qat-Q4_0.gguf",
    revision: "8c31a52c0476b564d0f9a9da2a5f3e759d1fd6a8",
    sha256: "4f1e32db877a9339df2d6529c1635570425cbe81f0aa3f7dd5d1452f2e632b42",
    role: "alternative",
    note: "ENTRA CONDICIONADO, como su hermano de 12B (Gemma Terms, política de usos prohibidos en la ficha, aceptación ante Google). GGUF QAT oficial convertido por bartowski. Con su KV real híbrida (52 de 62 capas en ventana de 1.024) es verde en 32 GiB; con la fórmula sin híbrida habría salido rojo en todas las clases: por eso la matemática se extendió antes de cablearlo.",
  },
  {
    id: "multilingual-e5-small-q8",
    label: "multilingual-e5-small (Q8)",
    kind: "embedding",
    fileBytes: 132_441_664,
    arch: { layers: 12, kvHeads: 12, headDim: 64, vocab: 250002 },
    maxContext: 512,
    license: "MIT",
    sourceUrl:
      "https://github.com/Nido007-cmyk/Nido/releases/download/knowledge-packs-v2/multilingual-e5-small-q8_0.gguf",
    revision: "knowledge-packs-v2",
    sha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde",
    role: "search",
    note: "El modelo de búsqueda: embeddings multilingües (es/en/pt) para los paquetes de conocimiento y los documentos de la persona. Es el mismo con el que la línea móvil incrusta sus paquetes, así que un paquete vale en las dos casas. Procedencia: GGUF convertido por la casa desde intfloat/multilingual-e5-small @ 614241f622f53c4eeff9890bdc4f31cfecc418b3 (cos ≥ 0,999 contra el original); este repo alojará su propia copia al publicarse.",
  },
  {
    id: "bge-small-en-v1.5-q8",
    label: "bge-small-en-v1.5 (Q8_0)",
    kind: "embedding",
    fileBytes: 36_806_944,
    arch: { layers: 12, kvHeads: 12, headDim: 32, vocab: 30522 },
    maxContext: 512,
    license: "MIT",
    sourceUrl:
      "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf",
    revision: "d32f8c040ea3b516330eeb75b72bcc2d3a780ab7",
    sha256: "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514",
    role: "search",
    note: "El modelo de búsqueda original de la línea móvil (33M, solo inglés), con sus bytes verificados allí y su huella ya conocida en PC como perfil. Entra como dato resoluble por id, que es lo que la batería del interruptor mide; no pasa a ser el modelo de búsqueda de PC, que sigue siendo el e5 multilingüe, ni se ofrece en la superficie: si algún día el interruptor se enciende en PC, será una tanda con su nombre.",
  },
];

/**
 * La escalera de defaults de escritorio, por presupuesto disponible
 * (no por RAM bruta: manda la cuenta de ram.ts). El usuario siempre
 * puede elegir otro; esto es solo lo que la instalación propone.
 * Cada peldaño está fijado donde su modelo sale VERDE en el techo de
 * su clase (la recomendación del estudio de catálogo grande,
 * recogida: Qwen3-8B como fuerte moderno y el 30B-A3B-2507 como
 * default del peldaño de 32 GiB):
 *
 *  - < 2 GiB de presupuesto: el ligero (0.6B).
 *  - < 4 GiB: el 1.7B.
 *  - < 6,5 GiB: el 4B 2507.
 *  - < 10,5 GiB: el Qwen2.5-7B de la foto (verde a 32.768 desde
 *    7,4 GiB de presupuesto).
 *  - < 21,7 GiB: el Qwen3-8B (verde a 32.768 desde 10,5 GiB).
 *  - ≥ 21,7 GiB: el 30B-A3B-Instruct-2507 (verde a 32.768).
 */
export function defaultModelForBudget(budgetBytes: number): CatalogEntry {
  const byId = (id: string) => DESKTOP_CATALOG.find((m) => m.id === id)!;
  const G = 1024 * 1024 * 1024;
  if (budgetBytes < 2 * G) return byId("qwen3-0.6b-q4km");
  if (budgetBytes < 4 * G) return byId("qwen3-1.7b-q4km");
  if (budgetBytes < 6.5 * G) return byId("qwen3-4b-instruct-2507-q4km");
  if (budgetBytes < 10.5 * G) return byId("qwen2.5-7b-instruct-q4km");
  if (budgetBytes < 21.7 * G) return byId("qwen3-8b-q4km");
  return byId("qwen3-30b-a3b-instruct-2507-q4km");
}
