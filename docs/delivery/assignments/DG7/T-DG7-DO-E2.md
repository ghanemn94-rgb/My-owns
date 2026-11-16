# Assignment T-DG7-DO-E2: Image-bundle follow-ups and the container host run (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** (1) Land ARCH-R6's DO-E code follow-ups in deploy/scripts/image-bundle.sh (exit 3 on the classic store; save only Compose-run images and write `excluded`; matching T-B12 cases) and update docs/operations/restricted-network.md's 'four images' line. (2) The orchestrator started a Docker daemon in this container (docker info: containerd snapshotter, Server 29.9.2; pulls go through the HTTPS proxy). Execute the full command list of handbacks/DG7/T-DG7-DO-E-devops-engineer.md §5 (init-secrets with MTH_SECRETS_DIR outside the repo, pull, build-image, save, rm, load, verify, Compose up --pull never --wait with ps and /readyz, the no-egress run with the test IdP, the Keycloak e2e spec), plus the A19 container drill if the work split names one. Log every command, exit code and timing to docs/delivery/test-evidence/DG7/orchestrator/host/ (prefix files do-e2-). A step that fails is reported FAIL with its log; fix only what is in your ownership, else report. This is one Docker host with registry access, not an air-gapped or HA environment; say so. Run docker compose down -v and remove secrets dirs at the end. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-E2-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-E2-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
