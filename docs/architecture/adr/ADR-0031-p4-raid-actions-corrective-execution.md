# ADR-0031: RAID (T15) on canonical records, actions, corrective-action cases, budget/actual/forecast with working-day slip, and the critical path from defined scheduling logic

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-04), 2026-10-09.
- **Requirements (slice E of `docs/architecture/p4-plan.md`):** REQ-PB-078, REQ-PB-079, REQ-PB-080, REQ-PB-085, REQ-S09-007, REQ-S09-009, REQ-S12-016, REQ-S16-018.
- **Sources (quoted where a design point has one):**
  - Playbook B0126 ("Integrated RAID + Decision Log"), B0127 ("Template 15 — RAID"), B0128 (the T15 table: columns "ID | Type | Description | Impact | Probability | Owner | Due | Mitigation / action | Status"; rows `R01 | Risk | … | H/M/L | H/M/L | … | Open`, `A01 | Assumption | … | H/M/L | n/a | … | [Validate] | Open`, `I01 | Issue | … | n/a | … | [Resolve] | Open`, `D01 | Dependency | … | n/a | … | [Mitigate] | Open`), B0121 (Correct: "What action is needed if benefit is off track? | Recovery plan"), B0093 (Value Review outputs: "Benefit evidence, forecast, corrective action").
  - Master prompt M0090 ("All required controls must work against persisted server-side data."), M0108 ("Risks and Actions: integrated RAID, corrective actions and escalations."), M0143 (T15: "ID, type Risk/Assumption/Issue/Dependency, description, impact, probability where applicable, owner, due date, mitigation/action, status"), M0150 ("Design decisions and executive decisions should use a shared decision model with appropriate views. Likewise, the dependency map and RAID dependency entries should refer to the same canonical dependency record. Avoid duplicate registers that drift."), M0184 ("Track approved vs forecast milestone dates, deliverable acceptance, budget/actual/forecast, role-based capacity, FTE demand, dependencies and decisions. … Critical-path claims must come from defined scheduling logic, not cosmetic highlighting."), M0196 (working days on the business calendar), M0227 ("KPI deviates from trajectory | Create or update a corrective-action case using the configured severity and persistence rule"), M0236 ("Adoption or control check fails | Create recovery action and assign owner and follow-up date"), M0250 ("Needed-by date and supported critical-path logic"), M0324 ("Risk, Assumption, Issue, Action, Decision, ChangeRequest and Approval.").
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 Q5 (RAID codes `R-nn`, `A-nn`, `I-nn`; a dependency keeps `DEP-nn`), Q10 (the canonical `approval` table), R4 (rows citing later A-tests are judged on their own acceptance text), R5 (starter automations are code-defined handlers with configuration values in data; rule-builder configurability is DG5's REQ-S12-001/-002); D-090 (S-12 contiguity), D-092 (7) (transformation-scoped paths).
- **Builds on:** ADR-0003 (UUIDv7, optimistic concurrency), ADR-0004 (audit), ADR-0006 (authorization), ADR-0007 (API conventions), ADR-0015 (one decision model; canonical `dependency`, `action_item`), ADR-0016 (record guards `0010`; lock registry §6), ADR-0021 (initiative statuses), ADR-0023 (T08 graph, cycle guard, milestones, `varianceDays` in calendar days, §8 "a separate working-day slip … is added when the business calendar lands"), ADR-0025 (business calendar, `addWorkingDays`, job kit `runOnce`, `createWorkItemOnce`), ADR-0026 (approval), ADR-0027 §8 (`kpi.deviation_evaluated`), ADR-0029/0030 (benefit lifecycle Correct step, `benefit.variance_evaluated`).
- **Physical model:** `0041_p4_raid_actions_corrective.sql`, `0042_p4_budget_schedule.sql`, `0043_p4_raid_permissions.sql`. Probe ids below refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/probe-output.txt`.
- **Two gate systems.** Nothing in this ADR is a business approval. Closing a RAID entry or a corrective case is an operational record change, not a G1–G6 decision. Nothing here reads or writes the engineering records DG0–DG7.

## Context

As built before slice E:

1. `dependency` (DG2 `0017`, extended by DG3 `0022`) is "THE canonical dependency record shared by T08 and RAID" (its migration comment). T08 serves it on `/api/v1/dependencies` (ADR-0023 §4). It has description, owner, `needed_by`, mitigation and status (`open`, `at_risk`, `resolved`, `archived`), and no impact column.
2. `action_item` (`0017`) has title, description, owner, due date, status (`open`, `in_progress`, `done`, `cancelled`) and an optional workshop-item source. The DG2 operations `listActionItems`, `createActionItem`, `getActionItem`, `updateActionItem` return the `ActionItem` schema, which requires `createdBy` (a user id).
3. `decision` (`0017`) is the one decision model: `kind` `design` (T04, `D-nn`), `gate` (`GD-nn`) and `executive` (T16, `DEC-nn`; its T16 columns are slice D's, ARCH-05).
4. `milestone` (`0020`) has `approved_date` and `forecast_date`; `Milestone.varianceDays` is in calendar days and stays so (ADR-0023 §8).
5. No table stores risks, assumptions, issues, corrective cases, budget lines or durations. P3 makes no critical-path claim (ADR-0023 §5).
6. The producers of the four consumed events: `kpi.deviation_evaluated` (ADR-0027 §8, slice A), `benefit.variance_evaluated` (ADR-0030 §6, slice B), `adoption.check_failed` and `control_check.failed` (slices F and G, ARCH-06 not yet written: §5.4 fixes the payload those producers must emit).

## Decision

### 1. RAID entries: Risk, Assumption, Issue as typed rows (REQ-PB-079, REQ-PB-080, REQ-S16-018)

**Entity `raid_entry`** (`0041`), one table with a type discriminator (the S16-018 entities Risk, Assumption and Issue):

| T15 column (B0128) | Field | Rule |
|---|---|---|
| ID | `code` | `R-nn` (Risk), `A-nn` (Assumption), `I-nn` (Issue), from `record_code_counter` prefixes `R`, `A`, `I` (D-089 Q5); CHECK `raid_entry_code_format` ties the prefix to the type; unique per transformation (`raid_entry_code_key`; probes R08, R10) |
| Type | `entry_type` | `risk` \| `assumption` \| `issue` (CHECK); immutable (`raid_entry_type_immutable`; probe R15). `dependency` entries are not stored here (§2) |
| Description | `description` | 1–4000 characters, required |
| Impact | `impact` | `high` \| `medium` \| `low`, required (CHECK; probe R09) |
| Probability | `probability` | `high` \| `medium` \| `low` for a Risk; NULL (n/a) otherwise: CHECK `raid_entry_probability_applicable` = `(entry_type = 'risk') = (probability IS NOT NULL)` (probes R03, R04, R05) |
| Owner | `owner_user_id` | required, an active user of the organization (API check) |
| Due | `due_date` | business date, nullable (shown as Unknown when NULL) |
| Mitigation / action | `mitigation` | 1–4000 characters, nullable. The UI labels it per type as B0128 does: Action (Risk), Validate (Assumption), Resolve (Issue), Mitigate (Dependency) |
| Status | `status` | `open` (default; a new row must be `open`, `raid_entry_starts_open`; probe R11) → `in_progress` ↔ `open`; `open` \| `in_progress` → `closed` (`raid_entry_status_transition`). `closed` needs `closed_at`, `closed_by` and a 3–2000 character `closure_note` (`raid_entry_closed_complete`; probe R16), and is **final**: no field changes and no reopening in DG4 (`raid_entry_closed_final`; probes R17, R18) |

Plus `initiative_id` (optional affected initiative, composite FK in the transformation), `version`, stamps. Guards: `p2_attach_guards('raid_entry', true)` (organization matches the transformation, version steps by 1, deferred audit coverage; probes R01, R12, R13, R14).

**State machine:** `open ⇄ in_progress`; `open → closed`; `in_progress → closed`; `closed` final. `updateRaidEntry` may move between `open` and `in_progress` only; closing is `closeRaidEntry` with a note.

### 2. RAID Dependency entries are the canonical T08 rows (REQ-PB-078, REQ-PB-079, REQ-PB-080)

- **No copy.** A RAID entry of type Dependency **is** a `dependency` row. `0041` adds one nullable column, `dependency.impact` (`high` \| `medium` \| `low`; NULL = Unknown on rows created before P4 or through T08; probes D02, G04). A dependency has **no probability column**, so "Probability n/a" holds by construction (probe D05).
- **The register view `raid_register`** (`0041`, SELECT-only for `mth_app`; probe P03) is a `UNION ALL` of `raid_entry` rows and the non-archived `dependency` rows, with the columns `id`, `entry_type` (`'dependency'` for the second part), `code` (`DEP-nn` kept), `description`, `impact`, `probability` (NULL for dependencies), `owner_user_id`, `due_date` (= `needed_by`), `mitigation`, `raid_status`, `record_status`, `record_table` (`raid_entry` \| `dependency`), `initiative_id` (a dependency's `to_initiative_id`), `version`, `created_at`, `updated_at`. `raid_status` maps a dependency's status: `open` and `at_risk` → `open`; `resolved` → `closed`; an `archived` dependency is not listed (probe D04). `record_status` keeps the raw status, so an at-risk dependency stays visible as at risk.
- **REQ-PB-078 A01** "editing a dependency's owner in T08 changes the same RAID entry; there is no second copy": the view reads the dependency row itself, so a T08 owner change is the RAID entry's owner change, with the same id and version (probe D03 on the database; BE-D's integration test does the same through `updateT08Dependency` then `getRaidEntry`).
- **Writes on a Dependency entry through the RAID API** (`createRaidEntry` with `type: "dependency"`, `updateRaidEntry`, `closeRaidEntry`) change the canonical row through one port, `RaidDependencyPort`, which `workflows/t08-dependencies.ts` exports and `server.ts` passes to the `raid` module (the `GateFactsProvider`/`T08ScheduleFlagsProvider` wiring pattern, ADR-0023 §8; `raid` never imports `workflows`). The port reuses T08's code allocation (`DEP-nn`), type check and cycle guard. A RAID create maps: description, impact, owner, due → `needed_by`, mitigation; `from_kind` = `to_kind` = `other` and `dependency_type` = `other` unless the request names T08 endpoints (`fromInitiativeId`, `toInitiativeId`) and a `dependencyType`. Close = status `resolved`. The T08 and DG2 dependency representations are unchanged (they do not show `impact`).
- **Decisions (REQ-PB-078 "design (T04) and executive (T16) decisions use one shared decision model with separate views").** There is one `decision` table (ADR-0015). Slice E adds no decision table and no decision copy. `getRaidDecisionLog` (B0126 "Integrated RAID + Decision Log") returns, for one transformation, the open RAID entries from `raid_register` and the open `decision` rows of kinds `design` and `executive`, each item with its canonical id, kind and code and no copied fields beyond the listed columns. The T04 view is the existing `/api/v1/decisions`; the T16 view is slice D's (ARCH-05).

### 3. Type validation (REQ-PB-079 "Type outside Risk/Assumption/Issue/Dependency is rejected")

`RaidEntryCreate.type` is the closed enum `risk`, `assumption`, `issue`, `dependency`. Any other value is a 400 `urn:mth:problem:validation` with the error `{ pointer: "/type", code: "raid.type_invalid", message: "Type must be Risk, Assumption, Issue or Dependency." }`, before any write. The database refuses a fourth `raid_entry` type as a second line (probe R07).

### 4. Actions, extended (REQ-S16-018 "Action"; p4-plan seam 13)

- `0041` adds four nullable columns to `action_item`: `raid_entry_id`, `dependency_id`, `corrective_case_id` (composite FKs in the transformation; probe AC04) and `follow_up_date`. At most one source among `source_workshop_item_id` and the three new links (CHECK `action_item_one_source`; probe AC02); the new links never change after creation (trigger `action_item_source_immutable`; probe AC03). Existing rows keep every value (probe G04); the statuses and the DG2 transitions are unchanged.
- **Actions stay person-authored.** `action_item.created_by` stays NOT NULL (probe AC05). The worker's recovery action is the corrective case itself (§5), so the DG2 `ActionItem` representation (which requires `createdBy`) stays true for every row.
- **The DG2 action operations are byte-stable.** The P4 representation `RaidAction` (DG2 fields plus `raidEntryId`, `dependencyId`, `correctiveCaseId`, `followUpDate`, `sourceKind` ∈ {`workshop`, `raid_entry`, `dependency`, `corrective_case`, `none`}) is served on new paths (§10). Creating a linked action is `createRaidEntryAction` or `createCorrectiveCaseAction`; the action register (`listActionRegister`, `getActionRegisterItem`, `updateActionRegisterItem`) lists and edits every action of a transformation with filters `sourceKind`, `ownerUserId`, `status`, `overdue` (due date before today's business date and status `open` or `in_progress`).
- A linked action's owner gets one My Work item (kind `raid_action_due`, dedupe key `raid.action:<actionItemId>:<ownerUserId>`, due date = the action's due date) through `createWorkItemOnce`.

### 5. Corrective-action cases with the severity and persistence rule (REQ-PB-085, REQ-S12-016)

#### 5.1 Entity `corrective_case` (`0041`)

- `code` `CA-nn` (`record_code_counter` prefix `CA`); `source_kind` ∈ {`kpi_deviation`, `benefit_variance`, `adoption_check`, `control_check`, `value_review`}; `source_scope_key` (the source: `<kpiDefinitionId>:<scopeKind>:<scopeId>`, a benefit id, a check id, or `value_review:<findingRef>`); the kind's own source fields (`kpi_definition_id` + `kpi_scope_kind` + `kpi_scope_id`; or `benefit_id`; or `source_record_type` + `source_record_id`), and no other kind's (CHECK `corrective_case_source_fields`; probes C07, C08); `title`; `recovery_plan` (the B0121 Correct output; nullable until written); `owner_user_id`; `follow_up_date` with the `follow_up_calendar_id` and `follow_up_calendar_version` it was computed on (ADR-0025 §1); `status`; `consecutive_off_track`, `signal_count`, `last_signal_at`; closure fields; `created_source` (`api` \| `worker`).
- **Authorship.** A Value Review case is created by a person (`created_source = 'api'`, `created_by`, `updated_by`, owner and follow-up date all required); the four event-driven kinds are created only by the worker (`created_source = 'worker'`, `created_by` NULL, the audit event's actor is the service). CHECK `corrective_case_created_source` (probes C09, C10, C11, C12, C22). A service update leaves `updated_by` NULL; a person's update sets it.
- **Status:** `open` (a new case must be `open`, `corrective_case_starts_open`; probe C05) ⇄ `in_progress`; `open` \| `in_progress` → `closed` with `closed_at`, `closed_by` and a 3–2000 character `closure_note` (`corrective_case_closed_complete`; probe C14); `closed` is final (`corrective_case_closed_final`; probe C16). A case without an owner cannot be closed (`corrective_case_owner_required`; probe C19). Source fields and `created_source` are immutable (`corrective_case_source_immutable`; probe C06).
- **One case, updated not duplicated:** the partial unique index `corrective_case_one_open_key` on (`transformation_id`, `source_kind`, `source_scope_key`) WHERE `status <> 'closed'` allows at most one case that is not closed per source (probe C03). After closure, a new off-track run opens a **new** case (probe C20). For `adoption_check` and `control_check` the index `corrective_case_one_per_check_key` holds over all statuses: one failed check gets one case, ever (probe C17).
- Guards: `p2_attach_guards('corrective_case', true)` (probes C01, C21).

#### 5.2 Entity `corrective_action_rule` (`0041`): the configured rule (M0227)

One optional row per transformation and source kind (`corrective_action_rule_source_key`; probe RU05): `min_kpi_rag` (`amber` \| `red`; required for `kpi_deviation` and forbidden otherwise, `corrective_action_rule_severity_kpi_only`; probes RU02, RU03), `persistence_cycles` 1–12 (only `kpi_deviation` and `benefit_variance` may exceed 1, `corrective_action_rule_persistence_series_only`; probe RU04), `follow_up_working_days` 1–60, `enabled`. `source_kind` is immutable (probe RU06); every change is versioned and audited (probe RU07).

**Defaults** (used when a transformation has no row for the kind; held as constants in `raid/corrective-rules.ts`; `listCorrectiveActionRules` returns all four kinds with `isDefault: true` for these):

| Source kind | Severity | Persistence | Follow-up | Enabled |
|---|---|---|---|---|
| `kpi_deviation` | `red` | 2 consecutive reporting periods | 5 working days | yes |
| `benefit_variance` | — (`offTrack = true`) | 1 | 5 working days | yes |
| `adoption_check` | — (a failed check) | 1 | 5 working days | yes |
| `control_check` | — (a failed check) | 1 | 5 working days | yes |

#### 5.3 Entity `corrective_signal` (`0041`): the append-only signal log

One row per consumed source event: `source_kind`, `source_scope_key`, `source_event_key` (unique: the producer's idempotency key; probe SG02), `period_key`, `period_start`, `period_end`, `observed_rag` (KPI only, `corrective_signal_rag_kpi_only`; probe SG07), `off_track` (NULL = Unknown; probe SG08), `rule_persistence`, `consecutive_off_track`, `outcome` ∈ {`recorded`, `case_created`, `case_updated`, `rule_disabled`} (a `case_*` outcome names its case, `corrective_signal_outcome_case`; probe SG06), `corrective_case_id`, `payload` (the event payload, a JSON object), `received_at`. It is system lineage like `calculation_run`: no audit event of its own (the case it creates or updates is audited; probe SG01); UPDATE, DELETE and TRUNCATE are refused (probes SG03, SG04, SG05); `mth_app` has INSERT and SELECT only (probe P02).

#### 5.4 The four consumers (BE-D2, `apps/worker/src/handlers/raid.ts`)

Each consumer runs with `runOnce(consumer, <event idempotency key>, fn)` (ADR-0025 §3) and, inside its one transaction, takes `pg_advisory_xact_lock(730236, hashtext('<transformationId>:<sourceKind>:<sourceScopeKey>'))` before it reads the open case.

| Consumer | Event (producer) | `source_scope_key` | `period_key` | `off_track` |
|---|---|---|---|---|
| `raid.corrective_kpi` | `kpi.deviation_evaluated` (ADR-0027 §8; payload `{ evaluationId, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId, calculatedRag, deviation, previousCalculatedRag }`) | `<kpiDefinitionId>:<scopeKind>:<scopeId>` | the reporting period id (its `period_start`/`period_end` copied from `reporting_period`) | `calculatedRag` = `red` → true when the rule's severity is `red`; `amber` or `red` → true when it is `amber`; `green` → false; `unknown`, `stale`, `not_computable` → NULL (Unknown) |
| `raid.corrective_benefit` | `benefit.variance_evaluated` (ADR-0030 §6; payload `{ benefitId, measurementId, periodStart, periodEnd, plannedAmount, measuredAmount, variance, offTrack }`) | the benefit id | `<periodStart>..<periodEnd>` | `offTrack` (NULL stays NULL = Unknown) |
| `raid.corrective_adoption` | `adoption.check_failed` (slice F) | the check id | the check id | true |
| `raid.corrective_control` | `control_check.failed` (slice G) | the check id | the check id | true |

**Producer contract for the two check events** (ARCH-06 must emit exactly this payload; aggregate = the check record): `{ checkId, checkRecordType, transformationId, ownerUserId, subjectLabel, failedAt, businessDate }` — `checkRecordType` is the producer's table name (`^[a-z][a-z0-9_]{1,62}$`), `ownerUserId` is the check's owner or `null`, `subjectLabel` is the checked item's own name (user data, 1–500 characters), `failedAt` an RFC 3339 instant, `businessDate` the failure's business date; idempotency key `<event type>:<checkId>`.

**The rule, step by step:**

1. Read the transformation's rule for the kind, or the default (§5.2). If it is disabled: insert the signal with outcome `rule_disabled`; stop.
2. Insert the signal.
3. **Consecutive count** (series kinds): for the source scope, take the latest-received signal of each `period_key`, order them by `period_start` descending, and count the leading signals with `off_track = true`. A signal with `off_track` false **or NULL** ends the run: an Unknown period is never counted as off track and never as recovered. For the check kinds the count is 1.
4. If a case that is not closed exists for the scope and the signal is off track: **update** it (`consecutive_off_track` = the count, `signal_count + 1`, `last_signal_at`; version + 1; audit `corrective_case.signal_applied`, actor service); the signal's outcome is `case_updated`. An on-track or Unknown signal never closes or edits the case (outcome `recorded`); closing is a person's decision (§5.5).
5. Else, if the count ≥ `persistence_cycles`: **create** the case (`created_source = 'worker'`; audit `corrective_case.created`, actor service), its owner's work item (§5.6), and the signal outcome `case_created`.
6. Else: outcome `recorded`.

This gives the REQ-PB-085 acceptance cases literally: under a two-cycle rule, a KPI red in two consecutive periods opens **one** case at the second signal and the third red signal **updates** it (probes C02–C04 on the database; BE-D2's worker test end to end); a benefit below plan (`offTrack = true`, persistence 1) opens one case and a repeated evaluation updates it instead of duplicating it; a redelivered event is a no-op twice over (the `processed_message` ledger and `corrective_signal_event_key`). REQ-S12-016: a failed control or adoption check opens exactly one owned case with a follow-up date (probes C13, C17).

**Owner resolution** (first active user found; ADR-0026's "visible routing error, never a silent skip"):

- `kpi_deviation`: the KPI's `owner_user_id`, else its `steward_user_id`, else the transformation's `lead_user_id`;
- `benefit_variance`: the benefit's `owner_user_id` (NOT NULL on `benefit`);
- the check kinds: the payload's `ownerUserId`, else the transformation's `lead_user_id`.

When none resolves, the case is created with `owner_user_id` NULL and listed as unassigned (`ownerStatus: "unassigned"` in the API), no work item is created, and it cannot be closed until a person assigns an owner (probes C18, C19).

**Follow-up date:** `addWorkingDays(businessDate, follow_up_working_days, the organization's default calendar)` (ADR-0025 §1), where `businessDate` is the event's business date (the check payload's `businessDate`; for KPI and benefit events, `p4_business_date(<event created_at>, <calendar timezone>)`). The calendar id and version are stored with the date. If the calendar is not configured, the date is NULL and shown as Unknown with reason `calendar_not_configured`, never a guessed date.

**Title:** the source's own name (the KPI name, the benefit title, the check's `subjectLabel`), not a system sentence; the UI shows the translated kind label beside it (S-6).

#### 5.5 Person actions on a case

- `createCorrectiveCase` (Value Review finding, B0093): body `{ findingRef, title, recoveryPlan?, ownerUserId, followUpDate }`, where `findingRef` (1–150 characters) names the Value Review finding (for example the review date and item). `source_scope_key = 'value_review:' + findingRef` (trimmed and lower-cased), so a second open case for the same finding is refused with 409 `corrective_case.already_open`.
- `updateCorrectiveCase` (`If-Match`): `title`, `recoveryPlan`, `ownerUserId` (a change cancels the previous owner's open follow-up work item and creates the new owner's), `followUpDate` (not before today's business date), `status` (`open` ⇄ `in_progress` only).
- `closeCorrectiveCase` (`If-Match`): `{ closureNote }` (3–2000 characters); refused while the case has no owner.
- A case does **not** move a benefit's lifecycle step. Entering the benefit's Correct step stays the Business Owner's `advanceBenefitLifecycle` with the benefit's own `recovery_plan` (ADR-0029 §2); the case read model shows the benefit's current step beside it.

#### 5.6 Work items

The case owner gets one My Work item: kind `corrective_case_follow_up` (seeded by `0043`), subject `corrective_case`, due date = `follow_up_date`, dedupe key `corrective.follow_up:<caseId>:<ownerUserId>`, created with `createWorkItemOnce` in the case's transaction. The item closes when the case closes (`work_item.system_managed`, the ADR-0025 §4 rule for subject-bound tasks).

### 6. Why the recovery action is the case (REQ-S12-016 "create recovery action and assign owner and follow-up date")

`action_item.created_by` is NOT NULL and the DG2 `ActionItem` representation requires `createdBy`. A worker-created `action_item` would need either a fabricated author or a DG2 contract change. The case carries everything M0236 lists (the failed check, an owner, a follow-up date) and is shown on "Risks and Actions > Corrective actions" (the requirement's screen); people add further actions to it with `createCorrectiveCaseAction`. REQ-S12-016's acceptance "a failed control check creates one owned action with a follow-up date" is therefore checked on the case (`listCorrectiveCases` with `sourceKind=control_check`). This is an interpretation of "action" in that acceptance text, recorded here for the orchestrator and the reviewers.

### 7. Budget, actual and forecast; execution tracking (REQ-S09-007)

- **Entity `budget_line`** (`0042`): `initiative_id`, `label` (1–200), `period_month` (NULL = the whole initiative, else the first day of a month; probe BU05), `currency` `char(3)` (`^[A-Z]{3}$`, copied from `organization.default_currency` at creation and immutable; probes BU06, BU07), `budget_amount`, `actual_amount`, `forecast_amount` (each `numeric(20,4)`, ≥ 0, NULL = Unknown; probe BU04), `owner_user_id`, `note`, `status` `active` → `archived` (with `archived_at`, `archived_by`, `archive_reason`; probe BU09; archived is frozen, `budget_line_archived_frozen`; probe BU11). One active line per initiative, label (case-insensitive) and month (`budget_line_active_key`; probe BU08). Guards: versioned and audited (probes BU01, BU12).
- **Decimal (REQ-S09-007 "budget/actual/forecast use decimal SAR"):** amounts are `numeric(20,4)` in the database and `DecimalString` on the wire, summed with decimal.js. The probe checks `0.1 + 0.2 = 0.3000` and `100000 × 0.02 × 50 = 100000.0000` on stored amounts (BU02, BU03). A request amount with more than 16 integer or 4 fraction digits is refused (422 `budget_line.amount_invalid`), so `numeric(20,4)` never rounds silently.
- **Totals and variance (computed on read, `getInitiativeExecution`):** per currency, never converted: `budget`, `actual`, `forecast`, `forecastVariance = forecast − budget`, `actualVariance = actual − budget`. Each is `{ status: "known", amount }` only when every active line of that currency has the operand(s); otherwise `{ status: "unknown", knownAmount, missingCount }`. An initiative with no active line has `budgetLineCount: 0`, `budgetTotals: []` and `budgetUnknownReason: "no_budget_lines"`, never a total of 0.
- **Working-day slip (REQ-S09-007 "forecast slip vs approved date is shown in working days").** For each milestone with both dates, `slipWorkingDays` on the organization's default calendar (ADR-0025 §1 working-day definition): if `forecast > approved`, the count of working days `d` with `approved < d ≤ forecast`; if `forecast < approved`, minus the count of working days `d` with `forecast < d ≤ approved`; 0 if equal. Unknown (`{ status: "unknown", reason }`) when `approved_date` is missing (`approved_date_missing`), `forecast_date` is missing (`forecast_date_missing`), or the organization has no active default calendar (`calendar_not_configured`); the range is bounded to 3,660 calendar days (else Unknown, `range_too_long`). The DG3 `Milestone.varianceDays` (calendar days) is unchanged and is shown beside it as `calendarVarianceDays`. Worked examples (BE-E's unit fixtures, Sunday–Thursday workweek): approved Thu 2026-10-08, forecast Thu 2026-10-15, no holiday → **+5** (calendar 7); the same with a holiday on Sun 2026-10-11 → **+4**; approved Thu 2026-10-15, forecast Thu 2026-10-08 → **−5**; approved = forecast → **0**.
- **The other M0184 items, read from their canonical records** (no copies): deliverable acceptance (`deliverable.acceptance_status`), role-based capacity and FTE demand (`resource_demand` and `capacity`, ADR-0023 §6, decimal FTE, Unknown without a capacity row), dependencies (incoming and outgoing T08 rows of the initiative), decisions (`initiative_decision_link` → `decision`), and whether the initiative is on the computed critical path (`true`, `false`, or `null` when the path is not computable, §8).

### 8. Critical path from defined scheduling logic (REQ-S09-009)

- **Network.** Nodes: the transformation's initiatives whose status is not `cancelled`. Edges: every non-archived canonical dependency with both `from_initiative_id` and `to_initiative_id` set, between two nodes, read as finish-to-start ("From must deliver before To", ADR-0023 §5). The graph is acyclic by the DG3 guard `dependency_cycle_guard` (lock 730221); the algorithm still checks and reports `not_computable` with reason `cycle` if a cycle is found. External predecessors have no duration and add no edge.
- **Input.** `initiative_schedule.duration_working_days` (`0042`): one row per initiative (`initiative_schedule_initiative_key`; probe SC03), an integer 0–2600 (probe SC04) or NULL; the initiative never changes (probe SC05); versioned and audited (probes SC01, SC02). Set with `createInitiativeSchedule`/`updateInitiativeSchedule` (`roadmap.edit`).
- **Algorithm** (`packages/shared/src/schedule/critical-path.ts`, pure, version `cpm-fs/1`): the critical path method with finish-to-start edges and zero lag, in working-day offsets from 0.
  1. Topological order by Kahn's algorithm, ties broken by initiative code.
  2. Forward pass: `ES(n) = max(EF(p))` over predecessors `p` (0 for a node without predecessors); `EF(n) = ES(n) + d(n)`. Project duration `P = max EF`.
  3. Backward pass: `LF(n) = min(LS(s))` over successors `s` (`P` for a node without successors); `LS(n) = LF(n) − d(n)`.
  4. Total float `TF(n) = LS(n) − ES(n)`. A node is critical if and only if `TF(n) = 0`; an edge `p → s` is critical if and only if both ends are critical and `EF(p) = ES(s)`.
  5. Critical paths: every path of critical edges from a critical node with `ES = 0` to a critical node with `EF = P` (a single critical node with `ES = 0` and `EF = P` is a path of length one), enumerated depth-first in code order, at most 20 (`truncated: true` beyond).
- **No claim without complete inputs.** If any node has no `initiative_schedule` row or a NULL duration, the response is `status: "not_computable"`, `reason: "missing_durations"`, with the list of those initiatives, and **no** node, edge or path is marked critical (`critical: null`, offsets `null`). A transformation without a node gives `reason: "no_initiatives"`. The REQ-S09-009 acceptance "with missing durations no critical path is claimed" is this rule.
- **Recompute.** Nothing is stored: every `getScheduleNetwork` and `getInitiativeExecution` call computes from the current rows, so a changed duration, date or dependency is reflected on the next read (the requirement's "Critical dependency slips -> recompute").
- **Fixture** (BE-E's unit test; codes and durations in working days): `INI-01` (5) → `INI-02` (10) → `INI-04` (3); `INI-01` → `INI-03` (4) → `INI-04`. `P = 18`; critical path `INI-01 → INI-02 → INI-04`; `INI-03` has total float 6. With `INI-03`'s duration removed: `not_computable`, `missingDurations: [INI-03]`.

### 9. Authorization (permissions matrix §13)

New codes (`0043`, `P4_RAID_PERMISSIONS`): `raid.edit` (write), `corrective_action.manage` (write), `corrective_rule.configure` (configure), `budget.edit` (write). None is `business_approval` or `finance_validation`.

| Operation | Permission (role defaults) | Record-level rule |
|---|---|---|
| Read the RAID register, an entry, the RAID + decision log, cases, signals, rules, budget lines, execution, the schedule network | `transformation.read` (every role in the transformation's scope, AUD included) | scope; 404 outside it (ADR-0006) |
| Create, update, close a Risk, Assumption or Issue | `raid.edit` (TL, WL, TO; REQ-PB-079 "create/edit:WL,TL,TO") | — |
| Create, update, close a Dependency entry | `raid.edit` **and** `dependency.edit` (TL, WL, TO hold both) | — |
| Create an action on a RAID entry or case; update an action in the register | `action.edit` (TL, TO), or `action.update_own` for an action the caller owns (the DG2 rule, ADR-0020 §3) | an `update_own` holder may create an action only for themselves |
| Create (Value Review), update, close a corrective case | `corrective_action.manage` (TL, BO, FIN; REQ-PB-085 "create:BO,TL,FIN") | — |
| Create or update a corrective-action rule | `corrective_rule.configure` (TL, TO) | — |
| Create, update, archive a budget line | `budget.edit` (TL, FIN; REQ-S09-007 "budget:FIN,TL") | — |
| Create or update an initiative duration | `roadmap.edit` (TL, WL, TO; P3) | — |

- **AUD** holds none of these: every slice E write by an AUD user is 403, and every read in its scope succeeds read-only.
- **Technical admins** (`ADM_TECH`, `ADM_ACCESS`, `ADM_METHOD`) hold none of these and no `transformation.read`, so they get 404 on these transformation-scoped operations (ADR-0006 non-disclosure). REQ-S10-003 is unaffected: slice E has no approval endpoint.
- **SoD:** no slice E operation is an approval, so ADR-0026's requester-cannot-approve rule does not apply. The worker (service actor) holds no permission; it only writes cases, signals and work items through the consumers (ADR-0025 §3 item 5).
- Every mutation re-checks authorization at commit time, validates, needs `If-Match` (428/409; creates are version 1), writes its audit event in the same transaction, and does no remote I/O inside it (S-4).

### 10. Contract (OpenAPI 1.3.0-p4; 31 operations, tags `raid`, `actions`, `corrective-actions`, `budget-lines`, `schedule-network`)

| Task | Operations |
|---|---|
| BE-D (RAID, actions) | `listRaidEntries`, `createRaidEntry`, `getRaidEntry`, `updateRaidEntry`, `closeRaidEntry`, `listRaidEntryActions`, `createRaidEntryAction`, `getRaidDecisionLog`, `listActionRegister`, `getActionRegisterItem`, `updateActionRegisterItem` |
| BE-D2 (corrective cases) | `listCorrectiveCases`, `createCorrectiveCase`, `getCorrectiveCase`, `updateCorrectiveCase`, `closeCorrectiveCase`, `listCorrectiveCaseSignals`, `listCorrectiveCaseActions`, `createCorrectiveCaseAction`, `listCorrectiveActionRules`, `createCorrectiveActionRule`, `updateCorrectiveActionRule` |
| BE-E (budget, execution, critical path) | `listBudgetLines`, `createBudgetLine`, `getBudgetLine`, `updateBudgetLine`, `archiveBudgetLine`, `getInitiativeExecution`, `getScheduleNetwork`, `createInitiativeSchedule`, `updateInitiativeSchedule` |

Every request body is `application/json` (= the route's `config.consumes`, S-3); every list is cursor-paginated (`cursor`, `limit`); every mutable representation carries `version` and an `ETag`; every operation declares the ADR-0007 §5b platform statuses. No P1–P3 operation changes.

### 11. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 400 | `raid.type_invalid` (error at `/type`) | "Type must be Risk, Assumption, Issue or Dependency." |
| 422 | `raid.probability_required` (at `/probability`) | "A Risk needs a Probability (High, Medium or Low)." |
| 422 | `raid.probability_not_applicable` (at `/probability`) | "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty." |
| 422 | `raid.status_transition` | "A RAID entry moves between Open and In progress; use Close to close it." |
| 422 | `raid.closed` | "This RAID entry is closed and can no longer be changed." |
| 422 | `corrective_case.status_transition` | "A corrective action moves between Open and In progress; use Close to close it." |
| 422 | `corrective_case.closed` | "This corrective action is closed and can no longer be changed." |
| 422 | `corrective_case.owner_required` | "Assign an owner before closing this corrective action." |
| 422 | `corrective_case.follow_up_past` (at `/followUpDate`) | "The follow-up date cannot be before today." |
| 409 | `corrective_case.already_open` (`urn:mth:problem:duplicate`) | "An open corrective action already exists for this finding: {code}." |
| 422 | `corrective_rule.severity_kpi_only` (at `/minKpiRag`) | "A severity applies to KPI deviations only, and a KPI deviation rule needs one." |
| 422 | `corrective_rule.persistence_series_only` (at `/persistenceCycles`) | "A failed check is one event: its persistence is 1 cycle." |
| 409 | `corrective_rule.exists` (`urn:mth:problem:duplicate`) | "A rule for this source already exists in this transformation; update it instead." |
| 422 | `budget_line.amount_invalid` | "Amounts must be zero or more, with at most 16 digits before and 4 after the decimal point." |
| 422 | `budget_line.period_invalid` (at `/periodMonth`) | "The month must be given as its first day (YYYY-MM-01)." |
| 422 | `budget_line.archived` | "This budget line is archived and can no longer be changed." |
| 409 | `budget_line.duplicate` (`urn:mth:problem:duplicate`) | "An active budget line with this label and month already exists for the initiative." |
| 409 | `initiative_schedule.exists` (`urn:mth:problem:duplicate`) | "This initiative already has a planned duration; update it instead." |

Generic refusals keep their platform texts: 403 `urn:mth:problem:forbidden` (no permission), 404 (outside scope), 409 `urn:mth:problem:version-conflict` with `currentVersion`, 428 (no `If-Match`). Database last-line mappings for `platform/db-errors.ts` (BE-D, BE-D2 and BE-E add their lines): `raid_entry_probability_applicable` → `raid.probability_required` or `raid.probability_not_applicable` (by type); `raid_entry_status_transition`, `raid_entry_starts_open` → `raid.status_transition`; `raid_entry_closed_final` → `raid.closed`; `raid_entry_code_key`, `corrective_case_code_key` → 409 version-conflict (a concurrent code allocation; retry); `corrective_case_status_transition`, `corrective_case_starts_open` → `corrective_case.status_transition`; `corrective_case_closed_final` → `corrective_case.closed`; `corrective_case_owner_required` → `corrective_case.owner_required`; `corrective_case_one_open_key` → 409 `corrective_case.already_open`; `corrective_action_rule_severity_kpi_only` → `corrective_rule.severity_kpi_only`; `corrective_action_rule_persistence_series_only` → `corrective_rule.persistence_series_only`; `corrective_action_rule_source_key` → 409 `corrective_rule.exists`; `budget_line_archived_frozen` → `budget_line.archived`; `budget_line_active_key` → 409 `budget_line.duplicate`; `budget_line_period_month_check` → `budget_line.period_invalid`; `initiative_schedule_initiative_key` → 409 `initiative_schedule.exists`; `*_version_step` → 409; `*_audit_required`, `action_item_one_source`, `action_item_source_immutable`, `corrective_case_source_fields`, `corrective_case_created_source`, `corrective_case_source_immutable`, `corrective_case_one_per_check_key`, `corrective_signal_*`, `budget_line_currency_locked`, `initiative_schedule_initiative_immutable`, `corrective_action_rule_source_immutable` → 500 (a programming error: the API never sends such a write).

### 12. REQ-S16-018: the entity group

| Entity (M0324) | Table | Primary key | Owner | Status | Built by |
|---|---|---|---|---|---|
| Risk | `raid_entry` (`entry_type = 'risk'`) | `id` (code `R-nn`) | `owner_user_id` | `open`, `in_progress`, `closed` | `0041`; BE-D |
| Assumption | `raid_entry` (`entry_type = 'assumption'`) | `id` (`A-nn`) | `owner_user_id` | as Risk | `0041`; BE-D |
| Issue | `raid_entry` (`entry_type = 'issue'`) | `id` (`I-nn`) | `owner_user_id` | as Risk | `0041`; BE-D |
| Action | `action_item` (DG2, extended) | `id` | `owner_user_id` | `open`, `in_progress`, `done`, `cancelled` | `0017` + `0041`; BE-D |
| Decision | `decision` (DG2; kinds `design`, `gate`, `executive`) | `id` (`D-nn`, `GD-nn`, `DEC-nn`) | `owner_user_id` | `open`, `decided`, `deferred`, `cancelled` | `0017`; T16 columns slice D (ARCH-05) |
| ChangeRequest | not yet built: slice H (ARCH-07, migrations `0051`–`0054`) | — | — | — | ARCH-07; BE-L |
| Approval | `approval` (P4 canonical, D-089 Q10) | `id` | requester `requested_by`; assignee party/user/group | `pending`, `changes_requested`, `deferred`, `approved`, `rejected`, `withdrawn` | `0031`; BE-B |

The A09 acceptance clause "an integration test creates and reads each one through the API with authorization enforced" is `apps/api/test/integration/raid/entity-group.test.ts` (BE-D2, after BE-D): it creates and reads a Risk, an Assumption, an Issue, an Action, a design Decision and an Approval through the API, each with a 403 for an AUD user on the write and a 404 outside scope. The ChangeRequest case is added to the same file by BE-L (slice H) when that entity exists; until then, REQ-S16-018 is not complete and the handbacks say so. The ERD lists the group in §1g (`docs/architecture/erd.md`).

### 13. Decimal and Unknown

- Money: `budget_line` amounts only, `numeric(20,4)` with a per-row `currency` (S-5); decimal.js in code; no conversion between currencies.
- Unknown is explicit and never 0 or green: a NULL budget amount (§7), a missing slip (§7), a missing duration (§8: no critical path claimed), a NULL `dependency.impact` (shown Unknown), an Unknown KPI RAG or benefit variance (§5.4: not counted as off track, not counted as recovered), a NULL follow-up date (`calendar_not_configured`), an unassigned case owner (§5.4).
- Durations and slips are integer working days; FTE comes from the DG3 decimal columns.

## Alternatives considered

1. **One table per RAID type (risk, assumption, issue).** Rejected: the four T15 types share all nine columns; one typed table with a CHECK on probability keeps one register and one code path. S16-018 lists the entities, not tables.
2. **A `raid_entry` row for Dependency entries that points to the dependency.** Rejected: it would be a second record with its own owner, status and due date that can drift (M0150 "Avoid duplicate registers that drift"; REQ-PB-078 A01 "there is no second copy").
3. **Worker-created `action_item` rows with a nullable author.** Rejected (§6): it changes a DG2 NOT NULL invariant and makes the DG2 `ActionItem` representation false for new rows.
4. **Auto-closing a case when the source is back on track.** Rejected: closing records a judgement (the recovery worked); an on-track period after an off-track run is evidence for that judgement, not the judgement itself.
5. **Counting an Unknown period as neither breaking nor extending a run.** Rejected: "persisting two cycles" means two consecutive observed periods; a gap cannot be claimed as persistence.
6. **Milestone-level critical path.** Rejected for DG4: the canonical dependency graph connects initiatives, and milestones have no precedence links; a milestone-level network would need a second dependency graph.

## Consequences

- One RAID register over two tables, with no copy; T08 and DG2 dependency paths are unchanged.
- The four consumers make slice E independent of the order in which slices A, B, F and G land (event-coupled, p4-plan §2).
- ARCH-06 (slices F and G) must emit the check events with the payload of §5.4.
- REQ-S16-018 completes only when slice H adds ChangeRequest (§12).
- Seven new database objects (six tables and one view), four permission codes, two work-item kinds, one lock class (730236; 730237 reserved).

## Verification

- Probe (`probe.ts`, `probe-output.txt`): migrations on a fresh database and over a P3-populated one (G00–G05); seeds (S01–S05); RAID (R01–R18); Dependency entries (D01–D05); actions (AC01–AC05); rules (RU01–RU07); cases (C01–C22); signals (SG01–SG08); budget lines (BU01–BU12); durations (SC01–SC05); privileges (P01–P03).
- `catalogue.test.ts` pins the triggers, the versioned tables, the grants and the view; `seed.test.ts` pins `0043` against `P4_RAID_PERMISSIONS`/`P4_RAID_ROLE_PERMISSIONS`; `advisory-locks.test.ts` pins 730236.
- The implementers' integration tests prove the API half (p4-work-split §E): the nine T15 columns and the type, probability and closure refusals; the T08-owner-edit A01 test; the corrective rule (two cycles create one case, the third updates it; a benefit below plan creates one; replay creates none; a failed control check creates one owned case with a follow-up date); decimal budget totals and the working-day slip examples; the critical-path fixture and the missing-duration refusal; AUD 403 on every write; the entity-group test (§12).

## Amendment (2026-10-09, T-DG4-ARCH-R1): RAID Dependency entries as decided, and the codes added outside §11

### A1. RAID Dependency entries (BE-D handback §5 items 1–3; decided, no DG3 reopen)

1. **Status.** A Dependency entry has no "In progress" status. Its RAID status is **Open** (the T08 statuses `open` and `at_risk`) or **Closed** (`resolved`). A RAID update to `in_progress` on a Dependency is refused 422 `raid.status_transition` (the §11 text, unchanged); `status: "open"` is accepted and keeps `at_risk`. Risk, Assumption and Issue keep Open ⇄ In progress as §1 states.
2. **Closure fields.** The canonical `dependency` row (DG2/DG3) has no closure columns, and none is added. A closed Dependency entry returns `recordStatus: "resolved"` and `closedAt`, `closedBy`, `closureNote` as `null`; the closure note is the `reason` of the `dependency.update` audit event that resolved it. The RAID screen shows such an entry as **Closed** and its closure note from the record history; it never shows the null fields as a blank closure or as "Unknown". (Risk, Assumption and Issue entries keep their closure columns.)
3. **"To" initiative.** The RAID form requires a "To" initiative when the type is Dependency (FE-D; the orchestrator's preference). The API mapping of §2 is unchanged, so an API create without endpoints still maps to `to_kind = other`. Such an entry is listed and read on T08, edited and closed through RAID, and editable on T08 once a `toInitiativeId` is given (T08's `updateT08Dependency` keeps its DG3 422 `dependency.to_required`). No DG3 response changes.

### A2. Codes and keys added outside §11 (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `validation.not_applicable` | 400 field | accepted | This field does not apply here. |
| `raid.task.action_due` | message key | accepted | Your action is due. With {sourceCode}: Your action on {sourceCode} is due. |
| `raid.task.corrective_follow_up` | message key | accepted | Follow up corrective case {caseCode}. |
