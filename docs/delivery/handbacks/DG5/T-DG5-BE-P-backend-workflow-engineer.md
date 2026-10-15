# Handback T-DG5-BE-P (backend-workflow-engineer): the 90-day launch plan, tasks, predecessors, template and the S12-004 port

- **Stage:** P5 / DG5 (BUILDING). Assignment `docs/delivery/assignments/DG5/T-DG5-BE-P.md` (sha256 `daed88fc…ddde`, verified). Scope: `docs/architecture/p5-work-split.md` §H.1.
- **Invocation:** `DG5-T-DG5-BE-P-backend-workflow-engineer-20261015T165642Z-2c3fab11`, session `2c3fab11-732b-48d6-8568-ed987a596f70`.
- **Base:** branch `dg5/be-p` at `fedb63d`. Changes are **uncommitted** for the orchestrator.
- **Time:** start `2026-10-15T17:01:32Z`, end `2026-10-15T18:34:32Z` (`date -u`).
- **Migrations:** none. `0086`/`0087` (ARCH-05) are used as delivered. No dependency was added.
- **Gates:** a launch plan is not a business approval. Nothing here reads or writes DG0–DG7. All test data is synthetic.

## Read this first: what is not green

1. **`pnpm test` did not pass in this run.** This host was saturated: load average 21–39 with four agents running, and one `tsc` was OOM-killed.
   - Runs 1–3 of `pnpm test` with the locale unset:
     - Run 1 had **two real defects of mine**. Both are fixed, and their files pass on their own (§3).
     - Run 2 overlapped run 3 by mistake: I backgrounded run 2, then started run 3 while run 2 was still running. Both were stopped by the runner's time limit.
     - Run 3 failed only on timeouts.
   - Under that load the remaining failures are timeouts of tests I did not touch:
     - `architecture.test.ts`: two AST-scan tests at 51–63 s against a 30 s budget. They pass in 23 s on their own.
     - Several `unit-web` tests (20–28 s, web code unchanged).
   - The `C.UTF-8` run was **not run**. So acceptance item 2 is **not met by this run**: FAILED or BLOCKED by load. It needs the orchestrator's merged-tree verification at normal load.
2. **`pnpm test:integration` did not complete.** At 18:29Z, after 28 minutes, the Vitest worker pool crashed with `ERR_IPC_CHANNEL_CLOSED`: a pool child died under memory pressure.
   - Before the crash, 76 test files finished. 75 passed; `contract.test.ts` passed 76 of its 77 tests.
   - The one failure is the expected media-type pin (§4).
   - Acceptance item 3 is **not met by this run** (incomplete). My own suites pass in full when run alone (§3).
