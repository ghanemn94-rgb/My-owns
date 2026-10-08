# qa-verifier DG3 round 6: run notes (every non-zero exit disclosed)

Candidate `sha256:7049d793cd20ed7718e84ff4aa3bf940f99b5e2507e964660ef3b3545c1f3c96` (757 files, source c40232b). It recomputes identically:
- in the repo working tree at the start (HEAD 36411df);
- at `--ref c40232b` and `--ref HEAD` at the end (HEAD 00cb9fa);
- in both clones.

HEAD moved during the run with 0 files changed outside `docs/delivery/`. I did not read any other reviewer's round-6 record or evidence.

## Clones and install

Two disposable, complete (non-shallow) clones at c40232b, both removed at the end:
- **`review-dg3`** ran every suite.
- **`probe-dg3`** ran only the throwaway mutation probes.

The install was offline, `--frozen-lockfile`, from a copy of the pnpm store.

## Spec

`docs/delivery/test-evidence/DG3/qa/tests/round-6/e2e/dg3-qa-r6.spec.ts` (sha256 710787b0…) is a copy of the round-5 spec.

- **Renames only, 6 lines:** the header, the results file `dg3-qa-r6-checks-*`, the synthetic names "R6" and the screenshot prefix `qa-r6-`. Line numbers are unchanged; the F180b assertion is still line 1813.
- **How it ran:** as `e2e/dg3-qa-r6.spec.ts` in the clone, then removed. It was never part of the candidate.
- **No repair required adapting a test.** T-DG3-KBE-H changes only `eslint.config.js`, `fuzz.test.ts` and documentation. The engine source diff since round 5 is 0 lines, and `apps/web`, `packages/db` and the ERD have no diff either.
- **Path:** the copy is in `tests/round-6/`, because `tests/round-3/` holds my write-once round-3 evidence. Round 5 did the same with `tests/round-5/`.

## Non-zero exits and failures

### 1. `02-unit-node24-unset.log`, EXIT 1: a load-sensitive DG2 timing flake, rerun green

The failing test is `apps/web/src/auth/session-identity.test.tsx` › "F-DG2-500 sign-out here and 403 (en) › signing out here clears everything; B signing in afterwards never sees A's records". It failed at line 295: `findByText('No transformations yet')` timed out after 5811 ms. The host's load average was about 13–14 on 4 vCPU, observed with `uptime` during the run; the other reviewers' runs were sharing the host.

