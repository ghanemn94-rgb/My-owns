# Assignment T-DG0-AN-07: make the stage-plan lists consistent with the merged register

- **Stage:** P0 / DG0, state **FIXING**. **Base:** the current working tree. The orchestrator has run the merge: `docs/delivery/requirements.csv` now has 411 rows, and `node tools/gates/validate.mjs --register DG0` prints PASS.
- **Problem:** your consistency script from T-DG0-AN-06, `/tmp/claude-0/-home-user-My-owns/3253d7a4-2657-4ff1-8731-f03e580f3e38/scratchpad/counts.py`, reports `STAGE-PLAN LISTS MISMATCH`. Every "Requirements with an increment in Pn that complete later" list in `docs/analysis/stage-plan.md` differs from the register for P0–P6. The "completing at DGn" lists all match.

## Steps
1. Copy the script into the repository as `docs/analysis/tools/check_counts.py`, so reviewers can re-run it, and make it exit non-zero on any mismatch.
2. Regenerate the P0–P6 "increment in … complete later" lists in `docs/analysis/stage-plan.md` from the register. Prefer generating them with the script rather than editing by hand.
3. Re-run the script until it reports no mismatch. Confirm the counts in `docs/analysis/README.md` too.
4. Run `node tools/gates/validate.mjs --register DG0`. It must still print PASS. Don't edit the part files unless the validator requires it; if you do edit them, re-run `python3 tools/source/merge_register.py`.
5. See "Infrastructure: permission-classifier outages" in `docs/delivery/agent-protocol.md`. If the shell keeps being refused, end your turn with the `CLASSIFIER-BLOCKED` marker and you'll be resumed.

## Permitted files
`docs/analysis/**` and your handback `docs/delivery/handbacks/DG0/T-DG0-AN-07-transformation-analyst.md`. Paste the final outputs of both the script and the validator into the handback.
