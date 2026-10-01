# DG1 round-5 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-4 all-PASS (which raised only non-mandatory nits). Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:24eb377939d83b7036e992e647f390b91e030cd6aa18b805b74dea900d50b08e`
- **source_commit:** `5f83a3363798e3e3452be208f0e6adb5a8649fe6` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1` and `--diff`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/24eb377939d83b70.manifest.json`.

## What changed since round 4 (all PASS, non-mandatory nits)
All now `FIXED_PENDING_VERIFICATION` with a fix_revision + summary:
- **F-DG1-122 (Medium):** the installer acceptance test is non-destructive — AC-8 snapshots pre-existing dev paths and removes only a probe-created path (a planted .vscode/tasks.json survives).
- **F-DG1-123 (Low):** the copy-back enumerates the real pnpm-workspace members (not package.json<=depth4) and fails the install on a copy error.
- **F-DG1-124 (Low):** the module lint bans dynamic-code primitives outright in src/modules/** (eval/Function/constructor/loaders/reflection/process.binding/dlopen + non-literal computed keys), written any way.
- **F-DG1-211 (Low):** the REQ-DLV-042 acceptance log is regenerated from the current 13-case suite.
- **Carry-overs (fixed in rounds 2/3, not yet re-verified):** F-DG1-204 (SBOM regenerated; generate-sbom --check passes), F-DG1-205 (all three ci.yml copies identical).

## Your job
Verify each finding you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-5/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-5/`. PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains.
