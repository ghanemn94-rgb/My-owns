# Handback T-DG4-KBE-A — the pure KPI library (kpi-benefits-engineer)

- **Stage / task:** DG4 (P4 "Execution value and sustainment"), T-DG4-KBE-A, p4-work-split §A.1 (wave W3).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-KBE-A-kpi-benefits-engineer-20261009T033625Z-0ec99ec4","session_id":"0ec99ec4-f435-4793-a717-727436111c5c"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-KBE-A.md`, sha256 `5e97c90d1fa59b338152cc6da15d41461b5139f83d95ae8c0ac6bd232cdb2d58` (verified before starting).
- **Working tree:** `/home/user/wt/dg4-kbe-a`, branch `dg4/kbe-a`, base `HEAD` = `bfa1f98` ("DG4 W3: assignments …"). The changes are **uncommitted**, as instructed.
- **Time:** start `2026-10-09T03:36:39Z`, end `2026-10-09T04:07Z` (about 31 minutes; the 100-minute salvage rule did not apply).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave `PASS gate DG3 (historical)` with exit 0, both before implementation and at the end (`T-DG4-KBE-A-evidence/validate-dg3-historical.log`).
- **Calculation specification:** ADR-0028 (binding). The library's own specification is the header comment of each file under `packages/shared/src/kpi/`. The interpretations I had to make are listed in §6.
- **Approvals:** no business, Finance or IT approval was granted or simulated. All fixtures are synthetic.

## 1. Files changed

Everything is inside my §A.1 ownership: `packages/shared/src/kpi/**` and the one barrel line in `calc.ts`.

| File | Purpose |
|---|---|
| `packages/shared/src/calc.ts` | One line added: `export * from "./kpi/index.ts";` (p4-plan §5.3). |
| `packages/shared/src/kpi/index.ts` | Public API. `KPI_RULES_VERSION = "mth-kpi/1.0.0"`; re-exports the modules. |
| `packages/shared/src/kpi/types.ts` | Shared core: vocabularies mirroring the 0033/0035 CHECKs; `KpiResult` = `{ status, value \| null, reason }`; the reason codes and the 13 ADR-0028 §6 explanation keys; strict decimal and ISO-date parsing (`KpiInputError`); `roundForStorage` (numeric(24,6), half-up, with the ADR-0024 §6 rounding record); `divisionIsExact`. |
| `packages/shared/src/kpi/measures.ts` | §1: the shortfall and deviation for each of the four measure types. |
| `packages/shared/src/kpi/periods.ts` | §2, §6: period comparability (frequency, calendar/weeks basis, `week_count`, value basis); period values; YTD start and window; cumulative values per value nature, with Unknown for an incomplete window. |
| `packages/shared/src/kpi/change.ts` | §3: the pp vs % change, the zero base (Not computable), the negative-baseline flag, variance and variance ratio, and the en/ar labels ("+2.0 pp", "+20%"). |
| `packages/shared/src/kpi/trajectory.ts` | §4: expected-to-date (linear by day count, step, the baseline point, Unknown before the first point or without an approved trajectory), with an exactness flag for the rounding record. |
| `packages/shared/src/kpi/rag.ts` | §5: thresholds (configured version, or the defaults 0.05/0.10); d in relative or absolute mode; green/amber/red; band and milestone rules; explanation key and params naming the threshold used. The input has no task, activity or initiative field. |
| `packages/shared/src/kpi/status.ts` | §6: freshness against a business-date parameter; slot value statuses; read-time staleness; whether an override is in force (`now < expiresAt`); displayed vs calculated RAG; grey RAGs; trend judged by measure type, with `not_comparable`. |
| `packages/shared/src/kpi/aggregate.ts` | §7: the roll-up rules (sum, additive `last_value`, `weighted_ratio`, `custom_formula` delegation, `none`). Expected scopes and `kpi.scope_missing`; mixed unit, currency or period is refused, never converted. A rule that doesn't fit the value nature is a caller error (there is no averaging rule). |
| `packages/shared/src/kpi/formula-binding.ts` | §8: KPI unit → engine kind, currency, unit and period. `validateKpiFormula` passes engine refusals through and adds `kpi_formula.unit_mismatch` (ADR-0027 §13 text). `evaluateKpiFormula` maps Unknown inputs, division by zero and out-of-range. It uses only the engine's public API. |
| `packages/shared/src/kpi/a05.test.ts` | The A05 acceptance examples. Each `describe` quotes the requirement's acceptance text verbatim, and the tests run through the `@mth/shared/calc` barrel. 17 tests. |
| `packages/shared/src/kpi/{types,measures,change,periods,trajectory,rag,status,aggregate,formula-binding}.test.ts` | Exhaustive worked fixtures per module, including boundary cases (thresholds exactly at amber/red, band bounds, due date equal to the business date, stale at exactly N days, expiry at exactly `now`). 241 tests. |
| `packages/shared/src/kpi/property.test.ts` | Seeded property tests (mulberry32; the failing seed and case are named). No property-testing package is installed, and none was added. 11 properties × up to 2000 cases. |
| `packages/shared/src/kpi/purity.test.ts` | Source scan. No clock, randomness, process, network, timers, float parsing, dynamic code or dynamic import. `Number(` appears only in the ISO-date parsing in `types.ts`. Imports are limited to `./*`, `../formula/index.ts` and `../value.ts`. 14 tests. |
| `docs/delivery/handbacks/DG4/T-DG4-KBE-A-kpi-benefits-engineer.md`, `…/T-DG4-KBE-A-evidence/*.log` | This handback and the check logs. |

