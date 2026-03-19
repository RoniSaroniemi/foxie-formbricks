# Implementation Brief — Formbricks Fork Setup

**Date:** 2026-03-19
**Status:** Ready for agent execution
**Track:** Phase A, Track 2 (parallel with canonical layer sprint)
**Depends on:** Nothing — fully independent of Track 1

---

## Goal

Produce a running, published Formbricks fork that is ready to participate in the Phase B integration test. The integration test requires:

1. A Formbricks instance where `Response.contactId` works without an enterprise licence
2. A completion signal that fires to the Foxie gateway when a respondent finishes a survey
3. A public AGPLv3 repository containing the modified code

That is the entire scope of this brief. Nothing more.

**You are not building:**
- Repeating group rendering
- `dynamic_elements` schema additions
- Template tag `{{target.key}}` rendering
- Portal shell
- Any UI changes

Those are separate briefs. This brief is the minimum fork needed for integration testing.

---

## Reference Documents

Read before starting.

| Document | What to read | When |
|---|---|---|
| `universal-portal-decision-and-poc-scope.md` | Section 6 (fork strategy, AGPLv3 compliance) | Before setup |
| `context-for-portal-poc-agent.md` | Section 6 (fork change scope table, known hard problems test matrix) | Before Chunk 2 |
| `M4-canonical-data-layer-contracts-draft.md` | Section 3.6 (completion signal contract — full specification) | Before Chunk 2 |

---

## Confirmed Working Setup

This section documents the exact setup verified on 2026-03-19. Follow it precisely — do not improvise.

### Base version

Fork from **Formbricks v3.17.1**, commit `0bcd85d`.

```bash
git clone https://github.com/formbricks/formbricks.git foxie-formbricks
cd foxie-formbricks
git checkout v3.17.1
```

### Tool versions

- Node.js: v25.7.0 (any >= 16 works; v25.7.0 confirmed)
- pnpm: v10.x works with `--no-frozen-lockfile` (repo declares 9.15.9)

### Install dependencies

```bash
pnpm install --no-frozen-lockfile
```

Expected: ~90 seconds. Prisma client generation messages are normal — ignore them.

### Pre-build fix (required)

Before building, create a directory the build expects:

```bash
mkdir -p apps/web/public/js
```

If you skip this, the build fails with a `copyCompiledAssetsPlugin` error.

### Build the SDK

```bash
npx turbo run build --filter=@formbricks/surveys
```

This builds the dependency chain automatically: `@formbricks/logger` → `@formbricks/i18n-utils` → `@formbricks/surveys`.

### Verify the SDK build

```bash
ls -lh packages/surveys/dist/index.umd.cjs
```

Expected: file exists, ~430 KB. If this file is not present, do not proceed.

### Run the full application (for testing completion signal)

The completion signal requires a running Formbricks backend. Use Docker Compose.

Create `docker-compose.override.yml` in the repo root:

```yaml
services:
  formbricks:
    image: ghcr.io/formbricks/formbricks:latest
    ports:
      - "3300:3000"
    depends_on:
      - valkey
    environment:
      - REDIS_URL=redis://valkey:6379

  valkey:
    image: valkey/valkey:8.1.1
    restart: unless-stopped
```

**Important:** Use `latest` image, not the `3.17.1` tagged image — the tagged image has migration timeout issues.

Start:

```bash
WEBAPP_URL=http://localhost:3300 \
NEXTAUTH_URL=http://localhost:3300 \
NEXTAUTH_SECRET=$(openssl rand -hex 32) \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
CRON_SECRET=$(openssl rand -hex 32) \
docker compose -f docker/docker-compose.yml -f docker-compose.override.yml \
  -p foxie-formbricks up -d
```

### Known issues and workarounds

| Issue | Workaround |
|---|---|
| pnpm version mismatch | Use `--no-frozen-lockfile` |
| `copyCompiledAssetsPlugin` build error | `mkdir -p apps/web/public/js` before building |
| `tsc: command not found` during build | Run `pnpm install` first |
| Docker v3.17.1 image migration timeout | Use `latest` image |
| Docker runtime 500 errors | Add Redis/Valkey service with `REDIS_URL` |

