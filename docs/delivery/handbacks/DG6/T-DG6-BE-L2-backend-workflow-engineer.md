# Handback T-DG6-BE-L2: integration runs, retries, the test adapter, the worker jobs (backend-workflow-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §B/A.2.
- **Invocation:** `DG6-T-DG6-BE-L2-backend-workflow-engineer-20261029T195705Z-edda6ac1` (session `edda6ac1-1472-468b-a7cd-d703de8280cc`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-L2.md`, sha256 `b24dbe26c46980c0a777367080c9c80e212abad6fc71eadff895b0c064906586` (verified).
- **Base:** branch `dg6/be-l2` at `b5b33a331` (worktree `/home/user/wt/dg6-be-l2`). Changes are **uncommitted**, for the orchestrator.
- **Time:** started 2026-10-29T19:57:34Z; end time in §8.
- **Two gate systems:** nothing here reads or writes DG0–DG7. `connector.run` is a write code, never a business-approval or Finance-validation code. Running a connector approves nothing (G1–G6). Every fixture and test value is SYNTHETIC.

## 1. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5`: **exit 0**, last line `PASS gate DG5 (historical)`. It ran before any write.

## 2. Design decision the orchestrator must confirm (deviation from §B/A.2's process placement)

§B/A.2 puts the run (start → remote call → finish, retry, last-failure raise) in `apps/worker/src/handlers/integrations.ts`. That cannot be done as written:

- **The run's success path is API code.** ADR-0055 §2 step 3 stages the rows through BE-M's engine: `prepareImport` and `stageImportInTx` in `apps/api/.../integrations/imports/staging.ts`. Those validate every row through the `ImportTargetRegistry` that the domains fill in the API composition (`server.ts`; KBE-A's `kpi_actual.v1` calls the DG4 KPI rules). The ADR's auto-commit also goes through the DG4 submission service.
- **The worker may not use API code.** The worker imports no API code (ADR-0002 rule 5; `kit.ts`). A worker twin would mean twinning BE-M's engine, KBE-A's target and the DG4 submission service.
- **`integrations` may not import `operations`.** `apps/api/src/modules.ts` and `architecture.test.ts` forbid it ("A failed run reaches operations through the outbox").

**What I built** (each part tested against a real PostgreSQL):

1. **Run engine in the API** (`integrations/runs.ts`): `executeIntegrationRun` (ADR-0055 §2 steps 1–4), `dueRuns` and `connectorRunWatchStep`.
   - It is driven by a **run watch in the API process**, every 10 s. `integrations/index.ts` starts it at `onReady` and stops it at `onClose`.
   - This copies BE-K's heartbeat-watch precedent in `operations/index.ts`.
   - It is not started under `NODE_ENV=test`, where suites drive the steps explicitly. The e2e stacks use `NODE_ENV=development`, so it runs there and in production.
   - It is safe across API replicas: the connectorRun lock, the `queued → running` transition and the stale-run takeover.
2. **Worker `integrations.connector_run`** (every minute, job_schedule row and job identity in migration 0116). It creates the cadence slots, `schedule:<connector id>:<slot start ISO>`, exactly once. Slot starts use the organization's `default_timezone`; weeks start on Sunday. It needs no API code.
3. **Worker `integrations.connector_exception`**, which consumes two new outbox events.
   - `connector.run_failed` is written in the transaction of the LAST failure. The consumer raises or recurs the operational exception with BE-K's kit twin under lock 730305.
   - `connector.run_recovered` is written when a run succeeds after a failure. The consumer resolves the exception as `recovered`.
   - Both are exactly once through the `processed_message` ledger.

**Orchestrator options:**
- **(a)** Accept this split, which is my recommendation.
- **(b)** Move the import engine, the targets and the DG4 submission service into a package the worker may import (a larger reopen).
- **(c)** Grant an ADR-0002 exception.

The ADR text that names the worker as executor (ADR-0055 §2 "The run (BE-L, `apps/worker/src/handlers/integrations.ts` …)") should be amended by the architect whichever option is chosen.

## 3. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/integrations/runs.ts` (new) | Queue (manual and retry; Idempotency-Key replay), the run engine (two short transactions under connectorRun, remote call outside both), staging through BE-M's engine, counts, decimal reconciliation (`@mth/shared/calc` FORMULA_DECIMAL), automatic retry with exponential backoff, last-failure and recovery outbox events, run views (detail with history, retry chain and actionable error), due-run query, stale-run recovery, the run watch, `installDefaultConnectorAdapters`. |
| `apps/api/src/modules/integrations/adapters/test-adapter.ts` (new) | The local test adapter: modes `healthy`/`failing`/`stopped`, `confirm` `immediate`/`never`, the A17 default 10-row fixture (8 valid / 1 invalid / 1 duplicate) or `adapter_settings.fixture`, a decimal control total, `TEST-<sha256 12>` references, and the per-key effect counter (`testAdapterEffects`, the A13 proof for BE-N2). No network I/O. |
| `apps/api/src/modules/integrations/adapters/http-pull.ts` (new) | The generic `http_pull` adapter (documented pull protocol, bearer credential, `since`, a 10 MiB body limit, timeout, status → error-code classification). Its transport is injectable, so tests reach the fake over loopback while production stays https-only. **Residual:** tested only against the local fake source; never "live". |
| `apps/api/test/support/fake-http-source.ts` (new) | Local fake HTTP source (loopback; `MTH_PORT_POOL` ports): rows, status, hang, raw, oversized, required bearer. |
| `apps/api/test/integration/integrations/adapter-contract.test.ts` (new) | The shared adapter contract suite (C1–C5 against both adapters), plus each adapter's own rules. **Path deviation:** §B/A.2 names `integrations/adapters/contract.test.ts`, but a module test under `src/modules` may import only `modules.ts` and `architecture.testkit.ts` outside `src/modules` (architecture.testkit.ts `TEST_SUPPORT_FILES`). The suite needs the fake source in `test/support`, so it lives in the integration project. It uses no database. |
| `apps/api/test/integration/integrations/runs.test.ts` (new) | 15 tests (see §4). |
| `apps/api/src/modules/integrations/routes.ts` | The BE-L2 run block (after BE-L's): 4 routes. |
| `apps/api/src/modules/integrations/index.ts` | Starts and stops the run watch (onReady/onClose; not under NODE_ENV=test). |
| `apps/worker/src/handlers/integrations.ts` | `integrations.connector_run` (cadence slots) and `integrations.connector_exception` (raise/recover twin) through `defineJob`. |
| `apps/worker/src/queues/integrations.ts` | The two queues; event map `connector.run_failed` and `connector.run_recovered` → `integrations.connector_exception`. |
| `apps/worker/src/kit.ts` | **Registration lines only:** two `JOB_SERVICE_IDENTITIES` declarations. |
| `packages/db/migrations/0116_p6_connector_run_jobs.sql` (new) | job_schedule row `integrations.connector_run` (`* * * * *`, Asia/Riyadh), its audit event, and two job identities with their audit events. **Id 0116** = next above 0115 on this branch (D-196); renumber at merge if needed. |
| `packages/shared/src/schemas/events.ts` | **Shared file:** `connector.run_failed` v1 and `connector.run_recovered` v1 payload schemas (the relay refuses unregistered types). |
| `apps/api/src/modules/automation/samples.ts` | **Shared file:** a sample for `connector.run_failed` (it is BE-K2's catalogue trigger; samples.test requires a sample for every trigger-capable event). |
| `apps/api/src/modules/automation/samples.test.ts`, `outbox-registry.test.ts` | **Shared pins:** `connector.run_recovered` in NOT_TRIGGERS; both event types in the reviewed ENQUEUED list (write site `api integrations/runs.ts`). |
| `apps/worker/src/service-identities.test.ts` | **Shared pin:** 0116 added to the seeding migrations; 42 → 44 declarations. |
| `apps/worker/test/integration/schedules.test.ts` | **Shared pin:** `integrations.connector_run` in the "unhandled" lists (this test passes no integrations handler). |
| `apps/api/test/integration/contract/p6-exercises-be-l.ts` | The BE-L2 block (mirrors for the four operations, `exerciseP6BeL2Operations`, called at the end of BE-L's function). BE-L's "no pull adapter registered → 422" check now empties the adapter registry around itself, because the process registers the real adapters at start. |
| `apps/api/test/support/p6-pending-be-l2.ts` | Emptied (all four routed and exercised). |
| `apps/api/test/integration/contract/contract.test.ts` | **Pinned count:** request-body operations 405 → 407, JSON 404 → 406 (runConnector, retryIntegrationRun). |

## 4. Behaviour delivered, per requirement row

Acceptance texts are quoted from `docs/delivery/requirements.csv`.

### REQ-S17-001, "A17: a test connector run records last success, row counts, errors and retries, all visible in the UI"

The API part is done. The UI is FE-C's.

- **The run.** A run of the real local test adapter records:
  - `rowsRead` 10, `rowsStaged` 10, `rowsRejected` 1, `rowsDuplicate` 1, `errorCount` 1, `rowsCommitted` null (Unknown until BE-M2's commit);
  - reconciliation `matched` on the row count AND the decimal control total (`"211"` = `"211"`);
  - the staged batch with 8 valid / 1 invalid / 1 duplicate_in_batch;
  - `lastSuccessAt` on the connector.
- **Errors and retries.**
  - A failed run records `errorCode`/`errorMessage`.
  - Automatic retries are new runs, chained by `retryOfRunId` (`retry:<run id>`; attempt n+1 while n ≤ `retryMaxAttempts`). Each is due after `retryBackoffSeconds × 2^(attempt−1)`, tested as exactly 10 s, then 20 s.
  - `getIntegrationRun` gives the status history (`integration_run_event`), `retriedByRunId` and the actionable error.
  - `listIntegrationRuns` lists runs newest first, with a cursor.
  - Counts are null (Unknown) while queued and running, never 0.
- **Scheduled runs.** One run per cadence slot; a replay creates nothing.
- **Crash recovery.** A crash between start and finish leaves `running` with Unknown counts. The stale-run recovery finishes it with exactly one batch (the A13 hook for QA-C: `ExecuteOptions.beforeFinish`, `recover`, `staleAfterSeconds`).

### REQ-S16-022, "…an integration test creates and reads each one through the API with authorization enforced" (IntegrationRun part)

`runConnector` creates and `getIntegrationRun` reads, with authorization tested:
- KDS and ADM_TECH may run; AUD and TD get 403; an outsider gets 404; anonymous gets 401; nothing is written on a refusal.
- The entity-group test itself is BE-O's (`s16-022-entity-group.test.ts`).

### REQ-S17-005, "A17;A21: with the test connector stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message"

My part is the error codes and the run's actionable error:
- A `stopped` run fails with `connector.stopped`. A `failing` run fails with `connector.source_unavailable`.
- The connector page (`getConnector.actionableError`) and the run detail show which run (id, trigger, attempt, time), why (the code; its text is FE-A's catalogue) and the two fallbacks (`kpi_form`, `import_file`).
- The last failure produces exactly ONE `connector.run_failed` event and, through the worker consumer, exactly one operational exception. A replay creates nothing. A later success resolves it as `recovered`.
- The "KPI actual can still be submitted by form" half is BE-O's degradation test; no code of mine touches the KPI routes.

### Mutation invariants (shared rule 4)

- **Authorization re-checked at commit:** the request held behind the connectorRun lock while its grant is revoked gets 403, and nothing is written.
- **Validation:** 400 on body, id and Idempotency-Key.
- **Concurrency:** the one-active-run rule (409 `connector.run_active`), the unique key per connector, the retry-once key (409 `integration_run.not_retryable`), and 409 `connector.disabled`.
- **No If-Match on the two POSTs,** per ADR-0055 §9 (each creates a run).
- **Audit:** one audit event per transition with prior and new version (queued 1, started 1→2, succeeded/failed/cancelled 2→3).
- **No remote I/O in a transaction:** credentials and the adapter call happen between the two transactions.
- **Service identity:** a run acts as its connector's service identity. When an administrator narrows that identity, staging stops and the run fails with `service_identity.out_of_scope`.

## 5. Operations routed (pending-list delta)

`apps/api/test/support/p6-pending-be-l2.ts`: −4. `listIntegrationRuns`, `runConnector`, `getIntegrationRun` and `retryIntegrationRun` are routed, and each is exercised in `p6-exercises-be-l.ts` (BE-L2 block) with its success and every refusal it reaches:
- **runConnector:** 202, 200 replay, 400, 401, 403, 404, 409 disabled, 409 run_active.
- **list:** 200, 400, 401, 404 ×2.
- **get:** 200 with ETag, 400, 401, 404.
- **retry:** 202, 400, 401, 403, 404, 409 not_retryable, 422 retry_limit_reached.

**Pinned-count deltas for `contract.test.ts` (rule 16):**
- Operations with a request body: +2 (405 → 407), all `application/json` (404 → 406). Applied on this branch.
- No new media type, no CSRF-exempt route, no new rate-limit class.

## 6. Contract, schema, i18n and dependency needs (for the orchestrator)

1. **No new dependency.** No OpenAPI change: the four operations and their schemas are as ARCH-03 wrote them.
2. **Problem codes not in the ADR-0055 §9 table** (rule 17), proposed:
   - `service_identity.out_of_scope` as a run `errorCode`. This is ADR-0053's code; the run stores it, but it is not one of the six actionable connector codes, so the page shows no actionable error for it.
   - `connector.mapping_mismatch` is also used when the mapped header does not fit the import template (`import.header_mismatch` from BE-M's engine).
   - `connector.response_invalid` is used when no import template of the target kind is registered, or when the staging transaction refuses (e.g. 409 `import.form_schema_changed`). The retry stages again.
3. **For FE-A (i18n, en/ar):** problem texts for `connector.disabled`, `connector.run_active`, `integration_run.not_retryable` and `integration_run.retry_limit_reached` (param `{max}`, the total attempts = 1 + `retryMaxAttempts`, at most 6), plus the six why/what-to-do texts of ADR-0055 §4. None exists in `i18n/*/problems.json` yet.
4. **Shared-file overlaps to reconcile at merge:**
   - `packages/shared/src/schemas/events.ts` (two schemas);
   - `apps/api/src/modules/automation/samples.ts`. **BE-K2** adds the `connector.run_failed` catalogue trigger. If its starter-16 v2 action also opens the exception from the same event, the occurrence count would step twice per failure, so BE-K2 and the orchestrator should keep exactly one raiser: this consumer, or the starter action;
   - `kit.ts` (declarations), `service-identities.test.ts`, `schedules.test.ts`, `outbox-registry.test.ts`, `samples.test.ts`, `contract.test.ts`;
   - migration id 0116.
5. **KPI links of the connector exception** (ADR-0053 §2 "connector classes: the KPIs the connector's mappings feed") are not written. The payload carries the connector and the run, not KPI ids. Left for BE-K2 or the orchestrator.
6. **Auto-commit** (`commit_mode = auto`) is not run. A batch is staged with `commit_mode`/`on_behalf_of_user_id` recorded and stays `staged`, never silently committed. BE-M2's commit service should be called after transaction 2 (ADR-0055 §2 step 3). `rows_committed` stays null (Unknown) until then.

## 7. User-facing texts made untrue

None found. `grep -i "connector|integration"` over `apps/web/src/i18n/en/*.json` finds only the Operations and service-identity summaries, which stay true. No en/ar text calls connector runs planned or later. The run and error texts FE-A must add are listed in §6.3.

## 8. Checks actually run

Environment: Node 24.21.0, offline. Disposable PostgreSQL via `tests/qa/support/with-pg.sh`, `QA_PG_PORT=24950`, `MTH_PORT_POOL=24951-24999`. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-L2-evidence/`.

Machine conditions: 4 CPUs and 16 GB shared with the other W9 tasks. Load average was 18–23 during the full runs (measured 21:28Z), with about 3 GB available. Every timeout below happened under that load.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **exit 0**, `PASS gate DG5 (historical)` | `validate-dg5-historical.log` |
| 2 | `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| 3 | `pnpm -r build` | **exit 137 (BLOCKED, not a code failure):** `apps/web build: Killed` (out of memory) while the integration suite ran in parallel. Every other package built. `apps/web` is untouched by this task. **Not re-run alone** within the time limit. | `build.log` |
| 4 | `pnpm lint` | **exit 0** | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** ("All matched files use Prettier code style!" per xargs batch). This handback was written after the check; re-checked in row 12. | `prettier.log` |
| 6 | `pnpm openapi:lint` | **exit 0**, `PASS … OpenAPI 3.1.1, 932 operations` (unchanged contract) | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | unit-node: **2610 passed, 2 failed (exit 1)**. Both failures are **timeouts under load**, not assertions: `architecture.test.ts` "apps/web never imports @mth/db…" (30 s budget, took 42.8 s, a whole-tree import walk) and `server.test.ts` "declares access on every /api route" (5 s budget, took 5.1 s). Both passed in my earlier unit-node run on this same tree (`unit1.log` run: their files passed). Final (finished 22:07Z, exit 1): **unit-web 1778 passed, 9 failed** (4 files: `p2-blank-forms`, `p2`, `traceability`, `transformations` page tests; 1 timeout at 20 s, 8 "Unable to find role…" waits that expired). This task changed no file under `apps/web` (`git status` shows none), so these are not caused by it; they ran at load average 18-23 and are unverified as load effects until re-run alone. **unit-formula-nocodegen 259 passed, 2 skipped.** | `test-unit-locale-unset.log` |
| 8 | `pnpm test` with `C.UTF-8` | **NOT RUN** (time limit). | — |
| 9 | `QA_PG_PORT=24950 MTH_PORT_POOL=24951-24999 tests/qa/support/with-pg.sh pnpm test:integration`, locale unset | **NOT COMPLETED.** The run was stopped at its 60-minute background limit after 997 passed and 4 failed tests. All 4 failures are **timeouts in suites this task does not touch**, under the load above. **Passed in this run:** `integrations/runs.test.ts` 15/15, `integrations/connectors.test.ts` (BE-L) 20/20 with the real adapters registered, `operations/exceptions.test.ts` 13/13, `contract.test.ts` 100/101. **Not reached:** `adapter-contract.test.ts` and `apps/worker/test/integration/schedules.test.ts`. | `test-integration.log` (partial) |
| 10 | `with-pg.sh npx vitest run --project integration …/integrations/runs.test.ts` (isolated) | **exit 0, 15/15** | `runs-test-isolated.log` |
| 11 | `with-pg.sh npx vitest run --project integration …/contract/contract.test.ts` (isolated, after the pin update) | **exit 0, 101/101** (the media-type sweep took 20.5 s of its 30 s budget alone) | `contract-test-isolated.log` |
| 12 | `npx vitest run --project unit-node` on architecture, advisory-locks, outbox-registry, samples, service-identities (after the fixes) | **exit 0, 159/159** | `unit-pins-rerun.log` |
| 13 | The adapter contract suite (20 tests), run as `apps/api/src/modules/integrations/adapters/contract.test.ts` **before** I moved it to the integration project | **20/20 passed** at 20:09Z. The log was not kept, so I can't cite it. **Not re-run at its new path.** | — |

The four integration timeouts, all outside this task's files, are near-budget tests (F-DG4-143 class):
- `contract.test.ts` "every operation: an undeclared request media type…": 30.0 s; 20.5–25.5 s when isolated. My +4 routed operations add a little to this sweep.
- "export … at most 5000 rows": 60.0 s.
- "bulk editing … commit-time re-authorization": 30.0 s.
- "submission with missing mandatory evidence … gate page": 31.9 s.

**Pinned-count changes:** `contract.test.ts` request bodies 405 → 407 (JSON 404 → 406); `service-identities.test.ts` declarations 42 → 44 (and 0116 added to the seeding migrations); `schedules.test.ts` unhandled lists + `integrations.connector_run`; `outbox-registry.test.ts` ENQUEUED + 2; `samples.test.ts` NOT_TRIGGERS + `connector.run_recovered`.

Started 2026-10-29T19:57:34Z; handback written about 21:52Z (about 115 minutes).

## 9. What remains

Separable second half (D-059/D-070): **verification only.** The code is complete for §B/A.2 as adapted in §2.

1. **Run** `pnpm test` with `C.UTF-8`, and confirm unit-web and nocodegen with the locale unset (row 7).
2. **Run** the full `pnpm test:integration` on a less loaded machine. In particular run `adapter-contract.test.ts` (never run at its new path) and `apps/worker/test/integration/schedules.test.ts` (pin updated, not run).
3. **Re-run** the two load-timed-out unit tests (row 7) and the four load-timed-out integration tests (row 9) alone. If any is still over budget under the measured W9 load, its owner should raise its budget.
4. **Re-run** `pnpm -r build` alone (row 3; the web build was OOM-killed).
5. **Orchestrator decision** on §2 (where runs execute), and the ADR-0055 §2 wording.
6. **Orchestrator decision** on the single raiser of the connector exception, given BE-K2's starter 16 v2 (§6.4).
7. **Hand-offs:**
   - BE-M2: the auto-commit (§6.6);
   - BE-K2 or the orchestrator: the exception's KPI links (§6.5);
   - FE-A: the i18n problem texts (§6.3);
   - FE-C: the pages (counts "Unknown" when null, "Never succeeded", "Not checked", the retry chain).
8. **Merge:** renumber migration 0116 if another W9 task ships 0116, and reconcile the shared-file pins listed in §6.4 and §8.
