# Handback T-DG5-BE-I2 (backend-workflow-engineer): the jobs operations view, job runs, next run, run now

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §D.4.
- **Invocation:** `DG5-T-DG5-BE-I2-backend-workflow-engineer-20261015T024542Z-faa13688` (session `faa13688-247d-4eb0-9feb-4020c22ae8f1`).
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-I2.md`, sha256 `cae6aae80e9796a677b62884963b5d159c2103c8cd70ad186761f2b573c4b87f` (verified).
- **Base:** branch `dg5/be-i2`, `HEAD` `5b4597ccb9477a521c1683a3bf5d91c99eb53208`. The changes are left **uncommitted**.
- **Time:** started `2026-10-15T02:45:55Z` (`date -u`), checks finished `2026-10-15T04:24:49Z` (`date -u`), within the roughly 100-minute budget.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits 0 (`PASS gate DG4 (historical)`), at both the start and the end.
- **Product gates G1–G6** are business approvals inside the product. Nothing here reads or writes DG0–DG7 records, grants a business, Finance or IT approval, or lets a job decide one. "Run now" only starts a scheduled job. All test data is synthetic.

## 1. Changed files

| File | Owner per §D.4 | Purpose |
|---|---|---|
| `apps/api/src/modules/jobs/operations.ts` | mine (filled BE-A's stub) | `listJobOperations`, `getJobOperation`, `runJobNow` |
| `packages/shared/src/time/cron-next.ts` (new) | mine | Pure five-field cron next run in a time zone; no dependency |
| `packages/shared/src/time/cron-next.test.ts` (new) | mine | Property tests on the seeded crons, plus exact instants, DST, offsets and null cases |
| `apps/worker/src/worker.ts` | mine (job_run lines, after BE-I's) | Records one `job_run` per finished attempt of a scheduled queue's job; registers the run-now dispatcher; `offWork` on stop |
| `apps/worker/src/job-runs.ts` (new) | mine (support file of the `worker.ts` lines) | `recordJobRun`, `dispatchRunNow`, `scheduleCodeOfQueue` |
| `apps/worker/src/queues/jobs.ts` (new) | **seam, see §5** | Queue `jobs.run_now`; event `job.run_requested` → `jobs.run_now` |
| `apps/worker/src/queues/index.ts` | **seam, see §5** | +3 lines: import, `...JOBS_QUEUES`, `JOBS_EVENT_QUEUES` |
| `packages/shared/src/schemas/job-operations.ts` (new) | **seam, see §5** | Zod mirrors (`jobOperation`, `jobOperationList`, `jobRun`, `jobOperationDetail`, `jobRunNowResult`), `runNowSingletonKey`, event payload `jobRunRequestedV1` |
| `packages/shared/src/schemas/index.ts` | **seam, see §5** | +2 lines: barrel export of `job-operations.ts` |
| `packages/shared/src/schemas/events.ts` | **seam, see §5** | +3 lines: import and `"job.run_requested": { 1: jobRunRequestedV1 }` |
| `packages/shared/src/time/index.ts` | **seam, see §5** | +9 lines: barrel export of `cron-next.ts` |
| `apps/api/test/support/p5-pending-be-i2.ts` | mine | Emptied (3 → 0) |
| `apps/api/test/integration/contract/p5-exercises-be-i2.ts` (new) | mine | Contract exercises of the three operations |
| `apps/api/test/integration/contract/contract.test.ts` | wiring lines (the BE-I precedent) | +5 lines: import, `...P5_MIRRORS_BE_I2`, one `it(...)` |
| `apps/api/test/integration/jobs/job-operations.test.ts` (new) | mine | API integration tests on a scratch database (7 tests) |
| `apps/worker/test/integration/job-runs.test.ts` (new) | mine | Worker integration tests with real pg-boss and the production `startWorker` (5 tests) |
| `docs/delivery/handbacks/DG5/T-DG5-BE-I2-*` | mine | This handback and its logs |

- **Migrations:** none. `job_run`, `operational_failure`, `job_schedule` and the `job.read`/`job.repair` grants already exist (`0028`, `0074`, `0076`).
- **API endpoints added:**
  - `GET /api/v1/admin/jobs`
  - `GET /api/v1/admin/jobs/{jobCode}`
  - `POST /api/v1/admin/jobs/{jobCode}/run`

## 2. Behaviour delivered

**REQ-S12-022.** Acceptance text, quoted: "A22: the jobs screen shows last success and next run for each scheduled job; a non-admin gets 403". Register text: "Store scheduled runs and execution outcomes in the database and expose last success, next run, failures and repair actions to authorized administrators".

- **Runs stored in the database (worker).** Every finished attempt of a job on a *scheduled* queue writes one `job_run` row: job id, attempt, outcome, started and finished times, error code. A scheduled queue is one that a `job_schedule` row names; when several rows share a queue, the first code is used, the same rule as BE-I's failure capture.
  - Writes are `ON CONFLICT (job_id, attempt_no) DO NOTHING`, so a redelivered attempt records once.
  - A recording error is logged and never changes the job's outcome. BE-I's capture lines are untouched and run first.
  - Failed attempts store ADR-0043 §9 execution codes: `automation.action_failed` before the last attempt, `automation.retries_exhausted` on the last attempt (the job is then also in the failure queue). See §5 item 3.
  - Covered by `apps/worker/test/integration/job-runs.test.ts`.
- **`GET /admin/jobs` (`job.read`, ADM_TECH).** Lists every `job_schedule` row, ordered by code. Each row shows:
  - **Last success:** the newest `succeeded` run, else `null` ("Never run"; never a time or "OK").
  - **Last run and last outcome:** the newest run, else `null`.
  - **Next run:** `nextCronRun(cron, timezone, request time)`. A disabled schedule gives `null` with reason `disabled`. A cron with no match within 366 days gives `null` with reason `unknown`. Never a guessed time.
  - **Open failures:** the count of `open` or `retrying` job failures of the schedule.
  - **Allowed actions:** `run_now` (`job.repair` and the schedule enabled) and `retry_failures` (`job.repair` and at least one `open` failure). The repairs themselves are BE-I's retry and dismiss routes.
  - An undeclared query parameter is a 400.
- **`GET /admin/jobs/{jobCode}` (`job.read`).** Returns the same job view plus its runs, newest first, keyset-paginated on `(finished_at, id)`. A cursor is bound to its job code (400 for another job's cursor). Unknown code → 404; malformed code → 400.
- **Non-admin 403.** The permission is required in the caller's own organization, the DG4 job-schedules rule, because the table is platform-wide. TL, AUD, TO, a user without grants and another organization's TO all get 403 on all three operations, and nothing is written.
- **`POST /admin/jobs/{jobCode}/run` (`job.repair`) → 202 `{code, jobId, singletonKey, queuedAt}`.** It runs in one transaction:
  1. Re-checks `job.repair` on grants reloaded inside the transaction (commit-time authorization; tested by revoking while the request waits → 403, `authorization.denied` audited, nothing written).
  2. Locks the schedule row (`FOR UPDATE`), so concurrent requests serialize.
  3. Unknown code → 404. Disabled schedule → 422 `job.schedule_disabled` "Enable the schedule before running it now." (ADR-0043 §9, exact).
  4. Unless a run now of this job was already requested in the same minute, it writes the audit event `job_schedule.run_now` and the internal outbox event `job.run_requested`. The event's idempotency key is the ADR singleton key `run-now:<code>:<ISO minute>`.
  - **No pg-boss I/O inside the transaction.** After COMMIT the relay delivers the event to `jobs.run_now`. The worker's dispatcher then sends the schedule's own job data (`{}`, exactly what the pg-boss cron sends) to the schedule's queue, under job id = the outbox event id. A replayed dispatch therefore sends nothing new, and the run is recorded like a scheduled one.
  - **Twice in one minute sends one job:** the second request writes nothing and returns the same `jobId`. Tested both sequentially and concurrently: one outbox event, one audit event.
  - The dispatcher does not send when the schedule was disabled after the request, or when no handler in this worker consumes the queue (outcomes `disabled` and `unhandled`, logged).
- **`nextCronRun`** (`packages/shared/src/time/cron-next.ts`):
  - **Syntax:** `*`, lists, ranges, steps and `n/step`; day of week 0 or 7 is Sunday.
  - **Day rule:** the same as cron-parser 4.9, which pg-boss 11 uses to fire schedules, so the shown time is when pg-boss starts the job. If day of week is full, only day of month counts. If day of month is full, only day of week counts. Otherwise either one is enough.
  - **Search:** minute by minute up to 366 days. For speed, minutes are visited in aligned 15-minute blocks whose local fields are read once. A block whose offset is not a multiple of 15 minutes is checked minute by minute.
  - **Tests:** an independent oracle in the test checks every seeded cron (DG4 and P5) in six zones (Riyadh, UTC, Kolkata, Kathmandu, London, New York) at fixed-seed instants. Each result must match the cron and no earlier minute may match. There are also exact Riyadh instants, the strictly-after rule, 29 February, a New York DST gap, and null for 30 February, 31 April, invalid crons, an unknown zone and NaN.
- **Shared rules (§2):**
  - Rule 4: no If-Match on run now. The contract declares no 409 or 428 for `runJobNow`, and the request changes no versioned record (`job_schedule.version` is unchanged; tested).
  - Rules 6 and 7: problem codes are i18n keys, and AUD gets 403.
  - Rule 8: harness ports 23900–23949.
  - Rule 10: exactly once, through the outbox unique key, the row lock and the deterministic job id.
  - Rule 14: contract seams done (§4).
  - Rule 15: exact refusal text.
  - Rule 17: no dependency.

## 3. Checks (real exit codes; logs under `docs/delivery/handbacks/DG5/T-DG5-BE-I2-evidence/`)

Environment: Node 24.21.0, offline. The integration database is a disposable PostgreSQL 16.13 on port 23900 (pool 23901–23949).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` | — |
| 1 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (every batch) | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 6 | `pnpm test` (LANG, LC_ALL, LC_CTYPE, LANGUAGE unset) | 0 | unit-node 108 files / 1911 tests; unit-web 72 / 1400; unit-formula-nocodegen 3 files, 259 passed and 2 skipped | `test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts as #6 | `test-c-utf8.log` |
| 8 | `QA_PG_PORT=23900 MTH_PORT_POOL=23901-23949 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 238 files / 2308 tests passed, 0 failed (2201.67 s); includes `contract.test.ts` 75, `jobs/job-operations.test.ts` 7, `worker job-runs.test.ts` 5 | `test-integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `PASS gate DG4 (historical)` | `validate-dg4-end.log` |

- **Counts:** unit-node gains 1 file and 9 tests (`cron-next.test.ts`). Integration gains 2 files with 7 + 5 tests, and the contract test gains one `it` (75 tests in `contract.test.ts`).
- **Targeted runs during development:**
  - `job-operations.test.ts`: the first run had 5 passed and 1 failed. A 409 came from the `audit_event_version_step` check because I had set prior = new version on the run-now audit event. Fixed by recording no version for this non-versioning action. The re-run passed 6/6; the 7th test (concurrent) was added afterwards and runs in #8.
  - `job-runs.test.ts`: the first runs failed on test setup. The queue `gate.condition_escalation_scan` is not created yet (BE-K owns it), and a direct `job_schedule` update hit the version and audit guards. Fixed by picking `gate.exception_expiry_scan` and doing an audited version + 1 toggle. Then 5/5 passed.
  - `contract.test.ts`: 75/75.
- **Flaky tests or timeouts:** none in the cited logs. The integration log has no failed, retried or timed-out test; the word "retry" appears there only in test names. My first draft of the cron property test exceeded the 5 s default in a targeted run because the oracle built a new formatter for every minute. I cached it and set explicit 60 s/120 s timeouts; it now takes about 1 s.
- **Pinned counts (D-079):** no change.
  - Media-type triple: `runJobNow` is a bodiless POST and the other two are GETs, so it stays `[361, 360, 1]`.
  - Rate-limit floor: `>= 285`, unchanged.
  - Operation count: 846, unchanged.

## 4. Operations routed (delta to `p5-pending-be-i2.ts`)

| Operation | Before | After | Exercised in `p5-exercises-be-i2.ts` |
|---|---|---|---|
| `listJobOperations` | pending | routed | 200; 400 (undeclared parameter); 403 (AUD, TL) |
| `getJobOperation` | pending | routed | 200; 400 (malformed code, bad cursor); 403 (AUD); 404 |
| `runJobNow` | pending | routed | 202; 400 (malformed code); 403 (AUD); 404; 422 `job.schedule_disabled` (exact text) |

`P5_PENDING_BE_I2` goes from 3 to **0**. Each success body is checked against its zod mirror (`P5_MIRRORS_BE_I2`).

## 5. Contract, schema and dependency needs, for the orchestrator

1. **Seam files outside §D.4's list.** §D.4 names no transport for "run now", and the API has no pg-boss client. So I used the outbox, following BE-I's retry precedent; all edits are additive:
   - a new event `job.run_requested` v1, with one schema line in `packages/shared/src/schemas/events.ts`;
   - a new queue file `apps/worker/src/queues/jobs.ts`, with 3 lines in `queues/index.ts`;
   - a new mirror file `packages/shared/src/schemas/job-operations.ts`, with a barrel line in `schemas/index.ts`;
   - the `cron-next` export lines in `packages/shared/src/time/index.ts`.

   I did not put the queue in `queues/automation.ts`: BE-H2's integration test pins that file's queue list exactly. Please confirm these seams, or move the lines to the files you prefer. They don't collide with BE-J's `handlers/index.ts`. If a concurrent W9 task also edited `events.ts`, `schemas/index.ts` or `queues/index.ts`, expect simple adjacent-line merges.
2. **ADR-0043 §6/§7 text.** The ADR lists the new queues as only `automation.evaluate`, `automation.tick_hourly` and `automation.tick_daily`. It doesn't name `job.run_requested` or `jobs.run_now`. Proposed amendment: "Run now writes the internal outbox event `job.run_requested` `{jobScheduleCode, queueName, requestedBy, singletonKey}` with idempotency key = the singleton key; consumer `jobs.run_now`; the job id of the run is the event id."
3. **`job_run.error_code` values.** The ADR says `error_code` but names no job code. I used the ADR-0043 §9 execution codes: `automation.action_failed` before the last attempt, `automation.retries_exhausted` on the last. If a dedicated code is preferred, the proposal is `job.run_failed` "The job failed; pg-boss retries it with backoff." I did not invent it.
4. **The run-now audit action `job_schedule.run_now`.** It carries no prior or new version (the schedule does not change), with `changes.run_now.to = <singleton key>`. Not listed in ADR-0043 §8's audit families; please confirm.
5. **The meaning of `JobRunNowResult.jobId`.** It is always the job id: a second request in the same minute returns the same id rather than `null`. The contract allows `null`; nothing here uses it.
6. **No dependency added.** `cron-parser` is only a transitive dependency of pg-boss; I implemented the cron logic myself and did not import it. **No migration** (no `0077`–`0079` number used).

## 6. User-facing texts

- **Untrue texts:** none that my work made untrue. `apps/web/src/i18n/{en,ar}/calendar.json` `jobs.*` (the DG4 jobs page) does not call the operations view, last success, next run or run now "planned" or "later". Its intro "A job never decides a business approval; it can only remind and escalate." stays true.
- **For FE-D (owner of the jobs view extension and the web i18n), to add in en and ar:**
  - the problem code `job.schedule_disabled` ("Enable the schedule before running it now.");
  - the execution codes `automation.action_failed` and `automation.retries_exhausted` (shown in the run history);
  - the labels "Never run", "Disabled" and "Unknown" for `lastSuccessAt: null` and `nextRunUnknownReason`.

  None of these is in `apps/web/src/i18n` today. BE-I's codes aren't either.
- **Code comment, not user-facing:** `apps/api/src/modules/jobs/index.ts` still says "Automation-rule administration and failure-queue views arrive in later stages". That file isn't mine; it's for the orchestrator.

## 7. What remains

- **Nothing in §D.4's scope.** The three operations are routed and exercised, the cron next-run function is delivered, run history is recorded, and run now works.
- **REQ-S12-022 completes with FE-D** (the jobs view extension, per p5-work-split §E.7). This task delivers the backend only, so the row is not complete until FE-D ships.
- **The §5 items** are orchestrator decisions.

## 8. Merge instructions

- No migrations; no ordering constraint beyond §E.6 (after BE-I, which is merged).
- Expected conflicts are adjacent-line additions in `contract.test.ts` (imports, mirrors, `it` blocks), `packages/shared/src/schemas/{index,events}.ts` and `apps/worker/src/queues/index.ts`, if a concurrent W9 task touched the same blocks. In `worker.ts`, my lines sit inside BE-I's `captured` helper and after `syncSchedules`. BE-L edits `kit.ts`, not `worker.ts`, per §E.6.
