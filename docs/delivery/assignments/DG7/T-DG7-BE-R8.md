# Assignment T-DG7-BE-R8: Migration-export organization-scope tests F-DG7-940 (backend-workflow-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-016. Stage DG7. Repair F-DG7-940 (read docs/delivery/reviews/DG7/round-3/code-security-reviewer.findings.json and the reviewer's evidence docs/delivery/test-evidence/DG7/code-security/round-3/32-authz-mutants.log, scripts/mutants.sh and repro/zz-cs-r3-transfer-scope.test.ts). Add shipped integration tests (under apps/api/test/integration/transfer/) proving that ADM_TECH granted at business_unit scope and at transformation scope gets 403 on all five migration-export operations, and that no migration_export row and no audit event is written. Show the mutant is killed: temporarily remove the scoped authorize() call in requireExportRight (apps/api/src/modules/transfer/export/service.ts), confirm the new tests fail, restore it byte-identically, confirm they pass; record both runs in your evidence. Do not change product behaviour. Run the transfer integration tests with tests/qa/support/with-pg.sh, plus typecheck, lint and prettier for the touched files, and record exit codes. Your handback must contain all five sections: files changed, checks run with exit codes, merge instructions, residual risks, open questions. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-BE-R8-backend-workflow-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-BE-R8-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
