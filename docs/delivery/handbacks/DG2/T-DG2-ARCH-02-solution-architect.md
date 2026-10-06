# Handback T-DG2-ARCH-02: contract declares every 400 the server can return (solution-architect)

- **Stage:** P2 / DG2 (FIXING). **Assignment:** `docs/delivery/assignments/DG2/round-6/T-DG2-ARCH-02.md` (sha256 `2f1ae242…6c1`, verified).
- **Base:** `HEAD` = `5d40a58` (BE10 `e057bf8` integrated). The tree was clean apart from sandbox-masked dotfiles and my run directory.
- **Invocation:** `DG2-T-DG2-ARCH-02-solution-architect-20261006T105633Z-7b9f308b`, session `7b9f308b-4a40-47d0-8ed0-645ab2cad07f`.
- **Scope:** an engineering contract and code change. It grants no business, Finance or IT approval and says nothing about product gates G1–G6.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/api/openapi.yaml` | Adds `"400": { $ref: "#/components/responses/ValidationError" }` to the 41 operations that lacked it (§2). Additive only: 41 inserted lines, nothing else changed, still 161 operations. |
| `apps/api/src/modules/transformations/register-kit.ts` | `paramsOf` validates the path parameters as one named strict object, so a malformed id reports `/params/<name>` (was `/params/`). |
| `apps/api/src/modules/kpi/support.ts` | `parseRecordParams` (the similar helper I found) now reports `/params/<name>`, for example `/params/kpiDefinitionId` (was `/params/id`). |
| `apps/api/test/integration/contract/malformed-input.ts` | **New.** Two sweeps: malformed path parameters on every GET operation with a path parameter, and U+0000 in the query on every operation. Also the U+0000 path-id case. |
| `apps/api/test/integration/contract/contract.test.ts` | Runs the new sweeps and adds the contract assertion "every operation except `completeOidcLogin` declares 400". The strict "every observed status is declared" check (`support/contract.ts`) is unchanged. |
| `apps/api/src/modules/admin/branding.test.ts` | Its exact-responses assertion for `getBrandingTokens` now expects `200, 400, 401`. A necessary consequence of the amendment (see §4). |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | New §5a amendment: "every operation that validates input declares 400", plus its scope, exception, pointer style and tests. |
| `docs/delivery/handbacks/DG2/T-DG2-ARCH-02-evidence/*.log`, `tree-pin.sha256` | Check logs, negative-control logs, and the hash pin of the changed files. |

## 2. Operations changed (41)

**Why the sweep went beyond path and query parameters.** The assignment's minimum was every operation with path parameters or validated query parameters. But the central request check (F-DG2-231, `preHandler` in `platform/hooks.ts`) refuses U+0000 in any body, query or path parameter **on every route**. So every operation can answer 400.

**Sweep result.**
- I swept all 161 operations. Before this change, 42 declared no 400.
- The only operation that never answers 400 is `completeOidcLogin` (`GET /api/v1/auth/callback`). It sets `config.invalidCharacters: "route"`, validates its own query and redirects (302) on every outcome. It stays without a 400, and a test pins that.
- The other 41 got the 400 response:
  - #5–#7, #11–#28 and #32, #35–#37, #39–#41 are the 33 GET operations with path parameters that the BE10 handback counted.
  - #29, #31, #33, #34 and #38 have only `transformationId` as a path parameter.
  - #1–#4, #8–#10 and #30 have no parameters at all. They answer 400 only through the U+0000 query check, which the new sweep proves.

| # | operationId | Method and path |
|---|---|---|
| 1 | `getHealth` | `GET /healthz` |
| 2 | `getReadiness` | `GET /readyz` |
| 3 | `logout` | `POST /api/v1/auth/logout` |
| 4 | `getMe` | `GET /api/v1/me` |
| 5 | `getOrganization` | `GET /api/v1/organizations/{organizationId}` |
| 6 | `getBusinessUnit` | `GET /api/v1/business-units/{businessUnitId}` |
| 7 | `getUser` | `GET /api/v1/users/{userId}` |
| 8 | `listRoles` | `GET /api/v1/roles` |
| 9 | `listPermissions` | `GET /api/v1/permissions` |
| 10 | `getBrandingTokens` | `GET /api/v1/branding/tokens` |
| 11 | `getRoleAssignment` | `GET /api/v1/role-assignments/{assignmentId}` |
| 12 | `getTransformation` | `GET /api/v1/transformations/{transformationId}` |
| 13 | `getStrategicGuardrail` | `GET /api/v1/transformations/{transformationId}/strategic-guardrails/{strategicGuardrailId}` |
| 14 | `getOutcome` | `GET /api/v1/transformations/{transformationId}/outcomes/{outcomeId}` |
| 15 | `getKpiDefinition` | `GET /api/v1/transformations/{transformationId}/kpi-definitions/{kpiDefinitionId}` |
| 16 | `getBaseline` | `GET /api/v1/transformations/{transformationId}/baselines/{baselineId}` |
| 17 | `getOutcomeKpi` | `GET /api/v1/transformations/{transformationId}/outcome-kpis/{outcomeKpiId}` |
| 18 | `getValuePool` | `GET /api/v1/transformations/{transformationId}/value-pools/{valuePoolId}` |
| 19 | `getDiagnosticItem` | `GET /api/v1/transformations/{transformationId}/diagnostic-items/{diagnosticItemId}` |
| 20 | `getDiagnosticFinding` | `GET /api/v1/transformations/{transformationId}/diagnostic-findings/{diagnosticFindingId}` |
| 21 | `getWorkstreamOutput` | `GET /api/v1/transformations/{transformationId}/workstream-outputs/{diagnosticWorkstreamOutputId}` |
| 22 | `getTomGap` | `GET /api/v1/transformations/{transformationId}/tom-gaps/{tomGapId}` |
| 23 | `getCapabilityHeatmapEntry` | `GET /api/v1/transformations/{transformationId}/capability-heatmap/{capabilityId}` |
| 24 | `getJourney` | `GET /api/v1/transformations/{transformationId}/journeys/{journeyId}` |
| 25 | `getDependency` | `GET /api/v1/transformations/{transformationId}/dependencies/{dependencyId}` |
| 26 | `getActionItem` | `GET /api/v1/transformations/{transformationId}/actions/{actionItemId}` |
| 27 | `getTomWorkshop` | `GET /api/v1/transformations/{transformationId}/tom-workshops/{workshopId}` |
| 28 | `getEvidence` | `GET /api/v1/transformations/{transformationId}/evidence/{evidenceId}` |
| 29 | `getTransformationMethodology` | `GET /api/v1/transformations/{transformationId}/methodology` |
| 30 | `listRoleAccountabilities` | `GET /api/v1/role-accountabilities` |
| 31 | `getCharter` | `GET /api/v1/transformations/{transformationId}/charter` |
| 32 | `getCharterVersion` | `GET /api/v1/transformations/{transformationId}/charter/versions/{versionNo}` |
| 33 | `getNorthStar` | `GET /api/v1/transformations/{transformationId}/north-star` |
| 34 | `getTomCanvas` | `GET /api/v1/transformations/{transformationId}/tom-canvas` |
| 35 | `getTomCanvasCell` | `GET /api/v1/transformations/{transformationId}/tom-canvas/{dimensionCode}` |
| 36 | `listTomWorkshopParticipants` | `GET /api/v1/transformations/{transformationId}/tom-workshops/{workshopId}/participants` |
| 37 | `getDecision` | `GET /api/v1/decisions/{decisionId}` |
| 38 | `listGates` | `GET /api/v1/transformations/{transformationId}/gates` |
| 39 | `getGate` | `GET /api/v1/transformations/{transformationId}/gates/{gateCode}` |
| 40 | `getGateSubmission` | `GET /api/v1/transformations/{transformationId}/gates/{gateCode}/submissions/{submissionNo}` |
| 41 | `downloadEvidenceContent` | `GET /api/v1/transformations/{transformationId}/evidence/{evidenceId}/content` |

The other 119 operations already declared 400. No schema, component, parameter or other response changed. The `ValidationError` component is reused unchanged. `pnpm openapi:lint` reports `161 operations`.

## 3. Behaviour delivered

1. **Contract (Required 1).** Every operation that can answer 400 now declares it. A contract test pins this: `the contract: every operation but the OIDC callback declares 400 (ADR-0007 §5a)`. The same test also requires that the callback does **not** declare 400.
2. **Pointer (Required 2).** Both shared path-parameter helpers now report `/params/<name>`:
   - register-kit `paramsOf` (was `/params/`);
   - kpi `parseRecordParams` (was `/params/id`).

   All other routes already parsed their path parameters as a named `z.strictObject`; I checked every `request.params` call site under `apps/api/src`. The helpers use `Object.fromEntries` and `Map`, with no computed-key syntax, because the module-boundary test (`architecture.test.ts`, ADR-0002) forbids non-literal computed members.
3. **Tests (Required 3).** In `contract.test.ts`, through the validating client:
   - **Malformed path parameters.** Every GET operation with a path parameter is called with `NOT-VALID` as its last parameter. That is 58 operations: the 33 from the BE10 handback plus 25 that already declared 400, among them every list under a transformation. The value fails the uuid, integer, gate-code and dimension-code rules. Each call must:
     - return 400, which must be declared, or the strict assertion throws;
     - have type `urn:mth:problem:validation`;
     - have exactly one error, at `/params/<last-param-name>`;
     - write no `audit_event` row for its request id.
   - **U+0000 in a path id.** `GET …/tom-gaps/abc%00def` returns 400, `code: validation`, with an error `{pointer: "/params/tomGapId", code: "validation.invalid_character"}` and no audit row.
   - **U+0000 in the query.** All 161 operations are called with `?probe=a%00b`:
     - 160 return a declared 400 `validation.invalid_character` at `/query/probe` with no audit row;
     - `completeOidcLogin` returns its declared 302.
4. **Docs (Required 4).** ADR-0007 §5a records the rule, the exception, the 41 amended operations, the pointer style and the tests.

## 4. Checks actually run

**How they ran.**
- Every check ran in both locale modes:
  - `nolocale`: `env -u LANG -u LC_ALL -u LC_CTYPE …`;
  - `cutf8`: `env -u LC_ALL … LANG=C.UTF-8`.
- The runs were sequential: nolocale from 11:14:26Z to 11:21:14Z, then cutf8 to 11:27:53Z. The exact command is line 2 of each log in `docs/delivery/handbacks/DG2/T-DG2-ARCH-02-evidence/`.
- Before the run I pinned the changed files in `tree-pin.sha256`. Afterwards `sha256sum -c` printed OK for all 7.
- Environment: Node 24.21.0, plus Node 22.22.2 for check 07; offline.

**Results.**

| # | Check | nolocale | cutf8 |
|---|---|---|---|
| 01 | `pnpm -r typecheck` | exit 0 | exit 0 |
| 02 | `pnpm -r build` | exit 0 | exit 0 |
| 03 | `pnpm lint` | exit 0 | exit 0 |
| 04 | `pnpm format:check` | **exit 2**: `All matched files use Prettier code style!`, but 12 `EACCES` on the sandbox-masked dotfiles | **exit 2**, same |
| 05 | `npx prettier --check . '!.bash_profile' … '!CLAUDE.local.md'` (the masked dotfiles excluded) | exit 0, `All matched files use Prettier code style!` | exit 0, same |
| 06 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 161 operations` | exit 0, same |
| 07 | `pnpm test` on Node 22.22.2 | exit 0, `Test Files 34 passed (34)`, `Tests 656 passed (656)` | exit 0, 34/34, 656/656 |
| 08 | `pnpm test` on Node 24.21.0 | exit 0, 34/34, 656/656 | exit 0, 34/34, 656/656 |
| 09 | `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` (PostgreSQL 16.13, UTF8, collate/ctype C) | exit 0, `Test Files 31 passed (31)`, `Tests 507 passed (507)` | exit 0, 31/31, 507/507 |
| 10 | `E2E_PG_PORT=55481/55482 E2E_API_PORT=3591/3592 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | exit 0, `Running 58 tests using 1 worker`, `58 passed (3.6m)` | exit 0, `58 passed (3.6m)` |
| 11 | `node tools/gates/validate.mjs --historical --stage DG1` | exit 0, `PASS gate DG1 (historical)` | exit 0, same |

**`contract.test.ts` in check 09 (both modes).** `✓ … contract.test.ts (14 tests)`, including:
- `✓ … every GET operation with a path parameter: a malformed id is a declared 400 at /params/<name>; nothing written`;
- `✓ … every operation but the OIDC callback: U+0000 in the query is a declared 400 invalid_character`.

There were 504 integration tests before and 507 now: the three new tests.

**Check 04.** It fails only because the sandbox masks the 12 dotfiles (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`). They are untracked and unreadable here (EACCES). Every readable file passes, and the `--ignore-path` variant (05) exits 0. I report check 04 as failed in this sandbox for that reason, not as passed.

**An earlier full run is not the evidence.** It found three unit failures, which I then fixed:
- `architecture.test.ts` and `kpi.test.ts` rejected my first helper version, which used computed keys;
- `branding.test.ts` pinned the `getBrandingTokens` responses to `[200, 401]`.

In that run, cutf8 e2e also failed with `psql: … port 55482 failed: Connection refused`. The e2e PostgreSQL never started, so no test ran. After the fixes I deleted every check log and reran everything from scratch. The table above is that second run only.

### Negative controls (the new cases fail on the old contract and code)

All three ran on Node 24.21.0 with `QA_PG_PORT=55471 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts`. Afterwards I restored the changed files and checked them against their sha256.

- **A: old contract** (`negative-control-A-old-contract.log`). `git show HEAD:docs/api/openapi.yaml` with the new code and tests gave exit 1, `Tests 3 failed | 11 passed (14)`:
  - `contract: getOrganization does not declare status 400 (declared: 200, 401, 404)`, with pointer `/params/organizationId` in the body;
  - `contract: getHealth does not declare status 400 (declared: 200)`;
  - the contract-rule test listed all 41 operations of §2 as undeclared.
- **B: old path-parameter helpers** (`negative-control-B-old-pointer.log`). HEAD's `register-kit.ts` and `kpi/support.ts` with the new contract gave exit 1, `1 failed | 13 passed`. The failure was `listStrategicGuardrails: the pointer names the parameter: expected [ '/params/' ] to deeply equal [ '/params/transformationId' ]`.
- **C: old KPI helper only** (`negative-control-C-old-kpi-pointer.log`) gave exit 1. The failure was `getKpiDefinition: … expected [ '/params/id' ] to deeply equal [ '/params/kpiDefinitionId' ]`.

## 5. Known gaps / not done

- **`branding.test.ts` is outside the files the assignment named.** Its exact-responses assertion encoded the old contract, and it would fail under the required contract change, so I updated it with one line and a comment. The orchestrator should confirm this is acceptable.
- **`pnpm format:check` (04) exits 2 in this sandbox**, because of the masked dotfiles only (see §4). The variant that excludes them passes.
- **Lint does not enforce the rule.** `pnpm openapi:lint` (`scripts/openapi-lint.mjs`) does not check that every operation declares 400. The contract test enforces it instead. Adding it to the lint script is optional and is not done.
- **Malformed ids are not swept on mutating operations.** The malformed-id sweep covers GET operations only, as assigned. Mutating operations with path parameters already declared 400; the U+0000 query sweep exercises them, but not with malformed ids.
- **Not changed:** migrations, `tools/**`, `.claude/**`, `docs/source/**`, reviews, gate records, the web app and the e2e specs.

## 6. Merge instructions

- No migrations and no new endpoints. The operation count stays 161.
- Commit:
  - the 6 modified files and the new `apps/api/test/integration/contract/malformed-input.ts`;
  - `docs/delivery/handbacks/DG2/T-DG2-ARCH-02-evidence/`;
  - this handback.
- **Contract change:** additive. 400 is newly declared on 41 operations, and runtime behaviour is unchanged.
- **Pointer change:** the pointer for a malformed register or KPI path id moves from `/params/` (or `/params/id`) to `/params/<name>`. No test or web code depended on the old pointers: I searched `apps/`, `tests/` and `e2e`, and the full suites pass.
- No conflicts expected.
