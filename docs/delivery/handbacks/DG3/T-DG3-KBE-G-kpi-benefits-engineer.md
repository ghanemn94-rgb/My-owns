# Handback T-DG3-KBE-G (kpi-benefits-engineer): F-DG3-100 fourth pass

- **Stage:** P3 / DG3, the repair before review round 5. Assignment: `docs/delivery/assignments/DG3/round-5/T-DG3-KBE-G.md` (sha256 `8eb3dd3f…ab12c`, verified).
- **Invocation:** `DG3-T-DG3-KBE-G-kpi-benefits-engineer-20261008T160549Z-37bd45b1`, session `37bd45b1-63cd-4089-8dfb-5385751498d3`.
- **Working tree:** `/home/user/wt/dg3-kbe-g`, branch `dg3/kbe-g`, `HEAD` `a233645` (the round-4 candidate plus the round-4 review records). I verified it before writing.
- **Time:** started `2026-10-08T16:06:00Z`, checks finished `2026-10-08T16:31:50Z` (`date -u`).
- **Changes:** uncommitted, left for the orchestrator to integrate. The evidence is in `docs/delivery/handbacks/DG3/T-DG3-KBE-G-evidence/`.
- **Finding:** F-DG3-100 stays OPEN until a non-author reviewer verifies it. I don't close my own finding.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, both before I started and at the end. Logs: `validate-dg2-historical-start.log` and `validate-dg2-historical-end.log`.

## 1. Changed files

