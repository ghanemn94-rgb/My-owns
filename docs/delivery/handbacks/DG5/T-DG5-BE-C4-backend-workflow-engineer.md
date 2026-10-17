# Handback T-DG5-BE-C4 (backend-workflow-engineer): repair task, D-164 (b, d) and D-165 (QA-B P-3, QA-E O-1)

- **Invocation:** `DG5-T-DG5-BE-C4-backend-workflow-engineer-20261017T093105Z-cfa772f8`, session `cfa772f8-b181-4beb-94c8-dad942aed855`.
- **Stage:** P5 / DG5 (BUILDING).
- **Branch:** `dg5/be-c4`, base `457e0ca` (D-165). Assignment sha256 `f3b8335b…58fb0`, verified.
- **Time:** started 09:31:21Z, checks finished 10:20:41Z (about 50 minutes).
- **Changes are uncommitted,** for the orchestrator to integrate.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0. Run at the start and again at the end (`T-DG5-BE-C4-evidence/validate-dg4-historical.log`).

Nothing here grants a business, Finance or IT approval. Every gate decision, exception and waiver in the tests is a synthetic demo business decision in a disposable test database. Nothing touches DG0–DG7, and product G6 never implies DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0094_p5_gate_approver_configured.sql` (new) | Additive: `gate_instance.approver_configured boolean NOT NULL DEFAULT false`, plus a column comment and the backfill (§2.1). |
| `packages/db/src/schema.ts` | **Outside my listed ownership, but required:** the new column in `GateInstanceTable` and in `SCHEMA_COLUMNS.gate_instance`. Without it, `packages/db/test/integration/catalogue.test.ts` fails on schema drift and Kysely cannot read or set the column. Two lines only. |
| `apps/api/src/modules/workflows/gates.ts` | `routedApproverOf` honours the flag. The two explicit selects that feed it (`effectiveGateApprovers`, `isGateApprover`) read the flag. The approver configuration sets it to true in the same update and records it in the same audit event. |
| `apps/worker/src/handlers/gates.ts` | **Outside my listed ownership, disclosed:** `effectiveGateApproverOf` is the documented SQL twin of `routedApproverOf`. It decides the recipients of the gate-exception expiry notices, and its parity with the API is pinned by `effective-approver.test.ts`. Without the same one-condition change, the worker would notify BO while the API routes to SP in the new case. The change: one selected column and one condition. No concurrent W20 owner edits this file. If you prefer, revert it and reassign; the parity assertion in `approver-configured.test.ts` would then fail. |
| `apps/api/src/modules/automation/samples.ts` (new) | One complete synthetic v1 example payload per event trigger that has a payload schema (16 events), plus the placeholder constant. |
| `apps/api/src/modules/automation/catalogue.ts` | `presentCatalogue` adds `samplePayload` to each trigger that has a payload schema and omits it otherwise. |
| `packages/shared/src/schemas/automation.ts` | Zod mirror: `automationTrigger.samplePayload` (optional record). |
| `docs/api/openapi.yaml` | Three changes, all inside my ownership. (1) `AutomationTrigger.samplePayload`: optional object, with its description and placeholder. (2) `getFormRecordCustomFields` 200: `ETag` → `ETagOrZero`, with the description saying `"0"` means no stored values. (3) `ProcedureStepComplete.description` rewritten (§2.4). |
| `apps/api/src/modules/automation/samples.test.ts` (new) | Unit tests for the samples (§3). |
| `apps/api/test/integration/methodology/approver-configured.test.ts` (new) | Integration tests for scope 1. |
| `apps/api/test/integration/automation/catalogue-sample-payload.test.ts` (new) | Integration tests for scope 2. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-C4-*` | This handback and its logs. |

