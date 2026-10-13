# qa-verifier DG4 round 10: run notes (T-DG4-REV-QA-R10)

Candidate `sha256:f38274cb6d50c49857a89876cec1bc4713f69ef84b29a6f5b9af10061317ccc6` (1475 files), source `e70ac02`, freeze commit `01a801e`.
Scope: review of the round-9 repairs (T-DG4-FE-R11 for F-DG4-160 and its sweep; T-DG4-BE-R7, the A08 G6 fingerprint), D-137 to D-139.
Every command ran in a disposable complete clone `$TMPDIR/review-dg4r10` or its copy `$TMPDIR/review-dg4r10-mut`; both, the store copy and all scratch are removed (env.txt).

## Order of work (UTC)
1. 16:39 candidate identity on the clone (01a801e and e70ac02) and the working tree: 1475 files, same ID (00-candidate.log). Product diff f2ae717..e70ac02 = exactly the 9 files (01-diff.log).
2. 16:39 offline install, `pnpm -r build`.
3. 16:41-17:08 unit series r1 (4 runs): all EXIT 0 but OUTSIDE the envelope (80/108 samples > 8, max 11.82). My validator runs (08-*) overlapped it from 16:45 to 16:59, which is part of the cause. Disclosed, not used as the gate check.
4. 17:08-17:24 unit series r2 (4 runs), nothing else of mine running: 64 samples 5.10-6.91, 0 > 8; 4/4 EXIT 0. This is the gate check.
5. 17:24-17:44 full integration (`with-pg.sh pnpm test:integration`): 209 files, 1984/1984, EXIT 0; 77 samples, max 6.25.
6. In parallel with the end of 5 (second copy, separate ports): A08 mutants (17:34-17:38), changed e2e specs (17:41-17:45), tests/qa alone, my probe spec, root acceptance specs (to 17:53), then static checks and the unit stale-text mutant. Every sample stayed <= 6.25.
7. 17:56 end-of-run identity re-check; clones removed.

## Disclosed non-zero exits, invalid attempts and warnings
- 06-a08-mutants-attempt1-filtered-INVALID.log: my first mutant harness used `-t` to run only the G6 test. The A08 describe is sequential, so the skipped earlier tests left G5 unapproved and the control itself failed with 422 gate.out_of_sequence. My harness error; not used.
- 06-a08-mutants-attempt2-overlapped-INVALID.log: my attempt to stop attempt 1 killed only my own shell (pkill matched its own command line), so attempt 1 kept running and overlapped attempt 2 on the same scratch paths. Not used.
- 06-a08-mutants.log (valid, per-process scratch paths): none 31/31 EXIT 0; stages, requirements, findings-removed, new-gate-DG7, new-review each fail exactly the G6 test, EXIT 1 by design (the mutant is killed); candidates 31/31 EXIT 0 by design (out of DELIVERY_RECORDS). Its per-mutant `head -30` cut the summary lines of the failing mutants; the counts are in the note appended to the log.
- 05-e2e-root-{unset,cutf8}-filter-INVALID.log: I passed `e2e/` as a Playwright filter; testDir is the repository root, so it also matched old QA probe specs under docs/delivery/test-evidence, which cannot import their helpers there (EXIT 1, 'Cannot find module'). My harness error; re-run with the 4 spec files named: 14/14 EXIT 0 in both settings.
- 05-e2e-probe-rev1-unset.log: revision 1 of my probe, 6/6 EXIT 0, but its sub-entry check was too weak (the sub-entry pages show the area label as h1, as the placeholder does). Revision 2 (05-e2e-probe-{unset,cutf8}.log) adds: no planned body on the sub-page, and the link into /transformations/<id>/<tab> opens a page with its own h1. 6/6 EXIT 0 in both settings.
- 02e-unit-fe-r11-targeted-and-mutant.log: EXIT(MUTANT) 1 by design: with the 4 i18n files restored to f2ae717, 14 of 49 tests fail; restored, clean status.
- Unit logs: 14 React 'Encountered two children with the same key' stderr warnings per run (passing tests in kpiUnit.test.tsx and percentKpi.test.tsx; fixture artefacts, unchanged since round 6). The summary's coarse 'fail/timeout lines' are passing (✓) tests whose names contain 'failed'; the strict scan shows 0 ×/FAIL, 0 timeouts, 0 failed summaries in all 8 logs.
- Integration log: 32 lines match error/timeout; all are stdout of passing error-path tests or names of passing tests (connection-hygiene, request-io F-DG2-412, OIDC idp_unavailable, bounded checkout/idle-in-transaction).
- e2e logs: 3 'npm warn Unknown project config' lines each (npm reading the pnpm .npmrc), no effect.
- Build: Vite's advisory 'chunks larger than 500 kB' only.

## Commits that landed during my run
be91689 and 39e0f8f: the round-10 domain and code-security run records and their review records/evidence, all under docs/delivery (0 files outside). I did not read them. The candidate ID was unchanged afterwards.

## Not re-run this round (carry-forward on identical code)
The full product e2e (all apps/web/e2e specs) in both settings, the AUD read-only pass, 390 px / 200 % on all P4 screens and the second full integration run: round-7 evidence on dab4562, whose product tree differs from e70ac02 only in the 9 FE-R11/BE-R7 files (01-diff.log). The 9 changed files' own checks were re-run here.
