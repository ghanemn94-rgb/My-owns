# DG2 gate audit — release-auditor (round 17)

Task ID: `T-DG2-AUDIT-R17`. You are the independent release auditor. Read the three round-17 specialist records first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

## Candidate
- **candidate_id:** `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750` (564 files). Verify it with `node tools/gates/candidate.mjs --stage DG2`.
- **manifest:** `docs/delivery/candidates/DG2/ddaab3cc264b0e13.manifest.json`.
- **source_commit:** `805da3e2`.
- **Stage state** is set to **VERIFYING** before your run.

## Audit
1. **Clone and identity.**
   - Use a complete clone; if the clone is incomplete, the audit is BLOCKED.
   - The candidate identity equals the one above.
   - `node tools/gates/validate.mjs --historical --stage DG1` passes.
2. **Independence and provenance.**
   - Each round-17 specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-17 run.
   - No reviewer implemented any DG2 requirement.
   - Each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033).
3. **Verdicts.** All three round-17 specialist verdicts are PASS, on this same candidate.
4. **Findings.**
   - EVERY DG2 finding is `CLOSED_VERIFIED`.
   - **F-DG2-530** (Low) must be closed on this candidate by code-security. Its round-16 verification FAILED, and the round-17 fix is FE15.
   - **F-DG2-570** (Low) must be closed on this candidate by the domain reviewer, and **F-DG2-580** (Low) by qa.
   - D-077 documents a 2 s residual that FE15 left open deliberately. Confirm that the closing reviewers considered it.
   - **F-DG2-410** is your round-10 connection-holding defect. It was raised and verified by code-security in round 11 on candidate `23e6c0a2`; the fix preceded the freeze (D-071). Confirm three things:
     - the record is honest: reproduced at `7fd1a89c`, fixed by BE16 `258b7e5`, verified by a non-author;
     - `fix_revision` is an ancestor of this candidate;
     - your own reproduction (`docs/delivery/test-evidence/DG2/audit/round-10/`) no longer reproduces on this candidate.
   - The other 36 were closed in earlier retained rounds. For each, the round's source_commit is present and the fix commit is an ancestor of this candidate:
     - F-DG2-140, 141, 142, 143;
     - F-DG2-150, 151, 152, 160;
     - F-DG2-180, 181;
     - F-DG2-201 to 206 (F-DG2-206's owner record was corrected to the fix author in D-071; check it against `ee46813`);
     - F-DG2-210, 211, 220;
     - F-DG2-230, 231, 260, 290, 310, 320, 340, 350, 351;
     - F-DG2-411, 412 (closed in round 12 by code-security) and 430 (closed in round 12 by qa);
     - F-DG2-440, 441 (closed in round 13 by code-security) and 460 (closed in round 13 by qa);
     - F-DG2-480 (High, non-mandatory; closed in round 14 by the domain reviewer);
     - F-DG2-500 (Medium; closed in round 15 by code-security).
   - No DG2 finding is OPEN or FIXED_PENDING_VERIFICATION.
   - Zero unresolved Critical/High findings.
   - Zero unresolved mandatory violations. Confirm F-DG2-140, 141, 201 and 202 (High, mandatory) and F-DG2-142, 150 and 203 (Medium, mandatory).
5. **Environmental residuals, not BLOCKED.**
   - No round-17 specialist recorded a BLOCKED check.
   - Live registry (REQ-DLV-042 AC-1, D-057), live CI (REQ-DLV-025 A24, D-058) and Keycloak (D-049) are documented residuals, with their available surface verified.
6. **Requirements.**
   - Each of the 32 `final_gate=DG2` requirements is in qa's `requirements_checked`, AND in domain's or code-security's.
   - `node tools/gates/validate.mjs --register DG2` passes.
7. **Decisions.** D-059 to D-077 are recorded with rationale. Check in particular:
   - D-062: the surgical rewrite of the round-2 ID collision, authorized by the user;
   - D-067: the unreproduced integration setup failure, later attributed to port collisions and fixed by F-DG2-310;
   - D-069: the two media-type design choices;
   - D-070: the salvage of the interrupted BE15 run. Its orphaned transcript is provenance only; the completing run BE15B is the implementer evidence;
   - D-071: your round-10 BLOCKED decision and how each condition was resolved;
   - D-072: the round-12 repairs (BE17 three-phase upload and pool bounds; FE9 pure updaters) and the ADR-0007 §5b 503 note;
   - D-073: BE18A (commit-time re-authorisation, OIDC discovery outside transactions, shutdown in-flight tracking, `.part` sweep);
   - D-074: FE10/FE11/FE12 (one session-end rule; language-not-saved notice in the chosen language, translated at render time);
   - D-075: FE13 (cache reset wherever the session ends, identity-change purge) and the salvage of the interrupted round-14 qa run. Its orphaned material is provenance only; the qa-verifier-rerun run is the round-14 qa record;
   - D-076: FE14 (an identity generation, so an answer to a request sent under one identity never lands after the tab moves to another; /me first on refocus);
   - D-077: FE15 (session-bound actions, /me confirmed before page data on navigation) and its declared 2 s residual for non-navigation GETs. Judge whether the residual is acceptable as declared. It is not a finding unless a specialist raised one; if you believe it needs one, record BLOCKED with the reason.
8. **Your round-10 blocking conditions are resolved.** Check each against the evidence:
   1. Every round-17 specialist record, and each round-11 to round-16 record whose closure this gate relies on, discloses and explains each non-zero exit, failed suite or hook timeout in the logs it cites. Grep the cited logs yourself (at least every round-17 log).
   2. The connection-holding defect has a finding ID, a severity and a mandatory classification. It is repaired and verified by a non-author on this candidate. It is F-DG2-410; see point 4.
   3. `validate.mjs` no longer reports F-DG2-206.
9. **Product vs engineering gates.** Product gates G1-G6 are business approvals. Nothing in the candidate grants a real business, Finance or IT approval, or ties G1-G6 to DG0-DG7.

## Your own evidence cannot exist yet
`validate.mjs --stage DG2` reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**, and list those errors. Any other error → BLOCKED.

## Records
Write `docs/delivery/reviews/DG2/round-17/release-auditor.json`, then `docs/delivery/gates/DG2.json`, using Write/Edit only. Mirror `docs/delivery/gates/DG1.json` key for key.
- `assignment` = exactly `docs/delivery/assignments/DG2/round-17/release-auditor.md` (bare path).
- `decision`: APPROVED only if every condition above holds; otherwise BLOCKED, with `blocking_conditions`.
- `manifest_path`: `docs/delivery/candidates/DG2/ddaab3cc264b0e13.manifest.json`.
- `previous_gate`: DG1.
- `requirements.final_gate_ids`: `REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-027, REQ-PB-028, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-DLV-034, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003, REQ-S10-001, REQ-S13-012, REQ-S16-013`.

Finally, run `node tools/gates/validate.mjs --stage DG2` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, do not approve.
