# Handback T-DG6-BE-X6 (backend-workflow-engineer): the load-sensitive P5 BE-J dependency-slip exercise

- **Stage:** P6, gate DG6 (BUILDING). Pre-freeze repair. **Branch/tree:** `dg6/be-x6` in `/home/user/wt/dg6-be-x6`, base `HEAD` `efd4107c9fbecc760dd265e10ca421417bd94bfe`. The tree was clean at the start. The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-X6-backend-workflow-engineer-20261031T114916Z-ae230185","session_id":"ae230185-341c-4565-bf7a-be53d707f1dc"}`. Assignment sha256 `f6b682b1…bcda`, verified.
- **Time:** started `Sat Oct 31 11:49:32 UTC 2026`, ended `Sat Oct 31 13:46:31 UTC 2026` (about 1 h 57 min).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → **exit 0** (`PASS gate DG5 (historical)`).
- **Nothing here is a business approval.** The configuration review in the moved test is a synthetic demo action by a test person. No G1–G6 or DG0–DG7 record is read or written.

## 1. Root cause: confirmed, with one correction to the hypothesis

**Confirmed: a shared starter-rule threshold bleeds between suites.**
- `slip-events.ts` `minimumSlipDays(tx)` reads starter 9's effective `parameters` by `code` (`starter.dependency_slip`).
- `apps/api/test/integration/automation/starters-be-j.test.ts`, describe "REQ-S12-012: a slip below the configured minimumSlipDays raises nothing (starter 9 version 2)", **published** version 2 with `minimumSlipDays: 7` on the **run's shared database** and never restored it. Its own comment said "for this test database", which assumes a per-file database. There isn't one.
- From then on, every 5-day slip in a later file records nothing. That is exactly `p5-exercises-be-j.ts:61`, `expected [] to have a length of 1 but got +0`.

**Correction: the files don't run "at the same time".** The `integration` project runs every file one after another in a single fork (`vitest.config.ts`: `pool: "forks"`, `singleFork: true`, `fileParallelism: false`). The bleed is therefore **order-dependent**, not concurrent:
- `contract/response-validation.test.ts` fails whenever it runs after `starters-be-j.test.ts`.
- Vitest's sequencer orders files by cached duration and earlier failures, so that order changes between runs and machines. This explains "only in full runs, never alone".
- Load matters only because it changes the durations that drive the order.

The other suite named in the hypothesis does not leak. `automation-rules.test.ts` (REQ-S12-002) sets `minimumSlipDays: 3` only on a **draft** and discards it in `finally`; the effective version is unchanged. A grep of `apps/api/test` and `tests/qa` for suites that publish a starter version finds only `starters-be-j.test.ts`. (`cutoff-pack.test.ts` publishes agenda items, not rules.)

**Deterministic reproduction, before the fix** (`repro-before.log`):
- Command: `QA_PG_PORT=27400 MTH_PORT_POOL=27401-27449 tests/qa/support/with-pg.sh npx vitest run --project integration --sequence.shuffle=false apps/api/test/integration/automation/starters-be-j.test.ts apps/api/test/integration/contract/response-validation.test.ts`
- Result: **exit 1**, Tests 1 failed | 121 passed (122).
- The failure is the reported one: `× … P5 BE-J operations (p5-exercises-be-j.ts)`, `AssertionError: expected [] to have a length of 1 but got +0`, `❯ exerciseP5BeJOperations apps/api/test/integration/contract/p5-exercises-be-j.ts:61:27`.

**Not a date bomb.** FE-X3 addendum 2 suspected one, unverified. The milestone dates (`2026-11-01`, `2026-11-06`, `2026-12-01`) and the launch date `2026-10-01` don't change the result, for two reasons:
- Detection compares the changed milestone's dates before and after the write. It never reads today: there is no `current_date`, `now()` or `new Date()` in `slip-events.ts`, `schedule.ts` or `schedule-network.ts`, or in the milestone date path of `milestones.ts` (`now()` there only stamps `approved_at`).
- No migration trigger on `milestone` compares with `current_date`. `forecastDate` is a plain `businessDate` with no range, and `launchPlan.startDate` `2026-10-01` is already in the past today and is accepted.

So the fixed dates were kept, with a comment saying why. The reproduction above fails the same way with these dates, and passes once the leak is removed.

## 2. Is reading a shared rule by `code` right in a multi-organization deployment?

