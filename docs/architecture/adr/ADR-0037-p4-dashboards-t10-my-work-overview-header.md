# ADR-0037: Dashboard read models: the six Template 10 areas and their area-specific RAG, six dashboards, filters, drill-down to records, period, calculation and evidence, zero vs Unknown vs n/a, scope enforcement, My Work, the Executive Overview and the workspace header

- **Status:** Proposed for P4 (DG4). Author: solution-architect (T-DG4-ARCH-08), 2026-10-09.
- **Requirements (slice J of `docs/architecture/p4-plan.md`):** REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-S03-008, REQ-S03-009, REQ-S03-011, REQ-S13-001, REQ-S13-002, REQ-S13-003.
- **Sources (quoted where a design point has one):**
  - Playbook B0094/B0095 (Template 10 — Executive Transformation Dashboard: "| Area | What to show | RAG logic |", six rows, among them "Outcomes | Actual vs baseline vs target; trend | RAG based on target trajectory, not activity completion" and "Decisions | Decision needed, owner, due date, impact of delay | Red if executive decision overdue").
  - Master prompt M0244 ("Provide executive, transformation, workstream, Finance, adoption and personal work dashboards. Filters include organization, transformation, owner, period, phase and status. Every headline number must drill into its contributing records, period, calculation and evidence; distinguish zero, unknown and not applicable."), M0245–M0252 ("Implement the six source dashboard areas with their distinct status logic", the table "Area | Required presentation | Status basis"), M0138 (T10), M0159 ("Missing or stale data must show Unknown/Stale, not green or zero."), M0160 ("RAG must use the approved expected trajectory and configurable thresholds … Never derive outcome RAG from project task completion."), M0100 ("My Work: assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines."), M0101 ("Executive Overview: outcomes, value, critical initiatives, adoption, blockers and decisions."), M0114 ("Within a transformation, show its phase, gate readiness, North Star, owners, outcome health, benefits, key decisions and next required actions. Provide contextual navigation into its related records without re-entering the transformation ID."), M0196 and M0302 (Asia/Riyadh default business calendar and timezone, configurable).
- **Decisions applied:** D-088 §2 (claims enumerated and exactly true); D-089 (plan adopted; R4: rows citing later A-tests are judged on their own acceptance text); D-091 (KPI versions; percentages stored as fractions); D-102 item 2 (no worker job calls API code; not needed here: slice J has no job).
- **Builds on:** ADR-0002 (module boundaries; rule 4 "Reporting read models may use SQL views that the owning module defines"), ADR-0006 (scoped policy), ADR-0007 (API conventions, problem+json, cursor pagination), ADR-0025 (business calendar, business date, `createWorkItemOnce`), ADR-0027/ADR-0028 (KPI status, RAG, Unknown/Stale/Not computable, overrides), ADR-0029/ADR-0030 (benefit register, value lines, totals counted once), ADR-0031 (RAID register, schedule network), ADR-0032 (T16 log and its overdue rule), ADR-0033 (adoption metric links), ADR-0035 (gates, phases), ADR-0038 (traceability, workstreams).
- **Physical model:** `0056_p4_dashboards_t10.sql` (`t10_area_definition`, `dashboard_rag_policy`, view `my_work_draft`), `0057_p4_dashboards_traceability_permissions.sql` (permissions). Probe ids refer to `docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/probe-output.txt`.
- **Two gate systems.** The dashboards show product gates G1–G6 as business approvals inside the product. Nothing here reads or writes DG0–DG7, and no dashboard figure is an approval.

## Context

As built at `HEAD` `89df7f7` (checked for this ADR):

1. `reporting` is a P1 scaffold. BE-A created the route-file stubs `reporting/{traceability,orphans,modular,my-work,executive-overview}.ts`, `reporting/dashboards/index.ts` and `transformations/workspace-header.ts`, each registering no route. `modules.ts` lets `reporting` import `platform`, `audit`, `access`, `transformations`, `kpi`, `tasks`, `benefits`, `raid`, `adoption`, `sustainment`, `governance` and `portfolio`, and **not** `workflows`.
2. The engines whose data the dashboards show exist: KPI evaluations with their RAG, Unknown/Stale/Not computable and overrides (slice A, `kpi_evaluation`, `rag_override`); benefit value lines and counting (`benefit_value_line`, `benefit_counting` views, slice B); the RAID register view `raid_register` (slice E); the T16 view `executive_decision_log` (slice D) with the ADR-0032 overdue rule; adoption metric links (`adoption_metric_link`, slice F); work items (`work_item`, slice I) with `assignee_user_id`, `due_date`, `link_path` and `kind`.
3. Of those, only `kpi` exports query functions today (`loadKpiGateFacts`, `computeTotals`, …); `benefits`, `governance` and `adoption` export only their registration hooks.
4. No dashboard, My Work, overview or header route exists, and no table stores a dashboard figure.

## Decision

### 1. Read models, computed on every request (all nine rows)

