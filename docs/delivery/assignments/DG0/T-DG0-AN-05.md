# Assignment T-DG0-AN-05: repair the round-1 register/analysis findings (transformation-analyst)

- **Stage:** P0 / DG0, state **FIXING**. **Base revision:** HEAD of `claude/mobily-transformation-platform-kwcc4i` (report `git rev-parse HEAD`).
- **The findings to fix** are in `docs/delivery/findings.json`: F-DG0-001, F-DG0-002, F-DG0-003, F-DG0-005 and F-DG0-203. The reviewers' full reasoning is in `docs/delivery/reviews/DG0/round-1/domain-reviewer.findings.json` and `qa-verifier.findings.json`. Read each finding's reproduction and expected behaviour.
- **Parallel work:** the orchestrator is fixing the tooling findings in `tools/**` and `docs/delivery/requirements-spec.md` at the same time. Don't touch those; the write guard enforces it.

## Required fixes
1. **F-DG0-001.** Split `REQ-PB-049`:
   - A DG3 row keeps `REQ-PB-049`. It covers per-transformation weight adjustment, the 100% total validation (reject 95%), and versioned weight sets usable by `REQ-S09-005`, with acceptance for invalid weights rejected. Increments `P3`, final gate DG3.
   - A new DG5 row, `REQ-PB-093`, covers administrator-configured default weights and rubrics in Playbook Studio. Use the next free PB number, and cite the same B blocks plus M0176.
   - Update the coverage rows, the stage plan and the acceptance map.
   - Recheck every other §21 "evidence required before approval" clause (M0404–M0411) against the `final_gate` of the rows that prove it, and fix any other mismatch you find. List them in your handback.
2. **F-DG0-002.** Apply the fix the finding expects:
   - `REQ-PB-020` (G5): approve is SP by default, or BO per T11 "Go-live / scale", and it's configurable. Alternatively, state explicitly that G5 is a transformation-level gate distinct from the initiative-level T11 decision. Pick one, justify it from the playbook, and make the register and the matrix consistent.
   - In the permissions matrix, add the T11 "Go-live / scale" decision row, and give SP Rv on the TOM row (RACI "C").
3. **F-DG0-003.** In the notes of every SOURCE row, separate the playbook content from master-prompt additions and interpretations, as REQ-PB-042/-058/-069/-083 do. Check **all 92 or more** PB rows, not only the three cited.
4. **F-DG0-005.** Fix the glossary Arabic terms for "Journey" and "Modular mode", as the finding suggests or better. Re-scan the whole glossary for other terms that are narrower than, or ambiguous against, the English meaning.
5. **F-DG0-203.** In `docs/analysis/stage-plan.md`, give every A-scenario a concrete owner and stage for its executable test, consistent with the gate at which it must pass:
   - the A-tests that must pass at DG2–DG5 are authored in P2–P5, test-first by qa-verifier before the candidate freezes, or by the implementers;
   - P6 extends and re-runs them.

   Keep `docs/analysis/acceptance-map.md` consistent with this.

After the fixes, run `python3 tools/source/merge_register.py` and `node tools/gates/validate.mjs --register DG0`. The register must still PASS. Note that the orchestrator may tighten the register rules concurrently: every evidence entry must become an existing file path. If a rule change makes a row fail, fix the part file.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback.

## Handback
`docs/delivery/handbacks/DG0/T-DG0-AN-05-transformation-analyst.md`. For each finding, give what changed (with file paths) and how you checked it.

## Addendum (orchestrator): register rule tightened by the F-DG0-106/202 fixes
Evidence entries must now be existing regular **files**; directories are rejected. `node tools/gates/validate.mjs --register DG0` currently fails on:
- REQ-DLV-026: `docs/delivery/runs/DG0`
- REQ-DLV-032: `.claude/agents`, `docs/delivery/handbacks/DG0/agent-load`, `docs/delivery/test-evidence/DG0/agent-load`, `docs/delivery/runs/DG0`

Replace each directory with the specific files that evidence the requirement. For example, list the ten `.claude/agents/<name>.md` files and `docs/delivery/agents.md` (which tabulates the load-check runs), instead of the directories. Note that `docs/delivery/runs/**`, `handbacks/**` and `test-evidence/**` are delivery metadata excluded from the candidate. Prefer candidate files (`docs/delivery/agents.md`, `tools/agents/run-agent.sh`, `.claude/agents/*.md`) as evidence wherever they demonstrate the requirement.

(An earlier attempt at this task was stopped by a transient permission-classifier outage before it changed any file. This is a fresh run.)
