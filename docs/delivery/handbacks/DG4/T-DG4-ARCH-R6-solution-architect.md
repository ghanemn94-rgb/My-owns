# Handback T-DG4-ARCH-R6 (solution-architect): the Value status per basis (F-DG4-126), the Portfolio item basis (F-DG4-127), currency-exact value drill-downs (F-DG4-105)

## Run details

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-ARCH-R6-solution-architect-20261011T152919Z-1d0d0b17","session_id":"1d0d0b17-9f8b-4bab-947a-cc19b52ff0a8"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-R6.md`. Its sha256 `1273ebf1…1debc` was verified before reading.
- **Base:** `HEAD` `de2504d1f77d3f2c9ff152a559ffdfb87f542762`, branch `dg4/arch-r6`.
- **Timing:** started 2026-10-11T15:29:31Z (`date -u`); ended at about 15:45Z, inside the 60-minute estimate.
- **Changes:** all left **uncommitted**, as the assignment asks.
- **Ports:** only the harness ports 23700–23749 were used.
- **Not an approval.** I am an engineering agent: nothing here is a business, Finance or IT approval. Product gates G1–G6 are not touched, and DG7 is not implied.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` ran before any write:
```
PASS gate DG3 (historical)
EXIT=0
```
It ran again at the end with the same result (§3, check 7).

## 1. Changed files, with every changed line and its reason

### 1.1 Files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` | Amendment **N4** (dated 2026-10-11): D-122 items 1–5, the supersessions, examples, contract, owners and code rows |
| `docs/architecture/adr/ADR-0030-p4-benefit-values-finance-validation-totals.md` | Amendment **N4**: the totals side of D-122 items 1–5 and what it supersedes |
| `docs/api/openapi.yaml` | One new parameter, two members, the new refusal on the operation, and meaning-change descriptions |
| `packages/shared/src/schemas/dashboards.ts` | zod mirrors: `dashboardItem.valueBasis` and `dashboardDrilldown.currency` (`.optional()`), and the new refusal text |
| `apps/api/test/support/p4-pending-arch-r6.ts` | **new**: the pending members and parameter (the ARCH-R5 pattern), plus the closing step |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R6-evidence/codes-table.md` | **new**: code table rows 236–245, with EN (exact) and AR (proposed) |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R6-solution-architect.md` | this handback |

`git diff` against the base touches only these files (§3, check 8).

### 1.2 `docs/api/openapi.yaml`: every hunk

Line numbers are in the new file. The new file's sha256 is `7cc9ec94…a07d91`.

| New lines | What changed | Reason |
|---|---|---|
| 136–149 | `info.description`: a new paragraph "P4 repairs (T-DG4-ARCH-R6 …)". It lists the additive changes and the meaning changes, and states that the members are not yet required. | Record of the change (the ARCH-R5 pattern) |
| 16309 | `getDashboardDrilldown.summary`: adds "dashboard.currency_not_applicable (ADR-0037 amendment N4)" to the 422 list | New refusal, N4 item 3 |
| 16313 | `getDashboardDrilldown.parameters`: adds `$ref: DrilldownCurrencyQuery` | New optional parameter, N4 item 3 |
| 17265 | `DrilldownValueClassQuery.description`: `value.gap` accepts `revenue_uplift` / `avoided_cost`; any other class on `value.gap` is 422 | **Meaning change**, N4 item 1 (the per-basis gap drill-down) |
| 17267–17272 | **new** `components/parameters/DrilldownCurrencyQuery`: `currency`, query, `required: false`, `pattern ^[A-Z]{3}$`, with the full rule as its description | N4 item 3 |
| 28166 | `DashboardRag.ruleParams`: adds a description of the `validated_gap` shape (`lines[]` with `headlineBasis` and `reasonKey`, the worst-of rule; no top-level `headlineBasis`). The schema is still `type: object`. | **Meaning change**, N4 item 1 |
| 28170 | `DashboardHeadline.description`: `value.gap` once per basis and currency; worst-of; every value href carries `currency=` | **Meaning change**, N4 items 1 and 3 |
| 28179 | `DashboardHeadline.headlineBasis.description`: `value.gap` may be any basis | **Meaning change**, N4 item 1 |
| 28196 | `DashboardItem.value`: adds a description of the Portfolio initiative figure (profit-and-cash, the n/a reason, unknown unchanged) | **Meaning change**, N4 item 2 |
| 28199 | **new** `DashboardItem.valueBasis` (`HeadlineBasis` or null), **not** in `required` | N4 item 2 (the basis label) |
| 28295 | `FinanceValueLine.drilldownHref.description`: class and gross hrefs carry `currency=`; a gross zero in a currency with no profit-and-cash benefit drills to n/a with no item | **Meaning change**, N4 item 3 |
| 28310 | `FinanceDashboard.headlines.description`: the top-line and non-cash headlines carry a gap each; each drills to its own currency | **Meaning change**, N4 items 1 and 3 |
| 28381 | `DashboardDrilldown.description`: `value.gap` by basis; `currency`; `multiple_currencies` without it in a scope of several value currencies | **Meaning change**, N4 items 1 and 3 |
| 28393 | `DashboardDrilldown.headlineBasis.description`: `value.gap` with a class, and `portfolio.initiatives` = `profit_and_cash` | **Meaning change**, N4 items 1 and 2 |
| 28394 | **new** `DashboardDrilldown.currency` (string or null, `^[A-Z]{3}$`), **not** in `required` | N4 item 3 |
| 28462 | `WorkspaceHeader.benefits.description`: the header hrefs name their currency | **Meaning change** (hrefs only), N4 item 3 |

