# DG6 release audit: single audit and decision run (release-auditor, round 4 of the clean re-gate)

Task ID: `T-DG6-AUDIT-RG-R4`. You are the independent release auditor of the frozen **DG6** candidate (P6 "Integration and system hardening"), re-gated on a clean base. Read D-193 to D-238 in `decisions.md` first, then the D-238 sections of `progress.md` (round 1 to round 3 of the re-gate). You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**A single run.** Every DG6 finding of this branch is CLOSED_VERIFIED and none awaits your acceptance. So this one run writes both your audit record and the gate record. Judge whether this single-run form is sound against D-140 option 1, whose two parts existed only to import an auditor's acceptance sidecar before the gate was written. If you judge it is not sound, the decision is BLOCKED and you say why.

## Candidate

- **candidate_id:** `sha256:32e41b5581a9beeba357a6c0dd5b50c414226910232ebfbb711c2178024376b5` (2773 files). Verify it with `node tools/gates/candidate.mjs --stage DG6 --ref f56f1b3d24c00d1803f6627c99b3f422a47b3014` on a complete clone. After the freeze, only meta-excluded records may have changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, `progress.md`). Confirm that, and that `decisions.md` is unchanged since the freeze.
- **manifest:** `docs/delivery/candidates/DG6/32e41b5581a9beeb.manifest.json`.
- **source_commit:** `f56f1b3d24c00d1803f6627c99b3f422a47b3014`.
- **Clones, not worktrees.** Work in a `git clone --no-local` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## The gate's specialist reviews (all on this candidate, round 3)

- domain-reviewer: `docs/delivery/reviews/DG6/round-3/domain-reviewer.json` (PASS).
- code-security-reviewer: `docs/delivery/reviews/DG6/round-3/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG6/round-3/qa-verifier.json` (PASS).

## Audit (all of it, independently)

1. **Clone and identity.** Complete clone. The candidate identity equals the one above. `node tools/gates/validate.mjs --historical --stage DG5` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of round 3; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG6 requirement; no DG6 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.** The three records are PASS on this candidate, each `source_commit` is the full 40-hex id, and each was a full review of the candidate, not only of the round-2 repair. Check this against each record's checks and evidence.
4. **Findings.** Every DG6 finding in `findings.json` is CLOSED_VERIFIED by a non-owner, with a full 40-hex `fix_revision` that is a commit object and an ancestor of the verifying round's `source_commit`, of the verifying run's `head_commit_at_start` and of this candidate. `findings.json` mirrors the reviewers' sidecars. Zero unresolved Critical/High findings and zero unresolved mandatory violations. Re-run the reproduction of the last repaired defect (F-DG6-960/970/980: a withheld assistant answer re-sent to the model as conversation history) yourself on the real stack and confirm it no longer reproduces.
5. **Write-once.** Nothing under `docs/delivery/reviews/DG6`, `runs/DG6`, `candidates/DG6` or `assignments/DG6/round-*` was ever deleted or rewritten in this branch's history since its base `8480971a28373e0841d889794cfacde99d347987`; the validator's write-once check reports nothing.
6. **Incidents and orchestrator decisions.** Judge each, from history, not from this text:
   - the round-2 qa-verifier run killed by a container restart (exit 143, no record). Its committed findings sidecar was imported (F-DG6-980), its verifications sidecar was not, and `stages.json` round 2 lists no qa record;
   - the first round-3 attempt of all three reviewers killed by a container restart. The interrupted run directories were committed, partial evidence was moved under `test-evidence/DG6/{code-security,qa}/round-3-interrupted-20261111`, and the three were relaunched with the same task ids;
   - after the round-3 import, the orchestrator recorded `fix_revision` for F-DG6-900/920/960/970/971/980 and set the verification block of 960/970/971/980 to the code-security-reviewer round-3 sidecar, the one the validator selects among three same-round PASS verifications. Judge whether that is a faithful record;
   - the user's choice of a clean re-gate (D-238), and that the final product of the old branch was carried unchanged at the re-gate base.
