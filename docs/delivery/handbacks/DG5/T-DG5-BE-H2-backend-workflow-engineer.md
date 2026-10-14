# Handback T-DG5-BE-H2 (backend-workflow-engineer): p5-work-split §D.2

## Continuation run (T-DG5-BE-H2B)

- **This run:** `DG5-T-DG5-BE-H2B-backend-workflow-engineer-20261014T102909Z-365936ee` (session `365936ee-1cc8-418e-89a6-37c2566c21be`), assignment `T-DG5-BE-H2B.md` (sha256 `42943e2c…ee8c6c`, verified). Started `2026-10-14T10:29:21Z`; the end time is in §3.0.
- **Interrupted run:** `DG5-T-DG5-BE-H2-backend-workflow-engineer-20261014T085105Z-8726f77b`. A container restart stopped it (exit 143, no result; D-147). Its transcript (`docs/delivery/test-evidence/DG5/BE-H2-orphaned/…/transcript.jsonl.gz`) ends while it was waiting for its full `pnpm test:integration` run, and that wait was killed (137). The orchestrator committed its tree as WIP `fabc9de` on `dg5/be-h2`.

**What I found**
1. **Every file in §1 exists and is complete.** I checked the end of every source and test file in `fabc9de`: none is truncated, and `routes.ts` already registers `dry-run.ts` and `lifecycle.ts` (BE-A/BE-H lines; nothing for me to add). All of them typecheck, build, lint and format, and the unit and integration suites run them (§3.0).
2. **The handback was unfinished.** §3.7 (integration), §3.8 (validator at the end) and §3.9 (end time) still held placeholders (`INTEGRATION_EXIT`, `VALIDATOR_EXIT`, `END_TIME`). `validate-dg4.log` was never written. The `pnpm lint` row pointed to "below" with no log.
3. **The first run's `integration.log` is truncated.** It stops after 207 files with no summary. It already contains an **undisclosed failure**: `tests/qa/integration/a13-job-idempotency.test.ts` › "A13 outbox relay: publishing twice enqueues one job" (`expected '<fan-out id>' to be '<event id>'`). The first run's §3 did not mention it.
4. **My re-run reproduces that failure deterministically:** 2115/2116 passed, exit **1** (§3.0, item 3). The cause is this task's queue map:
   - ADR-0043 §5 maps `transformation.created` (an admin-selectable trigger in `0074`) to `automation.evaluate`, so the event now fans out to two queues.
   - D-102's relay then gives each job `fanOutJobId(event, queue)` instead of the event id.
   - The DG1 QA test pins `jobs[0].id === event.id` (line 175). The rest of its intent still passes: one job, and no second job on a replayed send.
   - The first run updated the same pin in the DG4 worker tests it owned (§5.1), but not in this QA-owned file.
5. **The handback said "All changes are uncommitted"**, which is no longer true: the orchestrator committed them as WIP `fabc9de`. This run's own changes (handback and `-B` logs only) are uncommitted.

**What I fixed or did**
- **No source change was needed.** The tree is the WIP commit's code, unchanged.
- **I did not edit `tests/qa/integration/a13-job-idempotency.test.ts`.** It is the qa-verifier's acceptance suite and outside my §D.2 file ownership, and the assignment says to stay strictly inside it. I did three things instead:
  - wrote the one-assertion fix as `T-DG5-BE-H2-evidence/proposed-qa-a13-jobid-B.patch`. It derives the expected id from `jobsForEvent(event.id, QUEUES_FOR_EVENT["transformation.created"])` for the `transformation.created` queue, and keeps "exactly one job";
  - applied it temporarily and ran that file on its own disposable cluster: **5/5 passed, exit 0** (`proposed-qa-a13-jobid-run-B.log`);
  - reverted it with `git apply -R`, so `git status` shows no change under `tests/qa/`. `git checkout` could not be used because the worktree's git index is read-only in my sandbox.
  
  The orchestrator or the qa-verifier decides whether to apply the patch (§5.7 and §7).
