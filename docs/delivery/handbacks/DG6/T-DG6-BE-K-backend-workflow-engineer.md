# Handback T-DG6-BE-K (backend-workflow-engineer): operational exceptions, routes, the failure hook, the heartbeat route and watch

- **Stage:** DG6 (BUILDING), P6 "Integration and system hardening". Section: `docs/architecture/p6-work-split.md` §J/C.3.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-K-backend-workflow-engineer-20261029T001305Z-41decf6e","session_id":"41decf6e-84e2-4ea1-82cd-c4348e6c581f"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-K.md`, sha256 `516308c426e68fdacb940b22f24bf52e2a4ad4cca55579fd8e7213d47fbb86cd` (verified with `sha256sum` at start).
- **Working tree:** `/home/user/wt/dg6-be-k`, branch `dg6/be-k`, starting `HEAD` `df357b239dd10bcb1ba4242da51475d2dcb66814` (clean tracked tree at start). The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** start `Thu Oct 29 00:24:35 UTC 2026`, end `Thu Oct 29 02:22 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, exit 0 (`T-DG6-BE-K-evidence/validate-historical-DG5-start.txt`; re-run at the end, §3).
- **Gates:** acknowledging or resolving an operational exception is an operational action, **not a business approval** (G1–G6). Nothing here reads or writes an engineering gate record (DG0–DG7). No KPI value or freshness rule is written or changed. Every value in the tests is synthetic.
- **No migration** (none needed: 0101/0103 hold every table, guard, permission and lock). **No new dependency.**

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/operations/exceptions.ts` (new) | The service. The DTO mapping. The exact ADR-0053 §2 refusals (`operations.exception_not_open`, `operations.exception_resolved`, `operations.note_required`). The scope rule (`holdsForException`, `visibleException` 404, `requireExceptionChange` 403). The list with its SQL scope filter. The detail (events, linked KPIs with DG4's freshness label and last value, `hiddenKpiCount`). `acknowledgeException` and `resolveException` (row lock, commit-time re-authorization, 409, state checks, audit). The **raise/recover service** (`raiseOperationalException`, `recoverOperationalException`: lock `operationalExceptionUpsert` 730305, update-or-insert, one audit event, KPI links). |
| `apps/api/src/modules/operations/heartbeat.ts` (new) | `heartbeatState` (the pure rule), `readWorkerHeartbeat` (the `getWorkerHeartbeat` body), `heartbeatWatchStep` (one watch step: open, recur, skip or recover `worker:worker:heartbeat_missed`) and `startHeartbeatWatch` (every 60 s, unref'd timer, `alert: true` error log line on open). |
| `apps/api/src/modules/operations/routes.ts` | The five routes (BE-A's stub). |
| `apps/api/src/modules/operations/index.ts` | Registers the routes. Starts the heartbeat watch on `onReady` and stops it on `onClose`; it is not started when `deps.db` is absent (the module unit test). Public exports for BE-K2 and the tests: `raiseOperationalException`, `recoverOperationalException`, `heartbeatWatchStep`, `readWorkerHeartbeat`, `heartbeatState`. |
| `apps/api/src/modules/operations/operations.test.ts` | Unit: the heartbeat rule (unknown / alive ≤ 90 s / stale) and the five registered routes. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP6OperationsChannelsError`: the J/C database-guard mappings listed in §J/C.3, exactly. It is wired into `mapDatabaseGuardError` right after BE-A's P6 line. |
| `apps/api/src/modules/platform/db-errors-p6-jc.test.ts` (new) | Unit: every mapping through the dispatcher, with code, status and exact English text. |
| `apps/worker/src/kit.ts` | The failure hook lines. `captureJobFailure` opens or recurs the queue's `job_failed` exception **after the `operational_failure` write**, in the same transaction, once per failed pg-boss job (the `processed_message` ledger `operations.job_failed`, key `<queue>:<job id>`). `settleRetriedJob` (called on every success) resolves the active exception `recovered`. Also: the worker twin of the raise/recover service (`raiseOperationalExceptionTwin`, `recoverOperationalExceptionTwin`, lock 730305), and `redactErrorText`, the ADR-0053 §4 item 4 redaction now applied to `operational_failure.error_message` and `operational_exception.last_error_message`. |
| `apps/worker/src/exception-redaction.test.ts` (new) | Unit: each redaction class is removed; an ordinary message is unchanged. |
| `apps/api/test/integration/operations/exceptions.test.ts` (new) | Integration, 13 tests (§2). |
| `apps/api/test/integration/contract/p6-exercises-be-k.ts` | Contract exercises of the five operations (success and every reachable refusal) and their zod mirrors. |
| `apps/api/test/support/p6-pending-be-k.ts` | Emptied (the five operations are routed). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-K-*` | This handback and its evidence logs. |

## 2. Behaviour delivered, per requirement row

### REQ-S12-019 (BE-K part)

Acceptance: *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*. Row text: *"An exception is shown to admins and data owners; values display as Stale with last update time"*.

**BE-K delivers the job-failure path, the exception routes and the heartbeat. The connector-failure path is ARCH-03/BE-L's, and the stale-KPI scan is BE-K2's. Both call the raise service delivered here. The literal A17 fixture (a failing test connector, plus a KPI whose actual is older than `staleAfterDays`) is QA-A/QA-E's, after BE-L2 and BE-K2.** What is proven here:

- **One exception per source and failure class** (`exceptions.test.ts`):
  - **3 failures:** one job key fails 3 times (3 pg-boss jobs, each on its last attempt). The result is **exactly one** active exception with `occurrence_count` 3. It is linked to the single `operational_failure` row. Its history is `opened`, `recurred`, `recurred`, with three audit events (`operational_exception.opened`, then `.recurred` with prior/new versions 1→2 and 2→3, actor `service`).
  - **Replay:** a replay of the same failed job (same pg-boss job id, so the same `processed_message` key) **creates nothing**:
    - *Organization job:* the DG5 `job.failed` outbox key already refuses the replay, the whole capture rolls back, and the count stays 3.
    - *Organization-less job:* there is no outbox row, so DG5 accepts the replay (the failure row adds the attempts, unchanged DG5 behaviour). The exception ledger keeps the count at 1, with no second audit event.
  - **Recovery:**
    - A success of the queue in the job's organization resolves the exception `recovered`, with `resolved_by` NULL, no note and its audit event.
    - A success in another organization does not resolve it.
    - A success with nothing active writes nothing.
    - A later failure opens a **new** exception: a resolved one is final.
  - **Platform exception:** a scheduled, organization-less job opens a platform exception (`organization_id` NULL).
- **Redaction (ADR-0053 §4 item 4):** a failure text with URL credentials, `X-Amz-Signature`, an OIDC `code`, a bearer token, an AKIA key and a deep-link token is stored without any of them, in both `operational_exception.last_error_message` and `operational_failure.error_message`.
- **Visible to admins and data owners (ADR-0053 §9):**
  - **Organization-level reader** (ADM_TECH, AUD, TO): sees the organization's exceptions and the platform ones.
  - **Transformation-scope KDS:** sees **only** the exceptions linked to a KPI of its transformation. Another transformation's exception, an unlinked organization exception and a platform exception are all **404**, and acknowledging one out of scope is 404 with nothing written.
  - **Another organization's TO:** 403 on organization A's list and 404 on its exceptions. Its own list contains none of A's exceptions, only the platform ones.
  - **No `operations.read`:** 403 on the list.
- **Last known value with its freshness label:** `getOperationalException` lists each readable linked KPI with DG4's freshness label, its last value and the value's date. A KPI the caller cannot read (`transformation.read`, the panel's own gate) only increases `hiddenKpiCount`. The test proves the Unknown case: no accepted actual gives `freshness: "unknown"`, `lastValue: null`, `lastValueAt: null`, never 0 or fresh, and the DG4 panel route returns the same `unknown`/`null` for the same KPI.
  - **Limit, disclosed in §7:** the stale-with-value case is not proven here; BE-K2's freshness-scan tests and QA cover it.
  - **How it is computed:** `operations` may not import `kpi` (ADR-0002, the `modules.ts` `dependsOn` list; the architecture test refuses it). So the linked-KPI read repeats `statusOf`'s three reads (active version, current period, latest period evaluation) and applies DG4's **own** read-time rule from `@mth/shared/calc` (`withReadTimeStaleness`). Nothing is computed differently or written.
- **Acknowledge and resolve, every refusal and invariant** (integration and contract):

  | Case | Result |
  |---|---|
  | Malformed body | 400 |
  | AUD | 403 on both POSTs |
  | Missing, or outside scope | 404 |
  | Stale `If-Match` | 409 version |
  | Acknowledge when not open | 409 `operations.exception_not_open` |
  | Acknowledge or resolve when already resolved | 409 `operations.exception_resolved` |
  | Blank or short note | 422 `operations.note_required` (exact ADR texts) |
  | No `If-Match` | 428 |
  | Commit time | Authorization re-checked on the reloaded grants after the row lock: a right lost meanwhile is 403, nothing written |
  | Audit | Exactly one event per change, with prior and new version (`operational_exception.acknowledged` 1→2, `.resolved` 3→4) |
  | Remote I/O | None |

  Further behaviour:
  - A recurrence while acknowledged keeps the status and counts once.
  - Resolving leaves the KPI definition row byte-identical.
- **Worker heartbeat (A22, ADR-0053 §6):**
  - **Status rule:** `unknown` with no beat, `stale` after 90 s, `alive` within 90 s. `unknown` and `stale` are never alive.
  - **Watch, opening:** the watch raises nothing on `unknown`. It opens `worker:worker:heartbeat_missed` (platform) on a stale beat, and does not count again within 30 s.
  - **Watch, recovery:** it resolves the exception `recovered` when a fresh beat appears.
  - **Route:** `getWorkerHeartbeat` reads alive with a fresh beat, AUD reads it, 403 without `operations.read`, 401 anonymous.
  - **Test isolation:** the watch test runs in a rolled-back REPEATABLE READ owner transaction, so it is deterministic whatever other suites (or DO-D's writer) write to the shared run.

### REQ-S16-029 (redaction part only)

The ADR-0053 §4 item 4 line ("`operational_exception.last_error_message` and `operational_failure.error_message` are passed through the same redactor before they are written") is delivered with a local redactor (`redactErrorText`, kit.ts). See §5 item 2 for the merge with DO-D's shared redactor.

## 3. Checks actually run

Node 24.21.0, offline, ports 24000–24049. Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-K-evidence/`.

Acceptance checks 1, 2 and 4 of the assignment exit 0. Check 3 (the full integration suite) completed with exit 1: **4 failures, all explained below**. Two are the expected pinned-count delta that the orchestrator reconciles; two are load-induced and pass in the focused re-run #9.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | **0**, **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5-start.txt`, `validate-historical-DG5-end.txt` |
| 2 | `pnpm -r typecheck` (final tree) | **0** | every package | `typecheck.txt` |
| 3 | `pnpm -r build` (final tree) | **0** | every package | `build.txt` |
| 4 | `pnpm lint` (final tree) | **0** | 0 problems | `lint.txt` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (final tree, handback included) | **0** | "All matched files use Prettier code style!" | `prettier.txt` |
| 5b | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `openapi-lint.txt` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **0** | unit-node **162 files, 2501 tests passed**; unit-web **96 files, 1768 passed**; unit-formula-nocodegen **3 files, 259 passed, 2 skipped** | `test-locale-unset.txt` |
| 7 | `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | **0** | the same counts: 162/2501, 96/1768, 3/259 (+2 skipped) | `test-c-utf8.txt` |
| 8 | `QA_PG_PORT=24001 MTH_PORT_POOL=24002-24049 tests/qa/support/with-pg.sh pnpm test:integration` (full, completed 02:21 UTC) | **1** | **Test Files 2 failed, 335 passed (337); Tests 4 failed, 3416 passed, 1 skipped, 1 todo (3422).** The 4 failures are in `contract.test.ts` (1: the JSON-body pin) and `response-validation.test.ts` (3: the same pin, plus the two load-induced tests below). `exceptions.test.ts` passed 13/13 and `service-identity-scope.test.ts` 10/10 in this run. | `test-integration.txt` |
| 9 | Focused: `QA_PG_PORT=24030 MTH_PORT_POOL=24031-24049 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/operations/` | **1** | **3 files, 123/124 tests passed.** The only failure is the **expected JSON-body pin** (`expected [ 399, 398, 1 ] to deeply equal [ 397, 396, 1 ]`). `exceptions.test.ts` passes 13/13, `service-identity-scope.test.ts` 10/10, and every other contract test passes, including the P5 BE-J exercise and the undeclared-media-type sweep. | `test-integration-focused.txt` |

**Disclosed non-zero exits and failures:**

- **First unit runs (pre-fix):** `test-locale-unset-run1-prefix.txt` and `test-c-utf8-run1-prefix.txt` failed 1 test: `advisory-locks.test.ts` "no module source outside the registry spells a class number". My `exceptions.ts` spelled `730305` (constant and comments). It now uses `ADVISORY_LOCK_CLASSES.operationalExceptionUpsert`, and #6/#7 above are the clean re-runs.
- **First typecheck:** exited 2 on a tuple typing in my new `db-errors-p6-jc.test.ts`. It was fixed; #2 is the re-run.
- **A failed background start:** the first background attempt of #6/#7 wrote to a relative path from the wrong directory and never ran the tests. It was re-run with absolute paths.
- **Expected pin failure (#8, #9):** the JSON-body pin fails in `contract.test.ts` and again in `response-validation.test.ts`, as `[399, 398, 1]` vs `[397, 396, 1]`. **Expected:** two new JSON-body operations (`acknowledgeOperationalException`, `resolveOperationalException`). `contract.test.ts` is not my file; the pin is reconciled by the orchestrator (§2 rule 16, D-079 precedent). **Pinned-count change: `[397, 396, 1]` → `[399, 398, 1]`.** No other pin changes: operations 932, no new media type, rate-limit floor and CSRF-exempt list unchanged.
- **Load-induced failures in the full run (#8):** two more failures in `response-validation.test.ts`'s pass of the contract suite:
  - "P5 BE-J operations": `expected [] to have a length of 1 but got +0`;
  - "every operation: an undeclared request media type …": timed out at 30 s.

  #8 ran **concurrently with #6/#7 and the static checks** (time limit), so the host was heavily loaded. Both tests **passed** in the focused run #9, which matches BE-J's handback observation of the same two tests failing only under load. They are not caused by this change, which touches neither P5 BE-J nor the media-type sweep, but they are disclosed.


## 4. Operations routed: delta to `p6-pending-be-k.ts`

Removed all 5. The list is now empty: `listOperationalExceptions`, `getOperationalException`, `acknowledgeOperationalException`, `resolveOperationalException`, `getWorkerHeartbeat`. Each is exercised in `p6-exercises-be-k.ts` with a success and every reachable declared refusal. 404 of `getWorkerHeartbeat` is declared but not reachable: the route has no path parameter or organization. The contract's operation count (932) is unchanged. No media type, rate-limit or CSRF-exempt pin changes. Every `consumes` equals the contract: `application/json` on the two POSTs, none on the GETs.

## 5. Contract, schema, dependency and coordination notes for the orchestrator

1. **`lastValueAt` (contract) vs DG4's `dataAsOf` (a business date).** The contract types `linkedKpis[].lastValueAt` as a timestamp, while DG4's panel gives `freshness.dataAsOf` as a business date. I return the **start of that business date in the organization's time zone** (default calendar, else organization zone; Asia/Riyadh by default). An additive `dataAsOf: BusinessDate` would be clearer; that needs a contract change, which is yours to decide.
2. **Redactor (DO-D, in parallel).** ADR-0053 §4 item 1's process-wide `SecretProvider` set is DO-D's (`packages/config/src/load.ts`); it is not on this branch. `redactErrorText` (kit.ts) applies the pattern classes of §4 items 2–3 and §5 to the two stored messages. **At merge,** if DO-D exports a shared redactor, `redactErrorText` should delegate to it (one line) so the secret-value set also applies to stored messages.
3. **Heartbeat writer (DO-D).** I assumed DO-D's writer inserts a `worker_heartbeat` row per instance and updates `last_beat_at` and `beat_count` (+1). That is the 0101 shape, and the route and watch only read it. The tests insert their own rows, so they don't depend on the writer's timing.
4. **`unknown` does not raise.** The watch raises `heartbeat_missed` only when a beat exists and is older than 90 s (ADR-0053 §6: "when the newest beat is older than 90 s"). A deployment whose worker never beat shows `unknown` on the card but raises no exception. Please confirm, or decide that `unknown` for longer than N minutes after API start should raise.
5. **Multiple API instances.** Each instance runs the watch, serialized by lock 730305. A check within 30 s of the last recorded occurrence does not recur, so N instances do not multiply the count.
6. **Heartbeat visibility.** `getWorkerHeartbeat` is answered for an `operations.read` holder **at organization level** in some organization (the platform-exception rule). A transformation-scope KDS gets 403 there.
7. **Error alerts (ADR-0053 §6).** The in-app notification to `operations.acknowledge` holders on opening is BE-K2's (§J/C.4, "the alert lines"). BE-K writes only the API watch's `alert: true` error log line. `raiseOperationalException` and its twin return `outcome: "opened" | "recurred"` for BE-K2's alert.
8. **For BE-K2 and BE-L:**
   - **Freshness scan:** use `raiseOperationalExceptionTwin` / `recoverOperationalExceptionTwin` (worker, kit.ts) with `sourceKind: "data_freshness"`, `sourceCode: "kpi:<id>"`, `failureClass: "data_stale"` and `kpiLinks`.
   - **API-side raises:** use `raiseOperationalException` (operations index).
   - **Parity:** an integration test proves the two write the same rows and audit actions.
9. **`processed_message` growth:** one ledger row per last-attempt job failure (consumer `operations.job_failed`). It is subject to the existing retention purge of that table.
10. **Existing BE-J test:** `captureJobFailure` now also opens an exception. `service-identity-scope.test.ts` passed unchanged in my run.

## 6. User-facing texts

- **No en/ar string calls operational exceptions or the heartbeat "planned".** Checked: `apps/web/src/i18n/en/*.json`; `nav.json` `operations` / `operationalException` describe them as present, and `admin.json` `plannedSections` does not mention them.
- **Problem texts:** the three ADR-0053 §2 keys already exist in `problems.json` (FE-A) with the exact English texts this API sends.
- **Nothing made untrue; no text changed.**

## 7. What remains (not done)

- **A17 fixture:** the literal fixture (a failing test connector, a KPI stale with a value and date) depends on BE-L2 (connector runs) and BE-K2 (freshness scan). It is not runnable on this branch.
- **Stale-with-value parity:** only the Unknown case is proven against the DG4 panel; BE-K2's tests should add the stale-with-value comparison.
- **Error-alert notifications:** BE-K2's.
- **Redactor merge:** delegation to DO-D's shared redactor at merge (§5 item 2).

## 8. End

- **Status:** implementation complete for §J/C.3. No migration.
- **Merge instructions:**
  1. Merge after BE-J (already integrated) and in parallel with BE-L and DO-D. `apps/worker/src/kit.ts` is edited in the order BE-J → BE-K → BE-I2: my lines are the failure-hook block in `captureJobFailure` and `settleRetriedJob`, and a new section before BE-J's service-identity section.
  2. Reconcile the JSON-body pin in `contract.test.ts` to `[399, 398, 1]` (+2 over `[397, 396, 1]`), plus any parallel W7 deltas.
  3. If DO-D exports a shared redactor, make `redactErrorText` delegate to it (§5 item 2).
- **Time:** about 2 h, within the limit.

