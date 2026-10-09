# Handback T-DG4-BE-A: P4 foundation, slice I (backend-workflow-engineer)

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). This is engineering delivery work. Nothing here grants a business, Finance or IT approval. Product gates G1–G6 are not touched. Nothing reads or writes the DG0–DG7 records.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-A.md` (sha256 `14957ebf…b0f617`, verified at start). The scope is `docs/architecture/p4-work-split.md` §I+C.1, with shared rules §1 S-1…S-14.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-A-backend-workflow-engineer-20261009T015813Z-ca5a1722","session_id":"ca5a1722-d54c-46ba-b379-7ee0dd8dc2b5"}`.
- **Working tree:** worktree `/home/user/wt/dg4-be-a`, branch `dg4/be-a`, base `735fbc7`. All changes are left **uncommitted** for the orchestrator.
- **Time:** started `2026-10-09T01:58:25Z`. The end time is in "Checks" below. The work finished well inside the 2-hour bound, so nothing was salvaged or split.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` exited **0** (`PASS gate DG3 (historical)`), both at the start (`T-DG4-BE-A-evidence/validate-dg3-historical-start.log`) and at the end (`validate-dg3-historical.log`).
- **Data:** every fixture and seed value in the tests is synthetic.

## 1. Behaviour delivered, per requirement row

### REQ-S10-006: business calendar and working-day SLAs

**Acceptance:** "A09: a 5-working-day SLA raised on the day before a configured holiday skips the holiday and weekend days; no holiday exists until configured."

**Delivered:**

- Pure working-day arithmetic in `packages/shared/src/time/working-days.ts`:
  - `addWorkingDays` returns the n-th working day strictly after the raise date. The raise day never counts.
  - It looks at most 3,660 days ahead. A missing calendar, or too few working days in that window, gives Unknown (`null`, `calendar_not_configured`). It never falls back to elapsed calendar days.
  - `isWorkingDay` and `isValidWorkweek` are in the same file.
- The three ADR-0025 §1 worked examples are pinned literally in `working-days.test.ts`:
  - Thursday 2026-10-08 + 5 → Thursday 2026-10-15;
  - the same with a holiday on Sunday 2026-10-11 → Sunday 2026-10-18;
  - Wednesday 2026-10-14 + 5 with a holiday on Thursday 2026-10-15 → Thursday 2026-10-22, or Wednesday 2026-10-21 without the holiday.
- The 8 calendar operations are in `apps/api/src/modules/organization/calendar.ts`:
  - list, create, get and update calendars;
  - list, create and update holidays;
  - `GET /calendars/{id}/working-days`.
- `computeWorkingDayDueDate(db, organizationId, raisedOn, n)` serves BE-B and BE-C. It uses the organization's active default calendar and returns `calendarId`/`calendarVersion` to store next to a due date.
- No holiday is seeded or hard-coded. A holiday is removed by a status change and never deleted.
- `organization/routes.ts` gets one line: `ensureDefaultCalendar(tx, id, …)`, which calls `p4_ensure_default_calendar` inside the organization-create transaction (Asia/Riyadh, Sunday–Thursday, zero holidays, audited as the user with source `api`).
- **Tests:**
  - `apps/api/test/integration/calendar/calendar.test.ts`: A09 end to end through the API. Before the holiday the result is 2026-10-21; after it, 2026-10-22 with `skippedDates` = holiday 15, weekend 16 and 17. The default calendar of a new organization is checked, with no holidays.
  - `addWorkingDays` unit tests: Unknown without a calendar.
- The working-day endpoint answers Unknown for an **archived** calendar. That calendar is not in use, so the endpoint never guesses a date. This is my reading; ADR-0025 states Unknown only for "no active default calendar".

### REQ-S15-008: time semantics and currency

**Acceptance:** "A05;A09: a KPI actual for period 2026-10 entered on 2026-11-02 23:30 Asia/Riyadh keeps observation period 2026-10, business date 2026-11-02 and a UTC event timestamp; changing the default currency affects only new records."

**Delivered:**

- `businessDateOf(at, timezone)` in `packages/shared/src/time/business-date.ts`, the TypeScript twin of `p4_business_date`. It is pure and locale-independent: Latin digits, Gregorian calendar.
- Unit tests cover 2026-11-02T20:30Z → 2026-11-02 and 2026-11-01T21:30Z → 2026-11-02, not the UTC date.
- The integration test checks that `businessDateOf` equals SQL `p4_business_date` for four instants around midnight in Riyadh.
- The integration test also changes the organization's `defaultCurrency` from SAR to USD:
  - an existing transformation keeps SAR;
  - a new one gets USD;
  - the test restores SAR afterwards.
- **Not mine:** the KPI actual columns themselves belong to slice A (ADR-0027, KBE-C). This row completes when they land.

### REQ-S16-005: kit and restart test

**Acceptance:** "A13: killing the worker mid-job and restarting it completes the job exactly once with no duplicate notification."

**Delivered:**

- `apps/worker/src/kit.ts`:
  - `runOnce(db, consumer, key, fn)` writes the effects and the `processed_message` ledger row in one transaction, ledger row first. A duplicate returns `duplicate`.
  - `jobActor(jobId)` is the audit actor `service`/`worker`.
  - `createWorkItemOnce` is the worker twin (see §4 item 3).
- `apps/worker/src/schedules.ts`:
  - registers every enabled `job_schedule` row that has a handler with `boss.schedule(queue, cron, {}, { tz })`;
  - unschedules disabled rows;
  - reports rows without a handler as `unhandled` and does not schedule them, so no job is produced without a consumer;
  - re-syncs on the outbox event `job_schedule.updated`.
- `apps/api/src/modules/jobs/schedules.ts` holds the two job-schedule operations, with `job.read`/`job.configure` for ADM_TECH only. A change writes its audit event and the `job_schedule.updated` outbox event in the same transaction.
- **Kill and restart:** `apps/worker/test/integration/restart.test.ts` proves it as follows:
  1. A real child process (`node --conditions=@mth/source`, the production `startWorker`) takes a probe job. The probe uses only `runOnce` and `createWorkItemOnce`.
  2. It stops inside its transaction after writing the task and the reminder, then gets **SIGKILL**.
  3. Nothing is committed: 0 tasks, 0 reminders, 0 ledger rows.
  4. A restarted worker gets the job again, because pg-boss expires the dead worker's active job and retries it.
  5. It completes the job: exactly 1 task, 1 reminder, 1 ledger row, and one audit event of each kind.
  6. A redelivery of the same job outputs `{ outcome: "duplicate" }`, and the counts are unchanged.
- pg-boss on the product PostgreSQL remains the only queue.

### REQ-S12-005: kit and `createWorkItemOnce`

**Acceptance:** "A13: a period opening creates one task per KPI owner; a worker restart during the run creates no duplicates."

My part is the kit and `createWorkItemOnce`. The period-open handler belongs to KBE-C.

**Delivered:**

- `apps/api/src/modules/tasks/service.ts` `createWorkItemOnce(tx, actor, input)`:
  - writes the work item and one inbox notification with the same dedupe key, plus their audit events;
  - uses `INSERT … ON CONFLICT (organization_id, dedupe_key) DO NOTHING` and returns `created | existing`;
  - stores the i18n key and parameters, never a sentence;
  - accepts relative links only.
- `closeWorkItemsOfSubject` is the system close for approval tasks (BE-B).
- The 5 task and inbox operations are in `tasks/routes.ts`:
  - only the assignee sees an item; anyone else gets 404;
  - completion by someone else in the same organization is 403 `work_item.not_assignee`; in another organization it is 404;
  - `approval_decision` and `approval_escalated` refuse manual completion with 422 `work_item.system_managed`;
  - the inbox lists newest first with `unreadCount`, and a reminder is marked read only once.
- **Tests:** `apps/api/test/integration/tasks/work-items.test.ts` covers:
  - one task and one reminder per key, with a repeat creating nothing;
  - six concurrent calls → exactly one;
  - API/worker twin parity;
  - ordering and cursor pages;
  - every refusal text.
- **Not mine:** the restart half of this row is proven by the restart test above. The literal "one task per KPI owner" is KBE-C's handler test.

## 2. Shared rules (p4-work-split §1)

- **S-1:** names use the shared `name` rule (`trimmedText`). Blank and invisible-only names are 400, and this is tested.
- **S-2:** no route-local parser. JSON and query parsing is the platform's strict UTF-8 path.
- **S-3:** every new route's `config.consumes` matches its operation. The JSON bodies declare `application/json`, and the two bodiless POSTs declare none. The contract test `consumesDrift` reports no difference.
- **S-4:** every mutation has the following, each covered by an integration test:
  - authorisation re-checked inside the write transaction on reloaded grants, using the BE18A session-lock technique (`test/integration/calendar/session-lock.ts`). It is tested for:
    - calendar create and update (403, audited `authorization.denied`);
    - holiday create and update (403);
    - job update (403, audited);
    - work-item complete and inbox read (401 when the session ended);
  - zod validation and the ADR 422 rules;
  - `If-Match`, with 428 when missing and 409 when stale;
  - one audit event per changed row, in the same transaction;
  - no remote I/O inside the transaction;
  - AUD gets 403 (or 404 where existence is not disclosed) on every write.
- **S-5:** slice I stores no money. A due date that cannot be computed is `null` with a reason.
- **S-6:** work items and reminders store `messageKey` + `messageParams`.
- **S-8:** the ports used were 23801–23849. The unit tests ran with the locale unset and with `C.UTF-8`.
- **S-9:** no file under `packages/shared/src/formula/**` was changed.
- **S-10:** see §5 for the pending-list delta. BE-A created a `p4-exercises-<task>.ts` stub for every P4 task with operations (19 files) and wired every one into `contract.test.ts`.
- **S-11:** codes and English texts are exactly those of ADR-0025 §1, §3 and §4, and of ADR-0026 §2–§7 for the database mappings. They are pinned in `db-errors-p4.test.ts`, `tasks.test.ts` and the integration tests.
- **S-12:** no migration was written. `0032` is the orchestrator's no-op (D-090).
- **S-13:** the kit is in place. Job audits use `service`/`worker`.
- **S-14:** not applicable. Slice I writes no approval.

## 3. Changed files

**Module registry and composition**

| File | Purpose |
|---|---|
| `apps/api/src/modules.ts` | `P4_MODULES` (`tasks`, `governance`, `raid`, `benefits`, `adoption`, `sustainment`), each with its `dependsOn`. `workflows`, `kpi` and `portfolio` gain `organization` + `tasks`; `reporting` gains the P4 read sources (never `workflows`); `jobs` gains `access`. `SECTION16_MODULES["formulas/KPI"] = ["kpi", "benefits"]`. |
| `apps/api/src/server.ts` | Registers the calendar, job-schedule, P4 access and workspace-header route files, and the six P4 modules. |
| `apps/api/src/architecture.test.ts` | P4 module pins: suites exist; `tasks` is a leaf; only `governance` imports `workflows`; the updated `workflows`/`portfolio` pins; the §16 map. |
| `apps/api/src/architecture.testkit.ts` | `@mth/shared/time` added to the allowed shared imports. |
| `apps/api/src/server.test.ts` | Module-list pin, plus `tasks` active with 5 routes. Follows `server.ts`. |
| `apps/api/src/modules/{reporting/reporting.test.ts,kpi/kpi.test.ts,workflows/workflows.test.ts}` | `dependsOn` pins updated to the new `modules.ts`. Each is a one-block edit in another owner's suite, forced by the registry change. |
| `apps/api/src/modules/{governance,raid,benefits,adoption,sustainment}/index.ts` | Module hooks. Each reports `scaffold` until a route exists, then `active`. |
| `apps/api/src/modules/{governance,raid,benefits,adoption,sustainment}/<module>.test.ts` | Module suites. |
| `apps/api/src/modules/benefits/routes.ts` | Registration lines: KBE-D's, then KBE-E's. |

**Route-file stubs (58 files)**

Each stub returns `[]`, names its owner task, and already has its registration line. The registration lines were added to the existing `access/p4-routes.ts` (new), `workflows/index.ts`, `portfolio/index.ts`, `kpi/routes.ts`, `reporting/index.ts`, `transformations/index.ts` (export) and `server.ts`.

| Owner | Stub files |
|---|---|
| BE-B | `access/{groups,role-mappings,delegations}.ts`, `workflows/approvals.ts` |
| BE-C | `governance/{decision-rights,raci,matrices}.ts` |
| BE-D | `raid/routes.ts` |
| BE-E | `portfolio/{budget,schedule-network}.ts` |
| BE-F | `governance/{forums,meeting-series,meetings,agenda,minutes}.ts` |
| BE-G | `governance/{executive-decisions,escalations}.ts` |
| BE-H | `adoption/routes.ts` |
| BE-I | `sustainment/{performance-areas,handovers,controls,improvement,lessons}.ts` |
| BE-J | `sustainment/{status-model,transition-decisions,closure}.ts` |
| BE-K | `workflows/gate-exceptions.ts` |
| BE-L | `workflows/{change-requests,impact,phase-steps}.ts` |
| BE-M | `reporting/{traceability,orphans,modular}.ts` |
| KBE-B | `kpi/{kpi-versions,trajectories,data-quality,kpi-formulas}.ts` |
| KBE-C | `kpi/{actuals,reporting-periods,accept-pipeline,calculation-runs,rag-overrides,kpi-status}.ts` |
| KBE-D | `benefits/{register,lifecycle,allocations,groups,overlaps,scenarios}.ts` |
| KBE-E | `benefits/{measurements,finance-validation,corrections,totals}.ts` |
| KBE-F | `adoption/indicators.ts` |
| KBE-G | `reporting/dashboards/index.ts`, `reporting/{my-work,executive-overview}.ts`, `transformations/workspace-header.ts` |

No stubs were created for `workflows/g5.ts`/`g6.ts`. They are evaluators, not route files, and BE-K creates them.

**Calendar, tasks, jobs and platform**

| File | Purpose |
|---|---|
| `apps/api/src/modules/organization/calendar.ts` (new), `organization/index.ts`, `organization/routes.ts` (1 line + import) | Calendar and holiday routes, `computeWorkingDayDueDate`, `defaultCalendarTimezone`, and the default calendar on organization create. |
| `apps/api/src/modules/tasks/{index,service,routes,tasks.test}.ts` (new) | `createWorkItemOnce`, `closeWorkItemsOfSubject`, the 5 task and inbox operations. |
| `apps/api/src/modules/jobs/schedules.ts` (new), `jobs/outbox.ts` (new), `jobs/index.ts` | Job-schedule routes. The outbox writer moved unchanged into `outbox.ts` and is re-exported from `index.ts`. |
| `apps/api/src/modules/platform/db-errors.ts`, `db-errors-p4.test.ts` (new) | The P4 slice I and C constraint mappings of §I+C.1, with the exact ADR texts. |

**Shared package**

| File | Purpose |
|---|---|
| `packages/shared/src/time/{index,working-days,business-date,working-days.test}.ts` (new) | `@mth/shared/time`. |
| `packages/shared/package.json` | **Local** `./time` exports entry (see §4 item 1). |
| `packages/shared/src/schemas/{calendar,jobs,tasks}.ts` (new), `schemas/index.ts` (3 lines) | zod mirrors, plus `isFiveFieldCron`. |
| `packages/shared/src/schemas/events.ts` | `job_schedule.updated` v1 outbox payload (see §4 item 2). |

**Worker**

| File | Purpose |
|---|---|
| `apps/worker/src/queues/{index,platform,spec}.ts` | The former `queues.ts` content, the `job_schedule.updated` queue, and the domain registry. |
| `apps/worker/src/queues/{approvals,access,kpi,benefits,raid,meetings,escalations,adoption,sustainment,gates}.ts` | Per-domain stubs. |
| `apps/worker/src/handlers/{index,platform,spec}.ts` | The former `handlers.ts` content and the handler registry. |
| `apps/worker/src/handlers/{approvals,access,kpi,benefits,raid,meetings,escalations,adoption,sustainment,gates}.ts` | Per-domain stubs. |
| `apps/worker/src/{queues,handlers}.ts` | Compatibility re-exports (see §4 item 9). |
| `apps/worker/src/kit.ts` (new) | `runOnce`, `jobActor`, the `createWorkItemOnce` twin. |
| `apps/worker/src/schedules.ts` (new) | Schedule registration and the `job_schedule.updated` consumer. |
| `apps/worker/src/{worker,relay,main,index}.ts` | Starts the domain handlers, syncs schedules, new import paths, exports. |
| `apps/worker/README.md` | Path of the platform handlers. |

**Tests and harness**

| File | Purpose |
|---|---|
| `apps/worker/test/integration/{restart,schedules}.test.ts`, `apps/worker/test/{restart-child,restart-probe}.ts` (new) | Kill-and-restart and schedule tests. |
| `apps/worker/test/{support.ts,integration/outbox.test.ts,integration/maintenance.test.ts}` | Import paths. The maintenance queue pin adds `job_schedule.updated` and the domain queues. |
| `apps/api/test/integration/{calendar/calendar.test.ts,calendar/session-lock.ts,tasks/work-items.test.ts,jobs/job-schedules.test.ts}` (new) | The slice I integration suites. |
| `apps/api/test/integration/contract/p4-exercises-be-a.ts` (new) | My 15 operations. |
| `apps/api/test/integration/contract/p4-exercises-{be-b…be-m,kbe-b…kbe-g}.ts` (new) | 18 stubs. |
| `apps/api/test/integration/contract/contract.test.ts` | Imports and calls all 19 P4 seams. Pins: media-type triple `[150,149,1]` → **`[155,154,1]`**; rate-limit floor `>= 270` → **`>= 285`**. The operation total of 321 is unchanged. |
| `apps/api/test/integration/contract/{malformed-input,media-types,platform-statuses}.ts` | Well-formed values: `jobCode` → `approval.escalation_scan`, `matrixKind` → `raci`. |
| `apps/api/test/support/harness.ts` | `P4ExerciseContext`. |
| `apps/api/test/support/p4-pending-be-a.ts` | Now empty. |

## 4. Contract, schema and ownership notes for the orchestrator

1. **Request: merge the `@mth/shared/time` exports line** (p4-plan §5.3). I added it **locally** to `packages/shared/package.json` (`"./time": { "@mth/source": "./src/time/index.ts", "types": "./dist/time/index.d.ts", "default": "./dist/time/index.js" }`) so that typecheck, build and the tests could run. The API allow-list line in `architecture.testkit.ts` is also added.
2. **Outbox payload schema.** `job_schedule.updated` needs a v1 entry in `packages/shared/src/schemas/events.ts`, because `enqueueOutboxEvent` refuses unknown events. I appended it there. The file is not in my explicit list, but the work split requires the event. It is internal and not part of the HTTP contract. `outbox_event.organization_id` is NOT NULL while `job_schedule` is platform-wide, so the event carries the acting administrator's organization.
3. **`createWorkItemOnce` exists twice.** The worker may not import API code (ADR-0002 rule 5), and the KBE-C and BE-B handlers need the function in the worker. So `apps/worker/src/kit.ts` has a twin of `tasks/service.ts`:
   - it is the same SQL, except that ids come from `mth_uuid_v7()`, because the worker has no `uuid` dependency and I did not change the lockfile offline;
   - `work-items.test.ts` checks that both write identical rows.
   **Recommendation:** move the single implementation into `@mth/db` (`packages/db/src/work-items.ts`, frozen to me) and make both entries re-export it.
4. **`runOnce` takes `db` explicitly:** `runOnce(db, consumer, key, fn)`. ADR-0025 §3 writes the abstract form `runOnce(consumer, key, fn)`.
5. **Schema needs: none.** No migration was written. `0028` was sufficient as designed.
6. **Texts not fixed by an ADR:**
   - `role_mapping.already_mapped` (409, database mapping only) uses "This party is already mapped in this transformation. End the current mapping first.", taken from the openapi summary. BE-B should use the same text or ask ARCH to fix one.
   - The database-level mappings of `delegation.loop` and `raci.accountable_count` cannot know person or deliverable names, so they use a generic fill. The services (BE-B, BE-C) answer first with the full ADR text.
   - `approval.stale_version` and `calendar.code_taken` take their values from the database message.
7. **`SYSTEM_MANAGED_KINDS`** is a constant in `tasks/routes.ts` (BE-A): `approval_decision` and `approval_escalated`. A later kind that must close with its subject needs a one-line edit of this file by the orchestrator, or a registry function if preferred.
8. **The workspace header stub** sits in `transformations`, which almost every module depends on. KBE-G must read the other engines through an injected provider (the `GateFactsProvider` pattern), or it would create a module cycle.
9. **The worker split versus the read-only git index.** `git mv` failed ("Read-only file system", `.git/worktrees/dg4-be-a/index.lock`). Without index updates, the deleted `queues.ts` and `handlers.ts` would still be listed by `git ls-files -c`, and the prettier acceptance command would fail on them, as observed in my first run. I therefore kept `apps/worker/src/queues.ts` and `handlers.ts` as two-line compatibility re-exports of the new `queues/index.ts` and `handlers/index.ts`. The orchestrator may `git rm` them at integration; nothing imports them now.
10. **Edits outside the literal file list**, each forced by an owned change:
    - the four `dependsOn` and module-list pins (§3);
    - the worker test import paths and the queue pin;
    - the worker README line;
    - the `jobs/index.ts` → `outbox.ts` move;
    - `events.ts`;
    - `access/p4-routes.ts` with its `access/index.ts` export line;
    - the `organization/index.ts`/`transformations/index.ts` export lines.
11. **Untracked files I did not create:** `CLAUDE.local.md`, `.zshrc`, `.bashrc` and the other dotfiles in the worktree root are environment artifacts. I did not modify or stage them.

## 5. Operations routed (delta to `p4-pending-be-a.ts`)

`P4_PENDING_BE_A`: **15 → 0**. All 15 are routed, exercised with a success and their zod mirror in `p4-exercises-be-a.ts`, and covered by the dedicated suites:

- `listBusinessCalendars`, `createBusinessCalendar`, `getBusinessCalendar`, `updateBusinessCalendar`;
- `listCalendarHolidays`, `createCalendarHoliday`, `updateCalendarHoliday`;
- `computeWorkingDayDueDate`;
- `listJobSchedules`, `updateJobSchedule`;
- `listMyWorkItems`, `getWorkItem`, `completeWorkItem`;
- `listMyInbox`, `markInboxNotificationRead`.

`P4_PENDING_BE_B` (23) and `P4_PENDING_BE_C` (13) are unchanged.

## 6. Checks run (final tree; logs in `docs/delivery/handbacks/DG4/T-DG4-BE-A-evidence/`)

Environment: Node 24.21.0, offline. The disposable PostgreSQL came from `tests/qa/support/with-pg.sh` (PGBIN = newest `/usr/lib/postgresql/*/bin`) on ports 23801–23849.

End time: `2026-10-09T02:54:07Z` (about 56 minutes after the start).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | All 6 packages pass. | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | All packages build. | `build.log` |
| 3 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | Clean. | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 321 operations` | `openapi-lint.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | unit-node + unit-web: 89 files, **1707/1707**. unit-formula-nocodegen: 3 files, **259 passed / 2 skipped** (D-090 baseline: 1657 + 259/2). | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | The same: **1707/1707**, then **259 passed / 2 skipped**. | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 61 files, **844/844** (D-090 baseline: 794). See the breakdown below. | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)`, at the start and at the end. | `validate-dg3-historical{-start,}.log` |

