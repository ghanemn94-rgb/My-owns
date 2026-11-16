# Assignment T-DG7-DO-D10: Apply the D-278 disclosure to the handover surfaces and the release notes (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-017, REQ-S20-018, REQ-S01-006. Stage DG7. Repair F-DG7-923, F-DG7-942, F-DG7-972 (Low; ADR-0064 Amendment 5 A5.6 requires the D-278 drill disclosure in known-limitations.md, the release notes, deployment.md and the Arabic summaries). The transformation-analyst handback docs/delivery/handbacks/DG7/T-DG7-AN-P7I-transformation-analyst.md delivered the approved text as docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/apply-d278-disclosure.mjs (and d278-disclosure.diff) but could not write docs/handover/**. (1) Run that script (or apply the diff by hand if anchors moved), keep the text verbatim, run prettier on the changed files. (2) Release notes: tools/release/release-notes.mjs today cannot carry the disclosure for IMPLEMENTED rows (handback section 4 gap 2). Add a small, generic, deterministic section to the generated release notes, in English and Arabic, that states the D-278 transfer-drill rule in brief (scheduled jobs keep running; only A5.2 schedule executions are explained and listed in the drill report; a handler that writes business rows in the window still fails D9, not a data defect; recovery is re-run, never pause or reschedule; engine ticks not covered) and points to known-limitations.md#adr-residuals; source the text from a checked-in input file rather than hard-coding prose in logic if practical; add a test in tools/release/tests; regenerate with --write and confirm --check passes. (3) Run known-limitations --check, check-handover (with the latest protocol-audit report under the scratch evidence, or regenerate one with tools/release/protocol-audit.mjs as prior pre-freeze runs did), the release-tool tests, prettier, lint and typecheck; record real exit codes. Do not edit tools/gates/**, tools/agents/**, .claude/**, docs/source/**, reviews or gate records. Return the five handback sections. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-D10-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-D10-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
