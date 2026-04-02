# Repeating Group Live Testing Final Report

Date: 2026-04-02  
Branch: `feat/repeating-group-question`

## Scope

This report covers the live testing phase for the `repeatingGroup` implementation in the forked Formbricks runtime.

The purpose of this phase was to move beyond build/test confirmation and prove that:
- a real survey containing a `repeatingGroup` question can be created in Formbricks
- the survey renders and operates correctly in the browser
- answers persist through the actual survey response path
- Playwright can capture visual and data evidence for the full run

## Environment

Live testing was executed against a local Docker-backed Formbricks instance.

Runtime used:
- App URL: `http://127.0.0.1:3100`
- Backing services: local Postgres + Valkey via `docker-compose.dev.yml`
- Browser runner: Playwright Chromium

Survey under test:
- Survey ID: `cmnh0nxxc00068omnp17rgn9z`
- Public URL: `/s/cmnh0nxxc00068omnp17rgn9z`

## What Was Executed

The live test run executed the real survey path end to end:
- started the local Formbricks runtime
- completed authenticated setup needed for survey creation
- created a real link survey through `POST /api/v1/management/surveys`
- loaded the public survey URL in Chromium via Playwright
- answered the repeating-group card for two named targets
- added and answered one unlisted `"Other..."` target
- removed the unlisted target before submit
- submitted the survey
- fetched the persisted finished response through the management responses API

## Runtime Scenario

The survey used one `repeatingGroup` question with:
- 2 named targets:
  - `Matti Virtanen`
  - `Sarah Smith`
- repeated sub-questions:
  - `rating`
  - `openText`
- unlisted target support through `"Other..."`

The Playwright flow verified:
- initial render of the repeating-group card
- target accordion expansion
- template substitution for `{{target.name}}`
- independent answers for target 1 and target 2
- add/remove flow for an unlisted target
- successful final submit and end screen

## Evidence Captured

Visual evidence:
- [01-real-survey-initial-render.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/01-real-survey-initial-render.png)
- [02-real-survey-first-target.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/02-real-survey-first-target.png)
- [03-real-survey-second-target.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/03-real-survey-second-target.png)
- [04-real-survey-other-target.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/04-real-survey-other-target.png)
- [05-real-survey-other-removed.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/05-real-survey-other-removed.png)
- [06-real-survey-final-state.png](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/screenshots/real/06-real-survey-final-state.png)

Creation and runtime artifacts:
- [real-survey-created.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/real-survey-created.json)
- [real-survey-create-response.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/real-survey-create-response.json)
- [real-survey-output.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/real-survey-output.json)
- [real-survey-console.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/real-survey-console.json)

## Verified Results

### Survey creation

Pass:
- the management API accepted the real survey payload
- the created survey includes the `repeatingGroup` question and its nested structure

### Browser behavior

Pass:
- the real public survey loaded successfully
- the repeating-group card rendered in the actual survey flow
- named targets expanded correctly
- repeated `rating` and `openText` questions rendered under each target
- `{{target.name}}` text resolved correctly for each rendered target
- the unlisted target flow worked in runtime
- removing the unlisted target updated the active response state
- submit reached the ending screen successfully

### Persisted response proof

Pass:
- the final stored response was retrieved after submission
- the final persisted payload contains:
  - `rg1_target-1_rating-1: 4`
  - `rg1_target-1_open-1: "Matti runtime answer."`
  - `rg1_target-2_rating-1: 2`
  - `rg1_target-2_open-1: "Sarah runtime answer."`
- removed unlisted-target keys do not appear in the persisted final response

TTC proof:
- the stored response includes:
  - `rg1: 2165`
  - `_total: 2165`

## Issue Found During Live Test

One real runtime validation issue surfaced during survey creation:
- an ending card with an empty `buttonLink` is rejected by the management API

Resolution used for the live test:
- the verification fixture now uses `https://example.com/close` as a non-empty placeholder link

This did not change the `repeatingGroup` implementation itself. It was a survey-fixture correction required by the host API contract.

## Assessment Against Live Testing Goal

The live testing goal was to prove operational behavior in a real survey, not just in a local proof harness.

That goal was met:
- the feature ran inside an actual Formbricks survey
- the survey was created through the real management API
- the survey executed in Chromium as a public survey page
- final answers were persisted and retrieved from the real response path
- screenshots and data artifacts were captured for the run

## Final Verdict

Live testing status: `PASS`

The `repeatingGroup` feature is operationally verified in:
- the proof harness
- a real local Formbricks survey flow

This phase closes the gap between code-level confirmation and runtime proof. The feature now has end-to-end browser and persistence evidence, not just implementation evidence.
