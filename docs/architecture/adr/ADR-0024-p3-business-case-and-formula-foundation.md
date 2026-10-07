# ADR-0024: Business case, roll-up without double counting, and the T09 formula foundation (P3)

- **Status:** Proposed for P3 (DG3). Author: solution-architect (T-DG3-ARCH-01), 2026-10-07.
- **Requirements:** REQ-PB-053, REQ-PB-054, REQ-PB-055, REQ-PB-056, REQ-PB-057, REQ-S05-005, REQ-S08-007, REQ-DLV-035 (tested financial inputs).
- **Sources:** playbook B0083–B0088, B0139; master prompt §8 (lines ~263–282), M0148, M0168–M0173, M0329.
- **Builds on:** ADR-0003, ADR-0004, ADR-0016, ADR-0019 (decimal, Unknown, validation staleness), ADR-0021 (G4), ADR-0002 (package boundaries).
- **Physical model:** `0023_p3_business_case_formula.sql`. Module `kpi` (kpi-benefits-engineer) owns `business-cases` and `benefit-formulas`; the engine lives in `packages/shared/src/formula/` (§6).

## Decision

### 1. The ten sections (REQ-PB-053, B0085)

`business_case` stores each B0085 section in typed columns:

| # | Section (B0085) | Columns |
|---|---|---|
| 1 | Strategic rationale | `strategic_rationale` |
| 2 | Baseline | `baseline_summary` (+ Finance baseline validation, §5) |
| 3 | Value pools | `value_pools_summary` |
| 4 | Interventions | `interventions_summary` |
| 5 | Investment | `investment_summary` + investment lines (§2) |
| 6 | Benefits | `benefits_summary` + benefit lines (§2) |
| 7 | Timing | `benefit_ramp`, `recurrence_summary` (one-off vs recurring), `implementation_horizon` |
| 8 | Risks & sensitivities | `key_assumptions`, `downside_case`, `upside_case` |
| 9 | Ownership | `benefit_owner_user_id`, `initiative_owner_user_id`, `finance_validator_user_id` |
| 10 | Decision ask | `decision_ask_types text[]` ⊆ {`funding`, `policy`, `resource`, `prioritization`}, `decision_ask_text` |

