# Assignment T-DG7-ARCH-R4: ADR-0064 Amendment 3 (mode 2 for automation and counter rows; D8 gate chain) (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task under plan §5.3 (ARCH repair). Read §C of `docs/architecture/p7-work-split.md`, ADR-0064, the DG1 audit ADRs (append-only `audit_event`, its triggers and `seq`), decisions D-258 to D-260, Amendments 1 and 2, and the handbacks of ARCH-R3, BE-R2 (questions 1–2) and DO-D3 (findings 1–4, Q1–Q3) in `docs/delivery/handbacks/DG7/` first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **ADR-0064 Amendment 3** (dated, additions only), deciding with the D-260 directions (confirm or improve, with reasons, staying strict):
   - **Automation rows (DO-D3 Q2a):** an A2.6 rule that explains a row whose audit actor is a service identity when its `initiating_user_id` (or equivalent recorded link) is a journalled drill actor — no schema change, no "ignore the table".
   - **Counters (Q2b):** a "counter" basis: a counter row such as `record_code_counter` may change only by exactly the number of new coded rows the journalled actors created in its scope; anything else is unexplained.
   - **D8 gate chain (Q3):** D8 completes the gate's required outputs through the public API as the drill actor (no change to the shipped demo data), then submits and a different rebound approver decides. Specify the steps by OpenAPI operation id.
   - BE-R2 question 1 (audit_event has 17 columns; compare all except `seq` and `occurred_at`): correct the counts in A2.1 and C.13 by amendment. Record the measured shared-baseline count 45 against A2.10 residual 1.
2. Append `### C.14 BE-R3: mode 2 rules and table-digest drain (backend-workflow; repair; after ARCH-R4)` (including DO-D3 Q1: `mth-db` sets `process.exitCode` instead of `process.exit` so piped stdout drains; a test pipes a large digest) and `### B.8 DO-D4: run T-B11 to the end (devops-engineer; repair; after BE-R3 and AN-R1)`. Never edit existing sections.
3. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R4-solution-architect.md`.

## Acceptance

- `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` exit 0; prettier check and `node tools/gates/validate.mjs --historical --stage DG6` exit 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
