# Handback T-DG5-BE-C (backend-workflow-engineer): methodology migrations, gate re-approvals, the gates reader, the S16-012 group

- **Stage:** P5 / DG5 (BUILDING). **Section:** `docs/architecture/p5-work-split.md` §A.5.
- **Invocation:** `DG5-T-DG5-BE-C-backend-workflow-engineer-20261014T133219Z-a62ad782`, session `a62ad782-9a29-46d1-9d9a-5f303abc88a7`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-C.md`, sha256 `68d980103c098f25b81e21cb8c7badcfb85d94d62f63e0c5c00c0aded4dc70be` (verified).
- **Base:** worktree `/home/user/wt/dg5-be-c`, branch `dg5/be-c`, HEAD `81be9e6c969b338016695e383cef33960e87f1e9`. All changes are **uncommitted**.
- **Time:** start `2026-10-14T13:32:36Z` (`date -u`); end `2026-10-14T15:33:33Z` (`date -u`), about 2 h 01 min, at the hard limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` at the start → exit 0, `PASS gate DG4 (historical)`.
- **Two gate systems.** Approving a migration and re-approving a product gate are **business approvals inside the product**, made by people. No agent, job, seed or timer approves anything here. Nothing reads or writes the engineering gates DG0–DG7, and product G6 never implies DG7. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/methodology/migrations.ts` | Fills BE-A's stub. The eight migration operations, with the ADR-0040 §8 refusals and exact texts. It defines the `wireMethodologyMigrations` port (approval service and work-item services) and registers the `methodology_migration` approval subject (`decideThroughSubject` and `resubmitThroughSubject`). |
| `apps/api/src/modules/methodology/migration-plan.ts` (new) | Builds the ADR-0040 §2 plan items from the version diff and the kind providers' `migrationItems`, then computes `plan_sha256` and `plan_ready`. |
| `apps/api/src/modules/methodology/reapproval.ts` (new) | Creates the `gate_reapproval` rows on execution, supersedes earlier required rows, creates the `gate_reapproval` work items for `gate.submit` holders, and serves `listGateReapprovals`. |
| `apps/api/src/modules/workflows/criteria.ts` | Adds `resolveGateDefinitions`, the gate reader through `ConfigResolver`: label, help, default approver, `submissionEnabled`, and a criterion's label, help and mandatory flag. For v1 it returns the catalogue objects themselves. |
| `apps/api/src/modules/workflows/gates.ts` | The resolver lines (list, view, configure response, submit, decide, `isGateApprover`). Adds `routedApproverOf`, the re-approval resubmission (Q9), the 422 `gate.reapproval_required` refusal for later gates, and `satisfyReapproval` on an approved decision. |
| `apps/api/src/modules/workflows/approvals.ts` | Exports `decideApprovalInTx` (checks 3–8 and the outcome behaviour, unchanged and in the same order, with If-Match still read at check 5), the `decideThroughSubject` provider flag, the 422 `approval.decide_through_record` refusal, and `decide` in `bindServices`. |
| `apps/api/src/server.ts` | **Outside my listed files (disclosed, §5.1):** one import and one `wireMethodologyMigrations({...})` call, following the sustainment/kpi port precedent. Also adds `closeWorkItemsOfSubject` to the existing tasks import. |
| `packages/shared/src/schemas/methodology-migrations.ts` | Fills BE-A's stub with the zod mirrors: `methodologyMigration`, the page, item, create, preview, decision, `gateReapproval` and its page. |
| `apps/api/test/support/p5-pending-be-c.ts` | Pending list emptied (9 → 0). |
| `apps/api/test/integration/contract/p5-exercises-be-c.ts` | Exercises all 9 operations and fills the mirror map. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[343, 342, 1]` → `[346, 345, 1]`, plus a comment line (the BE-H2 precedent; §4). |
| `apps/api/test/integration/methodology/methodology-migrations.test.ts` (new) | REQ-S06-008 and Q9 behaviour; every refusal; AUD, If-Match, audit, commit time, lock. |
| `apps/api/test/integration/methodology/entity-group.test.ts` (new) | REQ-S16-012. |
| `apps/api/test/integration/methodology/v1-readers.test.ts` (new) | p5-plan R2: the v1-pinned regression suite for the rewired gate reader. |
| `apps/api/test/integration/methodology/migration-fixtures.ts` (new) | Seeds same-key published versions, sets a test transformation's pin, and takes the history snapshot (all test-only and synthetic). |

