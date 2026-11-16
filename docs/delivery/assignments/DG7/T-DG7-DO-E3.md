# Assignment T-DG7-DO-E3: Make the container image build (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** The orchestrator's host run (docs/delivery/test-evidence/DG7/orchestrator/host/host-run.log step 03) shows deploy/scripts/build-image.sh fails: (a) corepack enable --install-directory /pnpm needs the directory (ENOENT); (b) the dependency layer lacks COPY packages/reporting/package.json; (c) .dockerignore's **/*secret* drops tracked sources (apps/worker/src/secrets.ts, apps/api/src/**/secret-*.ts, secrets.ts, secret-namespace.ts). The orchestrator's probe (image-build-probe.diff in that folder) builds with exit 0. Apply those fixes properly, and add node --test checks that fail on each defect: every workspace package.json is COPYed before install, and no git-tracked file under apps/*/src or packages/*/src is excluded by .dockerignore. Add an optional pass-through in build-image.sh for host build networking and proxy (e.g. --network and the standard proxy build args from the environment) without baking proxy values into the image. You cannot reach the Docker socket from your sandbox: do not claim an image build; the orchestrator reruns it. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-E3-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-E3-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
