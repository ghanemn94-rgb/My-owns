# DG6 release audit, part 1 of 2: acceptance of F-DG6-952 (release-auditor, round 8 of the clean re-gate)

Task ID: `T-DG6-AUDIT-RG-R8`. You are the independent release auditor of the frozen **DG6** candidate (P6 "Integration and system hardening"), re-gated on a clean base (D-238). You cannot replace a missing specialist review or waive an unmet mandatory requirement.

**This run is part 1 of the two-part audit of D-140 option 1.** One finding awaits your concurrence as an accepted observation, and the validator reads acceptance only from your own sidecar, which the orchestrator imports into `findings.json` before the gate is written. So this run judges F-DG6-952 and writes your verification sidecar and an audit record for this round. It writes **no gate record**. Part 2 (round 9) audits the gate in full and writes `docs/delivery/gates/DG6.json`.

## Candidate

- **candidate_id:** `sha256:10f71f2418567878bffddfb004efbf342347029fd799dd3076af40aca32e2fc5` (2775 files). Verify it with `node tools/gates/candidate.mjs --stage DG6 --ref d8868b2a5c074b13c04693a88644c25ef2792583` on a complete clone. After the freeze only meta-excluded records may have changed; confirm it, and that `decisions.md` is unchanged since the freeze.
- **manifest:** `docs/delivery/candidates/DG6/10f71f2418567878.manifest.json`.
- **source_commit:** `d8868b2a5c074b13c04693a88644c25ef2792583`.
- **Clones, not worktrees.** Work in a `git clone --no-local` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.
- **Stage state** is VERIFYING before your run.

## Context

Read D-238 to D-240 in `decisions.md`, and the progress.md entries from "round 5" on. Round 7 (this candidate): domain, code-security and qa all PASS, F-DG6-911/951 CLOSED_VERIFIED by all three (`docs/delivery/reviews/DG6/round-7/`).

## The finding: F-DG6-952 (Low, not mandatory)

Raised by qa in round 6 (`docs/delivery/reviews/DG6/round-6/qa-verifier.findings.json`); read it in full there and in `findings.json`. The `stages.json` history timestamps of two APPROVED gates are out of order (DG5: VERIFYING stamped 12:00:00Z before APPROVED 06:30:00Z; DG0: REVIEWING 15:45:00Z before FIXING 15:16:00Z), and the validator does not check order. The reporter (qa) recorded `PASS -> ACCEPTED_OBSERVATION` in its round-6 verifications sidecar.

**The user decided (2026-11-12, recorded in `progress.md`) to accept F-DG6-952 as an observation**, and not to rewrite the history of approved gates. Judge it independently:

1. Confirm the facts: the out-of-order entries exist as stated, they lie in DG0 and DG5 history (approved gates), and no DG6 entry is out of order. Confirm the validator's history checks (`--historical` DG1–DG5, `--pipeline`) exit 0.
2. Confirm it is Low, `mandatory_violation: false`, with no product effect, and that `rules.mjs` permits ACCEPTED_OBSERVATION for it.
3. Judge whether accepting it, rather than rewriting approved records, is sound. If you concur, record `result: PASS, status_after: ACCEPTED_OBSERVATION`; if not, `result: FAIL, status_after: OPEN`, with why.

## Records

Write with Write/Edit only:

- `docs/delivery/reviews/DG6/round-8/release-auditor.verifications.json` = `{ "verifications": [ {finding_id: "F-DG6-952", result, status_after, note, evidence[]} ] }`.
- `docs/delivery/reviews/DG6/round-8/release-auditor.json`: mirror `docs/delivery/reviews/DG6/round-4/release-auditor.json`; `assignment` = exactly `docs/delivery/assignments/DG6/round-8/release-auditor.md`; `reviewer_role: release-auditor`, `round: 8`, `stage_id: DG6`; `candidate_id` and `source_commit` as above; checks for items 1–3 plus clone/identity; `verdict` PASS if you concur and found nothing blocking. State in the record that it is part 1 and carries no gate decision.
- Evidence under `docs/delivery/test-evidence/DG6/audit/round-8/`.
- New findings (if any): ids F-DG6-991 to F-DG6-995, sidecar `docs/delivery/reviews/DG6/round-8/release-auditor.findings.json`, in the format of `docs/delivery/reviews/DG6/round-4/release-auditor.findings.json`.
- Ports, if any: 32600–32699.

Do not write `docs/delivery/gates/DG6.json`. At the end run `node tools/gates/validate.mjs --stage DG6` and report its output and exit code; it will still fail on the gate record (part 2) and on acceptance not yet imported. List those errors.
