# DG0 assignment: release-auditor (round 20)

Read `docs/delivery/assignments/DG0/round-20/review-common.md` first. Task ID: `T-DG0-AUDIT-R20`.

The three specialist records for this round are:
- `docs/delivery/reviews/DG0/round-20/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-20/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-20/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7. For DG0 there is no previous gate (`previous_gate: null`). In particular:
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify that each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role. Spot-check each transcript (`zcat … | head`) to confirm the reviewer actually inspected the candidate rather than rubber-stamping it.
- Spot-check that the evidence content supports the claims.
- Check the derived requirement verification: each `final_gate = DG0` requirement is in QA's `requirements_checked` and in the domain or code-security reviewer's.
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-20/release-auditor.json`, and later the gate record, **with the Write/Edit tools only**. The validator binds both to your run's tool-authored output (D-021). Then write `docs/delivery/gates/DG0.json` (gate schema) with decision APPROVED **only** if every condition holds; otherwise write BLOCKED and list `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: the value of `stage.candidate.manifest_path` in `stages.json` (`docs/delivery/candidates/DG0/ef3ec3f205ffdac3.manifest.json`)
- `requirements.final_gate_ids`: every register row with `final_gate` DG0
- `tests`: the key executed checks with evidence paths

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.


## Round-20 audit specifics (read these carefully)

- **Stage state.** DG0 is set to **VERIFYING** before your run. The three specialist round-20 records are in `docs/delivery/reviews/DG0/round-20/`, and `docs/delivery/findings.json` is imported from them.
- **Your own evidence can't exist yet.** While you run, `node tools/gates/validate.mjs --stage DG0` necessarily reports errors about your own in-flight run_id. Record this check PASS **only if every reported error concerns your own in-flight run_id**; list the exact errors. Any other error is a real failure -> BLOCKED.
- **Process sandbox evidence (D-030 to D-033).** For each specialist run, check `docs/delivery/runs/DG0/<run_id>/sandbox.json` exists, matches `meta.process_sandbox_sha256`, shows a confined process (`procfs: host-bind`, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, a `landlock` block with `per_run_domain: true`) with only the role's own areas and an **empty `discarded`** list.
- **History integrity (D-034) and D-036.** In a fresh clone confirm `checkWriteOnce` = 0, the round-17 `qa-verifier.{findings,verifications}.json` are present at their original blobs, nothing under `reviews/`/`runs/`/`candidates/` was modified or deleted, and that a gate with a non-existent `source_commit` is now rejected in current mode (D-036).
- **Findings.** Confirm code-security/qa's round-20 verifications close **F-DG0-154, F-DG0-155, F-DG0-156, F-DG0-240**, and that F-DG0-145/146/148/150/151/152/153/236/237/239 stay CLOSED. For the Low observations **F-DG0-147** and **F-DG0-149** (residual 7 at its corrected host-global scope): if you agree each is Low, non-mandatory and within the disclosed residual, add `{"finding_id","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` for each to your own `release-auditor.verifications.json` and list them in the gate's `accepted_observations`. If you disagree with the corrected residual 7, it stays unresolved and the gate is BLOCKED. Check no finding is left `OPEN` or `FIXED_PENDING_VERIFICATION`.
- **Independence spot-check.** For each specialist, open its run's `transcript.jsonl.gz` and confirm it inspected the candidate.
- **Write both files with the Write/Edit tools only:** `docs/delivery/reviews/DG0/round-20/release-auditor.json` and the gate record `docs/delivery/gates/DG0.json` (APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`). Put your `invocation_reference` in both; take the manifest path from `stages.json`; `tests` must list the key checks with existing evidence files. Then run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code.
