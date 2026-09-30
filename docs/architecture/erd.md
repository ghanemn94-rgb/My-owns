# Entity-relationship model

- **Task:** T-DG1-ARCH-01 (solution-architect), 2026-09-30.
- **Covers:** master prompt §16 "Minimum domain entities", all twelve groups (REQ-S16-011…022).
- **Detail:** the physical columns of the tables P1 implements are in `data-dictionary.md`.
- **Marking:**
  - **P1** means the table is created by P1 migrations.
  - `Px` names the stage that adds the table.
  - Entity names are conceptual. Table names are snake_case singular, and `User` becomes `app_user` because `user` is a reserved word.

## Conventions shared by every table (ADR-0003/0004)

- `id uuid` (UUIDv7, app-generated) primary key.
- `organization_id` on every tenant-scoped row.
- `version integer` (optimistic concurrency) on every mutable row.
- `created_at`/`updated_at timestamptz` and `created_by`/`updated_by`.
- Explicit status columns with CHECK-constrained values and documented transitions.
- `ON DELETE RESTRICT` foreign keys.
- No hard deletes of business records.
- Money is `numeric` plus `currency`.
- Extensible custom fields live in `custom_field_values jsonb`, validated against the pinned `form_schema_version` (ADR-0014).

**Canonical shared records:**
- **one `decision` model:** T04 design decisions, T11 decision-right decisions, T16 executive decisions and gate decisions all reference or specialise it;
- **one `dependency` record**, shared by T08 and RAID;
- **one benefit register:** `benefit` plus `benefit_allocation`, with no duplicated benefit rows per initiative.

## 1. P1 physical model (implemented at DG1)

```mermaid
erDiagram
    organization ||--o{ business_unit : has
    business_unit ||--o{ business_unit : "parent of"
    organization ||--o{ app_user : "home org of"
    app_user ||--o{ user_identity : "bound to (issuer, subject)"
    app_user ||--o{ session : has
    role ||--o{ role_permission : grants
    permission ||--o{ role_permission : "granted by"
    app_user ||--o{ scoped_assignment : holds
    role ||--o{ scoped_assignment : "assigned as"
    organization ||--o{ scoped_assignment : "tenant of"
    app_user ||--o{ delegation : "delegator / delegate"
    organization ||--o{ transformation : owns
    business_unit ||--o{ transformation : contains
    app_user |o--o{ transformation : "sponsor / lead"
    organization ||--o{ audit_event : "tenant of"
    transformation |o--o{ audit_event : "scoped trail"
    organization ||--o{ outbox_event : "tenant of"
    outbox_event ||--o| processed_message : "consumed as"

    organization {
        uuid id PK
        text code UK
        text name_en
        text name_ar
        text default_timezone
        char3 default_currency
        text default_locale
        text status
        int version
    }
    business_unit {
        uuid id PK
        uuid organization_id FK
        uuid parent_business_unit_id FK
        text code
        text name_en
        text name_ar
        text status
        int version
    }
    app_user {
        uuid id PK
        uuid organization_id FK
        text display_name
        text email
        text preferred_locale
        text timezone
        text status
        int version
    }
    user_identity {
        uuid id PK
        uuid user_id FK
        text issuer
        text subject
    }
    session {
        uuid id PK
        bytea token_hash UK
        uuid user_id FK
        text auth_mode
        timestamptz idle_expires_at
        timestamptz absolute_expires_at
        timestamptz revoked_at
    }
    oidc_login_state {
        bytea state_hash PK
        text code_verifier
        text nonce
        text return_to
        timestamptz expires_at
    }
    role {
        uuid id PK
        text code UK
        text kind
        bool inherits_downward
    }
    permission {
        text code PK
        text category
    }
    role_permission {
        uuid role_id PK
        text permission_code PK
    }
    scoped_assignment {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        uuid role_id FK
        text scope_type
        uuid scope_id
        timestamptz effective_from
        timestamptz effective_to
        timestamptz revoked_at
        int version
    }
    delegation {
        uuid id PK
        uuid delegator_user_id FK
        uuid delegate_user_id FK
        text scope_type
        uuid scope_id
        timestamptz effective_from
        timestamptz effective_to
        text status
        int version
    }
    transformation {
        uuid id PK
        uuid organization_id FK
        uuid business_unit_id FK
        text code
        text name
        text mode
        text entry_phase
        text status
        text current_phase
        uuid sponsor_user_id FK
        uuid lead_user_id FK
        text timezone
        char3 currency
        timestamptz archived_at
        int version
    }
    audit_event {
        uuid id PK
        bigint seq UK
        timestamptz occurred_at
        text action
        text record_type
        uuid record_id
        uuid transformation_id
        uuid actor_user_id
        int prior_version
        int new_version
        text reason
        text request_id
        jsonb changes
    }
    outbox_event {
        uuid id PK
        bigint seq UK
        text event_type
        int schema_version
        jsonb payload
        text idempotency_key UK
        timestamptz published_at
    }
    processed_message {
        text consumer PK
        text idempotency_key PK
        timestamptz processed_at
    }
    idempotency_record {
        uuid user_id PK
        text key PK
        text request_hash
        jsonb response
        timestamptz expires_at
    }
```

