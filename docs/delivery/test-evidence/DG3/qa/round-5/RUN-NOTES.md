# qa-verifier DG3 round 5: run notes (every non-zero exit disclosed)

Candidate `sha256:dfedd62f05412fd7888b7d13d2391c6ab5df7d56563ab946502e53c558689ed3` (757 files, source 21e2742). It recomputes identical in the repo working tree at the start (HEAD 40c84e8) and at the end (HEAD 40b422e, also `--ref HEAD`), at `--ref 21e2742`, and in the clone at 21e2742. HEAD moved during the run (other reviewers' auto-committed evidence and an orchestrator assignment commit). Every move touched only `docs/delivery/` (0 files outside it). I did not read any other reviewer's round-5 record or evidence, nor the new orchestrator assignment.

Two disposable, complete clones under `$TMPDIR`, both removed at the end:
- **`review-dg3`** at 21e2742 ran every suite.
- **`probe-dg3`** at 21e2742 ran only the throwaway mutation probes, so they could never touch the suite runs.

Install: offline, `--frozen-lockfile`, from a copy of the pnpm store.

## Spec

`docs/delivery/test-evidence/DG3/qa/tests/round-5/e2e/dg3-qa-r5.spec.ts` (sha256 f3c1ef96…) is a copy of the round-4 spec (itself the round-3 spec plus the A9-R4 checks). It ran as `e2e/dg3-qa-r5.spec.ts` in the clone (identical sha256, see the header of each 04 log) and was removed from the clone afterwards; it was never part of the candidate tree.

- **Renames only (6 lines):** header, results file `dg3-qa-r5-checks-*`, synthetic transformation names "R5", screenshot prefix `qa-r5-`. Line numbers are unchanged (the F180b assertion is still line 1813).
- **No repair required adapting any test.** The round-5 repair (T-DG3-KBE-G) changes only lint/scan rules, the order of two statements in the `evaluateAst` catch, and one added first statement in the `parseFormula` catch. It changes no API or UI behaviour, and the A9-R4 checks already cover the formula API.
- **Path.** The assignment says to copy the specs into `tests/round-3/`. That directory holds my round-3 evidence, which is write-once, so the copy is in `tests/round-5/` (as round 4 used `tests/round-4/`).

## Non-zero exits and failures

1. **`01b-rethrow-rule-static-negative-probe.log`, EXIT 1 by design (lint and scan).**
   - In probe-dg3, 17 forbidden handler forms plus one allowed shape were appended to `packages/shared/src/formula/parse.ts`, and separately to `packages/shared/src/value.ts`. The forms are W1 `catch {}`, W2 `finally { return }`, W4 `Promise…then…catch`, W5 a wrapping catch, a differently named parameter, `else`, a statement before the rethrow, a rethrow of another class, `finally { break }`, `finally { throw }`, a shadowing `const EvalError`, `async`/`await`, `queueMicrotask`, `["then"]`/`?.catch`/`.finally`, an async arrow, a braced rethrow and a negated rethrow.
   - ESLint reports 26 errors per file, covering every one of the 17 forms (17 distinct lines per file: 254-270 in parse.ts, 299-315 in value.ts), and none on the allowed shape. The source scan test fails with exactly the hits `Promise`, `async`, `await`, `.then/.catch/.finally`, `catch without EvalError rethrow`, `finally with return/throw/break/continue` and `EvalError outside instanceof`.
   - Three **edge forms** outside the documented denylist pass both static layers (lint EXIT 0, scan passes). They are a finally that calls a throwing helper, `using` with a throwing `[Symbol.dispose]`, and a generator finally. That is consistent with ADR-0024 §6 ("best-effort denylist … not complete"). For what happens at run time, see item 2.
   - Restored: git status clean; `eslint packages/shared/src/formula packages/shared/src/value.ts` EXIT 0.
2. **`01c-rethrow-runtime-mutation-probe.log` and `01c2-rethrow-runtime-edge-probe.log`, non-zero steps by design.**
   - **M1-M4** inject a real string code generation (a Function-constructor key assembled at run time) into the try of each of the four catch sites: `validateFormula`, the `evaluateAst` walk, `formatDecimal` and `parseFormula` (new this round). unit-formula-nocodegen fails with EvalError in each: 73, 24, 4 and 103 failed tests. There are 0 'could not be processed' lines. The normal unit-node process passes each mutation (EXIT 0).
   - **The first `01c` log's E1-E4 section is inconclusive, and superseded.** Its thrower fired unconditionally, so the normal process failed too: 22, 7, 70 and 100 failed tests. It is kept for honesty. `01c2` repeats E1-E4 with a finally (or `using` dispose) that throws only while an exception is in flight.
   - **The 01c2 results.** The normal process passes 240/240 in each case. unit-formula-nocodegen fails in each: E1 24, E2 5, E3 73 and E4 104 failed. The replaced EvalError surfaces as an `internal` problem (SuppressedError or RangeError), a null display or a missing EvalError, and the internal-failure rule and outcome assertions refuse each of these.
   - **What this shows.** The edge forms the static layers miss are still refused at run time on exercised paths, as ADR-0024 §6 layer 3 describes. This is an observation, not a finding.
   - All files were restored. git status is clean, and nocodegen EXIT 0 (220 passed, 1 skipped).
3. **The 1 skipped test** in every unit-formula-nocodegen run is `fuzz.test.ts:457` `it.skipIf(NOCODEGEN)`, the ESLint-config assertion. ESLint's ajv needs `new Function`. It runs and passes in invocation 1 of the same `pnpm test`.
4. **`04-e2e-unset.log` and `04-e2e-cutf8.log`, EXIT 1 each: 216 passed, 2 failed, 0 skipped, 0 flaky.**
   - The 2 failures are my F180b probe in chromium-en and chromium-ar. The single failing assertion is line 1813, `expect(bad).toEqual([])`.
   - In each project and setting, exactly 7 of 77 rows fail, all in the one state 390 px + 200% root text (32 px). In those rows inside=true and notClipped=true, with 0 overlaps.
   - The pre-existing gate grid (`minmax(18rem, 1fr)`, unchanged since DG2) makes the document 505 or 633 px wide for a 390 px viewport. The clause is therefore partly right of the viewport and reachable by scrolling, which is about 195 CSS px of effective width, below WCAG 1.4.10's 320 px.
   - This is identical to rounds 3 and 4. It is an observation about the grid, not a residual of F-DG3-180, and not a finding. The round-5 repair touches no web code.
   - All 70 other rows pass every criterion.

## Notable lines in passing logs

- **Integration:** `BE17 db-econnreset … status 500` is stdout of a passing deliberate-negative test. `BE17 R6*/R8`, `BE18 Q7 idp_unavailable` and the `stdout |` lines for R6a-R6e are stdout of passing tests. The `npm warn Unknown project config` lines are npm advisories about pnpm keys in .npmrc.
- **Build:** Vite's advisory about chunks larger than 500 kB.
- **Contrast:** the three "fails" lines are the documented prohibited pairs, asserted to fail.
- **Install:** 2 WARN lines, "Failed to create bin … mth-db", because packages/db/dist did not exist before the build. The harness runs `node packages/db/dist/cli.js` after the build.
- **Unit logs:** every "×" match is a test name ("ARPU × annual customers", "role × month").
- **e2e logs:** the only "Error" lines belong to the F180b failures above. The api.log tail is empty (LOG_LEVEL=warn).
- **Clone candidate at the end:** 758 files / 8a8aa373… while my untracked spec copy sat in `e2e/` (a manifest path). After removing it: dfedd62f…, 757 files.

## Locale

`locale -a`: C, C.utf8, POSIX. Unit and e2e ran with LANG/LC_ALL unset and with C.UTF-8. ar_SA is not installed.

## Screenshots

As in round 4, only the C.UTF-8 run's screenshots (62 files, `screens/cutf8/{en,ar}/`) are kept, to limit repository size. The unset run produced the same set of captures (not kept); its JSON results (`results/e2e-unset-*`, `results/axe-e2e-unset/`) are kept in full.
