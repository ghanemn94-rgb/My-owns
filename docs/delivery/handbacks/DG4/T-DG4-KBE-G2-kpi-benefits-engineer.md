# Handback T-DG4-KBE-G2 (kpi-benefits-engineer): the Finance and adoption dashboards, My Work, the workspace header and `WorkflowsReadPort`

- **Stage:** P4, gate DG4 (BUILDING). Assignment `docs/delivery/assignments/DG4/T-DG4-KBE-G2.md` (sha256 `01c46a7d…ad4584`, verified with `sha256sum`). Section: `docs/architecture/p4-work-split.md` §J+K JK.5.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-G2-kpi-benefits-engineer-20261010T013144Z-727aac76","session_id":"727aac76-2f8c-4351-bcfb-c59f0ea340fd"}`.
- **Base:** branch `dg4/kbe-g2` at `a8bcf5d1409005ae725538ca30764fcf340e16d2` (`git rev-parse HEAD`), clean tree at start. The changes are left **uncommitted**, as the assignment asks.
- **Time:** started `2026-10-10T01:31:56Z`, ended `2026-10-10T02:27:27Z` (`date -u`), about 56 minutes, inside the limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` → `PASS gate DG3 (historical)`, **exit 0** (run before any edit).
- **Product gates G1–G6 are business approvals inside the product.** Nothing here reads or writes DG0–DG7. No agent, seed or job grants a real business, Finance or IT approval. All test data is synthetic; a Finance validation or trajectory approval in a fixture is a synthetic in-product approval of test data.

## 0. First: production wiring (D-107)

**This task needs one wiring line in `server.ts`, and it is in my ownership (JK.5: "`reporting/ports.ts` … and its `server.ts` wiring line").** I wrote it; nothing is left for the orchestrator to wire.

- `server.ts` now calls `setWorkflowsReadPort({ gateReadiness: gateReadinessReader(gateFacts) })` right after BE-J's `wireTransitionDecisionApprovals(…)`, using the production `GateFactsProvider`.
- `server.ts` no longer imports or calls `registerWorkspaceHeaderRoutes` from `transformations` (the BE-A stub is deleted, ADR-0037 §11). The header route is registered by `reporting/index.ts` (one line).
- **Proof (D-107 lesson):** `apps/api/test/integration/reporting/workspace-header.test.ts` builds the **real server through the harness** (`startApi` → `buildServer`) and wires nothing by hand. Its test "equals the live gate view's missing mandatory criteria" gets `gateReadiness.state = "known"` with the same `missingMandatoryCount` and gate status as `GET …/gates/G1`. This only passes if the `server.ts` line runs: the unwired port answers `null`, and the header would then show `unknown`. A second test swaps in a port answering `null`, checks the header shows Unknown (never `ready`), then restores the wired port.

## 1. Changed files

### New files (all inside my ownership)

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/dashboards/finance.ts` | `getFinanceDashboard` (`GET /api/v1/dashboards/finance`). Pure helpers `financeClassOf`, `financeClassLines`, `subtractValues`, `grossNetLines`, `investmentByCurrency`, `pendingValidationCount`. |
| `apps/api/src/modules/reporting/dashboards/finance.test.ts` | Unit tests with worked fixtures: class × state × currency lines, 0.1 + 0.2 = 0.3, the window, Unknown on a missing amount, overlap hold-back, no currency conversion, non-financial = no line, net = gross − cost (10 M − 1 M = 9 M), Unknown cost → Unknown net. |
| `apps/api/src/modules/reporting/dashboards/adoption.ts` | `getAdoptionDashboard` (`GET /api/v1/dashboards/adoption`) and `countOpenInterventions`. |
| `apps/api/src/modules/reporting/workspace-header.ts` | `getWorkspaceHeader` (`GET /api/v1/transformations/{t}/summary`): the eight elements. |
| `apps/api/src/modules/reporting/ports.ts` | `WorkflowsReadPort`, `setWorkflowsReadPort`, `workflowsReadPort`. Unwired, it answers `null` and fails closed. |
| `apps/api/src/modules/workflows/gate-readiness-read.ts` | `gateReadinessReader(gateFacts)`: the read-only live readiness of the current phase's gate. It reuses the gate view's own functions (`evaluateGate`, `loadGateFacts`, `coveringExceptions`, `exceptionBusinessDate`, `inheritedApprovalOf`), so nothing is re-derived. |
| `apps/api/src/modules/tasks/dashboard-facts.ts` | `loadOpenWorkItems(db, userId, transformationId?)`: one user's open work items, read-only. |
| `apps/api/test/integration/reporting/finance-adoption.test.ts` | Finance and adoption proofs, plus the X/Y scope sweep (9 tests). |
| `apps/api/test/integration/reporting/my-work.test.ts` | REQ-S03-008 proofs, the 30-kind completeness test, drafts, action items, paging, 401 and ADM (9 tests). |
| `apps/api/test/integration/reporting/workspace-header.test.ts` | REQ-S03-011 proofs, the port proofs (D-107) and scope (7 tests). |

