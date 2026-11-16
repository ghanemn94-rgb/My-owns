# Assignment T-DG7-ARCH-R2: the import load design (ADR-0064 §6 amendment) (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task under plan §5.3 (ARCH repair). Read §C of `docs/architecture/p7-work-split.md`, ADR-0064, the DG1 audit ADRs (append-only `audit_event`, its triggers and `seq`), decision D-258, and the handbacks of BE-D (headline and Q1/Q2), KBE-A and DO-D (§4 gap 2, Q2) in `docs/delivery/handbacks/DG7/` first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. **An amendment to ADR-0064 §6** (a dated amendment section; never rewrite the approved text) that makes the import load buildable on a freshly migrated target. The measured fact: migrations themselves write `audit_event` rows (uuid v7 ids, `seq` from 1), so a literal empty-target check refuses every target, and loading source rows collides on `audit_event_seq_key`. Hard constraints: `audit_event` stays append-only with its triggers on (disabling them is a DG1 reopen, forbidden); no source audit event is lost, altered or re-attributed; the target's own migration-written events are kept; the result is verifiable by reconciliation. Specify exactly: the empty-target rule (which baseline rows are allowed), how source audit rows are carried (e.g. preserved original id/seq in a carried form, or a defined mapping) and how the chain/ordering is verified, the load order, sequence resets, holds, the `migration_import` record, and the **post-import recheck rule** (BE-D Q2): which tables a recheck after use may differ in and how (`audit_event` additions, the tables the drill wrote, exactly those additions).
2. Also define BE-E's `verify` output that `reconcile-migration` consumes for attachments (BE-D gap 2).
3. Append a section `### C.12 BE-R1: the import load (backend-workflow; repair; after ARCH-R2)` to §C of the work split with file ownership, exact texts, tests and the clause → test table, and a section `### B.6 DO-D2: complete and run the transfer drill (devops-engineer; repair; after BE-R1)` covering DO-D's §4 gaps 3–6 and Q3. Never edit existing sections.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R2-solution-architect.md`: the `--historical` result, the options weighed, the decision and why, residual risks, anything undone.

## Acceptance

- The amendment is consistent with the DG1 audit guarantees and states how each is preserved; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