**Not changed:**
- `packages/shared/src/formula/**`: `git diff --stat HEAD -- packages/shared/src/formula` is empty (`evidence/diff-scope.log`), so S-9 holds.
- No migration, OpenAPI, schema, API or web file.

## 2. Behaviour delivered, per requirement row

Each acceptance text below is quoted from `docs/delivery/requirements.csv`.

### REQ-S07-002: "A05: unit tests: higher-better 80 vs expected 90 is adverse; lower-better 80 vs 90 is favourable; band 5-10 with 12 is outside; binary milestone not achieved by due date is adverse"

`evaluateMeasure` (`measures.ts`) implements the ADR-0028 §1 table. `a05.test.ts` proves each clause literally:
- higher-better 80 vs 90 gives `adverse`, s = 10;
- lower-better gives `favourable`, s = −10;
- band 5–10 with 12 gives `adverse`, `bandPosition: "above"`, s = 2, RAG red with `kpi.rag.outside_band`;
- milestone not achieved, with the business date after the due date, gives `adverse`, RAG red with `kpi.rag.milestone_overdue`.

`measures.test.ts` covers every sign, the band bounds (inclusive), the degenerate band, both milestone date edges, and Unknown inputs (shortfall `null`, never 0).

### REQ-S07-004: "A05: a rise from 0.10 to 0.12 is shown as +2.0 pp and +20%; cumulative YTD equals the sum of period flows for a flow KPI"

- `computeChange` returns `absolute { value: "2", label: "pp" }` and `relative { value: "0.2", label: "percent" }`.
- `formatPointChange` renders "+2.0 pp" (ar "+2.0 نقطة مئوية"), and `formatRelativeChange` renders "+20%" (ar "+20٪").
- `cumulativeValue` for a flow returns Σ of the period values. The A05 test compares it with the sum of the individual `periodValue`s, and a property test checks 500 random windows against an independent decimal.js sum.
- Stock gives the last value and ratio gives Σn/Σd. An incomplete window gives Unknown `kpi.cumulative_incomplete`, never a partial sum.

### REQ-S07-005: "A05: a zero denominator returns 'Not computable' (no division error, not 0); a percentage change from a negative baseline is flagged; comparing a 4-week to a 5-week period is flagged 'Not comparable'"

- `periodValue("ratio", 5/0)` returns `{ status: "not_computable", value: null, reason: "kpi.zero_denominator" }` and does not throw (asserted).
- A relative change from −200 to −150 gives 0.25 with `flag: "negative_baseline"`.
- `comparePeriods(5-week, 4-week)` gives `{ comparable: false, reason: "week_count" }`.
- `computeTrend` gives `{ trend: "not_comparable", comparisonFlag: "not_comparable" }`.
- A zero base for a relative change or variance ratio is Not computable `kpi.zero_base`.
- Missing values give Unknown with `kpi.no_accepted_actual` or `kpi.value_not_available`.

### REQ-S07-010 (library half): "A05: two BU ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages; summing SAR with USD without conversion is rejected"

- `rollUp` with `weighted_ratio` turns 1/10 and 9/10 into `"0.5"`. A skewed fixture (1/10 and 90/100) gives 91/110 ≈ 0.8273, not the 0.5 mean.
- SAR + USD gives `{ ok: false, code: "kpi.aggregation_unit_mismatch", message: "Roll-up refused: scope b is in USD, but the KPI is measured in SAR; values are never converted." }`.
- There is no averaging rule, and a rule that doesn't fit the value nature throws `KpiInputError`.
- A missing expected scope gives Unknown `kpi.scope_missing` and names the missing scopes. It contributes no zero (property-tested).
- The roll-up's place in the run is KBE-C's half.

### REQ-S07-011 (unit half): "A05: KPI A = B + 1 and B = A * 2 is rejected as circular; adding SAR to a count is rejected"

