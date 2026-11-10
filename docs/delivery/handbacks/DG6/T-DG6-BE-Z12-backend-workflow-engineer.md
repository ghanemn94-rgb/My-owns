# Handback T-DG6-BE-Z12 (backend-workflow-engineer): D-218 on every reference to a sensitive record (F-DG6-480)

- **Stage:** DG6, FIXING after review round 7. Task T-DG6-BE-Z12. Finding F-DG6-480 (Medium, REQ-S10-002).
- **Invocation:** `DG6-T-DG6-BE-Z12-backend-workflow-engineer-20261108T090746Z-f60600e9`, session `f60600e9-d84f-49d1-aeed-629ec9429fab`.
- **Base:** branch `dg6/be-z12` at `439ecbd35b819348da5e3e4ffbb79b84b5242475`. The tree was clean at the start. All changes are **uncommitted**, as asked.
- **Times:** start `2026-11-08T09:07:59Z`; end: see the last line of this file.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited 0 (`PASS gate DG5 (historical)`) at the start, and again at the end (`50-validate-dg5-historical-end.log`).
- **Product gates:** marking a record sensitive is an access decision, never a business approval. Nothing here grants or implies G1–G6, and nothing touches DG0–DG7. All test data is SYNTHETIC.

## Assignment discrepancy (please confirm)

The assignment's handback section names `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` and `T-DG6-BE-Z8-evidence/`. Both already exist: they are the merged handback of the earlier task T-DG6-BE-Z8 (F-DG6-380). BE-Z10 and BE-Z10B reported the same copy error. Overwriting them would destroy that record, so I did not touch them. Following the agent protocol's default path, this handback is `docs/delivery/handbacks/DG6/T-DG6-BE-Z12-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z12-evidence/`.

## Requirement row

**REQ-S10-002**, acceptance (quoted): "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant".

D-218 applies it to identifiers: "a response never names the id of a sensitive record the reader is not admitted to. The reference is omitted; where the open record depends on it, a neutral restricted marker without an id is returned, `includesRestrictedRecords: true` is set, and the screen shows the restricted label instead of a link." D-219 excuses exactly three paths: audit events, the grant register, and the phase-step evidence remove response.

F-DG6-480's write rule (the reviewer's expected result): "A write by a not-admitted principal that names a sensitive record by id answers as for an unknown id (or 404), so the write is not an existence oracle and cannot attach a record the writer cannot see."

## 1. How the inventory is derived from the schema, not the seed

The inventory is a module, `apps/api/test/support/sensitive-reference-inventory.ts`, with one row per column: column, kind, what it can name, the operations that serialize it, the state before, the status now, the fix or citation, and the exercise (which test seeds it).

The new test `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` reads the **PostgreSQL catalog** of the disposable database migrated to HEAD. It fails if the catalog and the inventory differ. The catalog side lists:

- every foreign-key column, single or composite, whose referenced column is the `id` of `benefit`, `business_case`, `evidence`, or any `SENSITIVE_CHILD_SOURCES` table (**54**);
- every uuid column with **no foreign key at all** (**59**). This class is where polymorphic `(record_type, record_id)` pairs, scope ids and subject ids live, whatever their names;
- every `uuid[]` column (**2**) and every `json`/`jsonb` column (**84**).

The test fails when:

- a catalog column is missing from the inventory;
- an inventory row is stale or has the wrong kind;
- an operationId it cites is not in `docs/api/openapi.yaml`;
- a `redacted` row has no exercise, or its exercise file does not exist or lacks its fragment;
- the `open` or `PENDING` rows differ from the lists in §6.

Floors on each class stop a broken catalog query from passing by finding nothing.

The sweep (`sensitive-reach-sweep.test.ts`) now imports the inventory. After its setup, for **every row whose exercise is `sweep`**, it checks **in the database** that the column holds one of the hidden ids:

- uuid columns: equals one;
- `uuid[]` columns: contains one;
- JSON columns: the text contains one.

The test fails otherwise. So a row the sweep claims to judge, but does not seed, can no longer pass. This check found five such rows on its first run (§4).

The inventory now has **199 rows**:

| Status | Rows |
|---|---|
| redacted | 46 |
| holder-restricted | 49 |
| cannot-name | 91 |
| D-219 | 2 |
| not-served | 6 |
| own-input | 3 |
| open | 2 |

The statuses mean:

- **holder-restricted:** the row holding the column is itself the sensitive record or a child of it, so it is already 404 or omitted.
- **cannot-name:** a CHECK constraint, the zod enum or the only writer shows the column never holds such an id.
- **own-input:** served only to its author, as they wrote it.

The full table is in §7.

## 2. What was fixed

### Rows F-DG6-480 names

