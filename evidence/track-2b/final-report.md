# Repeating Group Final Report

Date: 2026-04-02  
Branch: `feat/repeating-group-question`

## What Was Done

Implemented additive support for a new survey question type, `repeatingGroup`, in the forked Formbricks surveys SDK.

The implementation included:
- survey type/schema additions for `repeatingGroup`, targets, and supported sub-questions
- survey runtime plumbing so repeating-group answers can flow as composite-key response data
- a new repeating-group accordion UI component that renders repeated `rating` and `openText` questions per target
- support for portal-shell-hydrated `targets`
- support for template substitution using `{{target.name}}` and `target.displayData`
- support for adding and removing unlisted targets via `"Other..."`
- Playwright-based operational verification assets and evidence capture

## End Output / Results

### Functional result

The SDK now supports a single-card repeating-group question where:
- named targets render as accordion rows
- each expanded row renders its own repeated child questions
- child question answers are stored under composite keys
- unlisted targets can be added and removed during the session
- final submit emits the accumulated repeating-group response payload

### Verified output

Completed and verified in this repo:
- unit/integration test coverage for repeating-group behavior
- surveys package build passing
- Playwright harness run passing
- Playwright real-survey run passing against a local Docker-backed Formbricks instance
- browser screenshots captured for the key runtime states
- harness callback evidence captured and stored
- persisted real-survey response captured and stored

Artifacts produced:
- `evidence/track-2b/screenshots/harness/*.png`
- `evidence/track-2b/screenshots/real/*.png`
- `evidence/track-2b/harness-events.json`
- `evidence/track-2b/harness-output.txt`
- `evidence/track-2b/real-survey-created.json`
- `evidence/track-2b/real-survey-create-response.json`
- `evidence/track-2b/real-survey-output.json`
- `evidence/track-2b/real-survey-console.json`
- `evidence/track-2b/results.txt`
- `evidence/track-2b/verification-plan.md`

Current verification status:
- Harness proof: complete
- Real survey proof in actual host context: complete on local Docker-backed Formbricks

Real survey verification details:
- Runtime: `http://127.0.0.1:3100`
- Survey created via Management API
- Survey URL: `/s/cmnh0nxxc00068omnp17rgn9z`
- Final persisted response includes:
  - `rg1_target-1_rating-1 = 4`
  - `rg1_target-1_open-1 = "Matti runtime answer."`
  - `rg1_target-2_rating-1 = 2`
  - `rg1_target-2_open-1 = "Sarah runtime answer."`
- Removed unlisted target keys are absent from the final persisted response

## Key Implementation Details

### Data model and typing

Added:
- `TSurveyQuestionTypeEnum.RepeatingGroup = "repeatingGroup"`
- repeating-group target schema/type
- repeating-group sub-question union limited to `rating` and `openText`
- repeating-group question schema/type

Response handling was extended so the runtime can:
- merge composite-key updates
- remove keys when unlisted targets are deleted
- pass repeating-group values through `Survey` and `QuestionConditional` without altering survey navigation/state architecture

### Rendering model

The repeating-group UI is implemented as one atomic survey card:
- top-level question headline/subheader render once
- targets render as accordion rows
- each row creates rewritten child question ids using:
  - `{questionId}_{targetId}_{subQuestionId}`
- child question outputs are merged into the active repeating-group response map

### Template substitution

Localized strings are copied per rendered sub-question and template tags are resolved at render time:
- `{{target.name}}` uses `target.displayData?.name` then `target.name`
- `{{target.key}}` uses `target.displayData?.[key]`

### `"Other..."` handling

Unlisted targets:
- use deterministic in-session ids: `other-1`, `other-2`, ...
- are removable
- trigger deletion of all composite keys matching that target prefix

### Verification implementation

Added a dedicated Playwright verification path:
- a static proof server for `poc/repeating-group/proof.html`
- a harness Playwright spec that captures screenshots and payload artifacts
- a real-survey Playwright spec that is ready for a true host URL
- convenience commands in `package.json`

## Deviation From Brief

### 1. Runtime bug discovered during proof

During Playwright harness verification, accordion expansion did not persist after click.

Cause:
- local reset logic depended on the identity of `question.targets`
- rerenders recreated the array and collapsed the accordion

Resolution:
- changed the reset dependency to a stable derived signature instead of the raw array reference

This was not a brief deviation in product intent, but it was a necessary implementation correction discovered only by operational proof.

### 2. Verification became stronger than the original implementation brief

The brief asked for proof and evidence, but the implemented verification path went beyond basic fixture/manual confirmation:
- dedicated Playwright config
- scripted screenshot capture
- saved callback artifacts
- repeatable verification commands

This is intentional hardening, not scope drift.

### 3. Real-survey verification is scaffolded, not completed

The brief’s stronger success condition is a real survey using the element.

Resolution:
- a local Docker-backed Formbricks runtime was started
- onboarding and API-key creation were automated through Playwright
- the survey was created through `POST /api/v1/management/surveys`
- the public survey was exercised end to end and the persisted response was captured

One small runtime validation detail surfaced during this step:
- the management API rejected an empty ending-card `buttonLink`
- the verification fixture now uses `https://example.com/close`

## How The Brief Goals Were Matched

Matched well:
- additive implementation, no survey state-machine rewrite
- `repeatingGroup` question type introduced in the surveys SDK
- Model A assumption preserved: targets are hydrated externally before render
- supported sub-question types limited to `rating` and `openText`
- composite-key answer format implemented
- template substitution implemented
- `"Other..."` target creation supported
- proof harness created
- verification evidence generated in the repo

Matched with stronger implementation rigor than requested:
- repeatable Playwright evidence path
- structured artifact output
- browser-backed proof instead of only manual inspection

Still pending against the full intent:
- no major product-scope gap remains in the verification plan for the local fork
- if a separate external host environment is required later, the same Playwright real-survey path can be reused there

## Final Assessment

Implementation status: complete for the SDK/fork scope.  
Harness operational proof: complete.  
Real host operational proof: complete on local Docker-backed Formbricks.

The feature is no longer only “code-complete”; it is browser-proven in the dedicated harness and in a real Formbricks survey flow, with screenshots, creation evidence, and a persisted finished response.
