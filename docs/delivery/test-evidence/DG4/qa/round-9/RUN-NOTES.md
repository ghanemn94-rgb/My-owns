# qa-verifier DG4 round 9: run notes (T-DG4-REV-QA-R9)

Candidate `sha256:18c18fe4eda7cbc1c9b2c42ffd22f5ec5c1c4851be1a34183cb118bd4ddad76c` (1475 files), source `f2ae717`, freeze commit `01ad2e1`.
This is a confirmation and re-verification round after the D-136 history rewrite. Every command ran in the disposable complete clone `$TMPDIR/review-dg4r9`, which is removed at the end. The validators also ran on the repository working tree, read-only.

## Order of work
1. 09:17Z: clone at 01ad2e1 (not shallow, clean); `candidate.mjs --stage DG4` printed `sha256:18c18fe4...`, 1475 files, EXIT 0, both in the clone and in the working tree (HEAD 01ad2e1). The re-check at the end is in `00-candidate.log`.
2. Offline install (`00-install.log`; the two `WARN Failed to create bin … mth-db` lines are expected before the build), then `pnpm -r build` (`01-pnpm-r-build.log`), which `pnpm test` needs.
3. **Unit envelope, series r1 (09:19–09:40Z): OUTSIDE THE ENVELOPE, so not used as the gate check.** All 4 runs EXIT 0, but the 1-minute load went above 8: 55 of 81 samples, max 11.67. A cause on my side: I ran the SHA-map and fix-revision git checks (`03-rewrite-check.log`, `04-*.log`) at 09:19–09:22Z, concurrently with the start of the run. Under the D-134 envelope this series is disclosed and the check re-run; its passes show only that no failure appeared at load ≤ 11.67.
4. Idle gap with load decaying to 1.3, then **series r2 (09:41–09:56Z) inside the envelope**: 4/4 EXIT 0, 58 samples, max 5.81, 0 above 8, max gap 15 s. Nothing else of mine ran during r2.
5. Static checks (typecheck, lint, openapi:lint, no-cdn, format:check, contrast), the validators, the register confirmation, the F-DG4-146 mutant re-run, the write-once check and the D-136 record checks.

## Disclosed non-zero exits and error lines
- `02d-unit-f146-mutants.log`: EXIT 1 for M4/M4a/M4b, by design (mutants must be killed). M4 fails W1/W2 (en, ar), W3 and W4 (6/86); M4a fails W4; M4b fails W3. My round-6 test fails 4/4 under M4 and passes under M4a/M4b, exactly as in round 7. `client.ts` was restored and cmp-checked; the clone's git status is empty.
- `07b-writeonce.log`: EXIT 1 on the PRE-rewrite head (99 errors), by design: it reproduces the B3 defect that D-136 repairs. The new head gives 0 errors for DG4 and DG3.
- `04c-fix-locations.log`: the first F-DG4-140 snippet raised `KeyError: 'id'` (the register's key is `req_id`); the corrected re-run is appended below it.
- `07-d136-judgement.log`: the first B4 snippet printed only the stage candidate, because I read a non-existent key `rounds` (the key is `review_rounds`); the corrected per-round table is appended.
- Unit logs: 14 React "Encountered two children with the same key" warnings per run, in passing tests of kpiUnit.test.tsx and percentKpi.test.tsx. They are fixture artefacts and are identical in rounds 6–8. The coarse "fail/timeout lines" counter in `02-unit-envelope-summary.txt` matches ✓ (passing) tests whose names contain "failed". The strict scan at the end of that file shows 0 ×/FAIL lines, 0 timeouts and 0 failed summaries in all 8 logs.
- The build log carries Vite's advisory "chunks larger than 500 kB" only.

## Commits that landed during my run
`3e5a26e` and `b9358f1` are the auto-committed run records of the round-9 code-security and domain reviewers. They touch only `docs/delivery/runs/DG4/...`, 0 files outside docs/delivery. The candidate ID was unchanged afterwards. I did not read those files.

## Not re-run this round (carry-forward, D-136; product byte-identical)
Integration ×2, tests/qa alone, REQ-DLV-036 counts, full e2e (chromium-en/ar, both locale settings), axe, 390 px, 200 % text and the AUD read-only pass: round-7 evidence on `dab4562`, whose tree outside docs/delivery is identical to `f2ae717` (`03-rewrite-check.log`, last lines).
