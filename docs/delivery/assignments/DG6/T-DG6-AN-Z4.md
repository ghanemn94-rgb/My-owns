# Assignment T-DG6-AN-Z4: DG6 round-5 repair: register rows after the round-5 repairs (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 5).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-z4`, at the integrated `HEAD`. Every round-1 repair (BE-Y1..Y6, DO-Y1, DO-Y2, FE-Y1, ARCH-11..13; D-206 to D-208), the round-2 repairs (D-209, D-210) the round-3 repairs (D-211) the round-4 repairs (D-212 to D-214) and the round-5 repairs BE-Z7B, BE-Z8 and ARCH-15 (D-215) are merged. Their handbacks are under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** you run alone.

## What to change

Read the round-5 findings F-DG6-340, 341, 360, 361, 362 and 380 (`docs/delivery/reviews/DG6/round-5/*.findings.json`), and the handbacks of T-DG6-BE-Z7B, T-DG6-BE-Z8 and T-DG6-ARCH-15 under `docs/delivery/handbacks/DG6/`. Update `docs/delivery/requirements.csv` so that the notes and evidence of every DG6 row touched by a round-5 repair describe the candidate's actual behaviour and residuals. Each such row cites the repair's handback and the evidence of the shipped behaviour. At least:

- REQ-S10-002 (BE-Z7B: the Executive Overview, drill-downs and dashboards, restricted totals and `includesRestrictedRecords`, and the sweep as a real guard). Disclose the residuals in BE-Z7B's handback §7:
  - the 75 GET operations the sweep cannot fill;
  - the search index;
  - the flag-only adoption filter;
  - the omitted-table totals.
- REQ-S12-019, REQ-S20-013 and REQ-S20-022 (BE-Z8, F-DG6-380: concurrent failures on one queue are each captured once; the BE-Z6 acknowledge rule).
- Any row whose notes cite dashboards, the overview, drill-downs, report totals, the failure queue or operational exceptions.

Sweep every other DG6 row whose notes name a round-5 finding or a round-5 repair task, and correct it the same way.
- Do not change a row's status unless its evidence shows it.
- Never mark a row IMPLEMENTED on evidence you did not confirm passes in the cited log.
- The orchestrator's final verification of the merged tree comes after you. A row whose final verification is that run, or review round 6, says so.
- Do not change later-gate rows (`final_gate` DG7).

## Verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG6`: show its output; list each failure and why.
- `node tools/gates/validate.mjs --register DG5`, `--register DG4`: still PASS.
- **CSV integrity:** the CSV parses, with the same column count on every row and valid quoting (a small script, output shown).
- **Your rows only:** a script shows which rows differ from the base, and each is a DG6 row you list.
- **Every evidence path exists:** a script checks every path in the changed rows' `evidence` and shows the output.
- **`git diff --stat`** shows only `requirements.csv`, your handback and any `docs/analysis/**` note.

## Write guard

Never edit `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json` or `trading_agent/`.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-AN-Z4-transformation-analyst.md`: the rows changed; per row, the acceptance clause, the test that asserts it and the log that shows it passing; the validator output; every row you could not evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
