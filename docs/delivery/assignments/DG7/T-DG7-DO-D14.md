# Assignment T-DG7-DO-D14: Phased backup manifest and Compose restore ownership/evidence drill (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Repair findings F-DG7-1061, F-DG7-1071, F-DG7-1081 (split-phase backup: --phase finish must record the config file list; the config.sha/listing must survive from the database phase to finish through the shared backup root, never a per-process temp dir; no stray 'cat' error; add a test that fails on an empty config.files and on any stderr noise) and F-DG7-1072, F-DG7-1082 (a Compose restore that follows backup-restore.md must leave evidence readable by the API uid 10001 with its intended owner/modes, without an undocumented chown; extend the Compose drill to seed and move real evidence objects and job state, and to verify ownership, count and hashes after restore). Update backup-restore.md and the handover docs accordingly. You must then run the Compose drill yourself for real (dockerd must be started with nohup dockerd; images mth-app:local and postgres:18 exist; secrets via deploy/scripts/init-secrets.sh --dir) and record the log under docs/delivery/handbacks/DG7/. Do not claim a PASS you did not run. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D14-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D14-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
