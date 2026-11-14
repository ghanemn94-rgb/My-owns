# Assignment T-DG7-DO-E4: Image bundle keeps image names across save/load; pin-images C2 (devops-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task:** (1) Host run 2 (docs/delivery/test-evidence/DG7/orchestrator/host/host-run.log steps 04-09) shows deploy/scripts/image-bundle.sh save passes 'ref:tag@digest' names to docker save; on the containerd store the archive then loads by image ID only ('Loaded image ID: sha256:…'), verify reports 'does not match', and Compose up --pull never fails 'No such image: postgres:18@sha256:…'. The orchestrator verified the fix manually: tag the image as 'ref:tag', docker save by 'ref:tag', and after docker load, 'docker image inspect ref:tag@digest' resolves to the pinned id. Make save tag each pinned image as ref:tag (failing if the local id differs from the lock digest) and save by ref:tag; make load+verify check that every ref:tag@digest resolves; add node --test cases that fail on the old behaviour (mock docker). (2) Fix deploy/scripts/tests/pin-images.test.mjs C2 (expects 2 pinned compose image lines; compose.yaml now has 3), confirming the third line is intended. You cannot reach Docker from your sandbox; the orchestrator reruns the host run. Read §1 and §2 of `docs/architecture/p7-work-split.md`, the sections named here in full, the ADRs they cite, `docs/architecture/p7-plan.md` and decisions D-243 onward.
- **Time:** 60–75 minutes. `date -u` at start and end; past about 70 minutes, finish the current file and write the handback listing what remains.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline (`MTH_PNPM_OFFLINE=1`). Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`. No Docker daemon (D-243 Q1).

## Deliverables

Everything your scope assigns to you, with its tests passing, and the pending entries you implement removed from `apps/api/test/support/p7-pending*.ts`. Every mutation has a server-side authorization check, validation, optimistic concurrency where it updates, and an audit event, each covered by a test. Decimal arithmetic for money and rates; Unknown/Stale never shown as zero or green; bilingual texts as the work split gives them.

Then the handback `docs/delivery/handbacks/DG7/T-DG7-DO-E4-devops-engineer.md` with five sections: files changed; behaviour per requirement; checks run with their real exit codes; known gaps; open questions. Logs in `docs/delivery/handbacks/DG7/T-DG7-DO-E4-evidence/`.

## Acceptance

- Every your scope test passes; `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint` and `pnpm test` exit 0; the integration tests you touch (and the contract test) pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run. A missing tool is BLOCKED.
