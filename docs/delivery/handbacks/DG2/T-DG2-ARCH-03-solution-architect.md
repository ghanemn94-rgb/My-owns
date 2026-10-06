# Handback T-DG2-ARCH-03 (solution-architect): the contract declares every status the platform layer can return

- **Stage:** P2 / DG2 (FIXING). **Base:** `d834bde` (includes BE13 `d9c3f5d` and DEVOPS3 `4e3c446`). Working tree verified with `git rev-parse HEAD` / `git status` before writing.
- **Invocation:** `DG2-T-DG2-ARCH-03-solution-architect-20261006T165840Z-eb94396a`, session `eb94396a-cb18-4398-a6c0-3aa56c35f89e`.
- **Assignment:** `docs/delivery/assignments/DG2/round-8/T-DG2-ARCH-03.md` (sha256 `72ea75ed…4dae00`, verified).
- **Not changed:** product behaviour (`apps/api/src/**` except one unit test), migrations, `tools/**`, `.claude/**`, `docs/source/**`, reviews and gate records. No new operation, schema or response component.
- G1–G6 are product business approvals and are unrelated to DG0–DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | `"429": { $ref: "#/components/responses/RateLimited" }` added to the 158 operations that lacked it. A rate-limiting paragraph in `info.description`, and the `RateLimited` description now says it is declared on every operation. Additive only; still 161 operations |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | New **§5b**: the platform-status rule and its derivation table, the 429 key and exemption details, the out-of-contract-by-design rule (D-067: 500, 408, unmatched-route 404), the amended operations and the tests. Corrects §7's "keyed by session ID" |
| `apps/api/test/integration/contract/platform-statuses.ts` (new) | `platformStatuses` / `undeclaredPlatformStatuses` (the rule) and `exerciseRateLimitSweep` (the live 429 sweep over all 161 operations) |
| `apps/api/test/integration/contract/contract.test.ts` | Two new tests: the rule test and the live sweep. Header comment item 4 |
| `apps/api/test/integration/invalid-utf8.test.ts` | BE13's rate-limit test: the contract assertion is re-enabled for the 429 (`contract: false` removed, with a comment) |
| `apps/api/test/integration/platform.test.ts` | "limits general API traffic per session": the same re-enablement for its `getMe` 429 (it also skipped the contract for this reason; with a comment) |
| `apps/api/src/modules/admin/branding.test.ts` | Unit test that pinned `getBrandingTokens`' exact status keys of the old contract `[200,400,401]`; now `[200,400,401,429]`, with a comment (a test that encodes the old contract; permitted by the assignment) |
| `docs/delivery/handbacks/DG2/T-DG2-ARCH-03-evidence/*.log` | Check logs, negative controls, the contract analysis |

## 2. Platform statuses found (Required 1)

Read from `apps/api/src/server.ts`, `modules/platform/{hooks,http,framework-errors}.ts` and `modules/identity/routes.ts`:

| Status | Platform source | Applies to | Before | After |
|---|---|---|---|---|
| 429 | `@fastify/rate-limit`, `global: true`, `onRequest` (before authentication) | every operation | 3/161 declared | **161/161** |
| 401 | identity `preValidation`: no resolved session | every route not `{ public: true }` (156) | all declared | unchanged |
| 403 | identity `preValidation`: Origin / `X-CSRF-Token` on POST/PUT/PATCH/DELETE | every non-public unsafe operation | all declared | unchanged |
| 400 | central request check, parsers, `frameworkErrors` (ARCH-02 §5a) | all but `completeOidcLogin` | all declared (re-confirmed) | unchanged |
| 428 / 409 | If-Match prologue (`platform/http.ts`), stale version | the 58 operations that take `IfMatch` | all declared | unchanged |

The access check does **not** produce a platform 403 on reads. `config.access.permission` is enforced in handlers through the policy function (and the fail-closed `onSend` guard, which gives 500). A read the caller may not see is 404 (ADR-0006). So the platform 403 is the CSRF/Origin check on unsafe methods only.

