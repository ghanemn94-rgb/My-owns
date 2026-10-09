# Handback T-DG4-BE-J (backend-workflow-engineer): status model, transition decisions and the governed closure

- **Stage / gate:** P4, DG4 (BUILDING). Section `docs/architecture/p4-work-split.md` §F+G FG.6.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-J.md` (sha256 `6ea08fd7…9c1f0`, verified before starting).
- **Invocation:** `DG4-T-DG4-BE-J-backend-workflow-engineer-20261009T160403Z-9ff9d32d`, session `9ff9d32d-eb8c-43d7-9be2-a9c2c9348a6d`.
- **Working tree:** worktree `/home/user/wt/dg4-be-j`, branch `dg4/be-j`, base `HEAD` `89df7f7` (`git status` clean apart from sandbox stub files). **Changes are left uncommitted** for the orchestrator.
- **Time:** started `2026-10-09T16:04:14Z`; end time in §6.
- **Two gate systems.** Product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7. The closure **reads** the G6 `gate_instance` status and never writes it. No agent, job or seed grants an approval. Every approval decided in the tests is a synthetic decision on synthetic data, made by a test user and never by the requester. The approved G6 used in the tests is a **synthetic fixture** (§4.6).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/sustainment/status-model.ts` | Implements `getInitiativeStatusModel`, `getTransformationStatusModel`, `completeInitiativeDelivery` and `setInitiativeAdoptionStatus`. Exports `valueStatusOf(db, subject)` (ADR-0034 §2), `initiativeStatusModel`, `transformationStatusModel`, `bauStateOf` and `isValuePending`. |
| `apps/api/src/modules/sustainment/transition-decisions.ts` | Implements `list/create/get/update/submitTransitionDecision` and the approval port `wireTransitionDecisionApprovals`. Also holds the `benefit_transition_decision` subject provider (`applyTransitionDecisionOutcome`) and the exported `scheduleMonitoringReviews(tx, today, opts)`. |
| `apps/api/src/modules/sustainment/closure.ts` | Implements `closeInitiative`, `closeTransformation` and `listClosureRecords`. The ADR-0034 §7 checks run in order under lock class `closure`; a transformation closure sets `status = 'closed'` and never sets `archived_at`. |
| `apps/worker/src/handlers/sustainment.ts` | Adds the worker twin of the API's monitoring-review insert, `scheduleMonitoringReviewInTx`, and `runMonitoringScan`. Both run **after** BE-I2's area part in the `sustainment.review_scan` handler, through `runSustainmentReviewJob`. BE-I2's lines are unchanged. |
| `packages/shared/src/schemas/sustainment-closure.ts` (new) | Zod mirrors: `statusNote`, `initiativeAdoptionStatusSet`, `initiativeStatusModel`, `transformationStatusModel`, `closureRecord(Page)`, `transitionDecision(Page/Create/Update)`, plus the label and status vocabularies. |
| `packages/shared/src/schemas/index.ts` | Adds one export line, after BE-I2's line. |
| `apps/api/src/modules/platform/db-errors.ts` | Adds the BE-J lines of the slices F/G block: `mapP4SustainmentClosureError` and its one call, after BE-I2's. |
| `apps/api/src/modules/transformations/routes.ts` | Seam 15: the second sentence of the PATCH closure refusal now reads "Closure requires the G6 (Sustain) business approval with validated benefits; use the closure action." The status (422) and type (invalid-transition) are unchanged. |
| `apps/api/test/integration/transformations.test.ts` | Pins the new seam-15 text exactly. The old text was pinned nowhere (only `/G6/`), so no other DG1–DG3 test needed a change. |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin `[280, 279, 1]` → `[286, 285, 1]` (+6), with its comment. |
| `apps/api/test/support/p4-pending-be-j.ts` | Pending list: 12 → 0. |
| `apps/api/test/integration/contract/p4-exercises-be-j.ts` | Exercises the 12 operations through `ctx.mirrored`, with their zod mirrors. Also holds the shared fixtures: `seedClosureWorld`, `launchedInitiative`, `deliveredInitiative`, `pendingBenefit`, `validatedBenefit` (the real Finance path), `approveG6Synthetic`, `draftDecision`, `decideDecision`, `closeTransformationGoverned`. |
| `apps/api/test/integration/sustainment/status-model.test.ts` (new, 9 tests) | Proves REQ-S03-003, REQ-PB-009 (label), REQ-S11-006 and REQ-PB-069. |
| `apps/api/test/integration/sustainment/transition-decisions.test.ts` (new, 10 tests) | Proves REQ-S11-007 and includes the D-102 parity test. |
| `apps/api/test/integration/sustainment/closure.test.ts` (new, 9 tests) | Proves REQ-PB-009 (422) and REQ-S03-003 (closure). |
| `apps/api/test/integration/sustainment/reopen.test.ts`, `lessons.test.ts`, `apps/worker/test/integration/sustainment-scans.test.ts` | The closure fixture now goes through the governed closure (§4.7). |