| Reference | Responses | Before | Now |
|---|---|---|---|
| `benefit.parent_benefit_id` | `getBenefit`, `createBenefit`, `updateBenefit`, `archiveBenefit`, `advanceBenefitLifecycle`, the baseline decision | `parentBenefitId` named the hidden parent | `presentBenefits(db, principal, rows)`: null plus `includesRestrictedRecords: true`. **Write:** a hidden parent answers 422 `validation.reference` at `/parentBenefitId`, as an unknown id (`unknownReference`, now exported from the register kit). **Re-save:** a not-admitted writer sending `null` keeps the stored parent (`keptRestrictedRef`). |
| `meeting_output.record_id` | `listMeetingOutputs`, `createMeetingOutput` | `recordId` named the hidden benefit | `hideRestrictedTypedRefs`: the type is kept, `recordId` is null, plus the marker. **Write:** a hidden record answers 422 `meeting_output.record_not_found`, as an unknown record. |
| `launch_task.output_record_id` | `listLaunchTasks`, `getLaunchTask`, `createLaunchTask`, `updateLaunchTask`, `putLaunchTaskPredecessors` | `outputRecordId` named the hidden benefit; a hidden output answered 200 (against 422 for an unknown id), and the link was stored | `presentTasks(db, principal, …)`: the type is kept, the id is null, plus the marker. **Write:** a hidden output answers 422 `launch_task.output_record_invalid`, the same as an unknown id. **Re-save:** null keeps it. |
| `procedure_instance_link.record_id` | `listProcedureInstances`, `getProcedureInstance` and every step write response | `links[].recordId` served raw | A link to a record the reader is not admitted to is **not listed** (the link exists only to name the record; the same rule as BE-Z10B's phase-step evidence), plus the marker. **Write:** `linkProcedureStepEvidence` and the generic output link (`requireNamedRecordRead`) answer `procedure_step.output_record_invalid` for a hidden record, the same refusal as an unreadable or unknown one. |
| `procedure_instance.subject_record_id` | the same | served raw | `subjectRecordId` is null, plus the marker. The launch never checks a subject's existence for any id, so a hidden id is accepted exactly as an unknown one: no oracle. |
| `procedure_instance.input_values` (JSON) | the same | served raw | `redactRestrictedIds`, plus the marker. |

### Rows the inventory found (not in F-DG6-480)

| Reference | Responses | Before | Now |
|---|---|---|---|
| `benefit.business_case_line_id` | the benefit responses above | named a line of a hidden business case; naming such a line on write answered **409 `benefit.case_line_taken`** when it was taken (an oracle) | null plus the marker. **Write:** a hidden line answers 422 `benefit.case_line_invalid`, as an unknown line, before the "taken" check. Null keeps it. |
| `action_item.corrective_case_id` | `listActionRegister`, `getActionRegisterItem`, `updateActionRegisterItem` | named the sensitive benefit's variance case | `correctiveCaseId` is null, `sourceKind` stays `corrective_case`, plus the marker. The case's own action routes already answer 404. |
| `sustainment_review.transition_decision_id` | `listSustainmentReviews`, `completeSustainmentReview` | named the sensitive benefit's transition decision | null plus the marker. |
| `approval.subject_id` | `listMyApprovals`, `getApproval`, `requestApproval`, `decideApproval`, `resubmitApproval`, `withdrawApproval`, `requestKpiVersionApproval`, `submitGovernanceMatrix` (through `toApprovals`), `listApprovalDecisionRecords` | `approval_type` `benefit_transition_decision` names a transition decision, a benefit child | `subjectId` is null and the type is kept, plus the marker. **Contract type widening** (§5). |
| `revision_proposal.impact` / `.validation_report` (JSON) | `listRevisionProposals` | `impact.affectedBenefits[]` listed `{benefitId, code}` of every benefit using the formula, sensitive ones included | `redactRestrictedIds`: the entry is dropped and the counts (`affectedRecords`) are unchanged ("Totals and rollups"), plus the marker. The stored impact is unchanged. |
| **The orphan report** (found by the inventory-seeded sweep) | `getOrphanReport` | listed a sensitive benefit **itself** (id, code, label) when it has no links: the demo benefit the earlier sweeps used always had links | `withoutRestricted`: the record is not listed (ADR-0051 §2). |

### Rows checked and already correct

Two rows were redacted by BE-Z10 but never seeded: `kpi_actual_evidence` and `bau_handover_evidence`. The demo references neither, so BE-Z10's `referenced` loop skipped them. The sweep now seeds both. Their redaction holds (no leak).

### Re-save rule

This is D-218's continuation (`keptRestrictedRef`, BE-Z10B). It now also covers:

- the benefit PATCH (`parentBenefitId`, `businessCaseLineId`), including the forms bulk edit, which uses the same core;
- the launch-task PATCH (`outputRecordId`).

A writer admitted to the stored record clears it with null exactly as before. The tests check both cases.

## 3. Write-side rule (item 3)

New helper `refIsRestricted(db, principal, recordType, id)` in `access/sensitive-reach.ts`: one policy decision, true only for a sensitive type, or a child type, that the principal is not admitted to. Every write that accepts a reference from the inventory now treats a hidden id exactly like an unknown id:

Column "Hidden id, before": only the launch-task row was observed before the fix (`01-before-fix-z12.log`: `{ status: 200 }` against 422). The other before-fix tests stopped at their first assertion, which is a read, so the other entries in that column come from reading the code.

| Write | Unknown id | Hidden id, before | Hidden id, now |
|---|---|---|---|
| `updateLaunchTask` `outputRecordId` | 422 `launch_task.output_record_invalid` | **200, stored** | 422, identical (status, code, errors) |
| `updateBenefit` / `createBenefit` `parentBenefitId` | 422 `validation.reference` | 200, stored (when the parent had no values) | 422, identical |
| `updateBenefit` / `createBenefit` `businessCaseLineId` | 422 `benefit.case_line_invalid` | 200, or 409 `case_line_taken` | 422, identical |
| `createMeetingOutput` `recordId` | 422 `meeting_output.record_not_found` | 201 | 422, identical |
| `linkProcedureStepEvidence` `evidenceId` | 422 `procedure_step.output_record_invalid` | 200, linked | 422, identical (the same problem keys) |
| `completeProcedureStep` `outputRecordId` (link outputs) | 422 `procedure_step.output_record_invalid` | 200 | 422, identical (`requireNamedRecordRead`) |
| `launchProcedureInstance` `subjectRecordId` | 201 (no existence check for any id) | 201 | 201: identical, so no oracle; the response then shows null plus the marker |

The other writes in the inventory that accept a reference to a sensitive type were already refused by BE-Z10 and BE-Z10B, or do not exist. The latter covers rows whose references are set only by the system, such as blockers, closures and snapshots.

## 4. Tests (item 4)

**The reviewer's repro, ported:** `apps/api/test/integration/access/sensitive-reach-id-refs-z12.test.ts`, on the real demo dataset. The not-admitted reader is `tl2`, a TL who created nothing (never a named party), as in the repro. It has 6 tests:

1. Control: TL and tl2 get 404 on the hidden benefit and evidence; the TO reads both.
2. B1 `parentBenefitId`:
   - tl2 gets null plus the marker; the TO gets the id;
   - tl2's PATCH naming the hidden parent answers exactly as a random id;
   - tl2's null re-save keeps the parent;
   - `tl`, admitted as the parent's creator (a named party), clears it with null.
3. Business-case line: the read redaction, and the write answering as an unknown line (no 409).
4. B2 meeting output: the read, and `createMeetingOutput` answering hidden equal to unknown.
5. B3 launch task:
   - unknown 422 equals hidden 422, and nothing is stored;
   - after the TO attaches it, tl2's list and item show null plus the marker;
   - tl2's null re-save keeps it.
6. Action register: the read redaction on the item and the list; the TO sees the case.

**Procedure links:** added to `procedures/evidence-link-read-authorization.test.ts`.

- The TO writes two evidence items. The lead links one before it is marked, then the TO marks both.
- The lead's instance view and list omit the link, with the marker. The TO sees it.
- Linking the second item answers exactly as an unknown evidence record (422, the same code, detail and keys), and nothing is linked.

**Revision proposals:** added to `methodology/revision-proposals.test.ts`.

- AUD sees `affectedBenefits: []` with the marker, and `affectedRecords` unchanged.
- The benefit's creator, admitted, sees the entry. The stored impact is unchanged.

**The sweep, seeded from the inventory:** `inventorySetup` seeds every `sweep` row the earlier setups did not:

- an open benefit whose parent is a new sensitive benefit, created by a separate TL so no sweep reader is a named party;
- the benefits-register launch task's output;
- a `benefit_view` meeting output;
- an action on the sensitive benefit's corrective case;
- a KPI-actual evidence link and a BAU-handover evidence link.

It adds the matching extra reads (`getBenefit` of the child, the meeting outputs, the action item, the KPI actual, the handover). `checkInventorySeeded` then enforces the database check from §1.

**Before the fix** (`apps/api/src` reverted with `git apply -R` of my own diff, then re-applied):

- `01-before-fix-z12.log`: **5 failed, 1 passed** (the control).
- `02-before-fix-sweep.log`: **1 failed** (the sweep), with leaks to TL, AUD and AUD(org) on:
  - `listActionRegister` and `getActionRegisterItem` (the corrective case);
  - `listMeetingOutputs`;
  - `listLaunchTasks`;
  - `getOrphanReport` (the hidden parent).

**After the fix:**

- `03-after-fix-z12.log`: **6 passed**.
- `04-after-fix-sweep.log`: **2 passed**, with "inventory rows exercised here but not seeded: none".
- `05-inventory-test.log`: **2 passed**.
- `06-procedure-links.log`: 5 passed.
- `07-revision-proposals.log`: 6 passed.
- The final versions of all of these are also in the integration run (§8, row 7).

**Runs that failed during development** (kept and explained):

- `05a-inventory-test-first-run-kinds.log`: the catalog check flagged 15 rows I had given kind `fk` instead of `uuid`/`json`, which shows the kind check works. Fixed in the inventory.
- `04a-sweep-found-orphan-report.log`: the new seeding exposed the orphan-report leak. Fixed.
- `04b-sweep-not-seeded-rows.log`: the database check found 5 rows marked `sweep` that the sweep did not seed:
  - `bau_handover_evidence` and `kpi_actual_evidence`: now seeded;
  - the inbox target and params: re-pointed to `tasks/deep-links.test.ts#inbox.restricted`;
  - `search_document`: re-pointed to `search/search.test.ts#a sensitive benefit`.

**Web (en and ar):** the screens reuse `access.includesRestrictedRecords` ("Includes restricted records" / "يشمل سجلات مقيدة") through `RestrictedRecordsLabel`.

- `LaunchPlanPage.tsx` shows the label for a restricted output, never "No output record linked yet" / "لم يُربط سجل مخرج بعد", which would be untrue.
- `ActionsPage.tsx` (`ActionSource`) shows the label instead of a link to the case.
- Tests: `health-check/fef.test.tsx` (launch plan) and `raid/raid.test.tsx` (action register), both run per locale. `08-web-launch-plan-actions.log`: 41 passed.

## 5. Contract, schema and dependency needs (for the orchestrator)

**Additive optional members**, each described in `docs/api/openapi.yaml` and mirrored in zod: `includesRestrictedRecords` (`const: true`) on:

- `Benefit`
- `LaunchTask`
- `MeetingOutput`
- `RaidAction`
- `SustainmentReview`
- `ProcedureInstance` (the TypeScript view; it has no zod mirror)
- `Approval`
- `ApprovalDecisionRecord`
- `RevisionProposal`

**Type widening (please confirm):** `Approval.subjectId` and `ApprovalDecisionRecord.subjectId` change from `Uuid` to `NullableUuid` (still required). They are null only for a reader not admitted to the subject, with the marker set.

- An approval is a governance record: omitting it would hide that an approval exists, which D-218 does not allow ("where the open record depends on it, a neutral restricted marker").
- The SPA never reads approval `subjectId`.
- The precedent is BE-Z10B's `RagOverride.evidenceId`.
- I did not bump the contract version string.

**Everything else:**

- `pnpm openapi:lint` passes (932 operations).
- **Migrations:** none (the highest on the branch is `0126`).
- **Dependencies:** none.
- **Operations routed:** none. Every change modifies an existing operation. Delta to my `p6-pending-*.ts` list: **none**.

**ADR text for the architect** (ADR-0051 §2; their file, which I did not edit):

1. The write rule: a reference a not-admitted writer names to a sensitive record (or a child) answers exactly as an unknown id (`refIsRestricted`). The register kit's `unknownReference` is the shared 422.
2. The re-save rule now also covers the benefit PATCH and the launch-task PATCH.
3. A procedure link to a restricted record is not listed.
4. The schema-derived inventory is the reference list for this class. Any new reference column fails `sensitive-reference-inventory.test.ts` until it is classified.

## 6. What remains

**Open rows** (the inventory test pins exactly these two; each has a proposed repair):

1. `work_item.subject_id`, with its `linkPath`, and My Work's `recordId`/`href`.
   - BE-Z4 (before D-218) deliberately kept a restricted work item's ids and link for its **assignee**, and redacted only its text.
   - D-218 does not excuse that, and D-219 does not list it.
   - Repair proposed: for a restricted item, `subjectId: null` and `recordId: null` (`WorkItem.subjectId` and `MyWorkItem.recordId` become `NullableUuid`), a link to the transformation home, and the marker.
   - The SPA keys My Work rows by `recordId` (`HomeRegions.tsx`, `MyWorkSections.tsx`), so this needs a web change in the same step. It is a contract type change on two schemas, so I did not make it alone within the time box.
   - Separable second half: **T-DG6-BE-Z12B (work items and My Work)**.
2. `automation_rule_version.conditions`.
   - `benefitId` is a condition field of the automation trigger catalogue, so a rule condition can hold a sensitive benefit's id as a literal, shown to rule authors.
   - Repair proposed: `redactRestrictedIds` on read, plus a re-save rule that keeps a hidden literal.
   - **Decision needed:** a redacted condition changes what the rule is shown to do, and an author editing it could not see why it matches. The alternative is to refuse 404 on a rule version that names a restricted record, for a reader not admitted to it.

**Repaired, but no test seeds it yet** (the inventory test pins these six as `PENDING`):

| Row | Why it is untested |
|---|---|
| `approval.subject_id` | Needs a `benefit_transition_decision` approval; the demo has none. |
| `sustainment_review.transition_decision_id` | Needs a transition decision of a sensitive benefit; the demo has none. |
| `inherited_record.evidence_id` | BE-Z10B's redaction. Modular transformations only. The same response member as the dispensation `prior_approval` entry, which the sweep does seed. |
| `procedure_instance.subject_record_id` | Needs a procedure launched with a subject. |
| `procedure_instance.input_values` | Needs an input that names a record. |
| `revision_proposal.validation_report` | Same code path as `impact`, which is tested; this test puts no ids in the report. |

These are repaired by code, with the same helpers as the tested rows. They belong in T-DG6-BE-Z12B.

**Other notes:**

- The e2e stack (row 14) used the build made at about 10:11Z, after the web edits but before my last source edit, a behaviour-neutral rewrite of the re-save loop in `benefits/register.ts` that the architecture check required. The two operability specs do not touch benefits. Every benefit-related integration file was re-run on the final tree (row 9).
- The two earlier `pnpm test` runs (started about 09:59Z and 10:13Z) failed for one reason (`20/21-…`, overwritten by the final runs): the architecture test caught (a) stray empty `.claude/` directories that the write guard left in source folders while my shell's working directory was inside them (removed), and (b) the computed member access in that loop (rewritten). The final runs are in rows 11–12.

## 7. The inventory (column → operations → state before → now)

Generated from `apps/api/test/support/sensitive-reference-inventory.ts`, the source of truth that the catalog test checks.

#### redacted (46)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `benefit.parent_benefit_id` | fk | benefit (a sensitive parent) | `getBenefit`, `createBenefit`, `updateBenefit`, `archiveBenefit`, `advanceBenefitLifecycle`, `decideBenefitBaseline` | LEAK (F-DG6-480): parentBenefitId named the hidden parent; a hidden parent was accepted on write | benefits/register.ts presentBenefits: hideRestrictedRefs -> null + marker; checkBenefitRules: hidden parent -> 422 validation.reference as an unknown id; PATCH null keeps it (keptRestrictedRef) | sweep |
| `benefit_group.counted_benefit_id` | fk | benefit | `listBenefitGroups`, `getBenefitGroup` | redacted by BE-Z10 | benefits/groups.ts (BE-Z10): countedBenefitId null + marker | sweep |
| `action_item.corrective_case_id` | fk | corrective_case (child of a benefit) | `listActionRegister`, `getActionRegisterItem`, `updateActionRegisterItem` | LEAK: correctiveCaseId named the hidden variance case (found by this inventory) | raid/actions.ts shownActions: hideRestrictedRefs -> null + marker; the case's own action routes answer 404 (correctiveCaseId guard) | sweep |
| `sustainment_review.transition_decision_id` | fk | transition_decision (child of a benefit) | `listSustainmentReviews`, `completeSustainmentReview` | LEAK: transitionDecisionId named the hidden decision (found by this inventory) | sustainment/controls.ts: hideRestrictedRefs -> null + marker | PENDING: needs a transition decision of a sensitive benefit (the demo has none); redaction by code reading |
| `business_case.parent_case_id` | fk | business_case (a sensitive parent case) | `listBusinessCases`, `getBusinessCase` | redacted by BE-Z10 | business case presenter (BE-Z10): parentCaseId null + marker | sweep |
| `funding_decision.business_case_id` | fk | business_case | `listFundingDecisions` | redacted by BE-Z10 | funding (BE-Z10) | sweep |
| `benefit.business_case_line_id` | fk | business_case_line (child of a business case) | `getBenefit`, `createBenefit`, `updateBenefit`, `archiveBenefit`, `advanceBenefitLifecycle` | LEAK: businessCaseLineId named a line of a hidden case; a hidden line was accepted on write (found by this inventory) | benefits/register.ts presentBenefits: null + marker; checkBenefitRules: hidden line -> 422 benefit.case_line_invalid as an unknown line; PATCH null keeps it | apps/api/test/integration/access/sensitive-reach-id-refs-z12.test.ts#business-case line |
| `bau_handover_evidence.evidence_id` | fk | evidence | `getBauHandover` | redacted by BE-Z10 | handovers (BE-Z10) | sweep |
| `day_ninety_response.evidence_id` | fk | evidence | `getDayNinetyTest`, `putDayNinetyResponse` | redacted by BE-Z10/Z10B | launch/day-ninety.ts (BE-Z10, Z10B re-save rule) | sweep |
| `deliverable_external_change.evidence_id` | fk | evidence | `getDeliverableConfirmation` | redacted by BE-Z10B | portfolio/deliverable-confirmation.ts (BE-Z10B) | sweep |
| `diagnostic_workstream_output.evidence_id` | fk | evidence | `listWorkstreamOutputs`, `getWorkstreamOutput` | redacted by BE-Z10B | register-kit redact hook (BE-Z10B) | sweep |
| `gate_condition_closure.evidence_id` | fk | evidence | `listGateConditions`, `closeGateCondition` | redacted by BE-Z10/Z10B | workflows/gate-conditions.ts (BE-Z10, Z10B) | apps/api/test/integration/workflows/gate-conditions.test.ts#sensitive evidence |
| `gate_dispensation.evidence_id` | fk | evidence | `listGateDispensations`, `getTransformationReadiness`, `listInheritedRecords` | redacted by BE-Z10B | portfolio/dispensations.ts, readiness.ts, reporting/modular.ts (BE-Z10B) | sweep |
| `health_assessment_answer.evidence_id` | fk | evidence | `getHealthCheck`, `updateHealthCheck`, `putHealthCheckAnswer` | redacted by BE-Z10/Z10B | health/assessments.ts (BE-Z10, Z10B) | apps/api/test/integration/access/sensitive-reach-id-refs-writes.test.ts#health |
| `inherited_record.evidence_id` | fk | evidence | `listInheritedRecords`, `getInheritedRecord` | redacted by BE-Z10B | reporting/modular.ts (BE-Z10B); the same member as the dispensation prior_approval entry | PENDING: Modular transformations only (the demo is not one); the same member as the dispensation prior_approval entry the sweep seeds |
| `kpi_actual_evidence.evidence_id` | fk | evidence | `listKpiActuals`, `getKpiActual` | redacted by BE-Z10 | kpi actuals (BE-Z10) | sweep |
| `phase_step_evidence.evidence_id` | fk | evidence | `listPhaseStepEvidence` | redacted by BE-Z10B | workflows/phase-steps.ts: the link is not listed (BE-Z10B); remove response excused by D-219 (3) | sweep |
| `rag_override.evidence_id` | fk | evidence | `listRagOverrides`, `getKpiStatus`, `listKpiStatus` | redacted by BE-Z10B | kpi/rag-overrides.ts, kpi-status.ts (BE-Z10B) | sweep |
| `report_snapshot_evidence.evidence_id` | fk | evidence | `listReportSnapshotEvidence` | redacted by BE-Z5 | reporting/reports/restricted.ts visibleRefs (BE-Z5): the row is not listed | apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts#snapshot |
| `report_snapshot_evidence.content_id` | fk | evidence_content (child of evidence) | `listReportSnapshotEvidence` | redacted by BE-Z5 (the row is not listed) | the same row filter as report_snapshot_evidence.evidence_id | apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts#snapshot |
| `approval.subject_id` | uuid | subject_table of approval_type: transition_decision (child of a benefit) among open types | `listMyApprovals`, `getApproval`, `requestApproval`, `decideApproval`, `resubmitApproval`, `withdrawApproval`, `requestKpiVersionApproval`, `submitGovernanceMatrix` | LEAK: subjectId named a hidden transition decision (found by this inventory) | workflows/approvals.ts toApprovals: hideRestrictedTypedRefs -> subjectId null + marker (contract: Approval.subjectId NullableUuid) | PENDING: needs a benefit_transition_decision approval (the demo has none); redaction by code reading |
| `blocker_status.source_record_id` | uuid | source_record_type CHECK includes corrective_case (child of a benefit) | `listBlockerStatuses` | redacted by BE-Z5 (withoutRestricted: the row is not listed) | governance/escalations.ts withoutRestricted | sweep |
| `decision.blocker_record_id` | uuid | corrective_case (child) among blocker types | `listDecisions`, `getDecision`, `listExecutiveDecisions` | redacted by BE-Z10 | governance/executive-decisions.ts (BE-Z10): blockerRecordId null + marker | sweep |
| `impact_assessment_item.record_id` | uuid | item_type CHECK includes benefit and business_case | `getImpactAssessment`, `listImpactAssessments` | redacted (workflows/impact.ts restrictedRecordRefs: the item is not listed) | workflows/impact.ts | apps/api/test/integration/access/sensitive-reach-impact.test.ts# |
| `inbox_notification.target_record_id` | uuid | any record a notification targets | `listMyInbox` | redacted by BE-Y1/Z4 (tasks/deep-links.ts: target not readable -> inbox.restricted without the link) | tasks/deep-links.ts readableTargets | apps/api/test/integration/tasks/deep-links.test.ts#inbox.restricted |
| `launch_task.output_record_id` | uuid | output_record_type CHECK includes benefit, business_case and evidence | `listLaunchTasks`, `getLaunchTask`, `createLaunchTask`, `updateLaunchTask`, `putLaunchTaskPredecessors` | LEAK (F-DG6-480): outputRecordId named the hidden record; a hidden output was accepted (200 against 422) | launch/tasks.ts presentTasks: hideRestrictedTypedRefs; updateTask: hidden output -> 422 launch_task.output_record_invalid as an unknown id; null keeps it | sweep |
| `meeting_output.record_id` | uuid | record_type includes benefit (benefit_view) and other types | `listMeetingOutputs`, `createMeetingOutput` | LEAK (F-DG6-480): recordId named the hidden benefit; a hidden record was accepted on create | governance/meeting-outputs.ts: hideRestrictedTypedRefs; create: hidden record -> 422 meeting_output.record_not_found as an unknown id | sweep |
| `procedure_instance.subject_record_id` | uuid | any record type (free text; not existence-checked) | `listProcedureInstances`, `getProcedureInstance`, `launchProcedureInstance` | LEAK (F-DG6-480, by code reading): subjectRecordId served raw | procedures/steps.ts presentInstance: subjectRecordId null + marker. The launch does not check the subject's existence for any id, so a hidden id is accepted exactly as an unknown one (no oracle) | PENDING: needs a procedure definition launched with a subject; redaction by code reading (hideRestrictedTypedRefs) |
| `procedure_instance_link.record_id` | uuid | record_type CHECK includes evidence and finance_validation (child) | `listProcedureInstances`, `getProcedureInstance`, `completeProcedureStep`, `linkProcedureStepEvidence` | LEAK (F-DG6-480, by code reading): links[].recordId served raw; a hidden evidence item could be linked | procedures/steps.ts presentInstance: the link is not listed + marker; linkEvidence and requireNamedRecordRead: hidden record -> procedure_step.output_record_invalid as an unreadable record | apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts#D-218: a sensitive evidence link |
| `report_snapshot.subject_id` | uuid | subject_type CHECK includes business_case | `listReportSnapshots`, `getReportSnapshot` | redacted by BE-Z5 (a business-case pack of a restricted case is not shown) | reporting/reports/routes.ts snapshotForReader | apps/api/test/integration/access/sensitive-reach-dashboards-reports.test.ts#business case |
| `report_snapshot_source.record_id` | uuid | any record a snapshot used | `listReportSnapshotSources` | redacted by BE-Z5 (visibleRefs: the row is not listed) | reporting/reports/restricted.ts visibleRefs | sweep |
| `search_document.record_id` | uuid | any indexed record | `searchRecords` | redacted (P6 search: a restricted record's document is not returned) | search module read filter | apps/api/test/integration/search/search.test.ts#a sensitive benefit |
| `agenda_item.materials_evidence_ids` | array | evidence | `listAgendaItems`, `createAgendaItem`, `updateAgendaItem` | redacted by BE-Z10B | governance/agenda.ts (BE-Z10B) | sweep |
| `assistant_message.citations` | json | cited records | `getAssistantConversation` | redacted (P6 assistant: an answer citing a record the reader cannot read is withheld) | assistant/conversations.ts citationViews / withheld | apps/api/test/integration/assistant/conversations.test.ts#withheld |
| `assistant_suggestion.citations` | json | cited records | `getAssistantConversation`, `takeAssistantSuggestionToDraft` | redacted (the same readable() check) | assistant module readable() check | apps/api/test/integration/assistant/conversations.test.ts#withheld |
| `audit_event.changes` | json | from/to of audited columns (may hold ids) | `listTransformationAudit`, `listAuditEvents` | redacted (BE-Y1/Z10: a restricted record's changes are null; other events' hidden ids redacted) | audit/routes.ts (BE-Y1, BE-Z10 restrictedIdsAmong) | sweep |
| `closure_record.snapshot` | json | benefit ids with their measurement and transition decision ids | `listClosureRecords`, `closeInitiative`, `closeTransformation` | redacted by BE-Z10B | sustainment/closure.ts redactRestrictedIds (BE-Z10B) | apps/api/test/integration/sustainment/closure.test.ts#sensitive |
| `form_custom_value.field_values` | json | attachment (evidence ids) and reference field values | `getFormRecordCustomFields`, `putFormRecordCustomFields` | redacted by BE-Z10B | forms/custom-values.ts (BE-Z10B) | apps/api/test/integration/forms/custom-values-restricted.test.ts# |
| `gate_submission.snapshot` | json | frozen gate facts (evidence and benefit ids) | `getGateSubmission`, `listGateSubmissions` | redacted by BE-Z10 | workflows/gates.ts redactRestrictedIds (BE-Z10) | apps/api/test/integration/access/sensitive-reach-id-refs.test.ts# |
| `gate_submission_criterion.detail` | json | criterion details (may name ids) | `getGateSubmission` | redacted by BE-Z10 | workflows/gates.ts redactRestrictedIds (BE-Z10) | apps/api/test/integration/access/sensitive-reach-id-refs.test.ts# |
| `inbox_notification.message_params` | json | codes and labels of the notification's subject | `listMyInbox` | redacted by BE-Y1/Z4 (inbox.restricted with params {}) | tasks/deep-links.ts | apps/api/test/integration/tasks/deep-links.test.ts#inbox.restricted |
| `procedure_instance.input_values` | json | input values (a reference input may hold a record id) | `listProcedureInstances`, `getProcedureInstance`, `updateProcedureInstanceInputs` | served raw | procedures/steps.ts presentInstance: redactRestrictedIds + marker | PENDING: needs a procedure input naming a record; redaction by code reading (redactRestrictedIds) |
| `report_snapshot.content` | json | the frozen report document | `getReportSnapshot` | redacted by BE-Z5/Z7B (documentForReader) | reporting/reports/restricted.ts documentForReader | sweep |
| `revision_proposal.impact` | json | affectedBenefits[].benefitId of a formula revision | `listRevisionProposals` | LEAK: affectedBenefits named each benefit using the formula, sensitive ones included (found by this inventory) | methodology/revision-impact.ts: redactRestrictedIds over impact and validationReport + marker; counts unchanged | apps/api/test/integration/methodology/revision-proposals.test.ts#revision proposal: a sensitive affected benefit |
| `revision_proposal.validation_report` | json | validation findings of a revision (may name records) | `listRevisionProposals` | served raw | the same redactRestrictedIds as revision_proposal.impact | PENDING: as revision_proposal.impact |
| `work_item.message_params` | json | codes and labels of the item's subject | `listMyWorkItems`, `getWorkItem` | redacted by BE-Z4 (inbox.restricted text) | tasks/routes.ts workItemFor | apps/api/test/integration/access/sensitive-reach-escalation.test.ts# |

#### open (2)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `work_item.subject_id` | uuid | subject types include corrective_case, finance_validation, benefit_overlap (children) | `listMyWorkItems`, `getWorkItem`, `completeWorkItem`, `getMyWork` | kept by design in BE-Z4 for the assignee (text redacted, ids and link kept), before D-218 | PROPOSED: for a restricted item, subjectId null (WorkItem.subjectId and MyWorkItem.recordId NullableUuid) and a link to the transformation home, + marker; the SPA keys My Work rows by recordId, so it needs a web change too | - |
| `automation_rule_version.conditions` | json | a condition may compare the condition field benefitId to a literal uuid | `listAutomationRuleVersions`, `getAutomationRuleVersion` | served raw to rule authors | PROPOSED: redactRestrictedIds on read with a re-save rule that keeps a hidden literal (keptRestrictedRef); needs a decision because a redacted condition changes what the rule is shown to do | - |

#### D-219 (2)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `audit_event.record_id` | uuid | any record | `listTransformationAudit`, `listAuditEvents` | kept by design | D-219 (1): ADR-0051 §2 audit events keep actor, action, time, record id and versions; changes/reason redacted | - |
| `sensitive_record_grant.record_id` | uuid | benefit, business_case, evidence | `listSensitiveGrants`, `getSensitiveGrant` | kept by design | D-219 (2): ADR-0051 §7 grant register, shown to sensitive_record.read holders | - |

#### holder-restricted (49)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `benefit_allocation.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_allocation is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_enabler.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_enabler is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_evidence.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_evidence is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_lifecycle_event.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_lifecycle_event is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_measurement.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_measurement is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_overlap.benefit_a_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_overlap is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_overlap.benefit_b_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_overlap is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_plan_value.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_plan_value is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_scenario_value.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_scenario_value is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `corrective_case.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | corrective_case is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `finance_validation.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | finance_validation is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `performance_area_link.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | performance_area_link is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `trace_link.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | trace_link is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `transition_decision.benefit_id` | fk | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | transition_decision is a SENSITIVE_CHILD_SOURCES type of its benefit: 404 / omitted when the owner is restricted | - |
| `benefit_measurement.benefit_calculation_id` | fk | benefit_calculation (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by benefit_measurement, a benefit child | - |
| `benefit_evidence.measurement_id` | fk | benefit_measurement (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by benefit_evidence, a benefit child | - |
| `benefit_measurement.corrects_measurement_id` | fk | benefit_measurement (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | the same benefit's measurement, held by a benefit child | - |
| `benefit_measurement_input.measurement_id` | fk | benefit_measurement (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | served only under /benefit-measurements/{benefitMeasurementId} (SENSITIVE_REACH_PARAMS guard: 404) | - |
| `finance_validation.benefit_measurement_id` | fk | benefit_measurement (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by finance_validation, a benefit child | - |
| `finance_validation.corrects_validation_id` | fk | finance_validation (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | the same benefit's validation, held by a benefit child | - |
| `benefit_scenario_value.scenario_id` | fk | benefit_scenario (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by benefit_scenario_value, a benefit child | - |
| `corrective_signal.corrective_case_id` | fk | corrective_case (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | served only under /corrective-cases/{correctiveCaseId}/signals (SENSITIVE_REACH_PARAMS guard: 404) | - |
| `financial_cash_flow.set_id` | fk | financial_cash_flow_set (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | served only inside its set under the business case (business-case reads: 404) | - |
| `form_record_comment.parent_comment_id` | fk | form_record_comment (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by a form_record_comment, a form-record child | - |
| `record_sensitivity_change.record_sensitivity_id` | fk | record_sensitivity (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | sensitivity history: the sensitivity record's own reads (TO / sensitive_record.read; ADR-0051 §7) | - |
| `benefit_scenario.business_case_id` | fk | business_case | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_scenario is a SENSITIVE_CHILD_SOURCES type of its business_case: 404 / omitted when the owner is restricted | - |
| `business_case_line.business_case_id` | fk | business_case | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | business_case_line is a SENSITIVE_CHILD_SOURCES type of its business_case: 404 / omitted when the owner is restricted | - |
| `financial_cash_flow_set.business_case_id` | fk | business_case | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | financial_cash_flow_set is a SENSITIVE_CHILD_SOURCES type of its business_case: 404 / omitted when the owner is restricted | - |
| `benefit_evidence.evidence_id` | fk | evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_evidence is a SENSITIVE_CHILD_SOURCES type of its evidence: 404 / omitted when the owner is restricted | - |
| `evidence_content.evidence_id` | fk | evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | evidence_content is a SENSITIVE_CHILD_SOURCES type of its evidence: 404 / omitted when the owner is restricted | - |
| `evidence_link.evidence_id` | fk | evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | evidence_link is a SENSITIVE_CHILD_SOURCES type of its evidence: 404 / omitted when the owner is restricted | - |
| `form_record_attachment.evidence_id` | fk | evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | form_record_attachment child source names evidence_id as an extra owner | - |
| `evidence.current_content_id` | fk | evidence_content (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by the evidence item itself | - |
| `evidence.reviewed_content_id` | fk | evidence_content (child) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by the evidence item itself | - |
| `benefit_overlap.excluded_benefit_id` | uuid | benefit | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | one of the overlap's two benefits; benefit_overlap is restricted when either owner is | - |
| `corrective_case.kpi_scope_id` | uuid | a KPI scope | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by the corrective case (a benefit child when benefit_id is set); a KPI scope names no sensitive record | - |
| `corrective_case.source_record_id` | uuid | the case's source (a benefit measurement for a benefit case) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by the corrective case, a benefit child: 404 / omitted when its benefit is restricted | - |
| `evidence_link.record_id` | uuid | a record an evidence item is linked to (may be a benefit or business case) | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | evidence_link is an evidence child; listEvidenceLinks also omits a link to a restricted record (BE-Z10) | - |
| `form_custom_value.record_id` | uuid | a form record | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | form-record child source (codes form) | - |
| `form_draft.record_id` | uuid | a form record | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | form-record child source (codes form) | - |
| `form_record_attachment.record_id` | uuid | a form record | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | form-record child source (codes form) | - |
| `form_record_comment.record_id` | uuid | a form record | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | form-record child source (codes form) | - |
| `record_sensitivity.record_id` | uuid | benefit, business_case, evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | record_sensitivity is a pair child source; the sensitivity GET is the record's own (404 when restricted) | - |
| `record_sensitivity_change.record_id` | uuid | benefit, business_case, evidence | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | sensitivity history: the record's own sensitivity reads | - |
| `benefit_calculation.inputs` | json | a measurement's calculation inputs | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_calculation is a via child source | - |
| `benefit_calculation.rounding` | json | rounding policy | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | benefit_calculation is a via child source | - |
| `corrective_signal.payload` | json | a corrective signal's payload | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | under the corrective case (guarded) | - |
| `finance_validation.content` | json | a validation's content | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | finance_validation is a benefit child | - |
| `impact_assessment_item.detail` | json | an impact item's detail | - | holder already restricted (BE-Y1/Z1/Z4/Z5) | held by the impact item, which is not listed when its record is restricted (workflows/impact.ts) | - |

#### not-served (6)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `deliverable_external_change_event.evidence_id` | uuid | evidence (history); the events[] view omits it | - | - | no API response serializes it | - |
| `outbox_event.aggregate_id` | uuid | the outbox (worker only) | - | - | no API response serializes it | - |
| `report_snapshot_aggregate.record_id` | uuid | the records an aggregate counted (benefits, cases) | - | internal (BE-Z7B): decides the read-time label only | read by reporting/reports/restricted.ts for includesRestrictedRecords; never serialized | - |
| `automation_execution.trigger_payload` | json | the event payload a run started from | - | - | no API response serializes it | - |
| `operational_failure.job_data` | json | the failed job's data (the failure queue shows class and counts) | - | - | no API response serializes it | - |
| `outbox_event.payload` | json | the outbox event payload (worker only) | - | - | no API response serializes it | - |

#### own-input (3)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `export_job.selection` | json | the export's selection (register, filters); served to the job's requester | - | - | the export's selection (register, filters); served to the job's requester | - |
| `form_draft.payload` | json | the author's own partial request body (forms/drafts.ts: owner only) | - | - | the author's own partial request body (forms/drafts.ts: owner only) | - |
| `idempotency_record.response_body` | json | a replay of the caller's own earlier response, to the same user, key and request hash | - | - | a replay of the caller's own earlier response, to the same user, key and request hash | - |

#### cannot-name (91)

| Column | Kind | Can name | Operations | State before | Now | Exercise |
|---|---|---|---|---|---|---|
| `adoption_intervention.scope_id` | uuid | scope_kind CHECK: transformation, business_unit, initiative | - | - | scope_kind CHECK: transformation, business_unit, initiative | - |
| `audit_event.actor_user_id` | uuid | a user id | - | - | a user id | - |
| `audit_event.on_behalf_of_user_id` | uuid | a user id | - | - | a user id | - |
| `audit_event.transformation_id` | uuid | a transformation id | - | - | a transformation id | - |
| `automation_action_result.result_record_id` | uuid | the only writers (worker automation actions items/notify) store work_item or inbox_notification | - | - | the only writers (worker automation actions items/notify) store work_item or inbox_notification | - |
| `calculation_run.trigger_record_id` | uuid | trigger_record_type CHECK: kpi_actual, kpi_rag_threshold, target_trajectory, kpi_version, kpi_restatement | - | - | trigger_record_type CHECK: kpi_actual, kpi_rag_threshold, target_trajectory, kpi_version, kpi_restatement | - |
| `change_request.applied_record_id` | uuid | proposed/applied record type CHECK: kpi_version, benefit_formula_version | - | - | proposed/applied record type CHECK: kpi_version, benefit_formula_version | - |
| `change_request.proposed_record_id` | uuid | proposed_record_type CHECK: kpi_version, benefit_formula_version | - | - | proposed_record_type CHECK: kpi_version, benefit_formula_version | - |
| `change_request.subject_id` | uuid | subject_type CHECK: charter, kpi_definition, outcome_kpi, tom_canvas_cell, initiative, benefit_formula, milestone, budget_line | - | - | subject_type CHECK: charter, kpi_definition, outcome_kpi, tom_canvas_cell, initiative, benefit_formula, milestone, budget_line | - |
| `charter_version.north_star_id` | uuid | a North Star id | - | - | a North Star id | - |
| `data_quality_finding.scope_id` | uuid | KPI data-quality scopes (worker kpi handler) | - | - | KPI data-quality scopes (worker kpi handler) | - |
| `delegation.scope_id` | uuid | scope_type: organization or transformation | - | - | scope_type: organization or transformation | - |
| `deliverable_external_change_event.outbound_write_id` | uuid | an outbound write id | - | - | an outbound write id | - |
| `demo_dataset_run.requested_by` | uuid | a user id | - | - | a user id | - |
| `demo_seed_record.record_id` | uuid | the walkthrough reads only record_type 'transformation' rows (admin/walkthrough.ts) | - | - | the walkthrough reads only record_type 'transformation' rows (admin/walkthrough.ts) | - |
| `diagnostic_workstream_output.record_id` | uuid | the 7 WORKSTREAM_OUTPUT_RECORD_TYPES (none sensitive) | `listWorkstreamOutputs`, `getWorkstreamOutput` | typed redaction since BE-Z10B (no sensitive type admitted) | zod enum; hideRestrictedTypedRefs also applied (BE-Z10B) | - |
| `import_row_commit.target_record_id` | uuid | import_batch.target_kind CHECK has one value: kpi_actual | - | - | import_batch.target_kind CHECK has one value: kpi_actual | - |
| `journey_pain_point.step_key` | uuid | a journey step key | - | - | a journey step key | - |
| `kpi_actual.scope_id` | uuid | KPI scope kinds | - | - | KPI scope kinds | - |
| `kpi_evaluation.previous_period_id` | uuid | a reporting period id | - | - | a reporting period id | - |
| `kpi_evaluation.scope_id` | uuid | KPI scope kinds | - | - | KPI scope kinds | - |
| `kpi_restatement_reconciliation.scope_id` | uuid | KPI scope kinds | - | - | KPI scope kinds | - |
| `kpi_restatement_reissue_offer.series_id` | uuid | a report series id | - | - | a report series id | - |
| `methodology_migration_item.record_id` | uuid | methodology-bound records (gate instances, elements, config records) | `getMethodologyMigration` | - | the migration planner (methodology/migrations.ts) names gate instances, elements and config records only | - |
| `owner_update.subject_id` | uuid | OWNER_UPDATE_SUBJECT_TYPES: transformation, workstream | - | - | OWNER_UPDATE_SUBJECT_TYPES: transformation, workstream | - |
| `rag_override.scope_id` | uuid | scope_kind CHECK: KPI scopes | - | - | scope_kind CHECK: KPI scopes | - |
| `report_snapshot.series_id` | uuid | a report series id | - | - | a report series id | - |
| `report_snapshot_version.reference_id` | uuid | version_kind CHECK: methodology, config, kpi, formula, weight set, engine, scoring versions | - | - | version_kind CHECK: methodology, config, kpi, formula, weight set, engine, scoring versions | - |
| `revision_proposal.subject_id` | uuid | subject_type CHECK: methodology_version, benefit_formula_version | - | - | subject_type CHECK: methodology_version, benefit_formula_version | - |
| `scoped_assignment.scope_id` | uuid | an organization or transformation scope | - | - | an organization or transformation scope | - |
| `target_trajectory.scope_id` | uuid | KPI scope kinds | - | - | KPI scope kinds | - |
| `meeting_cutoff_pack.agenda_item_ids` | array | agenda item ids | - | - | agenda item ids | - |
| `assessment_form_version.schema` | json | an adoption form definition (questions) | - | - | an adoption form definition (questions) | - |
| `assessment_record.answers` | json | adoption answers keyed by question code | - | - | adoption answers keyed by question code | - |
| `assistant_setting.credential_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `assistant_setting_change.credential_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `assistant_suggestion.fields` | json | suggested field values of a draft form (text) | - | - | suggested field values of a draft form (text) | - |
| `automation_dry_run.findings` | json | validation findings of a dry run (codes and pointers) over synthetic samples | - | - | validation findings of a dry run (codes and pointers) over synthetic samples | - |
| `automation_dry_run.planned_actions` | json | planned actions computed from the builder's fixed synthetic sample payloads (automation/samples.ts) | - | - | planned actions computed from the builder's fixed synthetic sample payloads (automation/samples.ts) | - |
| `automation_dry_run.sample_event` | json | the builder's fixed synthetic sample payload | - | - | the builder's fixed synthetic sample payload | - |
| `automation_rule_version.actions` | json | action configuration (recipient parties, templates); no record id field | - | - | action configuration (recipient parties, templates); no record id field | - |
| `automation_rule_version.parameters` | json | numeric and text parameters of a starter | - | - | numeric and text parameters of a starter | - |
| `change_request.materiality_basis` | json | KPI / formula materiality figures | - | - | KPI / formula materiality figures | - |
| `change_request.proposed_change` | json | a KPI or formula patch (subject_type CHECK) | - | - | a KPI or formula patch (subject_type CHECK) | - |
| `charter_version.guardrails_snapshot` | json | charter guardrails | - | - | charter guardrails | - |
| `charter_version.top_outcomes_snapshot` | json | charter outcomes | - | - | charter outcomes | - |
| `config_check_run.report` | json | configuration check results (codes) | - | - | configuration check results (codes) | - |
| `connector_config_version.adapter_settings` | json | connector settings | - | - | connector settings | - |
| `connector_config_version.credential_refs` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `connector_config_version.field_mappings` | json | column mappings | - | - | column mappings | - |
| `data_quality_finding.detail_params` | json | KPI data-quality parameters (worker kpi handler) | - | - | KPI data-quality parameters (worker kpi handler) | - |
| `demo_dataset_run.coverage` | json | counts by table | - | - | counts by table | - |
| `demo_dataset_run.record_counts` | json | counts by table | - | - | counts by table | - |
| `dependency_slip.affected` | json | affected milestones and initiatives | - | - | affected milestones and initiatives | - |
| `import_row.normalized` | json | KPI actual import cells (target_kind kpi_actual) | - | - | KPI actual import cells (target_kind kpi_actual) | - |
| `import_row.raw` | json | KPI actual import cells (target_kind kpi_actual) | - | - | KPI actual import cells (target_kind kpi_actual) | - |
| `import_row.reasons` | json | validation reasons (codes) | - | - | validation reasons (codes) | - |
| `initiative_score_result.inputs` | json | initiative scoring inputs | - | - | initiative scoring inputs | - |
| `journey.steps` | json | journey steps (text) | - | - | journey steps (text) | - |
| `kpi_evaluation.explanation_params` | json | KPI evaluation parameters | - | - | KPI evaluation parameters | - |
| `kpi_evaluation.inputs` | json | KPI values | - | - | KPI values | - |
| `kpi_evaluation.rounding` | json | rounding policy | - | - | rounding policy | - |
| `meeting_cutoff_pack.open_asks` | json | decision (ask) ids, codes, titles, owners and agenda item ids (governance/cut-off.ts) | - | - | decision (ask) ids, codes, titles, owners and agenda item ids (governance/cut-off.ts) | - |
| `methodology_element.attributes` | json | methodology configuration | - | - | methodology configuration | - |
| `methodology_migration_item.detail` | json | migration planning detail (codes) | - | - | migration planning detail (codes) | - |
| `methodology_version.definition` | json | methodology configuration | - | - | methodology configuration | - |
| `notification_channel.smtp_password_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `notification_channel.smtp_username_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `notification_channel_change.smtp_password_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `notification_channel_change.smtp_username_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `outbound_write.payload` | json | an outbound connector write (deliverable status) | - | - | an outbound connector write (deliverable status) | - |
| `outcome_kpi.trajectory_points` | json | KPI trajectory values | - | - | KPI trajectory values | - |
| `phase_step.completion_check` | json | a phase step completion rule | - | - | a phase step completion rule | - |
| `procedure_definition.input_schema` | json | procedure input definitions | - | - | procedure input definitions | - |
| `procedure_step_definition.condition_value` | json | a step condition literal (definition data) | - | - | a step condition literal (definition data) | - |
| `ranking_entry.cause_detail` | json | initiative ranking causes | - | - | initiative ranking causes | - |
| `report_snapshot.parameters` | json | report parameters (register, period, filters of the report form) | - | - | report parameters (register, period, filters of the report form) | - |
| `saved_view.columns` | json | column keys | - | - | column keys | - |
| `saved_view.filters` | json | packages/shared/src/saved-views.ts: uuid filters are organization, business unit, transformation, wave and user ids only | - | - | packages/shared/src/saved-views.ts: uuid filters are organization, business unit, transformation, wave and user ids only | - |
| `saved_view.sort` | json | sort keys | - | - | sort keys | - |
| `saved_view_event.columns` | json | column keys | - | - | column keys | - |
| `saved_view_event.filters` | json | the same filter registry as saved_view.filters | - | - | the same filter registry as saved_view.filters | - |
| `saved_view_event.sort` | json | sort keys | - | - | sort keys | - |
| `storage_setting.s3_access_key_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `storage_setting.s3_secret_key_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `storage_setting_change.s3_access_key_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `storage_setting_change.s3_secret_key_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `webhook_endpoint.previous_secret_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `webhook_endpoint.signing_secret_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `webhook_endpoint_change.previous_secret_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |
| `webhook_endpoint_change.signing_secret_ref` | json | a secret reference (environment or vault key name), never a record id | - | - | a secret reference (environment or vault key name), never a record id | - |


## 8. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL is a disposable cluster from `tests/qa/support/with-pg.sh`, ports 31050–31099 only. Logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Z12-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, end) | 0, 0 | `PASS gate DG5 (historical)` | (start: console), `50-validate-dg5-historical-end.log` |
| 2 | Before the fix: `with-pg.sh npx vitest run --project integration …/sensitive-reach-id-refs-z12.test.ts` with `apps/api/src` reverted | 1 | **5 failed, 1 passed** (expected) | `01-before-fix-z12.log` |
| 3 | Before the fix: the sweep, with `apps/api/src` reverted | 1 | **1 failed**: leaks on 5 operations to TL, AUD and AUD(org) (expected) | `02-before-fix-sweep.log` |
| 4 | After the fix: the Z12 file | 0 | 6 passed | `03-after-fix-z12.log` |
| 5 | After the fix: the sweep | 0 | 2 passed; no rows marked `sweep` left unseeded | `04-after-fix-sweep.log` (dev runs `04a`, `04b`, §4) |
| 6 | The inventory test | 0 | 2 passed; catalog fk=54, uuid=59, json=84, array=2 | `05-inventory-test.log` (dev run `05a`) |
| 7 | `with-pg.sh npx vitest run --project integration <114 files>` | 0 | **114 files, 1076 tests passed** (942.8 s) | `30-integration-touched.log`, list in `30-integration-files.txt` |
| 8 | The files of row 7, per the assignment | 0 | included in row 7: worker job runs (`apps/worker/…/job-runs`), failure queue (`apps/worker/…/automation-failure-queue`, `apps/api/…/automation/automation-failures`), automation recovery (`tests/qa/integration/a13-*`), operations (`operations/*`, `jobs/job-operations`), operational exceptions (`operations/exceptions`, `exception-last-known-value`, `concurrent-exception-recurrence`, `apps/worker/…/connector-failure-exception`), the BE-Z6 race test (`operations/exception-recurrence-race`) | as row 7 |
| 9 | Re-run on the final tree: `benefits/*`, the Z12, sweep and inventory files, `contract/contract`, the forms bulk-edit files | 0 | **23 files, 279 tests passed** | `31-integration-rerun-final.log`, `31-integration-rerun-files.txt` |
| 10 | `npx vitest run --project unit-web` (launch plan and action register, en and ar) | 0 | 2 files, 41 tests passed | `08-web-launch-plan-actions.log` |
| 11 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node: 190 files, **2899 passed**; unit-web: 123 files, **2077 passed**; unit-formula-nocodegen: 3 files, **259 passed, 2 skipped** (pre-existing skips in that project, not mine) | `20-unit-lang-unset.log` |
| 12 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts as row 11 | `21-unit-c-utf8.log` |
| 13 | `pnpm -r typecheck` | 0 | all packages done | `10-typecheck.log` |
| 14 | `E2E_PG_PORT=31070 E2E_API_PORT=31080 MTH_PORT_POOL=31070-31099 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker) | 0 | **4 passed** (a13: en 11.3 s, ar 12.2 s; a22: en 1.6 m, ar 1.8 m) | `40-e2e-a22-a13.log` |
| 15 | `pnpm -r build` | 0 | done | `11-build.log` |
| 16 | `pnpm lint` | 0 | clean (`--max-warnings=0`) | `12-lint.log` |
| 17 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `13-format-check.log` |
| 18 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |

**Non-zero exits during the work** (each fixed and re-run):

- The first format check exited 123: 5 of my files were unformatted. I formatted them; row 17 is the re-run.
- The first two `pnpm test` runs failed only in `apps/api/src/architecture.test.ts` (§6, last note).
- The development runs `04a`, `04b` and `05a` are explained in §4.

No test was flaky, and none timed out. I added no e2e spec, so the e2e budget rule does not apply.

## 9. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts`, `access/index.ts` | `refIsRestricted`: the write-side check. |
| `apps/api/src/modules/transformations/register-kit.ts`, `transformations/index.ts` | `unknownReference`: the shared 422 for an unknown or hidden reference. |
| `apps/api/src/modules/benefits/register.ts`, `benefits/lifecycle.ts`, `benefits/finance-validation.ts` | `presentBenefits(db, principal, …)`: the parent and case-line redaction; the write checks; the re-save rule. |
| `apps/api/src/modules/launch/tasks.ts`, `launch/predecessors.ts` | Output redaction, the write check, the re-save rule. |
| `apps/api/src/modules/governance/meeting-outputs.ts` | Record redaction; the create check. |
| `apps/api/src/modules/procedures/steps.ts`, `procedures/instances.ts`, `procedures/outputs/kit.ts` | Link, subject and input redaction; the evidence and output link checks. |
| `apps/api/src/modules/raid/actions.ts` | Action register `correctiveCaseId`. |
| `apps/api/src/modules/sustainment/controls.ts` | Sustainment review `transitionDecisionId`. |
| `apps/api/src/modules/workflows/approvals.ts`, `governance/matrices.ts`, `kpi/kpi-versions.ts` | Approval and decision-record `subjectId` (the `toApprovals` port gains the principal). |
| `apps/api/src/modules/methodology/revision-impact.ts` | Revision proposal impact redaction. |
| `apps/api/src/modules/reporting/orphans.ts` | A restricted record is not listed in the orphan report. |
| `packages/shared/src/schemas/{approvals,benefits,governance-workflow,launch,raid,studio-coverage,sustainment-operations}.ts` | Zod mirrors: the optional markers; approval `subjectId` nullable. |
| `docs/api/openapi.yaml` | The same members, each described. |
| `apps/web/src/pages/launch-plan/LaunchPlanPage.tsx`, `pages/actions/ActionsPage.tsx` | The restricted label (en and ar). |
| `apps/web/src/pages/health-check/fef.test.tsx`, `pages/raid/raid.test.tsx` | Web tests of the label. |
| `apps/api/test/support/sensitive-reference-inventory.ts` (new) | The inventory (199 rows). |
| `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` (new) | Catalog against inventory. |
| `apps/api/test/integration/access/sensitive-reach-id-refs-z12.test.ts` (new) | The reviewer's repro, ported and widened. |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` | `inventorySetup`, `checkInventorySeeded`, and `benefit_view` on the synthetic forum. |
| `apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts`, `methodology/revision-proposals.test.ts` | One D-218 test each. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z12-*` | This handback and its evidence. |

## 10. User-facing texts

- **Made untrue by the redaction, and fixed in both languages:** a launch task whose output is restricted would have said "No output record linked yet" / "لم يُربط سجل مخرج بعد". It now shows "Includes restricted records" / "يشمل سجلات مقيدة".
- The action register shows the same label instead of a link to a restricted corrective case (no text there was untrue).
- No other en or ar string calls a feature I shipped "planned" or "later".

## 11. Merge instructions

- No migration and no new dependency.
- Expect conflicts only where a later task also changed the `toApprovals` port signature, `presentBenefits`, `presentTasks` or `presentInstance`: each gained a required `principal` parameter, so the compiler finds every caller.
- Run the full `pnpm test:integration` on the merged tree (not required here, per the assignment).

End: `2026-11-08T10:37:33Z` (`date -u`), about 89 minutes after the start.
