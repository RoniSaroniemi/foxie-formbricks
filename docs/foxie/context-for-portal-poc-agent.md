# Context for Universal Feedback Portal POC

**For:** AI agent executing the Universal Feedback Portal POC
**Read this document first, then read:** `universal-portal-decision-and-poc-scope.md`
**Additional reference documents** are listed in Section 7 with guidance on which sections are relevant.

---

## 1. What Foxie Is

Foxie is a customer feedback and retention management platform for agencies. An agency uses Foxie to collect structured feedback from their clients' contacts — the people who work at or for the companies the agency serves.

The core workflow: an agency configures a recurring feedback automation. The automation runs across a set of company/project entities (the agency's clients). For each entity, the automation identifies which contacts should be surveyed (based on their association to that entity), generates survey links, sends those links, and collects responses. The collected data is used to detect relationship health signals, track satisfaction over time, and identify accounts at risk.

Contacts are people. Organisation entities are companies, projects, subsidiaries, or teams. The relationship between a contact and an organisation entity is called an **association** — a first-class record in Foxie's data model that carries relationship metadata (type, status, review status).

**The four user classes relevant to the POC:**
- **Agency staff** — the people who configure and monitor automations. They have persistent platform accounts.
- **Survey respondents (external contacts)** — the contacts who receive survey links and fill in feedback. They have no platform account. They access via a token-embedded URL.
- **Internal contacts** — agency employees or other internal parties who provide feedback via a centralised portal view. They may or may not have platform accounts.
- **Service accounts** — machine actors (Temporal, internal services). Not relevant to the portal POC.

---

## 2. What the Universal Portal Is

The portal is a contact-scoped, authenticated web surface that aggregates all survey-related activity for a specific contact. It is the single entry point for all feedback interactions — regardless of audience type, automation cycle, or number of active requests.

### What it must do

When a contact opens any survey URL they have received:

1. The URL token is resolved server-side to identify: who this contact is, which FeedbackRequests are active for them across **all** running automation cycles, and contextual data (e.g. which entities are being evaluated).

2. The portal renders with a state appropriate to the contact's current situation:
   - **One active request, simple context:** portal opens with the survey immediately in view. Functionally identical to a direct survey experience from the contact's perspective, but still within the portal container.
   - **Multiple active requests:** portal opens with a listing view. The contact can navigate to each survey in turn.
   - **No active requests:** portal shows historical submissions.

3. When the contact completes a survey, the portal can surface that there are more surveys to complete — without requiring a new URL or a new login.

### What makes this different from the current state

Currently, Formbricks renders surveys as full-page standalone experiences. Each survey URL leads to a separate page. A contact with three active surveys across three automation cycles receives three separate links with no awareness of each other. Completing one does not surface the others.

The portal unifies this. The survey component renders **inside** the portal container. The portal owns the page; the survey is a child. This is the core architectural requirement that drives the POC.

### What the portal is not

- It is not a CRM or account management tool for agency staff. It is a respondent-facing surface.
- It is not a survey authoring tool. Survey authoring remains in Formbricks' admin interface.
- It is not a reporting surface. Reporting is a separate layer that consumes the answer data the portal collects.

---

## 3. The Session Model — How Data Flows Into the Portal

Understanding the session model is essential for the POC, because "session context injection" is one of the five questions the POC must answer.

### The token

When a FeedbackRequest is created for a contact, a session token is generated. This token is:
- Opaque — not a JWT, not decodable by the contact
- Stored hashed server-side in the `session_token` table
- Embedded in the survey URL sent to the contact

The contact opens the URL. The portal's backend receives the token, hashes it, looks it up in the `session_token` table, finds the associated `feedback_request_id`, and resolves the full session context from there.

### What the resolved session context contains

At minimum (v0.1):
```
{
  feedbackRequestId: UUID,
  contactId: UUID,
  surveyId: string (cuid — Formbricks survey ID),
  organisationId: UUID,
  evaluationTargets: [
    {
      associationId: UUID,
      entityId: UUID,
      entityName: string,
      entityType: string,   // 'company', 'project', etc.
      associationType: string  // 'is_customer_of', etc.
    }
  ],
  expiresAt: datetime
}
```

`evaluationTargets` is the list of entities being evaluated in this survey — used to render the **repeating question group** (the section of the survey that repeats once per evaluation target). For example, if a contact is associated with three projects, the repeating group renders three times, once per project.

### What the portal needs to query beyond the initial token

After token resolution, the portal also needs to know:
- All other active FeedbackRequests for this contact across all automation cycles (to show the listing view if there are multiple)
- Historical completed FeedbackRequests for this contact (for the history view)

This is a query against the `feedback_request` table filtered by `contact_id` and `status`. The portal makes this query using its own backend service account credentials, not the respondent's token.

### The critical point for the POC

In Formbricks' current model, the session is resolved from a JWT embedded in the URL — the JWT contains `contactId` and `surveyId`, and Formbricks resolves these from its own database. In the portal model, the session is resolved externally by Foxie's backend before the survey component renders. The survey component must accept pre-resolved session context from its parent rather than resolving its own.

This is what "session context injection" means in the POC. The survey component cannot call back to Formbricks to resolve identity — that work is done by the portal before the component is mounted.

---

## 4. The Key Data Entities

These are the entities the portal interacts with. Enough detail to recognise what the POC needs to handle — full schemas are in `M4-canonical-data-layer-contracts-draft.md`.

### `feedback_request`

One contact's participation in one collection run. The central operational record.

Relevant fields for the POC:
- `id` — UUID, primary key
- `contact_id` — who is being asked
- `association_id` — which relationship context (links to the polymorphic association table)
- `survey_id` — Formbricks cuid string — which survey to render
- `status` — `active | partial | completed | cancelled`
- `collection_run_id` — nullable; which automation phase this belongs to

### `session_token`

Separate from the feedback_request. Stores the hashed token, expiry, and revocation state.

### `collection_run`

One phase of one automation cycle. Groups all FeedbackRequests for a specific audience phase. Relevant for the portal because: the survey displayed in the portal is determined by `collection_run.survey_id` (resolved and frozen onto `feedback_request.survey_id` at creation time).

### `automation_cycle`

Groups all phases for one company/project in one automation run. The portal queries across all AutomationCycles — not just one — for a contact's active FeedbackRequests.

### The polymorphic `association` table

Links contacts to organisation entities. The `evaluation_targets` in the session context are derived from the contact's associations to entities in the current automation cycle's cohort.

---

## 5. What Formbricks Does in Foxie's Architecture

Formbricks is the survey authoring and answer persistence layer. It is not the rendering container for the portal — the portal is Foxie-owned. Formbricks provides:

- **Survey definition storage** — the question schema, question types, survey configuration
- **Browser-side rendering SDK** — the React components that render individual questions, handle input, manage the response queue
- **Answer persistence** — stores raw answers in `Response.data` (a JSON field keyed by question ID)
- **Per-question partial save** — the SDK already sends partial updates per question natively (this is a confirmed finding from prior investigation — see Section 6)

Formbricks does **not** provide (and is not expected to provide in the portal context):
- Session management for Foxie's FeedbackRequest model
- Token generation or validation
- Multi-survey aggregation view
- Cross-automation-cycle context

### The fork relationship

Foxie is forking Formbricks, not using it as a managed service. The fork allows changes to Formbricks' source that would not be accepted upstream. Several fork changes have already been designed (see Section 6). The POC will determine whether additional fork changes are needed for portal embedding, and whether those changes are bounded or cascade.

---

## 6. What Prior Investigation Has Already Established

This is the most important section for the POC. The M3 source investigation produced source-level findings about Formbricks' implementation. These are already known — the POC should not re-investigate them.

### Confirmed findings from M3

**Per-question save is already native.**
The Formbricks client SDK (`packages/surveys/src/lib/response-queue.ts:45,114`) accumulates individual question answers and sends them as partial updates. The server's `updateResponse()` function (`apps/web/lib/response/service.ts:438-453`) loads current state and merges. Per-question partial saving does not require a fork change.

**The diff detection hook point is identified.**
To emit per-question events (for the reporting trickle-down path), diff detection should be added to `updateResponse()` in `apps/web/lib/response/service.ts` at lines 438-453. The old data is available at line 438 before the merge. This is the right insertion point — the pipeline handler (`apps/web/app/api/(internal)/pipeline/route.ts`) does NOT have access to old data and is not the correct hook.

**JWT extension is feasible and bounded.**
JWT generation lives in `apps/web/modules/ee/contacts/lib/contact-survey-link.ts` (payload at lines 46-49, HS256 signing at line 53, URL generation at lines 65-67). Adding `feedbackRequestId` to the encrypted payload is a localised change. Structurally confirmed feasible.

**EE features are required.**
`Response.contactId` (required for respondent identity) is an enterprise license feature. Since Foxie is forking, EE features will be unlocked in the fork. This is not a constraint.

**Answer type system is clean.**
`ZResponseDataValue` at `packages/types/responses.ts:6-11` defines four types: `string`, `number`, `string[]`, `Record<string, string>`. These map cleanly to Foxie's answer row schema fields (text, value, choices, structured).

**Completion signal.**
Formbricks emits `responseFinished` when `Response.finished = true`. Native webhook delivery is fire-and-forget via `Promise.allSettled` in the pipeline handler (`apps/web/app/api/(internal)/pipeline/route.ts:214,222`). Adding a Foxie gateway call as another promise in the `Promise.allSettled` array provides natural isolation.

### What is NOT yet known (what the POC investigates)

**Whether the rendering pipeline can be componentised.**
The survey rendering is currently designed as a full-page standalone experience. Whether the rendering can be invoked as an embedded React component inside a parent container — without the component assuming it owns the page, managing its own routing, or conflicting with parent scroll/viewport contexts — is the key unknown.

**Where the entry point is for external session context.**
In Formbricks' current flow, the survey URL carries a JWT that the survey SDK resolves to identity. In the portal flow, identity is pre-resolved externally and must be passed into the rendering component. Where is the cleanest injection point, and what does the change look like?

---

## 7. Document Reference Map

All documents are in the same root folder. Read what you need — do not read everything.

| Document | What it contains | Relevant sections for this POC |
|---|---|---|
| `universal-portal-decision-and-poc-scope.md` | The POC specification — five questions to answer, three deliverables to produce, decision framework after POC | Read fully — this is the primary task document |
| `M4-canonical-data-layer-contracts-draft.md` | Full schema definitions for all Foxie canonical data entities | Sections 1.21 (feedback_request), 1.22 (session_token), 1.18 (automation_cycle), 1.19 (collection_run), 1.14 (audience_type_registry) |
| `foxie-authentication-identity-design.md` | Authentication layer design — four user classes, token types, tenant isolation | Section on survey respondent tokens; Section on token design by user class |
| `foxie-canonical-data-model-decisions.md` | Polymorphic association model, entity hierarchy, type registry design | Decision 2 (association table), Decision 4 (type registry) — for understanding evaluationTargets |
| `decision-twenty-reference-not-adopt.md` | Why Twenty was not adopted — useful framing for the Formbricks analogous decision | The summary table at the end |

**Do not read for this POC** (context you do not need):
- `M2-dependency-surface-map.md` — foundational architecture decisions now superseded by M4
- `research-brief-*.md` — research briefs dispatched to separate agents
- `briefing-*.md` — briefings for other agent tasks

---

## 8. Scope Boundaries for the POC Agent

**Do:**
- Read Formbricks source code to answer the five questions in the POC document
- Document which files were examined and what was found
- Produce the three deliverables: embedded rendering proof, change log, known hard problems list
- Be specific — cite file paths and line numbers as the prior M3 investigation did

**Do not:**
- Make a path-choice recommendation (fork vs. custom build) — that decision is made by the human based on your findings
- Implement any production-quality code
- Redesign any data schemas or API surfaces
- Investigate areas beyond what the five POC questions require
- Re-investigate what is already confirmed in Section 6 of this document

**The goal is evidence, not a working prototype.** The POC is successful when the five questions have specific, source-grounded answers. A polished implementation that cannot answer the questions has not succeeded. A rough proof that answers all five questions has.