Also created in P1, not drawn above:
- `schema_migration`: migration bookkeeping.
- The `pgboss.*` schema: owned and migrated by pg-boss (ADR-0008). This is P1's "job tables as required by the queue choice", and the physical form of the §16 entity **Job**.

## 2. Conceptual model, all §16 entity groups

### 2.1 Identity and access (REQ-S16-011; final gate DG4)

```mermaid
erDiagram
    Organization ||--o{ BusinessUnit : has
    Organization ||--o{ User : employs
    Organization ||--o{ Group : "has (P6)"
    Group }o--o{ User : "members (P6)"
    Role }o--o{ Permission : "role_permission"
    User ||--o{ ScopedAssignment : holds
    Group ||--o{ ScopedAssignment : "holds (P6)"
    Role ||--o{ ScopedAssignment : "granted as"
    User ||--o{ Delegation : delegates
```

| Entity | Table | Stage |
|---|---|---|
| Organization | `organization` | **P1** |
| BusinessUnit | `business_unit` | **P1** |
| User | `app_user` plus `user_identity` | **P1** |
| Group | `app_group`, `app_group_member` | P6 (IdP group mapping) |
| Role | `role` | **P1** |
| Permission | `permission`, `role_permission` | **P1** |
| ScopedAssignment | `scoped_assignment` | **P1** |
| Delegation | `delegation` | **P1 table**, logic P2/P4 |
| (support) Session, login state | `session`, `oidc_login_state` | **P1** |

### 2.2 Transformation, methodology and gates (REQ-S16-012; DG5)

```mermaid
erDiagram
    Transformation ||--o{ PerformanceArea : "tracks"
    Transformation ||--|| Charter : "has one current"
    MethodologyVersion ||--o{ Phase : defines
    MethodologyVersion ||--o{ GateDefinition : defines
    Transformation }o--|| MethodologyVersion : "pinned to"
    Transformation ||--o{ GateInstance : "runs"
    GateDefinition ||--o{ GateInstance : "instantiated as"
    GateInstance ||--o{ GateDecision : "decided by"
    GateDecision }o--|| Decision : "is a canonical"
```

| Entity | Table | Stage |
|---|---|---|
| Transformation | `transformation` | **P1** (minimal fields) |
| PerformanceArea | `performance_area` | P4 |
| Charter | `charter` (versioned, 14 source fields) | P2 |
| MethodologyVersion | `methodology_version` | P2 |
| Phase | `phase_definition` (per methodology version) | P2 |
| GateDefinition | `gate_definition` | P2 |
| GateInstance | `gate_instance` (submission version, evidence snapshot) | P2 |
| GateDecision | `gate_decision` → references `decision` | P2 |

### 2.3 Diagnosis and direction (REQ-S16-013; DG2)

