# DG7 release audit: single audit and decision run (release-auditor, round 9, part 2 of 2)

Task ID: `T-DG7-AUDIT-R9`. You are the independent release auditor of the frozen **DG7** candidate (P7 "Independent transfer and release"), the last delivery gate. Read the DG7 decisions in `decisions.md` (D-241 onward, to D-280) and the DG7 entries of `progress.md` first, including the user's acceptance of F-DG7-973 on 2026-11-16. You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**Part 2 of 2 (D-140 option 1).** Part 1 (round 8, `docs/delivery/reviews/DG7/round-8/`) concurred with accepting F-DG7-973 (Low) as an observation, as did its reporter (qa-verifier, round 8); the orchestrator imported both into `findings.json`. This run audits the gate in full and writes the gate record. It does not perform the A28 seal or the final release-readiness report; those follow an APPROVED gate.

## Candidate

- **candidate_id:** `sha256:0d71d4456adaac949e2c9af4c975f4b9976a166872195f496d5aa75fe8ed2272` (3158 files). Verify it with `node tools/gates/candidate.mjs --stage DG7 --ref 7579382c59e1791321d4856ac1cb2eb2cfb4edc7` on a complete clone. After the freeze only meta-excluded records may have changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, `progress.md`). Confirm it.
- **manifest:** `docs/delivery/candidates/DG7/0d71d4456adaac94.manifest.json`.
- **source_commit:** `7579382c59e1791321d4856ac1cb2eb2cfb4edc7`.
- **Clones, not worktrees.** Work in a `git clone --no-local` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.
- **Stage state** is VERIFYING before your run.

## The gate's specialist reviews (all on this candidate, round 7)

- domain-reviewer: `docs/delivery/reviews/DG7/round-7/domain-reviewer.json` (PASS).
- code-security-reviewer: `docs/delivery/reviews/DG7/round-7/code-security-reviewer.json` (PASS).
- qa-verifier: `docs/delivery/reviews/DG7/round-7/qa-verifier.json` (PASS).

## Audit (all of it, independently)

1. **Clone and identity.** Complete clone. The candidate identity equals the one above. `node tools/gates/validate.mjs --historical --stage DG6` passes.
2. **Independence and provenance.** Each specialist record's `invocation_reference` resolves to a real, distinct, successful, sandboxed run of round 7; each run's `sandbox.json` matches `meta.process_sandbox_sha256` (D-030 to D-033); no reviewer implemented any DG7 requirement; no DG7 review run reports a non-empty `external_config_changed` (D-082).
3. **Verdicts.** The three records are PASS on this candidate, each `source_commit` is the full 40-hex id, and each was a full review of the candidate, not only of the D-280 delta. Check this against each record's checks and evidence.
4. **Findings.** Every DG7 finding in `findings.json` is CLOSED_VERIFIED by a non-owner, with a full 40-hex `fix_revision` that is a commit object and an ancestor of the verifying round's `source_commit`, of the verifying run's `head_commit_at_start` and of this candidate; or REJECTED_INVALID as the validator allows; except **F-DG7-973** (Low, not mandatory), ACCEPTED_OBSERVATION by the user's decision, the reporter (qa, round 8) and the release-auditor (round 8). No Critical or High finding and no mandatory violation is unresolved.
5. **Write-once.** Nothing under `docs/delivery/reviews/DG7`, `runs/DG7`, `candidates/DG7` or `assignments/DG7/round-*` was deleted or rewritten in this branch's history; the validator's write-once check reports nothing. Approved records of DG0–DG6 are unchanged.
6. **Incidents and orchestrator decisions.** Judge each, from history, not from this text:
   - the container-restart kill of the round-5 qa run (no `qa-verifier.json`; committed sidecars handled as D-278 records);
   - the stages.json transition error F-DG7-922/941/970 (round 4 frozen without FIXING) and its late FIXING entry (D-277);
   - the D-278 decision (ADR-0064 A3.9 residual 1) and its disclosure repair (D-280: AN-P7I, DO-D10), the history-only secret-scan allow-list entries for the round-6 QA grep patterns, and the pre-freeze r7 failure on their payload staleness re-run green in `prefreeze-r7b`;
   - the user's acceptance of F-DG7-973 recorded in `progress.md` rather than `decisions.md` (to avoid a re-freeze);
   - the disclosures D-249/D-270 (protocol hits), D-274 (Q19 extension), D-267 (single host, not air-gapped, not HA), D-269, A27 K11 partial, ADR-0065 Amendment 1 (`automation_rule` excluded).
