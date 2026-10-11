# Handback T-DG4-KBE-R7 (kpi-benefits-engineer): the per-basis Value status (F-DG4-126), the Portfolio basis (F-DG4-127), currency-exact value drill-downs (F-DG4-105), missing planned amounts (D-123 item 3) and the contract closing step

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-R7-kpi-benefits-engineer-20261011T155259Z-5d68e0e2","session_id":"5d68e0e2-7bbc-4b51-afe1-a8ddd4b16519"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-R7.md`. Its sha256 `1052652b…87e8a1f0` matched the given value before I read it.
- **Base:** `HEAD` `5f0f016bf638d5456221a15f7efa55d757f03300`, branch `dg4/kbe-r7`. My first `git status` showed only the sandbox's untracked home files (see §6, item 6).
- **Timing:** `date -u` at the start: `Sun Oct 11 15:53:11 UTC 2026`. At the end: `Sun Oct 11 17:15:56 UTC 2026` (about 85 minutes; the 100-minute mark was not reached).
- **Changes:** all left **uncommitted**.
- **Ports:** only 26100–26149 were used: 26100–26109 for probes, affected tests and contract mutations; 26110–26119 for the A/B transcripts; 26120–26149 for the full integration run.
- **Disk:** 20 GB free before every full run (`disk-before-unit.txt`, `disk-before-integration.txt`). D-104's 3 GB floor was never approached.
- **Logs:** every log was written to `$TMPDIR` during its run and copied to the evidence directory afterwards. Nothing was written under `docs/delivery/` while a test run was in progress.
- **Process control:** no `pkill -f` or `pgrep -f` was used.
- **Not an approval.** I am an engineering agent, so nothing here is a business, Finance or IT approval.
  - The Finance validations in the fixtures are synthetic in-product approvals of synthetic test data.
  - Product gates G1–G6 are not touched. Product gate G6 never implies DG7, and DG7 is not claimed.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` ran before any write:
```
PASS gate DG3 (historical)
EXIT=0
```
It ran again at the end (§3, check 12).

## 1. Changed files

All files below are inside my ownership: the engine and API (ADR-0037 N4 "Owners": KBE-R7), my tests, the contract exercises and pending list, and the closing step. No file under `apps/web/**` is changed.

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/dashboards/areas.ts` | **F-DG4-126.** `valueArea` computes a gap per basis and currency where the basis has a counted, monetised benefit (`ValueCurrencyLine.topLineGap` / `nonCashGap`, new `BasisGap` and `ValueGapLine`). The Value RAG is `combine` over every line. `ruleParams.lines` is `{currency, headlineBasis, gapRatio, status, reasonKey}`, with no top-level `headlineBasis`. The `no_profit_and_cash_benefit` RAG branch is dropped (`nothing_due` when no line counts). New `gapValue()`. `InitiativeFact.valueReasonKey`. |
| `apps/api/src/modules/reporting/dashboards/engine.ts` | **F-DG4-127 and D-123 item 3.** New pure `initiativePlannedValues()`: a profit-and-cash allocated sum; `no_profit_and_cash_allocation` when only top-line or non-cash benefits are allocated; a missing profit-and-cash planned amount gives `benefit.value_amount_missing`. New `initiativeValue()`, shared with the drill-down. **F-DG4-126:** a top-line and a non-cash `value.gap` headline after each basis's states. **F-DG4-105:** `headline()` takes the figure's currency, so every value headline's href names it. `item()` gains `valueBasis`: `profit_and_cash` on initiatives, `basisOfClass` on financial benefits, null otherwise. |
| `apps/api/src/modules/reporting/dashboards/drilldown.ts` | **F-DG4-105.** The `currency` query parameter: 400 on a bad pattern; 422 `dashboard.currency_not_applicable` outside the value metrics; `currency` echoed. A drill-down with `currency` answers only that currency, and gives n/a with no item where the currency has no record of the basis (`no_benefit_in_class`, `no_profit_and_cash_benefit` or `no_financial_benefit`). Without `currency`, a scope of several value currencies gives `multiple_currencies`. `value.gap` takes `revenue_uplift` / `avoided_cost` (rule keys `gap_ratio_top_line` / `_non_cash`). `value.investment` narrows by currency. The `portfolio.initiatives` items use `initiativeValue`, with `headlineBasis: profit_and_cash`. `currency` enters the cursor hash only when given. |
| `apps/api/src/modules/reporting/dashboards/filters.ts` | `drilldownHref` gains `extra.currency`, appended after `valueClass` |
| `apps/api/src/modules/reporting/dashboards/finance.ts` | Class-line and gross-line hrefs carry their line's currency. `net` keeps `null`. |
| `apps/api/src/modules/reporting/dashboards/n4-value-basis.test.ts` | **new** unit tests with worked fixtures (§2.2) |
| `apps/api/src/modules/reporting/dashboards/areas.test.ts` | Pinned values re-baselined (§2.3) |
| `apps/api/test/integration/reporting/value-basis-n4.test.ts` | **new**: R3-6 (T10, workstream, Overview area and row, Finance headlines and row), R3-8, the ranking world and the missing amount, on the real API |
| `apps/api/test/integration/reporting/headline-basis.test.ts` | Re-baselined (§2.3). The drill invariant is sharpened (N4 item 3) and extended to probe GC. |
| `apps/api/test/integration/reporting/finance-drilldown-k1.test.ts` | Re-baselined (§2.3) |
| `apps/api/test/integration/contract/p4-exercises-kbe-g.ts` | The ARCH-R6 §4.3 contract exercises, through the validating client |
| `apps/api/test/support/p4-pending-arch-r6.ts` | Both lists emptied, with removal notes (§4) |
| `docs/api/openapi.yaml` | Closing step only (§4) |
| `packages/shared/src/schemas/dashboards.ts` | Closing step only (§4) |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-R7-kpi-benefits-engineer.md`, `…-evidence/**` | This handback, the logs, the A/B transcripts and the web fixture patch for FE-R6 |

## 2. Behaviour delivered, per requirement row

Acceptance texts, quoted from `requirements.csv`:
- **REQ-PB-063:** "A04;A05: an outcome whose tasks are 100% complete but KPI is below trajectory is Red/Amber, not Green; a KPI with no actual shows Unknown".
- **REQ-PB-062:** "A01;A04: all six areas render in en and ar from persisted data; each headline drills to contributing records".
- **REQ-S13-003:** "A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0".

The Outcomes rule and the KPI Unknown states are untouched. The Value area is the part of REQ-PB-063 that F-DG4-126 names. The en/ar rendering is FE-R6's.

### 2.1 Each finding against its own **expected** text (reproduction before → after)

The reviewers' probes were copied in for one run each and then removed: `zz-domain-r3.test.ts` and `probes/sec-dg4-r3-gross-currency.test.ts`.
- **Before** (`01-repro-before.log`, HEAD unchanged): exit 1, `Tests 3 failed | 6 passed (9)`. R3-6 (Green), R3-8 (`'435'`) and GC REPRO (`USD headline drills to a SAR value`) fail.
- **After** (`05-repro-after.log`): exit 1, `Tests 1 failed | 8 passed (9)`. R3-6, R3-8 and GC REPRO pass. **The one failure is R3-2,** whose line 143 pins the *old* revenue-only Value RAG `not_applicable`. D-123 item 1 accepted that this changes, and the T10 RAG is now `red` with lines `top_line` 1 and `non_cash` 1. R3-2's other assertions, before line 143, pass: the profit-and-cash headlines are n/a `no_profit_and_cash_benefit`, the gap is n/a, and top line is 300 and non-cash 45.

| Finding | Expected (its record) | After this change |
|---|---|---|
| **F-DG4-126** (REQ-PB-063) | "a gap ratio per basis and currency …, never summed across bases, with the Value RAG the worst of them"; the R3-6 worlds are not Green | R3-6a: `{status: red, ruleKey: dashboard.rag.value.validated_gap, lines: [SAR profit_and_cash "0" green, SAR top_line "1" red]}`. R3-6b: the same with `non_cash`. Both are red on T10, the workstream dashboard, the Overview area and its row, the Finance row and the Finance headlines (`value-basis-n4.test.ts`). The profit-and-cash amounts and gap are unchanged (70, 70, "0"). |
| **F-DG4-127** (REQ-PB-062) | "The initiative figure should be on the profit-and-cash basis (90 here) …; the ranking 'by value' should then use that basis" | R3-8: `{state: value, value: "90", currency: SAR}`, `valueBasis: profit_and_cash`; no "435" in the response. Ranking world: INI-B 70, then INI-A n/a `dashboard.portfolio.no_profit_and_cash_allocation`, then INI-C unknown `no_allocated_value`. Before, INI-A (300) ranked first. |
| **F-DG4-105** (REQ-S13-003) | "the drill-down of the USD n/a headline, and of the USD gross line, should be n/a … and list no item" | Probe GC: the USD headline's href is `…&currency=USD`. It drills to `{not_applicable, currency USD, no_profit_and_cash_benefit}`, `items: []`, `currency: "USD"`. The USD gross line has the same href and the same answer. SAR drills to SAR 70 with item B01. Without `currency`: `multiple_currencies` (it was SAR 70). |

### 2.2 Worked fixtures

**Unit:** `n4-value-basis.test.ts`, 12 tests.
- R3-6a and R3-6b;
- probe GC;
- revenue only (red; was n/a);
- the bases assessed separately: profit and cash 100/90, top line 1000/1000. **Amber**, never the summed ratio of 0.009 (green);
- unknown and nothing due;
- `gapValue`'s four states;
- **a 500-set property:**
  - the RAG equals `combine` of independently recomputed per-basis lines;
  - each line is its own basis's exact gap;
  - the RAG is never green beside a red, amber or unknown line;
- **Portfolio:**
  - R3-8: 90;
  - the ranking world;
  - **D-123 item 3:** a profit-and-cash planned line with a null amount makes the initiative `unknown` with `benefit.value_amount_missing`. As built it was 90, with the line skipped. A null *top-line* amount changes nothing;
  - the share and money scale: 100.00005 × 0.333333 + 10 × 0.5 = 38.3333 (half-even). Not-counted and other-currency benefits are left out.

**Integration:**
- **`value-basis-n4.test.ts`** (5 tests):
  - R3-6 on all four surfaces, with the basis's gap drill-down: rule key `gap_ratio_<basis>`, inputs `planned_SAR` 300 and `validated_SAR` 0, items [300];
  - R3-8, with `valueBasis` checked on every item;
  - the ranking world and its `portfolio.initiatives` drill-down: the same values, `headlineBasis: profit_and_cash`;
  - the missing planned amount, through the API (`amount: null`).
- **`headline-basis.test.ts` "F-DG4-105 (probe GC)":** the extended drill invariant, for a currency with no profit-and-cash benefit (USD) beside one with it (SAR). It covers T10, Overview, Finance, the header and **every Finance line**.
  - **Per figure:** the href names the currency; the drill-down echoes it; every item is in it; the item sum equals the figure. The one exception is the USD gross zero, which drills to n/a with no item.
  - **Narrowing:** `no_benefit_in_class` and an EUR `no_financial_benefit` (each with no item), and `multiple_currencies` without `currency`.
  - **The invariant itself is sharpened for every world in that file.** It now also checks the drill-down's `currency`, each item's currency, `value` deep-equal to the headline, and the `value.gap` headlines, which were skipped before.

### 2.3 Tests that pinned the changed behaviour (old → new)

| Test | Old | New |
|---|---|---|
| `areas.test.ts` DOM-GROSS | `ruleParams.headlineBasis` "profit_and_cash" | absent; `lines` = profit_and_cash, top_line and non_cash, each "1" red |
| `areas.test.ts` variant A | RAG `{not_applicable, dashboard.rag.value.no_profit_and_cash_benefit, {}}` | `{red, validated_gap, lines [SAR top_line 1 red, SAR non_cash 1 red]}`; `topLineGap` / `nonCashGap` asserted |
| `areas.test.ts` variant A per currency | RAG green | red; lines [SAR top_line 1 red, USD profit_and_cash 0 green] |
| `areas.test.ts` variant B | `{not_applicable, nothing_due}` | `{red, validated_gap}`; top-line gap 1 red |
| `areas.test.ts` unknown margin line | `withMargin.rag` unknown | red (the profit-and-cash line stays unknown, asserted); the top-line and non-cash gaps are 1 |
| `areas.test.ts` `initiative()` fixture | — | `valueReasonKey: null` (type only) |
| `headline-basis.test.ts` DOM-GROSS | 1 `value.gap` headline; order without the per-basis gaps; `ruleParams.headlineBasis` "profit_and_cash" | 3 gaps (top line and non-cash "1", `…_top_line` / `…_non_cash` labels, hrefs `valueClass=…&currency=SAR`); the order gains `value.gap/top_line` and `value.gap/non_cash`; no top-level `headlineBasis`; 3 lines |
| `headline-basis.test.ts` variant A | T10/Overview RAG n/a `no_profit_and_cash_benefit`; Overview row n/a | red `validated_gap` (lines top_line, non_cash); row red |
| `headline-basis.test.ts` variant B | `{not_applicable, nothing_due}` | `{red, validated_gap}`, lines [profit_and_cash n/a nothing_planned, top_line red] |
| `headline-basis.test.ts` `assertDrillInvariant` | skipped `value.gap`; no currency checks | also checks gaps, the href and echoed currency, each item's currency, and the value equal to the headline |
| `finance-drilldown-k1.test.ts` refusal loop | `value.gap` + `revenue_uplift` → 422 | `value.gap` + `revenue_uplift` → 200 (the top-line gap, N4 item 1); the loop now sends `value.gap` with `margin_uplift` and `non_financial_valued` (still 422) |
| `finance-drilldown-k1.test.ts` measured, rejected, sustained without class (world X: SAR and USD) | value = SAR profit-and-cash sum | without `currency`: n/a `multiple_currencies`; the SAR sum is now asserted with `currency=SAR` |
| `finance-drilldown-k1.test.ts` `value.sustained&valueClass=margin_uplift` | known zero SAR | without `currency`: `multiple_currencies`; with `currency=SAR`: known zero SAR |

**Not edited, and green unchanged:** `tests/qa/integration/a04-a05-a10-partials.test.ts` and `a04-kpi-propagation.test.ts` (QA-owned), and every other reporting test. They follow hrefs as sent.

### 2.4 The contract closing step

`P4_PENDING_ARCH_R6_MEMBERS` and `P4_PENDING_ARCH_R6_PARAMETERS` are empty (§4), so ARCH-R6 handback §4.1 item 6 was applied exactly. `git diff docs/api/openapi.yaml` is 5 lines, and the zod diff is the two members and their comments:
- **`DashboardItem.required`:** `…, ownerUserId, flags, valueBasis]`.
- **`DashboardDrilldown.required`:** `…, nextCursor, headlineBasis, currency]`.
- **The two member descriptions:** "Not yet required: pending in p4-pending-arch-r6.ts." became "Required since the API emits it (T-DG4-KBE-R7).".
- **The info paragraph:** "The two members are declared but not yet required: pending in `p4-pending-arch-r6.ts` until the API emits them." became "The two members are required since the API emits them (T-DG4-KBE-R7).".
- **`dashboards.ts`:** `.optional()` was removed from `dashboardItem.valueBasis` and `dashboardDrilldown.currency`, and the two comments now say "required since the API emits it (T-DG4-KBE-R7)".

Nothing else in either file changed.

**The contract test fails without each member.** Each was a temporary local mutation, reverted and checked with `cmp`:
- **`04a`:** `item()` and the two call sites no longer emit `valueBasis`. The run exits 1, `Tests 2 failed | 44 passed (46)`: "getTransformationDashboard 200 body violates the schema: data/areas/0/items/0 must have required property 'valueBasis'".
- **`04b`:** the drill-down no longer echoes `currency`. The run exits 1, `2 failed | 44 passed`: "getDashboardDrilldown 200 body violates the schema: data must have required property 'currency'".
- **With both members** (`03-affected-after.log`), the contract project passes.

### 2.5 Byte stability (response-transcript method; `evidence/ab/`)

**Method:**
- **A** = this worktree at HEAD `5f0f016`, recorded **before any edit**. **B** = the final tree.
- `ab/kbe-r7-transcript.test.ts` is KBE-R6's transcript test, extended:
  - **its worlds:** X, G, R, N and E, plus GC (probe GC), S6 (R3-6a) and P (the Portfolio ranking, INI-A to INI-D);
  - **its requests:** the per-world dashboards, header, Finance and Overview; org-wide Overview, Finance and adoption; a workstream;
  - **its drill-downs:** 7 value metrics × (no class + 6 classes) and 4 other metrics for X, G, R, GC, S6, P and the organization; then, for each scope, `currency=SAR` and `USD` on `value.planned`, `validated`, `gap` and `investment`; `value.gap` with `revenue_uplift`, `avoided_cost` and `margin_uplift` (each with and without `currency=SAR`); USD top line; `portfolio.initiatives`; `decisions.open&currency=SAR`; `currency=sar`.
- **Runs:** **533 requests**, the same in A and B. A exits 0; B exits 0.
- **Comparison:** `compare.py` (KBE-R5's, unchanged) wrote `compare.txt`, and the new `summary.py` classified it into `summary.txt`.

**Result (`summary.txt` line 1):** 13 byte-identical; **269 differ only by the two required members** (`valueBasis` on items, the drill-down's `currency`); 7 only by those and `&currency=` on hrefs; 3 only by those and the new top-line and non-cash gap headlines; **241 carry other changes**. `summary.txt` aggregates every changed path with an example. All are N4 changes:
- **`DashboardRag` (Value):**
  - `ruleParams.headlineBasis` removed;
  - `lines[]` gains `headlineBasis` and `reasonKey`, plus a line per present top-line or non-cash basis;
  - `status` and `ruleKey`: R n/a `no_profit_and_cash_benefit` → red `validated_gap`; S6 green → red; GC's USD line (was n/a) → top line 1 red.
- **`areaStatuses[value]`** on the Overview, Finance and adoption rows: the same changes.
- **Headlines:** the new gap headlines, and every value href gains `&currency=<c>`.
- **Portfolio items** (T10, Overview, `portfolio.initiatives` drill-down): world P 300 → n/a `no_profit_and_cash_allocation` for INI-A, and the 80 (35 + 45) → 35 for INI-D. The order changes to profit-and-cash value first.
- **Drill-downs:**
  - 105 responses newly n/a `multiple_currencies`: **all** in the multi-currency scopes X (42), org (42) and GC (21), none with `currency` or `subjectId` (`multiple-currencies-check.txt`);
  - the `currency=` requests: A 400 `validation.unknown_field` → B 200, or 422 `currency_not_applicable` / `value_class_not_applicable`;
  - `value.gap` + `revenue_uplift` / `avoided_cost`: 422 → 200.

**Changed members, listed:**
- `DashboardItem.valueBasis` (added);
- `DashboardDrilldown.currency` (added);
- `DashboardRag.ruleParams` of `validated_gap`;
- `DashboardRag.status` / `ruleKey` (Value);
- `T10Area.headlines` (the new gaps);
- `DashboardHeadline.drilldownHref` (`currency`);
- `FinanceValueLine.drilldownHref` (`currency`);
- `DashboardItem.value` (Portfolio);
- `areaStatuses[].status` (Value);
- `DashboardDrilldown.value`, `.items`, `.calculation` and `.headlineBasis` (`portfolio.initiatives`, `value.gap` by basis).

The B transcript was re-recorded on the final, prettier-formatted tree, and its classification is unchanged.

## 3. Checks actually run

**Environment:** this worktree, Linux sandbox, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, and PostgreSQL through `tests/qa/support/with-pg.sh` on ports 26100–26149.

| # | Command | Result | Log |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | **exit 2: fails in `apps/web` only.** The 3 TS2741 errors are in FE-owned `dashboardFixtures.ts` (valueBasis × 2, currency × 1), the consequence ARCH-R6 §4.1 item 6 warned of. `--no-bail`: every other package is `Done`. **With the verified FE patch applied temporarily: exit 0.** See §5. | `11-typecheck.log`, `11b-…no-bail.log`, `11c-…with-fe-patch.log` |
| 2 | `pnpm -r build` | **exit 2: the same `apps/web` tsc errors**; every other package is `Done`. **With the FE patch: exit 0.** | `12-build.log`, `12b-build-with-fe-patch.log` |
| 3 | `pnpm lint` | **exit 0** | `10-lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**: "All matched files use Prettier code style!" in every batch. Run last, with this handback present. | `14-prettier.log` |
| 5 | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` | `13-openapi-lint.log` |
| 6 | `pnpm test`, locale unset | **exit 1.** Invocation 1 (unit-node, unit-web): `Test Files 1 failed \| 146 passed (147)`, `Tests 6 failed \| 2825 passed (2831)`. **All 6 failures are `apps/web/src/i18n/problems-slices-hijk.test.ts`** (EN and AR): `expected [ 'dashboard.currency_not_applicable' ] to deeply equal []`, the web-owned translation of the ARCH-R6 refusal row (D-123 item 2; FE-R6 adds it). Because of `&&`, invocation 2 does not run, so it was run directly (row 8). | `21-unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 1**: identical counts and the same 6 failures | `22-unit-c-utf8.log` |
| 8 | `pnpm exec vitest run --project unit-formula-nocodegen` (invocation 2), both locales | **exit 0** each: `Test Files 3 passed (3)`, `Tests 259 passed \| 2 skipped (261)` | `23-…`, `24-…` |
| 9 | `QA_PG_PORT=26120 MTH_PORT_POOL=26121-26149 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: `Test Files 207 passed (207)`, `Tests 1966 passed (1966)`, 1164 s. **Pinned-count change: +6** over round 3's 1960 (`value-basis-n4.test.ts` +5, `headline-basis.test.ts` +1). The contract project's count is unchanged at 46. | `31-integration.log` |
| 10 | Affected suites (reporting, contract, the two QA A04 files) | first pass after the engine change: exit 1, `6 failed \| 163 passed (169)` (the pins of §2.3); after re-baselining and the new tests: **exit 0**, `175 passed (175)` | `02-…`, `03-…` |
| 11 | Probes before and after; contract mutations; A/B transcripts | §2.1, §2.4, §2.5 | `01`, `05`, `04a`, `04b`, `ab/` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**, `PASS gate DG3 (historical)`, at the start and at the end | `validate-dg3-historical*.log` |
| 13 | The FE fixture patch: `pnpm --filter @mth/web typecheck` and the web dashboards and components tests, with the patch | exit 0; `Tests 104 passed (104)`. Reverted with `git apply -R`; `git diff -- apps/web` is empty. | `06a-…`, `06b-…` |

**A non-zero exit fixed during the run, disclosed:**
- **What:** my first `pnpm test` run (not kept; the logs were overwritten by the rerun) also failed `apps/api/src/architecture.test.ts` and `reporting/reporting.test.ts`.
- **Why:** my new `n4-value-basis.test.ts` used two computed members with non-literal keys (`classes[...]`, `amounts[i]`), which the AST module-interface guard refuses.
- **Fix:** I replaced them with `.at()`. The two tests then passed: `Tests 201 passed` over `architecture.test.ts` and `modules/reporting/`.
- **Rerun:** rows 1–4 were re-run after that edit on the final tree.

## 4. Operations routed (delta to the pending lists)

- **`P4_PENDING_ARCH_R6` (operations):** `[]` → `[]`. No operation was added, so the count stays at 652.
- **`P4_PENDING_ARCH_R6_MEMBERS`:** 2 → **0**. `DashboardItem.valueBasis` is emitted on every DashboardItem of `getTransformationDashboard`, `getWorkstreamDashboard`, `getExecutiveOverview`, `getAdoptionDashboard` and `getWorkspaceHeader`. `DashboardDrilldown.currency` is emitted on every `getDashboardDrilldown` response.
- **`P4_PENDING_ARCH_R6_PARAMETERS`:** 1 → **0**. `getDashboardDrilldown` `currency` is exercised in `p4-exercises-kbe-g.ts`:
  - SAR, 200, `currency: "SAR"`, 70;
  - USD, 200, n/a, `items: []`;
  - `value.gap&valueClass=revenue_uplift&currency=SAR`, 200, `top_line`, "1";
  - `value.investment&currency=SAR`, 200, zero;
  - `decisions.open&currency=SAR`, 422 `dashboard.currency_not_applicable`;
  - `currency=sar`, 400;
  - `value.gap&valueClass=margin_uplift`, 422 `dashboard.value_class_not_applicable`.

## 5. For the orchestrator: contract, schema and web

1. **The web fixtures (assignment item 5).**
   - **What breaks:** the closing step breaks `apps/web` typecheck and build until FE-R6's fixtures carry the members.
   - **The patch:** `T-DG4-KBE-R7-evidence/web-fixtures-for-fe.patch` adds `valueBasis: null` to the two literal DashboardItems and `currency: "SAR"` to `drilldown()` in `dashboardFixtures.ts`.
   - **Verified:** with it, `pnpm -r typecheck` and `pnpm -r build` exit 0, and the 104 dashboards and components tests pass.
   - **Not applied:** `apps/web/**` is FE-R6's.
   - **What FE-R6 can do instead:** if FE-R6 already added the members (its §4.2 item 6), drop the patch.
   - **Recommended in addition** (cosmetic): FE-R6 also moves the fixture at `dashboardFixtures.ts:562` to the N4 `lines` shape.
2. **`problems-slices-hijk.test.ts`** stays red (6 tests) until FE-R6 adds the `dashboard.currency_not_applicable` text (D-123 item 2). It is not changed by me.
3. **No contract or schema gap** was found in the ARCH-R6 design. Two readings I made inside it, stated for the reviewers:
   - **(a) `value.gap` without `currency` for a top-line or non-cash basis absent from the scope's one value currency:** n/a `dashboard.value.no_benefit_in_class` with that currency. N4 names the reason only for the `currency` case. I used the `valueClass` rule for consistency.
   - **(b) The "Several value currencies" rule** applies with or without `valueClass`, as N4 item 3 reads. So a single-class drill-down in world X (SAR and USD) is n/a without `currency`, even when the class exists in one currency only. The Finance class-line hrefs all carry `currency`, so no figure's drill is affected.
4. **Domain note (D-123 item 4):** the Portfolio item labels its basis and does not list the other bases, as designed.

## 6. Known gaps and what remains

1. **Acceptance 1 is not met on this tree alone:** `pnpm -r typecheck` and `pnpm -r build` exit 2, at `apps/web` only (§3 rows 1–2). The fix is FE-owned (§5 item 1).
2. **Acceptance 2:** `pnpm test` exits 1 under both locales, with exactly the 6 FE-owned translation-guard tests (§5 item 2). Everything else passes, including invocation 2.
3. **Acceptance 3 and 4 are met:** integration 1966/1966, and DG3 historical exits 0.
4. **The reviewer probe R3-2** asserts the retired revenue-only n/a. It fails by design after D-123 item 1 (§2.1).
5. **Not run:** e2e (not in the acceptance list).
6. **Untracked files not mine:** the sandbox's home artifacts at the worktree root (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`) were present at my first `git status`. I did not create, edit or delete them. Prettier `--ignore-unknown` passed with them present.

## 7. Merge instructions

- **No migration.** Rebuild `@mth/shared` after merging (`pnpm --filter @mth/shared build`).
- **Order:** merge FE-R6's fixture members and `problems.json` text no later than this change. Otherwise apply `web-fixtures-for-fe.patch`; without one of the two, `apps/web` typecheck stays red.
- **Conflicts to expect:** none in file terms. I touched no `apps/web/**` file, and FE-R6 owns no file I changed.
- **After merging, check:** `pnpm openapi:lint` (652), `pnpm -r typecheck`, `pnpm test`, and the contract project.
