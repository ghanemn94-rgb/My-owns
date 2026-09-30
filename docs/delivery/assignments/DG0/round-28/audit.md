# DG0 assignment: release-auditor (round 28)

Read `docs/delivery/assignments/DG0/round-28/review-common.md` first. Task ID: `T-DG0-AUDIT-R28`.

The three specialist records are:
- `docs/delivery/reviews/DG0/round-28/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-28/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-28/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7 (`previous_gate: null` for DG0). In particular:
- **Confirm the repository is a COMPLETE clone** (`git rev-parse --is-shallow-repository` = `false`); if shallow, return BLOCKED (F-DG0-160).
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role; spot-check each transcript to confirm real inspection.
- Check the derived requirement verification: **each of the 19 `final_gate = DG0` requirements is in QA's `requirements_checked` and in the domain or code-security reviewer's.**
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-28/release-auditor.json`, then the gate record `docs/delivery/gates/DG0.json`, **with the Write/Edit tools only**. Decision APPROVED **only** if every condition holds; otherwise BLOCKED with `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: `stage.candidate.manifest_path` (`docs/delivery/candidates/DG0/1af91e8f620aec37.manifest.json`).
- `requirements.final_gate_ids`: **every** register row with `final_gate` DG0 (19: `REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`).
- `tests`: the key executed checks with existing evidence paths.

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.

## Round-23 audit specifics
- **Stage state** is set to **VERIFYING** before your run. The three round-28 specialist records are in `docs/delivery/reviews/DG0/round-28/`, and `findings.json` is imported from them.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG0` necessarily reports errors about your own in-flight run_id. Record this PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process sandbox evidence (D-030–D-033):** each specialist run's `sandbox.json` exists, matches `meta.process_sandbox_sha256`, shows a confined process (`procfs: host-bind`, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, `landlock` with `per_run_domain: true`), only its own areas, empty `discarded`.
- **History integrity + the strict validator (D-039..D-041):** confirm `checkWriteOnce` = 0 on the complete history; that the real-repo dry-run reports 0 PRUNED / 0 RECORD-LESS / 0 DROPPED and no "not in the verifying run's starting history" error; that a shallow clone is refused (F-DG0-160); that no absent/all-zero `fix_revision` or `head_commit_at_start` can pass and a closure is anchored to all three of the frozen round candidate, the verifying run head, and the gate candidate (D-041); and that a gate with an off-branch/non-existent `source_commit` is rejected (F-DG0-240/241).
- **Findings.** Confirm the round-28 verification closes **F-DG0-250**, and that all previously CLOSED findings stay CLOSED (F-DG0-013/014/145/146/148/150/151/152/153/154/155/156/157/158/159/160/161/162/163/164/165/166/167/168/169/170/236/237/238/239/240/241/242/243/244/245/246/247/248/249). For **F-DG0-147** and **F-DG0-149** (residual 7 at its host-global scope, including the shell): if each is Low, non-mandatory and within the disclosed residual, add `{"finding_id","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` for each to your `release-auditor.verifications.json` and list them in the gate's `accepted_observations`. If you disagree, they stay unresolved and the gate is BLOCKED. No finding may be left `OPEN` or `FIXED_PENDING_VERIFICATION`.
- **Independence spot-check:** open each specialist's `transcript.jsonl.gz` and confirm it inspected the candidate.
- **Write both files with Write/Edit only.** Put your `invocation_reference` in both; manifest path from `stages.json`; `tests` list the key checks with existing evidence. Then run `node tools/gates/validate.mjs --stage DG0` and report output + exit code.
