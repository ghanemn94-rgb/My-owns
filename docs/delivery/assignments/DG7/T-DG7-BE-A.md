# Assignment T-DG7-BE-A: P7 module registry, route and worker stubs, permission wiring (backend-workflow-engineer)

## Stage and base

- **Stage:** P7 "Independent transfer and release", gate DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`, current `HEAD`. Work in the repository root. You run alone.
- **Your task is the BE-A row of `docs/architecture/p7-plan.md` §5.1** ("`modules.ts`, `server.ts`, `architecture.test.ts` (modules `transfer`, `retention`, `release` registered; every P7 route file as a stub with its registration line; the `RetentionClassRegistry` wiring point); worker stubs `apps/worker/src/handlers/{retention,transfer}/index.ts` and one line each in the worker registries; the P7 permission wiring").
- **Read first:** `docs/architecture/p7-work-split.md` §1, §2 and every "Module registry → BE-A" or "BE-A" mention in §B, §C, §D, §E, §F and §I; ADR-0062 to ADR-0070; decisions D-243 to D-250; the pending lists `apps/api/test/support/p7-pending*.ts` and `p7-operations.ts`. Follow how P6's equivalent registry task did it (`docs/delivery/assignments/DG6/` BE-A and its handback).
- **Time:** 60–75 minutes. `date -u` at start and end.

## Environment

Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Offline. Ports below 32768. **Disk is tight (about 4 GB free): never make an extra checkout; delete your own temporary trees.** The write guard forbids `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, review and gate records, `stages.json`, `findings.json`, `test-evidence/**`, `trading_agent/`.

## Work

1. Register the modules `transfer`, `retention` and `release` and every P7 route file the work split names as a **stub** (each route still in a `p7-pending` list returns the module's not-implemented problem exactly as P6 stubs did, so the contract test's pending mechanism stays honest). One registration line per route file, in the files the work split assigns to you.
2. The `RetentionClassRegistry` wiring point (ADR-0067), with no behaviour yet.
3. Worker stubs `apps/worker/src/handlers/{retention,transfer}/index.ts` and one registry line each.
4. The P7 permission wiring: every P7 permission code from `P7_PERMISSIONS` reachable from its routes' guards; `architecture.test.ts` updated so module boundaries hold (ADR-0002).
5. Do not implement any P7 behaviour beyond stubs; the later BE/FE tasks own it.

## Handback

`docs/delivery/handbacks/DG7/T-DG7-BE-A-backend-workflow-engineer.md` with the five sections (what was built, behaviour per requirement, checks run with real exit codes, known gaps, open questions); logs in `docs/delivery/handbacks/DG7/T-DG7-BE-A-evidence/`.

## Acceptance

- `pnpm -r typecheck`, `pnpm lint`, `pnpm openapi:lint`, `pnpm test` exit 0; the integration contract and architecture tests pass on a disposable PostgreSQL (`tests/qa/support/with-pg.sh`).
- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exits 0.
- `node tools/gates/validate.mjs --historical --stage DG6` exits 0.

Never report a check as passed that did not run.
