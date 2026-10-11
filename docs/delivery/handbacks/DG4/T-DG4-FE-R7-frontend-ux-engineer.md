# Handback T-DG4-FE-R7 (frontend-ux-engineer): KPI unit kinds on the dashboards (D-124 items 2 and 3, web)

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-R7-frontend-ux-engineer-20261011T181043Z-5554deb4","session_id":"5554deb4-c02c-4f1f-b0e2-7b5be0a5cc19"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R7.md`. Its sha256 `1658b7e9…cbc19a6` matched before I read it.
- **Base:** `HEAD` `fba6e02`, branch `dg4/fe-r7`. `git status` at the start showed only the sandbox's pre-existing untracked dotfiles.
- **Timing:** started 2026-10-11T18:10:55Z. The end time is given in §7.
- **Changes:** all left **uncommitted**, as the assignment asks.
- **Ports:** harness ports 26200–26249 only (PostgreSQL 26200, API 26201, pool 26202–26249; for integration, pool 26201–26249).
- **Not an approval.** I am an engineering agent. Nothing here is a business, Finance or IT approval. No product gate G1–G6 is decided, and DG7 is not implied. All data in tests and specs is synthetic.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` ran before any write: `PASS gate DG3 (historical)`, **exit 0** (`T-DG4-FE-R7-evidence/validate-historical-DG3-start.log`). It ran again at the end (§3).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/dashboards/ui.tsx` | **N5 formatting.** New `formatValueParts` (number and label, separately) and `formatKpiParts`. With `kpiUnit` non-null, the number comes from `kpiUnit.kind` through the KPI pages' own `formatKpiValue` (imported with `times100` from `pages/kpi/ui.tsx`), then N5's label rule applies. With `kpiUnit` null or absent, the earlier rules are unchanged. `formatValue` is now the joined text of the parts. `ValueView` renders through a new `ValueText`, which handles bidi (§2.3). The two `ValueRagLines` gap objects get `kpiUnit: null`. The header and `PERCENT_UNITS` comments state the N5 rule. |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx` | The web-built Finance non-financial n/a value gets `kpiUnit: null` (ARCH-R7 §4.2 item 4). |
| `apps/web/src/pages/dashboards/dashboardFixtures.ts` | **Step 1 (first).** `kpiUnit` on every `DashboardValue` literal and helper: `v(…, kpiUnit = null)`, `unknownV(reasonKey, kpiUnit = null)`, `naV`, `naPc`, the two inline Portfolio n/a/Unknown values (all null). Two KPI values get their unit: `staleV` (a Stale percentage KPI labelled '%') and the T10 Outcomes `outcome_kpi` item (`{percentage, null}`). |
| `apps/web/src/pages/dashboards/percentKpi.test.tsx` | The F-DG4-125 test's API value objects now carry `kpiUnit` (ARCH-R7 §4.2 item 5). Its expectations ('12 %', '100 %') are unchanged and still pass. |
| `apps/web/src/pages/dashboards/kpiUnit.test.tsx` | **new.** ARCH-R7's fixtures F1–F4 in EN and AR, 26 tests (§2.2). |
| `apps/web/e2e/p4-kpi-unit.spec.ts` | **new, sibling of `p4-percentage-kpi.spec.ts`.** A `ratio` KPI and a labelled percentage KPI created through the API, on the real stack. Covers People & adoption, its drill-down, the adoption dashboard and the T10 Outcomes area for an outcome created through the API (§2.4). |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R7-frontend-ux-engineer.md` | this handback |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R7-evidence/**` | logs, probe and screenshots (§3) |

**Not touched:** the API, `packages/shared` (I made a temporary probe edit and reverted it, §3 item 2), `openapi.yaml`, the pending lists, `problems.json`/locales, `tools/**`, `.claude/**`, `docs/source/**`, review and gate records.

## 2. Behaviour delivered

**Requirement rows.** The assignment assigns no register row. Its binding text is D-124 items 2–3, as it states them, and ADR-0037 amendment N5 with ARCH-R7 handback §4.2/§4.3. Quoted:
- D-124 item 2: "A `ratio`-kind KPI renders × 100 on the dashboards. A ratio of 1.5 shows as '150 %' there and as '1.5' on its KPI page."
- D-124 item 3: "A `percentage` KPI with a free-text label renders unscaled. 0.12 with the label '% of users' shows as '0.12 % of users'."
- D-124's decision for both: "a KPI-derived dashboard value carries its unit kind apart from its label, and the web formats it as the KPI pages do. The value gap stays a percentage."

### 2.1 Item 1 of my section: `kpiUnit` on every web literal (done first)

- **Before any change,** a probe made `kpiUnit` required in the zod mirror, then ran `tsc -p apps/web`. It found 10 errors: 7 in `dashboardFixtures.ts`, 1 in `DashboardsPage.tsx`, 1 in `ui.tsx` and 1 in `percentKpi.test.tsx` (`evidence/probe-kpiUnit-required-before.log`).
- **After the change,** the same probe gave **exit 0 with no output** (`probe-kpiUnit-required-after.log`).
- In both runs the zod file was restored byte-identical from a copy. `git status packages/` was clean afterwards.
- **So KBE-R8's closing step** (`.nullable().optional()` → `.nullable()`) does not break the web typecheck.

### 2.2 Item 2 of my section: formatting by `kpiUnit.kind` (ADR-0037 N5 item 1)

| `kpiUnit.kind` | Number | Label |
|---|---|---|
| `percentage` | `formatKpiValue` (fraction × 100, ≤ 2 digits, then ' %') | null, '%', 'percent' or 'percentage' (trimmed, any case): none ('12 %'). A label starting with '%': the number without its sign, then the label ('12' + '% of users'). Any other label: '12 %' + label. |
| `currency` with a currency | money (`formatMoney` via `formatKpiValue`) | none |
| `ratio`, `count`, `duration`, `score`, `other`, and `currency` without a currency | a decimal, ≤ 4 digits (via `formatKpiValue`), never × 100 | the label, if set |
| `kpiUnit` null or absent | unchanged: `ratio` and percentage units are fractions × 100 (F-DG4-122, F-DG4-125), then money, count nouns as integers, other decimals + unit | as before |

**Unknown, n/a, Stale and zero are unchanged:**
- Unknown and n/a show no number.
- Stale shows 'last known value: ' and the same formatted text.
- Zero shows the formatted number (e.g. '0 %' or '0') and the Zero label.

**Surfaces.** Every surface that renders a `DashboardValue` goes through `ValueView`:
- T10 area items (`ItemRow`);
- the Executive Overview and workstream areas (same component);
- the adoption dashboard's indicator rows (`DashboardsPage.tsx`) and its area;
- every drill-down: the value, the inputs and the items (`DrilldownPanel`, `DrillRow`).

The **workspace header** renders only the profit-and-cash planned and validated money values (`WorkspaceHeader.tsx` lines 141/146). N5 "Not carriers" lists none of its elements as KPI-derived, so it shows no KPI value, and its rendering is unchanged.

**Unit tests:** `kpiUnit.test.tsx`, 26 tests, EN and AR.
- **The formatter:**
  - the four fixtures give '12 %', '12 % of users', '1.5' and '100 %';
  - the negative assertions: F2 never '0.12', F3 never '%' or '150 %', F4 never 'SAR' or 'ر.س';
  - the label rule (bare-sign labels; '% of users'; 'of users'; an Arabic label);
  - ratio, count, duration, score and other with labels;
  - a ratio KPI labelled '%' stays unscaled ('0.12 %'), because the label never decides;
  - a currency KPI is money without its label, and without a currency it is a decimal;
  - the null/absent `kpiUnit` rules, as before.
- **`ValueView`:** the bidi structure; Stale F2 'last known value: 12 % of users'; Unknown F3 shows no digit; zero F1 '0 %' and zero F3 '0', each with the Zero label.
- **Surfaces through `renderApp`** with mocked API responses:
  - T10: Outcomes F1/F3, People & adoption F2 and Stale F2, the F4 gap headline '100 %' without currency, and the KPI drill-down (value F3 '1.5', input F2, items '12 %', '12 % of users', '1.5');
  - the Executive Overview;
  - the adoption dashboard (three indicator rows and its area).

**Before / after** (the D-124 defects shown failing, then passing):
- **Before**, on the base code: **22 failed / 4 passed** (`evidence/kpiUnit-test-BEFORE.log`). The failures were the defects as D-124 states them: `expected '150 %' to be '1.5'`, `expected '0.12 % of users' to be '12 % of users'`, `expected '25 %' to be '0.25'`, `expected 'Stale last known value: 0.12 % of use…'`, `expected 'n5_f3_ratio…150 %…' to contain '1.5'`, and `formatValueParts` was not yet a function. The 4 that passed are the "kpiUnit null keeps today's rules" and "Unknown shows no number" tests, which are true before and after by design.
- **After:** **26/26**.

### 2.3 Bidi (ARCH-R7 §4.2 item 2), and one change I made to its suggestion

ARCH-R7 suggested putting the label in its own `<bdi>`. I did that first. The AR adoption-dashboard screenshot of the first real-stack probe (run 1, `e2e-probe-injected-kpiUnit-run1-before-bidi-fix.log`) showed the effect. I inspected it, but it was then overwritten by run 2's file of the same name, so it is not kept. The effect: in an RTL page, two sibling isolates are ordered right to left, so a Latin label read '% of users 12'.

**As built** (`ValueText`):
- the number is `<bdi dir="ltr">`;
- with a label, the number and the label sit together in **one** auto-direction `<bdi data-value-text>`, and the label is a plain `<span data-unit-label>`;
- the group's direction is resolved from the label, because the number's isolate is skipped. So a Latin label reads '12 % of users' left to right in both languages, and an Arabic label is laid out right to left.

The run 2 AR screenshots show '12 % of users' (`screenshots-probe/ar/zz-probe-kpi-unit-t10-people-drilldown.png`, `…-adoption-dashboard.png`). The unit test pins this structure. With no label the markup is the single LTR `<bdi>`, as before.

### 2.4 Item 3 of my section: e2e `p4-kpi-unit.spec.ts`

**Setup, all through the API.** One transformation per project, one open quarterly period of its own (2090+; the `p4-percentage-kpi` pattern) and **one outcome** (`POST …/outcomes`, with no status change and no database insert). Then two KPIs, each activated with a `weighted_ratio` version, linked to the outcome (`POST …/outcome-kpis`), and with a `direct_accept` actual:
- **F2:** `percentage`, label '% of users', 12/100. It is also an adoption indicator (`usage_activation_rate`).
- **F3:** `ratio`, no label, 3/2 = 1.5. An adoption template's unit kind is only `percentage` or `duration` (migration 0047; `indicators.ts` `KPI_MISMATCH`), so the ratio KPI can't be an adoption indicator and is shown in the Outcomes area only.

**The three tests (serial):**
1. **Calculation and the API.** The real worker calculates both KPIs (the status `actual` is polled to '0.12' and '1.5'). The T10 People & adoption item then carries `kpiUnit {percentage, '% of users'}` (needs **KBE-R8**).
2. **People & adoption, EN and AR.** The item's `.amount` reads exactly '12 % of users': '12' in the LTR isolate, '% of users' in the label span, never '0.12'. The same holds in its drill-down and on the adoption dashboard row. Screenshots and axe at each step.
3. **The T10 Outcomes area.** The API's Outcomes area lists both outcome KPIs with their `kpiUnit` (**D-124 item 1 and the member, KBE-R8**). The UI reads '12 % of users' and '1.5'; the ratio row has no '%', and the area never shows '150 %' or '0.12'. The same holds in the area drill-down. Screenshots and axe.

**On this branch alone (no KBE-R8), as the assignment foresees:** test 1 fails in both projects, at the assertion that `kpiUnit` is present (`evidence/e2e-p4-kpi-unit-branch-alone.log`: received `{state: "value", value: "0.12"}` with no `kpiUnit`). Everything before that assertion passed, including the worker's calculation of the ratio as 1.5. Because the file is serial, tests 2 and 3 are reported as "did not run". **Nothing is skipped conditionally.** The tests are expected to pass on the orchestrator's integrated tree once KBE-R8 is merged.

**What I could verify before the merge** (a disclosed probe, not a deliverable):
- **The probe:** a temporary copy of the spec, `apps/web/e2e/zz-fe-r7-probe.spec.ts`. Its source is kept as `evidence/zz-fe-r7-probe.spec.ts.txt`, and the file was **deleted** after each run.
- **What it changed:** it removed test 3 and the `kpiUnit` API assertion. In test 2, `page.route` adds the KBE-R8 member to the **real** API responses of the T10 dashboard, the drill-down and the adoption dashboard (`kpiUnit {percentage, '% of users'}` where `unit` is '% of users', null elsewhere). Everything else ran against the real stack, including the worker.
- **Result: 4/4 passed** (EN and AR, axe included), on run 2 after the bidi change (`e2e-probe-injected-kpiUnit-run2.log`). Run 1, before the bidi change, also passed 4/4: its assertions are text-based, and the screenshot revealed the visual order.
- **Test 3 (Outcomes) could not be probed** without KBE-R8's item 1. The run 2 EN screenshot shows the as-built defect: the Outcomes area reads "Unknown: no active outcome with a KPI in scope" although the outcome and its KPIs exist (`screenshots-probe/en/zz-probe-kpi-unit-t10-people-adoption.png`).
- **Screenshot paths:** `docs/delivery/handbacks/DG4/T-DG4-FE-R7-evidence/screenshots-probe/{en,ar}/zz-probe-kpi-unit-{t10-people-adoption,t10-people-drilldown,adoption-dashboard}.png`. The spec's own screenshots (`p4-kpi-unit-*`) are written to the gitignored `apps/web/e2e/screenshots/` when it runs on the integrated tree.

## 3. Checks actually run

Environment: this worktree, Linux sandbox, Node v24.21.0, pnpm from the repository toolchain, offline, Chromium from `/opt/pw-browsers`. Free disk before each full run: 20 GB. No `.claude/.cc-writes` directory was found in the source folders (checked before each run).

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**, `PASS gate DG3 (historical)`, at the start (`validate-historical-DG3-start.log`) and at the end (`validate-historical-DG3-end.log`) |
| 2 | Probe: `kpiUnit` required in the zod mirror, then `tsc --noEmit -p apps/web`; the file restored | before: 10 errors (`probe-kpiUnit-required-before.log`); after: exit 0 (`probe-kpiUnit-required-after.log`) |
| 3 | `pnpm -r typecheck` | **exit 0**, 7 × "typecheck: Done" (`typecheck.log`, final code) |
| 4 | `pnpm -r build` | **exit 0** (`build.log`) |
| 5 | `pnpm lint` | **exit 0** (`lint.log`) |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!" in all 11 batches (`prettier.log`) |
| 7 | `pnpm openapi:lint` | **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` (`openapi-lint.log`) |
| 8 | `pnpm test`, locale unset (`LANG`/`LC_*` unset) | **exit 0**: unit 150 files, **2878 passed**; formula-nocodegen 3 files, **259 passed, 2 skipped** (pre-existing skips, as in D-121/D-124) (`unit-locale-unset.log`) |
| 9 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: **2878 passed**; **259 passed, 2 skipped** (`unit-C.UTF-8.log`) |
| 10 | `pnpm exec vitest run --project unit-web …/kpiUnit.test.tsx` on the base formatter | **exit 1**, 22 failed / 4 passed: the before state (`kpiUnit-test-BEFORE.log`) |
| 11 | `QA_PG_PORT=26200 MTH_PORT_POOL=26201-26249 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: 207 files, **1966/1966** (18:35:35Z–18:55:57Z) (`integration.log`). No pinned count changed: the web change touches no API test |
| 12 | `with-stack.sh npx playwright test apps/web/e2e/p4-kpi-unit.spec.ts --workers=1` (branch alone) | **exit 1**: 2 failed (test 1, EN and AR: `kpiUnit` missing, needs KBE-R8), 4 did not run (serial) (`e2e-p4-kpi-unit-branch-alone.log`) |
| 13 | The probe with the injected member (§2.4), twice | **exit 0**, 4/4 each time (`e2e-probe-injected-kpiUnit-run1-before-bidi-fix.log`, `…-run2.log`) |
| 14 | Full product e2e: `E2E_PG_PORT=26200 E2E_API_PORT=26201 MTH_PORT_POOL=26202-26249 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | see §3.1 |

### 3.1 Full product e2e

- **Run:** 18:57:33Z–19:42:40Z (45.0 min). Load average 3.12 at the start and 6.53 at the end (`e2e-full.times`). Log: `e2e-full.log`; per-spec counts: `e2e-full-per-spec.txt`.
- **Exit 1. Totals: 340 passed, 2 failed, 4 did not run.**
- **The failures are only the new spec's test 1**, in both projects. Both are the expected branch-alone failure: `kpiUnit` absent, which needs KBE-R8 (§2.4). Its tests 2–3 did not run, because the file is serial.
- **Every other spec passed in both projects:** the 340 tests D-124 reports for the previous full run, which include `p4-percentage-kpi` (2 + 2), `p4-value-headlines` (2 + 2) and `p4-dashboards` (7 + 7).
- **No retry, flake or timeout:** `grep -ci "retry|flaky"` on the log gives 0.
- **axe:** every `expectAccessible` call asserts zero serious or critical violations and fails the test otherwise (`support/ui.ts` l.100), so the 340 passing tests carry 0 serious/critical issues. The new spec's axe steps are in tests 2–3. On this branch they ran only in the probe (§2.4), where they passed in EN and AR.

| Spec | chromium-en | chromium-ar |
|---|---|---|
| journeys | 9 ✓ | 9 ✓ |
| p2-blank-text | 9 ✓ | 9 ✓ |
| p2-journeys | 12 ✓ | 12 ✓ |
| p3-business-cases | 6 ✓ | 6 ✓ |
| p3-g4-refusal | 2 ✓ | 2 ✓ |
| p3-inherited-approval | 5 ✓ | 5 ✓ |
| p3-journeys | 18 ✓ | 18 ✓ |
| p3-portfolio | 6 ✓ | 6 ✓ |
| p3-prioritization-roadmap | 7 ✓ | 7 ✓ |
| p3-seams | 3 ✓ | 3 ✓ |
| p3-ui-completion | 7 ✓ | 7 ✓ |
| p4-adoption-bau | 8 ✓ | 8 ✓ |
| p4-benefits | 9 ✓ | 9 ✓ |
| p4-change-phases | 7 ✓ | 7 ✓ |
| p4-dashboards | 7 ✓ | 7 ✓ |
| p4-execution | 4 ✓ | 4 ✓ |
| p4-gates-closure | 9 ✓ | 9 ✓ |
| p4-governance | 8 ✓ | 8 ✓ |
| **p4-kpi-unit (new)** | **1 ✘, 2 not run** | **1 ✘, 2 not run** |
| p4-kpi | 10 ✓ | 10 ✓ |
| p4-percentage-kpi | 2 ✓ | 2 ✓ |
| p4-raid-governance | 7 ✓ | 7 ✓ |
| p4-route-splitting | 2 ✓ | 2 ✓ |
| p4-traceability | 6 ✓ | 6 ✓ |
| p4-value-headlines | 2 ✓ | 2 ✓ |
| session-end | 5 ✓ | 5 ✓ |

**Acceptance item 4 is therefore not met on this branch alone,** and it can't be until KBE-R8 merges. That is the case the assignment foresees for the Outcomes area. Note that it also applies to the labelled-percentage and `kpiUnit` assertions, because the API sends no `kpiUnit` before KBE-R8.

## 4. Pending operations (delta)

**None routed.** This task is web-only: it adds no operation and moves nothing out of any `p4-pending-*.ts` list. `P4_PENDING_ARCH_R7_MEMBERS` (`DashboardValue.kpiUnit`) stays as it is: emptying it is KBE-R8's closing step. `contract.test.ts` is not affected, and integration passed 1966/1966.

## 5. Contract and schema needs, and notes for the orchestrator

1. **No contract need.** I used ARCH-R7's member as designed.
2. **Merge order.** My fixtures already carry `kpiUnit` (§2.1), so KBE-R8's closing step can merge before or after this task without breaking the web typecheck.
3. **The new e2e spec needs KBE-R8.** Tests 1–3 of `p4-kpi-unit.spec.ts` pass only on the integrated tree: the member, and D-124 item 1 for test 3. Please judge them on the integrated run. On this branch they fail as described in §2.4, and are not skipped.
4. **One deviation from ARCH-R7's bidi suggestion** (§2.3): one auto isolate around the number and the label, instead of a separate isolate for the label. Left for the round-4 reviewers, with the screenshots.
5. **Two choices inside N5 that its table leaves open:**
   - a `currency` KPI **without** a currency is formatted "as `other`", so its label is added, as for `other`;
   - a label is trimmed before use, and a blank label counts as none (the API already sends it trimmed or null).
6. **`PERCENT_UNITS` is kept** for a value without `kpiUnit`, as ARCH-R7 allows. It never applies to the unit of a value that has `kpiUnit`; it is only used to recognize a bare-sign label. It can be removed once the member is required everywhere.
7. **Probe artefacts.** The probe spec was deleted, and its source is kept only as a `.txt` file under the evidence directory. The probe screenshots were moved from the gitignored `apps/web/e2e/screenshots/` into the evidence directory.

## 6. What remains

- **The integrated-tree run** of `p4-kpi-unit.spec.ts` (tests 1–3 in EN and AR) after KBE-R8 merges. It is the orchestrator's (§5 item 3).
- Nothing else in my section is open.

## 7. End

Ended 2026-10-11T19:47Z (`date -u`), about 97 minutes after the start. Typecheck, lint and prettier were re-run last, after a final comment-only edit to `ui.tsx`, and all exit 0. All changes are uncommitted on `dg4/fe-r7`. No probe file remains in the source tree. `node tools/gates/validate.mjs --historical --stage DG3` exits 0 at the end.
