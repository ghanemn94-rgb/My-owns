# Assignment T-DG7-AN-P7I: Disclose the D-278 drill rule in the handover surfaces (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-S19-017, REQ-S20-018, REQ-S01-006. Stage DG7. Repair findings F-DG7-923, F-DG7-942 and F-DG7-972 (all Low, one gap). ADR-0064 Amendment 5 A5.6 (AN) requires the D-278 transfer-drill disclosure in known-limitations.md, the release notes and deployment.md's drill section, and in the Arabic summaries; today only deployment.md (English) and the register notes carry it. The disclosure must say: (1) a scheduled job that runs during the drill is explained only as A5.2 says (no initiating user; trigger_key names an enabled job_schedule row in the target and a slot inside the D7-D9 window by its cron and timezone) and is listed in the drill report; (2) a scheduled job whose handler writes business rows during the window still makes D9 FAIL, which is not a data defect; (3) the recovery is to re-run the drill, never to pause or reschedule a job; also name A5.7 residual 3 (engine ticks not covered). known-limitations.md and release-notes.md are GENERATED: edit their sources (requirements.csv notes and/or the guide/inputs read by tools/release/known-limitations.mjs and tools/release/release-notes.mjs), never tools/release/** code, then regenerate with --write and confirm --check passes; add the Arabic text wherever the Arabic summaries live (find them). Do not edit tools/**, docs/source/**, .claude/**, reviews or gate records. Run prettier on changed files. Return the five handback sections. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-transformation-analyst.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
