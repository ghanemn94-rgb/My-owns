# DG5 release audit, part 1 of 2: verification run (release-auditor, round 8)

Task ID: `T-DG5-AUDIT-V`. You are the independent release auditor. Per **D-140 option 1** (D-176), the audit runs in two parts: **this verification run** (you audit, and you record your own judgement of the open acceptances in a sidecar), then the orchestrator imports your sidecar into `findings.json`, then a **separate decision run** (round 9) writes the gate record. Read D-183 first. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

## Candidate

- **candidate_id:** `sha256:33188e9e698fd11bb80cc95c3ccb865f24f83df1451f7c46788ec9b1e51c7f47` (2194 files). Verify it with `node tools/gates/candidate.mjs --stage DG5 --ref 12dc33e4f9f2f804aeb0a9774a988d699709a235` on a complete clone. After the freeze only meta-excluded records changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`) plus `decisions.md` D-183, which the validator handles by recomputing from the source commit; confirm that.
- **manifest:** `docs/delivery/candidates/DG5/33188e9e698fd11b.manifest.json`. **source_commit:** `12dc33e4f9f2f804aeb0a9774a988d699709a235`.
- **Clones, not worktrees.** Work in a `git clone` under your private `$TMPDIR`. Never run `git worktree add` (D-082).

## The gate's specialist reviews (all on this candidate)

- domain-reviewer: `docs/delivery/reviews/DG5/round-7/domain-reviewer.json` (PASS; run `T-DG5-REV-DOM-R7C`).
- code-security-reviewer: `docs/delivery/reviews/DG5/round-7/code-security-reviewer.json` (PASS; run `T-DG5-REV-SEC-R7`).
- qa-verifier: `docs/delivery/reviews/DG5/round-8/qa-verifier.json` (PASS; run `T-DG5-REV-QA-R8`, the acceptance round on the same candidate, D-183), with its full review in `docs/delivery/reviews/DG5/round-7/qa-verifier.json` (run `T-DG5-REV-QA-R7C`).
## Audit (all of it, independently)

1. **Clone and identity.** A complete clone; the candidate identity equals the one above; `node tools/gates/validate.mjs --historical --stage DG4` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of its round; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG5 requirement; no DG5 review run reports a non-empty `external_config_changed` (D-082), or say which and judge it.
3. **Verdicts.** The three specialist verdicts above are PASS on this same candidate. Judge whether citing qa's round-8 record (an acceptance round on the unchanged candidate that cites its round-7 evidence, D-183) together with domain's and code-security's round-7 records is a sound basis for the gate.
4. **Findings.** Read every DG5 finding in `docs/delivery/findings.json`. Every one must be terminal: `CLOSED_VERIFIED` by a non-owner with a `fix_revision` that is an ancestor of this candidate, or `ACCEPTED_OBSERVATION` (Low, non-mandatory). Zero unresolved Critical/High findings, zero unresolved mandatory violations.
   - **F-DG5-125, F-DG5-150 and F-DG5-151** (Low, non-mandatory) were accepted as observations by qa in round 8. Judge each one yourself (reproduce or inspect as needed). Each needs a DG6 carry-forward.
5. **Incidents.** Container restarts and other interruptions during DG5 (D-164 to D-183): orphaned runs and evidence (`*-orphaned`), WIP salvages (FE-Z1, FE-AB2), the D-176 sandbox setting, the D-181 picker defect found by the orchestrator's verification, and the D-182 unexplained e2e failure (qa's F-DG5-151). Confirm each is recorded, that no unverified WIP reached the candidate, and judge each.
6. **Residuals.** No specialist recorded an unexplained BLOCKED check; documented environmental residuals are listed as such.
7. **Requirements.** Each of the 78 `final_gate=DG5` requirements below is in qa's `requirements_checked` AND in domain's or code-security's. `node tools/gates/validate.mjs --register DG5` passes.
8. **Decisions.** D-141 to D-183 are recorded with rationale. Quote them; do not paraphrase. Judge in particular the orchestrator's own edits (D-179 `d2f4579`, earlier comment-only edits), D-176 (sandbox setting, user-approved), D-180/D-181 (fix rather than accept), D-183 (the acceptance round).
9. **Evidence honesty (DG2 round-10 audit condition 1).** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
10. **Product vs engineering gates.** Product gates G1–G6 are business approvals; nothing grants a real business, Finance or IT approval, or ties G1–G6 to DG0–DG7. Product G6 never implies DG7. Demo data is synthetic and labelled.

**The 78 DG5-final requirements:** `REQ-PB-001`, `REQ-PB-002`, `REQ-PB-011`, `REQ-PB-077`, `REQ-PB-086`, `REQ-PB-087`, `REQ-PB-088`, `REQ-PB-089`, `REQ-PB-090`, `REQ-PB-091`, `REQ-PB-092`, `REQ-PB-093`, `REQ-DLV-037`, `REQ-S01-002`, `REQ-S01-003`, `REQ-S01-004`, `REQ-S02-001`, `REQ-S02-004`, `REQ-S03-007`, `REQ-S03-010`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S08-019`, `REQ-S09-011`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-018`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-004`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-008`, `REQ-S13-009`, `REQ-S13-010`, `REQ-S14-001`, `REQ-S14-002`, `REQ-S14-003`, `REQ-S14-004`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S18-003`, `REQ-S18-004`, `REQ-S20-002`, `REQ-S20-006`, `REQ-S20-007`, `REQ-S20-015`, `REQ-S20-016`, `REQ-S21-001`.

## What this run writes (and does not)

- `docs/delivery/reviews/DG5/round-8/release-auditor.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }` with one entry for each of F-DG5-125, 150 and 151: `result: "PASS", status_after: "ACCEPTED_OBSERVATION"` if you independently accept it (rationale and DG6 follow-up in `note`), otherwise `result: "FAIL", status_after: "OPEN"` with why.
- `docs/delivery/reviews/DG5/round-8/release-auditor.json`: your audit record. Mirror the field set of `docs/delivery/reviews/DG4/round-10/release-auditor.json`; `assignment` = exactly `docs/delivery/assignments/DG5/round-8/release-auditor.md`; `reviewer_role: release-auditor`, `round: 8`, `stage_id: DG5`; `checks_run[]` for items 1–10; `verdict`: PASS only if every item holds apart from the gate record that does not exist yet; otherwise BLOCKED with the blocking conditions.
- **Do not write `docs/delivery/gates/DG5.json`.** The decision run does that.
- Evidence under `docs/delivery/test-evidence/DG5/audit/round-8/`.
- Run `node tools/gates/validate.mjs --stage DG5` and report its output and exit code. Errors about the missing gate record, about your own in-flight run_id, and about F-DG5-125/150/151 lacking your acceptance (not imported yet) are expected; list them. Any other error is BLOCKED.
