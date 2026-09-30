# DG0 assignment: qa-verifier (round 22)

Read `docs/delivery/assignments/DG0/round-22/review-common.md` first. Task ID: `T-DG0-REV-QA-R22`.

## Your scope: execute and independently verify the DG0 acceptance criteria

1. **Run everything that exists** (record command, environment, actual output):
   - `tools/source/check_extraction.sh`
   - `node --test tools/gates/tests/*.test.mjs`
   - `node --test tools/agents/tests/*.test.mjs`
   - `node tools/gates/validate.mjs --register DG0`, `--pipeline`, `--reconcile`
   - `node tools/gates/candidate.mjs --stage DG0`
2. **The real-repo dry-run gate on the FULL history (this round's key check of D-038).** In a fresh **complete** clone of HEAD (`git clone <repo> "$TMPDIR/dg0"`; confirm it is not shallow), run `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs "$TMPDIR/dg0"`. Confirm **0** errors in the PRUNED, RECORD-LESS and DROPPED buckets, and that the only remaining errors are "round not finished" artifacts. Save under `docs/delivery/test-evidence/DG0/qa/round-22/`.
3. **Verify the D-038 scoping is fail-closed (re-run your round-21 negative suite + new cases).** Confirm the round-21 fail-open cases are now REJECTED: a gate-round run `head_commit_at_start` = missing / `unknown` / `HEAD` / a non-existent 40-hex; an all-zero or typo'd `fix_revision` on a retained or gate-round closure. Confirm a **shallow** clone is refused by `validateGate` (F-DG0-160), and that the scoped tolerance still accepts a genuinely-superseded round (round 18) on the full history. Write cases under `docs/delivery/test-evidence/DG0/qa/tests/` (not `tests/qa/`); design ≥5 not already in `tools/gates/tests/`.
4. **Register integrity** (independent script, saved under round-22): every row's columns; no `VERIFIED` status; `IMPLEMENTED` DLV rows' evidence exists and implements the requirement; A01–A28 coverage and `final_gate`/`increments` consistency; counts; coverage matrices complete. Confirm every `fix_revision` in `findings.json` is full 40-hex and (on the full history) an ancestor of HEAD or a genuinely-superseded-round commit.
5. **Agent setup (§0.1/§0.2)** from recorded evidence: ten agents loaded, distinct invocations, orchestrator's model, out-of-scope writes blocked; re-verify the guard live (attempt a write to `docs/source/QA-PROBE.txt`); `agents.md` matches evidence.
6. **Feasibility:** stage plan and acceptance map assign every A01–A28 to a concrete test level and stage.

## Close F-DG0-238 (F-DG0-158)
You reported F-DG0-238 (round 17): the `finish()` copy-back FileExistsError. It is the **same defect** as F-DG0-150, which is CLOSED_VERIFIED (fixed at `421c922`). It was imported into `findings.json` (OPEN) this round. Verify the defect is fixed in the current candidate and close it: record `{"finding_id":"F-DG0-238","result":"PASS","status_after":"CLOSED_VERIFIED","note":"duplicate of F-DG0-150, same finish() fix (421c922); verified fixed","evidence":[...]}` in your `qa-verifier.verifications.json`. (If you judge it better recorded as `REJECTED_INVALID` "duplicate", that is acceptable too — but CLOSED_VERIFIED is more accurate since the defect was real and is fixed.) The orchestrator will set its `fix_revision`.

## Requirements to check (record exactly these in `requirements_checked`)
Check **all 19** DG0-final requirements (qa covers every one), plus register-completeness over all rows:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`.