No migration was added (`0066`/`0067` stay free). No dependency was added. Nothing under `packages/shared/src/formula/**` changed.

## 2. Behaviour delivered, per requirement row

### REQ-S06-008 (owner: BE-C)

> Acceptance: "A06;A07: after publishing v2, an existing transformation still renders v1 forms; the migration preview lists the new required field and a required G2 reapproval; historical records remain unchanged"

All tests are in `methodology-migrations.test.ts`.

- **After publishing v2, it still renders v1.** v2 is seeded as published. The transformation's gate view still shows the catalogue label "G1 - Case for Change" and the catalogue G3 approver (SP), and its pin names v1. The same holds while the migration is only planned. After execution the gate reads v2: the label "(synthetic v2)" and approver BO.
- **The preview lists the new required field.** Test "the preview lists the new required field (forms provider)…": a form_schema v2 adds a required `T01.sponsor_note`. Plan revision 1 lists `new_required_field` with `needs_input` and `recordCount` 6, and `planReady` is false. Submit answers 422 `methodology_migration.inputs_required`. An input naming no plan field answers 400 and writes nothing. A preview with `value: null` (leave empty until next edit) moves the item to `provided` in revision 2, makes the plan ready, and lets submit proceed.
- **The preview lists a required G2 re-approval.** v2 adds a mandatory G2 checklist item, with G1 and G2 approved. The plan is `[mapping G1, mapping G3, reapproval G2, unchanged_history]`. The re-approval item names the preserved approved G2 decision and the reason (`checklist_item test.g2-check added`).
- **Historical records remain unchanged.** `historySnapshot` is taken before and after execute and compared byte for byte. It covers `gate_instance`, `gate_submission`, `gate_submission_criterion`, `gate_decision`, `gate_decision_agreement`, `decision`, `charter`, `baseline`, `value_pool`, `diagnostic_item`, `diagnostic_finding`, `evidence`, `evidence_link`, `scoring_weight_set` and `form_custom_value` of the transformation. The pin moves once (version 2, `last_migration_id`) with exactly one history row.
- **Plan, approve-migration and execute** (row: "plan:ADM; approve-migration:TL or configured business approver"). ADM_METHOD plans and executes. The approval is routed to the SP party (D-143 point 2), with `sod_policy = requester_excluded` and the approver task. AUD and TL get 403 on every write. ADM_METHOD gets 403 on decide, and SP gets 403 on execute.
- **"Migration executed → create reapproval tasks".** Each re-approval gets one `gate_reapproval` work item per active `gate.submit` holder (TL here), with message key `methodology.task.gate_reapproval` and params `{gateCode}`.

The p5-work-split §A.5 tests:

- G1 is resubmitted while its re-approval is required (201, `approved → submitted`) and approved again by the Sponsor. The re-approval becomes `satisfied`, linked to the **new** decision, and its task is done. The earlier G1 decisions are byte-identical.
- G2's resubmission passes the approval refusal. In this synthetic world it stops at the DG2 criteria check (422 `gate_criteria_incomplete`), because no fixture completes G2's outputs (see §8).
- G1 approved with no re-approval keeps 422 `gate.already_approved`.
- G3 gets 422 `gate.reapproval_required`, with the exact text, both before and after G1 is re-approved (G2 is still required).
- A second migration supersedes the earlier G2 row (`superseded`; its task is cancelled).
- The requester deciding gets 403 `methodology_migration.self_approval`. This person holds both ADM_METHOD and SP.
- `POST /approvals/{id}/decisions` on the type answers 422 `approval.decide_through_record` and writes nothing (no `approval_decision` row).
- A stale pin answers 409 `methodology_migration.pin_moved`, on submit and on execute of an approved migration; nothing is written.
- Lock 730252 (`ADVISORY_LOCK_CLASSES.methodologyMigration`, asserted): two concurrent creates give exactly one 201 and one 409 `open_exists`, and one row.
- Request changes, then resubmit: the same approval moves to round 2 for the new row version. Reject is final (then 422 `not_open`). Withdraw also withdraws a submitted migration's approval.

### REQ-S06-010 (shared with BE-B3; my part is the migration-approval half)

> Acceptance: "A06;A12: a methodology admin can publish a form change but receives 403 approving a funding reallocation; a KPI owner can update assigned KPI actuals but not Studio"

What I add: ADM_METHOD gets 403 on `decideMethodologyMigration`, because publishing never grants a business approval. Only `methodology_migration.approve` (SP) decides. BE-B3 owns the funding-reallocation 403 and the BO Studio 403.

