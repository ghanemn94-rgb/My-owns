# Assignment T-DG6-ARCH-09: P6 architecture, pre-freeze ADR records of D-203 and D-204 (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`. You run in the main checkout.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first and report the result. It must exit 0.
- **Concurrency:** implementer and QA runs may be active in their own git worktrees. They do not touch `docs/architecture/**`.
- **Time:** about 75 minutes. Run `date -u` at the start and at the end.
- **Your harness ports are 27750–27799 only.**

## What to do

Edit documents only.

1. **ADR-0043:** record D-203 and D-204 (`docs/delivery/decisions.md`), and items 1, 3, 4, 5 and 6 of `docs/delivery/handbacks/DG6/T-DG6-BE-X9-backend-workflow-engineer.md` §6. Item 2 is decided by D-204: the version in force at occurrence. T-DG6-BE-X10 implements it in parallel.
2. **`docs/architecture/data-dictionary.md` and `docs/architecture/erd.md`:** add `automation_rule_enablement` (migration 0122), with the column BE-X10 adds if any. Read its handback when it lands, or describe the 0122 file as shipped.
3. **ADR-0058 or the operations ADR:** note the two worker variables `WORKER_JOB_BATCH_SIZE` and `WORKER_JOB_CONCURRENCY`, and BE-X9's measured throughput.

## Acceptance

- `pnpm format:check` and `pnpm openapi:lint` exit 0.
- The handback lists every item: applied (with file and section) or declined (with the reason).
- Write it to `docs/delivery/handbacks/DG6/T-DG6-ARCH-09-solution-architect.md`.
- Leave your changes **uncommitted** for the orchestrator.
