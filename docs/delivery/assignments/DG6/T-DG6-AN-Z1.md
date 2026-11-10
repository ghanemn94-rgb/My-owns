# Assignment T-DG6-AN-Z1: DG6 round-2 repair: register rows after the round-1 and round-2 repairs (F-DG6-161, F-DG6-201) (transformation-analyst)

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg6/an-z1`, at the integrated `HEAD`. Every round-1 repair (BE-Y1..Y6, DO-Y1, DO-Y2, FE-Y1, ARCH-11..13; D-206 to D-208) and the round-2 repairs BE-Z1, ARCH-14 and BE-Z2/Z2B (D-209) are merged. Their handbacks are under `docs/delivery/handbacks/DG6/`.
- **Concurrency (D-004):** you run alone.

## What to change

Read F-DG6-161 (`docs/delivery/reviews/DG6/round-2/domain-reviewer.findings.json`) and F-DG6-201 (`docs/delivery/reviews/DG6/round-2/qa-verifier.findings.json`) verbatim. Update `docs/delivery/requirements.csv` so that the notes and evidence of every DG6 row touched by a round-1 or round-2 repair describe the candidate's actual behaviour and residuals, and cite the repair's handback and the evidence of the shipped behaviour. At least:

- REQ-S12-019 (BE-Y3: freshness across periods; ADR-0053 corrected by ARCH-14);
- REQ-S16-030 (BE-Y4: export and upload rate-limit classes wired; BE-Z2: binding of the secret interface);
- REQ-S20-029 (DO-Y1: RFC ids in the tree's generator);
- REQ-S20-030 (BE-Y5/BE-Y6/DO-Y2: asynchronous live-export assembly, D-207, and its re-measurement);
- REQ-S10-002 (BE-Y1 and BE-Z1: sensitive reach incl. benefit calculation lineage);
- REQ-S16-029 (BE-Y2 and BE-Z2: SecretRef namespace and binding, D-209);
- REQ-DLV-038.

Sweep every other DG6 row whose notes name a round-1 or round-2 finding (F-DG6-100..147, 180, 181) or a repair task, and correct it the same way. Do not change a row's status unless its evidence shows it; never mark a row IMPLEMENTED on evidence you did not confirm passes in the cited log. A row whose final verification is the next review round says so. Later-gate rows (`final_gate` DG7): do not change them.

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

Write `docs/delivery/handbacks/DG6/T-DG6-AN-Z1-transformation-analyst.md`: the rows changed; per row, the acceptance clause, the test that asserts it and the log that shows it passing; the validator output; every row you could not evidence, flagged as a real gap.

Leave your changes **uncommitted** for the orchestrator to integrate.