**What did not change:**
- No `required` list changed.
- No operation was added: still **652**.
- No status, enum or metric changed.
- `info.version` stays `1.3.0-p4`, as in ARCH-R5.

### 1.3 `packages/shared/src/schemas/dashboards.ts`

The new file's sha256 is `5fbb301308b2…c41c4b`. The pending file's is `31daff66…58571b`.

| New lines | What changed | Reason |
|---|---|---|
| 143–146 | The `dashboardItem` doc comment: `valueBasis` is `.optional()` until KBE-R7 | Pending-member record |
| 158–159 | `valueBasis: headlineBasis.nullable().optional()` | Mirror of `DashboardItem.valueBasis` |
| 296–304 | `currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional()`, with its comment | Mirror of `DashboardDrilldown.currency` |
| 393–395 | `DASHBOARD_REFUSALS["dashboard.currency_not_applicable"]`, the exact N4 text | The API's `dashboardRefusal()` reads its `detail` here (filters.ts) |

### 1.4 The ADRs

Both changes are appends only. ADR-0037 gains 164 lines after line 457, and ADR-0030 gains 45 lines after line 280. Nothing earlier is edited. Each amendment:
- states D-122 items 1–5;
- names what it supersedes:
  - **ADR-0037 N3 item 2:** "there is no gap ratio or RAG on them";
  - **N3 item 1, for the RAG:** "the value-gap ratio and the Value RAG";
  - **N3 item 4's "The Value RAG" bullet**, and the top-level `ruleParams.headlineBasis`;
  - **§3's Portfolio ordering;**
  - **N3 item 3, for the hrefs;**
  - **KBE-R6 §5.3 (d);**
- cites B0095, M0248, M0172 and B0145.

## 2. Behaviour delivered (design; the code is KBE-R7's and FE-R6's)

- **F-DG4-126** (REQ-PB-063): ADR-0037 N4 item 1 and ADR-0030 N4 item 1.
  - **The gap ratio:** one per basis and currency, only where that basis has a counted, monetised benefit in that currency.
  - **Never summed** across bases.
  - **The Value RAG** is the worst of the lines' statuses (`combine`). `ruleParams.lines` lists each line as `{currency, headlineBasis, gapRatio, status, reasonKey}`.
  - **The gap headlines:** one per basis, labelled with its basis.
  - **The headline amounts** are unchanged.
- **F-DG4-127** (REQ-PB-062): N4 item 2.
  - **The figure and the ranking** are on the profit-and-cash basis.
  - **Only top line or non-cash allocated:** `not_applicable` `dashboard.portfolio.no_profit_and_cash_allocation`, ranked after the valued initiatives.
  - **Nothing allocated:** `unknown`, unchanged.
  - **The label:** `DashboardItem.valueBasis`.
