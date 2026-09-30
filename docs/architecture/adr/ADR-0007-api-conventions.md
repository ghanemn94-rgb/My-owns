# ADR-0007: API conventions: REST, OpenAPI 3.1 contract-first, errors, pagination, validation, rate limiting, request IDs

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-027, REQ-S16-030, REQ-S19-006, REQ-S19-007, REQ-S15-007 (bilingual errors), REQ-S15-011.

## Decision

1. **REST under `/api/v1`** with JSON bodies. `/healthz` (liveness) and `/readyz` (DB reachable and all migrations shipped with the build applied) sit at the root.
   - Resource names are plural and kebab-case; JSON fields are camelCase; enum values are snake_case storage codes.
   - Actions that are not plain field updates are explicit sub-resources (`/archive`, `/revoke`), each needing a reason.
2. **Contract-first OpenAPI 3.1.** `docs/api/openapi.yaml` is the **source of truth**. solution-architect owns it; other agents request changes through the orchestrator. It is kept in sync by:
   - `@mth/shared/schemas` (zod), which mirrors the components and is used for request validation in the API and for forms in the web;
   - **contract tests** in `apps/api` that load the OpenAPI document (with `yaml` 2.8.1 and `ajv` 8.17.1 plus `ajv-formats` 3.0.1, JSON Schema 2020-12 mode) and validate every response body, status and headers produced by the route tests against the matching operation;
   - a **route-coverage test**: every Fastify route under `/api/v1` has an OpenAPI operation, and every operation has a route;
   - `pnpm openapi:lint`: `@apidevtools/swagger-parser` 10.1.1 validation plus project rules (unique operationIds, CSRF on unsafe methods, 409/428 on If-Match, problem+json errors).

   *Why not code-first generation:* the contract must stay stable once a gate approves it, and a generated spec changes whenever someone touches a route. Contract-first plus tests makes drift a test failure, not a silent contract change. Breaking changes need `/api/v2` or a reopened gate.
3. **Errors: RFC 9457** `application/problem+json`:
   - `type` is a URN (`urn:mth:problem:<kind>`);
   - `title`/`detail` are English diagnostics;
   - `code` is the stable i18n key the web translates into ar/en;
   - `requestId` is always present;
   - `errors[]` (JSON pointer, code, message) for validation;
   - `currentVersion` on 409.

   | Status | Used for |
   |---|---|
   | 400 | schema validation |
   | 401 | no session |
   | 403 | no permission, or CSRF failure |
   | 404 | missing or not readable |
   | 409 | version conflict or duplicate |
   | 422 | business rule / transition |
   | 428 | missing If-Match |
   | 429 | rate limit |
   | 500 | internal, no internals leaked |
   | 503 | not ready |
4. **Pagination: cursor-based.**
   - `limit` defaults to 25 (maximum 100). `cursor` is opaque: base64url of the sort key and `id`, bound to the filters by a hash.
   - Responses are `{ items, nextCursor }`, with a stable sort that always ends with `id`.
   - Offset pagination is not offered: it is unstable under concurrent inserts and slow on large audit tables.
   - Table UIs page with next/previous cursors and keep their sort and filter chips.
5. **Validation:** **zod 4.1.12** (MIT) [UNVERIFIED], shared between API and web. The API validates body, query and params before the handler runs. Unknown properties are rejected (strict objects). Strings are trimmed where the schema says so.
6. **Concurrency:**
   - `ETag: "<version>"` on every single-resource response.
   - `If-Match` is required on PATCH, PUT and action endpoints that change a versioned record.
   - Missing If-Match → 428; stale → 409 (ADR-0003).
   - `Idempotency-Key` is optional on `POST /transformations`: the same key and body return the original 201, and the same key with a different body gives 422. Keys are stored for 24 hours.
7. **Rate limiting (T-3): `@fastify/rate-limit` 10.3.0** (MIT) [UNVERIFIED].
   - Global limit `RATE_LIMIT_PER_MINUTE` (default 300), keyed by session ID or else client IP.
   - Stricter `AUTH_RATE_LIMIT_PER_MINUTE` (default 20 per IP) on `/auth/login`, `/auth/callback` and `/auth/dev-login`.
   - A 429 response is problem+json with `Retry-After`.
   - Store: **in-process memory** in P1. With one API instance per deployment in P1 and Compose, it is correct. For several instances, P6 adds a small PostgreSQL-backed store through the plugin's custom-store interface. No Redis is introduced (the "no extra mandatory service" rule).
   - *T-3 alternatives considered:*
     - `express-rate-limit`: Express-only, and we use Fastify.
     - `rate-limiter-flexible` (ISC): good, and it has a Postgres store, but it duplicates the plugin wiring; kept as the fallback if the custom store proves awkward.
     - Rate limiting only at a reverse proxy: IT may add it, but the app must protect itself when deployed without one.
   - `TRUST_PROXY` controls which `X-Forwarded-For` hops are believed.
8. **Request IDs.**
   - An inbound `X-Request-Id` is accepted if it matches `^[A-Za-z0-9._-]{1,128}$`; otherwise a UUIDv7 is generated.
   - It is echoed in the response header and included in every log line (pino, via Fastify), every problem body and every audit event.
9. **Framework: Fastify 5.6.1** (MIT) [UNVERIFIED]. Security headers come from `@fastify/helmet` 13.0.2 (strict CSP with `default-src 'self'`, no remote origins), and the SPA is served by `@fastify/static` 8.2.0.
   - Body size limit: 1 MiB for JSON. Upload endpoints come in P2/P6 with their own limits.

## Alternatives

- **GraphQL.** Harder to authorize per field and to cache, and less conventional for IT integration contracts.
- **tRPC.** Couples clients to TypeScript and does not produce a language-neutral contract, which §19 item 4 needs.
- **Express 5.** Viable, but Fastify has first-class schema, hooks and logging, and is faster.

## Verification evidence

| Item | Pinned | Licence | Evidence |
|---|---|---|---|
| fastify | 5.6.1 | MIT | [UNVERIFIED] |
| @fastify/rate-limit | 10.3.0 | MIT | [UNVERIFIED] |
| @fastify/helmet | 13.0.2 | MIT | [UNVERIFIED] |
| @fastify/static | 8.2.0 | MIT | [UNVERIFIED] |
| zod | 4.1.12 | MIT | [UNVERIFIED] |
| ajv / ajv-formats | 8.17.1 / 3.0.1 | MIT | [UNVERIFIED] |
| yaml | 2.8.1 | ISC | [UNVERIFIED] |
| @apidevtools/swagger-parser | 10.1.1 | MIT | [UNVERIFIED]; OAS 3.1 support to be confirmed. Fallback: `@redocly/cli` with telemetry disabled (`REDOCLY_TELEMETRY=off`) |
| OpenAPI document | 3.1.1 | — | Offline structural check (YAML parse, all `$ref` resolve, 32 unique operationIds, path params declared, CSRF/If-Match/problem+json rules) [V-LOCAL 2026-09-30]; full OAS validation BLOCKED until install |
