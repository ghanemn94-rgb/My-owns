# DG1 gate audit — release-auditor (round 4, clean re-gate)
Task ID: `T-DG1-AUDIT-R4`. Read the three round-4 specialist records first.
## Candidate
- **candidate_id:** `sha256:6e0c0db1a8bea33cd81f05ea8c795d8ede4bfb7f380dfe146556cb4875a6f827` (395 files) — verify `node tools/gates/candidate.mjs --stage DG1`. **manifest:** `docs/delivery/candidates/DG1/6e0c0db1a8bea33c.manifest.json`.
## Audit (points 1-7)
- Complete clone; else BLOCKED. Candidate identity equals the above; `node tools/gates/validate.mjs --historical --stage DG0` passes.
- Independence & provenance: each round-4 specialist `invocation_reference` resolves to a real, distinct, successful, sandboxed round-4 run; no reviewer implemented any DG1 requirement.
- **Findings:** EVERY DG1 finding `CLOSED_VERIFIED`. F-DG1-147 CLOSED_VERIFIED by code-security on this candidate; the rest (F-DG1-140/141/142/143/144/145/146/001/002/003/230/231/232) CLOSED_VERIFIED in earlier retained rounds whose source_commits are present and whose fixes are ancestors of this candidate. **No** DG1 finding OPEN/FIXED_PENDING; zero unresolved Critical/High; zero unresolved mandatory (F-DG1-140/141 Medium mandatory — confirm). The three DG0 ACCEPTED_OBSERVATION (F-DG0-147/149/015) belong to the previous gate.
- **Environmental residuals, not BLOCKED:** no gate-round specialist recorded a BLOCKED check; live-registry (AC-1, D-057), live-CI (A24, D-058), keycloak (D-049) are documented residuals with their available surface verified.
- **Requirements:** each of the 12 `final_gate=DG1` requirements is in QA's `requirements_checked` AND domain's or code-security's; `node tools/gates/validate.mjs --register DG1` passes.
- **Decisions:** D-046..D-058 recorded with rationale.
## Round-4 specifics
- **Stage state** is set to **VERIFYING** before your run. Confirm QA shows unit green Node 22+24, integration green (migration 0009, bu-hierarchy-guard), e2e journeys green EN+AR no skips, and `pnpm -r typecheck` now covers the e2e specs (F-DG1-147).
- **Process-sandbox (D-030-D-033):** each run's `sandbox.json` matches `meta.process_sandbox_sha256`.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
Write `docs/delivery/reviews/DG1/round-4/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). `assignment`=exactly `docs/delivery/assignments/DG1/round-4/release-auditor.md` (bare path). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`.
- `manifest_path`: `docs/delivery/candidates/DG1/6e0c0db1a8bea33c.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, do not approve.
