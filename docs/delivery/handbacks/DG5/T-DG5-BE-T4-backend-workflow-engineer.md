# Handback T-DG5-BE-T4 (backend-workflow-engineer): DG5 W21 repair, D-166 Rules A and B and the worker's dev-binding reset

- **Stage:** P5, gate DG5 (BUILDING). Task T-DG5-BE-T4, assignment `docs/delivery/assignments/DG5/T-DG5-BE-T4.md` (sha256 `e0942480…a0bbe7`, verified).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-T4-backend-workflow-engineer-20261017T140321Z-0599ed3d","session_id":"0599ed3d-8e39-4365-a9ef-e1c20e5ff53d"}`.
- **Base:** branch `dg5/be-t4` at `6f8ce12a34038946d0b01dd5685a4cc2a7fb12d7` (D-166). The changes are left **uncommitted** for the orchestrator.
- **Time:** started `2026-10-17T14:03:35Z`; finished at `2026-10-17T14:56:06Z` (about 53 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0. It ran first, before any write.

Everything here is synthetic. No business, Finance or IT approval was granted. The approvals decided in the tests are demo **business approvals** on synthetic records, decided by a synthetic Sponsor through the canonical approval. Product gates G1–G6 and engineering gates DG0–DG7 stay separate.

## 1. Summary

| Scope | Result |
|---|---|
| 1. Rule A (D-166; D-QA-E-2; REQ-S06-003) | Delivered. Migration `0096`, the adoption in `procedures/steps.ts`, the routing wait and its retry. `intake-adoption.test.ts`: 12 tests. |
| 2. Rule B (D-166; REQ-S12-012) | Delivered. `forwardFinishes`/`forwardFinish` are pure functions in `portfolio/schedule.ts`, next to `predecessorFinish`, which is unchanged. `slip-events.ts` uses them for `affected`. 9 unit tests, and the updated integration test in `starters-be-j.test.ts`. |
| 3. Worker in-app reset keeps the dev binding (BE-T3 §6.4) | Delivered. `@mth/db` exports `demoDevIssuerBindingAllowed`. `handlers/demo.ts` passes `devIssuerBinding` to `resetDemo`. 2 unit tests and 2 integration tests. |

No operation was routed, and no route, request or response shape changed.

## 2. Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0096_p5_intake_adopts_transformation.sql` (new) | Rule A at the database. It adds a new function `procedure_step_instance_row_guard()`, then drops and re-creates the trigger of the same name on `procedure_step_instance` only. The new function keeps every `p2_row_guard` rule and allows exactly one change of `transformation_id`, the adoption (§3.1). `p2_row_guard` itself is unchanged for every other table. |
| `apps/api/src/modules/procedures/steps.ts` | Rule A in the engine: `adoptIntakeTransformation` (called from `completeStep` after `capture_intake` completes, before `advance`); `requestStepApproval` requests on the step's own transformation; an adopted step waits instead of failing on the DG4 routing refusals; `routeWaitingApprovals` (the retry, at the start of `advance`). The header comment is updated. |
| `apps/api/src/modules/procedures/instances.ts` | `updateInputs` ends with `advance`, so an inputs update routes an adopted approval step that was waiting (§3.1, retry). |
| `apps/api/src/modules/portfolio/schedule.ts` | Rule B: `ForwardFacts`, `forwardFinishes`, `forwardFinish`. `predecessorFinish` is unchanged. `isScheduled`'s parameter type is widened to `Pick<ScheduleDependency, "status" \| "toInitiativeId">`; its behaviour is the same. |
| `apps/api/src/modules/portfolio/slip-events.ts` | The `affected` forecasts are `forwardFinish(S, before set)` / `forwardFinish(S, after set)`. The query also reads the initiatives' `planned_start` and the dependencies' `status`. Slip detection (`predecessorFinish` of the slipped predecessor, `minimumSlipDays`, critical reasons, slip key, outbox) is unchanged. |
| `apps/api/src/modules/portfolio/schedule.test.ts` | 9 Rule B unit tests (§3.2). |
| `apps/api/test/integration/procedures/intake-adoption.test.ts` (new) | Rule A: 3 API tests and 9 database tests (§3.1). |
| `apps/api/test/integration/automation/starters-be-j.test.ts` | **Implementer test (BE-J's), updated as assigned.** The before = after expectation is replaced by Rule B: B and C get planned starts; B, with no slack, moves `2026-12-01 → 2026-12-06`; C, with slack, stays `2027-01-10`; the dependents' stored milestones are unchanged. The header says so. |
| `apps/api/test/integration/procedures/seeded-procedures.test.ts` | **Comments only** (the header line and the "KNOWN GAP" block of the intake test), which Rule A made untrue. No assertion changed. It is a procedures-module test; I list it because BE-G wrote it. |
| `apps/worker/src/handlers/demo.ts` | `DemoResetSettings.devIssuerBinding?`; `demoResetSettingsFromEnv(env)` (the default settings: `loadConfig("worker", env)` plus `demoDevIssuerBindingAllowed({NODE_ENV, AUTH_MODE})`); `resetDemo` gets `devIssuerBinding: s.devIssuerBinding === true`. |
| `packages/db/src/index.ts` | One line: exports `demoDevIssuerBindingAllowed` from `./demo/guard.ts`. |
| `apps/worker/src/handlers/demo.test.ts` (new) | 2 unit tests of `demoResetSettingsFromEnv`. |
| `apps/worker/test/integration/demo-reset-dev-binding.test.ts` (new) | 2 integration tests on a real database (the ledger acknowledgement, then the binding passed through; a redelivery does nothing). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T4-*` | This handback and its logs. |

## 3. Behaviour delivered, per requirement row

### 3.1 REQ-S06-003 (Rule A; D-QA-E-2)

Acceptance: "A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario". Before this task, the intake could not complete, because no approval of its `confirm_sponsor` step could be requested.

**Engine (`steps.ts`).**

- **Adoption.** When `completeStep` completes `capture_intake` of an instance whose `transformation_id` is NULL and whose `procedure_code` is `new_transformation_intake`, with its `transformation` output T, every pending step whose `transformation_id` is NULL gets T. This happens in the same transaction, after the output link and the step completion, and before `advance`. Each adopted step gets:
  - the P2 version step (version + 1, `updated_at`, `updated_by`, optimistic on the version);
  - one audit event `procedure_step_instance.adopt_transformation`, with `transformation_id` T and `changes {transformation_id: {from: null, to: T}}`.
- **The instance keeps its organization scope.** Its `transformation_id` stays NULL, and its read gate, write gate and step actors are unchanged.
- **Approval routing.** `requestStepApproval` requests on the step's own `transformation_id`. For an adopted step that is T, routed by T's role mappings through the DG4 `routeToParty`/`resolveParty`, never a fallback. The requester is the person whose action activated the step, so separation of duties keeps the TL from deciding it (tested).
- **Waiting truthfully.** If T has no mapped Sponsor (`routing.role_unmapped`), or the mapped person is not an approver (`routing.assignee_not_approver`), an **adopted** step waits instead of failing the action that activated it:
  - it stays `active` with no approval;
  - `nextAction` is `await_approval` / `procedures.next_action.await_approval_unrouted`.

  Catching the refusal is safe because `requestApprovalInTx` resolves the party before any insert, so the refusal writes nothing. In a transformation-scope instance the refusal stays the action's 422, as in DG4.
- **Retry.** Once T's Sponsor is mapped, the next action on the instance requests the approval: `advance` starts with `routeWaitingApprovals`, and `updateProcedureInstanceInputs` now calls `advance`. The retry covers only adopted, active approval steps that never had an approval. A rejected or returned approval is never re-requested.

**Database (`0096`).** The only `transformation_id` change the trigger allows:

- from NULL to a non-NULL T;
- on a step that is `pending` before and after, where nothing else changes but `version`, `updated_at` and `updated_by`;
- in an **active** instance with NULL `transformation_id` and code `new_transformation_intake`, in the step's organization;
- only to the T named by that instance's `output`/`transformation` link on its **completed** `capture_intake` step, with T in the same organization.

Every other change is refused with the unchanged constraint name `procedure_step_instance_identity_immutable`. A change on a closed step is refused even earlier, by the 0069 guard (`procedure_step_instance_status_transition`), which fires first in trigger-name order.

**Tests (`intake-adoption.test.ts`, 12, all pass):**

- **API: adoption.** An organization-scope intake instance adopts T when `capture_intake` completes:
  - steps go `[null, null, null]` → `[null (completed), T (active), T (pending)]`;
  - the instance stays organization-scope;
  - there is one adoption audit event per adopted step (prior 1 → new 2, by the TL);
  - a refused completion (422 `output_required`; 403 `procedure_step.not_assignee` for a KDS without the TL role) adopts nothing.
- **API: mapped Sponsor.** With a Sponsor assigned (SP on T) and mapped (TL through `POST /transformations/{T}/role-mappings`):
  - `confirm_sponsor` requests a `procedure_step` approval on T, assigned to `SP` / that Sponsor and requested by the TL;
  - the TL's own decision is refused (separation of duties);
  - the Sponsor approves and the instance completes, with output links transformation, charter and approval.
- **API: no mapped Sponsor.** The step waits truthfully: `active`, `approvalId` null, `await_approval_unrouted`, no approval row. An inputs update still succeeds and keeps it waiting. After T's Sponsor is mapped, the next inputs update requests the approval, the Sponsor decides, and the instance completes.
- **Database refusals**, in rolled-back owner transactions that recreate the state right after `capture_intake` completes, without the adoption:
  - a positive control shows the exact adoption is allowed;
  - a direct UPDATE before the capture step linked a transformation is refused;
  - a different transformation is refused;
  - a second adoption (T → T2, and T → NULL) is refused;
  - a started step is refused (the completed capture step through the 0069 guard; an active step through `0096`);
  - an adoption that also changes another column, or starts the step at the same time, is refused;
  - a **non-intake** organization-scope instance with the same steps and link is refused.
- **Database refusals as the runtime role (`mth_app`)** on committed rows after the API flow:
  - a second adoption of the pending step (to T2, and back to NULL) is refused;
  - the active adopted step is refused;
  - the completed capture step is refused;
  - in a transformation-scope instance (seeded `baseline_validation`), both T → T' and T → NULL are refused.

### 3.2 REQ-S12-012 (Rule B)

Acceptance: "A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic".

`forwardFinishes(facts)(S)` implements D-166 Rule B literally:

- `own = predecessorFinish(S, set)`.
- **Scheduled predecessors** are the initiative predecessors of dependencies for which `isScheduled` holds. Archived and resolved dependencies do not count.
- **Without a scheduled predecessor**, the result is `own`.
- **Otherwise:**
  - `required` is the latest `forwardFinish(P)` over S's predecessors. That date itself is the first start ADR-0023 §5 allows, because `schedule.before_predecessor` flags only `planned_start < finish`; a unit test covers this.
  - `shift = max(0, required − planned_start)` in calendar days.
  - The result is `own + shift`.
- **Unknown (`null`)**, never 0 nor the unshifted date, when there is a predecessor but no planned start, or any input date is missing. An initiative not in the set is also Unknown.
- **Memoized.** A revisit returns Unknown instead of looping. DG4 refuses cycles, so a revisit cannot occur.

`slip-events.ts` records `forecastFinishBefore` / `forecastFinishAfter` as `forwardFinish` over the before and after sets, which differ only in the slipped milestone. It covers every initiative reachable from the slipped dependency's successor (the existing BFS). Nothing else is stored or overwritten.

**Tests:**

- **Unit (`schedule.test.ts`, 9 new; 23 in the file):**
  - no slack: moves by 5;
  - enough slack: no move;
  - partial slack: moves by 3;
  - a start on the predecessor's finish: no shift;
  - a chain of two across a month end: both move by 5;
  - two predecessors: the latest decides;
  - a missing `planned_start`: Unknown;
  - a missing predecessor or own date: Unknown;
  - no scheduled predecessor (archived or resolved): equals `predecessorFinish`, and an unknown id is Unknown.
- **Integration (`starters-be-j.test.ts`):**
  - a 5-day slip of A on the critical path records one slip;
  - its `affected` holds B `2026-12-01 → 2026-12-06` (no slack, moves by the slip) and C `2027-01-10 → 2027-01-10` (slack, no move), as literal dates;
  - the stored milestones of B and C are unchanged;
  - starter 9 notifies BO, the owner of B and C, **once** (replay ×3 adds nothing), as before;
  - the other REQ-S12-012 tests are unchanged: a move earlier raises nothing, a non-critical dependency raises nothing, a breached needed-by raises one slip, and a slip below `minimumSlipDays` raises nothing.

### 3.3 REQ-S18-004 / REQ-S18-001 (scope 3, the dev-mode demo stack)

REQ-S18-004 acceptance: "A02: an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records". BE-T3's D-165 binding makes that browser path possible. An in-app reset (`demo.reset`) now keeps it: the worker passes `devIssuerBinding: demoDevIssuerBindingAllowed({NODE_ENV, AUTH_MODE})`, the same rule as `mth-db reset-demo`, which is true only with `AUTH_MODE=dev` and never with `NODE_ENV=production`. In every other mode, nothing is bound.

Tests:

- **Unit:** development and test with `AUTH_MODE=dev` give true; no `AUTH_MODE`, `oidc` and `production` give false.
- **Integration (real database):** the request is acknowledged in `processed_message` before the reset runs; then `resetDemo` receives `devIssuerBinding: true` (or false when unset or false), with `requestedVia: api`; a redelivery is `duplicate` and starts no second reset.

## 4. Checks actually run (exit codes and counts)

All ran in this worktree, one at a time (D-164 load rule), on Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-T4-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | `PASS gate DG4 (historical)` (run first) | (console) |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint` | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (first run) | **123** | 3 of my new test files were not formatted. I ran `prettier --write` on them (whitespace only). | `prettier-run1-exit123.log` |
| 5b | the same check, re-run | 0 | all files formatted | `prettier.log` |
| 5c | `npx eslint --max-warnings=0` on the 3 reformatted files (lint ran before the reformat) | 0 | clean | `lint-after-prettier-write.log` |
| 6 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations` | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --configLoader runner --project unit-node` | 0 | 142 files, **2328 passed** | `unit-node-locale-unset.log` |
| 8 | `env -u LANG -u LC_CTYPE LC_ALL=C.UTF-8 npx vitest run --configLoader runner --project unit-node` | 0 | 142 files, **2328 passed** | `unit-node-c-utf8.log` |
| 9 | `QA_PG_PORT=23700 MTH_PORT_POOL=23701-23749 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/{procedures,automation,portfolio,contract,environment} packages/db/test/integration apps/worker/test/integration/demo-reset-dev-binding.test.ts` | 0 | 50 files, **618 passed**, 0 failed, 0 skipped. Among them: `intake-adoption` 12, `seeded-procedures` 13, `starters-be-j` 9, `demo-reset-dev-binding` 2. Fresh database: 88 migrations. | `integration.log` |

**During development** (not counted above): `intake-adoption.test.ts` failed 3 of 12 on its first run. All three were test-setup mistakes, not product defects:

- the 0069 closed-step guard answers first for a completed step;
- the transformation adapter takes only a transformation created after the launch;
- the seeded launch roles are TO.

I fixed the tests; the next run passed 12/12. The worker integration file passed 2/2 and `schedule.test.ts` passed 23/23 on their first runs.

**Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite. They are the orchestrator's merged-tree verification. The web unit project (`unit-web`) is not reached by this change and was not run.

**Pinned counts.** `contract.test.ts` pins are unchanged: no operation, media type or rate limit changed. A fresh database applies **88 migrations** (`0096` included), per the integration log header.

## 5. Operations routed (delta to my pending list)

None. This task adds no route and changes no request or response shape, so it has no `p5-pending-be-t4.ts` or `p5-exercises-be-t4.ts`. `contract.test.ts` is unaffected.

## 6. Contract, schema, dependency and documentation needs (for the orchestrator)

1. **`docs/api/openapi.yaml` (frozen, not mine): an optional wording note.** `updateProcedureInstanceInputs` (`PATCH /procedure-instances/{id}/inputs`) may now also request the business approval of an adopted intake step that was waiting for its Sponsor mapping. The response shape and the refusals are unchanged. `completeProcedureStep` likewise adopts the intake's transformation on `capture_intake`. If the descriptions should say so, that is the contract owner's edit.
2. **For T-DG5-ARCH-R1 (ADR-0042 / ADR-0044 amendments and the data dictionary), facts to record:**
   - **Rule A, as implemented:**
     - the 0096 function `procedure_step_instance_row_guard()` and its exact conditions (§3.1);
     - the audit action `procedure_step_instance.adopt_transformation`;
     - the routing wait of an adopted step on `routing.role_unmapped` / `routing.assignee_not_approver`;
     - its retry by the next instance action (`advance`; `updateProcedureInstanceInputs` now calls it).
   - **Rule B, as implemented:**
     - `forwardFinishes` in `portfolio/schedule.ts`;
     - "first allowed start = the predecessor's forward finish itself" (ADR-0023 §5 flags only `planned_start < finish`);
     - only initiative predecessors of scheduled dependencies count; an external predecessor is not part of the forward pass, as in the existing slip query.
3. **For QA-E2 (the intake under Rule A):** the Sponsor must hold SP on the produced transformation and be mapped there (the TL maps through `POST /transformations/{T}/role-mappings`). Either:
   - map the Sponsor before `draft_charter` completes, and `confirm_sponsor` is requested as it activates; or
   - map it afterwards and send any inputs update (`PATCH …/inputs`, `If-Match`), which requests it.

   Then the Sponsor decides through `POST /approvals/{id}/decisions`.
4. **Dependencies:** none. **Secrets:** none.

## 7. User-facing texts

No en/ar string is made untrue. I searched `apps/web/src/i18n/{en,ar}` for the intake, unrouted/awaiting-routing, dependency-slip and forecast wording:

- `workflowsP5.json` `nextAction.await_approval` ("Waiting for the business approval") stays true;
- `myWork.json` `dependency_slip` ("A critical dependency slipped") stays true;
- no string calls Rule A or Rule B planned.

The only stale wording I found was in code comments, which I corrected in my files (`steps.ts` header, `slip-events.ts` header) and in `seeded-procedures.test.ts` (comments only). This handback passes `npx prettier --check`.

## 8. Merge instructions

- **Migration:** `0096_p5_intake_adopts_transformation.sql` (additive; strictly after `0095`; `seed.test.ts` passes in `unit-node`). Run `mth-db migrate` as usual.
- **Expected conflicts:** none with the W21 tasks:
  - T-DG5-ARCH-R1 edits `docs/architecture/**`;
  - FE-D4 edits `apps/web/**` and the web e2e;
  - QA-E2 and QA-F2 edit `tests/qa/**` and root `e2e/**`.

  Of the files outside my two module trees, `starters-be-j.test.ts` and `apps/worker/src/handlers/demo.ts` are named in my ownership, and `seeded-procedures.test.ts` has comment-only changes.
- **Implementer-test change (disclosed):** `apps/api/test/integration/automation/starters-be-j.test.ts` (BE-J's) now expects Rule B, as the assignment requires.

## 9. What remains

- Nothing in the assigned scope.
- The OpenAPI description note and the ADR facts in §6 are for their owners.
- The repository-wide suites (§4) are the orchestrator's merged-tree verification (D-164).