```mermaid
erDiagram
    Transformation ||--o{ DiagnosticFinding : has
    Transformation ||--o{ Baseline : has
    Transformation ||--o{ ValuePool : has
    Transformation ||--o{ Outcome : has
    Transformation ||--o{ StrategicGuardrail : has
    Outcome ||--o{ Outcome : "parent of (tree)"
    Evidence }o--o{ DiagnosticFinding : "evidence_link"
    Evidence }o--o{ Baseline : "evidence_link"
```

| Entity | Table | Stage |
|---|---|---|
| DiagnosticFinding | `diagnostic_finding` | P2 |
| Baseline | `baseline` | P2 |
| Evidence | `evidence`, `evidence_version`, `evidence_link` (polymorphic link to any record) | P2 (storage adapter ADR-0010) |
| ValuePool | `value_pool` | P2 |
| Outcome | `outcome` (North Star, outcome hierarchy) | P2 |
| StrategicGuardrail | `strategic_guardrail` | P2 |

### 2.4 KPI and calculation (REQ-S16-014; DG4)

```mermaid
erDiagram
    KPIDefinition ||--o{ KPIVersion : "versioned as"
    KPIVersion ||--o{ KPIActual : measures
    KPIVersion ||--o{ TargetTrajectory : targets
    KPIActual }o--o{ CalculationRun : "input to"
    KPIActual ||--o{ DataQualityFinding : "flagged by"
    Outcome ||--o{ KPIDefinition : "measured by"
```

| Entity | Table | Stage |
|---|---|---|
| KPIDefinition | `kpi_definition` | P2 (dictionary), P4 |
| KPIVersion | `kpi_version` | P4 |
| KPIActual | `kpi_actual` (observation period, business date, event timestamp) | P4 |
| TargetTrajectory | `target_trajectory` | P4 |
| CalculationRun | `calculation_run` (inputs, formula version, result) | P4 |
| DataQualityFinding | `data_quality_finding` | P4 |

### 2.5 Target operating model and procedures (REQ-S16-015; DG5)

```mermaid
erDiagram
    Transformation ||--o{ TOMCanvas : has
    TOMDimension ||--o{ TOMCanvas : "structures"
    TOMCanvas ||--o{ Capability : lists
    Capability ||--o{ Gap : "has"
    Journey ||--o{ Process : "realised by"
    Gap }o--o{ Journey : affects
    ProcedureDefinition ||--o{ ProcedureInstance : "executed as"
```

| Entity | Table | Stage |
|---|---|---|
| TOMDimension | `tom_dimension` (the 10 seeded dimensions) | P2 |
| TOMCanvas | `tom_canvas` | P2 |
| Capability | `capability` | P2 |
| Gap | `gap` (T03) | P2 |
| Journey | `journey` | P2 |
| Process | `process` | P2 |
| ProcedureDefinition | `procedure_definition` (versioned) | P5 |
| ProcedureInstance | `procedure_instance` | P5 |

### 2.6 Portfolio and roadmap (REQ-S16-016; DG3)

```mermaid
erDiagram
    Transformation ||--o{ Initiative : has
    Initiative }o--o{ Gap : "closes (trace)"
    Initiative }o--o{ Outcome : "moves (trace)"
    Initiative ||--o{ Deliverable : produces
    Initiative ||--o{ Milestone : has
    RoadmapWave ||--o{ Initiative : sequences
    Dependency }o--|| Initiative : "from"
    Dependency }o--|| Initiative : "to"
    Initiative ||--o{ ResourceDemand : needs
    Capacity ||--o{ ResourceDemand : "covers"
    FundingDecision }o--|| Decision : "is a canonical"
```

| Entity | Table | Stage |
|---|---|---|
| Initiative | `initiative` (T05) | P3 |
| Deliverable | `deliverable` | P3 |
| Milestone | `milestone` | P3 |
| RoadmapWave | `roadmap_wave` (T07) | P3 |
| Dependency | `dependency`: **canonical, shared by T08 and RAID** | P3 |
| ResourceDemand | `resource_demand` | P3 |
| Capacity | `capacity` | P3 |
| FundingDecision | `funding_decision` → references `decision` | P3 |

