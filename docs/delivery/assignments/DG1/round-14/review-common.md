# DG1 round-14 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-13 all-PASS, which raised one Low finding. It is now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:dd747fe1df62d876a74101caa826542b90d3eb36cedb1de14f299b0b6de8c559`
- **source_commit:** `985d0fa6d05e0b63f53ad67f641910dab34f50ca` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone. 391 files.
- **manifest:** `docs/delivery/candidates/DG1/dd747fe1df62d876.manifest.json`.

## What changed since round 13 (F-DG1-135 now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-135 (Low, REQ-S16-003):** the round-13 `walk()` broadening had classified any `*.test.<ext>` as a test (`TEST_FILE`), granting test-only boundary exemptions (import of `modules.ts`/`architecture.testkit.ts`/`vitest`), wider than the build exclusion (`tsconfig.build.json` drops `.test.ts`/`.test.tsx`) and vitest (`.test.ts`). So a `*.test.mts` would ship in `dist`, never run as a test, yet get exemptions. Fixed in `apps/api/src/architecture.testkit.ts`: `TEST_FILE = /\.test\.tsx?$/` (exactly the build-excluded test extensions). `CODE_FILE` stays broad (every buildable file is still scanned), so a `*.test.mts` is now a **non-test** module file with the full boundary rules. Real module test files are all `.test.ts`, so nothing changes for the real tree.

A Node 24.21.0 binary is at `/opt/nvm/versions/node/v24.21.0/bin`.

## Your job
Verify the finding you own (your role file lists it); re-run your checks (real output; a missing tool/DB is BLOCKED; where a check runs on Node 24, run both). Re-check the 12 DG1-final requirements; confirm no regression. You did not implement this repair. Write `docs/delivery/reviews/DG1/round-14/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-14/`. PASS only if the fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
