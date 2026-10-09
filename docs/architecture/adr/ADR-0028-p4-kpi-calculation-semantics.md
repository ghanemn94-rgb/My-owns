# ADR-0028: KPI calculation semantics: measure types, period and cumulative values, % vs pp, aggregation, RAG with versioned thresholds, Unknown/Stale/Not computable, KPI formulas on the DG3 engine

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-02), 2026-10-09.
- **Requirements:** REQ-S07-002, REQ-S07-004, REQ-S07-005, REQ-S07-006, REQ-S07-007, REQ-S07-008, REQ-S07-009 (display), REQ-S07-010, REQ-S07-011 (units) (slice A of `docs/architecture/p4-plan.md`). The data model and the pipeline are in ADR-0027.
- **Sources:** master prompt M0159 ("Support higher-is-better, lower-is-better, acceptable-band and binary milestone measures … Distinguish period from cumulative values and percentage changes from percentage-point changes. Use explicit handling for missing values, zero denominators, negative baselines and incomparable periods. Missing or stale data must show Unknown/Stale, not green or zero."), M0160 ("RAG must use the approved expected trajectory and configurable thresholds. Always show actual, expected-to-date, final target, variance, trend, data freshness and rule explanation. Never derive outcome RAG from project task completion."), M0161 ("sum eligible flows, last value for stocks, weighted ratios where appropriate, or an approved custom formula. Do not average percentages or mix units by default. Preserve currency and period. Formula dependencies must reject circular references and invalid units."); playbook B0095 (Template 10, Outcomes: "RAG based on target trajectory, not activity completion").
- **Decisions applied:** seam 5 (the DG3 formula engine is reused unchanged), AN-04 (REQ-S07-007 notes: trajectory-based RAG applies to KPIs and the T10 Outcomes area; the other T10 areas keep their own logic, slice J).
- **Where the code lives:** `packages/shared/src/kpi/**` (KBE-A; pure, decimal.js through `@mth/shared/calc`, no I/O, property-tested), called by the worker's `kpi.recalculate` handler and by the read model (KBE-C). Version string `kpi_rules_version` = `mth-kpi/1.0.0`, recorded on every `calculation_run`.

## Context

The sources fix the behaviours but not the formulas. Every rule below is the platform's definition, chosen so that each acceptance text of the rows above is a direct consequence; the "Threshold defaults are an implementation assumption" (REQ-S07-007 notes). Values are `numeric(24,6)` decimal strings (ADR-0019); arithmetic uses the engine's `FORMULA_DECIMAL` configuration and rounds once on storage with the ADR-0024 §6 item 11 rounding record (`kpi_evaluation.rounding`).

## Decision

### 1. Measure types and the adverse deviation (REQ-S07-002)

Let `a` be the actual, `e` the expected-to-date (§4), and `t` the threshold version in force (§5).

| Measure type | Shortfall `s` | Deviation |
|---|---|---|
| `higher_is_better` | `s = e − a` | `adverse` if `s > 0`, `within` if `s = 0`, `favourable` if `s < 0` |
| `lower_is_better` | `s = a − e` | same rule |
| `acceptable_band` `[L, U]` | `s = L − a` if `a < L`; `s = a − U` if `a > U`; else `s = 0` | `within` inside the band (bounds included), `adverse` outside |
| `binary_milestone` (due date `D`) | — | `favourable` when achieved with `achieved_on ≤ D`; `adverse` when not achieved and today's business date is after `D`, or achieved after `D`; `within` when not achieved and today is on or before `D` |

Worked examples (the A05 unit tests): higher-is-better 80 vs expected 90 → `s = 10` → adverse; lower-is-better 80 vs 90 → `s = −10` → favourable; band 5–10 with 12 → `s = 2` → adverse ("outside"); binary milestone not achieved by its due date → adverse.

### 2. Period and cumulative values (REQ-S07-004)

Every evaluation of an entered KPI has basis `period` (the reporting period's own value) and, except for milestones, basis `cumulative` (year to date from `kpi_version.ytd_start_month`, over the periods of the KPI's frequency inside the window up to and including this one):

| Value nature | Cumulative |
|---|---|
| `flow` | the sum of the period values: **cumulative YTD equals the sum of period flows** |
| `stock` | the latest period value (last value) |
| `ratio` | `Σ numerators / Σ denominators` over the window |
| `milestone` | not evaluated |

