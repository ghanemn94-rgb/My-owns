# DG6 release audit: single audit and decision run (release-auditor, round 13)

Task ID: `T-DG6-AUDIT-R13`. You are the independent release auditor of the frozen **DG6** candidate (P6 "Integration and system hardening"). Read D-193 to D-236 in `decisions.md` and D-237 in `progress.md` first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**A single run (D-237).** All 52 DG6 findings are CLOSED_VERIFIED, and none awaits your acceptance. So this one run writes both your audit record and the gate record. Judge whether this single-run form is sound against D-140 option 1, whose two parts existed to import the auditor's acceptance sidecar before the gate was written. If you judge that it is not sound, the decision is BLOCKED and you say why.

## Candidate

- **candidate_id:** `sha256:c05864ba65f6319c0e9501cd80216a8d3f775eb07c7853744ecb8c1314f5023c` (2769 files). Verify it with `node tools/gates/candidate.mjs --stage DG6 --ref 2495e036c4d933788044756ab3c41415e3873cf3` on a complete clone. After the freeze, only meta-excluded records changed: assignments, reviews, runs, test evidence, `findings.json`, `stages.json` and `progress.md`. Confirm that, and confirm that `decisions.md` is unchanged since the freeze.
- **manifest:** `docs/delivery/candidates/DG6/c05864ba65f6319c.manifest.json`.
- **source_commit:** `2495e036c4d933788044756ab3c41415e3873cf3`.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## The gate's specialist reviews (all on this candidate, round 12)

- domain-reviewer: `docs/delivery/reviews/DG6/round-12/domain-reviewer.json` (PASS).
- code-security-reviewer: `docs/delivery/reviews/DG6/round-12/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG6/round-12/qa-verifier.json` (PASS).

## Audit (all of it, independently)

1. **Clone and identity.** Use a complete clone. Confirm the candidate identity equals the one above. `node tools/gates/validate.mjs --historical --stage DG5` must pass.
2. **Independence and provenance.**
   - Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of round 12.
   - Each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033).
   - No reviewer implemented any DG6 requirement.
   - No DG6 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.**
   - The three records above are PASS on this same candidate.
   - Every record's `source_commit` is the full 40-hex id.
   - Each review was a full review of the candidate, not only of the round-11 diff. Check this against each record's checks and evidence.
4. **Findings.** Every DG6 finding in `findings.json` (52) must be `CLOSED_VERIFIED`:
   - by a non-owner;
   - with a full 40-hex `fix_revision` that is an ancestor of this candidate.

   Check that `findings.json` mirrors the reviewers' sidecars and verification files. There must be zero unresolved Critical/High findings and zero unresolved mandatory violations. Re-run the reproduction of at least the last repaired finding (F-DG6-700/740) yourself, on the real stack, to confirm it no longer reproduces.
5. **Write-once.**
   - Nothing under `docs/delivery/reviews/DG6` or `docs/delivery/runs/DG6` was ever deleted or rewritten in this branch's history.
   - The validator's write-once check reports nothing.
6. **Incidents and orchestrator decisions.** Judge each of these:
   - container restarts and salvage: D-216 (BE-Z7 and its continuation BE-Z7B), D-231 (the round-9 code-security and QA reviews killed; their partial output was never committed; confirm this from history), and the V15 restart recorded in `test-evidence/DG6/orchestrator-final-4288d7c/README.md`;
   - the orchestrator's own document edits, such as the ADR-0051 amendment with FE-Z16 (D-235);
   - the decision to repair rather than accept F-DG6-700/740 (D-235).
7. **Final verification.** `test-evidence/DG6/orchestrator-final-4288d7c/` is a full run on `4288d7c0b`, whose product tree must equal the candidate's. Confirm that, and that every step's `.rc` is 0. Grep the logs yourself.
8. **Requirements.**
   - Each of the 48 `final_gate=DG6` requirements below is in qa's `requirements_checked`, and also in domain's or code-security's.
   - `node tools/gates/validate.mjs --register DG6` passes.
9. **Decisions.** D-193 to D-236, and D-237 in `progress.md`, are recorded with rationale. Quote them; do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.**
    - G1–G6 are business approvals. Nothing grants a real business, Finance or IT approval, and nothing ties G1–G6 to DG0–DG7.
    - Product G6 never implies DG7.
    - Demo data is synthetic and labelled.
    - Brand tokens are provisional; nothing claims official PMI status or certification.

**The 48 DG6-final requirements:** .

## Records

Write these with Write/Edit only:

- **Your audit record:** `docs/delivery/reviews/DG6/round-13/release-auditor.json`. Mirror `docs/delivery/reviews/DG5/round-5/release-auditor.json`.
  - `assignment` = exactly `docs/delivery/assignments/DG6/round-13/release-auditor.md`.
  - `reviewer_role: release-auditor`, `round: 13`, `stage_id: DG6`.
  - `source_commit` = the full id above.
- **The gate record:** `docs/delivery/gates/DG6.json`. Mirror `docs/delivery/gates/DG5.json` key for key.
  - `reviews` = the three round-12 records.
  - `release_audit` = your round-13 record.
  - `accepted_observations` = `[]`.
  - `manifest_path` = as above.
  - `previous_gate: DG5`.
  - `requirements.final_gate_ids` = the 48 above.
  - `decision` = APPROVED only if every item holds. Otherwise BLOCKED, with `blocking_conditions`.
- **Evidence:** under `docs/delivery/test-evidence/DG6/audit/round-13/`.
- **New findings:** if you raise any, use ids F-DG6-820 to F-DG6-839, in a sidecar `docs/delivery/reviews/DG6/round-13/release-auditor.findings.json` in the format the round-12 reviewers used.
- **Ports:** below 32768. Your range is 32600–32699.

## Your own evidence cannot exist yet

At the end, run `node tools/gates/validate.mjs --stage DG6`. Report its output and exit code. Record PASS only if every reported error concerns your own in-flight run_id, and list those errors. Any other error means BLOCKED.
