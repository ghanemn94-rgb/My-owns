# qa-verifier DG5 re-gate round 4 (acceptance round on the same candidate, D-189): run notes

Run `DG5-T-DG5-RG-QA-R4-qa-verifier-20261025T023414Z-2882bb99`. The orchestrator's invocation names task `T-DG5-RG-QA-R4` (as D-189 does). The assignment's first line still reads `T-DG5-REV-QA-R5`, a text carried over from earlier rounds. That is a cosmetic inconsistency, and the task itself is unambiguous.

Candidate `sha256:d8d831814a6065af8b417c862486dc2132ee6cca40bae0573f4918ff52e782c9` (2203 files), source `54e02b61961550386d5ab24a74e8ae8bb612218f`. It is the same candidate as my round-3 record (`docs/delivery/reviews/DG5/round-3/qa-verifier.json`).

## Order of work (UTC, 2026-10-25)
1. 02:34. I read the assignment (sha256 a02e094b… matches), CLAUDE.md, agent-protocol.md and D-189.
2. 02:34. I made a COMPLETE disposable clone `$TMPDIR/review-r4` at 54e02b6: not shallow, 25592 tracked files, clean. `candidate.mjs --stage DG5` gives d8d83181…, 2203 files (00-candidate-start.log).
3. 02:35. **The repository working tree at HEAD 8fbdc7a does NOT hash to the frozen candidate.** It hashes to `sha256:ec9b3d94…`, with 1 changed file: `docs/delivery/decisions.md`. Commit 8fbdc7a added the D-189 row to it after the freeze. `decisions.md` is a candidate entry (it is not in META_EXCLUDES), so `validate.mjs --reconcile` reports every DG5 review as "STALE for current content", and `candidate.mjs --diff` exits 1 (00c-working-tree-drift.log, 08-validate.log). This is exactly the defect class of D-136 B1 (D-135 added to decisions.md after the DG4 round-8 freeze). See "Candidate drift" below.
4. 02:39. Offline install (00b-install.log, EXIT 0). 02:39–02:41: `pnpm -r build` (01-pnpm-r-build.log, EXIT 0).
5. 02:41–02:42. **F-DG5-146 deterministic reproduction**, my spec `docs/delivery/test-evidence/DG5/qa/tests/round-4/e2e/zz-qa-dg5rg4-session-race.spec.ts`. It was copied into the clone's apps/web/e2e/ for the run and removed before the end check. It ran on the real stack, --workers=1, locale unset, ports 26610/26611: 4/4 passed, EXIT 0 (05-e2e-race-unset.log).
6. 02:42–02:46. p4-benefits.spec.ts and session-end.spec.ts alone, real stack, both projects, ports 26620/26621: 28/28, EXIT 0, at a 1-minute load of median 1.77 and max 2.36 (05-e2e-benefits-session-unset.log).
7. 02:46–02:48. p4-benefits.spec.ts chromium-en alone under SYNTHETIC CPU contention: six `node -e 'for(;;){}'` burners on 4 cores, started 20 s before the run and killed after it (05-e2e-loaded-burners.log; `pgrep` afterwards found none). Load median 5.90, max 8.26. Result 9/9, EXIT 0 (05-e2e-benefits-loaded-unset.log).
8. 02:49–02:53. Validators: `--historical` DG4, DG3, DG2 and DG1 PASS; `--register DG5` PASS; `--reconcile` PASS (structure), with the STALE report; `candidate.mjs --diff` EXIT 1 (08-validate.log).
9. 02:53. End identity (00-candidate-end.log): the clone is unchanged (0 tracked changes, d8d83181…), and `--ref 54e02b6` in the repository gives d8d83181…. The repository working tree still gives ec9b3d94…, HEAD unchanged at 8fbdc7a.
10. 02:54. Clean-up: the clone, the store copy and the Playwright output were removed (09-cleanup.log). An empty pre-existing directory `round-4/dom-dumps/.claude/.cc-writes` (mtime 2026-10-20, not created by me; it looks like a sandbox mount stub) appeared in my fresh evidence directory and was removed with `rmdir`.