**Migrations:** none. No schema change was made (see §4 for the schema-level findings).

## 2. API endpoints added (12; pending list 12 → 0)

| Operation | Method and path | Permission (record rule) |
|---|---|---|
| `getInitiativeStatusModel` | `GET /api/v1/initiatives/{initiativeId}/status-model` (ETag) | `transformation.read`; 404 outside scope |
| `completeInitiativeDelivery` | `POST /api/v1/initiatives/{initiativeId}/complete-delivery` (If-Match) | `initiative.complete_delivery` (WL, TL) |
| `setInitiativeAdoptionStatus` | `POST /api/v1/initiatives/{initiativeId}/adoption-status` (If-Match) | `adoption_status.set` (BO) |
| `closeInitiative` | `POST /api/v1/initiatives/{initiativeId}/close` (201) | `initiative.close` (TL) |
| `getTransformationStatusModel` | `GET /api/v1/transformations/{t}/status-model` | `transformation.read` |
| `closeTransformation` | `POST /api/v1/transformations/{t}/close` (201) | `transformation.close` (TL) |
| `listClosureRecords` | `GET /api/v1/transformations/{t}/closure-records` | `transformation.read` |
| `listTransitionDecisions` | `GET /api/v1/transformations/{t}/transition-decisions?benefitId=&status=` | `transformation.read` |
| `createTransitionDecision` | `POST /api/v1/transformations/{t}/transition-decisions` (201, Location, ETag) | `transition_decision.propose` (BO, FIN) |
| `getTransitionDecision` | `GET …/transition-decisions/{d}` (ETag) | `transformation.read` |
| `updateTransitionDecision` | `PATCH …/transition-decisions/{d}` (If-Match; `status: withdrawn` withdraws) | `transition_decision.propose` |
| `submitTransitionDecision` | `POST …/transition-decisions/{d}/submit` (If-Match; bodiless, so no `consumes`, S-3) | `transition_decision.propose`; the decision is made through the canonical approval (`approval.decide`; requester excluded) |

Every mutation follows the same sequence. The read gate runs first: ADM-only users and outsiders get 404. The write permission is then re-checked **at commit time** on reloaded grants (AUD 403). Validation follows (S-1 free text). If-Match applies where the contract declares it (428 when missing, 409 when stale). Creates and closes are version 1. Each mutation writes its audit event in the same transaction and does no remote I/O. Each of these is tested, including commit-time revocation on `completeInitiativeDelivery`, `createTransitionDecision`, `submitTransitionDecision`, `closeInitiative` and `closeTransformation`.

## 3. Behaviour delivered, per requirement row (acceptance texts quoted from `requirements.csv`)

### REQ-PB-009: "A11: an initiative with delivery=Complete and no validated benefit cannot be closed (API 422 invalid-transition); UI shows 'Delivered — value validation pending'"

- `closeInitiative` runs the ADR-0034 §7 checks in order, and the first failure answers:
  - not `completed` → 422 invalid-transition `closure.delivery_not_complete`;
  - already closed → 409 `closure.already_closed`;
  - value `no_benefit`/`validation_pending` → **422 `urn:mth:problem:invalid-transition` `closure.value_validation_pending`**, with the exact ADR-0034 §12 initiative text;
  - a validated benefit without a BAU owner → 422 `closure.sustainment_owner_missing`.