Breakdown of the +50 integration tests:

- +19 P4 seam cases in `contract.test.ts`, which now has 44 tests;
- +13 in `calendar.test.ts`;
- +12 in `work-items.test.ts`;
- +3 in `job-schedules.test.ts`;
- +1 in the worker `restart.test.ts`;
- +2 in the worker `schedules.test.ts`.

Pinned-count changes, all in `contract.test.ts`:

- media-type triple `[150,149,1]` → `[155,154,1]`;
- rate-limit floor `>= 270` → `>= 285`.

**Disclosed non-zero exits during the work.** Each was fixed and re-run; none remains:

- Contract test run 1: exit 1. My exercise sent `cron: "* * *"`, which is shorter than the contract's `minLength: 9`, so the correct answer was 400, not 422. I changed the probe to `"61 * * * *"`.
- Worker integration run 1: exit 1. `maintenance.test.ts` pinned the P1 queue list, and the new `job_schedule.updated` queue was missing from it. I updated the pin.
- First unit run: exit 1. `kpi.test.ts` and `workflows.test.ts` pinned the old `dependsOn` lists. I updated both pins.
- First prettier check: exit 123. The deleted `queues.ts`/`handlers.ts` were still listed in the git index (see §4 item 9). Fixed with the shims.
- One `tsc` error (TS4111) in `restart-child.ts`. Fixed.

