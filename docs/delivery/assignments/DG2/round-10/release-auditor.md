# DG2 gate audit — release-auditor (round 10)

Task ID: `T-DG2-AUDIT-R10`. You are the independent release auditor. Read the three round-10 specialist records first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

## Candidate
- **candidate_id:** `sha256:7fd1a89ca090dbdea5ae9f014853684239cbf80e89dc5cce50914155cb9d484a` (544 files). Verify it with `node tools/gates/candidate.mjs --stage DG2`.
- **manifest:** `docs/delivery/candidates/DG2/7fd1a89ca090dbde.manifest.json`.
- **source_commit:** `fe22d759`.
- **Stage state** is set to **VERIFYING** before your run.

## Audit
1. **Clone and identity.**
   - Use a complete clone; if the clone is incomplete, the audit is BLOCKED.
   - The candidate identity equals the one above.
   - `node tools/gates/validate.mjs --historical --stage DG1` passes.
2. **Independence and provenance.**
   - Each round-10 specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-10 run.
   - No reviewer implemented any DG2 requirement.
   - Each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033).
3. **Verdicts.** All three round-10 specialist verdicts are PASS, on this same candidate.
4. **Findings.**
   - EVERY DG2 finding is `CLOSED_VERIFIED`.
   - F-DG2-350 and F-DG2-351 must be closed by code-security on this candidate.
   - The other 26 were closed in earlier retained rounds. For each, the round's source_commit is present and the fix commit is an ancestor of this candidate:
     - F-DG2-140, 141, 142, 143;
     - F-DG2-150, 151, 152, 160;
     - F-DG2-180, 181;
     - F-DG2-201 to 206;
     - F-DG2-210, 211, 220;
     - F-DG2-230, 231, 260, 290, 310, 320, 340.
   - No DG2 finding is OPEN or FIXED_PENDING_VERIFICATION.
   - Zero unresolved Critical/High findings.
   - Zero unresolved mandatory violations. Confirm F-DG2-140, 141, 201 and 202 (High, mandatory) and F-DG2-142, 150 and 203 (Medium, mandatory).
5. **Environmental residuals, not BLOCKED.**
   - No round-10 specialist recorded a BLOCKED check.
   - Live registry (REQ-DLV-042 AC-1, D-057), live CI (REQ-DLV-025 A24, D-058) and Keycloak (D-049) are documented residuals, with their available surface verified.
6. **Requirements.**
   - Each of the 32 `final_gate=DG2` requirements is in qa's `requirements_checked`, AND in domain's or code-security's.
   - `node tools/gates/validate.mjs --register DG2` passes.
7. **Decisions.** D-059 to D-070 are recorded with rationale. Check in particular:
   - D-062: the surgical rewrite of the round-2 ID collision, authorized by the user;
   - D-067: the unreproduced integration setup failure, later attributed to port collisions and fixed by F-DG2-310;
   - D-069: the two media-type design choices;
   - D-070: the salvage of the interrupted BE15 run. Its orphaned transcript is provenance only; the completing run BE15B is the implementer evidence.
8. **Product vs engineering gates.** Product gates G1-G6 are business approvals. Nothing in the candidate grants a real business, Finance or IT approval, or ties G1-G6 to DG0-DG7.

## Your own evidence cannot exist yet
`validate.mjs --stage DG2` reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**, and list those errors. Any other error → BLOCKED.

## Records
Write `docs/delivery/reviews/DG2/round-10/release-auditor.json`, then `docs/delivery/gates/DG2.json`, using Write/Edit only. Mirror `docs/delivery/gates/DG1.json` key for key.
- `assignment` = exactly `docs/delivery/assignments/DG2/round-10/release-auditor.md` (bare path).
- `decision`: APPROVED only if every condition above holds; otherwise BLOCKED, with `blocking_conditions`.
- `manifest_path`: `docs/delivery/candidates/DG2/7fd1a89ca090dbde.manifest.json`.
- `previous_gate`: DG1.
- `requirements.final_gate_ids`: `REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

Finally, run `node tools/gates/validate.mjs --stage DG2` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, do not approve.
