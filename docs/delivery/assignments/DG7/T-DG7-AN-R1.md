# Assignment T-DG7-AN-R1: register rewording of ADR-0064 A2.8 (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task (D-260). Read §C of `docs/architecture/p7-work-split.md`, ADR-0064, the DG1 audit ADRs (append-only `audit_event`, its triggers and `seq`), decisions D-258 and D-259, your Amendment 1, and the handbacks of ARCH-R2, BE-R1 (§0, R1) and DO-D2 (§4 gaps 1–6, Q1–Q2) in `docs/delivery/handbacks/DG7/` first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. In `docs/delivery/requirements.csv` make exactly the two replacements of ADR-0064 A2.8 decision 1 (REQ-DLV-006 `procedure`; REQ-DLV-023 `notes`), and nothing else. Prove no other byte changed (`git diff --stat` and a diff of the two rows) and that `node --test apps/api/scripts/register-snapshot.test.mjs` (T-R16) now exits 0.
2. **Handback** `docs/delivery/handbacks/DG7/T-DG7-AN-R1-transformation-analyst.md` with the commands and real exit codes.

## Acceptance

- T-R16 exits 0; prettier check and `node tools/gates/validate.mjs --historical --stage DG6` exit 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