- **F-DG4-105** (REQ-S13-003): N4 item 3.
  - **The parameter:** an optional `currency`, and `DashboardDrilldown.currency` echoing it.
  - **Every value headline and Finance line** carries an href with its currency.
  - **No record of the basis in the currency:** n/a with no item.
  - **Without `currency`:** unchanged in a scope of one value currency, otherwise `multiple_currencies`.
- **Unchanged (D-122 item 5):**
  - the N3 headline amounts;
  - the per-class lines;
  - the Finance validation rules;
  - gross, net and cost;
  - the DG3 business-case totals.

**One consequence I state rather than hide.** Item 1's rule ("each only where that basis has a counted benefit") means a revenue-only (or avoided-cost-only) transformation now has the status of that basis's gap. Before, the Value RAG was `not_applicable` (`dashboard.rag.value.no_profit_and_cash_benefit`). That rule key is therefore retired (code row 241).
- The round-3 domain reviewer called the old n/a "acceptable", not required, and the rule it proposed implies the new status.
- Its profit-and-cash headlines stay n/a, as N3 decided.
- If the orchestrator wants the old n/a kept for that case, that is a narrower rule than D-122 item 1, and it is not designed here.

## 3. Checks actually run

Environment: this worktree, Linux sandbox, Node and pnpm from the repository toolchain, with no network. The disposable PostgreSQL ran on harness port 23700.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm openapi:lint` | **exit 0**: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` |
| 2 | `pnpm -r typecheck` | **exit 0** (every package, `apps/web` included) |
| 3 | `pnpm lint` | **exit 0** (`eslint . --max-warnings=0`) |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**: "All matched files use Prettier code style!" in every batch |
| 5 | `pnpm --filter @mth/shared build`, then `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/contract/` | build exit 0; **contract exit 0**: `Test Files 2 passed (2)`, `Tests 46 passed (46)`, 51.8 s |
| 6 | `pnpm exec vitest run --project unit-web apps/web/src/i18n/problems-slices-hijk.test.ts` (**not** an acceptance check; run to see the effect of the new refusal row) | **exit 1, expected:** `Tests 6 failed \| 12 passed (18)`, `expected [ 'dashboard.currency_not_applicable' ] to deeply equal []` (EN and AR). See §5, item 1. |
| 7 | `node tools/gates/validate.mjs --historical --stage DG3` | **exit 0**: `PASS gate DG3 (historical)` (at the start, and again at the end) |
| 8 | `git status --short`, `git diff --stat` | Only the files in §1.1. See also §5, item 4. |

**Not run:** integration beyond the contract project, e2e and the unit suites. No product behaviour changed: the API and the web are untouched, and the new zod members are optional.

## 4. Implementation notes for KBE-R7 and FE-R6

### 4.1 KBE-R7 (engine and API)

**1. `areas.ts` `valueArea` (N4 item 1).**
- **Lines.** For each currency *c* of `valueCurrencies` and each basis *b* of `VALUE_BASES` where `has(b)`, compute the sums of *b* (already done for `topLine` and `nonCash`). Then compute `valueGapStatus(sums.planned, sums.validated, policy)`. Add `ValueCurrencyLine.topLineGap` and `nonCashGap`: `{gapRatio, status, reasonKey}` or null.
- **The area status** is `combine(all lines' statuses)`, where `lines` = every (currency, basis) with `has(b)`, ordered by currency, then basis. When it is `null`: `{not_applicable, "dashboard.rag.value.nothing_due", {}}`. Drop the `no_profit_and_cash_benefit` RAG branch.
- **`ruleParams`** = `{amberRatio, redRatio, lines: [{currency, headlineBasis, gapRatio, status, reasonKey}]}`, with no top-level `headlineBasis`.
- **What stays as is:** the profit-and-cash `planned…validated`, `gapRatio`, `status` and `reasonKey` of each currency line (the headline amounts).

**2. `engine.ts` `presentAreas` (N4 items 1 and 3).**
- After the `top_line` state headlines, push a `value.gap` headline: `dashboard.headline.value_gap_top_line`, basis `top_line`. Do the same for `non_cash` (`…_non_cash`). Its value is built like the profit-and-cash gap's: known ratio with currency, `unknown` with currency, or `nothing_planned` n/a with currency null.
- `headline()` gains a `currency` argument, and every value headline passes its own currency: the state metrics, the gap and `value.investment`. The `no_financial_benefit` headline passes none.
- `drilldownHref` (filters.ts) gains `extra.currency`, appended **after** `valueClass`.
- For the gap headline, `valueClass` is `revenue_uplift` / `avoided_cost` by basis, as `headline()` already does.

