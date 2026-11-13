# Assignment T-DG7-DO-D: the transfer drill (devops-engineer; W10; after BE-B, BE-D, BE-E, BE-F, DOC-B) (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task is §B.2 of `docs/architecture/p7-work-split.md`.** Read §1, §2 and the whole of §B first, the ADRs §B cites, the plan `docs/architecture/p7-plan.md` and decisions D-243 onward in `docs/delivery/decisions.md`. The work split is binding: file ownership, exact EN and AR texts, problem codes, tests and the requirement → clause → test table. Take migration ids above the highest one in `packages/db/migrations/` (renumber if another task took yours; D-245 O9).
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.
- No Docker daemon (D-243 Q1): build and run every non-container step of the drill; the container half (Compose up, image load, Keycloak) is the orchestrator's — write it as an exact runnable procedure. Follow DOC-B's deployment and operator guides; QA-A's A18 harness is the target. Read the BE-D, BE-E, BE-F, DO-F and DOC-B handbacks first (D-254–D-257).
## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything §B.2 assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D-evidence/`.

## Acceptance

- Every §B.2 test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
