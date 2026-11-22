/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contextReserveFit.fixture.ts — FIXTURE DE DATOS de la batería
 * `contextReserveFit` (puerta de J-1, tanda 2 de E3), asentada en la
 * apertura de la tanda según la decisión de puerta de
 * estudios/E3-J1-PUERTA.md §4.2 (patrón de DIRIMEN-EMBEDDINGS:
 * fixture de datos con asiento).
 *
 * `MODEL_CATALOG` trae las 8 entradas `kind: "llm"` del manifiesto
 * móvil del 0.1.108 (`src/models/manifest.ts`), VERBATIM, como tabla
 * de datos de la batería. Lo que esta fixture prueba: que el
 * ensamblado de `pure.ts` cabe para cada entrada chica de la tabla
 * de origen, y (con las constantes de abajo) que las constantes de
 * origen valen lo que la batería afirma. Lo que NO prueba: la
 * verdad del catálogo de PC — el catálogo de PC es el de E0
 * (`src/core/catalog.ts`), con otros ids y otros tamaños, y su
 * acreditación es de E0/E4, no de esta puerta.
 *
 * Las dos constantes viajan con su valor de origen y su cita:
 * `EMERGENCY_CONTEXT = 1024` (`src/inference/memoryLadder.ts:74`
 * del 0.1.108) y `DEFAULT_MAX_TOKENS = 1024`
 * (`src/models/settings.ts:98` del 0.1.108). Son datos de la
 * batería, no varas de PC.
 *
 * El tipo es estructural y mínimo: los campos que las entradas
 * verbatim traen y la batería lee (`id`, `kind`, `sizeBytes`,
 * `defaultNCtx`). El planificador que en el móvil consume esta
 * tabla está DIFERIDO a E4 (ver `diferidosJ1.ts`).
 */
export interface MobileCatalogEntry {
  id: string;
  kind: string;
  label: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string;
  revision?: string;
  license: string;
  description: string;
  required: boolean;
  bundled?: boolean;
  capabilities?: {
    roles?: string[];
    usesChatTemplate?: boolean;
    noThink?: boolean;
    stripReasoning?: boolean;
    minGenerationTokens?: number;
    sampling?: { temperature?: number; topP?: number; topK?: number; repeatPenalty?: number };
  };
  arch?: { nLayer: number; nKvHeads: number; headDim: number };
  defaultNCtx?: number;
}

