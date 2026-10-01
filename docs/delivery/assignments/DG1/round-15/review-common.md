# DG1 round-15 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-14 all-PASS, which raised two Low findings. Both are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:76d8b3049d22d414a4c036bd3dd1af6e0c3609baedb096e2d2ecf4180bf07846`
- **source_commit:** `f27b5a6f80f2b1146bc8f3de35d284991e4213f8` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone. 391 files.
- **manifest:** `docs/delivery/candidates/DG1/76d8b3049d22d414.manifest.json`.

## What changed since round 14 (both findings now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-136 (Low, REQ-S19-004):** the integration project in `vitest.config.ts` now sets `hookTimeout: 30_000` (matching `testTimeout`). The `access-derived-race.test.ts` `afterAll` teardown (DDL + `api.close()` + `dropScratchDatabase()`, which itself waits up to 10s for other backends to disconnect) no longer runs under vitest's default 10s hook budget, so a contended/slow runner can't flake a 200/200 run.
- **F-DG1-217 (Low, REQ-S16-003):** the lint's `syntaxErrors()` used `ts.transpileModule`, which throws an internal "Debug Failure" when emitting a `.d.ts`/`.d.mts`/`.d.cts` name. Fixed: a `declarationSyntaxErrors()` helper (a no-emit one-file `ts.createProgram` + `getSyntacticDiagnostics`) handles declaration files, so the lint no longer crashes; `.d.ts` files are still scanned (their type imports stay boundary-checked) and a real syntax error surfaces as a named `unparseable source` diagnostic.

A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED; where a check runs on Node 24, run both). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-15/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-15/`. PASS only if the fixes verify, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