---

## Evidence Folder

Create this structure before starting:

```
evidence/
├── chunk-1/
│   ├── results.txt
│   └── timestamp.txt
├── chunk-2/
│   ├── results.txt
│   └── timestamp.txt
└── final/
    ├── results.txt
    └── timestamp.txt
```

Save PASS/FAIL results to `results.txt` after each verify step. Never delete evidence files.

---

## Chunk 1 — Repository Setup and AGPLv3 Publication

### 1a — Create the fork repository

1. Create a new public GitHub repository named `foxie-formbricks`
2. Clone Formbricks at v3.17.1 as above
3. Add the new repository as the `origin` remote
4. Push the base commit

```bash
git remote set-url origin https://github.com/<foxie-org>/foxie-formbricks.git
git push origin main
```

### 1b — Document the fork base

Create `FORK.md` in the repo root:

```markdown
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
```

This file is the living change log required by the AGPLv3 licence. Every fork change made in this and future briefs must be recorded here.

### 1c — Licence confirmation

Verify `LICENSE` file in the root contains the AGPLv3 text. Do not change it. The fork inherits this licence.

### 1d — Verify local build from fork

Confirm the fork builds correctly from the newly pushed repository:

```bash
git clone https://github.com/<foxie-org>/foxie-formbricks.git verify-fork
cd verify-fork
mkdir -p apps/web/public/js
pnpm install --no-frozen-lockfile
npx turbo run build --filter=@formbricks/surveys
ls -lh packages/surveys/dist/index.umd.cjs
```

Expected: UMD bundle present at ~430 KB.

---

## Verify 1 — Repository Setup

Save output to `evidence/chunk-1/results.txt`.

| # | Check | Method |
|---|---|---|
| 1 | Repository is public on GitHub | Open URL in browser, confirm accessible without login |
| 2 | `FORK.md` exists with base commit documented | `cat FORK.md` |
| 3 | `LICENSE` contains AGPLv3 text | `head -3 LICENSE` |
| 4 | UMD bundle builds successfully from fresh clone | Build log shows no errors, `ls -lh packages/surveys/dist/index.umd.cjs` |
| 5 | Bundle size is ~430 KB (confirms all dependencies included) | `ls -lh` output |

---

## Chunk 2 — EE Feature Unlock

The `Response.contactId` field is gated behind an enterprise licence check in the upstream Formbricks codebase. Foxie's fork needs this field available without a licence key.

### 2a — Locate the EE gate

The EE feature that gates contact-linked responses is in `apps/web/modules/ee/`. Search for the licence check that gates `contactId` on responses:

```bash
grep -r "contactId" apps/web/modules/ee/ --include="*.ts" -l
grep -r "IS_FORMBRICKS_CLOUD\|isEnterpriseEdition\|ENTERPRISE" apps/web/modules/ee/ --include="*.ts" -l
```

Identify the specific check that prevents `Response.contactId` from being populated without an enterprise licence.

### 2b — Remove the gate

Modify the identified file(s) to allow `contactId` to be set on responses without an enterprise licence check. The change should be minimal — remove or bypass the licence gate specifically for `contactId`. Do not remove licence gates from unrelated EE features.

### 2c — Document the change

Add a row to `FORK.md`:

```markdown
| 2026-03-19 | apps/web/modules/ee/<filename> | Removed enterprise licence gate for Response.contactId | Required for Foxie session identity — contactId must flow through responses without an enterprise key |
```

### 2d — Rebuild and confirm

After making the change, rebuild `apps/web` (or the relevant package) and confirm the change compiles without errors.

---

## Verify 2 — EE Unlock

Save output to `evidence/chunk-2/results.txt`.

Start the full Docker application (`docker compose up`). Complete the first-user setup if not already done. Create a survey and generate a contact link.

| # | Check | Method |
|---|---|---|
| 1 | Application starts without errors after fork change | `docker compose logs formbricks \| tail -20` |
| 2 | Contact survey link can be generated | Create contact in Formbricks UI, generate link |
| 3 | Opening contact survey link sets `contactId` on the response | Submit a response via the link, query `Response` table directly: `SELECT "contactId" FROM "Response" WHERE ...` |
| 4 | `contactId` is not null on the response record | DB query result |
| 5 | `FORK.md` updated with the change documented | `cat FORK.md` |

