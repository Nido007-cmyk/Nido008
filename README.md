> **Language:** English · [Español](README.es.md)

<p align="center">
  <img src="app/public/mascot-nido.png" alt="NIDO mascot" width="120">
</p>

<h1 align="center">NIDO PC</h1>

<p align="center"><b>Your agent, your world, on your computer.</b><br>
A private AI assistant for desktop that runs 100% offline on your own machine.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://github.com/Nido007-cmyk/Nido008/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Nido007-cmyk/Nido008/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows-3A563F">
</p>

NIDO PC is a private personal assistant for desktop that runs large
language models on your own machine, 100% offline after the initial
download. No accounts, no telemetry, no cloud. Your conversations,
notes, reminders and personal documents live in an encrypted local
database that only your password opens. It shares the soul of the
[NIDO mobile app](https://github.com/Nido007-cmyk/Nido) and adds what
a computer unlocks: larger models by default, long contexts, and the
full tool catalog always present.

**The model is for conversation. The help is not.**

> **In development.** NIDO PC is not finished and there is no public
> release yet. This repository is its public home: the source code is
> published as it is built, as a snapshot of the current development
> state. When the first alpha is ready, it will be published in
> [Releases](https://github.com/Nido007-cmyk/Nido008/releases) with
> its installer and its verification hash.

## What it does today

- **Chat with a large local model.** Pick from a catalog of open
  models sized for your machine, from small and fast to 7B and 8B
  class models on machines with the memory for them. NIDO tells you
  plainly what fits your computer and what does not.
- **Answers checked against sources.** A grounding judge checks
  what the model claims against the sources at hand, sentence by
  sentence, and each answer carries a badge that says how it was
  checked.
- **Official knowledge packs.** Local knowledge packs (the NIDO and
  SALVORA packs, the same ones the mobile app uses) answer from
  verified local content with no network at all.
- **Your own documents.** Import your documents and ask about them;
  answers cite the document and the page.
- **Deep research.** Give NIDO a hard question and it breaks it
  down into sub-questions, searches your knowledge packs and your
  documents for each one, and puts every claim through the
  grounding judge before it reaches you. You see the plan and its
  estimated cost before anything runs, and you can edit it. The
  report comes in four styles and stays saved in the app, and if
  you close NIDO in the middle of a run, the session resumes
  where it stopped when you come back.
- **Memory, calendar and reminders on your machine.** What NIDO
  remembers for you, your calendar and your contacts live inside
  the app, encrypted, and never sync anywhere.
- **Calendar and contacts move with you.** Import and export
  your calendar and contacts as standard .ics and .vcf files,
  with a preview of what will change before anything is written.
- **Scheduled tasks.** Create tasks that run later or on a schedule,
  inside the app, and read their results when you come back.
- **A built-in guide.** The Learn section inside the Library
  teaches every feature with examples you can tap, written only
  for what the app really does.
- **Voice on your device.** Dictate your messages and have
  answers read aloud, in English, Spanish and Portuguese, with
  speech models that run entirely on your machine.
- **Three languages.** The whole interface speaks English, Spanish
  and Portuguese.

## Watch

A first look at NIDO PC running, recorded during development:
the [sneak peek video](https://github.com/Nido007-cmyk/Nido008/issues/1),
in this repo's first issue (2 minutes).

## Install

There is nothing to install yet: no installer is published while
the app is in development. The first alpha will ship as a Windows
installer from this repo's Releases page, published next to a
`.sha256` file so you can verify your download before opening it:

```bat
certutil -hashfile NIDO-PC-Setup-0.1.0.exe SHA256
```

Windows will show a SmartScreen notice because the installer
carries no commercial code-signing certificate. That is expected,
and it is a decision, not an oversight: NIDO PC is free and open
source, and its guarantee is the open code plus the matching hash,
not a purchased signature.

Until then, the way to run NIDO PC is to build it from source,
below.

## Privacy and security

- Everything runs on your machine. After the downloads you approve
  (models and knowledge packs, each verified by its hash), the app
  needs no network and opens no listening ports.
- No accounts, no telemetry, no analytics, nothing phones home.
- Your data is stored encrypted. Lose the password and the data is
  gone: there is no recovery, by design.
- The full statement is in [PRIVACY.md](PRIVACY.md), and how to
  report a vulnerability privately is in
  [SECURITY.md](SECURITY.md).

## Status

NIDO PC is in active development, version 0.1.0. The code in this
repository is a snapshot of the development branch taken on
2026-11-23. Working today: the chat, the model catalog with its
verified downloads, the encrypted memory, the calendar, contacts
and reminders, calendar and contact import and export in .ics
and .vcf, scheduled tasks, the document library, on-device
voice (dictation and read-aloud), deep research with its saved
reports and the built-in guide. In development right now: the
last stage of the first version, on the way to the first alpha.

At the last verified milestone, the test battery ran 7,365 tests:
7,352 passing, 13 expected failures and no unexpected failures.

NIDO PC is early alpha software. It can fail, and it will change.
What every version promises is fewer failures than the one before
it, and release notes that say plainly what got better.

## NIDO on your phone

NIDO also lives on Android, with the same promise: fully offline,
private, no accounts. Get the current Android release,
[v0.1.112-alpha](https://github.com/Nido007-cmyk/Nido/releases/tag/v0.1.112-alpha),
from the mobile repository.

## Build from source

```sh
npm install
npm test            # the full test battery (the core, src/)
npm run typecheck   # typecheck the core
npm run catalog     # per-machine-class catalog verdicts
npm run probe       # engine smoke test from the terminal
```

The desktop shell lives in `app/`:

```sh
cd app
npm install
npm run typecheck
npm run build:vite  # build the app
npm run dist:dir    # package it, unpacked, with electron-builder
```

The public architecture overview lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The rules for
contributing are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project layout

- `src/`: the core of the app (agent, retrieval, grounding,
  models, security), shared logic with no platform code.
- `app/`: the desktop shell (Electron), its services and the
  interface.
- `scripts/`: the public build and verification scripts (the
  catalog report, the engine probe and the knowledge-pack
  library the tests use).
- `knowledge-packs/`: the official packs this app accepts.
- `assets/`: the bundled packs and the retrieval corpus the app
  ships with.
- `docs/`: the project's constitution and principles, and the
  architecture overview.

## Contributing

Bug reports and feedback from testers are the most useful contribution right
now. Please use the issue templates: the app's own "Report a problem" opens
the same door. For code, read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md) first.

## Credits and license

NIDO PC is original code, written from scratch for the desktop,
under NIDO's own MIT license. The mobile line's history and
attributions live in the mobile repository. Third-party components
keep their own licenses, which will be listed in each release's
notices file once releases begin; the AI models you download
keep their own licenses too, and the app never redistributes
model weights: you download each model from its publisher.

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 NIDO contributors.
