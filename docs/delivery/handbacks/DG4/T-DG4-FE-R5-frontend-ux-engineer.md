# Handback T-DG4-FE-R5 (frontend-ux-engineer): F-DG4-122 and the F-DG4-123 screens

- **Stage:** P4 / DG4, FIXING after review round 2, repair wave B.
- **Invocation:** `DG4-T-DG4-FE-R5-frontend-ux-engineer-20261011T090332Z-7775be6f`, session `7775be6f-e4b4-4afa-b606-9414def7383d`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R5.md`. sha256 `fd722f77…5cb337`, verified at the start.
- **Base:** branch `dg4/fe-r5`, `HEAD` `47d1536f2e99a12e16a0d1abab75f928124079cb`. At the start `git status` showed only untracked sandbox dotfiles.
- **Time:** `date -u` gave 09:03:43Z at the start and 10:35:09Z after the last check. The handback was written after that, about 95 minutes in total.
- **State:** all changes are **uncommitted**, as asked.
- **Ports used:** 26200–26249 only:
  - integration: PostgreSQL 26200, pool 26201–26219;
  - e2e: PostgreSQL 26220, API 26221, pool 26222–26249.

This is an engineering record. It grants no product gate (G1–G6) and no business, Finance or IT approval. All test data is synthetic.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` exited **0** (`PASS gate DG3 (historical)`) both at the start and at the end:
- `T-DG4-FE-R5-evidence/validate-DG3-historical-start.log`
- `T-DG4-FE-R5-evidence/validate-DG3-historical-end.log`

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/lib/format.ts` | New `formatPercent`: exact decimal; `fraction: true` multiplies by 100. Digits come from the locale's Intl formatter, and the sign is placed per the locale's own percent pattern. |
| `apps/web/src/pages/dashboards/ui.tsx` | **F-DG4-122:** `formatValue` now tests the unit before the currency (`ratio`, then `percent`/`percentage`/`%`, then currency).<br>**F-DG4-123:** new `HeadlineList` and `BasisChip`. `AreaCard` (T10, workstream, Executive Overview, adoption) uses `HeadlineList`. The drill-down panel shows a "Basis" row from `DashboardDrilldown.headlineBasis`. The unused `decimal.js` import is removed. |
| `apps/web/src/pages/dashboards/DashboardsPage.tsx` | The Finance headlines render through `HeadlineList`. An unused import is removed. |
| `apps/web/src/components/WorkspaceHeader.tsx` | New `HeaderBenefits`. With `benefits.headlines` it shows the basis-labelled headlines, the beside group and a drill-down per figure. Without them (the as-built API) it falls back to the previous planned/validated lines. |
| `apps/web/src/i18n/en/dashboards.json`, `apps/web/src/i18n/ar/dashboards.json` | Code-table rows 207–230, with EN exact and AR as proposed. Rows 229–230 change text only. Rows 231–235: the five A2 keys are **removed** (retired). New `basis.*` texts: chips, the "beside, never added" note, the provisional-Arabic note and the class lists. |
| `apps/web/src/pages/dashboards/dashboardFixtures.ts` | The existing Value-area fixture moves to the N3 keys and `headlineBasis`. New D-119 fixtures in two variants, `main` and `na`, for T10, the Overview, Finance, the header and the drill-down. |
| `apps/web/src/pages/dashboards/dashboards.test.tsx` | F-DG4-122 unit tests in EN and AR. The catalogue test moves to the row-210 key. |
| `apps/web/src/pages/dashboards/valueHeadlines.test.tsx` (new) | The F-DG4-123 screen tests on four surfaces × two locales, plus a code-table key test. |
| `apps/web/e2e/p4-value-headlines.spec.ts` (new) | Real-stack e2e. Test 1 is F-DG4-122 on T10, the Overview and Finance. Test 2 is F-DG4-123 on four surfaces; it **skips itself** while the API does not yet send `headlineBasis` (§6). |
| `apps/web/e2e/p4-dashboards.spec.ts` | Test 4b now selects 100 rows per page before it counts the org-wide class lines (§3.4). |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R5-*` | This handback and its evidence. |

No API, worker, shared, contract or migration file was changed.

## 2. Behaviour delivered

### 2.1 F-DG4-122 (High, mandatory; REQ-PB-062)

**Finding's expected text:** "it must render as a percentage (here '100 %'; a 25 % gap as '25 %'), never as a money amount."

**Delivered:** a `ratio` value renders as a percentage before any currency is considered, and so does a percentage unit. Results in both EN and AR:

