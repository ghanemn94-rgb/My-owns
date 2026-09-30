# DG0 assignment: qa-verifier (round 23)

Read `docs/delivery/assignments/DG0/round-23/review-common.md` first. Task ID: `T-DG0-REV-QA-R23`.

## Your scope: execute and independently verify the DG0 acceptance criteria

1. **Run everything that exists** (record command, environment, actual output):
   - `tools/source/check_extraction.sh`
   - `node --test tools/gates/tests/*.test.mjs`
   - `node --test tools/agents/tests/*.test.mjs`
   - `node tools/gates/validate.mjs --register DG0`, `--pipeline`, `--reconcile`
   - `node tools/gates/candidate.mjs --stage DG0`
2. **The real-repo dry-run gate on the FULL history (key check of D-039).** In a fresh **complete** clone of HEAD — do it **twice**, once `git clone --no-local <repo> "$TMPDIR/nl"` and once plain `git clone <repo> "$TMPDIR/loc"` — run `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs "$TMPDIR/nl"` (and `.../loc`). Confirm **0** errors in the PRUNED/RECORD-LESS/DROPPED buckets in **both**, and that the two outputs are identical (the `gc` removed the dangling `450c756`, so a local clone no longer differs — F-DG0-013/247). Only "round not finished" artifacts should remain. Save under `docs/delivery/test-evidence/DG0/qa/round-23/`.
3. **Verify the D-039 strict validator (negative suite).** Confirm the round-22 exploits are now closed: a forged superseded round (schema-valid manifest naming a non-existent `source_commit` + a stages review-round entry, a genuine verifier run) can no longer close a finding with an all-zero `fix_revision` (round-22 QA22-N7); a run `head_commit_at_start` that is missing/`unknown`/absent is rejected; a later-round findings sidecar cannot downgrade `severity`/`mandatory_violation` (F-DG0-165); a shallow clone is refused (F-DG0-160/248). Write cases under `docs/delivery/test-evidence/DG0/qa/tests/`; design ≥5 not already in `tools/gates/tests/`.
4. **Register integrity** (independent script, saved under round-23): every row's columns; no `VERIFIED` status; `IMPLEMENTED` DLV rows' evidence exists and implements the requirement; A01–A28 coverage and `final_gate`/`increments` consistency; counts; coverage matrices complete. Confirm every `fix_revision` in `findings.json` is full 40-hex and, on the complete history, present and an ancestor of HEAD.
5. **Agent setup (§0.1/§0.2)** from recorded evidence: ten agents loaded, distinct invocations, orchestrator's model, out-of-scope writes blocked; re-verify the guard live (attempt a write to `docs/source/QA-PROBE.txt`); `agents.md` matches evidence.
6. **Feasibility:** stage plan and acceptance map assign every A01–A28 to a concrete test level and stage.

## Requirements to check (record exactly these in `requirements_checked`)
Check **all 19** DG0-final requirements (qa covers every one), plus register-completeness over all rows:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`.