There were no flaky tests or timeouts.

## 7. What remains

Nothing in §I+C.1 is open. These items are outside my scope:

- **REQ-S12-005:** KBE-C's `kpi.reporting_period_open` handler (`apps/worker/src/handlers/kpi.ts`, stub in place) is what proves "one task per KPI owner".
- **REQ-S15-008:** completes when slice A's KPI-actual columns land (ADR-0027).
- **REQ-S16-005:** QA's A13 run.
- **Problem-code i18n:** the `i18n/{en,ar}/problems.json` keys for every slice I code (`calendar.*`, `job.*`, `work_item.*`, `inbox.*`) belong to FE-A, as do the Administration > Calendar, Administration > Jobs and My Work screens.
- **Merge items for the orchestrator:** the §4 item 1 exports line, and optionally the §4 item 3 consolidation and the `git rm` of the two worker shims.

## 8. Merge instructions

- **No migration to run.**
- **Ordering:** this change must merge **before** any other P4 implementer integrates (p4-plan §5.2). ARCH-02 owns `0033`, the slice A contract, ADR, schema and catalogue. It touches none of my files, so no conflict is expected. If ARCH-02 also edits `contract.test.ts` pinned counts, reconcile the media-type triple and the rate-limit floor from both handbacks.
- **Pinned counts after this change:**
  - media-type triple `[155, 154, 1]`;
  - rate-limit floor `>= 285`;
  - `operations` 321, unchanged;
  - unit 1707 + 259 passed / 2 skipped;
  - integration 844.
