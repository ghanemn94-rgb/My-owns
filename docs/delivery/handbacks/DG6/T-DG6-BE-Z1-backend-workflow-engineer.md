# Handback T-DG6-BE-Z1 (backend-workflow-engineer): F-DG6-180 (High) and F-DG6-200 (Low)

- **Stage:** DG6 (P6), FIXING after review round 2. Invocation `DG6-T-DG6-BE-Z1-backend-workflow-engineer-20261103T232628Z-e7116b75` (session `e7116b75-50c7-4e34-b95e-0d4ba460fee2`).
- **Base:** branch `dg6/be-z1` at `6dd7f101d349453ca96df7aa5c59d6e7a4bec90f`. The tree was clean at the start.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z1.md` (sha256 `3de2719e…ec9ed3`, verified).
- **Time:** started `2026-11-03T23:30:21Z`, ended `2026-11-04T00:06Z` (about 36 minutes).
- **State:** changes are left **uncommitted** for the orchestrator.
- **Approvals:** none. No product gate (G1–G6), Finance or IT approval was granted. Nothing here touches DG0–DG7, and all test data is synthetic.

## Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` printed `PASS gate DG5 (historical)` and exited 0, both at the start and at the end. Logs: `T-DG6-BE-Z1-evidence/00a-validate-dg5-historical-start.log` and `17-validate-dg5-historical-end.log`.

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts` | Adds a third `ChildSource` kind, `via`: a row that names no owner itself, but is named by a child row. Registers `benefit_calculation` as a `via` source through `benefit_measurement.benefit_calculation_id → benefit_id`. Adds `viaOwners()`. |
| `apps/api/src/modules/kpi/calculations.ts` | `GET …/calculations` now filters the page through `withoutRestricted`. This is the established list pattern (`benefits/overlaps.ts`, T-DG6-BE-Y1). The header comment is updated. |
| `apps/api/test/integration/access/sensitive-reach-calculations.test.ts` (new) | Ports the reviewer's P-CALC reproduction onto the product fixtures (5 tests: negative and positive). |
| `apps/api/test/integration/reporting/exports-assembly.test.ts` | The 0125 guard test now waits on a blocking row lock for the refused UPDATE's transaction before it calls `step` (F-DG6-200 (1)). |
| `apps/api/test/integration/workflows/change-requests-in-tx.test.ts` | `auditXmin` now orders its rows by `occurred_at, seq` before callers index them (F-DG6-200 (2)). |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z1-*` | This handback and its logs. |

- **Migrations:** none.
- **API endpoints added:** none. Behaviour changed on the existing `GET /api/v1/benefit-formulas/{benefitFormulaId}/versions/{versionNo}/calculations` (`listBenefitCalculations`).

## Behaviour delivered

### REQ-S10-002: F-DG6-180 (High, mandatory)

Acceptance text, quoted: *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the gra[nt]"*.

**The rule (ADR-0051 §2).** A `benefit_calculation` row that a `benefit_measurement` references is now a child of that measurement's benefit.

- When the benefit is marked sensitive and the caller is not admitted, `listBenefitCalculations` leaves the row out of the list.
- The list still answers 200. It does not answer 403, and the response carries no count field.
- Admission follows the existing §2 clause: an active grant, a named party, or `sensitive_record.grant` at the transformation.

**Which rows have no owner.** A stand-alone T09 calculation (`POST …/calculations`) is never referenced by a measurement. It has no sensitive owner and stays listed. If a referenced row is missing, the helper treats it as unresolved and fails closed. The lineage is append-only, so this case is not expected.

**Pagination disclosure.** As in the overlaps list, the filter runs after pagination. A page can therefore hold fewer than `limit` items while `nextCursor` is non-null. This matches the established BE-Y1 pattern. I did not change it.

**Other routes that use the helper.** `restrictedRecordRefs` keys on the audit `record_type`. Both audit routes (`/transformations/{t}/audit` and `/audit-events`) therefore also redact any `benefit_calculation` event whose row belongs to a sensitive measurement. At HEAD only stand-alone calculations write a `benefit_calculation.create` event. The measurement path (`measurements.ts:insertCalculation`) and the worker (`handlers/benefits.ts`) write none. So nothing visible changes there today. The rule simply covers it.

**The sweep.**

