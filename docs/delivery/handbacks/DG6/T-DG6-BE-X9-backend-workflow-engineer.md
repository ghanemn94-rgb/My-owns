# T-DG6-BE-X9 handback: automation throughput and enablement time (D-203) (backend-workflow-engineer)

- **Stage:** P6, gate DG6 (BUILDING). **Branch:** `dg6/be-x9`, starting `HEAD` `759eeb5d4469b93c2774c63aeed4733020dca04a` (clean tree).
- **Invocation:** run `DG6-T-DG6-BE-X9-backend-workflow-engineer-20261101T014458Z-b317492c`, session `b317492c-e4f2-42e5-8ef5-9ea0adb9b1ce`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X9.md`, sha256 `b96010ad…bd1fe1` (verified).
- **Time:** start `Sun Nov 1 01:45:15 UTC 2026`; end: see §9.
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Approvals:** nothing here grants or records a business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing reads or writes DG0–DG7. All test data is synthetic.

## 0. Contradiction in the assignment (reported, not guessed)

The assignment's binding scope names a section "`docs/architecture/p6-work-split.md` pre-freeze repair: automation throughput and enablement time (D-203)". **That section does not exist**, either in this tree or in `/home/user/My-owns` at the same commit. `grep -n "D-203\|throughput\|X9"` on the file finds nothing.

So I worked from three sources only:
- the assignment text;
- D-203 in `docs/delivery/decisions.md`;
- QA-H's handback §6 and its reproduction script;
- plus the §2 shared rules, which do exist and which I followed.

I touched only files the repair needs (§1). File ownership could not be checked against a section, so the orchestrator should confirm the list in §1 at merge.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `apps/worker/src/worker.ts` | O-1. Every captured queue fetches a bounded batch and runs it with bounded concurrency (`runJobBatch`). **Each job is settled on its own** (`boss.complete` or `boss.fail`). A full batch calls `notifyWorker`, which skips pg-boss's loop delay. The new `jobBatchSize`/`jobConcurrency` options are defaulted by `JOB_THROUGHPUT_DEFAULTS` (8 and 4). The purge and `job_schedule.updated` queues stay one job per fetch. |
| `apps/worker/src/main.ts` | Passes `config.worker.jobBatchSize`/`jobConcurrency` to `startWorker` and logs them at start-up. Pool `max = max(5, concurrency + 2)`, which is 6 by default (was 5). |
| `packages/config/src/index.ts` | New variables `WORKER_JOB_BATCH_SIZE` (default 8, 1–50) and `WORKER_JOB_CONCURRENCY` (default 4, 1–16), with constants `JOB_BATCH_SIZE` and `JOB_CONCURRENCY`. |
| `packages/config/src/load.ts` | Validates both variables. A concurrency above the batch size is refused, naming the variable. Adds `worker.jobBatchSize` and `worker.jobConcurrency`. |
| `packages/config/src/load.test.ts` | 10 new tests (defaults, range, refusals, concurrency above batch size). The two pinned `worker` objects now include the new fields. |
| `.env.example` | Regenerated with `node deploy/scripts/generate-env-example.mjs`. `--check` is OK: 33 names, no values. |
| `packages/db/migrations/0122_p6_automation_rule_enablement.sql` | O-2. **New migration, id 0122** (the next above 0121 on this branch, D-196). Adds the append-only ledger `automation_rule_enablement`, written only by the `SECURITY DEFINER` trigger `automation_rule_enablement_record` on `automation_rule`, and backfills one row per currently enabled rule from stored times. |
| `packages/db/src/schema.ts` | `AutomationRuleEnablementTable`, its row type and its `SCHEMA_COLUMNS` entry. |
| `apps/worker/src/automation/engine.ts` | O-2. `candidates(…, outboxEventId?)` keeps a rule only when the newest enablement row of its current effective version is `<=` the event's `outbox_event.created_at`, compared in SQL at microsecond precision. `evaluateEvent` passes the envelope's `outboxEventId`. The new `occurredAtOf` throws `automation.occurrence_time_unknown` when the outbox row is missing. |
| `apps/worker/src/worker-batch.test.ts` | New unit tests for `runJobBatch`: per-job settlement, the concurrency bound, settlement errors rethrown, the defaults. |
| `apps/worker/test/integration/batch-settlement.test.ts` | New integration tests on real pg-boss: a failing job of a full batch retries alone; the always-failing job reaches `failed` alone; the concurrency bound holds; full batches skip a 30 s polling interval. |
| `apps/api/test/integration/automation/automation-backlog-enablement.test.ts` | New. The QA-H O-2 reproduction, disable/re-enable, the unknown occurrence time, and the O-1 backlog measurement with exactly-once under concurrent replays, all on the real API, relay and worker. |
| `apps/api/test/integration/automation/automation-engine.test.ts` | Its `envelope()` helper now writes the envelope's outbox row (already published), as the relay's source would. 8 call sites now `await`. |
| `apps/api/test/integration/automation/automation-notify-delivery.test.ts` | Same helper change (1 call site). |
| `apps/api/test/support/automation-failures.ts` | Adds `storedGateDecidedEnvelope(db, org, payload)`, the envelope with its outbox row. |
| `apps/api/test/integration/automation/automation-failures.test.ts` | Uses the stored envelope where an envelope is evaluated (2 sites). |
| `apps/api/test/integration/contract/p5-exercises-be-i.ts` | Uses the stored envelope for its one evaluation (`contract.test.ts` and `response-validation.test.ts` run it). |
| `packages/db/test/integration/catalogue.test.ts` | Adds `automation_rule_enablement: "SELECT"` to the `mth_app` privileges and a 0122 trigger test (the definer function, not executable by PUBLIC). Excludes the new trigger from the 0074 pin, as the 0097 triggers are excluded. |
| `apps/api/test/integration/hardening/integrity-sweep.test.ts` | Adds the table to `P6_TABLES`. Both of its `*_id` columns are foreign keys. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X9-*` | This handback and its evidence. |

