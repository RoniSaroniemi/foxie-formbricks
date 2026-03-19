# Universal Feedback Portal — Decision Context and POC Scope

**Date:** 2026-03-11
**Status:** DIRECTION DECIDED — portal as universal container confirmed. Implementation path (fork vs. custom build) pending POC results.
**Next action:** Run the embedding POC described in Section 3 before committing to fork or custom-build path.

---

## 1. What Was Decided and Why

### The decision

The portal is the universal container for all survey-related activity in Foxie. Every feedback interaction — whether from a customer audience, an internal audience, or any future audience type — happens through a single, contact-scoped portal surface. There is no separate "direct survey" experience that bypasses the portal. The portal simply renders with different initial states depending on what is active for that contact.

### Motivations

**Solving the multiple-survey problem.** When a contact has more than one active FeedbackRequest across different automation cycles, there is currently no clean way to present all of them. Without a universal container, each arrives as a separate link with no awareness of the others. The portal solves this structurally: one authenticated session surfaces all active requests, enables completion of one and natural navigation to the next, and shows historical submissions for context.

**Consistent identity model.** The token-based session mechanism already resolves to a contact, a set of active FeedbackRequests, and contextual data. The portal is the natural rendering target for this resolved session. Without the portal, the session payload is resolved and then discarded — used only to pre-fill a survey that then operates without awareness of its own context.

**Unified experience across audience types.** Customer contacts, internal employees, and future audience types (suppliers, board members) currently need different handling. The portal provides a single rendering surface that adapts to the contact's context. An internal employee opening any survey link sees their portal with all active requests across all automation cycles. A customer contact with a single active request sees the portal open directly on that survey. The difference is rendering state, not architecture.

**Foundation for future signal types.** When Foxie adds non-survey signal capture — structured interview summaries, meeting feedback, NPS pop-ups — these should live in the same surface rather than as separate isolated flows. The portal as a universal container means future signal types are additions to an existing surface, not new surfaces that require new identity and session infrastructure.

**Competitive differentiation.** A purpose-built feedback portal that aggregates all relationship signals in one place for each contact is a meaningful product capability. It is not something that emerges naturally from a standalone survey tool. It requires deliberate architectural commitment. The decision to build toward this now, rather than retrofitting later, reflects the same thinking that led to the canonical data model: design for where the product is going, not just where it is today.

### The parallel to Twenty

The reasoning mirrors the Twenty decision: just as building Foxie's data model inside Twenty's constraints would have produced a less capable and less maintainable system, building the feedback experience around a standalone survey tool's assumptions (full-page ownership, no persistent session context, no multi-request aggregation) would produce a less capable experience. The right path is to decide what the experience should be first, then determine how to build it.

---

## 2. Why a POC Is Needed Before Committing to the Build Path

The portal direction is decided. What is not yet decided is whether Foxie gets there by:

**Path A — Fork Formbricks** and componentise its rendering pipeline so the survey renders as an embedded component inside the portal shell, retaining Formbricks' accumulated solutions to browser-specific rendering problems.

**Path B — Custom build** using Formbricks as an inspiration and reference, extracting the core rendering primitives, and building a purpose-designed survey component that was designed from the start to be embedded in a portal context.

Both paths are viable in principle. The choice depends on one empirical question: how deeply does componentising Formbricks' rendering cascade into its core? If the changes are localised and clean, Path A is faster and safer. If they cascade into the rendering architecture, Path B becomes the more honest choice.

This is not a question that can be answered by analysis alone. It requires hands-on investigation of Formbricks' rendering pipeline in the context of the specific embedding requirement.

Additionally, the Step 2 OSS investigation into Formbricks' token-URL resolution seam was commissioned earlier. Those results — specifically on how deep the fork changes would need to go for session context injection — are direct inputs to this decision and should be reviewed alongside the POC findings.

---

## 3. POC Scope

The POC is not a prototype. It does not need to be production-quality, feature-complete, or even visually polished. Its sole purpose is to answer the empirical question above: what does it actually take to make Formbricks survey rendering work as an embedded component inside a portal shell?

### What the POC must answer

