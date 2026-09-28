# Assignment T-DG0-AN-12: follow-up to T-DG0-AN-11 after the orchestrator closed two gaps it reported (transformation-analyst)

- **Stage:** P0 / DG0, state **REVIEWING** (before the round-13 freeze). **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Context.** Your AN-11 handback (`docs/delivery/handbacks/DG0/T-DG0-AN-11-transformation-analyst.md`, §4) reported two gaps. The orchestrator closed both in commit `ff838e3`:
  1. **The zero-length stub exemption now has automated tests.** `tools/agents/tests/runner.test.mjs` has two new tests:
     - "D-026: zero-length untracked sandbox stubs are not reported as configuration changes";
     - "D-026: configuration with content, a symlink, or a truncated tracked file is still reported (exit 71, no auto-commit)".

     Each was shown to fail on a runner deliberately broken in the matching direction.
  2. **The pre-freeze now checks that the register equals the merge output.** `tools/gates/prefreeze.sh` re-runs `tools/source/merge_register.py` in the sandboxed clone and requires `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv` to be unchanged. The check was shown to fail at `86b0986` and pass from `f764edf`.

  `docs/delivery/decisions.md` D-026 records both.
- **One correction to your assignment and your notes.** Nested bubblewrap **is** available inside the agent sandbox: the orchestrator ran `bwrap` and `tools/gates/tests/sandbox.test.mjs` from a sandboxed session, and both succeeded. The AN-11 assignment wrongly said otherwise. REQ-DLV-023's notes currently say "An analyst cannot run prefreeze.sh inside its own sandbox (nested bubblewrap is unavailable there)". Correct this: prefreeze checks the committed HEAD, so it is run after committing.

## Required
1. **Update the REQ-DLV-007 notes and acceptance.**
   - Remove the "has no dedicated automated test" residual.
   - Cite the two new runner test titles verbatim in the acceptance where the stub exemption is described.
2. **Update REQ-DLV-023.**
   - The procedure and acceptance now include the pre-freeze check "register equals the merge of docs/analysis/parts (sandboxed)".
   - Correct the nested-bubblewrap note as above.
   - Keep the open note that the CI bubblewrap step is unverified.
3. **Edit only the part file**, then regenerate with `python3 -I -B tools/source/merge_register.py`.
4. **Run and paste in your handback:**
   - `node tools/gates/validate.mjs --register DG0`
   - `python3 -I -B docs/analysis/tools/check_counts.py`
   - `python3 -I -B docs/analysis/tools/check_pb_provenance.py`
   - `python3 -I -B docs/analysis/tools/check_test_refs.py`
   - `node --test tools/agents/tests/runner.test.mjs`
5. **Change nothing else.** Your handback lists the exact rows changed.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-12-transformation-analyst.md`.