**Yes, by design. The product is unchanged.**
- **ADR-0044 §1:** `0075` seeds one `automation_rule` per starter with `origin = 'starter'`, `scope_level = 'platform'`, and only its declared `parameters` change in a new version (table row 9: `minimumSlipDays`, integer 1–90, default 1).
- **The database enforces this:**
  - `automation_rule_origin_shape`: a starter is `scope_level = 'platform'`;
  - `automation_rule_scope_complete`: platform ⇒ `organization_id IS NULL`;
  - `automation_rule_code_key UNIQUE (code)`: exactly one row per code across the platform, so no organization-scope admin rule can take the starter's code (`0074_p5_automation_engine.sql:80–88`).
- **ADR-0044 §7** defines a slip as a move "by at least `minimumSlipDays` calendar days", with no per-organization variant.
- **The worker resolves the same platform row by code** (`apps/worker/src/automation/starters.ts:173`, `withStarterRule`). The API's detection and the worker's execution therefore always agree on one threshold.

The threshold is a platform-wide setting owned by ADM_METHOD.
- A per-organization threshold would be a new feature (an organization-scope override of a starter's parameters). That needs an ADR-0044 amendment, which is out of scope for this repair. It is listed in §8 for the orchestrator, not as a defect.
- Reading by `code` returns that single row. Adding an `organization_id` filter would find nothing.

## 3. The repair (two independent halves; each one alone fixes the failure)

1. **No suite leaks starter 9's parameter any more.** The describe that publishes `minimumSlipDays: 7` now runs on its **own scratch database**: `createScratchDatabase` → `migrate` → `startApi({ database })` → `seedWorld`, then `close` and `dropScratchDatabase` in `afterAll`. This is the `scoring-defaults.test.ts` pattern for suites that change shared seeded configuration.
   - The run database's starter 9 is never changed, at any point in the run.
   - This is cleaner than restoring the value afterwards. A restore needs another full author → review → publish cycle (version 3), which leaves two extra versions and their audit events on the shared rule, and it depends on a `finally` running before the next file starts. The scratch database never touches the shared rule at all.
   - The assertions are unchanged: 5-day → 0 slips; +8 → `[{ slip_days: 8, critical_reason: "critical_path" }]`.
2. **The exercise no longer depends on the threshold.** `p5-exercises-be-j.ts` moves A's milestone **90 days** (`2026-11-01` → `2027-01-30`) and asserts `slipDays: 90`.
   - 90 is the largest `minimumSlipDays` any starter 9 version can hold: `packages/shared/src/schemas/automation.ts:168` `z.number().int().min(1).max(90)`, ADR-0044 §1. So the move is a slip under every valid configuration, whatever another suite publishes.
   - The exercise's purpose is the contract of `listDependencySlips` (200, AUD 200, 400, 401, 404 through the validating client), and that is unchanged.
   - REQ-S12-012's literal "5-day slip" stays proven by `starters-be-j.test.ts` "REQ-S12-012: a 5-day slip …", which still runs on the run database at the default threshold, now that nothing raises it.

**Each half alone fixes the pair:**

| Run | Command (ports 27400/27401–27449) | Exit | Result | Log |
|---|---|---|---|---|
| before | the two files, base tree | 1 | 1 failed / 121 passed (the reported failure) | `repro-before.log` |
| after (both halves) | the two files, repaired tree | 0 | 122 passed | `repro-after.log` |
| control: old leaking `starters-be-j.test.ts` + new exercise | `git show HEAD:<starters-be-j>` restored temporarily, then the repaired file put back | 0 | 122 passed | `control-old-starters-new-exercise.log` |

## 4. Files changed

| File | Purpose |
|---|---|
| `apps/api/test/integration/automation/starters-be-j.test.ts` | The starter 9 v2 (`minimumSlipDays` 7) describe runs on its own migrated scratch database (local `api`/`w`/`send`, `beforeAll`/`afterAll`), with a comment naming the leak. Imports `migrate`, `inject`, `createScratchDatabase`, `dropScratchDatabase` and `roleUrl`. |
| `apps/api/test/integration/contract/p5-exercises-be-j.ts` | A 90-day slip (the maximum threshold) instead of 5, with `slipDays: 90`. A comment explains the independence and why the fixed dates are safe. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X6-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-X6-evidence/*.log` | The logs cited here. |

There is no product, API, worker, schema, contract or migration change. No migration was needed, and no migration id is taken.

## 5. Behaviour per requirement row

The assignment names no requirement row, and the section it cites ("`p6-work-split.md` pre-freeze repair: a load-sensitive contract exercise") **does not exist** in `docs/architecture/p6-work-split.md` (its sections are §1, §2, §E/F, §J/C, §B/A, §H/G, §D and §I/K). This discrepancy is flagged per the agent protocol. I worked from the assignment text, §2's shared rules (13: deterministic tests; 16: contract seams; 18: migrations; 20: clones, not worktrees), and the row the tests prove:

- **REQ-S12-012**, acceptance: *"A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic"*.
  - No behaviour changes.
  - The 5-day proof (`starters-be-j.test.ts`, "REQ-S12-012: a 5-day slip …") runs on the run database at the default threshold, and it passed in both full runs (§6).
  - The configured-threshold proof (a 5-day slip below `minimumSlipDays` 7 raises nothing, an 8-day slip raises one) now runs on its own database, so its configuration can't change another file's result.

## 6. Checks (real exit codes; logs in `T-DG6-BE-X6-evidence/`)

Environment for every check: Node 24.21.0, offline, this worktree, a disposable PostgreSQL per run through `tests/qa/support/with-pg.sh`, ports in 27400–27449. Empty `.claude/.cc-writes` directories in source folders: none found before the tests.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | **0** | `PASS gate DG5 (historical)` | (console) |
| 2 | `pnpm -r typecheck` | **0** | | `pnpm--r-typecheck.log` |
| 3 | `pnpm -r build` | **0** | | `pnpm--r-build.log` |
| 4 | `pnpm lint` | **0** | | `pnpm-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (run before this handback was written; re-run after it, see the last row) | `prettier-check.log` |
| 6 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `pnpm-openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | **0** | unit-node 186 files / **2801** passed; unit-web 120 / **2015** passed; unit-formula-nocodegen 3 / **259** passed + 2 skipped (`fuzz.test.ts` `it.skipIf(NOCODEGEN)`, by design, pre-existing) | `pnpm-test-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | identical: 2801 / 2015 / 259 + 2 skipped | `pnpm-test-c-utf8.log` |
| 9 | the two-file reproduction, before / after / control (§3) | 1 / **0** / **0** | 121 + **1 failed** (the reported one) / 122 / 122 | `repro-before.log`, `repro-after.log`, `control-old-starters-new-exercise.log` |
| 10 | **Full run 1:** `QA_PG_PORT=27410 MTH_PORT_POOL=27411-27449 tests/qa/support/with-pg.sh pnpm test:integration` | **killed (no exit code)** | **Incomplete, not a pass.** I started it in the background with a 1-hour limit; the run needs about 59–65 minutes under this load, and **the tool killed it at that limit** (13:33 UTC) after **404 of 406 files: 404 passed, 0 failed** (4110 passed + 3 skipped/todo in those files; no Vitest summary was printed). In this run `starters-be-j.test.ts` (log line 693) ran **before** `response-validation.test.ts` (line 883), the order that failed before the repair, and both passed (`response-validation.test.ts` 113 tests; "932 of 932 live operations"). | `integration-run1.log` |
| 10b | the 2 files run 1 did not reach (`portfolio/unpaged-lists.test.ts`, `text-scan/ui-strings.test.ts`), `QA_PG_PORT=27420 MTH_PORT_POOL=27421-27429 tests/qa/support/with-pg.sh npx vitest run --project integration <the two files>` | **0** | 2 files, 9 passed. Run 1 + 10b cover all 406 files with 0 failures, but they are **not one full run**. | `integration-run1-remaining-2-files.log` |
| 11 | **Full run 2:** `QA_PG_PORT=27401 MTH_PORT_POOL=27402-27409 tests/qa/support/with-pg.sh pnpm test:integration` (ran in parallel with run 1 on its own cluster and disjoint ports, i.e. loaded; load average ~1.7–3 on 4 CPUs) | **1** | Test Files 1 failed / 405 passed (406); Tests **2 failed** / 4117 passed / 1 skipped / 2 todo (4122); 3518.9 s. **The repaired exercise passed** ("P5 BE-J operations (p5-exercises-be-j.ts) 540ms"), and so did `starters-be-j.test.ts` (9). **The 2 failures are a different, pre-existing, non-deterministic product defect**, in `tests/qa/integration/a20-p6-register-1000.test.ts` (REQ-S15-013, qa-verifier's A20): paging `GET /initiatives` without `sort` returned 998 and 999 of 1,000 initiatives (`:71` and `:101`). The same file passed in run 1 (4 tests). Root cause in §6.1. | `integration-run2.log` |

**Pinned-count change: none.** `contract.test.ts` and `response-validation.test.ts` report 932 of 932 live operations, with 0 pending excluded.

### 6.1 Run 2's failure: a millisecond cursor over microsecond timestamps (outside this task; for the orchestrator)

Not repaired here, because it is outside BE-X6's scope and the time limit.
- **Where:** `apps/api/src/modules/portfolio/initiatives.ts:299–311`, the path when `sort` is absent ("exactly as at DG5"). It orders by `updated_at desc, id desc`, but encodes the cursor as `r.updated_at.toISOString()`.
- **Why rows go missing:**
  - A JavaScript `Date` keeps **milliseconds**, while `updated_at` is a microsecond `timestamptz`.
  - The next page's predicate is `updated_at < <ms value> OR (updated_at = <ms value> AND id < …)`.
  - That predicate **skips every row whose `updated_at` falls between the truncated millisecond and the boundary row's real microsecond value**, that is, rows written in the same millisecond as a page's last row.
  - A20 inserts its 1,000 rows sequentially and fast, so how many share a millisecond depends on host speed. That's why it passes and fails across runs.
- **Contrast:** the `sort` path in the same file already keeps "timestamps to the microsecond" in the cursor (`:176`).
- **The same pattern** (`paginate(…, r.<timestamp>.toISOString() …)`) appears at **17 call sites in 13 modules**:
  - `workflows/t08-dependencies.ts`;
  - `kpi/business-cases.ts`, `kpi/benefit-formulas.ts`, `kpi/calculations.ts`;
  - `portfolio/selections.ts`, `initiatives.ts`, `resource-demands.ts`, `overrides.ts`, `dispensations.ts`, `funding.ts`;
  - `integrations/routes.ts`, `procedures/instances.ts`, `forms/drafts.ts`.
- **Severity:** I propose **High**, with `mandatory_violation` true: a paginated register silently omits records (REQ-S15-013, data integrity). The fix belongs to the owners of those modules. Either carry the microsecond text in the cursor (`to_char(updated_at, …)` / `updated_at::text`, as the `sort` path does), or compare with `date_trunc('milliseconds', updated_at)` on both sides.

| last | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after this handback) | **0** ("All matched files use Prettier code style!"); `pnpm lint` re-run after it: **0** | | (console) |

## 7. Operations routed (delta to the pending list)

**None.** BE-X6 routes no operation and has no `p6-pending-*.ts` list. `contract.test.ts`'s pinned counts (operations 932 per `openapi:lint`, media types, rate-limit floor, CSRF-exempt routes) are unchanged. **The pinned-count delta is 0.**

## 8. For the orchestrator (contract, schema, dependency)

- **No contract, schema or dependency need.**
- **Observation (not a defect):** starter thresholds such as `minimumSlipDays` and starter 1's `roleTaskDueWorkingDays` are platform-wide by ADR-0044 §1. If Mobily needs per-organization starter settings in a multi-organization deployment, that is an ADR-0044 amendment (an organization-scope parameter override, resolved by both `slip-events.ts` and `withStarterRule`). It is not a P6 repair.
- **The test pattern for the reviewers:** a suite that publishes a new effective version of any **shared seeded rule** (starters, `scoring-defaults`) must use its own scratch database. That way the run order, which Vitest changes between runs, can never change another file's result.

## 9. User-facing texts made untrue

None. No en/ar string or screen changed, and none describes this behaviour as planned.

## 10. What remains

1. **A second complete, green full integration run has not been shown.** Run 1 was killed by my own 1-hour background limit after 404 of 406 files, with 0 failures; the remaining 2 files passed separately. Run 2 completed, but it failed on A20 (§6.1), a defect that is not this task's.
   - Both runs prove the repaired exercise: it passed in both, including after `starters-be-j.test.ts` in run 1.
   - Neither is a whole-suite exit 0. The orchestrator's next full run is needed, and it can only be green once §6.1 is fixed or A20's run happens not to hit a same-millisecond page boundary.
   - I stopped here because of the 2-hour limit (started 11:49:32Z; the runs ended at 13:33 and 13:43).
2. **§6.1** (the millisecond cursor, 17 call sites), for the orchestrator to allocate.
3. **The assignment's section reference** ("`p6-work-split.md` pre-freeze repair …") names a section that does not exist in `p6-work-split.md` (§5). The orchestrator may want to add it, or correct the reference.
