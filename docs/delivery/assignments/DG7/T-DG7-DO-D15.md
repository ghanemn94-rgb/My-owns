# Assignment T-DG7-DO-D15: restore.sh symlinked evidence root regression and guide section 8 (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Repair F-DG7-1101 (Medium): restore.sh must resolve a symlinked --target-evidence-path to its target for the default-owner stat (stat -L), chown, chmod, and the R7 owner/otherOwner/groupOrOtherBits counts, exactly as DO-D12 does for the backup root; a restored database must never be left with an unnormalised evidence root. Reproduce it first with the reviewer's probe (see docs/delivery/reviews/DG7/round-4/code-security-reviewer.findings.json F-DG7-1101), add a test (T-E15) for a symlinked evidence root that fails on the old code, and run the backup/restore suite. Also repair F-DG7-1092: update backup-restore.md section 8 to record the passing Compose run docs/delivery/test-evidence/DG7/orchestrator/compose-backup-rg4c (C0-C11, 2 evidence files, 1 job, owner 10001) and name rg4/rg4b as the two failed attempts. You have no Docker daemon: do not claim a Compose run; the orchestrator will re-run it. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D15-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D15-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
