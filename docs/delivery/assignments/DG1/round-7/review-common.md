# DG1 round-7 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-6 all-PASS, which raised exactly two Low, non-mandatory findings. Both are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:d3743a352912a357b0a81124794561cea5f06f5dbc31542b9623c68c47649ab7`
- **source_commit:** `a6bdea00f8ee9d75926bc08b089d9a895b1f810f` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/d3743a352912a357.manifest.json`.

## What changed since round 6 (both findings now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-127 (Low, REQ-S16-003):** the module lint (`apps/api/src/architecture.testkit.ts`) now bans the `sqlite` / `node:sqlite` specifier (added to `LOADER_BUILTINS`), closing the `node:sqlite` `DatabaseSync.loadExtension` native-loader route (same class as the `process.dlopen` route closed by F-DG1-125; a module never needs SQLite — persistence is `@mth/db`/PostgreSQL per ADR-0003, zero imports in src). Self-check `architecture.test.ts` adds **A1**. The two irreducible residuals (runtime code-generation-then-import via a literal same-module path; the enumerated loader/eval denylist not being provably exhaustive over every host capability) are now **documented and ACCEPTED** in the testkit header as stated residuals of a static defence-in-depth lint (ADR-0002) over human-reviewed code in a read-only production source tree — `node:fs` is deliberately NOT banned (tests/modules read files legitimately). Fix commit at the round-7 head; D-053 records the decision.
- **F-DG1-212 (Low, REQ-DLV-042):** the REQ-DLV-042 cited installer acceptance log (`docs/delivery/test-evidence/DG1/orchestrator/install-sandbox-acceptance.log`) was the pre-F-DG1-126 13-case run; it is regenerated against the post-fix installer as the 14-case suite (AC-1..AC-10, 14 passed, 0 failed, exit 0).

These were the only two open findings; no other candidate change.

## Your job
Verify each finding you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-7/<role>.json` + sidecars (`<role>.findings.json` for any NEW finding, `<role>.verifications.json` for the fixes you verify); evidence under `docs/delivery/test-evidence/DG1/<key>/round-7/`. PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. On an **adjacent** module-lint loader route, check it against the testkit header's stated+accepted residual class (D-053) before raising it as new: a route already covered by a documented residual is not a new finding.
