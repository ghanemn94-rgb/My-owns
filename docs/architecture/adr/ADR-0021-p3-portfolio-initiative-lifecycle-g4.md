# ADR-0021: Portfolio and initiative model, sequencing rules, product gate G4 and the G1 extension (P3)

- **Status:** Proposed for P3 (DG3). Author: solution-architect (T-DG3-ARCH-01), 2026-10-07.
- **Requirements:** REQ-S16-016, REQ-PB-004, REQ-PB-006, REQ-PB-007, REQ-PB-019, REQ-PB-022, REQ-PB-032, REQ-PB-040, REQ-PB-045, REQ-PB-046, REQ-PB-059 (owners), REQ-S04-006, REQ-S09-003, REQ-DLV-035.
- **Sources:** playbook B0009, B0011, B0012, B0021, B0023, B0032, B0047, B0048, B0059, B0070–B0072; master prompt §3 (End-to-End vs Modular, lines ~155–158), §4 (G4 row, ~194), §5 (T05, ~212), §16 entity group (~500), P3 row (615).
- **Builds on:** ADR-0003 (optimistic concurrency), ADR-0004 (audit), ADR-0006/0020 (authorization, role catalogue), ADR-0007 (API conventions, §5a/§5b, 422 `invalid-transition`), ADR-0015 (one decision model, product-gate engine), ADR-0016 (P2 guards), ADR-0018 (evidence verification), ADR-0019 (decimal, Unknown).
- **Companion ADRs:** ADR-0022 (prioritization), ADR-0023 (roadmap, dependencies, capacity, funding), ADR-0024 (business case and the formula foundation).
- **Physical model:** migrations `0020_p3_portfolio_roadmap.sql`, `0021_p3_prioritization.sql`, `0022_p3_dependency_capacity_funding.sql`, `0023_p3_business_case_formula.sql`, `0024_p3_gates_access_instantiation.sql`. Contract: `docs/api/openapi.yaml` tags `portfolio`, `prioritization`, `roadmap`, `capacity`, `business-cases`, `benefit-formulas`, `gates`.

## Context

P3 delivers phase 4 *Mobilize*: initiatives (T05), prioritization (T06), the wave roadmap (T07), the dependency map (T08), business cases, benefit formulas (T09), resource capacity, funding and the business gate G4 (B0023 "Is the portfolio executable and value-backed?"). The playbook's sequencing principles are hard rules in this product:

- **B0009** End-to-End: "Do not launch initiatives before the North Star, outcomes and target state are clear."
- **B0011** "Outcome before activity: define measurable business outcomes before building a project list."
- **B0012** "Current state before solution: diagnose economics, customer, operations, capability and technology before prescribing initiatives."
- **B0032** Gate 1: "Do not proceed with a list of projects. Proceed only when the leadership team agrees on the problem, baseline and material value pools."
- **B0059** "A project portfolio is not a Target Operating Model."
- **B0070** traceability chain: Diagnosed issue → Target-state gap → Initiative → Deliverable → Capability change → KPI movement → Benefit.

P3 is **additive to DG2**. It adds migrations, tables, resources and OpenAPI paths. Two DG2 extensions are required and allowed (G1 agreement confirmations, the readiness view); both are specified in §8–§9 below with exactly what changes for existing clients. One more DG2 artifact is touched compatibly (the canonical `dependency` table, ADR-0023 §4); it was announced in DG2 (`0017`: "P3 adds initiative endpoints and cycle checks").

## Decision

### 1. The S16-016 entity group

Every entity has a UUIDv7 primary key from the application, `organization_id` + `transformation_id` (composite FKs inside one transformation), `version` (optimistic concurrency), `created_*`/`updated_*`, the P2 row guard and the deferred audit-coverage constraint (`p2_attach_guards`, ADR-0016). History and decision tables are append-only (`p2_attach_append_only`).

| S16-016 entity | Table | Owner column | Status column | Module (`apps/api/src/modules/*`) | ADR |
|---|---|---|---|---|---|
| Initiative | `initiative` | `executive_owner_user_id` (T05 "Executive owner"), `workstream_lead_user_id` | `status` (§3) | `portfolio` (new) | this |
| Deliverable | `deliverable` | `owner_user_id` | `acceptance_status`, `status` | `portfolio` | ADR-0023 §2 |
| Milestone | `milestone` | `owner_user_id` | `status` | `portfolio` | ADR-0023 §2 |
| RoadmapWave | `roadmap_wave` | `owner_user_id` | `status` | `portfolio` | ADR-0023 §1 |
| Dependency | `dependency` (canonical, DG2 `0017`, extended) | `owner_user_id` | `status` | `workflows` (owner since DG2) | ADR-0023 §4 |
| ResourceDemand | `resource_demand` | `owner_user_id` | `status` (`planned`/`committed`/`released`/`archived`) | `portfolio` | ADR-0023 §6 |
| Capacity | `capacity` | `owner_user_id` | `status` | `portfolio` | ADR-0023 §6 |
| FundingDecision | `funding_decision` (specialises a canonical `decision` row of kind `executive`) | `decided_by` (the approver) | `outcome` | `portfolio` | ADR-0023 §7 |

Supporting P3 tables (all in the data dictionary): `initiative_gap_link`, `initiative_outcome_contribution`, `initiative_decision_link`, `gate_dispensation`, `portfolio_selection`, `resource_role`, `dependency_type`, the scoring tables (ADR-0022), the business case and formula tables (ADR-0024), and `gate_decision_agreement` (§8).

