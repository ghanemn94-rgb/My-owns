# Assignment T-DG7-DO-D9: A18 drill: explain scheduled starters in D7-D9 (F-DG7-971) (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-017, REQ-S20-018. Stage DG7. Read D-278 in docs/delivery/decisions.md (the orchestrator's decision on ADR-0064 A3.9 residual 1), finding F-DG7-971 in docs/delivery/reviews/DG7/round-5/qa-verifier.findings.json and the QA evidence in docs/delivery/test-evidence/DG7/qa/round-5/a18/ (d9-schedule-window-analysis.log, qa-r5-d9-boundary-repro.sh). Then read the ADR-0064 amendment ARCH-R6 just added. Implement it in deploy/scripts/transfer-drill.sh (and its helpers) and in the shipped harness tests/qa/integration/a18-transfer-drill.test.ts if it carries its own recheck: mode 2 explains exactly the schedule-triggered executions the amendment defines and their action results and audit events, and lists each in the drill report; nothing else becomes explained. Never pause or reschedule any job. Add tests in deploy/scripts/tests/transfer-drill.test.mjs (with-pg) that: (a) inject a schedule-triggered execution for a real job_schedule slot inside the window and show D9 PASS with it listed, and FAIL with your rule removed; (b) show D9 still FAILS for an execution with an initiating user, for a trigger_key whose code has no job_schedule row, and for a slot outside the window. Then run the full drill once across a quarter hour (use the QA script qa-r5-d9-boundary-repro.sh as a model, choose the start so D7-D9 contains :00/:15/:30/:45) and once away from it; record both. Run the transfer-drill tests with tests/qa/support/with-pg.sh, deploy tool tests, lint and prettier; record exit codes. Do not edit the register, handover texts (except docs/handover/deployment.md to describe the drill rule and what the report lists), gate tooling or reviews. Your handback must contain all five sections: files changed, checks run with exit codes, merge instructions, residual risks, open questions. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D9-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D9-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
