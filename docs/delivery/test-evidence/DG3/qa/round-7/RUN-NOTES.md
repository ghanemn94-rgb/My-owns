# qa-verifier DG3 round 7: run notes (every non-zero exit disclosed)

Candidate `sha256:f55095dbec364594d25a624261512239854f233d3ee0b5c8ecc210d1602bf6e0` (757 files, source d3e6fe6). It recomputes identically in the repo working tree at the start (HEAD d22938f), at `--ref d3e6fe6` and `--ref HEAD` at the end (HEAD e8c188e), and in both clones at the start and the end (`00-candidate.log`, `00-candidate-end.log`). HEAD moved during the run with 0 files changed outside `docs/delivery/` (other reviewers' evidence commits). I did not read any other reviewer's round-7 record or evidence.

## Clones and install

Two disposable, complete (non-shallow) clones at d3e6fe6 under `$TMPDIR`, both removed at the end: `review-dg3` ran every suite, `probe-dg3` ran only the throwaway mutation probes. Offline `--frozen-lockfile` install from a copy of the local pnpm store.

## Spec

`docs/delivery/test-evidence/DG3/qa/tests/round-7/e2e/dg3-qa-r7.spec.ts` (sha256 f80370cb…) is a copy of my round-6 spec with renames only (6 lines: header, results file `dg3-qa-r7-checks-*`, synthetic names "R7", screenshot prefix `qa-r7-`). Line numbers are unchanged; the F180b assertion is still line 1813. It ran as `e2e/dg3-qa-r7.spec.ts` in the clone and was removed afterwards; it was never part of the candidate. No repair required adapting a test: T-DG3-KBE-I changes only `fuzz.test.ts` and two architecture documents (0 files changed under `apps/`, `packages/` apart from `fuzz.test.ts`, `eslint.config.js`, migrations, ERD). The copy is in `tests/round-7/` because `tests/round-3/` (and rounds 4–6) hold my write-once evidence of earlier rounds.

## New in round 7: acceptance-side probes of T-DG3-KBE-I (F-DG3-280)

- `01e-r7-lintproof-mutation-probe.log`: weakens one guard selector in `eslint.config.js` at a time (probe clone, throwaway) and runs the repaired lintText test. Control passes; P1 (drop `ForOfStatement[await=true]`) fails at `for await (const x of xs) a(x);`; P2 (drop the `PrivateIdentifier[…]` part) fails at the new `class C { #then() {} }` row; P3 (generator selector neutralised) fails at G1; P4 (drop the `Literal[…]` part) fails at `const { ["then"]: t } = p;`. Each EXIT 1 is by design; after each restore git status is clean and the final control passes.
- `01f-r7-probe-row-count.log`: a throwaway `console.log` shows PROBES = 101, linted = 99, excluded = 2 (`const s = "unclosed;`, `function f() {`), matching the new ADR-0024 §6 sentence and p3-work-split §9 item 29. The ADR's guard-rule list matches the test's `GUARD_RULES` set exactly.

## Non-zero exits and failures

1. `01b-r7-rule-static-negative-probe.log`: EXIT 1 by design for ESLint and the scan in each of the 4 file × block runs; per-line coverage identical to round 6 (14/14, 17/17; allowed shapes not flagged; `01b-r7-probe-summary.txt`). Restored clean; the final eslint exits 0.
2. `01c-runtime-mutation-probe.log`: nocodegen EXIT 1 by design for M1–M4 with 73/24/4/103 failed tests (identical to round 6), EvalError lines 65/44/9/70, 0 'could not be processed'. Normal process 280/280 each (277 in round 6 + the 3 new tests). Control after restore 259 passed + 2 skipped, EXIT 0.
3. `01e-…` P1–P4: EXIT 1 by design (see above).
4. `04-e2e-unset.log` and `04-e2e-cutf8.log`: EXIT 1 each, 216 passed, 2 failed, 0 skipped, 0 flaky (retries 0). The 2 failures are my F180b probe in chromium-en and chromium-ar at the single assertion `expect(bad).toEqual([])` (line 1813). In every project and setting, 70 of 77 rows pass every criterion; the 7 failing rows are exactly the 7 badges at 390 px + 200% root text, with inside=true, notClipped=true, 0 overlaps, but clauseInside=false and noHScroll=false because the pre-existing gate grid makes the document 505/633 px wide. Identical to rounds 3–6: an observation about the grid, not a residual of F-DG3-180, not a finding.

No unit run failed in this round: all four configurations exit 0 on the first run (the load-sensitive DG2 session-identity flake disclosed in rounds 3 and 6 did not recur).

## Notable lines in passing logs

- Unit: one `[FSTDEP022] FastifyWarning` deprecation line per log (present in earlier rounds; no test effect). The 2 skips in invocation 2 are the two `it.skipIf(NOCODEGEN)` ESLint tests (ESLint's ajv needs code generation); both run and pass in invocation 1.
- Integration: `BE17 db-econnreset … status 500` is stdout of a passing deliberate-negative test; `BE17 R6*/R8` and `BE18 Q7 idp_unavailable` are stdout of passing tests; 3 `npm warn Unknown project config` lines are npm advisories about pnpm keys.
- Build: Vite's advisory about chunks larger than 500 kB.
- Contrast: the three "fails" lines are the documented prohibited pairs, asserted to fail.
- Install: 4 WARN lines "Failed to create bin … mth-db" because the db dist did not exist before the build.
- e2e: the only "Error" lines belong to the F180b failures (other matches are test titles containing "inline error"); api.log tail empty (LOG_LEVEL=warn).
- Observation, unchanged since round 5: the G4 refusal's `g4.finance_validation` message is "Finance validation" repeated 4 times, once per unvalidated item; the acceptance ("listing 'Finance validation'") holds.

## Locale

`locale -a`: C, C.utf8, POSIX. Unit and e2e ran with LANG/LC_ALL unset and with C.UTF-8. ar_SA is not installed.

## Screenshots

As in rounds 4–6, only the C.UTF-8 run's screenshots are kept (62 files, `screens/cutf8/{en,ar}/`). The JSON results and axe summaries of both runs are kept in full.

## Housekeeping

Empty `.claude/.cc-writes` directories (harness artefacts) appeared in this evidence directory and were removed. Helper scripts are in `scripts/` (round-6 scripts adapted by path/round renames only, plus the new `probe-r7-lintproof.sh`, `probe-summary.py`, `trace.py`, `run-unit.sh`, `run-integration.sh`).