### REQ-S06-004 (shared with BE-A, BE-B, slices B and E; my part is the gate reader)

> Acceptance: "…after publish, with no deployment or application-code change, … a submission is routed to the new approver"

My part: a pinned version's `gate.defaultApproverRoleCode` is honoured by new submissions (`routedApproverOf`) for a gate whose approver was never configured for the transformation. A configured approver is kept. Only roles in the DG2 allowed set are resolved. Positive control: `v1-readers.test.ts` (G3 resolves BO), and after migration the G3 view shows BO. The T13 field and the validation rule belong to slice B; non-gate routes belong to slice E (ADR-0044).

### REQ-S16-012 (owner: BE-C)

> Acceptance: "A08: the ERD and migrations contain every entity listed (…) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"

`entity-group.test.ts` creates and reads each entity through the API, with AUD 403 on every write and 404 outside the scope:

- Transformation, Charter, GateInstance (from instantiation) and GateDecision (a synthetic G1 decision by the Sponsor, read back through the submission).
- MethodologyVersion (a Studio draft), Phase and GateDefinition as version-scoped rows in that draft (D-142 Q4). A seventh gate answers 422 `config_version.source_element_protected`. Studio reads are permission-only, so an outsider gets 403 there (A.10 item 1).
- PerformanceArea.

The ERD and migrations half is the architect's (`0011`, `0017`, `0062`–`0064`; ERD §1l).

### p5-plan R2 (the v1 regression suite)

`v1-readers.test.ts` covers four cases:

1. A new transformation is pinned to `playbook` v1, and `resolveGateDefinitions` is JSON-identical to `loadGateDefinitions`.
2. `GET /gates` and every `GET /gates/{code}` definition is JSON-identical to the DG2 catalogue from `GET /methodology`, and `canSubmit` is unchanged.
3. A v1 submission routes to `SP` with basis `default_role` (in the snapshot as well). The decision's `approverBasis` is `default_role`. The DG2 refusal text is unchanged, and the re-approval list is empty.
4. Control: a version without rows resolves to the catalogue. A version with rows changes exactly the overridden fields, and a role outside the allowed set is never resolved.

## 3. Checks actually run

