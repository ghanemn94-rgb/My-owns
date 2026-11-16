# Assignment T-DG7-ARCH-R1: close the data-dictionary and OpenAPI description gaps (solution-architect)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, at the current `HEAD`.
- **Preceding gate:** DG6 APPROVED (D-241). Run `node tools/gates/validate.mjs --historical --stage DG6` first and report it; it must exit 0.
- **Plan:** `docs/architecture/p7-plan.md` (adopted, D-243). This is a repair task under plan §5.3 (ARCH repair). Read slice F of `docs/architecture/p7-work-split.md`, ADR-0070 and DO-H's handback `docs/delivery/handbacks/DG7/T-DG7-DO-H-devops-engineer.md` (§4 and its open questions 1–4) first.
- **Time:** about 2 hours. **Disk is tight (about 4 GB free): never make a full extra checkout; delete your own temporary trees.** Run `date -u` at start and end; past about 100 minutes, finish the current section and write the handback with what remains.

## Environment

- Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline.
- The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `trading_agent/`.

## Deliverables

1. Make `node tools/release/dictionary-coverage.mjs` PASS on the merged schema (currently FAIL, 176 gaps in `docs/handover/data/coverage.json`) by completing `docs/architecture/data-dictionary.md` (and `erd.md` where needed) with true descriptions of every table and column, read from the migrations. Do not weaken the tool. DO-H's questions 1–4 (repeated headings, type spelling, `###` views, partitions): decide each in your handback with a reason; if a tool change is needed, describe it for DO-H rather than edit `tools/release/**` yourself.
2. Make `tools/release/openapi-coverage` PASS: describe the 22 operations it flags (summary/description) in the contract, checked with `pnpm openapi:lint`.
3. Regenerate both coverage JSON files on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`) and keep the logs under `docs/delivery/handbacks/DG7/T-DG7-ARCH-R1-evidence/`.
4. **Handback** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R1-solution-architect.md`: the `--historical` result, before/after gap counts, decisions on Q1–Q4, anything undone.

## Acceptance

- Both coverage tools exit 0 on the merged tree; `pnpm -r typecheck`, `pnpm lint` and `pnpm openapi:lint` exit 0.
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

## Evidence honesty

Report every command with its real exit code. Never report a check as passed that did not run.