**3. `engine.ts` Portfolio (N4 item 2).**
- Split `plannedOf` by basis, using `basisOfClass`. `allocatedOf` sums only `profit_and_cash`. A second map, `otherAllocatedOf`, sums the other two only to know that some exist.
- `InitiativeFact` gains `valueReasonKey: string | null`:
  - **`null`** when the profit-and-cash sum exists;
  - **`dashboard.portfolio.no_profit_and_cash_allocation`** when only the other map has the initiative;
  - **`dashboard.portfolio.no_allocated_value`** otherwise.
- The item value is:
  - **valued:** `knownValue(pc)`;
  - **only top line or non-cash:** `{...notApplicableValue(NO_PC_ALLOC, "currency"), currency: plannedCurrency}`;
  - **nothing allocated:** `unknownValue("dashboard.portfolio.no_allocated_value", …)`.
- `comparePortfolio` is unchanged: n/a and unknown are both `plannedAllocated: null`.
- `item()` gains `valueBasis` (default null):
  - **Portfolio items:** `profit_and_cash`;
  - **Value-area benefit items:** `basisOfClass(b.valueClass)` when financial and monetised, else null.
- **The same in `drilldown.ts`:** the `portfolio.initiatives` items take the same value rule (lines 425–427 today), and that drill-down's `headlineBasis` becomes `profit_and_cash`.
- **The header:** `workspace-header.ts` `keyDecisions.items` are DashboardItems, so they carry `valueBasis: null`.

**4. `drilldown.ts` (N4 item 3).**
- **The query.** `drilldownQuery` gains `currency: z.string().regex(/^[A-Z]{3}$/).optional()`, which gives 400 on a bad format.
- **The refusal.** In `drill()`, a `currency` with a metric outside the seven value states, `value.gap` and `value.investment` is `dashboardRefusal("dashboard.currency_not_applicable", "/currency")`.
- **`valueClass` on `value.gap`.** Allow it only with `revenue_uplift` or `avoided_cost`; anything else is `dashboard.value_class_not_applicable`.
- **`valueDrill` with currency *c*:**
  - Filter `lines`, `eligible` and `financial` to `b.currency === c`, after `subjectId`.
  - If `eligible` is empty, the value is `{...notApplicableValue(reason, "currency"), currency: c}`, with `items: []` and `inputs: []`. The reason is:
    - **`valueClass` given:** `dashboard.value.no_benefit_in_class`;
    - **else, `financial` not empty:** `NO_PROFIT_AND_CASH`;
    - **else:** `dashboard.value.no_financial_benefit`.
  - Otherwise the value is the single *c* sum.
- **`valueDrill` without currency:** if `eligible` is empty, give the N3 reasons, unchanged. Otherwise, when `subjectId` is null and the scope's value currencies (`valueCurrencies(ctx.facts.benefits)` ∪ the eligible currencies) number more than one, the value is n/a `dashboard.value.multiple_currencies`. Items and inputs are as today. Otherwise the behaviour is today's.
- **`value.gap`:**
  - **The basis:** from `valueClass` (none means profit and cash).
  - **The items:** that basis's lines, and only *c*'s when `currency` is given.
  - **The value:** the area's gap for (basis, *c*); without currency, the area's rule as today, applied to the basis.
  - **The calculation:** rule key `dashboard.value.gap_ratio` / `…_top_line` / `…_non_cash`, `inputs` `planned_<c>` and `validated_<c>` of the basis, and `headlineBasis` by basis.
- **`value.investment` with *c*:** *c*'s lines, and a known zero in *c* when there are none.
- **The echo:** every drill-down response sets `currency: query.currency ?? null`.

**5. `finance.ts` (N4 item 3).**
- Class lines: `drilldownHref(…, {transformationIds, valueClass: l.valueClass, currency: l.currency})`.
- Gross lines: `hrefOf` gains the currency.
- The `net` line keeps `null`.

