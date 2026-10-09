# Handback T-DG4-KBE-R1 (kpi-benefits-engineer): P4 repair scope, items 1–4

- **Stage:** DG4 (BUILDING), task T-DG4-KBE-R1. Assignment `docs/delivery/assignments/DG4/T-DG4-KBE-R1.md` (sha256 `3c30c58f…7cf5`, verified).
- **Invocation:** `DG4-T-DG4-KBE-R1-kpi-benefits-engineer-20261009T210742Z-d234d663`, session `d234d663-5ac8-4493-bb28-3610b1e2dcd2`.
- **Base:** worktree `/home/user/wt/dg4-kbe-r1`, branch `dg4/kbe-r1`, `HEAD` `7aac2ad`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started 21:09:46Z; ended 22:11:24Z (`date -u`).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**. I ran it first, before any edit.
- **Approvals:** no G1–G6 business approval was granted or simulated beyond the existing synthetic test fixtures. Nothing here touches DG0–DG7 records. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/kpi-definitions.ts` | **Item 1.** New exported `createKpiDefinitionRow(tx, audit, input)`: slice A's KPI create service. It does the `kpi_definition` insert, the 409 `duplicate.name` and the `kpi_definition.create` audit event. It also exports the `KpiDefinitionRowInput` type. The `createKpiDefinition` route now calls it. |
| `apps/api/src/modules/kpi/index.ts` | **Item 1.** Exports `createKpiDefinitionRow` and `KpiDefinitionRowInput` from the kpi module boundary. |
| `apps/api/src/modules/kpi/kpi.test.ts` | **Item 1.** The export pin gains `createKpiDefinitionRow` and its arity (3). |
| `apps/api/src/modules/adoption/indicators.ts` | **Item 1.** `createKpiFromTemplate` (used by `createAdoptionMetricLink` with `createKpi`) calls `createKpiDefinitionRow`. The copied insert, audit event and private copy of the audit field list are removed. The pre-check of a taken name and the active-owner check are unchanged. |
| `apps/api/test/integration/kpi-p4/create-service.test.ts` (new) | **Item 1.** A direct byte comparison of the new service against the two pre-R1 inserts (copied verbatim from `7aac2ad`). |
| `apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts` | **Item 2.** `insertFinding` no longer calls `Math.random()`. The new `nextFindingPeriodDay` picks the day after the organization's latest ad-hoc period (first day `2031-01-02`). It reads that day under `reporting_period_guard`'s own advisory lock (730230). |
| `apps/api/test/integration/kpi-p4/fixture-dates.test.ts` (new) | **Item 2.** Proves the fixture is deterministic and unique: sequential calls, 12 concurrent calls, and an existing period that has to be skipped. |
| `apps/worker/src/handlers/kpi.ts` | **Item 3:** `recalculate` records a `failed` run on the last attempt (`JobAttempt`, `isFinalAttempt`, `recalculateAttemptOf`, `RECALCULATE_FAILED_CODE`, `recordFailedRun`). **Item 4, defect found by the new test:** a formula input that the run does not recompute is now bound to its source's value, computed from the source's accepted values (`ensureInput`). The header comment is updated. |
| `apps/worker/test/integration/kpi-recalculate.test.ts` | **Item 3.** Three tests: the final-attempt rule, failure per attempt called directly, and failure through the production worker with pg-boss retries and the dead letter. |
| `apps/worker/test/integration/kpi-period-open-restart.test.ts` (new) | **Item 4.** Kills a real worker process partway through `kpi.reporting_period_open` and restarts it. |
| `apps/worker/test/kpi-period-open-child.ts` (new) | **Item 4.** The child worker process: the production `startWorker` with the real, unchanged period-open handler. |
| `apps/api/test/integration/kpi-p4/formula-recalc.test.ts` (new) | **Item 4.** Recalculates a formula KPI from accepted input actuals, end to end through the API and the worker consumer. |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R1-evidence/*` | Logs (§3). |

I changed no migration, contract, ADR, zod mirror, route, `packages/shared/src/formula/**` (S-9), `tools/**`, `.claude/**` or delivery record.

