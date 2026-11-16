# Assignment T-DG7-AN-P7H: Register notes for the A18 scheduled-starter rule (F-DG7-971) (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-017, REQ-S20-018, REQ-S01-006. Stage DG7. Read D-278 in docs/delivery/decisions.md (the orchestrator's decision on ADR-0064 A3.9 residual 1), finding F-DG7-971 in docs/delivery/reviews/DG7/round-5/qa-verifier.findings.json and the QA evidence in docs/delivery/test-evidence/DG7/qa/round-5/a18/ (d9-schedule-window-analysis.log, qa-r5-d9-boundary-repro.sh). Then read the ADR-0064 amendment (ARCH-R6) and the DO-D9 handback and evidence. Update the notes of REQ-S19-017, REQ-S20-018 and REQ-S01-006 in docs/delivery/requirements.csv to disclose the residual and the rule (A18 D9 explains only schedule-triggered executions inside the D7-D9 window, listed in the drill report), citing DO-D9's quarter-hour and away runs. Keep each row IMPLEMENTED only if its acceptance is literally met. Run node tools/gates/validate.mjs --register DG7 and a fresh node tools/release/protocol-audit.mjs --stage DG7 (record C3 count). Do not edit docs/handover/** (the orchestrator regenerates release notes and known limitations), gate tooling or reviews. Your handback must contain all five sections: files changed, checks run with exit codes, merge instructions, residual risks, open questions. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-AN-P7H-transformation-analyst.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-AN-P7H-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
