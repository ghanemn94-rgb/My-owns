# Assignment T-DG7-DO-D4: run T-B11 to the end (devops-engineer; repair; after BE-R3 and AN-R1) (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task is §B.8 of `docs/architecture/p7-work-split.md`.** Read §1, §2 and the whole of §B first, the ADRs §B cites, the plan `docs/architecture/p7-plan.md` and decisions D-243 onward in `docs/delivery/decisions.md`. The work split is binding: file ownership, exact EN and AR texts, problem codes, tests and the requirement → clause → test table. Take migration ids above the highest one in `packages/db/migrations/` (renumber if another task took yours; D-245 O9).
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.
- Read DO-D3's, BE-R3's and AN-R1's handbacks first. Make T-B17 pass, build an archive from the current HEAD and run T-B11 to the end. A step not run is NOT_RUN, never PASS. No Docker daemon: the container half stays the orchestrator's.
## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything §B.8 assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D4-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D4-evidence/`.

## Acceptance

- Every §B.8 test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