**Limiter details (ADR-0007 §5b):**
- **Key.** `u:<userId>` for a session the identity hook has resolved; anything else (no cookie, forged, expired or revoked) is `ip:<client IP>` (F-DG1-142). The three auth routes have their own per-route limit keyed by IP.
- **Exemption.** `allowList: request.url === "/healthz" || request.url === "/readyz"` compares the **raw request URL**, query included. The live sweep confirms that the bare health URLs stay 200 with the bucket spent, while `/healthz?probe=1` and `/readyz?probe=1` answer 429. So `getHealth` and `getReadiness` declare 429 too (see §6, observation 1).

### Operations changed (158, each gained only `"429"`)

All 161 except `startOidcLogin`, `completeOidcLogin` and `devLogin`, which already declared 429. Per-operation method/path table: `T-DG2-ARCH-03-evidence/contract-status-analysis.log`.

`getHealth`, `getReadiness`, `logout`, `getMe`, `updateMyPreferences`, `listOrganizations`, `createOrganization`, `getOrganization`, `updateOrganization`, `listBusinessUnits`, `createBusinessUnit`, `getBusinessUnit`, `updateBusinessUnit`, `listUsers`, `createUser`, `getUser`, `updateUser`, `listRoles`, `listPermissions`, `getBrandingTokens`, `listRoleAssignments`, `createRoleAssignment`, `getRoleAssignment`, `revokeRoleAssignment`, `listTransformations`, `createTransformation`, `getTransformation`, `updateTransformation`, `archiveTransformation`, `listTransformationAudit`, `listStrategicGuardrails`, `createStrategicGuardrail`, `getStrategicGuardrail`, `updateStrategicGuardrail`, `archiveStrategicGuardrail`, `listOutcomes`, `createOutcome`, `getOutcome`, `updateOutcome`, `archiveOutcome`, `listKpiDefinitions`, `createKpiDefinition`, `getKpiDefinition`, `updateKpiDefinition`, `archiveKpiDefinition`, `activateKpiDefinition`, `listBaselines`, `createBaseline`, `getBaseline`, `updateBaseline`, `archiveBaseline`, `listOutcomeKpis`, `createOutcomeKpi`, `getOutcomeKpi`, `updateOutcomeKpi`, `archiveOutcomeKpi`, `listValuePools`, `createValuePool`, `getValuePool`, `updateValuePool`, `archiveValuePool`, `listDiagnosticItems`, `createDiagnosticItem`, `getDiagnosticItem`, `updateDiagnosticItem`, `archiveDiagnosticItem`, `listDiagnosticFindings`, `createDiagnosticFinding`, `getDiagnosticFinding`, `updateDiagnosticFinding`, `archiveDiagnosticFinding`, `listWorkstreamOutputs`, `createWorkstreamOutput`, `getWorkstreamOutput`, `updateWorkstreamOutput`, `archiveWorkstreamOutput`, `listTomGaps`, `createTomGap`, `getTomGap`, `updateTomGap`, `archiveTomGap`, `listCapabilityHeatmapEntries`, `createCapabilityHeatmapEntry`, `getCapabilityHeatmapEntry`, `updateCapabilityHeatmapEntry`, `archiveCapabilityHeatmapEntry`, `listJourneies`, `createJourney`, `getJourney`, `updateJourney`, `archiveJourney`, `listDependencies`, `createDependency`, `getDependency`, `updateDependency`, `archiveDependency`, `listActionItems`, `createActionItem`, `getActionItem`, `updateActionItem`, `listTomWorkshops`, `createTomWorkshop`, `getTomWorkshop`, `updateTomWorkshop`, `listEvidence`, `createEvidence`, `getEvidence`, `updateEvidence`, `archiveEvidence`, `getTransformationMethodology`, `updateTomDimensionLabels`, `listRoleAccountabilities`, `getCharter`, `createCharter`, `updateCharter`, `listCharterVersions`, `getCharterVersion`, `getNorthStar`, `setNorthStar`, `listNorthStarHistory`, `validateBaseline`, `validateValuePool`, `approveOutcomeKpiTrajectory`, `getTomCanvas`, `getTomCanvasCell`, `updateTomCanvasCell`, `listJourneyPainPoints`, `createJourneyPainPoint`, `updateJourneyPainPoint`, `archiveJourneyPainPoint`, `listTomWorkshopParticipants`, `addTomWorkshopParticipant`, `removeTomWorkshopParticipant`, `listTomWorkshopItems`, `createTomWorkshopItem`, `convertTomWorkshopItem`, `listDecisions`, `createDecision`, `getDecision`, `updateDecision`, `addDecisionOption`, `updateDecisionOption`, `decideDecision`, `listGates`, `getGate`, `configureGateApprover`, `listGateSubmissions`, `submitGate`, `getGateSubmission`, `decideGate`, `downloadEvidenceContent`, `uploadEvidenceContent`, `reviewEvidence`, `listEvidenceLinks`, `createEvidenceLink`, `removeEvidenceLink`, `listTransformationTeam`, `assignTransformationTeamRole`

