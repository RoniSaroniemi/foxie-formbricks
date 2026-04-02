# Foxie Fork of Formbricks

This repository is a fork of [Formbricks](https://github.com/formbricks/formbricks).

**Upstream base:** v3.17.1 (commit 0bcd85d)
**Fork date:** 2026-03-19
**Licence:** AGPLv3 (inherited from upstream)

## Changes from upstream

All changes from the upstream base are documented here as they are made.
Each entry includes: file changed, what changed, and why.

| Date | File | Change | Reason |
|------|------|--------|--------|
| 2026-03-19 | apps/web/modules/ee/license-check/lib/utils.ts | `getIsContactsEnabled()` now returns `true` unconditionally | Required for Foxie session identity — contactId must flow through responses without an enterprise key |
| 2026-03-19 | apps/web/app/api/(internal)/pipeline/route.ts | Added Foxie gateway completion signal call to responseFinished handler | Required for Temporal workflow to receive completion events |
| 2026-03-19 | apps/web/lib/foxie/completion-signal.ts | New file — async completion signal sender with exponential backoff retry (1s/5s/30s) | Isolated gateway call, non-blocking to pipeline handler |
| 2026-04-02 | packages/types/surveys/types.ts | Added `RepeatingGroup` enum value and repeating-group survey schemas/types | New SDK question type for target-based accordion surveys |
| 2026-04-02 | packages/surveys/src/components/general/question-conditional.tsx | Added repeating-group routing and broadened value/update typing for composite-key question data | Required to render and update the new question type safely |
| 2026-04-02 | packages/surveys/src/components/questions/repeating-group-question.tsx | New file — accordion UI, target iteration, standalone child-question rendering, template replacement, and unlisted-target handling | Core repeating-group implementation for Phase B |
| 2026-04-02 | apps/web/playwright/repeating-group.*.spec.ts | Added Playwright operational verification flows for harness and real-survey evidence capture | Required runtime proof with screenshots and payload artifacts |
| 2026-04-02 | playwright.repeating-group.config.ts | Added dedicated Playwright config for repeating-group verification | Isolated screenshot/evidence flow from existing app E2E suite |
| 2026-04-02 | scripts/run-repeating-group-verification.mjs | Added verification runner that builds surveys, installs Chromium, and executes Playwright evidence runs | One-command operational verification entry point |