| Input | Output |
|---|---|
| `{value:"1", unit:"ratio", currency:"SAR"}` | `100 %` |
| `0.25` | `25 %` |
| `0.125` | `12.5 %` |
| `0` | `0 %` |
| `-0.05` | `-5 %` in EN; `‎-5 %` in AR (the locale's own minus, with U+200E, from Intl) |
| `{12.5, unit:"percent" \| "percentage" \| "%", currency:"SAR"}` | `12.5 %` |

- **Digits:** they come from `Intl` for the locale. In Arabic that is `ar-u-…-nu-latn`, which gives Latin digits by ADR-0009.
- **Sign placement:** the percent sign follows the number in both en-GB and ar. This is derived from Intl's percent pattern (`formatToParts`), so a locale that puts the sign first would get `% n`.
- **Money stays money:** `SAR 90.00` / `90.00 ر.س.`.

**Search for formatters that test currency before unit** (the assignment's list), over all web formatters that read a currency:

| Formatter | Verdict |
|---|---|
| `pages/dashboards/ui.tsx` `formatValue` | **Defective. Fixed.** It is the only one. |
| `pages/kpi/ui.tsx` `formatKpiValue` | Correct. It tests `unitKind === "currency" && currency`, so a percentage KPI that carries a currency goes to the percentage branch. Unchanged. |
| `pages/benefit-formulas/values.tsx` `formatFormulaValue` | Correct. It branches on `type.kind` first. Unchanged. |
| `pages/benefits/ui.tsx` `moneyText` and `sharePercent` | No unit input: money-only and fraction-only by design. Unchanged. |
| `components/Amount.tsx` `Amount` | Money only, with no unit. Unchanged. |

`ValueView` is the only caller of `formatValue`. It is used by T10, the workstream dashboard, the Overview, Finance (headlines, lines and drill-downs), adoption, the personal dashboard and the workspace header, so all of them are fixed.

**Reproduction failing before the fix and passing after:**

- **Unit** (`dashboards.test.tsx`, "F-DG4-122 (en|ar)"):
  - before the fix: `T-DG4-FE-R5-evidence/f122-unit-before-fix.log`, exit 1. EN received `"SAR 1.00"`; AR received `"‏1.00 ر.س.‏"`.
  - after the fix: `f122-unit-after-fix.log`, exit 0.
- **e2e** (real stack; `p4-value-headlines.spec.ts` test 1, the domain reviewer's world):
  - before the fix (`formatValue` temporarily restored to the currency-first order, the web rebuilt, then the fixed file restored, checked with `cmp`): `e2e-f122-before-fix.log`, exit 1. chromium-en received `"SAR 1.00"`; chromium-ar received `"‏1.00 ر.س.‏"`.
  - after the fix: `e2e-value-headlines-alone-1.log`, exit 0. The assertion is exactly `100 %` on the T10 Value area, the Executive Overview (`?tr=`) and the Finance dashboard (`?tr=`), in both projects, and no `SAR`/`ر.س`/`1.00` appears in the gap. The spec also checks the API input itself: `{state:"value", value:"1", unit:"ratio", currency:"SAR"}`.
- **Screenshots:** `T-DG4-FE-R5-evidence/screenshots/{en,ar}/p4-value-gap-{t10,overview,finance}.png`.

### 2.2 F-DG4-123 screens (REQ-S08-009; also REQ-PB-062, REQ-S13-003, REQ-S03-009, REQ-S03-011)

These are built from ARCH-R5's contract members and tested with mocked responses (`valueHeadlines.test.tsx`, 26 tests: 13 per locale). The fixture is the domain reviewer's world: profit_and_cash 90, top_line 300, non_cash 45, gap ratio 1.

- **Basis labels** on the T10 Value area, the Executive Overview, the workspace header and the Finance dashboard:
  - each value headline shows its row 207–219 label, for example "Planned value (profit and cash)" / "القيمة المخططة (الربح والنقد)";
  - each also shows a basis chip (`dashboards.basis.*`, neutral styling, text, not a status colour).
- **Top line and non-cash beside, never summed:**
  - `top_line` and `non_cash` headlines are rendered in a separate `<dl data-headlines-beside data-not-summed="true">`;
  - the group is introduced by `dashboards.basis.besideNote` ("Shown beside the profit-and-cash value, never added to it …");
  - the web computes no sum. The tests assert that 435 appears nowhere on the page and that no beside headline sits in the profit-and-cash list.
- **`not_applicable`** (the `na` variant): every profit-and-cash headline, and the gap, show "Not applicable" plus the row-220 reason text. They show no digit and no green chip. On T10 and the Overview the Value area RAG is `not_applicable`, with the row-221 rule text. Top line 300 and non-cash 45 are still shown.
- **Drill-downs:** every headline opens its own `drilldownHref`, as sent:
  - profit_and_cash requests carry **no** `valueClass`;
  - top_line requests carry `valueClass=revenue_uplift`;
  - non_cash requests carry `valueClass=avoided_cost`.

  The tests assert the request URL on all four surfaces. The drill-down dialog shows the basis row (`DashboardDrilldown.headlineBasis`, with its class list), the value and the `sum_planned_<basis>` rule text. The workspace header gained a drill-down dialog for this.
- **EN and AR keys:**
  - rows 207–230 are all present (24 keys);
  - rows 231–235 are retired;
  - the five basis texts are added.

  The test asserts that the 29 keys are non-empty, that the Arabic ones are Arabic, and that the five retired keys are absent. **The Arabic is provisional.** The texts are ARCH-R5's proposals, unreviewed by a native speaker. In Arabic each headline list that carries a basis shows `dashboards.basis.arProvisional` (`data-provisional="basis"`).
- **The web readers in ARCH-R5 handback §6**, each checked:

  | Reader | Result |
  |---|---|
  | `pages/dashboards/ui.tsx` | **updated:** `formatValue`, `HeadlineList`, `BasisChip`, the drill-down basis row, and React keys that now include the basis (two `value.planned` headlines per currency no longer collide) |
  | `DashboardsPage.tsx` | **updated:** the Finance headlines. The gross line's drill-down renders whenever `drilldownHref` is set, so the "gross now always drills" change needs no web change. |
  | `api.ts` | no change needed: it only forwards hrefs |
  | `dashboardFixtures.ts` | **updated** |
  | `dashboards.test.tsx` | **updated** |
  | `pages/closure/closure.test.tsx` | no change needed: it uses its own `closureP4.*` keys and no value headline |
  | i18n `{en,ar}/dashboards.json` | **updated** |
  | `components/WorkspaceHeader.tsx` | **updated** |
  | the drill-down view | **updated** (basis row) |

## 3. Checks actually run

All logs are in `docs/delivery/handbacks/DG4/T-DG4-FE-R5-evidence/`. Environment: Node 24.21.0, offline, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. `df -h .` showed 20 GB free before each full run. No empty `.cc-writes` directories were found in source folders.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log`; re-run at the end: `typecheck-final.log`, exit 0 |
| 2 | `pnpm -r build` | 0 | `build.log` |
| 3 | `pnpm lint` | 0 | `lint.log`; re-run at the end: `lint-final.log`, exit 0 |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!". `prettier.log`; at the end: `prettier-final.log`, exit 0 |
| 5 | `pnpm openapi:lint` | 0 | `PASS … OpenAPI 3.1.1, 652 operations` (`openapi-lint.log`) |
| 6a | `pnpm test`, with `LANG`/`LC_ALL`/`LC_CTYPE` unset | 0 | Invocation 1: 146 files, **2810 passed**. Invocation 2 (nocodegen): 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 6b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2810, then 259 + 2 skipped (`unit-locale-c-utf8.log`) |
| 7 | `QA_PG_PORT=26200 MTH_PORT_POOL=26201-26219 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 205 files, **1953/1953**. The same count as round 2, so no pinned-count change (`integration.log`) |
| 8 | Full e2e: `E2E_PG_PORT=26220 E2E_API_PORT=26221 MTH_PORT_POOL=26222-26249 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` | **1** | **329 passed, 2 failed, 2 skipped, 3 did not run** (43.0 min; `e2e-full.log`; per spec: `e2e-full-per-spec.txt`). Both failures are explained in §3.4 |
| 9 | Re-run of the three affected specs together (`p4-dashboards`, `p4-value-headlines`, `session-end`), same command | 0 | **26 passed, 2 skipped** (the two F-DG4-123 e2e tests, §6) (`e2e-rerun-three-specs.log`) |
| 10 | `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | 0 / 0 | `PASS gate DG3 (historical)` |

### 3.1 e2e per spec (full run, row 8)

All specs passed in both projects except the following:

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `p4-value-headlines.spec.ts` (new) | 1 passed, 1 skipped | 1 passed, 1 skipped |
| `p4-dashboards.spec.ts` | 7 passed | 4 passed, **1 failed (4b)**, 2 did not run (serial) |
| `session-end.spec.ts` | 3 passed, **1 failed**, 1 did not run (serial) | 5 passed |

Every other spec (journeys, p2-*, p3-*, p4-adoption-bau, p4-benefits, p4-change-phases, p4-execution, p4-gates-closure, p4-governance, p4-kpi, p4-raid-governance, p4-route-splitting, p4-traceability) passed with equal counts in en and ar.

### 3.2 Axe

Every test that ran calls `expectAccessible`, which fails on any serious or critical violation. No test failed on axe:
- **full run:** both failures are other assertions, listed below;
- **re-run (row 9):** 0 serious or critical issues for `p4-value-gap-{t10,overview,finance}`, plus all the p4-dashboards and session-end steps.

### 3.3 No timeouts

No test hit the 30 s timeout in any run.

### 3.4 The two failures in the full run (disclosed)

1. **`p4-dashboards.spec.ts` 4b, chromium-ar:** `[data-drill-line='avoided_cost-validated-SAR']` had count 0.
   - **Cause:** the page snapshot shows "page 1 of 2 · 25 of 28 rows" (`الصفحة 1 من 2 · 25 من 28 صفوف`). The Finance class lines are organization-wide, and my new spec's EN world adds benefits in four classes, which raised the line count above the table's first page of 25. The test assumed every line was on page 1.
   - **The screen is correct:** pagination is a required table feature.
   - **Fix (test only):** 4b now selects 100 rows per page first, and asserts that the lines fit within 100.
   - **Verified:** the row 9 re-run, 4b passed in both projects. In that fresh database the line count may have stayed under 25, so the re-run proves the test still passes; it does not reproduce the 28-line condition.
2. **`session-end.spec.ts:299` "a 403 is not a session end", chromium-en:** the expected `PATCH /me/preferences` 403 came back 200.
   - **Relation to this change:** the test covers the language switch after a dev re-login as another user (T-DG2-FE11). None of my files touch the session, preferences or language switch.
   - **Result elsewhere:** it passed in chromium-ar in the same run, and in both projects in the row 9 re-run.
   - **Status:** I report it as a **flaky, unrelated failure** under load. Cause not established.

I did not re-run the full 43-minute suite after the 4b test fix, because of the time limit. The orchestrator's integration run should confirm it.

## 4. Pending operations (delta)

**None.** This task routes no API operation. No `p4-pending-*` list belongs to the web task, and `contract.test.ts` is untouched. The three ARCH-R5 members in `p4-pending-arch-r5.ts` are KBE-R6's to empty (D-120).

## 5. Contract or schema needs (for the orchestrator)

None new. The web reads exactly ARCH-R5's members:
- `DashboardHeadline.headlineBasis`;
- `DashboardDrilldown.headlineBasis`;
- `WorkspaceHeader.benefits.headlines`.

It reads all three as optional, so it typechecks both before and after KBE-R6's closing step (`required` and dropping `.optional()`).

**One expectation for KBE-R6:** on the header, `benefits.headlines` should carry the planned and validated headlines of all three bases. That is ARCH-R5 §7, "identical to the T10 headlines … hrefs included". The web renders them as sent and computes no sum.

## 6. What remains (after the KBE-R6 merge)

1. **The e2e for F-DG4-123 (`p4-value-headlines.spec.ts` test 2) has not run yet.** It skips itself while the API sends no `headlineBasis`, with the reason "T-DG4-KBE-R6 (D-119) is not merged in this tree". After the merge it must **run and pass**, in en and ar.
   - It asserts on T10, the Overview, Finance and the header: profit_and_cash 90 with its label; top_line 300 and non_cash 45 in the beside group; the gap at 100 %; no 435; and the top-line drill-down using `valueClass=revenue_uplift` and summing to 300.
   - It takes screenshots `p4-value-basis-*` and runs axe.
   - The orchestrator's integrated e2e run is the check. A skip there would mean the API still lacks the member.
2. **Until KBE-R6 is merged, this tree is in a mixed state:**
   - the as-built API still sends the five retired A2 keys, which now render the neutral headline text "Figure" / "رقم";
   - the as-built API still sends the five-class sums (435);
   - the row 229–230 rule texts already name the profit-and-cash basis.

   The screenshots `screenshots/ar/p4-value-gap-t10.png` and the others show this state; they are evidence for F-DG4-122 only. All three resolve when KBE-R6 emits the new keys and sums. **Merge FE-R5 and KBE-R6 together.** Do not freeze with only one of them.
3. **One more full e2e run** after the 4b test fix (§3.4) belongs in the integrated run.
4. **Native-speaker review** of the Arabic rows 207–230 and the basis texts. They are shown as provisional.

## 7. Merge instructions

- **No migration.** Rebuild `@mth/shared` and the web after merging.
- **Order:** with KBE-R6, in the same integration (§6.2). No file overlap with KBE-R6 is expected; it owns the API, the engine, the contract closing step and the mirrors.
- **Conflicts:** possible only if another task edits `apps/web/src/i18n/*/dashboards.json` or `p4-dashboards.spec.ts`.
- **After the merge:** run the e2e suite and confirm that `p4-value-headlines.spec.ts` test 2 **passes, not skips**, in both projects.
