# ADR-0048: The 90-day launch plan as editable scheduled tasks (generation from a start date, owners, predecessors, "blocked by", re-dating unstarted tasks), the Day-90 leadership test, the 25-question Transformation Health Check (HealthAssessment) with Yes=1/No=0 scheme v1, the four B0152 bands, incomplete handling, the top 3 actions and reassessments, and versioned scoring schemes (N/A or partial credit only with their own bands)

- **Status:** Proposed for P5 (DG5). Author: solution-architect (T-DG5-ARCH-05), 2026-10-14.
- **Requirements (slice H of `docs/architecture/p5-plan.md`):** REQ-PB-086, REQ-PB-087, REQ-PB-091, REQ-PB-092, REQ-S14-001, REQ-S14-002, REQ-S14-003, REQ-S14-004, REQ-S16-021.
- **Sources (quoted where a design point has one; D-142 Q5: the playbook text is rendered verbatim, the master prompt is a paraphrase):**
  - B0133 "First 90 Days of a New Transformation"; B0134 (table "Window | Primary objective | Actions | Outputs"), e.g. "Days 31-60 | Define & design | Agree North Star/outcomes; build KPI tree; design TOM; run design decisions; identify initiatives; size benefits. | North Star; KPI tree; TOM; initiative backlog; initial business case."
  - B0135 "Day-90 leadership test"; B0136–B0141, the six questions, from "Can leaders explain the same case for change and North Star?" to "Can the transformation team show what it needs from executives this month?"
  - B0149 "Transformation Health Check — 25 Questions"; B0150 (25 checkbox questions, "Score: ____ / 25", "Top 3 actions"); B0151 "Interpretation"; B0152 ("21-25 | Strong transformation discipline; focus on value acceleration and continuous improvement.", "16-20 | Solid foundation; address a few structural gaps before scaling.", "10-15 | Execution risk is material; strengthen direction, TOM, governance or benefits.", "0-9 | Transformation is likely being managed as disconnected projects; reset around outcomes and operating model.").
  - M0257 "Seed the source 90-day launch plan relative to an adjustable start date"; M0261 "Convert this into editable scheduled tasks with owners, dependencies and required outputs. Preserve the Day-90 leadership test …"; M0224 "New transformation created | … optional 90-day plan".
  - M0262 "Implement all 25 source health-check questions with response, evidence, owner, assessment date and action. Seed a simple Yes=1/No=0 scoring method as an explicit implementation assumption because the source provides checkboxes and a total but no partial-credit method. Unanswered items make the assessment incomplete. If partial credit or N/A is introduced later, use a separately versioned scoring scheme and do not silently reuse the original interpretation bands."
  - M0288 "Preserve the source score bands … Require the top three improvement actions and track reassessments over time."; M0327 "BAUHandover, Control, ControlCheck, ImprovementItem, Lesson and HealthAssessment."
- **Decisions applied:** D-141, D-142 (**Q5** verbatim playbook text; **Q6** "Day *d* = start date + *d* calendar days … A task that falls on a non-working day shows a working-day warning and is never silently shifted"; R1), D-143–D-146; D-088 §2, F-DG3-100.
- **Builds on:** ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0016, ADR-0025 (job kit, work items, the working-day calendar), ADR-0034 (BAU handover, controls, checks, improvement items, lessons: the other five S16-021 entities), ADR-0039 (configuration kinds, pins, `ConfigResolver`, the publish pipeline), ADR-0040 (pin migration), ADR-0044 §1 (the `LaunchPlanPort` of starter 1).
- **Physical model:** `0086_p5_launch_plans_health_checks.sql`, `0087_p5_kpi_launch_health_permissions.sql`. The guard probe (`docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe-output.txt`) tests this ADR's database claims in groups S01–S07 (seeds), LP (plan), LT (tasks), LD (predecessors), DT/DR (Day-90 test), HS (schemes), HA/HN/HX (assessments, answers, actions) and AO (grants); each probe names the constraint it expects.
- **Two gate systems.** Nothing here reads or writes DG0–DG7. A health-check score or a Day-90 answer is an assessment, not an approval of anything.