## 3. Out of scope by design (Required 2)

ADR-0007 §5b records, next to §5a, that these are not declared on any operation (D-067):
- **500 `internal`**: a failure, never a contract response;
- **408**: a transport-level request timeout written before routing;
- **404 for an unmatched route**, including the dev-login/OIDC routes in a mode where they are not registered.

It also notes that the other pre-routing answers (Node `clientError` malformed request / oversized headers, `FST_ERR_BAD_URL`) are 400 `ValidationError` problems written before an operation is matched (see §6, observation 2).

## 4. Rule test, live sweep and re-enabled assertions (Required 3)

- **Rule test** (`contract.test.ts` → "the contract: every operation declares each platform status derived from its route (ADR-0007 §5b)"). For every operation it derives the platform statuses from the route's declared access (from `api.routes`; contract `security: []` only as the fallback for an unrouted operation), its method, the contract's `IfMatch` parameter and the limiter. It fails with `<operationId> <status>` for each undeclared one. It also pins the derivation on `getHealth` [400,429], `completeOidcLogin` [429], `getMe` [400,401,429], `createCharter` [400,401,403,429] and `updateTransformation` [400,401,403,409,428,429], and the public set (5 operations).
- **Live sweep** ("every operation: the rate limiter's 429 is a declared RateLimited problem"). An API with `RATE_LIMIT_PER_MINUTE=1` and `AUTH_RATE_LIMIT_PER_MINUTE=1` (with the fake IdP) calls each of the 161 operations twice. The second answer must be 429 `rate_limited` with `Retry-After`, asserted against the contract by the validating client. Afterwards it checks that the bare `/healthz` and `/readyz` stay 200.
- **Re-enabled:** BE13's `invalid-utf8.test.ts` rate-limit test (`[400,400,400,429,429]` on `createCharter`) and `platform.test.ts`' `getMe` 429 now assert against the contract.

## 5. Negative controls (Required 4)

- **`negative-control-old-contract.log`**: `docs/api/openapi.yaml` restored to HEAD (`git show HEAD:… >`), new tests, then the new contract restored. Result: **exit 1, 4 failed | 38 passed**:
  - rule test: `expected [ 'getHealth 429', …(157) ] to deeply equal []` (158 undeclared);
  - live sweep: `contract: getHealth does not declare status 429 (declared: 200, 400)`;
  - invalid-utf8 rate-limit: `createCharter does not declare status 429`;
  - platform rate-limit: `getMe does not declare status 429`.
- **`negative-control-mutated-statuses.log`**: the new contract with one 401 (`getMe`), 403 (`createCharter`), 428 (`updateTransformation`) and 409 (`updateOrganization`) removed. Rule test **exit 1**, listing exactly `getMe 401`, `updateOrganization 409`, `updateTransformation 428`, `createCharter 403`. This shows the rule checks more than 429.

## 6. Checks actually run

