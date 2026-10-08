# DG3 round 4: code-security-reviewer narrative

- **Candidate:** `sha256:8376d762…fc455` (757 files), source `171a0b57`. Recomputed in a complete clone, and rechecked after other reviewers' evidence commits.
- **Verdict: FAIL.** The only reason is that F-DG3-100 (Low, non-mandatory, REQ-PB-056) does not verify closed.
- **No new finding.** Nothing Critical, High or mandatory is open.

## The full review passes

- **Static checks:** build, typecheck, lint, openapi:lint (270 operations), no-cdn and format all exit 0.
- **`pnpm test`:** both invocations exit 0 on Node 22 and on Node 24: 1593, then 199 passed + 1 skipped by design. Against round 3, no test was removed.
- **Integration:** 793/793 twice, once with the locale unset and SQL_ASCII, once with C.UTF-8 and UTF8. Both runs apply 27 migrations and cover the whole contract.
- **Validators:** `--historical` passes for DG2 and DG1.
- **Probes:**
  - the AUD-403 sweep: 66/66;
  - integrity: 16/16;
  - inherited approval: 5/5;
  - CSP: 1/1;
  - formula fuzz with the exact oracle: 65/65 and 75/75 on both Node versions.
- **Scope:** the repair touches only the formula engine, value.ts, its tests, `eslint.config.js` and the ADR.

## Disclosed failures

The two round-4 API-probe failures in `probes-ABD-CSP-E-*.log` come from revision 1 of my own probe. The harness's contract check refused an undeclared 500 before my assertions ran; no operation declares 500. Revision 2 passes in both environments.

## F-DG3-100

**Both round-3 reasons are fixed:**
- **S1 and S3**, which passed all three layers in round 3, now fail at run time through the `EvalError` rethrow.
- **`value.ts` is guarded:** V1 is refused by lint and by the scan.

Also verified:
- The 18 earlier forms stay refused.
- A wrapped or unhandled `EvalError` is refused.
- At the API, an `EvalError` becomes a generic 500 with no detail, and nothing is written.

**It stays open because ADR-0024 §6's layer-3 guarantee is still not exactly true.** The ADR says the guarantee holds because "every catch in the closure rethrows `EvalError`", but nothing enforces that rule for new code.
- The test: a real code generation is placed on an exercised path and wrapped in a new handler.
- The forms: W1 (an empty `catch`), W2 (`finally { return; }`) and W4 (a Promise `.catch`).
- The result: each passes lint, the scan and the no-codegen run (`swallow-probe.log`).
- W5, the same path with the error rethrown wrapped, is refused. That proves the path is exercised.

**Either of these closes it for me:**
- **(a) Enforce the rule statically:**
  - a CatchClause rule;
  - `no-unsafe-finally`;
  - no Promise, `.then` or `.catch` in engine sources.
- **(b) Narrow the guarantee and state the residual honestly.** The residual is the run-time analogue of Q1–Q5: code that handles its own refusal is invisible to layer 3.

**Three minor statements to correct as well:**
- "four" catches: there are five;
- the web "error boundary": it is React Router's default element;
- the closure parser misses string-named specifiers: ESLint refuses them anyway.