**New API module `portfolio`.** It owns initiatives and their links, waves, deliverables, milestones, capacity, resource demand, selection and funding, and (with ADR-0022) prioritization. `business-cases` and `benefit-formulas` are owned by the `kpi` module (kpi-benefits-engineer), which already owns value pools and Finance validation of baselines. The dependency register (DG2 and T08 paths) stays in `workflows`.

**Module graph (no cycle).** `portfolio.dependsOn = [transformations, kpi, evidence, access, audit, platform, workflows]`: `portfolio` reads gate status and creates canonical `decision` rows through `workflows`' public interface. `workflows` must **not** import `portfolio`. The G4 evaluators in `workflows/g4.ts` read their facts through a `GateFactsProvider` interface that `workflows` defines; `server.ts` wires it at start-up with `portfolio/gate-facts.ts` and `kpi/p3-gate-facts.ts` (dependency injection, as `registerKpiModule` already does). The architecture test keeps asserting the module graph is acyclic.

### 2. Initiative (T05) and its links

`initiative` holds the 14 T05 source fields (B0072). Each field has exactly one home:

| # | T05 field (B0072) | Storage |
|---|---|---|
| 1 | Initiative name | `initiative.name` |
| 2 | Executive owner | `initiative.executive_owner_user_id` |
| 3 | Workstream lead | `initiative.workstream_lead_user_id` |
| 4 | Problem / gap addressed | `initiative.problem_statement` (narrative) **and** `initiative_gap_link` rows (1..n, to `tom_gap` or `diagnostic_finding`) |
| 5 | Objective | `initiative.objective` |
| 6 | Scope (in/out) | `initiative.scope_in`, `initiative.scope_out` |
| 7 | Key deliverables | `deliverable` rows (count outside 3–7 → **warning** `initiative.deliverable_count`, never a rejection) |
| 8 | Outcome/KPI contribution | `initiative_outcome_contribution` rows (outcome required, T02 row/KPI optional per row, statement required) |
| 9 | Financial benefit | `initiative.financial_benefit_summary` (narrative); quantified lines live in the initiative business case (ADR-0024) |
| 10 | Customer benefit | `initiative.customer_benefit_summary` |
| 11 | Dependencies | canonical `dependency` rows with `from_initiative_id`/`to_initiative_id` (ADR-0023) |
| 12 | Risks | `initiative.risks_summary` (top risks; the canonical RAID register is P4, which links back) |
| 13 | Milestones | `milestone` rows (approved vs forecast dates) |
| 14 | Required decisions | `initiative_decision_link` rows → canonical `decision` (decision, owner and due date come from the decision row; one decision model, ADR-0015) |

Further columns: `code` (`INI-01`…, from `record_code_counter` prefix `INI`), `wave_id` (ADR-0023), `planned_start`, `planned_end` (dates; `planned_end >= planned_start`) and the lifecycle columns of §3.

**Retirement, never deletion (aligned with what was built, T-DG3-ARCH-03).** An earlier draft of this paragraph listed `archived_*` columns. They do not exist: migration `0020` has no archive columns on `initiative`, and the contract has no archive route and no archive fields on `Initiative`. The rule as built by T-DG3-BE-B is:

- There is **no DELETE** of an initiative, in the API or in the grants.
- **`cancelled` is the terminal retirement** (`POST /initiatives/{id}/cancel`, with a reason and the `cancelled_*` stamps; §3).
- **A `cancelled` or `completed` initiative is read-only, and so are its links.** A `PATCH` of the T05 card, or a create, change or archive of a gap link, outcome contribution or decision link, answers **422** `urn:mth:problem:validation`, code `initiative.read_only`, detail "A {status} initiative is read-only; its card and links can no longer be changed." (`portfolio/repository.ts` `assertEditable`, `READ_ONLY_STATUSES`).

The individual link rows keep their own `active` → `archived` status (archive, never delete).

*Open point, not built in P3:* the same guard is **not** applied to the records other tasks hang off an initiative: scores (BE-D) and deliverables and milestones (BE-C). Writing them on a cancelled initiative is not refused today. BE-E should apply it to resource demand when it builds those writes. The consequence is limited, because a cancelled initiative is out of rankings, the view, G4 scope and capacity demand. Extending `assertEditable` to those writes is a follow-up for BE-E or a repair round; it is listed in `p3-work-split.md` §9 (item 14).

**Outcome hierarchy (REQ-PB-032).** The five B0048 levels are canonical records: North Star (`north_star`) → strategic outcome (`outcome`) → KPI (`outcome_kpi` → `kpi_definition`) → target (`outcome_kpi.target_value`, `target_date`, trajectory) → **initiative contribution** (`initiative_outcome_contribution`). `outcome_id` is `NOT NULL` with a composite FK into the same transformation: a contribution without an outcome is rejected by the schema (API 400 at `/outcomeId`, DB `not_null_violation`). When `outcome_kpi_id` is set it must belong to that outcome (DB trigger `initiative_contribution_kpi_matches_outcome`). `GET /transformations/{id}/outcome-hierarchy` (P3 read view, `portfolio` module) returns the five levels as one tree.

**TOM/portfolio separation (REQ-PB-040, B0059).**