- I removed one empty `.claude/.cc-writes` directory, inside the evidence folder, before the tests.
- I re-ran **every** acceptance check on the final tree (§3.0). I corrected §3, §5, §7 and §8 below, and kept the first run's table as history (§3.1–§3.9).

**Acceptance status:** checks 1, 2 and 4 pass. **Check 3 fails** (1 test, item 4 above) until the QA test's pin is updated.

## Original handback (first run, corrected where marked)

- **Stage:** P5, gate DG5 (BUILDING). Invocation `DG5-T-DG5-BE-H2-backend-workflow-engineer-20261014T085105Z-8726f77b` (session `8726f77b-cf65-4d50-b0ea-4fc0dbe5f499`).
- **Tree:** worktree `/home/user/wt/dg5-be-h2`, branch `dg5/be-h2`, base `f591b7c` (D-146). The first run left its changes uncommitted; after the container restart the orchestrator committed them as WIP `fabc9de` (D-147). The continuation run's changes (this handback and the `-B` logs) are uncommitted.
- **Time:** the first run started at `2026-10-14T08:51:19Z` and was stopped before it finished. The continuation run's times are in §3.0.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited **0** (`PASS gate DG4 (historical)`) at the start of the first run. The continuation run ran it again at its start and its end, with exit 0 both times (§3.0). The first run's end-of-run validator (§3.8) never ran.
- **Approvals:** no business, Finance or IT approval was granted. Product gates G1–G6 are business approvals inside the product. A rule review is a *configuration* review by a second person. Every person and value in the tests is synthetic. Nothing here reads or writes DG0–DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/automation/conditions.ts` (new) | Pure condition evaluator: AND semantics; decimal.js through `@mth/shared/calc` `FORMULA_DECIMAL`, reused unchanged; `automation.condition_unknown_value`, never 0. |
| `apps/api/src/modules/automation/conditions.test.ts` (new) | Unit tests of the evaluator (4 tests). |
| `apps/api/src/modules/automation/dry-run.ts` (BE-H stub filled) | `listAutomationDryRuns` and `runAutomationDryRun`. Evaluation runs in a READ ONLY transaction that is always rolled back. A second transaction re-checks authorization and inserts only the `automation_dry_run` row and its audit event. |
| `apps/api/src/modules/automation/lifecycle.ts` (BE-H stub filled) | `submit…`, `decideAutomationRuleReview`, `publish…`, `discard…`; `automation_rule_review` work items; the §9 lifecycle refusals. |
| `apps/worker/src/automation/engine.ts` (new) | The engine: candidate rules, execution under lock 730258, the conditions twin, per-action transactions with results, finish/skip/fail, last-attempt `automation.retries_exhausted`, event and tick entry points, `tickSlot`. |
| `apps/worker/src/automation/actions/common.ts` (new) | Worker twin of the API planner: target, scope, identity and recipients. Also the action key. |
| `apps/worker/src/automation/actions/create-task.ts`, `notify.ts`, `escalate.ts` (new) | The three executors. Each one plans with the twin, then writes its effect through `createWorkItemOnce` or `inbox_notification` with a dedupe key. |
| `apps/worker/src/automation/actions/items.ts` (new) | Shared work-item writing and the working-day due date on the organization's default business calendar. |
| `apps/worker/src/queues/automation.ts` (stub filled) | Queues `automation.evaluate`, `automation.tick_hourly`, `automation.tick_daily`. Maps the 16 admin-selectable event triggers to `automation.evaluate`. |
| `apps/worker/src/handlers/automation.ts` (stub filled) | The three handlers. Each passes the pg-boss attempt through. |
| `apps/api/test/integration/automation/automation-lifecycle.test.ts` (new) | 12 integration tests: dry run, submit, review, publish, discard. |
| `apps/api/test/integration/automation/automation-engine.test.ts` (new) | 9 integration tests: the engine, replay ×3, retries, ticks, queue map, and API↔worker parity. |
| `apps/api/test/integration/contract/p5-exercises-be-h2.ts` (new) | Contract exercises of the 6 operations: success plus every reachable declared refusal. |
| `apps/api/test/support/p5-pending-be-h2.ts` | Pending list 6 → 0. |
| `apps/api/test/integration/contract/contract.test.ts` | Additive only: import, mirrors spread, one `it` block, and the media-type pin `[334, 333, 1]` → `[336, 335, 1]`. BE-A created no BE-H2 stub, so I added these lines; they are the same shape as every other seam. |
| `apps/worker/test/integration/outbox.test.ts`, `adoption-below-trajectory.test.ts`, `gates.test.ts` (DG4 tests) | Single-queue pins updated for the ADR-0043 §5 fan-out. See §5.1. |

| `docs/delivery/handbacks/DG5/T-DG5-BE-H2-evidence/*-B.*` (continuation run) | The re-run logs (§3.0); `proposed-qa-a13-jobid-B.patch` (§5.7, not applied) and its verification run. |

**Migrations:** none. I needed no database change (`0074`–`0076` suffice), and no number in `0077`–`0079` is mine.

## 2. Behaviour delivered, per requirement row

**API endpoints added (6), all under `/api/v1/admin/automation-rules/{ruleId}/versions/{versionNo}`:**

| Method and path | Operation | Permission | If-Match |
|---|---|---|---|
| `GET …/dry-runs` | listAutomationDryRuns | `automation.read` | — |
| `POST …/dry-runs` | runAutomationDryRun | `automation.configure` | none (a create of an append-only record; BE-B2 precedent, D-146) |
| `POST …/submit` | submitAutomationRuleVersion | `automation.configure` | the version's |
| `POST …/review` | decideAutomationRuleReview | `automation.review` | the version's |
| `POST …/publish` | publishAutomationRuleVersion | `automation.configure` | **the rule's** (OpenAPI) |
| `POST …/discard` | discardAutomationRuleVersion | `automation.configure` | the version's |

`config.consumes` is `application/json` for the two operations with a body (dry run, review). The three bodiless POSTs declare none (shared rule 3). The contract test's media-type check passes.

### REQ-S12-002 (my part: dry run, review where configured, publish)

Acceptance text: *"A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions"*. The first clause is mine. The failure queue and retry are BE-I's.

**A dry run creates no tasks.** Proved by `automation-lifecycle.test.ts` › "creates no work item, notification, execution or business record…":
- It counts nine tables before and after: `work_item`, `inbox_notification`, `automation_execution`, `automation_action_result`, `transformation`, `approval`, `outbox_event`, `automation_dry_run` and `audit_event`.
- The only increments are **one** `automation_dry_run` and **one** audit event (`automation_dry_run.create`).
- The planned action shows it *would* notify the transformation's TL, by recipient id, yet nothing was written.

The rest of the work-split's literal list:

| Literal case | Result | Test |
|---|---|---|
| Submit without a pass dry run | 422 `automation_rule_version.dry_run_required`, exact text | Also proves that an edit after a pass run makes it stale, and that a `fail` run does not count. |
| The author reviewing | 403 `automation_rule_version.self_review` ("You cannot review a version you authored.") | The author holds both ADM_METHOD and TO, so the refusal is reachable. |
| Publish with review required and none | 422 `automation_rule_version.review_required`, exact text | — |
| TO switches review off, then a draft publishes after its dry run | 200 `published`, `reviewedBy: null`. Without the dry run it is still 422 `dry_run_required`. | **Caveat:** slice A's `updateConfigReviewPolicy` is BE-B3's, running in parallel in W5, and is not routed in this tree. The test flips the same `config_review_policy` row as the owner, with an audit event, and restores it in `finally`. See §5.3. |
| D-145 item (ARCH-03 handback §4 item 3): every publish writes its rule row | Proved on v1 and on v2 | After each publish: `automation_rule.effective_version_id` is the new version, the rule's `version` stepped by 1, and an `automation_rule.effective_version` audit event exists (exactly 1 after v1, 2 after v2). The previous version is `superseded`, with `superseded_at` and its audit event. Exactly one `published` version remains. The deferred `automation_rule_effective_check` therefore runs at every publish COMMIT. |

**Further dry-run behaviour delivered:**
- Conditions cleanly not met → `pass`, `conditionsMet: false`.
- Target outside the rule's scope → `fail`, with finding `automation.action_forbidden` (en text exact, ar provided).
- A numeric condition with a missing, float or non-decimal value → `fail`, `conditionsMet: null`, finding `automation.condition_unknown_value`. It is never 0.
- `initiating_user` identity whose user cannot read the target → `forbidden`.
- A sample that does not match the trigger → 422 `automation.dry_run_sample_invalid` (exact text), with nothing written.
- A non-draft version → 409 `automation_rule_version.not_editable`.

**Review work items:** submit creates one `automation_rule_review` item per active holder of `automation.review` in the rule's organization, and never one for the author. The dedupe key is `automation_rule_review:<versionId>:<userId>` and the message key `automation.task.rule_review`. A decision closes them as `done`; a discard or publish cancels any still open.

**Every mutation, tested:**
- AUD gets 403 on dry run, submit, review, publish and discard (also TO on configure operations, and ADM_METHOD on review).
- `If-Match`: 428 when missing, 409 when stale.
- One audit event per row written:
  - submit → `automation_rule_version.submit`, plus `work_item.create` and `inbox_notification.create` per reviewer;
  - review → `.review_approve` or `.review_request_changes`;
  - publish → `.publish`, `automation_rule.effective_version` and `.supersede`;
  - discard → `.discard`.
- Commit-time re-authorization: with a grant revoked mid-request, dry run and publish return 403 and nothing is written.

### REQ-S12-001 (my part: engine and execution history)

Acceptance text: *"A13: each execution is recorded with rule version, trigger event and outcome"*.

`automation-engine.test.ts` › "an enabled admin rule on gate.decided…":
- One envelope delivered to the `automation.evaluate` handler records **exactly one** `automation_execution`.
- That row has `automation_rule_version_id` (the published version), `trigger_code = gate.decided`, `trigger_key` (the envelope's idempotency key), `status = succeeded`, `conditions_met = true`, `run_as = service`, `attempt_no = 1`, scope, and `finished_at`.
- It has one `automation_action_result` (`done`, key `automation:<rule code>:<trigger key>:1`) and one `automation_task` for the TL.
- Audit: `automation_execution.start` then `.succeed`, as actor `service` with source `worker`.
- Conditions not met (G2) → `skipped`, `conditions_met = false`, with no result and no task.
- **Due dates:**
  - Without a business calendar, the task's due date is **null** (Unknown, never guessed in elapsed days).
  - With a default calendar, it equals the calendar endpoint's own `working-days` answer for `dueInWorkingDays: 3`.
- **Scope:** a disabled rule, another organization's event, and a transformation rule on another transformation never run.
- A target outside scope → execution `failed`, `automation.action_forbidden`, result `forbidden`, no task. It is not retried; it is a recorded result, not a throw. Inserting the failure-queue row is BE-I's (§7).

### REQ-S12-021 (my part: replay ×3)

Acceptance text: *"A13: replaying the same event three times yields one reminder, one action and one approval task"*.

`automation-engine.test.ts` › "sequential and concurrent replays create exactly one of each":
- One event is delivered 3× sequentially, and another 3× concurrently.
- For each: one execution, one `done` result per action, one task and one notification.
- The three layers are: UNIQUE `(rule version, trigger key)` under lock 730258; one `done` per action key; the effect's own dedupe key.

The "approval task" part of A13 is BE-J/BE-K's: approvals come from starters and routes, never from an admin rule.

**Retries (also supports REQ-S12-020, BE-I's).**
- A thrown error leaves the execution `running`.
- A redelivery resumes it without repeating the action already `done`, and completes it once (2 tasks for 2 actions).
- On the **last** attempt (`retryCount >= retryLimit`), the execution is marked `failed` with `automation.retries_exhausted` and the error is rethrown, so the job still reaches `ops.failed`.
- A finished execution is a `duplicate` on any later delivery.
- The queues keep the standard `RETRY_POLICY` (no override).

**Ticks.** One execution per rule and slot, whatever the number of deliveries. Slots:
- hourly: the start of the UTC hour;
- daily: midnight of the business day in the schedule's time zone, for example `automation.tick_daily:2026-10-14T21:00` for 15 October in Riyadh.

**Parity (ADR-0002 rule 5):**
- The worker's condition twin equals the API evaluator on 15 cases.
- The worker planners for `create_task`, `notify` and `escalate` equal the API planners (outcome, target, recipients, key) on **54** combinations: 3 actions × 2 scopes × 3 identities × 3 targets. These cover `would_run`, `forbidden` and `invalid`.

**Queue map:** equals the catalogue's admin-selectable event triggers (16 rows from `0074` and `0075`). Each event keeps its DG4 consumer first, and `automation.evaluate` comes last.

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-H2-evidence/`)

### 3.0 Continuation run (T-DG5-BE-H2B): every acceptance check re-run on the final tree

- **Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline.
- **Database:** a disposable PostgreSQL 16.13 from `tests/qa/support/with-pg.sh`, on ports in 23910–23949 only.
- **Tree:** `fabc9de` plus untracked evidence. There is no source change relative to `fabc9de`.
- **Order:** the runs were sequential, with no other suite running in this tree.
- **Logs:** everything is in `docs/delivery/handbacks/DG5/T-DG5-BE-H2-evidence/`, and each log ends with an `… exit=<n>` line.

| Acc. | Command | Exit | Result | Log (`-B`) |
|---|---|---|---|---|
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (start, 10:29Z) | **0** | `PASS gate DG4 (historical)` | `validate-dg4-start-B.log` |
| 1 | `pnpm -r typecheck` | **0** | all packages `Done` | `typecheck-B.log` |
| 1 | `pnpm -r build` | **0** | all packages `Done` | `build-B.log` |
| 1 | `pnpm lint` | **0** | `eslint . --max-warnings=0`, no output | `lint-B.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (run after this handback was written) | **0** | "All matched files use Prettier code style!" | `prettier-check-B.log` |
| 1 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 789 operations` | `openapi-lint-B.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **0** | unit-node 100 files / **1828** passed; unit-web 71 / **1385** passed; formula-nocodegen 3 / **259** passed + 2 skipped (by design) | `unit-locale-unset-B.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | the same: 1828; 1385; 259 + 2 skipped | `unit-c-utf8-B.log` |
| 3 | `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | **217 files: 216 passed, 1 failed. 2116 tests: 2115 passed, 1 failed.** The one failure is `tests/qa/integration/a13-job-idempotency.test.ts:175`, "A13 outbox relay: publishing twice enqueues one job" (`expected 'd6818590-…' to be '01a13a27-…'`). Cause: the fan-out (see the continuation section, item 4). No timeout, no flaky test. Duration 1420 s. | `integration-B.log` |
| 3 (supporting) | The same harness (`QA_PG_PORT=23920 MTH_PORT_POOL=23921-23949`) running `pnpm exec vitest run --project integration tests/qa/integration/a13-job-idempotency.test.ts`, **with `proposed-qa-a13-jobid-B.patch` applied temporarily** (reverted afterwards) | 0 | 1 file, **5/5** passed | `proposed-qa-a13-jobid-run-B.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **0** | `PASS gate DG4 (historical)` | `validate-dg4-end-B.log` |
| — | `date -u` | — | start `2026-10-14T10:29:21Z`; end `2026-10-14T11:30:24Z`. The prettier, `pnpm lint` and end-validator rows above were re-run after the handback was written. | `timestamps-B.txt` |

**Pinned counts:**
- The integration total of 2116 tests is the first full count for this tree. The first run never finished one.
- The media-type triple `[336, 335, 1]` and the operation count of 789 are unchanged from the first run's §4. `contract.test.ts` passed in `integration-B.log`.

### 3.1–3.9 First run (interrupted), kept as history, corrected

Environment: Node 24.21.0, offline. The disposable PostgreSQL came from `tests/qa/support/with-pg.sh` on ports 23901–23949. Empty `.claude/.cc-writes` directories were removed before the runs. **These rows are superseded by §3.0. They are evidence only where §3.0 re-ran them.**

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 3.1 | `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| 3.2 | `pnpm -r build` | 0 | — | `build.log` |
| 3.3 | `pnpm lint` | 0 (first run's claim; it wrote no log) | `eslint . --max-warnings=0` | none; see `lint-B.log` |
| 3.4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier-check.log` |
| 3.5 | `pnpm openapi:lint` | 0 | PASS, 789 operations | `openapi-lint.log` |
| 3.6a | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 100 files / **1828** passed; unit-web 71 / **1385**; formula-nocodegen 3 / **259** passed + 2 skipped by design | `unit-locale-unset.log` |
| 3.6b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts: 1828; 1385; 259 + 2 skipped | `unit-c-utf8.log` |
| 3.7 | `QA_PG_PORT=23910 MTH_PORT_POOL=23911-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **none (interrupted)** | The log is truncated after 207 files, with no summary. It already shows the `a13-job-idempotency.test.ts` failure that §3.0 reproduces. | `integration.log` |
| 3.8 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | **not run** (interrupted) | — | none written; see `validate-dg4-*-B.log` |
| 3.9 | `date -u` | — | start `2026-10-14T08:51:19Z`; no end, because the run was interrupted. `timestamps.txt` holds `09:35:43Z`, an intermediate stamp. | `timestamps.txt` |

- The unit-node count is 1824 (D-146) + 4 from my `conditions.test.ts`.
- The integration delta is +21 tests in my two new files, +1 contract `it` block, and the DG4 tests changed in place (no count change).
- **Correction (B):** the first run's "Worker integration 84/84" below covered only the worker files. It never completed a full integration run, so it did not see the QA A13 failure.

**Intermediate runs, disclosed.** All of them used my disposable cluster; none is cited as evidence above.
- **Contract test, first run:** 73/73 passed.
- **Lifecycle tests, first run:** 1 of 25 failed. My fixture assumed a business-unit TL grant reaches a transformation. It does not, because TL does not inherit downward. Fixed with a transformation-scoped TL; then 12/12.
- **Engine tests, first run:** 2 of 9 failed.
  1. My static trigger list missed the five admin-selectable triggers that `0075` adds. Fixed by adding them, and the test is the drift guard.
  2. My test expected a due date where the organization has no business calendar. The honest answer is null (Unknown). The test now asserts null, then the calendar's own answer once one exists.
- **Worker integration, first run:** 9 of 84 failed. The DG4 pins of "one queue per event" broke under the ADR-0043 §5 fan-out (§5.1). After the update, 1 failure was left (a replay count of 2 → 3); after that fix, 84/84.

## 4. Operations routed (delta to my pending list)

`apps/api/test/support/p5-pending-be-h2.ts`: **6 → 0**.
- Routed: listAutomationDryRuns, runAutomationDryRun, submitAutomationRuleVersion, decideAutomationRuleReview, publishAutomationRuleVersion and discardAutomationRuleVersion.
- Each is exercised in `p5-exercises-be-h2.ts`, with the success case and the declared refusals it can reach:
  - 400, 401 by the framework, 403 (AUD/nobody), 404, 409 (stale and `not_editable`), 428;
  - 422 `dry_run_sample_invalid`, `dry_run_required`, `review_required`, `invalid_transition`;
  - 403 `self_review`.

**Pinned counts for the orchestrator (rule 14; D-079):**
- **Media-type triple:** `[334, 333, 1]` → `[336, 335, 1]` (+2 JSON bodies: dry run and review). I made this change in `contract.test.ts`; please reconcile it with BE-B3 and BE-E.
- **Rate-limit floor** (`>= 285`): unchanged; the test passes.
- **Operation count:** 789, unchanged.
- **Contract seam:** BE-A pre-created no `p5-exercises-be-h2.ts` stub, so `contract.test.ts` gained its import, mirror spread and `it` line (additive, same shape as BE-H's).

## 5. Contract, schema and dependency items (for the orchestrator)

1. **DG4 behaviour touched (D-142 classification needed).** ADR-0043 §5 maps every admin-selectable event trigger to `automation.evaluate`. Sixteen DG4/P5 event types now fan out to two or three queues (D-102). Consequences:
   - The relay gives their jobs the deterministic `fanOutJobId(event, queue)` instead of `job id = event id`. Exactly-once is unchanged, each DG4 consumer and its `runOnce` key are unchanged, and the DG4 queue stays first in the list.
   - Three DG4 worker tests pinned one queue per event: `outbox.test.ts` (4 tests), `adoption-below-trajectory.test.ts` (4) and `gates.test.ts` (1). I updated them to derive the expected jobs from `QUEUES_FOR_EVENT`/`jobsForEvent`, and their intent (one job per queue, no duplicate on retry or replay, all-or-none) is kept.
   - The single-queue id rule stays pinned by the pure "job ids" test.
   - `schedules.test.ts` still lists the two ticks as unhandled. It passes its own handler list, so it stays green; its comment ("unhandled until BE-H2…") is now stale, and I did not edit it.
2. **`automation_rule.published` outbox event (ADR-0043 §7) is not emitted.**
   - The relay records an event type without a queue as a relay failure, and no consumer exists. The engine reads rules from the database at each evaluation, so no cache needs invalidating.
   - Please either drop it from ADR-0043 §7 or give it a consumer, and add it to `OUTBOX_EVENT_SCHEMAS`, which is outside my files.
3. **The review-policy switch test** uses an owner-side update of `config_review_policy`, because BE-B3's `updateConfigReviewPolicy` is not in this tree. After BE-B3 merges, the test `TO switches review off…` should call that operation as TO. The assertion is unchanged.
4. **Codes and semantics not in the ADR-0043 tables (rule 15), proposed:**
   - (a) `request_changes` without a `note` → 400 `validation.required` at `/note`. The OpenAPI marks `note` optional; a request to change something should say what.
   - (b) **Dry run outcome:**
     - `pass` when no finding;
     - conditions cleanly not met still pass (`conditionsMet: false`);
     - the actions are planned regardless, so the permission checks always run;
     - an unknown value gives `conditionsMet: null` plus the finding, and `fail`.
   - (c) **Finding codes:**
     - `forbidden` → `automation.action_forbidden`;
     - `invalid` (no or unknown target, unparsable settings) → `automation_rule.action_parameters_invalid`;
     - the texts are ADR-0043's English, with my Arabic.
   - (d) **Sample validation:**
     - With an `OUTBOX_EVENT_SCHEMAS` schema for the trigger, the payload must parse.
     - Without one (ticks, `dependency.slipped`, `procedure_step.activated`), only the trigger's `condition_fields`, its initiating-user field and `transformationId` are allowed, as scalars.
     - The limit is 16 KiB.
   - (e) **Audit action names:**
     - `automation_rule_version.{submit,review_approve,review_request_changes,publish,supersede,discard}`;
     - `automation_rule.effective_version`;
     - `automation_dry_run.create`;
     - `automation_execution.{start,succeed,skip,fail}` (the P2 guard requires an audit event per execution row and version);
     - `automation_action_result.create`.
   - (f) **Tick slot:** `<code>:<ISO minute>`, where the minute is the hour start (hourly) or the business-day midnight in the schedule's time zone (daily), so every retry of one tick reuses its key.
   - (g) **Starter drafts in a dry run:** `starter_handler` is planned `would_run` with its handler names, so a starter settings version can pass its dry run and be published.
5. **Key length.** Action keys are `automation:<rule code ≤ 64>:<trigger key>:<ordinal>`, and the effect adds `:<uuid>`. The columns hold 200 characters. With today's envelope keys (`<event>:<uuid>`, about 50 characters) the longest effect key is about 165. An envelope key over about 85 characters would exceed it. No current producer emits one; please confirm, or bound it in the ADR.
6. **No new dependency.** decimal.js is reached through `@mth/shared/calc` (`FORMULA_DECIMAL`, unchanged).
7. **(B) A DG1 QA acceptance test pins the pre-D-102 job id. A decision is needed; it blocks acceptance check 3.**
   - The test is `tests/qa/integration/a13-job-idempotency.test.ts:175`, `expect(jobs[0]!.id).toBe(event!.id)`.
   - After ADR-0043 §5, `transformation.created` has two queues (`transformation.created` and `automation.evaluate`), so the relay uses `fanOutJobId`. `relay.ts` documents that id as "never equal to the event id itself".
   - What the test intends still holds: one job per queue, and no second job after a replayed send.
   - **Proposed fix:** `T-DG5-BE-H2-evidence/proposed-qa-a13-jobid-B.patch`, which adds 2 imports and replaces 1 assertion. It was verified 5/5 (§3.0).
   - The file is the qa-verifier's (DG1 `b69791e`) and outside my §D.2 ownership, so I did not apply it.
   - **Alternative, outside my files too:** change `jobsForEvent` so the first (DG4) queue keeps the event id. That contradicts D-102's documented id rule, so I do not recommend it.
8. **(B) Stale comments, not mine to edit:**
   - `apps/api/src/modules/automation/routes.ts` still says that `dry-run.ts` and `lifecycle.ts` are a "stub until then". The file says that "these lines do not change".
   - `schedules.test.ts` says the ticks are "unhandled until BE-H2" (also §5.1).
   
   Both are comments only, with no behaviour effect.

## 6. User-facing texts

- `apps/web/src/i18n/{en,ar}/admin.json` `plannedSections` ("…automation … settings are planned for later releases") is still **true**. This task ships API and worker behaviour only, with no automation screen. It becomes untrue when FE-D ships the builder, so it belongs to FE-D (as BE-H also recorded). Not changed.
- **New keys need en/ar labels.** The web i18n files are FE-owned; these are for FE-D or the owner of `problems.json` and the My Work messages:
  - **Work item and notification message key:** `automation.task.rule_review`, params `ruleCode`, `ruleName`, `ruleNameAr`, `versionNo`. The kind label `automation_rule_review` already exists.
  - **Problem codes:** `automation_rule_version__invalid_transition`, `__dry_run_required`, `__review_required`, `__self_review`, and `automation__dry_run_sample_invalid`.
  - **Already listed by BE-H:** the four `automation.message.*` keys (params `ruleName`, `triggerLabel`), which the executors now use.
- Dry-run finding messages are returned in English and Arabic by the API, as the contract requires.

## 7. What remains

- **(B) Blocking acceptance check 3, for the orchestrator or the qa-verifier:** apply `proposed-qa-a13-jobid-B.patch` to `tests/qa/integration/a13-job-idempotency.test.ts`, or decide otherwise (§5.7). Then re-run `pnpm test:integration`. Until then the integration suite exits 1 with 2115/2116 passing.
- **Mine:** nothing in my §D.2 file list is left undone.
- **For BE-I:**
  - writing the `operational_failure` row for a `failed` execution (`automation.action_forbidden`, `automation.retries_exhausted`);
  - retry and dismiss;
  - the `job.failed` event;
  - the REQ-S12-020 kill/restart test.
- **For BE-J:** `launch_procedure`. Its executor needs a line in `AUTOMATION_EXECUTORS` in `apps/worker/src/automation/engine.ts`, which is my file, so BE-J adds one line there.
- **For the orchestrator:** the §4 and §5 reconciliations and confirmations.

## 8. Merge instructions

- (B) Merging this branch makes `tests/qa/integration/a13-job-idempotency.test.ts` fail until the §5.7 patch, or an equivalent, is applied. Apply both together.
- No migration to run.
- **Expected conflicts:**
  - `contract.test.ts`: the media-type pin and additive import/mirror/`it` lines. Sum the increments with BE-B3 and BE-E.
  - `apps/worker/test/integration/*.test.ts`: only if another W5 task also edits these DG4 tests.
- After merge, re-run the worker integration files and `automation-*.test.ts`. Under load, `architecture.test.ts` and `raid.test.tsx` have timed out before (F-DG4-148, D-146).
