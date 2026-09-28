# Assignment T-DG0-AN-06: finish the AN-05 repairs (merge, directory evidence, validate)

- **Stage:** P0 / DG0, state **FIXING**. **Base:** the current working tree. The AN-05 part-file edits are present but not merged, and not committed.
- **Context:** `docs/delivery/handbacks/DG0/T-DG0-AN-05-transformation-analyst.md`, sections 4 and 5, and the addendum at the end of `docs/delivery/assignments/DG0/T-DG0-AN-05.md`.

## Steps (all of them are required)
1. Run `python3 tools/source/merge_register.py` and paste its output.
2. Run `node tools/gates/validate.mjs --register DG0`. It currently reports:
   - **REQ-DLV-026 and REQ-DLV-032 cite directories as evidence.** Directories are no longer accepted, so edit `docs/analysis/parts/req-dlv-s14-s21.csv` to replace each directory with specific existing files that evidence the requirement. For REQ-DLV-032, for example, use the ten `.claude/agents/<name>.md` files plus `docs/delivery/agents.md`. Prefer candidate files: `docs/delivery/agents.md`, `tools/agents/run-agent.sh` and `tools/gates/**`, over excluded metadata under `docs/delivery/runs|handbacks|test-evidence/**`. Check each file exists with `test -f`.
   - Any other problem it prints.
   Re-merge and re-validate until it prints `PASS register rules at DG0`.
3. Confirm, or correct, the hand-computed counts in `docs/analysis/README.md` and `docs/analysis/stage-plan.md` against the merged register, using a short Python script. Paste its output.
4. If the shell is refused because the permission classifier returned no verdict, wait about a minute and retry; don't give up on the first refusal. The runner also resumes your session automatically.

## Permitted files
`docs/analysis/**`, `docs/delivery/requirements.csv` (only via the merge script), and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-06-transformation-analyst.md`. The handback must include the exact final validator output.