- Then it writes the closure record (basis, plus a snapshot of the measurement ids or the transition decision per benefit) and the audit event `initiative.close`.
- Lock class `closure` (`ADVISORY_LOCK_CLASSES.closure`), key `initiative:<id>`. Concurrent closes give one 201 and one 409.
- `getInitiativeStatusModel` label: `"Delivered — value validation pending"` when delivery is `completed` and the value status is `no_benefit` or `validation_pending`.
- Tests:
  - `closure.test.ts` "REQ-PB-009: delivery Complete and no validated benefit cannot be closed (422 invalid-transition)", which covers both no benefit and a pending benefit and checks the label;
  - `status-model.test.ts` "REQ-PB-009: … 'Delivered — value validation pending'".
- The UI half belongs to FE-F (`pages/closure/**`).

### REQ-S03-003: "A11: setting delivery to Complete leaves adoption, validated value and closure unchanged; the API rejects a closure request while validated value is pending unless a transition decision exists"

- `completeInitiativeDelivery` (WL, TL) writes only `status = 'completed'` and the delivery stamps (`launched → completed`; anything else is 422 `initiative.delivery_not_launched`). The optional note goes to the audit `reason`.
- `status-model.test.ts` proves the other three statuses are unchanged on the row and in the model: adoption `not_assessed` and no stamps, value `validation_pending`, closure `open`, no closure row.
- `setInitiativeAdoptionStatus` (BO) is the only writer of `adoption_status`. `not_assessed` or an unknown value gives 422 `initiative.adoption_status_invalid` at `/adoptionStatus`, with the exact text.
- `closeTransformation` checks, in order:
  1. archived → 422 `transformation.archived` (the DG1 code and text);
  2. already closed → 409;
  3. not active/on_hold → 422 `closure.transformation_not_open`;
  4. G6 not `approved` → 422 `closure.g6_not_approved`;
  5. value pending → **422 invalid-transition `closure.value_validation_pending`** (transformation text);
  6. an area not in BAU → 422 `closure.bau_not_accepted`.
- On success it writes the record, sets `status = 'closed'` with version + 1, and writes the audit events `transformation.close` (record) and `transformation.closed` (transformation). **`archived_at` stays NULL**, and an improvement item is still created after closure.
- `closure.test.ts` walks every refusal in order. It then **succeeds once an approved transition decision covers the pending benefit, with G6 approved and the areas in BAU**.

### REQ-S11-006: "A11: with all initiatives complete and value pending, the transformation shows 'Delivery complete - value validation pending', not successful"

- `getTransformationStatusModel` returns `deliveryState`, `valueState`, `bauState`, `closureState`, `label`, `initiatives {total, completed}` and `performanceAreas {total, bau}` side by side. Initiatives exclude `cancelled`; areas exclude `retired`.
- The label rules are exactly ADR-0034 §2. No label contains "success", and the test asserts that over the whole body.
- `status-model.test.ts` covers "REQ-S11-006 …": an empty transformation reads "In delivery"; one of two initiatives complete reads "In delivery"; all complete with the value pending reads **"Delivery complete - value validation pending"**. `closure.test.ts` also shows "Value validated - BAU accepted" and "Closed".

### REQ-S11-007: "A11: after the transition decision, the benefit's forecast is still shown as forecast and monitoring tasks appear for the residual owner"

- Transition decisions are drafted by BO or FIN, edited, and withdrawn.
- `submitTransitionDecision` requests the canonical approval of type `benefit_transition_decision` through BE-B's `requestApprovalInTx`. It is routed to party **SP**, with SoD `requester_excluded`, so the requester gets 403 on their own approval.
- The provider applies the outcome in the deciding transaction:
  - **approve** → `approved`, `decided_*`, `next_monitoring_date = first_monitoring_date`, and the monitoring reviews already inside the 7-day horizon;
  - **reject** → `rejected`;
  - **changes requested** → an editable draft. Resubmission goes through `POST /approvals/{id}/resubmit`.
