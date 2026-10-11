# Handback T-DG4-ARCH-R5 (solution-architect): one basis for the value headlines (F-DG4-123, D-119)

- **Stage:** P4 / DG4, review round 2, repair wave A.
- **Invocation:** `DG4-T-DG4-ARCH-R5-solution-architect-20261011T083705Z-be48a045`, session `be48a045-018c-4b58-a6fe-3ca23be51766`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-ARCH-R5.md`. sha256 `f1641a06…469dc7`, verified at start.
- **Base:** branch `dg4/arch-r5`, `HEAD` `ba571072d10358fbb3094267f77f6e0bfe2dba75`. `git status` at start showed only untracked sandbox dotfiles.
- **Time:** `date -u` gave 08:37:15Z at start and 08:52:57Z at the last product edit. This handback was written after that. About 20 minutes in total.
- **State of the changes:** all **uncommitted**, as asked.
- **Ports:** the contract test's disposable PostgreSQL used port 23700 (log: "port-policy: PostgreSQL listening on port 23700 (attempt 1)"), with `MTH_PORT_POOL=23701-23749`.

This is an engineering record. It grants no product gate (G1–G6) and no business or Finance approval. The test fixture values are synthetic.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG3` gave **exit 0**, `PASS gate DG3 (historical)`, both at the start and at the end (§3).

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0037-p4-dashboards-t10-my-work-overview-header.md` | Amendment **N3**: the D-119 rule for every value headline. It covers the drill-down rule, Unknown, n/a and zero, the contract members, the owners and the code table. It supersedes N2 items 2–3, the N2 note and ADR-0030 N1 item 5 |
| `docs/architecture/adr/ADR-0030-p4-benefit-values-finance-validation-totals.md` | Amendment **N3**: D-119 items 1–6, stated exactly. It supersedes N1 item 5 and says why the DG3 business-case totals keep their basis on purpose. Cites M0172 and B0145 |
| `docs/api/openapi.yaml` | Additive. A new schema `HeadlineBasis`, and three members that are not yet required. Descriptions state the meaning changes. An info paragraph |
| `packages/shared/src/schemas/dashboards.ts` | Zod mirrors: `HEADLINE_BASES`, `HeadlineBasis`, `headlineBasis` and `HEADLINE_BASIS_CLASSES`, plus the three members as `.optional()` |
| `apps/api/test/support/p4-pending-arch-r5.ts` (new) | The pending list: `P4_PENDING_ARCH_R5` (no operations) and `P4_PENDING_ARCH_R5_MEMBERS` (the three members) |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-evidence/codes-table.md` (new) | The code table, continued from row 206: rows 207–235, EN exact and AR proposed |
| `docs/delivery/handbacks/DG4/T-DG4-ARCH-R5-solution-architect.md` (new) | This handback |

`git status --short`, excluding the untracked sandbox dotfiles and the `CLAUDE.local.md` device node, shows exactly the four ` M` files and the three new paths above. No other file changed. In particular, these are untouched:
- `p4-pending.ts` (§5.3);
- the contract test;
- all API, web and worker code;
- the sources, the gate tools and the delivery records.

## 2. Behaviour delivered (REQ-S08-009, REQ-S13-003, REQ-S03-009, REQ-S03-011; F-DG4-123)

**Design only.** No product behaviour changes in this task: the API still emits the five-class headlines until KBE-R6. The decided design is as follows.

1. **The profit-and-cash basis.** `value.planned`, `.forecast`, `.submitted` and `.validated`, `value.gap` and the Value RAG sum `margin_uplift` + `cash_saving` + `working_capital_release` per currency. This holds on four surfaces:
   - T10 (and the workstream dashboard, which shares the shape);
   - the Executive Overview, including each row's Value status;
   - the workspace header (`benefits.planned`/`.validated`);
   - the Finance `headlines`.
2. **Two bases of their own.** `revenue_uplift` (`top_line`) and `avoided_cost` (`non_cash`) get headlines of their own:
   - **states:** planned, forecast, submitted and validated on T10, the Overview and Finance; planned and validated on the header;
   - **when:** only for a currency that holds a benefit of that class;
   - **what they never have:** a gap, a RAG, or a place in any profit-and-cash sum.
