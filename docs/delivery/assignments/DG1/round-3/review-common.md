# DG1 round-3 review — common instructions

You are independently re-reviewing the DG1 candidate after the round-2 BLOCK. Read your role file in this directory next.

## Candidate (same for all three reviewers and the auditor)
- **candidate_id:** `sha256:f0baa87d0163560fc05119a310c73ed365564833697c74bfa3a1c7f8795595a8`
- **source_commit:** `520417922c46d465a19433440bb41faf2bef319a`
- **manifest:** `docs/delivery/candidates/DG1/f0baa87d0163560f.manifest.json` (389 files)
- Confirm `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal this id. A complete clone (not shallow). HEAD may be the freeze commit (f0baa87 + round-3 assignments/manifest/stages, all candidate-excluded metadata); the recomputed candidate id is identical — verify and continue.

## What changed since round 2 (BLOCKED)
Round 2 found 2 Highs, 1 Medium-mandatory and several Low/Medium. All are now `FIXED_PENDING_VERIFICATION` in `docs/delivery/findings.json`, each with a `fix_revision` + summary. The repairs:
- **Orchestrator:** the installer `tools/deps/install-sandbox.sh` was redesigned (D-051) — the real repo is bound READ-ONLY and pnpm runs in a disposable copy; only node_modules (+ create lockfile) is copied back. Closes **F-DG1-113** (control-path escape), **F-DG1-114** (config-surface injection) and **F-DG1-102**.
- **Backend (BE4):** **F-DG1-115** (derive step locks the source BU grant FOR SHARE + re-checks → no derived assignment outlives a concurrent revoke; 403+rollback+audit when unauthorized), **F-DG1-117** (lint rejects process.getBuiltinModule / computed members / new Function).
- **Frontend (FE4):** **F-DG1-208** (all e2e locators anchored → AR+EN journeys green), **F-DG1-005/008** (derived-assignment audit entry localized AR+EN).
- **DevOps (DEVOPS3):** **F-DG1-116** (check-ci-needs allow-lists the gate job + validate steps, rejecting defaults/env/container/services/if and env/shell/working-directory), **F-DG1-108/203** (CI resolves missing digests at runtime; keycloak is the D-049 test-only residual).
- **Analyst (ANALYST3):** **F-DG1-007/209** (register residuals: 422-not-409, migrations 0001-0008, refreshed evidence).
Also still-fixed-pending from round 2 and re-verified now: F-DG1-106, 107, 112, 204, 205.

## Your job
1. **Verify each finding you own** (your role file lists them): confirm the fix is real, complete and correct on THIS candidate, no regression. Write a verification sidecar so the orchestrator can close it `CLOSED_VERIFIED`, or record it still-open with a new finding if inadequate.
2. **Re-run your checks** on the frozen candidate (record command, environment, real output). A missing tool/DB is BLOCKED, never a silent pass.
3. **Re-check the 12 DG1-final requirements** per your role file.
4. Independence: you did not implement the round-3 repairs (implementers: solution-architect, backend-workflow-engineer, frontend-ux-engineer, devops-engineer, transformation-analyst, delivery-orchestrator). An author cannot close their own finding.

## Record
Write `docs/delivery/reviews/DG1/round-3/<role>.json` + your finding/verification sidecars (Write only), and evidence under `docs/delivery/test-evidence/DG1/<key>/round-3/`. Overall PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. A Low, non-mandatory, fail-safe observation may be left for acceptance (reviewer sidecar + auditor), not a silent pass.
