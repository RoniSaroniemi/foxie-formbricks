# Experimental Brief — Formbricks Repeating Group Rendering

**Date:** 2026-03-19
**Status:** Ready for agent execution
**Track:** Phase A, Experimental Branch (parallel with canonical layer sprint and fork setup)
**Type:** Investigation — not production implementation
**Output:** Findings document, not working feature

---

## What This Is

This is a thinking-and-building investigation. The goal is to understand how the Formbricks SDK can accommodate a repeating group question element, and to produce concrete evidence about which implementation path is viable.

**The code produced in this brief is throwaway.** Write the minimum needed to test a hypothesis. Do not refactor, do not write tests, do not make it pretty. The deliverable is the findings document — not the code.

This brief exists because the repeating group is the most structurally novel part of Foxie's survey experience and the one place where the Formbricks fork may require deep changes. Understanding the cascade depth before the real implementation begins is what this investigation produces.

---

## What the Repeating Group Actually Is

Before touching any code, understand the target experience. This is what you are investigating how to build.

### Visual reference

The repeating group is a **single survey card** containing:

1. A top-level title and subtext (e.g. "How have our experts performed?")
2. A list of named evaluation targets — each rendered as a **collapsible accordion row**
   - Each row has: a chevron (expand/collapse), the target's name, and a checkbox (skip toggle)
   - When expanded: the full question set renders inside the row
   - Question text may contain template tags resolved to the target's data (e.g. the person's name)
3. An **"Other..."** row at the bottom — a special unlisted addition mechanism
   - Clicking it opens a text input for entering a name
   - Confirming the name expands the same question set for that unlisted target
   - Unlisted targets have a remove button (⊖) — named targets cannot be removed

### The question set inside each accordion row

Two to three questions typically. Example from current implementation:
- A 1-5 rating question: "How well has collaboration with this person met expectations?"
- An open text question: "What are their strengths and where could they improve?"

The **same question set** repeats for every target. Answers are tagged by which target they belong to — this is the `eval_target_association_id` in Foxie's data model.

### What makes this structurally different from standard Formbricks

Standard Formbricks renders one question at a time (or multiple on one page in MQP mode) in a **sequential flow**. Navigate forward → next question. Navigate back → previous question.

The repeating group is an **accordion on a single card**. All targets visible simultaneously. The respondent expands whichever target they want to answer, fills in the questions, collapses it, moves to the next target. Navigation arrows move between the repeating group card and the next survey question — not between individual target answers.

This is the core structural tension the investigation must resolve.

---

## Reference Documents

Read these before starting Part 1.

| Document | What to read | Why |
|---|---|---|
| `context-for-portal-poc-agent.md` | Section 6 — minimal surface section, component dependency tree | Understand the SDK component hierarchy before forming hypotheses |
| `universal-portal-decision-and-poc-scope.md` | Section 4 and Section 6 | Understand the fork strategy and why the approach must be sustainable |
| `M4-canonical-data-layer-contracts-draft.md` | Section 1.24 (`evaluation_target_assignment`) | Understand what `eval_target_association_id` is and why it matters for answer tagging |

### Key source files to read before Part 1 analysis

All paths relative to the Formbricks fork repository root.

| File | Lines | What to understand |
|---|---|---|
| `packages/surveys/src/components/general/survey.tsx` | 39-97 | State machine: how `Survey` manages question navigation |
| `packages/surveys/src/components/general/question-conditional.tsx` | 1-50 | How question type routing works — this is where a custom type would be registered |
| `packages/surveys/src/components/wrappers/stacked-cards-container.tsx` | 13-33 | How the card layout works — relevant for whether an accordion can live on one card |
| `packages/surveys/src/lib/survey-state.ts` | 3-24, 78-94 | What state the SDK tracks per question — relevant for how iteration state could be added |
| `packages/surveys/src/lib/response-queue.ts` | 45-113 | How answers are accumulated and submitted — relevant for composite answer structure |
| `packages/types/formbricks-surveys.ts` | 7-66 | Full `SurveyContainerProps` interface — what the SDK accepts from the portal shell |

Setup confirmation: use the Formbricks fork repository from the fork setup brief. Confirm UMD bundle builds before starting analysis.

---

## Part 1 — Hypothesis Analysis (analysis only, no code)

Work through each hypothesis by reading source code and reasoning about what changes would be required. For each hypothesis, write a short assessment (one to three paragraphs) covering: what it requires, where the friction is, and how deep the changes go. Record all assessments in the findings document.

