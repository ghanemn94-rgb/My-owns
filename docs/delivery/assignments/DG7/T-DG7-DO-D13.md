# Assignment T-DG7-DO-D13: Compose backup profile fails at phase database (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** The orchestrator ran deploy/scripts/drill/compose-backup-drill.sh on a Docker host (log docs/delivery/test-evidence/DG7/orchestrator/compose-backup-rg3/02-compose-backup-drill.log). Step C3 (backup-restore.md §3.2 step 1, '--profile backup run --rm backup --label rg3 --phase database') failed: 'backup: set rg3 failed: the Compose file //deploy/compose/compose.yaml does not exist'. This is part of F-DG7-1031/1051. Find the root cause in deploy/scripts/backup.sh and the backup service of deploy/compose/compose.yaml (how the repository/compose file path is resolved inside the backup container, mounts, working dir), fix it, and check the later steps (--phase finish, the copy-out, restore.sh into a fresh project, C9 ownership) for the same class of path/mount defect by reading them against the container layout. Add tests that reproduce the path resolution failure without Docker where possible (fail before, pass after). Update docs/handover/backup-restore.md if the commands change. You have no Docker daemon; do not claim the drill passes. Run backup-restore tests, secret scans, prettier; report exact results. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D13-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D13-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
