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

   **5a. Amendment (DG2, T-DG2-ARCH-02, 2026-10-06): every operation that validates input declares 400.**
   - **Rule.** An operation that validates any request input declares `"400": { $ref: "#/components/responses/ValidationError" }`. Input means body, query string or path parameters. A response status that the contract does not declare is contract drift, and the strict contract test fails on it.
   - **Scope.** The central request check (F-DG2-231, `preHandler` in `platform/hooks.ts`) refuses U+0000 anywhere in a body, query or path parameter on every route, with 400 `validation.invalid_character`. So **every operation declares 400**.
   - **The only exception** is `completeOidcLogin` (`GET /api/v1/auth/callback`). It opts out (`config.invalidCharacters: "route"`), validates its own query and answers every outcome with a redirect (302).
   - **The 41 operations amended** had declared no 400 before:
     - the 33 GET operations with path parameters;
     - `getHealth`, `getReadiness`, `getMe`, `listRoles`, `listPermissions`, `getBrandingTokens`, `listRoleAccountabilities` and `logout`.

     This is an additive amendment: no operation, schema or other response changed, and the operation count stays 161.
   - **Pointers.** A malformed path parameter reports exactly one field error at `/params/<name>` (for example `/params/tomGapId`). That is the same pointer style as `/query/<key>` and body `/field`. Shared path helpers (`register-kit` `paramsOf`, KPI `parseRecordParams`) validate the parameters as one named object, so the pointer always carries the parameter name.
   - **Tests.** `apps/api/test/integration/contract/malformed-input.ts`, run from `contract.test.ts`:
     - every GET operation with a path parameter, called with a malformed last parameter, returns a declared 400 at `/params/<name>` and writes no audit row;
     - a U+0000 path id returns 400 `validation.invalid_character`;
     - every operation except the callback returns a declared 400 for a U+0000 in the query string;
     - a contract assertion: every operation except the callback declares 400.
   - **New operations.** A new operation declares 400 from the start. `pnpm openapi:lint` does not enforce this rule; the contract test does.

   **5b. Amendment (DG2, T-DG2-ARCH-03, 2026-10-06): every operation declares every status its platform layer can return.**
   - **Rule.** The *platform layer* is everything that can answer for an operation regardless of its handler: hooks, authentication and CSRF, the rate limiter, the If-Match prologue, validation, and framework/parser errors. Every status it can return for an operation is declared on that operation, using the shared components. An undeclared one is contract drift (the §5a rule, generalised). The statuses are derived from the route's declared access:

     | Status | Component | Declared on | Platform source |
     |---|---|---|---|
     | 400 | `ValidationError` | every operation except `completeOidcLogin` (§5a) | central request check, body/query parsers, `frameworkErrors` |
     | 401 | `Unauthenticated` | every operation whose route is not `{ public: true }` | identity `preValidation`: no resolved session |
     | 403 | `Forbidden` | every non-public operation with an unsafe method (POST, PUT, PATCH, DELETE) | identity `preValidation`: Origin / `X-CSRF-Token` |
     | 428 | `PreconditionRequired` | every operation that takes the `IfMatch` parameter | If-Match prologue (`platform/http.ts`): header missing |
     | 409 | `VersionConflict` | every operation that takes the `IfMatch` parameter | the same prologue: stale version |
     | 429 | `RateLimited` | **every operation** | `@fastify/rate-limit` (§7) |

   - **429 on every operation.** The limiter is registered with `global: true` at `onRequest`, before authentication, so unauthenticated and public calls are counted too. Two details from `apps/api/src/server.ts`:
     - **Key.** The user id of a session the identity hook has *resolved* (within the idle timeout) is the key; anything else (no cookie, forged, expired or revoked) is keyed by the client IP (F-DG1-142). The three auth routes (`startOidcLogin`, `completeOidcLogin`, `devLogin`) use their own stricter per-IP limit (`AUTH_RATE_LIMIT_PER_MINUTE`). This corrects §7's "keyed by session ID".
     - **Exemption.** The `allowList` compares the exact request URL with `/healthz` and `/readyz`. The bare health URLs are never limited, but the same operations called with a query string (`/healthz?probe=1`) are counted and answer 429. `getHealth` and `getReadiness` therefore declare 429 as well. Comparing the matched route rather than the raw URL is a product change outside this amendment; it would let the health operations drop 429 again only through a reopened contract.
   - **Out of the contract by design (D-067).** These are deliberately **not** declared on any operation:
     - **500 `internal`.** It is a failure (including the fail-closed authorization guard), never a contract response; a test that receives one fails.
     - **408 request timeout.** It is a transport-level answer of Node's `clientError` handler and can occur before any operation is matched.
     - **404 for an unmatched route.** No operation matched, so there is no operation to declare it on. This includes the dev-login and OIDC routes in a mode where they are not registered. 404 *as a handler answer* (missing or unreadable record) stays declared where the operation gives it.
     - **429 for an unmatched route (D-071, T-DG2-BE16).** The not-found handler is rate-limited with the same limiter, key and bucket as the operations (`registerNotFoundHandler` with `preHandler: app.rateLimit()`). No operation matched, so, as for the unmatched 404, there is no operation to declare it on.
     - The other connection- or router-level answers (`clientError`'s malformed request and oversized headers, `FST_ERR_BAD_URL`) are also written before an operation is matched. They are 400 `ValidationError` problems, which every operation but the OIDC callback declares anyway.
   - **The 158 operations amended.** All 161 operations except `startOidcLogin`, `completeOidcLogin` and `devLogin` (which already declared it) gained `"429": { $ref: "#/components/responses/RateLimited" }`. No 400, 401, 403, 409 or 428 was missing. The amendment is additive: no operation, schema or other response changed, and the operation count stays 161.
   - **Tests.** `apps/api/test/integration/contract/platform-statuses.ts`, run from `contract.test.ts`:
     - **rule test.** For every operation it derives the platform statuses from the route's declared access (public or not), its method (mutation or not), the contract's `IfMatch` parameter and the limiter, and fails on any undeclared one. It also pins the derivation for five known operations. Negative controls: on the pre-amendment contract it fails with 158 undeclared 429s, and with one 401, 403, 409 and 428 removed it lists exactly those four;
     - **live sweep.** With both limits set to 1 per minute, every one of the 161 operations is called twice. The second call is a 429 `rate_limited` problem with `Retry-After`, asserted against the contract. The bare health URLs still answer 200.
     - The rate-limit tests in `invalid-utf8.test.ts` and `platform.test.ts` now assert their 429 against the contract too; they skipped that assertion while the 429 was undeclared.
   - **New operations.** A new operation declares its platform statuses from the start. `pnpm openapi:lint` checks 409/428 on If-Match; the contract test checks the rest.
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
