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

**Package.** `packages/shared/src/formula/` (`tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts`, `index.ts`), exported from the **`@mth/shared/calc`** subpath together with `scoring.ts` (ADR-0022). The barrel is `packages/shared/src/calc.ts`. It is not exported from the top-level `@mth/shared` entry, which ADR-0002 keeps dependency-free (T-DG3-ARCH-02; see the note at the end of §6). The API (`kpi` module) and the web (preview) import the same code from `@mth/shared/calc`, and decimal.js 10.6.0 is already a dependency of `@mth/shared`, so **no new dependency** is needed. `packages/calc` stays reserved for the P4 KPI/benefit engine, which will import this module rather than duplicate it.

**No dynamic code.** The engine is a hand-written tokenizer, recursive-descent parser and AST walker. `eval`, `new Function`, `Function(...)`, `vm`/`node:vm`, `setTimeout(string)`, dynamic `import()` and `with` are forbidden in `packages/shared/src/formula/**`; an ESLint override (`no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports: vm, node:vm`, `no-restricted-syntax: ImportExpression`, `WithStatement`, timer calls `setTimeout`/`setInterval`/`setImmediate`/`execScript` as plain or member calls, and `.constructor(...)` calls) enforces it. The timer selectors are needed because core `no-implied-eval` only recognises declared globals (T-DG3-KBE-A lint probe); a source scan in `fuzz.test.ts` backs the rule up.

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
| `cost_reduction` | Cost reduction · Volume × unit cost · Unit cost -X% · Volume × Δ unit cost · Q2-Q3 · H | `eligible_volume * (baseline_unit_cost - target_unit_cost)` | `eligible_volume` count, year, 200000; `baseline_unit_cost` currency SAR, none, 12.50; `target_unit_cost` currency SAR, none, 10.00 | 200000 × 2.50 = **500000.00 SAR** per year, exact (canonical `result` `"500000"`, stored `500000.000000`; see item 12 below) |

A team instantiates an example into its own T09 register (`POST /benefit-formulas` with `fromExample`), which creates a normal, unvalidated formula marked `is_illustrative = true` until edited. Changing `arpu` to `period = month` while `eligible_customers` stays `year` is rejected with `formula.period_mismatch` (REQ-S08-007).

**Engine details confirmed (T-DG3-ARCH-02).** T-DG3-KBE-A implemented the engine and raised its interpretations of points this section left open (handback §6, items 4–13). They are confirmed here as the rule, and reviewers test against this text. KBE-C (API) and FE-C (web) build on them. Code references are to `packages/shared/src/formula/`.

- **(4) Limit codes.** A limit violation is `formula.syntax` with `params.reason` ∈ `too_long` | `too_many_nodes` | `too_deep` | `too_many_variables` and `params.limit` (the number). The other syntax reasons are `character`, `number`, `number_digits`, `identifier_length`, `unknown_function`, `period`, `arity`, `empty`, `end` and `unexpected`. A *declared* variable list longer than 30 is `formula.invalid_variable` with `params.reason = too_many_variables`. No separate limit codes exist. The API problem carries `code` and `detail`; `params` are available to in-process callers such as the web preview, which may use them for i18n.
- **(5) `formula.invalid_variable`** is part of the code set: name pattern, reserved words (`to_period`, `min`, `max`, `abs`, `month`, `quarter`, `year`), duplicate names, kind/period enum, a currency exactly for kind `currency` (ISO 4217, upper case), and the value as a `numeric(24,6)` decimal string. It is defensive: the API's zod mirror of `FormulaVariable` refuses most of these with **400** first. A reserved name, a duplicate name and a missing or superfluous currency pass the schema, so the API answers them with **422** and this code.
- **Status boundary for KBE-C.** The request schema runs first, then the engine. Anything the contract schema refuses (for example `expression` longer than 2000, or a malformed `FormulaVariable`) is **400**. Anything it admits but the engine refuses is **422** `urn:mth:problem:validation`, with the first engine error's `code` as `code` and its `message` as `detail`. `too_long` is therefore reachable only through direct calls (the web preview), never through the API. Code-point vs UTF-16 counting at exactly 2000 cannot admit an invalid formula, because every character outside the grammar is a syntax error.
- **(6) Depth.** Parentheses, function calls and unary minus each add one level; the top level is depth 1. Left-associative binary chains add no depth (`a + b + …` with 30 terms is depth 1). Height is bounded anyway by the 200-node cap. Both limits are enforced while parsing, so deeply nested input fails cleanly and never exhausts the stack.
- **(7) Characters** are Unicode code points (the JSON Schema `maxLength` unit). The `offset` of a problem is a code-point offset from the start of the expression.
- **(8) Arity.** `to_period(expr, period)` takes exactly 2 arguments, the second a period name; `abs(expr)` exactly 1; `min` and `max` 2 or more expressions. A violation is `formula.syntax` with `reason = arity`.
- **(9) Type rules, completing the list above.**
  - Dimensionless × dimensionless: `number × X → X`, two operands of the same kind keep it, any other pair gives `number`.
  - `quantity ± quantity` needs the same `unit` label, or it is `formula.kind_mismatch`, so minutes + hours never sum silently.
  - Pairs not listed above (quantity × currency, quantity × quantity, fraction ÷ fraction, number ÷ fraction and the like) are `formula.kind_mismatch`.
  - Periods are "per period" labels. The result takes the operands' shared non-`none` period. `currency ÷ currency` with the same period gives `number` with period `none`. `+`, `−`, `min` and `max` also refuse a period against no period: 'Period mismatch: {a} is per {p} but {b} has no period'. `to_period` on a value without a period is `formula.period_mismatch` ('Period mismatch: to_period needs a value with a period, but {x} has no period').
  - In `period_mismatch` the operand with the finer period is named first and converted to the coarser one, so the message above is the same in either operand order.
  - One currency per formula is checked over the whole formula, so `sar / sar_b * usd` is refused even though each operation alone is well typed.
