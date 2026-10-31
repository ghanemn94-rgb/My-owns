# Assignment T-DG6-ARCH-08: P6 architecture, pre-freeze ADR records of the last repairs (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`. You run in the main checkout.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first and report the result. It must exit 0.
- **Concurrency:** implementer and QA runs may be active in their own git worktrees. They do not touch `docs/architecture/**`.
- **Time:** about 75 minutes. Run `date -u` at the start and at the end.
- **Your harness ports are 27300–27349 only.**

## What to do

Record in the ADRs what the last pre-freeze repairs changed. Edit documents only.

1. **ADR-0059 §6, §9 and §10:** the `assistantEnabled` field on `listAssistantConversations`, a user-level read of whether the assistant is on. See `docs/delivery/handbacks/DG6/T-DG6-BE-X5-backend-workflow-engineer.md` §5–§6.
2. **ADR-0053 §2:** the linked-KPI status now reads the KPI's latest period with a value, so a later open period no longer hides the last value (`T-DG6-BE-X4-backend-workflow-engineer.md`). Also record the `kpiLinks` on `connector.run_failed` (BE-X2) if ARCH-07 did not.
3. **ADR-0059 §12 and ADR-0054:** the composition calls added by BE-X2 and BE-X3B: the SecretProvider registry handed to integrations and to the assistant, and `installConnectionLog` in the API and worker main. Also record the connection log's requested-destination fields (`T-DG6-BE-X3B-backend-workflow-engineer.md`).
4. Every other "for the architect" item in the BE-X4, BE-X5, BE-X3B, FE-X1B, QA-EB, QA-F and QA-G handbacks.

## Acceptance

- `pnpm format:check` and `pnpm openapi:lint` exit 0.
- The handback lists every item: applied (with file and section) or declined (with the reason).
- Write it to `docs/delivery/handbacks/DG6/T-DG6-ARCH-08-solution-architect.md`.
- Leave your changes **uncommitted** for the orchestrator.