- **Forecast stays forecast:** the test compares `GET …/benefits/{id}/values`, the benefit row (version, lifecycle step, BAU owner) and its measurements before and after the decision; they are identical. The value status becomes `validated_with_transition` (per benefit: `transition`), never validated or sustained.
- **Monitoring tasks for the residual owner:**
  - a `sustainment_review` of subject `transition_decision`, assigned to the residual owner, due on `firstMonitoringDate`;
  - a `benefit_monitoring_due` work item in the residual owner's `GET /api/v1/me/work-items`;
  - created **exactly once** (a rerun of the API service and the worker scan creates nothing), and completed by the residual owner.
- The daily `sustainment.review_scan` creates the following reviews through `runMonitoringScan`, up to the expected realization end.
- **D-102 parity:** the worker's `runMonitoringScan` and the API's `scheduleMonitoringReviews` write the same review, work item, audit and decision rows (`transition-decisions.test.ts`, "parity (D-102 (2))").

### REQ-PB-069 (status-model part, with KBE-F): "A11: an initiative with delivery Complete and adoption below trajectory shows adoption at risk and triggers an intervention …"

- An initiative with delivery Complete and a below-trajectory evaluation shows `adoption: "at_risk"`, `adoptionSource: "indicator"`. The test uses a synthetic red/adverse evaluation scoped to the initiative and consumed by **KBE-F's real `handleIndicatorEvaluated`**, which creates exactly one intervention.
- The stored owner status (`adopted`) is not overwritten. Once the intervention is `done`, the owner's status and source `owner` show again.

## 4. Contract and schema needs, deviations, and decisions for the orchestrator

1. **Wiring line (production gap until merged).** Sustainment may not import `workflows`: `architecture.test.ts` says "only governance imports workflows" (p4-plan §2). `server.ts` and `sustainment/index.ts` are frozen for me (FG.0). So the approval service reaches `transition-decisions.ts` through a port that must be wired by the composition root, as KBE-C's `KpiApprovalPort` was. **Until the orchestrator adds the two lines below, `submitTransitionDecision` fails closed in a running server (500, nothing written).** Every other operation works unwired, and so does deciding an existing approval. The tests and the contract exercise wire the port themselves (`wireApprovals()` in `p4-exercises-be-j.ts`).
   ```ts
   // apps/api/src/modules/sustainment/index.ts (export line)
   export { wireTransitionDecisionApprovals } from "./transition-decisions.ts";
   // apps/api/src/server.ts (next to registerSustainmentModule; requestApprovalInTx and registerApprovalSubject are already imported for KPI)
   wireTransitionDecisionApprovals({ requestApproval: requestApprovalInTx, registerSubject: registerApprovalSubject });
   ```
2. **Exports for consumers (FG.8).** Cross-module imports go through `sustainment/index.ts`, which I may not edit. KBE-G (slice J) and BE-K need these export lines added by the orchestrator or by the consuming task:
   - `valueStatusOf`, `initiativeStatusModel`, `transformationStatusModel` and `bauStateOf` from `./status-model.ts`.
   - BE-K's `sustainment/gate-facts.ts` sits inside the module and can import them directly.
3. **Stored transition-decision status while in approval: a deviation from ADR-0034 §3 that needs architect acceptance or a repair migration.** Three guards together make the ADR's "draft → submitted (with its canonical approval)" store impossible without staling its own approval:
   - the 0031 guards bind `approval.subject_version` to the decision's **row version**, both at the approval's insert and at every decision;
   - the 0010 guard steps the version by exactly 1 on every update;
   - the 0048 CHECK `transition_decision_decided_complete` needs `approval_id` on a `submitted` row.

   As built:
   - submit requests the approval on the draft's current version and does not update the row;
   - the API **presents** the decision as `status: "submitted"` with its `approvalId` while the approval is pending or deferred. The list filters use the same effective status;
   - the service refuses content edits in that state (422 `transition_decision.frozen`), and any edit would also make the approval stale (409 at the decision);
   - on approve or reject, the provider moves the row draft → submitted (setting `approval_id`) → approved/rejected in the deciding transaction, after the guard has passed. So a stored `submitted` row exists only inside that transaction.

   Consequences:
   - the audit trail shows `transition_decision.submit` at decision time, not at request time;
   - a decision withdrawn while its approval is pending leaves that approval open but undecidable (409 `approval.stale_version`). There is no subject-side withdraw in BE-B's service.

   Repair options for the architect: either a `currentVersion` subject provider that the 0031 guard honours, or a migration that lets the approval re-bind `subject_version` on the subject's own submit step.