### 2.7 Business case and benefits (REQ-S16-017; DG4)

```mermaid
erDiagram
    BusinessCase ||--o{ Scenario : has
    BusinessCase }o--o| Initiative : "for (or transformation-level)"
    Benefit ||--o{ BenefitAllocation : "allocated via"
    BenefitAllocation }o--|| Initiative : "to"
    Benefit }o--|| BenefitFormulaVersion : "calculated by"
    Benefit ||--o{ BenefitMeasurement : measured
    BenefitMeasurement ||--o{ FinanceValidation : "validated by"
```

| Entity | Table | Stage |
|---|---|---|
| BusinessCase | `business_case` | P3/P4 |
| Scenario | `business_case_scenario` | P4 |
| Benefit | `benefit`: **the one benefit register** (T14) | P4 |
| BenefitAllocation | `benefit_allocation` (shares sum to ≤ 100%, no double counting) | P4 |
| BenefitFormulaVersion | `benefit_formula_version` (T09, immutable once published) | P4 |
| BenefitMeasurement | `benefit_measurement` | P4 |
| FinanceValidation | `finance_validation` (FIN only) | P4 |

### 2.8 RAID, decisions and approvals (REQ-S16-018; DG4)

```mermaid
erDiagram
    Transformation ||--o{ Risk : has
    Transformation ||--o{ Assumption : has
    Transformation ||--o{ Issue : has
    Transformation ||--o{ Action : has
    Transformation ||--o{ Decision : has
    ChangeRequest ||--o{ Approval : "routed for"
    Decision ||--o{ Approval : "routed for"
    Risk }o--o{ Dependency : "references canonical"
```

| Entity | Table | Stage |
|---|---|---|
| Risk, Assumption, Issue | `risk`, `assumption`, `issue` (T15) | P3/P4 |
| Action | `action` (also corrective actions) | P3/P4 |
| Decision | `decision`: **the one decision model** (T04/T11/T16/gate/funding) | P2 (design decisions), P4 |
| ChangeRequest | `change_request` | P4 |
| Approval | `approval` (assignee, request version, due, rationale, decision timestamp; SoD) | P2 (gates), P4 |

### 2.9 Governance forums and meetings (REQ-S16-019; DG4)

```mermaid
erDiagram
    Forum ||--o{ Meeting : holds
    Meeting ||--o{ AgendaItem : has
    Meeting ||--o{ Attendance : records
    Meeting ||--o| Minutes : produces
    Meeting ||--o{ MeetingActionLink : "assigns"
    MeetingActionLink }o--|| Action : links
    AgendaItem }o--o| Decision : "brief for"
```

| Entity | Table | Stage |
|---|---|---|
| Forum | `forum` (five seeded forums) | P4 |
| Meeting | `meeting` | P4 |
| AgendaItem | `agenda_item` | P4 |
| Attendance | `attendance` | P4 |
| Minutes | `minutes` (versioned; approve/publish) | P4 |
| MeetingActionLink | `meeting_action_link` | P4 |

### 2.10 People and adoption (REQ-S16-020; DG4)

```mermaid
erDiagram
    Transformation ||--o{ StakeholderGroup : has
    StakeholderGroup ||--o{ AdoptionIntervention : targets
    StakeholderGroup ||--o{ TrainingAssessmentRecord : "assessed by"
    AdoptionMetricLink }o--|| KPIDefinition : "adoption indicator"
    AdoptionMetricLink }o--|| StakeholderGroup : for
```

| Entity | Table | Stage |
|---|---|---|
| StakeholderGroup | `stakeholder_group` (T13) | P4 |
| AdoptionIntervention | `adoption_intervention` | P4 |
| Training/AssessmentRecord | `training_assessment_record` | P4 |
| AdoptionMetricLink | `adoption_metric_link` | P4 |

