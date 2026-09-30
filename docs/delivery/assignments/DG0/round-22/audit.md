# DG0 assignment: release-auditor (round 22)

Read `docs/delivery/assignments/DG0/round-22/review-common.md` first. Task ID: `T-DG0-AUDIT-R22`.

The three specialist records are:
- `docs/delivery/reviews/DG0/round-22/domain-reviewer.json`
- `docs/delivery/reviews/DG0/round-22/code-security-reviewer.json`
- `docs/delivery/reviews/DG0/round-22/qa-verifier.json`

The findings history is `docs/delivery/findings.json`, maintained by the orchestrator from reviewer sidecars.

Perform the audit defined in your agent definition, points 1–7 (`previous_gate: null` for DG0). In particular:
- **Confirm the repository is a COMPLETE clone:** `git rev-parse --is-shallow-repository` is `false`. If it is shallow, the gate cannot be audited here — return BLOCKED and say so (D-038, F-DG0-160).
- Recompute the candidate: `node tools/gates/candidate.mjs --stage DG0` and `--diff`.
- Verify each invocation reference against `docs/delivery/runs/DG0/<run_id>/meta.json` is a real, distinct, successful run of the named role; spot-check each transcript (`zcat … | head`) to confirm real inspection.
- Check the derived requirement verification: **each of the 19 `final_gate = DG0` requirements is in QA's `requirements_checked` and in the domain or code-security reviewer's.**
- Confirm there are no unresolved findings for DG0.

Write your audit record `docs/delivery/reviews/DG0/round-22/release-auditor.json`, then the gate record `docs/delivery/gates/DG0.json`, **with the Write/Edit tools only**. Decision APPROVED **only** if every condition holds; otherwise BLOCKED with `blocking_conditions`. Use your invocation reference in both.
- `manifest_path`: `stage.candidate.manifest_path` (`docs/delivery/candidates/DG0/09072ce5f5cb6441.manifest.json`).
- `requirements.final_gate_ids`: **every** register row with `final_gate` DG0 (19: `REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`).
- `tests`: the key executed checks with existing evidence paths.

Finally run `node tools/gates/validate.mjs --stage DG0` and report its output and exit code. If it fails, the gate is not approved. Say so, and don't edit anything to make it pass.

## Round-22 audit specifics
- **Stage state** is set to **VERIFYING** before your run. The three round-22 specialist records are in `docs/delivery/reviews/DG0/round-22/`, and `findings.json` is imported from them.
- **Your own evidence can't exist yet:** `validate.mjs --stage DG0` necessarily reports errors about your own in-flight run_id. Record this PASS **only if every reported error concerns your own in-flight run_id**; list them. Any other error → BLOCKED.
- **Process sandbox evidence (D-030–D-033):** each specialist run's `sandbox.json` exists, matches `meta.process_sandbox_sha256`, shows a confined process (`procfs: host-bind`, `unshare: ["ipc"]`, only `CAP_SETFCAP`, `no_new_privs`, `landlock` with `per_run_domain: true`), only its own areas, empty `discarded`.
- **History integrity + D-038:** confirm `checkWriteOnce` = 0 on the complete history; that the real-repo dry-run (`docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs`) reports 0 PRUNED / 0 RECORD-LESS / 0 DROPPED (the shallow-clone artifact and the round-18 orphan are resolved); that a shallow clone is refused (F-DG0-160); that a gate with an off-branch/non-existent `source_commit` is rejected (F-DG0-240/241); and that a present fix not in the candidate, and a malformed/gate-round `head_commit_at_start` or `fix_revision`, are all still caught (D-038 scoping).
- **Findings.** Confirm the round-22 verifications close **F-DG0-158, 159, 160, 161, 162, 163, 245**, that **F-DG0-150/151** are re-verified CLOSED against this candidate, and that **F-DG0-238** is CLOSED (duplicate of F-DG0-150; its `fix_revision` is `421c922`). Confirm F-DG0-145/146/148/152/153/154/155/156/157/236/237/239/240/241/242/243/244 stay CLOSED. For **F-DG0-147** and **F-DG0-149** (residual 7 at its host-global scope — now including the shell, F-DG0-162): if each is Low, non-mandatory and within the disclosed residual, add `{"finding_id","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` for each to your `release-auditor.verifications.json` and list them in the gate's `accepted_observations`. If you disagree, they stay unresolved and the gate is BLOCKED. No finding may be left `OPEN` or `FIXED_PENDING_VERIFICATION`.
- **Independence spot-check:** open each specialist's `transcript.jsonl.gz` and confirm it inspected the candidate.
- **Write both files with Write/Edit only.** Put your `invocation_reference` in both; manifest path from `stages.json`; `tests` list the key checks with existing evidence. Then run `node tools/gates/validate.mjs --stage DG0` and report output + exit code.
