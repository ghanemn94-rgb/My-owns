# Assignment T-DG7-FE-C2: Retention administration screens (REQ-S16-024) (frontend-ux-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S16-024, REQ-S20-022. Stage DG7. Finding F-DG7-913 (docs/delivery/reviews/DG7/round-1/domain-reviewer.findings.json). Build the Administration > Retention screens of p7-work-split §E.6 on the existing retention APIs (apps/api/src/modules/retention/{classes,runs,backups}/routes.ts and their OpenAPI operations): replace the five P7NotAvailablePage placeholder routes in apps/web/src/app/router.tsx with real screens (record classes with their retention periods, archival runs with their per-action log, backups as §E.6 defines), bilingual Arabic RTL and English LTR with every string in both dictionaries, server-side authorization respected (read vs manage), optimistic concurrency on edits (If-Match), Unknown/Stale never zero. Rewrite apps/web/e2e/p7-retention.spec.ts to satisfy T-E25 (axe, keyboard, 360 px) in both locales on the real stack, plus component tests. Record every command and exit. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-FE-C2-frontend-ux-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-FE-C2-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
