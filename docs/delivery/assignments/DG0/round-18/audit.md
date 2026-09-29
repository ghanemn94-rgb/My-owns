# DG0 assignment: release-auditor (round 18)

Read `docs/delivery/assignments/DG0/round-18/review-common.md` first. Task ID: `T-DG0-AUDIT-R18`.

The three specialist records for this round are:
- `docs/delivery/reviews/DG0/round-18/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-18/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-18/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7. For DG0 there is no previous gate (`previous_gate: null`). In particular:
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify that each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role. Spot-check each transcript (`zcat … | head`) to confirm the reviewer actually inspected the candidate rather than rubber-stamping it.
- Spot-check that the evidence content supports the claims.
- Check the derived requirement verification: each `final_gate = DG0` requirement is in QA's `requirements_checked` and in the domain or code-security reviewer's.
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-18/release-auditor.json`, and later the gate record, **with the Write/Edit tools only**. The validator binds both to your run's tool-authored output (D-021). Then write `docs/delivery/gates/DG0.json` (gate schema) with decision APPROVED **only** if every condition holds; otherwise write BLOCKED and list `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: the value of `stage.candidate.manifest_path` in `stages.json` (`docs/delivery/candidates/DG0/21efe44b6a4613a0.manifest.json`)
- `requirements.final_gate_ids`: every register row with `final_gate` DG0
- `tests`: the key executed checks with evidence paths

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.


## Round-18 audit specifics (read these carefully)

- **Stage state.** DG0 is set to **VERIFYING** before your run. The three specialist round-18 records are in `docs/delivery/reviews/DG0/round-18/`, and `docs/delivery/findings.json` is imported from them.
- **Your own evidence can't exist yet.** While you run, `node tools/gates/validate.mjs --stage DG0` necessarily reports errors about your own in-flight run_id (missing `meta.json`; your record/gate "not written by this run's file tools"). Record this check PASS **only if every reported error concerns your own in-flight run_id**; list the exact errors. Any other error is a real failure → BLOCKED.
- **Process sandbox evidence (D-030/D-031).** For each specialist run, check `docs/delivery/runs/DG0/<run_id>/sandbox.json` exists, matches `meta.process_sandbox_sha256`, shows a confined process (`procfs: host-bind`, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`) with only the role's own writable/staged areas, and an **empty `discarded`** list.
- **Findings.** F-DG0-145 (High), 146, 148 are CLOSED_VERIFIED. Confirm code-security's round-18 verification closes **F-DG0-150** and **F-DG0-151**, and qa's closes **F-DG0-236/237**. For the Low observations **F-DG0-147** and **F-DG0-149**: if you agree each is Low, non-mandatory and within the disclosed residual, add `{"finding_id","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` for each to your own `release-auditor.verifications.json` and list them in the gate's `accepted_observations`. If you disagree, they stay unresolved and the gate is BLOCKED. Check no finding is left `OPEN` or `FIXED_PENDING_VERIFICATION`.
- **Independence spot-check.** For each specialist, open its run's `transcript.jsonl.gz` and confirm it inspected the candidate.
- **Write both files with the Write/Edit tools only:** `docs/delivery/reviews/DG0/round-18/release-auditor.json` and the gate record `docs/delivery/gates/DG0.json` (APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`). Put your `invocation_reference` in both; take the manifest path from `stages.json`; `tests` must list the key checks with existing evidence files. Then run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code.