- **Nothing is stored.** Every dashboard, drill-down, My Work, overview and header response is computed from the canonical rows in the request's own read-only transaction. No table, cache or snapshot holds a dashboard figure or a RAG status, so "Accepted KPI actual → refresh dashboard" (REQ-PB-062, REQ-S13-001, REQ-S03-009 automation) holds by construction: the next read after the accept pipeline's commit reads the new evaluation. No job and no outbox consumer belongs to slice J.
- **Data access (ADR-0002 rules 1 and 4).** KBE-G reads:
  1. through these SQL views: `raid_register` (raid), `executive_decision_log` (governance), `benefit_value_line` and `benefit_counting` (benefits), `traceability_edge` (`0055`, ADR-0038), `my_work_draft` (`0056`, §7);
  2. through read-only functions that KBE-G adds in one new file per engine module, each exported by one line in that module's `index.ts`: `kpi/dashboard-facts.ts` (KPI status per outcome KPI and adoption indicator, through the slice A status service so overrides in force and the read-time Stale re-check apply), `benefits/dashboard-facts.ts` (planned, forecast, submitted, validated and rejected totals per currency line and window, and the investment line, through the slice B totals service), `portfolio/dashboard-facts.ts` (initiatives, milestones, workstreams, the schedule network's critical-path flag), `adoption/dashboard-facts.ts` (metric links, open interventions), `tasks/dashboard-facts.ts` (a user's open work items);
  3. the gate readiness of the header through a port, `WorkflowsReadPort` (`reporting/ports.ts`: `gateReadiness(db, transformationId): Promise<GateReadiness | null>`), wired in `server.ts` to a read-only function of `workflows` (the `GateFactsProvider` precedent, ADR-0021 §7), because `reporting` may not import `workflows`.
  No file of slice J writes a table except the `dashboard_rag_policy` route (§3).
- **No lock.** Read models take no advisory lock (p4-plan §4, "730249 reserved … unless the ADR shows a need"); 730249 is used by ADR-0038 §3, not here.

### 2. The six dashboards and their operations (REQ-S13-001, REQ-PB-062, REQ-S03-009)

| Dashboard (M0244) | Operation | Path | Scope | Content |
|---|---|---|---|---|
| Executive | `getExecutiveOverview` | `GET /api/v1/overview` | the transformations of `organizationId` the caller may read, narrowed by the filters | the six T10 areas over that set, and one row per transformation with its six area statuses |
| Transformation | `getTransformationDashboard` | `GET /api/v1/transformations/{transformationId}/dashboard` | one transformation | the six T10 areas (Template 10) |
| Workstream | `getWorkstreamDashboard` | `GET /api/v1/transformations/{transformationId}/workstreams/{workstreamId}/dashboard` | the active initiatives of one workstream (ADR-0038 §9) | Outcomes (outcomes those initiatives contribute to), Value (benefits allocated to them), Portfolio (those initiatives), Dependencies (dependencies to or from them); Decisions and People & adoption are transformation-level and are returned with status `not_applicable` and rule key `dashboard.rag.workstream_not_applicable` |
| Finance | `getFinanceDashboard` | `GET /api/v1/dashboards/finance` | as Executive | value lines per value class × state × currency (ADR-0030 §7), gross/implementation cost/net, the count of measurements awaiting Finance validation, the count of non-financial benefits (Value n/a), one row per transformation |
| Adoption | `getAdoptionDashboard` | `GET /api/v1/dashboards/adoption` | as Executive | the People & adoption area, each linked indicator with its KPI status, open interventions per stakeholder group, one row per transformation |
| Personal work | `getMyWork` | `GET /api/v1/me/work` | the caller's own items (§7) | My Work sections and their counts |

The executive dashboard of M0244 and the Executive Overview of M0101 are **one read model and one operation**: M0101's six tiles map one-to-one onto the T10 areas (outcomes → Outcomes, value → Value, critical initiatives → Portfolio, adoption → People & adoption, blockers → Dependencies, decisions → Decisions). The personal work dashboard of M0244 and My Work of M0100 are likewise one operation.

**Area shape (`T10Area`).** `code` (`outcomes` | `value` | `portfolio` | `dependencies` | `decisions` | `people_adoption`), `ordinal`, the seeded labels (`sourceAreaEn`, `areaAr`, `sourceWhatToShowEn`, `whatToShowAr`, `sourceRagLogicEn`, `ragLogicAr`, `arProvisional`), `rag` (`status`, `ruleKey`, `ruleParams`, `policySource`), `headlines[]` (§5) and `items[]` (each `recordType`, `recordId`, `code`, `label`, `href`, `rag`, `dueDate`, `value`, `ownerUserId`, `flags[]`). Every area of every response has all of these members, so "all six areas render in en and ar from persisted data" (REQ-PB-062) is checked against one shape.

**Seed (`t10_area_definition`, `0056`; probe T01, T02).** Six rows, `code` and `ordinal` CHECKed; `source_area_en`, `source_what_to_show_en`, `source_rag_logic_en` are B0095 verbatim, `source_presentation_en` and `source_status_basis_en` are M0247–M0252 verbatim (probe T01 compares them with the read-only sources); the Arabic columns are provisional (`ar_provisional = true`). The application role has SELECT only (probe T02).

### 3. Area-specific RAG (REQ-PB-063, REQ-PB-064)

**Statuses.** `green`, `amber`, `red`, `unknown`, `stale`, `not_applicable`. **Combining** a set of statuses (an outcome from its KPIs, an area from its rows) uses this precedence: `red` if any is red; else `amber` if any is amber; else `unknown` if any is `unknown` or `not_computable`; else `stale` if any is stale; else `green`. So a missing or stale input never yields `green` (M0159). An empty set is handled per area below and is never `green` unless the table says so.

**Thresholds (`dashboard_rag_policy`, `0056`; probes RP01–RP07).** One row per organization (unique), every threshold column nullable; NULL means the default below, and the response's `policySource` says `default` or `configured`. Neither source gives a value, so the defaults are this ADR's interpretation (REQ-PB-063 notes: "Interpretations: the default threshold values, which neither source gives"):

| Column | Default | Used by |
|---|---|---|
| `value_gap_amber_ratio` / `value_gap_red_ratio` (decimal fraction, 0–1; amber ≤ red, CHECK) | 0.05 / 0.15 | Value |
| `milestone_slip_amber_working_days` / `milestone_slip_red_working_days` (0–250; amber ≤ red, CHECK) | 1 / 10 | Portfolio |
| `dependency_due_soon_working_days` (0–250) | 10 | Dependencies |
| `decision_due_soon_working_days` (0–250) | 3 | Decisions |
| `top_initiative_count` (1–50) | 10 | Portfolio |
| `deadline_horizon_working_days` (1–250) | 10 | My Work "upcoming deadlines" (§7) |

Working days are counted with the organization's business calendar (ADR-0025). The **business date** is today in the organization's default calendar timezone (Asia/Riyadh unless configured); with a period filter, the **as-of date** is the earlier of the period's end and the business date (§4).

| Area | Rows | Row status | Area status when the set is empty | What it never reads |
|---|---|---|---|---|
| **Outcomes** (B0095 "RAG based on target trajectory, not activity completion") | each active outcome of the scope, with its active outcome KPIs (T02 rows) | outcome = combine of its KPIs' statuses; a KPI's status is the slice A status for the selected period (the calculated RAG against the approved trajectory and versioned thresholds, or an override in force, ADR-0028); an outcome with no KPI is `unknown` | `unknown` (`dashboard.rag.outcomes.none`) | deliverables, milestones, action items, work items, phase steps or any completion percentage |
| **Value** ("RAG based on validated benefit gap") | per currency line: `plannedToDate` = Σ planned amounts with `period_end` ≤ as-of date (and ≥ the filter start), `validatedToDate` = Σ validated value-line amounts in the same window, over the benefits counted once (`benefit_counting.counted`) | gap ratio = (planned − validated) / planned with decimal arithmetic; ≤ amber ratio → green, ≤ red ratio → amber, above → red; a line with planned = 0 is `not_applicable` | `not_applicable` when no counted financial benefit has a planned amount due (`dashboard.rag.value.nothing_due`) | forecast, scenario or pending values (they are shown, never counted as realized); non-financial benefits (n/a, counted separately, REQ-PB-076) |
| **Portfolio** ("RAG by milestone + outcome risk") | the top `top_initiative_count` initiatives in status `selected`, `funded`, `launched` or `completed`, ordered by planned value allocated to them (Σ planned amount × allocation share, decimal) descending, then code | initiative = combine(milestone component, outcome component). Milestone: any milestone not `achieved`/`cancelled` whose `approved_date` is before the as-of date → red; otherwise the largest slip in working days from `approved_date` to a later `forecast_date`: ≥ red → red, ≥ amber → amber, else green; no milestone with an approved date → `unknown`. Outcome: combine of the Outcomes statuses of the outcomes it contributes to (`initiative_outcome_contribution`); none → `unknown` | `not_applicable` (`dashboard.rag.portfolio.none`) | task completion |
| **Dependencies** ("RAG by decision date / critical path") | open dependencies of the scope (`raid_register` rows with `record_table = 'dependency'` and RAID status open) | red when `needed_by` is before the as-of date, or its linked decision (`decision_id`) is an overdue executive decision; amber when the dependency is `at_risk` or `needed_by` is within `dependency_due_soon_working_days`; an amber dependency whose target initiative is on the computed critical path (slice E) is red; `unknown` when `needed_by` is NULL; else green. `onCriticalPath` is `true`, `false` or `null` (not computable), never a guessed `false` | `green` (`dashboard.rag.dependencies.none_open`) | — |
| **Decisions** ("Red if executive decision overdue") | T16 asks of the scope (`executive_decision_log`) with status `open` or `deferred` | **overdue** = the ADR-0032 rule: its due date is before the business date in the organization's default calendar timezone. Area **red** when at least one is overdue (and lists each overdue ask); amber when any is due within `decision_due_soon_working_days`; else green | `green` (`dashboard.rag.decisions.none_open`) | asks in any status other than `open` or `deferred` (a recorded outcome closes the ask, so it no longer counts) |
| **People & adoption** ("RAG vs adoption curve") | the KPIs of the active adoption metric links of the scope (`adoption_metric_link.kpi_definition_id`) | the slice A status against the approved trajectory (the adoption curve); combine as Outcomes | `unknown` (`dashboard.rag.adoption.no_indicators`) | training completion alone (REQ-PB-072 keeps proficiency separate; the indicator KPIs carry it) |

REQ-PB-063's acceptance: an outcome whose tasks are 100 % complete but whose KPI is below trajectory is red or amber, because the Outcomes rule reads only the KPI status; a KPI with no actual is `unknown` (slice A `kpi.rag.no_actual`). REQ-PB-064's acceptance: one open T16 ask due yesterday (Asia/Riyadh) makes the Decisions area red and lists it; after its outcome is recorded its status is no longer `open`/`deferred`, so it is not counted.

**Overrides.** The T10 areas have no override of their own. The authorized, reasoned, audited override of REQ-PB-063's permissions column is the slice A KPI override (`rag_override`, ADR-0027: reason, evidence, expiry, audit; the calculated status is preserved and shown beside it); the Outcomes and People & adoption rows use the override while it is in force and show both statuses. This ADR's reading of "override: authorized with reason (audited)"; for the orchestrator to confirm.

### 4. Filters (REQ-S13-002)

Query parameters, applied server-side to every headline, row and drill-down of a response, and echoed in `appliedFilters` (for the chips):

| Filter | Parameter | Meaning |
|---|---|---|
| Organization | `organizationId` (required on `getExecutiveOverview`, `getFinanceDashboard`, `getAdoptionDashboard`) | the organization whose readable transformations form the scope |
| Transformation | `transformationId` (repeatable, at most 50) | narrows the scope; each id must be readable (else 404, §6) |
| Owner | `ownerUserId` | keeps rows owned by that user: outcome and outcome-KPI owner, KPI owner, benefit owner, initiative executive owner or workstream lead, dependency owner, decision owner |
| Period | `periodId` (a `reporting_period` of the organization) | the window [period start, period end]; KPI statuses of that reporting period, or for a KPI of another frequency its latest reporting period that ends inside the window; value lines inside the window; decisions and dependencies whose due or needed-by date lies inside the window; the as-of date (§3) |
| Phase | `phase` | transformations whose `current_phase` equals it |
| Status | `status` | transformations whose `status` equals it (`draft`, `active`, `on_hold`, `closed`) |

REQ-S13-002's acceptance "filtering by period Q1 changes all tiles to Q1 values" is met because every area's rows and headlines take the window and the as-of date of §3 from the one `periodId`.

### 5. Headlines, drill-down, and zero vs Unknown vs n/a (REQ-S13-003, REQ-PB-062, REQ-S03-009)

**Value shape (`DashboardValue`).** `state` ∈ `value` | `zero` | `unknown` | `stale` | `not_applicable`; `value` (decimal string; non-null only for `value`, `zero` and `stale`); `unit`; `currency`; `reasonKey` (non-null for `unknown`, `stale` and `not_applicable`). `zero` is a known value equal to 0 (for example a validated total of `0.0000` when nothing is validated, ADR-0030 probe M06). `unknown` and `not_applicable` carry `value: null` and are never rendered as 0 or green (M0159, REQ-PB-076).

**Headline (`DashboardHeadline`).** `metric` (closed enum below), `labelKey`, `value`, `period` (`start`, `end`, `asOf`, `label`), `drilldown` (`href` of the drill-down call with the same filters).

**Drill-down (`getDashboardDrilldown`, `GET /api/v1/dashboard-drilldown`).** Parameters: `metric`, the §4 filters, an optional `subjectId` (an outcome KPI, benefit, initiative or decision id when the metric is per record), `cursor`, `limit`. Response: `metric`, `appliedFilters`, `value` (the headline value), `period`, `calculation` (`ruleKey`, `expression` (the formula text when one applies, else null), `inputs[]` (name, `DashboardValue`, record reference), `rounding` (the stored rounding object or null)), `items[]` (the contributing records: `recordType`, `recordId`, `code`, `label`, `href`, `value`, `period`), `evidence[]` (`evidenceId`, `title`, `verificationStatus`, the record it supports), `nextCursor`. Metrics:

| Metric | Contributing records |
|---|---|
| `outcomes.kpi_status` (`subjectId` = outcome KPI) | the accepted actual and its evaluation for the period, the calculation run, the actual's evidence |
| `outcomes.area` | the outcome KPIs with their statuses |
| `value.planned`, `value.forecast`, `value.validated`, `value.submitted` | the benefit value lines of that state in the window, each with its benefit; validated lines with their Finance decision's evidence |
| `value.investment` | the business-case investment lines (ADR-0030 §7 item 6) |
| `value.gap` | planned and validated lines side by side |
| `portfolio.initiatives` | the listed initiatives with their milestone and outcome components |
| `dependencies.open` | the open dependencies |
| `decisions.open`, `decisions.overdue` | the asks |
| `adoption.indicators` | the linked indicator KPIs with their statuses |
| `finance.pending_validation` | the submitted measurements awaiting Finance |

**Invariant (tested by KBE-G):** for a sum metric, the decimal sum of `items[].value` over all pages equals the headline value, per currency; an `unknown` item makes the sum `unknown` unless the metric's rule excludes it (validated totals never include unknown values, ADR-0030). REQ-S13-003's acceptance: the validated benefit total drills to its benefit records (`value.validated`); a KPI with no data shows `unknown`, not 0. REQ-S03-009's acceptance: after an accepted KPI actual, the Outcomes area of the overview shows the new actual once (one evaluation per KPI, scope and period: the latest calculation run, ADR-0027) and `outcomes.kpi_status` lists the source actual.

### 6. Scope enforcement (REQ-S13-001, REQ-S03-001)

- The scope of a response is the set of transformations the caller may read in the organization, computed once per request with the access module's scoped policy (the function the DG1 `listTransformations` uses, ADR-0006), intersected with the filters. Every query of every area, headline, drill-down and per-transformation row is constrained to that set by `transformation_id`; workstream and portfolio rows are reached only through their transformations.
- An explicit `transformationId` or `workstreamId` the caller may not read returns **404** `not-found`, exactly as the DG1 transformation routes do (existence is not disclosed); an `organizationId` in which the caller holds no grant returns 404.
- REQ-S13-001's acceptance (a user scoped to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y record or figure) and REQ-S03-001's (a user scoped to one business unit cannot list the other's transformations) are tested by KBE-G per dashboard and per drill-down metric, with a second transformation in another business unit holding non-zero figures.

### 7. My Work (REQ-S03-008)

`getMyWork` (`GET /api/v1/me/work`; optional `section`, `cursor`, `limit`). Without `section` it returns the first page (at most 50) of every section, each section's total count, and `upcomingDeadlines`; with `section` it pages that section. Only the caller's own items appear: work items with `assignee_user_id` = the caller, drafts with `created_by` = the caller, action items with `owner_user_id` = the caller. Items of transformations the caller can no longer read are left out. Every item carries `href` (the work item's stored `link_path`, or the record's path), `dueDate`, and `overdue` (due date before the business date).

| Section (M0100) | Source |
|---|---|
| Assigned actions | open work items of kinds `meeting_action_due`, `raid_action_due`, `corrective_case_follow_up`, `adoption_intervention_due`, `gate_condition_due`, `phase_step_enabled`, `scale_scope_enabled`, `assessment_invitation`, `approval_changes_requested`; and open or in-progress `action_item` rows owned by the caller that no open work item names as its subject (so an action is listed once) |
| Drafts | `my_work_draft` (`0056`): records in status `draft` of these 18 types, authored by the caller: `agenda_item`, `assessment_form`, `bau_handover`, `benefit_measurement`, `business_case`, `change_request`, `diagnostic_finding`, `initiative`, `journey`, `kpi_actual`, `kpi_definition`, `kpi_version`, `lesson`, `meeting_minutes`, `outcome`, `target_trajectory`, `tom_canvas_cell`, `transition_decision` (probe MW01). `gate_instance`, `governance_matrix` and the T02 trajectory status also use the word "draft" and are left out: none is a draft a person authored. Draft records of DG5 form-builder types do not exist yet (p4-plan §6) |
| Reviews | open work items of kinds `kpi_actual_review`, `finance_validation_review`, `assessment_to_review`, `phase_step_review`, `benefit_overlap_review` |
| Approvals | open work items of kinds `approval_decision`, `approval_escalated`, `gate_decision_due`, `gate_exception_to_decide`, `executive_decision_due`, `executive_decision_escalated`, `bau_handover_to_accept`, `minutes_to_approve` |
| Missing updates | open work items of kinds `kpi_update_due`, `kpi_actual_rejected`, `benefit_monitoring_due`, `performance_review_due`, `control_check_due` |
| Other | open work items of kinds `approval_outcome`, `approval_overdue`, `gate_exception_expired`, and of any kind not named above |
| Upcoming deadlines | every open item of the five non-draft sections whose due date is on or before the business date plus `deadline_horizon_working_days` working days (overdue ones included and flagged), ordered by due date |

The mapping is code in `reporting/my-work.ts` (`MY_WORK_SECTION_BY_KIND`); a KBE-G test reads every `work_item_kind` row of a migrated database and fails when a kind is missing from the map, so a later kind cannot fall silently into "Other" without a decision. These are the 30 kinds present after `0058` (`0028`–`0058`). REQ-S03-008's acceptance: a KPI owner with a due actual sees the `kpi_update_due` item (created by slice A's period-open job with the KPI period-entry `link_path`) under Missing updates; another user's items never appear.

### 8. Executive Overview (REQ-S03-009)

`getExecutiveOverview` is §2's executive dashboard: the six T10 areas over the caller's readable transformations of the organization, with the §4 filters, plus `transformations[]` (`transformationId`, `code`, `name`, the six area statuses). The Portfolio area is M0101's "critical initiatives" and the Dependencies area its "blockers". Permission: `transformation.read` in scope (SP, TL, BO, FIN, TO and AUD hold it by default, with every other business role).

### 9. Workspace header (REQ-S03-011)

`getWorkspaceHeader` (`GET /api/v1/transformations/{transformationId}/summary`), implemented in `reporting/workspace-header.ts` (§11 explains why not in `transformations`). Eight elements (M0114), each with an explicit Unknown:

| Element | Content | Unknown when |
|---|---|---|
| `phase` | `currentPhase`, `mode`, `entryPhase`, the phase labels from `phase_definition` | never (NOT NULL columns) |
| `gateReadiness` | the gate of the current phase: `gateCode`, `status`, `inheritedApproval` (the DG3 annotation), `missingMandatoryCount` and `ready` from the live evaluation through `WorkflowsReadPort` | the port returns null (`state: unknown`) |
| `northStar` | the North Star statement and status | no North Star row |
| `owners` | sponsor and lead (user id and display name) | the column is NULL (each owner separately) |
| `outcomeHealth` | the Outcomes area status (§3) and the count of outcomes per status | per §3 |
| `benefits` | planned and validated totals per currency (§3 Value window = to the business date), benefit count, non-financial count | no active benefit (`state: unknown`) |
| `keyDecisions` | up to 5 open T16 asks by due date, and the overdue count | — (an empty list with count 0 is a fact) |
| `nextActions` | up to 5 of the caller's open work items for this transformation, by due date, and `missingMandatoryCount` of the gate | — |

Contextual navigation (REQ-S03-011 "one click opens the transformation's RAID filtered to it") is a web concern: every link in the workspace (RAID, KPIs, benefits, decisions, gates, traceability, dashboard) is built by FE-G from the route's transformation context, so the user never re-enters the id; the e2e test clicks the header's RAID link and checks the RAID list is filtered to the transformation.

### 10. Authorization (permissions matrix §17)

| Action | Permission (category) | Default roles | Record-level rule |
|---|---|---|---|
| Transformation, workstream dashboards, header, drill-down | `transformation.read` | every business role, AUD | 404 outside scope (§6) |
| Executive Overview, Finance, Adoption dashboards | `transformation.read` (per transformation in scope) | every business role, AUD | the scope is the readable set; an organization without a grant → 404 |
| My Work | authenticated session | every user | own items only (§7) |
| Read the RAG policy | `organization.read` | every role | the caller's organization |
| Set the RAG policy (`putDashboardRagPolicy`, If-Match; `"0"` creates the row) | `dashboard.configure` (configure) | TO, KDS | organization scope |

AUD holds only reads (403 on `putDashboardRagPolicy`). No technical-admin role holds `dashboard.configure`; an ADM-only caller has no `transformation.read` and gets 404 on the transformation dashboards and an empty My Work. The policy write re-authorises at commit, validates, requires `If-Match` (428/409), writes one audit event (probe RP05), and does no remote I/O inside the transaction.

### 11. Module placement

- `reporting/dashboards/**`, `reporting/my-work.ts`, `reporting/executive-overview.ts`, `reporting/workspace-header.ts` (new), `reporting/ports.ts` (new), and the `dashboard_rag_policy` route in `reporting/dashboards/rag-policy.ts`.
- The workspace header is served by `reporting`, not by the BE-A stub `transformations/workspace-header.ts`: the eight elements need `kpi`, `benefits`, `governance`, `tasks` and the gate port, and `transformations` may not import those modules (they depend on it; ADR-0002 rule 3, acyclic). KBE-G deletes the empty stub and its registration line in `transformations/index.ts` (a named wiring line).

### 12. Decimal and Unknown

All money, ratios and KPI values are decimal strings computed with decimal.js and compared as decimals; percentages are fractions (D-091). Totals never add states together (ADR-0030 §7) and never add currencies together: each currency is its own line. Unknown, Stale, Not computable and n/a are shown with their labels in both languages and never as 0 or green (§3 precedence, §5 states).

### 13. Refusal codes and English texts (exact; S-11)

| Status | Code | English `detail` (or error `message`) |
|---|---|---|
| 404 | `not-found` (DG1 standard) | the DG1 text, unchanged |
| 422 | `dashboard.period_not_found` (at `/periodId`) | "The reporting period does not exist in this organization." |
| 422 | `dashboard.owner_not_found` (at `/ownerUserId`) | "The owner is not a user of this organization." |
| 422 | `dashboard.metric_subject_mismatch` (at `/subjectId`) | "This drill-down needs a record of the kind the metric is about." |
| 422 | `dashboard.workstream_archived` | "This workstream is archived; open its transformation's dashboard instead." |
| 422 | `dashboard_rag_policy.threshold_order` (at the amber field) | "The amber threshold cannot be beyond the red threshold." |
| 400 | `validation` (schema) | the shared ADR-0007 validation messages (enum, uuid, range: ratios 0–1, working days 0–250, top count 1–50, horizon 1–250) |

`dashboard_rag_policy.threshold_order` maps the `0056` CHECKs `dashboard_rag_policy_value_gap_order` and `dashboard_rag_policy_milestone_slip_order` (probes RP02, RP07).

## Alternatives considered

1. **Materialized dashboard tables refreshed by a job.** Rejected: a refresh lag would show a figure the canonical rows no longer support, and a second copy of figures is the drift M0150 warns about. If performance needs it later, a cache must keep the drill-down invariant of §5.
2. **A T10 area override table.** Rejected for DG4: the KPI override of slice A already carries reason, evidence, expiry and audit with the calculated status preserved (M0160); a second override at area level would let an area disagree with its own rows.
3. **Separate Executive Overview and executive dashboard read models.** Rejected: M0101's tiles and the T10 areas are the same six subjects; two read models would diverge.
4. **Store the My Work section on `work_item_kind`.** Rejected: migration `0058` (repair range, merged) inserts kinds after `0056` would run, so a NOT NULL column would fail on fresh databases; the code map plus a completeness test gives the same guarantee.
5. **Seed default thresholds as data.** Rejected: no source gives them; NULL + documented default + `policySource` keeps "configured" a person's decision.

## Consequences

- KBE-G adds one `dashboard-facts.ts` file and one export line in each of `kpi`, `benefits`, `portfolio`, `adoption` and `tasks`, the `WorkflowsReadPort` wiring line in `server.ts`, and removes the `transformations/workspace-header.ts` stub (p4-work-split §J+K).
- Finance and Adoption dashboards are cross-transformation reads; their cost grows with the scope. A test with 50 synthetic transformations bounds the query count (no per-row query loops).
- None of the nine rows is complete at this task's end: each needs KBE-G (and FE-G for the screens).

## Verification

- **Database (probe, real output):** T01, T02, RP01–RP07, MW01 (`probe-output.txt`).
- **API (KBE-G tests, p4-work-split §J+K):** all six areas present with both languages' labels; the Outcomes area red/amber for a KPI below trajectory with every linked deliverable accepted, `unknown` for a KPI without an actual (REQ-PB-063); Decisions red with one open ask due yesterday in Asia/Riyadh (business date injected), not counted after its outcome is recorded (REQ-PB-064); period filter Q1 changes every area (REQ-S13-002); every headline's drill-down sums to it and the validated total drills to its benefits (REQ-S13-003); the scope sweep over the six dashboards and every drill-down metric (REQ-S13-001, REQ-S03-001); My Work sections, the `kpi_update_due` item under Missing updates with its link, and no other user's item (REQ-S03-008); the overview after an accepted actual (REQ-S03-009); the header's eight elements with Unknown where data is missing (REQ-S03-011); AUD 403 and If-Match 428/409 on the policy write; the work-item-kind map completeness test.
- **Web (FE-G):** six dashboards, chips, drill-down panel, header with the one-click RAID link (e2e), en/ar.

## Amendment (2026-10-09, T-DG4-ARCH-R1): the version-0 RAG policy and the keys added outside §13

### A1. The RAG policy before it is configured

**The defaulted-record ETag rule (applies to three records only).** A record that exists by default before anyone writes it (one phase step per transformation and step key, ADR-0035 §1; one change-control policy per transformation, ADR-0036; one dashboard RAG policy per organization, ADR-0037 §3) is read with `version: 0` and `ETag: "0"` while no row exists, and the body shows the defaults (Unknown/null where the ADR says so). The first write sends `If-Match: "0"` and inserts the row at version 1; `If-Match: "0"` once a row exists is 409 `urn:mth:problem:version-conflict` with `currentVersion`; `If-Match: "<n ≥ 1>"` while no row exists is 409 without `currentVersion` (its schema starts at 1, and the BE-L behaviour is kept); a missing `If-Match` is 428. The contract declares this with two components used **only** by these six operations: the response header `ETagOrZero` (pattern `^"(0|[1-9][0-9]{0,9})"$`) on `getPhaseStep`, `getChangeControlPolicy` and `getDashboardRagPolicy`, and the parameter `IfMatchOrZero` (same pattern) on `updatePhaseStep`, `putChangeControlPolicy` and `putDashboardRagPolicy`. Every other operation keeps `ETag`/`IfMatch` starting at 1, and "creates are version 1" still holds for every row that is inserted. A 404 was rejected for these reads because the defaults are real, displayable values and the screen needs the ETag to make the first write. The three `contract: false` skips added for this (`workflows/phases.test.ts`, `workflows/change-requests.test.ts`, `reporting/rag-policy.test.ts`, one GET each) are removed by ARCH-R1, so these reads are contract-checked.

### A2. Rule, reason and headline keys and codes added outside §13 (accepted, with their exact English texts)

These keys are rendered by the web client; the server sends only the key (and `ruleParams` where §3 defines them). The rule keys `.none`, `.none_open`, `.nothing_due`, `.no_indicators` and `dashboard.rag.workstream_not_applicable` are already in this ADR and are not repeated.

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `validation.ratio_range` | 400 field | accepted | Enter a decimal ratio from 0 to 1. |
| `dashboard.rag.outcomes.trajectory` | rule key | accepted | Outcomes: the worst outcome-KPI status against its trajectory. |
| `dashboard.rag.value.validated_gap` | rule key | accepted | Value: validated value against the value planned to date. |
| `dashboard.rag.portfolio.milestone_outcome` | rule key | accepted | Portfolio: the worst milestone slip of the top initiatives. |
| `dashboard.rag.dependencies.needed_by_critical_path` | rule key | accepted | Dependencies: open dependencies needed soon or on the critical path. |
| `dashboard.rag.decisions.overdue` | rule key | accepted | Decisions: at least one open decision is past its decision date. |
| `dashboard.rag.decisions.due` | rule key | accepted | Decisions: open decisions are due soon. |
| `dashboard.rag.adoption.curve` | rule key | accepted | People and adoption: the worst adoption indicator against its curve. |
| `dashboard.value.gap_ratio` | rule key | accepted | Value gap = (planned due to date - validated) / planned due to date. |
| `dashboard.value.sum_investment` | rule key | accepted | Investment = the sum of the approved budget lines. |
| `dashboard.finance.pending_validation` | rule key | accepted | Values waiting for Finance validation. |
| `dashboard.value.nothing_planned` | reason key | accepted | Not applicable: nothing is planned to date. |
| `dashboard.value.no_financial_benefit` | reason key | accepted | Not applicable: there is no financial benefit. |
| `dashboard.value.multiple_currencies` | reason key | accepted | Not applicable: the values are in more than one currency and are never converted. |
| `dashboard.portfolio.no_allocated_value` | reason key | accepted | Unknown: no benefit value is allocated to this initiative. |
| `dashboard.portfolio.no_approved_milestone` | reason key | accepted | Unknown: the initiative has no approved milestone date. |
| `dashboard.portfolio.milestone_overdue` | reason key | accepted | Red: a milestone is past its approved date and not achieved. |
| `dashboard.portfolio.milestone_slip` | reason key | accepted | A milestone has slipped past its approved date. |
| `dashboard.kpi.no_period_in_window` | reason key | accepted | Unknown: no reporting period falls in the selected window. |
| `dashboard.headline.value_planned` | label key | accepted | Planned value |
| `dashboard.headline.value_forecast` | label key | accepted | Forecast value |
| `dashboard.headline.value_submitted` | label key | accepted | Submitted value |
| `dashboard.headline.value_validated` | label key | accepted | Validated value |
| `dashboard.headline.value_gap` | label key | accepted | Value gap |
| `dashboard.headline.value_investment` | label key | accepted | Investment |
| `dashboard.headline.outcome_kpis` | label key | accepted | Outcome KPIs |
| `dashboard.headline.top_initiatives` | label key | accepted | Top initiatives |
| `dashboard.headline.open_dependencies` | label key | accepted | Open dependencies |
| `dashboard.headline.open_decisions` | label key | accepted | Open decisions |
| `dashboard.headline.overdue_decisions` | label key | accepted | Overdue decisions |
| `dashboard.headline.adoption_indicators` | label key | accepted | Adoption indicators |

## Amendment (2026-10-10, T-DG4-ARCH-R3): Finance class lines drill down; the value-state sum keys

Source: KBE-G2 handback §5 item 5 (D-111). Nothing above is removed. Where this amendment and §5 differ, this amendment wins.

### K1. A value-class drill-down and three more value-state metrics (decided: add them)

**The gap.** The Finance dashboard shows a line per value class × state × currency (`FinanceValueLine`, ADR-0030 §7). `getDashboardDrilldown` had no value-class parameter, and no metric for the states `measured`, `rejected` and `sustained`. So, as built by KBE-G2, a class line carried a `drilldownHref` only when it was the whole state's figure in its currency (the only financial class there). Every other class line, and every `measured`, `rejected` and `sustained` line, carried `null`.

**Decided: add them, as the §5 drill-down invariant asks.** M0244 says every headline number must drill into its contributing records. A class line is a figure the Finance dashboard shows on its own, and a stated limitation would leave most class lines of a real organization (several classes per currency) without a drill-down. The change is additive: one optional query parameter, three enum values, one new code and three new rule keys.

1. **Parameter `valueClass`** (`FinanceValueClass`: `revenue_uplift`, `margin_uplift`, `cash_saving`, `avoided_cost`, `working_capital_release`, `non_financial_valued`), optional.
   - It applies only to the seven value-state metrics: `value.planned`, `value.forecast`, `value.submitted`, `value.validated`, `value.measured`, `value.rejected`, `value.sustained`.
   - With any other metric it is refused: 422 `dashboard.value_class_not_applicable` at `/valueClass`, through `dashboardRefusal`, with the K2 text.
   - A value outside the enum is a 400 `validation` (the query schema).
2. **New metrics `value.measured`, `value.rejected`, `value.sustained`.**
   - Items are one per benefit, the benefit's lines of that state summed, as the four existing value metrics do.
   - `subjectId` (a benefit) is accepted as for those four.
   - `calculation.ruleKey` is `dashboard.value.sum_<state>`, and `inputs` is one `total_<currency>` per currency, as built for the four.
   - No headline uses them, so `DashboardHeadline.metric` never takes these values.
3. **Which lines a value-state drill-down sums.** The rule is the Finance class line's own, so the invariant holds by construction:
   - **The benefit:** `financeClassOf(b)` is not null, i.e. counted once and monetised. Without `valueClass`, its class must be one of the five financial classes, which is the existing rule of the four value metrics. With `valueClass`, `financeClassOf(b)` must equal it, so `non_financial_valued` selects valued non-financial benefits.
   - **The line:** the state matches, and `lineInWindow(line, state, clock)` holds.
   - **The overlap hold:** `entersLine`, i.e. validated and sustained lines of a benefit with an open overlap warning are held back.
   - The measured, rejected and sustained lines come from the same `benefit_value_line` rows the Finance dashboard reads (`loadExtraStateLines`).
4. **Invariant (tested by the kpi-benefits task).** Take every class line (class *c*, state *s*, currency *k*) of a Finance dashboard response. The drill-down with metric `value.<s>`, `valueClass` *c* and the same filters has items whose decimal sum in currency *k* equals the line's `total`, or both are `unknown`. The fixture has at least two financial classes in one currency, two currencies, a benefit held back by an open overlap, and a valued non-financial benefit.
5. **The Finance dashboard's hrefs.**
   - **Every class line** carries `drilldownHref` = the drill-down of its state's metric with `valueClass` = its class and the response's filters. The "whole state's figure" condition is removed.
   - **The `gross` lines** keep their hrefs (`value.planned`, `value.validated`, no `valueClass`).
   - **The `net` lines keep `null`.** This is a stated limitation, and the reason is that a net line is a derived difference (gross − implementation cost), not a sum of records. Its two inputs each drill: the `gross` line of the same state and currency, and the `value.investment` drill-down with the same filters. The screen shows a net line as "gross − implementation cost" with links to those two, and never as a drillable total.
6. **Unchanged:** every existing metric's response without `valueClass` (the four value metrics keep their financial-class rule), the headlines, the filters, scope enforcement (§6) and the other dashboards.

### K2. Codes and keys (accepted, with their exact English texts)

| Code or key | Kind | Decision | English text (exact) |
|---|---|---|---|
| `dashboard.value_class_not_applicable` (at `/valueClass`) | 422 | **new** (K1) | A value class narrows only a drill-down of benefit values by state. |
| `dashboard.value.sum_planned` | rule key | accepted (KBE-G, as built; not in an ADR table before) | Planned value = the sum of the planned values in the period. |
| `dashboard.value.sum_forecast` | rule key | accepted (KBE-G, as built; not in an ADR table before) | Forecast value = the sum of the forecast values in the period. |
| `dashboard.value.sum_submitted` | rule key | accepted (KBE-G, as built; not in an ADR table before) | Submitted value = the sum of the values submitted for Finance validation in the period. |
| `dashboard.value.sum_validated` | rule key | accepted (KBE-G, as built; not in an ADR table before) | Validated value = the sum of the Finance-validated values in the period. |
| `dashboard.value.sum_measured` | rule key | **new** (K1) | Measured value = the sum of the measured values in the period. |
| `dashboard.value.sum_rejected` | rule key | **new** (K1) | Rejected value = the sum of the values Finance rejected in the period. |
| `dashboard.value.sum_sustained` | rule key | **new** (K1) | Sustained value = the sum of the sustained values in the period. |

The four "as built" keys are produced from a template (`` `dashboard.value.sum_${state}` `` in `reporting/dashboards/drilldown.ts`), which is why no earlier literal scan found them. They were found while specifying K1.
