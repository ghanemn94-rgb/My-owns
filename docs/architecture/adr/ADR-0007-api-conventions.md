# ADR-0007: API conventions: REST, OpenAPI 3.1 contract-first, errors, pagination, validation, rate limiting, request IDs

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-027, REQ-S16-030, REQ-S19-006, REQ-S19-007, REQ-S15-007 (bilingual errors), REQ-S15-011.

## Decision

1. **REST under `/api/v1`** with JSON bodies. `/healthz` (liveness) and `/readyz` (DB reachable and all migrations shipped with the build applied) sit at the root.
   - _Amended 2026-10-23 (T-DG5-ARCH-RG1; D-185, F-DG5-100): the `Readiness` check `migrations` is `ok` when the database is up to date. It is `fail` for drift the migration runner refuses: an applied file whose checksum changed, an applied file this build does not ship, or **a pending file whose id is not above the highest applied id** (`apps/api/src/modules/platform/health.ts:48–52`; ADR-0003, "Migration order"). It is `pending` only for forward migrations the runner would apply. Anything but `ok` answers 503 `not_ready` (`health.ts:60–63`). The contract is unchanged: the `Readiness` enum is still `ok | pending | fail`, and the `getReadiness` summary is still true. Test: `apps/api/test/integration/platform.test.ts:49`._
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

   **4a. Amendment (DG6, T-DG6-ARCH-05, 2026-10-27; D-199): bounded collections, named one by one.**
   - **Rule.** A `list*` operation may return `{ items }` without `nextCursor` only when it is named in the table below, with a bound that the database or the code enforces and that is at most 250 items. Every other list operation is `{ items, nextCursor }` as above. A new unpaginated list needs a new amendment row; `UNPAGINATED_LISTS_AT_HEAD` in `apps/api/test/integration/contract/response-validation.test.ts` pins the set, so it can only shrink.
   - **Evidence.** Rows 1–15 and 16–19: the T-DG6-ARCH-05 probe (`docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/probe-output.txt`, LB01–LB06). Row counts, privileges and keys of every row: `list-bounds-inspect.txt` in the same folder (every migration applied to an empty PostgreSQL 16.13 database, 2026-10-27). "No INSERT" means the application role `mth_app` holds no INSERT privilege on the table, so only a migration can add a row.
   - **The 21 exempt bounded collections:**

     | # | Operation | Bound (items per response) | Why the bound holds |
     |---|---|---|---|
     | 1 | `listPermissions` | 185 | `permission`: no INSERT for `mth_app`; 185 rows after `0112` |
     | 2 | `listRoles` | 14 | `role`: no INSERT; 14 rows |
     | 3 | `listRoleAccountabilities` | 14 | `role_accountability`: no INSERT; 14 rows |
     | 4 | `listPhases` | 6 | `phase_definition`: no INSERT; 6 rows |
     | 5 | `listGuidingQuestions` | 4 | `guiding_question`: no INSERT; 4 rows |
     | 6 | `listDecisionRightTemplates` | 4 | `decision_right_template`: no INSERT; 4 rows |
     | 7 | `listGovernanceParties` | 18 | `governance_party`: no INSERT; 18 rows |
     | 8 | `listAdoptionIndicatorTemplates` | 8 | `adoption_indicator_template`: no INSERT; 8 rows |
     | 9 | `listBenefitFormulaExamples` | 2 | `benefit_formula_example`: no INSERT; 2 rows |
     | 10 | `listFormRecordTypes` | 33 | `form_record_type`: no INSERT; 33 rows |
     | 11 | `listReportDefinitions` | 12 | `report_definition`: no INSERT; 12 rows |
     | 12 | `listConfigReviewPolicies` | 7 | `config_review_policy`: no INSERT; `UNIQUE (config_kind)`; 7 rows |
     | 13 | `listJobOperations` | 16 | one entry per `job_schedule` row: no INSERT; `UNIQUE (code)`; 16 rows |
     | 14 | `listHealthCheckQuestions` | 25 | the `source_element` rows of set `health_question` (B0152): 25, fixed by migration |
     | 15 | `listMethodologyElements` | 56 | one entry per `methodology_element_profile` row: no INSERT (`0089` grants SELECT only); 56 rows |
     | 16 | `listGates` | 6 per transformation | `gate_instance` `UNIQUE (transformation_id, gate_code)` over the 6 `gate_definition` rows (no INSERT) |
     | 17 | `listGovernanceMatrices` | 2 per transformation | `governance_matrix` `UNIQUE (transformation_id, kind)`, `kind IN ('decision_rights', 'raci')` |
     | 18 | `listTransformationConfigPins` | 6 per transformation | `transformation_config_pin` `UNIQUE (transformation_id, kind)` over a CHECK of 6 kinds |
     | 19 | `listGateSubmissionCriteria` | 32 per submission | `gate_submission_criterion` `UNIQUE (gate_submission_id, criterion_key)`, and `criterion_key` references `gate_criterion_definition (key)`: 32 rows, no INSERT. (The submission code writes only the gate's own criteria, at most 8 per gate; the database bound stated here is the 32.) |
     | 20 | `listMethodologyBlockLinks` | 64 per block | the block's seeded `playbook_block_link` rows (no INSERT; at most 14 per block) plus the version's `linksAdded` for that block: one `block.<Bxxxx>` element per version (`UNIQUE (methodology_version_id, element_type, stable_key)`), whose `linksAdded` array the `0089` guard `methodology_element_reader_block` caps at 50 |
     | 21 | `listImportTemplates` | 1 in P6 | one entry per import target registered in code (ADR-0056 §9: `kpi_actual.v1` only); a new target is a code change with its own ADR row |

   - **The 17 lists that are not bounded, named for pagination in a later task** (`docs/architecture/p6-work-split.md` §D.5, task T-DG6-BE-V). Each grows with user data and no constraint caps it: `listApprovalRoutes` (one per routed approval type and per routed procedure of a published version; procedure definitions are not capped), `listBenefitFormulaVersions` (`UNIQUE (formula_id, version_no)`, no cap), `listBusinessCaseLines`, `listDeliverables`, `listDependencyTypes` (`mth_app` may INSERT custom types), `listHealthCheckSchemes` (one per published version, which grows with every publish), `listInitiativeDecisionLinks`, `listInitiativeGapLinks`, `listInitiativeOutcomeContributions`, `listKpiRestatementReissueOffers` (`UNIQUE (restatement_id, snapshot_id)`, as many as the snapshots), `listMilestones`, `listReportSnapshotVersions`, `listResourceRoles`, `listRoadmapWaves`, `listTemplateSourceLinks` (bounded by 8,252 = the seeded links plus 50 added links on each of 165 blocks, over the 250 limit), `listTomWorkshopParticipants`, `listWeightSets`. Until that task ships they stay in `UNPAGINATED_LISTS_AT_HEAD` and return every item; adding `nextCursor` is additive (D-196 item 4) and removes them from the pin.
   - This amendment changes no operation, schema or response. The P6 list operations of slice D (`listAssistantConversations`) are cursor-paginated.
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
     - **503 `unavailable` from an exhausted database pool (D-072, T-DG2-BE17).** A checkout that waits longer than the pool's `connectionTimeoutMillis` is an operational failure, like 500, never a contract response. Only `getReadiness` declares 503, as its documented not-ready answer.
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
