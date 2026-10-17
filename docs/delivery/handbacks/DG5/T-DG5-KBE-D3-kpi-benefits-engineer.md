# Handback T-DG5-KBE-D3 (kpi-benefits-engineer): system SUM totals in the assembled tables (D-163; F-DG5-qa-c-3)

- **Stage:** P5, gate DG5 (BUILDING). This is a repair task (D-163). Its Added scope replaces the file lists of §F.2 and §F.4.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-KBE-D3-kpi-benefits-engineer-20261017T013232Z-167826c6","session_id":"167826c6-c258-426a-aaf6-b21e278dfa52"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-KBE-D3.md`. Its SHA-256 `945550118cc0…846ed053` was verified before starting.
- **Starting revision:** `f21a5363939294effa4157c5e6db3d404b04ce3c` on branch `dg5/kbe-d3`. The changes are left **uncommitted** for the orchestrator.
- **Time:** started `Sat Oct 17 01:32:46 UTC 2026`. The end time is in the last section.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0. Log: `T-DG5-KBE-D3-evidence/validate-historical-DG4.log`.

All data in the tests is SYNTHETIC. The demo dataset is an illustrative example, not Mobily performance. Product gates G1–G6 are business approvals inside the product, and nothing here grants a business, Finance or IT approval. Nothing here touches DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/reporting/reports/assemblers/table-totals.ts` (new) | Pure helper `columnTotal` / `columnTotals` that builds one declared `{columnKey, formula: "sum", value}`. Rules: decimal columns only. No total when the column mixes unit kinds, value bases or currencies. An `unknown` or `stale` cell gives an Unknown total (`value: null`, reason `not_computable`). An n/a cell with no number is left out. The value is the screen's own figure when the caller passes it, otherwise the decimal.js sum. The total is provisional if any input is provisional, and validated only if every labelled input is validated. |
| `apps/api/src/modules/reporting/reports/assemblers/table-totals.test.ts` (new) | 16 unit tests with worked fixtures, including the playbook examples Δ attach × customers × ARPU and volume × Δ unit cost, and 0.1 + 0.2 = 0.3. Covers mixed currency, basis and unit (no total), unknown and stale (Unknown total), and schema validity. |
| `apps/api/src/modules/reporting/reports/assemblers/business-cases.ts` | Adds tables `group_<case#>_<basis\|cost_cash\|cost_non_cash>_<ccy>`: the lines behind each single-basis total on the screen. That covers gross benefits per value basis and implementation cost (cash and non-cash), per case and currency. Each table has a SUM total equal to the DG3 engine's figure (`loadCaseTotals`, by reference). |
| `apps/api/src/modules/reporting/reports/assemblers/registers.ts` | For `{register: "benefits"}` only, adds the screen's totals block (`benefitTotalSections`). There is one table `totals_<ccy>_<value_class>` per currency × value class. Rows are the counted, monetised benefits. Columns are validated, sustained and pending (submitted), each with a SUM total. |
| `apps/api/src/modules/reporting/reports/assemblers/diagnostic.ts` | The `value_pools` table declares SUM totals on `upside_amount` and `downside_amount`, valued from the screen's `totalValuePools`. That only happens when every pool is in one currency. An unquantified pool makes the total Unknown. |
| `apps/api/test/integration/reporting/table-totals-demo.test.ts` (new) | The literal test on the demo dataset. The XLSX of `business_cases` and of `registers` `{register:"benefits"}` goes through the real API and the worker's `runExport`, and must contain `SUM(…)` formulas whose cached values equal `GET /business-cases/{id}/totals` and `GET /benefit-totals`. It also checks that no other formula exists. |
| `apps/api/test/integration/reporting/kbe-c2-assemblers.test.ts` | `assertBasesNeverMixed` now allows declared totals, but only on a one-currency decimal column, equal to the decimal sum or Unknown. New checks: business-case groups equal the engine; a USD line gets its own table; the cash-cost group with an Unknown line has an Unknown total while the screen shows a partial 40000; the mixed-currency lines table and the measures table have no total; value-pool totals with an unquantified pool are Unknown. |
| `apps/api/test/integration/reporting/registers-report.test.ts` | Every `totals_*` table total equals `GET /benefit-totals`, line by line (an Unknown on the screen is Unknown in the report). Rows are counted benefits of that class and currency; the pending total is provisional; the unmonetised CX benefit is in no totals table; the register table itself still has no total. |
| `docs/delivery/handbacks/DG5/T-DG5-KBE-D3-*` | This handback and its evidence logs. |

