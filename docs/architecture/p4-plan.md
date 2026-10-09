# P4 architecture plan: slices, seams, architecture tasks and implementer waves

- **Task:** T-DG4-ARCH-00 (solution-architect), 2026-10-09. **Stage:** P4 "Execution value and sustainment" (DG4, BUILDING). **Base:** `015728e` on `claude/mobily-transformation-platform-regate`; DG3 APPROVED (`docs/delivery/gates/DG3.json`).
- **What this is:** a plan only. It contains no ADR bodies, no migrations and no contract. Each architecture task in §4 writes its own ADRs, migrations, contract operations and a section of `docs/architecture/p4-work-split.md`. This plan fixes the numbering, ranges, order and file ownership those tasks start from.
- **Sources:** the 137 rows of `docs/delivery/requirements.csv` with `final_gate` = DG4 (their `acceptance` texts are binding); master prompt §7, §8, §10–§13, the §16 entity list (l.493–506), §20 A03–A11 (l.575–583) and the P4 row (l.616); playbook B0092–B0131 (T10–T16, Transform and Realize).
- **Two gate systems.** G1–G6 are business approvals inside the product. Nothing in P4 reads or writes the engineering records DG0–DG7. Product G6 never implies DG7, and no agent grants a real business, Finance or IT approval; seed and demo approvals are synthetic.
- **Carried rules (D-078 §3, D-088 §2), binding on every P4 task:** shared free-text rules and strict UTF-8; `config.consumes` equal to the request media type; commit-time re-authorisation and no remote I/O inside a transaction; decimal-only arithmetic with Unknown/Stale/Not computable shown honestly (never 0 or green); bilingual text translated at render time; one form-level alert per form and session-bound web actions; harness ports below 32768 and verification with the locale unset and with `C.UTF-8`; every non-zero exit disclosed; ADR claims enumerated and exactly true, never absolute (F-DG3-100); no worktree or install activity while a review or audit run is active (D-082).

## 1. Inventory: the 137 DG4 requirements, one slice each

### 1.1 The slices

The suggested starting point (A–I) is kept with four changes, each for a reason:

