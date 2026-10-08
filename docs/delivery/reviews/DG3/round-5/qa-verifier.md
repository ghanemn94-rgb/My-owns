# DG3 round 5: qa-verifier narrative

**Verdict: PASS. No new findings.**

- **Candidate:** `sha256:dfedd62f05412fd7888b7d13d2391c6ab5df7d56563ab946502e53c558689ed3`, 757 files, source `21e2742`.
- **Record:** `qa-verifier.json`. Every non-zero exit is explained in `docs/delivery/test-evidence/DG3/qa/round-5/RUN-NOTES.md`.

## Independence

- I authored no product code. I wrote only my spec copy (outside the candidate), evidence and this record.
- I did not open any other reviewer's round-5 record or evidence. I also did not open the orchestrator commit that appeared during my run (`40b422e`, an assignment under `docs/delivery/`).
- I ran everything in two disposable clones of `21e2742` under `$TMPDIR`, and removed both.

## The round-5 repair (T-DG3-KBE-G), from the acceptance side

**Static rule (lint and scan).** In a throwaway clone I appended 17 forbidden handler forms to `parse.ts`, and separately to `value.ts`:
- W1 `catch {}`;
- W2 `finally { return }`;
- W4 `Promise…then…catch`;
- W5, a wrapping catch;
- a different parameter name;
- `else`;
- a statement before the rethrow;
- a rethrow of another class;
- `finally { break }` and `finally { throw }`;
- a shadowing `EvalError`;
- `async`/`await`;
- `queueMicrotask`;
- `["then"]`, `?.catch` and `.finally`;
- a braced rethrow;
- a negated rethrow.

The results:
- ESLint flags every one of the 17 forms (26 errors on 17 lines per file) and leaves the allowed shape alone.
- The scan test fails with the matching hit names.
- After the restore, lint is clean.

**Run-time rule.** I injected a real string code generation into the `try` of each catch site: `validateFormula`, `evaluateAst`, `formatDecimal`, and `parseFormula` (new this round). In every case `unit-formula-nocodegen` fails with `EvalError`, and no "could not be processed" problem appears. The normal process passes.

**Edge observation (not a finding).** Three forms are outside the documented denylist:
- a `finally` that calls a helper which throws while an exception is in flight;
- `using` with a throwing dispose;
- a generator `finally`.

These forms pass lint and the scan. ADR-0024 §6 explicitly describes those layers as best effort. With the forms injected around a real code generation, the no-codegen invocation still fails: 24, 5, 73 and 104 failed tests. The replaced error ends up as an `internal` problem (or a null display), and the internal-failure rule and the outcome assertions refuse it. So the documented defence in depth holds.

My first edge attempt is inconclusive and was repeated. Its thrower fired unconditionally, so it also failed the normal process. It is kept in `01c-…log`, and RUN-NOTES discloses it.

**Unchanged behaviour:**
- **The formula API.** Thirteen invalid or hostile expressions return 422 with their own code; the empty string returns 400 from the request schema. There is never a 500 and never `internal`. A valid formula still returns 200.
- **`formatDecimal`.** It still returns null (shown as Unknown) for every invalid stored value.
- **`pnpm test`.** It runs both Vitest invocations: 1614 tests, then 220 passed plus 1 justified skip. This holds on Node 22 and 24, with the locale unset and with C.UTF-8.

## Full regression

- **Static checks:** all 7 exit 0, with 270 OpenAPI operations.
- **Integration:** 793/793, twice, each on a fresh PostgreSQL with all 27 migrations. Every pending list is empty.
- **e2e:** run on the real stack in chromium-en and chromium-ar, with both locale settings. The results are identical to round 4, spec by spec:
  - 216 passed per setting;
  - the same 2 F180b failures, which are an observation about the pre-existing grid at 390 px with 200% text;
  - 0 axe violations;
  - 166 of 166 recorded acceptance checks pass per project;
  - the AUD read-only pass is green.
- **F180:** 7 of 7 badges are inside their card or field, so F-DG3-180 still holds. As instructed, I wrote no verifications file.
- **Validators:** register, pipeline, and historical DG2 and DG1 all pass, both at the start and at the end.

## Deviation from the assignment text

The assignment says to copy the specs into `tests/round-3/`. That directory is my write-once round-3 evidence, so the copy is in `tests/round-5/e2e/dg3-qa-r5.spec.ts`, matching round 4's practice. The only changes are 6 renamed lines.

## Residuals (environmental, not product results)

These were checked on the offline or configuration surface only:
- the live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

Product gates G1–G6 are business approvals inside the product. They never imply DG0–DG7. Every approval in my tests is synthetic.
