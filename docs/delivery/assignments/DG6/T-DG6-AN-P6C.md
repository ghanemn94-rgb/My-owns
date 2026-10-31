# Assignment T-DG6-AN-P6C: DG6 register update, the last 5 rows (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-p6c`, at the integrated `HEAD`. Every P6 implementation, repair and acceptance-suite task except QA-E is merged there (D-193 to D-202); the evidence is in the QA handbacks under `docs/delivery/test-evidence/DG6/qa/` and the implementer handbacks under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** you run alone. Every DG6 implementation, repair and QA task is merged (D-202).
- **Your 5 rows:**
- REQ-S12-019: repaired by BE-X4.
- REQ-S15-014: clause 2 tested by QA-F.
- REQ-S17-007: repaired by BE-X5.
- REQ-S20-030: re-measured on an idle host by DO-H.
- REQ-DLV-038: the evidence run is QA-EB's. The repairs after it (BE-X4, BE-X5, QA-F, QA-G, FE-X3, BE-X6) are cited by their handbacks. The binding re-run is the orchestrator's freeze verification. Say so in the notes, and cite `docs/delivery/test-evidence/DG6/orchestrator-prefreeze-1726c96/` as the pre-repair run.

Before you mark a row IMPLEMENTED, confirm that the cited tests pass in the repair task's handback logs. Read the earlier analysis in `docs/delivery/handbacks/DG6/T-DG6-AN-P6A-transformation-analyst.md` §4 and `T-DG6-AN-P6B-transformation-analyst.md` §5.

**Later-gate rows with a P6 increment** (`final_gate` DG7): do not change them.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG6`: show its output. With all five rows done it must PASS. If it does not, list each failure and why.
- `node tools/gates/validate.mjs --register DG4`, `--register DG3` and `--register DG2` → still PASS.
- **CSV integrity:** the CSV still parses, with the same column count on every row and valid quoting. Check it with a small script and show its output.
- **Your rows only:** a script must show that only your rows (and, for half A, the later-gate notes) differ from the base.
- **Every evidence path exists:** a script must check every path in your rows' `evidence` and show the output.
- **`git diff --stat`** shows only `requirements.csv`, plus your handback and any `docs/analysis/**` note.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-AN-P6C-transformation-analyst.md`. Include:
- the rows changed;
- per row, the acceptance clause and the test that asserts it;
- the validator output;
- every row you could NOT evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
