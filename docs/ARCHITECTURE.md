> **Language:** English · [Español](es/ARCHITECTURE.md)

# NIDO PC architecture

This is the public overview of how NIDO PC is built: the pieces,
the security model and the memory math that decides which models a
given machine can run. It describes the code in this repository as
it stands.

## The shape

NIDO PC has two layers:

- **`src/` — the core.** Platform-free TypeScript: the agent loop,
  the deterministic tool layer, retrieval over local knowledge,
  the grounding judge, the model catalog and its memory math, the
  encrypted stores and the security primitives. The core knows
  nothing about the operating system or the window it runs in.
- **`app/` — the desktop shell.** An Electron app that hosts the
  core: the vault door, the views (chat, library, agenda, models,
  settings), the system services (notifications, tray, the
  scheduling clock) and the single verified door through which
  model and pack files enter the machine.

## The engine

Inference is llama.cpp through node-llama-cpp, running GGUF models
stored on the user's own machine, with precompiled engine binaries
per platform and GPU backends (CUDA, Vulkan, Metal) used when the
machine offers them. One model is loaded at a time; switching
models frees the previous one.

## Whether a model fits is computed, not guessed

A model's working set is accounted in full before anything loads:

```
working set = weights (the whole file)
            + KV cache (2 × layers × context × KV heads × head dimension × bytes per element)
            + compute buffers
            + logits
```

Against that stands the machine's budget: its available memory
minus a reserve of max(2 GiB, 20% of total RAM), capped at 8 GiB.
Context ceilings follow the budget class: 32,768 tokens at a budget
of 8 GiB or more, 16,384 at 4 GiB or more, 8,192 below that, with a
floor of 2,048. If a model only fits degraded, the app says what
was degraded and why; if it does not fit, it says so with the
numbers shown. The verdict the load path reaches is the verdict
the interface shows. The implementation lives in `src/core/ram.ts`
and `src/inference/ramBudget.ts`.

## Security model

- **No network after your downloads.** The only network the app
  uses is the download of models and knowledge packs that the user
  starts, each one verified before it is used. No accounts, no
  telemetry, no analytics, no online license checks, and no
  listening ports (measured: zero sockets in every state).
- **One verified door.** Every model file is checked by exact size
  and sha256 against the catalog in a single function
  (`src/core/loadPath.ts`) before the native parser sees a single
  byte. Downloads land in a `.part` file, are verified, and are
  renamed atomically (`src/core/download.ts`). No URL ever reaches
  the engine.
- **Encrypted local data.** Conversations, notes, reminders,
  calendar, contacts and personal documents live in a local
  encrypted database (SQLCipher). The key is derived from the
  user's password and never leaves the machine; there is no
  recovery, by design.
- **Only official packs.** The pack door accepts only the official
  NIDO and SALVORA knowledge packs, each verified by its hash and
  its manifest signature.
- **The agent asks first.** Actions that change anything go
  through an explicit confirmation, and every tool the agent can
  use has its own switch in Settings.

## Knowledge and grounding

Answers are grounded in local sources: the official knowledge
packs, the documents the user imports and the app's own memory.
Retrieval uses a multilingual embedding model (multilingual-e5)
pinned by hash, and a grounding judge checks what the model claims
against the sources, sentence by sentence; each answer carries a
badge that states how it was checked.

## Languages

The interface and the deterministic layer speak English, Spanish
and Portuguese with full parity across the three: every string
exists in all three, and translations are written to sound natural
in their own language, never word for word.

## Testing

The core carries a full test battery (Vitest) that runs from this
repository (`npm test`), including negative tests for every
security door described above: a model file altered by a single
byte is refused by hash before the parser runs. What a given
machine cannot execute is declared as not executed, never
presented as tested.

## Licenses

NIDO PC is MIT (see [LICENSE](../LICENSE)). llama.cpp and
node-llama-cpp are MIT. Each model keeps its own license, shown on
its card before download; the app never redistributes model
weights.
