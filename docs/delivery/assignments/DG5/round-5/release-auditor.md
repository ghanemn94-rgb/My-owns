# DG5 release audit, part 2 of 2: decision run (release-auditor, corrected re-gate round 5)

Task ID: `T-DG5-RG2-AUDIT-D2`. You are the independent release auditor. Read D-184 to D-191 in `decisions.md` and D-192 in `progress.md` first. DG5 was re-gated twice: D-184 (after the old branch's round-8 audit BLOCKED on B1–B4, `git show ac68d1b:docs/delivery/reviews/DG5/round-8/release-auditor.json`) and D-190 (after the first re-gate branch's audit BLOCKED on B1–B3, `git show 5a7c189:docs/delivery/reviews/DG5/round-3/release-auditor.json`). Confirm that none of those defects recurs on this branch. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**Part 2 of 2 (D-140 option 1).** Your verification run `T-DG5-RG2-AUDIT-V` (`docs/delivery/reviews/DG5/round-3/release-auditor.json` and `.verifications.json`) audited this candidate, and the orchestrator imported your sidecar. Round 5 is a record-only round on the same candidate. Re-confirm each item below (your round-5 record is your detailed basis), confirm `findings.json` mirrors domain-reviewer's and your sidecars for F-DG5-120 and 121, and write the gate.

**Second decision run.** Your first decision run `T-DG5-RG2-AUDIT-D` (round 4, `docs/delivery/reviews/DG5/round-4/release-auditor.json`, gate BLOCKED) found one condition, B1: `findings.json` lacked the `acceptance` object for F-DG5-120 and 121. The orchestrator added it, in the F-DG4-148 shape (`rationale` quoting both accepting sidecars, `owner: frontend-ux-engineer`, `accepted_by: ["domain-reviewer", "release-auditor"]`); `findings.json` is meta-excluded, so the candidate is unchanged. Confirm B1 is resolved, re-confirm every item, and write the gate record afresh (it replaces the BLOCKED `docs/delivery/gates/DG5.json`).

## Candidate

- **candidate_id:** `sha256:55a411ae9f4e87473478988f3d9909752a934a547ba40acc1479f2b2bc3a24ce` (2207 files). Verify it with `node tools/gates/candidate.mjs --stage DG5 --ref 660f40c7d141b6fb73c145e0ee7a053ceb5905de` on a complete clone; after the freeze only meta-excluded records changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, and `progress.md`; `decisions.md` is unchanged since the freeze — confirm that); confirm that.
- **manifest:** `docs/delivery/candidates/DG5/55a411ae9f4e8747.manifest.json`. **source_commit:** `660f40c7d141b6fb73c145e0ee7a053ceb5905de`.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` (D-082).

## The gate's specialist reviews (all on this candidate)

- code-security-reviewer: `docs/delivery/reviews/DG5/round-2/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG5/round-2/qa-verifier.json` (PASS).
- domain-reviewer: `docs/delivery/reviews/DG5/round-3/domain-reviewer.json` (the acceptance round on the same candidate, D-192), with its full review in `docs/delivery/reviews/DG5/round-2/domain-reviewer.json`.

## Audit (all of it, independently)

1. **Clone and identity.** A complete clone; the candidate identity equals the one above; `node tools/gates/validate.mjs --historical --stage DG4` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of its round; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG5 requirement; no DG5 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.** The three specialist records above are PASS on this same candidate, and every record's `source_commit` is the full 40-hex id (B2/B3). Judge whether citing domain's round-3 acceptance record with the round-2 code-security and qa records is a sound basis (D-192, as D-183 and D-189).
4. **Findings.** Every DG5 finding in `findings.json` is terminal: `CLOSED_VERIFIED` by a non-owner, with a full 40-hex `fix_revision` that is an ancestor of this candidate (B1), or `ACCEPTED_OBSERVATION` (Low, non-mandatory). **F-DG5-120 and F-DG5-121** were judged by domain in round 3; judge each yourself. Zero unresolved Critical/High, zero unresolved mandatory violations.
5. **Write-once.** Nothing under `docs/delivery/reviews/DG5` or `docs/delivery/runs/DG5` was ever deleted or rewritten in this branch's history (B4); the validator's write-once check reports nothing.
6. **The re-gate itself (D-184, D-190).** Confirm that commit `2fe8f85` carries the product of `5a7c189` unchanged outside `docs/delivery`, that `runs/DG5` keeps every file of the base `601d7d2` byte-identical (only additions), and that the excluded paths are only DG5 review artefacts. Judge the method against the D-056 precedent.
7. **Incidents and orchestrator decisions.** D-190 (the corrected re-gate), D-191 (F-DG5-100 and 140, the BE-RG3 repair, the orchestrator's ADR-0046 docs amendment, the verification of `7bb7d93` with e2e 470/470 x2), D-192 (the acceptance round, in `progress.md`), and any restart salvage. Judge each.
8. **Requirements.** Each of the 78 `final_gate=DG5` requirements below is in qa's `requirements_checked` AND in domain's or code-security's. `node tools/gates/validate.mjs --register DG5` passes.
9. **Decisions.** D-141 to D-191 (and D-192 in `progress.md`) are recorded with rationale; quote, do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.** G1–G6 are business approvals; nothing grants a real business, Finance or IT approval or ties G1–G6 to DG0–DG7; product G6 never implies DG7; demo data is synthetic and labelled.

**The 78 DG5-final requirements:** `REQ-PB-001`, `REQ-PB-002`, `REQ-PB-011`, `REQ-PB-077`, `REQ-PB-086`, `REQ-PB-087`, `REQ-PB-088`, `REQ-PB-089`, `REQ-PB-090`, `REQ-PB-091`, `REQ-PB-092`, `REQ-PB-093`, `REQ-DLV-037`, `REQ-S01-002`, `REQ-S01-003`, `REQ-S01-004`, `REQ-S02-001`, `REQ-S02-004`, `REQ-S03-007`, `REQ-S03-010`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S08-019`, `REQ-S09-011`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-018`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-004`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-008`, `REQ-S13-009`, `REQ-S13-010`, `REQ-S14-001`, `REQ-S14-002`, `REQ-S14-003`, `REQ-S14-004`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S18-003`, `REQ-S18-004`, `REQ-S20-002`, `REQ-S20-006`, `REQ-S20-007`, `REQ-S20-015`, `REQ-S20-016`, `REQ-S21-001`.

## Records

Write `docs/delivery/reviews/DG5/round-5/release-auditor.json`, then `docs/delivery/gates/DG5.json`, using Write/Edit only. Mirror `docs/delivery/gates/DG4.json` key for key.

- `assignment` = exactly `docs/delivery/assignments/DG5/round-5/release-auditor.md`; `reviewer_role: release-auditor`, `round: 5`, `stage_id: DG5`; `source_commit` the full id above.
- Gate: `reviews` the three specialist records above; `release_audit` your round-5 record; `accepted_observations` the ids accepted by both domain-reviewer and you; `manifest_path` as above; `previous_gate: DG4`; `requirements.final_gate_ids` the 78 above; `decision` APPROVED only if every item holds, otherwise BLOCKED with `blocking_conditions`.
- Evidence under `docs/delivery/test-evidence/DG5/audit/round-5/`.

## Your own evidence cannot exist yet

Run `node tools/gates/validate.mjs --stage DG5` at the end and report its output and exit code. Record PASS only if every reported error concerns your own in-flight run_id, and list those errors. Any other error means BLOCKED.