## Measurements for F-DG5-145 (p4-benefits test 8, default 30 s budget)
| run | load (1 min) | en | ar |
|---|---|---|---|
| round 4, spec alone (this run) | median 1.77 | 16.7 s | 15.5 s |
| round 4, spec alone, synthetic load (this run) | median 5.90, max 8.26 | 23.7 s | not run |
| round 3, spec alone (cited) | about 8 | 25.8 s | 25.7 s |
| round 3, full product suite, C.UTF-8 (cited) | loaded | 23.6 s | 15.4 s |
| round 3, full product suite, unset (cited) | median 6.2, max 16.8 | **30.2 s, timeout** | 20.5 s |

The duration rises with load and with the suite's accumulated data. Its longest single step in the failing trace is 1.53 s. This is a chain-length budget problem, not a slow product step.

## The F-DG5-146 reproduction (forced race)
- R1 holds My Work's first `GET /api/v1/me/work-items` for 2.5 s, signs in (signIn returns while the request is held), signs out elsewhere, then releases the request. The app itself lands on /login with `error=session_expired`, `returnTo=/my-work` and the localized alert, in en LTR and ar RTL. The URL never leaves /login for 3 s, there are at most 3 further GET /me, and there is no stale shell. The primary-navigation link that the original test clicks does not exist (count 0), so the original `locator.click` waits for its whole budget. This is the round-3 failure, made deterministic.
- R2 uses the same hold, but waits for the held request to settle and for network idle BEFORE signing out. The original test's steps and assertions (returnTo=/transformations) pass unchanged, with 0 work-items 401s. The fix direction named in the finding works.
- Product observation (not a finding): My Work's `useMyWorkItems` loads every page eagerly (`fetchAllPages`, apps/web/src/api/p4.ts:310-316, api/queries.ts:105). This is why the window grows with the number of open items. It is DG4-approved behaviour, and no DG5 acceptance text covers it. I note it as a DG6 performance follow-up.

## Every failure, error or warning line in my round-4 logs, explained
- **08-validate.log:** `candidate.mjs --stage DG5 --diff` EXIT 1, because the working tree differs from the frozen manifest in `docs/delivery/decisions.md` (D-189). `--reconcile` prints "STALE for current content" for every round for the same reason. See below.
- **00b-install.log:** four `WARN Failed to create bin … mth-db … ENOENT` lines. These are pnpm creating the bin link before packages/db is built. The build creates it (01-pnpm-r-build.log, EXIT 0). The same lines appear in round 3.
- **01-pnpm-r-build.log:** Vite's "Some chunks are larger than 500 kB" advisory and its "Adjust chunk size limit" line (informational, EXIT 0). A file name `FailuresPage-…js` matched my scan for "fail". It is a page name, not a failure.
- **05-e2e-*.log:** three `npm warn Unknown project config` lines per run (npm reading pnpm's .npmrc keys, harmless). 0 failed, 0 flaky, 0 skipped, 0 did not run.
- No timeouts occurred in any round-4 run.

## Candidate drift: what it means for this record
- What I reviewed is exactly d8d83181… (the clone at 54e02b6, and `--ref 54e02b6`). No product, test or tooling file differs between 54e02b6 and HEAD. The only candidate-scope difference is the one added D-189 row in `docs/delivery/decisions.md`.
- Approval-time (current-mode) gate validation recomputes the candidate from the working tree (`tools/gates/lib/rules.mjs`, around l.985–999). Until `docs/delivery/decisions.md` in the working tree is back to its frozen content (sha256 818f68c0…), a DG5 gate on d8d83181 will fail with "candidate: current content hashes to ec9b3d94…, approval covers d8d83181…; changed: ~docs/delivery/decisions.md". The alternative is a re-freeze, which makes every DG5 review record, this one included, stale.
- This is an orchestrator delivery-record defect, the D-136 B1 class. It is not an implementer defect: the finding schema's `owner` must be an implementer role, so I record it as a FAIL check in my record, not as a finding. It does not change any judgement in this record.