- An initiative is a *vehicle* linked to one or more TOM gaps (`initiative_gap_link.target_type = 'tom_gap'`) or diagnosed findings (`'diagnostic_finding'`). The TOM tables (`tom_canvas_cell`, `tom_gap`, `capability`, `journey`) get **no** initiative column, and the `portfolio` module never writes them.
- **The rejection.** `POST /initiatives/{id}/gap-links` accepts `targetType` only as `tom_gap` or `diagnostic_finding`. Any other TOM record type (`tom_canvas_cell`, `capability`, `journey`, `tom_dimension`), i.e. an attempt to attach the initiative as TOM/G3 evidence, is answered **422** `urn:mth:problem:validation`, code `initiative.not_tom_evidence`, detail "A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence." The contract declares `targetType` as a string with this documented rule rather than an enum, so the 422 (not a 400) is the rule's answer.
- `initiative` is **not** added to `evidence_link.record_type` or `p2_record_ref_guard` in P3. The G3 criterion evaluators read no portfolio table. A unit test asserts that G3 completeness is identical with and without initiatives and gap links.

### 3. Initiative lifecycle

States: `draft` → `submitted` → `ranked` → `selected` → `funded` → `launched` → `completed`; terminal `cancelled`. Ranking, selection and funding are three separate records (REQ-S09-003): `ranking_snapshot`/`ranking_entry` (ADR-0022), `portfolio_selection` (append-only) and `funding_decision` (append-only, ADR-0023 §7). The status column only mirrors them so lists and guards stay cheap. The display label of `selected` is **'Selected - unfunded'** (EN) / 'مختارة - غير ممولة' (AR, provisional translation) whenever no approved, current funding decision exists.

Every transition is an explicit action sub-resource with `If-Match` (428/409), authorization re-checked at commit (BE18A pattern), validation, a status-step trigger and one audit event per changed row. A refused transition is **422 `urn:mth:problem:invalid-transition`** (ADR-0007) with `code` and the English `detail` below (the web translates `code`). Preconditions are evaluated in the listed order and the first failure is reported; `errors[]` lists all failing preconditions of that transition.

| Transition | Route / trigger | Permission | Preconditions, in order → 422 `code`: exact reason text |
|---|---|---|---|
| create (`draft`) | `POST /api/v1/initiatives` | `initiative.edit` | none beyond validation. **Drafting is allowed at any time** (B0009, M0094), including before G1. |
| `draft → submitted` ("add to the portfolio", "submit for prioritization") | `POST /initiatives/{id}/submit` | `initiative.edit` | 1. `initiative.g1_not_approved`: **'Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio'** (REQ-PB-007, REQ-PB-022). Satisfied when G1 is `approved`, or (Modular) by an accepted inherited approval for G1 (§5).<br>2. `initiative.outcome_before_activity`: **'Outcome before activity: link at least one measurable outcome with a KPI before submitting for prioritization'** (REQ-PB-006). Needs ≥ 1 active contribution whose `outcome_kpi_id` is set. This one is answered as `urn:mth:problem:validation` with `errors[0].pointer = "/outcomeContributions"`, because the acceptance calls it a validation error; the `code` and text are as above. |
| `submitted → draft` (withdraw) | `POST /initiatives/{id}/withdraw` (reason ≥ 3 chars) | `initiative.edit` | status must be `submitted` or `ranked` (`initiative.not_withdrawable`). |
| `submitted → ranked` | the ranking-proposal transaction (`POST /transformations/{id}/prioritization/rankings`, ADR-0022) | `prioritization.edit` | the initiative has a complete score under the active weight set; incomplete ones stay `submitted` and are listed as `incomplete` in the snapshot. |
| `ranked → selected` (approved portfolio selection) | `POST /initiatives/{id}/select` (rationale) | `portfolio.select` (business_approval; SP default) | 1. `initiative.not_ranked`: 'The initiative is not in the current proposed ranking'.<br>2. `initiative.g1_not_approved` (as above). Writes a `portfolio_selection` row (`selected`). Ranking never selects. |
| `selected/funded → ranked` (deselect) | `POST /initiatives/{id}/deselect` (rationale) | `portfolio.select` | status `selected` or `funded` and not `launched`. Writes `portfolio_selection` (`deselected`). |
| `selected → funded` | recording an **approved** funding decision (`POST /api/v1/funding-decisions`) | `funding.approve` (business_approval; FIN and SP) | 1. `funding.not_selected`: 'Funding can only be approved for a selected initiative'. Selection never funds. A `rejected`/`deferred` decision leaves `selected`. A later `revoked` decision returns a `funded` (not launched) initiative to `selected`. |
| `funded → launched` | `POST /initiatives/{id}/launch` | `initiative.launch` (write; TL default) | 1. `initiative.g1_not_approved` (when still `draft`).<br>2. End-to-End only: `initiative.direction_not_approved`: **'North Star, outcomes and target state not yet approved'** (REQ-PB-004, B0009). Satisfied when G2 **and** G3 are `approved`, or an active waiver for each missing gate exists (§5).<br>3. `initiative.selected_unfunded`: **'Selected - unfunded: a funding approval is required before launch'** (REQ-S09-003) when status is `selected`.<br>4. `initiative.not_launchable`: 'Only a funded initiative can be launched' for any other status. |
| `launched → completed` | reserved for P4 (execution); no P3 route | — | — |
| any non-terminal → `cancelled` | `POST /initiatives/{id}/cancel` (reason) | `initiative.edit` | not `launched`/`completed`; terminal. |

Notes:

- **Precondition 2 of launch is checked before the funding precondition** so the REQ-PB-004 test ("End-to-End, G3 not approved → 422 with the reason") gets the sequencing reason even for a selected-but-unfunded initiative; the acceptance's "after G2 and G3 approval the same call succeeds" holds for a funded initiative. G4 approval is **not** a launch precondition: B0009 gates launch on direction and target state, and a funded Wave 1 pilot may launch before the whole portfolio passes G4. G4 moves the transformation's phase (ADR-0015) and is the portfolio-level decision.
- The DB backs the machine with `initiative_status_step()` (BEFORE UPDATE OF status): only the edges above are legal, and `launched_at/by`, `cancelled_at/by/reason` are complete exactly in their states (CHECKs). Gate preconditions are API rules (they read other aggregates); the DB guarantees the edge set.
- **Readiness hints, not blocks:** fewer than 3 or more than 7 deliverables (`initiative.deliverable_count`), no gap link (`initiative.no_gap_link`), no executive owner (`initiative.no_owner`) are returned in `warnings[]` on the initiative representation. They block only at G4 (§7).

### 4. Sequencing rule evaluation (one function)

`portfolio/sequencing.ts` exports one pure function `sequencingState(facts)` used by the transitions, the readiness view (§9) and the web. Facts: `mode`, `entry_phase`, gate statuses G1–G3, active dispensations (§5), diagnostic coverage (§9). It returns `{ canSubmit, canLaunch, blockers[] }` with the codes and texts of §3. No route re-implements the rule.

### 5. End-to-End vs Modular entry, waivers and inherited approvals (master prompt l.157–158, REQ-PB-004)

- **End-to-End** (`transformation.mode = 'end_to_end'`): the §3 preconditions apply literally: G1 approved to enter the portfolio, G2 and G3 approved to launch.
- **Modular** (`mode = 'modular'`, `entry_phase` set): the team enters an existing transformation. Approvals granted before the product was used are **captured as evidence, never fabricated**:
  - `gate_dispensation` row with `kind = 'inherited_approval'`, `gate_code` (G1, G2 or G3), `approving_body` (text), `approved_on` (date), `evidence_id` (**required**), `recorded_by`.
  - It counts for sequencing only when **(a)** its evidence is `verified` (ADR-0018: accessible, reviewed by someone other than its creator; a bare filename never counts) and **(b)** it was **accepted** by a person holding `gate.decide` for the transformation who is not the recorder (`accepted_by <> recorded_by`, DB CHECK). Until then the readiness view shows the gate as "inherited approval pending verification", never as approved.
  - It **never** creates a `gate_decision`, never changes `gate_instance.status`, and the gate list keeps showing the gate as `draft` with an `inheritedApproval` annotation. The product-gate history therefore never contains an approval the product did not record.
- **Waiver** (End-to-End, REQ-PB-004 procedure "or an authorized waiver is recorded"): `gate_dispensation` with `kind = 'waiver'`, `gate_code`, mandatory `reason`, optional `initiative_id` (null = the whole transformation), `expires_on`, `granted_by` (must hold `gate.decide` and be the gate's configured approver; not the requester; business approval). A waiver unblocks the sequencing precondition for that gate only; it is shown on the initiative and in readiness as "launched under waiver of G3", and it can be revoked (`status = 'revoked'`, audited). It never approves the gate.
- Routes (as in the frozen contract, `docs/api/openapi.yaml`): `GET/POST /transformations/{id}/gate-dispensations`, `POST …/{dispensationId}/decision` with body `AcceptanceDecision {result: accepted | rejected, note?}` and `If-Match` (operation `decideGateDispensation`; a `pending` dispensation becomes `accepted` or `rejected`), and `POST …/{dispensationId}/revoke` (`accepted` → `revoked`). Permissions: recording `gate.submit`; deciding (accepting, rejecting, revoking) `gate.decide`, held by the waived gate's configured approver. *(T-DG3-ARCH-02: this line earlier said `…/accept`; the contract's `…/decision` is authoritative and is what T-DG3-BE-A implemented.)*
- **No delegated dispensation decisions (confirmed, T-DG3-ARCH-02).** `AcceptanceDecision` is a shared schema and carries an optional `onBehalfOfUserId`. On a gate dispensation it is refused with **422** `urn:mth:problem:validation`, code `dispensation.on_behalf_not_supported`, pointer `/onBehalfOfUserId`, and nothing is written. A waiver or an inherited-approval acceptance is a business approval that stands in for a product gate, so the waived gate's configured approver decides it in person. This is the rule T-DG3-BE-A implemented. T-DG3-ARCH-03 made it the rule for **every** P3 business approval: see §6.

### 6. Business approvals are recorded human decisions

Selection (`portfolio.select`), funding (`funding.approve`), weight-set approval and ranking overrides (`prioritization.approve`), dispensations and G4 (`gate.decide`) are *business approvals inside the product*. The product records a named person's decision with rationale, timestamp, approver basis and audit event. Nothing auto-approves: no job, rule, seed or migration writes an approval. Demo seed data may contain clearly synthetic approvals, which approve nothing real. A technical-admin role can never hold these permissions (DB trigger from `0001`). These are G-level business records and never DG0–DG7 engineering gate records.

**Delegation: one rule for the P3 business approvals (decided T-DG3-ARCH-03, 2026-10-08).** Until then the rule differed by action: selection allowed one-hop delegation, while dispensations and prioritization decisions refused it.

**The rule: a P3 business approval is decided by the approver in person. Acting on someone's behalf is refused.**