If any period in the window has no accepted value, the cumulative value is **Unknown** (`kpi.cumulative_incomplete`), never a partial sum. A trajectory compares like with like: a `period` trajectory with period values, a `cumulative` one with cumulative values.

### 3. Changes: percentage points vs percent (REQ-S07-004, REQ-S07-005)

- Values of a `percentage` KPI are stored as **fractions** (0.12 = 12 %), the engine's `fraction` kind.
- For two values `x₀ → x₁` of a percentage KPI the library returns both: the **point change** `(x₁ − x₀) × 100`, labelled `pp`, and the **relative change** `(x₁ − x₀) / |x₀|`, labelled `%`. Example: 0.10 → 0.12 is **+2.0 pp** and **+20 %**. Other units have only the relative change and the absolute difference in their unit. The two labels are never interchanged.
- `x₀ = 0`: the relative change is **Not computable** (`kpi.zero_base`), never 0 and never an error.
- `x₀ < 0`: the relative change is computed with `|x₀|` and **flagged** `negative_baseline` (`kpi_evaluation.comparison_flag`; data-quality finding `negative_baseline`, severity `info`).
- `variance = a − e` (in the KPI's unit) and `variance_ratio = (a − e) / |e|` (Not computable when `e = 0`, flag `zero_base`).

### 4. Expected-to-date from the approved trajectory (REQ-S07-007)

- Source: the **approved** `target_trajectory` of the KPI and scope (ADR-0027 §5). With none, the RAG is **Unknown** (`kpi.rag.no_approved_trajectory`). Band and milestone measures need no trajectory (their bounds and due date are the expectation).
- The expected value at the period's end date `p`: the known points are the trajectory points plus, when the active version has `baseline_value` and `baseline_date` earlier than the first point, the baseline point.
  - `linear`: on a point's date, its value; between two consecutive points, straight-line interpolation by day count; after the last point, the last point's value.
  - `step`: the value of the latest point on or before `p`.
  - Before the first known point: **Unknown** (`kpi.rag.before_trajectory`).
- **Never from task completion.** The evaluator's inputs are exactly: the accepted values, the active KPI version, the approved trajectory, the threshold version and the business date. It reads no work item, action, deliverable, milestone or initiative status, so "with all tasks complete and actual below the red threshold the KPI is Red" holds by construction (A04 tests it).

### 5. RAG with versioned thresholds (REQ-S07-007)

- Thresholds: the active `kpi_rag_threshold` version (ADR-0027; `tolerance_mode`, `amber_threshold`, `red_threshold`), or, when the KPI has none, the **default** relative thresholds 0.05 / 0.10 (recorded as `threshold_source = 'default'`).
- The adverse deviation `d`: `relative` mode `d = s / |e|` (for a band, `s / (U − L)`; with `e = 0` or `U = L` the RAG is Not computable, `kpi.zero_base`); `absolute` mode `d = s`. A non-positive `s` gives `d ≤ 0`.
- **Green** when `d ≤ amber`; **Amber** when `amber < d ≤ red`; **Red** when `d > red`. Milestones: favourable → Green, within → Green (`kpi.rag.milestone_not_yet_due`), adverse → Red.
- A new threshold version triggers a calculation run (`threshold_changed`, ADR-0027 §8) that re-evaluates the KPI's slots of its current reporting period with the new version, so "changing the threshold version recomputes RAG".

### 6. Statuses, display and the seven elements (REQ-S07-006, REQ-S07-008, REQ-S07-009)

**Value statuses** (`kpi_evaluation.value_status`) and the RAG they force:

| Status | Meaning | Value | RAG |
|---|---|---|---|
| `ok` | an accepted, fresh value | the number | green / amber / red, or `unknown` when no expectation exists |
| `unknown` | no accepted value for the period (`kpi.no_accepted_actual`), an explicit "not available" (`kpi.value_not_available`), an incomplete cumulative window or roll-up (`kpi.cumulative_incomplete`, `kpi.scope_missing`), an Unknown formula input (`kpi.formula_input_unknown`), no active version (`kpi.no_active_version`) | NULL | `unknown` |
| `stale` | the accepted value's `data_as_of` is more than `dq_stale_after_days` before today's business date (`kpi.stale`) | the number, labelled Stale | `stale` |
| `not_computable` | a zero denominator (`kpi.zero_denominator`), a zero base (`kpi.zero_base`), a non-additive stock roll-up (`kpi.stock_not_additive`), a milestone roll-up (`kpi.no_rollup`), a division by zero in a formula (`kpi.formula_division_by_zero`) | NULL | `not_computable` |

Database invariants (`0035`): `unknown` and `not_computable` store NULL; green, amber and red need status `ok` and a known deviation; a non-`ok` status forces the same-named RAG (probes R03–R06). The web renders Unknown, Stale and Not computable grey with their label (en and ar) and never as 0 or green.

**Current period.** For a KPI, the current reporting period is the latest (by `period_end`) period of its frequency in the organization whose status is `open` or `closed`. With no accepted value for it, the panel shows **Unknown** (grey, labelled), and the KPI contributes nothing to any aggregate (§7): "a KPI with no actual for the current period renders Unknown … and contributes no zero to aggregates".

**Read-time rules** (applied by `getKpiStatus`/`listKpiStatus`, never stored): staleness is re-checked against today's business date (a stored `ok` evaluation can display as Stale); an override is in force while `status = 'active'` and `now() < expires_at`.

**The KPI panel** (`KpiStatus`) always carries, in en and ar through i18n keys:

1. `actual` (decimal string or null, with its value status and period label);
2. `expectedToDate` (or null with a reason);
3. `finalTarget` (the version's target value and date, or null);
4. `variance` and `varianceRatio` (with `pp`/`%` labelling for percentage KPIs; null with a reason when not computable);
5. `trend` (`improving`, `worsening`, `flat`, `not_comparable`, `unknown`: the change against the previous period of the same frequency, judged by the measure type);
6. `freshness` (`dataAsOf`, `staleAfterDays`, `fresh` \| `stale` \| `unknown`);
7. `explanation` (`explanationKey` + `explanationParams`), which **names the threshold used**: `thresholdSource`, `thresholdVersion`, `toleranceMode`, `amberThreshold`, `redThreshold`, plus `trajectoryVersion`, `expected`, `actual`.

Explanation keys: `kpi.rag.on_or_better_than_trajectory`, `kpi.rag.amber_band`, `kpi.rag.red_threshold`, `kpi.rag.inside_band`, `kpi.rag.outside_band`, `kpi.rag.milestone_achieved`, `kpi.rag.milestone_not_yet_due`, `kpi.rag.milestone_overdue`, `kpi.rag.no_actual`, `kpi.rag.no_approved_trajectory`, `kpi.rag.before_trajectory`, `kpi.rag.stale`, `kpi.rag.not_computable`.

`calculatedRag` is always present; `displayedRag` equals the override while one is in force (with `override { rag, reason, evidenceId, expiresAt, by }`) and equals `calculatedRag` otherwise, so after expiry the calculated RAG displays (REQ-S07-009).

**Trend and comparability (REQ-S07-005).** Two periods are comparable when they have the same frequency and the same basis and, for week-based periods, the same `week_count`. Comparing a 4-week to a 5-week period gives `trend = not_comparable` and `comparison_flag = not_comparable` (data-quality finding `not_comparable`, severity `info`); the panel labels it "Not comparable".

### 7. Aggregation (REQ-S07-010)

The roll-up of an entry scope narrower than the transformation (business units or initiatives) to the transformation scope, per reporting period and basis, uses the active version's rule:

| Rule | Roll-up across scopes |
|---|---|
| `sum` (flows) | `Σ values` |
| `last_value` (stocks) | `Σ values` when `stock_additive_across_scopes`; otherwise Not computable (`kpi.stock_not_additive`) |
| `weighted_ratio` (ratios) | `Σ numerators / Σ denominators`: two BU ratios 1/10 and 9/10 roll up to **0.50**, not the mean of percentages |
| `custom_formula` | the KPI's approved formula (ADR-0027 §2, business-approval policy) |
| `none` (milestones) | none (Not computable, `kpi.no_rollup`) |

- No rule averages values; there is no `average` aggregation rule (CHECK `kpi_version_aggregation_fits_nature`).
- **Expected scopes:** the scopes that have an accepted value of this KPI in any earlier period or in this one. If one of them has no accepted value for this period, the roll-up is **Unknown** (`kpi.scope_missing`, data-quality finding `scope_missing`): a missing scope contributes no zero.
- **Units and currency are preserved.** Every input of a roll-up has the KPI's unit and currency (ADR-0027 §6 refuses another currency at entry: "summing SAR with USD without conversion is rejected"); the library also refuses mixed currencies or units in its input (`kpi.aggregation_unit_mismatch`, an error, never a conversion). A roll-up never mixes periods.

### 8. KPI formulas on the DG3 engine (REQ-S07-011, units half; seam 5)

- A formula version's variables are typed from their source KPIs:

  | Source `unit_kind` | Engine kind | Unit / currency |
  |---|---|---|
  | `currency` | `currency` | the KPI's currency |
  | `percentage` | `fraction` | — |
  | `count` | `count` | `unit_label` |
  | `ratio`, `score` | `number` | — |
  | `duration`, `other` | `quantity` | `unit_label` |

  Period: `monthly` → `month`, `quarterly` → `quarter`, `annual` → `year`, otherwise `none`.
- At version creation, `validateFormula(expression, variables)` must succeed, and the result type must equal the KPI's own mapped type (kind and currency), otherwise 422 `kpi_formula.unit_mismatch`. The engine's own refusals pass through with their ADR-0024 §6 codes and texts: adding SAR to a count is `formula.kind_mismatch`; SAR plus USD is `formula.currency_mismatch`.
- Evaluation: `evaluateFormula` with each variable bound to the source KPI's evaluated value of the same scope, period and `input_basis`. An Unknown input gives Unknown (`kpi.formula_input_unknown`); a division by zero gives Not computable (`kpi.formula_division_by_zero`); the engine's rounding record is stored on the evaluation.
- Cycle detection is a graph check outside the engine (ADR-0027 §4). No file under `packages/shared/src/formula/**` changes.

## Alternatives considered

- **Percentages stored as 0–100.** Rejected: the engine's `fraction` kind and the pp/% rule are simpler with fractions, and one convention avoids ×100 errors. The `0036` backfill copies DG2 T02 trajectory values verbatim; a DG2 percentage KPI whose T02 points were entered as 0–100 must be re-approved as a new trajectory version (ADR-0027 §5).
- **Partial roll-ups with a coverage note.** Rejected: REQ-S07-006 forbids a missing scope from contributing zero, and a partial sum of flows reads as the total.
- **Amber for a milestone that is not yet due.** Rejected: nothing is adverse before the due date; the explanation key states "not yet due".

## Consequences

- A percentage KPI's values, bounds, thresholds in `absolute` mode and trajectory points are fractions.
- A roll-up becomes Unknown as soon as one previously reporting scope is late; the data-quality finding names it.
- The DG3 engine is unchanged, so a KPI formula has the same limits (2000 characters, 200 nodes, 30 variables).

## Verification

- KBE-A: unit and property tests in `packages/shared/src/kpi/**` for every worked example above (the A05 list): adverse/favourable/outside/milestone; +2.0 pp and +20 %; YTD = Σ flows; zero denominator → Not computable (no error, not 0); negative baseline flagged; 4-week vs 5-week → Not comparable; 1/10 and 9/10 → 0.50; SAR + USD refused; no actual → Unknown and no zero contribution; all-tasks-complete plus actual below red → Red; a new threshold version → new RAG.
- Database invariants: probe R03–R07 (`0035`).
- KBE-C: the read model's seven elements in en and ar and the override display rules; QA A04/A05.

## Amendment (2026-10-09, T-DG4-ARCH-R1): codes and keys added outside the ADR

### A1. Codes and keys added outside the ADR's refusal table (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `kpi.aggregation_period_mismatch` | roll-up refusal | accepted | Roll-up refused: scope {scopeId} is for period {periodId} ({basis}), not {expectedPeriodId} ({expectedBasis}); a roll-up never mixes periods. |
| `kpi.before_trajectory` | reason key | accepted | Unknown: the date is before the first trajectory point. |
| `kpi.no_approved_trajectory` | reason key | accepted | Unknown: the KPI has no approved target trajectory. |
| `kpi.calculation_pending` | reason key | accepted | Unknown: an accepted actual is waiting for its calculation run. |
| `kpi.value_out_of_range` | reason key | accepted | Not computable: the result does not fit the stored decimal range. |