3. **Drill-downs.**
   - **profit_and_cash:** the value-state drill-down without `valueClass`. **Its meaning changes:** it now sums three classes, no longer five.
   - **top_line:** `valueClass=revenue_uplift`.
   - **non_cash:** `valueClass=avoided_cost`.
   - **The Finance `gross` line now always drills** (same drill-down as profit_and_cash). This removes the N2 condition.
   - **`net`** stays `null`.
4. **n/a, zero and Unknown.**
   - **n/a:** in a currency with no profit-and-cash benefit, the profit-and-cash headlines and the gap are `not_applicable`, with `dashboard.value.no_profit_and_cash_benefit`. When every currency is in that state, the Value RAG is `not_applicable` with `dashboard.rag.value.no_profit_and_cash_benefit`.
   - **Known zero:** a profit-and-cash benefit exists but nothing is in the window. Unchanged.
   - **Unknown:** a line without an amount. Unchanged.
   - **No financial benefit at all:** `no_financial_benefit`. Unchanged.
5. **Labels.** There are 13 new label keys, one per basis × state plus the gap, all named for their basis. The five A2 value label keys are retired once KBE-R6 lands.
6. **Unchanged:**
   - the per-class lines and their K1 hrefs;
   - the Finance validation rules;
   - gross, net and cost (N1);
   - `value.investment`;
   - the DG3 business-case totals. ADR-0030 N3 item 6 gives the reason for the difference: a planning artefact, with a basis split and a warning, approved at DG3, against a single executive headline with no warning beside it. Aligning them would reopen DG3, so it is escalated, not done here.

## 3. Checks actually run

The environment for all of them: worktree `/home/user/wt/dg4-arch-r5`, Node and pnpm from the repository, `node_modules` as installed, and `@mth/shared` rebuilt (`pnpm --filter @mth/shared build`, exit 0) before the typecheck.

