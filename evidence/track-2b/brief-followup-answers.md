# Brief Follow-up Answers: Callback Completion and Workflow Surface

Date: 2026-04-02  
Branch reviewed: `feat/repeating-group-question`

This note answers the five follow-up questions against the current `foxie-formbricks` source and, where available, against the runtime evidence already captured in this repo.

## 1. Callback-only mode confirmation

### Answer

Yes, in the current fork, when `renderSurveyInline()` is used without `appUrl` and `environmentId`, `onFinished` does fire after the repeating-group submit.

This is not just theoretical:
- the callback-only proof harness wires `renderSurveyInline()` with `onResponse` and `onFinished` only, with no `appUrl` or `environmentId`
- the captured harness event log shows:
  - `onResponse` with `finished: true`
  - then `onFinished`

The runtime proof is here:
- [survey-fixture.js](/Users/roni-saroniemi/Github/foxie-formbricks/poc/repeating-group/survey-fixture.js#L114)
- [harness-events.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/harness-events.json#L7)

### Once only?

In the normal respondent flow, yes: it should fire once only.

Reason:
- completion is gated by the effect in [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L549)
- `onBack()` does not reset `isSurveyFinished`, so the same mounted survey instance does not naturally transition back to a non-finished state after completion
- the ending card has no back control; its button only handles redirect/link behavior

Relevant code:
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L173)
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L549)
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L606)
- [ending-card.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/ending-card.tsx#L80)

Important caveat:
- there is no dedicated regression test that simulates a forced post-completion back-navigation and resubmit
- but from the code, a duplicate `onFinished` would require either a remount or an external/manual reset of the completion state

## 2. `onFinished` vs `onResponse` with `finished: true`

### Answer

In callback-only mode, `onResponse` and `onFinished` are two separate signals.

The order is:
1. `onResponse` fires with `finished: true`
2. `onFinished` fires separately after that

This is confirmed both by source and by runtime evidence:
- in callback-only mode, `onResponseCreateOrUpdate()` calls `onResponse(...)` directly and returns early when `!appUrl || !environmentId`
- `onFinished` is fired later by a separate `useEffect` once `isSurveyFinished && isResponseSendingFinished`
- the harness timestamps show `onResponse` first and `onFinished` shortly after

Relevant code:
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L466)
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L549)
- [harness-events.json](/Users/roni-saroniemi/Github/foxie-formbricks/evidence/track-2b/harness-events.json#L7)

Practical implication:
- in callback-only mode, if Milestone 3 posts on `onResponse`, it should check `finished` to avoid treating every partial question submit as completion
- if Milestone 4 also posts on `onFinished`, then yes, double-posting is possible unless one path is treated as authoritative

### Important distinction for backend mode

With `appUrl` and `environmentId` present, the survey runtime does **not** call `onResponse` in the same way.

Instead it:
- queues API persistence through `ResponseQueue`
- calls `onResponseCreated`
- sets `onFinished` only after the finished response has been sent

So the “`onResponse` then `onFinished`” answer is specifically true for callback-only mode, which is the Phase B case you described.

## 3. Survey completion when repeating group is the last question

### Answer

The repeating-group component itself just calls the survey-level `onSubmit(...)` when its button is pressed:
- [repeating-group-question.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/questions/repeating-group-question.tsx#L142)

From there, the behavior depends on whether there is an ending card.

### Case A: repeating group is the last question and there is no ending card

Then:
- submit on the repeating-group card marks the survey finished immediately
- `onResponse` fires with `finished: true` in callback-only mode
- `onFinished` then fires from the completion effect

There is no extra click after that.

### Case B: repeating group is the last question before an ending screen

Then:
- clicking the repeating-group submit button marks the survey as finished immediately
- `endingId` is set
- `questionId` is advanced to the ending card
- the ending card renders
- `onFinished` fires from the completion effect after the finished state commits

So the completion is logically triggered by the repeating-group submit, not by the ending-screen button.

The ending-screen button only handles redirect/link behavior:
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L575)
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L598)
- [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L689)
- [ending-card.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/ending-card.tsx#L80)

Practical interpretation:
- if you have a simple end screen, the respondent clicks the repeating-group button and lands on that end screen
- `onFinished` is not waiting for the end-screen button click
- by the time `onFinished` fires, the repeating-group answer map has already been assembled and passed through `onResponseCreateOrUpdate(...)`

## 4. Workflow ID surface

### Answer

This cannot be confirmed from the `foxie-formbricks` repository itself.

I could not find `trigger-workflow.ts` or the Temporal workflow start script in this repo, so there is no source here that proves whether the workflow start call returns:
- workflow ID
- run ID
- survey URL

What this repo **does** contain is the intended contract documentation:
- the canonical data layer design says `automation_cycle.temporal_workflow_id` is the stored stable group workflow identifier
- it also says contact-level child workflow IDs are not stored in the canonical data layer

Relevant docs:
- [M4-canonical-data-layer-contracts-draft.md](/Users/roni-saroniemi/Github/foxie-formbricks/docs/foxie/M4-canonical-data-layer-contracts-draft.md#L776)
- [M4-canonical-data-layer-contracts-draft.md](/Users/roni-saroniemi/Github/foxie-formbricks/docs/foxie/M4-canonical-data-layer-contracts-draft.md#L2066)

So the repo-supported answer is:
- this repo expects a stable stored group workflow ID
- this repo does **not** let me verify how `trigger-workflow.ts` obtains it

If that question materially affects the brief, the Temporal-side script or repo needs to be inspected directly.

## 5. Formbricks fork completion signal in callback-only mode

### Answer

No, the pipeline completion signal does not fire in callback-only mode.

Reason:
- in callback-only mode, `Survey` exits early in `onResponseCreateOrUpdate()` after calling `onResponse(...)`
- it does **not** create or update a Formbricks response
- therefore the client response API routes are never hit
- therefore `sendToPipeline(...)` is never called
- therefore the internal pipeline handler and Foxie completion signal path never run

Relevant source:
- callback-only early return:
  - [survey.tsx](/Users/roni-saroniemi/Github/foxie-formbricks/packages/surveys/src/components/general/survey.tsx#L466)
- response persistence path that triggers pipeline only when a Formbricks response is created:
  - [responses route](/Users/roni-saroniemi/Github/foxie-formbricks/apps/web/app/api/v1/client/[environmentId]/responses/route.ts#L155)
- pipeline handler that emits the Foxie completion signal only on `responseFinished`:
  - [pipeline route](/Users/roni-saroniemi/Github/foxie-formbricks/apps/web/app/api/(internal)/pipeline/route.ts#L214)

So for Phase B callback-only mode, the completion paths are:
- `onResponse` with `finished: true`
- `onFinished`

And the completion path that is **not** active is:
- Formbricks persistence → internal pipeline → Foxie completion signal

## Short version

- Q1: Yes, callback-only mode fires `onFinished` after repeating-group submit. In normal flow it fires once.
- Q2: In callback-only mode, `onResponse({ finished: true })` happens first, then `onFinished` fires separately.
- Q3: If there is an end screen, repeating-group submit triggers completion and advances to the ending card; `onFinished` does not wait for the end-screen button click.
- Q4: Not confirmable from this repo; `trigger-workflow.ts` is not here.
- Q5: No, the backend pipeline completion signal does not run in callback-only mode.
