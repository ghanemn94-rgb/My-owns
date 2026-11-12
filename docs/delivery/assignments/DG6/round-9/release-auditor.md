# DG6 release audit: single audit and decision run (release-auditor, round 9 of the clean re-gate, part 2 of 2)

Task ID: `T-DG6-AUDIT-RG-R9`. You are the independent release auditor of the frozen **DG6** candidate (P6 "Integration and system hardening"), re-gated on a clean base. Read D-193 to D-240 in `decisions.md` first, then the D-238 sections of `progress.md` (all re-gate rounds, including the user's acceptance of F-DG6-952 on 2026-11-12). You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**Part 2 of 2 (D-140 option 1).** Part 1 (round 8, `docs/delivery/reviews/DG6/round-8/`) concurred with accepting F-DG6-952 (Low) as an observation, and the orchestrator imported that acceptance into `findings.json`. This run audits the gate in full and writes the gate record.

## Candidate

- **candidate_id:** `sha256:10f71f2418567878bffddfb004efbf342347029fd799dd3076af40aca32e2fc5` (2775 files). Verify it with `node tools/gates/candidate.mjs --stage DG6 --ref d8868b2a5c074b13c04693a88644c25ef2792583` on a complete clone. After the freeze, only meta-excluded records may have changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, `progress.md`). Confirm that, and that `decisions.md` is unchanged since the freeze.
- **manifest:** `docs/delivery/candidates/DG6/10f71f2418567878.manifest.json`.
- **source_commit:** `d8868b2a5c074b13c04693a88644c25ef2792583`.
- **Clones, not worktrees.** Work in a `git clone --no-local` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.

## The gate's specialist reviews (all on this candidate, round 7)

- domain-reviewer: `docs/delivery/reviews/DG6/round-7/domain-reviewer.json` (PASS).
- code-security-reviewer: `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG6/round-7/qa-verifier.json` (PASS).

## Audit (all of it, independently)

1. **Clone and identity.** Complete clone. The candidate identity equals the one above. `node tools/gates/validate.mjs --historical --stage DG5` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of round 7; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG6 requirement; no DG6 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.** The three records are PASS on this candidate, each `source_commit` is the full 40-hex id, and each was a full review of the candidate, not only of the D-240 delta. Check this against each record's checks and evidence.
4. **Findings.** Every DG6 finding in `findings.json` is CLOSED_VERIFIED by a non-owner, with a full 40-hex `fix_revision` that is a commit object and an ancestor of the verifying round's `source_commit`, of the verifying run's `head_commit_at_start` and of this candidate; except **F-DG6-952** (Low, not mandatory), ACCEPTED_OBSERVATION by the user's decision, the reporter (qa, round 6) and the release-auditor (round 8), which must be in the gate's `accepted_observations`. `findings.json` mirrors the sidecars. Zero unresolved Critical/High findings and zero unresolved mandatory violations. Re-run the reproductions of the last repaired defects yourself: F-DG6-990 (probe `docs/delivery/test-evidence/DG6/audit/round-4/probes/zz-aud-r4-served-dg-labels.test.ts` on the real stack) and F-DG6-911/951 (`--historical` DG1-DG5, `--pipeline`).
5. **Write-once.** Nothing under `docs/delivery/reviews/DG6`, `runs/DG6`, `candidates/DG6` or `assignments/DG6/round-*` was ever deleted or rewritten in this branch's history since its base `8480971a28373e0841d889794cfacde99d347987`; the validator's write-once check reports nothing.
6. **Incidents and orchestrator decisions.** Judge each, from history, not from this text:
   - the container-restart kills: round-2 qa, the first round-3 attempt of all three, round-5 qa (exit 143, no record; committed sidecars imported, the round lists no qa record);
   - after each import, the orchestrator recorded `fix_revision`s and set verification blocks to the sidecar the validator selects among same-round PASS verifications (rounds 3 and 7). Judge whether that is a faithful record;
   - the round-4 audit BLOCK (F-DG6-990) and its repair T-DG6-BE-RG3 (D-239); the missing FIXING entry (F-DG6-911/951) and its late fix `e7cb240e7`; the re-freeze of D-240 so that fix lies inside a candidate; the user's acceptance of F-DG6-952 recorded in `progress.md` rather than `decisions.md` (to avoid another re-freeze);
   - the user's choice of a clean re-gate (D-238).