- **No leak.** The assertion just before it (line 293, A's secret absent) passed. The DOM dump shows B's own home page with the list not yet rendered, so no data of A leaked.
- **Unchanged since DG2.** The file was last changed in DG2 (29da00d), and `apps/web` has 0 diff lines since round 5.
- **Second invocation.** `pnpm test` chains its invocations with `&&`, so in this configuration the no-codegen invocation did not run.
- **Rerun of the same configuration** (`02-unit-node24-unset-rerun.log`): EXIT 0, with 1651/1651 and then 256 passed + 2 skipped.
- **File alone** (`02b-session-identity-repeat.log`): 8 repeats of 18/18 passed.
- **Same as before.** The same test failed the same way in my round 3 (node22 unset) and in other DG3 evidence (code-security round 3, KBE-E, KBE-F handbacks).
- **Classification.** A load-sensitive timing flake of a DG2 test: disclosed, not a DG3 defect, not a finding.

### 2. `01b-r6-rule-static-negative-probe.log`, EXIT 1 by design (lint and scan, per file and per block)

The probe appended forms to `packages/shared/src/formula/parse.ts`, and separately to `packages/shared/src/value.ts`:
- 14 round-6 forms in my own spellings:
  - generator declaration, object method, class method, expression, and a generator whose finally returns plus `it.return()`;
  - destructured `then`, the `"finally"` key, a `` `then` `` template, a `#then` private name, a thenable `{ then() }`, and a `catch` key;
  - `Array.fromAsync`, `[Symbol.asyncIterator]`, and `["fromAsync"]`;
- the 17 round-5 forms, byte-identical to round 5;
- 2 allowed shapes.

Results:
- **ESLint flags every form line, and neither allowed shape** (`01b-r6-probe-summary.txt`):
  - round-6 block: 14/14, with 27 errors;
  - round-5 block: 17/17, with 34 errors, up from 26 in round 5, because the new name rule also fires on R10 and on the `then`/`catch`/`finally` members of the probe's helper `declare const qaP` type.
- **The fuzz.test.ts source scan fails** on the mutated file: "expected ['generator', 'then', …(4)]" for the round-6 block, and "['Promise', 'async', 'await', …(7)]" for the round-5 block.
- **Restored:** `git status` is clean, and `eslint packages/shared/src/formula packages/shared/src/value.ts` exits 0.

### 3. `01c-runtime-mutation-probe.log`, non-zero steps by design

M1–M4 inject a real string code generation into the try block of `validateFormula`, the `evaluateAst` walk, `formatDecimal` and `parseFormula`.

- **No-codegen invocation:** fails each time with EvalError, with 73, 24, 4 and 103 failed tests, identical to round 5. There are 0 'could not be processed' lines.
- **Normal unit-node process:** passes each mutation, 277/277.
- **Control after restore:** 256 passed + 2 skipped, EXIT 0.
- **Disclosed:** my first attempt placed M3 *after* `d = fromStored(value)` (round 5 placed it before) and failed 3 tests rather than 4. The 4th test makes `fromStored` throw a TypeError first, so an M3 placed after it never runs there. This was a probe-placement difference, not a product change, and the log is the corrected rerun.

### 4. `04-e2e-unset.log` and `04-e2e-cutf8.log`, EXIT 1 each: 216 passed, 2 failed, 0 skipped, 0 flaky (retries 0)

The 2 failures are my F180b probe in chromium-en and chromium-ar, through the single assertion at line 1813, `expect(bad).toEqual([])`.

- **Where it fails.** In each project and setting, 7 of 77 rows fail, all in the one state 390 px + 200% root text.
- **The failing rows.** In those rows inside=true and notClipped=true, with 0 overlaps. clauseInside=false and noHScroll=false, because the pre-existing gate grid makes the document 505 or 633 px wide.
- **Same as before.** This is identical to rounds 3, 4 and 5: an observation about the grid, not a residual of F-DG3-180, and not a finding.
- **Other rows:** all 70 pass every criterion.
- **Per-spec counts:** identical to round 5 (`04-per-spec-counts-r5-vs-r6-*.txt`).

## Notable lines in passing logs

- **Unit:**
  - each log has one `[FSTDEP022] FastifyWarning` deprecation line, which was present in earlier rounds and has no test effect;
  - the "×" matches are test names ("ARPU × annual customers", "role × month").
- **Integration:**
  - `BE17 db-econnreset … status 500` is stdout of a passing deliberate-negative test;
  - `BE17 R6*/R8` and `BE18 Q7 idp_unavailable` are stdout of passing tests;
  - the 3 `npm warn Unknown project config` lines are npm advisories about pnpm keys.
- **Build:** Vite's advisory about chunks larger than 500 kB.
- **Contrast:** the three "fails" lines are the documented prohibited pairs, asserted to fail.
- **Install:** 2 WARN lines, "Failed to create bin … mth-db", because the db dist did not exist before the build.
- **e2e:**
  - the only "Error" lines belong to the F180b failures (the other matches are test titles containing "inline error");
  - the api.log tail is empty (LOG_LEVEL=warn).
- **Observation, unchanged since round 5:** in A10, the G4 refusal's `g4.finance_validation` message is "Finance validation" repeated 4 times, one per unvalidated item. The acceptance ("listing 'Finance validation'") holds.

## Locale

`locale -a`: C, C.utf8, POSIX. Unit and e2e ran with LANG/LC_ALL unset and with C.UTF-8. ar_SA is not installed.

## Screenshots

As in rounds 4–5, only the C.UTF-8 run's screenshots are kept (62 files, `screens/cutf8/{en,ar}/`). The JSON results of both runs are kept in full.

## Housekeeping

An empty `.claude/.cc-writes` directory, a harness artefact, appeared in this evidence directory and was removed. The helper scripts are in `scripts/`.
