# Assignment T-DG7-DO-E6: Secret-scan hits introduced by DO-E5 (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** Pre-freeze run 2 (docs/delivery/test-evidence/DG7/orchestrator/prefreeze/checks-2.log; docs/delivery/test-evidence/DG7/orchestrator/prefreeze/2-secret-scan-payload.log, docs/delivery/test-evidence/DG7/orchestrator/prefreeze/2-release-tool-tests.log T-G2): node tools/release/secret-scan.mjs --scope payload exits 1 on S2 at deploy/scripts/tests/dockerfile-context.test.mjs:191 (a comment spelling a scheme://user:pass@host URL), and --scope history also fails on DO-E5's handback l.29 and its run result.json quoting that text. Reword the comment so S2 no longer matches. Run records are write-once and git history cannot be rewritten, so for history-only hits add allow-list entries with reasons in the same form DO-J2 used (handbacks/DG7/T-DG7-DO-J2-devops-engineer.md); also reword DO-E5's handback line (implementer doc). Never weaken a scanner rule. Record payload and history scan exits (both must be 0) and the secret-scan tests. Write your own handback without quoting any matched text verbatim. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-E6-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-E6-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