- `benefit_calculation`: `grep` over `apps/api/src`, `apps/worker/src` and `packages` finds it read only by `kpi/calculations.ts` (the list) and written by `measurements.ts` and the worker. Search, exports, the assistant and the report assemblers do not read it. No route reads a single calculation: the `Location` of the POST has no GET route.
- `benefit_measurement_input`, the other measurement child that is not in `SENSITIVE_CHILD_SOURCES`: it is read only by `inputsOf()` → `presentMeasurements()`, under the benefit's own measurement routes. Those routes already answer 404 through `readBenefitRow` and the `benefitMeasurementId` guard. No other route returns it.
- An FK sweep of the migrations found no other uncovered table that carries a benefit's or business case's value. The rows that only reference evidence (diagnostic outputs, gate dispensations and others) fall under ADR-0051 §4, not §2.
- Business-case lines store no calculation lineage. `business_case_line` has `benefit_formula_id` and no `benefit_calculation` reference. The finding's "if its lineage is stored in the same table" case therefore does not exist.

**The test** (`access/sensitive-reach-calculations.test.ts`). Two benefits are measured through the same formula version. TL also adds one stand-alone calculation. Pages use `limit=2`, so the filter runs across cursor pages.

- Before marking: TL and AUD list all 3 rows.
- After a TO marks one benefit sensitive:
  - TL and AUD get 404 on the benefit.
  - **P-CALC:** TL and AUD list 200 without the sensitive row. Exactly the plain row and the stand-alone row remain, with their values.
- Positive: the TO and the owner (BO, a named party) list all 3, with inputs and result.
- After an explicit grant, TL lists the row again, while AUD still does not.

**Fails before, passes after.**

- With the two source files reverted to HEAD (`00-calc-test-before-fix.log`), 2 tests fail. P-CALC fails with `expected { …(18) } to be undefined`, the reviewer's exact symptom. The AUD-without-grant check fails as well.
- With the fix (`01-calc-test-after.log`), 5/5 pass.

### REQ-DLV-038: F-DG6-200 (Low)

Acceptance text, quoted: *"Implementers harden the system; reviewers verify applicable A01-A22 checks, authorization boundaries, malformed and duplicate input, concurrency and failure recovery, realistic load, …"*.

Both assertions are unchanged. Neither test retries or sleeps.

**(1) The 0125 guard test** (`exports-assembly.test.ts`).

- **The fix.** After the refused UPDATE, the test runs `SELECT id FROM export_job WHERE id = $1 FOR UPDATE` (owner pool, auto-commit). This blocks on the aborting transaction itself until it has released the row, then releases its own lock at statement end. The test then asserts `step([job]) → [{ outcome: "assembled" }]` exactly as before.
- **Repeated 40 times:** the probe file is kept as `zz-z1-guard-repeat.test.ts.txt`.
  - "fixed" variant: 0/40 misses unloaded (`02`), 0/40 with 8 CPU spinners (`03`), and 0/40 on each of 3 parallel clusters with 16 spinners at load average about 19.7 on 4 vCPU (`04-…-1/2/3`).
- **Honest note.** The un-fixed control ("as-is") also gave 0/40 in every run on this host. I could not reproduce the reviewer's 5/40 window, which needs a sub-millisecond abort interval.
- **Mechanism probe** (`05-guard-mechanism-probe.log`). Since the control never missed, I added a deterministic probe. A held row lock stands in for the aborting UPDATE:
  - `step` then returns `[]`, which is the reviewer's symptom;
  - the blocking `FOR UPDATE` stays pending for 300 ms while the lock is held;
  - it returns only after the holder rolls back;
  - `step` then assembles the job.

  This shows that the wait closes exactly the window the finding describes.

**(2) `change-requests-in-tx`.**

- **The fix.** `auditXmin` orders by `occurred_at, seq`. The two `change_request.submit` rows come from different transactions, and `seq` is the insertion identity used as the tie-break. Index `[1]` is now the round-2 submit by construction.
- **Repeated 40 times:** probe `zz-z1-xmin-repeat.test.ts.txt`.
  - 0/40 misses in every run.
  - Under the heavy load of `04-…-1/2/3`, the unordered heap order differed from the ordered result in **40 of 40** iterations on each cluster. The old indexing would have failed every time, and the ordered helper stayed correct.

## Checks run

