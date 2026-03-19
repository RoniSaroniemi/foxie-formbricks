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
