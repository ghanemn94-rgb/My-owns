# Assignment T-DG5-ARCH-R2: bring the R1 amendments to the built state (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator, your `--cwd`, on branch `dg5/arch-r2`, at the integrated `HEAD`: W1–W21 are merged and verified (D-167).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** in their own worktrees, T-DG5-BE-T5 works in `packages/shared`, `apps/api`, `apps/worker` and the demo dataset; T-DG5-FE-D5 works in `apps/web`; T-DG5-AN-P5A and AN-P5B work in `docs/delivery/requirements.csv`. You write only `docs/architecture/**`.
- **Time:** about 1 hour. Run `date -u` at the start and at the end.

## Task

Your earlier amendments (T-DG5-ARCH-R1, handback §4) describe some items as decided but not yet built. Read the merged code and D-167, then update each of these amendment texts to the built state, with `file:line` evidence. Change a text only where the code shows it:

1. **ADR-0042 V2 and the data dictionary's `0096` rows:** Rule A as merged:
   - the `procedure_step_instance_row_guard()` conditions;
   - the audit action `procedure_step_instance.adopt_transformation`;
   - the routing wait and its retry through the next instance action (`PATCH …/inputs`);
   - **D-167's clarification:** an adopted step is read and acted on with the authorization of its transformation T (step assignee role on T), while the instance's other steps and organization reads keep organization scope. T-DG5-BE-T5 implements it in W22; write it as "decided by D-167, implemented by T-DG5-BE-T5 (W22)".
2. **ADR-0044 B1–B2:** Rule B as merged (`forwardFinishes` in `portfolio/schedule.ts`; "the first allowed start is the predecessor's forward finish date itself"; external predecessors excluded). Confirm that your earlier reading matches the code.
3. **ADR-0050 D3:** the worker's in-app reset keeps the dev binding (`apps/worker/src/handlers/demo.ts`; `@mth/db` `demoDevIssuerBindingAllowed`).
4. **ADR-0042 V3:** a step's output record is chosen in the UI (T-DG5-FE-D4: `pages/procedures/CompleteWithOutput.tsx`, `outputs.ts`).
5. **ADR-0044 / ADR-0043:** `dependency.slipped` v1 is registered in `OUTBOX_EVENT_SCHEMAS`, and the builder catalogue serves its `samplePayload`. This is T-DG5-BE-T5's W22 repair of QA-F2's D-QA-F2-1. Write it as "decided by D-167, implemented by T-DG5-BE-T5 (W22)", since it lands during your run.
6. **ADR-0039 C2:** the orchestrator confirms the framing (D-167): the `0094` trigger disable is a one-off exception, and any further use needs its own decision. Keep the text.

## Rules

- Write only `docs/architecture/**`. Never edit `docs/source/**`, delivery records, reviews, gates, `tools/**`, `.claude/**`, `apps/**`, `packages/**`, `tests/**` or `e2e/**`.
- State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
3. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R2-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