- **(10) English texts** (the codes come from this ADR; these texts are now authoritative too, and Arabic is rendered by the web from the code and `params`):
  - `formula.kind_mismatch`: 'Kind mismatch: {left} ({leftKind}) {op} {right} ({rightKind}) is not allowed'
  - `formula.currency_product`: 'Currency product: {left} and {right} are both currency amounts and cannot be multiplied'
  - `formula.currency_mismatch`: 'Currency mismatch: {left} is in {lc} but {right} is in {rc}; there is no FX conversion'
  - `formula.division_by_zero`: 'Division by zero: {divisor} is 0; the result is Unknown'
  - `formula.missing_input`: 'Missing input: {names}; the result is Unknown'
  - `formula.result_out_of_range`: 'Result out of range: {value} does not fit numeric(24,6)'
  - `formula.syntax`: 'Syntax error at offset {n}: {detail}'
- **(11) Exactness record.** The lineage's `rounding` object is `{column: "numeric(24,6)", scale: 6, mode: "ROUND_HALF_UP", precision: 80, exact, stored, rounded, inexactIntermediate}`. `rounded` reports the single storage rounding. `inexactIntermediate` is true when a division, an inverse period conversion or the 80-digit cap actually rounded an intermediate value, and every operation is re-checked against an unbounded-precision computation to set it. KBE-C stores this object in the `benefit_calculation` lineage as is.
- **(12) "500000" vs "500000.00".** These are the same value. The canonical `result` is the normalised decimal string `"500000"` (API `result`, comparison by `compareDecimal`). The stored column value is `"500000.000000"` (`rounding.stored`, `benefit_calculation.result`). The currency display is `SAR 500,000.00`. "500000.00 SAR" in the example table is the display form.
- **(13) Display suffixes.** `formatFormulaValue` defaults to "pp" / `نقطة مئوية` for `fraction_delta` and "%" / `٪` for the percent kinds. The Arabic default is **provisional**. The web (FE-C) renders the suffix through i18next from the suffix code that `displayNumber` returns (`percentage_points` | `percent`), so translators own the text. The defaults are a fallback for non-UI callers (for example exports).

None of items 4–13 is changed, so **KBE-C has no code change to make** to the engine. KBE-C owns the 400/422 boundary above.

**Import path (T-DG3-ARCH-02).** The engine and `scoring.ts` pull in decimal.js, so they are exported from the subpath **`@mth/shared/calc`** (`packages/shared/package.json` `exports["./calc"]`, with the conditions `@mth/source` → `src/calc.ts`, `types` → `dist/calc.d.ts`, `default` → `dist/calc.js`). The top-level `@mth/shared` stays dependency-free (ADR-0002). The API, the worker, the web (Vite) and vitest resolve the subpath exactly like `@mth/shared/schemas`. The lower-level parts of the engine (`tokenize`, `parseFormula` and the rest) are re-exported from the same subpath; no consumer imports files under `src/formula/` directly.

### 7. Permissions

