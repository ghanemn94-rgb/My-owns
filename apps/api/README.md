# @mth/api

**Responsibility.** The single HTTP API process of the modular monolith (ADR-0002). It serves `/api/v1/**`
per `docs/api/openapi.yaml`, `/healthz` and `/readyz`, and the built web bundle (same origin, ADR-0005).

**Modules** (`src/modules/<name>/`, map and allowed dependencies in `src/modules.ts`): platform, audit, identity,
access, organization, transformations, methodology, workflows, kpi, reporting, evidence, jobs, admin.
P1 implements platform, audit, identity, access, organization, transformations, jobs (outbox writer) and admin.
`src/architecture.test.ts` enforces the map (only `index.ts` of a declared dependency may be imported).

**Rules.** Every mutation: policy check (`access` module, one function) → zod validation (`@mth/shared/schemas`)
→ `If-Match`/version check → write + audit event (+ outbox event) in one transaction (ADR-0003/0004/0006/0007).
A failed authorization of a mutation is audited too (`authorization.denied`). Every `/api` route declares
`config.access` (`{ public: true }` or `{ permission }`), or the server refuses to start; a success response from a
route that never consulted the policy function is turned into a 500 (fail closed).

## Run

| What | Command |
|---|---|
| Build | `pnpm --filter @mth/api build` |
| Start (production) | `node apps/api/dist/main.js` (`pnpm --filter @mth/api start`) |
| Dev (type stripping, `@mth/source`) | `pnpm --filter @mth/api dev` |

Environment: see `packages/config/src/index.ts` (`ENV_VARS`). The API connects as `mth_app` (`DATABASE_URL`) and
needs `APP_BASE_URL`, `AUTH_MODE` and, for `AUTH_MODE=oidc`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`. It exits with code 78 on invalid configuration (including `AUTH_MODE=dev` with
`NODE_ENV=production`). The dev-login route exists only with `AUTH_MODE=dev`; OIDC routes only when OIDC is set.

Static SPA: served from `apps/api/public/` (image layout) or `apps/web/dist/` when an `index.html` exists there.

## Tests

- Unit (`unit-node`): `src/**/*.test.ts` (policy rules, platform plumbing, architecture, route registration).
- Integration (`integration`, real PostgreSQL): `test/integration/**`, all through `test/support/harness.ts`,
  whose client validates **every** response (status, body, ETag/Location) against the OpenAPI document, and every
  accepted request body against the contract's request schema. `test/integration/contract/` adds route coverage
  (routes ⇄ operations), a journey through all 32 operations and the zod-mirror lockstep check.
- OIDC is tested against `test/support/fake-idp.ts` (local OpenID Provider on 127.0.0.1; the real `openid-client`
  validates everything). Keycloak remains the portable IdP for e2e (devops-engineer).
- QA suites can reuse `startApi`, `seedWorld`, `signIn` and `call` from `test/support/harness.ts`.

**Owner from P1:** backend-workflow-engineer. Contract changes go through solution-architect.
