# DG1 gate audit — release-auditor (round 2, clean re-gate)
Task ID: `T-DG1-AUDIT-R2`. Independent release auditor for the **DG1 gate**. Read the three specialist records first: `docs/delivery/reviews/DG1/round-2/{domain-reviewer,code-security-reviewer,qa-verifier}.json`.

## Candidate
- **candidate_id:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d` (394 files) — verify `node tools/gates/candidate.mjs --stage DG1`.
- **manifest:** `docs/delivery/candidates/DG1/e6979e12111aeb14.manifest.json`.

## Audit (your agent definition, points 1-7)
- **Complete clone** (not shallow); else BLOCKED.
- **Candidate identity:** recomputed id equals the above. `node tools/gates/validate.mjs --historical --stage DG0` passes (DG0 carried intact).
- **Independence & provenance:** each round-2 specialist `invocation_reference` resolves to a real, distinct, successful, sandboxed round-2 run; spot-check each transcript. No reviewer implemented any DG1 requirement.
- **Findings:** EVERY DG1 finding is `CLOSED_VERIFIED` by the relevant reviewer on **this** candidate. In particular the 12 round-1 findings (F-DG1-140, 141, 142, 143, 144, 145, 146, 001, 002, 003, 230, 231) must be `CLOSED_VERIFIED` on `e6979e12…`. **No** DG1 finding `OPEN`/`FIXED_PENDING_VERIFICATION`; zero unresolved Critical/High; zero unresolved mandatory (F-DG1-140/141 are Medium mandatory — confirm their verifications bind to post-freeze runs and the fix is in the candidate). The three DG0 `ACCEPTED_OBSERVATION` (F-DG0-147/149/015) belong to the previous gate.
- **Environmental residuals, not BLOCKED:** confirm neither gate-round specialist recorded a BLOCKED check; the live-registry install (AC-1, REQ-DLV-042, D-057) and live-CI (A24, REQ-DLV-025, D-058) are documented residuals with their available surface verified. keycloak is the D-049 residual.
- **Requirements:** each of the **12** `final_gate=DG1` requirements is in QA's `requirements_checked` AND in domain's or code-security's; `node tools/gates/validate.mjs --register DG1` passes.
- **Decisions:** D-046..D-058 recorded with rationale.

## Round-2 specifics
- **Stage state** is set to **VERIFYING** before your run.
- Confirm QA's record shows unit green on **both** Node 22 and Node 24, and the integration suite (incl. `bu-hierarchy-guard.test.ts`, migration 0009) green.
- **Process-sandbox (D-030-D-033):** each specialist run's `sandbox.json` matches `meta.process_sandbox_sha256`.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG1` necessarily reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.

Write `docs/delivery/reviews/DG1/round-2/release-auditor.json`, then `docs/delivery/gates/DG1.json` (Write/Edit only). Set `assignment` to exactly `docs/delivery/assignments/DG1/round-2/release-auditor.md` (bare path). APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`. Use your `invocation_reference` in both.
- `manifest_path`: `docs/delivery/candidates/DG1/e6979e12111aeb14.manifest.json`.
- `requirements.final_gate_ids`: `REQ-DLV-025,033,042`, `REQ-S15-002,005,006`, `REQ-S16-001,002,003,004`, `REQ-S19-004,006`.
- Finally run `node tools/gates/validate.mjs --stage DG1` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, the gate is not approved — say so and do not edit anything to make it pass.
