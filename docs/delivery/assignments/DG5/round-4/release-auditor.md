# DG5 release audit, part 1 of 2: verification run (release-auditor, re-gate round 4)

Task ID: `T-DG5-RG-AUDIT-V`. You are the independent release auditor. Read D-184 to D-189 first. DG5 was re-gated on a clean base (D-184) after your predecessor's round-8 audit on the old branch BLOCKED on record defects B1–B4 (old branch `claude/mobily-transformation-platform-regate`, `git show ac68d1b:docs/delivery/reviews/DG5/round-8/release-auditor.json`); confirm that none of B1–B4 recurs on this branch. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**Part 1 of 2 (D-140 option 1).** This is the verification run. Write your audit record and your own acceptance sidecar; do NOT write the gate record. The orchestrator imports your sidecar, then a separate decision run (round 5) writes the gate.

## Candidate

- **candidate_id:** `sha256:d8d831814a6065af8b417c862486dc2132ee6cca40bae0573f4918ff52e782c9` (2203 files). Verify it with `node tools/gates/candidate.mjs --stage DG5 --ref 54e02b61961550386d5ab24a74e8ae8bb612218f` on a complete clone; after the freeze only meta-excluded records changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, and `decisions.md` D-189); confirm that.
- **manifest:** `docs/delivery/candidates/DG5/d8d831814a6065af.manifest.json`. **source_commit:** `54e02b61961550386d5ab24a74e8ae8bb612218f`.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` (D-082).

## The gate's specialist reviews (all on this candidate)

- domain-reviewer: `docs/delivery/reviews/DG5/round-3/domain-reviewer.json` (PASS).
- code-security-reviewer: `docs/delivery/reviews/DG5/round-3/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG5/round-4/qa-verifier.json` (the acceptance round on the same candidate, D-189), with its full review in `docs/delivery/reviews/DG5/round-3/qa-verifier.json`.

## Audit (all of it, independently)

1. **Clone and identity.** A complete clone; the candidate identity equals the one above; `node tools/gates/validate.mjs --historical --stage DG4` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of its round; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG5 requirement; no DG5 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.** The three specialist records above are PASS on this same candidate, and every record's `source_commit` is the full 40-hex id (B2/B3). Judge whether citing qa's round-4 acceptance record with the round-3 domain and code-security records is a sound basis (D-189, as D-183).
4. **Findings.** Every DG5 finding in `findings.json` is terminal: `CLOSED_VERIFIED` by a non-owner, with a full 40-hex `fix_revision` that is an ancestor of this candidate (B1), or `ACCEPTED_OBSERVATION` (Low, non-mandatory). **F-DG5-145 and F-DG5-146** were judged by qa in round 4; judge each yourself. Zero unresolved Critical/High, zero unresolved mandatory violations.
5. **Write-once.** Nothing under `docs/delivery/reviews/DG5` or `docs/delivery/runs/DG5` was ever deleted or rewritten in this branch's history (B4); the validator's write-once check reports nothing.
6. **The re-gate itself (D-184).** Confirm that commit `270ebbf` carries the product of `ac68d1b` unchanged outside `docs/delivery`, and that the excluded paths are only DG5 review artefacts. Judge the method against the D-056 precedent.
7. **Incidents and orchestrator decisions.** D-185 (eight findings, all repaired), D-186 (the user-approved skip of the pre-freeze e2e run) and D-187 (the F-DG5-143 failure that followed), D-188 (full verification, e2e 470/470 x2), D-189 (the acceptance round; the round-2 assignment path typo), and any restart salvage. Judge each.
8. **Requirements.** Each of the 78 `final_gate=DG5` requirements below is in qa's `requirements_checked` AND in domain's or code-security's. `node tools/gates/validate.mjs --register DG5` passes.
9. **Decisions.** D-141 to D-189 are recorded with rationale; quote, do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.** G1–G6 are business approvals; nothing grants a real business, Finance or IT approval or ties G1–G6 to DG0–DG7; product G6 never implies DG7; demo data is synthetic and labelled.

**The 78 DG5-final requirements:** `REQ-PB-001`, `REQ-PB-002`, `REQ-PB-011`, `REQ-PB-077`, `REQ-PB-086`, `REQ-PB-087`, `REQ-PB-088`, `REQ-PB-089`, `REQ-PB-090`, `REQ-PB-091`, `REQ-PB-092`, `REQ-PB-093`, `REQ-DLV-037`, `REQ-S01-002`, `REQ-S01-003`, `REQ-S01-004`, `REQ-S02-001`, `REQ-S02-004`, `REQ-S03-007`, `REQ-S03-010`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S08-019`, `REQ-S09-011`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-018`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-004`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-008`, `REQ-S13-009`, `REQ-S13-010`, `REQ-S14-001`, `REQ-S14-002`, `REQ-S14-003`, `REQ-S14-004`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S18-003`, `REQ-S18-004`, `REQ-S20-002`, `REQ-S20-006`, `REQ-S20-007`, `REQ-S20-015`, `REQ-S20-016`, `REQ-S21-001`.

## Records

- `docs/delivery/reviews/DG5/round-4/release-auditor.verifications.json` = `{ "verifications": [ ... ] }` with one entry each for F-DG5-145 and F-DG5-146: `result: "PASS", status_after: "ACCEPTED_OBSERVATION"` if you independently accept it (rationale and DG6 follow-up in `note`), otherwise `result: "FAIL", status_after: "OPEN"`.
- `docs/delivery/reviews/DG5/round-4/release-auditor.json`: your audit record, mirroring `docs/delivery/reviews/DG4/round-10/release-auditor.json`; `assignment` = exactly `docs/delivery/assignments/DG5/round-4/release-auditor.md`; `reviewer_role: release-auditor`, `round: 4`, `stage_id: DG5`; `source_commit` the full id above; `verdict` PASS only if every item holds apart from the gate record that does not exist yet, otherwise BLOCKED with the blocking conditions.
- **Do not write `docs/delivery/gates/DG5.json`.**
- Evidence under `docs/delivery/test-evidence/DG5/audit/round-4/`.

## Validator

Run `node tools/gates/validate.mjs --stage DG5` at the end and report its output and exit code. Expected errors: the missing gate record, your own in-flight run_id, and F-DG5-145/146 lacking your acceptance (not imported yet); list them. Any other error is BLOCKED.
