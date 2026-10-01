# DG1 round-6 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-5 all-PASS, which raised exactly two Low, non-mandatory findings. Both are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:a7b46fbc29db6bb855495593e43f2e859305dea9d6c403fe86f73619d9fb210d`
- **source_commit:** `0026a7bde8baced44e5786ddd64a00624bcfa021` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/a7b46fbc29db6bb8.manifest.json`.

## What changed since round 5 (both findings now `FIXED_PENDING_VERIFICATION`, with a fix_revision + summary)
- **F-DG1-125 (Low, REQ-S16-003):** the module lint (`apps/api/src/architecture.testkit.ts`) now bans the `process` / `node:process` module specifier (added to `LOADER_BUILTINS`), so an import of the process module from `src/modules/**` is itself a specifier violation — closing the default/namespace/named import route that previously aliased the process object past rule 3's `process.<loader>` check. The global `process` stays covered by rule 3 (unchanged). Self-check (`architecture.test.ts`) extended with X6–X8; P12 (global `process.binding`) kept as the global-form guard. Fix commit `83b12da`.
- **F-DG1-126 (Low, REQ-DLV-042):** the installer copy-back (`tools/deps/install-sandbox.sh`) now takes its workspace-member list from pnpm's own resolution (`pnpm -r ls --depth -1 --json`, run against the real trusted tree) instead of a hand-rolled YAML glob parser, so only pnpm's own members (honoring `packages:` and `!` exclusions, ignoring other list keys like `publicHoistPattern`) are copy-back destinations; the parser merges pnpm's one-array-per-project stream, refuses any path outside the repo root, and fails the install on a resolve/parse error. Acceptance test adds AC-10. Fix commit `3037ce2`.

These were the only two open findings; no other candidate change. D-052 records both fixes.

## Your job
Verify each finding you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-6/<role>.json` + sidecars (`<role>.findings.json` for any NEW finding, `<role>.verifications.json` for the fixes you verify); evidence under `docs/delivery/test-evidence/DG1/<key>/round-6/`. PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