## 2. Behaviour delivered

D-203 assigns no new requirement row. It repairs observations against **REQ-S12-020 and REQ-S20-029 (O-1)** and **REQ-S12-001/REQ-S12-002 (O-2)**. I changed no row's acceptance text.

### O-1: throughput

- **Batch and concurrency.** pg-boss fetches up to `WORKER_JOB_BATCH_SIZE` jobs per poll of a queue, and `runJobBatch` runs at most `WORKER_JOB_CONCURRENCY` of them at a time.
- **Per-job settlement.** Each job is settled with `boss.complete(queue, id, output)` or `boss.fail(queue, id, error)`. The error is the same object pg-boss serialises (`serialize-error`). pg-boss's own settlement after the batch then finds no active job and changes nothing: its `complete` updates only `state = 'active'` (pg-boss 11 `plans.completeJobs`).
- **Retry, backoff and dead-letter are unchanged per job.** This is proved by `batch-settlement.test.ts`:
  - the job that fails once is retried alone (`retry_count` 1, then completed);
  - the always-failing job reaches `failed` alone, with its own error as its output;
  - the six neighbours complete once, on attempt 0, with their own outputs.
  `captured` (the failure queue on the last attempt, and the `job_run` row) still wraps every job.
- **No loop delay while a backlog remains.** A full batch calls `boss.notifyWorker(workerId)`, so pg-boss's loop delay (`worker.js:77`) is skipped. Partial or empty batches wait the polling interval as before, so idle queues cost what they did.
- **Exactly-once is unchanged** (ADR-0043): the UNIQUE `automation_execution_once_key`, the action idempotency keys, lock 730258, and each effect's dedupe key. Exactly-once never relied on serial execution, because several worker processes already run one queue concurrently.
  - Proved under real concurrency: 240 events plus 60 replays (new job ids, same idempotency keys) give 240 executions, 240 distinct trigger keys, all `succeeded`, and 240 tasks with 240 distinct subjects.
  - The job outputs show one `succeeded` and three `duplicate` per replayed event.
- **Service identities are unchanged:** every handler still runs with its per-queue service principal. The worker loop does not touch identities.
- **Configuration** goes through the existing loader, with safe defaults of 8 per fetch and 4 at once. The pool grows to `concurrency + 2` (minimum 5), so one busy queue never takes every connection.

**Measurement (jobs/s on one queue, `automation.evaluate`, a backlog of 300 jobs = 240 relayed events plus 60 replays, real API/relay/worker, the same test file):**

| | Code | Result | Evidence |
| --- | --- | --- | --- |
| **Before** | `HEAD` `worker.ts` and `engine.ts` (`git show HEAD:…`, swapped in temporarily, then restored; sha256 checked) | **1.5 jobs/s**: 225 of 300 completed in 150.1 s, then the deadline (`MTH_X9_BACKLOG_DEADLINE_MS=150000`) | `T-DG6-BE-X9-evidence/throughput-before-head.log` |
| **After** | this change, defaults (8/4) | **120.1 jobs/s**: 300 of 300 in 2.5 s | `T-DG6-BE-X9-evidence/throughput-after.log` |

