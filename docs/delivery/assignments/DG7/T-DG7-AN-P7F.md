# Assignment T-DG7-AN-P7F: Q19 extension to the 18 DG7 rows (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-DLV-005 REQ-DLV-008 REQ-DLV-011 REQ-DLV-012 REQ-DLV-014 REQ-DLV-018 REQ-DLV-024 REQ-DLV-028 REQ-DLV-030 REQ-DLV-031 REQ-DLV-039 REQ-DLV-040 REQ-S02-005 REQ-S19-015 REQ-S20-031 REQ-S21-002 REQ-S21-003 REQ-S21-004. Stage DG7. Finding F-DG7-935 (docs/delivery/reviews/DG7/round-2/code-security-reviewer.findings.json) and the user decision in D-274: apply the D-243 Q19 treatment to these 18 rows exactly as on the six existing Q19 rows: status IMPLEMENTED, evidence that ran, and a trailing 'completes-after-gate:' clause naming precisely what only the DG7 gate round, audit or A28 seal completes. Where a row carries a disclosed deviation (D-270 protocol hits C2/C3/C5 for DLV-011/012/024; A27 K11 partial for DLV-030), state it plainly in the notes before the marker and cite D-270 / the A27 report; never present it as met. Check with node tools/gates/validate.mjs --register DG7 (must exit 0) and the T-I13 laterClauses parser. Change no other row. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-AN-P7F-transformation-analyst.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-AN-P7F-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
