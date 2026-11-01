# Handback T-DG6-BE-Y1 (backend-workflow-engineer): sensitive records in audit and form-record routes

- **Stage:** DG6 (P6), FIXING after review round 1. **Task:** T-DG6-BE-Y1. **Findings:** F-DG6-121, F-DG6-122, F-DG6-123 (High, mandatory; REQ-S10-002).
- **Invocation:** `DG6-T-DG6-BE-Y1-backend-workflow-engineer-20261101T210453Z-1e447a32` (session `1e447a32-86a0-4239-9c53-29fe2b9334ad`).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Y1.md` (sha256 `4c976886…6b32fa`, verified).
- **Base:** branch `dg6/be-y1` at `eb75a6aa6fe99b7064712e926ddb384a6e7a137a`. The changes are **uncommitted**, as the assignment asks.
- **Time:** started 21:07:35 UTC (`date -u`); last `date -u` 23:19:51 UTC (about 2 h 12 min; past the 2-hour limit while the final unit runs finished).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exit 0 (`PASS gate DG5 (historical)`), run before implementation and again at the end (see Checks).

No product gate (G1–G6) and no engineering gate (DG0–DG7) is affected. Marking a record or granting access is an access decision, never a business approval. All test data is synthetic.

## The rule and the one helper

The rule: a user who gets 404 on a sensitive record must not learn its content, or its children's, through any other route (ADR-0051 §2).

The single helper is **`apps/api/src/modules/access/sensitive-reach.ts`** (new; re-exported from `access/index.ts`). Every touched route calls it; there are no per-route copies.

| Export | What it does |
|---|---|
| `SENSITIVE_CHILD_SOURCES` | A closed map, from the FK sweep of migrations 0012, 0023, 0037, 0038, 0041, 0048, 0068, 0085 and 0098. It maps each record type (audit `record_type` = table) that carries a sensitive record's values to its owner column(s): `benefit_measurement`, `benefit_plan_value`, `benefit_scenario_value`, `benefit_allocation`, `benefit_lifecycle_event`, `benefit_enabler`, `finance_validation`, `corrective_case`, `transition_decision`, `performance_area_link`, `benefit_overlap` (two owners), `benefit_evidence` (benefit + evidence) → benefit; `business_case_line`, `benefit_scenario`, `financial_cash_flow_set` → business case; `evidence_link`, `evidence_content` → evidence. Polymorphic (`record_type`, `record_id`) pairs: `record_sensitivity`, `sensitive_record_grant`, and the form sub-resources `form_record_comment`, `form_custom_value`, `form_draft`, `form_record_attachment` (plus its evidence). Form codes are resolved through the read-only `form_record_type` registry (T14 → benefit), never hard-coded. |
| `restrictedRecordRefs(db, principal, refs)` | Returns the refs whose sensitive owner (the record itself for the three sensitive types) is marked sensitive and not admitted by the §2 clause. It reuses `sensitivityClauseAdmits`, `activeGrantKeys` and `loadSensitiveRecords`, so the decision is the one the record GET makes. When nothing in the caller's organizations is marked, it answers the empty set after one query, so DG1–DG5 responses are unchanged. **Fail-closed:** a child row that no longer exists is resolved from the event's `changes.<owner column>`; if still unresolved, it counts as restricted when any marked record of that owner type is not admitted. |
| `requireRecordReach` | The 404 form for one record, with the denial attached. |
| `withoutRestricted` | The list form: the row is absent. |
| `registerSensitiveReachGuard(app, db)` | A `preHandler` registered in `server.ts` before every business route. A route whose **path parameter** names a value child of a sensitive record answers 404 `not_found` before its handler runs, for reads and writes alike. The parameters are a closed map, `SENSITIVE_REACH_PARAMS`: `benefitMeasurementId`, `benefitPlanValueId`, `benefitScenarioId`, `benefitScenarioValueId`, `benefitOverlapId`, `financeValidationId`, `lineId` (only under `/business-cases/`). Any future child item route is covered by naming its parameter here. Public and unauthenticated requests are not touched. The parents' own parameters (`benefitId`, `businessCaseId`, `evidenceId`) and the evidence links are deliberately **not** in the map. Their routes already apply §2 (404) and §4: the evidence download, preview and links answer the declared 403 `evidence.parent_forbidden`, and a blanket 404 would override it. A first version that included them broke the contract exercises `p6-exercises-be-x1.ts` and `p6-exercises-be-d.ts` (403 → 404), which is how I found this; see Checks. |

## Per finding: cause, fix, test, result

### F-DG6-121: `GET /api/v1/transformations/{id}/audit` applied no sensitivity rule

- **Cause:** the route (`transformations/routes.ts`) returned `listTransformationAudit` as is. Nothing consulted `record_sensitivity`.
- **Fix:** the route now passes the page through `restrictedRecordRefs`. Events of a sensitive record the caller is not admitted to, **and of every record that carries its values** (the map above), keep actor, action, time, record id and versions, with `changes` and `reason` null. This is the same redaction as `/audit-events`. The contract already allows both to be null (`AuditEvent.reason`, `AuditEvent.changes`), so the contract is unchanged.
- **Test:** `apps/api/test/integration/access/sensitive-reach.test.ts`, cases "F-DG6-121: … redacts … for TL and AUD" and "F-DG6-121 positive". It covers the benefit's own events, the measurement (amount 987654.32), plan values, the `record_sensitivity.marked` event and the form-comment events, for TL and AUD. Plain records stay unredacted. The serialized trail must not contain `987654`. TO reads the values. BO is refused (403, no `audit.read`).
- **Result:** FAILS before the fix and PASSES after (logs `02-…BEFORE-fix.log` and `01-…AFTER-fix.log`). It PASSES again on the final code in the targeted run (`24-integration-targeted-final2.log`).

### F-DG6-122: `/api/v1/audit-events` redacted only events whose own record is sensitive

- **Cause:** `server.ts` wired `restrictedRecords` to the interim `sensitiveRecordsRedactedForEveryone`, which looked up `record_sensitivity` by the event's own `record_id` only. Child events (measurement, line, link) were never redacted. The interim also over-redacted for admitted callers.
- **Fix:** `restrictedRecords: (request, refs) => restrictedRecordRefs(db, principalOf(request), refs)`. `AuditRecordRef` gained an optional `changes`, so the fail-closed owner lookup can read it. The interim function is deleted, and the comment in `audit/routes.ts` is updated. Grantees, named parties and `sensitive_record.grant` holders now read unredacted, as ADR-0051 §2 says.
- **Test:** case "F-DG6-122". For AUD without a grant: the sensitive benefit's measurement event is `[redacted: true, changes: null, reason: null]`; the sensitive case's `business_case_line` events are redacted; `GET /audit-events/{id}` is redacted; the flag's `record_sensitivity.marked` event is redacted. The plain benefit's measurement is not redacted. The positive is case "AUD with grants on the benefit and the case reads their child events unredacted". TO holds no `audit_event.read` (0100), so AUD with a grant is this route's positive.
- **Result:** FAILS before and PASSES after.

### F-DG6-123: the P5 form-record routes of a sensitive T14 benefit ignored sensitivity

- **Cause:** `forms/history.ts` `requireRecordRead`, the shared read gate of versions, comments and attachments, checked only `transformation.read` and existence. The writes (`createComment`, attach, remove, custom values, bulk) checked only existence. `compare.ts` had its own inline copy of the rule.
- **Fix:** one gate in `forms/record-types.ts`, `requireRecordVisible` / `recordVisible`, which runs `recordExists` and then `requireRecordReach`. It is used by:
  - the shared read gate (versions, comments list, attachments list);
  - `compare.ts`, whose inline copy is removed;
  - the comment write, attach and remove;
  - the custom-fields GET and PUT;
  - the bulk edit (per record, before its version is disclosed in a 409);
  - the reference checks of custom values and bulk (a hidden record is an unknown reference, `validation.reference`);
  - draft create on an existing record (404 only when restricted; the existence behaviour is unchanged).

  Two related leaks are closed in the same files. An attachment row of a sensitive **evidence** item (its title) is absent from the attachments list, and attaching such an evidence item answers `form_attachment.evidence_unknown`. The T14 export (`GET …/form-records/T14/export`) leaves out the restricted records.
- **Test:** cases "F-DG6-123", "F-DG6-123 write" and "sweep". TL and AUD get 404 `not_found` on versions, comments, attachments, custom-fields and compare. TO and the owner get 200 and read the restricted comment. TL's `POST …/comments` is 404 and the `form_record_comment` count is unchanged. TL may still comment on the plain benefit (201). With a grant, TL reads and comments (201); after the revocation it gets 404 again on the next request.
- **Result:** FAILS before and PASSES after.

### Independent confirmation with the reviewer's own reproductions

`zz-cs-r1-audit-sensitivity.test.ts` and `zz-cs-r1-form-record-sensitivity.test.ts` were copied into `tests/qa/integration/` temporarily, run, and removed (log `03-reviewer-repros-after-fix.log`). Both assert the leak, so on the fixed tree they now fail at exactly the leak assertions:

- audit: "unredacted: 0", with "events of the sensitive benefit: 6 with changes: 0";
- forms: `expected 404 to be 200` on the TL's versions read.

## Route sweep (routes checked)

I swept the route inventory for every path that reads or writes a sensitive record's children: grep of `selectFrom(<child table>)` and of the `:…Id` path parameters across `apps/api/src/modules/**`.

| Route(s) | State before | Now |
|---|---|---|
| `GET /transformations/{t}/audit` | leak (F-121) | redacted (helper) |
| `GET /audit-events`, `GET /audit-events/{id}` | children leak (F-122) | redacted (helper) |
| `…/form-records/{type}/{id}/versions`, `/compare`, `/comments` (GET, POST), `/attachments` (GET, POST, `/{a}/remove`), `/custom-fields` (GET, PUT), `…/form-records/{type}/bulk`, `…/form-drafts` (POST), `…/form-records/{type}/export` | leak (F-123) | 404 / absent (helper) |
| `…/benefit-measurements/{id}` (GET, PATCH, `/submit`), `…/benefit-plan-values/{id}` (GET, PATCH) | **leak** (no sensitivity check on the item routes) | 404 via the guard; tested for GET |
| `…/benefit-scenarios/{id}`, `…/benefit-scenario-values/{id}`, `…/benefit-overlaps/{id}`, `…/finance-validations/{id}` (+ `/decision`), `/business-cases/{c}/lines/{lineId}` (PATCH, archive) | item routes without a sensitivity check | 404 via the guard (not individually tested) |
| `…/evidence-links` (GET, POST), `…/evidence-links/{linkId}/remove` | evidence module, ADR-0051 §4 | unchanged (owned by the §4 rules; not in the guard map) |
| `…/finance-validations` (list), `…/benefit-overlaps` (list), `…/benefit-scenarios` (list) | **leak** (transformation-level lists of child rows) | restricted rows absent (`withoutRestricted`); the finance-validations list is tested |
| `…/benefits/{b}/*` (values, lifecycle, enablers, allocations, measurements, plan values), `/business-cases/{c}` (+ `/lines`, financial metrics), `…/evidence/{e}` (+ download, preview) | already 404 (BE-B2 `readBenefitRow` / `requireSensitiveRead`; ADR-0051 §4 `requireEvidenceRead`) | unchanged; the guard also applies (same answer). Case lines are tested: AUD 404, TL (creator) and TO 200 |
| search, assistant retrieval, report/export selection, notification deep links | already ReadScope / `includesRestrictedSources` / `deepLinkTarget` (BE-B, BE-B2, BE-C) | unchanged |
| `/transformations/{t}/records/{type}/{id}/sensitivity`, `/admin/sensitive-grants/**` | management routes (TO, ADM_ACCESS) | unchanged (their parameters are not in the guard's map, by design) |

## Behaviour delivered per requirement row

- **REQ-S10-002.** Acceptance: *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*. A sensitive benefit is now hidden from a TL/AUD without the grant on every route that reaches it or its children, listed above. The owner (named party), TO (`sensitive_record.grant`) and grantees are admitted. Admission ends on the next request after a revocation.
- **REQ-S10-004** (touched, not assigned). Acceptance: *"One authorization layer is applied to every read path …"*. The audit, form and child-list reads now use the same §2 clause as record views, through one helper.

## Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts` (new) | The one helper: child map, `restrictedRecordRefs`, `requireRecordReach`, `withoutRestricted`, the path-parameter guard. |
| `apps/api/src/modules/access/index.ts` | Re-exports the helper. |
| `apps/api/src/server.ts` | Registers the guard before the business routes; wires `/audit-events` `restrictedRecords` to the helper (removes the interim). |
| `apps/api/src/modules/audit/routes.ts`, `audit/index.ts` | Removes `sensitiveRecordsRedactedForEveryone`; adds `AuditRecordRef.changes`; comment. |
| `apps/api/src/modules/transformations/routes.ts` | F-121 redaction on the per-transformation audit trail. |
| `apps/api/src/modules/forms/record-types.ts` | `recordVisible` / `requireRecordVisible`, the forms gate on the helper. |
| `apps/api/src/modules/forms/{history,compare,comments,attachments,custom-values,bulk,drafts,export}.ts` | Each form-record sub-resource read or write goes through the gate (F-123). |
| `apps/api/src/modules/benefits/{finance-validation,overlaps,scenarios}.ts` | The transformation-level child lists leave out restricted rows (sweep). |
| `apps/api/test/integration/access/sensitive-reach.test.ts` (new) | 10 integration tests: TL, AUD, TO and the owner, with and without a grant, allowed and denied, before and after marking. |

## Checks actually run (logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Y1-evidence/`)

Environment: Node 24.21.0, offline. Disposable PostgreSQL 16.15 clusters started by `tests/qa/support/with-pg.sh`, on ports 28100–28149 only (UTF8, C locale). Every exit code below is the real one.

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | exit 0, `PASS gate DG5 (historical)` | (start of session; re-run at the end, row 17) |
| 1 | `with-pg.sh npx vitest run --project integration apps/api/test/integration/access/sensitive-reach.test.ts`, **first draft** | exit 1. A fixture error in my test (the benefit was not at Measure, 422 `benefit_measurement.step`); 10 skipped. Fixed by using `measuredBenefit`. | `00-sensitive-reach-fixture-error.log` |
| 2 | Same test, on the base code (tracked `apps/api/src` files restored from `HEAD` by file copy; the helper moved aside; all restored afterwards) | exit 1, **6 failed** / 4 passed. The 6 are exactly the leak cases: F-121, F-122, F-123 read, F-123 write, sweep, and the grant/revocation case. | `02-sensitive-reach-BEFORE-fix.log` |
| 3 | Same test, with the fix | exit 0, **10 passed** | `01-sensitive-reach-AFTER-fix.log` |
| 4 | The reviewer's repro tests (`zz-cs-r1-audit-sensitivity`, `zz-cs-r1-form-record-sensitivity`), copied into `tests/qa/integration` temporarily and removed after | exit 1, 2 failed **at the leak assertions**: "unredacted: 0" and `expected 404 to be 200`. These tests assert the defect, so failing is the expected outcome after the fix. | `03-reviewer-repros-after-fix.log` |
| 5 | `pnpm -r typecheck`, attempt 1 | **exit 137** (`apps/api` tsc killed, out of memory, while it ran in parallel with tests) | `10-typecheck-attempt1-killed-137.log` |
| 6 | `pnpm -r --workspace-concurrency=1 typecheck` | exit 0 (all 8 projects) | `11-typecheck.log` |
| 7 | `pnpm lint` | exit 0 | `12-lint.log` |
| 8 | `pnpm openapi:lint` | exit 0, `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `13-openapi-lint.log` |
| 9 | `pnpm -r build` | exit 0 | `14-build.log` |
| 10 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `15-prettier.log` |
| 11 | `with-pg.sh pnpm test:integration` (full; QA_PG_PORT=28130, MTH_PORT_POOL=28131-28149) | **exit 1, INCOMPLETE.** The single-fork worker died after 14 files (`Error: Channel closed`, `ERR_IPC_CHANNEL_CLOSED`, most likely OOM: it ran in parallel with `pnpm test`, a second integration run and tsc). In the 14 files: `contract.test.ts` 4 failed (BE-X1, BE-D: 403 → 404 caused by my first guard map; P2 exercises: 30 s timeout; the coverage roll-up) and `tests/qa/integration/a12-p6-scope-isolation.test.ts` 1 failed (the same 403 → 404 on the evidence download). Both led to the guard-map correction described above. | `20-integration.log` |
| 12 | `pnpm test`, locale unset, attempt 1 (in parallel with row 11) | exit 1. unit-node: 3 failed / 2814 passed. One was **real**: `architecture.test.ts` refused my non-literal computed member keys in `sensitive-reach.ts` (fixed with `Map`s). Two were timeouts under load. unit-web: 6 failed / 2012 passed, all timeouts (5–30 s) in files I did not touch. formula-nocodegen: 259 passed / 2 skipped. | `21-unit-locale-unset-attempt1.log` |
| 13 | `npx vitest run --project unit-node apps/api/src/architecture.test.ts` (after the fix) | exit 0, 141 passed | `22-architecture-after-fix.log` |
| 14 | Targeted integration, round 1 (contract, access, audit, forms, evidence, transformations, aud-write-deny) | exit 1. **3 failed** / 555 passed. Two were real, in my new test: the `Map` refactor left two property reads on a `Map` in the polymorphic branch, so the flag and comment owners were not resolved. The typecheck that would have caught it had been OOM-killed: `16-typecheck-api-after-guard-change.log`, exit 137. Fixed. One was a timeout of `p5-exercises-be-k` (30 s, under the parallel full run). | `23-integration-targeted-final.log` |
| 15 | Targeted integration, final code: `apps/api/test/integration/{access,audit,forms,evidence,benefits}`, `evidence.test.ts`, `transformations.test.ts`, `aud-write-deny.test.ts`, `tests/qa/integration/a12-p6-scope-isolation.test.ts` | **exit 0, 40 files, 602 passed, 1 todo** | `24-integration-targeted-final2.log` |
| 16 | `contract.test.ts` alone, final code | **exit 0, 105 passed** | `25-integration-contract-final.log` |
| 17 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | exit 0, `PASS gate DG5 (historical)` | `30-validate-dg5-historical.log` |
| 17a | `apps/api` `tsc -p tsconfig.json`, on the final code (after the last `sensitive-reach.ts` change) | exit 0 | `17-typecheck-api-final.log` |
| 17b | `npx eslint --max-warnings=0` on every changed and new file, final code | exit 0 | `18-lint-changed-files-final.log` |
| 18 | `pnpm test` (locale unset, then `LANG=LC_ALL=C.UTF-8`), final code | Locale unset: **exit 0**, unit-node 2817 passed, unit-web 2018 passed, unit-formula-nocodegen 259 passed / 2 skipped. C.UTF-8: **exit 0**, unit-node 2817 passed, unit-web 2018 passed, unit-formula-nocodegen 259 passed / 2 skipped. Both runs are on the final code, after the architecture fix. | `26-unit-locale-unset.log`, `27-unit-c-utf8.log` |

Rows 6–10 (full typecheck, lint, build, Prettier) ran before the last three edits to `sensitive-reach.ts` (the `Map` lookups, the narrower guard map and the polymorphic-branch fix). After those edits I re-ran only the API typecheck (17a), ESLint on the changed files (17b), Prettier on the file (exit 0) and the architecture test (13). I did not re-run `pnpm -r build` or the full-tree `pnpm lint` on the final code; the orchestrator's integration run should.

**Not done (BLOCKED by time):** a complete `pnpm test:integration` on the final code. Row 11 is incomplete (the worker died), and the hard limit did not allow a fresh full run, which is far longer than the remaining time (14 files took about 14 minutes; there are about 384 files). Rows 15 and 16 cover every integration file in the areas this change touches, plus the a12 file of `tests/qa` that exercises sensitive records. The rest of `tests/qa/integration` and the other API directories were not re-run on the final code. **The orchestrator should run the full `pnpm test:integration` at integration.** No pinned count changed: my new file adds 10 integration tests; I did not edit any count pin.

## Operations routed (delta to the pending list)

None. No new or changed OpenAPI operation; no `p6-pending-*.ts` or `p6-exercises-*.ts` change is needed. `contract.test.ts` result: see the integration run.

## Contract, schema, migration and dependency needs (for the orchestrator)

- **No migration.** No new dependency.
- **Contract (optional, additive; for the orchestrator and the FE owner):** `AuditEvent` (the per-transformation trail) could gain an optional `redacted: boolean`, as `GlobalAuditEvent` has. The transformation audit page could then show the existing "Redacted" chip instead of an empty change list. I did not add it: `openapi.yaml` and the zod mirrors are shared with the concurrent tasks, and the null `changes`/`reason` already conform.
- **Domain consequence to note for review:** the guard and the child lists apply ADR-0051 §2 literally to Finance. A FIN user who is neither the benefit's named `finance_validator_user_id` nor a grantee no longer opens a finance validation of a **sensitive** benefit (`…/finance-validations/{id}`, `/decision`: 404; the list leaves it out). This is what §2 says ("Holding … does not admit by itself"), but it means a sensitive benefit's Finance validation needs the validator named on the benefit or given a grant. No approval is granted or bypassed by this change.

## User-facing texts

- None is made untrue.
- `adminP6.audit.scopeNote` ("Events of a sensitive record you are not admitted to are shown without their reason and changes.") and `adminP6.audit.redacted` remain true. They now also cover the child events, so the FE owner may optionally extend them ("…or of a record that carries its values"), in en and ar.
- The per-transformation audit page shows a redacted event with no change list and no reason, without a chip. See the contract note above.

## What remains

- The guard covers child **item** routes by path parameter. Child **lists** were filtered where they exist at transformation level: finance validations, overlaps and scenarios.
- `benefit-scenarios` list items embed scenario values (`presentScenarios`). A scenario of a non-sensitive case that holds a value row of a sensitive **benefit** is still listed with that value. Filtering the embedded values needs the scenario presenter changed (`benefits/scenarios.ts`, owner of slice F.3); not done.
- `corrective_case`, `transition_decision` and `performance_area_link` events are redacted in both audit routes (they carry a sensitive benefit's id and variance or decision data). Their own register routes (RAID corrective cases, sustainment transition decisions, performance-area links) are separate records and are **not** hidden. Whether ADR-0051 §2 extends to them is a domain question for the architect/reviewers.
- The reach of the deep links, search and export was not re-tested here; they are unchanged.

## Merge instructions

- No migration and no ordering constraint.
- Expected conflicts:
  - `apps/api/src/server.ts`: the import list and the audit-routes port block (the `restrictedRecords` line), plus one new `registerSensitiveReachGuard(app, db)` line before `registerOrganizationRoutes`;
  - `apps/api/src/modules/forms/*.ts` and `benefits/{finance-validation,overlaps,scenarios}.ts`: small, local edits.
- Keep the guard registered **before** the business routes.
