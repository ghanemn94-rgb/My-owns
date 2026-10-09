# ADR-0033: Adoption as an outcome: the seven leading adoption indicators as KPI templates, the T13 Stakeholder & Adoption Plan, champions, interventions (one per indicator, scope and period below trajectory), versioned feedback and assessment forms, training versus observed proficiency, impacted-team involvement and champion constraints

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-06), 2026-10-09.
- **Requirements (slice F of `docs/architecture/p4-plan.md`):** REQ-PB-069, REQ-PB-070, REQ-PB-071, REQ-PB-072, REQ-PB-073, REQ-S11-001, REQ-S11-002, REQ-S16-020.
- **Sources (quoted where a design point has one):**
  - Playbook B0105 ("Transformation fails when the solution is delivered but the organization does not adopt the new way of working. Manage adoption as an outcome with measurable leading indicators."), B0106 ("Template 13 — Stakeholder & Adoption Plan"), B0107 (columns "Stakeholder | Impact | Current stance | Required behavior | Intervention | Owner | Adoption KPI"; value lists "H/M/L", "Support / Neutral / Resist", "Comms / training / involvement / incentive"), B0108 ("Leading adoption indicators"), B0109–B0115 (the seven indicators, quoted verbatim in §2), B0116 ("People-centered principle — Involve impacted teams early in design, not only during communication. Champions are most useful when they can surface constraints and shape decisions—not simply broadcast messages.").
  - Master prompt M0141 (T13: "Stakeholder/group, impact H/M/L, current stance Support/Neutral/Resist, required behavior, intervention, owner, adoption KPI"), M0159 ("Missing or stale data must show Unknown/Stale, not green or zero."), M0215 ("Implement stakeholder groups, influence/impact, stance, required behavior, intervention plans, champions, communication/training actions and evidence of proficiency. Provide short native feedback/assessment forms so observations can be collected and reviewed in the platform."), M0216 ("Seed all source adoption indicators: usage/activation; new-process compliance; cycle-time shift; training completion plus observed proficiency; decision turnaround; percentage of transactions using the new journey; exception/workaround rate. Distinguish training attendance from successful adoption. Track actuals against adoption trajectories and create corrective interventions when gaps appear."), M0326 ("StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord and AdoptionMetricLink.").
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 R4 (rows citing a later-stage A-test are judged on their own acceptance text), R5 (starter automations are code-defined handlers with configuration in data); D-090 (S-12 contiguity); D-092 (7) (transformation-scoped paths); D-093 (4) (ADR-0031 §5.4 fixes the `adoption.check_failed` payload; this ADR emits exactly it).
- **Builds on:** ADR-0003 (UUIDv7, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization; 404 outside scope), ADR-0007 (API conventions), ADR-0014 (validated JSON only for versioned forms), ADR-0015 (one decision model; T04 design decisions are `decision` kind `design`; `tom_workshop`), ADR-0016 (record guards `0010`; lock registry §6), ADR-0025 (business calendar, `addWorkingDays`, `p4_business_date`, `runOnce`, `createWorkItemOnce`), ADR-0027/ADR-0028 (KPI definitions, versions, trajectories, `kpi_evaluation`, the `kpi.deviation_evaluated` event, fractions for percentages), ADR-0031 §5.4 (the check-event payload and the corrective case it opens).
- **Physical model:** `0047_p4_adoption.sql`, `0049_p4_adoption_sustainment_permissions.sql` (the slice G tables are ADR-0034's). Probe ids below refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/probe-output.txt` (104 PASS, 0 FAIL, slices F and G together).
- **Two gate systems.** Nothing in this ADR is a G1–G6 business approval, reads or writes a gate, or reads or writes the engineering records DG0–DG7. No slice F code is a `business_approval` permission (§9). All probe and seed data is synthetic.

## Context

As built before slice F (checked on `HEAD` `588fe12`):

1. No table stores stakeholder groups, champions, adoption interventions, forms, training or assessment records. `apps/api/src/modules/adoption/` holds two route stubs created by BE-A (`routes.ts`, owned by BE-H; `indicators.ts`, owned by KBE-F) that register nothing, and `apps/worker/src/{handlers,queues}/adoption.ts` stubs.
2. `kpi_definition` (`0014`) carries `is_leading`, `polarity`, `unit_kind`, `owner_user_id`; P4 versions, trajectories and evaluations exist (`0033`–`0035`). Every accepted actual produces `kpi_evaluation` rows and one `kpi.deviation_evaluated` outbox event per evaluation of basis `period` (ADR-0027 §8), with `calculated_rag` ∈ {`green`, `amber`, `red`, `unknown`, `stale`, `not_computable`} and `deviation` ∈ {`favourable`, `within`, `adverse`, `unknown`} (`0035`).
3. `decision` (`0017`) kind `design` is the T04 decision; `tom_workshop` (`0017`) records design workshops and their participants (people, not stakeholder groups).
4. ADR-0031 §5.4 fixes the payload of `adoption.check_failed` and BE-D2's consumer `raid.corrective_adoption`, which opens exactly one corrective case per failed check (`corrective_case_one_per_check_key`).

## Decision

### 1. Adoption is an outcome with its own status, separate from delivery (REQ-PB-069)

1. Adoption is measured by **adoption metric links** (§3): an indicator measure attached to an outcome, an initiative, a stakeholder group or the transformation. A KPI-fed measure is an ordinary KPI of the transformation (its trajectory, actuals and RAG are slice A's), so "adoption KPIs use trajectories" is ADR-0027/0028's trajectory model, unchanged.
2. An initiative's **adoption status** is a column of its own (`initiative.adoption_status`, `0048`, ADR-0034 §1), set by the Business Owner, never written by a delivery transition. The status model read (ADR-0034 §2) reports adoption as `at_risk` while the initiative has an open below-trajectory intervention (§4) for a metric link targeting it or for an evaluation scoped to it, whatever the stored status; this is how "an initiative with delivery Complete and adoption below trajectory shows adoption at risk" (REQ-PB-069 acceptance) is met. Delivery `completed` changes neither value (probe ST02).
3. A gap beyond threshold creates **exactly one** intervention per indicator, scope and reporting period (§4).

### 2. The seven leading adoption indicators, seeded verbatim as KPI templates (REQ-PB-071)

**Entity `adoption_indicator_template`** (`0047`, read-only for `mth_app`; probes S01, S05). One row per *measure*. The `source_indicator_en` column holds the B0109–B0115 text exactly:

| Ordinal | `source_indicator_en` (verbatim) | Measure(s) (`key`, `measure_en`) | Unit | Polarity | Nature / aggregation | Value source |
|---|---|---|---|---|---|---|
| 1 | Usage / activation rate | `usage_activation_rate` | percentage | higher is better | ratio / weighted ratio | KPI actuals |
| 2 | Compliance with new process | `process_compliance_rate` | percentage | higher is better | ratio / weighted ratio | KPI actuals |
| 3 | Cycle-time shift | `cycle_time_shift` | duration | lower is better | stock / last value | KPI actuals |
| 4 | Training completion + observed proficiency | `training_completion` "Training completion"; `observed_proficiency` "Observed proficiency" | percentage | higher is better | ratio / weighted ratio | training records; assessment records |
| 5 | Decision turnaround time | `decision_turnaround_time` | duration | lower is better | stock / last value | KPI actuals |
| 6 | Percentage of transactions handled through the new journey | `new_journey_share` | percentage | higher is better | ratio / weighted ratio | KPI actuals |
| 7 | Exception / workaround rate | `exception_workaround_rate` | percentage | lower is better | ratio / weighted ratio | KPI actuals |

- The indicator name is the source; the measure names, unit, polarity, nature and value source are this ADR's reading (indicator 4 splits into two measures because REQ-PB-072 requires completion and observed proficiency to be "recorded as two separate measures"). Arabic labels are marked `ar_provisional = true`.
- "Available by name" (REQ-PB-071 acceptance): `listAdoptionIndicatorTemplates` returns the seven indicators with their measures, labels in both languages and the provisional-Arabic flag.
- **Instantiation.** `createAdoptionMetricLink` with `createKpi: true` (KPI-fed measures only) creates, in one transaction, a `kpi_definition` of the transformation from the template (name = the measure's English name, `is_leading = true`, unit, polarity; owner from the request) through slice A's create service, then the link. With `kpiDefinitionId` it links an existing KPI of the same transformation, whose `unit_kind` and `polarity` must equal the template's (422 `adoption_metric_link.kpi_mismatch`). Actuals by period are slice A's (`kpi_actual`), unchanged.

### 3. Entity `adoption_metric_link` (REQ-S16-020 "AdoptionMetricLink")

- Fields: `template_key`, `kpi_definition_id` (required exactly when the template's value source is `kpi_actuals`: trigger `adoption_metric_link_kpi_matches_source`; probes ML01, ML02), `target_kind` ∈ {`transformation`, `outcome`, `initiative`, `stakeholder_group`} with exactly the matching target id (CHECK `adoption_metric_link_target`; probe ML03), `status` ∈ {`active`, `removed`} (removal stamped, final), version and stamps.
- At most one active link per transformation, measure and target (`adoption_metric_link_active_key`). Measure, KPI and target never change (`adoption_metric_link_identity`); a different attachment is a new link.
- Guards: `p2_attach_guards` (version step, deferred audit).

### 4. Adoption interventions; below trajectory creates exactly one (REQ-PB-069, REQ-S11-001)

**Entity `adoption_intervention`** (`0047`):

- Fields: `code` `AI-nn` (`record_code_counter` prefix `AI`), optional `stakeholder_group_id`, `intervention_type` ∈ {`comms`, `training`, `involvement`, `incentive`, `corrective`} (the four B0107 values plus `corrective`, used only by the worker), `title`, `description`, `owner_user_id`, `due_date`, `status`, `origin` ∈ {`manual`, `below_trajectory`}, the trigger fields (`metric_link_id`, `kpi_evaluation_id`, `reporting_period_id`, `scope_kind`, `scope_id`, `trigger_key`), `outcome_note`, completion stamps, `created_source` ∈ {`api`, `worker`}.
- **Shape** (CHECK `adoption_intervention_origin_shape`; probes AI01, AI03): a `manual` intervention is created through the API by a person with an owner and a due date and is never `corrective`; a `below_trajectory` intervention is created by the worker (`created_by` NULL, audit actor `service`), is `corrective`, and names all trigger fields; a manual one names none.
- **Status:** `planned` (every new intervention, probe AI02) → `in_progress` → `done`; `planned` → `done`; `planned` | `in_progress` → `cancelled`. `done` and `cancelled` are final and carry an `outcome_note` (probe AI06). Code, origin and trigger fields are immutable (probe AI07). An intervention without an owner cannot be completed (`adoption_intervention_owner_required`).
- **Communication and training actions** (M0215) are interventions of type `comms` and `training`; a `training_record` may name its training intervention (§6).
- **My Work** (REQ-S11-001 acceptance "an intervention with owner and due date appears in My Work"): on create, and on an owner change, the service calls `createWorkItemOnce` with kind `adoption_intervention_due`, subject `adoption_intervention`, assignee the owner, due date the intervention's, dedupe key `adoption.intervention:<interventionId>:<ownerUserId>`; an owner change cancels the previous owner's open item; `done` or `cancelled` closes it (ADR-0025 §4 subject-bound tasks).

**The below-trajectory rule** (KBE-F, consumer `adoption.indicator_evaluated` on the `kpi.deviation_evaluated` event, `runOnce` with the event's idempotency key):

1. For each **active** `adoption_metric_link` whose `kpi_definition_id` is the event's KPI:
2. The evaluation is **below trajectory** when `deviation = 'adverse'` and `calculated_rag` ∈ {`amber`, `red`} (the gap is beyond the configured threshold, ADR-0028). `green`, `unknown`, `stale` and `not_computable` never create an intervention: an Unknown period is not counted as below trajectory.
3. Inside one transaction: `pg_advisory_xact_lock(730242, hashtext('<linkId>:<scopeKind>:<scopeId>:<reportingPeriodId>'))`; if no intervention with that `trigger_key` exists, insert one (`origin = below_trajectory`, type `corrective`, title = the KPI's name, stakeholder group = the link's when its target is a group); the partial unique index `adoption_intervention_trigger_key` refuses a second (probe AI04), and the trigger `adoption_intervention_evaluation_matches` refuses an evaluation of another KPI, scope or period (probe AI05).
4. **Owner** (first active user found): the link target's owner (stakeholder group `owner_user_id`; outcome `owner_user_id`; initiative `executive_owner_user_id`, then `workstream_lead_user_id`; transformation `lead_user_id`), else the KPI's `owner_user_id`, else the transformation's `lead_user_id`. None → `owner_user_id` NULL, shown `ownerStatus: "unassigned"`, no work item.
5. **Due date:** `addWorkingDays(businessDate, 5, the organization's default calendar)` where `businessDate = p4_business_date(<event created_at>, <calendar timezone>)`; no calendar configured → NULL, shown Unknown with reason `calendar_not_configured`.
6. In the same transaction, the owner's work item (above) and one outbox event **`adoption.check_failed`** with exactly the ADR-0031 §5.4 payload `{ checkId, checkRecordType, transformationId, ownerUserId, subjectLabel, failedAt, businessDate }`, where `checkId` = the intervention id, `checkRecordType = "adoption_intervention"`, `subjectLabel` = the KPI name, `failedAt` = the event's evaluation time; idempotency key `adoption.check_failed:<interventionId>`. Slice E opens exactly one corrective case for it (REQ-S12-016, ADR-0031 §5.4).
7. A redelivered event creates nothing twice (the `processed_message` ledger and `adoption_intervention_trigger_key`).

### 5. Short native feedback and assessment forms (REQ-S11-002)

**Entities `assessment_form`, `assessment_form_version`, `assessment_invitation`** (`0047`):

- `assessment_form`: `kind` ∈ {`feedback`, `proficiency_assessment`} (immutable), `name`, `description`, optional `stakeholder_group_id`, `status` `draft` → `published` → `retired` (final), `current_version_no`, `published_version_no` (never moves back; must exist), stamps (probes FM01, FM05).
- `assessment_form_version` (append-only; probe FM06): `version_no` = the form's `current_version_no + 1` at insert (trigger; probe FM05), `schema` jsonb validated by `p4_assessment_form_schema_valid(kind, schema)` (probes FM02–FM04). **The schema** is the object `{"questions": [...]}` with 1–20 questions; each question has exactly the members `key` (`^[a-z][a-z0-9_]{0,39}$`, unique), `type` ∈ {`single_choice`, `scale`, `yes_no`, `text`}, `label_en` and `label_ar` (1–500 characters), `required` (boolean), plus `options` (only and always for `single_choice`: 2–10 objects with exactly `value`, `label_en`, `label_ar`, values unique), `min`/`max` (only and always for `scale`: integers 0 ≤ min < max ≤ 10), `proficiency` (boolean, optional) and `pass_min` (only and always for a `scale` proficiency question, within its bounds). A `proficiency_assessment` form has exactly one required `yes_no` or `scale` question with `"proficiency": true`; a `feedback` form has none. No other member is accepted. The API validates the same shape (zod) before it writes and returns 400 at the failing pointer; the database function is the last line.
- Editing a form's questions inserts the next version (the published version stays what respondents answer until `publishAssessmentForm` publishes the new one). A response answers the **published** version of a **published** form (trigger `assessment_record_form_published`; probe AR05).
- `assessment_invitation`: an invited user (`user_id`), the group the answers belong to, optional observed person (`subject_user_id`), due date; `open` → `responded` | `cancelled` (final); one open invitation per form, invitee and subject. Created only for a published form. On create the invitee gets one work item, kind `assessment_invitation`, dedupe `assessment.invitation:<invitationId>`.

**Entity `assessment_record`** (REQ-S16-020 "Training/AssessmentRecord", the assessment half; probes AR01–AR05):

- Fields: form and version, optional invitation (one record per invitation, `assessment_record_invitation_key`), `stakeholder_group_id` (required), `kind` ∈ {`feedback`, `proficiency_observation`} matching the form kind, `respondent_user_id` (= `created_by`: a response is the respondent's own, CHECK `assessment_record_respondent_is_creator`), `subject_user_id` or `subject_label` (exactly one, only for an observation), `observed_on`, `answers` (a JSON object keyed by question key; the API checks every required question is answered with a value of its type, every key is a question key, a `single_choice` answer is one of its option values, a `scale` answer an integer within bounds, a `text` answer passes the shared free-text rules), `proficiency_result` ∈ {`proficient`, `not_yet_proficient`} (exactly for an observation), `status` `submitted` → `reviewed` | `withdrawn`, `reviewed` → `withdrawn`, review and withdrawal stamps.
- **The proficiency result is derived from the answers by the API**: a `yes_no` proficiency answer `true` → `proficient`, `false` → `not_yet_proficient`; a `scale` answer ≥ `pass_min` → `proficient`, else `not_yet_proficient`. The client never sends it.
- Answers, result, form, version, group, kind, respondent, subject and date are immutable after submission (probe AR04); a correction is a withdrawal (with a reason) and a new response.
- **Review** (REQ-S11-002 "review:BO"): `reviewAssessmentRecord` sets `reviewed`, `reviewed_by`, `reviewed_at`, an optional note. A submitted record gives one work item to the form's creator, kind `assessment_to_review`, dedupe `assessment.review:<recordId>`.

### 6. Training completion and observed proficiency are separate (REQ-PB-072)

**Entity `training_record`** (`0047`; REQ-S16-020 the training half; probes TR01, TR02): stakeholder group, optional training intervention (must be of type `training`), participant (a user or a label, exactly one), `training_title`, `scheduled_on`, `status` `enrolled` → `completed` | `no_show` | `withdrawn` (all final), `completed_on` (exactly when completed), `recorded_by`.

**The two measures** (KBE-F, `getAdoptionIndicators`; computed with the shared decimal module, results as decimal strings, fractions per ADR-0028 §3, rounded half-up to 6 fractional digits):

- `training_completion` for a group and a reporting period = completed records with `completed_on` in the period ÷ records of the group that are not `withdrawn` and were created on or before the period end. Denominator 0 → **Unknown** (`value: null`, `valueStatus: "unknown"`, reason `adoption.no_training_records`).
- `observed_proficiency` for a group and a period = observed subjects whose **latest** non-withdrawn observation with `observed_on` in the period is `proficient` ÷ observed subjects with such an observation. A subject is `subject_user_id`, or the trimmed, case-folded `subject_label`. No observation in the period → **Unknown** (`value: null`, `valueStatus: "unknown"`, reason `adoption.no_proficiency_observations`), never 0 and never derived from training (REQ-PB-072 acceptance "100% training completion with no proficiency observations shows proficiency Unknown, not adopted"; probe TR01 checks the data shape, the computation is KBE-F's test).
- A target other than a stakeholder group aggregates over the transformation's active groups: numerators and denominators are summed (the weighted-ratio rule), never averaged.
- An observation submitted via a proficiency form links to its stakeholder group and counts from submission until withdrawn (REQ-S11-002 acceptance; probe AR01 shows the link and the count query).
- No status, measure or read model sets "adopted" from training completion.

### 7. People-centered principle: involvement in design and champion constraints (REQ-PB-073)

**Entity `stakeholder_champion`** (`0047`): a named champion of a group (same organization, trigger `stakeholder_champion_same_org`), `active` → `removed` (final; probe CC05), one active row per group and user.

**Entity `stakeholder_involvement`** (`0047`, append-only; probes IV01, IV02): one row records that an impacted group took part in a design workshop (`tom_workshop`) or a T04 design decision (`decision` kind `design`, trigger `stakeholder_involvement_design_decision`), with a note. A mistaken row is corrected by a withdrawal row naming it (`withdraws_involvement_id`, one withdrawal per original, same group and target); the read model hides withdrawn pairs and shows the history.

**Entity `champion_constraint`** (`0047`; probes CC01–CC04): raised **in person** by an active champion of the group (`created_by` = the champion's `user_id`, trigger `champion_constraint_raised_by_champion`) about a T04 design decision of the same transformation (`champion_constraint_design_decision`), with the constraint text; `open` → `addressed` (with a response) | `withdrawn`; final after that; champion, group, decision and text never change.

- **Visible on the decision** (REQ-PB-073 acceptance): `listChampionConstraints?decisionId=` lists them, and slice F adds `championConstraintCount` and `openChampionConstraintCount` to the P4 decision read models it serves (`getAdoptionPlan`, the constraint list); the DG2 `Decision` schema and operations are unchanged (no DG2 response changes). FE-E shows the list on the T04 decision page through the new operation.

### 8. Lock class, events and jobs

| Lock class | Resource | Key | Users |
|---|---|---|---|
| 730242 `adoptionIntervention` | the below-trajectory intervention of one link, scope and period | `<metricLinkId>:<scopeKind>:<scopeId>:<reportingPeriodId>` | KBE-F consumer `adoption.indicator_evaluated` |

Events: consumes `kpi.deviation_evaluated` (ADR-0027 §8); emits `adoption.check_failed` (§4, payload ADR-0031 §5.4). No scheduled job in slice F.

### 9. Authorization (permissions matrix §15)

New codes (`0049`, `P4_ADOPTION_SUSTAINMENT_PERMISSIONS`), slice F part: `adoption.edit`, `assessment_form.manage`, `assessment.respond`, `assessment.review`, `proficiency.record`, `champion_constraint.raise` (all **write**). Probes S02, S04.

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Read templates, groups, plan, champions, interventions, links, indicators, forms, invitations, records, training, involvement, constraints | `transformation.read` (every role in scope, AUD included); templates: any signed-in user | scope; 404 outside it (ADR-0006) |
| Create, update, archive a group; add or remove champions; create or update interventions; create or remove metric links; record or withdraw involvement | `adoption.edit` (TL, BO, WL; REQ-PB-070/REQ-S11-001 "edit:BO,WL,TL") | — |
| Create, edit, publish, retire a form; create invitations | `assessment_form.manage` (BO, WL; REQ-S11-002 "create:BO,WL") | — |
| Submit a response (feedback or observation) | `assessment.respond` (SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC) | an open invitation for the caller **or**, for a proficiency observation without invitation, the caller holds `proficiency.record` (403 `assessment_record.not_invited`) |
| Review a record | `assessment.review` (BO; REQ-S11-002 "review:BO") | — |
| Withdraw a record | `assessment.review`, or the respondent's own record | 403 `assessment_record.not_withdrawable_by_caller` |
| Create or update training records | `proficiency.record` (BO, WL; REQ-PB-072 "record:BO,WL") | — |
| Raise a constraint | `champion_constraint.raise` (BO, WL) | the caller is an active champion of the group (403 `champion_constraint.not_champion`) |
| Address or withdraw a constraint | `decision.edit` (address; the DG2 code for T04 decisions) or the raising champion (withdraw) | 403 `champion_constraint.not_resolvable_by_caller` |

- **AUD** holds no slice F write code: every slice F write by an AUD user is 403, every read in its scope succeeds read-only.
- **Technical admins** hold none of these codes and no `transformation.read`: they get 404 on these transformation-scoped operations.
- **SoD.** None is required by the slice F sources: a reviewer may review a response to a form they created. Every mutation re-checks authorization at commit time, validates, needs `If-Match` (428/409; creates are version 1), writes its audit event in the same transaction, and does no remote I/O inside it (S-4).

### 10. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 400 | `stakeholder_group.stance_invalid` (at `/currentStance`) | "Current stance must be Support, Neutral or Resist." |
| 400 | `stakeholder_group.impact_invalid` (at `/impact` or `/influence`) | "{Field} must be H, M or L." with Field ∈ "Impact", "Influence" |
| 400 | `stakeholder_group.intervention_invalid` (at `/interventionTypes/n`) | "Intervention must be Comms, Training, Involvement or Incentive." |
| 409 | `stakeholder_group.name_taken` (`urn:mth:problem:duplicate`) | "A stakeholder group with this name already exists in this transformation." |
| 422 | `stakeholder_group.archived` | "This stakeholder group is archived and can no longer be changed." |
| 422 | `stakeholder_group.kpi_invalid` (at `/adoptionKpiDefinitionId`) | "The adoption KPI must be a KPI of this transformation." |
| 409 | `stakeholder_champion.exists` (`urn:mth:problem:duplicate`) | "This person is already a champion of this group." |
| 422 | `adoption_intervention.status_transition` | "This intervention cannot move from {from} to {to}." |
| 422 | `adoption_intervention.final` | "This intervention is {status} and can no longer be changed." |
| 422 | `adoption_intervention.outcome_required` (at `/outcomeNote`) | "Record the outcome before completing or cancelling the intervention." |
| 422 | `adoption_intervention.owner_required` | "Assign an owner before completing this intervention." |
| 422 | `adoption_metric_link.kpi_required` (at `/kpiDefinitionId`) | "This indicator is measured by a KPI: name a KPI or create one from the template." |
| 422 | `adoption_metric_link.kpi_not_applicable` (at `/kpiDefinitionId`) | "This measure is computed from training or assessment records and takes no KPI." |
| 422 | `adoption_metric_link.kpi_mismatch` (at `/kpiDefinitionId`) | "The KPI's unit and polarity must match the indicator template." |
| 409 | `adoption_metric_link.exists` (`urn:mth:problem:duplicate`) | "This indicator is already attached to this target." |
| 400 | `assessment_form.schema_invalid` (at the failing pointer under `/questions`) | "The form is not valid: {reason}." |
| 422 | `assessment_form.retired` | "This form is retired and can no longer be changed." |
| 422 | `assessment_form.not_published` | "Only a published form takes invitations and responses." |
| 422 | `assessment_form.status_transition` | "This form cannot move from {from} to {to}." |
| 409 | `assessment_invitation.exists` (`urn:mth:problem:duplicate`) | "This person already has an open invitation to this form." |
| 422 | `assessment_invitation.final` | "This invitation is {status} and can no longer be changed." |
| 400 | `assessment_record.answer_invalid` (at `/answers/<key>`) | "This answer is not valid for the question." |
| 400 | `assessment_record.answer_required` (at `/answers/<key>`) | "This question requires an answer." |
| 400 | `assessment_record.subject_required` (at `/subjectUserId`) | "A proficiency observation names the person observed." |
| 403 | `assessment_record.not_invited` | "You are not invited to answer this form." |
| 403 | `assessment_record.not_withdrawable_by_caller` | "Only the respondent or a reviewer can withdraw this response." |
| 422 | `assessment_record.status_transition` | "This response cannot move from {from} to {to}." |
| 422 | `assessment_record.withdrawn` | "This response is withdrawn and can no longer be changed." |
| 422 | `training_record.final` | "This training record is {status} and can no longer be changed." |
| 422 | `training_record.intervention_not_training` (at `/interventionId`) | "Only a training intervention can be linked to a training record." |
| 422 | `stakeholder_involvement.target_invalid` (at `/decisionId` or `/workshopId`) | "Involvement is recorded on a design workshop or a T04 design decision of this transformation." |
| 422 | `stakeholder_involvement.already_withdrawn` | "This involvement record is already withdrawn." |
| 403 | `champion_constraint.not_champion` | "Only an active champion of this group can raise a constraint." |
| 422 | `champion_constraint.decision_invalid` (at `/decisionId`) | "A constraint links to a T04 design decision of this transformation." |
| 422 | `champion_constraint.final` | "This constraint is {status} and can no longer be changed." |
| 403 | `champion_constraint.not_resolvable_by_caller` | "Only a decision editor can address this constraint, and only its champion can withdraw it." |

Every problem also carries the shared codes of S-11 (400 `validation`, 404, 409 `version_conflict`, 428 `precondition_required`); every code above is translated by FE-E in `i18n/{en,ar}/problems.json` (S-6).

### 11. REQ-S16-020: the entity group

| M0326 entity | Table(s) | Primary key | Owner | Status |
|---|---|---|---|---|
| StakeholderGroup | `stakeholder_group` (+ `stakeholder_champion`) | `id` | `owner_user_id` (NOT NULL) | `status` `active`/`archived` |
| AdoptionIntervention | `adoption_intervention` | `id` | `owner_user_id` (NOT NULL for manual; NULL only when the worker resolves no owner, §4) | `status` `planned`/`in_progress`/`done`/`cancelled` |
| Training/AssessmentRecord | `training_record`, `assessment_record` (+ `assessment_form`, `assessment_form_version`, `assessment_invitation`) | `id` | `recorded_by` / `respondent_user_id` | `status` (`enrolled`/`completed`/`no_show`/`withdrawn`; `submitted`/`reviewed`/`withdrawn`) |
| AdoptionMetricLink | `adoption_metric_link` | `id` | `created_by` (the link has no business owner of its own; its KPI has) | `status` `active`/`removed` |

The REQ-S16-020 integration test ("creates and reads each one through the API with authorization enforced") is BE-H2's (p4-work-split §F+G.6), after BE-H's and KBE-F's routes exist.

### 12. Decimal and Unknown

- The two record-fed measures are decimal fractions (§6) or Unknown; KPI-fed measures are slice A's decimals, Unknown, Stale or Not computable, unchanged (ADR-0028). No slice F value is a binary float; nothing Unknown is shown as 0 or green.
- `getAdoptionIndicators` returns per measure `{ value, valueStatus ∈ {ok, unknown, stale, not_computable}, valueReason, calculatedRag, trajectoryValue, reportingPeriodId }`; `calculatedRag` is slice A's for KPI-fed measures and `null` for the two record-fed measures (they have no trajectory in DG4; §13).
- An intervention's NULL due date (worker, no calendar) and NULL owner are shown Unknown / unassigned, never a guessed value.

### 13. What DG4 does not build (stated so it is not claimed)

1. Trajectories and RAG for the two record-fed measures (training completion, observed proficiency): DG4 shows their values and Unknown; below-trajectory interventions are created for KPI-fed measures only. A team that needs a trajectory on either measures it with a KPI-fed link (template keys 1–3, 5–7) or enters it as a KPI actual.
2. Anonymous or external respondents, reminders for open invitations (DG6 notifications), form branching or scoring beyond the proficiency rule.
3. A rule-builder configuration of the below-trajectory automation (D-089 R5: code-defined; threshold from slice A's RAG thresholds; the 5-working-day due date is a constant in `adoption/interventions.ts`).

## Alternatives considered

1. **Indicators as a separate measurement system.** Rejected: REQ-PB-071 says "KPI templates attachable to adoption outcomes with actuals by period"; reusing slice A keeps one trajectory, actual and RAG model.
2. **Seven template rows with indicator 4 as one combined measure.** Rejected: REQ-PB-072 requires completion and proficiency "recorded as two separate measures"; one combined value would let completion count as adoption.
3. **A free-form JSON blob for T13.** Rejected: ADR-0003/ADR-0014 require typed relational tables for core entities; only versioned form questions are validated JSON (§5).
4. **Interventions created per actual instead of per evaluation.** Rejected: an actual can be re-accepted (versions), and REQ-PB-069 requires exactly one per gap; the evaluation of (KPI, scope, period) is the stable key.
5. **Stakeholder groups as access groups (`access_group`).** Rejected: access groups grant rights; stakeholder groups describe impacted populations and grant nothing.
6. **Constraints as comments on the DG2 decision.** Rejected: the DG2 `Decision` schema would change (a DG2 response change); a separate linked entity keeps DG2 byte-stable.

## Consequences

- `0047` adds 12 tables, 2 non-trigger functions (`p4_text_array_distinct`, `p4_assessment_form_schema_valid`), a guard trigger function on each of the 11 tables other than the template, and widens the `record_code_counter` prefix set by `SG` and `AI`; `0049` adds 6 slice F permission codes and 3 slice F work-item kinds (`adoption_intervention_due`, `assessment_invitation`, `assessment_to_review`).
- KBE-F depends on slice A's create service for KPIs and on the `kpi.deviation_evaluated` event (KBE-C, merged, D-098).
- Slice E's `raid.corrective_adoption` consumer receives `adoption.check_failed` once per worker intervention.
- FE-E translates the codes of §10 and shows Unknown and the provisional-Arabic flag.

## Verification

- **Database (probe, real output):** S01, S02, S03, S04, S05, SG01–SG09, CC01–CC05, IV01, IV02, ML01–ML03, AI01–AI07, FM01–FM06, AR01–AR05, TR01, TR02, P01.
- **API (implementers' tests, p4-work-split §F+G):** every refusal of §10 with its exact text; AUD 403 on every write; 404 outside scope; `If-Match` 428/409; audit event per mutation; a Hostile stance 400; an intervention with owner and due date in My Work; a proficiency observation through the form counted in the group's measure; 100% completion with no observation → proficiency Unknown; one intervention for an actual below trajectory, none twice on redelivery, and one `adoption.check_failed` event; a champion's constraint listed on its decision; the REQ-S16-020 entity-group test.

## Amendment (2026-10-09, T-DG4-ARCH-R1): the assessment form's record version, the single metric-link read, and the codes added outside §10

### A1. A new assessment form is at record version 2 (BE-H2 handback §6 item 1; D-105) — decided: amend the rule for this entity, no migration

`createAssessmentForm` makes two audited writes to the form row in one transaction: the insert (record version 1, `current_version_no = 0`, as `assessment_form_guard` requires) and, after its first `assessment_form_version` row (`version_no = 1`, which the version guard requires to be `current_version_no + 1`), the step to `current_version_no = 1` (record version 2, as `p2_row_guard` requires). So the 201 returns `version: 2`, `ETag: "2"` and `currentVersion.versionNo: 1`, with three audit events (the form's create at version 1, the question version's create, and the form's step to version 2). **This is accepted as the one documented exception to "creates are version 1"** (p4-work-split S-4): every write is real and audited, the ETag is exact, and a client always takes the version from the ETag. A trigger change (`0061`) was rejected: it would loosen two `0047` guards that the probe proves, to save one version number. The contract's 201 description now says this. Every later form write keeps the usual `version + 1`.

### A2. `getAdoptionMetricLink` (KBE-F handback §4)

`createAdoptionMetricLink`'s 201 `Location` is `…/adoption-metric-links/{adoptionMetricLinkId}`, the pattern every other create in this slice follows. The read is now in the contract: `GET /api/v1/transformations/{transformationId}/adoption-metric-links/{adoptionMetricLinkId}`, operationId `getAdoptionMetricLink`, `transformation.read`, 200 `AdoptionMetricLink` with `ETag` (active or removed; 404 for another transformation's link or none). Owner: the kpi-benefits-engineer repair task (pending list `p4-pending-arch-r1.ts`). The `Location` header is unchanged.

### A3. Codes and keys added outside §10 (accepted, with their exact English texts)

`invalid_transition` and `validation.required` are existing codes; only their detail and use are recorded. `validation.not_applicable` is shared with ADR-0031 and ADR-0034.

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `validation.not_applicable` | 400 field | accepted | This field does not apply here. |
| `validation.conflict` | 400 field | accepted | Name an existing KPI or ask to create one, not both. |
| `adoption.task.intervention_due` | message key | accepted | Adoption intervention {code} is due. |
| `adoption.task.assessment_invitation` | message key | accepted | Please complete the form {formName}. |
| `adoption.task.assessment_to_review` | message key | accepted | Review the submitted form {formName}. |
| `adoption.no_reporting_period` | reason key | accepted | Unknown: the organization has no reporting period. |
| `invalid_transition (existing code)` | 422 detail | accepted detail texts | This champion is already removed. / A withdrawal record cannot itself be withdrawn. / This metric link is already removed. |
| `validation.required (existing code)` | 400 field | accepted use | at /reportingPeriodId when the organization has no open or closed period (getAdoptionIndicators) |
