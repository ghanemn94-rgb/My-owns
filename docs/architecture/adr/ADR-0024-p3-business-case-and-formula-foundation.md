# ADR-0024: Business case, roll-up without double counting, and the T09 formula foundation (P3)

- **Status:** Proposed for P3 (DG3). Author: solution-architect (T-DG3-ARCH-01), 2026-10-07.
- **Requirements:** REQ-PB-053, REQ-PB-054, REQ-PB-055, REQ-PB-056, REQ-PB-057, REQ-S05-005, REQ-S08-007, REQ-DLV-035 (tested financial inputs).
- **Sources:** playbook B0083–B0088, B0139; master prompt §8 (lines ~263–282), M0148, M0168–M0173, M0329.
- **Builds on:** ADR-0003, ADR-0004, ADR-0016, ADR-0019 (decimal, Unknown, validation staleness), ADR-0021 (G4), ADR-0002 (package boundaries).
- **Physical model:** `0023_p3_business_case_formula.sql`; `0027_p3_calculation_rounding.sql` (§10). Module `kpi` (kpi-benefits-engineer) owns `business-cases` and `benefit-formulas`; the engine lives in `packages/shared/src/formula/` (§6).

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

**Extended guard (F-DG3-100; T-DG3-KBE-D, rewritten by T-DG3-KBE-E, corrected by T-DG3-KBE-F and T-DG3-KBE-G).** There are three layers, and each one guarantees only what is stated here.

