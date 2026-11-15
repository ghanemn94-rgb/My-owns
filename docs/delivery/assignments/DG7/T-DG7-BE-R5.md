# Assignment T-DG7-BE-R5: Integration failures from the pre-freeze full run (backend-workflow-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** The orchestrator's full 'tests/qa/support/with-pg.sh pnpm test:integration' (logs: docs/delivery/test-evidence/DG7/orchestrator/prefreeze/integration.log and, after removing stray empty .claude/.cc-writes sandbox folders from the tree, docs/delivery/test-evidence/DG7/orchestrator/prefreeze/integration-rerun-failed.log) fails: (1) apps/api/test/integration/platform.test.ts: 4 tests expect /readyz checks {database, migrations} only, but BE-B added storage and worker; update the expectations to the real contract (and confirm worker 'unknown' vs 'alive' semantics per ADR). (2) apps/api/test/integration/automation/automation-version-at-occurrence.test.ts: the suite setup's devLogin returns 500 (contract: devLogin does not declare 500); find the root cause (product or test) and fix it. (3) apps/worker/test/integration/retention-archive.test.ts T-E14/T-E17: a regex expects 6 fractional digits but PostgreSQL text renders '00:29:51.91429+00' when the microseconds end in 0: an intermittent test defect; fix the assertion, not the data. (4) apps/api/test/integration/platform/readiness-storage-worker.test.ts T-B2 read-only case fails when run as uid 0 with no read-only mount ('the read-only case cannot be constructed'): make it construct the case another way, or skip it with a BLOCKED reason when it truly cannot, never pass silently. Also make packages/db migrations reading robust or explicit about non-.sql entries only if the ADR intends it (a stray directory crashed 'migrate' tests with 'cannot copy a directory'); otherwise report. Run each affected file and the whole integration project under with-pg.sh; record exits. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-BE-R5-backend-workflow-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-BE-R5-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