## 2. Behaviour delivered, per item and requirement row

### Item 1: KPI create service (KBE-F handback item 2; D-105)

- **What changed.** `kpi/index.ts` now exports `createKpiDefinitionRow`. Both `createKpiDefinition` and adoption's `createKpi` path call it, so the module has one insert and one audit event shape.
- **Proof that rows and audit events are byte-identical.**
  - **Existing tests, unchanged.** `adoption/indicators.test.ts` passes 14/14, including "createKpi creates the KPI from the template in the same transaction (is_leading, unit, polarity, owner)" and the 409 `duplicate.name` check. The `kpi/**` DG2 integration suites also pass, in the full run.
  - **Direct comparison** (`create-service.test.ts`, 3/3):
    - The two pre-R1 inserts are reproduced verbatim from `git show 7aac2ad:…` and run on the same input as the service, each in a rolled-back transaction.
    - The test compares the `JSON.stringify` of every column of the returned row, of the stored row and of every audit event. It masks only the generated values: the uuid, the audit `seq`/`id`/`record_id` and the transaction-time timestamps.
    - The route path is checked with a full body and a minimal body. The adoption path is checked with a template body, and the column defaults it relies on still hold (`frequency monthly`, nulls).
    - A taken name gives the same serialised 409 `duplicate.name` problem from all three paths.
- **Rows:** REQ-S16-020. Acceptance: *"A11: the ERD and migrations contain every entity listed (StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"*. Behaviour is unchanged, and the `entity-group-metric-link.test.ts` and `indicators.test.ts` tests pass. The KBE-F handback's FG.3 wording, "slice A's KPI create service", is now literally true.

### Item 2: deterministic fixture dates (BE-C §4.5, BE-M; D-098, D-105)

- **Cause.** The flake was `kbe-b-fixtures.ts:86` drawing `Math.random() * 3000` days. Two calls could land on the same day: "reporting_period: ad_hoc … overlaps another ad_hoc period".
- **Fix.** The day is now the day after the organization's latest ad-hoc period, read inside the insert's transaction under the guard's advisory lock (730230, per organization and frequency). So it is:
  - **deterministic:** a fresh organization gets `2031-01-02`, `-03`, `-04` in call order;
  - **unique per call,** even for concurrent calls.
- **Direct proof** (`fixture-dates.test.ts`, 3/3): sequential calls give exactly those dates; 12 concurrent `insertFinding` calls give 12 distinct consecutive days; an existing `2031-01-02..10` ad-hoc period is skipped (the next day is `2031-01-11`).
- **20-run loop** (`fixture-loop-20x.log`): `data-quality.test.ts` + `fixture-dates.test.ts` + `contract/contract.test.ts` (which runs `p4-exercises-kbe-b.ts`, the other `insertFinding` caller), 20 times against one disposable cluster: **20 iterations, 0 failed**, each 53/53 tests. `LOOP DONE: 20 iterations, 0 failed`, `EXIT=0`.
  - *Disclosure:* the loop ran in the background while I worked on items 3 and 4. During iterations of the loop, `apps/worker/src/handlers/kpi.ts` and new test files changed. The fixture code was final for all 20 iterations (only a Prettier pass touched formatting). The final tree also passed these files once more, in the full integration run (§3).

### Item 3: a failure on the final retry is recorded (KBE-C handback §7.8; ADR-0027 §8 step 4)

- **When the calculation throws,** `recalculate` works out the attempt:
  - the optional `attempt` argument if given;
  - otherwise the job's own `retry_count`/`retry_limit`, read from `pgboss.job` by job id and queue (pg-boss 11; the worker connects as `mth_app`, which already runs pg-boss DML). A failed lookup counts as "not known to be last".
