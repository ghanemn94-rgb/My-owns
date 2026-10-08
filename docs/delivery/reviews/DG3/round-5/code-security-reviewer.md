# DG3 round 5: code-security-reviewer narrative

- **Candidate:** `sha256:dfedd62f…689ed3` (757 files), source `21e2742e`. I recomputed it in a complete clone, and again in the repository after other reviewers' evidence commits.
- **Verdict: FAIL.** The only reason is that F-DG3-100 (Low, non-mandatory, REQ-PB-056) does not verify closed.
- **No new finding.** Nothing Critical, High or mandatory is open.

## The full review passes

- **Static checks:** build, typecheck, lint, openapi:lint (270 operations), no-cdn and format all exit 0.
- **`pnpm test`:** both invocations exit 0 on Node 22 and on Node 24: 1614, then 220 passed + 1 skipped by design.
  - Against round 4, the only change is +21 rows in `fuzz.test.ts`, in each project. No test was removed.
- **Integration:** 793/793 twice, once with the locale unset and SQL_ASCII, once with C.UTF-8 and UTF8. Both runs apply 27 migrations and cover the whole contract.
- **Validators:** `--historical` passes for DG2 and DG1.
- **Probes:**
  - the AUD-403 sweep: 66/66;
  - integrity: 16/16;
  - inherited approval: 5/5;
  - CSP: 1/1;
  - API EvalError: 2/2;
  - formula fuzz with the exact oracle: 65/65 and 75/75 on both Node versions, the same as round 4.
- **Scope:** the repair touches only `eslint.config.js`, three engine files (two code-neutral rethrow changes and one comment), `fuzz.test.ts` and the docs. No API, web, db, contract, CI or dependency file changed.
- **Acceptance:** all 16 requirements have passing evidence in both integration runs.

## F-DG3-100

**What is fixed:**
- W1, W2 and W4 are now refused by lint and the scan. In round 4 they passed every layer.
- Every earlier form stays refused: W3/W5/W6, S1–S3, V1/V2, and the 18 round-2 forms.
- The catch-shape rule holds against:
  - renaming and destructuring;
  - code before the guard;
  - a block or `else`;
  - shadowing `EvalError`;
  - a later `var e`;
  - an `Error[Symbol.hasInstance]` hijack, which is refused at run time because it breaks the canary.
- Event listeners (`EventTarget`, `AbortSignal.onabort`) are refused at run time as unhandled errors.

**Why it stays open.** ADR-0024 §6 now says that exercised code "cannot handle its own refusal", and that "the exception reaches the test on the exercising test's call stack". Three plain forms on the exercised S1 path pass lint, the scan and the no-codegen run:

| Form | Code | Lint | Scan | No-codegen run |
|---|---|---|---|---|
| G1 | `function* g(){ try { codegen } finally { yield 0; } }`, then `g().next()` | 0 | 0 | 220 passed, exit 0 |
| G2 | as G1, then `it.return(0)` | 0 | 0 | 220 passed, exit 0 |
| A1 | `const { then: t } = Array.fromAsync([0])`, then a code-generating reaction and a second `t.call(d, undefined, () => undefined)` | 0 | 0 | 220 passed, exit 0 |

- **Controls:** G3, A2 and S2 are refused at run time, which proves the path is exercised.
- **In production** the generated code runs (`generator-swallow-demo.log`).
- **Minor:** the scan's `finally` check misses a `"}"` inside a string (F1). Lint refuses that case.

**Closure (final).** Narrow the three absolute statements to the enumerated handler forms. Then state, as a residual like Q1–Q5, that a self-handling form outside them is refused by no layer even on an exercised path, citing G1, G2 and A1 as examples. Refusing generators and a destructured `then` statically is welcome but optional.
