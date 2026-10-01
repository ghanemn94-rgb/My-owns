# DG1 round-4 review — common instructions

You are independently re-reviewing the DG1 candidate after the round-3 BLOCK. Read your role file next.

## Candidate (same for all three reviewers and the auditor)
- **candidate_id:** `sha256:3b76021be348356f6cead57bff8fce358fac7acbfe9da42bdd8262f143308fb1`
- **source_commit:** `016433db8bb24e870fa4190856a2f188b30bd70d`
- **manifest:** `docs/delivery/candidates/DG1/3b76021be348356f.manifest.json` (390 files)
- Confirm `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal this id. Complete clone (not shallow). HEAD may be the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify and continue.

## What changed since round 3 (BLOCKED)
Round 3 found a new High (F-DG1-118) + Mediums/Lows; all now `FIXED_PENDING_VERIFICATION` with a `fix_revision` + summary:
- **F-DG1-118 (High, orchestrator):** the installer copy-back now copies node_modules ONLY at the real repo's trusted workspace-member paths (enumerated from the real tree, NUL-safe, non-symlink); a node_modules planted at any other path is never copied back. Recloses **F-DG1-113/114**.
- **F-DG1-009 (Medium, orch+BE):** integration files run serially (vitest `poolOptions.forks.singleFork`); `dropScratchDatabase` waits until no client is connected before dropping (else fails, never force-drops a live DB), and the harness owner pool has an error listener. New `scratch-drop.test.ts`.
- **F-DG1-210 (Medium, FE):** the create page refetches `/api/v1/me` after a 201 (≤5s, fail-open) so Edit/Archive/audit appear without a reload.
- **F-DG1-119 (Medium, devops):** `deploy/images.lock.json` is Prettier-ignored (generated lock) so `format:check` is green.
- **F-DG1-120 (Low, devops):** `check-ci-needs` restricts the gate checkout/setup-node `with:` inputs (closes **F-DG1-107**).
- **F-DG1-121 (Low, BE):** the module lint catches an aliased function-`.constructor` loader.

## Your job
1. **Verify each finding you own** (your role file lists them) on THIS candidate — fix real, complete, no regression. Write a verification sidecar (CLOSED_VERIFIED) or record it still-open with a new finding.
2. **Re-run your checks** (record command, env, real output; a missing tool/DB is BLOCKED, never a silent pass).
3. **Re-check the 12 DG1-final requirements** per your role file.
4. Independence: you did not implement the round-4 repairs.

## Record
`docs/delivery/reviews/DG1/round-4/<role>.json` + finding/verification sidecars (Write only); evidence under `docs/delivery/test-evidence/DG1/<key>/round-4/`. Overall PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
