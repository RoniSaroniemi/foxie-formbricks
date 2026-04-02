# Repeating Group Verification Commands

## Prerequisites

- Harness verification:
  - `pnpm verify:repeating-group:harness`
- Full verification:
  - set `REPEATING_GROUP_REAL_SURVEY_URL`
  - optionally set one of:
    - `REPEATING_GROUP_REAL_EVENT_WINDOW_KEY`
    - `REPEATING_GROUP_REAL_EVENT_SELECTOR`
    - `REPEATING_GROUP_REAL_CONSOLE_PREFIX`
  - run `pnpm verify:repeating-group`

## Output Artifacts

- Harness screenshots: `evidence/track-2b/screenshots/harness/`
- Real-survey screenshots: `evidence/track-2b/screenshots/real/`
- Harness payload evidence:
  - `evidence/track-2b/harness-events.json`
  - `evidence/track-2b/harness-output.txt`
- Real-survey payload evidence:
  - `evidence/track-2b/real-survey-output.json`
  - or `evidence/track-2b/real-survey-output.txt`

## Real-Survey Environment Variables

- `REPEATING_GROUP_REAL_SURVEY_URL`: required
- `REPEATING_GROUP_REAL_TARGET_ONE_LABEL`: optional, default `Matti Virtanen`
- `REPEATING_GROUP_REAL_TARGET_TWO_LABEL`: optional, default `Sarah Smith`
- `REPEATING_GROUP_REAL_EVENT_WINDOW_KEY`: optional payload source
- `REPEATING_GROUP_REAL_EVENT_SELECTOR`: optional payload source
- `REPEATING_GROUP_REAL_CONSOLE_PREFIX`: optional payload source
- `REPEATING_GROUP_REAL_COMPLETION_TEXT`: optional completion assertion

One payload source is required for the real-survey run.