**Question 1 — Embeddability.** Can Formbricks' survey rendering be invoked as a component inside a parent container (a portal shell), or does it assume full-page ownership? Does it manage its own routing, its own scroll context, its own viewport sizing in ways that conflict with being embedded?

**Question 2 — Session context injection.** Can an externally-resolved session context (contact ID, FeedbackRequest ID, association list) be passed into the rendering pipeline cleanly, or does the rendering pipeline expect to resolve its own session from a URL token? How deep does the change go?

**Question 3 — Minimal surface.** What is the smallest set of Formbricks components and files required to render a functional survey with per-question saving? Everything else is out of scope. This defines how much of Formbricks would be carried into the fork vs. how much would be discarded.

**Question 4 — Change cascade.** When the embedding changes are made, do they stay localised to the rendering entry points, or do they cascade into question type implementations, the response queue, the persistence layer? The answer determines the ongoing maintenance cost of the fork.

**Question 5 — Known hard problems.** From Formbricks' issue history and PR history: what browser-specific problems has it solved that would need to be re-solved in a custom build? Keyboard navigation, mobile viewport, file upload, accessibility, cross-browser input handling. This is a research task, not an implementation task.

### POC deliverables

Three things to produce — no more:

1. **An embedded survey rendering proof.** A minimal portal shell (a simple div container, not a full portal UI) with a Formbricks survey rendering inside it. One question type (NPS). Per-question save working. Session context passed in from outside rather than resolved from a URL token. The goal is to confirm it works and to measure what changed.

2. **A change log.** Every file in Formbricks that had to be modified, with a one-line description of what changed and why. This is the empirical measure of fork depth.

3. **A known hard problems list.** From issue and PR history: the browser-specific problems that Formbricks has solved. This is the cost of the custom path — what would need to be rediscovered and re-solved.

### What the POC explicitly does not include

- Multi-question surveys
- Full portal UI (listing view, history, navigation)
- All question types
- Reminder or notification logic
- Any backend beyond the minimum needed to test per-question save
- Visual design or branding

### Success criteria

The POC is successful when it can answer all five questions above with evidence rather than inference. It is not successful if it produces a working demo but cannot characterise the change depth or the known hard problems.

---

## 4. Decision Framework After POC

When the POC is complete, the path decision is made against these criteria:

| Criterion | Path A (Fork) is better | Path B (Custom) is better |
|---|---|---|
| Embedding change depth | Changes are localised to rendering entry points | Changes cascade into question types or response queue |
| Minimal surface size | Small — a few hundred lines of rendering logic | Large — thousands of lines of entangled code |
| Known hard problems | Numerous, non-obvious, browser-specific | Few, or well-understood from Formbricks research |
| Session context injection | Clean seam at one injection point | Distributed across multiple layers |
| Ongoing maintenance cost | Low — fork stays close to upstream | High — fork diverges significantly |

If three or more criteria favour Path A, fork. If three or more favour Path B, custom build. If mixed, the deciding factor is the session context injection seam — because that is the change that must be made on every future Formbricks update if the fork path is chosen.

---

## 5. What We Already Know From Prior Investigation

From the M3 Formbricks source investigation and the Step 2 OSS brief, several things are already established that bear on the POC:

**In favour of the fork path:**
- Per-question save is already native. The SDK sends partial updates; the server merges them. This is a significant piece of work that does not need to be rebuilt.
- The answer type system (`ZResponseDataValue`) is clean and well-designed. The four types (text, value, choices, structured) map well to Foxie's answer row schema.
- The JWT payload is extensible — adding `feedbackRequestId` is a localised change confirmed as structurally feasible.
- The diff detection hook point (`updateResponse()` in `service.ts`) is identified. The change is bounded.

**Raising questions about the fork path:**
- The survey rendering was designed as a full-page standalone experience. Whether it componentises cleanly is the key unknown.
- The pipeline handler (`route.ts`) is fire-and-forget. Making the completion signal reliable requires adding retry logic outside the pipeline — not a blocker, but a fork change.
- EE features (personalised contact links) are required for session identity. The fork will need to unlock these, which is straightforward but creates a permanent divergence point from the open-source upstream.

**What the POC will establish** is specifically whether the rendering pipeline componentises — the one remaining empirical unknown.