### Edited files

| File | Change |
|---|---|
| `apps/api/src/modules/reporting/my-work.ts` | The BE-A stub is filled: `getMyWork`, `MY_WORK_SECTION_BY_KIND` (30 kinds), `sectionOfKind`, `draftHref`, `readableTransformationIds`, `workItemOf`, `loadMyWork`, `upcomingDeadlines`. |
| `apps/api/src/modules/reporting/dashboards/index.ts` | Two registration lines (Finance, adoption), added after KBE-G's. |
| `apps/api/src/modules/reporting/index.ts` | One import and one registration line for the workspace header. |
| `apps/api/src/modules/tasks/index.ts` | One export line (`loadOpenWorkItems`). |
| `apps/api/src/modules/transformations/index.ts` | The stub's export line is removed. |
| `apps/api/src/modules/transformations/workspace-header.ts` | **Deleted** (the empty stub; ADR-0037 §11). |
| `apps/api/src/server.ts` | The stub import and call are removed; the port wiring line and its two imports are added (§0). |
| `packages/shared/src/schemas/dashboards.ts` | Shapes appended after KBE-G's: `FINANCE_LINE_STATES`, `financeValueLine`, `financeDashboard`, `adoptionIndicatorRow`, `adoptionDashboard`, `MY_WORK_SECTIONS`, `myWorkSection`, `myWorkItem`, `myWorkSectionPage`, `myWork`, `userRef`, `currencyValue`, `WorkspaceGateReadiness`, `workspaceHeader`. Also one import of `gateInheritedApproval`. |
| `apps/api/test/integration/contract/p4-exercises-kbe-g.ts` | Four mirror entries added to `P4_MIRRORS_KBE_G`. `exerciseP4KbeG2Operations` is appended and called at the end of KBE-G's exercise, so `contract.test.ts` is unchanged. |
| `apps/api/test/support/p4-pending-kbe-g2.ts` | Now empty (4 → 0). |

## 2. Behaviour delivered, per requirement row

### REQ-S03-008: My Work

> **Acceptance:** "A02;A12: a KPI owner with a due actual sees it under Missing updates with a link that opens the KPI period entry; another user's items never appear"

- **The real job creates the item.** `getMyWork` reads the item that slice A's **real** period-open job creates. The test calls the worker's `openDuePeriods` on a scheduled monthly period that has ended. The KPI owner (KDS) then sees the `kpi_update_due` item under `missing_updates` with:
  - `href` = `/transformations/{t}/kpis/{k}/actuals` (the KPI period-entry link the job stores);
  - `dueDate` = `2026-06-10`, `overdue` = true, and `code` = `2026-05`;
  - the item also appears in `upcomingDeadlines`.
