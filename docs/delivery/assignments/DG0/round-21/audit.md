# DG0 assignment: release-auditor (round 21)

Read `docs/delivery/assignments/DG0/round-21/review-common.md` first. Task ID: `T-DG0-AUDIT-R21`.

The three specialist records for this round are:
- `docs/delivery/reviews/DG0/round-21/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-21/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-21/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7. For DG0 there is no previous gate (`previous_gate: null`). In particular:
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role. Spot-check each transcript (`zcat … | head`) to confirm the reviewer actually inspected the candidate rather than rubber-stamping it.
- Spot-check that the evidence content supports the claims.
- Check the derived requirement verification: **each of the 19 `final_gate = DG0` requirements is in QA's `requirements_checked` and in the domain or code-security reviewer's.** (code-security carries all 19; domain carries the source/analysis subset.)
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-21/release-auditor.json`, and later the gate record, **with the Write/Edit tools only**. The validator binds both to your run's tool-authored output (D-021). Then write `docs/delivery/gates/DG0.json` (gate schema) with decision APPROVED **only** if every condition holds; otherwise write BLOCKED and list `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: the value of `stage.candidate.manifest_path` in `stages.json` (`docs/delivery/candidates/DG0/7d00f8574a41648a.manifest.json`).
- `requirements.final_gate_ids`: **every** register row with `final_gate` DG0 (there are 19: `REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`).
- `tests`: the key executed checks with existing evidence paths.

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.

## Round-21 audit specifics (read these carefully)

- **Stage state.** DG0 is set to **VERIFYING** before your run. The three specialist round-21 records are in `docs/delivery/reviews/DG0/round-21/`, and `docs/delivery/findings.json` is imported from them.
- **Your own evidence can't exist yet.** While you run, `node tools/gates/validate.mjs --stage DG0` necessarily reports errors about your own in-flight run_id. Record this check PASS **only if every reported error concerns your own in-flight run_id**; list the exact errors. Any other error is a real failure → BLOCKED.
- **Process sandbox evidence (D-030 to D-033).** For each specialist run, check `docs/delivery/runs/DG0/<run_id>/sandbox.json` exists, matches `meta.process_sandbox_sha256`, and shows a confined process (`procfs: host-bind`, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, a `landlock` block with `per_run_domain: true`) with only the role's own areas and an **empty `discarded`** list.
- **History integrity (D-034) and the D-037 gate readiness.** In a fresh clone confirm `checkWriteOnce` = 0, nothing under `reviews/`/`runs/`/`candidates/` was modified or deleted, and that the real-repo dry-run gate (`docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs`) shows 0 PRUNED / 0 RECORD-LESS / 0 DROPPED — i.e. the pre-existing history damage no longer blocks the gate (D-037). Confirm a gate with an off-branch or non-existent `source_commit` is still rejected in current mode (F-DG0-241/240), and that a **present** fix not in the candidate is still caught (the D-037 tolerance is not a blanket skip).
- **Findings.** Confirm the round-21 verifications close **F-DG0-157, F-DG0-241, F-DG0-242, F-DG0-243, F-DG0-244**, and that F-DG0-145/146/148/150/151/152/153/154/155/156/236/237/239/240 stay CLOSED. For the Low observations **F-DG0-147** and **F-DG0-149** (residual 7 at its corrected host-global scope): if you agree each is Low, non-mandatory and within the disclosed residual, add `{"finding_id","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` for each to your own `release-auditor.verifications.json` and list them in the gate's `accepted_observations`. If you disagree, it stays unresolved and the gate is BLOCKED. Check no finding is left `OPEN` or `FIXED_PENDING_VERIFICATION`.
- **Independence spot-check.** For each specialist, open its run's `transcript.jsonl.gz` and confirm it inspected the candidate.
- **Write both files with the Write/Edit tools only:** `docs/delivery/reviews/DG0/round-21/release-auditor.json` and `docs/delivery/gates/DG0.json` (APPROVED only if every condition holds; else BLOCKED with `blocking_conditions`). Put your `invocation_reference` in both; take the manifest path from `stages.json`; `tests` must list the key checks with existing evidence files. Then run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code.
