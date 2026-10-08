# Assignment T-DG3-AN-P3B: register evidence after wave 6 (transformation-analyst)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING), the last step before the candidate freezes.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg3/an-p3b`, at the integrated `HEAD`, which contains every P3 task through wave 6 (FE-D, BE-F and your own AN-P3).
- **Write scope:** `docs/delivery/requirements.csv` and your handback only.
- **Concurrency (D-004):** BE-G (`apps/api/**` tests) and FE-F (the G4 refusal dialog and `apps/web/e2e/p3-g4-refusal.spec.ts`) run alongside you. Their new files are not in your tree, so do not cite them.
- **Time:** about 20–30 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.

## Task

Update the `evidence` of the DG3 rows that wave 6 changed, following your own AN-P3 observations O-2 and O-3 (`docs/delivery/handbacks/DG3/T-DG3-AN-P3-transformation-analyst.md` §5). **Before citing a file, open it and check that it asserts the acceptance clause.**

- **FE-D's journeys spec.** Add `apps/web/e2e/p3-journeys.spec.ts` to each row whose acceptance it drives in the browser. At least:
  - REQ-DLV-035: G4 end to end;
  - REQ-S04-006: 403/403/409 and the named initiative;
  - REQ-PB-019: 'Owners';
  - REQ-PB-004, -006, -007, -022: sequencing;
  - REQ-PB-048, -049, REQ-S09-001/003/005: prioritization;
  - REQ-PB-050, REQ-S09-006/008: roadmap and cycles;
  - REQ-PB-053–057, REQ-S05-005, REQ-S08-007: business case and T09;
  - REQ-PB-059, REQ-S09-004: capacity.

  Use FE-D's handback (`T-DG3-FE-D-frontend-ux-engineer.md`) for which journey asserts what.
- **BE-F's G4 tests.** Add `apps/api/test/integration/gates/g4.test.ts` and `apps/api/src/modules/workflows/g4.test.ts` where they assert the G4 roadmap items: REQ-PB-019, REQ-S04-006, REQ-DLV-035.
- **The notes.** Append "DG3 analyst check (T-DG3-AN-P3B, base <sha>): …" to the `notes` of each changed row.
- **Keep everything else** in every row unchanged.

## Self-verification (real output in the handback)

- `node tools/gates/validate.mjs --register DG3` → PASS, exit 0.
- `node tools/gates/validate.mjs --register DG2` → PASS.
- `node tools/gates/validate.mjs --historical --stage DG2` → exit 0.
- **The CSV still parses:** the same column count on every row. Show your check script's output.
- `git diff --stat` shows only `requirements.csv`, plus your handback.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-AN-P3B-transformation-analyst.md`. Include:
- the rows changed;
- the evidence added and the clause each piece asserts;
- the validator output.
