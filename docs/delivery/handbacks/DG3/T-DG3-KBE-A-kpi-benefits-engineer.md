# Handback T-DG3-KBE-A: P3 shared calculation code (T06 scoring, T09 restricted formula engine)

- **Agent:** kpi-benefits-engineer. **Stage:** P3 / DG3 (BUILDING). **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-KBE-A-kpi-benefits-engineer-20261007T220249Z-95423c4f","session_id":"95423c4f-5271-4529-a1ed-402b8c6e75fc"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-KBE-A.md` (sha256 `65c93a11…40c40`, verified at start).
- **Base:** worktree `/home/user/wt/dg3-kbe-a`, `HEAD` = `df13c99c64199d14b3d76699fb0695a89a56f388` (same as `claude/mobily-transformation-platform-regate`). The changes are **uncommitted** in the worktree; the orchestrator integrates them.
- **Start:** `date -u` → `Wed Oct  7 22:02:58 UTC 2026`. **End:** `date -u` → `Wed Oct  7 22:22:58 UTC 2026` (about 20 minutes, within the 2-hour limit).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` → `PASS gate DG2 (historical)`, exit 0. It was run before implementation, and again at the end (`T-DG3-KBE-A-evidence/validate-dg2-historical.log`).
- Engineering work only. No product gate G1–G6 and no business, Finance or IT approval is granted or implied, and nothing here touches the DG0–DG7 records.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/scoring.ts` (new) | T06 arithmetic (ADR-0022 §1–§3, §7): criterion set, v1 defaults, weight-set validation with machine codes, `weightedScore` (exact `numeric(7,4)`), 2-digit display, 0–100 view with its conversion and label, `scoreResultView`, comparison axes |
| `packages/shared/src/scoring.test.ts` (new) | 36 tests, including the exhaustive 5^5 property test against a BigInt rational oracle |
| `packages/shared/src/formula/types.ts` (new) | `ENGINE_VERSION`, `FORMULA_LIMITS`, kinds, periods, functions, variable/type/problem/AST types |
| `packages/shared/src/formula/tokenize.ts` (new) | Hand-written tokenizer: code-point offsets, length limit, literal and identifier limits |
| `packages/shared/src/formula/parse.ts` (new) | Recursive-descent parser for the ADR-0024 §6 EBNF: arity, node and depth limits enforced while parsing |
| `packages/shared/src/formula/typecheck.ts` (new) | Variable-declaration checks and the ADR-0024 §6 type rules: kinds, currency, period alignment, `to_period` |
| `packages/shared/src/formula/evaluate.ts` (new) | AST walker on a decimal.js clone (precision 80, ROUND_HALF_UP). Single storage rounding to `numeric(24,6)`. Division by zero, missing input and out-of-range give Unknown |
| `packages/shared/src/formula/index.ts` (new) | Public API: `validateFormula`, `evaluateFormula`, re-exports, display by kind (`formatFormulaValue`: "2 pp" vs "2%") |
| `packages/shared/src/formula/formula.test.ts` (new) | 136 tests: grammar table, limits, type rules, evaluation, the two seeded examples, display |
| `packages/shared/src/formula/fuzz.test.ts` (new) | 5 tests: 40 000 fuzz inputs with eval/Function tripwires, code-shaped payloads, and a source scan for dynamic code |
| `packages/shared/src/index.ts` | **Export lines only:** `export * from "./scoring.ts";` and `export * from "./formula/index.ts";` |
| `eslint.config.js` | **Only the override block** for `packages/shared/src/formula/**` (details in §4) |
| `docs/delivery/handbacks/DG3/T-DG3-KBE-A-*` | This handback and its evidence logs |

Nothing else changed. `value.ts`, the contract, migrations, `schemas/**` (BE-A) and every root config except the one ESLint block are untouched. No dependency was added; decimal.js 10.6.0 was already pinned in `@mth/shared`.

## 2. Behaviour delivered (per requirement)

- **REQ-PB-047 / REQ-PB-048 / REQ-PB-049 / REQ-S09-001 / REQ-DLV-035 (KBE-A part: the arithmetic).**
  - 5,4,3,2,1 under 25/25/20/15/15 gives `"3.3000"` stored and `"3.30"` displayed.
  - The 0–100 view of 3.30 is `"57.5"`.
  - 95 and 105 are rejected with `prioritization.weights_total`, detail 'Weights must total 100% (got 95.00%)', pointer `/weights`.
  - v2 (risk_compliance 10, strategic fit 15) is accepted.
  - A missing score gives `incomplete` with `weightedScore: null` and `missingCriteria` in set order. It is never 0.
  - Scores 0, 6, 2.5, "4.0" and others are rejected with `prioritization.score_range`.
  - The result is exact in decimal.js. The property test covers all 3125 combinations: stored value, display and 0–100 view each equal an independent BigInt rational computation.