### 2.11 Sustainment, improvement and health (REQ-S16-021; DG5)

```mermaid
erDiagram
    Transformation ||--o{ BAUHandover : "hands over"
    BAUHandover ||--o{ Control : establishes
    Control ||--o{ ControlCheck : "checked by"
    PerformanceArea ||--o{ ImprovementItem : backlog
    Transformation ||--o{ Lesson : records
    Transformation ||--o{ HealthAssessment : "assessed by"
```

| Entity | Table | Stage |
|---|---|---|
| BAUHandover | `bau_handover` (receiving-owner acceptance) | P4 |
| Control | `control` | P4 |
| ControlCheck | `control_check` | P4 |
| ImprovementItem | `improvement_item` | P4 |
| Lesson | `lesson` | P4/P5 |
| HealthAssessment | `health_assessment` (25-question check) | P5 |

### 2.12 Configuration, automation, integration, reporting and audit (REQ-S16-022; DG6)

```mermaid
erDiagram
    FormSchemaVersion ||--o{ TransformationConfigPin : "pinned by"
    AutomationRuleVersion ||--o{ Job : triggers
    OutboxEvent ||--o{ Job : "relayed as"
    Job ||--o{ Notification : "may create"
    IntegrationRun }o--|| Job : "runs as"
    ReportSnapshot }o--|| Transformation : "issued for"
    AuditEvent }o--o| Transformation : "scoped to"
```

| Entity | Table | Stage |
|---|---|---|
| FormSchemaVersion | `form_schema_version` | P2/P5 (ADR-0014) |
| AutomationRuleVersion | `automation_rule_version` | P5 |
| Job | `pgboss.job` (+ `pgboss.schedule`), plus `outbox_event` and `processed_message` | **P1** (queue, outbox, ledger) |
| Notification | `notification` (in-app inbox) | P4 |
| IntegrationRun | `integration_run` | P6 |
| ReportSnapshot | `report_snapshot` (immutable once issued) | P5 |
| AuditEvent | `audit_event` | **P1** |

## 3. Coverage check (REQ-S16-011…022)

Every entity named in master prompt §16 appears in section 2:

| Group | Entities | Count |
|---|---|---|
| Identity and access | Organization, BusinessUnit, User, Group, Role, Permission, ScopedAssignment, Delegation | 8 |
| Transformation, methodology and gates | Transformation, PerformanceArea, Charter, MethodologyVersion, Phase, GateDefinition, GateInstance, GateDecision | 8 |
| Diagnosis and direction | DiagnosticFinding, Baseline, Evidence, ValuePool, Outcome, StrategicGuardrail | 6 |
| KPI and calculation | KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun, DataQualityFinding | 6 |
| Target operating model and procedures | TOMDimension, TOMCanvas, Capability, Gap, Journey, Process, ProcedureDefinition, ProcedureInstance | 8 |
| Portfolio and roadmap | Initiative, Deliverable, Milestone, RoadmapWave, Dependency, ResourceDemand, Capacity, FundingDecision | 8 |
| Business case and benefits | BusinessCase, Scenario, Benefit, BenefitAllocation, BenefitFormulaVersion, BenefitMeasurement, FinanceValidation | 7 |
| RAID, decisions and approvals | Risk, Assumption, Issue, Action, Decision, ChangeRequest, Approval | 7 |
| Governance forums and meetings | Forum, Meeting, AgendaItem, Attendance, Minutes, MeetingActionLink | 6 |
| People and adoption | StakeholderGroup, AdoptionIntervention, Training/AssessmentRecord, AdoptionMetricLink | 4 |
| Sustainment, improvement and health | BAUHandover, Control, ControlCheck, ImprovementItem, Lesson, HealthAssessment | 6 |
| Configuration, automation, integration, reporting and audit | FormSchemaVersion, AutomationRuleVersion, Job, Notification, IntegrationRun, ReportSnapshot, AuditEvent | 7 |

Total: 81 §16 entities.