| Action | Body carrying `onBehalfOfUserId` | Answer when it is present |
|---|---|---|
| Select / deselect (`portfolio.select`) | `SelectionRequest` | 422 `selection.on_behalf_not_supported` (changed from one-hop delegation) |
| Funding decision (`funding.approve`, BE-E) | `FundingDecisionCreate` | 422 `funding.on_behalf_not_supported` (BE-E implements it) |
| Ranking-override decision (`prioritization.approve`) | `ApprovalDecision` | 422 `prioritization.on_behalf_not_supported` (as built) |
| Weight-set approval and override revoke (`prioritization.approve`) | `TransitionNote` / `ReasonRequest`, which have no such property | 400: the strict schema refuses an unknown property (as built) |
| Dispensation decision (`gate.decide`) | `AcceptanceDecision` | 422 `dispensation.on_behalf_not_supported` (as built) |

Every 422 has the same form: `type` `urn:mth:problem:validation`, `errors[0].pointer` `/onBehalfOfUserId`, the English detail "A {record} is decided by the approver in person; deciding on someone's behalf is not available.", and **nothing is written** (no row, no version bump, no audit event). The check runs after the `If-Match` check, before the separation-of-duties and business preconditions, and before any write. The contract is unchanged: the property stays in the frozen schemas, and the 422 is already declared on every one of these operations.

Why "refused" and not "allowed":

1. **In P3 delegation adds no capability.** Selection, funding, weight-set approval and override decisions are granted by permission, not to one named person. Any other holder of the permission can decide in their own name when the usual approver is absent. Dispensations name an approver, but a waiver stands in for a product-gate approval, so T-DG3-ARCH-02 already required that approver to decide in person.
2. **The delegation feature itself is P4.** REQ-S10-010 (final gate DG4) covers delegation records with effective dates, absence handling, loop rejection and "B on behalf of A" in the audit trail. Allowing delegation now, in five places, ahead of that feature would create five separate SoD paths (REQ-S10-016) to keep consistent later. Refusing keeps one path.
3. **It is the smaller change.** Three of the five actions already refused delegation, and only selection changes.

Not covered by this rule: **record-owner decisions** keep the ADR-0015 one-hop delegation path (`actsOnBehalfOf`). These are the design decision (`decision.decide`), the product gate decision (`gate_decision`, including G4, §7) and deliverable acceptance by the executive owner (ADR-0023 §2). Each can be made only by one named person, so absence would otherwise block them. Their contracts were approved at DG2 or are owner-based by design.

**In P4**, REQ-S10-010 revisits this table in one place: one shared helper reusing `actsOnBehalfOf`, the delegator's and the caller's SoD checked against the proposer, and both identities recorded. The `on_behalf_of_user_id` columns of `portfolio_selection` and `funding_decision` (ADR-0023 §7) stay in the schema for that and are always NULL in P3.

### 7. Product gate G4 (REQ-PB-019, REQ-S04-006, REQ-PB-046, REQ-PB-055, REQ-PB-059)