- **REQ-PB-056 / REQ-PB-057 / REQ-S08-007 / REQ-S07-011, REQ-S08-004, REQ-S08-006, REQ-S08-008 (KBE-A part: the engine).**
  - Restricted language, hand-written, with no dynamic code.
  - `formula.undefined_variable` 'Undefined variable: {name}'.
  - Monthly ARPU × annual population gives `formula.period_mismatch` with the ADR's exact message. `to_period(arpu, year)` is then accepted and the inverse conversions divide.
  - The revenue example gives exactly `100000` SAR per year. The cost example gives exactly `500000` (= `500000.00`) SAR per year, stored as `500000.000000`.
  - Division by zero and a missing input give a null (Unknown) result with their codes. An over-large result gives `formula.result_out_of_range`.
  - A fraction_delta of 0.02 displays as "2 pp" and a fraction of 0.02 as "2%".
  - The ESLint override and a source scan enforce the no-dynamic-code rule.

## 3. Public API (for BE-D, KBE-C, FE-B, FE-C), all exported from `@mth/shared`

### `scoring.ts`

```ts
const CRITERION_CODES: readonly ["strategic_fit","financial_value","customer_impact","feasibility","time_to_value","risk_compliance"];
type CriterionCode; function isCriterionCode(v: unknown): v is CriterionCode;
interface CriterionWeight { criterionCode: string; weightPercent: string }        // "25", "25.00", "12.5"
const DEFAULT_WEIGHTS_V1;  const MIN_CRITERIA_PER_SET = 2;  const MAX_CRITERIA_PER_SET = 6;
type WeightSetProblemCode = "prioritization.weights_total" | "prioritization.weight_format" | "prioritization.weight_range"
  | "prioritization.unknown_criterion" | "prioritization.duplicate_criterion" | "prioritization.criteria_count";
interface WeightSetProblem { code: WeightSetProblemCode; pointer: string; detail: string }
function validateWeightSet(weights: readonly CriterionWeight[]):
  { ok: true; total: string /* "100.00" */ } | { ok: false; problems: readonly WeightSetProblem[] };
function weightTotal(weights): string;                                              // "100.00"
type ScoreInput = string | number;   // "1".."5" or a JS integer 1..5 (contract integer / smallint); never used in arithmetic
type ScoreMap = Readonly<Partial<Record<string, ScoreInput | null | undefined>>>;
function isValidScore(v: unknown): v is ScoreInput;
class ScoringInputError extends Error { code: ScoringInputCode; pointer: string }   // thrown by weightedScore/axisScore on invalid input
function weightedScore(scores: ScoreMap, weights: readonly CriterionWeight[]):
  | { completeness: "complete"; weightedScore: string /* "3.3000" */; missingCriteria: []; inputs }
  | { completeness: "incomplete"; weightedScore: null; missingCriteria: CriterionCode[]; inputs };
  // inputs = { [criterion]: { score: "5" | null, weightPercent: "25.00" } }  → initiative_score_result.inputs
function weightedScoreDisplay(value: string | null, o?: { locale?: "ar"|"en"; digits?: "latn"|"arab" }): string | null; // "3.30"
function display100(weighted: string | null): string | null;                       // "57.5"
function display100Formatted(weighted: string | null, o?): string | null;
const DISPLAY100_CONVERSION = "(score-1)/4*100"; const DISPLAY100_LABEL_KEY = "prioritization.conversion_label";
const DISPLAY100_LABEL_EN = "0–100 view = (weighted score − 1) ÷ 4 × 100"; const DISPLAY100_LABEL_AR (provisional);
function scoreResultView(r: { completeness; weightedScore; missingCriteria }):
  { completeness; weightedScore; weightedScoreDisplay; display100; conversion; missingCriteria };  // contract ScoreResult minus versionNo/computedAt
const VALUE_AXIS_CRITERIA, FEASIBILITY_AXIS_CRITERIA;
function axisScore(scores: ScoreMap, weights, criteria: readonly CriterionCode[]): string | null;   // ADR-0022 §7, 4 dp
```

