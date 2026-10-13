# DG4 gate audit: release-auditor (round 8)

Task ID: `T-DG4-AUDIT-R8`. You are the independent release auditor. Read the three round-8 specialist records first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

## Candidate

- **candidate_id:** `sha256:8014e5ceffe1f374388ff00e59775458601e0a66be40e5dfe32a10c8cd2d3804` (1475 files). Verify it with `node tools/gates/candidate.mjs --stage DG4 --ref 8553323d6938d5c5077661070ab9f8df2d8dc969`, or on a clone checked out at that commit. Records written after the freeze (D-135, this assignment, `findings.json`, `stages.json`) are not part of the frozen candidate, so a working-tree hash of a later HEAD differs by design.
- **manifest:** `docs/delivery/candidates/DG4/8014e5ceffe1f374.manifest.json`.
- **source_commit:** `8553323d6938d5c5077661070ab9f8df2d8dc969`.
- **Stage state** is set to **VERIFYING** before your run.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` on this repository (D-082).

## Audit

1. **Clone and identity.**
   - Use a complete clone; if the clone is incomplete, the audit is BLOCKED.
   - The candidate identity equals the one above.
   - `node tools/gates/validate.mjs --historical --stage DG3`, `--historical --stage DG2` and `--historical --stage DG1` pass.
2. **Independence and provenance.**
   - Each round-8 specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed round-8 run.
   - Each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033).
   - No reviewer implemented any DG4 requirement.
   - **D-082 held for DG4:** no DG4 review run (rounds 1–8) reports a non-empty `external_config_changed`. If one does, say which and judge it.
3. **Verdicts.** All three round-8 specialist verdicts are PASS, on this same candidate.
4. **Findings.** Twenty-four DG4 findings were raised. Twenty-three must be `CLOSED_VERIFIED` by a non-owner, with its fix revision an ancestor of this candidate. Check each verifying run's provenance: exit 0, an empty `external_config_changed`, and a matching sandbox.
   - **Round 1** (candidate `19656b1f`), all closed in **round 2** (candidate `3f51b79d`): F-DG4-100 (Medium), F-DG4-101 (Medium, **mandatory**), F-DG4-102 (Low), F-DG4-103 (Low) by code-security; F-DG4-120 (Low), F-DG4-121 (Medium) by domain; F-DG4-140 (Low), F-DG4-141 (Low) by qa. F-DG4-140 and F-DG4-141 were closed by the qa **re-run** `…REV-QA-R2B-…-d9f6a2c1` (D-119).
   - **Round 2**, all closed in **round 3** (candidate `890faa12`): F-DG4-104 (Medium, owner delivery-orchestrator) by code-security; F-DG4-122 (High, **mandatory**), F-DG4-123 (Medium), F-DG4-124 (Medium, owner delivery-orchestrator) by domain.
   - **Round 3**, all closed in **round 4** (candidate `5ff36f6e`): F-DG4-105 (Medium) by code-security; F-DG4-125 (High, **mandatory**), F-DG4-126 (Medium), F-DG4-127 (Medium) by domain.
   - **Round 4** (an all-PASS round in which qa raised two non-blocking findings), closed in **round 5** (candidate `69b7412a`) by qa: F-DG4-143 (Medium), F-DG4-144 (Low). They were repaired rather than accepted as observations (D-127).
   - **Round 5**, closed in **round 6** (candidate `f966fe57`): F-DG4-106 (Low) by code-security and F-DG4-145 (Low) by qa, one test-only defect (D-129, D-130).
   - **Round 6**, closed in **round 7** (candidate `baa6ff4d`, by the re-runs R7B): F-DG4-128 (Medium) by domain; F-DG4-146 and F-DG4-147 (Low) by qa (D-131 to D-133).
   - **F-DG4-148 (Low, not mandatory), raised by qa in round 6, is the one finding accepted as an observation.** It did not verify closed in round 7 (D-133). The user decided to accept it, with the load envelope in `environment.md` limitation 6 (D-134). In round 8, qa (the reporter) recorded `PASS → ACCEPTED_OBSERVATION` in its verifications sidecar, and `findings.json` mirrors it with `accepted_by` [qa-verifier, release-auditor] (D-135). **Your concurrence is required:** judge the acceptance on its merits (Low, not mandatory, no product defect, the envelope accurate and evidenced). If you concur, record `PASS → ACCEPTED_OBSERVATION` for F-DG4-148 in `docs/delivery/reviews/DG4/round-8/release-auditor.verifications.json` and list it in the gate's `accepted_observations`. If you do not concur, the gate is BLOCKED.
   - No DG4 finding is OPEN or FIXED_PENDING_VERIFICATION; F-DG4-148 is ACCEPTED_OBSERVATION as above. There are zero unresolved Critical/High findings and zero unresolved mandatory violations.
   - **F-DG4-104 / F-DG4-124 concern `stages.json`.** The fix `546fb4e` **added** a FIXING entry, dated at the D-117 commit `f5579e7`, between two existing entries; it rewrote none. Judge whether that correction is acceptable as recorded (D-119).
5. **Incidents.**
   - **Build-time restarts (D-103, D-114, D-116):** container restarts killed implementer and QA authoring runs during the build. Their material is kept for provenance under `test-evidence/DG4/*-orphaned/` (`be-g`, `be-h2`, `be-i2`, `be-i2b`, `kbe-f`, `arch-r3`, `fe-f2`, `fe-g2`, `qa-b`, `fe-r3`), and B runs completed each task. Confirm that each salvage is recorded and that no unverified WIP reached the candidate without a completing run.
   - **D-119:** the first round-2 qa run (`…REV-QA-R2-…-a13ea231`) ended with exit 143 and no record. Its material is kept for provenance under `test-evidence/DG4/qa-r2-orphaned/`, and qa was re-run on the same candidate from `round-2/qa-verifier-rerun.md`.
   - **FE-R9 (D-130):** a session restart killed the FE-R9 repair run. Its WIP was salvaged and completed by FE-R9B, and the run is kept under `test-evidence/DG4/fe-r9-orphaned/`.
   - **Round 7 (D-133):** a session restart killed all three first round-7 review runs. Their material is kept under `test-evidence/DG4/{domain,code-security,qa}-r7-orphaned/`, and all three were re-run on the same candidate from `round-7/*-rerun.md`.
   - **Round 8 (D-134)** was a confirmation round. The product code is byte-identical to round 7's candidate, and the reviewers carried forward their round-7 checks on that code, labelled as such. Judge whether that scope is adequate.
   - **D-124:** three defects were found during the round-3 repairs, before any review of this candidate, and repaired before this freeze; they were recorded as decisions, not findings. Confirm each repair is in this candidate and judge whether recording them that way is acceptable.
6. **Residuals.**
   - No round-8 specialist recorded a BLOCKED check.
   - Live registry (REQ-DLV-042 AC-1, D-057), live CI (REQ-DLV-025 A24, D-058) and Keycloak (D-049) are documented residuals, with their available surface verified.
7. **Requirements.**
   - Each of the 137 `final_gate=DG4` requirements is in qa's `requirements_checked`, AND in domain's or code-security's.
   - `node tools/gates/validate.mjs --register DG4` passes.
8. **Decisions.** D-088 to D-135 are recorded with rationale. Quote them; do not paraphrase. Check in particular:
   - D-088 to D-116: the P4 plan and the build in worktree waves, the orchestrator's integration edits, and the disclosed limitations in the register notes. Judge whether each limitation is acceptable as disclosed;
   - D-117, D-119 and D-122: every finding was repaired, none accepted as an observation; the value-basis rule (D-117, D-119, D-122) and the reviewers' acceptance of it;
   - D-118 and D-121: the orchestrator's edits at the merges (wording, a test kit, a test fixture, an e2e conditional skip replaced by an assertion). Judge whether each is wording or test-only, as claimed;
   - D-123 to D-126: the round-3 repairs, the D-124 defects and their repair;
   - D-127 to D-130: round 4, the FE-R8 repair of F-DG4-143 and F-DG4-144, round 5, and the FE-R9 kill and salvage;
   - D-131 to D-135: round 6 (including F-DG4-128, a real product defect), the BE-R6 and FE-R10 repairs, round 7, the user's decision on F-DG4-148, and round 8.
9. **Evidence honesty (DG2 round-10 audit condition 1).** Every round-8 specialist record discloses and explains each non-zero exit, failed suite or hook timeout in the logs it cites. Grep the cited logs yourself, at least every round-8 log.
10. **Product vs engineering gates.** Product gates G1–G6 are business approvals. Nothing in the candidate grants a real business, Finance or IT approval, or ties G1–G6 to DG0–DG7. Product G6 never implies DG7. G5 and G6 approvals in the evidence are synthetic demo decisions.

## Your own evidence cannot exist yet

`validate.mjs --stage DG4` reports errors about your own in-flight run_id. Record PASS **only if every reported error concerns your own in-flight run_id**, and list those errors. Any other error means BLOCKED.

## Records

Write `docs/delivery/reviews/DG4/round-8/release-auditor.json`, then `docs/delivery/gates/DG4.json`, using Write/Edit only. Mirror `docs/delivery/gates/DG3.json` key for key.

- `assignment` = exactly `docs/delivery/assignments/DG4/round-8/release-auditor.md` (bare path).
- `decision`: APPROVED only if every condition above holds; otherwise BLOCKED, with `blocking_conditions`.
- `manifest_path`: `docs/delivery/candidates/DG4/8014e5ceffe1f374.manifest.json`.
- `previous_gate`: DG3.
- `requirements.final_gate_ids`: `REQ-PB-005, REQ-PB-008, REQ-PB-009, REQ-PB-010, REQ-PB-013, REQ-PB-014, REQ-PB-015, REQ-PB-020, REQ-PB-021, REQ-PB-044, REQ-PB-058, REQ-PB-060, REQ-PB-061, REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-PB-065, REQ-PB-066, REQ-PB-067, REQ-PB-068, REQ-PB-069, REQ-PB-070, REQ-PB-071, REQ-PB-072, REQ-PB-073, REQ-PB-074, REQ-PB-075, REQ-PB-076, REQ-PB-078, REQ-PB-079, REQ-PB-080, REQ-PB-081, REQ-PB-082, REQ-PB-083, REQ-PB-084, REQ-PB-085, REQ-DLV-036, REQ-S03-001, REQ-S03-002, REQ-S03-003, REQ-S03-004, REQ-S03-005, REQ-S03-006, REQ-S03-008, REQ-S03-009, REQ-S03-011, REQ-S04-001, REQ-S04-002, REQ-S04-007, REQ-S04-008, REQ-S04-009, REQ-S04-010, REQ-S04-012, REQ-S04-013, REQ-S04-014, REQ-S07-001, REQ-S07-002, REQ-S07-003, REQ-S07-004, REQ-S07-005, REQ-S07-006, REQ-S07-007, REQ-S07-008, REQ-S07-009, REQ-S07-010, REQ-S07-011, REQ-S07-012, REQ-S07-013, REQ-S07-014, REQ-S07-015, REQ-S07-017, REQ-S08-001, REQ-S08-002, REQ-S08-003, REQ-S08-004, REQ-S08-006, REQ-S08-008, REQ-S08-009, REQ-S08-010, REQ-S08-011, REQ-S08-013, REQ-S08-014, REQ-S08-015, REQ-S08-016, REQ-S08-017, REQ-S08-018, REQ-S09-007, REQ-S09-009, REQ-S09-010, REQ-S10-003, REQ-S10-005, REQ-S10-006, REQ-S10-007, REQ-S10-008, REQ-S10-009, REQ-S10-010, REQ-S10-011, REQ-S10-012, REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018, REQ-S10-019, REQ-S11-001, REQ-S11-002, REQ-S11-004, REQ-S11-005, REQ-S11-006, REQ-S11-007, REQ-S11-008, REQ-S11-009, REQ-S12-005, REQ-S12-006, REQ-S12-009, REQ-S12-010, REQ-S12-011, REQ-S12-014, REQ-S12-016, REQ-S13-001, REQ-S13-002, REQ-S13-003, REQ-S15-008, REQ-S16-005, REQ-S16-011, REQ-S16-014, REQ-S16-017, REQ-S16-018, REQ-S16-019, REQ-S16-020, REQ-S16-025, REQ-S20-003, REQ-S20-004, REQ-S20-005, REQ-S20-008, REQ-S20-009, REQ-S20-010, REQ-S20-011`.

Finally, run `node tools/gates/validate.mjs --stage DG4` and report its output and exit code. If it fails for any reason other than your own in-flight run_id, do not approve.