- **SAR + count:** refused by `validateKpiFormula` with the engine's `formula.kind_mismatch`, with its ADR-0024 §6 text passed through. SAR + USD gives `formula.currency_mismatch`.
- **Unit mismatch:** a result type whose kind or currency differs from the KPI's gives `kpi_formula.unit_mismatch` "The formula gives count (customers), but the KPI is measured in SAR."
- **Playbook worked examples** (as KPI formulas):
  - Δ attach (0.02) × 500 000 customers × SAR 45.50 ARPU = **SAR 455 000**, exact, rounding record `rounded: false`;
  - volume (120 000 tickets) × Δ unit cost (SAR 3.75) = **SAR 450 000**.
- **Not in this task:** the **circular** clause belongs to KBE-B. Per §A.1/§A.2 and ADR-0027 §4, cycle detection is the graph walk in `kpi/kpi-formulas.ts` under lock 730228. The library adds no cycle code, so ownership does not overlap.

### Also proven (ADR-0028 "Verification" list, rows owned with KBE-B and KBE-C)

These cover REQ-S07-006/007, where the library half is mine:
- no actual gives Unknown RAG (`kpi.rag.no_actual`), and the scope contributes no zero to the roll-up;
- all tasks complete with the actual below red gives **Red**. The evaluator's input type has no activity field, and passing extra task-completion properties changes nothing (asserted);
- a new threshold version gives a new RAG (amber → red), and the explanation names `thresholdVersion: 2`.

## 3. Checks (real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-KBE-A-evidence/`)

