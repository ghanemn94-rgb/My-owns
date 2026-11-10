# Assignment T-DG6-AN-Z2: DG6 round-3 repair: register rows after the round-3 repairs (F-DG6-260) (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-z2`, at the integrated `HEAD`. Every round-1 repair (BE-Y1..Y6, DO-Y1, DO-Y2, FE-Y1, ARCH-11..13; D-206 to D-208), the round-2 repairs (D-209, D-210) and the round-3 repairs BE-Z4 and FE-Z2 are merged. Their handbacks are under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** you run alone.

## What to change

Read F-DG6-260 (`docs/delivery/reviews/DG6/round-3/qa-verifier.findings.json`) verbatim. Update `docs/delivery/requirements.csv` so that the notes and evidence of every DG6 row touched by a round-3 repair, or named by F-DG6-260, describe the candidate's actual behaviour and residuals. Each such row cites the repair's handback and the evidence of the shipped behaviour. At least:

- REQ-S20-001, REQ-S20-012, REQ-S20-017 and REQ-S20-022 (F-DG6-260): their notes still report acceptance suites as failing or not yet in the tree. On the round-3 candidate they are present and pass; cite the orchestrator's final verification `docs/delivery/test-evidence/DG6/orchestrator-final-8b22cc0/` and the round-3 QA evidence;
- REQ-S10-002 (BE-Z4, F-DG6-220: corrective case, transition decision and performance-area link of a sensitive benefit). Remove the residuals that BE-Z3 and BE-Z4 resolved. Disclose what BE-Z4's handback says remains: other records still show a restricted case's id or code, but none of its values;
- REQ-S15-011 (FE-Z2, F-DG6-222: unbound SecretRef field errors marked and localized);
- REQ-S15-007 (FE-Z2, F-DG6-221: the Arabic "Last error" text);
- any row whose notes cite the a02 demo walkthrough's step 10 (FE-Z2, F-DG6-261).

Sweep every other DG6 row whose notes name a round-3 finding (F-DG6-220 to 222, 260 or 261) or a round-3 repair task (BE-Z4, FE-Z2), and correct it the same way. Do not change a row's status unless its evidence shows it, and never mark a row IMPLEMENTED on evidence you did not confirm passes in the cited log. A row whose final verification is the next review round says so. Do not change later-gate rows (`final_gate` DG7).

## Self-verification (real output in the handback)

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

Write `docs/delivery/handbacks/DG6/T-DG6-AN-Z2-transformation-analyst.md`: the rows changed; per row, the acceptance clause, the test that asserts it and the log that shows it passing; the validator output; every row you could not evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