`business_case.edit`, `benefit_formula.edit` (write; TL, KDS for formulas, WL record-level for initiative cases), `finance.validate` (FIN; existing P1 catalogue entry, first used here).

### 8. Out of P3 scope (listed so nobody claims it)

The canonical benefit register with allocations, shared-benefit groups, contribution allocations ≤ 100% and unallocated shares; planned/forecast/measured/validated value tracking; scenarios (base/upside/downside) as data; NPV/ROI/payback. These are P4 (REQ rows with final gate DG4). P3 prevents double counting only through §2 (one formula → one line) and §3 (one line → one case; set-based roll-up).

### 9. Interpretations and texts recorded after build (T-DG3-KBE-B handback §3, §7; confirmed T-DG3-ARCH-03, 2026-10-08)

These are the rule, and reviewers test against this text.

- **Sections 5 and 6 of a transformation case count its roll-up set.** For the "≥ 1 active line" condition (§1), a **transformation** case counts the lines of its roll-up set (§3): its own lines plus the lines of its active initiative cases, each distinct line once. Costs and benefits normally sit at initiative level, so a transformation case with no own lines is still complete there when its initiatives carry lines. An **initiative** case counts its own lines only.
- **Net is Unknown without both sides.** `netValue` (per currency) is `null` (Unknown) unless both `grossBenefits` and `implementationCost` have a known amount in that currency. It is never computed against an implied `0`.
- **The baseline author is `created_by`.** For the separation-of-duties rule of §5 ("did not author the record"), the author of a case's baseline is the case's `created_by`, matching the DB CHECK. Someone who only edited the baseline later is not barred from validating it. Tightening this to "the last baseline editor" would need a new column (`baseline_updated_by`) and a migration. It is not done in P3; if Finance policy requires it, it is a later-stage change to this ADR.
- **`rejected` stays `rejected`.** A baseline edit turns only a `validated` baseline into **Stale** (the stored SHA-256 no longer matches). A `rejected` baseline stays `rejected` after an edit, because the DB requires the hash exactly when the status is `validated`. A new validation decision is needed either way.

**Problem codes and English texts** (KBE-B's wording, as built; FE-C translates from `code`, Arabic provisional):

| Code | Status | English `detail` |
|---|---|---|
| `business_case.line_class_mismatch` | 422 | "The class {class} is not a {lineKind} class." |
| `business_case.value_basis_mismatch` | 422 | "The value basis {valueBasis} does not fit the class {class}." |
| `business_case.non_financial_amount` | 422 | "A strategic or non-financial benefit has no amount: it is not monetised without an approved valuation method." |
| `business_case.formula_already_linked` | 409 | "This benefit formula already backs another active line; one benefit is counted in one line only." |
| `business_case.not_initiative_lead` | 403 | "A Workstream Lead edits only the business cases of initiatives they lead." |
| `finance.validator_is_author` | 403 | "Finance validation is done by someone other than the record's author (separation of duties)." (the `db-errors.ts` text) |
| `business_case.amount_negative`, `.fte_only_internal`, `.fte_positive`, `.period_range`, `.formula_only_benefit` | 422 | as written in `apps/api/src/modules/kpi/business-case-lines.ts` |
| `business_case.transformation_case_exists`, `.initiative_case_exists` | 409 | as written in `kpi/business-cases.ts` |
| `business_case.transformation_case_required`, `.initiative_required`, `.initiative_not_allowed`, `.has_initiative_cases`, `.baseline_missing`, `.archived`, `.already_archived`; `business_case_line.archived`, `.already_archived` | 422 | as written in `kpi/business-cases.ts` and `kpi/business-case-lines.ts` |
| warnings `business_case.revenue_and_margin`, `business_case.possible_duplicate` | — | as written in `kpi/totals.ts` |

The source files are the single place for the texts marked "as written". This ADR fixes the codes and their meaning, not a second copy of every sentence.

## Alternatives considered

1. **A third-party expression library** (for example `expr-eval`, `mathjs`). Rejected: they evaluate floats, carry far more surface than needed, and some compile to `Function`; a 300-line parser is auditable and has no new licence or supply-chain risk.
2. **New `packages/calc` package now.** Rejected for P3: it adds a workspace package and lockfile churn for code the web and API already share through `@mth/shared/calc`. P4 may move it.
5. **Exporting the engine from the top-level `@mth/shared`.** Rejected (T-DG3-ARCH-02): it would pull decimal.js into every consumer of the dependency-free top-level entry. A subpath costs one `exports` entry and no dependency change.
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
