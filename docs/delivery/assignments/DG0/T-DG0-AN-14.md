# Assignment T-DG0-AN-14: acceptance-map drift (F-DG0-235) with an automated check, and register rows for D-028 (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING** (after round 14). **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Background to read first:**
  - `docs/delivery/decisions.md` D-028;
  - `docs/delivery/threat-model.md`;
  - the repair commit `5c4a12b`;
  - the round-14 findings:
    - `docs/delivery/reviews/DG0/round-14/qa-verifier.findings.json` (F-DG0-235);
    - `docs/delivery/reviews/DG0/round-14/code-security-reviewer.findings.json` (F-DG0-143, F-DG0-144).
- **Your shell and scratch changed (D-028).** Your `$TMPDIR` is now private to your run and is removed when the run ends. Keep nothing there that must survive the run.

## Required
1. **F-DG0-235.** `docs/analysis/acceptance-map.md` must list REQ-DLV-042 wherever its acceptance column cites a scenario (A18, A23, A24), including the A24 "rows adding cases later" table if that is where it belongs.
2. **Make this drift impossible to miss.** Add an automated check under `docs/analysis/tools/`: either a new `check_acceptance_map.py` or an extension of `check_counts.py`.
   - For every register row, every scenario `A01`–`A28` cited in its `acceptance` column must be listed for that row in `acceptance-map.md`, and the reverse must hold as well.
   - The check exits non-zero on any mismatch and prints the mismatches.
   - `tools/gates/prefreeze.sh` automatically runs every `docs/analysis/tools/*.py`, so a new script is picked up without further changes.
   - Show in your handback that the check fails on the pre-fix `acceptance-map.md` (for example against `git show HEAD:docs/analysis/acceptance-map.md` via a temporary copy under your `$TMPDIR`) and passes after the fix.
   - If the map deliberately doesn't list some rows (for example grouped by area), define the exact rule the map follows and check that rule. Don't loosen it until the check passes.
3. **Update the rows that describe the changed controls**, citing the new tests verbatim (titles are in the test files):
   - **REQ-DLV-007** (write controls):
     - only the run's private `MTH_RUN_TMP` is file-tool scratch, never the shared `/tmp`;
     - the guard fails closed on unresolvable paths and on `/proc`, `/sys` and `/dev`;
     - each reviewer may write only its own review files and evidence directory, in both the guard scopes and the sandbox deny list.

     Cite:
     - "F-DG0-144: a reviewer may not write another reviewer's record, sidecars or evidence"
     - "F-DG0-144: only the run's own private temporary directory is scratch, never the shared /tmp"
     - "F-DG0-143: writes that resolve through /proc, /sys or /dev, or whose real path cannot be determined, are blocked"
     - `test_each_reviewer_writes_only_its_own_evidence_directory`
     - `test_roles_without_evidence_cannot_write_any`
     - `test_a_stage_is_required`
   - **REQ-DLV-006** (agent invocation): every run gets a private `TMPDIR`, exported as `TMPDIR` and `MTH_RUN_TMP` and removed at the end, and `agent_settings.py` takes the stage. Cite the runner test "F-DG0-144: every run gets its own private TMPDIR, exported to the agent and removed when the run ends".
   - **REQ-DLV-008** (concurrent writers, SPECIFIED): record that concurrent agents are now isolated in scratch, records and evidence (D-028).
   - **Also:** fix any other register statement D-028 made stale, for example "the temp directory is scratch" or reviewers writing `docs/delivery/test-evidence/**` or `docs/delivery/reviews/**` broadly.
4. **Edit only the part files and analysis docs**, then regenerate the register with `python3 -I -B tools/source/merge_register.py`.
5. **Run and paste in your handback.** Every check must pass:
   - `node tools/gates/validate.mjs --register DG0`
   - every `python3 -I -B docs/analysis/tools/*.py`, including your new check
   - `node --test tools/agents/tests/guard.test.mjs tools/agents/tests/runner.test.mjs`
   - `python3 -I -B -m unittest discover -s tools/agents/tests -p 'test_*.py'`
6. **Classifier outages:** see the "Infrastructure" section of `docs/delivery/agent-protocol.md`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-14-transformation-analyst.md`.
