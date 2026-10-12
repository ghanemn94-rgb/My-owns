# Handback T-DG4-FE-R8: frontend-ux-engineer (DG4 round-4 finding repairs F-DG4-143, F-DG4-144)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-R8-frontend-ux-engineer-20261012T005733Z-cb2ac100","session_id":"cb2ac100-6437-49cb-a4e0-850d8631db53"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R8.md` (sha256 `f83b2245…77d9f`, verified).
- **Base:** branch `dg4/fe-r8`, HEAD `b160a40`. Worktree `/home/user/wt/dg4-fe-r8`.
- **Time:** started `2026-10-12T00:57:44Z`, ended at about `02:25Z`, roughly 88 minutes.
- **Changes:** left **uncommitted**. File ownership `apps/web/**` only, plus this handback and its evidence.
- **Approvals:** no product gate (G1–G6) was decided, and none implies an engineering gate (DG0–DG7). All data is SYNTHETIC.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave `PASS gate DG3 (historical)`, exit 0, both at the start (`00-…`) and at the end (`12-…`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/dashboards/ui.tsx` | **F-DG4-143:** new `valueRagLineValue(line)`, so `ValueRagLines` renders each line by its `status`. **F-DG4-144:** `useOrgQuery` narrows the unit's list by phase and status before the 50 limit. It intersects the transformation chip through the full readable list, and adds the reason `none_matching` (type `BlockedFilterReason`). |
| `apps/web/src/pages/dashboards/api.ts` | `useBusinessUnitTransformations(orgId, bu, {phase, status})` passes `phase` and `status` to `GET /api/v1/transformations`. Both are part of the query key. |
| `apps/web/src/i18n/en/dashboards.json`, `apps/web/src/i18n/ar/dashboards.json` | `dashboards.filter.blocked.too_many` reworded in EN and AR. New key `dashboards.filter.blocked.none_matching`. |
| `apps/web/src/pages/dashboards/valueRagLineState.test.tsx` (new) | Unit tests: an `unknown`, a `not_applicable`, a valued and a stale line, plus T10 and the Executive Overview rendered in EN and AR (8 tests). |
| `apps/web/src/pages/dashboards/buFilter.test.tsx` (new) | Unit tests for F-DG4-144 on the Overview, Finance and adoption dashboards, in EN and AR (22 tests). |
| `apps/web/e2e/p4-value-rag-lines.spec.ts` (new) | e2e on the real stack. Test 1: qa's F-DG4-143 world on T10 and the Executive Overview. Test 2: F-DG4-144 in a business unit of its own with 51 transformations. Screenshots and axe at each step. |
| `apps/web/e2e/p4-dashboards.spec.ts` | Test 3 uses a business unit of its own (D-127 fragility); its assertions are kept. Test 4b selects 100 rows per page on the gross/net table (see §4.3). |

## 2. Behaviour delivered

### REQ-S13-003 / F-DG4-143

**Acceptance text:** "A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0". The finding's expected text is binding: "The line's value reads 'Not applicable (n/a)' (data-value-state='not_applicable'), as the non-cash gap headline beside it does. 'Unknown' is shown only for a line with status unknown (a missing amount)."

`valueRagLineValue` maps each line by its `status`:

| Line status | What the line shows |
|---|---|
| `not_applicable` | `{state:'not_applicable'}` with its reason. Never a number, even if a ratio were sent. |
| `unknown` | `{state:'unknown'}` with its reason. |
| `stale` | `{state:'stale'}`, with the last known ratio if there is one. |
| `green`, `amber`, `red` with a ratio | The ratio (for example "100 %"). |
| `green`, `amber`, `red` without a ratio (a malformed line) | `unknown`, never 0. |

The separate reason line under a line is now shown only for a valued line. For the other states the reason is already inside the value, so it is never shown twice.

On qa's world, with the read-only auditor, on T10 and on `/executive-overview?tr=<id>`, in EN and AR:
- The non-cash SAR line reads 'Not applicable (n/a)' with 'Not applicable: nothing is planned to date.' and the chip 'Not applicable'. It has no `data-value-state='unknown'`, no '%' and no green.
- The other three lines read 100 % Red.

Screenshots: `screens/{en,ar}/p4rl-01-t10-value-rag-lines.png` and `p4rl-02-overview-value-rag-lines.png`.

**Other places that build a value from a nullable ratio or amount the same way** (assignment item 1). I searched `apps/web/src` for client-built `DashboardValue`s and nullable ratios:

| Location | Finding |
|---|---|
| `pages/dashboards/ui.tsx` `ValueRagLines` | **The defect.** Fixed. |
| `pages/dashboards/DashboardsPage.tsx:373` (Finance non-financial count) | Always `not_applicable` with `dashboard.value.no_financial_benefit`. Correct; no ratio is involved. |
| `pages/kpi/KpiPage.tsx` `Variance` | A null `varianceRatio` only omits the "(± x %)" suffix; the variance itself is still shown. This is not a state claim, so there is no defect. |
| `pages/kpi/KpiPage.tsx:138` | A null `variance` shows `ValueState status="unknown"` with the actual's or expected's reason, even when `actualStatus` is `not_computable`. The KPI contract has no `not_applicable`, so this is not the F-DG4-143 defect. Raised for the orchestrator; **not changed** (outside the finding's dashboard scope). |
| `pages/change-requests/ChangeRequestsPage.tsx:232` | `materialBudgetChangeRatio === null` reads "no threshold". Correct. |

Every other dashboard value (headlines, items, Portfolio `valueBasis`, drill-down rows) is the server's `DashboardValue` with its own `state`, rendered by `ValueView`.

### REQ-S13-002 / F-DG4-144

**Acceptance text:** "A04: filtering by period Q1 changes all tiles to Q1 values". The finding's expected text is binding: "Narrowing as advised lifts the block. Or, if the design does not let phase and status narrow the unit's transformations, the note does not offer them as the remedy and names one that works."

**Contract and API check (assignment item 2).** `listTransformations` (`docs/api/openapi.yaml` `/api/v1/transformations`) declares `phase` (`Phase`) and a repeatable `status` (`TransformationStatus`). The API (`apps/api/src/modules/transformations/routes.ts`) filters `t.current_phase = phase`, `t.status IN statuses` and `archived_at IS NULL`. These are exactly the dashboards' own scope filters (`reporting/dashboards/scope.ts`: `t.current_phase`, `t.status`, non-archived). So the first branch applies, and no API or contract change was made.

**Delivered** on the Executive Overview, Finance and adoption dashboards (the shared `useOrgQuery`):

- **Phase and status narrow before the limit.** With phase or status set, the unit's list is read with them (`limit 51`) before the 50 limit is applied. 50 or fewer remaining lifts the block, and the request carries those ids. Zero remaining shows the new `none_matching` note ("No transformation you can read in this business unit matches the chosen transformation, phase or status. Change or clear those filters."). It is never the misleading 'you cannot read any', and no request is sent, so it is never read as "all".
- **The transformation chip (the note's other remedy) is made to work.** Before, it intersected with the unit's first 51 only, so a transformation beyond them was wrongly reported as none. It now intersects with the caller's full readable list (`useReadableTransformations`, which the FilterBar already loads) by `businessUnitId`. If that read fails, it falls back to the unit's page.
- **The note's texts (EN and AR)** now say: "Narrow the filter by phase or status until 50 or fewer remain, choose transformations with the transformation filter, or open the transformations' own dashboards." Each named remedy is tested.

**qa's probe** (`docs/delivery/test-evidence/DG4/qa/tests/round-4/e2e/dg4-qa-r4-bu-limit.spec.ts`, revision 2), copied unchanged into `e2e/` for the run and removed afterwards:
- **Before:** failed in EN and AR (`afterStatus_noteVisible: true`).
- **After:** passed in EN and AR (`afterPhase_noteVisible: false`, `afterStatus_noteVisible: false`).

Screenshots: `p4rl-03-bu-too-many.png`, `p4rl-04-bu-phase-none-matching.png` and `p4rl-05-bu-transformation-chip.png`.

### The test fragility (D-127, assignment item 3)

`p4-dashboards.spec.ts` test 3 now creates its own business unit and one transformation in it:
- the unit is created by `dev.admin` (ADM_TECH, `business_unit.manage`);
- the transformation is created by `dev.office` (TO, org-scoped `transformation.create`).

It checks the business-unit chip on that unit, so the count in SYN_RETAIL no longer matters. Its assertions are kept: the chip is visible, the request carries the unit's transformation, and that row is visible. One assertion is added: the other unit's transformation (A) is not requested. The owner chip and the window/as-of checks are unchanged.

**Shown on one stack** (`02-…log`): qa's probe first raised SYN_RETAIL to at least 51, then `p4-dashboards` test 3 passed in EN and AR. It also passed in the full suite (`03-…`).

## 3. Checks actually run

Commands ran from the worktree root with Node 24.21.0, offline. The shell's environment has `LC_CTYPE=C.UTF-8` unless noted.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | exit 0, `PASS gate DG3 (historical)` | `00-…`, `12-…` |
| 1a | **Before**, unit: HEAD versions of `ui.tsx`, `api.ts` and both `dashboards.json` restored, new tests kept; `npx vitest run valueRagLineState.test.tsx buFilter.test.tsx` | exit 1: 24 failed, 6 passed (the 6 are the too_many baselines, which hold before and after) | `01-unit-new-tests-before.log` |
| 1b | **Before**, e2e: same HEAD files, `vite build`, then `with-stack.sh npx playwright test apps/web/e2e/p4-value-rag-lines.spec.ts e2e/<qa probe> --workers=1` | 4 failed and 2 did not run (serial): F-DG4-143 test 1 in EN and AR (`not_applicable` count 0) and qa's probe in EN and AR (note still visible). Playwright exit 1 | `01-e2e-repro-before.log` |
| 2 | **After**, one stack: qa's probe, then `p4-value-rag-lines` and `p4-dashboards` | Probe 2/2 passed. Specs: 15 passed, 1 failed (`p4-dashboards` 4b in AR, see §4.3), 2 did not run (serial). Test 4b was then fixed | `02-…log` |
| 3 | `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` (ports 26221/26222, pool 26223–26249; LANG and LC_ALL unset) | **350 passed (41.1 m), 0 failed, 0 flaky**, exit 0. axe asserts 0 serious or critical in every `expectAccessible` call | `03-e2e-full-product-suite.log` |
| 4 | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | exit 0. unit-node + unit-web: 152 files, **2915/2915**. Formula: **259 passed, 2 skipped** (pre-existing) | `04-…` |
| 5 | `LC_ALL=C.UTF-8 pnpm test` | exit 0, same counts | `05-…` |
| 6 | `QA_PG_PORT=26230 MTH_PORT_POOL=26231-26249 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0: 208 files, **1975/1975**. No pinned-count change (1975, as in D-126) | `11-…` |
| 7 | `pnpm -r typecheck` | exit 0 | `06-…` |
| 8 | `pnpm -r build` | exit 0 (before the full e2e run, and again at the end) | `07-…`, `07b-…` |
| 9 | `pnpm lint` | exit 0 (also re-run at the end: 0) | `08-…` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `09-…` |
| 11 | `pnpm openapi:lint` | exit 0: PASS, 652 operations | `10-…` |

The new tests also passed on their own after the fix: 8/8 and 22/22.

**e2e per spec, full run (chromium-en / chromium-ar), all passed:**

| Spec | en | ar | | Spec | en | ar |
|---|---|---|---|---|---|---|
| journeys | 9 | 9 | | p4-execution | 4 | 4 |
| p2-blank-text | 9 | 9 | | p4-gates-closure | 9 | 9 |
| p2-journeys | 12 | 12 | | p4-governance | 8 | 8 |
| p3-business-cases | 6 | 6 | | p4-kpi-unit | 3 | 3 |
| p3-g4-refusal | 2 | 2 | | p4-kpi | 10 | 10 |
| p3-inherited-approval | 5 | 5 | | p4-percentage-kpi | 2 | 2 |
| p3-journeys | 18 | 18 | | p4-raid-governance | 7 | 7 |
| p3-portfolio | 6 | 6 | | p4-route-splitting | 2 | 2 |
| p3-prioritization-roadmap | 7 | 7 | | p4-traceability | 6 | 6 |
| p3-seams | 3 | 3 | | p4-value-headlines | 2 | 2 |
| p3-ui-completion | 7 | 7 | | **p4-value-rag-lines (new)** | 2 | 2 |
| p4-adoption-bau | 8 | 8 | | session-end | 5 | 5 |
| p4-benefits | 9 | 9 | | | | |
| p4-change-phases | 7 | 7 | | | | |
| p4-dashboards | 7 | 7 | | | | |

**Screenshots** (from the full run): `T-DG4-FE-R8-evidence/screens/{en,ar}/`:
- `p4rl-01` … `p4rl-05`;
- `p4dash-05-executive-overview.png` and `p4dash-06-overview-filtered.png` (test 3 on its own unit).

## 4. Disclosures

1. **Comment-only edit after the full e2e run.** After the full e2e run started, I changed two comments in `ui.tsx`: wrapped an over-long line, and corrected "whole list" to "first 51". There was no code change. The final build, prettier and lint were re-run on it (all exit 0). Unit and integration ran on the final source.
2. **The "before" bundle** was built with `vite build` alone. `pnpm build`'s `tsc` step fails at HEAD because the new test imports `valueRagLineValue`, which does not exist there (exit 2, log not kept as evidence). The HEAD files were restored by `git show HEAD:<path> > <path>`, and my versions copied back afterwards; `git diff` was checked.
3. **`p4-dashboards` test 4b failed once in chromium-ar** (log `02`, before the fix in this handback).
   - **Cause:** test data volume, as in D-127. The gross/net table is organization-wide and paged. The USD benefits of qa's world (added by `p4-value-rag-lines` in the EN project) push the `planned-SAR` net row off page 1.
   - **Fix:** test 4b now selects 100 rows per page on `#finance-net`, as it already did for `#finance-lines`, and asserts that the table's rows fit in 100.
   - **Result:** it passed in both projects in the full run. No timeout was raised and nothing is skipped.
4. **Empty `apps/web/.claude/.cc-writes`** directories (created by the write-guard hook) were removed before each test run. The hook may create them again.

## 5. Operations routed (pending-list delta)

**None.** No operation was added or moved; `listTransformations` is an existing DG1 operation with `phase` and `status` already in the contract. No `p4-pending-*` or `p4-exercises-*` file was touched.

## 6. Contract or schema needs (for the orchestrator)

None. Two observations, both outside this scope:
- `KpiPage` `Variance` shows Unknown for a `not_computable` actual (§2).
- The other organization-wide dashboard tables in the e2e suite read all of the organization's data, so they may need the same page-size treatment as data grows.

## 7. What remains

Nothing in the assigned scope. Closing F-DG4-143 and F-DG4-144 is for the round-5 reviewers; the author does not close them.

## 8. Merge instructions

No migrations and no API changes. The files are independent of other open work. New i18n key: `dashboards.filter.blocked.none_matching`, in EN and AR (the Arabic is proposed, as usual).
