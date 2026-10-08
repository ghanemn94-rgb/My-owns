# DG3 round 6: code-security-reviewer narrative

- **Candidate:** `sha256:7049d793…1c3c96` (757 files), source `c40232b`, freeze commit `36411df`.
  - Recomputed in a complete clone.
  - Recomputed in the repository at the start, and again after the domain reviewer's auto-committed evidence (`e67183c`, `74c703c`). I did not open that evidence.
- **Verdict: PASS.**
  - F-DG3-100 verifies CLOSED.
  - One new finding, F-DG3-280. It is Low, non-mandatory and non-blocking.
  - Nothing Critical, High or mandatory is open.

## F-DG3-100: final criterion met, both options

**(b) The wording.** ADR-0024 §6 no longer contains these three statements:
- "It cannot handle its own refusal";
- "So the exception reaches the test…";
- "This closes a promise reaction…".

What replaced them:
- Lint "refuses exactly" the enumerated forms L1–L7, and the scan's mirror is enumerated item by item.
- "What it refuses" is conditional.
- The residual is stated in my wording, with G1, G2 and A1 as examples.

**(a) Static refusal.** My earlier probes, run verbatim in a disposable clone:

| Form | Round 5 | Round 6 |
|---|---|---|
| G1 (generator `finally { yield }`) | passed all layers | **lint + scan** |
| G2 (G1 + `it.return(0)`) | passed all layers | **lint + scan** |
| A1 (`Array.fromAsync`, destructured `then`) | passed all layers | **lint + scan** |
| F1 (`finally { const s = "}"; return; }`) | lint | **lint + scan** |
| G3, A2, W3, W5, W6, V2 | ≥ 1 static + run time | unchanged |
| E1, E2, H2, H4, S2, S1–S3 (round 3) | run time | unchanged |
| W1, W2, W4, V1, O1–O6, N1–N12 | lint + scan | unchanged |

**Independent checks:**
- **My own spellings.** I wrote 53 L1–L7 spellings. Lint refuses all 53 and allows the engine's shapes.
  - The scan catches 52. The miss is `private *g() {}`, which is consistent with the scan's L4 description in §6. Lint refuses it, and the scan refuses `yield` anywhere.
- **The candidate's own lint test, widened.** I widened its lint test to every lintable probe row (97 rows). It passes.
- **Word claims.** An AST walk confirms the claims about decimal.js and the engine sources: 5 catches and no `finally` block.
- **The residual is real.** A3 is A1 with run-time-assembled `fromAsync`/`then` keys. It passes every layer, which is exactly the stated residual. Its control, A4, is refused at run time.

**The engine is unchanged.**
- Probe C gives 65/65 and 75/75 on Node 22 and Node 24.
- No engine, API, web, db or contract file changed.

## New finding F-DG3-280 (Low)

§6 line 126 says that `fuzz.test.ts` lints "the probe-table spellings below" with `ESLint.lintText`. Its filter selects 48 of the 99 rows. The rows it skips include the L5 `async`/`await` rows and the L2 `EvalError` row.

- **Behaviour:** true. Lint refuses all of these rows.
- **The defect:** the test's scope is overstated in the ADR.
- **Fix:** either filter out only the two "unbalanced" rows (with that filter the test passes today), or name the subset in the sentence.

## Full review

- **Static checks:** build, typecheck, lint, openapi (270 operations), no-cdn and format all exit 0.
- **`pnpm test`:** both invocations exit 0 on Node 22 and on Node 24.
  - Counts: 1651, then 256 passed + 2 skipped. The skips are the two ESLint tests under the no-codegen flag, by design.
  - The only change from round 5 is `fuzz.test.ts`.
- **Integration:** 793/793 twice, once with the locale unset (SQL_ASCII) and once with C.UTF-8 (UTF8). Both runs include the contract and migrations 0001→0027.
- **Validators:** `--historical` passes for DG2 and DG1.
- **Probes, twice:**
  - the AUD-403 sweep: 66/66;
  - integrity: 16/16;
  - inheritedApproval: 5/5;
  - CSP: 1/1;
  - API EvalError: 2/2.
- **P3 surface:** the counts are identical to round 5. The lock registry, migrations, the contract and the p3-pending lists are unchanged.
- **Acceptance:** all 16 requirements have passing evidence.
- **Environmental residuals:** the live registry, live CI and Keycloak pass on their offline surface.

## Disclosures

These are explained in the record:
- the Vite chunk-size advisory;
- the pre-build `mth-db` bin WARN;
- the BE17 ECONNRESET diagnostic from a passing test;
- `×` characters in passing test names;
- the NUL byte in an injection test name;
- the probes' by-design non-zero sub-exits;
- my discarded word-claims revision 1 (a scanner bug);
- the premature first env-residuals run;
- the one by-design scan miss in my spelling run (exit 1).