export const MODEL_CATALOG: MobileCatalogEntry[] = [
  {
    id: "phi-3.5-mini-instruct-q4km",
    kind: "llm",
    label: "Phi-3.5-mini-instruct (Q4_K_M)",
    filename: "models/primary-llm.gguf",
    sizeBytes: 2393232672,
    sha256: "e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5",
    sourceUrl:
      "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above — LFS oid verified via the HF API at
    // that commit. The downloader fetches /resolve/<revision>/, never the
    // mutable /resolve/main/ branch pointer.
    revision: "6d70da17e749a471ccb62ade694486011a75cda3",
    license: "MIT",
    description: "Powerful. Best for complex reasoning and detailed analysis. Slower, uses more storage (~2.4GB).",
    required: false,
    // RAM pre-flight profile (verified against microsoft/Phi-3.5-mini-
    // instruct config.json): 32 layers, plain multi-head attention —
    // 32 KV heads, NO GQA — head dim 96. Its KV cache is the heaviest
    // per token in the catalog (~1.5 GiB at 4096 in fp16): without this
    // declaration the pre-flight fell back to the light default profile
    // and underestimated it ~13x, admitting loads RAM cannot sustain.
    arch: { nLayer: 32, nKvHeads: 32, headDim: 96 },
    defaultNCtx: 4096,
    // usesChatTemplate: it HAS routing roles, so the adaptive executor
    // must give it its own <|user|>/<|assistant|> template like the
    // direct-chat route already does — not the hand-built plain prompt
    // with foreign stop strings.
    capabilities: { roles: ["general", "reasoning"], usesChatTemplate: true },
  },
  {
    id: "qwen2.5-1.5b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-1.5B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-1.5b-instruct-q4km.gguf",
    sizeBytes: 986048768,
    sha256: "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "9eadc66189c7641e1ddd226b8267a9119b2ce2d4",
    license: "Apache-2.0",
    description: "Fast. Perfect for daily tasks. Light and quick, stays on your device (~1.0GB).",
    required: true,
    // RAM pre-flight profile (verified against config.json): 28 layers,
    // GQA with 2 KV heads, head dim 128. Declared so estimateContextBytes
    // uses this model's real architecture instead of the fallback.
    arch: { nLayer: 28, nKvHeads: 2, headDim: 128 },
    // Real-device Phase 9 test ("whats up?" -> a long, rambling,
    // free-associated multi-question response) traced to the app's
    // hand-built "Question: ...\n\nAnswer:" prompt shape being outside
    // Qwen2.5-Instruct's own fine-tuned ChatML template — see
    // routing/types.ts's ModelCapabilities.usesChatTemplate doc comment.
    capabilities: { roles: ["fast"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  },
  {
    id: "qwen2.5-0.5b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-0.5B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-0.5b-instruct-q4km.gguf",
    sizeBytes: 397808192,
    sha256: "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-10-05): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API at
    // that commit). The downloader fetches /resolve/<revision>/, never the
    // mutable /resolve/main/ branch pointer.
    revision: "41ba88dbac95fed2528c92514c131d73eb5a174b",
    license: "Apache-2.0",
    description:
      "Light. The fastest on-device chat, for phones with less RAM (~0.4GB). Best for quick everyday questions; weaker at complex reasoning.",
    required: false,
    // RAM pre-flight profile (verified against config.json): 24 layers,
    // GQA with 2 KV heads, head dim 64.
    arch: { nLayer: 24, nKvHeads: 2, headDim: 64 },
    // 4096 para el agent-loop: el system prompt con las 24 herramientas ocupa
    // ~2k tokens, y con n_ctx=2048 el prompt desbordaba antes de generar
    // ("Context is full" en dispositivo, T-contexto-2026-10-06). KV cache:
    // 2*24 capas*2 KV heads*64 head dim*2 bytes*4096 ≈ 48 MiB (+128 MiB de
    // cómputo); sigue cabiendo en teléfonos de gama baja con margen.
    // Qwen2.5 soporta nativamente hasta 32K, así que 4096 no es problema
    // para el modelo ni para llama.cpp/llama.rn.
    defaultNCtx: 4096,
    // Same Qwen2.5 family as the 1.5B default: same ChatML template and
    // stop sequences, so the existing prompt engineering applies unchanged.
    capabilities: { roles: ["fast"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  },
  {
    // P2.1 (2026-10-08): Q5_K_M variant of the 0.5B for the Q4-vs-Q5 A/B.
    // A/B CANDIDATE ONLY — not the shipped default. The shipped default stays
    // LIGHT_LLM_ID (Q4_K_M) until device evidence (npm run eval:device) shows
    // a measurable quality gain worth ~22 MB. LFS oid verified via the HF
    // API at the pinned commit below (same commit as the Q4 entry).
    id: "qwen2.5-0.5b-instruct-q5km",
    kind: "llm",
    label: "Qwen2.5-0.5B-Instruct (Q5_K_M) [A/B]",
    filename: "models/qwen2.5-0.5b-instruct-q5km.gguf",
    sizeBytes: 420086336,
    sha256: "a0a413dcbb4676f21d4c951b98a393324694edb1a20a4f9547d1de8d2919ff3b",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q5_K_M.gguf",
    revision: "41ba88dbac95fed2528c92514c131d73eb5a174b",
    license: "Apache-2.0",
    description:
      "A/B candidate only. Same 0.5B model at higher precision (~5-bit vs ~4-bit); +22 MB over Q4_K_M. Kept out of the default path until the device eval proves a quality gain.",
    required: false,
    // Same arch as the Q4 0.5B (verified against config.json): 24 layers,
    // GQA with 2 KV heads, head dim 64.
    arch: { nLayer: 24, nKvHeads: 2, headDim: 64 },
    // Same n_ctx as the Q4 0.5B so the A/B compares quantization only.
    defaultNCtx: 4096,
    capabilities: { roles: ["fast"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  },
  {
    // 2026-10-12: Qwen3-0.6B, added at the owner's request. The successor
    // generation to the light 0.5B: Apache-2.0 (passes the license audit),
    // official GGUF exists but only at Q8_0 (639 MB — too heavy for the
    // light tier), and bartowski's repo does not answer anonymous HF API
    // calls, so its bytes cannot be verified/pinned the way this catalog
    // requires. unsloth's Q4_K_M is used instead: LFS oid and size
    // verified via the HF API at the pinned commit below.
    // NOT a default and no routing roles yet. Qwen3's chat template
    // thinks by default (<think> blocks): the noThink capability below
    // makes LlamaEngine pass enable_thinking=false on the jinja path
    // (and strip any leaked block from the final text), so it answers
    // directly like the Qwen2.5 models. Remaining caution for the
    // device eval: its KV cache is ~9x heavier per token than
    // Qwen2.5-0.5B's (8 KV heads x 128 head dim vs 2 x 64) — hence
    // defaultNCtx 3072 instead of 4096, and on low-RAM devices the
    // pre-flight will shrink it further. Offered as an optional
    // download ("Select & Use") until the eval proves it earns a
    // default path. Sampling: Qwen's non-thinking recommendation
    // (temp 0.7) matches the existing "chat" preset, so no per-model
    // preset was added.
    id: "qwen3-0.6b-q4km",
    kind: "llm",
    label: "Qwen3-0.6B (Q4_K_M)",
    filename: "models/qwen3-0.6b-q4km.gguf",
    sizeBytes: 396705472,
    sha256: "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a",
    sourceUrl:
      "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
    revision: "50968a4468ef4233ed78cd7c3de230dd1d61a56b",
    license: "Apache-2.0",
    description:
      "New generation of the light model: follows instructions better than Qwen2.5-0.5B at the same size (~0.4GB). Optional download while it is evaluated on real devices.",
    required: false,
    // RAM pre-flight profile (verified against Qwen/Qwen3-0.6B
    // config.json): 28 layers, GQA with 8 KV heads, head dim 128.
    arch: { nLayer: 28, nKvHeads: 8, headDim: 128 },
    defaultNCtx: 3072,
    capabilities: { roles: [], usesChatTemplate: true, noThink: true, sampling: { topP: 0.8, topK: 20 } },
  },
  {
    id: "qwen2.5-7b-instruct-q4km",
    kind: "llm",
    label: "Qwen2.5-7B-Instruct (Q4_K_M)",
    filename: "models/qwen2.5-7b-instruct-q4km.gguf",
    sizeBytes: 4683074240,
    sha256: "65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423",
    sourceUrl:
      "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "8911e8a47f92bac19d6f5c64a2e2095bd2f7d031",
    license: "Apache-2.0",
    description: "Powerful. Strongest reasoning for complex tasks. Needs more resources (~4.7GB).",
    required: false,
    // RAM pre-flight profile (verified against Qwen/Qwen2.5-7B-Instruct
    // config.json): 28 layers, GQA with 4 KV heads, head dim 128. Its
    // KV cache is ~224 MiB at 4096 — without this declaration the
    // pre-flight estimated half of that on the heaviest model we ship.
    arch: { nLayer: 28, nKvHeads: 4, headDim: 128 },
    // Same ChatML family as the 1.5B/0.5B: with routing roles assigned,
    // the adaptive executor must use its real chat template too.
    capabilities: { roles: ["reasoning", "verifier"], usesChatTemplate: true, sampling: { topP: 0.8, topK: 20 } },
  },
  {
    id: "lfm2.5-8b-a1b-q4km",
    kind: "llm",
    label: "LFM2.5-8B-A1B (Q4_K_M)",
    filename: "models/hf-liquidai-lfm2-5-8b-a1b-gguf-lfm2-5-8b-a1b-q4-k-m-gguf.gguf",
    sizeBytes: 5155564768,
    sha256: "4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0",
    sourceUrl: "https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/main/LFM2.5-8B-A1B-Q4_K_M.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "49c14831707011e64d70b2ebd8462ba08d608434",
    license: "LFM Open License v1.0",
    description:
      "Mixture of experts: 8B total, ~1.5B active per token. Fastest in our benchmark (~15 tok/s) and the best reasoning, but it thinks before answering, so give it a bigger answer budget. ~5.2GB.",
    required: false,
    // RAM pre-flight profile (verified against LiquidAI/LFM2.5-8B-A1B):
    // 24 layers but only 6 are attention (GQA 8 KV heads, head dim
    // 64); the naive layers x KV formula therefore OVERestimates its
    // KV ~4x (~192 MiB vs ~48 MiB real at 4096) — a deliberate,
    // documented conservative bound, the safe direction.
    arch: { nLayer: 24, nKvHeads: 8, headDim: 64 },
    // Estudio de modelos (2026-10-12): este modelo es razonamiento
    // puro — cada respuesta abre con <think> y su plantilla no tiene
    // interruptor (verificado; la eval de la referencia del mismo
    // GGUF midió ~85% de la salida en razonamiento y 4/17 respuestas ausentes con
    // presupuestos de 512). Tratamiento: su plantilla propia, la
    // receta oficial de LiquidAI como capa bajo los presets
    // (temp 0.2, top_k 80, rep 1.05), piso de 2048 tokens en las rutas
    // de respuesta final, y la cadena se retira del texto asentado
    // (stripReasoning) para que historial y memoria guarden la
    // respuesta. Sin roles: sigue siendo selección manual.
    capabilities: {
      roles: [],
      usesChatTemplate: true,
      stripReasoning: true,
      minGenerationTokens: 2048,
      sampling: { temperature: 0.2, topK: 80, repeatPenalty: 1.05 },
    },
  },
  {
    id: "gemma-4-e4b-it-q4_0",
    kind: "llm",
    label: "Gemma 4 E4B (QAT Q4_0)",
    filename: "models/hf-google-gemma-4-e4b-it-qat-q4-0-gguf-gemma-4-e4b-q4-0-it-gguf.gguf",
    sizeBytes: 5154941280,
    sha256: "676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee",
    sourceUrl: "https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf",
    // C/F2 (2026-09-28): pinned to the Hugging Face commit whose file bytes
    // match the sha256/sizeBytes above (LFS oid verified via the HF API).
    revision: "4b4a2c1d584be7264f87aac328a1bc739ce81b6c",
    license: "Apache-2.0",
    description: "Private Local. Google's on-device model. Balanced performance and privacy (~5.2GB).",
    required: false,
    // RAM pre-flight profile (verified against google/gemma-4-E4B-it):
    // 42 text layers, 2 KV heads, head dim 320. This is an UPPER BOUND:
    // most layers use a 512-token sliding window and layers share KV,
    // so llama.cpp's real allocation is lower — the naive formula
    // overestimates, which is the safe direction for a pre-flight. Its
    // thinking mode is opt-in via a <|think|> system token this app
    // never sends, so no reasoning handling is needed. Text-only: the
    // catalog ships no mmproj, vision/audio are not supported.
    arch: { nLayer: 42, nKvHeads: 2, headDim: 320 },
    // Google's published sampling (top_p 0.95 / top_k 64) as the
    // under-preset layer. Temperature deliberately NOT declared: the
    // official 1.0 targets open chat; this app's cooler task presets
    // are a product choice for a factual assistant.
    capabilities: { roles: [], sampling: { topP: 0.95, topK: 64 } },
  },
];

/** Valor de origen: `src/inference/memoryLadder.ts:74` (0.1.108). */
export const EMERGENCY_CONTEXT = 1024;

/** Valor de origen: `src/models/settings.ts:98` (0.1.108). */
export const DEFAULT_MAX_TOKENS = 1024;