7. **Final verification.** `docs/delivery/test-evidence/DG7/orchestrator/prefreeze-r7/` is the orchestrator's 19-check run before the freeze, on the tree of `19a82f6c2` plus DO-D10; `prefreeze-r7b/` re-ran secret-payload, secret-history, the release-tool tests and prettier after the two allow-list entries were scoped to history. The product tree differs from `7579382c` only in `docs/handover/known-limitations.md` (regenerated protocol-audit pointer) and `tools/release/secret-allowlist.json` (`git diff 19a82f6c2bbb0434fd15e87ef0cfe192d5de6a47 7579382c59e1791321d4856ac1cb2eb2cfb4edc7 -- . ':!docs/delivery'`). Confirm this, confirm every step's exit code in `checks.log` (r7 plus r7b for the re-run steps), and grep the logs yourself. Judge whether that evidence, together with the specialists' own runs on the candidate, suffices. Live CI was not run (record as a disclosed residual, not as passed).
8. **Requirements.** Each of the 54 `final_gate=DG7` requirements below is in qa's `requirements_checked`, and also in domain's or code-security's. `node tools/gates/validate.mjs --register DG7` passes.
9. **Decisions.** The DG7 decisions are recorded with rationale. Quote them; do not paraphrase.
10. **Evidence honesty.** Every specialist record discloses and explains each non-zero exit, failed test or timeout in the logs it cites. Grep the cited logs yourself.
11. **Product vs engineering gates.** G1–G6 are business approvals: nothing grants a real business, Finance or IT approval, and nothing ties G1–G6 to DG0–DG7. Product G6 never implies DG7. Demo data is synthetic and labelled. Brand tokens are provisional; nothing claims official PMI status or certification.

**The 54 DG7-final requirements:** `REQ-DLV-005`, `REQ-DLV-008`, `REQ-DLV-009`, `REQ-DLV-010`, `REQ-DLV-011`, `REQ-DLV-012`, `REQ-DLV-014`, `REQ-DLV-018`, `REQ-DLV-021`, `REQ-DLV-024`, `REQ-DLV-027`, `REQ-DLV-028`, `REQ-DLV-030`, `REQ-DLV-031`, `REQ-DLV-039`, `REQ-DLV-040`, `REQ-DLV-041`, `REQ-S01-001`, `REQ-S01-006`, `REQ-S02-003`, `REQ-S02-005`, `REQ-S16-008`, `REQ-S16-009`, `REQ-S16-024`, `REQ-S16-031`, `REQ-S16-033`, `REQ-S17-004`, `REQ-S19-001`, `REQ-S19-002`, `REQ-S19-003`, `REQ-S19-005`, `REQ-S19-007`, `REQ-S19-008`, `REQ-S19-009`, `REQ-S19-010`, `REQ-S19-011`, `REQ-S19-012`, `REQ-S19-013`, `REQ-S19-014`, `REQ-S19-015`, `REQ-S19-016`, `REQ-S19-017`, `REQ-S19-018`, `REQ-S19-019`, `REQ-S20-018`, `REQ-S20-019`, `REQ-S20-023`, `REQ-S20-026`, `REQ-S20-027`, `REQ-S20-028`, `REQ-S20-031`, `REQ-S21-002`, `REQ-S21-003`, `REQ-S21-004`.

## Records

Write these with Write/Edit only:

- **Your audit record:** `docs/delivery/reviews/DG7/round-9/release-auditor.json`. Mirror `docs/delivery/reviews/DG6/round-9/release-auditor.json`. `assignment` = exactly `docs/delivery/assignments/DG7/round-9/release-auditor.md`; `reviewer_role: release-auditor`, `round: 9`, `stage_id: DG7`; `candidate_id` and `source_commit` = the full ids above.
- **The gate record:** `docs/delivery/gates/DG7.json`. Mirror `docs/delivery/gates/DG6.json` key for key. `reviews` = the three round-7 records; `release_audit` = your round-9 record; `accepted_observations` = `["F-DG7-973"]`; `manifest_path` as above; `previous_gate: DG6`; `requirements.final_gate_ids` = the 54 above; `decision` = APPROVED only if every item above holds, else BLOCKED with the reasons.
- **Evidence:** under `docs/delivery/test-evidence/DG7/audit/round-9/`.
- **New findings:** ids F-DG7-996 to F-DG7-999, in a sidecar `docs/delivery/reviews/DG7/round-9/release-auditor.findings.json` in the format the round-7 reviewers used.
- **Ports:** below 32768. Your range is 32600–32699.

## Your own evidence cannot exist yet

At the end, run `node tools/gates/validate.mjs --stage DG7`. Report its output and exit code. Record PASS only if every reported error concerns your own in-flight run_id, and list those errors. Any other error means BLOCKED.