- **Governance (C) is split into three slices.** C = decision rights, RACI, approvals and delegation (an access and approval engine); D = forums, meetings and the T16 executive decision log (a meeting and escalation engine); E = RAID, actions and corrective actions (the master prompt's own navigation area "Risks and Actions: integrated RAID, corrective actions and escalations", M0108). Together they hold 33 rows, too many for one ~2 h architecture run.
- **Adoption (F) and BAU/closure (G) are separate slices,** because the status model ("delivery complete / value validation pending / BAU accepted") and the BAU handover are a different engine from the T13 register and its indicators.
- **The scheduler slice (I) is a foundation slice:** the business calendar, time semantics, the scheduled-job kit, work items (tasks) and the in-app inbox. Each starter automation is mapped to the slice that owns its domain rule, because the rule (what to create, how not to duplicate it) is domain logic; the kit is shared.
- **Letters are re-assigned** so that each slice has one letter: A KPI, B Benefits, C Decision rights/approvals, D Forums/T16, E RAID/actions, F Adoption, G Sustainment/closure, H Phases/gates/change control, I Foundation, J Dashboards, K Traceability/modular, L Acceptance and evidence.

| Slice | Domain | API module(s) (ADR-0002) |
|---|---|---|
| A | KPI engine (S07, S16-014) | `kpi` (existing) |
| B | Benefits engine and Finance validation (S08, T14, PB-058, PB-074–076, S16-017) | new `benefits` |
| C | Decision rights (T11), RACI (T12), approvals, delegation, groups (S10, S16-011) | `access`, `workflows`, new `governance` |
| D | Forums, meetings, T16 executive decision log, escalation (S10-005/011/012, S16-019) | `governance`, `workflows` (decision rows) |
| E | RAID (T15), actions, corrective actions, execution tracking (S16-018, S09-007/009) | new `raid`, `portfolio` |
| F | Adoption: T13, indicators, interventions, feedback forms (S11-001/002, S16-020) | new `adoption` |
| G | BAU handover, sustainment, continuous improvement, status model and closure (S11-004…009, S03-002/003) | new `sustainment`, `transformations`, `portfolio` |
| H | Phases, G5/G6, gate exceptions and waivers, change control and impact (S04, S09-010, S07-015) | `workflows` |
| I | Foundation: business calendar, time semantics, scheduled-job kit, work items and inbox (S10-006, S12-005, S15-008, S16-005) | `organization`, new `tasks`, `apps/worker` |
| J | Dashboards and workspaces: T10, six dashboards, My Work, Executive Overview, header (S13, S03-008/009/011) | `reporting` |
| K | Traceability and modular entry (S03-001/005/006, PB-005/010/044) | `reporting`, `portfolio` |
| L | Acceptance tests A03, A04, A05, A08–A11 and the P4 evidence (S20, DLV-036) | `tests/qa/**`, `e2e/**` |

### 1.2 Requirement → slice

| Requirement | Slice | Reason |
|---|---|---|
| REQ-PB-005 | K | Modular entry: missing baseline and outcome links flagged; the G3 refusal itself is DG2's (A03). |
| REQ-PB-008 | C | Transform readiness becomes "not ready" when T11 or charter decision rights are empty; the new data is T11/T12. |
| REQ-PB-009 | G | "Benefits before closure": the closure guard on initiatives and the 'Delivered — value validation pending' state. |
| REQ-PB-010 | K | One source of truth across roadmap, scorecard and benefits register views (no copies). |
| REQ-PB-013 | B | Finance-only validation of benefit logic and realization (403 for BO; validator in audit). |
| REQ-PB-014 | H | The six phases; P4 adds the Transform and Realize phase content on the existing phase model. |
| REQ-PB-015 | H | G1–G6 as approval records; P4 completes the set with G5 and G6. |
| REQ-PB-020 | H | G5 evidence: performance, adoption, risk closure, decision log; approver configurable to BO. |
| REQ-PB-021 | H | G6 evidence: benefits, ownership transfer, controls, CI backlog. |
| REQ-PB-044 | K | Traceability view with orphan report and clickable nodes. |
| REQ-PB-058 | B | One owner per benefit; a shared 10 M SAR benefit counts once in the portfolio total. |
| REQ-PB-060 | D | Five operating-system layers seeded verbatim; meeting series on a configured recurrence. |
| REQ-PB-061 | D | Forum outputs as native meeting records; Value Review publication needs a benefit entry; decisions flow to T16. |
| REQ-PB-062 | J | T10 Executive Dashboard, six areas, en/ar, drill-down. |
| REQ-PB-063 | J | Area-specific T10 RAG logic (KPI RAG comes from A). |
| REQ-PB-064 | J | Decisions area Red when an executive decision is overdue (Asia/Riyadh day boundary). |
| REQ-PB-065 | C | T11 seeded verbatim; a Business scope change routes approval to the Sponsor. |
| REQ-PB-066 | C | T11 SLA types computed: working days, next forum, release plan. |
| REQ-PB-067 | C | T12 RACI seeded verbatim; 'X' rejected, 'A/R' accepted. |
| REQ-PB-068 | D | "Escalate decisions, not status": agenda item without 'Impact of delay' cannot be published. |
| REQ-PB-069 | F | Adoption as an outcome; below trajectory creates exactly one intervention. |
| REQ-PB-070 | F | T13 Stakeholder & Adoption Plan as a native register (7 columns, value lists). |
| REQ-PB-071 | F | Seven leading adoption indicators seeded as KPI templates. |
| REQ-PB-072 | F | Training completion and observed proficiency tracked separately (Unknown without observations). |
| REQ-PB-073 | F | Champion constraints link to a T04 decision and show on it. |
| REQ-PB-074 | B | Six-step benefits lifecycle with step preconditions. |
| REQ-PB-075 | B | T14 Benefits Register, 10 columns; pending value excluded from validated totals. |
| REQ-PB-076 | B | Non-financial benefits: Value n/a, excluded from SAR totals, never counted as zero. |
| REQ-PB-078 | E | RAID and T08 share the canonical dependency record; no second copy. |
| REQ-PB-079 | E | T15 RAID register, 9 columns, Type validated. |
| REQ-PB-080 | E | T15 Probability n/a for Assumption/Issue/Dependency; required for Risk. |
| REQ-PB-081 | D | T16 Executive Decision Log, 9 columns; recorded Outcome closes and leaves the overdue list. |
| REQ-PB-082 | D | Blocker red for N cycles produces exactly one open T16 ask (idempotent job). |
| REQ-PB-083 | G | BAU handover with ownership transfer, controls and cadence; acceptance creates recurring tasks once. |
| REQ-PB-084 | G | CI backlog persists after closure; G6 lists it (G6 criterion itself is H). |
| REQ-PB-085 | E | Corrective action / recovery plan when a KPI or benefit is off track (one case, updated, not duplicated). |
| REQ-DLV-036 | L | The P4 outputs and evidence: A04, A09, A10, A11 executable tests pass on the DG4 candidate. |
| REQ-S03-001 | K | Multiple transformations/BUs/portfolios; BU scoping holds on every new P4 list and view. |
| REQ-S03-002 | G | Performance areas and BAU ownership continue after transformation closure. |
| REQ-S03-003 | G | Separate delivery, adoption, validated value and closure statuses; closure guard. |
| REQ-S03-004 | H | Scale transition before G5 approval returns 422 naming G5. |
| REQ-S03-005 | K | Inherited approvals labelled 'inherited', never Approved; missing links flagged (A03). |
| REQ-S03-006 | K | Many-to-many links with allocation rules and downstream impact listing. |
| REQ-S03-008 | J | My Work: assigned actions, drafts, reviews, approvals, missing updates, deadlines. |
| REQ-S03-009 | J | Executive Overview with the six T10 areas and drill-down. |
| REQ-S03-011 | J | Workspace header with eight elements, Unknown where missing; contextual RAID link. |
| REQ-S04-001 | H | Guided phase steps, evidence, owners, review queue; completion rules enforced for Transform and Realize. |
| REQ-S04-002 | H | Gates tied to immutable evidence snapshots (G5/G6 use the same engine). |
| REQ-S04-007 | H | Transform procedure and G5 with recorded scale scope; scaling outside it blocked. |
| REQ-S04-008 | H | Realize procedure and G6; product G6 changes no DG record. |
| REQ-S04-009 | H | Nine fields per criterion row on every gate submission. |
| REQ-S04-010 | H | Seven gate statuses with enforced transitions (G5/G6 included). |
| REQ-S04-012 | H | Submission blocked on missing evidence unless an authorized exception is recorded in the snapshot. |
| REQ-S04-013 | H | Waivers with reason, scope, approver, expiry and compensating action; expiry re-opens the gap. |
| REQ-S04-014 | H | Material change to approved scope/baseline/target/TOM/cost/benefit logic triggers impact assessment and reapproval. |
| REQ-S07-001 | A | KPI dictionary with the full field list; polarity, unit and aggregation rule required. |
| REQ-S07-002 | A | Higher/lower/band/binary-milestone measure semantics. |
| REQ-S07-003 | A | Actuals by KPI, scope and period, versioned (no duplicate rows). |
| REQ-S07-004 | A | Period vs cumulative; % vs percentage points. |
| REQ-S07-005 | A | Missing values, zero denominator, negative baseline, incomparable periods. |
| REQ-S07-006 | A | Unknown/Stale, never green or zero, no zero contribution to aggregates. |
| REQ-S07-007 | A | RAG from the approved trajectory and versioned thresholds, never from task completion. |
| REQ-S07-008 | A | Seven elements beside RAG, with the rule explanation naming the threshold. |
| REQ-S07-009 | A | Manual RAG override with reason, evidence, expiry, audit; calculated status preserved. |
| REQ-S07-010 | A | Explicit aggregation: flows, stocks, weighted ratios, custom formula; no mixed units. |
| REQ-S07-011 | A | Circular references and invalid units rejected across KPI formulas. |
| REQ-S07-012 | A | Draft/review/accept or direct-accept submission routes. |
| REQ-S07-013 | A | Accept pipeline: one calculation run and one audit event per accepted actual. |
| REQ-S07-014 | B | After an accepted actual, the linked benefit shows a pending amount; validated total unchanged. |
| REQ-S07-015 | H | KPI definition/baseline/target change through a versioned change request with impact preview (generic CR engine; A supplies KPI versions). |
| REQ-S07-017 | A | Four-step KPI update with downstream-changes confirmation. |
| REQ-S08-001 | B | Planned, forecast, measured, submitted, validated, rejected, sustained values kept separate. |
| REQ-S08-002 | B | Delivered capability is an enabler: 'enabled - not yet measured'. |
| REQ-S08-003 | B | Benefit record fields; financial mapping or agreed non-financial KPI required. |
| REQ-S08-004 | B | Safe formula builder (DG3 engine reused unchanged for benefit measurement). |
| REQ-S08-006 | B | Formula versions and calculation lineage for benefit values. |
| REQ-S08-008 | B | Unvalidated comparison basis is provisional and excluded from validated totals. |
| REQ-S08-009 | B | Revenue uplift vs margin, avoided cost vs cash savings on separate lines. |
| REQ-S08-010 | B | No SAR value on CX benefits without an approved valuation method. |
| REQ-S08-011 | B | Gross, cost and net separate; cost counted once across levels. |
| REQ-S08-013 | B | Allocation over 100% rejected; below 100% shows unallocated. |
| REQ-S08-014 | B | Overlap warnings; Finance resolves; excluded from validated totals until resolved. |
| REQ-S08-015 | B | Finance validation content (measurement period required); non-Finance 403. |
| REQ-S08-016 | B | Measure-only submissions excluded from the validated total until approved. |
| REQ-S08-017 | B | Corrections as amendments/reversals; in-place edit of a validated value 409. |
| REQ-S08-018 | B | Base/upside/downside scenarios never mixed into actuals. |
| REQ-S09-007 | E | Budget/actual/forecast in decimal SAR; forecast slip in working days. |
| REQ-S09-009 | E | Critical path from defined scheduling logic; none claimed with missing durations. |
| REQ-S09-010 | H | Material rebaseline through change control; approved date unchanged without approval. |
| REQ-S10-003 | C | ADM-only users get 403 on gate and Finance approval endpoints (all new P4 approval endpoints). |
| REQ-S10-005 | D | Forum recurrence, participants, cut-off and agenda rules configurable; future meetings only regenerated. |
| REQ-S10-006 | I | Asia/Riyadh business calendar with configurable workweek and holidays; no hard-coded holidays. |
| REQ-S10-007 | C | Source RACI copied per transformation; edits never change the seed or other transformations. |
| REQ-S10-008 | C | Roles mapped to named people or governed groups; unmapped role blocks routing visibly. |
| REQ-S10-009 | C | One accountable per RACI deliverable; 'A/R' counts as one. |
| REQ-S10-010 | C | Delegation with effective dates, absence, 'B on behalf of A', no loops. |
| REQ-S10-011 | D | Committee workflow: agenda, briefs, quorum, decisions, immutable minutes, actions in My Work. |
| REQ-S10-012 | D | Executive asks require the seven fields ('why now' etc.). |
| REQ-S10-014 | C | Approval record: assignee, request version, due date, rationale, comments, timestamp. |
| REQ-S10-016 | C | Separation of duties: requester cannot approve own request under the default policy. |
| REQ-S10-017 | C | Stale approval (version moved) returns 409. |
| REQ-S10-018 | C | Approve, reject, request changes, defer (defer needs a date). |
| REQ-S10-019 | C | Timer escalates an overdue approval exactly once and never approves. |
| REQ-S11-001 | F | Stakeholder groups: influence/impact, stance, behaviour, interventions in My Work. |
| REQ-S11-002 | F | Native feedback/assessment forms; proficiency observations count in the indicator. |
| REQ-S11-004 | G | Continuous performance management after delivery and closure; review tasks on time. |
| REQ-S11-005 | G | BAU handover content; acceptance only by the receiving owner. |
| REQ-S11-006 | G | 'Delivery complete - value validation pending' state, never inferred success. |
| REQ-S11-007 | G | Transition decision for long-realization benefits; forecast stays forecast; residual-owner monitoring. |
| REQ-S11-008 | G | Periodic control checks, review tasks, lessons (searchable across transformations), CI items. |
| REQ-S11-009 | G | Reopening a performance area preserves the original handover and closure history. |
| REQ-S12-005 | I | Period opens → one task per KPI owner; worker restart creates no duplicates. |
| REQ-S12-006 | A | Accepted actual → one recalculation and one validation flag. |
| REQ-S12-009 | H | Valid gate submission → exactly one task per required approver referencing the snapshot. |
| REQ-S12-010 | H | Gate approved → next phase/scope tasks created once; conditional approval enables only its scope. |
| REQ-S12-011 | D | Decision SLA expiry escalates once to the next authority with the delay impact. |
| REQ-S12-014 | B | Benefit evidence submitted → exactly one Finance queue item; replay creates none. |
| REQ-S12-016 | E | Adoption or control check fails → one owned recovery action with follow-up date. |
| REQ-S13-001 | J | Six dashboards; scope never leaks another transformation's figures. |
| REQ-S13-002 | J | Dashboard filters: organization, transformation, owner, period, phase, status. |
| REQ-S13-003 | J | Every headline drills to records; zero, Unknown and n/a distinguished. |
| REQ-S15-008 | I | Asia/Riyadh and SAR defaults; observation period, business date and UTC event timestamp kept distinct. |
| REQ-S16-005 | I | Durable worker and scheduler: kill/restart completes exactly once (for every P4 job). |
| REQ-S16-011 | C | Identity entity group incl. Group and Delegation, created and read through the API. |
| REQ-S16-014 | A | KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun, DataQualityFinding. |
| REQ-S16-017 | B | BusinessCase, Scenario, Benefit, BenefitAllocation, BenefitFormulaVersion, BenefitMeasurement, FinanceValidation. |
| REQ-S16-018 | E | Risk, Assumption, Issue, Action, Decision, ChangeRequest, Approval (E holds the group's ERD and integration test; C supplies Approval, H ChangeRequest, D executive Decision). |
| REQ-S16-019 | D | Forum, Meeting, AgendaItem, Attendance, Minutes, MeetingActionLink. |
| REQ-S16-020 | F | StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink. |
| REQ-S16-025 | B | Decimal money and rates (0.1 + 0.2 = 0.30; 100000 × 0.02 × 50 = 100000.00) across P4 money paths. |
| REQ-S20-003 | L | Executable A03 Modular entry. |
| REQ-S20-004 | L | Executable A04 KPI propagation. |
| REQ-S20-005 | L | Executable A05 Calculation correctness. |
| REQ-S20-008 | L | Executable A08 Gate controls (incl. G5/G6). |
| REQ-S20-009 | L | Executable A09 Decision escalation. |
| REQ-S20-010 | L | Executable A10 Benefit integrity. |
| REQ-S20-011 | L | Executable A11 Adoption and sustainment. |

### 1.3 Check table

Counted from §1.2 by `docs/delivery/handbacks/DG4/T-DG4-ARCH-00-evidence/check-inventory.py`, which also checks that the set equals the register's 137 DG4 ids with no duplicate (handback §3).

| Slice | Requirements |
|---|---|
| A KPI engine | 16 |
| B Benefits and Finance validation | 24 |
| C Decision rights, RACI, approvals, delegation | 15 |
| D Forums, meetings, T16, escalation | 10 |
| E RAID, actions, corrective actions, execution tracking | 8 |
| F Adoption | 8 |
| G Sustainment, BAU, CI, status model and closure | 11 |
| H Phases, G5/G6, exceptions, change control | 18 |
| I Foundation: calendar, time, jobs, tasks, inbox | 4 |
| J Dashboards and workspaces | 9 |
| K Traceability and modular entry | 6 |
| L Acceptance tests and P4 evidence | 8 |
| **Total** | **137** |

## 2. Dependencies and order

An arrow `X → Y` means Y needs X's data, contract or service before Y can be finished. Event-coupled pairs (Y consumes X's outbox event) are marked `⇢`; they let X land first without calling Y.

```text
DG1–DG3 (approved)
   │
   I  Foundation: calendar, time semantics, job kit, work items, inbox
   │
   ├──────────────► C  Decision rights, RACI, approvals, delegation, groups
   │                 │
   ├──► A  KPI ──────┼──────► B  Benefits / Finance validation
   │    │            │         │
   │    ├ ⇢ E (kpi.deviation_evaluated → corrective case)
   │    │            │         ├ ⇢ E (benefit.variance_evaluated → corrective case)
   │    │            ▼         │
   │    │      D  Forums, meetings, T16, escalation ◄── E (blockers red for N cycles)
   │    │            │         │
   │    └──► F  Adoption (indicators are KPI templates) ⇢ E (adoption check failed)
   │                 │         │
   │                 ▼         ▼
   │           G  BAU handover, controls, CI, status model, closure ⇢ E (control check failed)
   │                 │
   │                 ▼
   └──────────► H  G5/G6 (needs E risk closure, F adoption, D decision log, G handover/CI, B benefits),
                    gate exceptions/waivers, change control (needs C approvals, A KPI versions, B formulas)
                     │
                     ▼
               K  Traceability, orphan report, modular flags (needs A, B, E links)
                     │
                     ▼
               J  Dashboards, My Work, Executive Overview, header (reads every engine)
                     │
                     ▼
               L  A03, A04, A05, A08, A09, A10, A11 executable tests; DLV-036 evidence
```

- **Critical path:** I → A → B → G → H → J → L. B's Finance-validated totals feed G (closure guard) and H (G6 benefits evidence); J reads all engines; L proves them end to end. The ARCH tasks are therefore ordered I+C, A, B, E, D, F+G, H, J+K (§4), and the implementer waves follow the same order (§5).
- **Off the critical path:** C (needed by D, H and G, but small), E (its corrective-action service consumes events, so A and B never wait for it), F (needed by G and H).
- **No module cycle.** `workflows` reads G5/G6 facts only through the `GateFactsProvider` interface it already defines (`workflows/g4.ts`, wired in `server.ts`, ADR-0021 §7, p3-work-split §9 item 16). The new modules never import `workflows` except `governance` (decision rows, the approval service), and `workflows` never imports them.

## 3. The DG1–DG3 seams P4 extends

"Additive" means existing requests, responses, rows and texts are unchanged; new things are added beside them. "Reopen candidate" means a DG1–DG3-approved behaviour, guard, contract or text would change; the orchestrator decides (D-088 trigger), and the slice ADR must state the documented reason.

| # | Seam (where) | What P4 needs | Classification |
|---|---|---|---|
| 1 | **Gate engine, G5/G6** (`workflows/gates.ts`, `criteria.ts` `EVALUATORS`, `g4.ts` `GateFactsProvider`, `gate_definition` seed `0011`) | G5/G6 criteria rows in `gate_criterion_definition` (new migration; G1–G4 rows untouched), evaluators `g5.*`/`g6.*`, new `GateFactsProvider` members (raid, adoption, governance, sustainment, benefits), an enabling migration (`submission_enabled = true` for G5/G6, the `0026` G4 precedent), phase advance transform → realize on G5 through the existing `next_phase` path. G6's `next_phase` is NULL (see §6 Q4). | **Additive** (the G4 pattern). |
| 2 | **G5 scale scope** (`GateDecisionCreate`) | A `scaleScope` body member accepted only for G5 (the G1 `agreements` precedent), and a scale-transition guard that reads it (S04-007, S03-004). | **Additive** (other gates refuse it with 422, as G1 `agreements` does for non-G1, `gate.agreements_not_applicable`). |
| 3 | **Gate submission exceptions** (S04-012: "with a valid exception it succeeds and the snapshot records the exception"; `gate_submission_criterion_mandatory_complete` CHECK in `0017`; `gate_dispensation` CHECK `gate_code IN ('G1','G2','G3')` in `0020`) | A mandatory criterion may be `incomplete` only when an accepted, unexpired waiver covers it; the snapshot records it. The `0017` CHECK must change from "mandatory ⇒ complete" to "mandatory ⇒ complete or covered", and the `0020` gate list widened. | **Reopen candidate**: a DG2-approved database invariant changes. Requests without a waiver keep the exact DG2 422 (`gate_criteria_incomplete`). |
| 4 | **Gate routing tasks** (S12-009, S12-010; ADR-0015 §2 "Write all the audit events and an outbox event `gate.submitted`") | Approver tasks per submission and next-phase tasks per approval, created by idempotent consumers of `gate.submitted`/`gate.decided` outbox events. | **Additive**, but see §6 R1: as built, the gate engine writes **no** outbox event: the outbox writer `enqueueOutboxEvent` (`jobs/index.ts`) has one caller under `apps/api/src`, `transformations/routes.ts` (`transformation.created`), and no migration inserts into `outbox_event`. ADR-0015 §2's sentence is not true of the code; P4 adds the events, and ADR-0015 needs a correction note. |
| 5 | **Formula engine reuse for KPI formulas** (`packages/shared/src/formula/**`, `@mth/shared/calc`, ADR-0024 §6 guard) | KPI custom formulas and numerator/denominator evaluation reuse `validateFormula`/`evaluateFormula` with variables bound to KPI actuals; KPI-to-KPI cycle detection (S07-011) is a graph check over KPI references **outside** the engine. | **Additive** as long as no file under `packages/shared/src/formula/**` changes. Any engine grammar or source change is a **reopen candidate** (it re-opens the ADR-0024 §6 enumerated guard claims, F-DG3-100). |
| 6 | **`kpi_definition`** (`0014`; `createKpiDefinition` in the DG2 contract) | S07-001 fields (numerator/denominator, calculation, aggregation rule, data-quality rule, reporting period, approval policy, steward already exists); `polarity` gains `binary_milestone` (S07-002); KPIVersion rows. Acceptance: "one without polarity, unit or aggregation rule is rejected". | New nullable columns and the polarity widening are **additive**. Making `aggregationRule` **required on create** is a **reopen candidate** (a DG2 request that is valid today would get 400). See §6 Q1. |
| 7 | **Target trajectory** (`outcome_kpi.trajectory_points jsonb`, `trajectory_status`, `0014`; DG2 trajectory approval) | S16-014 names a `TargetTrajectory` entity; RAG uses the approved trajectory. | **Additive** if a typed `target_trajectory` table is introduced with the approved jsonb points migrated into it and `outcome_kpi`'s DG2 fields kept as they are; replacing the jsonb is a **reopen candidate**. ARCH-02 decides; this plan recommends the additive form. |
| 8 | **Roles and permissions** (`packages/shared/src/permissions.ts`, `0005`, ADR-0020) | `P4_PERMISSIONS` and role defaults (e.g. `kpi_actual.submit`, `kpi_actual.accept`, `rag.override`, `benefit.edit`, `finance.validate` reused, `raid.edit`, `forum.manage`, `meeting.record`, `executive_decision.decide`, `decision_right.configure`, `raci.edit`, `delegation.manage`, `group.manage`, `approval.decide`, `adoption.edit`, `handover.accept`, `change_request.decide`, `calendar.configure`). Technical-admin roles (`ADM_TECH`, `ADM_ACCESS`, `ADM_METHOD`) get no business-approval permission (S10-003). | **Additive** (new permission rows and role grants; no existing grant removed). |
| 9 | **Delegation** (`delegation` table `0001`; one-hop rule in `access/records.ts`; ADR-0021 §6 "Every P3 business approval is decided in person", p3-work-split §9 item 7) | S10-010: delegation management API, effective dates, absence, "B on behalf of A" in audit, loops (A→B and B→A) rejected. | Management API, loop guard and P4 approvals honouring delegation are **additive**. Letting the P3 approvals (selection, funding, overrides, dispensations) accept `onBehalfOfUserId` instead of the DG3 422 `*.on_behalf_not_supported` is a **reopen candidate**. See §6 Q3. |
| 10 | **Groups** (no Group table exists; `0001` has `app_user`, `role`, `scoped_assignment`, `delegation`) | S16-011 and S10-008 need `Group` and group membership, and role-to-person/group mapping per transformation. | **Additive**. |
| 11 | **Canonical `decision`** (`0017`, ADR-0015 §1: kind `executive` reserved for T16, prefix `DEC`) | T16 columns (why now, impact if delayed, required/decision date, executive owner, outcome), escalation fields, champion-constraint links (PB-073) to T04 rows. | **Additive** (ADR-0015 "P4 adds columns and views, not a new table"). |
| 12 | **Canonical `dependency`** (`0017`, T08 in `workflows/t08-dependencies.ts`, ADR-0023 §8) | T15 Dependency entries are the same rows (PB-078): impact H/M/L, probability n/a, mitigation, RAID status. | New columns and a RAID view are **additive**; the T08 routes and the `DEP-nn` code stay. See §6 Q5 on display IDs. |
| 13 | **`action_item`** (`0017`, `/transformations/{id}/actions`) | Actions from minutes, RAID mitigations, corrective/recovery actions with follow-up dates, shown in My Work. | **Additive** (new nullable source columns; existing statuses kept). |
| 14 | **Initiative lifecycle** (`portfolio/transitions.ts`, `initiative.status` incl. `completed`, ADR-0021 §3) | Separate adoption, value-realization and closure statuses (S03-003, PB-009); `completed` stays "delivery complete". | **Additive** (new columns and a closure action; the DG3 transition table is unchanged). |
| 15 | **Transformation closure** (`transformations/routes.ts`: `GOVERNED_TARGET_STATUSES = {closed}`, 422 text "…Closure requires the G6 (Sustain) business approval with validated benefits, which is not available in this release.") | A governed closure action (approved G6 plus validated value or a transition decision, S03-003/S11-006/S11-007). | The PATCH status edit keeps refusing closure (**additive** new action). The English detail text's clause "which is not available in this release" becomes untrue and must change: a **DG1/DG2-approved text change** with a documented reason (orchestrator to confirm). |
| 16 | **Readiness view** (`portfolio/readiness.ts`, ADR-0021) | PB-008: Transform readiness lists missing T11 decision rights and charter decision rights. | **Additive extension, but the output for existing data changes by design** (a transformation "ready" in DG3 can become "not ready" in DG4 until T11 is filled). Documented reason: PB-008 increments P2;P4. |
| 17 | **Business case and T09** (`kpi/business-cases.ts`, `benefit-formulas.ts`, `benefit_calculation` lineage, ADR-0024) | The T14 register links benefits to business-case lines and formula versions; measurements reuse the lineage row shape (incl. `rounding`, `0027`). P3 rules (one class per line, one formula → one active line, set-based roll-up) are kept. | **Additive**. A benefit register that *replaces* the business-case roll-up would be a reopen candidate; none is planned. |
| 18 | **Worker** (`apps/worker/src/queues.ts` `QUEUE_FOR_EVENT`, `handlers.ts`, ADR-0008 §5 "Working-day calendar (later, P3/P4)") | Per-domain queues and handlers, pg-boss schedules in `Asia/Riyadh` (reporting period opening, SLA/approval timers, meeting-series generation, BAU review recurrence, blocker-red cycle evaluation), all through the outbox and `processed_message` ledger. | **Additive** (one registry change by BE-A; per-domain files after it). |
| 19 | **Module registry** (`apps/api/src/modules.ts`, `architecture.test.ts`, `SECTION16_MODULES` "formulas/KPI": `["kpi"]`) | New modules `benefits`, `governance`, `raid`, `adoption`, `sustainment`, `tasks`; `reporting` (a P1 scaffold) gets routes. | **Additive**; the pinned `SECTION16_MODULES` map gains `benefits` under "formulas/KPI" (an orchestrator-merged test pin). |
| 20 | **Contract** (`docs/api/openapi.yaml` 1.2.0-p3, 270 operations) | P4 operations (≈ 300, §4); `info.version` 1.3.0-p4. P1–P3 paths byte-stable except the named extensions in rows 2, 3 and 6. | **Additive** except rows 3 and 6 if chosen. |
| 21 | **Web shell** (`apps/web/src/app/{router.tsx,nav.ts}`, `AreaPages.tsx`, `api/**`) | The navigation areas Governance, Risks and Actions, Benefits and Finance, Change and Adoption, BAU and Improvement, My Work, Executive Overview. | **Additive** (FE-A owns the shell, as in P3). |
| 22 | **Workspace header** (`transformations` "workspace header data") | Eight elements incl. outcome health, benefits, key decisions, next actions (S03-011). | **Additive** (new header fields; Unknown where missing). |

## 4. Architecture tasks

Each task is sized for about 2 hours of architect work, runs alone on the shared contract files (§5.3), and writes: its ADRs; its migrations with the P2 guard pattern (`p2_attach_guards`, version step, audit-required triggers, CHECKed statuses) and a guard probe on a real PostgreSQL; the Kysely types and catalogue pins; its `P4_PERMISSIONS` additions; its OpenAPI operations with `openapi:lint`; the ERD, data-dictionary and permissions-matrix sections; and its `p4-work-split.md` section (owners, seams, pending lists, problem codes and exact English texts). Implementers of a slice start only after its ARCH task is merged.

**Migration numbering.** Each task owns a contiguous range. The architect writes from the low end; the numbers left in a range are for that slice's implementers (enabling or follow-up migrations, the `0025`/`0026` precedent) in the order its work-split section names. `0058`–`0069` are held by the orchestrator for repairs. **Advisory-lock classes** (ADR-0016 §6 registry, `platform/advisory-locks.ts`): each task owns a disjoint block; a class it does not need stays unallocated and is never reused by another block.

| Task | Slices | ADRs | Migrations | OpenAPI area (est. operations) | Lock classes (block) | Requirements covered |
|---|---|---|---|---|---|---|
| **T-DG4-ARCH-01** | I + C | ADR-0025 business calendar, time semantics (observation period / business date / event timestamp), scheduled-job kit, work items and in-app inbox; ADR-0026 groups and role mapping, delegation management and loop guard, the P4 Approval record (outcomes, SoD, stale 409, timer escalation), T11 decision rights and SLA types, T12 RACI per transformation | 0028–0032 | `calendar`, `tasks` (My Work items, inbox), `groups`, `role-mappings`, `delegations`, `approvals`, `decision-rights`, `raci` (≈ 42) | 730224 delegation graph (per organization); 730225 RACI deliverable (one accountable); 730226 approval subject (per subject record); 730227 reserved | I: S10-006, S12-005, S15-008, S16-005. C: PB-008, PB-065, PB-066, PB-067, S10-003, S10-007, S10-008, S10-009, S10-010, S10-014, S10-016, S10-017, S10-018, S10-019, S16-011 |
| **T-DG4-ARCH-02** | A | ADR-0027 KPI data model and pipeline (dictionary v2, versions, target trajectories, actual versions, submission routes, accept pipeline, calculation runs, data-quality findings, overrides, `kpi.deviation_evaluated` event); ADR-0028 KPI calculation semantics (measure types, period/cumulative, % vs pp, aggregation, RAG with versioned thresholds, Unknown/Stale/Not computable, KPI formulas on the DG3 engine) | 0033–0036 | `kpi-definitions` (extended), `kpi-versions`, `target-trajectories`, `reporting-periods`, `kpi-actuals` (+ submit, accept, reject), `calculation-runs`, `kpi-status` (RAG panel), `rag-overrides`, `data-quality-findings` (≈ 35) | 730228 KPI formula graph (per transformation); 730229 KPI actual slot (KPI, scope, period); 730230 reporting period (per organization, frequency, period); 730231 reserved | S07-001…013, S07-017, S12-006, S16-014 |
| **T-DG4-ARCH-03** | B | ADR-0029 benefit register T14, lifecycle steps and preconditions, shared-benefit groups, allocations, overlap warnings, scenarios; ADR-0030 measurements, Finance validation queue and content, amendments/reversals, value lines (planned/forecast/measured/submitted/validated/rejected/sustained; revenue vs margin; avoided vs cash; non-financial n/a), totals counted once | 0037–0040 | `benefits` (+ lifecycle actions), `benefit-allocations`, `benefit-groups`, `benefit-overlaps` (+ resolve), `benefit-scenarios`, `benefit-measurements` (+ submit), `finance-validations` (queue, decide, amend, reverse), `benefit-totals` (≈ 38) | 730232 benefit allocation set (per benefit); 730233 Finance validation queue (per measurement); 730234 overlap resolution (per transformation, driver); 730235 reserved | PB-013, PB-058, PB-074, PB-075, PB-076, S07-014, S08-001, S08-002, S08-003, S08-004, S08-006, S08-008, S08-009, S08-010, S08-011, S08-013, S08-014, S08-015, S08-016, S08-017, S08-018, S12-014, S16-017, S16-025 |
| **T-DG4-ARCH-04** | E | ADR-0031 RAID T15 on canonical records (risk, assumption, issue as typed rows; dependency = the T08 row), actions, corrective-action cases with the severity and persistence rule (consumers of `kpi.deviation_evaluated`, `benefit.variance_evaluated`, `adoption.check_failed`, `control_check.failed`), budget/actual/forecast and working-day slip, critical path from defined scheduling logic; the S16-018 group ERD | 0041–0043 | `raid` (list/create/update/close per type), `actions` (extended), `corrective-actions` (+ update, close), `budget-lines`, `schedule-network` (critical path) (≈ 30) | 730236 corrective case (per source metric/benefit/check); 730237 reserved | PB-078, PB-079, PB-080, PB-085, S09-007, S09-009, S12-016, S16-018 |
| **T-DG4-ARCH-05** | D | ADR-0032 forums (five layers seeded verbatim), meeting series and recurrence (future-only regeneration), meetings, agenda items with the executive-ask fields, attendance and quorum, minutes (immutable once published), meeting action links, T16 executive decision log, SLA escalation (`S12-011`), blocker-red cycle escalation (`PB-082`) | 0044–0046 | `forums`, `meeting-series`, `meetings`, `agenda-items` (+ publish), `attendance`, `minutes` (+ approve, publish), `executive-decisions` (T16; + record outcome), `escalations` (≈ 36) | 730238 meeting series generation (per series); 730239 executive ask (per blocker source); 730240 decision escalation (per decision); 730241 reserved | PB-060, PB-061, PB-068, PB-081, PB-082, S10-005, S10-011, S10-012, S12-011, S16-019 |
| **T-DG4-ARCH-06** | F + G | ADR-0033 adoption: T13 register, stakeholder groups, interventions, feedback/assessment forms (validated versioned form JSON), training vs proficiency records, seven indicator KPI templates, below-trajectory → one intervention, champion-constraint links; ADR-0034 sustainment: delivery/adoption/value/closure statuses, transition decision, governed closure, performance areas beyond closure, BAU handover content and receiving-owner acceptance, controls and control checks, recurring review tasks, CI backlog, lessons (cross-transformation search), reopening with preserved history | 0047–0050 | `stakeholder-groups`, `adoption-plan` (T13), `adoption-interventions`, `assessment-forms`, `assessment-records`, `adoption-indicators`; `performance-areas` (+ reopen), `bau-handovers` (+ submit, accept), `controls`, `control-checks`, `improvement-items`, `lessons`, `transition-decisions`, closure actions (≈ 48) | 730242 adoption intervention (per indicator, scope, period); 730243 BAU handover (per performance area); 730244 closure (per transformation/initiative); 730245 reserved | F: PB-069, PB-070, PB-071, PB-072, PB-073, S11-001, S11-002, S16-020. G: PB-009, PB-083, PB-084, S03-002, S03-003, S11-004, S11-005, S11-006, S11-007, S11-008, S11-009 |
| **T-DG4-ARCH-07** | H | ADR-0035 G5 and G6 (criteria, evaluators, facts, scale scope, enabling, phase advance), gate exceptions and waivers (reason, scope, approver, expiry, compensating action; snapshot), gate routing tasks and the outbox events (§3 rows 1–4); ADR-0036 change control: change requests, impact assessment and preview (outcomes, benefits, gates, reports, formulas), KPI and rebaseline change requests, T11 routing, original approvals and snapshots preserved | 0051–0054 | gates (G5/G6 via existing paths; `GateDecisionCreate.scaleScope`), `gate-exceptions` (+ decision, revoke), `change-requests` (+ submit, decide), `impact-assessments`, `phase-steps` (Transform, Realize) (≈ 24) | 730246 change request (per subject record); 730247 gate exception (per gate instance); 730248 reserved | PB-014, PB-015, PB-020, PB-021, S03-004, S04-001, S04-002, S04-007, S04-008, S04-009, S04-010, S04-012, S04-013, S04-014, S07-015, S09-010, S12-009, S12-010 |
| **T-DG4-ARCH-08** | J + K | ADR-0037 dashboard read models: the six T10 areas and their area-specific RAG, six dashboards, filters, drill-down to records/period/calculation/evidence, zero vs Unknown vs n/a, scope enforcement, My Work aggregation, Executive Overview, workspace header; ADR-0038 traceability view and orphan report, link allocation rules and downstream impact, modular-entry missing-link flags, inherited labels | 0055–0057 | `dashboards/{executive,transformation,workstream,finance,adoption,personal}`, `dashboard-drilldown`, `my-work`, `executive-overview`, `workspace-header` (extended), `traceability`, `orphan-report`, `impact` (≈ 20) | 730249 reserved (read models take no lock unless the ADR shows a need) | J: PB-062, PB-063, PB-064, S03-008, S03-009, S03-011, S13-001, S13-002, S13-003. K: PB-005, PB-010, PB-044, S03-001, S03-005, S03-006 |

Slice L (8 rows) has no architecture task: its tests are written by qa-verifier (§5.2) from the acceptance texts and the ADRs above. Estimated P4 total ≈ 273 operations (contract ≈ 543).

**ADR numbers** run ADR-0025…ADR-0038 in the order above. A task that needs only one ADR leaves its second number unused rather than shifting later numbers.

## 5. Implementer tasks and waves

### 5.1 Tasks and file ownership

Each task is sized at 60–75 minutes. Paths are relative to `apps/api/src/modules/` unless they start with `apps/`, `packages/` or `tests/`. Every task also owns its tests, its `apps/api/test/support/p4-pending-<task>.ts` and its `apps/api/test/integration/contract/p4-exercises-<task>.ts` (the P3 seam pattern, p3-work-split §5). The exact per-file lists are written by the slice's ARCH task into `p4-work-split.md`; the split below is the boundary they must respect.

| Task | Role | Slice | Owns (boundary) | Needs merged first |
|---|---|---|---|---|
| **BE-A** | backend-workflow | I | `modules.ts`, `server.ts`, `architecture.test.ts`/`.testkit.ts` (all P4 modules registered; every new route file named in this table created as a stub with its registration line), `tasks/**` (work items, inbox), `organization/calendar.ts`, `packages/shared/src/time/**`, `apps/worker/src/{queues.ts,handlers.ts,schedules/**}` (split into per-domain stub files `apps/worker/src/{queues,handlers}/<domain>.ts`), `platform/db-errors.ts` P4 mappings, `contract.test.ts`, test harness files | ARCH-01 |
| **BE-B** | backend-workflow | C | `access/groups.ts`, `access/role-mappings.ts`, `access/delegations.ts` (+ loop guard), `workflows/approvals.ts`, approval timer handler `apps/worker/src/handlers/approvals.ts` | BE-A |
| **BE-C** | backend-workflow | C | `governance/decision-rights.ts` (T11, SLA types), `governance/raci.ts` (T12), the PB-008 lines in `portfolio/readiness.ts` | BE-A |
| **KBE-A** | kpi-benefits | A | `packages/shared/src/kpi/**` (measures, period/cumulative, % vs pp, aggregation, RAG, Unknown/Stale/Not computable; property tests), its export lines in the `@mth/shared/calc` barrel | ARCH-02 |
| **KBE-B** | kpi-benefits | A | `kpi/kpi-definitions.ts` (P4 fields only), `kpi/kpi-versions.ts`, `kpi/trajectories.ts`, `kpi/data-quality.ts`, `kpi/kpi-formulas.ts` (graph and cycle check; engine untouched), `kpi/routes.ts` + `kpi/index.ts` registration lines (first) | KBE-A |
| **KBE-C** | kpi-benefits | A, I | `kpi/actuals.ts`, `kpi/reporting-periods.ts`, `kpi/accept-pipeline.ts`, `kpi/calculation-runs.ts`, `kpi/rag-overrides.ts`, `kpi/kpi-status.ts`, `apps/worker/src/handlers/kpi.ts` (S12-006 recalculation, S12-005 period-open tasks), `kpi/routes.ts` + `kpi/index.ts` registration lines (after KBE-B) | KBE-B |
| **KBE-D** | kpi-benefits | B | `benefits/register.ts`, `benefits/lifecycle.ts`, `benefits/allocations.ts`, `benefits/groups.ts`, `benefits/overlaps.ts`, `benefits/scenarios.ts`, `benefits/routes.ts` + `index.ts` (first) | ARCH-03, BE-A |
| **KBE-E** | kpi-benefits | B | `benefits/measurements.ts`, `benefits/finance-validation.ts`, `benefits/corrections.ts`, `benefits/totals.ts`, `apps/worker/src/handlers/benefits.ts` (S12-014 queue, S07-014 pending on accepted actual), `benefits/routes.ts` + `index.ts` lines (after KBE-D) | KBE-C, KBE-D |
| **BE-D** | backend-workflow | E | `raid/**` (register, actions extension, corrective cases), `apps/worker/src/handlers/raid.ts` (deviation, variance, adoption-check and control-check consumers), the RAID columns in `workflows/t08-dependencies.ts` projections (read side only) | ARCH-04, BE-A |
| **BE-E** | backend-workflow | E | `portfolio/budget.ts`, `portfolio/schedule-network.ts`, `packages/shared/src/schedule/critical-path.ts` (pure, tested on a fixture network) | ARCH-04 |
| **BE-F** | backend-workflow | D | `governance/forums.ts`, `governance/meeting-series.ts`, `governance/meetings.ts`, `governance/agenda.ts`, `governance/minutes.ts`, `apps/worker/src/handlers/meetings.ts` (series generation) | ARCH-05, BE-C |
| **BE-G** | backend-workflow | D | `governance/executive-decisions.ts` (T16 on `decision` kind `executive`), `governance/escalations.ts`, `apps/worker/src/handlers/escalations.ts` (S12-011, PB-082) | BE-F, BE-D |
| **BE-H** | backend-workflow | F | `adoption/**` except `adoption/indicators.ts` (T13, stakeholder groups, interventions, assessment forms and records, champion links) | ARCH-06 |
| **KBE-F** | kpi-benefits | F | `adoption/indicators.ts` (seven KPI templates, training vs proficiency, below trajectory → one intervention through BE-H's service), `apps/worker/src/handlers/adoption.ts` | BE-H, KBE-C |
| **BE-I** | backend-workflow | G | `sustainment/performance-areas.ts`, `sustainment/handovers.ts`, `sustainment/controls.ts`, `sustainment/improvement.ts`, `sustainment/lessons.ts`, `apps/worker/src/handlers/sustainment.ts` (recurring BAU reviews, control checks) | ARCH-06, BE-D |
| **BE-J** | backend-workflow | G | `sustainment/status-model.ts`, `sustainment/transition-decisions.ts`, `sustainment/closure.ts`, the closure lines in `portfolio/transitions.ts` and `transformations/routes.ts` (§3 rows 14–15) | BE-I, KBE-E |
| **BE-K** | backend-workflow | H | `workflows/g5.ts`, `workflows/g6.ts`, `workflows/criteria.ts` (registration), `workflows/gate-exceptions.ts`, the outbox and exception lines in `workflows/gates.ts`, `apps/worker/src/handlers/gates.ts` (S12-009, S12-010), the G5/G6 enabling migration, the `server.ts` `GateFactsProvider` wiring lines | ARCH-07, BE-D, BE-G, KBE-F, BE-I |
| **BE-L** | backend-workflow | H | `workflows/change-requests.ts`, `workflows/impact.ts`, `workflows/phase-steps.ts` | ARCH-07, BE-B, KBE-B |
| **BE-M** | backend-workflow | K | `reporting/traceability.ts`, `reporting/orphans.ts`, `reporting/modular.ts`, the link-allocation lines in `portfolio/links.ts` | ARCH-08 |
| **KBE-G** | kpi-benefits | J | `reporting/dashboards/**` (T10 areas, RAG per area, six dashboards, filters, drill-down), `reporting/my-work.ts`, `reporting/executive-overview.ts`, `transformations/workspace-header.ts` (a stub file and its registration line created by BE-A, so KBE-G and BE-J never edit the same file) | ARCH-08, BE-J, BE-K |
| **FE-A** | frontend-ux | I, C | `apps/web/src/app/{router.tsx,nav.ts}`, `apps/web/src/api/**` (all P4 routes, nav entries and query keys up front), `pages/{calendar,groups,delegations,approvals,decision-rights,raci,my-work}/**`, `i18n/{en,ar}/{nav,problems}.json` P4 blocks, and their namespaces | BE-A, BE-B, BE-C |
| **FE-B** | frontend-ux | A | `pages/kpi/**` (dictionary, versions, trajectory, four-step update, review queue, RAG panel with seven elements, overrides, data quality) | FE-A, KBE-C |
| **FE-C** | frontend-ux | B | `pages/benefits/**`, `pages/finance-validation/**` | FE-A, KBE-E |
| **FE-D** | frontend-ux | E, D | `pages/raid/**`, `pages/actions/**`, `pages/forums/**`, `pages/meetings/**`, `pages/executive-decisions/**` | FE-A, BE-D, BE-F, BE-G |
| **FE-E** | frontend-ux | F, G | `pages/adoption/**`, `pages/bau/**`, `pages/improvement/**`, `pages/lessons/**` | FE-A, KBE-F, BE-I |
| **FE-F** | frontend-ux | H, G | G5/G6 and exception views in `pages/gates/**` (P4 keys in `gates.json`), `pages/change-requests/**`, `pages/closure/**` | FE-A, BE-J, BE-K, BE-L |
| **FE-G** | frontend-ux | J, K | `pages/dashboards/**`, `pages/executive-overview/**`, workspace header component, `pages/traceability/**` | FE-A, KBE-G, BE-M |
| **QA-A** | qa-verifier | L | `tests/qa/**` and `e2e/**` files for A04, A05, A10 | KBE-E |
| **QA-B** | qa-verifier | L | files for A08 (incl. G5/G6), A09 | BE-K, BE-G |
| **QA-C** | qa-verifier | L | files for A11, A03 and the DLV-036 evidence run | BE-J, KBE-F, BE-M |

"After X" on a shared registration file (`kpi/routes.ts`, `benefits/routes.ts`) means the two edits are sequential, never concurrent (the KBE-B/KBE-C precedent, p3-work-split §6).

### 5.2 Waves (at most 4 concurrent runs, D-004; an ARCH run counts)

| Wave | Runs | Why this grouping |
|---|---|---|
| W1 | ARCH-01 | Foundation contract, calendar, tasks and approvals first; alone, because every later task builds on its registry and contract. |
| W2 | ARCH-02, BE-A | BE-A's first change (module registry, stubs, worker split, harness) must merge before any other implementer integrates. |
| W3 | ARCH-03, BE-B, BE-C, KBE-A | C completes; KBE-A starts the KPI pure functions. |
| W4 | ARCH-04, KBE-B, KBE-D, FE-A | KPI dictionary/versions and the benefit register in parallel (different modules); FE-A builds the shell for every P4 area. |
| W5 | ARCH-05, KBE-C, BE-D, BE-E | Accept pipeline; RAID and corrective cases; budget and critical path. |
| W6 | ARCH-06, KBE-E, BE-F, FE-B | Measurements and Finance validation; forums and meetings; KPI screens. |
| W7 | ARCH-07, BE-G, BE-H, FE-C | T16 and escalation; adoption register; benefits screens. |
| W8 | ARCH-08, KBE-F, BE-I, FE-D | Indicators; BAU, controls and CI; RAID and governance screens. |
| W9 | BE-J, BE-K, BE-L, FE-E | Status model and closure; G5/G6 and exceptions; change control; adoption and BAU screens. |
| W10 | BE-M, KBE-G, QA-A, QA-B | Traceability; dashboards; acceptance tests A04/A05/A10 and A08/A09. |
| W11 | FE-F, FE-G, QA-C, analyst register update (AN-P4) | Gates, CR and closure screens; dashboards; A11, A03 and DLV-036; the register updated before the freeze (the DG2 F-DG2-202 lesson, D-079 §4). |

Then the orchestrator's freeze verification (the P3 sequence, p3-work-split §6 item 6, with the `p4-pending` lists empty). The critical path through the waves is ARCH-01 → BE-A → KBE-A → KBE-B → KBE-C → KBE-E → BE-J → KBE-G → FE-G. If a run is interrupted at its time bound, it is salvaged and split (D-059/D-070); the wave order does not change.

### 5.3 Shared files that need orchestrator merges

| File(s) | Rule |
|---|---|
| `docs/api/openapi.yaml`, `docs/architecture/{erd.md,data-dictionary.md,p4-work-split.md}`, `docs/analysis/permissions-matrix.md` | Written only by ARCH tasks, one at a time (sequential waves). An implementer's contract need goes in its handback. |
| `packages/shared/src/permissions.ts` (`P4_PERMISSIONS`, role defaults), `packages/db/src/schema.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/catalogue.test.ts` | ARCH tasks append their blocks; an implementer migration (inside its slice's range) appends its own schema/catalogue lines. |
| `packages/shared/src/calc.ts` (`@mth/shared/calc` barrel) | KBE-A adds the `kpi/**` export lines; BE-E adds the `schedule/**` line after KBE-A merges. |
| `packages/shared/package.json` `exports` (new `@mth/shared/time` entry) and the API module allow-list | Orchestrator merge on BE-A's request (the D-079 `@mth/shared/calc` precedent). |
| `apps/api/src/modules.ts`, `server.ts`, `architecture.test.ts` (incl. the `SECTION16_MODULES` pin) | BE-A creates every P4 module and stub up front; later edits are only the named wiring lines (BE-K `GateFactsProvider`). |
| `apps/api/test/integration/contract/contract.test.ts` pinned counts (media-type triple, rate-limit floor) | Orchestrator, reconciled from the handbacks (the D-079 precedent). |
| `apps/api/test/support/p4-pending.ts` (aggregate) | Frozen after ARCH-08; each task edits only its own `p4-pending-<task>.ts`. |
| `apps/worker/src/{queues,handlers}/index.ts` registries | BE-A creates one import line per domain; each task owns only its domain file. |
| `apps/web/src/app/{router.tsx,nav.ts}`, `apps/web/src/api/**`, `i18n/{en,ar}/{nav,problems}.json` | FE-A adds all P4 entries up front; other FE tasks request missing keys in their handback, and the orchestrator merges them append-only. |
| `docs/delivery/requirements.csv` | Analyst only (AN-P4). |

## 6. Risks and open questions

### Open questions for the orchestrator or the user

- **Q1. Is the KPI aggregation rule required on create?** REQ-S07-001 acceptance: "a KPI definition persists all listed fields; one without polarity, unit or aggregation rule is rejected". The DG2-approved `createKpiDefinition` does not take an aggregation rule. Options: (a) require it on create (reopen candidate, §3 row 6); (b) require it on activation (`…/activate`) and on every P4 use (actual entry, aggregation), leaving DG2 create unchanged. **Recommendation:** (b), with the acceptance text tested at activation. This needs the orchestrator's reading of "rejected".
- **Q2. Gate-submission exceptions change a DG2 invariant** (§3 row 3). REQ-S04-012 acceptance: "with a valid exception it succeeds and the snapshot records the exception". The `0017` CHECK `gate_submission_criterion_mandatory_complete` forbids exactly that. **Recommendation:** accept the reopen, scoped to "complete, or covered by an accepted unexpired waiver recorded in the snapshot", with every DG2 refusal unchanged when there is no waiver.
- **Q3. Delegation for P3 approvals.** REQ-S10-010: "an approval by B shows 'B on behalf of A' in audit". DG3 decided "Every P3 business approval is decided in person… Delegation for the P3 approvals arrives with REQ-S10-010 (P4)" (p3-work-split §9 item 7). **Recommendation:** P4 applies delegation to the new P4 approvals and keeps the existing ADR-0015 one-hop paths; whether selection, funding, override and dispensation decisions start accepting `onBehalfOfUserId` is the orchestrator's call (reopen candidate, §3 row 9).
- **Q4. What does G6 approval do?** `gate_definition` G6 has `next_phase` NULL. The DG1 text says "Closure requires the G6 (Sustain) business approval with validated benefits"; REQ-S03-003 says "the API rejects a closure request while validated value is pending unless a transition decision exists". **Recommendation:** G6 approval does not close the transformation by itself. Closure is a separate governed action that needs an approved G6 and either validated value or a documented transition decision (S11-007). Performance areas continue after it (S03-002).
- **Q5. RAID display IDs.** B0128 shows `R01`, `A01`, `I01`, `D01`; T08 dependencies already carry `DEP-nn` (DG3) and T04 decisions `D-nn` (DG2). REQ-PB-078 requires one canonical dependency row. **Recommendation:** Risk/Assumption/Issue take `R-nn`/`A-nn`/`I-nn` from `record_code_counter`; a RAID Dependency entry shows its existing `DEP-nn` code. Renumbering dependencies to `D01` would change DG3 codes and collide visually with T04's `D-nn`.
- **Q6. The SLA types "Next SteerCo / urgent route" and "Per release plan"** (B0099). REQ-PB-066 acceptance tests only the working-day type. **Recommendation:** "Next SteerCo" = the date of the next scheduled Executive SteerCo meeting of the transformation's forum series (Unknown when none is scheduled, never a guessed date); "urgent route" = a configured number of working days, recorded with a reason; "Per release plan" = the linked milestone's approved date (Unknown when none).
- **Q7. "Next configured authority"** (REQ-S12-011, M0231). The sources name no escalation chain. **Recommendation:** each T11 decision-right row carries an ordered escalation chain (role codes, resolved through the role mapping of S10-008); the default chain is the T11 Approve role → SP. An unmapped next authority is a visible routing error (S10-008), never a silent skip.
- **Q8. Meeting cut-off agenda generation.** REQ-PB-060's notes cite M0235 ("a draft agenda at the cut-off"), but its acceptance requires only seeded layers and recurrence, and the starter automation itself is REQ-S12-015 with final gate DG5. **Recommendation:** DG4 builds cut-off dates as configuration (S10-005) and no automatic agenda generation; DG5 adds it.
- **Q9. "Enter or import actual"** (REQ-S07-017). Controlled imports are a P6 output (master prompt P6 row: "Controlled imports, connector contracts/test adapters"). **Recommendation:** DG4 delivers single-actual entry with evidence attachment; bulk/file import is P6.
- **Q10. One Approval entity vs the existing typed approvals** (REQ-S16-018 lists `Approval`). DG2/DG3 approvals live in `gate_decision`, `funding_decision`, dispensation, weight-set and override decisions. **Recommendation:** P4 adds a canonical `approval` table for the new P4 approval types (change requests, T11-routed decisions, handover acceptance where policy needs it) and a read-only union view for My Work and the S16-018 test; existing approval tables are not migrated (that would be a reopen).

### Risks

- **R1. ADR-0015 over-claims the outbox (doc defect in a DG2-approved ADR).** ADR-0015 §2 says submission writes "an outbox event `gate.submitted`" and decision "an outbox event `gate.decided`". As built, `enqueueOutboxEvent` (`jobs/index.ts`) has exactly one caller under `apps/api/src`, `transformations/routes.ts` (`eventType: "transformation.created"`); `workflows/gates.ts` contains no outbox write, and no migration inserts into `outbox_event` (checked with `grep` on `015728e`). P4 needs these events (S12-009, S12-010). Because none were ever written, there is no backlog to replay. ARCH-07 adds the events and a correction note to ADR-0015 (wording only; the orchestrator decides whether that note needs a DG2 record). This is the F-DG3-100 lesson applied to an older ADR.
- **R2. Performance areas need an entity whose group closes at DG5.** REQ-S03-002 (DG4) needs performance areas that outlive a transformation, but `PerformanceArea` is in REQ-S16-012 (final gate DG5). P4 builds the table as an increment. `kpi_definition.transformation_id` is NOT NULL, so ongoing KPIs stay linked to the original transformation; ARCH-06 must check whether any DG2/DG3 guard refuses writes once a transformation is `closed` and design "closed transformation, KPI actuals still accepted" explicitly.
- **R3. Sustainment entities whose group closes at DG5.** BAU handover, Control, ControlCheck, ImprovementItem and Lesson (REQ-S16-021, final gate DG5) are needed by DG4 rows PB-083, PB-084, S11-005 and S11-008. P4 builds them; HealthAssessment (the 25-question check, P5) is not built.
- **R4. Acceptance texts that cite later-stage A-tests.** Several DG4 rows cite A07 (DG5: S04-014, S07-015, S08-017, S09-010, S10-007, S11-009), A06 (DG5: S10-005, S10-007), A12/A13 (DG6) or A14/A17/A20/A23. DG4 must satisfy each row's own acceptance text, not the whole later A-test. Reviewers should be told this in the review assignments.
- **R5. Starter automations whose rule-builder configurability is DG5.** The notes of REQ-S12-009/010/011/014/016 say "Administrator configurability of this starter automation in the rule builder is verified under REQ-S12-001/REQ-S12-002 at DG5". DG4 builds them as code-defined handlers with configuration values (thresholds, N cycles, cadences) in data, not as rule-builder rules.
- **R6. Sequential or parallel approval rules are DG5** (REQ-S10-015). DG4 approvals are single-step; "each required approver receives exactly one task" (S12-009) resolves to the one configured gate approver (ADR-0015 §2).
- **R7. Size.** 8 ARCH runs and 30 implementer runs (DG3: 4 and 23). ARCH-06 (F + G, 19 rows, ≈ 48 operations) is the largest; if it reaches the time bound, it splits into ARCH-06a (F) and ARCH-06b (G) with the same ADR numbers (0033, 0034), migration range and lock block.
- **R8. Fixed DG3 lesson surfaces in new code.** Every new route needs the free-text, UTF-8, `config.consumes`, commit-time re-authorisation and AUD-403 tests; every new money/rate field is a decimal string; every Unknown is labelled. The ARCH work-split sections repeat these as numbered shared rules (p3-work-split §2 pattern).

### Rows that may belong to a later stage

- **REQ-S12-005** (final DG4) is fine for KPI owners, but "in-app reminders" depend on the Notification entity of REQ-S16-022 (final DG6). P4 builds an in-app inbox only; email/messaging adapters are P6 (M0241, §12 "Optional email or enterprise messaging channels are adapters").
- **REQ-S03-008** (My Work, final DG4) lists "drafts, reviews, approvals". Drafts of DG5 form-builder records do not exist yet; DG4's My Work lists drafts of the record types that exist in P1–P4.
- No DG4 row was found that cannot be built in P4. The questions above are about interpretation, not stage.
