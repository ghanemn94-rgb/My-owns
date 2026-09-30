# DG0 assignment: qa-verifier (round 21)

Read `docs/delivery/assignments/DG0/round-21/review-common.md` first. Task ID: `T-DG0-REV-QA-R21`.

## Your scope: execute and independently verify the DG0 acceptance criteria

1. **Run everything that exists** and record the command, environment and actual output:
   - `tools/source/check_extraction.sh`
   - `node --test tools/gates/tests/*.test.mjs`
   - `node --test tools/agents/tests/*.test.mjs`
   - `node tools/gates/validate.mjs --register DG0`
   - `node tools/gates/validate.mjs --pipeline`
   - `node tools/gates/validate.mjs --reconcile`
   - `node tools/gates/candidate.mjs --stage DG0`
2. **The real-repo dry-run gate (this round's key verification of D-037).** In a fresh clone of HEAD (`git clone <repo> "$TMPDIR/dg0"`), run `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs "$TMPDIR/dg0"` (or against your clone path). Confirm:
   - 0 errors in the PRUNED, RECORD-LESS and DROPPED buckets (F-DG0-242/243 fixed);
   - the only remaining errors are "round not finished" artifacts (stage state, unverified FIXED_PENDING findings, the placeholder gate's own reviewers/requirements) that clear once this round completes and the auditor drafts the real gate;
   - the commits the (now empty) PRUNED bucket would have named are genuinely absent, and no CLOSED_VERIFIED finding has an absent-and-off-branch `fix_revision` (F-DG0-150/151 now point at the retained `421c922…`).
   Save the output under `docs/delivery/test-evidence/DG0/qa/round-21/`.
3. **Independent negative tests (A24/A25).** Write your own tests under `docs/delivery/test-evidence/DG0/qa/tests/` (Node's built-in `node:test`, no dependencies). **Do not write under `tests/qa/` during this review** (it would change the frozen candidate). Prove the validator rejects: a missing reviewer; a reviewer who authored the scope; a shared invocation; a failed/blocked check; an unresolved High finding; an incomplete requirement; a non-existent block anchor; a SOURCE row without a playbook block; a coverage-matrix gap; a candidate change after freeze; a tampered manifest. **Add cases for the D-037 tolerances:** a **present** fix that is not in the candidate is still rejected; a gate `source_commit` that is an off-branch commit or an annotated tag is rejected; a record-less sidecar whose record file exists but is unlisted is still an error. Design at least 5 cases not already in `tools/gates/tests/`. Run them and save the output.
4. **Register integrity (independent script, saved under `docs/delivery/test-evidence/DG0/qa/round-21/`).** Check every row's columns; no row is `VERIFIED`; `IMPLEMENTED` DLV rows' evidence paths exist **and actually implement the requirement**; the A01–A28 coverage and `final_gate`/`increments` consistency; counts per class/area/gate; the coverage matrices are exactly complete. **Also confirm every `fix_revision` in `findings.json` matches `^[0-9a-f]{40}$` and resolves to a commit or is a knowingly pruned ancestor-less commit (F-DG0-244).**
5. **Agent setup (§0.1/§0.2).** Verify from the recorded evidence that all ten agents loaded, ran as distinct invocations, used the orchestrator's model, and had out-of-scope writes blocked. Re-verify the guard live by attempting a write to `docs/source/QA-PROBE.txt`; your write guard should block it. Check `docs/delivery/agents.md` claims match the raw evidence.
6. **Feasibility.** The stage plan and acceptance map assign every A01–A28 scenario to a concrete test level and stage, with no scenario left untestable.

## Requirements to check (record exactly these in `requirements_checked`)
Check **all 19** DG0-final requirements (qa must cover every one), plus register-completeness over all rows:
`REQ-DLV-001`, `REQ-DLV-002`, `REQ-DLV-003`, `REQ-DLV-004`, `REQ-DLV-006`, `REQ-DLV-007`, `REQ-DLV-013`, `REQ-DLV-015`, `REQ-DLV-016`, `REQ-DLV-017`, `REQ-DLV-019`, `REQ-DLV-020`, `REQ-DLV-022`, `REQ-DLV-023`, `REQ-DLV-026`, `REQ-DLV-029`, `REQ-DLV-032`, `REQ-S20-024`, `REQ-S20-025`.
