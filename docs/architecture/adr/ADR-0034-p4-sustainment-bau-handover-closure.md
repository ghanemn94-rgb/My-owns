# ADR-0034: Sustainment: separate delivery, adoption, validated-value and closure statuses, the governed closure, benefit transition decisions, performance areas beyond closure, BAU handover with receiving-owner acceptance, controls and control checks, recurring reviews, the continuous-improvement backlog, lessons, and reopening with preserved history

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-06), 2026-10-09.
- **Requirements (slice G of `docs/architecture/p4-plan.md`):** REQ-PB-009, REQ-PB-083, REQ-PB-084, REQ-S03-002, REQ-S03-003, REQ-S11-004, REQ-S11-005, REQ-S11-006, REQ-S11-007, REQ-S11-008, REQ-S11-009.
- **Sources (quoted where a design point has one):**
  - Playbook B0014 ("Benefits before closure: an initiative is not complete when delivered; it is complete when value is realized and sustained."), B0021 (phase 6 "REALIZE | Prove & sustain value | Benefits, BAU handover, continuous improvement"), B0023 (G6: "G6 - Sustain | Is value embedded in BAU? | Benefits evidence, ownership transfer, controls, continuous improvement backlog."), B0101 (T12 row "BAU Handover | I | C | A/R | R | C | C": Business Owner A/R, Workstream Lead R), B0119 ("Objective: convert delivered capabilities into validated business value, transfer ownership to BAU, and establish a mechanism for sustained performance."), B0121 (Sustain: "Who owns the metric after transformation closure? | BAU owner + control cadence").
  - Master prompt M0092 ("Transformations may be time-bounded; performance areas and BAU ownership can continue indefinitely. Initiative delivery, business adoption, validated value and transformation closure must have separate statuses."), M0217 ("Support continuous performance management after project delivery and after transformation closure. BAU handover must include accepted business owner and KPI owner, operating procedures, controls, evidence, capability readiness, unresolved accepted risks, benefit monitoring cadence, data access and improvement backlog. Capture receiving-owner acceptance."), M0218 ("A transformation cannot be marked successful solely because initiatives are complete. Show delivery complete, value validation pending, and BAU accepted as separate states. For benefits with a longer realization period, allow a documented transition decision with residual benefit ownership and scheduled monitoring; do not label forecast future value as already sustained."), M0219 ("Create periodic control checks, review tasks, lessons and continuous-improvement items. Reopening a deteriorating performance area must preserve earlier closure and handover history."), M0237 ("BAU handover accepted | Transfer routine ownership and activate recurring performance/control reviews"), M0327 ("BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment.").
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 Q4 (G6 approval does not close a transformation; closure is a separate governed action: an approved G6, plus validated value or a documented transition decision), seam 15 (the closure-refusal clause "which is not available in this release" is corrected), R2/R3 (performance areas and the sustainment entities, whose groups close at DG5, are built as increments in DG4; HealthAssessment is not built), R4, R5; D-090 (S-12); D-092 (7) (transformation-scoped paths); D-093 (4) (ADR-0031 §5.4 payload for `control_check.failed`).
- **Builds on:** ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0015 (G6 is a `gate_instance` row, product gate), ADR-0016 (guards, lock registry §6), ADR-0021 (initiative statuses; `launched → completed` "reserved for P4"), ADR-0025 (calendar, `addWorkingDays`, `runOnce`, `createWorkItemOnce`, job schedules), ADR-0026 (the canonical `approval`, SoD `requester_excluded`, delegation), ADR-0029/ADR-0030 (benefit, `bau_owner_user_id`, `control_cadence`, measurements with status `validated`, value series incl. `forecast` and `sustained`), ADR-0031 §5.4 (check events and the corrective case), ADR-0033 (adoption interventions and the adoption status signal).
- **Physical model:** `0048_p4_sustainment.sql`, `0049_p4_adoption_sustainment_permissions.sql`; `0050_p4_sustainment_schedules.sql` (the two job schedules; written by the architect so the migration ids stay contiguous, S-12). Probe ids refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/probe-output.txt` (104 PASS, 0 FAIL).
- **Two gate systems.** G6 is the product's Sustain business approval (a `gate_instance` row); this ADR reads its status and never writes it. An approved G6 never implies the engineering gate DG7, and nothing here reads or writes DG0–DG7. The one slice G business approval is the receiving owner's handover acceptance (§9); no job, trigger or seed accepts a handover, approves a transition decision or closes anything. Probe data is synthetic (the probe's approved G6 instance is a synthetic fixture inserted with replication triggers off, ST10).

## Context

As built before slice G (checked on `HEAD` `588fe12`):

1. `initiative.status` (`0020`, ADR-0021 §3) has the edge `launched → completed`, which ADR-0021 reserves for P4; no route uses it. There is no column for who completed delivery, no adoption status and no closure.
2. `transformation.status` ∈ {`draft`, `active`, `on_hold`, `closed`}; `PATCH /transformations/{id}` refuses `closed` with 422 invalid-transition and the text "A transformation cannot be closed by a status edit. Closure requires the G6 (Sustain) business approval with validated benefits, which is not available in this release." (`transformations/routes.ts`).
3. **R2 check (p4-plan §6).** The API write guards under `apps/api/src/modules` that refuse writes on a transformation test `archived_at`, not its status: `transformations/register-kit.ts` (the register kit's transformation check), `kpi/support.ts` (the KPI scope check), and the `PATCH` in `transformations/routes.ts`. `grep -rn '"closed"' apps/api/src/modules` (non-test files) finds no comparison of a transformation's status with `closed` other than `GOVERNED_TARGET_STATUSES`. Closing a transformation therefore leaves its KPI writes, register writes and the new slice G writes open, provided closure never sets `archived_at` (§7; probes ST11, ST12).
4. `benefit` (`0037`) has `bau_owner_user_id`, `control_cadence` and `lifecycle_step` (Sustain needs both, `benefit_sustain_outputs_present`); `benefit_measurement.status = 'validated'` marks Finance-validated values (ADR-0030).
5. `gate_instance` (`0017`) has one row per transformation and gate; G6's `next_phase` is NULL.
6. ADR-0031 §5.4 fixes the payload of `control_check.failed` and BE-D2's consumer `raid.corrective_control`.

## Decision

### 1. Four separate statuses (REQ-S03-003, REQ-PB-009, M0092)

| Status | Where | Values | Set by | Never derived from |
|---|---|---|---|---|
| Delivery | `initiative.status` (DG3) + `delivery_completed_at`/`_by` (`0048`) | DG3 values; `completed` = delivery complete | `completeInitiativeDelivery` (`launched → completed`; WL, TL) | — |
| Adoption | `initiative.adoption_status` (`0048`) | `not_assessed` (default), `on_track`, `at_risk`, `adopted` | `setInitiativeAdoptionStatus` (BO), with note and stamps | delivery |
| Validated value | derived (§2) | `no_benefit`, `validation_pending`, `validated`, `validated_with_transition` | Finance validations (slice B) and approved transition decisions (§3) | delivery, adoption |
| Closure | `closure_record` (`0048`) | open (no row) / closed (one row) | `closeInitiative` (TL), `closeTransformation` (TL) | delivery, adoption |

- `completed` requires the delivery stamps (trigger `initiative_delivery_complete_guard`; probe ST01); the stamps are set once, with that move. Setting delivery leaves adoption, value and closure unchanged (probe ST02: adoption stays `not_assessed`, no closure row).
- An adoption status other than `not_assessed` names who set it and when (CHECK `initiative_adoption_status_stamps`; probe ST03).
- Existing initiatives keep their values; the new columns are NULL or the default (probe G04).
- The DG3 `Initiative` schema and the DG3 operations are byte-stable; the four statuses are served by `getInitiativeStatusModel` (§2). The ADR-0021 "completed initiative is read-only" rule still applies to the T05 card and links; the adoption status and closure are separate actions on new paths.

### 2. The status model read (REQ-S11-006, REQ-PB-009 UI text)

**Benefits of an initiative:** benefits with `status = 'active'` that are allocated to it in their allocation set in force (`benefit_allocation.set_no = benefit.allocation_set_no`) or enabled by it (an active `benefit_enabler`). **Benefits of a transformation:** its benefits with `status = 'active'`.

**Per benefit:** `validated` when it has at least one `benefit_measurement` with `status = 'validated'`; else `transition` when it has an approved `transition_decision` (§3); else `pending`.

**Value status of a subject:** `no_benefit` (no benefit); `validation_pending` (at least one `pending`); `validated` (all `validated`); `validated_with_transition` (none `pending`, at least one `transition`).

**`getInitiativeStatusModel`** returns `{ delivery, adoption, adoptionSource, value, closure, label }`:

- `adoption` = `at_risk` with `adoptionSource: "indicator"` while an open (`planned` or `in_progress`) below-trajectory intervention exists for a metric link targeting the initiative or for an evaluation with `scope_kind = 'initiative'` and `scope_id` = the initiative (ADR-0033 §1); otherwise the stored status with `adoptionSource: "owner"`.
- `label` (en; ar translated at render time, S-6): `"Closed"` when closed; else `"Delivered — value validation pending"` when delivery is `completed` and value is `no_benefit` or `validation_pending` (REQ-PB-009 acceptance text); else `"Delivered — value validated"` when delivery is `completed`; else `"In delivery"`.

**`getTransformationStatusModel`** returns `{ deliveryState, valueState, bauState, closureState, label, initiatives: {total, completed}, performanceAreas: {total, bau} }`:

- `deliveryState`: `delivery_complete` when the transformation has at least one initiative that is not `cancelled` and all such initiatives are `completed`; else `in_delivery`.
- `valueState`: the value status of the transformation (above).
- `bauState`: `no_performance_area` (none that is not `retired`), `bau_accepted` (all non-retired areas of the transformation are `bau`), else `bau_pending`.
- `closureState`: `closed` (a transformation `closure_record`) or `open`.
- `label`: `"Closed"`; else `"Delivery complete - value validation pending"` when `deliveryState = delivery_complete` and `valueState` ∈ {`no_benefit`, `validation_pending`} (REQ-S11-006 acceptance text, verbatim); else `"Value validated - BAU acceptance pending"` when delivery is complete, value is `validated`/`validated_with_transition` and `bauState ≠ bau_accepted`; else `"Value validated - BAU accepted"` when all three hold; else `"In delivery"`. **No label says "successful"**, and none is derived from initiative completion alone (M0218).

Both reads return each component separately so views show them side by side (REQ-S03-003 "views show all four side by side"). The workspace header (slice J) reads the same service.

### 3. Benefit transition decisions (REQ-S11-007, M0218)

**Entity `transition_decision`** (`0048`; probes TD01–TD06):

- Fields: `code` `TD-nn`, `benefit_id`, `residual_owner_user_id`, `rationale` (3–4000), `expected_realization_end`, `monitoring_frequency` ∈ {`weekly`, `monthly`, `quarterly`, `semi_annual`, `annual`}, `monitoring_interval` (1–12), `first_monitoring_date` (≤ `expected_realization_end`), `next_monitoring_date`, `status`, `approval_id`, `decided_at`/`decided_by`.
- **Status:** `draft` → `submitted` (with its canonical `approval`) → `approved` | `rejected`; `submitted` → `draft` (changes requested); `draft` | `submitted` → `withdrawn`. Approved, rejected and withdrawn are final; an approved decision's content never changes, only `next_monitoring_date` advances (probe TD03). A submitted decision's content is frozen. At most one `draft`, `submitted` or `approved` decision per benefit (probe TD02).
- **Decision through the canonical approval** (ADR-0026 §4): `submitTransitionDecision` creates an `approval` of type `benefit_transition_decision` (`0049`; subject `transition_decision`, SoD `requester_excluded`), assignee party SP (REQ-S11-007 "decide:SP or configured authority"; an organization configures another authority through the approval's assignee party, ADR-0026), with the ADR-0026 due-date rules. The approval provider moves the decision to `approved` (setting `decided_*` and `next_monitoring_date = first_monitoring_date`), `rejected`, or back to `draft` (changes requested). Approval needs `approval.decide` (SP, BO, FIN; ADR-0026 §8) and the requester cannot approve.
- **Forecast stays forecast.** The service writes no benefit value, measurement, lifecycle step or `sustained` series row (probe TD01: measurement count and benefit version unchanged); the benefit's forecast is still reported in the `forecast` series of ADR-0030 and its value status becomes `transition` (§2), never `validated` or `sustained`.
- **Monitoring tasks** for the residual owner: `sustainment_review` rows of subject `transition_decision`, assigned to the residual owner only (trigger `sustainment_review_decision_approved`; probes TD04, TD05), created by the review scan (§6) from `next_monitoring_date`, each with a work item of kind `benefit_monitoring_due`.

### 4. Performance areas that outlive their transformation (REQ-S03-002, REQ-S11-004, REQ-S11-009)

**Entity `performance_area`** (`0048`): `code` `PA-nn`, `transformation_id` (the **origin** transformation: scope, audit and code counter), `name`, `description`, optional `business_unit_id` and `sponsor_user_id`, `bau_owner_user_id`, `kpi_owner_user_id`, `review_frequency` (default `monthly`), `review_interval`, `next_review_date`, `cycle_no`, `status`, `current_handover_id`, retire stamps.

- **Status:** `establishing` (new, cycle 1, no handover; probe PA02) → `bau` (only with the accepted handover of the current cycle, trigger `performance_area_bau_handover_accepted` and CHECK `performance_area_bau_complete`; probe PA03) → `reopened` (cycle + 1; probes RO01–RO03) → `bau` (with the new cycle's accepted handover; probe RO07); any non-retired → `retired` (final).
- **No slice G guard reads the origin transformation's status.** After the transformation closes, the area still takes reviews, control checks and edits (probe ST11), and its KPIs still take actuals (probe ST12, §Context 3).
- **Entity `performance_area_link`** (`0048`): the area's KPIs and benefits (`link_kind` ∈ {`kpi`, `benefit`}), one active link per target, removal stamped.
- **Entity `performance_area_cycle`** (append-only; probes RO04, RO05): one row per cycle. Cycle 1 is written with the area (a deferred trigger refuses an area without the row of its current cycle at COMMIT: probes PA01, RO01). A reopening writes the next cycle with `reopen_reason` (3–2000) and copies, as they are at that moment, the prior cycle's accepted handover id, acceptance time and acceptor, and — when the origin transformation has a closure record — its id and closure time.
- **Reopening** (`reopenPerformanceArea`, BO and TL; REQ-S11-009): only from `bau`; steps `cycle_no` by exactly 1 (trigger `performance_area_cycle_step`; probe RO02); keeps `current_handover_id` pointing at the prior accepted handover until the new one is accepted (`performance_area_reopen_keeps_handover`); the prior handover stays `accepted`, final and immutable (probes HO06, RO03, RO06). Nothing is overwritten: the original handover acceptance and the closure date remain visible and unchanged (`getPerformanceArea` returns the cycles with their prior handover and closure).

### 5. BAU handover and receiving-owner acceptance (REQ-PB-083, REQ-S11-005, M0217, M0237)

**Entity `bau_handover`** (`0048`): `code` `HO-nn`, `performance_area_id`, `cycle_no` (the area's current cycle; trigger `bau_handover_area_open`), and the M0217 content:

| M0217 item | Field(s) |
|---|---|
| accepted business owner | `receiving_owner_user_id` (NOT NULL) and the acceptance stamps |
| KPI owner | `kpi_owner_user_id` |
| operating procedures | `operating_procedures` |
| controls | the area's active `control` rows (at least one) |
| evidence | `bau_handover_evidence` rows (at least one; append-only, links to `evidence`) |
| capability readiness | `capability_readiness` |
| unresolved accepted risks | `unresolved_accepted_risks` |
| benefit monitoring cadence | `benefit_monitoring_cadence` ∈ {`weekly`, `monthly`, `quarterly`, `semi_annual`, `annual`} |
| data access | `data_access` |
| improvement backlog | `improvement_backlog_summary` (the API lists the area's open `improvement_item` rows beside it) |
| receiving-owner acceptance | `status = 'accepted'`, `accepted_at`, `accepted_by` = `receiving_owner_user_id` |

- **Status:** `draft` → `submitted` → `accepted` | `returned`; `returned` → `submitted`. Accepted is final and immutable (probe HO06). Content changes only in `draft` or `returned` (`bau_handover_content_frozen`; probe HO08). At most one handover in progress and one accepted per area and cycle (probe HO07).
- **Submit validates every item.** The database refuses `submitted` unless every content field is present (CHECK `bau_handover_content_complete`; probe HO01 "a handover missing data access is rejected"), the area has an active control (probe HO02) and the handover has evidence (probe HO03). The API checks the same list first and answers 422 `bau_handover.incomplete` naming every missing item (§12).
- **Submission notifies the receiving owner:** one work item, kind `bau_handover_to_accept`, dedupe `sustainment.handover:<handoverId>:<handover version after the submit>`, closed when the handover is accepted or returned.
- **Only the receiving owner accepts or returns.** `acceptBauHandover`/`returnBauHandover` need `bau_handover.accept` **and** the caller = `receiving_owner_user_id`, else **403** `bau_handover.not_receiving_owner` (REQ-S11-005 acceptance); the database CHECKs `accepted_by = receiving_owner_user_id` and `returned_by = receiving_owner_user_id` (probe HO04). A delegate does not accept for the receiving owner in DG4 (acceptance transfers ownership to that person).
- **Acceptance transaction** (BE-I; lock 730243 on the area): the handover → `accepted`; the area → `bau`, `current_handover_id`, `bau_owner_user_id` = receiving owner, `kpi_owner_user_id`, `next_review_date` = the acceptance business date plus one review period (`review_frequency` × `review_interval`, calendar months or weeks, not working days); routine ownership transfer: every KPI linked to the area gets `owner_user_id` = the handover's KPI owner (version + 1, audit), every control of the area without an owner gets the receiving owner, every benefit linked to the area with no `bau_owner_user_id` gets the receiving owner and `control_cadence` = the monitoring cadence; and the **first recurring review**: one `sustainment_review` (subject `performance_area`, current cycle, due `next_review_date`, assignee the BAU owner) with its work item (kind `performance_review_due`, dedupe `sustainment.review:<areaId>:<dueDate>`). A repeated acceptance call is refused (accepted is final), and the review's unique key (`sustainment_review_due_key`) makes the review exactly once (REQ-PB-083 acceptance; probe RV02).

### 6. Recurring reviews and control checks (REQ-S11-004, REQ-S11-008, M0219)

**Entity `sustainment_review`** (`0048`): subject `performance_area` (with its cycle; only while the area is `bau` in that cycle, probe RV03) or `transition_decision` (only an approved one, for its residual owner, probes TD04, TD05); `due_date`; `assignee_user_id`; `status` `due` → `done` | `cancelled` (final); completion needs `outcome_note` and `performance_signal` ∈ {`on_track`, `deteriorating`, `unknown`} (probe RV04). **Unique per subject and due date** (probe RV02).

**Entity `control`** (`0048`): `code` `CTL-nn`, area, name, description, owner, `frequency` (same set) and `frequency_interval`, `next_check_date`, `active` → `retired` (final).

**Entity `control_check`** (`0048`; probes CK01–CK06): one per control and due date (unique: probe CK02), only for an active control of the same area (probe CK06); `due` → `passed` | `failed` | `cancelled` (final, probe CK05); `failed` needs a `result_note` (probe CK03); performed stamps.

**The scans** (BE-I2, `apps/worker/src/handlers/sustainment.ts`; schedules seeded by `0050`; both `runOnce` per run key, both in the organization's timezone, default `Asia/Riyadh`):

- `sustainment.review_scan` (daily): for every area in `bau` whose `next_review_date` ≤ today's business date + 7 days, insert the review for `next_review_date` if absent (the unique key makes a rerun or a restart a no-op) with its work item, then advance `next_review_date` by one step (version + 1, audit as the service); the same for every approved transition decision with `next_monitoring_date` ≤ the expected realization end (BE-J's service, called from this handler). The review for a due date is therefore created at the latest 7 days before it is due, and on the first run after a worker outage; this is how "after closure, the next scheduled review task is created on time" (REQ-S11-004) is met — the scan never reads the transformation's status.
- `sustainment.control_check_scan` (daily): for every active control whose `next_check_date` ≤ today + 7 days, insert the check for that date if absent (owner = the control's owner, else the area's BAU owner) with its work item (kind `control_check_due`, dedupe `sustainment.control_check:<checkId>`), then advance `next_check_date`.
- **A failed check** (`recordControlCheck` with `failed`; BE-I2): in the same transaction, one outbox event **`control_check.failed`** with exactly the ADR-0031 §5.4 payload (`checkId` = the check id, `checkRecordType = "control_check"`, `ownerUserId` = the control owner or `null`, `subjectLabel` = the control's name, `failedAt`, `businessDate`); idempotency key `control_check.failed:<checkId>`. Slice E opens exactly one corrective case (the recovery action with owner and follow-up date; REQ-S11-008 "a failed control check creates a recovery action"; D-093 (2)).

### 7. The governed closure (REQ-PB-009, REQ-S03-003, REQ-S11-007; D-089 Q4, seam 15)

**Entity `closure_record`** (`0048`, append-only; probes ST04–ST10): `subject_kind` ∈ {`initiative`, `transformation`}, `initiative_id` (exactly for an initiative), `basis` ∈ {`validated_value`, `transition_decision`, `validated_value_and_transition_decision`}, `snapshot` (JSON object: per benefit the validated measurement ids or the approved transition decision id; for a transformation also the approved G6 gate decision id and the accepted handover ids), `closure_note`, `closed_at`, `closed_by` (= `created_by`). One per subject (probe ST06). The database also refuses an initiative closure unless the initiative is `completed` (probe ST04) and a transformation closure unless its G6 `gate_instance` is `approved` (probe ST08), and refuses `transformation.status = 'closed'` without the transformation's closure record (trigger `transformation_closure_guard` on the DG1 table; probe ST09).

**`closeInitiative`** (`initiative.close`, TL; lock 730244 `initiative:<id>`). Checks in this order, the first failure answers:

1. not `completed` → 422 invalid-transition `closure.delivery_not_complete`;
2. already closed → 409 `closure.already_closed`;
3. value status `no_benefit` or `validation_pending` → **422 invalid-transition `closure.value_validation_pending`** (REQ-PB-009 acceptance "an initiative with delivery=Complete and no validated benefit cannot be closed (API 422 invalid-transition)");
4. a `validated` benefit without `bau_owner_user_id` → 422 invalid-transition `closure.sustainment_owner_missing` (B0121 Sustain "BAU owner"; a `transition` benefit's sustainment owner is its residual owner).

Then the closure record (basis from the per-benefit statuses) and its audit event.

**`closeTransformation`** (`transformation.close`, TL; lock 730244 `transformation:<id>`). Checks in this order:

1. archived → 422 `transformation.archived` (the DG1 code and text);
2. status not `active` or `on_hold` → 422 invalid-transition `closure.transformation_not_open`;
3. G6 not `approved` → 422 invalid-transition `closure.g6_not_approved`;
4. value status `no_benefit` or `validation_pending` → **422 invalid-transition `closure.value_validation_pending`** (REQ-S03-003 acceptance "the API rejects a closure request while validated value is pending unless a transition decision exists": a pending benefit covered by an approved transition decision is not pending, §2);
5. `bauState = bau_pending` → 422 invalid-transition `closure.bau_not_accepted`.

Then, in one transaction: the closure record; `transformation.status = 'closed'`, `version + 1`, audit `transformation.closed`. **`archived_at` is not set**, so the R2 guards (§Context 3) keep accepting KPI actuals, register writes, reviews, control checks, the CI backlog and lessons (probes ST11, ST12). G6 approval alone closes nothing (D-089 Q4).

**Seam 15 (DG1 text change, accepted by D-089).** The `PATCH` refusal keeps its 422 invalid-transition and its first sentence; BE-J changes the second sentence to: "Closure requires the G6 (Sustain) business approval with validated benefits; use the closure action." — dropping "which is not available in this release", which becomes untrue. The DG1/DG2 tests that pin the old text (`transformations.test.ts`, `contract.test.ts`, `p2-exercises.ts`, `registers.test.ts` where they assert the detail) are updated by BE-J in the same change; their status and problem type are unchanged.

### 8. Continuous-improvement backlog and lessons (REQ-PB-084, REQ-S11-008)

**Entity `improvement_item`** (`0048`; probes CI01–CI03): `code` `CI-nn`, origin transformation, optional area, title, description, `source_kind` ∈ {`manual`, `lesson`, `control_check`, `review`, `handover`} with exactly the matching source id, owner, priority H/M/L, target date, `open` → `in_progress` ⇄ `open`; `open` | `in_progress` → `done` | `rejected` (final, with a resolution note). No guard reads the transformation's status: the backlog stays visible and editable after closure (REQ-PB-084 acceptance; probe ST11). **"G6 lists the backlog"**: `listImprovementItems` is the read the G6 evaluator of slice H uses (`GateFactsProvider`, ARCH-07); slice G exposes it, slice H consumes it.

**Entity `lesson`** (`0048`; probes LL01, LL02): `code` `LL-nn`, origin transformation, optional area, title, context, lesson text, recommendation, up to 10 distinct tags (1–50 characters each), `draft` → `published` → `archived`; `draft` → `archived`. `search_document` is a stored `tsvector` (configuration `simple`) over title, context, text, recommendation and tags, indexed (GIN) for published lessons.

- **Searchable from another transformation** (REQ-S11-008 acceptance): `searchLessons` (`GET /api/v1/lessons/search?q=&tag=&cursor=&limit=`) needs `lesson.search` (read; every business role and AUD) and returns the **published** lessons of every transformation of the caller's organization whose business unit is in the caller's scope (ADR-0006 scope rules), matching `plainto_tsquery('simple', q)`; drafts appear only in their own transformation's `listLessons`. A lesson of a transformation outside the caller's scope is not returned (no existence disclosure). Probe LL01 shows the organization-scoped query finding transformation 1's lesson.

### 9. Authorization (permissions matrix §15)

New codes (`0049`), slice G part: `adoption_status.set`, `initiative.complete_delivery`, `initiative.close`, `transformation.close`, `performance_area.manage`, `performance_area.reopen`, `bau_handover.prepare`, `control.manage`, `control_check.record`, `sustainment_review.complete`, `improvement.edit`, `lesson.edit`, `transition_decision.propose` (all **write**), `bau_handover.accept` (**business_approval**), `lesson.search` (**read**). Probes S02, S04.

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Read areas, links, cycles, handovers, controls, checks, reviews, CI items, lessons, transition decisions, closure records, status models | `transformation.read` (every role in scope, AUD included) | scope; 404 outside it |
| Search published lessons across transformations | `lesson.search` (SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC, AUD) | business-unit scope (§8) |
| Complete delivery | `initiative.complete_delivery` (WL, TL; REQ-PB-009 "set-delivery:WL") | — |
| Set adoption status | `adoption_status.set` (BO; REQ-S03-003 "set-adoption:BO") | — |
| Create, update, retire an area; add or remove links | `performance_area.manage` (BO, TO; REQ-S03-002 "own:BO") | — |
| Reopen an area | `performance_area.reopen` (BO, TL; REQ-S11-009) | — |
| Create, edit, add evidence to, submit a handover | `bau_handover.prepare` (WL, TL; REQ-S11-005 "prepare:WL,TL") | — |
| Accept or return a handover | `bau_handover.accept` (BO) | caller = `receiving_owner_user_id`, else **403** `bau_handover.not_receiving_owner` |
| Create, update, retire controls | `control.manage` (BO, TO) | — |
| Record a control check | `control_check.record` (BO, TO; REQ-S11-008 "record:BO,TO") | — |
| Complete a review | `sustainment_review.complete` (BO, KDS, FIN) | caller = the review's assignee (403 `sustainment_review.not_assignee`) |
| Create, update CI items | `improvement.edit` (BO, TO; REQ-PB-084 "edit:BO,TO") | — |
| Create, update, publish, archive lessons | `lesson.edit` (BO, TO) | — |
| Create, edit, submit, withdraw a transition decision | `transition_decision.propose` (BO, FIN) | — |
| Decide a transition decision | `approval.decide` through the canonical approval (SP, BO, FIN; ADR-0026) | the approval's assignee; requester excluded |
| Close an initiative / a transformation | `initiative.close` / `transformation.close` (TL; REQ-S03-003 "close-transformation:TL after G6 approval") | — |

- **Why `bau_handover.accept` is a business approval held only by BO.** The acceptance transfers routine ownership (M0237) and is the T12 "BAU Handover" A/R decision of the Business Owner (B0101); an ADM-only caller must get 403 on it (REQ-S10-003, "all new P4 approval endpoints"; the BE-B2 helper `access/technical-admin.ts` gives 403 to a caller whose every grant is a technical-admin role). BO already holds `business_approval` codes, so the F-DG1-106 / ADR-0020 §3 / ADR-0026 §8 rules keyed on "a role holding an approval permission" are unchanged (probe S02). The `0001` trigger refuses it for a technical-admin role (probe S04).
- **AUD** holds only `lesson.search` (read): every slice G write by an AUD user is 403.
- **Technical admins** hold none of these codes and no `transformation.read`: 404 on transformation-scoped operations, 403 on `acceptBauHandover` and `returnBauHandover` (the S10-003 helper).
- **SoD:** the transition decision's requester cannot approve it (`requester_excluded`). The receiving owner may have prepared the handover only if they also hold `bau_handover.prepare` (BO does not by default); no SoD beyond this is required by the slice G sources.
- Every mutation re-checks authorization at commit time, validates, needs `If-Match` (428/409; creates are version 1), writes its audit event in the same transaction, and does no remote I/O inside it (S-4).

### 10. Lock classes, events and jobs

| Lock class | Resource | Key | Users |
|---|---|---|---|
| 730243 `bauHandover` | the handover of one area | `<performanceAreaId>` | create, submit, accept, return a handover; `reopenPerformanceArea` |
| 730244 `closure` | the closure of one subject | `initiative:<id>` / `transformation:<id>` | `closeInitiative`, `closeTransformation` |
| 730245 | reserved for this block | — | — |

Events: emits `control_check.failed` (§6). Jobs: `sustainment.review_scan`, `sustainment.control_check_scan` (§6; schedules seeded by `0050`, handlers BE-I2).

### 11. Decimal and Unknown

- Slice G stores no money: values stay slice B's decimals. The status model reports value status from validations, never from amounts, and never shows a forecast as validated or sustained (§3).
- `performance_signal = 'unknown'` is a valid review outcome; a status model with no benefit says `no_benefit`, never "validated"; an area without BAU owner shows the owner as Unknown; a NULL `next_review_date` (area not in BAU) shows "not scheduled", never a guessed date.

### 12. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 422 | `initiative.delivery_not_launched` (invalid-transition) | "Only a launched initiative can be marked delivery complete." |
| 422 | `initiative.adoption_status_invalid` (at `/adoptionStatus`) | "Adoption status must be On track, At risk or Adopted." |
| 422 | `closure.delivery_not_complete` (invalid-transition) | "Initiative delivery is not complete." |
| 409 | `closure.already_closed` (`urn:mth:problem:duplicate`) | "This {subject} is already closed." with subject ∈ "initiative", "transformation" |
| 422 | `closure.value_validation_pending` (invalid-transition), initiative | "Delivered — value validation pending: an initiative closes only when each of its benefits is validated by Finance or covered by an approved transition decision." |
| 422 | `closure.value_validation_pending` (invalid-transition), transformation | "Validated value is pending: a transformation closes only when each of its benefits is validated by Finance or covered by an approved transition decision." |
| 422 | `closure.sustainment_owner_missing` (invalid-transition) | "Each validated benefit needs a BAU owner before closure." |
| 422 | `closure.transformation_not_open` (invalid-transition) | "Only an active or on-hold transformation can be closed." |
| 422 | `closure.g6_not_approved` (invalid-transition) | "Closure requires the G6 (Sustain) business approval." |
| 422 | `closure.bau_not_accepted` (invalid-transition) | "Every performance area of this transformation needs an accepted BAU handover before closure." |
| 422 | `performance_area.retired` | "This performance area is retired and can no longer be changed." |
| 422 | `performance_area.not_reopenable` (invalid-transition) | "Only a performance area in BAU can be reopened." |
| 400 | `performance_area.reopen_reason_required` (at `/reason`) | "A reason is required to reopen a performance area." |
| 409 | `performance_area_link.exists` (`urn:mth:problem:duplicate`) | "This KPI or benefit is already linked to the performance area." |
| 422 | `bau_handover.incomplete` (one error per missing item, pointer to its field) | "The BAU handover is incomplete. Missing: {items}." with items from "KPI owner", "operating procedures", "controls", "evidence", "capability readiness", "unresolved accepted risks", "benefit monitoring cadence", "data access", "improvement backlog" |
| 403 | `bau_handover.not_receiving_owner` | "Only the receiving owner can accept or return this handover." |
| 422 | `bau_handover.status_transition` (invalid-transition) | "This handover cannot move from {from} to {to}." |
| 422 | `bau_handover.frozen` | "A submitted handover can only be accepted or returned." |
| 422 | `bau_handover.accepted_final` | "An accepted handover is final and cannot be changed." |
| 422 | `bau_handover.area_not_open` | "A handover is prepared for an establishing or reopened performance area." |
| 409 | `bau_handover.exists` (`urn:mth:problem:duplicate`) | "This performance area already has a handover in progress for this cycle." |
| 400 | `bau_handover.return_reason_required` (at `/reason`) | "A reason is required to return a handover." |
| 422 | `control.retired` | "This control is retired and can no longer be changed." |
| 422 | `control_check.final` | "This control check is {status} and can no longer be changed." |
| 400 | `control_check.result_note_required` (at `/resultNote`) | "A failed control check needs a result note." |
| 403 | `sustainment_review.not_assignee` | "Only the assigned reviewer can complete this review." |
| 422 | `sustainment_review.final` | "This review is {status} and can no longer be changed." |
| 422 | `improvement_item.final` | "This improvement item is {status} and can no longer be changed." |
| 422 | `improvement_item.status_transition` | "This improvement item cannot move from {from} to {to}." |
| 400 | `improvement_item.resolution_note_required` (at `/resolutionNote`) | "Record a resolution note before closing the item." |
| 422 | `lesson.archived` | "This lesson is archived and can no longer be changed." |
| 422 | `lesson.status_transition` | "This lesson cannot move from {from} to {to}." |
| 409 | `transition_decision.exists` (`urn:mth:problem:duplicate`) | "This benefit already has a transition decision in progress or approved." |
| 422 | `transition_decision.final` | "This transition decision is {status} and can no longer be changed." |
| 422 | `transition_decision.frozen` | "A submitted transition decision cannot be edited." |
| 422 | `transition_decision.benefit_validated` | "This benefit already has Finance-validated value; a transition decision is for value still to be realized." |
| 422 | `transition_decision.monitoring_after_end` (at `/firstMonitoringDate`) | "The first monitoring date must be on or before the expected realization end." |

### 13. What DG4 does not build (stated so it is not claimed)

1. HealthAssessment (M0327, the 25-question check; P5, D-089 R3).
2. A transformation reopening after closure (closure is final in DG4; a deteriorating area is reopened instead, §4).
3. Delegated handover acceptance (§5) and rule-builder configuration of the scans (D-089 R5).
4. An organization-level performance-area list across transformations (`/api/v1/performance-areas` in the REQ-S03-002 row's screen column): DG4 serves areas on transformation-scoped paths (D-092 (7)); the acceptance text does not test the path.

## Alternatives considered

1. **One composite status column.** Rejected: M0092 requires separate statuses; one column would derive closure from delivery.
2. **Closing a transformation by setting `archived_at`.** Rejected: the R2 guards would then refuse KPI actuals and register writes after closure (REQ-S03-002, REQ-S11-004).
3. **G6 approval closes the transformation.** Rejected by D-089 Q4.
4. **Performance areas without a transformation (`transformation_id` NULL).** Rejected for DG4: the `0010` row guard, the code counter, the corrective case (`transformation_id` NOT NULL, `0041`) and `kpi_definition.transformation_id` (NOT NULL) all assume a transformation; the origin transformation keeps scope and audit working while no guard reads its status (§4). An organization-level area is a DG5 candidate with REQ-S16-012.
5. **Reopening by editing the accepted handover.** Rejected: REQ-S11-009 requires the original acceptance to stay unchanged; accepted is final and a new cycle gets a new handover.
6. **Transition decisions as a benefit lifecycle step.** Rejected: ADR-0029's six steps are the playbook's B0121 steps; a transition decision is a governed decision about residual value, routed through the canonical approval.

## Consequences

- `0048` adds 12 tables (`performance_area`, `performance_area_cycle`, `performance_area_link`, `control`, `control_check`, `bau_handover`, `bau_handover_evidence`, `transition_decision`, `sustainment_review`, `lesson`, `improvement_item`, `closure_record`), 6 columns, 4 CHECK constraints and 1 trigger on `initiative`, 1 trigger on `transformation`, 3 non-trigger functions (`p4_sustain_frequency_valid`, `p4_tags_valid`, `p4_lesson_document`), and widens the code-prefix set by `PA`, `HO`, `CTL`, `CI`, `LL`, `TD`; `0049` adds 15 slice G permission codes, 4 slice G work-item kinds and the `benefit_transition_decision` approval type.
- BE-J changes one DG1 English sentence (seam 15) and the tests that pin it.
- Slice H's G6 evaluators read the handover, control and CI facts from these tables through `GateFactsProvider`.

## Verification

- **Database (probe, real output):** G00–G05, S02–S04, PA01–PA03, HO01–HO10, RO01–RO07, CK01–CK06, RV01–RV04, TD01–TD06, CI01–CI03, LL01, LL02, ST01–ST12, P01.
- **API (implementers' tests, p4-work-split §F+G):** every refusal of §12 with its exact text; AUD 403 on every write; technical-admin 403 on accept/return; 404 outside scope; `If-Match` 428/409; audit per mutation; a handover missing data access rejected; acceptance by anyone but the receiving owner 403; acceptance creates the first review exactly once and the scan the next ones; after closure the next review task is created on time and KPI actuals are accepted; after reopening the original acceptance and closure date are unchanged; a failed control check emits one `control_check.failed` and slice E opens one case; a lesson found from another transformation; the initiative with delivery complete and no validated benefit refused with 422 invalid-transition and shown "Delivered — value validation pending"; setting delivery to Complete leaves adoption, value and closure unchanged; the transformation closure refused while value is pending unless a transition decision exists; after the transition decision the forecast stays forecast and monitoring tasks appear for the residual owner.
