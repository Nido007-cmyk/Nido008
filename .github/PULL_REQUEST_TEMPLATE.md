# NIDO PC Pull Request Template

## What changed
<!-- One or two sentences. Link issues with "Closes #123" when it applies. -->

## Why
<!-- The problem this solves, in plain words. -->

## Checklist
- [ ] `npm run typecheck` passes for the core (`src/`)
- [ ] `npm run typecheck` passes in `app/` when the shell changed
- [ ] `npm test` passes, or the failures are pre-existing and named below
- [ ] New behavior has tests, including a negative test for anything security shaped
- [ ] User facing text follows the human tone rule (natural sentences, no em dashes) and exists in English, Spanish and Portuguese
- [ ] Privacy principles respected (fully offline, no telemetry, no accounts)
- [ ] Anything not actually run is declared as unproven below, never presented as tested
- [ ] No breaking changes to encrypted storage or saved data, or the migration is described below

## Testing
<!-- How did you test this? Machine and operating system? Unit tests only?
     Say plainly what was NOT run. -->

## Screenshots
<!-- For interface changes, before and after. -->

## Notes
<!-- Anything a reviewer should know: tradeoffs, follow ups, known gaps. -->
