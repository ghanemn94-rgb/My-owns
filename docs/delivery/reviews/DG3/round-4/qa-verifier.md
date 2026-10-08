# DG3 round 4: qa-verifier, narrative

**Verdict: PASS.** Candidate `sha256:8376d762920591f1348e321dc36aaa806793efe2238af113f903b76b016fc455` (source `171a0b57`, 757 files). No new findings.

I ran everything in two disposable clones under `$TMPDIR`, both removed at the end. The candidate ID recomputes identical at the start, in the clone, and at `--ref HEAD` at the end. I did not read any other reviewer's round-4 record. Every non-zero exit is explained in `docs/delivery/test-evidence/DG3/qa/round-4/RUN-NOTES.md`.

## T-DG3-KBE-F (F-DG3-100 repair) from the acceptance side

- **Static guard on `value.ts`:** I appended 12 forbidden forms to `value.ts`. Lint reported 22 errors and refused every one, including the decimal.js-only import allowlist.
- **EvalError is rethrown.** I injected a run-time code generation separately into each engine catch.
  - The no-codegen invocation fails with EvalError in every case: 73, 24 and 3 failures for `validateFormula`, `evaluateAst` and `formatDecimal`.
  - No "could not be processed" problem appears.
  - The normal process still passes, as ADR-0024 §6 intends.
- **The API keeps its 422 behaviour.** I sent 13 invalid or hostile formulas.
  - 12 of them get 422 with their own code (`formula.syntax` or `formula.undefined_variable`), never 500 and never the "internal" fallback.
  - The empty string gets 400 from the request schema.
  - A create with a syntax error gets 422, and a valid formula still gets 200.
- **`formatDecimal` still returns null (Unknown)** for invalid stored values in en and ar.
- **`pnpm test` runs both Vitest invocations:** 1593 tests, then 199 passed + 1 skipped. The skip is the ESLint-config assertion, which cannot run under the no-codegen flag; it runs and passes in the first invocation.

## F-DG3-180

- **F180** still passes (7 of 7 badges inside) in chromium-en and chromium-ar, in both locale settings.
- **F180b** gives the same result as round 3. 70 of 77 rows pass. The 7 failing rows are the known 390 px + 200% text state, where the 18rem grid scrolls horizontally but the badge stays inside its card. This is an observation about the grid, not a finding.

## Full regression

| Area | Result |
|---|---|
| Static (typecheck, build, lint, openapi 270 ops, no-cdn, format, contrast) | all exit 0 |
| Unit: Node 22/24 × locale unset/C.UTF-8 | 1593 + 200 (1 justified skip), all green |
| Integration, twice | 793/793 each; 27 migrations; pending lists empty |
| e2e product + A20 | 182/182 per setting, identical to round 3 |
| e2e QA literal checks | 166 per project per setting (163 + 3 new), 0 failed |
| Axe | 1392 product analyses, 0 violations; 32 QA axe checks, 0 failed |
| AUD | read-only throughout |
| Validators (register, pipeline, historical DG2/DG1) | all PASS |

**Residuals (not BLOCKED):** live registry, live CI and Keycloak.

All data is synthetic. Product gates G1–G6 are business approvals inside the product, and none of them implies an engineering gate DG0–DG7.