Untracked files I did not create and did not touch: `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. They were in the worktree at the start (or appeared during the run) and are not part of this change. Do not integrate them.

## 2. Behaviour delivered

### 2.1 Added scope 1 (D-164 b): an explicit approver configuration is remembered

- **Migration `0094_p5_gate_approver_configured.sql`:** `ALTER TABLE gate_instance ADD COLUMN approver_configured boolean NOT NULL DEFAULT false`.
- **Backfill:** true for every instance that has an `audit_event` with `record_type = 'gate_instance'`, `record_id = id` and **`action = 'gate_instance.configure'`**. That is the audit action of the approver configuration operation. The operation is `PATCH /api/v1/transformations/{transformationId}/gates/{gateCode}` (`gates.ts`); the assignment calls it "the `PUT`", but the route and the contract are PATCH.
- **R2: the backfill changes nothing but the new column.** Version, `updated_at` and `updated_by` stay byte-identical, so ETags do not move.
  - Two row guards would otherwise force a version step and a new audit event: `p2_row_guard` (version step) and `p2_audit_required`. They are disabled with `ALTER TABLE gate_instance DISABLE TRIGGER gate_instance_row_guard / gate_instance_audit_required` for the backfill statement only, inside the migration's own transaction, and re-enabled before commit.
  - The test proves the guards are back on afterwards: an update without a version step is still refused.
  - No audit event is written. The flag records a fact that is already in the audit trail.
  - No earlier migration disabled a trigger, so this is a new pattern. **The orchestrator or architect should confirm it.** The alternative is to bump each configured row's version with a system audit event, which would change ETags and break R2.
- **The configuration operation:**
  - It sets `approver_configured: true` in the same `UPDATE` as the role and user.
  - It records `changes.approverConfigured: {from, to}` in the same `gate_instance.configure` audit event.
  - Unchanged: version step, `If-Match` (428 when missing, 409 when stale), commit-time re-authorization (`writeAtCommit`, `gate.configure`), and validation.
  - A refused configuration (403, 409 or 428) leaves the flag false (tested).
- **`routedApproverOf`:** when `approver_configured` is true, it returns the stored approver (through `approverOf` on the resolved definition, so the basis is unchanged). Otherwise today's rule applies unchanged.
- **Stored rows unchanged:** rows of v1-pinned transformations keep all their values. The new column is the only change. `toGateInstance` and the contract's `GateInstance` are unchanged; the flag is not exposed, and no contract change is needed for it.
- **Requirement REQ-S06-004.** Acceptance (quoted): "A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver". This repair makes "routed to the new approver" hold when the configured approver equals the catalogue default role. A06 itself passes unchanged (§3).

### 2.2 Added scope 2 (D-164 d): `AutomationTrigger.samplePayload`

- **Contract:** `AutomationTrigger.samplePayload` is an optional `object`, with a description. The zod mirror is `samplePayload: z.record(z.string(), z.unknown()).optional()`.
  - No new operation, and no change to any request or response media type.
  - The description says the payload is present only for an event trigger whose outbox event has a payload schema, and that it is valid against that schema (the complete payload, as in `AutomationDryRunRequest`). The ids are synthetic.
  - It also says: "Its transformationId, when the event has one, is the fixed placeholder 00000000-0000-7000-8000-000000000000, replaced by the builder with the selected transformation."
- **Served by `GET /api/v1/admin/automation-catalogue`:**
  - It is served for every trigger with `trigger_kind = 'event'` and `outboxPayloadSchema(code, 1) !== null`. That covers the 16 events of 0074/0075:
    - `transformation.created`
    - `kpi.threshold_changed`, `kpi.trajectory_approved`, `kpi.version_activated`, `kpi.actual_accepted`, `kpi.values_recalculated`, `kpi.deviation_evaluated`
    - `benefit.evidence_submitted`, `benefit.variance_evaluated`
    - `adoption.check_failed`, `control_check.failed`
    - `blocker_status.recorded`
    - `gate.submitted`, `gate.decided`
    - `procedure_step.activated`
    - `job.failed`
  - Schedules, requests and `dependency.slipped` (no registered schema; see the BE-J handback) have no sample.
  - Each sample is parsed with its schema before it is served, and the response is a fresh copy.
- **Requirement REQ-S12-002.** Acceptance (quoted): "A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions". The dry-run behaviour is unchanged. The catalogue now provides a valid sample, so a builder can run a dry run on a schema-validated event without hand-writing the payload. FE-D3 pre-fills from it.

### 2.3 Added scope 3 (D-165, QA-B P-3): the ETag of an empty custom-field set

`getFormRecordCustomFields` 200 now declares `ETag: $ref ETagOrZero` (the D-153 precedent). The response description notes that `"0"` with version 0 means no stored values. The `PUT` 200 keeps `ETag`, because a written set is version 1 or more. No server change was needed.

`tests/qa/integration/a07-historical-integrity.test.ts` › "contract (found while authoring A07): reading the extension values of a record that has none › GET …/form-records/T13/{id}/custom-fields returns version 0 with an ETag the contract allows" **passes, unchanged.**

### 2.4 Added scope 4 (D-165, QA-E O-1): `ProcedureStepComplete` description

New text:

> The output adapters verify and link; they never produce a record. For a create output, the record is first produced natively through its owning module's own operation (with that module's permissions, rules and audit event), and outputRecordId names it: the adapter checks that it is of the step's type, in the instance's scope, produced since the instance was launched and not another instance's output (422 procedure_step.output_required when none is named). For a link output, outputRecordId names the existing record. For an advance output, outputRecordId is omitted (or names the same record): the record an earlier step of this instance linked must have reached the state this step records.

This matches `procedures/outputs/kit.ts` (the header and `outputAdapter`).

## 3. Checks actually run

Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-C4-evidence/`. Following the load rule, they ran one at a time. Integration used ports 23800–23849.