**6. The closing step, in the same change once both members are emitted:**
- **In `openapi.yaml`:**
  - add `valueBasis` to `DashboardItem.required` (after `flags`);
  - add `currency` to `DashboardDrilldown.required` (after `headlineBasis`);
  - in both member descriptions, replace "Not yet required: pending in p4-pending-arch-r6.ts." with "Required since the API emits it (T-DG4-KBE-R7).";
  - in the info paragraph, replace "The two members are declared but not yet required: pending in `p4-pending-arch-r6.ts` until the API emits them." (wrapped across lines 142–143) with "The two members are required since the API emits them (T-DG4-KBE-R7).".
- **In `dashboards.ts`:** remove `.optional()` from `dashboardItem.valueBasis` and `dashboardDrilldown.currency`, and update their two comments.
- **In `p4-pending-arch-r6.ts`:** empty `P4_PENDING_ARCH_R6_MEMBERS` and `P4_PENDING_ARCH_R6_PARAMETERS`, with a removal note as KBE-R6 wrote.
- **Nothing else changes in these files.**
- **Warning (the KBE-R6 lesson, D-121):** dropping `.optional()` breaks the FE-owned web fixtures' typecheck (`dashboardFixtures.ts`), unless FE-R6 has already added `valueBasis` to each fixture DashboardItem and `currency` to each fixture drill-down (item 4.2.6).

### 4.2 FE-R6 (web)