### `formula/`

```ts
const ENGINE_VERSION = "mth-formula/1.0.0";
const FORMULA_LIMITS = { maxLength: 2000, maxNodes: 200, maxDepth: 32, maxVariables: 30, maxLiteralDigits: 24, maxIdentifierLength: 48 };
type FormulaKind = "fraction"|"fraction_delta"|"percent_change"|"count"|"currency"|"quantity"|"number";
type FormulaPeriod = "none"|"month"|"quarter"|"year";
interface FormulaVariable { name; kind; period; unit?; currency?; value?: string|null; source?; description? } // = contract FormulaVariable
interface FormulaType { kind; currency: string|null; period; unit: string|null }
type FormulaErrorCode = "formula.syntax"|"formula.undefined_variable"|"formula.kind_mismatch"|"formula.currency_product"
  |"formula.currency_mismatch"|"formula.period_mismatch"|"formula.invalid_variable"|"formula.division_by_zero"
  |"formula.missing_input"|"formula.result_out_of_range";
interface FormulaProblem { code: FormulaErrorCode; message: string /* English detail */; offset?: number; params: Record<string,string> }

function validateFormula(expression: unknown, variables: readonly FormulaVariable[]):
  | { ok: true; ast: FormulaAst; resultType: FormulaType; variables: readonly string[]; checked: CheckedFormula; engineVersion }
  | { ok: false; errors: readonly FormulaProblem[]; engineVersion };
function evaluateFormula(expression: unknown, variables: readonly FormulaVariable[], inputs?: Record<string, string|null>):
  { ok: boolean; result: string | null /* canonical stored value, null = Unknown */; resultType: FormulaType | null;
    errorCode?: FormulaErrorCode; errors: FormulaProblem[];
    rounding: { column: "numeric(24,6)"; scale: 6; mode: "ROUND_HALF_UP"; precision: 80; exact: string|null;
                stored: string|null /* "100000.000000" */; rounded: boolean; inexactIntermediate: boolean };
    inputs: Record<string, string|null> /* values used → lineage */; engineVersion };
function evaluateAst(checked: CheckedFormula, inputs?): FormulaEvaluation;           // evaluate without re-parsing
function formatFormulaValue(value: string|null, kind: FormulaKind, o?: { locale?; digits?; maxFractionDigits?; currency?; unit? }): string|null;
function displayNumber(value: string|null, kind): { value: string; suffix: "percent"|"percentage_points"|null } | null;
// lower level: tokenize, parseFormula, checkVariables, typecheckFormula, RESERVED_WORDS, FORMULA_DECIMAL, RESULT_COLUMN
```

**Mapping to the contract (KBE-C):**
- `FormulaCheckResult.valid` = `validateFormula(...).ok`.
- `resultKind`, `resultUnit`, `resultCurrency` and `resultPeriod` come from `resultType`.
- `result` = `evaluateFormula(...).result`, and `errors` = its `errors` (each with `code` and `message`).
- An invalid formula is a 422 whose problem `code` and `detail` are the first error's `code` and `message`.
- `benefit_calculation.result` = `rounding.stored`, or `result` (same value). `error_code` = `errorCode`.
- The lineage's rounding record is `rounding`, and its inputs are `inputs`. `engine_version` = `ENGINE_VERSION`.

## 4. ESLint override (`eslint.config.js`, only this block)

For `packages/shared/src/formula/**/*.{ts,tsx,js,mjs}` the override sets these rules:
- `no-eval`, `no-implied-eval` and `no-new-func`;
- `no-restricted-imports` for `vm` and `node:vm`;
- `no-restricted-syntax` for `ImportExpression`, `WithStatement`, timer calls (`setTimeout`, `setInterval`, `setImmediate`, `execScript`, as plain calls or member calls) and `.constructor(...)` calls. It also repeats the existing `parseFloat` ban, because a later `no-restricted-syntax` replaces the generic list for these files.

The probe evidence is in `T-DG3-KBE-A-evidence/lint-eval-probe.log`. There were two runs:
- **Run 1** used the assignment's rule list only. `eval("1")`, `new Function`, `Function(...)`, the `node:vm` import and `import()` all failed, exit 1. But `setTimeout("1", 0)` was **not** flagged: core `no-implied-eval` only recognises declared globals, and the root config declares none.
- **Run 2** added the timer and `.constructor` selectors. All 11 probe constructs failed, exit 1.