---

## Chunk 3 — Completion Signal

When a respondent finishes a survey, Formbricks must notify the Foxie gateway. This is the signal that triggers `feedback_request.status` to update to `completed` and the Temporal workflow to advance.

**Read first:** M4 Section 3.6 in full. It specifies the exact payload, endpoint, retry policy, and file locations.

### 3a — The insertion point

The completion signal fires in the pipeline handler at:

```
apps/web/app/api/(internal)/pipeline/route.ts
Lines 214-222
```

This handler uses `Promise.allSettled` — it runs multiple operations in parallel and does not fail-fast. Adding the Foxie gateway call here means a slow or failing gateway call cannot block or break the existing webhook dispatch.

The trigger condition: `responseFinished` event — when `Response.finished` transitions to `true`.

### 3b — The signal payload

```json
{
  "feedback_request_id": "uuid",
  "completion_degree": "full",
  "timestamp": "ISO 8601 datetime",
  "respondent_contact_id": "uuid"
}
```

- `feedback_request_id` — from the session context. For Phase B integration testing, this comes from the Foxie session token that was used to access the survey. The mechanism for passing this through the session context is not yet implemented in this brief — for Phase B, this can be passed as a hidden field or environment variable during testing. Document this as a known gap.
- `completion_degree` — `"full"` when `Response.finished = true`. `"partial"` otherwise (not sent in Phase A).
- `timestamp` — `new Date().toISOString()`
- `respondent_contact_id` — from `Response.contactId` (unlocked in Chunk 2)

### 3c — The gateway endpoint

```
POST {FOXIE_GATEWAY_URL}/signals/feedback-completed
Content-Type: application/json
```

`FOXIE_GATEWAY_URL` must be an environment variable. For Phase B integration testing, this will point to the Foxie canonical layer gateway. For local testing in this brief, it can point to a local mock server (see Verify 3).

### 3d — Implement the call

In `apps/web/app/api/(internal)/pipeline/route.ts`, on the `responseFinished` event, add the Foxie gateway call as an additional promise in the `Promise.allSettled` array:

```typescript
// Add alongside existing webhook promises
const foxieSignalPromise = sendFoxieCompletionSignal({
  feedbackRequestId: response.feedbackRequestId ?? null,
  respondentContactId: response.contactId ?? null,
  timestamp: new Date().toISOString(),
  completionDegree: "full",
});
```

### 3e — Implement the async retry utility

The retry must NOT block the pipeline handler. Implement it as a fire-and-forget with deferred retries:

```typescript
// apps/web/lib/foxie/completion-signal.ts

const FOXIE_GATEWAY_URL = process.env.FOXIE_GATEWAY_URL;
const RETRY_DELAYS_MS = [1000, 5000, 30000];

export async function sendFoxieCompletionSignal(payload: {
  feedbackRequestId: string | null;
  respondentContactId: string | null;
  timestamp: string;
  completionDegree: "full" | "partial";
}): Promise<void> {
  if (!FOXIE_GATEWAY_URL) return; // Gateway not configured — skip silently
  if (!payload.feedbackRequestId) return; // No feedback request context — skip

  const body = JSON.stringify({
    feedback_request_id: payload.feedbackRequestId,
    completion_degree: payload.completionDegree,
    timestamp: payload.timestamp,
    respondent_contact_id: payload.respondentContactId,
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${FOXIE_GATEWAY_URL}/signals/feedback-completed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return; // Success
      console.error(`[foxie] completion signal HTTP ${res.status} on attempt ${attempt + 1}`);
    } catch (err) {
      console.error(`[foxie] completion signal network error on attempt ${attempt + 1}:`, err);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  // All retries exhausted
  console.error(`[foxie] completion signal failed after all retries. feedback_request_id=${payload.feedbackRequestId}`);
}
```

### 3f — Add environment variable

Add to `.env.example` (create if it does not exist):

