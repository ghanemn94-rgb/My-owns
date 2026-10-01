# DG1 round-2 review — common instructions

You are independently re-reviewing the **repaired** DG1 candidate after all 25 round-1 findings were fixed. Read your role file in this directory after this one.

## Candidate (same for all three reviewers and the auditor)
- **candidate_id:** `sha256:991d32417f16984e47da7bb0767bd2e432e2d88b9fb066513dd7fa1761fea8fc`
- **source_commit:** `f32c705898cf0a393ed87d7f45a570df9bc09a17`
- **manifest:** `docs/delivery/candidates/DG1/991d32417f16984e.manifest.json` (388 files)
- Confirm `node tools/gates/candidate.mjs --stage DG1` and `--diff` equal this id before you trust the tree. A complete clone (`git rev-parse --is-shallow-repository` = `false`).

## What changed since round 1
Round 1 BLOCKED the gate with **25 findings** (4 High, 10 Medium, 11 Low), now all `FIXED_PENDING_VERIFICATION` in `docs/delivery/findings.json`, each with a `fix_revision` and a summary. The repairs:
- **Orchestrator:** F-DG1-102 (install-sandbox hardened: --clearenv, control paths read-only, --cap-drop ALL), F-DG1-111/206 (hermetic acceptance tests), F-DG1-204 (SBOM), F-DG1-205 (ci.yml drift), F-DG1-108/203 image-digest pinning (D-049: keycloak BLOCKED — quay.io denied in this environment, test-only), F-DG1-104 CI install, plus the openapi prose + data-dictionary alignment and D-048/D-049/D-050.
- **Backend (BE3):** F-DG1-101/201 (getBrandingTokens contract coverage, 33 ops), F-DG1-001 (close refused 422/G6), F-DG1-103 (OIDC browser-binding, migration 0007), F-DG1-106 (BU-Lead derived assignment, migration 0008), F-DG1-105/002 (workflows/kpi/reporting module scaffolds, D-048), F-DG1-109/110/112.
- **DevOps (DEVOPS2):** F-DG1-202 (assemble-runtime includes design-tokens), F-DG1-104/107/108/203.
- **Frontend (FE2 + FE3):** F-DG1-003 (glossary), F-DG1-004 (no dead not-found), F-DG1-005 (audit labels), and the web no longer offers the governed `closed` transition.
- **Analyst (ANALYST2):** F-DG1-105/002/006/207 register reconciliation.

## Your job
1. **Verify each finding you own** (your role file lists which). For each, confirm the fix is real, complete and correct on THIS candidate, and that it did not introduce a regression. Write a sidecar entry so the orchestrator can close it `CLOSED_VERIFIED`, or record it still-open with a new finding if the fix is inadequate.
2. **Re-run your checks** on the frozen candidate (record command, environment, real output). A missing tool/DB/credential is **BLOCKED**, never a silent pass.
3. **Re-check the 12 DG1-final requirements** per your role file.
4. Independence: you did not implement the round-2 repairs (implementers: solution-architect, backend-workflow-engineer, frontend-ux-engineer, devops-engineer, transformation-analyst, delivery-orchestrator). An author cannot close their own finding.

## Record
Write your review record `docs/delivery/reviews/DG1/round-2/<role>.json` and your finding sidecars, with Write only, plus evidence under `docs/delivery/test-evidence/DG1/<key>/round-2/`. Overall PASS only if every assigned fix verifies, every assigned requirement is complete with existing evidence, and you found no unresolved Critical/High/mandatory issue. Otherwise FAIL with the specific findings.
