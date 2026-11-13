# Assignment T-DG7-QA-A: A18 and A19 test-first harnesses (qa-verifier)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task is QA-A in `docs/architecture/p7-plan.md`** (ownership row, W7; REQ-S20-018 and REQ-S20-019 rows) and the A18/A19 rows of `docs/architecture/p7-work-split.md` (§B and §E, including the A19 → QA-A row: restore recovers database, evidence, audit, snapshots and job state; checks R1–R8; timings recorded). Write `tests/qa/integration/a18-*.test.ts` and `a19-*.test.ts` from the acceptance texts in the master prompt. They are test-first: they are expected to FAIL until DO-D and DO-F land; record the failing run honestly. You author tests only, never product code.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

The two harnesses, runnable, each assertion traced to an acceptance clause. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-QA-A-qa-verifier.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-QA-A-evidence/`.

## Acceptance

- The harnesses run and fail only for the not-yet-built drill (each failure named); `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