| # | Command | Result |
|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | **exit 0**, `PASS gate DG3 (historical)` |
| 2 | `pnpm openapi:lint` | **exit 0**, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations`. The operation count is unchanged (652) |
| 3 | `pnpm -r typecheck` | **exit 0** (`apps/api`, `apps/web`, `apps/worker`, `packages/*`: Done). Re-run after the last comment edit: exit 0 |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | **exit 0**. Re-run after the last edit: exit 0 |
| 5a | `pnpm format:check` | **exit 2, not a formatting failure.** Prettier printed "All matched files use Prettier code style!" but could not open `CLAUDE.local.md` (EACCES). That path is an untracked character device (`crw-rw-rw- 1, 3`, i.e. `/dev/null`) that the sandbox places in the worktree, and it is not repository content. I report this check as **not passed as written** |
| 5b | `prettier --check --ignore-unknown` over every tracked file (16,906 files, `git ls-files`, minus the separate `trading_agent/` project) plus `p4-pending-arch-r5.ts` | **exit 0**, "All matched files use Prettier code style!". Changed files re-checked after the last edits: clean |
| 6 | Contract test project: `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/contract/` | **exit 0**: `Test Files 2 passed (2)`, `Tests 46 passed (46)`, 49.5 s, on disposable PostgreSQL port 23700. Run twice; the second run was on the final `openapi.yaml` (sha256 `f3365614…6f9b80`) |
| 7 | (extra) `pnpm exec vitest run --project unit-node packages/shared apps/api/src/modules/reporting` | **exit 0**: 30 files, 830 tests |
| 8 | (extra) Validating the new members with ajv against `openapi.yaml` and with the zod mirrors (node one-off) | profit_and_cash 90, top_line 300, non_cash 45 and an n/a headline: valid in both. A headline without the member (as-built): valid in both. `headlineBasis: "gross"`: rejected by both. `null`: valid in both |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | **exit 0**, `PASS gate DG3 (historical)` |

Not run: the full integration suite, the web unit tests and e2e. No product code changed, and the shared change is additive and optional, but I make no claim beyond rows 1–9.

## 4. Every changed line, with its reason

### 4.1 `docs/api/openapi.yaml` (`git diff --numstat`: 22 added, 5 removed; 9 hunks: 5 lines replaced in place and 17 new lines, one of them blank)

| # | Where | Change | Reason |
|---|---|---|---|
| 1 | `info.description`, after the ARCH-R3 paragraph | +10 lines: the "P4 repairs (T-DG4-ARCH-R5, 2026-10-11; F-DG4-123, D-119)" paragraph | the repair record convention (R1–R3 paragraphs) |
| 2 | `DrilldownValueClassQuery.description` | replaced: two sentences added. The top-line and non-cash headlines drill with `revenue_uplift` and `avoided_cost`. **Without `valueClass` a value-state drill-down sums the profit-and-cash basis only** | **meaning change** (N3 item 3) |
| 3 | `DashboardHeadline` | +1 line: `description`, the basis rule, n/a, emission and drill-down per basis | **meaning change** of the value headlines (N3 items 1–4) |
| 4 | `DashboardHeadline.properties` | +1 line: `headlineBasis: HeadlineBasis \| null` (**not in `required`**) | additive member (N3 contract) |
| 5 | new schema `HeadlineBasis` | +4 lines: enum `profit_and_cash, top_line, non_cash`, with a description | the basis enum. The name avoids `valueBasis`, which is already used with other meanings by `BusinessCaseLine` (DG3) and `KpiEvaluation` |
| 6 | `FinanceValueLine.drilldownHref.description` | replaced: a gross line **always** carries the value-state drill-down without `valueClass` (supersedes the N2 condition) | **meaning change** (N3 item 3) |
| 7 | `FinanceDashboard.headlines` | replaced: a description added (profit_and_cash headlines equal gross, plus top_line and non_cash) | **meaning change** |
| 8 | `DashboardDrilldown.description` | replaced: without `valueClass`, and for `value.gap`, the basis is profit-and-cash. A scope with no such benefit gives n/a `dashboard.value.no_profit_and_cash_benefit` | **meaning change** |
| 9 | `DashboardDrilldown.properties` | +1 line: `headlineBasis: HeadlineBasis \| null` (**not in `required`**) | additive member |
| 10 | `WorkspaceHeader.benefits` | replaced: a `description` (`planned` and `validated` are now profit-and-cash, n/a rule), plus the property `headlines: DashboardHeadline[]` (**not in `required`**) | **meaning change** plus additive member |

Unchanged: every operation, status, parameter schema, `required` list and enum except the new `HeadlineBasis`. `DashboardMetric` is unchanged (no new metric).

### 4.2 `packages/shared/src/schemas/dashboards.ts` (5 hunks)

| # | Change | Reason |
|---|---|---|
| 1 | After `financeValueClass`: `HEADLINE_BASES`, `type HeadlineBasis` and `headlineBasis` (z.enum), with a comment | the mirror of `HeadlineBasis` |
| 2 | `HEADLINE_BASIS_CLASSES` (`profit_and_cash` → the three classes, `top_line` → `revenue_uplift`, `non_cash` → `avoided_cost`) | one shared constant, so the engine (KBE-R6) and the web (FE-R5) cannot disagree on the basis |
| 3 | The `dashboardHeadline` doc comment, plus `headlineBasis: headlineBasis.nullable().optional()` | mirror. Optional while it is pending |
| 4 | `dashboardDrilldown`: `headlineBasis: headlineBasis.nullable().optional()`, with a comment | mirror |
| 5 | `workspaceHeader.benefits`: `headlines: z.array(dashboardHeadline).optional()`, with a comment | mirror |

**Zod exports for KBE-R6 and FE** (all from `@mth/shared/schemas`):
- `HEADLINE_BASES`, `HeadlineBasis` (type), `headlineBasis` and `HEADLINE_BASIS_CLASSES`;
- the existing `dashboardHeadline`/`DashboardHeadline`, `dashboardDrilldown`/`DashboardDrilldown` and `workspaceHeader`/`WorkspaceHeader`, which now carry the new members.

### 4.3 `apps/api/test/support/p4-pending-arch-r5.ts` (new)

- **`P4_PENDING_ARCH_R5 = []`:** the operation list of the ARCH-R3 pattern. This repair adds no operation.
- **`P4_PENDING_ARCH_R5_MEMBERS`:**

  | Member | Operations | Zod mirror |
  |---|---|---|
  | `DashboardHeadline.headlineBasis` | `getTransformationDashboard`, `getWorkstreamDashboard`, `getExecutiveOverview`, `getFinanceDashboard`, `getAdoptionDashboard`, `getWorkspaceHeader` | `dashboardHeadline` |
  | `DashboardDrilldown.headlineBasis` | `getDashboardDrilldown` | `dashboardDrilldown` |
  | `WorkspaceHeader.benefits.headlines` | `getWorkspaceHeader` | `workspaceHeader` |

### 4.4 ADRs

Both changes are appended sections. No earlier line is edited.
- **ADR-0037:** +106 lines, amendment N3. It holds the decision items 1–6, the example table, the contract, the owners and the 25-row code table.
- **ADR-0030:** +38 lines, amendment N3. It holds items 1–6, the reason the two bases differ, the example and the owner.

### 4.5 Code table

`T-DG4-ARCH-R5-evidence/codes-table.md`, rows **207–235**. Rows 231–235 are the retired A2 keys.

| Rows | Keys | Decision |
|---|---|---|
| 207–219 | 13 label keys | new |
| 220 | `dashboard.value.no_profit_and_cash_benefit` (the item 4 `not_applicable` reason) | new |
| 221 | `dashboard.rag.value.no_profit_and_cash_benefit` | new |
| 222–228 | `dashboard.value.sum_<state>_profit_and_cash` (7 rule keys) | new |
| 229–230 | `dashboard.rag.value.validated_gap` and `dashboard.value.gap_ratio` | text changed; keys unchanged |
| 231–235 | the five A2 value label keys | retired |

The same rows, without the Arabic column, are in ADR-0037 N3.

## 5. The pending list and the contract test

The contract test passes before KBE-R6 for this reason:
- The three new members are **declared but not `required`** in `openapi.yaml`.
- They are `.optional()` in the zod mirrors.
- So the as-built responses, which lack them, still validate (check 8).

**Nothing reads `p4-pending-arch-r5.ts` mechanically:**
- The existing pending machinery (`p4-pending.ts` → `contract.test.ts`) handles **operations** only.
- A member-level check would need an edit to `contract.test.ts`, which is outside my permitted files.
- I did not add an import line to `p4-pending.ts`, because the operation list is empty.

**Required closing step (orchestrator):** once KBE-R6 has emptied `P4_PENDING_ARCH_R5_MEMBERS`, add the three members to their `required` lists in `openapi.yaml` and drop the three `.optional()` calls from the mirrors, in one change. Only then does the contract test enforce them. This must happen before the DG4 re-freeze. Either the solution-architect does it as a short follow-up, or the orchestrator allows KBE-R6 to make exactly those edits. Otherwise a response without `headlineBasis` would still pass.

## 6. Every reader of a member whose meaning changes

Each of these is a change KBE-R6 or FE-R5 must make or re-baseline:

| Member (meaning change) | Readers |
|---|---|
| Value headlines (`DashboardHeadline` for `value.*`) and the Value RAG | API: `reporting/dashboards/areas.ts` (`valueArea`, `valueGapStatus`, `lineEligible`, `valueLinesOf`, `valueCurrencies`, `FINANCIAL_VALUE_CLASSES`), `engine.ts` (`presentAreas` Value block, `benefitValidated`), `finance.ts` (headlines), `executive-overview.ts` (area status rows). Tests: `areas.test.ts`, `finance.test.ts`, `test/integration/reporting/dashboards.test.ts`, `filters.test.ts`, `scope.test.ts`, `bu-scope.test.ts`, `finance-adoption.test.ts`; qa: `tests/qa/integration/a04-a05-a10-partials.test.ts`, `a04-kpi-propagation.test.ts`. Web: `pages/dashboards/ui.tsx`, `DashboardsPage.tsx`, `api.ts`, `dashboardFixtures.ts`, `dashboards.test.tsx`, `pages/closure/closure.test.tsx`; i18n `apps/web/src/i18n/{en,ar}/dashboards.json` |
| `getDashboardDrilldown` without `valueClass` (now profit-and-cash), and `value.gap` | API: `reporting/dashboards/drilldown.ts` (`valueDrill`, the `asBuilt` branch, `benefitInClass`, `lineEntersClassSum`, the `value.gap` case). Tests: `test/integration/reporting/drilldown.test.ts`, `finance-drilldown-k1.test.ts`, `k1-value-class.test.ts`, `p4-exercises-kbe-g.ts`. Web: the drill-down view in `pages/dashboards/*` |
| `FinanceValueLine.drilldownHref` on gross (always set) | API: `finance.ts` (`hrefOf`, the N2 condition). Tests: `finance.test.ts`, `finance-drilldown-k1.test.ts`. Web: `ui.tsx`, `DashboardsPage.tsx`, `dashboardFixtures.ts` |
| `WorkspaceHeader.benefits.planned` / `.validated` (now profit-and-cash) | API: `reporting/workspace-header.ts` (lines 148–151). Test: `test/integration/reporting/workspace-header.test.ts`. Web: `components/WorkspaceHeader.tsx` |

Not readers: `benefits/totals.ts` (`getBenefitTotals`), and `kpi/totals.ts` (DG3). Both are unchanged.

## 7. Implementation notes (for KBE-R6 and FE-R5)

### The fixture to use (the domain reviewer's, synthetic)

- **Benefits:** one transformation, SAR, all counted and monetised, values planned to date. `revenue_uplift` 300, `margin_uplift` 70, `cash_saving` 20, `avoided_cost` 45. Nothing validated, no cost lines.
- **Expected values:**
  - Planned value (profit_and_cash) = **90.0000**;
  - Planned revenue uplift (top_line) = 300.0000;
  - Planned avoided cost (non_cash) = 45.0000;
  - Validated value (profit_and_cash) = `zero` 0.0000;
  - gap ratio = 1, so the Value RAG is **Red** (default policy: amber 0.05, red 0.15);
  - Finance `gross.planned` = 90.0000, equal to the first value;
  - 435 appears nowhere.
- **Variant A (n/a):** remove the 70 and the 20 benefits. Then:
  - every profit_and_cash headline and the gap are `not_applicable` / `dashboard.value.no_profit_and_cash_benefit`;
  - the Value RAG is `not_applicable` / `dashboard.rag.value.no_profit_and_cash_benefit`;
  - the header `benefits.planned` SAR value is `not_applicable` with the same reason;
  - the top_line 300 and non_cash 45 headlines are still shown.
- **Variant B (zero vs n/a):** keep the margin benefit but move its line outside the window. Planned (profit_and_cash) is `zero`, and the gap is n/a / `dashboard.value.nothing_planned`.
- **Variant C (Unknown isolation):** give the revenue line a null amount. The top_line headline is `unknown`, and the profit_and_cash headlines are unaffected.
- **Drill invariant, every case:** for each value headline, the decimal sum of the drill-down's items in the headline's currency equals its value, or both are `unknown`. Add a second currency (USD) to prove it per currency.

### Per surface

**T10** (`getTransformationDashboard`; the workstream dashboard shares the shape) and the **Executive Overview** (`getExecutiveOverview`):
- **Members:** `areas[code=value].headlines[]`, `DashboardHeadline.headlineBasis`, and the Value `rag` (`ruleParams.headlineBasis = "profit_and_cash"` on `validated_gap`). On the Overview, also `transformations[].areaStatuses[code=value]`.
- **Order per currency:**
  - profit_and_cash planned, forecast, submitted, validated and gap;
  - top_line planned … validated (only if a `revenue_uplift` benefit exists in the currency);
  - non_cash planned … validated (only if an `avoided_cost` benefit exists);
  - after all currencies, `value.investment` per currency (`headlineBasis: null`).
- **No financial benefit at all:** one `value.validated` headline, `profit_and_cash`, n/a `no_financial_benefit`.
- **Label keys:**
  - `dashboard.headline.value_<state>_profit_and_cash`;
  - `dashboard.headline.value_gap_profit_and_cash`;
  - `dashboard.headline.value_<state>_top_line`;
  - `dashboard.headline.value_<state>_non_cash`.
- **Drill-down hrefs:**
  - profit_and_cash: `metric=value.<state>` with no `valueClass`; `metric=value.gap` for the gap;
  - top_line: `valueClass=revenue_uplift`;
  - non_cash: `valueClass=avoided_cost`;
  - all with the same filters.
- **Engine:**
  - `valueCurrencies` stays on five classes; it defines which currencies have a block.
  - The sums and `valueGapStatus` use the three classes. Use `HEADLINE_BASIS_CLASSES`.
  - `lineEligible`'s count, monetisation and overlap rules are unchanged.

**Finance dashboard** (`getFinanceDashboard`):
- **Members:** `headlines[]` (the same as T10's Value headlines, with `headlineBasis`), `lines[]` unchanged, and the gross `drilldownHref` now **always** `value.planned` / `value.validated` with no `valueClass` (remove the N2 condition). Net stays `null`.
- **Test:** for each state and currency, gross `total` = the profit_and_cash headline value = the drill-down's sum.

**Workspace header** (`getWorkspaceHeader`):
- **Members:**
  - `benefits.planned` and `.validated`: profit-and-cash per currency; n/a with `no_profit_and_cash_benefit` where applicable;
  - `benefits.headlines[]`: the planned and validated headlines of the three bases per currency, identical to the T10 headlines with the same metric, basis and currency, hrefs included;
  - `benefits.state`: unchanged.
- **Web:** show the profit-and-cash figure as the header value, and the top-line and non-cash figures beside it with their basis labels. Link each figure to its `drilldownHref`.

**Drill-down** (`getDashboardDrilldown`):
- **Without `valueClass`,** for the seven value-state metrics, select the three profit-and-cash classes. The currencies are those of the eligible profit-and-cash benefits; this replaces the `asBuilt` lines-based branch, so an eligible basis with no line is a known zero.
- **Rule key:** `dashboard.value.sum_<state>_profit_and_cash`.
- **Value:**
  - no five-class benefit: n/a `no_financial_benefit` (unchanged);
  - five-class benefits but no profit-and-cash benefit: n/a `no_profit_and_cash_benefit`;
  - several currencies: n/a `multiple_currencies`, with per-currency `inputs`.
- **`value.gap`:** items are the profit-and-cash planned and validated lines only.
- **`headlineBasis`:** set per N3 (`profit_and_cash`, `top_line`, `non_cash` or null).
- **With `valueClass`:** unchanged (K1).

**Web (FE-R5):**
- **Labels:** render by `labelKey`, EN and AR from the code table (rows 207–230). Show a basis chip from `headlineBasis` (suggested texts at the foot of the code table).
- **Never sum across bases.** Never present a top_line or non_cash figure inside a profit-and-cash total.
- **States:** render `not_applicable` with its reason, never as 0 or green.
- **F-DG4-122** (the ratio rendered as money) is FE-R5's separately. The `value.gap` unit stays `ratio`.

## 8. Known gaps / not done

- **No engine, API or web change:** by design. KBE-R6 and FE-R5 implement it, and until then the built product still shows 435.
- **The members are not yet `required`,** and no test reads the member pending list (§5). That needs the closing step in §5.
- **`pnpm format:check` as written exits 2** on the sandbox's `CLAUDE.local.md` device node (§3 row 5a). The equivalent check over every tracked file exits 0 (row 5b).
- **The Arabic texts are proposals, provisional,** for FE-R5. They are not verified by a native reviewer.
- **DG3 business-case totals:** not aligned, on purpose (ADR-0030 N3 item 6). Aligning them would reopen DG3, and only the orchestrator could decide that.

## 9. Merge instructions

- **No migration.**
- **Merge this before KBE-R6 and FE-R5** (wave B, D-119). Rebuild `@mth/shared` (`pnpm --filter @mth/shared build`) after the merge so the API and web see the new exports.
- **Conflicts to expect:** none. These files have no other writer in wave A.
- **KBE-R6 removes entries from `P4_PENDING_ARCH_R5_MEMBERS`** as it emits each member. Then apply the §5 closing step (the `required` lists and dropping the three `.optional()` calls) before the round-3 freeze.
