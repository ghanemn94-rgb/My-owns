# Assignment T-DG5-ARCH-R4: the round-1 repair amendments (solution-architect)

## Stage and base

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 (D-170).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your `--cwd`, on branch `dg5/arch-r4`, at the integrated `HEAD`, where every repair of wave V1 is merged:
  - T-DG5-BE-V1, F-DG5-100 and migration `0097`;
  - T-DG5-BE-V2 and its continuations BE-V2B and BE-V2C, F-DG5-101;
  - T-DG5-BE-V3, F-DG5-120;
  - T-DG5-FE-V1 and its continuation FE-V1B, F-DG5-140, 141 and 121, plus the gate-readiness line.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Concurrency (D-004):** you run alone. You write only `docs/architecture/**` and `docs/api/openapi.yaml` description text (no operation, schema or response change).
- **Time:** about 45 minutes. Run `date -u` at the start and at the end.

## Task

Read D-170 and the next decision in `docs/delivery/decisions.md`, then the merged code. Read the section "ADR and data-dictionary statements this fix makes untrue or incomplete" of each handback:
- `T-DG5-BE-V1-backend-workflow-engineer.md`;
- `T-DG5-BE-V2-backend-workflow-engineer.md`;
- `T-DG5-BE-V2C-backend-workflow-engineer.md`;
- `T-DG5-BE-V3-backend-workflow-engineer.md`;
- `T-DG5-FE-V1B-frontend-ux-engineer.md`.

Then amend, each as a **dated amendment** (T-DG5-ARCH-R4) with `file:line` evidence from the merged tree:

1. **ADR-0039 §1, §5 and §9, and ADR-0043 §4 and §8 (F-DG5-100).**
   - Define "author" as the draft's creator plus every person recorded as a contributor (`0097`: `methodology_version_contributor`, `automation_rule_version_contributor`, their triggers and backfill).
   - State that the reviewer is never an author or the requester, at the API (403 `config_review.self_review`, `automation_rule_version.self_review`) and in the database (the named 0097 refusals).
   - State that review tasks skip every author.
   - Note the BEFORE-trigger ordering BE-V1 reported.
2. **ADR-0042 §3, §9 and V3 (F-DG5-101).**
   - A step's output, and any record a step links by id (the evidence link of BE-V2C, and any sibling path it closed), must be readable by the acting person in that record's scope, re-checked in the completing transaction.
   - Otherwise the step answers 422 `procedure_step.output_record_invalid` (or the path's existing refusal), audited as the existing `authorization.denied`, and nothing is linked or adopted.
   - Update the §9 authorization table.
3. **ADR-0050 §4 and §5 (F-DG5-120).**
   - The demo transformation is created in Diagnose and advanced to Transform by the synthetic G1–G4 approvals:
     - G1–G3 are complete on seeded evidence;
     - G4 is complete except two accepted exceptions, with their expiry;
     - G5 and G6 are not submitted.
   - Each decision carries the synthetic label.
   - Note what the seed does not emit: no outbox events, and no automation request execution.
   - Correct the stale line references BE-V3 lists.
4. **The gate-readiness line (FE-V1B).** If an ADR or the data dictionary states what the readiness line shows, update it.
5. **The data dictionary.**
   - The two new contributor tables, their functions and triggers, and the updated guard rows (BE-V1 §5).
   - The API-side read rule on `procedure_instance_link`, which the database guard does not check.
6. **`docs/api/openapi.yaml` description text only.**
   - The `ProcedureStepComplete` description gets the read rule.
   - The `decideConfigReview` summary gets the author definition.
   - `pnpm openapi:lint` must still pass with 846 operations.

## Rules

- Write only `docs/architecture/**` and description strings in `docs/api/openapi.yaml`.
- State only what the merged code and the decisions show.
- G1–G6 stay separate from DG0–DG7. Never call the playbook or the product an official PMI standard.

## Acceptance (real output in the handback)

1. `git ls-files -co --exclude-standard -z -- docs/architecture docs/api | xargs -0 npx prettier --check --ignore-unknown` exits 0.
2. `pnpm openapi:lint` exits 0, with 846 operations.
3. `node tools/gates/validate.mjs --historical --stage DG4` exits 0, at the start and at the end.
4. A table: item → amendment → evidence (`file:line`).

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-ARCH-R4-solution-architect.md`, and leave your changes **uncommitted** for the orchestrator to integrate.
