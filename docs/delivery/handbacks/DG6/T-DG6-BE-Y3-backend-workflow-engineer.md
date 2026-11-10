# Handback T-DG6-BE-Y3 (backend-workflow-engineer): DG6 round-1 repair of KPI freshness, createTomGap 400 and test isolation

- **Stage / gate:** P6, DG6 (FIXING after review round 1).
- **Invocation:** `DG6-T-DG6-BE-Y3-backend-workflow-engineer-20261101T210533Z-60b1bd85`, session `60b1bd85-f678-46cd-93af-6cfc0e12a904`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Y3.md` (sha256 `5a1df302…de2c`, verified).
- **Base:** branch `dg6/be-y3` at `eb75a6aa6`. The tree was clean at the start.
- **Changes:** left uncommitted for the orchestrator.
- **Time:** started `2026-11-01T21:07:38Z`. The end time is in §8.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited **0**.

Nothing here grants or records a business, Finance or IT approval (G1–G6), and nothing reads or writes DG0–DG7. All test data is synthetic.

## 1. Changed files

| File                                                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/worker/src/handlers/operations.ts`                                     | F-DG6-100/140: `kpiFreshness` now reads the KPI's latest accepted value across periods. That is the newest open or closed period of the KPI's frequency whose panel evaluation (the slot's highest run seq) carries a value, the same query as the API's `linkedKpiStatus` (BE-X4). The ADR-0028 read-time staleness rule and `dq_stale_after_days` then apply as before. The header and doc comments were updated to match.                               |
| `apps/worker/test/integration/operations-freshness.test.ts`                  | Regression tests for F-DG6-100/140: the domain reviewer's probe scenario, an Unknown later evaluation, a Fresh control and a never-a-value control (4 new tests).                                                                                                                                                                                                                                                                                       |
| `apps/api/test/integration/operations/exception-last-known-value.test.ts`    | Parity check: with the later empty period open, the worker's `kpiFreshness` agrees with `getOperationalException`'s linked-KPI read (Stale, `250.75`, `2026-01-31`).                                                                                                                                                                                                                                                                                  |
| `apps/api/src/modules/transformations/registers.ts`                          | F-DG6-146: `createTomGap` parses with the contract's `TomGapCreate` (`dimensionCode` required), so a missing `dimensionCode` gets the uniform 400. The `tomGapCreateLenient` schema is gone. The `check` 422 rule stays as a guard for other paths.                                                                                                                                                                                                    |
| `apps/api/test/integration/hardening/route-inventory.test.ts`                | F-DG6-146: the `4:createTomGap` pin is removed (`REPORTED_DEVIATIONS` is now empty, and case 4 asserts all 482 operations answer 400). F-DG6-124/145: the fingerprint no longer skips the non-existent table `user_session`. It now fingerprints `public.session` without its two sliding columns, `last_seen_at` and `idle_expires_at`, so every other session change is still detected. A new test forces the touch and proves both directions. |
| `apps/api/test/integration/registers.test.ts`                              | F-DG6-146: the existing T03 test pinned the old 422 for a gap without `dimensionCode`. It now expects the uniform 400 (`urn:mth:problem:validation`, pointer `/dimensionCode`). The full integration run found this pin (§8). |
| `apps/api/test/integration/automation/dependency-slip-relay.test.ts`         | F-DG6-145: the "further relay round" assertion is scoped to the slip's own outbox row (still published, `publish_attempts` 1, same `published_at`, no error). It no longer asserts the global `{published: 0}` tally, which the running worker's own rows change.                                                                                                                                                                                         |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y3-backend-workflow-engineer.md`       | This handback.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Y3-evidence/*.log`                     | Command logs (§3).                                                                                                                                                                                                                                                                                                                                                                                                                                     |

There is no migration, no contract change, no dependency and no change to user-facing strings.

## 2. Per finding: cause, fix, test, result

### F-DG6-100 / F-DG6-140 (Medium, the same defect; REQ-S12-019)

- **Acceptance (REQ-S12-019):** "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date". The row title: "when a connector or job fails or data becomes stale, create a visible operational exception and retain last known values with freshness labels".
- **Reproduced:** `01-before-fix-targeted.log`, with HEAD's `operations.ts` and the new tests. The probe scenario failed with `expected [ 'unknown', null, null ] to deeply equal [ 'stale', '0.4125', '2026-09-03' ]`.
- **Cause:** `kpiFreshness` read only the organization's newest open or closed period of the KPI's frequency. `kpi.reporting_period_open` opens each new period automatically, so for a stopped feed the newest period is always empty. The read was then `unknown`, never `stale`, and the scan emitted no `data.stale` event.
- **Fix:** freshness is now based on the KPI's latest accepted value across periods:
  - **Which value:** the newest open or closed period whose panel evaluation (the slot's highest `calculation_run.seq`) has a non-null value.
  - **Staleness:** that value's `data_as_of` is checked against the active version's `dq_stale_after_days` (default 45) with `withReadTimeStaleness`, as before.
  - **What does not hide it:** an empty newest period, or one with an Unknown evaluation.
  - **Unknown:** a KPI with no value in any period stays Unknown with null value and date (never 0).
  - **Unchanged:** `scheduled` periods are not read, the episode key is still `data.stale:<kpi>:<dataAsOf>`, and recovery happens once the newest value is fresh.
  - **Parity:** the query is the same shape as `linkedKpiStatus` in `apps/api/src/modules/operations/exceptions.ts`.
- **Tests:**
  - **Worker** (`operations-freshness.test.ts`, describe "a stopped feed…"):
    1. The domain probe scenario (stale value 60 days old in the previous closed period, current period open and empty): reads Stale `0.4125` with its date, the scan gives `{kpis 1, stale 1, emitted 1}` then `emitted 0`, and the raise consumer opens one `data_stale` exception.
    2. An Unknown evaluation in the current period does not hide the earlier stale value.
    3. A value within the window in the earlier period reads Fresh and emits nothing.
    4. No value in any period stays Unknown with nulls and emits nothing.
  - **API parity** (`exception-last-known-value.test.ts`, "a later open period WITHOUT an evaluation"): the worker read equals the linked-KPI read, Stale `250.75` `2026-01-31`.
- **Before the fix:** tests 1–3 and the parity check failed (4 failures). Test 4 passed, as it should: it guards that Unknown stays Unknown.
- **After the fix:** all pass (`03-after-fix-targeted.log`, 30/30).
- **BE-X4 agreement:** checked by the parity assertion above. The linked-KPI read itself is unchanged.

### F-DG6-146 (Low; REQ-S16-027)

- **Acceptance (REQ-S16-027):** "contract tests validate responses against the OpenAPI document; invalid input returns the uniform 400 body; an unauthorized call returns 403".
- **Cause:** `tomGapRegister.createSchema` was `tomGapCreate.partial({ dimensionCode: true })`. A missing `dimensionCode` passed parsing and was then refused by `check` as `422 t03.dimension_required`.
- **Fix:** `createSchema: tomGapCreate`, the zod mirror of the contract's `TomGapCreate`, which requires `dimensionCode`. The `dimension_code: null` default in `insertValues` was removed as unreachable. The `REPORTED_DEVIATIONS` pin is removed in the same change.
- **Test:** route-inventory case 4.
  - **Before the fix:** with the pin removed and HEAD's `registers.ts`, it failed with "operations not refused as ADR-0051 §5 requires: expected [ Array(1) ] to deeply equal []" (`01-before-fix-targeted.log`).
  - **After the fix:** `statuses {"400":482}`, tables changed 0 (`03-after-fix-targeted.log`).

### F-DG6-124 / F-DG6-145 (Low; REQ-S02-006, REQ-DLV-038)

- **Acceptance (REQ-S02-006):** "A08;A12: each control test that bypasses the UI and calls the API with invalid or unauthorized input is rejected; clearing browser storage loses no submitted business data".
- **Acceptance (REQ-DLV-038):** "A12;A13;A14;A17;A21;A22;A23: the applicable A01-A22 executable tests pass on the DG6 candidate and the load report states the actual results against REQ-S20-029".
- **Cause 1 (route inventory):** `SESSION_TABLES = new Set(["user_session"])` names a table that doesn't exist. The real `session` table was fingerprinted whole, so `touchSession` (which slides `last_seen_at`/`idle_expires_at` at most once a minute) changed it whenever a case took more than 60 s.
- **Fix 1:** `SLIDING_COLUMNS` maps `public.session` to `["last_seen_at", "idle_expires_at"]`. Those rows are hashed as `to_jsonb(x) - 'last_seen_at' - 'idle_expires_at'`. Every other table and every other session column is still compared, so a created, revoked or altered session is still caught.
- **Test 1:** the new route-inventory test "the fingerprint ignores only the session's sliding idle expiry, whatever a case's duration". It does this without waiting 60 s, so the result doesn't depend on timing:
  - ages the caller's session two minutes, sends `GET /api/v1/me`, asserts that `last_seen_at` moved and that no table changed;
  - then changes `user_agent` and asserts that `public.session` is reported;
  - restores the original values and asserts that nothing changed.
- **Test 1 results:**
  - **Before the fix:** with HEAD's behaviour (no sliding columns excluded), it failed with exactly the reviewers' symptom, `expected [ 'public.session' ] to deeply equal []` (`02-before-fix-session-fingerprint.log`).
  - **After the fix:** passes (`03-after-fix-targeted.log`).
- **Cause 2 (dependency-slip-relay):** after `startWorker`, the test asserted `relayOnce(...)` equals `{published: 0, failed: 0}` over the whole database. The worker's own loop writes further outbox rows meanwhile, so the count depended on timing.
- **Fix 2:** the assertion is scoped to the slip's own row: still published, `publish_attempts` 1, the same `published_at`, `last_error` null. The existing scoped checks are kept: one pg-boss job for the key, and one execution.
- **Test 2 / honest limit:** I could not make the old global assertion fail on demand, because it depends on the worker loop's timing under load. The fix removes the global dependency by construction. After the fix the file passes (`03-after-fix-targeted.log`) and in the full integration run (§3).

## 3. Checks run (real exit codes)

Environment:

- Node 24.21.0 and pnpm 10.33.0, offline.
- PostgreSQL is the disposable cluster from `tests/qa/support/with-pg.sh`, on ports 28200–28249 only.
- The host was shared with the concurrent DG6 repair tasks (load average 12–25, about 4–5 GB free).

| #   | Command                                                                                                                                         | Exit                                    | Result / counts                                                                                                                                                                                                                                                                       | Log                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0   | `node tools/gates/validate.mjs --historical --stage DG5`                                                                                        | 0                                       | `PASS gate DG5 (historical)`                                                                                                                                                                                                                                                          | (console)                                                              |
| 1   | targeted integration, **before the fix** (HEAD `operations.ts` and `registers.ts`, new tests): freshness, last-known-value and route-inventory files | 1 (expected)                            | 5 failed: 3 freshness, BE-X4 parity, case 4 (`createTomGap` 422)                                                                                                                                                                                                                      | `01-before-fix-targeted.log`                                           |
| 2   | route-inventory sliding-session test, **before the fix** (fingerprint as HEAD)                                                                  | 1 (expected)                            | 1 failed: `expected [ 'public.session' ] to deeply equal []`                                                                                                                                                                                                                          | `02-before-fix-session-fingerprint.log`                                |
| 3   | targeted integration, **after the fix** (the 4 touched test files)                                                                               | 0                                       | 4 files, 30 tests passed; case 4 `{"400":482}`                                                                                                                                                                                                                                        | `03-after-fix-targeted.log`                                            |
| 4a  | `pnpm -r typecheck`                                                                                                                             | **137**                                 | **Killed (out of memory):** `apps/api` `tsc` was killed while the workspace typechecked in parallel on the shared host. This was not a type error.                                                                                                                                    | `10-typecheck.log`                                                     |
| 4b  | `pnpm -r --workspace-concurrency=1 typecheck`                                                                                                   | 0                                       | every package Done                                                                                                                                                                                                                                                                    | `11-typecheck-retry-concurrency1.log`                                  |
| 5   | `pnpm -r --workspace-concurrency=1 build`                                                                                                       | 0                                       |                                                                                                                                                                                                                                                                                       | `12-build.log`                                                         |
| 6   | `pnpm lint`                                                                                                                                     | 0                                       | eslint `--max-warnings=0`                                                                                                                                                                                                                                                             | `13-lint.log`                                                          |
| 7   | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown`                                                      | 0                                       | "All matched files use Prettier code style!" (run before this handback existed; it is re-checked in §8)                                                                                                                                                                               | `14-prettier.log`                                                      |
| 8   | `pnpm openapi:lint`                                                                                                                             | 0                                       | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations`                                                                                                                                                                                                                           | `15-openapi-lint.log`                                                  |
| 9   | `pnpm test` (locale unset), chained with #10 in one background command                                                                          | **not completed**                       | unit-node: 187 files / **2817 passed**. unit-web: **16 failures in 12 files**, all `findBy`/role lookups past their timeout (2 at 20 s) at load average about 28. The chain was then **stopped by the 30-minute background limit** before unit-web finished and before #10 started. | `20-unit-lang-unset.log`                                               |
| 9a  | `npx vitest run --project unit-web <the 12 failed files>` (locale unset)                                                                        | 0                                       | 12 files, **269 passed**: the failures were load timeouts, not regressions. My diff touches no `apps/web` file.                                                                                                                                                                 | `22-unit-web-failed-files-rerun-lang-unset.log`                        |
| 9b  | `npx vitest run --project unit-formula-nocodegen` (locale unset)                                                                                | 0                                       | 3 files, 259 passed, 2 skipped (pre-existing skips in `fuzz.test.ts`)                                                                                                                                                                                                          | `23-unit-formula-nocodegen-lang-unset.log`                             |
| 10a | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-formula-nocodegen`                                                                   | 0                                       | 3 files, 259 passed, 2 skipped                                                                                                                                                                                                                                                 | `24-unit-formula-nocodegen-lang-c-utf8.log`                            |
| 10b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-node`                                                                                | **1**                                   | 187 files, **2817 passed**, 0 failed. The exit code is 1 because of **1 unhandled Vitest infrastructure error**, `[vitest-worker]: Timeout calling "onTaskUpdate"` (worker RPC under load; collect 456 s). It was not a test failure, but the run is not clean. | `25-unit-node-lang-c-utf8.log`                                         |
| 11  | `QA_PG_PORT=28230 MTH_PORT_POOL=28231-28249 tests/qa/support/with-pg.sh pnpm test:integration` (includes `tests/qa/integration`)                 | **1**                                   | **Incomplete:**<br>1. One real failure: `registers.test.ts`, "T03: a gap without a TOM dimension is 422". This was a stale pin of the old behaviour, and is now updated (see 11a).<br>2. Then the Vitest fork died at `kpi/import-target.test.ts` with `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`, so the process was killed (most likely out of memory on the shared host, about 4 GB free). That file's 9 tests were not run and there is no summary line: 42 integration files ran before the crash. | `30-integration.log`                                                   |
| 11a | the 5 touched integration files, including `registers.test.ts` after the update                                                                  | 0                                       | 5 files, **53 passed**                                                                                                                                                                                                                                                         | `31-integration-touched-files.log`                                     |

**Pinned-count change:** route-inventory case 4 went from `{400: 481, 422: 1}` (with 1 pinned deviation) to `{400: 482}` (no pin). The integration test count grows by 5: 4 worker tests and 1 route-inventory test.

## 4. Operations routed (pending-list delta)

None. This repair routes no new operation. `createTomGap` was already routed and exercised, so no `p6-pending-*.ts` or `p6-exercises-*.ts` changes.

## 5. Contract, schema and dependency needs (for the orchestrator)

- No migration, no OpenAPI change and no new dependency.
- `createTomGap` now matches the contract's existing `TomGapCreate` (required `dimensionCode`).

## 6. User-facing texts

This repair made no en/ar string untrue. It makes an existing promise true: the Operations screen's "An exception is opened when a job or connector fails or data becomes stale. Linked KPIs keep their last known value and are labelled Stale." now also holds for a stopped feed while a later period is open.

**For the architect (ADR owner), outside my write scope by D-004 ownership:** ADR-0053 still says the scan reads only the newest period and that the question is "not decided here". This is in `docs/architecture/adr/ADR-0053-p6-operations-service-identities-exceptions-logs-heartbeat.md`, line 79, in the bullet "Not changed by this repair (open …)". That bullet is now untrue. Proposed replacement: "The worker's freshness scan (`kpiFreshness`) uses the same last-known-value rule (T-DG6-BE-Y3, F-DG6-100/140): an empty or Unknown later period does not hide a stale value, so the scan opens the `data_stale` exception." I did not edit the ADR.

## 7. Merge notes

- There are no migrations.
- Possible textual conflicts:
  - `apps/worker/src/handlers/operations.ts`, in `kpiFreshness` and the header comment;
  - `route-inventory.test.ts`, at `REPORTED_DEVIATIONS`, the fingerprint and one new `it` before case 1. Another repair that adds a pin would need to re-add the map entries.

## 8. Final results and what remains

**End time:** `2026-11-01T22:41:49Z` (about 94 minutes).

At about 94 minutes I stopped starting long runs, as the assignment's time rule requires. All of these are done:

- the code and test fixes for every finding in scope;
- the before/after proof for F-DG6-100/140, F-DG6-146 and F-DG6-124;
- typecheck, build, lint, prettier and openapi lint, each exit 0 (typecheck exited 0 only on the concurrency-1 retry; the first run was OOM-killed, exit 137, §3 #4a);
- every touched integration file, green (53/53).

**Acceptance status, stated plainly:**

1. **Static checks:** typecheck (concurrency-1 retry), build, lint, prettier and openapi lint all exit 0. The first parallel `pnpm -r typecheck` was OOM-killed (137, §3 #4a).
2. **`pnpm test`, NOT fully demonstrated as one clean invocation per locale.**
   - **Locale unset:**
     - unit-node 2817/2817 passed;
     - unit-formula-nocodegen 259 passed, 2 skipped;
     - unit-web had 16 load timeouts in 12 files, which all pass on re-run (269/269), but the full unit-web run was stopped by the 30-minute background limit before its summary.
   - **`C.UTF-8`:**
     - unit-node 2817/2817 passed, but exited 1 on one Vitest RPC timeout;
     - unit-formula-nocodegen 259 passed, 2 skipped;
     - **unit-web was not run under `C.UTF-8`.**
   - **What remains:** run `pnpm test` with the locale unset and with `C.UTF-8` on a quieter host.
3. **`with-pg.sh pnpm test:integration`, NOT completed.**
   - The one real failure it found (the stale 422 pin in `registers.test.ts`) is fixed and verified (§3 #11a).
   - The Vitest fork then crashed (`ERR_IPC_CHANNEL_CLOSED`) at `kpi/import-target.test.ts`, which my diff doesn't touch.
   - **What remains:** a complete integration run (including `tests/qa/integration`) on a quieter host, with its counts. If needed, run it sharded (`--shard 1/2`, `--shard 2/2`) on ports 28200–28249.
4. **`node tools/gates/validate.mjs --historical --stage DG5`:** exit 0.

**Separable remainder:** only re-running the checks in items 2 and 3 above. No code item remains open.

**Out of my write scope:** the ADR-0053 line 79 text, for the architect (§6).

Findings F-DG6-100, F-DG6-140, F-DG6-146, F-DG6-124 and F-DG6-145 are repaired, not closed. They close only through the next review round.
- `npx eslint --max-warnings=0 apps/api/test/integration/registers.test.ts` (changed after #6): exit 0 (`16-lint-registers-test-after-update.log`).