Script: `matrix-commands.log` (BE13's matrix with ports below 32768: QA PG 25471, e2e PG 25491/25492, API 13601/13602). Node 24.21.0 (Node 22.22.2 for 07). PostgreSQL 16.13 disposable clusters (UTF8). Pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Each mode ran sequentially and alone: **nolocale** (`env -u LANG -u LC_ALL -u LC_*`) 17:11:54–17:19:36Z, **cutf8** (`LANG=C.UTF-8`) 17:19:36–17:27:19Z. Each log holds its command, the environment line and the exit status.

| # | Command | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | exit 2: only the 12 `EACCES` sandbox-masked dotfiles (`.bash_profile` … `CLAUDE.local.md`), 0 `[warn]`; "All matched files use Prettier code style!" | the same: exit 2, 12 `EACCES` only, 0 `[warn]` |
| 05 | `npx prettier --check . !.bash_profile … !CLAUDE.local.md` | exit 0 | exit 0 |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` (Node 22.22.2) | exit 0, `Test Files 38 passed (38)`, `Tests 691 passed (691)` | exit 0, 38/38, 691/691 |
| 08 | `pnpm test` (Node 24.21.0) | exit 0, 38/38, 691/691 | exit 0, 38/38, 691/691 |
| 09a | `QA_PG_PORT=25471 tests/qa/support/with-pg.sh pnpm test:integration` | exit 0, `Test Files 33 passed (33)`, `Tests 547 passed (547)` | exit 0, 33/33, 547/547 |
| 09b | the same (run 2) | exit 0, 33/33, 547/547 | exit 0, 33/33, 547/547 |
| 10 | `with-stack.sh npx playwright test journeys.spec.ts p2-journeys.spec.ts p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `58 passed (3.6m)` | exit 0, `58 passed (3.6m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

In all four integration runs `contract.test.ts` (16 tests, was 14), `invalid-utf8.test.ts` (14) and `platform.test.ts` (12) pass. Integration is 547 (BE13: 545, plus the 2 new contract tests).

**Superseded runs, kept for honesty and not counted:**
- **`superseded-matrix-1/`**: the first matrix, nolocale only. Unit 07/08 failed (690/691) on `branding.test.ts`, which pinned the old status keys of `getBrandingTokens`. I fixed that test (§1) and stopped the matrix.
- **`superseded-matrix-2-overlapped/`**: my `pkill` could not reach the first background matrix (each sandboxed command has its own PID namespace; the pkill ended only my own shell). The first matrix kept running while the second started, so the two overlapped. In the overlap, one e2e test timed out (`p2-blank-text.spec.ts:113`, chromium-en, `locator.click` 30 s; 52 passed, 1 failed), most likely because the second run's `pnpm -r build` rebuilt the bundle under it. I stopped both by truncating the shared script and ran the counted matrix alone from a fresh copy. In the counted runs that spec passed in both locales.

## 7. Known gaps and observations

1. **Health exemption compares the raw URL (product, outside my write scope).** `allowList` uses `request.url`, so `/healthz?x` is rate-limited although bare `/healthz` is not. The contract now declares 429 on both health operations, so there is no drift. If the orchestrator wants health fully exempt, comparing `request.routeOptions.url` in `server.ts` is a backend change. The 429 could then be removed from the health operations only through a reopened contract, and the rule test would need its derivation updated. I recommend tracking this as a Low item.
2. **Pre-routing 400 on the OIDC callback URL.** Node's `clientError` answers an oversized request line or headers with 400 `validation.headers_too_large` before any route matches. That can also happen for a URL whose path is `/api/v1/auth/callback`, which declares no 400 (§5a exception). ADR-0007 §5b classes these answers as pre-routing (not an operation response), like 408. If the orchestrator prefers to declare them, the alternative is a 400 on `completeOidcLogin`. That would reverse ARCH-02's exception, so it is the orchestrator's decision. No test covers that combination today.
3. **`pnpm openapi:lint` does not enforce 429/401/403.** `scripts/openapi-lint.mjs` checks only 409/428 on If-Match. The contract rule test enforces the rest. I did not change the lint script, which the assignment did not list.
4. Every check in §6 ran. None is BLOCKED.

## 8. Merge instructions

- No migrations and no runtime change. Merge order is free; the change is additive within v1 (`info.version` unchanged).
- Expect conflicts only in `docs/api/openapi.yaml` response blocks if another branch edits the same operations. Re-run `pnpm openapi:lint` and `contract.test.ts` after any merge.
- A new operation must declare its platform statuses (including 429) from the start, or the rule test fails.