4. **Closure note length.** `closure_record.closure_note` is 3–2000 characters in `0048`, while the contract's `StatusNote.note` is 1–2000. The close routes answer 400 at `/note` for 1–2 characters, which the contract allows (400), instead of letting the database refuse.
5. **New audit action names and work-item message key** (not listed in the ADR):
   - audit actions: `initiative.complete_delivery`, `initiative.set_adoption_status`, `initiative.close`, `transformation.close`, `transformation.closed`, `transition_decision.{create,update,withdraw,submit,approve,reject,monitoring_scheduled}`;
   - work-item message key: `sustainment.task.benefit_monitoring_due`, with params `decisionCode` and `dueDate`.

   These need EN/AR labels from FE-A/FE-F. No new problem code was added beyond ADR-0034 §12. I reuse `validation.reference` and BE-B's `approval.already_open` (a draft whose approval has changes requested is resubmitted through the approval).
6. **Synthetic approved G6 in tests.** G5/G6 decisions are routed by slice H (BE-K, not merged), and DG3's guard keeps G5/G6 submission disabled. The tests therefore build an approved G6 with `approveG6Synthetic`:
   - the `gate_instance` row is written with its audit event;
   - the DG3 portfolio fixture `setGateStatus` then writes a pending submission and the status `approved`, through the app role with audit events.

   It approves nothing and never implies DG7. Once BE-K lands, the closure tests could switch to a real G6 decision.
7. **Closure fixtures replaced:**
   - `reopen.test.ts`, `lessons.test.ts` and `apps/worker/test/integration/sustainment-scans.test.ts` now close through the governed `closeTransformation`, using `closeTransformationGoverned`: SP mapped, synthetic G6, every pending benefit covered by an approved transition decision. These tests only needed a closed transformation.
   - **Not replaced:** `improvement.test.ts` and `performance-areas.test.ts` deliberately close a transformation that still has an `establishing` area. The governed closure correctly refuses that (`closure.bau_not_accepted`), so those two keep BE-I's `closeTransformationSynthetic`. That function stays in `p4-exercises-be-i.ts`, unedited.
8. **Interpretations, for reviewers:**
   - `closeTransformation` checks "already closed" (409) before `transformation_not_open`. Otherwise a closed transformation could never reach the contract's 409.
   - An adoption status may be set on any initiative status.
   - Approval title: `"<TD code> · <benefit code>"`.
   - Approval due date: Unknown with reason `no_sla` (the ADR-0026 rule when no SLA type applies), as governance does.

## 5. Checks actually run (logs in `docs/delivery/handbacks/DG4/T-DG4-BE-J-evidence/`)