Environment: Node 24.21.0, offline. Disposable PostgreSQL through `tests/qa/support/with-pg.sh`, ports 23800–23849. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-C-evidence/`.

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 827 operations` |
| Targeted runs during development: `methodology-migrations.test.ts`, `v1-readers.test.ts`, `entity-group.test.ts`, `contract.test.ts` | 0 (final runs) | 9/9, 4/4, 3/3, 73/73 |
| `pnpm test` (locale unset), `pnpm test` (C.UTF-8) | 1 (both) | §9: two timeouts under load (about 22); both tests pass alone. C.UTF-8 incomplete |
| `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` | **0** | **222 files, 2163/2163** (`integration.log`) |
| `pnpm -r typecheck`, `pnpm lint`, prettier check (re-run after the last edit) | 0, 0, 0 | `typecheck-final.log`, `lint-final.log`, `prettier-final.log` |
| `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `validate-dg4-end.log` |

**Disclosed intermediate failures, all mine and fixed:**

1. The first migration-suite run failed 3 of 9 with `approval.stale_version`. The DB guard (0031 `p4_approval_subject_version`) checks the subject's **row version**, but I had used the plan revision. I changed the design so the approval names the migration's row version as submitted, and `approval_id` is linked by the deciding or withdrawing update. Re-run: 9/9.
2. The entity-group test read the charter at the wrong path (`CharterView.charter`). Fixed; 3/3.
3. The first contract run failed for two reasons. My exercise approved G1 through the fixture without the B0032 agreements (refused at COMMIT by 0025), and the media-type pin moved by +3. Both fixed; 73/73.
4. The first `pnpm test` (locale unset) failed 1 of 1831: `advisory-locks.test.ts` refuses a spelled lock-class number, and my comment in `migrations.ts` contained it. I now name `methodologyMigration`.
5. An empty `apps/api/.claude/.cc-writes` directory existed. I found it before my first test run but removed it only before the full integration run. It is under `apps/api`, not under `packages/db/migrations`, where the known harness issue lives (D-144), so the earlier runs were not affected.

## 4. Operations routed (delta to `p5-pending-be-c.ts`)

All 9 left the pending list (9 → 0): `listMethodologyMigrations`, `createMethodologyMigration`, `getMethodologyMigration`, `previewMethodologyMigration`, `submitMethodologyMigration`, `decideMethodologyMigration`, `executeMethodologyMigration`, `withdrawMethodologyMigration`, `listGateReapprovals`. Each has a success and every declared refusal I could reach in `p5-exercises-be-c.ts`; 401 and 429 are owned by their own suites.

**Pinned counts:** the media-type triple goes `[343, 342, 1]` → **`[346, 345, 1]`** (+3 JSON bodies: create, preview, decide; submit, execute and withdraw are bodiless). The orchestrator should sum this with the other W6 increments. The operation count is unchanged (contract test 73/73).

`config.consumes` is `application/json` on create, preview and decide; the three bodiless POSTs declare none.

## 5. Contract, schema and dependency needs (for the orchestrator)

1. **`server.ts` wiring (outside my listed files).** `methodology` may not import `workflows` or `tasks`, so the approval service and the work-item services have to be passed in by the composition root. These are two named lines: the import and `wireMethodologyMigrations({ requestApproval, registerSubject, createWorkItem, closeWorkItems })`, plus `closeWorkItemsOfSubject` added to the existing tasks import. This follows BE-B2's and the sustainment/kpi precedent. Please accept it or reassign it.
2. **Outbox event `methodology_migration.executed` is NOT emitted** (ADR-0040 §4 lists it). It needs a payload schema entry in `packages/shared/src/schemas/events.ts` (`OUTBOX_EVENT_SCHEMAS`) and, I expect, a worker consumer or an explicit no-op. Neither file is mine. Proposed payload v1: `{migrationId, transformationId, kind, fromVersionId, toVersionId}`. After the registry entry exists, one `insertInto("outbox_event")` call in `executeMigration` is enough (idempotency key `methodology_migration.executed:<id>`).
3. **ADR-0040 §1/§4 note (for the architect).** The approval's subject version is the migration's **row version** (the 0031 database rule), not the plan revision. `approval_id` is therefore set by the decide or withdraw update. Until then the API reports the open approval found by subject (`approvalId` in the response). This is consistent with the 0063 guards: `approved`, `rejected` and `changes_requested` are set in the same update as `approval_id`.
4. **Pinning on create.** When a transformation has no pin of the kind (it resolves to version 1 of the default key), `createMethodologyMigration` first records that pin, version 1, with its audit event. The 0063 guard requires `from` to be the current pin. This changes nothing the transformation reads. Please confirm or record a decision.
5. **No new problem codes** beyond ADR-0039 §13 and ADR-0040 §8. The preview input that names no plan field uses the existing validation item code `validation.reference` (400).
6. No new dependency and no migration.

## 6. User-facing texts

- No existing en/ar string became untrue. The problem keys for every §8 code are already in `apps/web/src/i18n/{en,ar}/problems.json`. The "Methodology migrations" nav and landing texts (FE-A) describe screens that FE-B ships, so they stay true until then.
- **For the owner of `apps/web/src/i18n/{en,ar}/myWork.json` and `pages/my-work/messages.ts` (FE):** the new work-item message key `methodology.task.gate_reapproval`, with params `{gateCode}`. Proposed texts: en "Resubmit {{gateCode}} for business re-approval after a methodology migration"; ar (provisional) "أعد تقديم {{gateCode}} لإعادة الاعتماد بعد ترحيل المنهجية". The kind label `gate_reapproval` already exists.
- **For FE-B:** the gate screens should show "Re-approval required" / "إعادة الاعتماد مطلوبة" (ADR-0040 §3) from `listGateReapprovals`. The DG2 `GateInstance` contract has no such field, and I did not change it.

## 7. Integration and merge notes

- The `workflows/approvals.ts` change is a pure extraction. `decideApproval` keeps checks 1–2 and the read and commit-time gates, then calls `decideApprovalInTx` with the If-Match read deferred to check 5, so every DG4 refusal keeps its order and body (the contract and DG4 approval suites pass). BE-K edits other lines of this file later.
- `workflows/gates.ts` and `criteria.ts`: for a v1-pinned transformation every path returns the DG2 result. With no `gate_reapproval` rows, both new reads find nothing.
- Expect additive conflicts in `server.ts` (wiring lines) and in `contract.test.ts` (the pin line).

## 8. Known gaps and what remains

1. **The outbox event `methodology_migration.executed`** (§5.2). Not done; it needs a file I don't own.
2. **G2's full resubmission flow is shown only up to the criteria check.** No fixture completes G2's outputs (North Star, outcome tree, KPI definitions). The full resubmit → decide → `satisfied` flow is proven on G1 through the same code path. The acceptance row's own text (the preview lists a required G2 re-approval) is met literally.
3. **Approver routes `approver_route` `gate.Gn`** (multi-step or any-of) are not read by the gate reader; only `gate.defaultApproverRoleCode` is. Executing routes is slice E (ADR-0044, BE-K).
4. **Re-approval through the form_schema provider** ("a required field of a template whose records are evidence for G", ADR-0040 §3): the plan accepts `reapproval` items from any provider, but the forms provider (BE-D) emits none today.
5. **Preview "counts"** (ADR-0040 §2) are not returned: the `MethodologyMigration` schema has `additionalProperties: false` and no counts field. Clients count `items`.
6. **The commit-time authorization test accepts 403 or 404.** With every grant revoked, the transformation becomes invisible, so 404 is also correct. Nothing is written in either case.
7. **Checklist items and mandatory artifacts scoped by `phaseCode`** count toward the gate that closes that phase. This is my reading of ADR-0040 §3; the architect should confirm it.

## 9. Final check results and end time

All logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-C-evidence/`.

