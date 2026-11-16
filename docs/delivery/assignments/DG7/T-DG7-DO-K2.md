# Assignment T-DG7-DO-K2: check-handover tests and the connector handover list (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-015, REQ-S17-004. Stage DG7. Findings F-DG7-956 (docs/delivery/reviews/DG7/round-1/qa-verifier.findings.json): 4 tests in tools/release/tests/check-handover.test.mjs pin the superseded DO-I protocol-audit report while docs/handover/known-limitations.md is now generated from docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json; make the tests use the report the shipped file is generated from (or a self-contained fixture) so they test what they name, and run the full node --test tools/release/tests/*.test.mjs. F-DG7-914 (docs/delivery/reviews/DG7/round-1/domain-reviewer.findings.json): docs/handover/api/connectors.md is generated from docs/delivery/environment.md, whose rows the orchestrator has now refreshed; regenerate it with tools/release/connector-handover.mjs and check its --check mode; fix any generator-side stale text you own. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-K2-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-K2-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