Node v24.21.0, offline. Harness ports: 23150 (PostgreSQL), pool 23151–23199.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `pnpm -r typecheck` | 0 | all packages clean | `typecheck.log` |
| 1 | `pnpm -r build` | 0 | — | `build.log` |
| 1 | `pnpm lint` | 0 | — | `lint.log` |
| 1 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (the 22 new KPI files are included) | `prettier.log` |
| 1 | `pnpm openapi:lint` | 0 | contract untouched | `openapi-lint.log` |
| 2 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | unit-node + unit-web: **101 files, 1996 passed**; nocodegen: **3 files, 259 passed, 2 skipped** | `unit-locale-unset.log` |
| 2 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts: 1996 passed; 259 passed, 2 skipped | `unit-c-utf8.log` |
| 3 | `QA_PG_PORT=23150 MTH_PORT_POOL=23151-23199 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **61 files, 846 passed**; PostgreSQL bound 23150 on attempt 1 | `integration.log` |
| 4 | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |
| — | `npx vitest run --project unit-node packages/shared/src/kpi` | 0 | 12 files, **283 passed** | `kpi-library-tests.log` |
| — | `git diff --stat HEAD -- packages/shared/src/formula` | 0 | empty: engine unchanged (S-9) | `diff-scope.log` |

**Count deltas against the merged W2 tree** (the HEAD commit message: unit 1713 + 259/2, integration 846):
- unit: +283, all of them the new KPI library tests;
- nocodegen: unchanged;
- integration: unchanged (846). No pinned count changed.

**Disclosures:**
- **Failing runs during development**, before the final runs above:
  - **1 type error pair:** an `Extract` in `rag.ts` and a constructor parameter property refused by `erasableSyntaxOnly`. Both fixed.
  - **A real defect in `divisionIsExact`,** caught by a test. It multiplied the quotient back at precision 80, which rounds 900/91 × 91 back to 900, so an inexact interpolation was recorded as exact. It now multiplies at precision 400, and a regression test was added.
  - **Two fixture errors of mine:** lower-is-better 99 vs 90 is d = 0.10 exactly, which is Amber by "d ≤ red", not Red. A second fixture was also corrected.
  - **One aggregation defect:** a scope that reported an explicit "not available" was not counted as expected, which allowed a partial sum. Fixed (see §6 item 4).
- **Stray directories:** before the test runs I removed three empty `.claude/.cc-writes` directories inside source folders, as the assignment instructs: `packages/shared/src/kpi/`, `packages/shared/`, `packages/db/migrations/`.
- **Flaky results:** none observed.

## 4. Operations routed (pending-list delta)

**None.** KBE-A owns no API operation (§A.1). There is no `p4-pending-kbe-a.ts` or `p4-exercises-kbe-a.ts`, and I didn't create one. `contract.test.ts` stays green, because it ran inside the unit and integration runs above.

## 5. Contract, schema and i18n needs (for the orchestrator)

No migration or schema change is needed.

1. **Expected-to-date reason codes.** The contract field `KpiStatus.expectedReason` uses `KpiReasonCode`, with pattern `^kpi\.[a-z_]{1,60}$`. ADR-0028 §4 names these cases by their explanation keys `kpi.rag.no_approved_trajectory` and `kpi.rag.before_trajectory`, but the second dot breaks that pattern. So the library's *reason* is `kpi.no_approved_trajectory` / `kpi.before_trajectory`, and the *explanation keys* stay `kpi.rag.*`.
   - **Action:** FE-A needs i18n keys for both reason codes.
   - **Optional:** an ADR-0028 §4 wording note. No contract change is needed, because both codes match the pattern.
2. **Codes the ADR doesn't name:**
   - `kpi.value_out_of_range`: Not computable when a calculated value doesn't fit numeric(24,6), including the engine's `formula.result_out_of_range`;
   - `kpi.aggregation_period_mismatch`: a roll-up given inputs of another period or basis. ADR-0028 §7 says "a roll-up never mixes periods" but names no code.

   Both match the 0035 `value_reason` CHECK and the contract pattern, and both need i18n keys (FE-A). `kpi.aggregation_unit_mismatch` is ADR-named.
3. **Milestone achieved without `achieved_on`.** 0034 allows `milestone_achieved = true` with `achieved_on` NULL. On time vs late then can't be decided, so the library returns Unknown, never Green.
   - The reason is currently `kpi.no_accepted_actual`, with explanation `kpi.rag.no_actual`. That is imprecise, because an accepted actual exists.
   - **Recommendation for KBE-C:** require `achievedOn` when `milestoneAchieved` is true on `submitKpiActual`/`addKpiActualValue`. Alternatively, the orchestrator can allocate a dedicated reason code.
4. **`threshold_source = 'none'`.** The library reports `none`, with null threshold params, when no threshold was applied. That covers Unknown, Stale and Not computable values, a missing trajectory, and milestones. It reports `configured` or `default` whenever d was compared, including a relative-mode zero base. This satisfies the 0035 CHECK (`configured` ⇔ `threshold_id`). KBE-C's `getKpiStatus` may still choose to *display* the KPI's configured thresholds next to an Unknown.

## 6. Interpretations made (reviewers: please check these against ADR-0028)

1. **YTD window membership:** same-frequency periods whose `period_start` lies from the YTD start up to and including the current period's start. The YTD start is derived from the current period's start and `ytd_start_month`.
2. **Incomplete window applies to stocks too.** "If any period in the window has no accepted value, the cumulative value is Unknown" applies to stocks as well, read literally, even though a stock's cumulative value is the last value.
3. **Stale values get no judgement:** RAG `stale` with deviation `unknown`.
4. **Expected scopes:** a scope whose accepted entry for the period is an explicit "not available" counts as *reported*, so it is expected, and the roll-up is Unknown (`kpi.scope_missing`). This follows from "a missing scope contributes no zero" and the no-partial-sums rule.
5. **Relative mode with `U = L` or `e = 0`** is Not computable (`kpi.zero_base`), applied literally even when the actual sits exactly on a degenerate band.
6. **Trend:**
   - band: closer to the band means improving;
   - milestone: compares the achieved flags;
   - stale values still give a trend, because their numbers are known;
   - incomparable periods give `not_comparable` before any value is looked at.
7. **Green explanation key:** green in higher/lower-is-better uses `kpi.rag.on_or_better_than_trajectory` for every d ≤ amber, including a small adverse d. The ADR's key list has no separate "within tolerance" key. The params carry `deviationValue`, so the panel can show the exact deviation.
8. **Freshness boundary:** a value exactly `dq_stale_after_days` old is fresh; one day older is stale ("more than").
9. **Formula inputs:** an input that is Not computable makes the formula Unknown (`kpi.formula_input_unknown`). Stale inputs are used and listed in `staleInputs`, and KBE-C decides the result's freshness.
10. **Malformed inputs** (a non-decimal string, an invalid date, thresholds out of order, a rule that doesn't fit the value nature, duplicate scopes or trajectory dates) throw `KpiInputError`. They never become a status or 0. The API validates first, so in production these are programming errors.

## 7. Merge instructions

- No migrations and no ordering constraints, beyond §A.6: KBE-A before KBE-B and KBE-C, who import from `@mth/shared/calc`.
- **No conflicts expected.** The only shared file is `packages/shared/src/calc.ts`, where KBE-A owns its one appended line (p4-plan §5.3).
- **Barrel name collisions.** The barrel now also exports generic helper names: `ok`, `unknown`, `notComputable`, `dec`, `plain`, `KD`, `hasValue`. If a later barrel line (e.g. the slice B library) exports the same name, `tsc` reports TS2308 at build. It won't fail silently.

## 8. What remains

Nothing in §A.1 remains. These items belong to other tasks:
- the REQ-S07-011 circular-reference clause: KBE-B, `kpi/kpi-formulas.ts`;
- the use of the library in the calculation run and read model, and the REQ-S07-010 roll-up in the run: KBE-C;
- i18n keys for the codes in §5: FE-A/FE-B;
- the §5 item 3 decision on milestones achieved without a date: the orchestrator or KBE-C.
