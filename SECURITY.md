# Security Policy

NIDO PC is built to run entirely on your own machine: no accounts,
no telemetry, no cloud features, and your personal data lives in a
local encrypted database. Even so, we take security reports
seriously and we want to hear about problems before they can hurt
anyone.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private
vulnerability reporting:

https://github.com/Nido007-cmyk/Nido008/security/advisories/new

Do not open a public issue for a vulnerability, and do not post
exploit details anywhere public before a fix exists. There is no
bug bounty program and no payment for reports; what we offer is a
fix, credit in the release notes if you want it, and our thanks.

## Scope

In scope, because they protect the data on your machine:

- The encryption of the local database and the password lock.
- The verification of model and knowledge pack downloads (hashes,
  the pack manifest signature, and the single load path that checks
  them before anything runs).
- The app opening a listening port or making network connections
  outside the downloads you start.
- Anything that lets content inside the app (a document, a pack, a
  model file) execute code or escape the app's own limits.

Out of scope:

- Issues that require physical access to an unlocked computer, or
  malware already running with your user's permissions.
- The AI model's answers being wrong, rude or unhelpful. That is a
  quality problem, not a vulnerability; please report it as a bug.
- Vulnerabilities in third-party components that do not affect
  NIDO PC in practice; report those upstream, and tell us too if
  NIDO PC ships an affected version.

## Supported versions

NIDO PC is in development and no public release has been published
yet. When releases exist, the supported version is the latest one,
and security fixes land there. On an old version, the fix is to
update.

## What to include in a report

- What the problem is and what an attacker could do with it.
- The NIDO PC version, your operating system, and your machine
  class if it matters.
- Steps to reproduce, or a proof of concept, kept private inside
  the report.
- Anything you already know about a fix, if you do.

## Response expectations

- We acknowledge reports within 5 business days.
- We confirm whether the report is in scope and keep you updated
  while we fix it.
- Fixes are coordinated with you: we agree on a disclosure date
  together, and we credit reporters in the release notes unless
  you prefer to stay anonymous.

## Safe harbor

We consider security research done under this policy to be
authorized. If you act in good faith, avoid privacy violations
and service disruption, and report what you find privately, we
will not pursue legal action over the research itself.

## How NIDO PC is built to be safe

- **No network surface.** After the downloads you approve, the app
  needs no network and opens no listening ports.
- **Verified downloads only.** Every model and pack is checked by
  size and SHA-256 hash against the catalog before the native
  engine ever sees it, through one single load path.
- **Encrypted at rest.** Your conversations, notes, reminders,
  calendar, contacts and documents live in an encrypted local
  database. The key comes from your password and never leaves your
  machine.
- **Signed packs.** The pack door accepts only official NIDO and
  SALVORA packs, verified by hash and by the manifest signature.
- **The agent asks first.** Anything that changes something on
  your machine goes through an explicit confirmation, and every
  tool has its own switch in Settings.

## The trust chain for downloads and packs

Releases will be published with a `.sha256` file so you can verify the
installer before you run it. Knowledge packs are verified the same
way inside the app, and a pack whose hash or signature does not
match is refused, never opened.

## Ground rules

- Never post secrets, keys or private data in a public issue.
- No bug bounty, no payment, and no public disclosure before a
  coordinated date.
- Be gentle with automated scanners against this repository and
  its releases; a hand written report is worth more than a
  thousand scanner hits.