G4 reuses the ADR-0015 engine unchanged: `gate_instance`, versioned `gate_submission` with frozen snapshot and SHA-256, `gate_submission_criterion`, `gate_decision` + canonical `decision` (kind `gate`). The **decision contracts are reused byte-for-byte**: a decision by a user who is not the configured approver → **403** `gate.not_approver`; by the submitter (or on the submitter's behalf) → **403** `gate.submitter_cannot_decide`; on a superseded/withdrawn/decided submission → **409** `urn:mth:problem:version-conflict`, code `gate.submission_superseded`. An approved G4 moves `current_phase` from `mobilize` to `transform` through the existing path.

**G4 scope.** The initiatives in G4 scope are those with status `selected`, `funded` or `launched` (the approved portfolio selection) in the transformation. Draft, submitted, ranked and cancelled initiatives are out of scope. An empty scope makes `g4.initiative_cards` incomplete (`g4.portfolio_empty`).

**Criteria** (seeded by `0024` in `gate_criterion_definition`; all mandatory; `requires_verified_evidence = false`). Missing items use the existing `Warning` shape: `code` (i18n key), `message` (English label with the initiative's code and name filled in) and `pointer` (`/initiatives/{id}`, `/business-cases/{id}`, `/benefit-formulas/{id}` …). The labels below are the exact English texts the acceptance tests look for:

| Key | Ordinal | Complete when … | `missing[]` item (code → English label) |
|---|---|---|---|
| `g4.initiative_cards` | 1 | ≥ 1 initiative in scope; each has name, objective, scope in, ≥ 1 active gap link (REQ-PB-046) and ≥ 1 outcome contribution with a KPI (REQ-PB-006) | `g4.portfolio_empty` → 'Initiative cards'; `g4.initiative_card_incomplete` → 'Initiative card incomplete: {code} {name} ({fields})', where {fields} lists the missing ones of `name`, `objective`, `scopeIn`, comma-separated (§11); `g4.initiative_gap_missing` → 'Gap link missing: {code} {name}'; `g4.initiative_outcome_missing` → 'Outcome/KPI link missing: {code} {name}' |
| `g4.business_cases` | 2 | a transformation-level business case exists and is not archived; every in-scope initiative has an initiative case linked to it; the transformation case fills all ten sections and each initiative case the lighter set (ADR-0024 §1) | `g4.business_case_missing` → 'Business cases'; `g4.initiative_case_missing` → 'Business case missing: {code} {name}'; `g4.business_case_section_missing` → 'Business case section missing: {section}' |
| `g4.finance_validation` | 3 | every in-scope case (and the transformation case) has a current Finance-validated baseline, and every benefit line's formula version is Finance-validated and current (REQ-PB-055) | `g4.finance_validation_missing` → **'Finance validation'**, with `pointer` naming the case or formula version |
| `g4.prioritization` | 4 | a current proposed ranking exists under the active weight set and every in-scope initiative has a complete score in it | `g4.prioritization_missing` → 'Prioritization'; `g4.score_incomplete` → 'Score incomplete: {code} {name}' |
| `g4.roadmap` | 5 | every in-scope initiative has a wave, planned dates and ≥ 1 milestone with an approved date; no dependency cycle; no unresolved dependency whose predecessor finishes after the successor's needed-by date is left without a mitigation | `g4.roadmap_missing` → 'Roadmap: {code} {name}'; `g4.schedule_conflict` → 'Schedule conflict: {dependency code}' (how this is read: §11) |
| `g4.owners` | 6 | every in-scope initiative has an executive owner **and** a workstream lead (REQ-PB-019, REQ-PB-059) | `g4.owner_missing` → **'Owners'**, one item per initiative without owners, `message` 'Owners: {code} {name}' |
| `g4.funding` | 7 | every in-scope initiative has a current approved funding decision (REQ-S04-006) | `g4.funding_missing` → 'Funding decision missing: {code} {name}' |
| `g4.capacity` | 8 | every in-scope initiative has ≥ 1 `committed` resource demand, and no committed demand exceeds the role's available capacity in its period (REQ-S04-006, REQ-PB-059) | `g4.capacity_commitment_missing` → 'Capacity commitment missing: {code} {name}'; `g4.capacity_conflict` → 'Capacity conflict: {role} {period}' ({period} is `YYYY-MM`; a role and month with committed demand and **no** capacity row is Unknown and counts as a conflict, §11) |

A G4 submission with any incomplete criterion is refused with the existing **422 `gate_criteria_incomplete`**, the shape the DG2-approved `submitGate` (ADR-0015) emits for every gate. Nothing is written.

**The refusal shape** (decided by T-DG3-ARCH-04, option (a): this text now matches the code, and the code is unchanged):

- `errors[]` has **one entry per incomplete mandatory criterion**, in criterion order:
  - `pointer` is `/criteria/<key>`;
  - `code` is the code of that criterion's **first** missing item (from the table), or `gate.criterion_incomplete` when the criterion has none;
  - `message` is **all** of that criterion's missing-item labels, joined with single spaces.
- `detail` is "Mandatory required outputs are incomplete: <keys>." (the keys comma-separated).
- Every label of the table therefore still appears **literally** in the 422. That covers 'Owners', 'Finance validation' and each initiative's '{code} {name}', which is what REQ-PB-019 ("rejected listing 'Owners'") and REQ-PB-046 ("rejected naming that initiative") need.
- **The per-item list with pointers** (one `Warning` per missing item: `code`, `message`, and `pointer` naming the initiative, case, formula version or dependency) is in the gate view, `GET /transformations/{id}/gates/G4` → `criteria[].missing[]`. It is not repeated in the 422. A client that needs per-item links reads the view: the refusal says *which criteria* block, and the view says *which records*.
- **Why not per-item entries (option (b))?** No requirement needs the 422 itself to carry per-item pointers. Changing it only for G4 would give one problem code two shapes, and changing it for every gate would break the byte-stable G1–G3 refusals that DG2 approved. `apps/api/test/integration/gates/g4.test.ts` checks the joined messages, for example `g4.owners` → 'Owners: {code} {name}'.

**Snapshot.** The G4 snapshot freezes the in-scope initiative ids and versions, the ranking snapshot id, the active weight-set version, case ids and versions, formula version ids and their validation state, funding decision ids, committed demand ids and the wave assignment.

**Enabling.** `0024` seeds the G4 criteria but leaves `gate_definition.submission_enabled = false`, so the DG2 API and its tests are unchanged until the backend task (BE-E, `p3-work-split.md` §2) ships the evaluators together with its migration `0026_p3_enable_g4.sql`: `UPDATE gate_definition SET submission_enabled = true … WHERE code = 'G4'` (and updates the one DG2 test that asserts G4 is not submittable). Until then the G4 view lists the eight criteria as `incomplete` with `gate.criterion_not_evaluable` (the DG2 fail-closed rule).

### 8. G1 extension: leadership agreement confirmations (REQ-PB-022, B0032)

**Contract.** `GateDecisionCreate` gains an optional property:

```yaml
agreements:
  type: object
  additionalProperties: false
  required: [problem, baseline, materialValuePools]
  properties:
    problem:            { type: boolean, const: true }
    baseline:           { type: boolean, const: true }
    materialValuePools: { type: boolean, const: true }
```

**Rules.**

- For `gateCode = G1` and `outcome = approved`, `agreements` is **required** with all three confirmations `true`. Missing, partial or `false` confirmations → **422** `urn:mth:problem:validation`, code `gate.g1_agreements_required`, `errors[]` pointers `/agreements/problem`, `/agreements/baseline`, `/agreements/materialValuePools` for each missing one; detail 'G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032)'. Nothing is written.
- For any other gate, or any non-approve outcome, `agreements` must be absent (422 `gate.agreements_not_applicable`).
- The check runs after the ADR-0015 checks 1–4 (404, 403 not approver, 403 submitter, 409 superseded), so those statuses keep their precedence.

**What changes for existing G1 clients.** The request schema is a backward-compatible superset (one new optional property). The *behaviour* of exactly one call changes: `POST /transformations/{id}/gates/G1/decision` with `outcome: approved` **without** `agreements` was 200 in DG2 and is 422 in P3. G1 `rejected`, `changes_requested` and `deferred`, and all G2/G3 decisions, are unchanged. The response (`GateDecision`) gains a nullable `agreements` property (the three confirmations with `confirmedAt`), additive. DG2 tests and the G1 e2e that approve G1 must send the three confirmations; the backend task updates them (listed in `p3-work-split.md`).

**Storage and audit.** `gate_decision_agreement` (append-only): `gate_decision_id`, `agreement_code` (`problem` | `baseline` | `material_value_pools`), `confirmed_by` (= the decider), `confirmed_at`; unique per decision and code. The approving transaction inserts the three rows and the gate decision's audit event carries `agreements: ["problem","baseline","material_value_pools"]` in its diff. The database guard (a deferred constraint trigger on `gate_decision`: an approved G1 decision needs exactly three agreement rows at COMMIT) is added by the backend task **in the same migration and release as the API change** (BE-A), because adding it in `0024` would make the DG2 API's G1 approval fail before the API sends the confirmations.

### 9. Readiness view (REQ-PB-007, B0012) — DG2 extension

`GET /api/v1/transformations/{transformationId}/readiness` (new path; `transformation.read`; no existing path changes). Response `TransformationReadiness`:

- `mode`, `entryPhase`, `currentPhase`;
- `gates`: G1–G4 status, plus `dispensations` (inherited approval / waiver) per gate;
- `diagnostic`: one entry per B0012 area with `area`, `covered` (boolean), `dimensions` (the T01 dimension codes behind it) and `missing[]` (T01 dimension codes not yet covered);
- `missingDiagnosticAreas`: the B0012 area codes not covered (**this is the list the acceptance reads**);
- `sequencing`: `canSubmitInitiatives`, `canLaunchInitiatives`, `blockers[]` (codes and texts of §3).

**B0012 → T01 mapping** (T01 dimensions are the six seeded `diagnostic_dimension` rows, B0031):

| B0012 area (`area` code) | English / Arabic label | T01 dimension codes | Covered when |
|---|---|---|---|
| `economics` | Economics / الجوانب الاقتصادية | `financial` | every listed dimension is covered |
| `customer` | Customer / العملاء | `customer` | 〃 |
| `operations` | Operations / العمليات | `process` | 〃 |
| `capability` | Capability / القدرات | `people_org` | 〃 |
| `technology` | Technology / التقنية | `technology`, `data` | both covered |

A T01 dimension is **covered** when its seeded `diagnostic_item` (active) states current state, root cause, impact and confidence: the content half of `g1.diagnostic` (ADR-0015), without the verified-evidence half, because readiness is an early-warning view and G1 itself still requires verified evidence. Arabic labels are provisional translations.

### 10. Rules every P3 implementer follows (DG2 lessons, binding)

1. Free text uses the shared `freeText`/`hasText`/`hasInvalidCharacter` rules (visible content, no NUL, no lone surrogates); truncation only through `truncateText`.
2. Strict UTF-8 JSON and query parsing (BE13) on every new route; no route-local parser.
3. `config.consumes` on every new route equals the operation's declared `requestBody.content` (JSON unless stated); the contract media-type test enforces it.
4. Every mutation: server-side authorization re-authorised at commit (BE18A), validation, optimistic concurrency (`If-Match` → 409/428; creates are version 1), an audit event, and a test for each.
5. No remote or client I/O inside a database transaction (BE17/BE18A).
6. Money, rates, weights, scores and FTE are decimal strings on the wire and `numeric` in SQL; never `Number()`. Unknown/Stale is never shown as 0 or green.
7. Every user-facing string is bilingual (Arabic RTL, English LTR), translated at render time; codes, not English text, cross the API for translation.
8. Web forms follow RecordForm and the hand-written-form blank rules (one form-level alert in one live region, axe-clean banners); session-bound actions use `apps/web/src/auth/sessionBound.ts` (no raw `navigate`, no direct `setQueryData`).
9. Harness ports stay below 32768; verification runs with the locale unset and with `C.UTF-8`.
10. Unit tests are deterministic with explicit timeouts.
11. Every new operation declares its ADR-0007 §5a/§5b platform statuses from the start (400 always; 401 non-public; 403 unsafe; 409/428 with If-Match; 429 always).

### 11. Interpretations recorded after wave 4 (T-DG3-BE-E handback §7, T-DG3-FE-A/B/C handbacks; T-DG3-ARCH-04, 2026-10-08)

These are the rule, and reviewers test against this text. Capacity and funding detail is in ADR-0023 §9.

1. **Deselecting voids funding** (the §3 deselect row). A funding decision counts only for the selection it was recorded under. `latestFundingState()` (`portfolio/funding.ts`) reads the latest decision recorded after the initiative's latest `selected` row in `portfolio_selection`. If there is no selection row, every decision counts.
   - A deselected and re-selected initiative is 'Selected - unfunded' (`fundingState = unfunded`), and launch is refused until a person records a **new** approved funding decision. Re-selection never puts the status back to `funded`.
   - Deselecting writes no funding record. Selection and funding stay separate records (REQ-S09-003).
   - G4 reads funding through the same function, so `g4.funding` also needs that new decision.
2. **`g4.initiative_card_incomplete`.** The "name, objective, scope in" part of `g4.initiative_cards` had no missing-item code. Its code is `g4.initiative_card_incomplete`, with the message 'Initiative card incomplete: {code} {name} ({fields})', where {fields} is the comma-separated missing ones of `name`, `objective` and `scopeIn` (blank text counts as missing, `hasText`). It is listed before the gap and outcome items of the same initiative.
3. **The G4 roadmap reading** (`g4.roadmap`, `workflows/g4.ts` with `portfolio/gate-facts.ts`):
   - `g4.roadmap_missing` is listed for each in-scope initiative that has no wave, no `plannedStart`, no `plannedEnd`, or no milestone with an approved date.
   - **Cycles are not re-checked.** The `dependency_acyclic` guard (0022, ADR-0023 §5) refuses a cycle at write time, so the dependency graph cannot hold one when G4 is evaluated.
   - `g4.schedule_conflict` lists each unresolved dependency (not `resolved` and not `archived`) **into** an in-scope initiative that carries the T08 flag `schedule.needed_by_conflict` and has a blank `mitigation`. That is the §7 rule: a predecessor that finishes after the needed-by date, left without a mitigation. A mitigation text clears the item. The flag stays visible on T07 and T08.
   - **A dependency whose schedule is Unknown (`schedule.unknown`: no needed-by date, or a predecessor with no finish date) is not listed by G4.** The §7 rule names only a known late predecessor. Every in-scope initiative's own dates are already required by `g4.roadmap_missing`, so an Unknown can only come from a missing needed-by date or a predecessor outside G4 scope (an external party, or an initiative that is not selected). T07 and T08 show these as Unknown, never as "no conflict". Listing them in G4 as well would be a stricter reading, and it is open as a recommendation (T-DG3-ARCH-04 handback §4). It changes only after an orchestrator decision.
4. **Unknown capacity is a G4 conflict.** `g4.capacity` uses committed demand only (ADR-0023 §6). A role and month with committed demand and no active capacity row has Unknown capacity, and it is listed as 'Capacity conflict: {role} {YYYY-MM}', never passed.
5. **Commit authority.** A capacity commitment needs `capacity.commit` (BO and TO by default), checked through the policy function at transformation scope (ADR-0023 §9).
6. **Unpaged child lists refuse `limit`.** `GET /initiatives/{id}/gap-links`, `…/outcome-contributions`, `…/decision-links`, `…/deliverables`, `…/milestones`, `GET /business-cases/{id}/lines`, `GET /transformations/{id}/waves`, `…/resource-roles` and `GET /dependency-types` return `{items}` with no `nextCursor`. Their contract declares no `cursor` or `limit` parameter, only `includeArchived` where shown.
   - This is the contract's intent. They are bounded child lists of one parent record, or small catalogues, and they are returned whole.
   - Under ADR-0007 §5 (strict query objects), `limit` or `cursor` on them is **400**, not ignored.
   - A client pages only the `*Page` operations: `listInitiatives`, `listT08Dependencies`, `listCapacity`, `listResourceDemands`, `listBenefitFormulas`, the calculation lineage and so on. FE-A's `api/portfolio.ts` uses a plain GET for the unpaged lists (FE-A handback §5.3).
7. **Shared mirrors for the roadmap, T08 and capacity views.** `RoadmapWave(+List)`, `RoadmapView`, `DependencyType(Code)(+List)`, `T08Dependency(+Page)`, `PeriodMonth`, `ResourceRole(+List)`, `Capacity(+Page)`, `CapacityPlan(Cell)` and `ResourceDemand(+Page)` are now zod mirrors in `@mth/shared/schemas` (`roadmap.ts`). Before this, only the API route files defined them, and the web re-typed them by hand (FE-B handback §4.2, FE-A §5.4).
   - The API route files re-export them under their old names, and the contract seams validate against them.
   - The web's read-only TypeScript views (`pages/{roadmap,dependencies,capacity}/api.ts`, `api/types.ts`) are unchanged. A later web task switches them to the shared mirrors.

## Alternatives considered

1. **One `status` column carrying ranking, selection and funding without separate records.** Rejected: REQ-S09-003 asks for three distinct records and approvals; the status only mirrors them.
2. **Making G4 approval a launch precondition.** Rejected: the REQ-PB-004 acceptance says the launch succeeds after G2 and G3; B0009 names North Star, outcomes and target state, not the portfolio gate.
3. **Recording inherited approvals as `gate_decision` rows.** Rejected: the master prompt forbids fabricating approvals; a gate decision must be a person's decision recorded in the product.
4. **Adding the G1 agreement DB guard in `0024`.** Rejected: it would break the DG2 G1 approval before the API change ships; it moves to the backend task's migration with the API change.
5. **Initiatives as TOM evidence through `evidence_link`.** Rejected (B0059).

## Consequences

- New module `portfolio`; the module graph test is updated by the backend task.
- One behaviour change for existing clients (G1 approve needs `agreements`), documented above; everything else in DG2 stays byte-stable.
- G4 becomes submittable only when the backend task flips `submission_enabled` together with the evaluators.
- P4 extends `initiative` (execution status, `completed`), links RAID to the same `dependency` rows and adds T16 executive decisions on the same `decision` table.

## Verification

- **Migration probe** (`docs/delivery/handbacks/DG3/T-DG3-ARCH-01-evidence/`): fresh apply 0001→0024, apply over a P2-populated database, guards fire on the new tables (audit at COMMIT, version step, append-only, cycle-closing dependency).
- **Required integration tests (backend):** each §3 transition, success and every listed 422 with its exact text; End-to-End launch 422 then 200 after G2+G3; Modular inherited approval counts only when verified and accepted by another person; the G1 approve without agreements → 422 and with them → 200 plus three agreement rows; readiness lists `economics … technology` for a fresh transformation; G4 submit 422 naming 'Owners', 'Finance validation' and the initiative; G4 decide 403/403/409; a read-only auditor gets 403 on every P3 write; every S16-016 entity created and read through the API.
- **Required e2e (qa-verifier):** G4 happy path end to end with distinct synthetic users (TL submits, SP approves; FIN validates and funds).
