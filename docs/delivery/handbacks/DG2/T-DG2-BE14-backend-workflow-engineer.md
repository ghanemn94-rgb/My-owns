# Handback T-DG2-BE14: every operation accepts only its declared request media types (backend-workflow-engineer)

- **Stage:** DG2 (FIXING), round-9 repair. **Finding:** F-DG2-320 (Low, REQ-DLV-034, not mandatory).
- **Invocation:** `DG2-T-DG2-BE14-backend-workflow-engineer-20261006T191522Z-18e92928`, session `18e92928-6746-4cf4-9481-c9102a0f3760`.
- **Base:** `b15c5984271393c9e9eba9c96fe584d20b92132e`, branch `claude/mobily-transformation-platform-regate`. The changes are uncommitted in the working tree; the orchestrator integrates them.
- **Assignment:** `docs/delivery/assignments/DG2/round-9/T-DG2-BE14.md` (sha256 `de8b05d7…bc5efe`, verified before starting).
- No migration was added. `docs/api/openapi.yaml` is unchanged, and no new endpoints were added.
- I granted no business, Finance or IT approval. Product gates G1–G6 are unrelated to DG0–DG7.

## Discrepancy in the assignment

The assignment says that "86 operations use `application/json` and 2 use `application/octet-stream`". The contract actually declares **87** request bodies:

- 86 use `application/json`;
- **1** uses `application/octet-stream` (`uploadEvidenceContent`).

The other `application/octet-stream` entry in the contract is the **response** of `downloadEvidenceContent`, which is a GET with no request body. This is pinned by a test: `contract.test.ts`, "every route accepts exactly the request media types its operation declares", asserts `[87, 86, 1]`. The fix doesn't depend on the count.

## The fix (F-DG2-320)

**Root cause.** All routes shared every parser on the root instance:

- Fastify's built-in `text/plain` parser, which decodes with `setEncoding('utf8')` and so replaces invalid bytes with U+FFFD;
- the strict `application/json` parser;
- the evidence module's `application/octet-stream` parser. It was registered directly on the root instance, so it also applied to every route.

The upload handler cast whatever `request.body` it received to a byte source. `store.put` then iterated it:

- a decoded string was re-encoded character by character, which produced the U+FFFD rewrite and a sha256 over the rewritten bytes;
- an object or array threw, which produced the undeclared 500.

**Fix, implemented once** in a new module, `apps/api/src/modules/platform/media-types.ts`:

1. **A route-level `consumes` set.**
   - `FastifyContextConfig.consumes` defaults to `["application/json"]`.
   - `uploadEvidenceContent` declares `consumes: ["application/octet-stream"]`.
   - An `onRoute` check refuses to start the server when a set is empty, is not an array, or names a media type that has no parser.
   - The set is tied to the contract by a test, not by hand: `consumesDrift` in `test/integration/contract/media-types.ts` compares every routed operation's `consumes` with its `requestBody.content` keys in `openapi.yaml` and must be empty.
2. **One central `preParsing` hook** (`registerMediaTypeEnforcement`).
   - It runs after `onRequest`, so request IDs and the rate limiter come first.
   - It runs **before Fastify reads, parses or hands over any body byte**.
   - It applies exactly when Fastify would run a content-type parser. `willParseBody` mirrors `fastify@5.6.1/lib/handleRequest.js`: a body-carrying method with a Content-Type header, or else with a `Transfer-Encoding` or a `Content-Length` other than `"0"`.
   - When the media-type essence (lower-cased, parameters stripped, `""` when absent) is not in the route's set, it throws the existing 400 problem `validation`. The error has `errors[0].code = "validation.content_type"`, pointer `""`, and the detail "Send the request body as <declared types>."
   - It sets `Connection: close`, as Fastify's own parser errors do, because the unread body isn't drained.
   - Unknown routes (`request.is404`) are skipped, so they keep their 404.
3. **Parsers.**
   - Fastify's built-in `text/plain` parser is removed. No operation declares `text/plain`.
   - The JSON parser (strict UTF-8 from BE13, unchanged) and the octet-stream parser are each wrapped in `restrictParserTo(mediaType, …)`, which re-checks the route's set. This is defence in depth: a JSON operation sent `application/octet-stream` gets the declared 400 even without the hook.
