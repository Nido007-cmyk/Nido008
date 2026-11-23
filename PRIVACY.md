Language: English · [Español](PRIVACY.es.md)

# Privacy

NIDO PC is built so that your data never has to leave your
computer. This page states, plainly and checkably, what the app
does with your information. The code is open, so every statement
here can be verified in this repository.

## The short version

- No accounts. There is nothing to sign up for and no profile on
  any server.
- No telemetry, no analytics, no crash reporting sent anywhere.
- Everything you create with NIDO PC stays on your machine, in an
  encrypted local database.
- The app opens no listening ports and, after your own downloads,
  uses no network at all.

## What stays on your machine

Conversations, notes, reminders, your calendar, your contacts,
the facts NIDO remembers for you and the personal documents you
import are stored locally and encrypted. The encryption key is
derived from your password and never leaves the device. There is
no sync, no backup service and no cloud copy: we could not read
your data even if we wanted to, because we never receive it.

If you lose your password, your data cannot be recovered. That is
the honest price of this design, and the app says so when you
create your vault.

## The only network the app ever uses

Two downloads, both started by you and both verified against a
published hash before anything is used:

1. **Models.** When you choose to download a model, the app
   fetches it from its publisher's repository. The publisher's
   download service can see the request the way any download
   works; NIDO itself sends no identifier, no account and no
   usage data with it.
2. **Knowledge packs.** The official packs are fetched from the
   project's releases, under the same rule: a plain download, a
   hash check, nothing about you attached.

There are no releases or updates yet: NIDO PC is still in
development and there is nothing to download. When the first
alpha is published, updates will follow the same rule as
everything else in this app: the app will never check for
updates on its own. When you ask it to look, it will read the
releases of this repository, and any update you install will
come from here and be verifiable like the first install.

## What the app never does

- It never uploads your conversations, notes, documents or any
  personal content, to us or to anyone.
- It never builds a profile of you, on the machine or elsewhere,
  beyond the memory you can inspect, edit and delete inside the
  app itself.
- It never contacts an advertising or analytics service.
- It never scans your disk. Documents are read only where you
  point the app, when you import them.

## Diagnostics you choose to share

If something breaks, the app can prepare a short diagnostics
summary on your machine: app version, system, memory and the
model in use. It contains no conversations, notes, names or
documents. Nothing is sent: the app shows you the whole text, and
it only leaves your machine if you copy it and paste it into a
bug report yourself.

## Children, changes and questions

NIDO PC is a general-purpose tool and collects nothing about
anyone, of any age, because it collects nothing at all.

If this policy changes, the change will be visible in this file's
history in this repository. Questions about privacy can be opened
as an issue; anything sensitive belongs in the private channel
described in [SECURITY.md](SECURITY.md).
