# ADR-0012: Testing strategy

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S20-031, REQ-S20-012/013/014/018/020 (P1 increments), REQ-S21-002.

## Decision

| Level | Tool | Where | Runs against |
|---|---|---|---|
| Unit (node) | **Vitest 3.2.4** (MIT) [UNVERIFIED], project `unit-node` | `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts`, `tests/qa/unit/**` | pure functions: policy scope resolution, status transitions, problem mapping, config loader, token contrast |
| Unit (web) | Vitest + jsdom 27.0.0 + Testing Library 16.3.0 [UNVERIFIED], project `unit-web` | `apps/web/src/**/*.test.tsx` | components, i18n key parity, RTL direction switching |
| Integration | Vitest, project `integration` | `apps/*/test/integration/**`, `packages/*/test/integration/**`, `tests/qa/integration/**` | **real PostgreSQL**: a disposable database per run |
| Contract | Vitest (in `integration`) | `apps/api/test/integration/contract/**` | responses validated against `docs/api/openapi.yaml` (ADR-0007) |
| E2E | **Playwright `@playwright/test` 1.56.1** (Apache-2.0) | `e2e/**` (qa-verifier acceptance suites) and `apps/web/e2e/**` (frontend journeys and visual screenshots) | built app + DB + (test) IdP, projects `chromium-en` and `chromium-ar` |
| Accessibility | `@axe-core/playwright` 4.10.2 | inside e2e | every P1 screen in both languages |
| Visual | Playwright screenshots | `e2e/visual/**` | EN (LTR) and AR (RTL) per screen, kept as evidence under `docs/delivery/test-evidence/DG1/` |

### Integration database

- `packages/db/test/global-setup.ts` connects with `TEST_DATABASE_ADMIN_URL`, creates `mth_test_<runId>`, creates the roles `mth_owner` and `mth_app` if missing, runs **all migrations on the fresh database** (this doubles as the REQ-S19-004 check), and drops the database at teardown.
- Files run serially inside the project. Each test cleans up with transactions or unique data.
- If `TEST_DATABASE_ADMIN_URL` is missing, the integration project **fails with a clear "BLOCKED: no database" message**. It never silently skips (CLAUDE.md: never report an unrun check as passed).

### Playwright browsers (CF-2)

- **`playwright install` is never run**, in the sandbox, in CI or in images.
- `@playwright/test` is pinned to exactly **1.56.1**. Its playwright-core 1.56.1 `browsers.json` expects **chromium revision 1194** (Chromium 141.0.7390.37) [V-LOCAL]. That revision is pre-installed at `/opt/pw-browsers/chromium-1194` and `/opt/pw-browsers/chromium_headless_shell-1194` [V-LOCAL].
- Every environment sets `PLAYWRIGHT_BROWSERS_PATH`:
  - `/opt/pw-browsers` in the build sandbox;
  - `/ms-playwright` in CI, which uses the version-matched official image `mcr.microsoft.com/playwright:v1.56.1-noble`, pinned by digest by devops [UNVERIFIED tag]. Its browsers are baked in, so again no install step.
- Upgrading Playwright is a deliberate change: new pin, new matching browser image or sandbox browsers, and an update to this ADR.

### Rules

- A passing build is not acceptance (REQ-S20-031).
- A test that cannot run is reported as BLOCKED with the exact reason.
- qa-verifier writes the A12/A13/A14/A20/A18 first cases test-first, before freeze, under `tests/qa/**` and `e2e/**`.
- Implementers add unit and integration tests for their rows. Every mutation test covers authorization, validation, concurrency and audit (CLAUDE.md).

## Alternatives

- `node:test`: viable for Node, but using Vitest for both web and node gives one runner, one config and jsdom support.
- Testcontainers: needs a Docker socket, which the sandbox does not grant [V-LOCAL: `docker version` → permission denied on `/var/run/docker.sock`]. A plain admin URL works both locally (local PG 16) and in CI (a service container).

## Verification evidence

| Item | Pinned | Licence | Evidence |
|---|---|---|---|
| @playwright/test | 1.56.1 | Apache-2.0 | `playwright` 1.56.1 and `playwright-core` 1.56.1 package.json + `browsers.json` chromium r1194 read from `/opt/node22/lib/node_modules/playwright` and the cached registry tarball [V-LOCAL 2026-09-30]; `/opt/pw-browsers/chromium-1194/INSTALLATION_COMPLETE` present [V-LOCAL] |
| vitest | 3.2.4 | MIT | [UNVERIFIED] |
| jsdom | 27.0.0 | MIT | [UNVERIFIED] |
| @testing-library/react / dom | 16.3.0 / 10.4.1 | MIT | [UNVERIFIED] |
