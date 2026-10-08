# qa-verifier DG3 round 4: run notes (every non-zero exit disclosed)

Candidate `sha256:8376d762920591f1348e321dc36aaa806793efe2238af113f903b76b016fc455` (757 files, source 171a0b57). It recomputes identical in the repo working tree at the start (HEAD fd27c10) and at the end (HEAD 28044a4, `--ref HEAD` too), in the clone at 171a0b5, and at `--ref 171a0b5`. HEAD moved twice during the run (other reviewers' auto-committed evidence). Both moves touched only `docs/delivery/` (0 files outside it). I did not read any other reviewer's round-4 record.

Two disposable, complete clones under `$TMPDIR`, both removed at the end:
- **`review-dg3`** at 171a0b5 ran every suite.
- **`probe-dg3`** at 171a0b5 ran only the throwaway mutation probes, so they could never touch the suite runs.

Install: offline, `--frozen-lockfile`, from a copy of the pnpm store.

## Spec

`docs/delivery/test-evidence/DG3/qa/tests/round-4/e2e/dg3-qa-r4.spec.ts` (sha256 c40c8593…) is a copy of the round-3 spec. It ran as `e2e/dg3-qa-r4.spec.ts` in the clone (identical sha256, see the header of each 04 log) and was never added to the candidate tree.

- **Renames only:** header, results file `dg3-qa-r4-checks-*`, transformation names "R4", screenshot prefix `qa-r4-`.
- **Added:** three recorded checks in A9 for the T-DG3-KBE-F repair, seen from the acceptance side:
  - `A9-R4-invalid-formulas-422-not-internal`: 13 invalid or hostile expressions through `POST /benefit-formulas/validate`. Each must be 422 (400 for the empty string, which the request schema refuses) and must never be the engine's "internal" fallback ("could not be processed").
  - `A9-R4-create-syntax-error-422`.
  - `A9-R4-valid-formula-still-200`.
- **No repair required adapting any existing test.**
- **Line shift:** the F180b assertion moved from line 1768 (round 3) to line 1813 because of the 45 inserted lines.

## Non-zero exits and failures

1. **`01b-guard-static-negative-probe-value-ts.log`, EXIT 1 by design.**
   - In probe-dg3, 12 forbidden forms were appended to `packages/shared/src/value.ts`: `node:fs`, `@mth/shared`, `./transformation.ts`, `globalThis["ev"+"al"]`, `Object.getPrototypeOf`, `["constructor"]`, `Function`, `Reflect.construct`, `process.getBuiltinModule`, `import.meta`, `.constructor`, `eval("1")`.
   - ESLint reported 22 errors, and every line is refused. The 3 imports are refused by the new decimal.js-only allowlist.
   - Restored: lint EXIT 0, `git status` clean.
2. **`01c-guard-runtime-mutation-probe.log`, non-zero steps by design.** Three separate mutations inject a string code generation, through a key assembled at run time, into each catch path of the engine's closure:
   - **M1**, inside `validateFormula`'s try: unit-formula-nocodegen EXIT 1, 73 failed / 126 passed / 1 skipped.
   - **M2**, inside `evaluateAst`'s walk: EXIT 1, 24 failed.
   - **M3**, inside `value.ts` `formatDecimal`'s try: EXIT 1, 3 failed.
   - The failures carry "EvalError: Code generation from strings disallowed". No "could not be processed" problem appears, so EvalError is no longer converted (the round-3 code-security defect). The same mutations pass in a normal unit-node process (219/219), as ADR-0024 §6 intends.
   - Each file was restored. The no-codegen project is back to EXIT 0 (199 passed + 1 skipped).
3. **The 1 skipped test** in every unit-formula-nocodegen run is `fuzz.test.ts` "every file of the engine's import closure gets the engine-source lint rules". It is `it.skipIf(NOCODEGEN)` by design: ESLint's ajv uses `new Function`, so ESLint cannot run under the flag. It runs and passes in unit-node in the same `pnpm test`.
4. **`04-e2e-unset.log` and `04-e2e-cutf8.log`, EXIT 1 each: 216 passed, 2 failed, 0 skipped, 0 flaky.**
   - The 2 failures are my F180b probe in chromium-en and chromium-ar. The single failing assertion is line 1813, `expect(bad).toEqual([])`.
   - In each project and setting, exactly 7 of 77 rows fail, all in the one state 390 px + 200% root text (32 px).
   - In those rows the badge is inside its card or field, is not clipped and overlaps nothing. However, the pre-existing gate grid (`minmax(18rem, 1fr)`, unchanged since DG2) makes the document wider than the viewport (scrollWidth 505 or 633 > 390). The clause is therefore partly right of the viewport and reachable by scrolling.
   - This is identical to round 3: about 195 CSS px of effective width, below WCAG 1.4.10's 320 px reflow requirement. It is an observation about the grid, not a residual of F-DG3-180, and not a finding.
   - All 70 other rows pass every criterion.

## Notable lines in passing logs

- Integration logs:
  - `BE17 db-econnreset … status 500` is stdout of a passing deliberate-negative test.
  - `BE17 R6*/R8` and `BE18 Q7 idp_unavailable` are stdout of passing tests.
  - `npm warn Unknown project config` lines are npm advisories about pnpm keys in .npmrc.
- Build: Vite's advisory about chunks larger than 500 kB.
- Contrast: the three "fails" lines are the documented prohibited pairs, asserted to fail.
- Unit logs: every other error/fail match is the name of a passing test.
- e2e logs: the only "Error" lines belong to the F180b failures above.

## Locale

`locale -a`: C, C.utf8, POSIX. Unit and e2e ran with LANG/LC_ALL unset and with C.UTF-8. ar_SA is not installed.
