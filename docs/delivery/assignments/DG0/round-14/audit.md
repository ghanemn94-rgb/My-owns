# DG0 assignment: release-auditor (round 14)

Read `docs/delivery/assignments/DG0/round-14/review-common.md` first. Task ID: `T-DG0-AUDIT-R14`.

The three specialist records for this round are:
- `docs/delivery/reviews/DG0/round-14/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-14/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-14/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7. For DG0 there is no previous gate (`previous_gate: null`). In particular:
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify that each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role. Spot-check each transcript (`zcat … | head`) to confirm the reviewer actually inspected the candidate rather than rubber-stamping it.
- Spot-check that the evidence content supports the claims.
- Check the derived requirement verification: each `final_gate = DG0` requirement is in QA's `requirements_checked` and in the domain or code-security reviewer's.
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-14/release-auditor.json`, and later the gate record, **with the Write/Edit tools only**. The validator binds both to your run's tool-authored output (D-021). Then write `docs/delivery/gates/DG0.json` (gate schema) with decision APPROVED **only** if every condition holds; otherwise write BLOCKED and list `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: the value of `stage.candidate.manifest_path` in `stages.json` (`docs/delivery/candidates/DG0/a25db736652685e2.manifest.json`)
- `requirements.final_gate_ids`: every register row with `final_gate` DG0
- `tests`: the key executed checks with evidence paths

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.


## Round-14 audit specifics (read these carefully)

- **Stage state.** DG0 is set to **VERIFYING** before your run. The three specialist round-14 records are in `docs/delivery/reviews/DG0/round-14/`, and `docs/delivery/findings.json` has been imported from them by `tools/gates/import-findings.mjs`.
- **Your own evidence can't exist yet.** Your run's `meta.json`, with its `outputs` and `tool_authored`, is written by the runner only after your run ends, and then auto-committed together with your files. So while you run, `node tools/gates/validate.mjs --stage DG0` necessarily reports errors about **your own invocation**:
  - a missing `docs/delivery/runs/DG0/<your run_id>/meta.json`;
  - your record, or the gate file, "not written by this run's file tools".

  Record this check as PASS **only if every reported error concerns your own in-flight run_id**. List the exact errors in `actual`. Any other error is a genuine failure, so write BLOCKED.
- **After your run ends,** the orchestrator runs the full `node tools/gates/validate.mjs --stage DG0`, and later `--historical`, and records their output. DG0 becomes APPROVED in `stages.json` only if that full validation exits 0.
- **Write both files with the Write/Edit tools only:** your audit record `docs/delivery/reviews/DG0/round-14/release-auditor.json`, and the gate record `docs/delivery/gates/DG0.json`.
  - Put your `invocation_reference` in both.
  - Take the candidate manifest path from `stages.json` (`stage.candidate.manifest_path`).
  - `tests` must list at least the key checks you executed, with evidence files that exist.
- **Accepted observations.** If a specialist proposes a Low finding as an observation (`status_after: ACCEPTED_OBSERVATION` in its round-14 sidecar) and you agree, add the same entry to your own `docs/delivery/reviews/DG0/round-14/release-auditor.verifications.json` and list the ID in the gate's `accepted_observations`. If you disagree, don't accept it: the finding then stays unresolved, and the gate is BLOCKED.
- **Independence spot-check.** For each specialist, open its run's `transcript.jsonl.gz` (`zcat … | head -c 20000`, and grep for the tool calls it made). Confirm it actually inspected the candidate, then record what you saw.
- **Findings history.** Several findings were verified across rounds 12 to 14. Check that every finding's binding verification comes from a run that completed successfully (exit 0, not `is_error`). The round-12 QA run did not, and the round-12 domain run is orphaned (`docs/delivery/test-evidence/DG0/round-12-orphaned/README.md`). Also check that no finding is left `FIXED_PENDING_VERIFICATION` or `OPEN`.