**Do not write any implementation code in Part 1.** This is reading and reasoning only.

---

### Hypothesis A — MQP Mode as Foundation

**The idea:** Formbricks already supports multi-question-per-page (MQP) mode — multiple questions render on a single card simultaneously. The repeating group could be built by treating the question set as a page in MQP mode, and finding a way to repeat that page once per target within a single card wrapper.

**Investigate:**

1. How does MQP mode render multiple questions? Find the relevant code path in `survey.tsx` and the wrappers. Does MQP render questions in a list layout, or is it something else?

2. Is there a concept of a "page" or "question group" in the survey definition type? Look at the survey schema in `packages/types/` — specifically how questions are grouped if at all.

3. If you had to render the question set three times on one card (once per target), what would that require in the `Survey` state machine? Would it need to know about iteration? Or could each iteration be represented as a separate "page" that the card renders all at once?

4. What does the response structure look like in MQP mode? Does `ResponseQueue` submit all answers from the page together, or one at a time? Does the question ID uniqueness constraint become a problem when the same question appears multiple times for different targets?

**Hypothesis A is likely insufficient if:** MQP mode renders questions in a flat list without any container structure — because you need a per-target collapsible row, not a flat list. Document exactly why it is or is not sufficient.

---

### Hypothesis B — Custom Question Type

**The idea:** Register a new question type called `repeating_group` in `QuestionConditional`. This component receives the target list as part of its question definition, renders the accordion internally, and submits a composite structured answer. Sub-questions inside each accordion row are rendered directly by importing and using individual question components standalone.

**Investigate:**

1. How does `QuestionConditional` route to question type components? What would adding a new `case` for `repeating_group` require? How many lines of change?

2. Can individual question components (`RatingQuestion`, `OpenTextQuestion`) be imported and used standalone — outside the `Survey` orchestrator? These components currently receive props like `onSubmit`, `onChange`, `currentQuestionId`, `ttc` from `Survey`. If you imported `RatingQuestion` directly into a custom accordion component, what props would you need to provide? Are any of those props deeply tied to the `Survey` state machine in a way that makes standalone use difficult?

3. What does the answer from a `repeating_group` question look like? Each target produces answers to two or three sub-questions. How would this be represented in `Response.data`? Options:
   - A flat map: `{ "q1_target1": value, "q1_target2": value, "q2_target1": value }` — messy but closest to native format
   - A nested object: `{ "repeating_group_1": { "target1": { "q1": value, "q2": value } } }` — cleaner but not a native Formbricks type
   - Multiple separate answer events: one `onResponse` callback per target's answers — each tagged with `eval_target_association_id`

4. Does `SurveyState` need to change? It currently tracks one answer per question ID. If the repeating group is one question, does `SurveyState` need to understand composite answers?

**Hypothesis B is most promising if:** Individual question components can be used standalone with reasonable prop shims, and the answer structure can be represented as multiple separate `onResponse` callbacks (one per target) — because that maps cleanly to Foxie's `eval_target_association_id` tagging model.

---

### Hypothesis C — Hybrid: SDK for Non-Repeating, Custom for Repeating

**The idea:** The survey definition contains normal Formbricks questions before and after the repeating group. The repeating group question ID is present in the survey definition but the SDK is instructed to skip it. The portal shell renders the accordion as a Foxie-owned component entirely outside the SDK container, positioned between the SDK survey panels. When the respondent answers targets in the accordion, the portal shell directly calls the Foxie reporting write endpoint with `eval_target_association_id`-tagged answers. Navigation between the pre-accordion questions, the accordion, and the post-accordion questions is managed by the portal shell — not the SDK.

**Investigate:**

1. Can the SDK be told to skip a specific question ID? Look at `survey.tsx` logic evaluation and the `startAtQuestionId` prop. Is there a supported way to tell the SDK "skip question X in the flow"? Or would skipping require a fork change to the navigation state machine?

2. What does the SDK do when it reaches the "end" of the questions before the repeating group — specifically, does it fire `onFinished` immediately, or can it be kept in a waiting state? This matters for the portal shell's orchestration: the SDK needs to stop at the boundary before the accordion and wait.

3. How would the portal shell merge answers from the SDK (`onResponse` callbacks from regular questions) with answers from the custom accordion component? Both ultimately need to reach the Foxie reporting write endpoint. Is there a clean interface for this, or does it require the portal shell to buffer answers and submit them together?

4. Is this approach truly hybrid, or does it devolve into building a custom survey renderer for everything? If the SDK questions before and after the accordion are simple (NPS, rating, one open text), the SDK does genuine work. If they are complex or numerous, the hybrid becomes a coordination burden.