The probe file was removed after each run, and the log shows it is absent. The fuzz test's eval tripwire (it saves, replaces and restores `globalThis.eval` and never calls it) carries justified, line-scoped `eslint-disable` comments.

## 5. Checks actually run (worktree, Node v24.21.0, offline)

| Command | Result | Log |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG2` (start and end) | `PASS gate DG2 (historical)`, **exit 0** | `validate-dg2-historical.log` |
| `pnpm -r typecheck` | **exit 0** (7 projects) | `typecheck.log` |
| `pnpm -r build` | **exit 0** | `build.log` |
| `pnpm lint` | **exit 0** | `lint.log` |
| ESLint eval probe under `packages/shared/src/formula/` | **exit 1, as intended** (5 errors in run 1, 11 in run 2); probe removed | `lint-eval-probe.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0**, "All matched files use Prettier code style!" | `prettier-check.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | **exit 0**: 53 files, **1106 tests passed** | `test-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: 53 files, **1106 tests passed** | `test-c-utf8.log` |

All logs are in `docs/delivery/handbacks/DG3/T-DG3-KBE-A-evidence/`.

**New tests: 177**, all passing in both locales:
- `scoring.test.ts`: 36;
- `formula/formula.test.ts`: 136;
- `formula/fuzz.test.ts`: 5.

Every test has an explicit timeout. The fuzz runs use a seeded mulberry32 generator, so they are deterministic.

**Notes on the logs:**
- The test logs contain a `FastifyWarning [FSTDEP022]` from existing `apps/api` tests. It is unrelated to this change, and no suite failed or timed out.
- The worktree shows untracked `.bashrc`, `.bash_profile`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. They are `/dev/null` character devices masked in by the sandbox, not repository files. Git lists them, so they were passed to Prettier, and the check still exited 0. Do not commit them.
- The handback Markdown itself was checked with Prettier after it was written. The evidence logs are `.log` files, which `--ignore-unknown` skips.

## 6. Interpretations and decisions (please confirm; raised, not silently decided)

1. **Weight ≥ 0 vs > 0.** The assignment says "each weight is ≥ 0". ADR-0022 §1 and the 0021 DB CHECK say `weight_percent > 0 AND <= 100`. I followed the ADR and the DB: `"0"` is refused with `prioritization.weight_range`. The contract pattern also admits `"0"`, so a 0 weight passes the 400 schema check and then gets 422 from `scoring.ts`.
2. **Extra machine codes in scoring.** `prioritization.weight_format`, `prioritization.weight_range`, `prioritization.unknown_criterion`, `prioritization.duplicate_criterion`, `prioritization.criteria_count` and `prioritization.score_range` are new i18n keys. They mirror the schema and DB checks. Only `prioritization.weights_total` is ADR-defined. If BE-D maps them to 400 schema errors instead, it can ignore them. FE-B needs translations if it shows them.
3. **Scores as JS integers.** A score is accepted as `"1".."5"` or as a JS **integer** 1..5, because the contract has `score: integer` and pg returns `smallint` as a number. It is converted to its digit string and then to decimal.js at once, and no arithmetic runs on a number. Non-integers are refused.
4. **Limit codes.** ADR-0024 names no codes for the limits ("anything else is `formula.syntax`"). So limits are `formula.syntax` with `params.reason`, one of `too_long`, `too_many_nodes`, `too_deep` or `too_many_variables`, plus `params.limit`. Other syntax reasons include `character`, `number`, `number_digits`, `identifier_length`, `unknown_function`, `period`, `arity`, `empty`, `end` and `unexpected`. A declared list of more than 30 variables is `formula.invalid_variable` with reason `too_many_variables`.
5. **`formula.invalid_variable`** (new code). This is a defensive check of the variable declarations: name pattern, reserved words (`to_period`, `min`, `max`, `abs`, `month`, `quarter`, `year`), duplicates, kind/period enum, currency required exactly for `currency` (ISO uppercase), and the value as a `numeric(24,6)` decimal string. The API's zod schema should refuse these with 400 first.
6. **"Nesting depth"** counts parentheses, function calls and unary minus, with the top level at depth 1. Binary chains are left-associative and add no depth: `a + b + … (30 terms)` is depth 1. AST height is bounded anyway by the 200-node cap. Both limits are enforced while parsing, so 1000 nested `(` fail cleanly and never exhaust the stack.
7. **"Characters"** means Unicode code points (the JSON Schema `maxLength` unit). Offsets are code-point offsets too.
8. **Arity** (not specified in the ADR): `to_period(expr, period)`, `abs(expr)`, and `min` or `max` with at least two expressions. A violation is `formula.syntax` with reason `arity`.
9. **Type-rule details the ADR leaves open:**
   - **Dimensionless × dimensionless:** `number × X → X`, the same kind stays the same, and otherwise the result is `number`.
   - **Quantity units:** quantities with different unit labels cannot be added (`formula.kind_mismatch`). I added this so minutes + hours never sums silently.
   - **Kinds not listed in the ADR** (quantity × currency, quantity × quantity, fraction ÷ fraction, number ÷ fraction) give `formula.kind_mismatch`.
   - **Periods are "per period" basis labels:**
     - the result takes the shared non-`none` period;
     - `currency ÷ currency` with the same period gives a `number` with period `none`;
     - `+`, `−`, `min` and `max` also refuse a period against no period, with the message 'Period mismatch: {a} is per {p} but {b} has no period';
     - `to_period` on a value without a period is `formula.period_mismatch`.
   - **Who is named in `period_mismatch`:** the operand with the finer period is named first and converted to the coarser one. That reproduces the ADR message in either operand order.
   - **One currency per formula:** a formula is checked as a whole, so `sar / sar_b * usd` is refused even though each operation alone is well typed.
