# Assignment T-DG7-ARCH-R5: ADR-0064 Amendment 4 (automation chains and KPI evaluations in mode 2; date-relative demo periods) (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task under plan §5.3 (ARCH repair). Read §C of `docs/architecture/p7-work-split.md`, ADR-0064, the DG1 audit ADRs (append-only `audit_event`, its triggers and `seq`), decisions D-258 to D-263, Amendments 1 to 3, and the handbacks of BE-R3, DO-D4, DO-D5 and DO-D6 (Q1, Q2) in `docs/delivery/handbacks/DG7/` first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0064 Amendment 4** (dated, additions only):
   - **Automation chains (DO-D6 Q2):** one explained `automation_execution` can write several `automation_action_result` rows and executions can chain. Define a strict rule: a row is explained when it links (by recorded foreign keys) to an execution that is itself explained by a journalled actor's event or by an explained parent execution, with the chain depth and the exact link columns named. Counts must match the links exactly; no table-wide allowance.
   - **`kpi_evaluation`:** the worker derives evaluations from KPI values the journal wrote. Define the basis (link to the journalled `kpi_actual_value` / period) and the exact expected count.
   - Confirm these remain within the DG1 guarantees and the "never ignore a table" rule.
2. **Demo data (D-263):** specify that `seed-demo` creates reporting periods relative to the date it runs (the current period open, prior periods as now), so shipped demo data never goes stale, and that the demo seed includes an organization-wide access administrator only if the product's permission model already allows one (no rule change). Name the files and tests.
3. Append `### C.15 BE-R4: chain rules, KPI evaluations, date-relative demo periods (backend-workflow; repair; after ARCH-R5)` and `### B.9 DO-D7: run T-B11 and the A18 harness to the end (devops-engineer; repair; after BE-R4)`. Never edit existing sections.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R5-solution-architect.md`.

## Acceptance

- `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` exit 0; prettier check and `node tools/gates/validate.mjs --historical --stage DG6` exit 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
