# Assignment T-DG6-ARCH-10: P6 architecture, pre-freeze ADR records of D-203 and D-204 (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`. You run in the main checkout.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first and report the result. It must exit 0.
- **Concurrency:** implementer and QA runs may be active in their own git worktrees. They do not touch `docs/architecture/**`.
- **Time:** about 75 minutes. Run `date -u` at the start and at the end.
- **Your harness ports are 27800–27849 only.**

## What to do

Edit documents only. Record what `docs/delivery/handbacks/DG6/T-DG6-BE-X10-backend-workflow-engineer.md` asks of the architect (§5, §8 and its "for the architect" list):
- in ADR-0043: D-204 as implemented, D-205 (the kill switch confirmed, and the residual race documented), and the ledger now recording disables (migration 0123), so that its rows form the interval history;
- in `docs/architecture/data-dictionary.md` and `erd.md`: migration 0123 and the `disable` and `backfill_disable` ledger sources.

Check that ARCH-09's text stays consistent with D-204 and D-205.

## Acceptance

- `pnpm format:check` and `pnpm openapi:lint` exit 0.
- The handback lists every item: applied (with file and section) or declined (with the reason).
- Write it to `docs/delivery/handbacks/DG6/T-DG6-ARCH-10-solution-architect.md`.
- Leave your changes **uncommitted** for the orchestrator.