3. **The worker side of the S12-004 port is outside my file ownership.** Read §6 and decide on the proposed patch.
   - Starter 1 runs in the **worker**, and the worker may not import API code (ADR-0002).
   - §H.1 gives me only `launch/port.ts` and its `server.ts` line. With only that, the production starter still calls the worker's no-op port.
   - I wrote and tested a worker twin plus BE-J's "with the plan flag" test as a **patch in my evidence directory**. It is not applied to the tree. The patch's tests pass: 37/37 in a scratch clone.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/launch/routes.ts` | BE-A's stub filled: registers template, plan, task and predecessor routes (BE-P2 appends after). |
| `apps/api/src/modules/launch/template.ts` (new) | `getLaunchPlanTemplate`: the three B0134 windows and 33 items, verbatim, from the `0086` catalogues. |
| `apps/api/src/modules/launch/plan.ts` (new) | `getLaunchPlan`, `generateLaunchPlan`, `updateLaunchPlan`. The generation core `generateLaunchPlanInTx` takes lock class `launchPlan`; re-dating; calendar-day helpers. |
| `apps/api/src/modules/launch/tasks.ts` (new) | `listLaunchTasks`, `createLaunchTask`, `getLaunchTask`, `updateLaunchTask`. Status rules, output links, owners, `blockedBy`, `nonWorkingDay`. |
| `apps/api/src/modules/launch/predecessors.ts` (new) | `putLaunchTaskPredecessors`: replaces the active set; removals are stamped; loop and other-plan checks. |
| `apps/api/src/modules/launch/port.ts` (new) | The `LaunchPlanPort` generator of the API process. A replay returns the existing plan. |
| `apps/api/src/modules/launch/plan-dates.test.ts` (new) | Unit tests: calendar-day arithmetic and the loop check. |
| `apps/api/src/server.ts` | One import pair and one line: `registerLaunchPlanPort(launchPlanGenerator)`. launch may not import automation (module map), so the composition root does the wiring. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP5LaunchPlanError` (the `launch_plan.*`/`launch_task.*` constraint lines) and its one dispatch line. |
| `packages/shared/src/schemas/launch.ts` (new) + barrel line in `schemas/index.ts` | zod mirrors of the 12 launch-plan OpenAPI components. |
| `apps/api/test/integration/launch/launch-plan.test.ts` (new) | 11 integration tests (§2, §3). |
| `apps/api/test/integration/contract/p5-exercises-be-p.ts` | All 9 operations through the validating client: success and every reachable refusal. |
| `apps/api/test/support/p5-pending-be-p.ts` | Emptied (9 → 0). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-P-*` | This handback and its evidence. |

## 2. Behaviour delivered, per requirement row

### REQ-PB-086 (BE-P: generation, dating, port)

Acceptance: *"A16: with start date 2026-10-01 the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30; all actions of B0134 appear"*.

- `POST /api/v1/transformations/{id}/launch-plan {startDate}` (TL, TO) runs in one transaction under lock `launchPlan`. It creates:
  - the plan (`generated_via = request`);
  - one task per `launch_template_item`: 17 actions, 15 outputs, and the Day-90 test task, each titled with the verbatim fragment;
  - the `day_ninety_test` row, scheduled on start + 90.
- Day *d* = start + *d* calendar days (D-142 Q6).
- Tested in `launch-plan.test.ts` › "generates 33 tasks…":
  - with 2026-10-01, the 11 Days 31-60 tasks start 2026-11-01 and are due 2026-11-30;
  - the 17 action titles, rejoined per window with `; `, equal `launch_window.actions_source_en` without its final `.`;
  - the Day-90 task and the test fall on 2026-12-30;
  - one audit event per row (plan, 33 tasks, test), each at version 1.
- **Non-working days:** a due date on a non-working day of the organization's default calendar returns `nonWorkingDay: true` and keeps its date. With a Sunday–Thursday workweek, the Days 0-30 tasks are due 2026-10-31 (a Saturday): flagged, not shifted.
- A second generate gives **409 `launch_plan.exists`**, with the exact text, and writes nothing.
- `getLaunchPlanTemplate` (any signed-in user) returns the windows and items verbatim. Its test checks that the actions and outputs rejoin to both source cells.
- **Port:** `launchPlanPort()` in the API process is `launchPlanGenerator` (asserted). Replayed three times, it returns `created`, `existing`, `existing` and leaves one plan (`generated_via = automation`, the audit actor is the service on behalf of the creator). A bad idempotency key throws.

### REQ-S14-004 (BE-P: tasks, owners, predecessors, re-dating)

Acceptance: *"A16: moving the start date by +7 days moves every unstarted task by 7 days and leaves completed tasks unchanged; a task whose predecessor is incomplete shows 'blocked by' the predecessor"*.

- **Re-dating:** `PATCH …/launch-plan {startDate}` with `If-Match`, Δ = new − old:
  - every `not_started` task moves both dates by Δ (version + 1 and one `launch_task.redate` audit event each);
  - in-progress, completed and cancelled tasks keep their dates;
  - the open Day-90 test moves by Δ;
  - `lastShiftDays = Δ`.
  - The same date again writes nothing.
  - Test: +7 moves 31 unstarted tasks by exactly 7 and leaves the completed and the in-progress task unchanged. The test moves 2026-12-30 → 2027-01-06.
- **Blocked by:** `putLaunchTaskPredecessors` replaces the active set. `blockedBy` is the list of active predecessors that are not completed. The test checks that `blockedBy` names "Agree North Star/outcomes" until that task is completed; a blocked task can still be started.
- **Loops and other plans:**
  - a predecessor loop through active links → 422 `launch_task.predecessor_cycle`;
  - the task itself → 422 `launch_task.predecessor_cycle`;
  - a task outside the plan → 422 `launch_task.predecessor_other_plan`.
  - The texts are exact.
- **Link history:** a removed link is stamped `removed_at`/`removed_by` (version 2, its own audit event) and never deleted. Re-adding a pair creates a new row.
- **Task edits:**
  - Status steps follow the `0086` list; otherwise 422 `launch_task.status_step`.
  - A completed task keeps its dates (422 `.completed_dates_fixed`).
  - A cancelled task is final (422 `.cancelled`).
  - A template task keeps its output type, and the output record must exist in the transformation (422 `.output_record_invalid`).
  - Owners must be active users of the organization (422 `validation.user_invalid`).
  - `createLaunchTask` adds a `custom` task at version 1 with the next ordinal.
- Every mutation:
  - checks the read gate on the request principal (outsider 404), then re-checks `launch_plan.edit` at commit time (a grant revoked mid-request → 403, nothing written; tested);
  - refuses AUD, SP and WL with 403 (tested);
  - validates;
  - returns 428 without `If-Match` and 409 when stale (tested on all three versioned mutations);
  - writes one audit event per row in the same transaction;
  - does no remote I/O.

### REQ-S12-004 (BE-J's pending test "with the plan flag the 90-day tasks are dated from the start date")

- The API port is implemented and registered.
- The worker twin, its wiring, BE-J's test and the pending-list update are in the **proposed patch** (§6), not applied. **This row's pending test is therefore still pending in the tree.**

## 3. Checks actually run (logs under `T-DG5-BE-P-evidence/`)

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start, 17:01Z) | exit 0, `PASS gate DG4 (historical)` (`validate-historical-DG4-start.log`) |
| `pnpm -r typecheck` | exit 0 (`static-checks.log`) |
| `pnpm -r build` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm openapi:lint` | exit 0 |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 (`prettier-check.log`) |
| `with-pg.sh npx vitest run --project integration apps/api/test/integration/launch` (port 24251) | 11/11 passed, exit 0 (`launch-integration-alone.log`; the first attempt failed 1/11, an outsider got 403 instead of 404, fixed by putting the read gate first) |
| `with-pg.sh npx vitest run --project integration …/contract/contract.test.ts` | 76/77; the one failure is the media-type pin `[375, 374, 1]` vs `[370, 369, 1]` (§4) (`contract-test-alone.log`) |
| `pnpm test`, locale unset, **run 1** | exit 1: 2 failures, both mine, fixed. (a) `architecture.test.ts`: `launch/port.ts` imported `automation` (not in launch's `dependsOn`), and `tasks.ts` used computed member keys in the audit diff. (b) `advisory-locks.test.ts`: my comments spelled the lock class number. After the fix: `npx vitest run --project unit-node architecture.test.ts advisory-locks.test.ts modules/launch server.test.ts` → **155/155**, 5 files. (`unit-locale-unset-run1-FAILED-fixed-later.log`) |
| `pnpm test`, locale unset, **run 2** | Overlapped run 3 by my error; stopped by the runner's time limit. Its partial log shows the architecture AST test timed out (40 s > 30 s). (`unit-locale-unset-run2-timeout-under-load.log`) |
| `pnpm test`, locale unset, **run 3** | unit-node 1973/1974 (only failure: the architecture AST test **timed out**, 51 s > 30 s). unit-web had several timeouts in screens I did not touch. Stopped by the runner's 30-min limit before it finished. (`unit-locale-unset.log`) |
| `npx vitest run --project unit-node`, locale unset (18:22–18:30Z, load 33) | exit 1: 1972/1974; the 2 failures are both "Test timed out in 30000ms" in `architecture.test.ts` (62.7 s and 30.3 s) (`unit-node-locale-unset.log`) |
| `pnpm test` with `C.UTF-8` | **NOT RUN** (time; host load) |
| `with-pg.sh pnpm test:integration` (ports 24260–24299, 18:00–18:29Z) | **Incomplete**: the Vitest pool crashed (`ERR_IPC_CHANNEL_CLOSED`). 76 files finished: 75 passed, and contract was 76/77 (the pin) (`integration.log`) |
| The proposed worker patch's tests, in a scratch clone (`with-pg.sh npx vitest run --project integration apps/worker/test/integration/starters.test.ts apps/api/test/integration/launch`, port 24280) | **37/37**, exit 0: starters 25 including the new test, launch 11, parity 1 (`proposed-worker-port-tests.log`). Also in the clone: the worker `tsc --noEmit` exited 0, and eslint and prettier ran clean on the patch files. The API `tsc` in the clone was OOM-killed ("Killed"), so the parity test file is **not typechecked**. |
| `node tools/gates/validate.mjs --historical --stage DG4` (end, 18:30Z) | exit 0, `PASS gate DG4 (historical)` (`validate-historical-DG4-end.log`) |

## 4. Contract seams and pinned counts (for the orchestrator)

- **Pending list delta:** `p5-pending-be-p.ts` goes from 9 to **0**. Removed:
  - `getLaunchPlanTemplate`, `getLaunchPlan`, `generateLaunchPlan`, `updateLaunchPlan`;
  - `listLaunchTasks`, `createLaunchTask`, `getLaunchTask`, `updateLaunchTask`;
  - `putLaunchTaskPredecessors`.

  All nine are exercised in `p5-exercises-be-p.ts` with their zod mirrors.
- **Media-type pin: `[370, 369, 1]` → `[375, 374, 1]`.** That is +5 JSON bodies: `generateLaunchPlan`, `updateLaunchPlan`, `createLaunchTask`, `updateLaunchTask` and `putLaunchTaskPredecessors`; the four GETs add none.
  - Suggested comment: `// T-DG5-BE-P: + 5 (generateLaunchPlan, updateLaunchPlan, createLaunchTask, updateLaunchTask, putLaunchTaskPredecessors; JSON bodies).`
  - I did not edit `contract.test.ts` (the BE-L/BE-M precedent).
- **Rate-limit floor:** I saw no change reported. Only the media-type assertion failed.

## 5. Contract, codes and dependency needs

- **No dependency** and **no migration** needed.
- **One refusal text not in ADR-0048 §9.** A due date before the start date is refused by the API with **400** `validation` (field code `validation.constraint` at `/dueDate`), detail "The due date cannot be before the start date." The database's `launch_task_dates` CHECK backs it. The 400 is declared on every operation. Please confirm the code and text, or give one for the next ADR-0048 touch. The same code is used, as 422, for the 999-task cap ("The launch plan has reached its maximum number of tasks."), which no real plan reaches.
- **`nonWorkingDay` is `false` when the organization has no default calendar.** The contract makes it a non-nullable boolean, so Unknown cannot be expressed. A calendar-less organization therefore shows no warning rather than a false one. If you want Unknown, it needs a contract change, `[boolean, null]`.
- **Generated tasks have no owner** (`ownerUserId: null`). The TL or TO assigns owners through `updateLaunchTask`. The template seeds no owner, and none is invented.
- **Audit actions written:**
  - `launch_plan.generate`, `launch_plan.redate`;
  - `launch_task.generate`, `.create`, `.update`, `.redate`, `.predecessors_replace`, `.<status>` (for example `launch_task.completed`);
  - `launch_task_predecessor.add`, `.remove`;
  - `day_ninety_test.create`, `.redate`.

  FE-A/FE-F may need en/ar audit labels for these, the W4 precedent.

## 6. The worker side of the port: proposed patch (decision needed)

`T-DG5-BE-P-evidence/proposed-worker-port.patch` (sha256 `e2272e5b…a871`) applies on top of this change. It touches files I do not own:

- `apps/worker/src/automation/ports/launch-plan-generator.ts` (new). The worker twin of `generateLaunchPlanInTx`, the `automation/actions/common.ts` twin precedent:
  - same SQL and rows;
  - ids from `mth_uuid_v7()`, because the worker has no `uuid` dependency;
  - audit actor: the service on behalf of the creator, `source: worker`, `request_id: job:<id>`.
- `apps/worker/src/worker.ts`: one import and one call line, `wireWorkerLaunchPlanPort()` in `startWorker`.
- `apps/worker/test/integration/starters.test.ts`: BE-J's literal test "with the plan flag the 90-day tasks are dated from the start date (day d = start date + d calendar days)". The handler runs four times and leaves one plan:
  - Days 0-30 run 2026-10-01..2026-10-31; Days 31-60 run 2026-11-01..2026-11-30; Days 61-90 run 2026-12-01..2026-12-30;
  - the test is on 2026-12-30;
  - the audit reason is "90-day plan: created from 2026-10-01".
- `apps/api/test/support/p5-pending-be-j.ts`: `P5_PENDING_TESTS_BE_J` goes to `[]`.
- `apps/api/test/integration/launch/worker-parity.test.ts` (new): the worker and the API generator write identical plans, 33 tasks, tests and 35 audit events. Ids, the transformation and the creator are normalized. A worker replay writes nothing.

Result in a scratch clone: 37/37 (§3).

Alternatives, if you prefer:
- move the generation core into a package that both processes may import;
- assign these lines to BE-J or BE-P2.

Until one of these lands, REQ-S12-004's "with the plan flag" test stays pending, and a transformation created with `launchPlan` gets no plan from the worker.

## 7. User-facing texts

- The web P5 placeholder for the launch plan ("Not available yet … is being built") **stays true**: the screen is FE-F's. No en/ar string was made untrue by this backend work.
- The `source_element` rows of set `launch_window` keep `feature_status = 'planned'` until KBE-G2's `0088`, as the slice design says (H.4, ADR-0048 Consequences). The B0134 coverage view will call the launch windows "planned" until then. That is a decision for the orchestrator's wave order, not something I can change (no migration of mine).

## 8. What remains

1. **Green full suites at normal load, with every step run.** That means `pnpm test` with the locale unset and with `C.UTF-8` (the C.UTF-8 run was not run here), and `pnpm test:integration` to completion, with the media-type pin reconciled. This needs the orchestrator's merged-tree verification.
2. **The decision on §6** (the worker twin and BE-J's pending test).
3. The §5 confirmations: the date-order refusal code and text, and `nonWorkingDay` without a calendar.
4. BE-P2 (Day-90 test read, responses, completion and its job) is a separate task. This task creates the `day_ninety_test` row at generation and moves it on re-dating, and does nothing else for it.

## 9. Merge notes

- There is no migration.
- `db-errors.ts`: BE-C2 also edits this file in W11 (BE-L2's three mappings). Expect an additive conflict at the dispatch list in `mapDatabaseGuardError`; keep both.
- `server.ts`: one import pair and one call line after the `forms.pin` initializer.
- `packages/shared/src/schemas/index.ts`: one appended export line.
