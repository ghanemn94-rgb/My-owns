# Handback T-DG5-BE-F (backend-workflow-engineer): procedure definitions and the `procedure` kind provider

- **Stage / gate:** P5 "Configuration automation and outputs", DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §C.1.
- **Invocation:** `DG5-T-DG5-BE-F-backend-workflow-engineer-20261014T133259Z-e9438a0b`, session `e9438a0b-8276-48da-b1ef-62265f922fba`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-F.md`, sha256 `a7e96ff7431a3bb1fd3e6c534ae653a9e2ecdf7dd0bfb7638d2f30c88e10c8a8` (verified).
- **Starting revision:** branch `dg5/be-f` at `81be9e6c969b338016695e383cef33960e87f1e9`, clean tree apart from the sandbox's device placeholders (`.bashrc`, `.mcp.json` and so on, which are not mine).
- **Time:** start `2026-10-14T13:33:18Z`, end `2026-10-14T15:15:49Z` (§8).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0. I ran it at the start and again at the end (§4).
- **Changes are uncommitted**, for the orchestrator to integrate.
- **Approvals:** no approval was granted. A procedure approval step only *names* the business role that decides through the canonical approval (ADR-0026). All test data is synthetic. Nothing reads or writes DG0–DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/procedures.ts` (new) | Zod mirrors of `ProcedureCode`, `ProcedureInputField`, `ProcedureStepDefinition(Input)`, `ProcedureDefinition(Input)`, `ProcedureDefinitionPage` and `ProcedureValidationReport`, plus the list/read queries. Also holds the exact ADR-0042 §10 definition texts (`PROCEDURE_DEFINITION_MESSAGES`), the condition-shape rule, and the pure decimal.js step-condition evaluator `evaluateStepCondition`, which BE-F2 can reuse for activation. |
| `packages/shared/src/schemas/index.ts` | One barrel line (`export * from "./procedures.ts"`). |
| `apps/api/src/modules/procedures/definitions.ts` (new) | The five operations, lineage-row resolution, builder validation (every finding), the ADR-0042 §1 hash rows, the audited row copy into a draft, and put/remove in a draft. |
| `apps/api/src/modules/procedures/provider.ts` (new) | The `procedure` `ConfigKindProvider`: diff rows, compatibility, affected active instances and preview. |
| `apps/api/src/modules/procedures/routes.ts` | Registers the provider and the definition routes. Leaves comment slots for BE-F2 and BE-G. |
| `apps/api/src/modules/procedures/definitions.test.ts` (new) | Unit tests: builder rules and §10 texts, and decimal conditions (a missing input is never defaulted). |
| `apps/api/test/integration/procedures/procedure-definitions.test.ts` (new) | Integration tests against real PostgreSQL: REQ-S06-001 literal, the §10 refusals, AUD/BO 403, `If-Match` 428/409, audit per row, commit-time authorization, lineage rows and hash invalidation. |
| `apps/api/test/support/procedures-fixtures.ts` (new) | A synthetic published `procedure` version under a unique key (a copy of the `0069` seed), and a synthetic definition body. |
| `apps/api/test/support/p5-pending-be-f.ts` | Emptied (5 → 0). |
| `apps/api/test/integration/contract/p5-exercises-be-f.ts` | Mirrors plus exercises for the five operations. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-F-evidence/*.log` | Logs of the checks in §4. |

No migration was written (§C.1 assigns none; `0069`/`0070` are the architect's). No dependency was added.

## 2. Endpoints added (OpenAPI tag `procedures`)

| Operation | Route | Permission | Notes |
|---|---|---|---|
| `listProcedureDefinitions` | `GET /api/v1/procedure-definitions?versionId&includeRemoved&cursor&limit` | `procedure.read` in the caller's organization | The default is the newest published `procedures` version. A version that is not published is Studio content: without `methodology.read` it returns 404. Ordered by ordinal, then code; cursor-paginated. |
| `validateProcedureDefinition` | `POST /api/v1/procedure-definitions/validate` | `methodology.configure` | Returns `{valid, findings[]}` with **every** finding (code, JSON pointer, exact §10 text). Nothing is written. |
| `getProcedureDefinition` | `GET /api/v1/procedure-definitions/{procedureCode}?versionId` | `procedure.read` | `ETag` is the definition row's version. A malformed code is 400 at `/params/procedureCode`. |
| `putProcedureDefinition` | `PUT /api/v1/admin/procedure-definitions/{versionId}/{procedureCode}` | `methodology.configure` (ADM_METHOD) | `If-Match` is the **draft's** version. The response `ETag` is the draft's new version, i.e. the next `If-Match`. Creates or replaces one definition with its steps. |
| `removeProcedureDefinition` | `POST /api/v1/admin/procedure-definitions/{versionId}/{procedureCode}/remove` | `methodology.configure` | `If-Match` is the draft's version. Marks an admin-authored definition `removed`. A seeded one is refused with 422 `procedure_definition.source_protected`. Returns the draft as `ConfigVersion`. |

Publishing, review, preview, compatibility, diff and rollback go through the unchanged slice A operations; there is no separate procedure publish operation (§C.1).

Every write does the following:
- re-checks authorization on grants reloaded inside the transaction (`refreshPrincipal`);
- validates the body with Zod (shape errors are 400);
- requires `If-Match` (428 missing, 409 stale);
- takes lock class `configDraft` on `procedure:<key>`, the same lock the slice A pipeline takes;
- refuses a non-editable version with 409 `config_version.not_editable`, using the exact slice A text;
- applies the §10 refusals first;
- writes one audit event per row, in the same transaction;
- does no remote I/O.

## 3. Behaviour delivered, per requirement row

### REQ-S06-001 (owner BE-F; completes with FE-D)

Acceptance text (`requirements.csv`): *"Define procedures with purpose, trigger, scope, prerequisites, inputs and input schema, ordered/conditional/parallel steps, responsible roles, SLA, validation rules, approval path, escalation path, expected outputs, completion conditions, exceptions and version/effective date"*. The §C.1 literal test: *"a definition with a conditional and a parallel step validates, is saved in a draft, previewed, reviewed (TO) and published, then launches (with BE-F2); a definition missing a trigger → 422 `procedure_definition.trigger_required`; missing a completion condition → 422 `procedure_definition.completion_required`; ADM_METHOD as a responsible role → 422 `procedure_definition.role_not_allowed`; removing a seeded procedure → 422 `procedure_definition.source_protected`; editing a published version → 409 `config_version.not_editable`; AUD 403; `If-Match` on the draft."*

What I delivered:
- **All M0152 parts** are accepted and returned, each in its own typed column (ADR-0042 §1): purpose, trigger, scope, prerequisites, input schema (the ADR-0041 §3 field types), ordered, conditional and parallel steps, responsible and launch roles, SLA, validation rules, approval path, escalation path, expected outputs, completion, exceptions, and version plus effective date.
- **Builder validation (ADR-0042 §1–§2)** returns every finding with its exact text:
  - trigger missing, or `event` without an event: `trigger_required`;
  - completion missing: `completion_required`;
  - no steps: `steps_required`;
  - an `ADM_*` or `AUD` role anywhere (launch, responsible, approval path, escalation, step responsible or approver): `role_not_allowed`;
  - steps sharing an ordinal without one shared group, or a group spanning two ordinals: `parallel_group_invalid`;
  - a condition on an undeclared input, a wrong value shape, or a numeric operator on a non-numeric input or a JSON float: `condition_invalid`;
  - a required input that isn't declared: `input_unknown`;
  - an input that fails its field-type settings (ADR-0041 §3), or `options` on a non-choice field: `input_schema_invalid`;
  - an approval step without an approver, a skippable approval step, a task step naming an approver, or an approval path whose mode and roles don't agree: `approval_step_invalid` (see §6.4);
  - a malformed code on a write: `code_invalid`.
- **Integration test results** (`procedure-definitions.test.ts`, real PostgreSQL):
  1. A definition with an ordered step, two parallel steps (group `reviews`) each with a condition, and a Sponsor approval step validates (`{valid: true, findings: []}`).
  2. It is saved in a draft: the ten base procedures and 31 steps are copied first, then the new definition and its 4 steps. One audit event per row; the draft history is `create_draft`, `procedure_put`.
  3. It is listed and read back with cursor pagination.
  4. Preview passes. The decimal condition `contractValue gte "1000000.00"` makes `finance_check` `not_applicable` for `999999.99`.
  5. The diff shows `procedure:` and `procedure_step:` additions, and the compatibility check passes.
  6. The draft is submitted for review, approved by **TO** (the configured reviewer), and published by ADM_METHOD.
  7. After publishing, a BO reads it as `published`.
  8. A put or remove on the published version returns 409 `config_version.not_editable`.
  9. A new draft of it holds all eleven procedures before any edit.
- **Refusal tests:**
  - missing trigger: 422 `trigger_required`;
  - missing completion: 422 `completion_required`, with the exact detail text;
  - ADM_METHOD as a responsible role: 422 `role_not_allowed`;
  - AUD as a step role: 422 `role_not_allowed`;
  - every other §10 code once each;
  - removing seeded `baseline_validation`: 422 `source_protected`, with the exact text;
  - a seeded definition stays **editable** (origin `source`, `productDefaults: true`);
  - AUD and BO get 403 on put, remove and validate;
  - `If-Match` missing gives 428, stale gives 409;
  - an unknown version, or a version of another kind, gives 404;
  - methodology.configure revoked while the request waits gives 403 and writes nothing (`afterIdentity`);
  - a step edit after preview returns the draft to `editing` with a new `contentSha256`, and the stored preview run no longer counts.
- **Not delivered here: "then launches (with BE-F2)".** The launch belongs to BE-F2 (`launchProcedureInstance`, not routed in this task). The published definition rows are launchable: published, not removed, and of the right scope. The 0069 `procedure_instance_launch` guard checks exactly those conditions.

### REQ-S16-015 (owner BE-G for the entity-group test; ProcedureDefinition create/read routed here)

Acceptance text (`requirements.csv`): *"Tables, migrations and API resources for TOMDimension, TOMCanvas, Capability, …"*, with the §C.3 literal *"create and read … ProcedureDefinition … through the API with authorization enforced (AUD 403, 404 outside scope)"*.

Here I route ProcedureDefinition **create** (`putProcedureDefinition` in a draft) and **read** (`getProcedureDefinition`/`list`), with AUD 403 on writes, tested. The entity-group test itself is BE-G's (`entity-group.test.ts`), so this row is **not complete** from this task alone.

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL 16.13 disposable clusters through `tests/qa/support/with-pg.sh`, on ports in 23900–23949. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-F-evidence/`.

| Check | Command | Exit | Result / counts | Log |
|---|---|---|---|---|
| Preceding gate (start) | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` | (start, 13:33Z; shown in the session) |
| Preceding gate (end) | same | 0 | `PASS gate DG4 (historical)` | `validate-dg4-historical.log` |
| Typecheck | `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| Build | `pnpm -r build` | 0 | clean | `build.log` |
| Lint | `pnpm lint` | 0 | 0 warnings | `lint.log` |
| Prettier | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| OpenAPI lint | `pnpm openapi:lint` | 0 | clean | `openapi-lint.log` |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node 101 files / 1839 tests passed; unit-web 71 / 1385 passed; unit-formula-nocodegen 3 files, 259 passed, 2 skipped | `test-locale-unset.log` |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts | `test-c-utf8.log` |
| Integration (final code) | `QA_PG_PORT=23920 MTH_PORT_POOL=23921-23949 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 220 files, 2155 tests: **2154 passed, 1 failed**. The one failure is the expected pinned count, `contract.test.ts` "every route accepts exactly the request media types its operation declares": `expected [ 345, 344, 1 ] to deeply equal [ 343, 342, 1 ]`, i.e. +2 JSON bodies from this task (§5). The orchestrator reconciles that pin (rule 14). Duration 2565 s. | `test-integration.log` |
| Integration (first run) | same, ports 23910–23949 | 1 | 2153 passed, 2 failed: the same pin, plus `studio-drafts.test.ts` "an unpinned kind resolves to version 1 of its default key". That second failure came from my provider registering `defaultKey: "procedures"`. I removed the registration (§6.5), and the final run passes that test. **This run is not final evidence**: I edited `provider.ts` and `definitions.ts` while it was running. | `test-integration-run1-mixed-code.log` |
| Earlier unit run (superseded) | `pnpm test`, locale unset | 1 | `architecture.test.ts` flagged 4 computed member accesses with non-literal keys in my files. Fixed with a Map lookup via `procedureDefinitionMessage`; the final runs above pass. | overwritten by `test-locale-unset.log` |
| Targeted runs during development | `with-pg.sh npx vitest run --project integration apps/api/test/integration/procedures/` | 0 | 8/8 passed | (session) |

The PostgreSQL clusters were disposable (`with-pg.sh`, PostgreSQL 16.13, UTF8, C locale, 77 migrations applied to a fresh database). No timeouts and no flaky retries were observed in the final runs.

## 5. Operations routed (pending-list delta)

- `apps/api/test/support/p5-pending-be-f.ts`: **5 → 0**. Moved out: `listProcedureDefinitions`, `validateProcedureDefinition`, `getProcedureDefinition`, `putProcedureDefinition`, `removeProcedureDefinition`.
- Each one is exercised in `p5-exercises-be-f.ts` through the validating client, with the mirrors listed in `P5_MIRRORS_BE_F`. Coverage per operation:

| Operation | Responses exercised |
|---|---|
| list | 200 ×2; 400; 403; 404 |
| validate | 200 valid; 200 invalid report; 400; 403 |
| put | 200; 428; 409; 403; 404; 400; 422 `trigger_required`; 422 `code_invalid`; 409 `not_editable` |
| get | 200 ×2; 400; 403; 404 |
| remove | 200; 428; 409; 403; 404; 400; 422 `source_protected`; 409 `not_editable` |

- **Pinned-count delta (for the orchestrator, rule 14):** `contract.test.ts` "every route accepts exactly the request media types its operation declares" now counts `[withBody, application/json, application/octet-stream]` = **`[345, 344, 1]`** against the pinned `[343, 342, 1]`. The +2 JSON bodies are `validateProcedureDefinition` and `putProcedureDefinition`; `removeProcedureDefinition` is a bodiless action POST with no `consumes`. No rate-limit-floor change was observed. This pin is the one expected failure of the contract file (see §4).

## 6. Contract, schema and seam needs (for the orchestrator)

1. **Slice A draft-copy and hash seam (main gap).**
   - **The rule.** ADR-0042 §1 says *"A new draft copies every definition and step row of its base version (… BE-F's provider does it in the draft-create transaction)"*, and the content hash covers those rows.
   - **The gap.** `methodology/drafts.ts` `createDraft`, `methodology/publish.ts` `rollbackVersion` and `methodology/content-hash.ts` only copy and hash `methodology_element` rows, and `ConfigKindProviderHooks` (`kinds.ts`) has no copy or hash hook. Those files are slice A's and frozen to me.
   - **How I kept the rule inside my ownership** (header of `definitions.ts`):
     - A `procedure` version with **no** procedure rows holds exactly its lineage source's content (`rollback_of_version_id`, else `based_on_version_id`). No version can legitimately have zero rows: seeded definitions cannot be deleted (`procedure_definition_source_kept`).
     - Reads resolve such a version to its source's rows.
     - The first procedure write into a draft copies every row (audited) before the edit.
     - My writes recompute the hash over methodology elements plus procedure rows.
     - Tested: a new draft and a published unedited draft both read the full set.
   - **Residual gap.**
     - `updateConfigDraft` (PATCH titles/definition), `createConfigDraft` and `rollbackConfigVersion` compute the hash **without** procedure rows. A title-only PATCH after a procedure edit therefore stores a hash that ignores the procedure rows. In a narrow sequence (preview run R at title T, then a procedure edit, then a PATCH back to the same T), the stored hash could equal R's again, and R would count as current although the procedures changed.
     - An unedited published draft has no rows of its own. BE-F2 must pin instances to the row that `loadDefinitions` resolves, whose `methodology_version_id` is the ancestor's. That ancestor is published, so the launch guard holds. **BE-F2 must know this.**
   - **Proposed fix (slice A owner):**
     - add `copyDraftRows(tx, {fromVersionId, toVersionId, actor, audit})` and `hashedElements(db, versionId)` to `ConfigKindProviderHooks`;
     - call `copyDraftRows` in `createDraft` and `rollbackVersion`, and append `hashedElements` in `loadHashedElements`;
     - my `materializeDraftRows` and `procedureElements` are already shaped for those two hooks.
2. **Methodology exports.** `methodology/index.ts` does not export `loadVersion`, `lockConfigDraft`, `requireStudioWrite`, `assertContentEditable`, `toConfigVersion`, `studioRefusals` or `loadHashedElements`, and the architecture test forbids deep imports. I therefore repeated minimal equivalents in `definitions.ts`: `requireOrgPermission`, the lock, `notEditable()` with the identical code and text, and `presentConfigVersion`. Proposal: export them from `methodology/index.ts` and delete my copies.
3. **`ConfigElementType`.** Diff and compatibility rows of this kind use `elementType` `procedure` / `procedure_step` (ADR-0042 §1). These are not in `CONFIG_ELEMENT_TYPES` (`studio.ts`, BE-A's), so `provider.ts` casts them. The OpenAPI `ConfigDiffEntry.elementType` is a string, so the wire contract holds. Proposal: a separate "provider row types" union in `studio.ts`.
4. **No code for an incomplete approval path.** Approval mode `none` with roles, or a mode other than `none` without roles (CHECK `procedure_definition_approval_complete`), has no §10 code. I used `procedure_definition.approval_step_invalid` ("An approval step needs a business approver role and cannot be skipped."). If the architect prefers a dedicated code, I propose `procedure_definition.approval_path_invalid`: "The approval path needs a mode and its approver roles together."
5. **Default key of `procedure`.** I do **not** register `defaultKey: "procedures"`, because BE-A's `studio-drafts.test.ts` pins "procedure has no resolvable version" and the three-kind pin list. As a result, `getConfigAffectedRecords` and compatibility list only transformations pinned to the procedures lineage (none today), so my `affectedRecords` hook (active instances per transformation, which stay pinned) never runs in practice. If the orchestrator wants ADR-0042's "affected instances" visible:
   - add `defaultKey: PROCEDURES_KEY` in `registerProceduresKindProvider`;
   - add a fourth `procedure` item to that test's expected list;
   - remove its `rejects.toThrow` line.
6. **Preview sample shape.** `{kind: "record", recordType: <procedure code>, input: {inputValues: {...}}}`. The report lists, per step, `applicable` or `not_applicable` and the missing required inputs. FE-D needs this.
7. **For BE-F2.** Use `evaluateStepCondition` (shared) and `loadDefinitions`/`rowsVersionIdOf` (procedures module) to launch and pin, as item 1 explains.

## 7. User-facing texts

- **Already correct:** the web `problems.json` (en/ar) already carries the `procedure_definition__*` keys with the §10 texts.
- **Checked, nothing untrue:** the nav texts for the procedure builder and definition screens describe the screens and don't call them planned.
- I found no en/ar string that this work makes untrue, so I changed no web file. The screens themselves are FE-D's.

## 8. What remains

- **REQ-S06-001, "then launches (with BE-F2)":** the launch half is BE-F2's (`launchProcedureInstance`). I wrote the instance-pinning guidance for BE-F2 in §6.1 and §6.7. FE-D's procedure builder completes the row.
- **REQ-S16-015:** BE-G's entity-group test. ProcedureDefinition create and read are routed and tested here.
- **Orchestrator decisions** (§6):
  - the slice A copy and hash seam (closes the residual stale-run window);
  - the methodology exports, then dedupe my local copies;
  - the `ConfigElementType` widening;
  - the incomplete-approval-path code;
  - whether `procedure` gets default key `procedures`.
- **Contract pin:** `contract.test.ts` media-type triple `[343, 342, 1]` → `[345, 344, 1]`.
- Nothing else in §C.1 is left undone.
- **End time:** `2026-10-14T15:15:49Z`. The full integration suite took about 43 minutes under load, which is what pushed past the ~100-minute mark. All items were finished before the final verification runs.