## Context

1. `source_element` (`0064`) already holds the 25 health questions verbatim (set `health_question`, keys `q01`–`q25`, B0150) and the three launch windows (set `launch_window`, keys `days_0_30`, `days_31_60`, `days_61_90`, B0134), both with `feature_status = 'planned'` and provisional Arabic labels.
2. Configuration kind `health_check_scheme` and its pin kind exist (`0062`, `0063`; ADR-0039 §1), with no element types (`methodology_element_guard` allowed none) and no seeded version. Its review policy is seeded "review required, reviewer TO".
3. The other five S16-021 entities exist since DG4 (`0048`: `bau_handover`, `control`, `control_check`, `improvement_item`, `lesson`; ADR-0034). HealthAssessment is the only new one.
4. `launch/routes.ts` and `health/routes.ts` are BE-A stubs. Starter 1 (ADR-0044 §1) calls `LaunchPlanPort.generate(tx, {transformationId, startDate, idempotencyKey: "launch_plan:<transformationId>"})`, which is a no-op until BE-P implements it.

## Decision

### 1. Launch plan generation (REQ-PB-086)

**Catalogues** (`0086`, read-only to mth_app):
- `launch_window`: the three B0134 rows, with `label_en` (`Days 0-30`, …), `objective_en` (`Diagnose & align`, `Define & design`, `Mobilize & prove`), `actions_source_en` and `outputs_source_en` (the full cell texts, verbatim), and the day range: 0–30, 31–60, 61–90.
- `launch_template_item`: 33 rows, being the 17 actions and 15 outputs of B0134 plus the Day-90 test (B0135). Each B0134 cell is split at `;` (the platform's split). Each fragment is verbatim, keeping the source's capitalisation and dropping the separator and the cell's final `.`. Each row also has its window, `item_kind` (`action` | `output` | `day_ninety_test`), `start_day`/`due_day`, and for outputs an `output_record_type` (Charter v0.9 → `charter`, diagnostic → `diagnostic_item`, baseline → `baseline`, governance → `meeting_series`, North Star → `north_star`, KPI tree → `kpi_definition`, TOM → `tom_canvas_cell`, initiative backlog and initiative cards → `initiative`, initial business case → `business_case`, Roadmap → `roadmap_wave`, benefits register → `benefit`, Wave 1 evidence → `evidence`; issue tree and dashboard have none).
- `day_ninety_question`: §4.

Every Arabic text is a provisional translation.

**Generate** (`generateLaunchPlan`, `POST /transformations/{id}/launch-plan`, body `{startDate}`; and the S12-004 port). In one transaction under lock 730267, it inserts the `launch_plan` (one per transformation: `launch_plan_transformation_key`; `idempotency_key = 'launch_plan:<transformationId>'`, CHECKed), one `launch_task` per template item, and the `day_ninety_test` (§4). **Day numbering (D-142 Q6):** day *d* is the start date + *d* calendar days. A task's `start_date` is start + `start_day` and its `due_date` is start + `due_day`. With start 2026-10-01, the 11 Days 31-60 tasks start on 2026-11-01 and are due on 2026-11-30 (the REQ-PB-086 acceptance), and the Day-90 test task is due on 2026-12-30. A date on a non-working day (the ADR-0025 calendar) is shown with a working-day warning and never shifted. A second generate gives 409 `launch_plan.exists`. The port's replay returns the existing plan and writes nothing (the unique key is the backstop).

### 2. Editable tasks and re-dating (REQ-S14-004)

**Entity `launch_task`**. Fields:
- `ordinal`;
- `template_item_code`, NULL exactly for `custom` tasks (`launch_task_kind_template`);
- `window_code` and `task_kind`;
- `title` (editable; the template text stays in the catalogue) and `notes`;
- `start_date` and `due_date` (`due ≥ start`);
- `owner_user_id`;
- `status`;
- the completion stamps;
- `output_record_type`/`output_record_id`, a link to the required output record, which must exist in the transformation (dynamic check `launch_task_output_record`).

**State machine** (`launch_task_guard`):

```text
not_started -> in_progress | completed | cancelled
in_progress -> not_started | completed | cancelled
completed   -> in_progress (reopen)
cancelled: final
```

A task is created `not_started`. Plan, template item, kind, window, ordinal and a template task's output type never change. **A completed task's dates never change** (`launch_task_completed_dates_fixed`).

**Re-dating** (`updateLaunchPlan`, `PATCH /transformations/{id}/launch-plan` `{startDate}`, `If-Match` on the plan). In one transaction under lock 730267, with Δ = new start − old start:
1. every task with status `not_started` moves its `start_date` and `due_date` by Δ days (each a version step with its own audit event);
2. `in_progress`, `completed` and `cancelled` tasks keep their dates;
3. an open Day-90 test moves its `scheduled_date` by Δ;
4. the plan records `last_shift_days = Δ` (`launch_plan_shift_recorded`).

REQ-S14-004's acceptance: "+7 days moves every unstarted task by 7 days and leaves completed tasks unchanged".

### 3. Owners, predecessors and "blocked by" (REQ-S14-004)

`launch_task_predecessor`: `task_id` needs `predecessor_task_id` first. Both tasks are in the same plan (`launch_task_predecessor_same_plan`); a task never precedes itself (CHECK); and no chain of active links forms a cycle (recursive check under lock 730267, `launch_task_predecessor_no_cycle`). **A link is never deleted:** removing it stamps `removed_at`/`removed_by`, its only change (`launch_task_predecessor_immutable`), and re-adding makes a new row (one active link per pair, partial unique index). `putLaunchTaskPredecessors` replaces a task's active set with `If-Match` on the task (the task steps one version; each added or removed link has its own audit event). **"Blocked by"** is derived on read: `blockedBy[]` = the task's active predecessors whose status is not `completed`, with their ordinals and titles. The UI shows "Blocked by: {title}". REQ-S14-004's acceptance: "a task whose predecessor is incomplete shows 'blocked by' the predecessor". A blocked task can still be started: the plan informs and does not lock. Owners are any active user of the transformation's organization (422 `validation.user_invalid`, the DG3/ADR-0043 code).

### 4. The Day-90 leadership test (REQ-PB-087)

`day_ninety_question` (6 rows, `q1`–`q6`, text **verbatim** B0136–B0141, provisional Arabic, `evidence_record_types` for the pre-fill). `day_ninety_test` (one per plan, created by the generation, `scheduled_date` = start + 90) and `day_ninety_response` (one per question: `answer` `yes` | `no`, optional `comment`, optional `evidence_id` of the transformation, `responded_by`).

- **Incomplete** while `answered_count < 6`. The API returns `completion {answered, total: 6, complete}`, and the UI shows "Incomplete (n/6)". `completeDayNinetyTest` needs all six (`day_ninety_test_completed_complete`; API 422 `day_ninety_test.incomplete`). A completed test is final, and responses are written only while it is open. `answered_count` equals the responses at COMMIT.
- **Pre-filled evidence:** `getDayNinetyTest` lists, per question, up to 5 suggestions from the records named in `evidence_record_types`. For example, q1 → the charter and North Star, with their state; q4 → baselines and benefit formulas with their Finance validation state; q6 → the transformation's open executive asks. These are links for the leader to confirm, never answers.
- **"Day 90 reached → create test task":** job `launch.day_ninety_tests` (daily 00:50 Asia/Riyadh, `0086`) creates, once per open test whose `scheduled_date` ≤ today in the transformation's time zone, one `day_ninety_test_due` work item per holder of `day_ninety_test.respond` in the transformation (dedupe key `day_ninety_test:<testId>:<userId>`; a replay creates nothing). The launch task of kind `day_ninety_test` is the plan's view of the same test.

### 5. The 25-question health check (REQ-PB-091, REQ-S14-001, REQ-S14-002, REQ-PB-092; HealthAssessment, REQ-S16-021)

**Entity `health_assessment`**. Fields:
- `sequence_no` (1… per transformation; reassessments are tracked in order);
- `scheme_version_id`, fixed at creation: the transformation's `health_check_scheme` pin through `ConfigResolver`, else v1 of key `health-check` (ADR-0039 §3 "never the latest"). It must be a published version of that kind (`health_assessment_scheme_published`);
- `assessment_date` and `owner_user_id`;
- `status`: `draft` → `submitted`, and a submitted assessment is final;
- `answered_count`;
- `score`, `score_max` and `band_key`, set only at submission;
- `previous_assessment_id`, the previous submitted assessment, for reassessments;
- the submission stamps.

At most one draft per transformation.

**Answers** (`health_assessment_answer`, one per question `q01`–`q25`): `response` (one of the scheme version's response keys, `health_assessment_answer_response_allowed`), `evidence_note`, `evidence_id`, `owner_user_id` and `action_note`. These are M0262's "response, evidence, owner, assessment date and action". Answers are written only while the assessment is a draft. The question texts are the `source_element` rows of set `health_question`, rendered **verbatim** (B0150), e.g. "Are 3-5 business outcomes measurable?" with the source's hyphen.

**Top 3 actions** (`health_assessment_action`, ranks 1–3, `action_text`, optional owner, due date and link to a DG4 `improvement_item` of the transformation). Submission needs exactly three (`health_assessment_three_actions`; API 422 `health_check.actions_required`). REQ-PB-091's "submission without three actions is rejected".

**Scoring** (scheme v1, an **implementation assumption**, M0262/D-010): Yes = 1 and No = 0, and the score is the count of Yes out of 25 (REQ-S14-001). The UI shows the method with the i18n key `healthCheck.scoringAssumption` ("Scoring Yes = 1, No = 0 is an implementation assumption; the playbook gives checkboxes and a total only."). Pure functions in `packages/shared/src/health/**` (KBE-G) compute the score; the database function `p5_health_assessment_result` computes the same value. **The database refuses a submitted score or band that differs from its own computation** (`health_assessment_score_matches`).

**Incomplete (REQ-S14-002):** while `answered_count < 25`, the API returns `completion {answered, total: 25, complete: false}`, `score: null` and **`band: null`**, and the UI shows "Incomplete (24/25)" and no band. An incomplete assessment cannot be submitted (`health_assessment_incomplete`; API 422 `health_check.incomplete`). A complete draft shows its computed score and band, labelled "not submitted".

**Bands (REQ-PB-092):** the scheme's `health_band` elements, each with `minScore`, `rangeLabel` and both texts. A score falls in the band with the highest `minScore` not above it. In v1 the four B0152 bands are verbatim, with `minScore` 21, 16, 10 and 0: scores 21, 16, 10 and 9 map to "21-25", "16-20", "10-15" and "0-9" and their texts, and 17 Yes gives 17 and "16-20" (REQ-S14-001's acceptance). A submitted assessment keeps its scheme version, score and band forever.

### 6. Versioned scoring schemes (REQ-S14-003)

A scheme is a configuration version of kind `health_check_scheme`. It is drafted, previewed, reviewed (TO, the seeded policy) and published through the slice A pipeline (ADR-0039 §4–§5, `methodology.configure`/`methodology.publish`, ADM_METHOD), and pinned and migrated per transformation (ADR-0039 §3, ADR-0040). `0086` adds two element types to the kind, `health_response` and `health_band`, by widening the element-type CHECK and redefining `methodology_element_guard()` with every `0062`/`0068` rule kept verbatim:

- **`health_response`:** stable key `yes` | `no` | `partial` | `na`. `credit` is a decimal string: "1", "0", or a fraction "0.xx" for `partial`; null for `na`, which is excluded from the denominator (`methodology_element_health_credit`).
- **`health_band`:** a decimal-string `minScore`, a `rangeLabel`, `textEn` and `textAr` (`methodology_element_health_band`). A `source` band is one of the four B0152 keys (`b0152_21_25`, `b0152_16_20`, `b0152_10_15`, `b0152_0_9`).
- **`definition`:** `{scoreBasis: "points" | "percent_of_applicable", questionCount: 25, …}`.

**Seeded v1** (`0086`): key `health-check`, version 1, published, origin `seed`. It has responses yes (credit 1) and no (credit 0), score basis `points`, and the four B0152 bands verbatim.

**Publish rule** (trigger `health_scheme_publish_guard` on `methodology_version`, function `p5_health_scheme_problem`). A health-check draft can be published only if:
1. the definition is valid (`health_scheme_definition`);
2. `yes` = 1 and `no` = 0 are present (`health_scheme_yes_no_required`);
3. a `partial` credit is strictly between 0 and 1 and `na` has none (`health_scheme_credit`);
4. `na` uses `percent_of_applicable`, score = 100 × Σ credit / number of applicable answers, to 2 decimals (`health_scheme_na_needs_percent`);
5. there is at least one band, one of them at 0, with distinct `minScore` values not above the maximum, 25 or 100 (`health_scheme_bands_invalid`);
6. **a scheme with `partial` or `na` keeps none of the four source bands**: it must remove them and define its own (`health_scheme_own_bands_required`). M0262: "do not silently reuse the original interpretation bands".

REQ-S14-003's acceptance "publishing a scheme that adds N/A without new bands is rejected" is rule 6. The preview hook of KBE-G's kind provider checks the same rules first, so the publish pipeline refuses before the database does: 422 `health_scheme.own_bands_required` and the other codes in §9. **"Existing assessments keep their original scheme version and band":** `scheme_version_id` never changes, a submitted assessment is final, and publishing or migrating a pin affects only assessments created afterwards. ADR-0040's migration preview lists the transformation's draft assessment as an `invalidated_calculation` item (ADR-0040 §2), and it keeps its scheme.

### 7. Authorization (permissions matrix §22)

| Operation group | Permission | Role defaults (`0087`) |
|---|---|---|
| Read the launch plan, tasks, Day-90 test, health assessments | `transformation.read` | every role holding it in scope, AUD included |
| Read the launch template, the 25 questions, the health-check schemes | session (REQ-S14-003 "view: all signed-in users") | every signed-in user |
| Generate the plan, change the start date, edit tasks and predecessors | `launch_plan.edit` | TL, TO (REQ-PB-086 "generate/edit:TL,TO") |
| Record Day-90 responses, complete the test | `day_ninety_test.respond` | SP, TL (REQ-PB-087 "respond:SP,TL") |
| Create, answer, set actions, submit a health assessment | `health_check.assess` | TL, TO (REQ-PB-091 "assess:TL,TO") |
| Draft and publish a scheme | `methodology.configure`, `methodology.publish` (slice A) | ADM_METHOD; review TO (the seeded policy) |

AUD gets 403 on every write. No code here is a business approval. The technical administrators get none of these codes; ADM_METHOD publishes schemes through Studio, as for every configuration kind. Every mutation re-checks its permission and scope at commit, validates, needs `If-Match` (428/409; the creates `generateLaunchPlan`, `createLaunchTask` and `createHealthCheck` return version 1), writes one audit event per mutated row, and does no remote I/O inside the transaction. **Concurrency of answers:** `putDayNinetyResponse` and `putHealthCheckAnswer` take `If-Match` of their test or assessment, and each write steps that parent's version (its `answered_count` or `updated_at`) with its own audit event, so two leaders answering at once get one 409.

### 8. Locks, events and jobs

- **730267** `launchPlan`, key `<transformationId>`: generate, re-date, task edits, predecessor links (taken by `launch_plan_guard` and `launch_task_predecessor_guard`).
- **730268** `healthAssessmentSubmit`, key `<assessmentId>`: the submission's score, band and three-action check together (taken by `health_assessment_guard`).
- 730269 is reserved for this block.
- Job `launch.day_ninety_tests` (§4). Work-item kind `day_ninety_test_due` (My Work **Assigned actions**).
- The `LaunchPlanPort` implementation is registered by BE-P in `server.ts`, one line (ADR-0044 §1). Generation and re-dating publish no outbox event.

### 9. Refusal codes and English texts (exact)

| Status | Code | English text (exact) |
|---|---|---|
| 409 | `launch_plan.exists` | This transformation already has a 90-day launch plan. |
| 422 | `launch_task.cancelled` | A cancelled task cannot be changed. |
| 422 | `launch_task.completed_dates_fixed` | A completed task keeps its dates; reopen it first. |
| 422 | `launch_task.status_step` | This status change is not allowed for the task. |
| 422 | `launch_task.predecessor_cycle` | This predecessor would make the tasks depend on each other in a loop. |
| 422 | `launch_task.predecessor_other_plan` | A predecessor must be a task of the same launch plan. |
| 422 | `launch_task.output_record_invalid` | The output must be a record of the required type in this transformation. |
| 422 | `day_ninety_test.incomplete` | Answer all six questions before completing the Day-90 leadership test. |
| 422 | `day_ninety_test.completed` | The Day-90 leadership test is complete; its responses can no longer change. |
| 409 | `health_check.draft_exists` | This transformation already has a health check in progress. |
| 422 | `health_check.incomplete` | Answer all 25 questions before submitting the health check. |
| 422 | `health_check.actions_required` | Submit the health check with its top 3 actions. |
| 422 | `health_check.not_draft` | Only a health check in progress can be changed or submitted. |
| 422 | `health_check.response_not_allowed` | This response is not allowed by the health check's scoring scheme. |
| 422 | `health_check.not_computable` | No question is applicable, so no score can be computed. |
| 422 | `health_scheme.own_bands_required` | A scheme with partial credit or N/A needs its own interpretation bands; the four source bands cannot be reused. |
| 422 | `health_scheme.yes_no_required` | A scheme keeps Yes = 1 and No = 0. |
| 422 | `health_scheme.credit_invalid` | Partial credit is a decimal between 0 and 1; N/A has no credit. |
| 422 | `health_scheme.na_needs_percent` | A scheme with N/A scores as a percentage of the applicable questions. |
| 422 | `health_scheme.bands_invalid` | Bands need one band starting at 0 and distinct starting scores within the maximum score. |

Generic codes are ADR-0007's; `validation.user_invalid` is ADR-0043's. The database constraint names (probe output) map to these codes in `platform/db-errors.ts` (BE-P, KBE-G lines).

### 10. Decimal and Unknown semantics

Scores are `numeric(7,2)` decimal strings ("17", "62.50"), computed with decimal.js in the API and with `numeric` in the database, which must agree (§5). Credits and `minScore` are decimal strings. Dates are business dates ('YYYY-MM-DD') in the transformation's time zone (default Asia/Riyadh). An incomplete assessment has `score: null` and `band: null`, never 0; an all-N/A one is `not_computable`. Counts are integers.

### 11. REQ-S16-021 entity group

| Entity | Table (migration) | Primary key | Owner | Status | API (task) |
|---|---|---|---|---|---|
| BAUHandover | `bau_handover` (`0048`) | `id` uuid | `receiving_owner_user_id` (NOT NULL) | `status` (`draft`, `submitted`, `accepted`, `returned`, …; ADR-0034) | DG4 routes |
| Control | `control` (`0048`) | `id` | `owner_user_id` (nullable) | `status` (`active`, `retired`) | DG4 routes |
| ControlCheck | `control_check` (`0048`) | `id` | `assignee_user_id` (nullable) | `status` (`due`, `passed`, `failed`, `cancelled`) | DG4 routes |
| ImprovementItem | `improvement_item` (`0048`) | `id` | `owner_user_id` (nullable) | `status` (`open`, `in_progress`, `done`, `rejected`) | DG4 routes |
| Lesson | `lesson` (`0048`) | `id` | `created_by` (the author; no separate owner column) | `status` (`draft`, `published`, `archived`) | DG4 routes |
| HealthAssessment | `health_assessment` (`0086`) | `id` | `owner_user_id` (NOT NULL) | `status` (`draft`, `submitted`) | `createHealthCheck`, `getHealthCheck` (KBE-G2) |

KBE-G2 writes the S16-021 group test. It creates each of the six through the API and reads it back, with 403 for a caller without the write right and for AUD, against the DG4 routes and the new health routes. The owner and status columns above were read from `0048` and `0086`.

## Alternatives considered

1. **Health-check scheme as typed tables outside Studio.** Rejected: p5-plan §2 routes schemes through slice A's publish pipeline, which already gives drafts, review, publish, immutable versions, pins and migration. The `health_response` and `health_band` elements carry typed, CHECKed attributes, and the scheme rules are a database publish guard.
2. **Copy the 25 question texts into the scheme.** Rejected: they are source elements, verbatim and counted by the source-coverage gate (`source_element`). A scheme changes scoring, never the questions.
3. **Store "blocked" on the task.** Rejected: it would go stale. It is derived from the predecessors' status on read.
4. **Shift re-dated tasks to working days.** Rejected by D-142 Q6: a working-day warning, never a silent shift.
5. **Delete removed predecessor links.** Rejected: no business table grants DELETE (catalogue rule). A stamped removal keeps the history.

## Consequences

- A transformation uses a new scheme only after its pin moves (ADR-0040), which keeps every existing assessment on its scheme.
- The 33 template tasks are created even when a team needs fewer. Unneeded ones are cancelled, never deleted.
- `0088` stays free for KBE-G2. Once BE-P and KBE-G2 have shipped, it moves the `source_element` rows of `launch_window` and `health_question` to `working` (p5-work-split §A rule A-7).

## Verification

- **Database (probe, 157/157 PASS on PostgreSQL 16.13):** groups S01–S07, LP, LT, LD, DT, DR, HS, HA, HN, HX and AO in `docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/probe-output.txt`, plus G00–G05.
- **Pins:** `catalogue.test.ts`, `seed.test.ts`, `advisory-locks.test.ts`, as ADR-0047 lists them; `MY_WORK_SECTION_BY_KIND` maps the three new kinds; `CONFIG_ELEMENT_TYPES`/`ELEMENT_TYPES_BY_KIND` in `@mth/shared/schemas` list the two new element types.
- **Implementer tests (literal, p5-work-split §H):**
  - REQ-PB-086: with start 2026-10-01 the Days 31-60 tasks fall in 2026-11-01…2026-11-30, and all 17 B0134 actions appear verbatim.
  - REQ-PB-087: the six questions render verbatim, and 5 responses give "Incomplete (5/6)".
  - REQ-PB-091: the 25 questions are verbatim; 24 answers → no band; submit without 3 actions → 422.
  - REQ-PB-092: 21, 16, 10 and 9 → the four texts verbatim.
  - REQ-S14-001: 17 Yes → 17 and "16-20", and the assumption is shown.
  - REQ-S14-002: 24 answers → "Incomplete (24/25)" and `band: null`.
  - REQ-S14-003: publishing a scheme with `na` and the source bands → 422 `health_scheme.own_bands_required`; an assessment submitted under v1 keeps v1, its score and its band after v2 is published and the pin migrated.
  - REQ-S14-004: +7 days moves every `not_started` task by 7 and leaves `completed` ones unchanged; a task with an incomplete predecessor shows `blockedBy`.
  - REQ-S16-021: the group test (§11).
  - For every mutation: AUD 403, `If-Match` 428/409, one audit event, commit-time re-authorization.