**Hypothesis C is most promising if:** The SDK can be cleanly stopped at a boundary question and the portal shell can take over rendering for the accordion without the SDK's navigation interfering.

---

## Part 2 — Minimal Experiments

After completing Part 1 analysis, choose the most promising one or two hypotheses and run a minimal experiment for each. The goal is to confirm or disprove the hypothesis with actual code — not to build a full implementation.

**Time limit per experiment: approximately two to three hours of actual implementation work.** If you are still fighting the SDK after three hours, that is itself a finding — document it and stop.

---

### What a minimal experiment looks like

For **Hypothesis A:** Construct a survey definition where the question set (rating + open text) appears three times, representing three targets. Use MQP mode if applicable. Call `renderSurveyInline()` with this definition. Observe: do all three sets render on one card? What does the `onResponse` payload look like? Take a screenshot of what renders.

For **Hypothesis B:** Add a minimal `repeating_group` case to `QuestionConditional` that renders a hardcoded accordion with two targets. Use a simple `<div>` for the accordion — no styling needed. Try importing `RatingQuestion` directly and rendering it inside the accordion. Observe: does it render? What props are required? What TypeScript errors appear? Take a screenshot of what renders.

For **Hypothesis C:** Create a survey with one NPS question before and one open text question after a marker question (e.g. type `repeating_group_placeholder`). Find the skip mechanism. Call the SDK with the survey and observe whether it navigates to the marker and what state it is in. Does the SDK stop cleanly, or does it try to render the placeholder? Can the portal shell detect this state?

---

### Evidence to capture per experiment

For each experiment, save to `evidence/experiment-N/`:

| File | What it contains |
|---|---|
| `hypothesis.txt` | One paragraph: what you expected to happen |
| `attempt.txt` | What you actually tried — specific files changed, specific code written |
| `result.txt` | What actually happened — paste any errors, TypeScript complaints, or rendering issues |
| `screenshot.png` | Screenshot of what rendered (or error screen) |
| `component-tree.txt` | List of files changed and why — even if changes were reverted |

---

## Findings Document

At the end of the investigation, produce `findings.md` in the repository root. This is the primary deliverable.

Structure:

```markdown
# Repeating Group Rendering — Investigation Findings

**Date:** <date>
**Hypotheses tested:** <list>

## What the repeating group requires (confirmed understanding)

<your understanding of the target UX after analysis, corrected by what you discovered>

## Hypothesis A findings

<what you found, what you tested, what it can and cannot do>

## Hypothesis B findings

<what you found, what you tested, what it can and cannot do>

## Hypothesis C findings

<what you found, what you tested, what it can and cannot do>

## Recommended path

<which hypothesis or combination you recommend for the sustainable implementation, and why>

## Component impact estimate

<rough estimate: which files would change, how many, and why — for the recommended path>

## The "Other..." interaction

<specific notes on how the unlisted target addition mechanism would work in the recommended path>

## Answer tagging

<how eval_target_association_id gets attached to answers in the recommended path>

## Open questions for the sustainable implementation

<anything that could not be determined from experimentation and needs further design>
```

---

## Out of Scope

Do not implement any of the following:

- Full accordion styling or visual polish
- Skip/include checkbox per target
- Full question type support — Rating + OpenText is sufficient for all experiments
- Template tag `{{target.name}}` rendering in question text — hardcode the name for experiments
- Integration with Foxie's canonical layer or reporting write endpoint
- The "Other..." interaction beyond noting how it would conceptually work
- Production-quality code in any form
- Tests

---

## Definition of Done

- [ ] Part 1 analysis complete — all three hypotheses assessed in findings document
- [ ] At least one experiment run with evidence captured
- [ ] `findings.md` produced with all sections completed
- [ ] Recommended path stated with concrete reasoning
- [ ] Component impact estimate provided for recommended path
- [ ] Evidence folder populated for each experiment attempted

---

## A Note on the Frankenstein Risk

The current system's repeating group was built as a custom implementation that diverged progressively from the survey tool it was built on. The goal of this investigation is to find the path that minimises that divergence — not to avoid it entirely (some divergence is inevitable and acceptable), but to choose it deliberately rather than accidentally.

If the investigation concludes that all three hypotheses require deep SDK changes and the cleanest path is to render the repeating group entirely outside the SDK, that is a valid and useful finding. It is not a failure. The sustainable implementation built on that finding will be better than one built without it.