No file outside my ownership was edited: none in `packages/reporting/**`, `packages/shared/**`, `apps/worker/**` or `tests/qa/**`.

## 2. Behaviour delivered

### REQ-S13-006

Acceptance text: *"A15;A12: a RAID description '=HYPERLINK(...)' exports as text; **a system SUM total remains a formula**"*.

The XLSX writer was already in place (BE-M). The missing part was that no assembler declared a total. Now:

- **Demo `business_cases` XLSX.** It contains `SUM(D3:D3)` ×4 and `SUM(D3:D5)`. The cached values 1584000 (avoided cost), 1920000 (margin uplift), 7128000 (revenue uplift), 3660000 (cash cost) and 1170000 (non-cash cost) each equal the screen's `GET /business-cases/{id}/totals` figure.
- **Demo `registers {benefits}` XLSX.** It contains 9 `SUM(…)` cells, one per class × state. Each cached value equals `GET /benefit-totals`, for example revenue uplift validated 222750, pending 99000, and margin uplift validated 80000.
- Both are in `targeted-integration-3-demo.log` and the A15 log line `A15 demo XLSX formulas: {...}` (`targeted-integration-2-a15.log`).
- `tests/qa/integration/a15-demo-transformation-outputs.test.ts` › "a system SUM total remains a formula in the XLSX of the business cases and of the benefits register" **passes unchanged** (✓ in `targeted-integration-2-a15.log`).

### REQ-S13-008

Acceptance text: *"Values not validated carry a 'provisional' label"*.

Each declared total carries the ADR-0045 §5 label of its inputs:

- provisional when any summed value is provisional, for example the pending (submitted) total and a revenue line whose formula is unvalidated;
- validated only when every labelled input is validated;
- otherwise n/a, for example cost lines.

Forecast and pending value are never presented as validated.

### REQ-S13-004

Acceptance text: *"each of the ten outputs … generates from the demo transformation and contains that transformation's ID and records"*. The new tables cite the records they show as sources: business-case lines, and benefits under `sectionKey` `totals_*`. A15's first two REQ-S13-004 tests still pass (`targeted-integration-2-a15.log`).

### Rules from the Added scope, and how each is met

- **Same decimal.js value as the screen.**
  - Business cases use the engine's `MoneyTotal.amount` by reference.
  - Value pools use the screen's `totalValuePools`.
  - The benefit totals are restated from the module-private `benefits/totals.ts`. The architecture test allows only `benefits/index.ts` as a public surface, and it does not export `totalsOf`. The restatement is the per-benefit sum of `benefit_value_line` amounts per state, held back on an open overlap, counted only. `registers-report.test.ts` and the demo test compare it with the route, figure by figure.
- **Mixed currency, basis or unit: no total.** Enforced in `columnTotal`, unit-tested, and checked by integration tests on the business-case `lines` table (SAR + USD).
- **Unknown or stale cell: Unknown total.** Unit-tested. In integration, the cash-cost group with a missing line gets `value: null, validation: unknown`, while the screen shows a partial 40000 with 1 unknown line. The unquantified value pool gets an Unknown total too.
- **Regression.** A stored snapshot's content is fixed at INSERT, and nothing re-assembles it. The REQ-S13-007 tests in `report-snapshots.test.ts` (an issued snapshot keeps its content) are part of the integration run. Only snapshots generated after this change contain the new tables and totals.

## 3. Every table examined (assembler · section · column → total or not, and why)

