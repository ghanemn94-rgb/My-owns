# DG0 assignment: qa-verifier (round 4)

Read `docs/delivery/assignments/DG0/round-4/review-common.md` first. Task ID: `T-DG0-REV-QA-R4`.

## Your scope: execute and independently verify the DG0 acceptance criteria

1. **Run everything that exists** and record the command, environment and actual output:
   - `tools/source/check_extraction.sh`
   - `node --test tools/gates/tests/*.test.mjs`
   - `node --test tools/agents/tests/*.test.mjs`
   - `node tools/gates/validate.mjs --register DG0`
   - `node tools/gates/validate.mjs --pipeline`
   - `node tools/gates/validate.mjs --reconcile`
   - `node tools/gates/candidate.mjs --stage DG0`
2. **Independent negative tests (A24/A25).** Write your own tests under `docs/delivery/test-evidence/DG0/qa/tests/` (Node's built-in `node:test`, no dependencies). **Do not write them under `tests/qa/` during this review.** New files there would change the frozen candidate. The orchestrator promotes your tests into `tests/qa/dg0/` in the next stage's candidate, as regression tests that build disposable fixtures and prove the validator rejects:
   - a missing reviewer;
   - a reviewer who authored the scope;
   - a shared invocation;
   - a failed or blocked check;
   - an unresolved High finding;
   - an incomplete requirement;
   - a register row with a non-existent block anchor;
   - a SOURCE row without a playbook block;
   - a coverage matrix missing a block or mapping to a requirement that doesn't cite it;
   - a candidate change after freeze;
   - a tampered manifest.
   Also prove that review-metadata changes do not alter the candidate. Design at least 5 cases that are **not** already in `tools/gates/tests/`. Run them and save the output under `docs/delivery/test-evidence/DG0/qa/`.
3. **Register integrity (independent script, saved under `docs/delivery/test-evidence/DG0/qa/`).** Check:
   - every row's columns;
   - that no row is `VERIFIED` (the status is derived, never declared);
   - that `IMPLEMENTED` DLV rows' evidence paths exist **and actually implement the requirement** (open them);
   - that the A01–A28 coverage and the `final_gate`/`increments` consistency hold;
   - the counts per class, area and gate;
   - that the coverage matrices are exactly complete.
4. **Agent setup (§0.1/§0.2).** Verify from the recorded evidence (`docs/delivery/runs/DG0/DG0-T-DG0-LOAD-*/meta.json`, `result.json`, `transcript.jsonl.gz`) that all ten agents loaded, ran as distinct invocations, used the orchestrator's model, and had out-of-scope writes blocked. Then re-verify the guard live yourself by attempting a write to `docs/source/QA-PROBE.txt`; your own write guard should block it. Check that `docs/delivery/agents.md` claims match the raw evidence.
5. **Feasibility.** The stage plan (`docs/analysis/stage-plan.md`) and acceptance map (`docs/analysis/acceptance-map.md`) assign every A01–A28 scenario to a concrete test level and stage, with no scenario left untestable.

Requirements you verify: every `REQ-DLV-*` row with `final_gate` DG0, plus register-completeness checks over all rows. List exactly what you checked.