1. **Labels.** Rows 236–239 (the per-basis gap labels and rules) and 242–243 (the reasons), in `dashboards.json` EN/AR. The Arabic is proposed and provisional.
2. **The refusal text.** Row 244, `dashboard.currency_not_applicable`, in `problems.json` EN/AR. `problems-slices-hijk.test.ts` fails until it exists (§5, item 1).
3. **The Value area.** Render the top-line and non-cash gap headlines in their basis group, each with its label and chip. Render each as a percentage: the fraction × 100, the F-DG4-125 rule. Never add them to the profit-and-cash gap.
4. **The Portfolio area.** Label the value column with the item's `valueBasis`: "Planned value allocated (profit and cash)". Render `not_applicable` with its reason, never as 0.
5. **Drill-downs.** Follow each href as sent. Show `DashboardDrilldown.currency` when it is non-null.
6. **Fixtures.** Add `valueBasis` (null, or `profit_and_cash` on an initiative item) to every fixture `DashboardItem`, and `currency` (null or the href's currency) to every fixture drill-down. While the members are optional this typechecks, and it keeps the KBE-R7 closing step from breaking `apps/web`. Also change the fixture at `dashboardFixtures.ts:562` (`ruleParams: { headlineBasis: "profit_and_cash" }`) to the N4 `lines` shape, or to `{}`.
7. **`dashboard.rag.value.no_profit_and_cash_benefit`** (row 241) is no longer sent once KBE-R7 lands. Keep its text until then.

### 4.3 Fixtures, expected values and contract exercises

All benefits are SAR unless stated, with planned periods 2026-01-01..2026-06-30, so every planned line is due at the as-of date. The thresholds are the defaults, 0.05 / 0.15.

**R3-6a (margin 70 validated 70; revenue uplift 300 planned, nothing validated). T10, Overview area and Finance `headlines`:**
- **The Value RAG:** `{status: "red", ruleKey: "dashboard.rag.value.validated_gap", ruleParams.lines: [{currency: "SAR", headlineBasis: "profit_and_cash", gapRatio: "0", status: "green", reasonKey: null}, {currency: "SAR", headlineBasis: "top_line", gapRatio: "1", status: "red", reasonKey: null}]}`.
- **`areaStatuses` value:** `red` on the Overview row and the Finance row.
- **The headlines:**
  - profit-and-cash planned 70, validated 70, gap "0";
  - top-line planned 300, validated `zero` 0, gap "1" (`dashboard.headline.value_gap_top_line`, href `metric=value.gap&…&valueClass=revenue_uplift&currency=SAR`).
- **The top-line gap drill-down:** `headlineBasis: top_line`, value "1", items = the revenue planned line(s), and `calculation.ruleKey` `dashboard.value.gap_ratio_top_line`.

**R3-6b (as R3-6a with avoided cost 300):**
- the same, with `non_cash`, `valueClass=avoided_cost` and `dashboard.headline.value_gap_non_cash`;
- the Value RAG is red.

**R3-8 (DOM-GROSS: revenue 300, margin 70, cash 20, avoided 45, each allocated 100 % to the completed INI-0017):**
- the Portfolio item value is `{state: "value", value: "90", unit: "currency", currency: "SAR", reasonKey: null}`, with `valueBasis: "profit_and_cash"` (it was 435);
- no response contains "435".

**The ranking world:**
- **The setup:** INI-A is allocated only the revenue uplift 300, and INI-B only the margin 70. Both are `completed` with the same milestones.
- **The order:** INI-B (70) comes first. INI-A follows with `not_applicable` `dashboard.portfolio.no_profit_and_cash_allocation`, currency SAR. Before, INI-A (300) was first.
- **An INI-C with nothing allocated** follows by code, `unknown` `dashboard.portfolio.no_allocated_value`.

**Probe GC (SAR margin 70; USD revenue uplift 11; nothing validated):**
- **The Value RAG:** red. Its lines are SAR `profit_and_cash` "1" red, then USD `top_line` "1" red.
- **SAR:**
  - **The profit-and-cash 'Planned value' headline** has the href `…metric=value.planned…&currency=SAR`. Its drill-down gives `{state: value, value: "70", currency: "SAR"}`, items `[B01 = 70 SAR]` and `currency: "SAR"`.
  - **The Finance gross planned SAR line** has the same href and the same answer.
- **USD:**
  - **The profit-and-cash 'Planned value' headline** is `not_applicable` `dashboard.value.no_profit_and_cash_benefit`, currency USD. Its href is `…&currency=USD`. Its drill-down gives `{state: not_applicable, value: null, currency: "USD", reasonKey: "dashboard.value.no_profit_and_cash_benefit"}`, `items: []` and `currency: "USD"`.
  - **The Finance gross planned USD line** (`zero`, USD) has the same href and the same answer. The decimal sum of no item is 0, the line's total.
  - **The top-line planned USD headline and the `revenue_uplift` USD class line** have the href `…&valueClass=revenue_uplift&currency=USD`, which gives USD 11 with one item.
- **Without `currency`:** `value.planned` without `valueClass` gives `not_applicable` `dashboard.value.multiple_currencies` (the scope's value currencies are SAR and USD). It gave SAR 70 before.

**The invariant, to be tested across all three dashboards, the header and every Finance line:**
- Follow the href of every value headline and every Finance line that has a currency.
- `drill.currency` equals the figure's currency, and every item is in it.
- For a sum metric, the decimal sum of the items equals the figure, or the figure is `unknown`. The one exception is a known-zero gross line beside an n/a profit-and-cash headline (ADR-0037 N4 item 3).

**The contract exercises (KBE-R7, in `p4-exercises-kbe-g.ts`, through the validating client, after the parameter leaves the pending list):**
- `getDashboardDrilldown` with `metric=value.planned&currency=SAR`: 200, and the body has `currency: "SAR"`;
- the same with `currency=USD` in a world without a USD profit-and-cash benefit: 200, n/a, `items: []`;
- `metric=value.gap&valueClass=revenue_uplift&currency=SAR`: 200, with `headlineBasis: "top_line"`;
- `metric=value.investment&currency=SAR`: 200;
- `metric=decisions.open&currency=SAR`: 422 `dashboard.currency_not_applicable`;
- `metric=value.planned&currency=sar`: 400 (pattern);
- `metric=value.gap&valueClass=margin_uplift`: 422 `dashboard.value_class_not_applicable`.

The existing exercise at `p4-exercises-kbe-g.ts:703` (`decisions.open` + `valueClass`, 422) is unchanged.

### 4.4 Readers of the meaning changes (to re-baseline or re-check)

- **`ruleParams` of `validated_gap`** (the top-level `headlineBasis` dropped; `lines` gains `headlineBasis` and `reasonKey`), and the retired RAG key:
  - `apps/api/test/integration/reporting/headline-basis.test.ts:197`;
  - `apps/api/src/modules/reporting/dashboards/areas.test.ts`;
  - `apps/api/test/integration/reporting/finance-adoption.test.ts` and `finance-drilldown-k1.test.ts` (both read `no_profit_and_cash_benefit`);
  - `apps/web/src/pages/dashboards/dashboardFixtures.ts:562`, `valueHeadlines.test.tsx`, and `apps/web/src/i18n/{en,ar}/dashboards.json`.
- **Value hrefs gaining `currency`, and drill-downs without `currency` in multi-currency scopes.** Any test that compares an href string or builds a drill URL by hand:
  - `apps/api/test/integration/reporting/{dashboards,drilldown,filters,scope,bu-scope,finance-adoption,finance-drilldown-k1,headline-basis}.test.ts`;
  - `apps/api/test/integration/contract/p4-exercises-kbe-g.ts`;
  - `tests/qa/integration/a04-a05-a10-partials.test.ts` and `a04-kpi-propagation.test.ts` (QA-owned: report, don't edit);
  - `apps/web/src/pages/dashboards/{api.ts,DashboardsPage.tsx,ui.tsx,dashboards.test.tsx,valueHeadlines.test.tsx}`.

  A test that follows the href as sent is unaffected.
- **The Portfolio item value and order** (now profit-and-cash):
  - `apps/api/src/modules/reporting/dashboards/areas.test.ts` (around lines 547–594) and `engine.ts`;
  - `drilldown.ts:425–427`;
  - the reporting integration tests that assert an initiative's value. Any fixture that allocates `revenue_uplift` (the KBE-G default class of `p4-exercises-kbe-g.ts:605`) now gets n/a instead of its sum.
- **`DashboardItem.valueBasis`:** every response with a DashboardItem, in the byte comparison (as `headlineBasis` was in KBE-R6 §2.5).

## 5. Known gaps and disclosures

1. **The web problem-translation guard fails until FE-R6 adds the text.** I added the 422 row `dashboard.currency_not_applicable` to ADR-0037 in the amendment table format. On purpose, `apps/web/src/i18n/problems-slices-hijk.test.ts` reads such rows, and it fails (6 tests, EN and AR; §3, check 6) until `problems.json` holds the code in EN and AR. That is FE-owned, outside my scope. **Options for the orchestrator:**
   - merge FE-R6's two problem texts together with this change, or first in wave B;
   - or accept that the test is red between the ARCH-R6 merge and FE-R6.

   I did not hide the row from the scan, since the guard exists so that a new refusal cannot go untranslated.
2. **The pending parameter.** Until KBE-R7, the as-built API answers 400 to `currency`, because the strict query schema rejects it. So no exercise may send it yet. It is listed in `P4_PENDING_ARCH_R6_PARAMETERS`, and nothing reads that list mechanically.
3. **A design choice inside D-122, flagged for the reviewers.**
   - **What:** the Portfolio item does not show the top-line and non-cash allocations (D-122 item 2: "If the item shows them"). It labels its value's basis instead (`valueBasis`), and the n/a reason names those bases.
   - **What the alternative costs:** a per-basis array on `DashboardItem`, which would be an additive contract change.
4. **Untracked files not mine.** `git status` shows sandbox or home artifacts at the worktree root: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. Some were there at my first `git status`; the list was truncated, so I can't say which. I didn't create, edit or delete any of them. They are not repository content. Prettier `--ignore-unknown` passed with them present.
5. **Observed, not changed (outside D-122).** The as-built `plannedOf` (engine.ts:205) skips planned lines with a null amount, so a Portfolio sum can omit a missing amount instead of becoming `unknown`. This predates DG4 round 3, and D-122 item 5 keeps the rules of the sum. I record it for the orchestrator; I did not design a change.
6. **Not run:** e2e, the unit suites and integration beyond the contract project (§3). No product code changed.

## 6. Merge instructions

- **No migration.** After merging, rebuild `@mth/shared` (`pnpm --filter @mth/shared build`).
- **Order:** merge this change first (wave A). Then, in wave B, KBE-R7 and FE-R6 follow §4.
- **Wave B on FE-R6:**
  - FE-R6's `problems.json` texts (§5, item 1) and fixture members (§4.2, item 6) should land no later than KBE-R7's closing step;
  - otherwise `problems-slices-hijk.test.ts` stays red, and `pnpm -r typecheck` breaks at `apps/web` when the `.optional()` calls are dropped.
- **Conflicts to expect:** none in file terms. Only I write `openapi.yaml` and the ADRs. KBE-R7's closing step edits the exact lines named in §4.1, item 6.
- **Check after the merge:** `pnpm openapi:lint` (652), `pnpm -r typecheck`, and the contract project.