10. **English texts the ADR does not give** (the codes are ADR-defined):
    - kind_mismatch: 'Kind mismatch: {left} ({leftKind}) {op} {right} ({rightKind}) is not allowed';
    - currency_product: 'Currency product: {left} and {right} are both currency amounts and cannot be multiplied';
    - currency_mismatch: 'Currency mismatch: {left} is in {lc} but {right} is in {rc}; there is no FX conversion';
    - division_by_zero: 'Division by zero: {divisor} is 0; the result is Unknown';
    - missing_input: 'Missing input: {names}; the result is Unknown';
    - result_out_of_range: 'Result out of range: {value} does not fit numeric(24,6)';
    - syntax: 'Syntax error at offset {n}: {detail}'.
11. **Exactness record.** With precision 80, `+ − ×` are exact for any realistic input. Every operation is still re-checked against an unbounded-precision computation, and `rounding.inexactIntermediate` is set when a division, an inverse period conversion or an 80-digit cap actually rounded. `rounding.rounded` reports the single storage rounding.
12. **The 500000.00 vs "500000" wording.** The assignment says `500000.00` and the ADR verification says `"500000"`. `result` is canonical (`"500000"`), `rounding.stored` is `"500000.000000"`, and `formatFormulaValue(..., "currency")` displays `SAR 500,000.00`. The tests assert all three, plus `compareDecimal(result, "500000.00") === 0`.
13. **The Arabic "pp" suffix** (`نقطة مئوية`) and `٪` in `formatFormulaValue` are defaults. FE-C may render the suffix code from `displayNumber` through i18next instead.
14. **Top-level `@mth/shared` now pulls in decimal.js.** Its header comment says "Dependency-free constants and types", but the assignment directs these exports there. `value.ts` is still exported only from `@mth/shared/schemas`. decimal.js is already a dependency of `@mth/shared`, and typecheck and build pass for every workspace (api, web, worker, db). The architect may want to update that header comment; it is outside my ownership.

## 7. Known gaps / not done

- Every scope item in the assignment is done: scoring and its tests, the engine, its tests, the ESLint override with the probe, and the exports.
- No integration with the API or web, by design: BE-D, KBE-C and FE-B/FE-C consume this code.
- No `packages/calc` package; it stays reserved for P4 per ADR-0024.
- The interpretations in §6 need the architect's or orchestrator's confirmation. Items 1, 2, 4, 5 and 9 decide behaviour that reviewers and the downstream tasks will see.

## 8. Merge instructions

- No migrations, no lockfile change, no new dependency.
- Copy or merge the new files and the two small edits (the `index.ts` export lines and the `eslint.config.js` override block). The paths are disjoint from BE-A's ownership (`schemas/portfolio.ts` and `schemas/index.ts` are untouched), so no conflict is expected. If BE-A also adds export lines to `packages/shared/src/index.ts`, both sets of appended lines should be kept.
- Do **not** commit the sandbox-masked dotfiles listed in §5.
- After merging, run `pnpm -r typecheck && pnpm -r build && pnpm lint && pnpm test`.