Other columns: `code` (`BC-01`…), `level`, `initiative_id`, `parent_case_id`, `title`, `currency` (char(3), defaults to the transformation's currency, SAR by default, configurable), `status` (`draft` | `archived`), versioned, audited.

**Section completeness** (G4 `g4.business_cases`): a transformation case needs all ten sections (text sections non-blank; 5 and 6 also ≥ 1 active line; 9 all three owners; 10 ≥ 1 ask type). A **lighter initiative case** needs sections 1, 4, 5, 6, 7 and 9 (with `initiative_owner_user_id` and `finance_validator_user_id`). Missing sections are named in `missing[]` (`g4.business_case_section_missing` → 'Business case section missing: {section} ({case code})').

### 2. Lines and classification (REQ-PB-053, REQ-S05-005)

`business_case_line`: `line_kind` (`investment` | `benefit`), **exactly one class** column set:

- `investment_class` ∈ `capex` | `opex` | `internal_fte` | `vendor_cost` | `opportunity_cost`;
- `benefit_class` ∈ `revenue` | `cost_reduction` | `cost_avoidance` | `working_capital` | `strategic_non_financial`.

DB: `CHECK (num_nonnulls(investment_class, benefit_class) = 1)` and the class column must match `line_kind`. API: the request has **one** `class` property (string); a request with two classes (an array, or both `investmentClass` and `benefitClass`) is rejected **400** at `/class` (strict schema), and a class that does not fit the kind is **422** `business_case.line_class_mismatch`.

Further columns: `title`, `amount numeric(20,4)` (null = **Unknown**, never 0), `currency`, `fte numeric(6,2)` (internal FTE lines), `period_start`, `period_end`, `recurrence` (`one_off` | `recurring`), `value_basis`, `benefit_formula_id` (benefit lines), `owner_user_id`, `status` (`active` | `archived`).

`value_basis` keeps economically different quantities apart (master prompt §8), CHECK-bound to the class:

| Class | Allowed `value_basis` |
|---|---|
| `revenue` | `revenue_uplift` or `margin_uplift` (never both on one line; revenue uplift is kept separate from margin) |
| `cost_reduction` | `cash_saving` |
| `cost_avoidance` | `avoided_cost` (kept separate from cash savings) |
| `working_capital` | `working_capital_release` |
| `strategic_non_financial` | `non_financial`, and `amount` must be NULL (no monetisation without an approved valuation method) |
| `capex`, `opex`, `vendor_cost` | `cash` |
| `internal_fte`, `opportunity_cost` | `non_cash` (shown separately from cash investment) |

**One benefit, one line.** A benefit formula can back at most one active line in the whole transformation (partial unique index on `benefit_formula_id`), so a T09 benefit cannot be counted in two cases.

### 3. Transformation case and initiative cases; the roll-up (REQ-PB-054)

- `level = 'transformation'`: at most one active per transformation (partial unique index); `initiative_id` and `parent_case_id` NULL.
- `level = 'initiative'`: `initiative_id` NOT NULL (one active case per initiative) and `parent_case_id` NOT NULL, pointing at the **one** transformation case of the same transformation (composite FK + trigger `business_case_parent_is_transformation`).
- **Roll-up = references, not copies.** The transformation view's line set is `own lines ∪ lines of its active initiative cases`, taken as a **set of line ids**, so each distinct line is counted once. A line belongs to exactly one case (FK), so the same cost can never sit at both levels: a transformation-level line is a cost or benefit that no initiative owns (for example the transformation office). Editing an initiative case line changes the roll-up on the next read; nothing is duplicated or stored twice.
- **Overlap warning.** When a transformation-level line and an initiative line share class, normalised title and an overlapping period, the roll-up returns `business_case.possible_duplicate`. It is a warning; Finance resolves economic overlaps that rules cannot determine (§8).

**Totals** (`GET /business-cases/{id}/totals`, decimal strings, per currency, no FX in P3):

- `grossBenefits`: Σ financial benefit lines, with a breakdown by class and by `value_basis`; `margin_uplift` and `revenue_uplift` are reported separately and a case holding both gets `business_case.revenue_and_margin` (possible double count).
- `implementationCost`: Σ investment lines, with `cash` (capex, opex, vendor cost) and `nonCash` (internal FTE, opportunity cost) subtotals shown separately.
- `netValue` = `grossBenefits − implementationCost`, shown next to (never instead of) the two inputs.
- Each total carries `unknownLineCount`; a total whose lines are all Unknown is `null` (Unknown), never `"0"`. The case total equals the sum of the distinct lines, each counted once (REQ-S05-005).
- No automatic subtraction of one cost at both levels: a transformation-level `netValue` uses its own distinct line set only once.

### 4. Business case permissions

`business_case.edit` (TL; WL for the initiative cases of initiatives they lead — record-level) creates and edits cases and lines. FIN validates (§5). AUD reads only.

### 5. Finance validation before G4 (REQ-PB-055, B0084, B0139)

Two validations, both recorded by a person holding `finance.validate` (FIN; category `finance_validation`) who did not author the record (DB CHECK):

- **Baseline** of a case: `POST /business-cases/{id}/baseline-validation` `{result: validated|rejected, note}` sets `baseline_validation_status`, `baseline_validated_by/at/note` and `baseline_validated_sha256` = SHA-256 of `baseline_summary` at that moment. A later edit of the baseline section makes it **Stale** (hash differs) → it no longer counts.
- **Benefit logic**: each `benefit_formula_version` (§6) carries `validation_status` (`unvalidated` | `validated` | `rejected`), `validated_by/at/note`. A version is immutable, so a validation never goes stale; a new version starts `unvalidated` and becomes the current one.

G4 `g4.finance_validation` is complete only when every in-scope case (and the transformation case) has a current validated baseline, and every active financial benefit line has a `benefit_formula_id` whose **current** version is validated. Otherwise the G4 submission is refused listing **'Finance validation'** with the case or formula (ADR-0021 §7). Measure-only and later-stage benefit validation (planned/forecast/measured values, amendments) is P4.

### 6. The formula foundation (T09)

**Package.** `packages/shared/src/formula/` (`tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts`, `index.ts`, exported from `@mth/shared`). The API (`kpi` module) and the web (preview) import the same code, and decimal.js 10.6.0 is already a dependency of `@mth/shared`, so **no new dependency** is needed. `packages/calc` stays reserved for the P4 KPI/benefit engine, which will import this module rather than duplicate it.

**No dynamic code.** The engine is a hand-written tokenizer, recursive-descent parser and AST walker. `eval`, `new Function`, `Function(...)`, `vm`/`node:vm`, `setTimeout(string)`, dynamic `import()` and `with` are forbidden in `packages/shared/src/formula/**`; an ESLint override (`no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports: vm, node:vm`, `no-restricted-syntax: ImportExpression`) enforces it.

**Grammar (EBNF).**

```ebnf
formula     = ws , expr , ws ;
expr        = term , { ws , ( "+" | "-" ) , ws , term } ;
term        = unary , { ws , ( "*" | "×" | "/" | "÷" ) , ws , unary } ;
unary       = [ "-" , ws ] , primary ;
primary     = number | call | identifier | "(" , ws , expr , ws , ")" ;
call        = function , ws , "(" , ws , [ expr , { ws , "," , ws , arg } ] , ws , ")" ;
arg         = expr | period ;
function    = "to_period" | "min" | "max" | "abs" ;
period      = "month" | "quarter" | "year" ;
identifier  = lower , { lower | digit | "_" } ;        (* ^[a-z][a-z0-9_]{0,47}$, not a function or period name *)
number      = digit , { digit } , [ "." , digit , { digit } ] ;   (* no exponent, no sign, ≤ 24 significant digits *)
ws          = { " " | "\t" } ;
lower       = "a" … "z" ;  digit = "0" … "9" ;
```

Limits: ≤ 2000 characters, ≤ 200 AST nodes, nesting depth ≤ 32, ≤ 30 variables. Anything else (letters outside the grammar, `**`, `;`, quotes, brackets, newlines, unknown functions) is a parse error `formula.syntax` with a character offset.

**Typed variables.** Each variable (`benefit_formula_variable`) has `name`, `kind`, `unit` (label), `currency` (for `currency` kind), `period` (`none` | `month` | `quarter` | `year`: "per period" basis), optional `value` (decimal) and `source`.

| `kind` | Stored as | Displayed as | Example |
|---|---|---|---|
| `fraction` | decimal share, 0.12 | percent, "12%" | attach rate |
| `fraction_delta` | difference of two fractions, 0.02 | **percentage points**, "2 pp" | Δ attach rate |
| `percent_change` | relative change as a fraction, −0.10 | percent, "−10%" | unit cost −10% |
| `count` | decimal | number with unit | eligible customers |
| `currency` | decimal amount + `currency` | money | ARPU, unit cost |
| `quantity` | decimal + `unit` | number with unit | minutes |
| `number` | dimensionless decimal | number | factor |

Percentages are never stored as 12 for 12%: the API takes and returns fractions, and the web converts at input and display. 10% → 12% is `0.10` → `0.12`; the change is `0.02`, shown as 2 percentage points.

**Type rules** (checked before evaluation; a violation is **422** `urn:mth:problem:validation` with `code` below and the variable names in `detail`):

- *Undefined variable* → `formula.undefined_variable` ('Undefined variable: {name}') (REQ-PB-056).
- `+`/`−`: same kind, same currency and same period; additionally `fraction ± fraction_delta → fraction` and `fraction − fraction → fraction_delta`. Otherwise `formula.kind_mismatch`.
- `×`: dimensionless kinds (`fraction`, `fraction_delta`, `percent_change`, `number`) take the other operand's kind; `count × currency → currency`; `count × count` and `count × quantity → quantity`; `currency × currency` → `formula.currency_product`.
- `÷`: `X ÷ number → X`; `currency ÷ currency` (same currency) → `number`; `currency ÷ count → currency` (per unit); otherwise `formula.kind_mismatch`.
- **Period alignment (REQ-S08-007).** Among the operands of one `+`, `−`, `×` or `÷` chain, every operand whose period is not `none` must have the **same** period. **Monthly ARPU combined with an annual population without a conversion is rejected** with `formula.period_mismatch`: 'Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)'. `to_period(x, year)` converts explicitly (month→year ×12, quarter→year ×4, month→quarter ×3, and the inverse divisions); it needs `x` to have a period.
- **Currency**: at most one currency per formula result; a mix of currencies → `formula.currency_mismatch`. No FX in P3.

**Evaluation.** decimal.js only, through a clone with precision 80 and `ROUND_HALF_UP`; no JavaScript number ever holds a value. Exact operations (`+ − ×`) are exact; division and inverse period conversion keep 80 significant digits and the result is rounded **once**, at storage, to `numeric(24,6)` (`ROUND_HALF_UP`), and that rounding is recorded in the lineage. **Division by zero** → evaluation error `formula.division_by_zero`; the result is **Unknown (null)**, never 0 or Infinity. A missing input value → result Unknown with `formula.missing_input`. A result outside `numeric(24,6)` → `formula.result_out_of_range`.

**Versioning and lineage.**

- `benefit_formula` (T09 row): `code` `BF-01`…, `benefit_name` (T09 *Benefit*), `baseline_driver`, `change_assumption`, `ramp` (text, e.g. 'Q1-Q4'), `confidence` CHECK `H` | `M` | `L` (others rejected, 400 by enum and DB CHECK), `owner_user_id`, `current_version_no`, `is_illustrative`, `example_code`, `status`. The T09 *Formula* column is the current version's `expression`. All six T09 columns persist (REQ-PB-056).
- `benefit_formula_version` (immutable except its validation columns): `version_no`, `expression`, `expression_sha256`, `result_kind/unit/currency/period`, `preview_result` (evaluated from the variables' values at creation, or null), `engine_version`, validation columns (§5). Creating a version parses and type-checks it **before** writing; an invalid expression writes nothing.
- `benefit_formula_variable` (append-only, per version).
- `benefit_calculation` (append-only lineage): `formula_version_id`, `inputs` (jsonb object `{name: {value, kind, unit, currency, period, source}}`, zod-validated, `jsonb_typeof` CHECK), `assumptions`, `period_start`, `period_end`, `result` (null when Unknown), `result_kind/unit/currency/period`, `outcome` (`ok` | `error`), `error_code`, `engine_version`, `computed_by`, `computed_at`.
- Routes: `POST /benefit-formulas/validate` (parse + type-check + preview, writes nothing), `POST /benefit-formulas`, `POST /benefit-formulas/{id}/versions`, `POST /benefit-formulas/{id}/versions/{versionNo}/preview` (writes a `benefit_calculation` row), `POST /benefit-formulas/{id}/versions/{versionNo}/validation` (Finance).

**The two seeded source examples (REQ-PB-057, illustrative).** Catalogue rows in `benefit_formula_example` (+ `benefit_formula_example_variable`), with the B0087 text verbatim and the marker *Illustrative calculation, synthetic values*:

| Code | Source row (B0087) | Expression | Variables (kind, period, illustrative value) | Result |
|---|---|---|---|---|
| `revenue_uplift` | Revenue uplift · Customers × attach rate × ARPU · Attach +X pp · Δ attach × customers × ARPU · Q1-Q4 · M | `(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu` | `baseline_attach_rate` fraction, none, 0.10; `target_attach_rate` fraction, none, 0.12; `eligible_customers` count, year, 100000; `arpu` currency SAR, year, 50 | 0.02 × 100000 × 50 = **100000 SAR** per year, exact |
| `cost_reduction` | Cost reduction · Volume × unit cost · Unit cost -X% · Volume × Δ unit cost · Q2-Q3 · H | `eligible_volume * (baseline_unit_cost - target_unit_cost)` | `eligible_volume` count, year, 200000; `baseline_unit_cost` currency SAR, none, 12.50; `target_unit_cost` currency SAR, none, 10.00 | 200000 × 2.50 = **500000.00 SAR** per year, exact |

A team instantiates an example into its own T09 register (`POST /benefit-formulas` with `fromExample`), which creates a normal, unvalidated formula marked `is_illustrative = true` until edited. Changing `arpu` to `period = month` while `eligible_customers` stays `year` is rejected with `formula.period_mismatch` (REQ-S08-007).

### 7. Permissions

`business_case.edit`, `benefit_formula.edit` (write; TL, KDS for formulas, WL record-level for initiative cases), `finance.validate` (FIN; existing P1 catalogue entry, first used here).

### 8. Out of P3 scope (listed so nobody claims it)

The canonical benefit register with allocations, shared-benefit groups, contribution allocations ≤ 100% and unallocated shares; planned/forecast/measured/validated value tracking; scenarios (base/upside/downside) as data; NPV/ROI/payback. These are P4 (REQ rows with final gate DG4). P3 prevents double counting only through §2 (one formula → one line) and §3 (one line → one case; set-based roll-up).

## Alternatives considered

1. **A third-party expression library** (for example `expr-eval`, `mathjs`). Rejected: they evaluate floats, carry far more surface than needed, and some compile to `Function`; a 300-line parser is auditable and has no new licence or supply-chain risk.
2. **New `packages/calc` package now.** Rejected for P3: it adds a workspace package and lockfile churn for code the web and API already share through `@mth/shared`. P4 may move it.
3. **One `classes text[]` column.** Rejected: "exactly one class" is simplest as two nullable typed columns with `num_nonnulls = 1`.
4. **Copying initiative lines into the transformation case.** Rejected: copies drift and double count; the roll-up is a set union of references.

## Consequences

- One engine, shared by API and web; the formula language is small and fully specified.
- Business-case and formula records are owned by `kpi`; G4 reads them through `kpi`'s exported fact loader.
- P4 builds the benefit register on `benefit_formula`/`benefit_calculation` without changing them.

## Verification

- Unit (`packages/shared/src/formula/*.test.ts`): grammar acceptance/rejection table; undefined variable; `eval`/`Function` absent (ESLint and a source scan); revenue example `"100000"` exact; cost example `"500000"` exact; monthly × annual → `formula.period_mismatch`; `to_period` conversion; division by zero → Unknown; 0.1 + 0.2 = 0.3 exactly; depth/size limits.
- Integration: all ten sections round-trip; two classes → 400; class mismatch → 422; amounts are strings with exact decimals; transformation roll-up counts an edited initiative line once; confidence `X` → 400; G4 refused with 'Finance validation' until FIN validates the baseline and the current formula version; FIN validating their own record → 403/422.
- Probe: `business_case_line` with two classes refused by the DB; `benefit_formula_version` expression update refused; `benefit_calculation` append-only.
