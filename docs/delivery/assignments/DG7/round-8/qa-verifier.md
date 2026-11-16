# DG7 round 8: acceptance of F-DG7-973 (qa-verifier, reporter)

Task ID: `T-DG7-REV-QA-R8`. Stage `DG7` (P7 "Independent transfer and release"). You are the independent qa-verifier and the reporter of F-DG7-973. You implemented no DG7 requirement and are read-only to implementation. This run judges only whether F-DG7-973 may be accepted as an observation; it is not a full review (round 7 was).

## Candidate

- **candidate_id:** `sha256:0d71d4456adaac949e2c9af4c975f4b9976a166872195f496d5aa75fe8ed2272` (3158 files). Verify it with `node tools/gates/candidate.mjs --stage DG7 --ref 7579382c59e1791321d4856ac1cb2eb2cfb4edc7` on a complete clone. After the freeze only meta-excluded records may have changed (assignments, reviews, runs, test evidence, `findings.json`, `stages.json`, `progress.md`); confirm it, and that `decisions.md` is unchanged since the freeze.
- **manifest:** `docs/delivery/candidates/DG7/0d71d4456adaac94.manifest.json`.
- **source_commit:** `7579382c59e1791321d4856ac1cb2eb2cfb4edc7`.
- **Clones, not worktrees.** Work in a `git clone --no-local` under your private `$TMPDIR`. Never run `git worktree add` (D-082).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`.
- **Stage state** is VERIFYING before your run.

## The finding: F-DG7-973 (Low, not mandatory)

Raised by qa-verifier in round 7 (`docs/delivery/reviews/DG7/round-7/qa-verifier.findings.json`); read it in full there and in `findings.json`. ADR-0071 §5.1 still says the release-notes generator "reads nothing else" and §5.2 lists seven sections, but since T-DG7-DO-D10 the generator also reads the checked-in `tools/release/release-notes-disclosures.json` and prints an eighth section (the D-278 transfer-drill disclosure that ADR-0064 A5.6 requires). D-280 accepts the deviation without a dated ADR amendment. Round 7 (this candidate): domain, code-security and qa all PASS; F-DG7-923/942/972 CLOSED_VERIFIED.

**The user decided (2026-11-16, recorded in `progress.md`) to accept F-DG7-973 as an observation** rather than amend ADR-0071 and run another full review round. Judge it independently:

1. Confirm the facts: the ADR-0071 text, the generator's extra input and section, D-280's wording, and that the generator stays deterministic from checked-in inputs (`release-notes.mjs --check` exit 0; its tests pass).
2. Confirm it is Low, `mandatory_violation: false`, with no product or behavioural effect, and that `tools/gates/lib/rules.mjs` permits ACCEPTED_OBSERVATION for it.
3. Judge whether accepting it is sound. If you concur, record `result: PASS, status_after: ACCEPTED_OBSERVATION`; if not, `result: FAIL, status_after: OPEN`, with why.

## Records

Write with Write/Edit only:

- `docs/delivery/reviews/DG7/round-8/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id: "F-DG7-973", result, status_after, note, evidence[]} ] }`.
- `docs/delivery/reviews/DG7/round-8/qa-verifier.json`: mirror the field set of `docs/delivery/reviews/DG7/round-7/qa-verifier.json`; `assignment` = exactly `docs/delivery/assignments/DG7/round-8/qa-verifier.md`; `reviewer_role: qa-verifier`, `round: 8`, `stage_id: DG7`; `candidate_id` and `source_commit` as above; checks for items 1–3 plus clone/identity; `requirements_checked` = []; `verdict` PASS if you concur and found nothing blocking. State that this is an acceptance-only run.
- Evidence under `docs/delivery/test-evidence/DG7/qa/round-8/`.
- New findings (if any): ids F-DG7-974 to F-DG7-979, sidecar `docs/delivery/reviews/DG7/round-8/qa-verifier.findings.json`, in the round-7 format.
- Ports, if any: 32700–32799.

At the end run `node tools/gates/validate.mjs --stage DG7` and report its output and exit code; it will still fail on the missing gate record and acceptance not yet imported. List those errors.
