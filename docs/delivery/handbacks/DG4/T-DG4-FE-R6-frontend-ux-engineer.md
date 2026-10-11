# Handback T-DG4-FE-R6 (frontend-ux-engineer): F-DG4-125 and the F-DG4-126 / F-DG4-127 screens

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-FE-R6-frontend-ux-engineer-20261011T155259Z-4343ad3b","session_id":"4343ad3b-772a-4c7e-a630-0aef28dbc27e"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-FE-R6.md`. Its sha256 `a4e10236…0a9` was verified before reading.
- **Base:** `HEAD` `5f0f016bf638d5456221a15f7efa55d757f03300`, branch `dg4/fe-r6`.
- **Timing:** started 2026-10-11T15:53:10Z and ended about 17:40Z (`date -u`), inside the 2-hour limit.
- **Changes:** all left **uncommitted**.
- **Ports:** only 26200–26249.
- **Not an approval.** I am an engineering agent: nothing here is a business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing implies DG7. All data is synthetic.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0**:
- at the start, before any write (`T-DG4-FE-R6-evidence/validate-dg3-historical-start.log`);
- at the end (`…-end.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/dashboards/ui.tsx` | **F-DG4-125:** `formatValue` renders `percentage` / `%` / `percent` (trimmed, case-insensitive; new `isPercentUnit`) as fraction × 100, the same as `ratio`. **N4:** `valueRagLines` (a defensive parser of `ruleParams.lines`) and `ValueRagLines` (per-basis gap lines, worst-of note, `data-worst`) in every `AreaCard`. The Portfolio value column is labelled by `valueBasis`, and each item shows its basis chip. The drill-down shows `DashboardDrilldown.currency`. `HeadlineList` keys are unique for repeated n/a headlines. |
| `apps/web/src/pages/dashboards/dashboardFixtures.ts` | `valueBasis: null` on every fixture `DashboardItem`; `currency: null` on the fixture drill-down; the D-119 `ruleParams` moved to the N4 `lines` shape; `staleV` is now a fraction (0.42). New N4 fixtures: the R3-6a world, the ranking world and the top-line gap drill-down (ARCH-R6 §4.3). |
| `apps/web/src/pages/dashboards/percentKpi.test.tsx` | **new**, F-DG4-125: formatter and surfaces, with the API's own KPI value objects, in EN and AR. |
| `apps/web/src/pages/dashboards/n4Value.test.tsx` | **new**, F-DG4-126/127 screens, with mocked ARCH-R6 contract responses, in EN and AR. |
| `apps/web/src/pages/dashboards/dashboards.test.tsx` | Re-baselined two assertions that pinned the defect (§2.1). |
| `apps/web/src/i18n/{en,ar}/problems.json` | `dashboard__currency_not_applicable` (code row 244). |
| `apps/web/src/i18n/{en,ar}/dashboards.json` | Rows 236–240 and 242–243. Web labels: `basis.portfolioValue`, `basis.ragLines`, `basis.ragLinesNote`, `basis.ragLineGap`, `drill.currency`. |
| `apps/web/e2e/p4-percentage-kpi.spec.ts` | **new** real-stack e2e: two real percentage KPIs, the real worker, People & adoption, the drill-down and the adoption dashboard, in EN and AR. |
| `docs/delivery/handbacks/DG4/T-DG4-FE-R6-evidence/**` | Logs, screenshots and the evidence-only N4 screenshot spec (§3.6). |

The fixture and test edits are web-owned (`dashboardFixtures.ts`, `dashboards.test.tsx`). No API, shared, contract, tool or record file was changed. The untracked dot-files and `CLAUDE.local.md` at the root are sandbox artifacts, not mine; ARCH-R6 §5.4 describes the same.

## 2. Behaviour delivered

### 2.1 F-DG4-125 (High, mandatory): REQ-PB-062, REQ-S13-003

REQ-PB-062 acceptance: "all six areas render in en and ar from persisted data; each headline drills to contributing records".
REQ-S13-003 acceptance: "the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0".

**Finding's expected text:** "…the Outcomes area and the People & adoption area, the Executive Overview, the adoption dashboard and every drill-down must show '12 %' for this KPI."

**Units checked.**
- `kpi/dashboard-facts.ts` sends `unit = unit_label ?? unit_kind`.
- For a percentage KPI that is `percentage` (no label) or the free-text label. `%` is the label the product's own fixtures and the reviewer used.
- `percent` is not an API unit kind. It is kept in the set as a possible label and is now also a fraction.
- No API unit sends an already-scaled percentage. Every reporting value constructor (`knownValue`, `countValue`, `sumValue`, `kpiActualValue`) was enumerated: the units are `currency`, `ratio`, the count units, or the KPI's `unit_label ?? unit_kind`.

**Surfaces checked.** T10 areas (Outcomes and People & adoption), the Executive Overview, the workstream dashboard, the adoption dashboard (indicator rows and area), the Finance headlines, the workspace header and every drill-down (value, inputs, items). All of them render through `ValueView` → `formatValue`, the one function fixed.

**Unchanged:** `ratio` (F-DG4-122): 1 → 100 %, 0.25 → 25 %; asserted again in `percentKpi.test.tsx`.

**Reproduction, before and after the fix.**
- **Before:** `f125-unit-before-fix.log`, the final test file run against `HEAD`'s `ui.tsx`: **10 failed, 2 passed**, `expected '0.12 %' to be '12 %'`. The two that pass are the ratio and money controls.
- **After:** `f125-unit-after-fix.log`, the dashboards folder: **67/67 passed**.

**Re-baselined (two pinned the defect):**
- `dashboards.test.tsx` F-DG4-122 block: `{value:"12.5", unit:"percent"|"percentage"|"%"} → "12.5 %"` became `{value:"0.125", …} → "12.5 %"`.
- The `staleV` fixture changed from `"42"` with unit `%` (which now reads 4200 %) to `"0.42"`. Its assertion became `data-value "0.42"` and text "42 %".

**e2e on a real percentage KPI** (`p4-percentage-kpi.spec.ts`, real stack, no interception).
- **Setup through the API:** two `percentage` KPIs, one with no label and one labelled `%`. Each has a `weighted_ratio` / `direct_accept` version, an accepted actual of 12/100, and feeds an adoption indicator (`usage_activation_rate`, `new_journey_share`).
- **Calculation:** the real worker runs for one step only, as in the `p4-benefits` precedent.
- **Test 1** asserts that the API sends `{state:"value", value:"0.12", unit:"percentage"}` and `{…unit:"%"}`.
- **Test 2** asserts "12 %" and no "0.12" on:
  - the T10 People & adoption area;
  - its drill-down;
  - the adoption dashboard.
- **Each step** takes a screenshot and runs axe.

### 2.2 F-DG4-126 screens (REQ-PB-063, D-122 item 1, ARCH-R6 §4.2 items 1 and 3)

REQ-PB-063 acceptance: "an outcome whose tasks are 100% complete but KPI is below trajectory is Red/Amber, not Green; a KPI with no actual shows Unknown".

- **The per-basis gap lines.** Every `AreaCard` whose RAG is `dashboard.rag.value.validated_gap` with `ruleParams.lines` lists one line per basis and currency. This covers T10, the Overview and the workstream dashboard. Each line shows:
  - its basis chip;
  - its currency;
  - its gap as a percentage (fraction × 100);
  - its own status chip (icon + text).
- **Worst-of.** The line or lines that set the area status carry `data-worst`. A note says the status is the worst of these gaps and that gaps are never added across bases.
- **No cross-basis figure.** The web never computes one. The tests assert that "81 %" (300/370) is absent.
- **Malformed input.** A malformed line, an unknown basis or an unknown status is dropped, never guessed. A null gap renders as Unknown, never 0.
- **Gap headlines.** The `value_gap_top_line` / `value_gap_non_cash` headlines are labelled (rows 236–237), carry their basis chip and sit in the "beside, never added" group. 1 renders as "100 %".
- **Rule texts:** rows 238–239 are new, and row 240's text now states the worst-of rule.
- **Retired key.** `dashboard.rag.value.no_profit_and_cash_benefit` (row 241) is kept until KBE-R7 lands (ARCH-R6 §4.2 item 7).

### 2.3 F-DG4-127 screens (REQ-PB-062, D-122 item 2, ARCH-R6 §4.2 item 4)

- **Column label.** The Portfolio value column reads "Planned value allocated (profit and cash)", but only when every item carries `valueBasis: "profit_and_cash"`. An unlabelled value from a pre-KBE-R7 API keeps the generic "Value" header, so the screen never claims a basis the API did not send.
- **Per-item chip.** Every item with a `valueBasis` shows its basis chip.
- **Initiatives with no profit-and-cash value.** `not_applicable` shows its state and the row 242 reason, never a number. `unknown` stays Unknown.
- **Ranking.** The server's order is kept: valued, then n/a, then Unknown.

### 2.4 F-DG4-105 screen part (REQ-S13-003, ARCH-R6 §4.2 item 5)

- The drill-down shows `DashboardDrilldown.currency` when it is not null (`data-drill-currency`).
- Every href is followed as sent; the test checks that `valueClass=revenue_uplift&currency=SAR` reached the server.

### 2.5 Item 3 (done first, before the screens)

- `dashboard.currency_not_applicable` is in `problems.json` in EN and AR (row 244 text, Arabic as proposed).
- `problems-slices-hijk.test.ts`: **6 failed / 12 passed before** (`problems-guard-before.log`), **18/18 after** (`problems-guard-after.log`).
- **Fixture members:** `valueBasis` on every fixture `DashboardItem`, `currency` on the fixture drill-down, and `ruleParams` in the N4 `lines` shape.
- **Closing-step simulation** (`closing-step-simulation.log`). I dropped both `.optional()` calls in `dashboards.ts`, exactly KBE-R7's closing step, rebuilt `@mth/shared` and ran `pnpm --filter @mth/web typecheck`.
  - **exit 0.** At `HEAD` the same simulation failed with 3 errors, all in `dashboardFixtures.ts`.
  - The file was restored and shared rebuilt; `git diff` on it is empty.

### 2.6 Arabic

- Every new Arabic text is the ARCH-R6 proposal, or for the web labels my own proposal. All are provisional.
- On screen, the provisional-Arabic note (`basis.arProvisional`) appears once per area wherever basis labels show: headlines, RAG lines and the Portfolio column.

## 3. Checks actually run

Environment: this worktree, Node 24.21.0, offline, Chromium from `/opt/pw-browsers`. Logs are in `T-DG4-FE-R6-evidence/`.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` | **exit 0** (`typecheck.log`) |
| 2 | `pnpm -r build` | **exit 0** (`build.log`) |
| 3 | `pnpm lint` | **exit 0** (`lint.log`) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** (`prettier.log`; npm config warnings only) |
| 5 | `pnpm openapi:lint` | **exit 0**, 652 operations (`openapi-lint.log`) |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | **exit 0**: 148 files, **2840 passed**; then 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: the same counts (`unit-c-utf8.log`) |
| 8 | `QA_PG_PORT=26210 MTH_PORT_POOL=26211-26249 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: 206 files, **1960/1960** (`integration.log`). Same count as D-121; no pinned count changed. |
| 9 | `E2E_PG_PORT=26220 E2E_API_PORT=26221 MTH_PORT_POOL=26222-26249 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1` | **exit 0: 340 passed** (43.5 min; load average 2.05–3.09). No failure, flake, retry or skip. Per spec and project: `e2e-per-spec-counts.txt`. `p4-percentage-kpi` passed 2/2 in each of chromium-en and chromium-ar. Every other spec matches D-121's 336 (e.g. `p4-value-headlines` 2+2, `p4-dashboards` 7+7, `p4-kpi` 10+10). Axe runs inside `expectAccessible`, which fails a test on any serious or critical issue, so all 340 passing means 0 serious or critical issues on every screen checked. Log: `e2e-full.log`. |
| 10 | The new spec alone (ports 26201/26202) | **exit 0, 4 passed** (`e2e-p4-percentage-kpi-alone.log`) |
| 11 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**, at the start and at the end |
| 12 | Closing-step simulation (§2.5) | web typecheck **exit 0** |

The unit count was 2819 at D-121; the +21 are this task's new tests.

### 3.1 Disclosed non-passes during development (not acceptance runs)

- **`n4Value`** first failed 2 D-119 tests in AR. Two provisional notes appeared per area, because my RAG lines added a second one. Fixed by keeping one note per area, then re-run green.
- **`percentKpi`** T10 test, first draft: my drill-down mock had `calculation: null`, which is invalid against the contract. That was a test defect; fixed.
- **Early iterations of the e2e spec** failed for three reasons, all fixed before the counted runs:
  - **Outcomes area not reachable:** the Outcomes area showed no outcome (§5.1), so I switched to the adoption-indicator path;
  - **wrong selector:** an `#id` selector where the register uses `data-register`;
  - **debug run:** one run was a debug pass.
- **The evidence spec's first axe run** found `scrollable-region-focusable` on my RAG-lines table inside a narrow card, a real defect. I first made the region focusable. I then replaced the table with a wrapping list, so each line's status is visible without scrolling. Axe is then 0 serious or critical in EN and AR.

### 3.2 Screenshots (EN and AR)

All are in `T-DG4-FE-R6-evidence/screens/{en,ar}/`.

**Real stack and real API, from the counted run:**
- `p4-pct-kpi-t10-people-adoption.png`;
- `p4-pct-kpi-t10-drilldown.png`;
- `p4-pct-kpi-adoption-dashboard.png`.

**Real SPA and stack, with MOCKED dashboard responses:**
- `n4-t10-value-rag-lines-portfolio.png`;
- `n4-overview-value-rag-lines.png`;
- `n4-finance-top-line-gap.png`;
- `n4-finance-gap-drilldown-currency.png`.

The mocked screenshots come from `n4-screens.evidence.spec.ts` with its own config (`n4-screens-evidence-run.log`: 2 passed, axe included). The dashboard, overview, Finance and drill-down responses are the N4 unit-test fixtures, because KBE-R7's API is not merged yet. That spec is evidence only and is not in the product suite.

## 4. Operations routed (pending-list delta)

**None.** This task routes no API operation, and the web has no `p4-pending-*` list. ARCH-R6's `p4-pending-arch-r6.ts` members and parameter are KBE-R7's to close.

## 5. For the orchestrator: contract, schema and findings outside my scope

1. **No API operation can make an outcome `active`, so the T10 Outcomes area is empty for any outcome created through the product.**
   - **Who:** BE or KBE scope, plus a decision.
   - **The defect:**
     - `outcome.status` defaults to `draft` (migration 0013);
     - the outcome register's update has no `status` column or transition (`transformations/registers.ts`), and no code updates `outcome` to `active`;
     - `kpi/dashboard-facts.ts` `loadOutcomeRows` reads only `status = 'active'`.
   - **How it showed:** the Outcomes area showed `dashboard.rag.outcomes.none` and no items for an outcome with two linked, calculated percentage KPIs (debug run, §3.1).
   - **Why it went unseen:** the round-3 reviewer's R3-7 inserted an active outcome directly in the database (`activeOutcome` fixture).
   - **What I did:** this is outside FE-R6's file ownership, so I changed nothing. The F-DG4-125 e2e uses the People & adoption area instead, which shares the formatter and drill-down with the Outcomes area. The unit test covers the Outcomes area with the API value object.
   - **Assessment:** I believe this is a REQ-PB-062 / REQ-PB-063 gap ("all six areas render … from persisted data") and should become a finding.
2. **A KPI of unit kind `ratio` reads differently on dashboards and on KPI pages.** The dashboards render it × 100 (F-DG4-122's ratio rule, which the assignment keeps), while `formatKpiValue` on the KPI pages shows the plain decimal. So a ratio KPI of 1.5 reads "150 %" on a dashboard and "1.5" on its KPI page. A fix needs the KPI's unit kind on `DashboardValue` (e.g. a `unitKind` member), or a different unit for the value gap. That is a contract decision; not changed.
3. **Free-text unit labels.** A percentage KPI whose label is not `%`, `percent` or `percentage` (e.g. "% of users") is sent with that label and renders unscaled, as "0.12 % of users". Only the unit kind identifies a fraction, and `DashboardValue` does not carry it. The same contract member as item 2 would close this. No such label exists in the seed or the templates.
4. **Wording ahead of the API.** Row 240's rule text ("the worst of … each basis and currency") is the N4 rule. Until KBE-R7 merges, the as-built API still applies N3, so on this branch alone the text runs ahead of the API. That is by design for a joint integration.
5. **The Portfolio card is narrow.** In the three-column grid the Portfolio items table, which predates this task, scrolls horizontally, and the n/a reason wraps tightly (`n4-t10-value-rag-lines-portfolio.png`). Axe reports no issue. A wider layout for that table is optional polish, not done.

## 6. What remains

- **The F-DG4-126 / F-DG4-127 screens are verified only against mocked ARCH-R6-shaped responses** (unit tests and the evidence screenshots). There is deliberately no real-stack e2e for them: per the assignment ("no conditional skips"), a test that needs KBE-R7's API would fail on this branch. It is left to the orchestrator's integrated run, or to a follow-up spec once KBE-R7 merges. The natural assertions are the ARCH-R6 §4.3 R3-6a and ranking worlds.
- **The Arabic texts** (rows 236–244 and the web labels) remain provisional until a native reviewer confirms them.

## 7. Merge instructions

- **No migration.** Rebuild `@mth/shared` after merging, as usual.
- **Order:** this branch can merge before or after KBE-R7. Its fixtures already typecheck with KBE-R7's closing step (§2.5).
- **Conflicts:** none expected; KBE-R7 does not own any file here.
- **After both merge:**
  - re-run `pnpm -r typecheck` and the dashboards unit folder;
  - run the full e2e; `p4-value-headlines` and `p4-dashboards` read the value area.
