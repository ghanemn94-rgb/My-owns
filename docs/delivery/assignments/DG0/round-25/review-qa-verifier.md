# DG0 assignment: qa-verifier (round 25)

Read `docs/delivery/assignments/DG0/round-25/review-common.md` first. Task ID: `T-DG0-REV-QA-R25`.

## Your scope: execute and independently verify the DG0 acceptance criteria

1. **Run everything that exists** (record command, environment, actual output):
   - `tools/source/check_extraction.sh`
   - `node --test tools/gates/tests/*.test.mjs`
   - `node --test tools/agents/tests/*.test.mjs`
   - `node tools/gates/validate.mjs --register DG0`, `--pipeline`, `--reconcile`
   - `node tools/gates/candidate.mjs --stage DG0`
2. **The real-repo dry-run gate on the FULL history.** In a fresh **complete** clone of HEAD (`git clone --no-local <repo> "$TMPDIR/nl"`) run `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs "$TMPDIR/nl"`. Confirm **0** errors in the PRUNED/RECORD-LESS/DROPPED buckets, **no** closure-anchor error ("is not in the verified round candidate", "is not in the verifying run's starting history", "is not in the gate candidate" — every genuine closure passes all three anchors, D-041), and that only "round not finished" artifacts remain. Save under `docs/delivery/test-evidence/DG0/qa/round-25/`.
3. **Verify the D-041 three-anchor closure + the standing strict validator (negative suite).** Confirm the round-24 case is closed: in a genuine round, a candidate-scope `fix_revision` committed **after the freeze but before the verifier ran** is now rejected by anchor 1 ("not in the verified round candidate"), and the round-23 forge (a superseded round with a non-existent `source_commit`, a genuine verifier run, a fix committed after the run) is still rejected by anchor 2 ("not in the verifying run's starting history"). Also re-confirm the standing controls: an all-zero/absent `fix_revision` or a missing/`unknown`/absent `head_commit_at_start` is rejected; a later-round sidecar cannot downgrade `severity`/`mandatory_violation` (F-DG0-165); a shallow clone is refused (F-DG0-160/248). Write cases under `docs/delivery/test-evidence/DG0/qa/tests/`; design ≥5 not already in `tools/gates/tests/`.
4. **Register integrity** (independent script, saved under round-25): every row's columns; no `VERIFIED` status; `IMPLEMENTED` DLV rows' evidence exists and implements the requirement; A01–A28 coverage and `final_gate`/`increments` consistency; counts; coverage matrices complete. Confirm every `fix_revision` in `findings.json` is full 40-hex and, on the complete history, present and an ancestor of HEAD.
5. **Agent setup (§0.1/§0.2)** from recorded evidence: ten agents loaded, distinct invocations, orchestrator's model, out-of-scope writes blocked; re-verify the guard live (attempt a write to `docs/source/QA-PROBE.txt`); `agents.md` matches evidence.
6. **Feasibility:** stage plan and acceptance map assign every A01–A28 to a concrete test level and stage.

## Requirements to check (record exactly these in `requirements_checked`)
Check **all 19** DG0-final requirements (qa covers every one), plus register-completeness over all rows:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`.
