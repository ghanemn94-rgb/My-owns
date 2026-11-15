# Assignment T-DG7-AN-P7D: Register pass 4 with the protocol audit (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** REQ-DLV-002 REQ-DLV-008 REQ-DLV-009 REQ-DLV-011 REQ-DLV-012 REQ-DLV-018 REQ-DLV-024 REQ-DLV-027 REQ-DLV-028 REQ-S20-031 REQ-S19-015 REQ-S02-005 REQ-S21-003: re-assess the 20 non-IMPLEMENTED rows against the pre-freeze protocol audit (docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-prefreeze.json and .log; DG7 C1, C4, C6, C7, C8, C9 PASS; C2 27, C3 5, C5 1 hits), check-handover PASS (check-handover-2.log), release notes regenerated, D-269. Promote a row only where its DG7 clause is proven by a check that ran; DLV-011 (C2), DLV-012 (C3) and DLV-024 (C5) keep a release-blocker note naming the DG7 hits unless the evidence clears them. Rows that need the gate round, audit or seal stay blockers. Then the orchestrator regenerates release-notes. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-AN-P7D-transformation-analyst.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-AN-P7D-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
