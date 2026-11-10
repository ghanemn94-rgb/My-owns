# Handback T-DG6-BE-K2S (backend-workflow-engineer): the merge seam of BE-K2 with BE-L2

- **Stage:** DG6 (P6). **Sections:** `p6-work-split.md` §J/C.4 and §B/A.2 (seam only).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-K2S-backend-workflow-engineer-20261030T042033Z-915c3b6a","session_id":"915c3b6a-6c39-4e49-b720-3ebc5d151140"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-K2S.md` (sha256 `8da9cf2a…e91479d`, verified).
- **Base:** branch `dg6/be-k2s` at `ff1e975a346cf41dcfd5a86ec7514c06c3ba1fae`. The tree was clean at start. The changes are left **uncommitted**.
- **Time:** started `2026-10-30T04:20:57Z`. The end time is in §8.
- **Approvals:** nothing here grants a business, Finance or IT approval. G1–G6 are untouched, and nothing implies DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/worker/src/queues/index.ts` | `INTEGRATIONS_EVENT_QUEUES` moves ahead of `AUTOMATION_EVENT_QUEUES` in `EVENT_QUEUE_MAPS`. `connector.run_failed` now fans out (D-102) as `["integrations.connector_exception", "automation.evaluate"]`: the domain consumer first, the engine last, matching `kpi.deviation_evaluated` and `data.stale`. No other event changes (the integrations map has only `connector.run_failed` and `connector.run_recovered`). |
| `apps/worker/src/automation/starters.ts` | Adds `STARTER_RULE_BY_QUEUE["integrations.connector_exception"] = "starter.job_failed"`. BE-L2's consumer is registered through `withStarterRule`, so each final connector failure is recorded as **one execution of starter 16 version 2** (0117 names `connector.run_failed`). `connector.run_recovered` is not a trigger of the starter, so it runs unrecorded (the wrapper's existing rule). The handler is called unchanged. |
| `apps/worker/test/integration/connector-failure-exception.test.ts` (new) | The required proof that one final failure yields exactly one open exception, end to end. Details in §2. |
| `apps/worker/test/integration/adoption-below-trajectory.test.ts` | Registry test (D-102): pins `connector.run_failed` → `[integrations.connector_exception, automation.evaluate]` and `connector.run_recovered` → `[integrations.connector_exception]`. |
| `apps/worker/test/integration/operations-freshness.test.ts` | `STARTER_16_V2` id `01920006-0116-…` → `01920006-0117-…` (the renumbered migration), and the describe title 0116 → 0117. The catalogue test also asserts the two-queue fan-out of `connector.run_failed`. |
| `apps/worker/test/integration/schedules.test.ts` | Adds `P6_OPERATIONS_JOBS = ["kpi.freshness_scan", "operations.exception_alerts"]` (BE-K2, 0117) next to BE-L2's `P6_CONNECTOR_JOBS` in both unhandled-row expectations. |
| `apps/worker/src/handlers/operations.test.ts` | Unit test: asserts the two-queue fan-out of `connector.run_failed` (title updated). |
| `apps/worker/src/queues/automation.ts`, `apps/worker/src/queues/operations.ts` | Comment-only: stale migration number 0116 → 0117. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-K2S-*` | This handback and its evidence. |

No migration, no API route, no OpenAPI or zod change, no new dependency, no en/ar string.

## 2. Behaviour delivered

### The six failing worker integration tests (assignment items 1–3)

1. **Registry (D-102).** `connector.run_failed` already went to both queues after the W9 merge, but in the wrong order: engine first, then `integrations.connector_exception`. The D-102 rule "domain consumer(s) first, engine last" therefore failed. Moving the integrations map ahead of the engine map fixes the order, and both consumers stay.
2. **`operations-freshness.test.ts`.** Two tests failed only because they still used the pre-renumbering id `01920006-0116-7000-8000-000000000001` for starter 16 v2. Migration 0117 seeds `01920006-0117-…`. BE-L2's catalogue rows are unaffected: 0117 alone inserts the `connector.run_failed` trigger, with condition fields `{connectorId, failureClass}`, a subset of BE-L2's v1 payload.
3. **`schedules.test.ts`.** Two tests failed because the lists of unhandled job rows lacked BE-K2's `kpi.freshness_scan` and `operations.exception_alerts`. These are now listed next to BE-L2's `integrations.connector_run`.

Result: those three files fail 5 tests before the fix and pass 23/23 after it (§3, rows 1–2). The assignment says 6; at `ff1e975a3` the pre-fix run shows 5 (`01-pre-fix-three-files.log`), all of them listed above.

### "One connector's final failure yields exactly one open operational exception"

