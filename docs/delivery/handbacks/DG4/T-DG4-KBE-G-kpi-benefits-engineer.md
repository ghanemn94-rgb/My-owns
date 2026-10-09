# Handback T-DG4-KBE-G (kpi-benefits-engineer): the T10 area engine, the transformation, executive and workstream dashboards, the drill-down and the RAG policy

- **Stage:** P4, gate DG4 (BUILDING). Assignment `docs/delivery/assignments/DG4/T-DG4-KBE-G.md` (sha256 `5a6f4f9d…a378cf`, verified). Section: `docs/architecture/p4-work-split.md` §J+K JK.4.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-G-kpi-benefits-engineer-20261009T184030Z-5b93bdef","session_id":"5b93bdef-738a-4781-8ae2-d808db8d1ccf"}`.
- **Base:** branch `dg4/kbe-g` at `85cae06be8db43b6e322c842efc4e5541f383d43`. The changes are left **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-09T18:40:42Z` and ended `2026-10-09T19:57:39Z` (`date -u`), about 77 minutes, inside the limit. Every section item is done except those listed in §7.
- **Product gates G1–G6 are business approvals inside the product.** Nothing here reads or writes DG0–DG7. No agent, seed or job grants a real business, Finance or IT approval. All test data is synthetic: trajectory approvals and Finance validations in the fixtures are synthetic approvals of test data.

## 0. First: production wiring (D-107 lesson)

**No production wiring is needed, and `server.ts` is not edited.**

- Every KBE-G route registers through the reporting module's existing registration lines: `reporting/index.ts` → `registerDashboardRoutes` and `registerExecutiveOverviewRoutes`, the BE-A stubs this task filled.
- KBE-G needs no port and no setter.
- **Proof:** every integration test of this task builds the real server through the harness (`startApi` → `buildServer`, the composition root) and wires nothing by hand. That covers `reporting/{dashboards,filters,drilldown,scope,rag-policy}.test.ts` and the contract exercises.
- KBE-G2 owns `WorkflowsReadPort` and its `server.ts` line, so it is not part of this task.

## 1. Changed files

### New files (all inside my ownership)

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/dashboards.ts` | Zod mirrors of the slice J shapes: `T10Area`, `DashboardValue`, headline, item, filters, the three dashboards, drill-down, RAG policy and its update. Also `DASHBOARD_RAG_DEFAULTS` (ADR-0037 §3's labelled defaults) and `DASHBOARD_REFUSALS` (the exact ADR-0037 §13 texts). |
| `apps/api/src/modules/reporting/dashboards/combine.ts` | The status precedence red > amber > unknown/not_computable > stale > green (pure). |
| `apps/api/src/modules/reporting/dashboards/areas.ts` | The six area rules of ADR-0037 §3 as pure functions of facts, using decimal.js (`FORMULA_DECIMAL`). |
| `apps/api/src/modules/reporting/dashboards/engine.ts` | Loads the facts once per request inside a **READ ONLY** transaction, narrows them (owner, window, per transformation, per workstream), computes the areas and presents them in the `T10Area` shape with the seeded en/ar labels. |
| `apps/api/src/modules/reporting/dashboards/filters.ts` | The §4 filters, business date (organization timezone), window and as-of date, the 422s, `appliedFilters`, and the drill-down hrefs. |
| `apps/api/src/modules/reporting/dashboards/scope.ts` | The readable-transformation set (`scopeFilter`, the DG1 `listTransformations` function). Returns 404 outside the scope. |
| `apps/api/src/modules/reporting/dashboards/transformation.ts` | `getTransformationDashboard` |
| `apps/api/src/modules/reporting/dashboards/workstream.ts` | `getWorkstreamDashboard` |
| `apps/api/src/modules/reporting/dashboards/drilldown.ts` | `getDashboardDrilldown`: the 14 metrics, the sum invariant and pagination. |
| `apps/api/src/modules/reporting/dashboards/rag-policy.ts` | `getDashboardRagPolicy` and `putDashboardRagPolicy`, the only slice J write. |
| `apps/api/src/modules/reporting/dashboards/areas.test.ts` | Unit tests with worked fixtures, plus seeded property tests (no new dependency). |
| `apps/api/src/modules/kpi/dashboard-facts.ts` | KPI statuses through slice A's `statusOf` (overrides in force, read-time Stale), the outcome/outcome-KPI rows, and the lineage of a status. |
| `apps/api/src/modules/benefits/dashboard-facts.ts` | Benefits with slice B counting (`benefit_counting`), value lines (`benefit_value_line`), investment lines, current allocations, and line evidence. |
| `apps/api/src/modules/portfolio/dashboard-facts.ts` | Initiatives with milestones and contributions, workstream facts, critical-path flags (true/false/null) and the default working calendar. |
| `apps/api/src/modules/adoption/dashboard-facts.ts` | The KPI-fed adoption metric links, with the KBE-F scope rule. |
| `apps/api/test/integration/reporting/dashboards.test.ts` | REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-S03-009, the workstream dashboard, and "stores nothing". |
| `apps/api/test/integration/reporting/filters.test.ts` | REQ-S13-002 |
| `apps/api/test/integration/reporting/drilldown.test.ts` | REQ-S13-003 |
| `apps/api/test/integration/reporting/scope.test.ts` | REQ-S13-001: the X/Y sweep. |
| `apps/api/test/integration/reporting/rag-policy.test.ts` | Policy, S-4, and configured thresholds changing the RAG and `policySource`. |

### Modified files

| File | Change |
|---|---|
| `apps/api/src/modules/reporting/dashboards/index.ts` | The BE-A stub, now registering the 5 routes of this folder. |
| `apps/api/src/modules/reporting/executive-overview.ts` | The BE-A stub, now `getExecutiveOverview`. |
| `apps/api/src/modules/{kpi,benefits,portfolio,adoption}/index.ts` | One export line (block) each for the new facts files. |
| `packages/shared/src/schemas/index.ts` | One export line. |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4DashboardError`: the `0056` order CHECKs map to 422 `dashboard_rag_policy.threshold_order` (pointer at the amber field), and the organization key maps to a retry. Plus its one call line in `mapDatabaseGuardError`. |
| `apps/api/test/support/p4-pending-kbe-g.ts` | 6 → 0 (§4). |
| `apps/api/test/integration/contract/p4-exercises-kbe-g.ts` | Exercises of all six operations, the mirrors, and the shared fixtures (the BE-J precedent). |

### Edits outside the file ownership (forced; please review at merge)

| File | Edit | Why |
|---|---|---|
| `apps/api/src/modules/reporting/reporting.test.ts` | The P1 test "its register hook … registers no route" became "registers the routes of its P4 route files and reports them" (the sustainment/benefits pattern). | Any reporting route fails the P1 assertion. **BE-M meets the same test concurrently** (expect a conflict; keep one version). |
| `apps/api/src/server.test.ts` | The `reporting` expectation changed from `{scaffold, P5, routes: []}` to `{active, P4}`. | Same reason. The URL check `routes … /report/i` is unchanged; no KBE-G URL contains "report". |
| `apps/api/src/modules/kpi/kpi.test.ts` | Three names added to the pinned `kpi/index.ts` export list: `loadKpiDashboardStatuses`, `loadKpiStatusLineage`, `loadOutcomeRows`. | The section gives KBE-G the `kpi/index.ts` export line; the pin is the KBE-C precedent. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin only, `[292, 291, 1]` → `[293, 292, 1]`, with a comment line. | The assignment instructs this pin change. |

## 2. Behaviour delivered, per requirement row

ADR-0037 is the binding design. The D-106 (a)–(d) interpretations are applied:

- (a) The default thresholds are labelled and configurable. Every `rag` carries `policySource`.
- (b) The only override is slice A's KPI override. The displayed RAG is used, and the calculated RAG is shown in the item flags as `calculated_<rag>`.
- (c) The executive dashboard and the Executive Overview are one operation (`GET /api/v1/overview`).

None of the seven rows is fully complete at this task's end: each one also needs FE-G's screens, and REQ-S13-001 also needs KBE-G2 (§7).

- **REQ-PB-062.** Acceptance: *"A01;A04: all six areas render in en and ar from persisted data; each headline drills to contributing records"*.
  - Every response has exactly 6 areas in Template 10 order. Each area carries the `t10_area_definition` seed labels: `sourceAreaEn`, `areaAr`, `sourceWhatToShowEn`, `whatToShowAr`, `sourceRagLogicEn`, `ragLogicAr`, `arProvisional`.
  - Each area also has its `rag`, `headlines[]` and `items[]`.
  - Every headline's `drilldownHref` is the drill-down call with the same filters.
  - Test `dashboards.test.ts` compares every label with the seed rows. It calls every headline href (200, same metric), and the `outcomes.area` drill lists the outcome-KPI records.
- **REQ-PB-063.** Acceptance: *"A04;A05: an outcome whose tasks are 100% complete but KPI is below trajectory is Red/Amber, not Green; a KPI with no actual shows Unknown"*.
  - The Outcomes rule reads only the slice A KPI status: `OutcomeFact` has no delivery input at all.
  - Test: an initiative linked to the outcome has an achieved milestone with an approved date and an accepted deliverable. The KPI's accepted April actual is 50 against an expected value of about 125, so the outcome is red or amber.
  - In the same response the Portfolio item shows `milestone_green`, so delivery is visible but never feeds Outcomes.
  - A KPI with no actual is `rag: unknown` with value `{state: unknown, value: null, reasonKey: kpi.no_accepted_actual}`, and its outcome is unknown.
  - The other area rules (Value gap, Portfolio milestone + outcome, Dependencies needed-by/critical path, People & adoption curve) and the empty-set rules are unit-tested in `areas.test.ts`.
  - Configurable thresholds are tested in `rag-policy.test.ts`.
- **REQ-PB-064.** Acceptance: *"A09: with one open T16 decision due yesterday (Asia/Riyadh), Decisions area is Red and lists it; after the decision is recorded it no longer counts"*.
  - "Yesterday" is the database's `p4_business_date(now(), 'Asia/Riyadh') - 1`, injected into the ask with the T16 test clock.
  - The Decisions area is `red` (`dashboard.rag.decisions.overdue`), the ask is the first item with flag `overdue`, and the `decisions.overdue` headline shows 1. The overview shows the same.
  - After the owner records the outcome, the ask is not listed, the area is `green` (`none_open`), and the overdue headline is `zero`.
- **REQ-S03-009.** Acceptance: *"A04: after an accepted KPI actual the overview's outcome tile shows the new actual once and its drill-down lists the source record"*.
  - After `acceptedActual(…, "123.5")` and the worker recalculation, exactly one Outcomes item carries `123.5`: the outcome KPI.
  - `outcomes.kpi_status` with `subjectId` = that outcome KPI returns value 123.5, the `kpi_actual` item whose id equals the accepted actual, and `calculation.inputs[0]` naming it.
- **REQ-S13-001** (KBE-G half: executive, transformation and workstream). Acceptance: *"A04;A12: a user scoped to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y record or figure"*.
  - X is in BU a1. Y is in BU a2 and holds non-zero figures: KPI actual 987654.321, a validated benefit of 44444.4, an initiative, a dependency, a decision, a workstream and an indicator.
  - A user granted TL only at X calls the overview, X's transformation and workstream dashboards, every drill-down metric and every headline href. None of Y's ids, codes or figures appears in any response.
  - The organization-wide auditor does see them (the sanity check).
  - An explicit Y transformation, a Y workstream, a Y subject, or organization B is **404**.
  - An ADM-only caller gets 404.
  - The Finance, adoption and personal dashboards are KBE-G2's.
- **REQ-S13-002.** Acceptance: *"A04: filtering by period Q1 changes all tiles to Q1 values"*.
  - With `periodId` = quarterly 2026-Q1, **each of the six areas' figures differs** from the unfiltered response, and each equals its Q1 value:
    - Outcomes: 50 → 150 (March's actual).
    - People & adoption: 60 → 140.
    - Value: planned to date 3000 → 1000, gap 0.7 → 0.1, red → amber.
    - Portfolio: the milestone red → green against the as-of date 2026-03-31.
    - Dependencies: 2 → 1.
    - Decisions: 2 → 1.
  - `appliedFilters` echoes the window and the as-of date. The transformation dashboard and the drill-downs carry the same filter.
  - The owner, phase and status filters are tested. An unknown period or owner returns the exact 422 texts.
- **REQ-S13-003.** Acceptance: *"A04;A05: the validated benefit total drills to its benefit records; a KPI with no data shows Unknown, not 0"*.
  - `value.validated` (1233.43 SAR) drills to its two **benefit** records. The decimal sum of `items[].value` over **all pages** (limit 1, two pages) equals the headline.
  - The Finance evidence of both measurements is listed, and the `calculation` names the rule and per-currency input.
  - The planned and gap drills hold the same invariant.
  - The three states are distinct:
    - `zero`: a known `"0"` when nothing is validated yet.
    - `not_applicable`: no financial benefit, or a non-financial benefit item.
    - `unknown`: the KPI with no data, `value: null`.
  - The unit property test checks the invariant over 300 seeded sets.

**Other proofs from the section's list:**

- A configured threshold changes the RAG and `policySource`: Decisions goes green → amber when `decisionDueSoonWorkingDays` = 20, and every area reports `configured`.
- AUD gets 403 on `putDashboardRagPolicy` and nothing is written. If-Match: 428 when missing, 409 when stale; `"0"` creates the row.
- Exactly one audit event per change (`dashboard_rag_policy.create`, then `.update`).
- Commit-time re-authorization: a grant revoked mid-request gives 403 and nothing is written.
- 422 for amber beyond red (exact text, amber pointer). 400 for out-of-range values.
- **No figure is stored:** reads write no row and no audit event, and the read runs in a READ ONLY transaction (a write inside it is rejected by PostgreSQL).

## 3. Checks actually run

Every command was run in this worktree, Node 24.21.0, offline. Logs are under `docs/delivery/handbacks/DG4/T-DG4-KBE-G-evidence/`.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (`validate-historical-DG3.txt`) |
| `pnpm -r typecheck` | 0 | `typecheck.txt` |
| `pnpm -r build` | 0 | `build.txt` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` (`lint.txt`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`format-check.txt`) |
| `pnpm openapi:lint` | 0 | `PASS … 645 operations` (`openapi-lint.txt`) |
| `pnpm test`, locale unset | 0 | unit-node + unit-web: **121 files, 2313 passed**; unit-formula-nocodegen: **3 files, 259 passed, 2 skipped** (`unit-locale-unset.txt`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts: 2313 passed; 259 passed, 2 skipped (`unit-c-utf8.txt`) |
| `QA_PG_PORT=24760 MTH_PORT_POOL=24761-24799 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **147 files, 1505/1505 passed**, duration 776.8 s (`integration.txt`) |

Unit delta against D-107's recorded 2293: +20.

- 19 of them are the new `areas.test.ts`.
- `reporting.test.ts` (one test replaced by one test) and `kpi.test.ts` (a longer pin, no new test) do not change the count.
- I did not identify the remaining +1. I did not re-run the base tree to find it, because that would need a stash in a shared stash stack.

**Focused runs during development** (PG on port 24750, pool 24751–24799; logs `focused-*.log`):

- **Contract:** `contract.test.ts` 45/45, with the KBE-G exercises.
- **Final passing runs:**
  - `dashboards.test.ts` 8/8
  - `filters.test.ts` 3/3
  - `drilldown.test.ts` 4/4 (`focused-dd2.log`)
  - `scope.test.ts` 3/3
  - `rag-policy.test.ts` 5/5 (`focused-rp3.log`)
- **First-run failures, disclosed:**
  - `focused-dd1.log` (exit 1): 3 of 4 drill-down tests failed because the contract validator **rejected an unrounded gap ratio** (80 fraction digits against the `Decimal` pattern's 6). **Fixed:** the presented ratio is rounded half-even to 6 places, while the RAG still compares the exact ratio, so rounding can never move a line across a threshold. `calculation.rounding` reports it. The planned value allocated to an initiative (planned × share) is presented at the money scale.
  - `focused-rp1.log` (exit 1): my test expected 403 for a transformation-scoped TL on the organization policy. The TL holds no `organization.read` on the organization, so the DG1 read gate correctly answers **404**. The test now expects 404 for the TL and 403 for AUD (org-scoped, read-only).
  - `focused-rp2.log`: the commit-time test first accepted 403 or 404. It was tightened to exactly 403 and passes (`focused-rp3.log`).

### 3.1 Integration (full suite)

- **Result:** 1505/1505 passed, exit 0, against the D-107 baseline of 1482.
- **Delta:** +23, the five new reporting files: `dashboards` 8, `filters` 3, `drilldown` 4, `scope` 3, `rag-policy` 5.
- **Pinned counts:** the only pinned-count change is the media-type pin (§4). The contract test passes with it (45 tests in its file).
- **Retries and flakes:** the log shows no port retry and no flaky or retried test.
- **Disk:** 20 GB free before the unit and integration runs (D-104 threshold: 3 GB).

## 4. Operations routed (pending-list delta)

`apps/api/test/support/p4-pending-kbe-g.ts`: **6 → 0**. All six are routed and exercised through `ctx.mirrored`, with each success body parsed by its zod mirror:

- `getExecutiveOverview`
- `getTransformationDashboard`
- `getWorkstreamDashboard`
- `getDashboardDrilldown`
- `getDashboardRagPolicy`
- `putDashboardRagPolicy`

**Media-type pin:** +1 JSON body (`putDashboardRagPolicy`), so `[292, 291, 1]` → `[293, 292, 1]` at my base. The orchestrator reconciles this with concurrent pins.

## 5. Contract and schema needs (for the orchestrator)

1. **No migration is needed.** No schema change.
2. **ETag `"0"`** (contract defect, the same one BE-L reported). The version-0 `getDashboardRagPolicy` answers ETag `"0"`, which is the value `putDashboardRagPolicy` takes as If-Match `"0"`. The contract's ETag pattern starts at `"1"`, so that one read is tested with `contract: false`. The architect should widen the pattern or document version 0.
3. **The drill-down `value` with several currencies.** The contract has one `value` and no currency parameter. Currencies are never added, so with more than one currency the drill-down `value` is `not_applicable` (`dashboard.value.multiple_currencies`) and each item carries its currency. The sum invariant holds per currency. A `currency` query parameter would be a contract addition.
4. **New reason and rule keys need EN/AR text** (FE-G/FE-A). Problem codes are exactly ADR-0037 §13's. The non-problem i18n keys introduced are:
   - Rule keys:
     - `dashboard.rag.outcomes.trajectory`
     - `dashboard.rag.value.validated_gap`
     - `dashboard.rag.portfolio.milestone_outcome`
     - `dashboard.rag.dependencies.needed_by_critical_path`
     - `dashboard.rag.decisions.overdue`
     - `dashboard.rag.decisions.due`
     - `dashboard.rag.adoption.curve`
     - plus the ADR's `.none` / `.none_open` / `.nothing_due` / `.no_indicators` / `.workstream_not_applicable`
   - Reason keys:
     - `dashboard.value.nothing_planned`
     - `dashboard.value.no_financial_benefit`
     - `dashboard.value.multiple_currencies`
     - `dashboard.kpi.no_period_in_window`
     - `dashboard.portfolio.no_allocated_value`
     - `dashboard.portfolio.no_approved_milestone`
     - `dashboard.portfolio.milestone_overdue`
     - `dashboard.portfolio.milestone_slip`
     - `dashboard.portfolio.slip_<reason>`
     - `benefit.non_financial`
     - `benefit.not_counted`
     - `benefit.overlap_open`
   - Headline label keys: `dashboard.headline.*`
5. **Merge order with BE-M.** The section puts my `db-errors.ts` block "after BE-M". BE-M's block is not in my base, so `mapP4DashboardError` sits after BE-L's `mapP4ChangeControlError`, with its one call line. Keep both at merge.

## 6. Interpretations made (for the domain reviewer)

- **Value** sums only the five financial classes over counted, monetised benefits. Validated values of a benefit with an open overlap are held back (ADR-0030 §7). Non-financial benefits are listed as Value n/a and never summed.
- **The window per state.** Planned, submitted and validated are "to date": period end ≤ as-of, and ≥ the window start when a period filter is set. Forecast lines are those whose period ends inside the period window, or all of them without a period filter.
- **Portfolio ranking.** Σ planned × allocation share, in the transformation's currency, presented and ranked at 4 places, half-even.
- **The milestone component** reads open (not achieved, not cancelled) milestones with an approved date.
- **Dependencies and decisions under a period filter** are those whose needed-by or due date lies inside the window. An undated one is outside a window.
- **The owner filter** leaves the investment line out, because investment lines have no benefit owner.
- **The workstream Value** counts each allocated benefit once at its full value, never share-scaled. This matches ADR-0030's "counted once" rule.

## 7. What remains

- **KBE-G2** (separate scheduled task, D-106 (f)):
  - the Finance and adoption dashboards;
  - My Work;
  - the workspace header;
  - `WorkflowsReadPort` and its `server.ts` line;
  - the REQ-S13-001 sweep of those three dashboards.
  KBE-G2 appends to `dashboards/index.ts`, `schemas/dashboards.ts` and `p4-exercises-kbe-g.ts`.
- **FE-G:** the screens, chips, drill-down panel and the en/ar texts of §5 item 4.
- **Not created:** `test/integration/reporting/t10-rag.test.ts`, which the section lists. Its proofs (REQ-PB-063, REQ-PB-064, configured thresholds) are in `dashboards.test.ts`, `rag-policy.test.ts` and the unit tests instead.
- **Not done:** the ADR-0037 "Consequences" test with 50 synthetic transformations bounding the query count. The facts are loaded with set queries, not per row. The exceptions are slice A's `statusOf`, called once per distinct KPI and scope, and one schedule network per transformation that has a dependency on an initiative.
- **Merge conflicts to expect:** `reporting.test.ts` and `server.test.ts` (BE-M has to make the same change), `db-errors.ts` (block order), `contract.test.ts` (the media-type pin), and `schemas/index.ts` (export line order).
