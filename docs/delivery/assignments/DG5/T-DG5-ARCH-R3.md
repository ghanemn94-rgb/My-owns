# Assignment T-DG5-ARCH-R3: the last amendment references (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator, your `--cwd`, on branch `dg5/arch-r3`, at the integrated `HEAD`: every W22 repair is merged (D-168).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** T-DG5-AN-P5C updates `docs/delivery/requirements.csv` in its own worktree. You write only `docs/architecture/**`.
- **Time:** about 45 minutes. Run `date -u` at the start and at the end.

## Task

Your T-DG5-ARCH-R2 handback §4 left these for after the W22 merge. Read the merged code and D-168, then:

1. **ADR-0042 V2 (last block), ADR-0043 S2, ADR-0044 B4 and the data dictionary's D-167 paragraph.** Replace the "decided by D-167, implemented by T-DG5-BE-T5 (W22) / not in this tree" sentences with what was built, with `file:line` evidence:
   - `dependency.slipped` v1 in `OUTBOX_EVENT_SCHEMAS` and its `samplePayload`;
   - the adopted step's authorization on its transformation;
   - the export runner's cleanup of earlier attempts' files;
   - the seeded pending approval routed to a demo role user.
2. **ADR-0044 §7:** correct the `dependency.slipped` payload sentence to the schema (`slipId`, `dependencyId`, `transformationId`, `slipDays`), and the slip key to the merged code's `<predecessor initiative id>:<milestone id>.<milestone version>`, after checking it against `0075` and `slip-events.ts`. Mark each change as a dated body correction (T-DG5-ARCH-R3).
3. **ADR-0050:** the roaming chains' KPI and benefit names now follow B0147 (T-DG5-BE-T6; D-168), so the traceability line reads 'Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift' (REQ-PB-090). Record it, with the test that asserts the literal line.

## Rules

- Write only `docs/architecture/**`. State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R3-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