**Result: one exception. The code did not open two.** The engine's `automation.evaluate` evaluates admin rules only (`apps/worker/src/automation/engine.ts:177`, `r.origin = 'admin'`) and never runs a starter. No admin action type opens an exception (the action registry has create-task, escalate, items and notify). That leaves BE-L2's consumer as the only opener.

The seam did have a related defect. Starter 16 v2 (0117) names `connector.run_failed`, and ADR-0053 §3 says its action "opens or recurs the exception", but nothing recorded an execution of starter 16 for a connector failure. `data.stale` was recorded (BE-K2 wraps `operations.exception_raise`). The `starters.ts` mapping now records it, with the exception still opened by one code path (BE-L2's consumer, under lock 730305).

The new test `connector-failure-exception.test.ts` uses a real PostgreSQL, pg-boss, the production relay and the production `DOMAIN_HANDLERS` registrations:

- **Relay fan-out.** A `connector.run_failed` outbox event becomes exactly 2 jobs, `integrations.connector_exception` and `automation.evaluate`, with the D-102 deterministic ids. A relay retry and a replayed send add no job.
- **One exception.** After both jobs complete:
  - exactly **1** active exception exists, and 1 in total, for (organization, `connector`, code, `connector_unreachable`), with `occurrence_count` 1;
  - its audit trail is exactly `["operational_exception.opened"]`;
  - exactly **1** `automation_execution`, starter 16 / version `01920006-0117-…`, trigger `connector.run_failed`, `succeeded`, and no execution from the engine;
  - one `processed_message` row (consumer `integrations.connector_exception`).
- **Redelivery.** Calling both handlers again with the same envelope creates nothing: the same exception row, still 1 execution.
- **A second final failure** of the same connector (another run) recurs the same exception (`occurrence_count` 2; audit `opened` + `recurred`). It never opens a second one, and each failure is its own starter-16 v2 execution.

### Requirement rows

- **REQ-S12-019.** Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*.
  - This seam proves the "one exception" half for the connector path through both consumers (above).
  - The "KPI shows Stale with its last value and date" half is BE-K2's freshness test in `operations-freshness.test.ts`. It is unchanged and passes after the repair.
  - The literal A17/A22 fixture (a failing test connector feeding a KPI, end to end through the API) is QA-A/QA-E's (`p6-work-split` J/C.16). This task does not complete it, and the row stays with its owners.
- **REQ-S17-005.** Not changed by this seam. BE-L2's run tests are untouched, and the API integration run covers them (§3).

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL is disposable via `tests/qa/support/with-pg.sh` on harness ports 25450–25499. The host was shared with other implementers, with load average 15–20 during the runs. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-K2S-evidence/`.

| # | Command | Exit | Result |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | `PASS gate DG5 (historical)` (`00-validate-dg5-historical.log`). **Disclosure:** I started it in the background at 04:21Z, before implementation, but that shell ended and its output was lost. The recorded run was in the foreground after the code change (it validates gate records, not my files). |
| 1 | `QA_PG_PORT=25450 MTH_PORT_POOL=25451-25499 tests/qa/support/with-pg.sh npx vitest run --project integration` on the 3 seam files, **before** the fix | 1 | 5 failed, 18 passed (23): the defect reproduced (`01-pre-fix-three-files.log`) |
| 2 | Same command on those 3 files plus `connector-failure-exception.test.ts` and `starters.test.ts`, **after** the fix | 0 | 5 files, **50 passed (50)** (`02-post-fix-five-files.log`) |
| 3 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 4 | `pnpm -r build` | 0 | `build.log` |
| 5 | `pnpm lint` | 0 | `lint.log` (rerun after formatting; also 0 before) |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. **Disclosure:** the first run exited **123** (3 of my files needed formatting). I ran `prettier --write` on those 3 files only, and the recheck exited 0. |
| 7 | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| 8 | `pnpm test` with the locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **1** | Results in the table below; log `unit-locale-unset.log` |
| 9 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | Results in the table below; log `unit-c-utf8.log` |
| 10 | `QA_PG_PORT=25450 MTH_PORT_POOL=25451-25459 tests/qa/support/with-pg.sh npx vitest run --project integration apps/worker/test/integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/contract/response-validation.test.ts` (the **full worker integration project plus the two contract files**) | **1** | 27 files: **26 passed, 1 failed**; 346 tests: **345 passed, 1 failed** (`worker-integration-and-contract.log`). Every worker file passed (25 files, including `connector-failure-exception.test.ts` 2/2, `schedules` 2/2, `operations-freshness` 7/7, `adoption-below-trajectory` 14/14, `starters` 25/25). `contract.test.ts` passed 101/101. The one failure is in `response-validation.test.ts`, 108/109 passed; details below the table. |
| 11 | `QA_PG_PORT=25460 MTH_PORT_POOL=25461-25499 tests/qa/support/with-pg.sh pnpm test:integration` (the whole integration project, 361 files, serial single fork) | **not finished** | Details in §8; partial log `integration-full-PARTIAL.log` |

`pnpm test` results by Vitest invocation:

| Locale | unit-node | unit-web | unit-formula-nocodegen |
|---|---|---|---|
| unset | 176 files, **2722 passed**, 0 failed, **1 unhandled error** | 98 files, 1787 passed | 3 files, 259 passed, 2 skipped |
| C.UTF-8 | 176 files, **2722 passed**, 0 failed, **2 unhandled errors** | 98 files, 1787 passed | 3 files, 259 passed, 2 skipped |

**The `response-validation.test.ts` failure (row 10):** the test is "every operation: an undeclared request media type is a declared 400 validation.content_type; nothing written" (`contract.test.ts:1102`, shared by both files), and it failed with `Test timed out in 30000ms`.
- This is the load-class contract timeout the assignment itself mentions ("plus 2 contract timeouts that are load").
- It exercises API routes only, and this task changed no API file (`git diff --stat HEAD -- apps/api` is empty).
- It ran at load average about 17–20, concurrently with my full run (row 11).
- Not repaired: it is outside this seam's files. It needs a quiet-host rerun or a budget review by the contract-test owner (§7).

**The `pnpm test` exit 1 (rows 8–9):**
- Every test passed in every invocation and both locales.
- The exit is 1 because unit-node reported Vitest-internal `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`: once with the locale unset, twice with C.UTF-8. That is the worker→main RPC timing out while the host load average was about 17–20. No test or file of mine is named in the stack (it is entirely inside `node_modules/vitest`).
- Acceptance item 2 is therefore **not met as literally stated** (exit 0) in these runs. I am reporting it as a load-induced tool error, not as a pass.
- A rerun on a quieter host is the orchestrator's call (§7).

## 4. Operations routed (pending-list delta)

None. This seam adds no API operation, so no `p6-pending-*.ts` or `p6-exercises-*.ts` change is needed. Contract pinned counts: **no delta**.

## 5. Contract, schema or dependency needs

- **Contracts.** None. The `connector.run_failed` v1 payload stays BE-L2's (`packages/shared/src/schemas/events.ts`). The 0117 trigger condition fields `{connectorId, failureClass}` are a subset of it.
- **Migration 0117 note (not edited: merged migrations are never edited).** Starter 16 v2's `actions` JSON lists `handlers: ["jobs.failure_capture", "operations.exception_raise"]`. For `connector.run_failed` the queue that runs the action is `integrations.connector_exception`; the JSON is descriptive, and the content hash is fixed. If the orchestrator wants the descriptor exact, that needs a starter 16 **version 3** in a new migration (the next free id at merge, D-196). I did not create one.
- **Dependencies.** None.

## 6. User-facing texts

None changed and none made untrue. The work is in the worker only, with no en/ar string.

## 7. What remains

- **The `pnpm test` exit code (acceptance item 2).** All tests pass, but unit-node exits 1 on Vitest RPC timeouts under host load (§3). It needs a rerun on a less loaded host, which I did not do within the time limit.
- **The full `pnpm test:integration` run (acceptance item 3)** is unfinished (§8). The worker integration project passed in full. `contract.test.ts` passed. `response-validation.test.ts` had one load timeout (§3, row 10), and the partial full run had one load timeout in `forms/form-records.test.ts` (§8). The orchestrator's verify run on a quieter host should rerun the whole project.
- **The literal A17/A22 end-to-end acceptance of REQ-S12-019.** It belongs to QA-A/QA-E (not this seam).

## 8. Full integration run and end time

- **Started:** 05:35:56Z, serial single fork, 361 files, with load average about 16–20. By 06:15Z it had finished **85 files**: 84 passed, 1 with a failure.
- **The failure:** `apps/api/test/integration/forms/form-records.test.ts` › "export (REQ-S05-001) › at most 5000 rows: 5000 export, 5001 is 422 form_export.too_large" timed out at its 60 s test budget (60010 ms) under load. It is an API forms test that this seam does not touch.
- **Why it is unfinished:** at that rate the whole project needs about 2.5–3 h, more than the assignment's time limit and the 2 h background limit of my run. **Acceptance item 3 (the full `pnpm test:integration` passing) is therefore NOT met by this run: it is unfinished, not passed.**
- **It may still be running:** TaskStop is not available to me and `pkill -f` is forbidden, so the run continues until its own background limit (about 07:36Z) and is then stopped. Its log after 06:15Z is not part of this evidence. Its final counts are unknown; please treat it as not run.
- **Pinned-count change:** none. No integration test count is pinned by this task. The worker integration project has one new file with 2 tests.
- **End time:** `date -u` gave `Fri Oct 30 06:16:06 UTC 2026` (about 115 minutes after the start).
