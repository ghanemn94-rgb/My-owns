# Assignment T-DG6-ARCH-07: P6 architecture, pre-freeze ADR corrections (solution-architect)

## Stage and base

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING), on branch `claude/mobily-transformation-platform-dg5-regate2`, at the current `HEAD`. You run in the main checkout.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first and report the result. It must exit 0.
- **Concurrency:** implementer and QA runs may be active in their own git worktrees. They do not touch `docs/architecture/**`.
- **Time:** about 75 minutes. Run `date -u` at the start and at the end.
- **Your harness ports are 26750–26799 only.**

## What to do

Bring the P6 ADRs and architecture documents into line with what the implementers built and what the QA authoring tasks found, before the DG6 freeze. Change documents only; never change product code, tests, delivery records or `tools/**`.

1. **ADR-0056 §7 (webhook body).** Apply the correction stated in `docs/delivery/handbacks/DG6/T-DG6-BE-X2-backend-workflow-engineer.md` §2 (the accepted item keys). Also apply its §5 event note to the ADR it belongs to.
2. **Every other "for the architect" item** in the DG6 handbacks under `docs/delivery/handbacks/DG6/` and `docs/delivery/test-evidence/DG6/qa/*/handback.md`. Grep for "architect", "ADR amendment", "proposed in the … handback", "not in ADR". For example: BE-T's proposed `assistant.test_adapter_shape` code in ADR-0059 §10, BE-H's `AbortIncompleteMultipartUpload` note for ADR-0054 §2, and BE-K2S's `connector.run_failed` fan-out to two consumers (ADR-0053 §3, ADR-0055).
   - Apply each one that matches the shipped behaviour.
   - List each one you decline, with the reason.
3. **Migration ids.** The orchestrator renumbered migrations at merge (D-196 item 2): BE-J 0113→0114, BE-K2 0116→0117, BE-S 0119→0120, BE-I2 0120→0121. Make sure the ERD, the data dictionary, the p6 work-split and the ADRs cite the shipped file names (`ls packages/db/migrations`).

## Acceptance

- `pnpm format:check` and `pnpm openapi:lint` exit 0.
- The handback lists every item: applied (with file and section) or declined (with the reason).
- Write it to `docs/delivery/handbacks/DG6/T-DG6-ARCH-07-solution-architect.md`.
- Leave your changes **uncommitted** for the orchestrator.