| # | Command | Result |
|---|---|---|
| 1 | `pnpm -r typecheck` | exit 0 (`typecheck.log`) |
| 2 | `pnpm -r build` | exit 0 (`build.log`) |
| 3 | `pnpm lint` | exit 0 (`lint.log`), see the note below |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | First run: **exit 123**, two of my files unformatted (`catalogue-sample-payload.test.ts`, `apps/worker/src/handlers/gates.ts`). After `prettier --write` on those two: **exit 0** (`prettier.log`). |
| 5 | `pnpm openapi:lint` | exit 0: `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` (unchanged count) |
| 6 | `npx vitest run --configLoader runner --project unit-node`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | exit 0: 140 files, **2309 passed** (D-165 baseline 2305, plus the 4 new `samples.test.ts` tests) |
| 7 | the same with `LANG=C.UTF-8 LC_ALL=C.UTF-8` | exit 0: 140 files, 2309 passed |
| 8 | `npx vitest run --configLoader runner --project unit-web`, locale unset, then C.UTF-8 (the shared zod mirror reaches the web) | exit 0 both: 85 files, 1609 passed each |
| 9 | `QA_PG_PORT=23800 MTH_PORT_POOL=23801-23849 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration` on: `apps/api/test/integration/{methodology,workflows,gates,automation}`, `gates.test.ts`, `dg2-repairs.test.ts`, `tests/qa/integration/{a03,a06,a07,a13}*.test.ts`, `packages/db/test/integration/{catalogue,migrate}.test.ts` | **exit 1:** 49 files, **450 passed, 2 failed** (`integration-reached.log`). The 2 failures are the A07 tests for **QA-B P-1**, which D-165 keeps failing on purpose and allocates to KBE-D4: "the issued Q1 dashboard retains the calculation version…" (`versions: []`) and "…offered for reissue after the approved restatement". Neither is in my scope, and my change does not reach `reporting/**`. |
| 10 | the same harness on `apps/api/test/integration/contract`, `apps/worker/test/integration/gates.test.ts`, `apps/api/test/integration/forms` | exit 0: 7 files, **164 passed**. `contract.test.ts` 83/83, worker `gates.test.ts` 8/8 (`integration-contract-worker-forms.log`). |
| 11 | `node tools/gates/validate.mjs --historical --stage DG4` | `PASS gate DG4 (historical)`, exit 0 (start and end) |

**Lint note.** `pnpm lint` ran before the `prettier --write` of the two files. Afterwards I re-ran `npx eslint --max-warnings=0` on those two files: exit 0 (`lint-reformatted.log`).

