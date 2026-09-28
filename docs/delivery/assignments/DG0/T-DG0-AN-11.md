# Assignment T-DG0-AN-11: fix F-DG0-232 so the register reflects the D-022 to D-026 delivery controls (transformation-analyst)

- **Stage:** P0 / DG0, state **REVIEWING** (between round 12 and the round-13 freeze). **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Finding F-DG0-232 (qa-verifier, Low).** The register doesn't reflect D-025:
  - REQ-DLV-007 (IMPLEMENTED) still says shell writes are controlled only because "the orchestrator checks git status after each run";
  - no register row cites `tools/agents/agent_settings.py`, `tools/agents/tests/test_agent_settings.py` or the validator's D-025 test.

  See `docs/delivery/reviews/DG0/round-12/qa-verifier.findings.json`.
- **Background to read first:**
  - `docs/delivery/decisions.md` D-022 to D-026;
  - `docs/delivery/threat-model.md`;
  - the round-12 repair commit `1a86582`, which is D-026: the orchestrator never executes agent-writable code outside a sandbox. It added:
    - `python3 -I -B` for the runner helpers;
    - `tools/gates/sandbox-run.sh` and its use in `tools/gates/prefreeze.sh`;
    - the validator's F-DG0-230 deny-list binding;
    - the zero-length stub rule in the config scan;
    - the bubblewrap CI step.

## Required

1. **Rewrite REQ-DLV-007** so the procedure, evidence and notes describe the real controls:
   - the file-tool write guard (D-009, D-020, D-023, D-024);
   - the OS Bash sandbox generated per run by `tools/agents/agent_settings.py`, with its deny list and role confinement (D-025);
   - the validator requirement that gate records come from sandboxed runs whose deny list names the run's own directory (D-025, F-DG0-230);
   - the runner's config scan (D-024, D-025, D-026).

   Remove the claim that a git status check is the compensating control. Keep the row's disclosed residuals honest: cite `threat-model.md` rather than claiming more than it does.
2. **Review the other DLV rows touched by D-022 to D-026 and update any that are now stale.** Candidates include:
   - the rows on agent invocation and run evidence (CLI prompt replay, D-022);
   - the rows on the write guard, worktrees and guard root (D-023/D-024);
   - the rows on the pre-freeze integration check (now sandboxed, D-026);
   - the rows on the CI workflow (the bubblewrap step);
   - the rows on external configuration changes (`external_config_changed`).

   Where a row's acceptance names tests, cite the real test titles. The test-reference check `docs/analysis/tools/check_test_refs.py` must keep passing. The relevant tests are:
   - `tools/agents/tests/test_agent_settings.py`;
   - `tools/agents/tests/runner.test.mjs`, test "F-DG0-140: modules planted in the repository root are never imported by the runner's helpers";
   - `tools/gates/tests/sandbox.test.mjs`;
   - the validator tests "D-025: gate records must come from Bash-sandboxed runs" and "F-DG0-230: the sandbox deny list must protect the run's own repository, not some other directory".

   Add evidence files where a row's evidence column should name them: `tools/agents/agent_settings.py`, `tools/gates/sandbox-run.sh`, `docs/delivery/threat-model.md`.
3. **Edit only the part files** under `docs/analysis/parts/`, for example `req-dlv-s14-s21.csv`. Then regenerate the register with `python3 -I -B tools/source/merge_register.py`. Don't edit `docs/delivery/requirements.csv` by hand.
4. **Run the checks in the working tree** and paste their output in your handback. Every one must pass:
   - `node tools/gates/validate.mjs --register DG0`
   - `python3 -I -B docs/analysis/tools/check_counts.py`
   - `python3 -I -B docs/analysis/tools/check_pb_provenance.py`
   - `python3 -I -B docs/analysis/tools/check_test_refs.py`
   - `node --test tools/gates/tests/validator.test.mjs`

   Don't run `tools/gates/prefreeze.sh`. It now checks only the committed HEAD, inside a nested bubblewrap sandbox that is not available inside your own sandbox. The orchestrator runs it after committing your change.
5. **Classifier outages:** see the "Infrastructure" section of `docs/delivery/agent-protocol.md`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-11-transformation-analyst.md`.
