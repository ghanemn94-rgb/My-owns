# Assignment T-DG0-AN-08: repair round-2 register findings F-DG0-006 and F-DG0-207 (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING**. **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Findings:** read the reproduction and expected result for each in `docs/delivery/findings.json` (sidecars in `docs/delivery/reviews/DG0/round-2/`).
  - **F-DG0-006.** Fix the provenance labelling of REQ-PB-088 and REQ-PB-068 as the finding expects. Then re-scan every PB row's "Master-prompt additions / Interpretations" wording, and check it against that row's actual `source_ref`.
  - **F-DG0-207.** Acceptance text must cite tests that exist. The current test titles (from `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs`) are:
    - reviewers may write only review records and evidence
    - qa-verifier may add tests under tests/qa and e2e but not product code
    - implementers cannot edit gate rules, agent definitions, sources or gate records
    - release-auditor writes gate decisions but not implementation
    - transformation-analyst is limited to analysis outputs and the register
    - unknown roles are denied and scratch space outside a repo is allowed
    - the hook entry point blocks with exit code 2 and allows with 0
    - implementers cannot write reviewer test evidence
    - F-DG0-105: Claude configuration surfaces and the unrelated project are protected from implementers
    - F-DG0-105: writes through a symlink into a protected path are blocked
    - F-DG0-105: protected-path matching is case-insensitive
    - F-DG0-111: a planted nested .git cannot move the guarded root; .git paths are never writable
    - the production guard root is this repository
    - a fully evidenced DG0 gate passes in current and historical mode
    - A24: a missing specialist reviewer fails the gate
    - A23: a reviewer who authored the scope, or who is an owner, is rejected
    - A23: reviewers sharing one invocation are not independent
    - A24 / F-DG0-102: fabricated or incomplete provenance is rejected
    - F-DG0-201: a review bound to an unrelated run of the same role is rejected
    - A24: failed or BLOCKED checks and non-PASS verdicts fail the gate
    - A24: unresolved blocking findings fail the gate; owners cannot verify their own fix
    - F-DG0-101: findings cannot escape by relabelling, dropping or downgrading
    - A24 / F-DG0-106 / F-DG0-202: incomplete requirements, placeholder evidence and coverage gaps fail
    - A25: a source change invalidates the approval; review metadata does not
    - A25 / F-DG0-103: symlinks are part of the candidate identity; submodules are refused
    - F-DG0-104: the manifest spec must equal the stage spec and the approved policy
    - A25: a tampered manifest or a stale review candidate is detected
    - F-DG0-102: approval records are immutable after approval (historical mode)
    - the gate record must be written by the audited release-auditor invocation
    - A24: the pipeline cannot advance past a gate that is not APPROVED
    - illegal stage transitions are rejected
    - an APPROVED gate with a BLOCKED decision or blocking conditions fails
    - F-DG0-107: the CSV parser rejects text after a closing quote and ragged rows
    - F-DG0-110 / F-DG0-204: closure comes from the reviewer's own verification sidecar and bound run
    - F-DG0-101 residual: deleting an earlier review round is detected
    - F-DG0-205: evidence that is a symlink to a file outside the repository is rejected
    - F-DG0-112 / F-DG0-206: file mode and entry type are part of the candidate identity
    Update REQ-DLV-013 and REQ-DLV-026, then **check every register row** whose acceptance or evidence names a test title or a file, and correct any other stale reference. A script that cross-checks quoted test titles against the list above is recommended; save it as `docs/analysis/tools/check_test_refs.py` and paste its output.
- Then run `python3 tools/source/merge_register.py`, `python3 docs/analysis/tools/check_counts.py` and `node tools/gates/validate.mjs --register DG0`. All of them must pass.
- If shell commands are refused because the classifier returns no verdict, follow the "Infrastructure" section of `docs/delivery/agent-protocol.md`: retry, then end your turn with `CLASSIFIER-BLOCKED`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-08-transformation-analyst.md`.