7. **Final verification.** `test-evidence/DG6/orchestrator-final-60787d8/` is a full run on `60787d89f`. Confirm that its product tree equals this candidate's (`git diff 60787d89ffa2562d491af424bc1024b4e3bc2d57 d8868b2a5c074b13c04693a88644c25ef2792583 -- . ':!docs/delivery'` empty), and that every step's `.rc` is 0. Grep the logs yourself.
8. **Requirements.** Each of the 48 `final_gate=DG6` requirements below is in qa's `requirements_checked`, and also in domain's or code-security's. `node tools/gates/validate.mjs --register DG6` passes.
9. **Decisions.** D-193 to D-240 (and the progress.md entries for the re-gate rounds) are recorded with rationale. Quote them; do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.** G1–G6 are business approvals: nothing grants a real business, Finance or IT approval, and nothing ties G1–G6 to DG0–DG7. Product G6 never implies DG7. Demo data is synthetic and labelled. Brand tokens are provisional; nothing claims official PMI status or certification.

**The 48 DG6-final requirements:** `REQ-DLV-038`, `REQ-S01-005`, `REQ-S02-006`, `REQ-S10-002`, `REQ-S10-004`, `REQ-S12-019`, `REQ-S12-023`, `REQ-S12-024`, `REQ-S13-011`, `REQ-S13-013`, `REQ-S15-001`, `REQ-S15-003`, `REQ-S15-007`, `REQ-S15-009`, `REQ-S15-010`, `REQ-S15-011`, `REQ-S15-012`, `REQ-S15-013`, `REQ-S15-014`, `REQ-S16-006`, `REQ-S16-007`, `REQ-S16-022`, `REQ-S16-023`, `REQ-S16-026`, `REQ-S16-027`, `REQ-S16-029`, `REQ-S16-030`, `REQ-S16-032`, `REQ-S17-001`, `REQ-S17-002`, `REQ-S17-003`, `REQ-S17-005`, `REQ-S17-006`, `REQ-S17-007`, `REQ-S17-008`, `REQ-S17-009`, `REQ-S17-010`, `REQ-S17-011`, `REQ-S20-001`, `REQ-S20-012`, `REQ-S20-013`, `REQ-S20-014`, `REQ-S20-017`, `REQ-S20-020`, `REQ-S20-021`, `REQ-S20-022`, `REQ-S20-029`, `REQ-S20-030`.

## Records

Write these with Write/Edit only:

- **Your audit record:** `docs/delivery/reviews/DG6/round-9/release-auditor.json`. Mirror `docs/delivery/reviews/DG5/round-5/release-auditor.json`. `assignment` = exactly `docs/delivery/assignments/DG6/round-9/release-auditor.md`; `reviewer_role: release-auditor`, `round: 9`, `stage_id: DG6`; `source_commit` = the full id above.
- **The gate record:** `docs/delivery/gates/DG6.json` (it currently holds the round-4 BLOCKED record; replace it). Mirror `docs/delivery/gates/DG5.json` key for key. `reviews` = the three round-7 records; `release_audit` = your round-9 record; `accepted_observations` = `["F-DG6-952"]`; `manifest_path` as above; `previous_gate: DG5`; `requirements.final_gate_ids` = the 48 above; `decision` = APPROVED only if every item holds, otherwise BLOCKED with `blocking_conditions`.
- **Evidence:** under `docs/delivery/test-evidence/DG6/audit/round-9/`.
- **New findings:** ids F-DG6-996 to F-DG6-999, in a sidecar `docs/delivery/reviews/DG6/round-9/release-auditor.findings.json` in the format the round-3 reviewers used.
- **Ports:** below 32768. Your range is 32600–32699.

## Your own evidence cannot exist yet

At the end, run `node tools/gates/validate.mjs --stage DG6`. Report its output and exit code. Record PASS only if every reported error concerns your own in-flight run_id, and list those errors. Any other error means BLOCKED.