```
# Foxie gateway URL for completion signals
# Leave empty to disable (signal will be skipped silently)
FOXIE_GATEWAY_URL=
```

### 3g — Document the change

Add rows to `FORK.md`:

```markdown
| 2026-03-19 | apps/web/app/api/(internal)/pipeline/route.ts | Added Foxie gateway completion signal call to responseFinished handler | Required for Temporal workflow to receive completion events |
| 2026-03-19 | apps/web/lib/foxie/completion-signal.ts | New file — async completion signal sender with exponential backoff retry | Isolated gateway call with 3 retries (1s/5s/30s) |
```

---

## Verify 3 — Completion Signal

Save output to `evidence/chunk-3/results.txt`.

### Set up a mock gateway

Run a minimal local HTTP server that accepts POST requests and logs the payload. Use `npx json-server` or a simple Node.js one-liner:

```bash
node -e "
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    console.log('[MOCK GATEWAY RECEIVED]', body);
    res.writeHead(200);
    res.end('{\"status\":\"accepted\"}');
  });
}).listen(4000, () => console.log('Mock gateway on :4000'));
"
```

Set `FOXIE_GATEWAY_URL=http://localhost:4000` in the Docker environment.

### Checks

| # | Check | Method |
|---|---|---|
| 1 | Application rebuilds without TypeScript errors after fork changes | Build log |
| 2 | Complete a survey via a contact link | Browser — submit NPS score |
| 3 | Mock gateway receives POST to `/signals/feedback-completed` | Mock server console output |
| 4 | Payload contains correct fields: `feedback_request_id`, `completion_degree`, `timestamp`, `respondent_contact_id` | Mock server log |
| 5 | `completion_degree` is `"full"` | Payload inspection |
| 6 | `respondent_contact_id` matches the contact used | Payload inspection vs. Formbricks contact ID |
| 7 | `FORK.md` has all three changes documented | `cat FORK.md` |
| 8 | `FOXIE_GATEWAY_URL=` (empty) results in no signal sent and no errors | Set empty, submit survey, confirm no errors in logs |

**Note on `feedback_request_id`:** In Phase B, this value comes from Foxie's session token. In this brief it may be `null` if the survey was accessed without a Foxie session token. Check 4 should confirm the field is present in the payload even if null — the gateway will handle the null case. Document this as a known gap: full `feedback_request_id` propagation requires Phase B session token integration.

---

## Final Verification

Save output to `evidence/final/results.txt`.

| # | Check | Result |
|---|---|---|
| 1 | Fork repository is public on GitHub | URL accessible without login |
| 2 | `FORK.md` documents all changes with dates and reasons | `cat FORK.md` — 3 entries minimum |
| 3 | `LICENSE` is AGPLv3 (unchanged from upstream) | `head -3 LICENSE` |
| 4 | UMD bundle builds from fork at ~430 KB | `ls -lh packages/surveys/dist/index.umd.cjs` |
| 5 | `Response.contactId` populates without enterprise key | DB query after contact survey submission |
| 6 | Completion signal fires to mock gateway on survey completion | Mock server log |
| 7 | Signal payload has all four required fields | Payload inspection |
| 8 | Empty `FOXIE_GATEWAY_URL` produces no errors | Log inspection |

---

## Definition of Done

- [ ] Public GitHub repository exists with AGPLv3 licence
- [ ] `FORK.md` documents all changes made
- [ ] `Response.contactId` confirmed working without enterprise licence
- [ ] Completion signal fires correctly to mock gateway
- [ ] All 8 final verification checks pass
- [ ] `FOXIE_GATEWAY_URL` environment variable documented in `.env.example`

---

## Out of Scope

Do not implement any of the following. They are covered in separate briefs:

- `dynamic_elements` field on survey definition schema
- Template tag `{{target.key}}` rendering
- Repeating group rendering (experimental branch — separate brief)
- Portal shell
- Any changes to the SDK rendering pipeline (`packages/surveys/`)
- Diff detection in `updateResponse()` — not needed for portal callback path
- JWT extension for `feedbackRequestId` — not needed for portal path
