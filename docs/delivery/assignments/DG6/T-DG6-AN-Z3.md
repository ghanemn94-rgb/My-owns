# Assignment T-DG6-AN-Z3: DG6 round-4 repair: register rows after the round-4 repairs (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 4).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-z3`, at the integrated `HEAD`. Every round-1 repair (BE-Y1..Y6, DO-Y1, DO-Y2, FE-Y1, ARCH-11..13; D-206 to D-208), the round-2 repairs (D-209, D-210) the round-3 repairs (D-211) and the round-4 repairs BE-Z5 and FE-Z3 are merged. Their handbacks are under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** you run alone.

## What to c## What to change

Read the round-4 findings F-DG6-280, 281, 300, 301 and 320 (`docs/delivery/reviews/DG6/round-4/*.findings.json`) and the handbacks of T-DG6-BE-Z5 and T-DG6-FE-Z3 under `docs/delivery/handbacks/DG6/`. Update `docs/delivery/requirements.csv` so that the notes and evidence of every DG6 row touched by a round-4 repair describe the candidate's actual behaviour and residuals. Each such row cites the repair's handback and the evidence of the shipped behaviour. At least:

- REQ-S10-002 (BE-Z5, F-DG6-300 and F-DG6-280: derived read paths and the escalation's executive ask; the sweep test). Disclose the residuals BE-Z5's handback §10 lists (GET operations the sweep cannot fill, stored rows from before the fix, ids and codes, the truthful counts kept);
- REQ-S15-007 (FE-Z3, F-DG6-320 and F-DG6-301: the exception and field-error texts, and the extended catalogue test);
- REQ-S17-001 (FE-Z3, F-DG6-281: the connector target display);
- any row whose notes cite the escalation, executive asks, traceability, missing links, G6 readiness or the register reports.

Sweep every other DG6 row whose notes name a round-4 finding or a round-4 repair task, and correct it the same way. Do not change a row's status unless its evidence shows it, and never mark a row IMPLEMENTED on evidence you did not confirm passes in the cited log. The orchestrator's final verification of the merged tree comes after you; a row whose final verification is that run or the next review round says so. Do not change later-gate rows (`final_gate` DG7).
ification (real output in the handback)

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

Write `docs/delivery/handbacks/DG6/T-DG6-AN-Z3-transformation-analyst.md`: the rows changed; per row, the acceptance clause, the test that asserts it and the log that shows it passing; the validator output; every row you could not evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
