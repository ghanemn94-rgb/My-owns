# Assignment T-DG0-AN-13: register rows for D-027, and a DG1 requirement for sandboxed dependency installation (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING** (after round 13). **Base:** HEAD of `claude/mobily-transformation-platform-kwcc4i`.
- **Background to read first:**
  - `docs/delivery/decisions.md` D-027;
  - `docs/delivery/threat-model.md`, especially the "Mechanically prevented" rows and residual 3;
  - the repair commit `cf13cb1`;
  - the round-13 findings in `docs/delivery/reviews/DG0/round-13/*.findings.json`:
    - F-DG0-012, F-DG0-141 and F-DG0-142;
    - F-DG0-233 and F-DG0-234.

## Required
1. **F-DG0-142: add one new ENGINEERING requirement**, using the next free `REQ-DLV-*` ID in the part file.
   - **What it requires:** dependency installation runs inside the OS sandbox (bubblewrap). It is an orchestrator step, because agent shells have no network. Inside that sandbox:
     - network is allowed for the package registry;
     - the root filesystem is read-only, and only the target tree and the package store are writable;
     - lifecycle scripts are disabled unless allow-listed;
     - the lockfile is committed.
   - **The installation wrapper and its tests** are delivered in P1, before the first install.
   - **Source:** ground it in master-prompt blocks. For example:
     - §0: the orchestrator executes nothing agent-writable outside a sandbox; reliability of the delivery controls;
     - §16/§19: dependency pinning, lockfiles, self-hosting.

     Cite the exact `M####` anchors you rely on and label the bubblewrap detail as an implementation decision (D-027), not source text.
   - **Suggested classification:** increments `P1`, `final_gate` `DG1`, status `SPECIFIED`. Follow `docs/delivery/requirements-spec.md` and the §21 stage table if they point elsewhere, and explain your choice.
   - **Keep the coverage matrices consistent.** Any `M` block you cite must list the new requirement where the rules require it. Use a `ref-additions-*.csv` part or a coverage part as the merge script expects.
2. **Update the rows describing the changed controls**, citing the new tests verbatim (titles are in the test files):
   - **REQ-DLV-023** (pre-freeze / `sandbox-run.sh`): the clone, checkout and command all run inside bubblewrap on a private tmpfs, and the git directory is bound read-only. Cite the test "F-DG0-141: the clone, checkout and command run inside the sandbox, in a work area no other process can see".
   - **REQ-DLV-007** (write controls / config scan): added, changed and removed entries are reported, and the scan fails closed. Cite the test "F-DG0-012/F-DG0-234: an untracked or ignored configuration file that is deleted or truncated to zero length is reported as removed".
   - **REQ-DLV-013** (provenance): `meta.cwd` must equal the transcript's init `cwd` and the prompt's working directory. Cite the test "F-DG0-233: meta.cwd is bound to the transcript (the CLI init line and the replayed prompt)".
   - **Also:** fix any other statement in the register that D-027 made stale, for example the rows or notes that say the sandbox wrapper clones into `$TMPDIR`, or that dependency installation happens outside the sandbox.
3. **Edit only the part files**, then regenerate with `python3 -I -B tools/source/merge_register.py`.
4. **Run and paste in your handback.** Every check must pass:
   - `node tools/gates/validate.mjs --register DG0`
   - `python3 -I -B docs/analysis/tools/check_counts.py`
   - `python3 -I -B docs/analysis/tools/check_pb_provenance.py`
   - `python3 -I -B docs/analysis/tools/check_test_refs.py`
   - `node --test tools/gates/tests/validator.test.mjs`

   If `check_counts.py` compares README or stage-plan counts, update `docs/analysis/README.md` and `docs/analysis/stage-plan.md` for the new requirement as those checks demand.
5. **Classifier outages:** see the "Infrastructure" section of `docs/delivery/agent-protocol.md`.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-13-transformation-analyst.md`.