7. **Final verification.** `test-evidence/DG6/orchestrator-final-a0cf22b/` is a full run on `a0cf22bba`. Confirm that its product tree equals this candidate's (only meta-excluded paths may differ), and that every step's `.rc` is 0. Grep the logs yourself.
8. **Requirements.** Each of the 48 `final_gate=DG6` requirements below is in qa's `requirements_checked`, and also in domain's or code-security's. `node tools/gates/validate.mjs --register DG6` passes.
9. **Decisions.** D-193 to D-238 (and the progress.md entries for the re-gate rounds) are recorded with rationale. Quote them; do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.** G1–G6 are business approvals: nothing grants a real business, Finance or IT approval, and nothing ties G1–G6 to DG0–DG7. Product G6 never implies DG7. Demo data is synthetic and labelled. Brand tokens are provisional; nothing claims official PMI status or certification.

**The 48 DG6-final requirements:** `REQ-DLV-038`, `REQ-S01-005`, `REQ-S02-006`, `REQ-S10-002`, `REQ-S10-004`, `REQ-S12-019`, `REQ-S12-023`, `REQ-S12-024`, `REQ-S13-011`, `REQ-S13-013`, `REQ-S15-001`, `REQ-S15-003`, `REQ-S15-007`, `REQ-S15-009`, `REQ-S15-010`, `REQ-S15-011`, `REQ-S15-012`, `REQ-S15-013`, `REQ-S15-014`, `REQ-S16-006`, `REQ-S16-007`, `REQ-S16-022`, `REQ-S16-023`, `REQ-S16-026`, `REQ-S16-027`, `REQ-S16-029`, `REQ-S16-030`, `REQ-S16-032`, `REQ-S17-001`, `REQ-S17-002`, `REQ-S17-003`, `REQ-S17-005`, `REQ-S17-006`, `REQ-S17-007`, `REQ-S17-008`, `REQ-S17-009`, `REQ-S17-010`, `REQ-S17-011`, `REQ-S20-001`, `REQ-S20-012`, `REQ-S20-013`, `REQ-S20-014`, `REQ-S20-017`, `REQ-S20-020`, `REQ-S20-021`, `REQ-S20-022`, `REQ-S20-029`, `REQ-S20-030`.

## Records

Write these with Write/Edit only:

- **Your audit record:** `docs/delivery/reviews/DG6/round-4/release-auditor.json`. Mirror `docs/delivery/reviews/DG5/round-5/release-auditor.json`. `assignment` = exactly `docs/delivery/assignments/DG6/round-4/release-auditor.md`; `reviewer_role: release-auditor`, `round: 4`, `stage_id: DG6`; `source_commit` = the full id above.
- **The gate record:** `docs/delivery/gates/DG6.json` (it currently holds the BLOCKED record carried from the old branch; replace it). Mirror `docs/delivery/gates/DG5.json` key for key. `reviews` = the three round-3 records; `release_audit` = your round-4 record; `accepted_observations` = `[]`; `manifest_path` as above; `previous_gate: DG5`; `requirements.final_gate_ids` = the 48 above; `decision` = APPROVED only if every item holds, otherwise BLOCKED with `blocking_conditions`.
- **Evidence:** under `docs/delivery/test-evidence/DG6/audit/round-4/`.
- **New findings:** ids F-DG6-990 to F-DG6-999, in a sidecar `docs/delivery/reviews/DG6/round-4/release-auditor.findings.json` in the format the round-3 reviewers used.
- **Ports:** below 32768. Your range is 32600–32699.

## Your own evidence cannot exist yet

At the end, run `node tools/gates/validate.mjs --stage DG6`. Report its output and exit code. Record PASS only if every reported error concerns your own in-flight run_id, and list those errors. Any other error means BLOCKED.
