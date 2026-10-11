# Assignment T-DG4-AN-R1: register follow-up for F-DG4-140 and the round-1 repairs (transformation-analyst)

## Stage and working tree

- **Stage:** P4, gate DG4, in review round 1 (repairs before round 2).
- **Working tree:** a separate git worktree on branch `dg4/an-r1`, at the integrated `HEAD`.
- **Concurrency (D-004):** T-DG4-ARCH-R4, T-DG4-KBE-R5, T-DG4-BE-R5 and T-DG4-FE-R4 change code in their own worktrees. You change only `requirements.csv` rows and your handback.
- **Your write scope:** the named rows of `docs/delivery/requirements.csv`, `docs/analysis/**`, and your handback. Nothing else.
- **Time:** about 30 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.

## Task

1. **F-DG4-140** (`docs/delivery/reviews/DG4/round-1/qa-verifier.findings.json`):
   - **REQ-PB-010:** update its `notes` and `evidence` so they cite QA-D's test `tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts`.
   - **REQ-S03-004:** do the same with `tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts`.
   - **Both rows:** open each test first, and check that it asserts the clause. Then remove the now-false "test gap" statements, and keep the rest of the notes.
   - Append "DG4 analyst check (T-DG4-AN-R1, base <sha>): …".
2. **Change nothing else.** The round-1 repairs (D-117) change code, not requirement rows. If a row you touch would also need a repair's evidence, say so in the handback rather than citing a file that does not exist in your tree.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG4` → PASS, and `--register DG3` → PASS.
- A script shows that only REQ-PB-010 and REQ-S03-004 differ from the base, and only in `evidence` and `notes`, with every evidence path existing.
- The CSV still parses, with the same column count on every row.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-AN-R1-transformation-analyst.md`. Leave your changes **uncommitted**.