All checks ran on Node 24.21.0, offline, with PostgreSQL 16.15 through `tests/qa/support/with-pg.sh` (disposable cluster, ports 28900–28912). The logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-Z1-evidence/`.

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | 0 / 0 | `PASS gate DG5 (historical)` | `00a-…`, `17-…` |
| New test with the source reverted to HEAD | **1 (expected)** | 2 failed, 3 passed (5) | `00-calc-test-before-fix.log` |
| New test with the fix | 0 | 5/5 passed | `01-calc-test-after.log` |
| Repeat probes, unloaded | 0 | 27/27; guard fixed 0/40 (control 0/40); xmin 0/40 | `02-repeat-probes.log` |
| Repeat probes, 8 spinners | 0 | 27/27; the same counts | `03-repeat-probes-under-load.log` |
| Repeat probes, 3 parallel clusters and 16 spinners | 0 ×3 | 27/27 each; guard 0/40 (control 0/40); xmin 0/40 with heap order swapped 40/40 | `04-repeat-probes-heavy-load-{1,2,3}.log` |
| Mechanism probe (`-t`) | 0 | 1 passed, 20 skipped | `05-guard-mechanism-probe.log` |
| Integration, touched suites (see below) | 0 | **39 files; 387 passed, 1 todo (388)** | `06-integration-touched.log` |
| Integration after the prettier reformat: `access/` and `kpi/benefit-formulas` | 0 | 7 files; 75 passed | `07-access-final-bytes.log` |
| `pnpm -r typecheck` | 0 | all packages done | `10-typecheck.log` |
| `pnpm lint` (`eslint . --max-warnings=0`) | 0 | clean | `11-lint.log` |
| `pnpm -r build` | 0 | all packages done | `12-build.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (first run) | **123** | `sensitive-reach.ts` not formatted (one long line) | `13a-prettier-first-run-exit123.log` |
| The same, after `prettier --write` on that file | 0 | all formatted | `13-prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit-node 189 files / 2851; unit-web 120 / 2020; unit-formula-nocodegen 3 / 259 passed + 2 skipped | `15-…` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same: 2851; 2020; 259 + 2 skipped | `16-…` |

**Disclosures.**

- **Prettier.** The first prettier check exited 123 on my own new code. A formatting-only rewrite fixed it, and the check was re-run (exit 0).
- **Integration and the reformat.** The touched-suite integration run (`06`) ran before that reformat. Typecheck, lint and build were re-run after it (exit 0), and so were the access and formula suites (`07`).
- **Not run here.** The full `pnpm test:integration` was not run, as the assignment allows. The orchestrator runs it on the merged tree.

**The `06` file set:** `reporting/exports*` (3 files), `workflows/change-requests*` (3), every `kpi/*.test.ts` (8), every `benefits/*.test.ts` (16), every `access/*.test.ts` (6, including the new one), every `audit/*.test.ts`, `p6-guard-mapping.test.ts` and `tests/qa/integration/a12-p6-scope-isolation.test.ts`. The exact list is on line 1 of the log.

## Operations routed (pending-list delta)

None. No operation was added, routed or moved. My `p6-pending-*` and `p6-exercises-*` lists are unchanged.

## For the orchestrator: contract, schema and dependency needs

- **No schema, zod, OpenAPI or migration change, and no new dependency.** The response shape is unchanged.
- **Optional contract wording, for the contract owner.** `listBenefitCalculations`' `200` description says "Page, newest first." It could add: "A lineage row of a measurement of a sensitive benefit the caller is not admitted to is absent (ADR-0051 §2)." I left `docs/api/openapi.yaml` untouched, because the current text is not untrue.

## User-facing texts made untrue

None. The change is server-side filtering. No en or ar string describes the calculation list's visibility.

## What remains

- **F-DG6-180 and F-DG6-200:** nothing in the assigned scope. Both stay OPEN until a non-author reviewer verifies them (code-security-reviewer for F-DG6-180, qa-verifier for F-DG6-200).
- **The guard race on this host:** the un-fixed control never missed, so the 40× evidence for the guard test is "0 misses with the fix" plus the deterministic mechanism probe, not a before/after miss count.
- **Evidence probes are not product tests.** The two `.txt` probe files are evidence copies and are not in the test tree.

## Merge instructions

There are no migrations, and the merge has no ordering constraints.

- `sensitive-reach.ts` is a shared helper. A concurrent edit to `SENSITIVE_CHILD_SOURCES` or `sensitiveOwnersOf` would conflict additively: keep both sides.
- The `via` branch in `sensitiveOwnersOf` must stay before the `column`/`pair` SQL.
