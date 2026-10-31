# Handback T-DG6-BE-X4 (backend-workflow-engineer): pre-freeze repair REQ-S12-019

- **Stage:** DG6 (P6), section `p6-work-split.md` §J/C, row REQ-S12-019 (QA-A2-F1; analyst §4.1).
- **Invocation:** `DG6-T-DG6-BE-X4-backend-workflow-engineer-20261031T041006Z-5b05a641`, session `5b05a641-0a63-432e-9244-a743c41266dc`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-X4.md`, sha256 `28db9572…e02f`; I checked the hash before I started.
- **Branch:** `dg6/be-x4`, worktree `/home/user/wt/dg6-be-x4`, at `HEAD` `701005a40`.
- **Time:** started 04:12:15 UTC, ended 06:17 UTC. That is past the 100-minute mark, because the full integration suite alone took 85 minutes on the shared machine. Every acceptance item ran.
- **No business approval:** nothing here is a business, Finance or IT approval (G1–G6), and nothing touches the DG0–DG7 records. All data is synthetic.

## 0. Starting state (disclosed)

`HEAD` `701005a40` is a WIP commit, "run killed by a machine restart within minutes of start; relaunched". It holds the first draft of this repair in `apps/api/src/modules/operations/exceptions.ts`, from the killed run of this same task.

- I reviewed that draft against ADR-0053 §2, the contract and `kpi-status.ts`, and kept it.
- My only change to it is Prettier formatting, left uncommitted.
- Diff the repair against `701005a40~1`, the integrated base.
- I did not rewrite history.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/operations/exceptions.ts` | The fix, in `linkedKpiStatus` (see §2). Part is in WIP commit `701005a40`; the formatting is uncommitted. Diff vs `701005a40~1`: +45/−23, this one function and its doc comment. |
| `apps/api/test/integration/operations/exception-last-known-value.test.ts` (new) | API integration test against a disposable PostgreSQL that opens a later period (8 tests). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X4-evidence/*.log` | Logs of every check below. |
| this file | The handback. |

What I did not touch:

- No migration (none needed), no route, no OpenAPI or zod change, no dependency.
- No change to the web, the worker or the QA tests. `tests/qa/integration/a17-import-and-integration.test.ts` and `e2e/a17-failing-connector-exception.spec.ts` are unedited.

## 2. Behaviour delivered

**REQ-S12-019.** Acceptance (quoted): *"A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date"*.

**Before.** `GET /api/v1/admin/operations/exceptions/{id}` read each linked KPI's evaluation only from the organization's newest open or closed period of the KPI's frequency. Once a later period was open, the data owner got `freshness "unknown"`, `lastValue null` and `lastValueAt null`.

**After.** `linkedKpiStatus` reads the KPI's latest open or closed period of its frequency whose panel evaluation carries a value.

- **Panel evaluation:** the same per-period read as `kpi/kpi-status.ts` `statusOf` / `latestPeriodEvaluation`. That is scope `transformation`, `value_basis` period, and the highest `calculation_run.seq` of the slot.
- **One lateral SQL query.** The rest is unchanged: `withReadTimeStaleness` from `@mth/shared/calc` (ADR-0028 read-time freshness) with the version's `dq_stale_after_days`, then `lastValueAt` as the start of the data-as-of business date in the organization's zone.
- **The contract's rule:** `lastValue` is "Last known accepted value … null = Unknown (never 0)" (ADR-0053 §2, M0239 "retain last known values with freshness labels").

Unchanged behaviour:

- **Authorization.** An unreadable KPI still only increments `hiddenKpiCount`.
- **The DG4 KPI panel**, whose default period is still the KPI's current period.
- **The worker.** Nothing is written.
- **A KPI with no value in any period** stays Unknown with nulls, never 0.

**What the new test checks** (`exception-last-known-value.test.ts`, 8 tests). The exception is raised by the worker's real `kpi.freshness_scan` → `data.stale` → `operations.exception_raise` jobs.

1. Baseline: Stale, `250.75`, `lastValueAt 2026-01-30T21:00:00.000Z` (2026-01-31, Asia/Riyadh).
2. A later closed period and the current open period, both without an evaluation: still Stale, 250.75 and the date. This is the defect case.
3. Parity: the DG4 panel for the January period gives `250.75`, stale, `2026-01-31`. The panel's default period is unchanged: actual null, never fresh.
4. None of these hides or replaces the value: an Unknown evaluation in the current period, a later **scheduled** period with a value, or another transformation's value.
5. A recalculation of January (higher run seq) gives that run's value, `251.5`.
6. Authorization is unchanged:
   - ADM_ACCESS + ADM_TECH without `transformation.read` gets `linkedKpis []` and `hiddenKpiCount 1`.
   - Another organization's TO gets 404.
7. A value in the current period then becomes the last value, Fresh.
8. A linked KPI whose only evaluations are Unknown gives `unknown`, `null`, `null`.

**Control (mutation check).** I ran the same file against the pre-fix `exceptions.ts` (from `701005a40~1`) and then restored the fix.

- Result: 3 failed, 5 passed (tests 2, 4 and 5 fail).
- Log: `vitest-new-test-against-prefix-code.log`.

## 3. Checks run

Environment: Node 24.21.0 offline, ports 27100–27149. Empty `.claude/.cc-writes` folders were removed before the tests. All logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-X4-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (before implementation) | **0** | `PASS gate DG5 (historical)` | `validate-historical-DG5.log` |
| 2 | `pnpm -r typecheck` | **0** | | `typecheck.log`; after formatting `pnpm --filter @mth/api typecheck` → 0 (`typecheck-api-final.log`) |
| 3 | `pnpm -r build` | **0** | | `build.log` |
| 4 | `pnpm lint` | **0** | Final run after formatting | `lint.log`, `lint-final.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | All matched files use Prettier code style (run last, after this handback was written) | `prettier-check.log` |
| 6 | `pnpm openapi:lint` | **0** | | `openapi-lint.log` |
| 7 | `pnpm test`, locale unset | **0** | unit-node 184 files / 2769 tests; unit-web 120 / 2013; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `test-unit-locale-unset.log` |
| 8a | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (first run) | **1** | Every test passed (same counts as #7), but unit-node reported 1 Vitest **unhandled error**, `[vitest-worker]: Timeout calling "onTaskUpdate"`. See below. | `test-unit-c-utf8.log` |
| 8b | the same, rerun | **0** | 2769 / 2013 / 259 + 2 skipped, no errors | `test-unit-c-utf8-rerun.log` |
| 9 | the new test file under `tests/qa/support/with-pg.sh` | **0** | 8/8 | `vitest-new-test.log` |
| 10 | `with-pg.sh npx vitest run --project integration tests/qa/integration/a17-import-and-integration.test.ts` (unedited) | **0** | 10/10, including "failing connector (REQ-S12-019, A17) …" | `vitest-a17-qa-file.log` |
| 11 | `E2E_PG_PORT=27110 E2E_API_PORT=27111 MTH_PORT_POOL=27112-27149 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a17-failing-connector-exception.spec.ts --workers=1` (unedited) | **0** | 2 passed: chromium-en 22.5 s, chromium-ar 20.4 s | `e2e-a17-failing-connector.log` |
| 12 | `QA_PG_PORT=27120 MTH_PORT_POOL=27121-27149 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 403 files: 400 passed, 3 failed. 4084 tests: 4077 passed, **4 failed**, 1 skipped, 2 todo. 5128 s. See below. | `test-integration.log` |
| 13 | rerun of the 3 failing files under `with-pg.sh` | **1** | `contract.test.ts` 105/105 and `response-validation.test.ts` 113/113 passed; `admin/security.test.ts` 1 failed (deterministic, pre-existing) | `test-integration-rerun-3-files.log` |

**Why #8a exited 1.** That run overlapped with the full integration suite (#12), and unit-node collection took 445 s. The worker RPC timed out. No test failed. The rerun on the quieter machine (#8b) exited 0.

**The four integration failures (#12).** None is in a file or code path this repair touches.

1. **`contract.test.ts` and `response-validation.test.ts` › "every operation: an undeclared request media type is a declared 400 …":** 30 s test timeouts. The suite ran next to `pnpm test` (#7/#8a) and other DG6 agents.
   - In isolation (#13) both files pass in full.
   - Load-induced. I'm disclosing it as a flake under load, not claiming it passed.
2. **`response-validation.test.ts` › "P5 BE-J operations":** `p5-exercises-be-j.ts:61`, dependency slips `expected [] to have a length of 1`.
   - It passed in the isolated rerun (#13).
   - It's a dependency-slip computation, which this change does not touch.
   - It looks non-deterministic under load (F-DG4-143 class). I'm reporting it for the owner of that exercise (P5 BE-J).
3. **`admin/security.test.ts` › "getSecurityRateLimits › ADM_TECH and AUD read every class …":** deterministic, and fails in isolation too.
   - The `webhook` rate-limit class now lists `operationIds: ["receiveWebhook"]`, where the test pins `[]`.
   - The webhook route came with BE-N (`4742b4884`), after the pin was written (BE-E/BE-T history).
   - Pre-existing on the integrated base and outside this task's files (§J/C REQ-S12-019). Changing it would change other behaviour, which the assignment forbids.
   - **For the orchestrator:** the owner of `admin/security.test.ts` / the rate-limit registry (BE-E or BE-N) should update the pin.

**Pinned counts.** I added no operation, media type, JSON-body route, rate-limit class or CSRF exemption. The pinned counts in `contract.test.ts` are unchanged, and it passes in isolation (#13). The integration test count grew by the new file's 8 tests.

### 3.1 Prettier

Exit **0**, "All matched files use Prettier code style!" in every batch. It was run at 06:16 UTC, after this handback, the new test and the formatting of `exceptions.ts` were written (`prettier-check.log`).

## 4. Operations routed (pending-list delta)

**None.** This repair adds no route and changes no operation's request or response shape. There is no `p6-pending-be-x4.ts`, and no other pending list changes. `getOperationalException` was already routed and exercised.

## 5. Contract, schema or dependency needs

None. The fix implements the existing contract text of `linkedKpis[].lastValue` ("Last known accepted value") and ADR-0053 §2. No architect ruling is needed: the ADR already promises the last known value.

**Observation for the orchestrator** (not changed; outside "change no other behaviour"):

- The worker's freshness scan (`apps/worker/src/handlers/operations.ts` `kpiFreshness`) still reads only the organization's newest period of the KPI's frequency.
- So once a later period is open and empty, the scan sees `unknown`, not `stale`. It will not open a *new* `data_stale` exception for a KPI whose last value went stale, although it may still resolve one.
- The connector path of A17 does not depend on it: the exception comes from `connector.run_failed`.
- Whether the scan should use the same last-known-value rule is a decision for the owner of BE-K2 (ADR-0053 §2/§6). I made no change.

## 6. User-facing texts

- `apps/web/src/i18n/en/adminP6.json` `exceptionsIntro` (and its ar twin) says "Linked KPIs keep their last known value and are labelled Stale".
- That statement was untrue at the base and is **true** after this repair.
- No en or ar string became untrue, and none needed changing.

## 7. What remains

- **Nothing in this task's scope.** The REQ-S12-019 row can be re-verified by QA on the frozen candidate: the A17 integration file and the A17 e2e (en, ar) now pass unedited.
- **Outside the scope:** the deterministic `admin/security.test.ts` webhook pin (§3, item 3) and the load-sensitive BE-J and media-type contract checks (items 1–2) need their owners.

## 8. Merge instructions

- No migration.
- Merge `exceptions.ts`, as the WIP commit plus the uncommitted formatting, and the new test file.
- Overlap is possible only if another task edits `linkedKpiStatus` in `apps/api/src/modules/operations/exceptions.ts`.