4. **Evidence upload (`evidence/routes.ts`).**
   - The route declares its `consumes`.
   - As a second line of defence, the handler stores a body only if it is the raw request byte stream with no decoding encoding set, or a `Uint8Array`. Anything else is the same 400 `validation.content_type`, so a parsed value can never reach `store.put`.
   - Valid octet-stream uploads are unchanged. They are streamed, the sha256 covers the raw bytes, and the 25 MiB limit still answers the declared 413 `evidence.too_large` with no partial file.

**Precedence (unchanged in kind).** Body parsing has always run before the `preValidation` authentication hook. A body with a media type the framework could not parse already got 400 before 401 or 403, for example `FST_ERR_CTP_INVALID_MEDIA_TYPE` or invalid JSON. The new refusal sits in the same place, so an undeclared media type is 400 even without a session. This is tested: "the refusal precedes authentication". With the declared media type, the control still gets 401. 400 is declared on every operation that has a body. Nothing is written and no audit row is produced.

**Test adjusted for the new behaviour.** `test/integration/aud-write-deny.test.ts` used to send a JSON `{}` to every P2 mutation, including `uploadEvidenceContent`. That request is now a 400 before authorization. The sweep now sends each operation its **declared** media type: octet-stream bytes for the upload, JSON for the rest. The AUD caller still gets 403 with only the `authorization.denied` audit row, on all 128 operations.

## Media-type sweep: every operation, before and after

**Before:** applies to every operation with a body-carrying method. The JSON, text/plain and octet-stream parsers were all shared on the root instance, so each such route accepted all three. Any other media type got 400 `validation.content_type` via `FST_ERR_CTP_INVALID_MEDIA_TYPE`.

**After:** applies to every operation:

- the route accepts only the declared set;
- any other media type gets 400 `validation.content_type` before the body is read;
- this includes a body sent with no Content-Type.

**Basis.** The "before" column comes from the code at `b15c598`:

- `server.ts` registered the JSON parser on the root instance;
- the Fastify default `text/plain` parser was never removed;
- `registerEvidenceModule` added the octet-stream parser on the root instance.

The negative-control run confirms it on the old code:

- `createEvidence` with `text/plain` or `octet-stream` was not refused;
- `devLogin` with `text/plain` was not refused;
- the upload with a JSON body or with no Content-Type was not refused.

**Summary:** 161 operations:

- 72 GET: no body is ever read. They are unchanged, and a Content-Type there is never refused.
- 86 JSON-body operations: JSON only.
- 1 octet-stream operation: octet-stream only.
- 2 bodiless POST operations (`logout`, `activateKpiDefinition`): these declare no request body. They keep the default `application/json`, so their empty-body behaviour is exactly as before:
  - no Content-Type and no body reaches the handler;
  - Content-Type `application/json` with an empty body is the existing 400 `validation.json`;
  - `{}` (which the web client can send) is accepted.

  `text/plain` and `octet-stream` bodies on them are now 400.

