# Assignment T-DG3-KBE-A: P3 shared calculation code: T06 scoring and the T09 restricted formula engine (kpi-benefits-engineer)

## Stage and base

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Working tree:** a **separate git worktree** created for you by the orchestrator. It is your current working directory (the runner's `--cwd`) and contains the same `HEAD` as `claude/mobily-transformation-platform-regate`. Work only there.
- **Concurrency (D-004):** you run **in parallel with BE-A**, which works in the main tree and owns everything in the "BE-A Owns" paragraph of `docs/architecture/p3-work-split.md`. That includes `packages/shared/src/schemas/portfolio.ts` and `schemas/index.ts`. Do not touch those files.
- **Preceding gate:** DG2 is APPROVED. Run `node tools/gates/validate.mjs --historical --stage DG2` in your tree first and report the result; it must exit 0.

## Time

Your run has a hard limit of about 2 hours. Run `date -u` at the start. Work in this order:

1. `scoring.ts` and its tests (small);
2. the formula engine: tokenizer, parser, type checker, evaluator, then the tests;
3. the ESLint override;
4. the exports.

If you pass about 100 minutes, finish the current file, make the tree typecheck, and write the handback listing what remains.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Node 22.22.2 is the floor.
- Run offline. `node_modules` is installed in your worktree. Do not run `playwright install`.
- **Your harness ports:** 23150–23199 only, if you need any.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, delivery records and `trading_agent/`.

## Binding design (read first)

- **`docs/architecture/p3-work-split.md`:** §1 (frozen files) and §3 "KBE-A". Your file ownership is exactly:
  - `packages/shared/src/scoring.ts` and `scoring.test.ts`;
  - `packages/shared/src/formula/**`, including its tests;
  - the export lines for both in `packages/shared/src/index.ts` (the only edit to that file);
  - the ESLint override block for `packages/shared/src/formula/**` in `eslint.config.js` (the only edit to that file).
- **ADR-0022 §1–§3:** weight sets; `weightedScore(scores, weights)` = Σ(score × weight)/100 in decimal.js only; exact `numeric(7,4)`; the display rule (2 digits, ROUND_HALF_UP); 'incomplete' with `missingCriteria`; the 0–100 view `(weighted − 1) / 4 × 100` with its label; the 100% total check.
- **ADR-0024 §6:** the package, the "no dynamic code" rule, the grammar (EBNF) and its limits, the typed variable kinds (fraction, fraction_delta, percent_change, count, currency, quantity, number), the type rules with their exact problem codes and English texts, period alignment and `to_period`, the currency rule, evaluation (decimal.js clone, precision 80, ROUND_HALF_UP, rounded once at storage to `numeric(24,6)`), division by zero → Unknown, `missing_input`, `result_out_of_range`, and the two seeded examples.
- **`packages/shared/src/value.ts`** is DG2-approved and frozen. Reuse its decimal helpers (e.g. `formatDecimal`); do not edit it.
- No new dependency: decimal.js 10.6.0 is already pinned in `@mth/shared`.

## Scope

1. **`scoring.ts`.**
   - Write pure functions with typed inputs and outputs, using decimal strings across the boundary and decimal.js inside.
   - Validate a weight set: the total is exactly 100, so 95 and 105 are rejected; each weight is ≥ 0 with at most 2 fraction digits; the criterion codes are known. Return machine codes that match ADR-0022, e.g. `prioritization.weights_total`.
   - `weightedScore(scores, weights)` returns `{ completeness, weightedScore, missingCriteria }`.
   - Display helpers: `weightedScoreDisplay` (2 digits) and `display100` (with the conversion string).
   - **Tests** (deterministic, explicit timeouts):
     - 5,4,3,2,1 under 25/25/20/15/15 → `3.3000` stored and `3.30` displayed;
     - 0–100 of 3.30 → `57.5`;
     - 95/105 rejected;
     - v2 with `risk_compliance` 10 and strategic fit 15 accepted;
     - a missing score → incomplete with `weightedScore` null;
     - scores 0, 6 and 2.5 rejected;
     - a property test over all 5^5 integer score combinations under v1 that compares with exact rational arithmetic computed independently in BigInt.
2. **`formula/`.** Write `tokenize.ts`, `parse.ts`, `typecheck.ts`, `evaluate.ts` and `index.ts`, exactly per ADR-0024 §6.
   - A hand-written tokenizer and recursive-descent parser, and an AST walker.
   - `eval`, `new Function`, `Function(...)`, `vm`/`node:vm`, `setTimeout(string)`, dynamic `import()` and `with` are all **forbidden**.
   - Report parse errors as `formula.syntax` with a character offset.
   - Enforce the limits: 2000 characters, 200 nodes, depth 32, 30 variables.
   - Return the type-rule errors with their exact codes and English texts. In particular:
     - `formula.undefined_variable` ('Undefined variable: {name}');
     - `formula.period_mismatch` with the ADR's exact message;
     - `formula.kind_mismatch`, `formula.currency_product`, `formula.currency_mismatch`.
   - Implement `to_period`, `min`, `max` and `abs`.
   - Evaluation errors: `formula.division_by_zero` and `formula.missing_input` (the result is null, i.e. Unknown) and `formula.result_out_of_range`.
   - Export an `ENGINE_VERSION` constant. Export the API so that the `kpi` module (KBE-C) and the web preview (FE-C) call the same code: `validateFormula(expression, variables)` → `{ ok, ast, resultType } | { ok: false, errors[] }` and `evaluateFormula(...)` → `{ result | null, resultType, errorCode?, rounding }`.
   - **Tests:**
     - a grammar table of accepted and rejected inputs, including `**`, `;`, quotes, newlines, unknown functions and exponents;
     - undefined variable;
     - monthly ARPU × annual population → `period_mismatch`; then `to_period(arpu, year)` is accepted, and `to_period` with an inverse (division) conversion is tested too;
     - division by zero → Unknown;
     - the revenue example 0.12 − 0.10 = 0.02 × 100000 × 50 SAR → exactly `100000` SAR per year;
     - the cost example 200000 × (12.50 − 10.00) → exactly `500000.00` SAR;
     - fraction vs fraction_delta display (0.02 → "2 pp");
     - each limit;
     - a fuzz test that random byte strings never throw an uncaught exception and never evaluate code.
3. **ESLint override** for `packages/shared/src/formula/**`: `no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-imports` for `vm` and `node:vm`, and `no-restricted-syntax` for `ImportExpression`. Prove it works by linting a temporary probe file containing `eval("1")` under that path (it must fail), then delete the probe. Keep the lint log.
4. **Exports** from `packages/shared/src/index.ts` (export lines only).

## Rules (binding)

- Decimal only. A JavaScript `number` never holds a money, score, weight or formula value; integers used as counts or limits are fine.
- Unknown is never 0. Codes, not English text, are what the API and web translate.
- Unit tests are deterministic with explicit timeouts, and pass with the locale unset and with `C.UTF-8`.
- Do not change `value.ts`, the contract, migrations or anything outside your ownership list. If you need such a change, raise it in the handback.

## Acceptance (your self-check, with real output in the handback)

1. In your worktree, all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`, including the eval probe failing as intended, then removed
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
2. `pnpm test` passes with `env -u LANG -u LC_ALL -u LC_CTYPE` and with `LANG=C.UTF-8 LC_ALL=C.UTF-8`. Report the counts and your new test counts.
3. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-A-kpi-benefits-engineer.md` in your worktree, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-A-evidence/`. Include:

- the start and end `date -u`;
- the files changed;
- the public API of `scoring.ts` and `formula/` (signatures) for BE-D, KBE-C and FE-B/FE-C;
- the checks with exit codes;
- anything left undone.
