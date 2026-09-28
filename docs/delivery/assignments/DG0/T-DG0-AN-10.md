# Assignment T-DG0-AN-10: fix F-DG0-009 so the test-reference check doesn't break when tests are added (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING**. **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Finding F-DG0-009 (domain-reviewer, Low):** `docs/analysis/tools/check_test_refs.py` hard-codes `EXPECTED_TITLES`. The orchestrator's round-4 repair added 5 validator tests, so the script now exits 1 on the candidate. See `docs/delivery/reviews/DG0/round-5/domain-reviewer.findings.json`.
- **Required:**
  1. **Make the check robust.** Derive the declared test titles from the test files themselves (`tools/gates/tests/*.test.mjs`, `tools/agents/tests/*.test.mjs` and `tools/agents/tests/test_*.py`) instead of a hand-maintained list. It must still fail if any quoted test title cited in the register doesn't exist.
  2. **Review the register rows** describing behaviour that the round-3/4 repairs added or changed:
     - tool-authored output binding (D-021 / F-DG0-119);
     - the gate file bound to the auditor run (F-DG0-121/211);
     - first-added-blob write-once (F-DG0-115/118);
     - round manifests recomputed from their source commit (F-DG0-212);
     - the runner metadata module `tools/agents/run_meta.py` with its tests `tools/agents/tests/test_run_meta.py`;
     - the pre-freeze check `tools/gates/prefreeze.sh`.

     Cite the new tests where a row's acceptance names tests, and add evidence files where appropriate: for example REQ-DLV-013, REQ-DLV-016, REQ-DLV-021, REQ-DLV-022 and REQ-DLV-026. Check the rows against `docs/delivery/decisions.md` D-016 to D-021.
  3. **Run `tools/gates/prefreeze.sh DG0`.** Every line must be PASS, except the final uncommitted-changes line, which fails while your edits are uncommitted; that's expected. Paste the output in your handback.
- **Classifier outages:** see the "Infrastructure" section of `docs/delivery/agent-protocol.md`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-10-transformation-analyst.md`.
