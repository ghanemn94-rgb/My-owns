# Assignment T-DG5-ARCH-R5: the round-2 repair amendments (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 2 (D-172).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your `--cwd`, on branch `dg5/arch-r5`, at the integrated `HEAD`, where T-DG5-BE-X1 (F-DG5-122) and T-DG5-BE-X2 (F-DG5-120) are merged. T-DG5-FE-X1 (web and e2e only) runs at the same time in its own worktree.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** you write only `docs/architecture/**`.
- **Time:** about 45 minutes. Run `date -u` at the start and at the end.

## Task

Read D-172 in `docs/delivery/decisions.md`, then the merged code and the section "ADR and data-dictionary statements … (for T-DG5-ARCH-R5)" of each of:
- `T-DG5-BE-X1-backend-workflow-engineer.md`;
- `T-DG5-BE-X2-backend-workflow-engineer.md`.

Amend, each as a **dated amendment** (T-DG5-ARCH-R5) with `file:line` evidence from the merged tree:

1. **The G4 readiness ADR (ADR-0035 §4, or wherever the G4 criteria and their subject sets are defined; F-DG5-122).**
   - Every criterion whose subject set is the approved portfolio (initiatives selected, funded or launched) fails closed when that set is empty. The missing item names the cause.
   - The criterion is complete only if both the transformation-level part and the per-initiative parts hold.
   - The same applies to the live readiness and the frozen snapshot.
   - An exception still covers one criterion only.
2. **ADR-0050 §4, §5, D7 and D9 (F-DG5-120).**
   - The demo's G4 rests on a real approved portfolio of INI-01..03, as BE-X2 lists it, with no exception. Correct every statement BE-X2's handback lists as untrue.
   - Record the observations BE-X2 discloses:
     - the seed emits no outbox events;
     - the `portfolio_selection.create` audit action differs from the API's `select`;
     - INI-01 carries a `before_predecessor` warning.
3. **The data dictionary.** Correct the demo paragraph BE-X2 names: there is no `gate_exception` row, and add the new table writes. Add the new G4 missing-item code(s) if the dictionary lists codes.

## Rules

- Write only `docs/architecture/**`.
- State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R5-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