**Acceptance 1 (exit 0):** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint` all exit 0. typecheck, lint and prettier were re-run after my last edit (a comment in `migrations.ts`) and exit 0 again. The build ran before that comment-only edit.

**Acceptance 2 (`pnpm test`): NOT green under load; disclosed.**

| Run | unit-node | unit-web | unit-formula-nocodegen | Exit |
|---|---|---|---|---|
| Locale unset (`unit-locale-unset.log`, started 14:36Z) | 1830/1831: **1 failed**, `architecture.test.ts` "every import respects dependsOn…" timed out at 30 000 ms (took 31.8 s), plus one vitest RPC timeout ("Timeout calling onTaskUpdate") | 1384/1385: **1 failed**, `raid.test.tsx` "action register: source, follow-up date and overdue flag…" timed out (7.1 s) | 259 passed, 2 skipped (by design) | 1 |
| C.UTF-8 (`unit-c-utf8.log`) | 1830/1831: **the same 1** `architecture.test.ts` timeout (47.3 s) | the same RAID test timed out (7.3 s); **the run was stopped by the agent runner's 40-minute background-task limit while unit-web was still running, so no unit-web summary exists** | **not run** (stopped before it started) | none (stopped) |

- The load average was about 21–22 throughout: four W6 agents plus my own integration run, which I started in parallel to fit the 2-hour limit.
- **Both failing tests pass alone:** `npx vitest run --project unit-node apps/api/src/architecture.test.ts` exits 0 with 139/139 (`isolated-architecture.log`). `npx vitest run --project unit-web apps/web/src/pages/raid/raid.test.tsx` exits 0 with 18/18 (`isolated-raid.log`).
- These are the same two tests BE-D and BE-H reported timing out at load (D-146; the F-DG4-148 class, the D-134 envelope). Neither touches my code paths beyond the architecture walk, which also scans my new files, and that walk passes.
- The earlier failure caused by my own code (the spelled lock-class number in a comment, `advisory-locks.test.ts`) is fixed. That test passes in both later runs.
- **Still to do:** a complete C.UTF-8 `pnpm test` at low load. This is the one acceptance check I could not finish inside the time limit.

**Acceptance 3 (integration):** `QA_PG_PORT=23810 MTH_PORT_POOL=23811-23849 tests/qa/support/with-pg.sh pnpm test:integration` exits **0**, with **222 test files and 2163/2163 tests**. My new tests are `methodology-migrations` 9, `entity-group` 3 and `v1-readers` 4, plus the BE-C contract exercise inside `contract.test.ts`. **Pinned-count change:** the media-type triple goes `[343, 342, 1]` → `[346, 345, 1]` (§4). The operation count is unchanged.

**Acceptance 4:** `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the start and at the end (`PASS gate DG4 (historical)`).

**Remaining work, in order:**

1. Re-run `pnpm test` with C.UTF-8, and with the locale unset, at low load.
2. Orchestrator decisions on §5.1 (the `server.ts` wiring lines), §5.2 (the outbox event registry entry), §5.3 (the ADR note on the approval subject version) and §5.4 (pinning on create).
3. The FE message key and the gate label (§6).
4. Gaps §8.3–§8.7, owned by later slices or needing confirmation.