**Development runs, disclosed:**
- The first run of `approver-configured.test.ts` failed 1 of 4. The cause was a test-fixture bug of mine: a pending exception collided with the coverage helper (`gate_exception.already_pending`). After the fix, it passes 4/4 (`integration-approver-configured-rerun.log`). The failing run's log was overwritten by the rerun; only this note records it.
- `integration-sample-payload-a07.log` is an earlier targeted run: `catalogue-sample-payload.test.ts` 3/3, A07 13 passed and the same 2 QA-B P-1 failures.

**Scope 1 tests:**
- `approver-configured.test.ts`, 4 tests:
  - Role-only SP on a BO-default G3 is reported as SP (single read, list read, PATCH response) and routes the next submission to SP. The worker twin agrees. BO is refused (exception decision 403 `gate_exception.not_approver`, gate decision 403). The flag and `changes.approverConfigured` are in the same audit event, at the stepped version.
  - A never-configured G3 follows BO, and its submission routes to BO.
  - A refused configuration leaves the flag false: AUD 403, stale 409, missing `If-Match` 428.
  - Backfill: the shipped `0094` file is re-applied to the pre-0094 table in a transaction that is rolled back. The configured instance becomes true and the never-configured one stays false. Version, `updated_at` and `updated_by` are unchanged, and the guards are re-enabled.
- The existing `effective-approver.test.ts`, A06 (`a06-configuration-change.test.ts`), A03, `gates.test.ts`, `gates/g4.test.ts`, `workflows/**`, `methodology/**` and the worker `gates.test.ts` all pass unchanged.

**Scope 2 tests:**
- `catalogue-sample-payload.test.ts`, 3 tests:
  - The contract documents the optional member and its placeholder.
  - Every served `samplePayload` parses with `outboxPayloadSchema(code, 1)`; every event trigger with a schema has one and no other trigger does. The response parses with the zod mirror.
  - The `gate.submitted` sample, with `transformationId` replaced by a transformation of the rule's organization, gives a **201** dry run with `conditionsMet: true`.
- `samples.test.ts`: 4 unit tests.

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suites were not run. They run in the orchestrator's verification of the merged tree.

## 4. Operations routed (delta to the pending list)

None. No operation was added or routed, so `apps/api/test/support/p5-pending-be-c.ts` and `p5-exercises-be-c.ts` are unchanged.

`contract.test.ts` passes 83/83. The pinned counts (media-type triple, rate-limit floor) are unchanged: **delta 0**.

## 5. Contract, schema or dependency needs

- **Contract:** only the three changes approved by D-164 (d) and D-165, listed in §1. No new operation, problem code or media type.
- **Schema:** migration `0094` (additive). On merge it runs after `0093`. BE-T3 holds `0095`/`0096`, so there is no number conflict.
  - `packages/db/src/schema.ts` needed two lines (disclosed in §1).
  - `docs/architecture/data-dictionary.md` (§`gate_instance`) does not list the new column yet. That file is the architect's, and no test checks it. Please add this row: `approver_configured | boolean | NOT NULL | false | ` with "0094; set by gate.configure".
- **Pattern to confirm:** the backfill disables two `gate_instance` triggers inside the migration transaction (§2.1).
- **Dependencies:** none.

## 6. User-facing texts made untrue

None. I checked the en/ar web strings that mention the dry-run sample (`workflowsP5.json` `dryRun.*` and `problems.json` `automation__dry_run_sample_invalid`). They stay true. FE-D3 owns the pre-fill and its strings.

## 7. What remains

- Nothing of my four Added-scope items remains.
- **For the orchestrator:**
  - Confirm or revert the two out-of-ownership edits: `packages/db/src/schema.ts` (required) and `apps/worker/src/handlers/gates.ts` (parity).
  - Confirm the trigger-disable backfill pattern.
  - Have the architect add the data-dictionary row.
- **Merge instructions:**
  - Apply migration `0094` in order (forward-only).
  - Expect no conflict with the concurrent W20 tasks:
    - KBE-D4 edits a different line of `workflows/index.ts`, and I did not touch that file.
    - FE-D3 consumes `samplePayload` from the zod mirror; the member is optional, so there is no break before or after its merge.