Earlier iterations of the same test after the change measured 153.7 and 155.3 jobs/s. Those runs are not kept as evidence because of the test-count bug described below. The host was also running other work, so treat the figures as indicative, not a benchmark.

### O-2: enablement time (D-203)

- **The rule.** A rule is a candidate for an event only when its **current effective version became enabled at or before the event's stored occurrence time**.
  - The stored occurrence time is `outbox_event.created_at`, the time of the transaction that recorded the event.
  - The enablement time is the newest `automation_rule_enablement` row for (rule, effective version).
  - The evaluation time is never used. Both times are compared in SQL, so microseconds are not lost to a JS `Date`.
- **What the trigger records.** It writes a row:
  - when a rule is inserted enabled, or goes from `enabled` false to true (`source 'enable'`);
  - when the effective version of an enabled rule changes (`'effective_version'`, i.e. a publish while enabled).
  Disabling writes nothing. Re-enabling writes a new row, so an event from a disabled window is never acted on.
- **The ledger is append-only** (`p2_attach_append_only`). `mth_app` has SELECT only, and the trigger function is `SECURITY DEFINER` with PUBLIC execute revoked. It is written in the same transaction as the already-audited rule update that causes it (the 0098 `record_sensitivity_change` pattern), so `automation_rule` gets no version step and no extra audit event.
- **Backfill** of rules already enabled: the latest of three stored times (the effective version's `published_at`, the rule's newest `automation_rule.enable` audit event, the rule's `created_at`). It never uses the migration clock.
- **Unknown occurrence time.** If an envelope has no outbox row (never for relayed jobs: the relay builds every envelope from its row, and no code deletes outbox rows), the job throws `automation.occurrence_time_unknown: …` and nothing is executed. pg-boss retries it, and the last attempt enters the failure queue. Unknown is never treated as "now".
- **The required integration test** is QA-H's reproduction (`automation-backlog-enablement.test.ts`, first test):
  1. 12 `transformation.created` events are created through the API with no worker running;
  2. an organization-scoped `transformation.created` rule is created, dry-run, reviewed, published and enabled through the API;
  3. the worker starts and relays and evaluates all 12 (`completed` = 12): **0 executions**;
  4. a new transformation is created: **exactly 1 execution**, with that event's trigger key.
  At `HEAD` the same test fails with 12 executions for the older events (`throughput-before-head.log`), which confirms the reproduction.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0, offline. PostgreSQL is disposable through `tests/qa/support/with-pg.sh` on ports 27650–27699. Empty `.claude/.cc-writes` directories were removed before the tests (one was found under `apps/worker/src/`).

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` | (start of run) |
| `pnpm -r typecheck` | 0 | all packages | `evidence/typecheck.log` |
| `pnpm -r build` | 0 | all packages | `evidence/build.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `evidence/lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | §9 |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `evidence/openapi-lint.log` |
| `pnpm test`, locale unset | 0 | unit-node 187 files / **2817** passed; unit-web 120 / **2018** passed; unit-formula-nocodegen 3 / **259** passed, 2 skipped | `evidence/unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts | `evidence/unit-c-utf8.log` |
| `node deploy/scripts/generate-env-example.mjs --check` | 0 | 33 names, none with a value | — |
| integration, the new file (after) | 0 | 4/4 | `evidence/throughput-after.log` |
| integration, the new file at `HEAD` code (before) | 1 (expected) | 3 failed, 1 passed (see below) | `evidence/throughput-before-head.log` |
| integration, `batch-settlement.test.ts` | 0 | 2/2 | (run in §2; repeated in the full run) |
| full `pnpm test:integration` (locale unset) | see §9 | see §9 | `evidence/integration-full.log` |
| rerun of the repaired files | see §9 | see §9 | `evidence/integration-rerun-fixed.log` |

Disclosures:
- **The "before" run is expected to fail.** It is the `HEAD` code under the new tests: both O-2 tests fail (12 executions for older events; the disabled-window event is acted on), and O-1 times out at 150 s. Its third O-2 test (unknown occurrence time) **passed vacuously at `HEAD`**: `OCCURRENCE_UNKNOWN` does not exist there, so `toThrow(undefined)` accepted HEAD's unrelated error.
- **Earlier failed iterations of the new test**, on my own test code, fixed before the evidence runs:
  - the backlog count included the replays, which share outbox ids, so the count never equalled 240;
  - no TL held the synthetic transformation, so `create_task` correctly had nobody to assign.
- **First API typecheck.** It printed 4 TS4111 errors (index-signature access) in the new test, while the shell showed exit 0 because of a `| head` pipe. I fixed them, and the rerun of `tsc` exits 0 without a pipe.
- **The first full integration run (§9) had failures** in `contract.test.ts` (2), `response-validation.test.ts` (2) and `automation-failures.test.ts` (6). Their cause was `automation.occurrence_time_unknown`: test envelopes with no outbox row (`p5-exercises-be-i.ts`, `automation-failures.test.ts`). That is the new rule working as intended. I fixed the test helpers (§1), and `integration-rerun-fixed.log` reruns those files.

## 4. Operations routed (pending list delta)

**None.** No HTTP operation was added or changed, so `openapi.yaml` and the zod mirrors are unchanged. There is no `p6-pending-*`/`p6-exercises-*` delta, and the contract pins are unchanged (operation count 932).

## 5. For the orchestrator: contract, schema, dependency

- **Migration `0122_p6_automation_rule_enablement.sql`** (forward-only). Renumber it at merge if a higher id has shipped. It replaces no function and changes no existing table's rows.
- **No new dependency.** pg-boss 11.0.0's existing `complete`, `fail` and `notifyWorker` are used.
- **New configuration:** `WORKER_JOB_BATCH_SIZE`, `WORKER_JOB_CONCURRENCY`. `.env.example` is regenerated.
- **New error code (internal, not an HTTP problem):** `automation.occurrence_time_unknown`, the job error of an envelope without an outbox row.
- **Pinned counts:** no `contract.test.ts` pin changed. `catalogue.test.ts` gains one test (0122) and one privilege row; `integrity-sweep.test.ts` lists one more P6 table.

## 6. What ADR-0043 must record (for the architect)

1. **The enablement-time rule (D-203).** An automation rule applies only to events whose **stored occurrence time** (`outbox_event.created_at`) is at or after the moment its **current effective version became enabled**. That moment is the newest `automation_rule_enablement` row for (rule, effective version), written by the 0122 trigger on enable and on every effective-version change of an enabled rule. Evaluation time is never used. A late event (backlog, outage, retry) is therefore never acted on by a rule enabled after it occurred, and an event from a disabled window is never acted on after re-enabling.
2. **An open point to decide: a version switch.** D-203 says both "the moment its effective version became enabled" and "evaluated against the rules that were enabled when it occurred". These differ when a new version is published while the rule is enabled. I implemented the first (the literal acceptance wording): an event that occurred under version N but is evaluated after version N+1 is published is acted on by **neither** version. The engine joins only the current effective version, and N+1's enablement is later than the event. Evaluating it against version N would need the effective-version interval history, and the ledger has the data for it. The architect should state which behaviour is wanted.
3. **Unknown occurrence time.** An envelope with no outbox row throws `automation.occurrence_time_unknown` (retried, then the failure queue), and is never evaluated as "now".
4. **Ticks are out of scope.** A tick's occurrence is its slot (`tickSlot`), so the enablement cutoff does not apply to ticks. A tick evaluated late in the same slot still reaches a rule enabled during that slot. This is unchanged and not covered by D-203.
5. **Worker concurrency (O-1).** Each queue processes up to `WORKER_JOB_BATCH_SIZE` jobs per fetch, at most `WORKER_JOB_CONCURRENCY` at once, and each job is settled on its own, so retry, backoff and dead-letter stay per job. Exactly-once rests on the three ADR-0043 layers (UNIQUE, action keys, lock 730258), never on serial execution. The two maintenance queues (`platform.purge`, `job_schedule.updated`) stay one job per fetch.
6. **Edge cases (documented, not tested).**
   - If a batch exceeds pg-boss's expiry (`resolveWithinSeconds`, 15 min by default), or a settlement call itself fails (the database is unreachable), pg-boss fails every job of the batch whose state is below `completed`. That set includes a job this batch already moved to `retry`, whose retry count then rises by one more.
   - The defaults keep a batch far below the expiry. The settlement error is rethrown deliberately, so that a job is never silently completed.
7. **Data dictionary and monitoring.**
   - `docs/architecture/data-dictionary.md` needs an entry for `automation_rule_enablement`. That document belongs to the architect and I did not edit it.
   - `docs/operations/monitoring.md` (devops-owned) could list the two new worker variables next to `WORKER_HEARTBEAT_SECONDS`.

## 7. User-facing texts

**No en/ar string is made untrue.** I searched `apps/web/src/i18n/en/*.json` for texts about enabling rules, earlier or queued events, and throughput; none states how enabling treats earlier events. An optional suggestion for the frontend owner: the enable dialog could say, in both languages, that a rule applies to events from the moment it is enabled. That is new text, not a correction.

## 8. Requirement → test

| Item | Test |
| --- | --- |
| O-2: 12 older events give 0 executions, a new event gives 1 | `apps/api/test/integration/automation/automation-backlog-enablement.test.ts` › "12 events written with no worker…" |
| O-2: disable then re-enable | same file › "disable then re-enable…" |
| O-2: unknown occurrence time | same file › "an envelope without its outbox row…" |
| O-1: backlog throughput and exactly-once under concurrent replays | same file › "240 automation.evaluate jobs plus 60 concurrent replays…" |
| O-1: per-job retry, failure and concurrency on real pg-boss | `apps/worker/test/integration/batch-settlement.test.ts` |
| O-1: `runJobBatch` unit behaviour | `apps/worker/src/worker-batch.test.ts` |
| O-1: configuration | `packages/config/src/load.test.ts` › "WORKER_JOB_BATCH_SIZE and WORKER_JOB_CONCURRENCY…" |
| 0122 catalogue | `packages/db/test/integration/catalogue.test.ts` › "0122: …"; `integrity-sweep.test.ts` |

## 9. Final results and what remains

**Full integration run.** Command: `QA_PG_PORT=27660 MTH_PORT_POOL=27661-27699 tests/qa/support/with-pg.sh pnpm test:integration`, locale unset (`evidence/integration-full.log`).
- **exit 1.** Test Files: 3 failed, 406 passed (409). Tests: 10 failed, 4128 passed, 1 skipped, 2 todo (4141). Duration 3421 s.
- **The 10 failures are all in three files I repaired while this run was going** (it had already loaded them): `contract.test.ts` (2), `response-validation.test.ts` (2), `automation-failures.test.ts` (6). Each fails with `automation.occurrence_time_unknown` (stack: `evaluateEvent` engine.ts:574 ← `p5-exercises-be-i.ts:55`), i.e. a test envelope with no outbox row.
- **Everything else passed in this run**, including:
  - all 45 `tests/qa/integration` files (0 failed);
  - `catalogue.test.ts` (36);
  - `integrity-sweep.test.ts` (23);
  - `automation-engine.test.ts` (9);
  - `automation-notify-delivery.test.ts` (2);
  - `automation-backlog-enablement.test.ts` (4);
  - `batch-settlement.test.ts` (2);
  - every worker integration file.

**Rerun of the repaired files after the fix.** Command: `QA_PG_PORT=27670 MTH_PORT_POOL=27671-27699 tests/qa/support/with-pg.sh npx vitest run --project integration` on `automation-failures`, `contract`, `response-validation`, `automation-engine` and `automation-notify-delivery` (`evidence/integration-rerun-fixed.log`).
- **exit 0.** Test Files: 5 passed (5). Tests: **238 passed (238)**.

**Pinned counts:** no change. `contract.test.ts` stays at 932 operations, with the same media types, rate-limit floor and CSRF-exempt routes.

**End checks** (03:25–03:31 UTC, after the last source edit; all exit 0):

| Check | Result | Log |
| --- | --- | --- |
| `pnpm -r typecheck` | exit 0 | `evidence/typecheck-final.log` |
| `pnpm lint` | exit 0 | `evidence/lint-final.log` |
| prettier `--check` over `git ls-files -co --exclude-standard` | exit 0, "All matched files use Prettier code style!" | `evidence/prettier-final.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` | exit 0, `PASS gate DG5 (historical)` | `evidence/validate-dg5-end.log` |

`pnpm -r build` (exit 0) ran after the last change to any non-test source file. Only test files changed after it.

**What remains:**
1. **No full integration rerun yet.** A complete `pnpm test:integration` on the final tree has not been run in one pass: the full run plus the rerun of its 3 failing files is the evidence. The orchestrator's merged-tree verification (D-203 "then a full verification on the merged tree") covers this.
2. **Integration was not run under `C.UTF-8`.** Only the locale-unset integration run was done (`pnpm test` ran in both locales). The integration cluster is always UTF8/C (`with-pg.sh`).
3. **For the architect:** ADR-0043 items 1–7 in §6. One of them is an open behaviour decision (§6 item 2, a version switch). The data-dictionary entry for `automation_rule_enablement` is also the architect's.
4. **Not repaired here (part of neither O-1 nor O-2):** the batch-expiry and settlement-failure edge described in §6 item 6.
5. **Missing section:** the `p6-work-split.md` section the assignment names does not exist (§0).

**End time:** `Sun Nov 1 03:31:18 UTC 2026` (about 106 minutes).