- **Other users' items never appear.** TL, BO and AUD never see KDS's task or KDS's draft. The query is keyed by `assignee_user_id` (work items), `created_by` (drafts) and `owner_user_id` (action items).
- **Section map and completeness test.** `MY_WORK_SECTION_BY_KIND` maps each of the 30 kinds of migrations `0028`–`0058` to one section, exactly as ADR-0037 §7 lists them (9 assigned actions, 5 reviews, 8 approvals, 5 missing updates, 3 other). The completeness test reads every `work_item_kind` row of the migrated database. It fails on any unmapped kind, and also on any mapped kind that does not exist. An unmapped kind is still shown under `other`, never hidden.
- **Drafts.** Drafts come from `my_work_draft` (`0056`) and list only the caller's own. Each carries its record's API path.
- **Action items** are listed once. An open or in-progress action owned by the caller is shown as `source: action_item` until an open work item of the caller names it; from then on only the work item is shown. Work items follow their source through the tasks services (BE-R1); this read re-derives nothing.
- **Scope.** An item of a transformation the caller cannot read is left out (the access module's `scopeFilter`).
- **Paging.** Without `section`, the response has the first page of every section, each section's `total`, and `upcomingDeadlines`. With `section`, it pages that section. Each `nextCursor` is bound to its section and its user; a cursor without `section`, or for another section or user, answers 400 `validation.cursor`.
- **Upcoming deadlines** use `deadline_horizon_working_days` (the RAG policy, default 10) in the organization's business calendar. Without a configured calendar the horizon is Unknown, and only items due on or before the business date are listed.
- **Access.** 401 without a session. An ADM-only caller gets an empty My Work (ADR-0037 §10).
- **Nothing is stored.** The read runs in a READ ONLY transaction, and the audit-event count is unchanged after a read.

### REQ-S03-011: workspace header

> **Acceptance:** "A02: from the workspace header one click opens the transformation's RAID filtered to it; the header shows the eight elements with Unknown where data is missing"

`GET /transformations/{t}/summary` returns the eight elements. Each one has an explicit Unknown:

1. **`phase`**: `currentPhase`, `mode` and `entryPhase`.
2. **`gateReadiness`**: comes **through `WorkflowsReadPort`** (§0): `state`, `gateCode`, `status`, `inheritedApproval` (the DG3 annotation, never an approval), `missingMandatoryCount` (mandatory criteria not complete and not covered today by an accepted, unexpired gate exception) and `ready` (true exactly when that count is 0). A port answering `null` → `state: "unknown"` with every member null.
3. **`northStar`**: the current North Star (`status = 'current'`). None → `unknown`.
4. **`owners`**: sponsor and lead, each `null` (Unknown) separately when its column is NULL.
5. **`outcomeHealth`**: the T10 Outcomes area's `rag` (KBE-G's engine, KPI trajectory statuses only) and the count of outcomes per status. An outcome without a KPI is `unknown`, never green.
6. **`benefits`**: planned and validated to the business date per currency (the Value area's window and counting rules), `benefitCount` and `nonFinancialCount`. **Unknown is decided by slice G's `valueStatusOf`** from `sustainment/index.ts` (D-107): `no_benefit` → `state: "unknown"` with empty lists (no benefit is not 0). `benefitCount` = `valueStatusOf(…).benefits.length`.
7. **`keyDecisions`**: up to 5 open T16 asks by due date, and `overdueCount` (the ADR-0032 rule from KBE-G's Decisions area).
8. **`nextActions`**: up to 5 of the **caller's own** open work items for this transformation, by due date, and the gate's `missingMandatoryCount` (null when the gate readiness is Unknown).

The tests prove:
- the empty-transformation case: no North Star, no sponsor, no lead, no outcome KPI, no benefit → each Unknown; key decisions and next actions are empty facts with count 0;
- the populated case: a North Star set through the API, sponsor and lead, one ask due yesterday (Asia/Riyadh) → `overdueCount` 1, and TL's task in TL's next actions only;
- the benefits case: planned 1000 and validated 400 SAR, `benefitCount` 1;
- 404 for an outsider, an ADM-only caller and an unknown id; 200 for AUD; 400 for an unknown query parameter;
- a read stores nothing.

**Not delivered here:** the "one click opens the transformation's RAID filtered to it" clause is a web concern (ADR-0037 §9; FE-G's e2e). The header gives the transformation context, and FE-G builds the link.

### REQ-S13-001: Finance, adoption and personal work dashboards (my half)

> **Acceptance:** "A04;A12: a user scoped to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y record or figure"

My half covers the Finance dashboard, the adoption dashboard and My Work (the personal work dashboard). KBE-G covered the other three.

**Finance** (`GET /dashboards/finance`). Same filters, scope and 404s as the Executive Overview.
- **`lines`.** One line per value class × state × currency (ADR-0030 §7 item 2): the five financial classes and `non_financial_valued`, across all seven states (planned, forecast, measured, submitted, validated, rejected, sustained).
  - Each state is summed on its own. Forecast is never validated, scenarios are never read, currencies are never converted, and only benefits counted once enter.
  - An open overlap holds back validated and sustained values.
  - The window is the Value area's: "to date", and forecast "in the window".
- **Gross, implementation cost and net.**
  - The `gross` lines (planned, validated) **are** the Value area's `value.planned`/`value.validated` figures, so they drill to them with an equal decimal sum (tested, paging included).
  - Implementation cost is the `value.investment` headline.
  - The `net` lines are gross − cost per currency, exact decimals. A missing amount makes them Unknown, never 0.
- **`headlines`.** The Value area's headlines, plus `finance.pending_validation`. Its count equals `pendingValidationCount` and its drill-down (1 submitted measurement in the fixture).
- **`nonFinancialCount`.** Counted benefits without an approved valuation method: Value n/a, in no line. For a transformation with only a non-financial benefit the response has `lines: []`, `nonFinancialCount: 1`, and `value.validated` = `{state: "not_applicable", value: null, reasonKey: "dashboard.value.no_financial_benefit"}`. **Non-financial benefits are n/a, never 0.**
- **Worked fixture** (revenue uplift, SAR):
  - planned 1000 + 500 = **1500**;
  - validated **900**, submitted (pending) **250**, measured **1150**;
  - forecast, rejected and sustained are known **0**;
  - gross 1500/900; net 1500/900 (no investment line, so the cost is a known 0).

**Adoption** (`GET /dashboards/adoption`):
- `area`: the T10 People & adoption area (the same one the other dashboards show);
- `indicators`: each linked indicator with its KPI status and value. One with an accepted actual of 130 shows `value`; one without an actual shows `rag: unknown`, `value.state: unknown`, `value: null`, and the area is not green;
- `openInterventionCount`: planned or in-progress interventions, narrowed by the owner and window filters;
- one row per transformation.

**Scope sweep** (`finance-adoption.test.ts`). Transformation Y (BU a2) holds distinctive non-zero figures: 77777.7 planned, 66666.6 validated, a 987654.321 adoption actual, plus their ids. A user granted FIN and TL only at the X transformations then reads both dashboards.
- No Y id or figure appears in any tile or total, nor in **every** headline, line and indicator drill-down the responses link to.
- As a sanity check, the org-wide auditor does see Y, so the sweep can fail.
- An explicit Y `transformationId`, organization B, or an ADM-only caller → 404; a foreign period → 422 `dashboard.period_not_found`.
- My Work's scope proof is in `my-work.test.ts`: an item of an unreadable transformation is left out.

## 3. Checks actually run (real exit codes)

Environment: Node 24.21.0, offline. Harness ports **25201–25249** only (`QA_PG_PORT`/`MTH_PORT_POOL`). Disk checked before each full run: 22 GB free. An empty `apps/api/.claude/.cc-writes` directory was removed before the tests.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` | **0** | `PASS gate DG3 (historical)` | (start of run; output above) |
| 2 | `pnpm -r typecheck` | **0** | all packages Done | `T-DG4-KBE-G2-evidence/typecheck.log` |
| 3 | `pnpm -r build` | **0** | | `build.log` |
| 4 | `pnpm lint` | **0** | | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **123** (see note) | every file formatted; one `[error] No files matching the pattern were found: "apps/api/src/modules/transformations/workspace-header.ts"` | `prettier.log` |
| 5b | the same, with that one deleted path filtered out | **0** | "All matched files use Prettier code style!" in all batches | `prettier-filtered.log` |
| 6 | `pnpm openapi:lint` | **0** | | `openapi-lint.log` |
| 7 | `pnpm test` with LANG/LC_ALL/LC_CTYPE unset | **0** | unit **2364 passed** (124 files); formula-nocodegen **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **0** | unit **2364 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25210 MTH_PORT_POOL=25211-25249 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **178 files, 1686/1686 passed** (1661 + 25 new; no pinned-count change: `contract.test.ts` and the catalogue pins are untouched) | `integration.log` |

**Note on #5 (disclosed, not hidden).** The literal command exits 123 for one reason only: the deleted stub `transformations/workspace-header.ts` is still in the git index. The sandbox mounts `.git` read-only (`git rm` failed with "Unable to create '…/index.lock': Read-only file system"), so the deletion is unstaged, and `git ls-files -c` still lists the path. Prettier itself reports every file formatted. Once the orchestrator stages the deletion (`git rm apps/api/src/modules/transformations/workspace-header.ts`, or `git add -A` of the tree), the literal command has nothing missing to check. #5b proves the rest of the tree passes.

**Counts against the D-110 baseline** (unit 2352 + 259/2; integration 1661):
- unit: +12 (`finance.test.ts`);
- integration: +25 (the three new files, 9 + 9 + 7). The contract test's count is unchanged, because my exercises run inside KBE-G's existing exercise.

**Earlier focused runs during development** (all real):
- the three new integration files plus `contract.test.ts`: 54/54 passed, exit 0;
- `vitest --project unit-node apps/api/src`: two intermediate failures, both fixed before the full runs above:
  - `architecture.test.ts` flagged three computed member accesses;
  - `workflows.test.ts` and `reporting.test.ts` pin their `index.ts` export lists (§5 items 1–2).

## 4. Operations routed (delta to my pending list)

`apps/api/test/support/p4-pending-kbe-g2.ts`: **4 → 0**.

| Operation | Route | Exercised in |
|---|---|---|
| `getFinanceDashboard` | `GET /api/v1/dashboards/finance` | `p4-exercises-kbe-g.ts` → `exerciseP4KbeG2Operations` (200 + 404 org B) |
| `getAdoptionDashboard` | `GET /api/v1/dashboards/adoption` | same (200) |
| `getMyWork` | `GET /api/v1/me/work` | same (200 all sections; 200 `section=drafts&limit=10`) |
| `getWorkspaceHeader` | `GET /api/v1/transformations/{transformationId}/summary` | same (200; 404 outsider) |

`config.consumes`: none of the four has a request body (all GET), so no `consumes` and **no media-type pin delta** (`contract.test.ts` untouched).

## 5. Deviations from the section, and needs for the orchestrator

1. **`workflows/index.ts` export line: not added.** JK.5 says `gate-readiness-read.ts` has "one export line in `workflows/index.ts`". But `workflows/workflows.test.ts`, which I do not own, pins that file's export list exactly, and adding the line fails it. I import `gateReadinessReader` in `server.ts` directly from `./modules/workflows/gate-readiness-read.ts`, the existing `raidDependencyPort` precedent (`./modules/workflows/t08-dependencies.ts`). If you want the export line, add it together with the pin update in `workflows.test.ts`.
2. **`reporting/index.ts` exports nothing new.** `reporting/reporting.test.ts`, also not mine, pins the export list to `REPORTING_MODULE` and `registerReportingModule`. So `server.ts` imports `setWorkflowsReadPort` from `./modules/reporting/ports.ts` (the same precedent). `reporting/index.ts` gains only the header's registration line.
3. **Open interventions are read from `adoption_intervention` directly** in `dashboards/adoption.ts`. `adoption/dashboard-facts.ts` (KBE-G's, frozen) has no intervention loader, although ADR-0037 §1 lists "open interventions" among its facts. The read is a count over the readable transformation ids only. A cleaner home would be a loader in `adoption/dashboard-facts.ts` (a KBE-G file).
4. **Measured, rejected and sustained lines** are read from the `benefit_value_line` view directly in `finance.ts`. That view is named in ADR-0037 §1, but KBE-G's `benefits/dashboard-facts.ts` loads only the four headline states.
5. **Contract need (for the architect): the drill-down has no value-class parameter.** A per-class Finance line therefore carries `drilldownHref` only when it *is* the whole state's figure in its currency (the only financial class there), so the decimal-sum invariant holds. Otherwise it carries `null`, and so do the derived `net` lines and the states with no drill-down metric (measured, rejected, sustained). Every **headline** and the `gross` lines drill exactly. Adding `valueClass` to `getDashboardDrilldown` (and metrics for measured, rejected and sustained) would let every line drill.
6. **Interpretation (domain reviewer):** gross and net are expressed as `FinanceValueLine`s with `valueClass` `gross` / `net` (states `planned`, `validated`). The `FinanceDashboard` schema has no gross/net member, and `valueClass` is a free string. With an owner filter no `net` line is shown: investment lines have no owner, and KBE-G's narrowing drops them.
7. **New display values, no new problem code.**
   - No new refusal code was added.
   - Reused codes and keys: `validation.cursor` (platform), the ADR-0037 keys, and `dashboard.finance.pending_validation` as the Finance headline's `labelKey` (an accepted A2 key with text "Values waiting for Finance validation.").
   - **FE-G needs EN/AR labels** for the `valueClass` values `gross`, `net` and `non_financial_valued` (ADR-0030 §7 names the last), and for the seven `FinanceLineState` values.
8. **Header elements limited to the contract.** `phase` carries `currentPhase`, `mode` and `entryPhase` only. The ADR mentions phase labels from `phase_definition`, but the `WorkspaceHeader` schema has no member for them.
9. **Schema / migration needs:** none. No migration number was used.

## 6. What remains

- **The orchestrator:** stage the deletion of `apps/api/src/modules/transformations/workspace-header.ts` (§3 note); decide on §5 items 1–5.
- **FE-G:** the Finance, adoption, My Work and header screens; the one-click RAID link with its e2e (REQ-S03-011); and the EN/AR labels of §5 item 7.
- **Not done:** a unit test file for `my-work.ts` helpers. They are covered by the integration tests. **Also not done:** the ADR-0037 "Consequences" bound of 50 synthetic transformations on query count, which this task's dashboards inherit from KBE-G's engine. The engine uses set queries, plus slice A's per-KPI `statusOf`.
- **No row is complete at this task's end.** REQ-S03-008, REQ-S03-011 and REQ-S13-001 each still need FE-G's screens, and REQ-S13-001 also needs KBE-G's half (merged).

## 7. Merge instructions

- No migration. The changes are uncommitted on `dg4/kbe-g2`.
- **Conflicts to expect:**
  - `server.ts`: imports near the reporting and workflows lines; the wiring line after `wireTransitionDecisionApprovals`;
  - `packages/shared/src/schemas/dashboards.ts`: appended at the end;
  - `p4-exercises-kbe-g.ts`: the mirror map and the end of `exerciseP4KbeGOperations`.
- BE-M3 and FE-D own none of these files.