Environment: Node 24.21.0 offline; disposable PostgreSQL 16.13 through `tests/qa/support/with-pg.sh` on ports 24352–24399.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | (start of run; re-run at the end, row 9) |
| 1 | `pnpm -r typecheck` | 0 | clean | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | clean | `build.log` |
| 3 | `pnpm lint` | 0 | clean | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` | `openapi-lint.log` |
| 6a | `pnpm test`, locale unset (**first run**) | **1** | **2 failed** / 2288 passed. Both were mine, and both are fixed: `architecture.test.ts` (a computed member lookup in `transition-decisions.ts`, replaced by a `Map`) and `advisory-locks.test.ts` (I had written the lock number in two comments; removed). | `unit-locale-unset.run1-FAILED.log` |
| 6b | `pnpm test`, locale unset (re-run after the fix) | 0 | unit-node+unit-web **2290 passed**; unit-formula-nocodegen **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | **2290 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=24352 MTH_PORT_POOL=24353-24399 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **135 files, 1441/1441 passed** (1413 at the base + 28 new: status-model 9, transition-decisions 10, closure 9). Duration 793 s. No failure, retry or timeout in the log. | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |
| 10 | Final re-run on the final tree (test files had changed after rows 1, 3 and 4): `pnpm -r typecheck`, `pnpm lint`, the prettier check of row 4 | 0, 0, 0 | clean | `typecheck-final.log`, `lint-final.log`, `prettier-final.log` |

Every exit code, in run order, is in `exit-codes.txt`. Its non-zero entry is the disclosed first unit run, 6a.

Targeted runs during development (scratch logs, not evidence):
- the first `pnpm lint`: exit 1 on one unused import (`insertInitiative`) in `p4-exercises-be-j.ts`; fixed before row 3.
- contract test: first run 2 failures, caused by a fixture date relative to the real clock; fixed by using far-future dates. Then 45/45.
- `status-model`: 9/9.
- `transition-decisions`: 9/9.
- `closure`: 8/8.
- `reopen` + `lessons`: 10/10.
- worker `sustainment-scans`: 5/5.
- my three suites after adding the commit-time tests: 28/28.

Pinned counts: media-type pin `[280, 279, 1]` → `[286, 285, 1]`, i.e. +6 JSON bodies (`completeInitiativeDelivery`, `setInitiativeAdoptionStatus`, `closeInitiative`, `closeTransformation`, `createTransitionDecision`, `updateTransitionDecision`; `submitTransitionDecision` is bodiless). The operation count is unchanged (607). The unit count is unchanged at 2290 (no unit tests added).

## 6. End state and what remains

- **Ended:** `2026-10-09T17:21Z`, about 77 minutes after the start. Free disk at the last full run: 22 GB.
- **Integration:** 1441/1441 passed (exit 0). The integration count rises from 1413 to 1441 (+28). The unit counts are unchanged.
- **Done:** all 12 operations of FG.6 are routed and exercised. `p4-pending-be-j.ts` is empty, so the pending delta is −12. The status-model, transition-decision and closure behaviour of the four rows (REQ-PB-009, REQ-S03-003, REQ-S11-006, REQ-S11-007) and the status-model part of REQ-PB-069 are delivered and tested. The worker's monitoring part of `sustainment.review_scan` is in place, with its D-102 parity test. Seam 15 is done, and 3 of the 5 closure-fixture call sites now use the governed closure.
- **Remains / needs the orchestrator:**
  1. **The two wiring lines of §4.1.** Without them, `submitTransitionDecision` answers 500 in a running server. This is a known production gap until merged, and the integration tests wire the port themselves.
  2. The `sustainment/index.ts` export lines for slice J and BE-K (§4.2).
  3. An architect decision on the stored-status deviation (§4.3). A repair migration may be needed.
  4. EN/AR labels for the new audit actions and the `benefit_monitoring_due` message key (§4.5), for FE-A/FE-F.
  5. The UI of these statuses and actions belongs to FE-F (`pages/closure/**`) and is not part of this task.
- **Not mine:** the untracked `CLAUDE.local.md` and dotfiles in the worktree root are sandbox stub files. I did not create or edit them.

## 7. Merge instructions

- Migrations: none.
- Expected conflicts, all of the union kind the orchestrator already resolves:
  - `packages/shared/src/schemas/index.ts` (one export line after BE-I2's);
  - `apps/api/src/modules/platform/db-errors.ts` (one new mapper function and its call, both placed after BE-I2's. The function ends with `default: return null`, so no dangling `case` label);
  - `apps/api/test/integration/contract/contract.test.ts` (media-type pin: add +6 to whatever the concurrent pins sum to; at my base it is `[286, 285, 1]`).
- `apps/worker/src/handlers/sustainment.ts`: the `SUSTAINMENT_HANDLERS` review entry now calls `runSustainmentReviewJob` (BE-I2's `runReviewScan`, then `runMonitoringScan`). `runReviewScan` is unchanged.
- After merging, add the two lines of §4.1, then re-run the contract test and `transition-decisions.test.ts`. Both also pass wired.
