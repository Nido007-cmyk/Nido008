Language: English · [Español](CONTRIBUTING.es.md)

# Contributing to NIDO PC

Thanks for wanting to help. NIDO PC is a privacy-first desktop
assistant: everything runs on the user's machine, offline, with no
accounts and no telemetry. Contributions are welcome when they
keep that promise intact.

## Ground rules

- **Privacy is not negotiable.** No feature may send user data
  anywhere, add telemetry or analytics, or require an account. If
  a change needs the network for anything beyond the downloads the
  user explicitly approves (models and knowledge packs, verified
  by hash), it does not belong here.
- **Clean room.** This repository is original code under NIDO's
  own MIT license. Do not bring in code copied from other
  assistants or from the mobile line's upstream history. Ideas and
  behavior can be discussed; code is written here.
- **Every contribution arrives under the MIT license** of this
  repository (see [LICENSE](LICENSE)).
- **The sealed thresholds stay sealed.** Retrieval and grounding
  constants, security posture and data formats change only with a
  measured defect, a minimal change and a regression test that
  proves the fix.

## How to contribute

1. Open an issue first for anything larger than a small fix, so
   the shape of the change is agreed before code is written.
2. Work in a branch and open a pull request against `main`.
   Releases enter only through pull requests with green CI.
3. Run the battery before you ask for review:

   ```sh
   npm install
   npm test
   npm run typecheck
   ```

4. In the pull request, say what you tested, with what evidence,
   and what remains untested. Green tests alone do not prove a
   change works on a real machine; say so when that is the case.

## Writing

- User-facing text ships in the three languages of the app
  (English, Spanish, Portuguese) in the same change. Translations
  are written to sound natural in their own language, never word
  for word from another one.
- Plain, human tone: write like a person, in the first person
  where the app speaks for itself, with no marketing filler.

## How reports are handled

We read every report. Anything that can be fixed gets fixed and
lands in a later version; we do not promise dates. Before each
version, the open bug reports in this repository are read in full:
the ones we can reproduce are confirmed against the app and the
fixable ones enter that version's work. If a report cannot be
reproduced, we will ask for the missing detail, and the report
form tells you which detail that usually is.

To report a bug, use the bug report form. The app itself can
prepare a diagnostics summary for you: in the app, open Settings,
then About, and use **Report a problem**. The app prepares the
text on your machine and sends nothing; you review it, copy it and
paste it into the form.

Security vulnerabilities never go in a public issue: see
[SECURITY.md](SECURITY.md) for the private channel.