**Scope: the engine's import closure.** The guarded code is the engine's transitive static import closure from `formula/index.ts`: the six sources in `packages/shared/src/formula/` (`evaluate.ts`, `index.ts`, `parse.ts`, `tokenize.ts`, `typecheck.ts`, `types.ts`) and `packages/shared/src/value.ts`, plus the package `decimal.js`. Below, "the engine sources" means all seven files. `value.ts` is the closure's only file outside `formula/` (`FORMULA_CLOSURE_OUTSIDE` in `eslint.config.js`).
- **Pinned by a test.** `fuzz.test.ts` computes the closure from `formula/index.ts` and asserts four things (listed below).
  - **What the closure parser follows.** It is a regular expression (`IMPORT_SPECIFIER`) over the comment-free text, not a JavaScript parser. It follows the quoted specifier of `import … from "…"`, `import type … from "…"`, a side-effect `import "…"`, `export { … } from "…"`, `export type { … } from "…"`, `export * from "…"` and `export * as n from "…"`, with braces over several lines. Since round 5 it also follows string-named specifiers, `export { "x" as y } from "…"`, `import { "x" as y } from "…"` and `export * as "n" from "…"` (the reviewer's X1).
  - **What it does not follow.** It does not follow `import()`, `require(…)`, `createRequire`, `import x = require("…")` or `import.meta`. Layers 1–2 refuse all of these in every engine source. The backstop for any static declaration the regular expression misses is ESLint: it parses the module, and its import allowlist (layer 1) applies to every `import`/`export … from` declaration it sees.
  - **The four assertions:**
    - every relative specifier resolves to a file;
    - `decimal.js` is the only package;
    - every file of the closure is in the source scan's file set (layer 2);
    - ESLint's computed configuration for every file of the closure carries the engine-source rules of layer 1 (`ESLint.calculateConfigForFile`). These include `no-eval`, `no-implied-eval`, `no-new-func`, `no-unsafe-finally`, the host globals, an import allowlist that refuses `node:vm`, `node:module`, `node:inspector`, `node:fs`, `zod` and `@mth/shared`, and the engine-source syntax selectors, including the catch-shape, `EvalError` and synchronous-engine selectors below.
- **What this means.** A file the engine starts to import, directly or through another file, fails this test until it is added to both static layers.
- **One exception to the both-projects rule.** The ESLint assertion runs in `unit-node` only. ESLint validates rule options with ajv, which compiles schemas with `new Function`, so ESLint cannot run under `--disallow-code-generation-from-strings`. Lint coverage is a property of the configuration, not of the process. The other three closure assertions run in both projects.
- **decimal.js.** It is a pinned third-party package (10.6.0) and is outside layers 1–2. Its 10.6.0 sources (`decimal.js` and `decimal.mjs`) contain no `eval(` or `Function(` call. They also contain no `try`, `catch`, `finally`, `Promise`, `async` or `await`, so the rethrow rule has nothing to apply to there. Layer 3 covers whatever part of it the tests exercise.

1. **Static layer: ESLint (`eslint.config.js`, the formula blocks).**
   - For every file under `packages/shared/src/formula/**`, and for `packages/shared/src/value.ts`:
     - `no-eval`, `no-implied-eval` and `no-new-func`;
     - `no-restricted-globals` for `Function`, `eval` and `Reflect`;
     - `no-restricted-syntax` for any `Function` identifier, computed `["constructor"]`/`["Function"]` members, any `.constructor` read or destructuring, `require`/`createRequire`, `Reflect.*`, `import()`, `with`, and timer calls;
     - `no-restricted-imports` for `vm`, `module`, `worker_threads`, `child_process`, `inspector` and `repl`, with and without `node:`.
   - For the engine sources only (the non-test files of `formula/`, excluding `test-support/`, and `value.ts`), these rules as well:
     - **An import allowlist.** `no-restricted-imports` refuses every specifier except `./<name>.ts`, `../value.ts` and `decimal.js`, for `import`, `import type` and `export … from`. For `value.ts` the allowlist is narrower: `decimal.js` only, so it cannot pull a further module into the closure. That refuses every `node:*` built-in and every npm or workspace package. The engine uses no `@mth/*` workspace import. Separately, run-time module loading is refused: `import()`, `require`, `createRequire`, `import.meta`, and `process` (which carries `getBuiltinModule`).
     - **Host globals.** `process`, `global`, `globalThis`, `self`, `window`, `frames`, `parent`, `top`, `opener` and `document` are refused both through `no-restricted-globals` and as any identifier, so a shadowing `declare const global` is refused too. The engine uses none of them.
     - **Constructor keys.** Any string literal, template element or identifier equal to `constructor` is refused, except the name of a class constructor declaration.
     - **Prototype reflection and assembled keys.** Also refused: prototype reflection (`getPrototypeOf`, `getOwnPropertyDescriptor(s)`, `setPrototypeOf`, `defineProperty`, `__proto__`, …), a computed key assembled from a string literal (`["con" + k]`, or a template with substitutions), and a computed member read directly off a function expression.
     - **The `EvalError`-rethrow rule (F-DG3-100 round 5).** These rules keep a refused code generation from being handled inside the closure, so it reaches the test that exercised it (layer 3):
       - **Catch shape.** Every `catch` must bind its parameter as `e`, and its first statement must be exactly `if (e instanceof EvalError) throw e;`, with a bare `throw` and no `else` (a `no-restricted-syntax` selector on `CatchClause`).
       - **What that refuses.** An optional-binding `catch { }`, a destructured or differently named parameter, a rethrow inside a block or after another statement, and any other first statement. The fixed name `e` lets a selector express the rule, because esquery cannot compare two attributes. All five catches already use it.
       - **No shadowing.** `EvalError` may appear only as the right operand of `instanceof`, so a local declaration cannot shadow the global it is tested against.
       - **No swallowing finally.** `no-unsafe-finally` (error) refuses a `return`, `throw`, `break` or `continue` that discards the exception in flight.
       - **A synchronous engine.** The engine has no asynchronous code. `Promise`, `queueMicrotask`, `async` functions, `await`, `for await` and any `.then`, `.catch` or `.finally` member (also as `["then"]`) are refused. This closes a promise reaction that would move the refusal off the exercising test's call stack, where a handler could swallow it.
   - **Guarantee and limit.** This layer is a best-effort denylist for the common spellings, plus the import allowlist. It is not complete, and it cannot be: JavaScript can assemble a property key at run time from values that no static rule sees.
2. **Static layer: the source scan (`fuzz.test.ts`, `scanSource`).**
   - It mirrors layer 1 on the engine sources, with comments stripped. Its file set is the six `formula/` sources and `value.ts`, and the closure test asserts that this set contains the whole closure. It checks the same denylist words, the host globals, the word `constructor` outside a class constructor declaration, prototype reflection, string-assembled keys, `import.meta`, hex and Unicode escapes, and the same import allowlists (`decimal.js` only for `value.ts`).
   - **The rethrow rule (round 5).** It also mirrors the `EvalError`-rethrow rule:
     - every `catch` keyword must begin `catch (e) { if (e instanceof EvalError) throw e;` with no `else` after it;
     - no `finally { … }` block may contain `return`, `throw`, `break` or `continue`. This is stricter than `no-unsafe-finally`, because it also counts one inside a nested function;
     - `EvalError` may appear only after `instanceof`;
     - `Promise`, `queueMicrotask`, `async`, `await`, and `.then`, `.catch` or `.finally` (or `["then"]`, …) are refused.
   - A probe table pins that each F-DG3-100 form is a hit:
     - the round-1 forms O1–O6;
     - the round-2 forms N1–N12;
     - other non-allowlisted imports;
     - the round-4 handler forms W1 (`catch { }`), W2 (`finally { return; }`), W4 (`Promise…then(…).catch(…)`) and W5 (a catch that wraps the error);
     - the other catch, finally and async spellings above;
     - the string-named specifiers (X1).
   - Its guarantee and its limit are the same as layer 1's.
3. **Run-time layer, independent of spelling (`vitest.config.ts`, project `unit-formula-nocodegen`).**
   - `pnpm test` runs the whole formula test corpus a second time: every `*.test.ts` under `packages/shared/src/formula/`, including `formula.test.ts` and `fuzz.test.ts`. It runs in forked Node processes started with `--disallow-code-generation-from-strings`.
   - In those processes, `eval` and every construction of `Function`, `AsyncFunction` or `GeneratorFunction` from a string throw `EvalError`, however the constructor was reached and however its key was spelled.
   - **Guarantee.** Any engine path that generates code from a string fails the engine's tests, provided a test exercises it. Two rules make this true, whatever the exercising test asserts, unless the test itself expects an `EvalError`. Only the injection tests named under "Regression" do that.
     - **The engine rethrows `EvalError` (F-DG3-100 rounds 4–5).** Every catch in the closure rethrows `EvalError` as its first statement, instead of converting it into a problem or a null. Since round 5, lint and the scan enforce this for every catch, including a new one (layers 1–2).
       - **The five catch clauses:** `validateFormula` and `evaluateFormula` in `index.ts`, the tree walk in `evaluateAst` (`evaluate.ts`), `parseFormula` (`parse.ts`), and `formatDecimal` in `value.ts`.
       - **The `parse.ts` catch.** It already rethrew everything that is not its own `ParseFailure`. Round 5 gave it the same first statement, which changes no behaviour. Round 5 also moved the rethrow to the top of the `evaluateAst` catch, ahead of the `EvalFailure` check. `EvalFailure` is a separate class and never an `EvalError`, so this changes no behaviour either.
       - **No swallowing.** No `finally` in the closure discards an exception, and the closure has no asynchronous code. So the exception reaches the test on the exercising test's call stack.
     - **An internal failure fails the tests.** Every outcome check in `fuzz.test.ts` refuses a problem with `params.reason: "internal"`, through the helper `internalProblems`. That covers `checkOutcome` (all 40,000 generated inputs, for both `validateFormula` and `evaluateFormula`) and the code-shaped-payload test. Every row of `formula.test.ts`'s rejection table refuses one too.
     - **Regression.** `codegen.nocodegen.test.ts` runs a real string code generation inside four of the five catches (all but `parse.ts`), through the public entry points: a caller-supplied getter, or a crafted checked formula. It requires the `EvalError` to come out. In both projects, `formula.test.ts` pins the other half: a `TypeError` at the same four points is still converted. Both files also inject an `EvalError` at those four points (the injection tests).
       - **Why `parse.ts` has no regression case.** Its `try` processes only the tokenizer's own token list, so no caller-supplied value reaches it. Its rethrow is pinned by lint and the scan instead.
     - **Production behaviour.** A genuinely unexpected error is unchanged: it is a 422 `formula.syntax` problem with `reason: "internal"` (`formatDecimal`: null, shown as Unknown). An `EvalError` cannot occur in production, because nothing in the engine generates code. If one ever did occur, it would propagate, and it is never shown as a user's syntax error.
       - **API.** The API's error handler answers with the generic 500 `internal` problem.
       - **Web.** The web defines no error boundary or `errorElement` of its own (`apps/web/src/app/router.tsx`). The formula builder (`useLiveCheck`) and the example preview (`BenefitFormulasPage.tsx`) call `evaluateFormula` while rendering. An `EvalError` would therefore reach React Router 7.9's default error element, which replaces the page. It shows "Unexpected Application Error!", the error message and its stack, in English only (not translated, not RTL).
       - **In practice.** This is unreachable, because the engine generates no code.
   - **Canary.** `codegen.nocodegen.test.ts` runs only in this project. It asserts that the flag is in the process's `execArgv`, and that each of these throws `EvalError`: `new Function`, direct and indirect `eval`, and the AsyncFunction and GeneratorFunction constructors reached through a prototype. If the flag is ever lost, the canary fails, so the guard cannot disappear silently.
   - **Not covered by the flag.** It does not cover `node:vm`, `node:inspector`, or a module loaded with `process.getBuiltinModule`. Layers 1–2 refuse those in every file of the engine's import closure, `value.ts` included, through the import allowlists and the `process` ban. The closure test ensures that no file of the closure is outside them. `decimal.js` is outside layers 1–2 (see "Scope").
   - **Mechanics**, recorded because they are not obvious:
     - Vitest 3.2 honours the forks pool's `execArgv` only at the root, so the project runs in its own Vitest invocation, the second command of `pnpm test`. The config refuses to combine it with another project.
     - Neither the `threads` pool nor `vmForks` can carry the flag: worker threads refuse it (`ERR_WORKER_INVALID_EXEC_ARGV`), and `node:vm` contexts re-enable code generation.
     - tinypool 1.1.1 resolves its warm-up handler through `new Function` when the handler name is not exported. So `test-support/nocodegen-preload.mjs`, loaded with `--import`, renames that one warm-up message to the worker's `run` export. The preload enables no code generation.

**Residual.** The run-time layer covers only what the tests exercise: the unit tests, and the fuzz tests with 40,000 generated inputs through `validateFormula` and `evaluateFormula`. No coverage figure is claimed. A code-generating path that no test exercises is caught only by the static layers, which are best effort.
- **The example.** `f[k](…)`, where `f` is an ordinary function variable and `k` is assembled at run time from non-literal parts, passes both static layers. Examples of such a `k`: a key harvested with `Object.getOwnPropertyNames`, or built with `String.fromCharCode`, `atob`, `decodeURIComponent` or a reversed string (the reviewer's Q1–Q5).
- **Where it is refused.** Such a form fails the tests only on a path a test exercises. Wherever it sits in the closure, an exercised one fails every test that reaches it, through the `EvalError` rethrow.
  - **Its own handler.** It cannot handle its own refusal. A catch that does not rethrow first, a `finally` that returns, throws, breaks or continues, and a promise reaction (`.then`, `.catch`, `.finally`, `async`/`await`) are refused by lint and the scan (round 5; the reviewer's W1, W2 and W4).
  - **A converting catch.** A catch that wraps or converts the `EvalError` (W5) lacks the required first statement, so lint and the scan now refuse it too. It also stays refused at run time: every `fuzz.test.ts` outcome check and every rejection-table row that reaches it fails, through the internal-failure rule. That rule is now defence in depth, because with the required first statement a catch can convert only errors that are not `EvalError`s.

**Production.**
- **Browser.** The web bundle, which includes this engine, is served by the API through `@fastify/static`. It carries the CSP from `HELMET_OPTIONS` in `apps/api/src/server.ts` (`useDefaults: false`): `script-src 'self'` with no `'unsafe-eval'`. The browser therefore refuses `eval` and string `Function` construction for that document. This was verified on the emitted header (T-DG3-KBE-E evidence). It holds only where the API serves the web bundle; a different web host must send an equivalent CSP.
- **Server.** No run-time flag is set in the API or worker processes, so there the engine relies on the static layers and on its tests.

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
- **(11) Exactness record.** The lineage's `rounding` object is `{column: "numeric(24,6)", scale: 6, mode: "ROUND_HALF_UP", precision: 80, exact, stored, rounded, inexactIntermediate}`. `rounded` reports the single storage rounding. `inexactIntermediate` is true when a division, an inverse period conversion or the 80-digit cap actually rounded an intermediate value, and every operation is re-checked against an unbounded-precision computation to set it. KBE-C stores this object in the `benefit_calculation` lineage as is: in the row's `rounding jsonb` column (migration `0027_p3_calculation_rounding.sql`, T-DG3-ARCH-04), returned as `BenefitCalculation.rounding` (`FormulaRounding`; zod `formulaRounding`) and repeated in the row's `benefit_calculation.create` audit event. See §10 for the column's rules.
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

### 10. The rounding record on the lineage row (T-DG3-ARCH-04, 2026-10-08)

KBE-C first stored only `rounded boolean` on the row and kept the full record in the audit event (KBE-C handback §6 item 2). That did not match §6 item 11. Migration `0027` closes the gap:

- **Column.** `benefit_calculation.rounding jsonb NULL`, `CHECK (rounding IS NULL OR jsonb_typeof(rounding) = 'object')`.
- **Shape bound to the row.** `benefit_calculation_rounding_shape` requires all eight keys and the constants (`numeric(24,6)`, 6, `ROUND_HALF_UP`, 80). It also requires `rounding.rounded = rounded` and `rounding.stored = result::text`, or JSON null when the result is Unknown. The record and the columns therefore cannot disagree.
- **NULL means "written before 0027", and nothing else.** `benefit_calculation_rounding_required CHECK (rounding IS NOT NULL) NOT VALID` is enforced on every new row and does not check the rows that existed before. The API returns `rounding: null` for such a row. The contract allows null for that reason only.
- **No backfill (decision).** A backfill from the audit events is possible, but it is not safe in the sense that matters here, and it is not needed:
  - The table is append-only (trigger). A backfill would have to disable the trigger and rewrite immutable lineage, which is exactly what the table must never allow.
  - No information is lost without one. The record of every pre-0027 row is in its `benefit_calculation.create` audit event, written in the same transaction, and `audit_event` is append-only as well.
  - P3 is unreleased, so no production database has such rows. A fresh database has none.
- **The override marker (FE-C handback §4.3).** In the lineage `inputs`, a value given in the calculation request carries `source` = exactly 'Calculation input (overrides the version value)' (`kpi/calculations.ts` `OVERRIDE_SOURCE`). The contract now documents this as a fixed English marker that clients may match and translate, and the web does so. Replacing it with a separate code field would be a further additive contract change, and it is not made in P3.
- **No single-line GET (FE-C handback §4.4).** The contract has no `GET /business-cases/{id}/lines/{lineId}`. A line is read through its case's list (`listBusinessCaseLines`, unpaged, ADR-0021 §11 item 6), which is also how a client reloads the current values after a 409. This is the contract's intent, and no operation is added.
- **Contract.** The change is additive. `BenefitCalculation` gains the required, nullable `rounding` (`oneOf [FormulaRounding, null]`), and the zod mirror changes with it. No operation is added or removed, so the pinned operation count stays 270.

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
- Rounding record (§10): the integration test `apps/api/test/integration/kpi/benefit-formulas.test.ts` checks that the revenue example's row, POST response and GET list carry `{column, scale, mode, precision, exact: "100000", stored: "100000.000000", rounded: false, inexactIntermediate: false}`. It also checks that an Unknown row carries `exact`/`stored` null, and that the database refuses a new row with the record missing, not an object, missing a key, or disagreeing with `rounded`/`result`. `packages/db/test/integration/catalogue.test.ts` (0027) pins the three CHECKs, including `NOT VALID` on the required one.