| operationId | method | path | declared request media types | accepted before | accepted after |
|---|---|---|---|---|---|
| getHealth | GET | `/healthz` | none | no body read | no body read (unchanged) |
| getReadiness | GET | `/readyz` | none | no body read | no body read (unchanged) |
| startOidcLogin | GET | `/api/v1/auth/login` | none | no body read | no body read (unchanged) |
| completeOidcLogin | GET | `/api/v1/auth/callback` | none | no body read | no body read (unchanged) |
| devLogin | POST | `/api/v1/auth/dev-login` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| logout | POST | `/api/v1/auth/logout` | none | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json (empty-body rules unchanged) |
| getMe | GET | `/api/v1/me` | none | no body read | no body read (unchanged) |
| updateMyPreferences | PUT | `/api/v1/me/preferences` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listOrganizations | GET | `/api/v1/organizations` | none | no body read | no body read (unchanged) |
| createOrganization | POST | `/api/v1/organizations` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getOrganization | GET | `/api/v1/organizations/{organizationId}` | none | no body read | no body read (unchanged) |
| updateOrganization | PATCH | `/api/v1/organizations/{organizationId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listBusinessUnits | GET | `/api/v1/organizations/{organizationId}/business-units` | none | no body read | no body read (unchanged) |
| createBusinessUnit | POST | `/api/v1/organizations/{organizationId}/business-units` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getBusinessUnit | GET | `/api/v1/business-units/{businessUnitId}` | none | no body read | no body read (unchanged) |
| updateBusinessUnit | PATCH | `/api/v1/business-units/{businessUnitId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listUsers | GET | `/api/v1/users` | none | no body read | no body read (unchanged) |
| createUser | POST | `/api/v1/users` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getUser | GET | `/api/v1/users/{userId}` | none | no body read | no body read (unchanged) |
| updateUser | PATCH | `/api/v1/users/{userId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listRoles | GET | `/api/v1/roles` | none | no body read | no body read (unchanged) |
| listPermissions | GET | `/api/v1/permissions` | none | no body read | no body read (unchanged) |
| getBrandingTokens | GET | `/api/v1/branding/tokens` | none | no body read | no body read (unchanged) |
| listRoleAssignments | GET | `/api/v1/role-assignments` | none | no body read | no body read (unchanged) |
| createRoleAssignment | POST | `/api/v1/role-assignments` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getRoleAssignment | GET | `/api/v1/role-assignments/{assignmentId}` | none | no body read | no body read (unchanged) |
| revokeRoleAssignment | POST | `/api/v1/role-assignments/{assignmentId}/revoke` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTransformations | GET | `/api/v1/transformations` | none | no body read | no body read (unchanged) |
| createTransformation | POST | `/api/v1/transformations` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getTransformation | GET | `/api/v1/transformations/{transformationId}` | none | no body read | no body read (unchanged) |
| updateTransformation | PATCH | `/api/v1/transformations/{transformationId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveTransformation | POST | `/api/v1/transformations/{transformationId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTransformationAudit | GET | `/api/v1/transformations/{transformationId}/audit` | none | no body read | no body read (unchanged) |
| listStrategicGuardrails | GET | `/api/v1/transformations/{transformationId}/strategic-guardrails` | none | no body read | no body read (unchanged) |
| createStrategicGuardrail | POST | `/api/v1/transformations/{transformationId}/strategic-guardrails` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getStrategicGuardrail | GET | `/api/v1/transformations/{transformationId}/strategic-guardrails/{strategicGuardrailId}` | none | no body read | no body read (unchanged) |
| updateStrategicGuardrail | PATCH | `/api/v1/transformations/{transformationId}/strategic-guardrails/{strategicGuardrailId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveStrategicGuardrail | POST | `/api/v1/transformations/{transformationId}/strategic-guardrails/{strategicGuardrailId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listOutcomes | GET | `/api/v1/transformations/{transformationId}/outcomes` | none | no body read | no body read (unchanged) |
| createOutcome | POST | `/api/v1/transformations/{transformationId}/outcomes` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getOutcome | GET | `/api/v1/transformations/{transformationId}/outcomes/{outcomeId}` | none | no body read | no body read (unchanged) |
| updateOutcome | PATCH | `/api/v1/transformations/{transformationId}/outcomes/{outcomeId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveOutcome | POST | `/api/v1/transformations/{transformationId}/outcomes/{outcomeId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listKpiDefinitions | GET | `/api/v1/transformations/{transformationId}/kpi-definitions` | none | no body read | no body read (unchanged) |
| createKpiDefinition | POST | `/api/v1/transformations/{transformationId}/kpi-definitions` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getKpiDefinition | GET | `/api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}` | none | no body read | no body read (unchanged) |
| updateKpiDefinition | PATCH | `/api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveKpiDefinition | POST | `/api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| activateKpiDefinition | POST | `/api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}/activate` | none | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json (empty-body rules unchanged) |
| listBaselines | GET | `/api/v1/transformations/{transformationId}/baselines` | none | no body read | no body read (unchanged) |
| createBaseline | POST | `/api/v1/transformations/{transformationId}/baselines` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getBaseline | GET | `/api/v1/transformations/{transformationId}/baselines/{baselineId}` | none | no body read | no body read (unchanged) |
| updateBaseline | PATCH | `/api/v1/transformations/{transformationId}/baselines/{baselineId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveBaseline | POST | `/api/v1/transformations/{transformationId}/baselines/{baselineId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listOutcomeKpis | GET | `/api/v1/transformations/{transformationId}/outcome-kpis` | none | no body read | no body read (unchanged) |
| createOutcomeKpi | POST | `/api/v1/transformations/{transformationId}/outcome-kpis` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getOutcomeKpi | GET | `/api/v1/transformations/{transformationId}/outcome-kpis/{outcomeKpiId}` | none | no body read | no body read (unchanged) |
| updateOutcomeKpi | PATCH | `/api/v1/transformations/{transformationId}/outcome-kpis/{outcomeKpiId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveOutcomeKpi | POST | `/api/v1/transformations/{transformationId}/outcome-kpis/{outcomeKpiId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listValuePools | GET | `/api/v1/transformations/{transformationId}/value-pools` | none | no body read | no body read (unchanged) |
| createValuePool | POST | `/api/v1/transformations/{transformationId}/value-pools` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getValuePool | GET | `/api/v1/transformations/{transformationId}/value-pools/{valuePoolId}` | none | no body read | no body read (unchanged) |
| updateValuePool | PATCH | `/api/v1/transformations/{transformationId}/value-pools/{valuePoolId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveValuePool | POST | `/api/v1/transformations/{transformationId}/value-pools/{valuePoolId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listDiagnosticItems | GET | `/api/v1/transformations/{transformationId}/diagnostic-items` | none | no body read | no body read (unchanged) |
| createDiagnosticItem | POST | `/api/v1/transformations/{transformationId}/diagnostic-items` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getDiagnosticItem | GET | `/api/v1/transformations/{transformationId}/diagnostic-items/{diagnosticItemId}` | none | no body read | no body read (unchanged) |
| updateDiagnosticItem | PATCH | `/api/v1/transformations/{transformationId}/diagnostic-items/{diagnosticItemId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveDiagnosticItem | POST | `/api/v1/transformations/{transformationId}/diagnostic-items/{diagnosticItemId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listDiagnosticFindings | GET | `/api/v1/transformations/{transformationId}/diagnostic-findings` | none | no body read | no body read (unchanged) |
| createDiagnosticFinding | POST | `/api/v1/transformations/{transformationId}/diagnostic-findings` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getDiagnosticFinding | GET | `/api/v1/transformations/{transformationId}/diagnostic-findings/{diagnosticFindingId}` | none | no body read | no body read (unchanged) |
| updateDiagnosticFinding | PATCH | `/api/v1/transformations/{transformationId}/diagnostic-findings/{diagnosticFindingId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveDiagnosticFinding | POST | `/api/v1/transformations/{transformationId}/diagnostic-findings/{diagnosticFindingId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listWorkstreamOutputs | GET | `/api/v1/transformations/{transformationId}/workstream-outputs` | none | no body read | no body read (unchanged) |
| createWorkstreamOutput | POST | `/api/v1/transformations/{transformationId}/workstream-outputs` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getWorkstreamOutput | GET | `/api/v1/transformations/{transformationId}/workstream-outputs/{diagnosticWorkstreamOutputId}` | none | no body read | no body read (unchanged) |
| updateWorkstreamOutput | PATCH | `/api/v1/transformations/{transformationId}/workstream-outputs/{diagnosticWorkstreamOutputId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveWorkstreamOutput | POST | `/api/v1/transformations/{transformationId}/workstream-outputs/{diagnosticWorkstreamOutputId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTomGaps | GET | `/api/v1/transformations/{transformationId}/tom-gaps` | none | no body read | no body read (unchanged) |
| createTomGap | POST | `/api/v1/transformations/{transformationId}/tom-gaps` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getTomGap | GET | `/api/v1/transformations/{transformationId}/tom-gaps/{tomGapId}` | none | no body read | no body read (unchanged) |
| updateTomGap | PATCH | `/api/v1/transformations/{transformationId}/tom-gaps/{tomGapId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveTomGap | POST | `/api/v1/transformations/{transformationId}/tom-gaps/{tomGapId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listCapabilityHeatmapEntries | GET | `/api/v1/transformations/{transformationId}/capability-heatmap` | none | no body read | no body read (unchanged) |
| createCapabilityHeatmapEntry | POST | `/api/v1/transformations/{transformationId}/capability-heatmap` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getCapabilityHeatmapEntry | GET | `/api/v1/transformations/{transformationId}/capability-heatmap/{capabilityId}` | none | no body read | no body read (unchanged) |
| updateCapabilityHeatmapEntry | PATCH | `/api/v1/transformations/{transformationId}/capability-heatmap/{capabilityId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveCapabilityHeatmapEntry | POST | `/api/v1/transformations/{transformationId}/capability-heatmap/{capabilityId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listJourneies | GET | `/api/v1/transformations/{transformationId}/journeys` | none | no body read | no body read (unchanged) |
| createJourney | POST | `/api/v1/transformations/{transformationId}/journeys` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getJourney | GET | `/api/v1/transformations/{transformationId}/journeys/{journeyId}` | none | no body read | no body read (unchanged) |
| updateJourney | PATCH | `/api/v1/transformations/{transformationId}/journeys/{journeyId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveJourney | POST | `/api/v1/transformations/{transformationId}/journeys/{journeyId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listDependencies | GET | `/api/v1/transformations/{transformationId}/dependencies` | none | no body read | no body read (unchanged) |
| createDependency | POST | `/api/v1/transformations/{transformationId}/dependencies` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getDependency | GET | `/api/v1/transformations/{transformationId}/dependencies/{dependencyId}` | none | no body read | no body read (unchanged) |
| updateDependency | PATCH | `/api/v1/transformations/{transformationId}/dependencies/{dependencyId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveDependency | POST | `/api/v1/transformations/{transformationId}/dependencies/{dependencyId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listActionItems | GET | `/api/v1/transformations/{transformationId}/actions` | none | no body read | no body read (unchanged) |
| createActionItem | POST | `/api/v1/transformations/{transformationId}/actions` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getActionItem | GET | `/api/v1/transformations/{transformationId}/actions/{actionItemId}` | none | no body read | no body read (unchanged) |
| updateActionItem | PATCH | `/api/v1/transformations/{transformationId}/actions/{actionItemId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTomWorkshops | GET | `/api/v1/transformations/{transformationId}/tom-workshops` | none | no body read | no body read (unchanged) |
| createTomWorkshop | POST | `/api/v1/transformations/{transformationId}/tom-workshops` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getTomWorkshop | GET | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}` | none | no body read | no body read (unchanged) |
| updateTomWorkshop | PATCH | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listEvidence | GET | `/api/v1/transformations/{transformationId}/evidence` | none | no body read | no body read (unchanged) |
| createEvidence | POST | `/api/v1/transformations/{transformationId}/evidence` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getEvidence | GET | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}` | none | no body read | no body read (unchanged) |
| updateEvidence | PATCH | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveEvidence | POST | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getTransformationMethodology | GET | `/api/v1/transformations/{transformationId}/methodology` | none | no body read | no body read (unchanged) |
| updateTomDimensionLabels | PATCH | `/api/v1/methodology/tom-dimensions/{dimensionCode}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listRoleAccountabilities | GET | `/api/v1/role-accountabilities` | none | no body read | no body read (unchanged) |
| getCharter | GET | `/api/v1/transformations/{transformationId}/charter` | none | no body read | no body read (unchanged) |
| createCharter | POST | `/api/v1/transformations/{transformationId}/charter` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| updateCharter | PATCH | `/api/v1/transformations/{transformationId}/charter` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listCharterVersions | GET | `/api/v1/transformations/{transformationId}/charter/versions` | none | no body read | no body read (unchanged) |
| getCharterVersion | GET | `/api/v1/transformations/{transformationId}/charter/versions/{versionNo}` | none | no body read | no body read (unchanged) |
| getNorthStar | GET | `/api/v1/transformations/{transformationId}/north-star` | none | no body read | no body read (unchanged) |
| setNorthStar | PUT | `/api/v1/transformations/{transformationId}/north-star` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listNorthStarHistory | GET | `/api/v1/transformations/{transformationId}/north-star/history` | none | no body read | no body read (unchanged) |
| validateBaseline | POST | `/api/v1/transformations/{transformationId}/baselines/{baselineId}/validation` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| validateValuePool | POST | `/api/v1/transformations/{transformationId}/value-pools/{valuePoolId}/validation` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| approveOutcomeKpiTrajectory | POST | `/api/v1/transformations/{transformationId}/outcome-kpis/{outcomeKpiId}/trajectory-approval` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getTomCanvas | GET | `/api/v1/transformations/{transformationId}/tom-canvas` | none | no body read | no body read (unchanged) |
| getTomCanvasCell | GET | `/api/v1/transformations/{transformationId}/tom-canvas/{dimensionCode}` | none | no body read | no body read (unchanged) |
| updateTomCanvasCell | PATCH | `/api/v1/transformations/{transformationId}/tom-canvas/{dimensionCode}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listJourneyPainPoints | GET | `/api/v1/transformations/{transformationId}/journeys/{journeyId}/pain-points` | none | no body read | no body read (unchanged) |
| createJourneyPainPoint | POST | `/api/v1/transformations/{transformationId}/journeys/{journeyId}/pain-points` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| updateJourneyPainPoint | PATCH | `/api/v1/transformations/{transformationId}/journeys/{journeyId}/pain-points/{painPointId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| archiveJourneyPainPoint | POST | `/api/v1/transformations/{transformationId}/journeys/{journeyId}/pain-points/{painPointId}/archive` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTomWorkshopParticipants | GET | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/participants` | none | no body read | no body read (unchanged) |
| addTomWorkshopParticipant | POST | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/participants` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| removeTomWorkshopParticipant | POST | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/participants/{participantId}/remove` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTomWorkshopItems | GET | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/items` | none | no body read | no body read (unchanged) |
| createTomWorkshopItem | POST | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/items` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| convertTomWorkshopItem | POST | `/api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/items/{itemId}/convert` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listDecisions | GET | `/api/v1/decisions` | none | no body read | no body read (unchanged) |
| createDecision | POST | `/api/v1/decisions` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getDecision | GET | `/api/v1/decisions/{decisionId}` | none | no body read | no body read (unchanged) |
| updateDecision | PATCH | `/api/v1/decisions/{decisionId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| addDecisionOption | POST | `/api/v1/decisions/{decisionId}/options` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| updateDecisionOption | PATCH | `/api/v1/decisions/{decisionId}/options/{optionId}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| decideDecision | POST | `/api/v1/decisions/{decisionId}/decide` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listGates | GET | `/api/v1/transformations/{transformationId}/gates` | none | no body read | no body read (unchanged) |
| getGate | GET | `/api/v1/transformations/{transformationId}/gates/{gateCode}` | none | no body read | no body read (unchanged) |
| configureGateApprover | PATCH | `/api/v1/transformations/{transformationId}/gates/{gateCode}` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listGateSubmissions | GET | `/api/v1/transformations/{transformationId}/gates/{gateCode}/submissions` | none | no body read | no body read (unchanged) |
| submitGate | POST | `/api/v1/transformations/{transformationId}/gates/{gateCode}/submissions` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| getGateSubmission | GET | `/api/v1/transformations/{transformationId}/gates/{gateCode}/submissions/{submissionNo}` | none | no body read | no body read (unchanged) |
| decideGate | POST | `/api/v1/transformations/{transformationId}/gates/{gateCode}/decision` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| downloadEvidenceContent | GET | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}/content` | none | no body read | no body read (unchanged) |
| uploadEvidenceContent | POST | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}/content` | application/octet-stream | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/octet-stream |
| reviewEvidence | POST | `/api/v1/transformations/{transformationId}/evidence/{evidenceId}/review` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listEvidenceLinks | GET | `/api/v1/transformations/{transformationId}/evidence-links` | none | no body read | no body read (unchanged) |
| createEvidenceLink | POST | `/api/v1/transformations/{transformationId}/evidence-links` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| removeEvidenceLink | POST | `/api/v1/transformations/{transformationId}/evidence-links/{linkId}/remove` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |
| listTransformationTeam | GET | `/api/v1/transformations/{transformationId}/scoped-assignments` | none | no body read | no body read (unchanged) |
| assignTransformationTeamRole | POST | `/api/v1/transformations/{transformationId}/scoped-assignments` | application/json | application/json, text/plain (U+FFFD-decoding), application/octet-stream | application/json |

## Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/platform/media-types.ts` (new) | `consumes` route config, `willParseBody`, `mediaTypeEssence`, the central preParsing refusal, `restrictParserTo`, the registration check, and removal of the text/plain parser |
| `apps/api/src/modules/platform/index.ts` | exports the media-type API |
| `apps/api/src/server.ts` | calls `registerMediaTypeEnforcement` before any route; JSON parser wrapped in `restrictParserTo`; `RouteRecord.consumes` added for the contract test |
| `apps/api/src/modules/evidence/routes.ts` | upload route declares `consumes: ["application/octet-stream"]`; octet parser wrapped in `restrictParserTo`; handler stores only a raw byte body (`isRawByteBody`) |
| `apps/api/src/modules/platform/media-types.test.ts` (new) | unit tests: essence parsing, the dispatch mirror, the registration check, refusal before any parser runs, declared types still work, bodiless requests unchanged, the parser guard without the hook |
| `apps/api/test/integration/media-types.test.ts` (new) | integration tests on real PostgreSQL (below) |
| `apps/api/test/integration/contract/media-types.ts` (new) | contract helpers: `declaredRequestMediaTypes`, `consumesDrift`, the live sweep `exerciseUndeclaredMediaTypes` |
| `apps/api/test/integration/contract/contract.test.ts` | two new contract cases (structural and live) |
| `apps/api/test/integration/aud-write-deny.test.ts` | the AUD sweep sends each operation its declared media type (octet-stream for the upload) |

## Behaviour delivered (REQ-DLV-034, F-DG2-320)

**Integration tests** (`media-types.test.ts`, 10 tests). Every response is asserted against the OpenAPI contract.

- **`uploadEvidenceContent` with an undeclared media type.** These bodies were tested:
  - `text/plain` with the round-8 ill-formed bytes `53 79 6e ff c3 0a ed a0 80 41`, with Content-Length and chunked;
  - `text/plain; charset=utf-8`, both framings;
  - `application/json` object `{"a":1}`, array `[1,2,3]` and string `"Synthetic"`, each with both framings;
  - form-urlencoded and multipart;
  - a body with no Content-Type, both framings.

  Every one gets exactly the 400 problem `validation.content_type`, and:
  - no `evidence_content` row is written;
  - no file (final or `.part`) is in the store; a positive control shows the helper does see a stored object;
  - the item's audit trail is unchanged and there is no audit row for the request;
  - the evidence version is unchanged and `currentContentId` stays null;
  - there is no error-level log line or `unhandled error`.
- **Precedence:** no session plus `text/plain` gets 400 `validation.content_type`. The control with `application/octet-stream` and no session gets 401.
- **Valid octet-stream:**
  - the same ill-formed bytes are stored exactly, in both framings: `sha256 = sha256(raw input)`, `size_bytes = 10`, and the download equals the input byte for byte;
  - `Application/Octet-Stream; charset=utf-8` is also stored byte for byte.
- **Size limit:** 25 MiB + 1 gets the declared 413 `evidence.too_large`. No row and no file.
- **JSON operations:**
  - `createEvidence` sent `text/plain`, `application/octet-stream` or `text/plain; charset=utf-8`, in both framings, gets 400, and no evidence is created;
  - `updateEvidence` (PATCH, If-Match) sent octet-stream gets 400, and the record is unchanged;
  - valid JSON, with and without `; charset=utf-8`, sent chunked, gets 201.
- **Bodiless requests:**
  - GET with `Content-Type: text/plain` and a body gets 200;
  - the upload with no body at all still gets the handler's own 400 `validation.body_required`;
  - `createEvidence` with Content-Type JSON and an empty body still gets 400 `validation.json`;
  - `logout` with no body, and with `{}`, still succeeds;
  - an unknown route sent `text/plain` still gets 404.

**Contract** (`contract.test.ts`, 2 new cases):

1. **Structural:** every routed operation's `consumes` equals its declared `requestBody.content`; operations with no request body keep the default JSON. Pinned: 87 bodies, of which 86 JSON and 1 octet-stream.
2. **Live:**
   - Every body-carrying operation (POST/PUT/PATCH/DELETE, 89 operations) is sent each undeclared type from `text/plain`, `text/plain; charset=utf-8`, `application/json` or `application/octet-stream` (whichever is not declared), `application/x-www-form-urlencoded`, `application/xml`, `multipart/form-data` and `application/merge-patch+json`, plus a body with no Content-Type.
   - Each answers the **declared** 400 `validation.content_type` with the operation's own detail. The validating client fails on any undeclared status, and nothing is written (no audit row).
   - Every GET operation (72) sent a Content-Type is never refused with `validation.content_type`.
   - The sweep covers all 161 operations.

**Unit tests** (`media-types.test.ts`, 10 tests): the cases listed in the changed-files table.

## Negative control (the new tests fail on the old code)

**Integration.** I made a disposable clone at `b15c598` (old `src`) and copied in only the new and changed test files: `media-types.test.ts`, `contract/media-types.ts` and `contract.test.ts`. I ran them against a disposable PostgreSQL 16 cluster. Log: `docs/delivery/handbacks/DG2/T-DG2-BE14-evidence/negative-control-integration.log`. Result: **6 failed | 22 passed (28)**.

The 6 failures are all of the F-DG2-320 assertions:

- the structural `consumes` check fails with `route.consumes is not iterable`; the old code has no set;
- the live sweep fails with `devLogin text/plain`: it was not refused;
- the upload's undeclared media types: not refused;
- precedence: the old code answered `validation.malformed_request`, not `content_type`;
- `createEvidence` with text/plain or octet-stream: not refused;
- the PATCH with octet-stream: not refused.

The controls pass on both old and new code: valid octet-stream bytes, the size limit, valid JSON, bodiless requests and the 404.

**Unit.** The new unit file imports `media-types.ts`, which does not exist at `b15c598`, so it cannot pass on the old code. I did not run it there as a separate log.

## Checks actually run

**Setup.** The matrix script is `docs/delivery/handbacks/DG2/T-DG2-BE14-evidence/matrix-commands.log`. Each check writes its own log in that directory, as `<mode>-NN-*.log`, and the summary is in `<mode>-00-summary.log`.

**Modes:**

- `nolocale`: `env -u LANG -u LC_ALL -u LC_* …`
- `cutf8`: the same, plus `LANG=C.UTF-8`

**Ports (all below 32768):**

| Mode | PostgreSQL (QA) | PostgreSQL (E2E) | API (E2E) |
|---|---|---|---|
| `nolocale` | 24351 | 24341 | 3601 |
| `cutf8` | 24361 | 24342 | 3602 |

**Run.** Node 24.21.0 is used everywhere except the Node 22 unit run, which uses 22.22.2. Both modes ran sequentially in a single job, from 19:52 to 20:09 UTC.

**Results:**

| # | Check | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: only the 12 sandbox-masked, untracked dotfiles fail with `EACCES` (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`); no other file is reported | same |
| 05 | `npx prettier --check . '!.bash_profile' … '!CLAUDE.local.md'` (the masked-dotfiles variant, as in BE13) | exit 0, "All matched files use Prettier code style!" | same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, Test Files 39 passed (39), Tests 701 passed (701) | same |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 39 / 701 passed | same |
| 09a | `tests/qa/support/with-pg.sh pnpm test:integration`, run 1 | exit 0, Test Files 34 passed (34), Tests 559 passed (559) | same |
| 09b | the same, run 2 | exit 0, 34 / 559 passed | same |
| 10 | `apps/web/e2e/support/with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (pre-installed Chromium, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) | exit 0, `58 passed (3.9m)` | exit 0, `58 passed (3.9m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | same |

**What the integration runs include.** Every 09a and 09b run includes:

- `contract/contract.test.ts` (18 tests);
- `invalid-utf8.test.ts` (14);
- `evidence.test.ts` (6);
- `media-types.test.ts` (10);
- `aud-write-deny.test.ts` (128);
- `kpi/kpi-aud-write-deny.test.ts` (18).

All of them passed.

**What the e2e runs include.** The evidence upload journey, "Evidence: note, filename reference and file upload; a link; review by another person", passed in both chromium-en and chromium-ar, in both modes.

**Earlier attempts (not evidence).** A first matrix attempt found two failures. Both are fixed above, and their logs were discarded:

- the ADR-0002 architecture test: my unit test imported `node:stream`, which is not allow-listed; it now uses a Buffer;
- the AUD sweep: it posted JSON to the upload operation.

A second attempt ran two matrix jobs at the same time. My `pkill` could not reach the first job across the sandbox's PID namespace. All its checks passed, but the logs were interleaved, so I deleted them all and reran the matrix once, cleanly and sequentially. The table above comes only from that clean run.

## Known gaps / not done

- **GET requests.** A GET request's body is never read (Fastify parses none), so a Content-Type there is ignored, not refused. This matches the "bodiless operations still behave as today" rule. The contract case asserts that GET is never refused, not that it gets a 400.
- **Bodiless POST operations.** `logout` and `activateKpiDefinition` declare no request body, but they keep accepting `application/json`. This preserves the empty-body rules and the web client's `{}`. If the contract should instead refuse any body on them, that is a contract decision for the orchestrator or architect.
- **The FST mapping message.** The detail of the old `FST_ERR_CTP_INVALID_MEDIA_TYPE` mapping in `hooks.ts` ("Send the request body as application/json.") is unchanged. It is now reached only if a route's set includes a type that has no parser, and the registration check prevents that.
- **Assignment count.** The "2 octet-stream operations" stated in the assignment does not match the contract, which has 1 (see the discrepancy section).
- **Findings.** I did not change `findings.json`. The orchestrator records `import-findings --fix`. F-DG2-320 must be verified by a non-author reviewer.

## Merge instructions

- No migrations, no contract change and no dependency change.
- Apply the working-tree changes listed above on top of `b15c598`.
- **Possible conflict:** any concurrent change to `aud-write-deny.test.ts`, or to the parser registration in `server.ts` or `evidence/routes.ts`.
- **For future routes:** any new non-JSON operation must declare `config: { consumes: [...] }`. The contract test fails otherwise.