| Assembler | Section | Decimal column(s) | Total? | Why |
|---|---|---|---|---|
| charter | outcomes, guardrails | none | no | No decimal column (rank is a count; the schema only allows totals on decimals). |
| diagnostic | items | `impact_amount` | no | The T01 screen shows no total, and amounts may be in mixed currencies. |
| diagnostic | findings | none | no | — |
| diagnostic | baselines | `value` (unit `other`) | no | Free-text units per row; the screen shows no total. Never summed. |
| diagnostic | value_pools | `upside_amount`, `downside_amount` | **yes** (one currency) | The DiagnosePage `ValuePoolTotals` shows a per-currency upside/downside total. With several currencies there is no total. An unquantified pool gives Unknown, where the screen shows "partial". |
| tom | canvas, gaps, decisions, dependencies, capabilities | none | no | — |
| business_cases | cases, case_sections | none | no | — |
| business_cases | lines | `amount` | no | Mixes investment and benefit lines, value bases (revenue, margin, cash, avoided cost …) and currencies. |
| business_cases | lines | `fte` | no | The screen shows no FTE total. |
| business_cases | totals | `amount` | no | The rows are different measures (gross, per basis, cost, cash/non-cash, net) of different cases. Summing them would mix bases and double-count (D-117). |
| business_cases | **group_<n>_<basis>_<ccy>** (new) | `amount` | **yes** | Equals `grossBenefitsByValueBasis[basis][ccy]` of CaseTotals (the screen's "By value basis" breakdown). |
| business_cases | **group_<n>_cost_cash\|cost_non_cash_<ccy>** (new) | `amount` | **yes** | Equals `implementationCostCash` / `implementationCostNonCash` (the screen's "Cash" / "Non-cash"). |
| business_cases | (gross benefits, implementation cost total, net value) | — | no SUM table | Gross adds revenue uplift to margin uplift and avoided cost to cash saving; net subtracts across bases. Against D-117 / F-DG4-121, they stay figures in the `totals` table only. |
| roadmap | waves, initiatives, milestones, dependencies | none | no | — |
| registers (raid, kpis, decisions, dependencies, actions) | register | none (a KPI target is text per its own unit) | no | — |
| registers (benefits) | register | `baseline`, `target` (unit `other`), `planned_value`, `realized_validated`, `realized_sustained`, `pending` | no | Rows mix currencies, value classes and free-text units. The list screen shows no column total. |
| registers (benefits) | **totals_<ccy>_<value_class>** (new) | `realized_validated`, `realized_sustained`, `pending` | **yes** | The BenefitsPage "Totals" block (`GET /benefit-totals`): one line per class × state per currency. |
| gate_pack | criteria, evidence | none | no | — |
| meeting_minutes | attendance, agenda, outputs, actions | none | no | — |
| executive_dashboard | items (per headline) | KPI value columns | no | The dashboard screen shows headline figures, not column totals. The rows are different KPIs. |
| handover | items, controls, improvement_items | none | no | — |
| meeting_pack | agenda, asks, decisions, actions | none | no | — |
| executive_pack | (no table sections) | — | no | — |

Not shown in the new benefit tables:

- **Forecast, planned, measured and rejected totals** of the benefits screen. Their states have no report value basis (`rejected`, `measured`), or their column label would read the same as the register's different `planned_value` column. The three Finance states are those of the register's existing columns.
- **The screen's "pending overlap" lines.** A held-back cell is n/a with no number and is outside the class total, as on the screen. The held-back sum is not shown as a separate total. A column holding such a cell gets the total as a value with no formula, because the writer emits a formula only when every row has a number.

## 4. Checks (real exit codes)

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` | `validate-historical-DG4.log` |
| `pnpm -r typecheck` (after the last code change) | 0 | — | `typecheck-r2.log` (first run, also 0: `typecheck.log`) |
| `pnpm -r build` | 0 | — | `build.log` |
| `pnpm lint` (after the last code change) | 0 | — | `lint-r2.log` (`lint.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after the last code change) | 0 | All matched files use Prettier code style | `prettier-r2.log` (`prettier.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| Targeted integration: kbe-c2-assemblers, registers-report, table-totals-demo | 1 → 0 | First run: 14/15. The one failure was a header lookup in my own new demo test, since fixed. Re-run of the demo test: 2/2 | `targeted-integration-1.log`, `targeted-integration-3-demo.log` |
| Targeted: `tests/qa/integration/a15-demo-transformation-outputs.test.ts` | 1 | **The SUM test passes.** 5/7 pass. The 2 failures are REQ-PB-089 (`content.synthetic` and the illustrative label). They belong to BE-N2's concurrent scope (`packages/shared/src/schemas/report.ts` `synthetic`, renderers). `synthetic` does not exist at HEAD (`git show HEAD:packages/shared/src/schemas/report.ts \| grep -c synthetic` → 0), so they fail without my change too. | `targeted-integration-2-a15.log` |
| `vitest --project unit-node` for architecture.test.ts, reporting.test.ts and reports/** (after the fix) | 0 | 7 files, 216/216 | (console; see §4.1) |

The full `pnpm test` (locale unset / `C.UTF-8`) and `pnpm test:integration` runs are covered in §4.1 and in the final section.

### 4.1 Non-zero exits, disclosed

- **`pnpm test` run 1** (`test-locale-unset.log`, `test-c-utf8.log`): exit 1 in both locales.
  - Results: unit-node 2266/2268 (unset) and 2265/2268 (C.UTF-8); unit-web 1534/1534; formula 259 + 2 skipped.
  - Real defect, mine: `architecture.test.ts` and `reporting.test.ts` refused my first `table-totals.ts` because of computed member access with a non-literal key (`columns[j]`, `cells[j]`, `screenValues[k]`), which bypasses the module-interface check. I fixed it with `.at(j)` and a `Map`, and both tests passed afterwards (216/216, see above).
  - Not mine: under `C.UTF-8`, 2 `packages/reporting/src/pdf/pdf.test.ts` Arabic tests hit the 5 s timeout. That run overlapped my integration run on a 4-CPU machine shared with the other W18 worktrees.
- **`pnpm test:integration` run 1** (`integration-r1-crashed.log`): exit 1, with no test failure reported. The Vitest pool crashed: `Unhandled Rejection: Error: Channel closed … ERR_IPC_CHANNEL_CLOSED` (tinypool). It ran at the same time as `pnpm test` and `pnpm -r typecheck/lint` on a machine with about 3 GB free memory. I re-ran it alone; see the final section.
- **`pnpm test` run 2** (`test-locale-unset-r2.log`): unit-node 2259/2268. The 9 failures are all timeouts: 8 × 5 s in `packages/reporting/src/pdf/pdf.test.ts` and 1 × 30 s in the AST test of `architecture.test.ts`. This run overlapped `pnpm -r typecheck`, `pnpm lint`, prettier and integration run 2. Run on their own, the same tests pass (216/216 above). See the final section for the rest of run 2.

## 5. Operations routed (pending-list delta)

None. This task adds no route and no operation. The `p5-pending-*.ts` and `p5-exercises-*.ts` files are unchanged, and the pinned counts in `contract.test.ts` do not change.

## 6. Contract, schema or dependency needs (for the orchestrator)

- No new dependency, no migration (`0083` remains unused) and no OpenAPI or zod change. The `ReportTotal` and `totals[]` schema is used as it is.
- **Proposal for the owner of `apps/api/src/modules/benefits/index.ts`** (not my file): export `totalsOf` (or the pure `computeTotals`) from `benefits/totals.ts`. The benefits-register totals could then take the engine's figures by reference, as business cases do with `loadCaseTotals`, instead of restating the rules. Until then, `registers-report.test.ts` and `table-totals-demo.test.ts` guard against drift.
- **Note for BE-N2 / the XLSX writer:** none required. `totalRowCells` already emits the formula when every row has a number whose sum equals the declared value, and otherwise prints the value. Two observations:
  - Each new table becomes its own sheet, so a transformation with many cases gets many sheets. Sheet names repeat titles such as "Margin uplift", de-duplicated by `sheetName`.
  - Each sheet's title does not name the case. The `case` column states it.

## 7. User-facing texts made untrue

None found. The web report view already renders `totals` (`apps/web/src/pages/reports/ui.tsx` `data-totals`), and no en or ar string says that totals are planned or absent. The new tables reuse existing bilingual keys:

- `report.business_case_value_basis.*`
- `report.business_case_measure.implementation_cost_cash|non_cash`
- `report.benefit_value_class.*`
- `report.business_cases.{case,title,class,amount}`
- `report.registers.benefits.{code,title,realized_validated,realized_sustained,pending}`
- `export.total`

So no label is missing in either language.

One wording point for the owner of `packages/shared/src/reports/content-labels.ts`: the valued non-financial class table is titled with `report.benefit_value_class.non_financial` ("Non-financial" / "غير مالية"). A dedicated "Non-financial (valued)" key would be more precise, but it would need a new label pair in that file, which I don't own.

## 8. Merge instructions

There are no migrations and no ordering constraints with BE-N2, BE-C3, FE-C2 or FE-G2.

Conflicts are possible only if another task edits the same three assembler files or the two reporting integration tests. In this wave, only this task owns them.

Merging BE-N2's `synthetic` member will make A15's two REQ-PB-089 tests pass; it has no interaction with the totals.

## 9. Full-suite status and what remains (written at about 94 minutes, per the time rule)

- **`pnpm test:integration`, run 2** (`integration-r2.log`; `QA_PG_PORT=23870 MTH_PORT_POOL=23871-23899 tests/qa/support/with-pg.sh pnpm test:integration`): **exit 1, not a pass.**
  - The single integration fork crashed again with `Error: Channel closed … ERR_IPC_CHANNEL_CLOSED` about 6 minutes in, before any reporting file ran and before a summary was printed.
  - Before the crash: `catalogue.test.ts` passed, `contract.test.ts` passed 83/83 (so the operation seam is unchanged), A08 and A09 passed, and several kpi, portfolio, procedures, methodology and workflows files passed.
  - `tests/qa/integration/a06-configuration-change.test.ts` reported `27 tests | 1 failed` in both runs. The crash suppressed the name of the failing test. A06 is configuration change (slices A and B), outside my scope; its QA defects are allocated to other W18 tasks under D-163. I did not touch any file it exercises.
  - Machine at that time: 4 CPUs, about 2.8 GB free of 16 GB, five W18 worktrees running at once, and my own `pnpm test` run 2 in parallel. A kill from memory pressure is the likely cause, but it is **not established**.
  - **Remains:** a full integration run on a quieter machine, with its counts. There are no pinned-count changes to reconcile: this task adds no operation, media type or rate-limit entry.
  - The integration files that cover this task's change were run on their own and passed:
    - `kbe-c2-assemblers.test.ts` 8/8
    - `registers-report.test.ts` 5/5
    - `table-totals-demo.test.ts` 2/2
    - A15's "a system SUM total remains a formula…" ✓

    Logs: `targeted-integration-1.log`, `-2-a15.log`, `-3-demo.log`.
- **`pnpm test`, run 2** (after the boundary fix): **not complete, and not reported as passed.**
  - Locale unset (`test-locale-unset-r2.log`): unit-node 2259/2268. All 9 failures are load timeouts (8 × 5 s in `packages/reporting/src/pdf/pdf.test.ts`, owned by BE-N2; 1 × 30 s in the AST walk of `architecture.test.ts`). Run alone after the fix, `architecture.test.ts` and `reporting.test.ts` pass 139/139 and 4/4.
  - The unit-web and formula invocations of that run, and the whole `C.UTF-8` run 2, were still running when this handback was written. Their logs are `test-locale-unset-r2.log` and `test-c-utf8-r2.log` in the evidence folder; anything written after this point is unreviewed.
  - In run 1, unit-web (1534/1534) and formula (259 passed, 2 skipped) passed in both locales. My change touches neither: no web or formula file is modified.
  - **Remains:** one clean `pnpm test` in each locale on an unloaded machine.
- **Separable remainder:** none of the Added scope is left unimplemented. What remains is verification only: the two full-suite runs above.
- **End time:** written at `Sat Oct 17 03:06 UTC 2026`; the exact end time is in the closing line below.
- **Closing line:** handback finished at Sat Oct 17 03:06:36 UTC 2026.

## 10. Addendum: `pnpm test` run 2 completed after the handback was written (03:38Z)

Both invocations exited **1**, so this is **not a pass**.

| Locale | unit-node | unit-web | formula |
|---|---|---|---|
| unset (`test-locale-unset-r2.log`) | 2259/2268 | 1533/1534 | 259 passed, 2 skipped |
| `C.UTF-8` (`test-c-utf8-r2.log`) | 2260/2268 | 1532/1534 | 259 passed, 2 skipped |

Every failure is a timeout or a wait that ran out under load:

- **`architecture.test.ts` AST walk:** `Test timed out in 30000ms`, not a boundary violation. It passed 139/139 when run on its own after the fix.
- **`packages/reporting/src/pdf/pdf.test.ts`:** 5 s timeouts, BE-N2's scope.
- **`apps/web/src/pages/raid/raid.test.tsx` › "action register…":** `Unable to find role="link" …`, a Testing Library wait that ran out. It passed in run 1 (1534/1534), and this task changes no web file.

**Still remaining:** one clean `pnpm test` in each locale, and one clean `pnpm test:integration`, on an unloaded machine.
