# Assignment T-DG7-AN-P7G: Register disclosure repairs F-DG7-920/960/921 (transformation-analyst)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Requirement ids: REQ-DLV-012, REQ-S19-017. Stage DG7. Repair round-3 findings F-DG7-920 and F-DG7-960 (the open one), then F-DG7-921. Read docs/delivery/reviews/DG7/round-3/*.findings.json, code-security-reviewer.verifications.json and qa-verifier.md. (1) F-DG7-920/960: in docs/delivery/requirements.csv REQ-DLV-012 (notes and the completes-after-gate marker), state the DG7 C3 handback hits as SEVEN and name every affected handback, including docs/delivery/handbacks/DG7/T-DG7-DO-D8-devops-engineer.md (round-2 repair, no merge-instructions section, run ended exit 1 and was completed by DO-D8B). Derive the count and names from a fresh run of node tools/release/protocol-audit.mjs --stage DG7 --json <scratch file>, not from memory; if it reports a different number, use that number and list every name. Fix every other place in the register that says 'six' for these hits. (2) F-DG7-921: in REQ-S19-017, cite as the evidence for 'records, jobs and approvals intact after a full restart' the post-fix run that really restarted PostgreSQL (docs/delivery/handbacks/DG7/T-DG7-DO-D8B-evidence/t-b11-run.log; check it shows the PostgreSQL restart before citing it), and disclose that the earlier DO-D7/DO-E D9 runs restarted only the API and worker, as the DO-D8 and DO-D8B handbacks found. Keep every row IMPLEMENTED only if its acceptance is still literally met; then run node tools/gates/validate.mjs --register DG7 and record the output. Do not edit docs/handover/** (the orchestrator regenerates release notes and known limitations), gate tooling, reviews or gate records. Your handback must contain all five sections: files changed, checks run with exit codes, merge instructions, residual risks, open questions. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-AN-P7G-transformation-analyst.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-AN-P7G-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