| File | Purpose |
|---|---|
| `eslint.config.js` (formula blocks only) | Adds the round-5 rules for the engine sources and `value.ts`; details below. |
| `packages/shared/src/formula/parse.ts` | Mechanical: the catch gains `if (e instanceof EvalError) throw e;` as its first statement. No behaviour change, because anything that was not a `ParseFailure` was already rethrown. |
| `packages/shared/src/formula/evaluate.ts` | Mechanical: the `evaluateAst` catch moves its existing `EvalError` rethrow ahead of the `EvalFailure` check. `EvalFailure` is a plain class, never an `EvalError`, so the order changes no behaviour. |
| `packages/shared/src/formula/index.ts` | Comment only: the `internalProblem` doc names the five catches and the static enforcement. |
| `packages/shared/src/formula/fuzz.test.ts` | Details below. |
| `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6 | The corrections and the new rule statements. |
| `docs/architecture/p3-work-split.md` §9 | Item 27, under "Amendments in the DG3 round-5 repair". |

**`eslint.config.js`.** The engine-source block now carries these rules:
- `CATCH_RETHROWS_EVAL_ERROR` with a `CatchClause:not(…)` selector. Every catch must bind `e`, and its first statement must be exactly `if (e instanceof EvalError) throw e;`, with a bare `throw` and no `else`.
- `Identifier[name='EvalError']` is allowed only as the right operand of `instanceof`, so no shadowing.
- No `Promise`, `queueMicrotask`, `async` functions, `await`, `for await`, or `.then`/`.catch`/`.finally` members (plain or `["then"]`).
- `no-unsafe-finally`: error.

**`fuzz.test.ts`.**
- **`scanSource()`** mirrors those rules (`CATCH_RETHROW`, `rethrowRuleHits()`, plus `FORBIDDEN` entries "Promise", "async", "await" and ".then/.catch/.finally"). It also flags a `finally` block containing `return`, `throw`, `break` or `continue`.
- **`IMPORT_SPECIFIER`** now follows string-named specifiers (X1).
- **The probe table** gains 21 rows:
  - the reviewer's W1, W2 and W4 helpers verbatim (W4 counted twice: Promise and `.then/.catch`), and W5;
  - 13 other refused spellings;
  - three string-named specifier forms.
- **The clean test** gains the allowed catch shape and a harmless `finally`.
- **The ESLint-config test** now also asserts the new selectors and `no-unsafe-finally` = 2 for every closure file.

`packages/shared/src/value.ts` is **unchanged**: its one catch already had the required shape.

## 2. Behaviour delivered (REQ-PB-056, F-DG3-100 closure criterion (a))

1. **The rethrow rule is enforced statically, in lint, for every file of the engine's import closure.** That means the non-test sources in `formula/` and `value.ts`.
   - **I checked first that the engine is synchronous.** The seven closure files contain no `Promise`, `async`, `await`, `then` or `finally` outside comments, and `decimal.js` 10.6.0 (`decimal.js` and `decimal.mjs`) contains no `try`, `catch`, `finally`, `Promise`, `async`, `await`, `eval(` or `Function(`.
   - **Stdin checks of the shapes** (run at the time, not saved as a log). The correct catch shape lints clean. Each of these is refused:
     - `catch { }`;
     - `catch (err)`;
     - a rethrow followed by `else`;
     - a rethrow inside a block `{ throw e; }`;
     - a rethrow as the second statement;
     - a destructured parameter;
     - `finally { return; }`;
     - `Promise…then…catch`;
     - `async`/`await`;
     - a shadowing `const EvalError`;
     - `x["then"]()`;
     - `queueMicrotask`.

     Separately, `import fs = require("node:fs")` is refused by `no-restricted-imports` and `@typescript-eslint/no-require-imports`.
   - **Why the parameter must be named `e`.** esquery cannot compare two attributes, so a selector can only express the rule with a fixed name. All five existing catches use `e`.
2. **The scan mirrors the rules**, with the reviewer's forms in the probe table.
3. **The closure parser follows string-named specifiers.** These are `export { "x" as y } from`, `import { "x" as y } from` and `export * as "n" from`. ADR §6 now states exactly what the regular expression follows and what it does not, with ESLint as the backstop.
4. **ADR-0024 §6 corrections.** I re-read each statement against the code.
   - **Five catch clauses,** `parse.ts` included. The regression test covers four of them; `parse.ts`'s `try` takes no caller-supplied value, and the ADR now says so.
   - **The web on an `EvalError`.** The app defines no error boundary or `errorElement` (`apps/web/src/app/router.tsx`). `FormulaBuilder.tsx` (`useLiveCheck`, through `useMemo`) and `BenefitFormulasPage.tsx` call `evaluateFormula` while rendering. So React Router 7.9's default error element would replace the page, showing "Unexpected Application Error!", the message and the stack, in English only. This is unreachable in practice.
   - **What the closure parser follows,** as in item 3.
   - **Static enforcement.** §6 now states that lint and the scan enforce the rethrow rule, `no-unsafe-finally` and the synchronous engine.
   - **The guarantee is qualified:** "unless the test itself expects an `EvalError`; only the injection tests do that".
   - **The residual is restated.** Q1–Q5 still apply to unexercised paths only. A self-handling form (W1, W2, W4) is now refused statically. W5 is refused statically and also at run time. The internal-failure rule is now described as defence in depth.
   - **decimal.js.** The note now records that it has no `try`/`catch`/`finally` and no asynchronous code.
5. **Formula results are unchanged.** The unit and fuzz suites pass unchanged, including the exact examples and the 40,000-input fuzz.

## 3. Checks actually run

Logs are in `docs/delivery/handbacks/DG3/T-DG3-KBE-G-evidence/`. Each one starts with the command and environment and ends with `EXIT=<code>`.

### Acceptance 1, static checks

| Command | Environment | Result |
|---|---|---|
| `pnpm -r typecheck` | Node 24.21.0 | EXIT=0 (`typecheck.log`) |
| `pnpm -r build` | Node 24.21.0 | EXIT=0 (`build.log`) |
| `pnpm lint` | Node 24.21.0 | EXIT=0 (`lint.log`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | Node 24.21.0 | "All matched files use Prettier code style!" EXIT=0 (`prettier.log`). Before I wrote this handback. I re-ran it on the handback file afterwards; see §4. |
| `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts` | Node 24.21.0 | EXIT=0 (`eslint-formula.log`) |

### Acceptance 2, `pnpm test`

The runs used `vitest run --project unit-node --project unit-web && vitest run --project unit-formula-nocodegen`. Round-4 baseline: 1593 + 199 passed, 1 skipped.

| Node | Locale | First invocation | Second invocation (`unit-formula-nocodegen`) | Exit | Log |
|---|---|---|---|---|---|
| 24.21.0 | unset | 1614 passed | 220 passed, 1 skipped | 0 | `test-node24-lang-unset.log` |
| 24.21.0 | `C.UTF-8` | 1614 passed | 220 passed, 1 skipped | 0 | `test-node24-lang-c-utf8.log` |
| 22.22.2 | unset | 1614 passed | 220 passed, 1 skipped | 0 | `test-node22-lang-unset.log` |
| 22.22.2 | `C.UTF-8` | 1614 passed | 220 passed, 1 skipped | 0 | `test-node22-lang-c-utf8.log` |

The +21 in each invocation is exactly the 21 new probe rows. No log contains FAIL, retry, flaky or Unhandled.

### Acceptance 3, integration

`QA_PG_PORT=23110 MTH_PORT_POOL=23111-23149 tests/qa/support/with-pg.sh pnpm test:integration` on Node 24.21.0 gave Test Files 56 passed (56), Tests **793 passed (793)**, EXIT=0 (`integration.log`).

### Acceptance 4, per-form tables

**The disposable clone.**
- `git clone` of this worktree to `$TMPDIR/review-p3` (`/var/tmp/mth-run.3QlXXf/claude-0/review-p3`), plus `git apply` of my uncommitted diff.
- Dependencies were installed with `pnpm install --offline --frozen-lockfile --store-dir $TMPDIR/pstore/v10`, from a private copy of the pnpm store. Installing into the shared store failed with EROFS (the sandbox makes it read-only), so I used the copy. Then `pnpm -r build` exited 0.
- The probes are unmodified copies of the reviewer's files, with the sha256 checked and recorded in each log header. They ran on Node 22.22.2. I never ran them in my tree, and I edited none of the reviewer's files.

**`swallow-probe.mjs`** (round 4, sha256 `d9989e67…`), run as `node <copy> $TMPDIR/review-p3 W1 W2 W3 W4 W5 W6`. EXIT=0 (`swallow-probe.log`).

| Form | lint | scan | run-time (flag-only failures) | Refused by | Round 4 |
|---|---|---|---|---|---|
| W1 `try { codegen } catch { }` | 1 (catch-shape selector) | 1 ("catch without EvalError rethrow") | 0 | **lint + scan** | passed all three layers |
| W2 `try { codegen } finally { return; }` | 1 (`no-unsafe-finally`) | 1 ("finally with …") | 0 | **lint + scan** | passed all three layers |
| W3 `Promise.resolve().then(codegen)` | 1 | 1 | unhandled rejection only under the flag | **lint + scan + run-time** | run-time |
| W4 `….then(codegen).catch(() => undefined)` | 1 (async selector) | 1 ("Promise", ".then/.catch/.finally") | 0 | **lint + scan** | passed all three layers |
| W5 `catch (e) { throw new Error("wrapped", { cause: e }) }` | 1 | 1 | 3 | **lint + scan + run-time** | run-time |
| W6 (W5 at evaluation time) | 1 | 1 | 2 | **lint + scan + run-time** | run-time |

This matches the expectation: W1, W2 and W4 are refused by lint and the scan, and W5 is still refused at run time (now also statically).

**A note on reading the log.** The probe's RUN and CTRL columns now exit 1 for every W form. That is because `fuzz.test.ts`'s scan test is part of both test runs and fails on the modified `tokenize.ts`. The log shows that this one scan test is the only failure in both RUN and CTRL for W1, W2 and W4. For a self-handled refusal, 0 flag-only failures is expected: the static layers are what refuse those forms.

**`guard-layers-probe.mjs`** (round 3, sha256 `7887455b…`), run with `S1 S2 S3 V1 V2`. EXIT=0 (`guard-layers-probe.log`).

| Form | lint | scan | run-time only | Refused by |
|---|---|---|---|---|
| V1 (`node:vm` in `value.ts`) | 1 | 1 | 0 | lint + scan |
| V2 (`new Function` in `value.ts`) | 1 | 1 | 61 | lint + scan + run-time |
| S1 | 0 | 0 | 3 | run-time |
| S2 | 0 | 0 | 8 | run-time |
| S3 | 0 | 0 | 2 | run-time |

These are the same verdicts as in the round-4 verification. All are still refused.

**`guard-bypass-probe.mjs`** (round 2, sha256 `934c62b1…`; identical to the round-3 copy). EXIT=0 (`guard-bypass-probe.log`).
- **All 18 forms are refused:** O1–O6 and N1–N12 are all eslint=1 and scan=1, "BLOCKED BY BOTH".
- **The clone path.** The probe requires `review-p2` in its root path, so I ran it through the symlink `$TMPDIR/review-p2 → review-p3`, the same clone. The log header records this.

**X1, the closure parser** (my own check, in the same clone; `x1-closure-parser.log`). `formula/types.ts` gained `export { "weightedScore" as zzX } from "../scoring.ts";`.
- ESLint refuses it, exit 1 (`no-restricted-imports`).
- In vitest (exit 1), three tests now fail on it:
  - the scan reports `non-allowlisted import`;
  - the closure test reports `expected [ 'scoring.ts' ] to deeply equal []`, so the closure now follows the specifier. In round 4 this test passed;
  - the ESLint-config test reports `scoring.ts no-eval: expected undefined to be 2`.
- The file was restored afterwards.

### Acceptance 5, the validator

`node tools/gates/validate.mjs --historical --stage DG2` exited 0, at the start and at the end.

## 4. Known gaps, not done, disclosures

- **The `parse.ts` catch has no run-time regression case.** Its `try` processes only the tokenizer's own token list, so no caller-supplied value can inject an `EvalError` there. Its rethrow is pinned by lint and the scan instead, and ADR §6 says so.
- **The lint rule fixes the catch parameter's name to `e`.** This is a convention imposed by the selector, and it is documented in the ADR and in `eslint.config.js`. A local ESLint rule could allow any name. I judged the selector sufficient, and it is mirrored exactly by the scan.
- **The scan is stricter than lint on `finally`.** It also counts a `return` inside a nested function within a `finally` block. That can only produce false positives, never misses. The engine has no `finally` today.
- **The residuals are unchanged.** A code generation on an **unexercised** path, with a run-time-assembled key (Q1–Q5), is still caught only by the best-effort static layers. The server runs with no `--disallow-code-generation-from-strings`. ADR §6 states both.
- **Sandbox artefacts.** The untracked entries at the worktree root (`.bashrc`, `.idea`, `.mcp.json`, `.zshrc`, `CLAUDE.local.md`, …) are character devices bind-mounted by the sandbox. They are not my files; don't commit them. The `prettier --check --ignore-unknown` run skipped them.
- **`.cc-writes` directories.** I deleted empty `.claude/.cc-writes` directories in source folders before the tests, as instructed.
- **Prettier on the handback.** The prettier check above ran before this handback existed. I then ran `npx prettier --write` on this one file, and `npx prettier --check` on it, which exited 0. That run was in the session but not saved as a log.
- **Non-zero exits.** I reported every one above:
  - the first, EROFS offline install in the clone (with a failed follow-up build), fixed with a private store copy;
  - the probes' expected lint, scan and vitest exit 1s.

  No test failed or was flaky in any acceptance run, and none timed out.

## 5. Merge instructions

- **No migrations, and no API or web contract change.**
- **Integration.** Apply the uncommitted diff (`changes.diff` in the evidence directory is a snapshot taken after all edits) on top of `a233645`. The seven files are listed in §1.
- **Conflicts.** None are expected outside `eslint.config.js`'s formula blocks, `packages/shared/src/formula/**`, ADR-0024 §6 and work-split §9 (item 27).
- **Engineering only.** This approves no business gate (G1–G6), and it is not DG3 approval. The gate needs the round-5 reviews and the audit.
