# Orphaned round-5 review attempts (not evidence for any gate decision)

The round-5 runs of **code-security-reviewer** (`DG0-T-DG0-REV-SEC-R5-…-65b43ddb`) and **qa-verifier** (`DG0-T-DG0-REV-QA-R5-…-98345982`) completed their review work. Then the runner's metadata step (`run-agent.sh` → Python replay code) crashed on a transcript event whose `message` field was a plain string. The error was `AttributeError: 'str' object has no attribute 'get'`, and it's a bug in the orchestrator-owned runner.

Because of the crash, those runs have no `meta.json`. Their before and after snapshots were already deleted, so their outputs and `tool_authored` bindings can't be reconstructed honestly. The orchestrator does not fabricate them.

Their records and sidecars were moved here unchanged from `docs/delivery/reviews/DG0/round-5/`, so the work stays inspectable. They are **not** imported into `findings.json`, and they count toward no gate. The runner was fixed:
- the metadata step moved to `tools/agents/run_meta.py`;
- regression tests were added in `tools/agents/tests/test_run_meta.py`;
- the snapshots are now kept until `meta.json` exists.

Both reviews are re-run in round 6 as fresh invocations.