- **On the last attempt** (`retryCount >= retryLimit`, pg-boss's own rule), it writes one `calculation_run` in a separate transaction:
  - `status` `failed`, `error_code` `kpi.recalculate_failed`, which matches the `^[a-z_]+\.[a-z_.]{1,80}$` CHECK;
  - zero evaluations and findings, the trigger and the idempotency key;
  - `ON CONFLICT DO NOTHING` on the unique keys.
  
  It then **rethrows**, so pg-boss still fails the job and the dead-letter queue `ops.failed` keeps it. No audit event is written (system lineage), and the accepted slot is untouched.
- **Earlier attempts** record nothing and rethrow, so pg-boss retries them.
- **A replay** of the dead-lettered job finds the trigger's one run and returns `already_run`, with no second run.
- **Proof** (`kpi-recalculate.test.ts`, 5/5). The failure is forced by a synthetic `BEFORE INSERT` trigger on `kpi_evaluation` that is scoped to the one seeded transformation and dropped afterwards.
  - `isFinalAttempt` follows pg-boss.
  - **Direct calls:** attempts 0/2 and 1/2 → throw, no run. No attempt information → throw, no run. Attempt 2/2 → throw, then exactly one `failed` run with its code, no `kpi_evaluation`, no `kpi.values_recalculated` or `kpi.deviation_evaluated`, no ledger row, no audit event, and the slot still `accepted` with value 1. Another "last attempt" → `already_run`, the same single run. After the fault is removed, a redelivery is a `duplicate` and the run is still the one `failed` run.
  - **Production worker:** queue `retryLimit 1, retryDelay 0`; relay → worker. The job ends `failed` with `retry_count 1 / retry_limit 1`, so the first attempt was retried and the second was last. Exactly one `failed` run exists, and the job is in `ops.failed` (count 1).
- **Rows:** REQ-S16-014 (CalculationRun `completed`, `failed`). REQ-S07-013 (*"accepting one actual produces exactly one calculation run and one audit event; linked dashboards show the new value once"*) is unchanged, and `pipeline.test.ts` passes. On failure the trigger still has exactly one run.

### Item 4a: kill the worker partway through `kpi.reporting_period_open` (KBE-C handback §7, §8)

- **Test** (`kpi-period-open-restart.test.ts`, 1/1; plus 5 more runs in `worker-kpi-tests-5x.log`, 5/5):
  1. One organization has one active monthly KPI with an owner and two due scheduled periods, `2026-01` and `2026-02`.
  2. The parent holds an uncommitted work item with the `2026-02` task's dedupe key. The **real** handler runs in a **real** worker process (`kpi-period-open-child.ts`). It commits `2026-01` (opened, audit event, task, reminder, ledger row), then blocks inside `2026-02`'s transaction, after opening the period and writing its audit event. The test detects the block through `pg_locks`, because `wait_event_type` is not visible to the test role.
  3. Partway through the job, the period-2 row is locked by the child, and committed state is `2026-01` open / `2026-02` scheduled. The child gets `SIGKILL`. The blocker is released: a backend waiting on a lock notices its dead client only once unblocked, then aborts, because no COMMIT can arrive. The committed state is unchanged.
  4. A restarted worker with supervision takes the expired job again. `retry_count ≥ 1`, and the output is `{opened: 1, tasks: 1}`. Each period ends `open`, version 2, with exactly one `reporting_period.open` audit event (actor `service`, source `worker`), one task, one reminder and one ledger row.
  5. A redelivery gives `{opened: 0, tasks: 0}`, and the KPI still has exactly 2 tasks in total.
- **Rows:** REQ-S12-005. Acceptance: *"A13: a period opening creates one task per KPI owner; a worker restart during the run creates no duplicates"*. REQ-S16-005. Acceptance: *"A13: killing the worker mid-job and restarting it completes the job exactly once with no duplicate notification"*. This is now proven for the real period-open handler, not only BE-A's probe.

### Item 4b: a formula KPI recalculated from accepted input actuals, and the defect it found

- **Test** (`formula-recalc.test.ts`, 1/1): `T = a + b` over KPI A (direct accept) and KPI B (review route), monthly, count/lines.
  1. With A accepted (120) only, A's run stores A = 120 and T = Unknown with `kpi.formula_input_unknown`, value NULL. Its RAG is not green.
  2. B is submitted for review but not accepted: no run, and T is unchanged.
  3. B is accepted by the BO reviewer (an in-product actual review, not a G1–G6 approval). B's run computes **T = 150**, with lineage `{formula: "a + b", values: {a: "120", b: "30"}}`. The run stores evaluations of B and T only.
  4. A's accepted correction (value 2 = 125) gives one new run (`duplicate` for slot 1, `done` for slot 2) and **T = 155**. The T status read shows `actual "155"` with that evaluation.
- **Defect found and fixed (my engine, calculation accuracy).** Before this change, step 3 gave T = Unknown, because the handler bound a formula input only to a value **computed in the same run**. A, accepted in an earlier run, was bound as Unknown. So a formula KPI over two separately accepted inputs could **never** compute.
  - **Evidence:** `formula-recalc-against-pre-fix-handler.log` is the new test run against `git show HEAD:apps/worker/src/handlers/kpi.ts`. It gives exit 1 with `value: null, value_status: "unknown"` where `150.000000 / ok` was expected. The fixed handler was then restored and checked with `cmp`.
  - **Fix (`ensureInput`).** A formula input that the run did not compute is evaluated for binding only:
    - it uses the source KPI's slot of the same scope, period and input basis;
    - it uses `evaluateSlot` over the source's **accepted** values, recursively for a formula source (the graph is acyclic, and a depth guard of 32 applies);
    - it is **not stored** as an evaluation and records **no finding**, so the run's rows, counts and outbox events for other KPIs are unchanged.
  - The formula engine (`packages/shared/src/formula/**`) is unchanged (S-9).
- **Rows:** REQ-S07-011 (*"KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected"*). `formulas.test.ts` passes unchanged. REQ-S07-013 and REQ-S12-006 (*"one accepted actual yields one recalculation and one validation flag"*): each acceptance still writes exactly one run.

## 3. Checks (real exit codes; logs in `T-DG4-KBE-R1-evidence/`)

| # | Command | Result |
|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**, `PASS gate DG3 (historical)` |
| 1 | `pnpm -r typecheck` (`typecheck.log`) | **exit 0**. *Disclosed:* the first run gave **exit 2**, with TS1294/TS4111 errors in my new `create-service.test.ts` (a parameter property and index-signature access). I fixed them, and the re-run gave exit 0. |
| 2 | `pnpm -r build` (`build.log`) | **exit 0** |
| 3 | `pnpm lint` (`lint.log`) | **exit 0** |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (`prettier.log`) | **exit 0**, "All matched files use Prettier code style!". *Note:* the worktree shows untracked top-level `.bashrc`, `.mcp.json`, `CLAUDE.local.md`, `.idea`, `.vscode`, etc. They are the sandbox's `/dev/null` character-device bind mounts (`crw-rw-rw- 1,3`), not files of mine, and I left them untouched. |
| 5 | `pnpm openapi:lint` (`openapi-lint.log`) | **exit 0** |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`; `unit-locale-unset.log`) | **exit 0**. Invocation 1: 121 files, **2313 passed**. Invocation 2 (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped**. |
| 7 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` (`unit-c-utf8.log`) | **exit 0**, the same counts: **2313** and **259 + 2 skipped**. This equals the D-108 baseline. No unit test was added; the kpi export pin was edited. |
| 8 | `QA_PG_PORT=24872 MTH_PORT_POOL=24873-24899 tests/qa/support/with-pg.sh pnpm test:integration` (`integration-full.log`) | **exit 0**: 159 files, **1575/1575 passed**, 0 failed, on the first full run. The pinned count changes from 1564 (D-108) to **1575 = 1564 + 11 new tests** (create-service 3, fixture-dates 3, formula-recalc 1, kpi-recalculate +3, kpi-period-open-restart 1). No existing pin was edited. |
| 9 | Fixture loop, 20×, ports 24852/24853-24860 (`fixture-loop-20x.log`) | **20/20 exit 0**, 0 failed |
| 10 | Worker KPI tests 5× (kill-restart + recalculate), ports 24862/24863-24870 (`worker-kpi-tests-5x.log`) | **5/5 exit 0** |
| 11 | New formula test against the pre-fix handler (`formula-recalc-against-pre-fix-handler.log`) | **exit 1, as expected** (the defect is reproduced); the fixed handler was then restored |

- **Disk:** `df -h .` showed 22 GB free before each full run, above the 3 GB stop line (D-104).
- **Locale:** S-8 is covered by checks 6 and 7.
- **Ports:** every port used was in 24850–24899.
- **Iteration runs (disclosed).** While I developed, focused runs failed and I fixed them:
  - `kpi-recalculate.test.ts`, once: my test expected a second "last attempt" to throw, but the handler correctly returns `already_run`, so I corrected the test.
  - `kpi-period-open-restart.test.ts`, three times. The detection used `wait_event_type`, which the role cannot see. The 30 s idle-in-transaction timeout ended the blocker. A `FOR UPDATE` with `count(*)` was invalid SQL. Kill-then-wait deadlocked, because a blocked backend does not notice a dead client.
  - `formula-recalc.test.ts`, three times: the accept response shape; then the real engine defect of item 4b; then my lineage assertion, which I aligned with the stored shape.

## 4. Operations routed, media types and the pending list

- **Operations routed:** none. No route was added or changed. **Delta to my `p4-pending-*` lists: none.** `contract.test.ts` passes, and runs in the 20× loop.
- **Media-type pin:** no JSON request body was added, so the delta is **0**.

## 5. Contract, schema and cross-team needs (for the orchestrator)

1. **No migration and no schema change.** `calculation_run` already allows `failed` with `error_code`.
2. **Attempt count (design choice; please confirm).** The shared `JobHandler` interface (`apps/worker/src/handlers/spec.ts`, BE-A) passes only `(db, data, jobId)`. To stay within my files, the kpi handler reads `retry_count`/`retry_limit` from `pgboss.job` by id. This couples it to the pg-boss 11 job table (schema `pgboss`).
   - **Cleaner alternative, outside my ownership:** `worker.ts` calls `boss.work(…, { includeMetadata: true }, …)` and passes `{ retryCount, retryLimit }` as a fourth argument to `handle`.
   - `recalculate` already accepts that optional `attempt` argument and then skips the lookup. No other change would be needed in kpi.ts.
3. **Formula lineage gap (not changed).** A formula evaluation's `inputs` stores `{formula, values{var: value}}`, but not the source KPI ids, accepted actual ids or value numbers. My role's lineage rule asks for the input actuals. Changing the stored shape could affect `loadKpiStatusLineage` and the status contract, so I left it for an ARCH-R1 or contract decision.
4. **ADR-0027 §8 step 4** reads "after the last attempt the handler writes a `failed` run with its `error_code`". The code now does this. The concrete code `kpi.recalculate_failed` is not listed in the ADR. If the reviewers require it there, ARCH-R1 owns that text.

## 6. What remains

- **All four repair items are done and tested.**
- **Open for the orchestrator or ARCH-R1:** §5.2 (where the attempt count comes from), §5.3 (formula lineage of source actuals) and §5.4 (the ADR listing of `kpi.recalculate_failed`).
- **Not attempted:** the transformation-scoped reporting-period read and any contract or ADR change are ARCH-R1's, per the assignment.

## 7. Merge instructions

- No migration and no ordering constraint.
- **Possible textual conflicts:**
  - `apps/worker/src/handlers/kpi.ts` (only KBE edits it);
  - `apps/api/src/modules/kpi/index.ts` (append-only export lines at the end);
  - `apps/api/src/modules/kpi/kpi.test.ts` (one pin line);
  - `apps/api/src/modules/adoption/indicators.ts`. BE-R1 or FE-C might touch it; in my diff, only `createKpiFromTemplate`, the import list and one header paragraph change.
- After merging, re-run `pnpm test:integration`. Expected integration delta: **+11 tests** (create-service 3, fixture-dates 3, formula-recalc 1, kpi-recalculate +3, kpi-period-open-restart 1) and **+4 files**.
