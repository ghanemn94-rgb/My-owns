# Permissions matrix: role × record × action

- **Task:** T-DG0-AN-02 (transformation-analyst). **Stage:** P0 / DG0. **Status:** specification only; nothing is implemented yet.
- **Sources:**
  - master prompt §10 (M0187, M0188, M0211, M0213), §6 (M0156), §12 (M0221, M0242) and §13 (M0255);
  - playbook minimum governance roles (B0018), T11 (B0099) and T12 RACI (B0101), through REQ-PB-012/013/065/067;
  - §16 (scoped authorization, audit) is AN-03's area and is referenced here only for context.
- **Requirements implemented by this matrix:** REQ-S10-001…004, REQ-S10-008…010, REQ-S10-014…019, REQ-S06-010, REQ-S12-003, REQ-S12-026, REQ-S13-014, REQ-PB-012 and REQ-PB-013.

The playbook is a practical synthesis *inspired by* PMI, Brightline and BRM, with custom extensions. Nothing here is an official PMI standard, a certified role model or a Mobily-approved access policy. Default assignments are a **configurable starting point**. Mobily's business owners must confirm them before production.

## 1. Roles

| Code | Role | Origin | Typical scope of assignment |
|---|---|---|---|
| SP | Executive Sponsor | Source (B0018) | Transformation |
| TL | Transformation Lead | Source (B0018) | Transformation |
| BO | Business Owner | Source (B0018) | Transformation, business unit, performance area |
| WL | Workstream Lead | Source (B0018) | Workstream, or initiatives within a transformation |
| FIN | Finance / Value Office | Source (B0018) | Transformation, or business unit (validator pool) |
| TO | Transformation Office | Source (B0018) | Organization or portfolio (PMO function) |
| KDS | KPI/Data Steward | Implementation (M0187) | KPIs or performance areas |
| TD | Tech/Data contributor | Implementation (M0187) | Initiatives, dimensions, dependencies |
| CM / SEC | Committee member / secretary | Implementation (M0187) | Forum |
| AUD | Read-only auditor | Implementation (M0187) | Organization, business unit or transformation (read-only) |
| ADM | System administrator (technical, access, or methodology admin sub-profiles) | Implementation (M0187) | Organization (technical configuration only) |

## 2. Scope rules (REQ-S10-002, REQ-S10-004)

1. **Every grant is a ScopedAssignment.** A grant is (user or governed group, role, scope). Scope is one of Organization, BusinessUnit, Portfolio, Transformation, Workstream/Initiative, PerformanceArea or Forum.
   - A grant at a wider scope covers narrower scopes only where the role row below says "inherits".
   - By default TO and AUD inherit downward. SP, TL, BO, WL, FIN, KDS and TD do **not** inherit to sibling transformations.
2. **Job title never grants access across all transformations.** No role is granted implicitly from HR attributes. Identity-provider groups map to scoped assignments explicitly, under IT control.
3. **Sensitive records** need an explicit record-level grant in addition to scope. Examples: named-person HR impacts in T13, commercially sensitive business-case lines and restricted evidence. Default holders are SP, TL, FIN and the record owner.
4. **One authorization layer is enforced on the server** for every path:
   - record reads and writes;
   - file download and preview (REQ-S13-014);
   - API calls;
   - exports and report generation;
   - search results and suggestions;
   - notification deep links (REQ-S12-024);
   - AI retrieval context (§17, AN-03).

   Unauthorized reads return 404 or 403 without leaking titles.
5. **Background jobs and connectors** act under the initiating user or a constrained service identity scoped to the rule (REQ-S12-003). A service identity never holds approval rights.
6. **Demo environment** users see only demo data. Production has no demo users (REQ-S18-001, REQ-S18-003; former REQ-S02-007 was consolidated into REQ-S18-001 in AN-04).

## 3. Action codes

| Code | Meaning |
|---|---|
| C | Create |
| U | Update (drafts, owned data) |
| S | Submit (for review, approval or validation) |
| Rv | Review, recommend, comment or consult (per T11/RACI "Consult"/"Recommend") |
| Ap | Approve or decide (business approval; the record keeps assignee, request version, due date, rationale, comments and timestamp, per REQ-S10-014) |
| Va | Finance validation (attestation) |
| Ac | Accept (receiving owner) |
| Cf | Configure (methodology/Studio, workflow, calendar, access) |
| V | View (scoped) |
| — | No access |

Unless stated otherwise, "own" means records where the user is the named owner or assignee.

## 4. Matrix (defaults, configurable)

| Record / action area | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Transformation (create, mode, entry phase) | V | C U | V | V | V | C U | V | V | V | V | — (technical support only) |
| Charter, thesis, scope checks, guardrails | Ap | C U S | Rv | V | Rv | U | V | V | V | V | — |
| T01 diagnostic, workstreams, value pools | V | C U S | Rv | C U (own) | Rv | U | V | Rv | V | V | — |
| Baseline registry | V | C U S | Rv | V | Va | V | C U S | V | V | V | — |
| North Star, outcomes, T02 tree | Ap | C U S | C U | V | Rv | V | U | V | V | V | — |
| KPI definition (dictionary) | V | C U S | Ap (per approval policy) | V | Rv | V | C U S | V | V | V | — |
| KPI actual (period value) | V | V | S (own KPI) | V | V | V | C S (assigned) | V | V | V | — |
| KPI actual acceptance (review route) | — | Ap (configurable) | Ap (configurable) | — | — | — | — | — | — | V | — |
| KPI definition/baseline/target change request; retrospective restatement | Ap (restatement authority) | C S | Ap | V | Rv / Va (financial impact) | V | C S | V | V | V | — |
| Manual RAG override | Ap | Ap (configured) | Ap (configured) | — | — | — | — | — | — | V | — |
| TOM canvas, T03 gaps, capabilities, journeys/processes, workshops | Rv (RACI C for Target Operating Model) | C U S | C U Ap (per T11 Target-state design) | C U (own) | Rv | V | V | C U Rv | V | V | — |
| T04 design decisions | V | C U | Ap (decision owner) | C | Rv | V | V | Rv | V | V | — |
| Gate submission (G1–G6) | V | C S | Rv | V | Rv | Rv | V | V | V | V | — |
| Gate decision (approve, reject, request changes, defer) | Ap (default) | — (the submitter cannot approve; SoD) | Ap where configured (G3 per T11 Target-state design; G5 per T11 Go-live / scale) | — | Rv (Finance criteria) | — | — | — | — | V | — (never) |
| Waiver or exception to mandatory evidence | Ap | S | Rv | — | Rv | Rv | — | — | — | V | — |
| Conditional approval (extension, disabled by default) | Ap | S | Ap where configured | — | — | — | — | — | — | V | Cf (enable only) |
| Modular entry: inherited records | V | C U | Rv | V | Rv | C U | V | V | V | V | — |
| T05 initiative card | V | C U S | Ap (RACI A: Initiative Delivery) | C U S | Rv | V | V | Rv | V | V | — |
| Business case (transformation, initiative) | Ap (RACI A) | C U S | Rv | C U (initiative case) | U Va (RACI R) | V | V | Rv | V | V | — |
| T06 scores | V | U | Rv | U (own initiatives) | U (financial value) | U | V | V | V | V | — |
| Scoring weights and rubrics | Ap | S | V | V | Rv | V | V | V | V | V | Cf (default set only) |
| Proposed ranking / portfolio selection / funding approval | V / Ap / Ap (SteerCo per T11) | C / S / S | Rv | V | Rv / Rv / Rv (co-recommender per T11) | V | V | V | V (SteerCo members vote as CM) | V | — |
| T07 waves and roadmap, milestones, rebaseline | Ap (rebaseline per T11) | C U S | Rv | U (own) | Rv (budget) | U | V | V | V | V | — |
| T08 / RAID dependency (canonical) | V | C U | Rv | C U | V | C U | V | C U | V | V | — |
| Resource / capacity plan | V | C U | Rv | C U | Rv | U | V | U | V | V | — |
| T09 benefit formula, formula versions | V | C U S | Rv | C U | Va | V | U | V | V | V | — |
| T14 benefit profile and allocations | V | C U | C U (accountable owner) | U (contribution) | Va (resolve overlaps) | V | U (measurements) | V | V | V | — |
| Benefit measurement / submit for validation | V | S | S | S | V | V | C S | V | V | V | — |
| Finance validation (baseline, formula, realized value, amendments or reversals) | — | — | — | — | Va (only FIN) | — | — | — | — | V | — (never) |
| Valuation method for non-financial benefits; NPV/ROI assumptions | V | Rv | Rv | — | Ap Cf | V | — | — | — | V | Cf (enable extension only) |
| T10 and other dashboards | V | V | V | V (workstream) | V | V | V | V | V | V | — (except the operations dashboard) |
| T11 decision rights matrix | Ap | U | Rv | V | Rv | U | V | V | V | V | — |
| T11 decision "Go-live / scale" for an initiative (B0099: Recommend Initiative owner; Approve Business owner; Consult Risk / Tech / CX; Inform SteerCo) | V | Rv | Ap (Business owner) | S Rv (as initiative owner: Recommend) | V | Rv (Risk consult, via RAID) | V | Rv (Tech consult) | V (SteerCo members: Inform) | V | — |
| T12 RACI (per transformation, versioned) | Ap | U | Rv | V | Rv | U | V | V | V | V | — |
| Forums, recurrence, cut-offs | V | Rv | V | V | V | Cf | V | V | U (SEC) | V | Cf (calendar only) |
| Meeting: agenda, attendance/quorum, minutes, actions | Ap (chair, where SP chairs) | C U | V | V | V | U | V | V | SEC: C U S; CM: Rv; chair: Ap (minutes) | V | — |
| T16 executive decision / executive ask | Ap (decision owner) | C S | Ap (when owner) | V | Rv | C | V | V | SEC: C | V | — |
| T13 stakeholders, interventions, feedback forms | V | C U | C U | C U | V | V | V | V | V | V (non-sensitive) | — |
| Adoption indicators and actuals | V | U | S | V | V | V | C S | V | V | V | — |
| T15 RAID (risk, assumption, issue) | V | C U | Rv | C U | V | C U | V | C U | V | V | — |
| Corrective action / recovery plan | V | C U | C U (owner) | U (own) | C | C U | V | V | V | V | — |
| BAU handover | V | C U S | Ac (receiving owner only; A/R per RACI) | C U S | Rv | V | Ac (as KPI owner, where named) | Rv | V | V | — |
| Controls, control checks, lessons, CI backlog, reopen performance area | V | U | C U; reopen | U | V | C U | U | V | V | V | — |
| Evidence item (upload, review, download) | as parent | as parent | as parent | as parent | as parent | as parent | as parent | as parent | as parent | V as parent | — (storage administration only; no content access by default) |
| Reports, exports, snapshots (issue) | V | C (issue) | V | V | V | C (issue) | V | V | SEC: C (packs) | V | — |
| Delegation | own | own | own | own | own | own | own | own | own | — | C on documented request (audited) |
| Methodology config (Playbook Studio, procedures, forms, formulas library) | — | Rv (reviewer, where configured) | — | — | Rv (formula changes) | Rv | — | — | — | V | Cf (draft, preview, publish; methodology admin) |
| Methodology migration of a pinned transformation | Ap (if policy-affecting) | Ap | — | — | Rv | Rv | — | — | — | V | Cf (plan) |
| Automation rules, failure queue, jobs | — | — | — | — | — | V | — | — | — | V | Cf (rules; retry) |
| Organization, business units, calendar, branding, notification channels | — | — | — | — | — | V | — | — | — | V | Cf |
| Access administration (scoped assignments) | — | assign within own transformation (non-approver roles) | — | — | — | assign within portfolio | — | — | — | V | Cf (access admin) |
| Requirement register view, About/provenance | V | V | V | V | V | V | V | V | V | V | V |
| Audit log | — | V (own transformation) | — | — | V (financial records) | V | — | — | — | V | V (technical events; cannot modify) |

## 5. Separation of duties and approval rules

1. **Requester ≠ approver** (REQ-S10-016). Under the default policy the server rejects an approval by the requester, or by the requester's delegate acting for the requester. A configured exception must be named in the policy and audited.
2. **Technical administrators are not business approvers** (REQ-S10-003, REQ-S06-010).
   - ADM has no Ap or Va right on any business record.
   - A person who also holds a business role gets approvals only through that separately assigned scoped role, and the assignment is audited.
   - Studio refuses configurations that make ADM an automatic approver (REQ-S06-006).
3. **Finance validation is exclusive to FIN** (REQ-PB-013). This holds even where the Business Owner remains accountable (M0211).
4. **Stale approvals are rejected.** An approval must reference the current submitted version (REQ-S10-017).
5. **Automation never approves.** Timers escalate, route and remind. They never set approve or validate outcomes (REQ-S10-019, REQ-S12-026).
6. **One accountable per deliverable.** The exception is a documented governance rule; "A/R" counts as one accountable (REQ-S10-009).
7. **Gate approvals** default to SP. The playbook's gate table (B0023) names no approver, and B0018 gives the Sponsor "approves major trade-offs". Where a T11 decision (B0099) matches what a gate decides, the gate's approver can be configured to the T11 approver:
   - G3 Target State: BO, per T11 "Target-state design" (REQ-PB-018, REQ-S04-005);
   - G5 Scale: BO, per T11 "Go-live / scale" (REQ-PB-020, REQ-S04-007).

   The default is configurable per gate. G5 is the **transformation-level** gate ("Are pilots/results sufficient to scale?"). T11 "Go-live / scale" decisions taken on **individual initiatives** (Recommend: initiative owner; Approve: BO; Consult: Risk/Tech/CX; Inform: SteerCo) are separate decision records, with their own row in the matrix above, and they feed G5's decision-log evidence. An initiative-level go-live approval never approves G5, and G5 approval does not replace the initiative-level decisions. The G6 product gate has no relation to engineering gate DG7. (AN-05, finding F-DG0-002.)
8. **Waivers** cannot be approved by the requester or by ADM (REQ-S04-013).

## 6. Delegation (REQ-S10-010)

- Delegation is time-bound (`effective_from`, `effective_to`), scoped (all, or listed record types) and reasoned (absence, other).
- Every action records both identities ("B on behalf of A").
- Circular chains (A→B→A, or A→B→C→A) are rejected. So is delegation to the requester of a pending item, which would bypass SoD.
- Delegated rights never exceed the delegator's rights. Expiry revokes them automatically. The expiry job is idempotent.

## 7. Implementation assumptions (flagged, not source)

- The action codes per cell, the default gate approver (SP) and the sub-profiles of ADM (technical, access, methodology) are **implementation assumptions** derived from B0018, T11 and T12 and from §10. The domain reviewer and Mobily business owners must confirm them.
- Sensitive-record categories are placeholders until Mobily defines its data classification.
- In the T11 "Go-live / scale" row, the T11 roles map to matrix roles as follows. "Initiative owner" is the initiative's named owner, recorded on T05 and typically the WL, or the BO where the BO owns it. "Risk" consultees act through the TO's RAID responsibility (B0018). "Tech" is TD. "CX" has no separate matrix role and is consulted as a named person under Rv on the decision record. "SteerCo" is its CM members. This mapping is an implementation assumption.
- Revision T-DG0-AN-05 (finding F-DG0-002): SP now has Rv (RACI "C", B0101) instead of V on the TOM row; the T11 "Go-live / scale" row was added; rule 7 was clarified.

## 8. P2 implementation (DG2): permission codes and per-entity rights

- **Added by:** T-DG2-ARCH-01B (solution-architect), 2026-10-02.
- **Implements:** sections 1–5 above for the P2 records. The design is ADR-0020; the seed is migration `0018`, mirrored in `packages/shared/src/permissions.ts`.
- **Status:** these are configurable defaults and implementation assumptions. Mobily's business owners must confirm them before production.

### 8.1 Role catalogue (all eleven §10 roles, 14 role codes)

| Code | Role | Kind | Inherits downward | P2 rights in one line |
|---|---|---|---|---|
| SP | Executive Sponsor | source | no | Approves gates (default approver), approves KPI target trajectories, decides decisions they own |
| TL | Transformation Lead | source | no | Drafts charter/North Star/outcomes/T01–T04/TOM; submits gates; reviews evidence; assigns non-approver team roles |
| BO | Business Owner | source | no | Edits outcomes and TOM; approves KPI targets; decides decisions they own; G3 approver where configured |
| WL | Workstream Lead | source | no | Contributes T01/TOM rows (own); creates decisions and dependencies |
| FIN | Finance / Value Office | source | no | Validates baselines and value pools (`finance.validate`); reviews evidence |
| TO | Transformation Office | source | **yes** | Charter and diagnostic editing; configures gate approvers; dependencies and actions; assigns non-approver team roles |
| KDS | KPI/Data Steward | implementation | no | KPI definitions, baselines, outcomes/T02 rows |
| TD | Tech/Data contributor | implementation | no | TOM contributions (own), dependencies |
| CM | Committee member | implementation | no | Read only in P2 (forums are P4) |
| SEC | Committee secretary | implementation | no | Read only in P2 (meetings are P4) |
| AUD | Read-only auditor | implementation | **yes** | **Read only. Every write returns 403** (REQ-S10-001 A12) |
| ADM_TECH | System administrator (technical) | technical_admin | no | No business-record rights; never an approver |
| ADM_ACCESS | System administrator (access) | technical_admin | no | User/assignment administration only; never an approver |
| ADM_METHOD | System administrator (methodology) | technical_admin | no | `methodology.configure`: TOM-dimension labels and translations only; never an approver |

### 8.2 P2 permission catalogue

| Code | Category | Meaning |
|---|---|---|
| `north_star.edit` | write | Create and refine the North Star |
| `charter.edit` | write | Draft and version the charter, thesis, scope checks and strategic guardrails |
| `outcome.edit` | write | Outcomes and T02 Outcome & KPI Tree rows |
| `kpi_definition.edit` | write | KPI definitions |
| `kpi_target.approve` | **business_approval** | Approve a KPI target trajectory (never the row's creator) |
| `baseline.edit` | write | Baselines |
| `diagnostic.edit` | write | T01, findings, workstream outputs, value pools (any row) |
| `diagnostic.contribute` | write | Create diagnostic records; edit own only |
| `tom.edit` | write | TOM canvas, T03 gaps, capabilities, journeys (any row) |
| `tom.contribute` | write | Create TOM records; edit own only |
| `workshop.facilitate` | write | Run TOM workshops; convert unresolved items |
| `decision.edit` | write | Create and edit design decisions (T04) |
| `decision.decide` | write (owner-only) | Record the outcome of a design decision **the caller owns**; not a gate or Finance approval |
| `dependency.edit` | write | Canonical dependency records |
| `action.edit` | write | Any action |
| `action.update_own` | write | Actions the caller owns |
| `evidence.create` | write | Add evidence; link it to records the caller may edit |
| `evidence.review` | write | Verify or reject evidence; never the caller's own |
| `gate.submit` | write | Submit G1–G6 (P2: G1–G3) |
| `gate.configure` | configure | Configure a gate's approver (role from the allowed list, optional named user) |
| `team.assign` | configure | Assign WL, KDS, TD, CM, SEC at the caller's transformation |
| `methodology.configure` | configure | Edit methodology display labels and translations |

The P1 permissions that P2 uses are `gate.decide` (business_approval: SP, BO) and `finance.validate` (finance_validation: FIN).

### 8.3 Per-entity rights in P2

Legend: **C** create, **E** edit (incl. archive), **E(own)** edit own rows only, **V** view, **D** decide/approve/validate, **—** none. V means the role can see the record at all; every role with `transformation.read` in scope has it. Every cell is checked server-side by the one policy function plus the record-level rule.

| Entity (table) | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM_* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Charter + versions (`charter`, `charter_version`) | V | C E | V | V | V | C E | V | V | V | V | — |
| North Star (`north_star`) | V | C E | V | V | V | V | V | V | V | V | — |
| Strategic guardrails (`strategic_guardrail`) | V | C E | V | V | V | C E | V | V | V | V | — |
| Outcomes (`outcome`) | V | C E | C E | V | V | V | C E | V | V | V | — |
| T02 Outcome & KPI Tree (`outcome_kpi`) | D (trajectory) | C E | C E D (trajectory) | V | V | V | C E | V | V | V | — |
| KPI definitions (`kpi_definition`) | V | C E | V | V | V | V | C E | V | V | V | — |
| Baselines (`baseline`) | V | C E | V | V | D (validate) | V | C E | V | V | V | — |
| Value pools (`value_pool`) | V | C E | V | V | D (validate) | C E | V | V | V | V | — |
| T01 diagnostic (`diagnostic_item`) | V | C E | V | C E(own) | V | C E | V | V | V | V | — |
| Diagnostic findings, workstream outputs | V | C E | V | C E(own) | V | C E | V | V | V | V | — |
| TOM canvas cells (`tom_canvas_cell`) | V | E | E | V | V | V | V | V | V | V | — |
| T03 TOM gaps, capabilities, journeys, pain points | V | C E | C E | C E(own) | V | V | V | C E(own) | V | V | — |
| TOM workshops, items, conversion | V | C E | C(item) | C(item) | V | V | V | C(item) | V | V | — |
| T04 design decisions (`decision` kind design) | D (own) | C E D (own) | D (own) | C E D (own) | V | V | V | V | V | V | — |
| Dependencies (`dependency`) | V | C E | V | C E | V | C E | V | C E | V | V | — |
| Actions (`action_item`) | E(own) | C E | E(own) | E(own) | E(own) | C E | E(own) | E(own) | V | V | — |
| Evidence + links (`evidence`, `evidence_link`) | V | C E D (review) | C E D (review) | C E | C E D (review) | C E D (review) | C E | C E | V | V | — |
| Gate instance: approver configuration | V | V | V | V | V | E | V | V | V | V | — |
| Gate submission (`gate_submission`) | V | C | V | V | V | V | V | V | V | V | — |
| Gate decision (`gate_decision`) | D (default approver) | — (submitter; SoD) | D where configured (G3) | — | V | — | — | — | — | V | — (never) |
| Team assignments (transformation scope) | V | C (WL, KDS, TD, CM, SEC) | V | V | V | C (WL, KDS, TD, CM, SEC) | V | V | V | V | ADM_ACCESS: all roles via `/role-assignments` |
| Methodology labels (`tom_dimension` labels) | V | V | V | V | V | V | V | V | V | V | ADM_METHOD: E |

**Read-only auditor (AUD) write-deny.**
- AUD holds only `read`-category permissions and inherits them downward from its assigned scope.
- Every P2 mutating operation declares a write, configure or approval permission, so AUD gets **403** (not 404, because AUD can read the record) and nothing is written.
- `packages/db/src/seed.test.ts` asserts AUD's catalogue. The P2 integration suite must call every mutating P2 operation as AUD and expect 403 (ADR-0020 §4).

**Changes against sections 1–5, all flagged as assumptions:**
- T04 "Ap (decision owner)" is implemented as `decision.decide` with an owner-only record rule. It is available to SP, TL, BO and WL, so whichever of them is the named T04 owner decides (B0065 names a decision owner, not a role).
- "Charter: SP Ap" and "North Star/outcomes: SP Ap" are exercised through the G1/G2 gate decisions, not a separate charter approval.
- TL's team-assignment right is narrowed to roles without approval or assignment rights.

## 9. P3 implementation (DG3): permission codes and per-entity rights

- **Added by:** T-DG3-ARCH-01 (solution-architect), 2026-10-07.
- **Implements:** sections 1–5 for the P3 records (Mobilize: portfolio, T05–T09, business cases, capacity, funding, G4). The design is ADR-0021…0024. The seed is migration `0024`, mirrored in `packages/shared/src/permissions.ts` (`P3_PERMISSIONS`, `P3_ROLE_PERMISSIONS`) and compared by `packages/db/src/seed.test.ts`.
- **Status:** configurable defaults and implementation assumptions. Mobily's business owners must confirm them before production. The product records business approvals as a named person's decision; no engineering agent, seed or job grants a real business, Finance or IT approval. G1–G6 are product gates, never DG0–DG7.

### 9.1 P3 permission catalogue

| Code | Category | Meaning | Default roles |
|---|---|---|---|
| `initiative.edit` | write | Create and edit initiatives, their links, deliverables and milestones; submit, withdraw, cancel | TL, WL, TO |
| `initiative.launch` | write | Launch a funded initiative when the sequencing rules allow it | TL |
| `portfolio.select` | business_approval | Approved portfolio selection / deselection | SP |
| `prioritization.score` | write | Enter T06 scores | TL, WL, BO |
| `prioritization.edit` | write | Propose weight sets, ranking snapshots and overrides | TL, TO |
| `prioritization.approve` | business_approval | Approve weight sets and overrides (never the proposer) | SP |
| `roadmap.edit` | write | Waves, wave assignment, milestone forecasts | TL, WL, TO |
| `roadmap.approve` | write | Approve milestone baseline dates | TL, TO |
| `deliverable.accept` | write | Accept or reject deliverables (record-level: the initiative's executive owner or delegate) | SP, TL, BO |
| `capacity.edit` | write | Resourcing roles, capacity, demand | TL, WL, TO |
| `capacity.commit` | write | Commit or release demand against capacity (record-level: the capacity owner, or transformation scope) | BO, TO |
| `funding.approve` | business_approval | Record a funding decision (canonical executive decision) | SP, FIN |
| `business_case.edit` | write | Business cases and lines (WL: record-level, initiative cases of initiatives they lead) | TL, WL, TO |
| `benefit_formula.edit` | write | T09 formulas and versions, calculations | TL, BO, KDS |
| `dependency_type.configure` | configure | Add, relabel and retire custom dependency types | ADM_METHOD |

P1/P2 permissions that P3 uses: `finance.validate` (FIN: business-case baselines and formula versions; never the author), `gate.submit` (TL: G4 submission, dispensation records), `gate.decide` (SP, BO: G4 decision, dispensation acceptance; G1 agreement confirmations), `gate.configure` (TO), `dependency.edit` (TL, WL, TO, TD: T08 rows), `decision.edit` (required decisions).

### 9.2 Per-entity rights in P3

Legend as in 8.3. **D** = decide/approve/validate. Every cell is checked server-side by the one policy function, re-authorised at commit (BE18A pattern), plus the record-level rule named.

| Entity (table) | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM_* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Initiative T05 (`initiative` + gap links, contributions, decision links) | V | C E, launch | V | C E | V | C E | V | V | V | V | — |
| Selection (`portfolio_selection`) | D | V | V | V | V | V | V | V | V | V | — |
| Funding decision (`funding_decision`) | D | V | V | V | D | V | V | V | V | V | — |
| Deliverables (`deliverable`) | D (accept, own initiative) | C E, D (own initiative) | D (accept, own initiative) | C E | V | C E | V | V | V | V | — |
| Milestones (`milestone`) | V | C E D (approved date) | V | C E | V | C E D (approved date) | V | V | V | V | — |
| Waves T07 (`roadmap_wave`) | V | C E | V | C E | V | C E | V | V | V | V | — |
| Weight sets T06 (`scoring_weight_set`, `scoring_weight`) | D | C | V | V | V | C | V | V | V | V | — |
| Scores (`initiative_score`; results read-only) | V | C E | C E | C E | V | V | V | V | V | V | — |
| Ranking snapshots (`ranking_snapshot`, `ranking_entry`) | V | C | V | V | V | C | V | V | V | V | — |
| Ranking overrides (`ranking_override`) | D | C | V | V | V | C | V | V | V | V | — |
| T08 dependencies (`dependency`) | V | C E | V | C E | V | C E | V | C E | V | V | — |
| Dependency types (`dependency_type`) | V | V | V | V | V | V | V | V | V | V | ADM_METHOD: C E (custom only) |
| Resource roles, capacity, demand | V | C E | commit | C E | V | C E, commit | V | V | V | V | — |
| Business cases + lines (`business_case`, `business_case_line`) | V | C E | V | C E (own initiatives) | D (baseline) | C E | V | V | V | V | — |
| T09 formulas, versions, calculations | V | C E | C E | V | D (version) | V | C E | V | V | V | — |
| Gate dispensations (`gate_dispensation`) | D (accept) | C | D (accept, where approver) | V | V | V | V | V | V | V | — |
| G4 (`gate_*`, reused) | D (default approver) | submit | D (if configured) | V | V | configure approver | V | V | V | V | — |
| G1 agreement confirmations (`gate_decision_agreement`) | D (with the G1 approval) | V | D (if configured approver) | V | V | V | V | V | V | V | — |

**Rules (binding for the P3 implementers):**

- **AUD (read-only auditor):** every P3 mutating operation returns **403** for AUD (it can read, so not 404) and writes nothing. The P3 integration suite calls every mutating P3 operation as AUD and expects 403.
- **Separation of duties:** the weight-set approver ≠ proposer; override approver ≠ proposer (DB CHECKs); a dispensation is accepted by someone other than its recorder; Finance validation ≠ author (DB CHECKs); deliverable acceptor ≠ submitter; G4 decision never by the submitter (ADR-0015 trigger, 403).
- **Technical admins:** `dependency_type.configure` is the only P3 right of any technical-admin role; it is `configure`, never an approval (the `0001` trigger refuses a technical admin holding `business_approval`/`finance_validation`).
- **Changes against sections 1–5, flagged as assumptions:** FIN may record funding decisions (B0018 "validates … value realization"; the funding approver may be configured to SP only); TL launches initiatives (execution authority after the business approvals); capacity commitments are a resourcing commitment by BO/TO, not a business approval.

## 10. P4 implementation, slices I and C (DG4): permission codes and per-entity rights

- **Added by:** T-DG4-ARCH-01 (solution-architect), 2026-10-09.
- **Implements:** sections 1–6 for the P4 foundation and governance records: business calendars, job schedules, My Work items and the inbox (ADR-0025); groups, role mapping, delegation, the P4 approval record, T11 and T12 (ADR-0026). The seed is migration `0031`, mirrored in `packages/shared/src/permissions.ts` (`P4_PERMISSIONS`, `P4_ROLE_PERMISSIONS`) and compared by `packages/db/src/seed.test.ts`. Later P4 slices append their own subsections.
- **Status:** configurable defaults and implementation assumptions. Mobily's business owners must confirm them before production. A P4 approval is a business approval recorded as a named person's decision; no engineering agent, seed or job grants a real business, Finance or IT approval, and a timer never decides one. G1–G6 are product gates, never DG0–DG7.

### 10.1 P4 permission catalogue (slices I and C)

| Code | Category | Meaning | Default roles |
|---|---|---|---|
| `calendar.configure` | configure | Business calendars: timezone, workweek, holidays | ADM_TECH |
| `job.read` | read | View the scheduled jobs | ADM_TECH |
| `job.configure` | configure | Enable, disable, reschedule jobs | ADM_TECH |
| `group.manage` | configure | Governed groups and their members | TO |
| `role_mapping.assign` | configure | Map governance parties to people or groups in a transformation | TL, TO |
| `delegation.create_own` | write | Delegate your own approvals for a period | SP, TL, BO, WL, FIN, TO, KDS, TD, CM, SEC |
| `delegation.manage` | configure | Record or revoke a delegation on the delegator's request | ADM_ACCESS |
| `approval.request` | write | Request a T11-routed approval | SP, TL, BO, WL, FIN, TO |
| `approval.decide` | business_approval | Decide an approval assigned to you, your group, escalated to you, or to someone you act for | SP, BO, FIN |
| `decision_right.configure` | configure | Edit the transformation's T11 matrix; submit it for approval | TL, TO |
| `raci.edit` | write | Edit the transformation's T12 RACI; submit it for approval | TL, TO |

`approval.decide` goes only to the roles that already hold an approval permission (SP, BO, FIN). TL, TO, WL and CM stay non-approver roles, so the creator-derived assignment (F-DG1-106) and the team view (ADR-0020 §3) are unchanged (ADR-0026 §8). P1 permissions that P4 slices I and C use: `organization.read` (calendars, groups, parties; every role), `transformation.read` (mappings, T11, T12, approvals, readiness), `audit.read` (the "B on behalf of A" trail).

### 10.2 Per-entity rights in P4 (slices I and C)

Legend as in 8.3. **D** = decide/approve. Every cell is checked server-side by the one policy function and re-authorised at commit, plus the record-level rule named.

| Entity (table) | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM_* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Business calendar, holidays (`business_calendar`, `business_calendar_holiday`) | V | V | V | V | V | V | V | V | V | V | ADM_TECH: C E; others V |
| Job schedules (`job_schedule`) | — | — | — | — | — | — | — | — | — | — | ADM_TECH: V E |
| My Work items (`work_item`) | own: V, complete | own | own | own | own | own | own | own | own | own: V only (none assigned) | own |
| Inbox (`inbox_notification`) | own: V, mark read | own | own | own | own | own | own | own | own | own: V only | own |
| Groups (`access_group`, `access_group_member`) | V | V | V | V | V | C E | V | V | V | V | V |
| Governance parties (`governance_party`, seed) | V | V | V | V | V | V | V | V | V | V | V |
| Role mappings (`role_mapping`) | V | C E (end) | V | V | V | C E (end) | V | V | V | V | — |
| Delegations (`delegation`) | C (own), revoke own | C (own) | C (own) | C (own) | C (own) | C (own) | C (own) | C (own) | C (own) | V (own, none created) | ADM_ACCESS: C, revoke (on request; never to self) |
| Approvals (`approval`, `approval_decision`, `approval_escalation`) | request; D (assigned) | request | request; D (assigned) | request | request; D (assigned) | request | V | V | V | V | — |
| T11 (`transformation_decision_right`; template seed) | V | C E, submit | V | V | V | C E, submit | V | V | V | V | — |
| T12 (`transformation_raci_deliverable`, `transformation_raci_assignment`; template seed) | V | C E, submit | V | V | V | C E, submit | V | V | V | V | — |
| Matrix approval (`governance_matrix` via `governance_matrix_change`) | D (as the SP-mapped person) | V | V | V | V | V | V | V | V | V | — |
| Transform readiness (read model) | V | V | V | V | V | V | V | V | V | V | — |

**Rules (binding for the P4 slice I and C implementers):**

- **AUD (read-only auditor):** every mutating operation of slices I and C returns **403** for AUD (or 404 where the record is another person's own item) and writes nothing. The slice's integration tests call every mutating operation as AUD.
- **Separation of duties (REQ-S10-016):** under the default policy `requester_excluded` the requester, and anyone acting on the requester's behalf, gets **403** `approval.sod_requester` on every outcome; the database refuses it again (`approval_decision_sod`). Delegating to the requester of an approval that is pending with the delegator is refused (422 `delegation.delegate_is_requester`).
- **Technical admins (REQ-S10-003):** ADM_TECH configures calendars and jobs; ADM_ACCESS records delegations on request. No technical-admin role holds `approval.decide`: the `0001` trigger refuses it, and an ADM-only user gets **403** on `decideApproval` and on the DG1–DG3 gate and Finance endpoints. Being added to a group or mapped to a party grants no permission.
- **Record-level rules:** deciding needs the approval to be assigned to the caller, an effective member of the assignee group, the escalation target, or an active delegate of one of these (ADR-0026 §4 rule 3); work items and inbox reminders are the assignee's and recipient's only.
- **Delegation (section 6 made concrete):** no loop in any form (database trigger, lock 730224); capability = the delegator's, checked at use time against the effective window; "B on behalf of A" in the audit trail (ADR-0026 §3).
- **Changes against sections 1–6, flagged as assumptions:** groups grant no permission in P4 (IdP group mapping stays P6); FIN may decide P4 approvals routed to Finance parties (consistent with its existing `funding.approve`); the escalation chain defaults to the Approve party, then SP (D-089 Q7).

## 11. P4 implementation, slice A (DG4): KPI engine permission codes and per-entity rights

- **Added by:** T-DG4-ARCH-02 (solution-architect), 2026-10-09.
- **Implements:** sections 1–6 for the KPI engine: KPI versions (dictionary v2), formula inputs, RAG threshold versions, reporting periods, target trajectories, actuals and their review, calculation runs, data-quality findings and RAG overrides (ADR-0027, ADR-0028). The seed is migration `0036_p4_kpi_permissions_backfill.sql`, equal to `P4_KPI_PERMISSIONS` / `P4_KPI_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`).
- **Status:** configurable defaults and implementation assumptions. Mobily's business owners must confirm them before production. Trajectory approval and KPI-version approval are business approvals recorded as a named person's decision; no engineering agent, seed or job grants a real business, Finance or IT approval.

### 11.1 P4 permission catalogue (slice A)

| Code | Category | Meaning | Default roles |
|---|---|---|---|
| `kpi_version.edit` | write | Create, edit and withdraw draft KPI versions and their formula inputs | TL, KDS |
| `kpi_version.activate` | write | Activate a KPI version (directly, or after its business approval); request that approval | TL, KDS |
| `kpi_threshold.configure` | write | Set a new RAG threshold version | TL, KDS |
| `target_trajectory.edit` | write | Create and withdraw draft target trajectories | TL, KDS |
| `reporting_period.manage` | configure | Create, open and close reporting periods | TO |
| `kpi_actual.submit` | write | Enter and submit KPI actuals with evidence | KDS, BO |
| `kpi_actual.accept` | write | Accept or reject submitted actuals as the configured reviewer | SP, TL, BO |
| `rag.override` | write | Override a calculated RAG with reason, evidence and expiry; revoke | TL, BO |
| `data_quality.manage` | write | Resolve or dismiss data-quality findings | TL, KDS |
| `kpi_target.approve` (P2, reused) | business_approval | Approve a target trajectory | SP, BO |
| `approval.decide` (P4 slices I/C, reused) | business_approval | Decide a `kpi_version_activation` approval | SP, BO, FIN |

None of the nine new codes is `business_approval` or `finance_validation`, so the creator-derived assignment (F-DG1-106) and the team view (ADR-0020 §3) are unchanged. AUD and the technical-admin roles (ADM_TECH, ADM_ACCESS, ADM_METHOD) hold none of them (REQ-S10-003).

### 11.2 Per-entity rights in P4 (slice A)

Legend as in 8.3. **D** = decide/approve. Every cell is checked server-side by the one policy function and re-authorised at commit, plus the record-level rule named.

| Entity (table) | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM_* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| KPI dictionary v2 (`kpi_definition` + `kpi_version`, `kpi_formula_input`) | V | C E, activate, withdraw | V | V | V | V | C E, activate, withdraw | V | V | V | — |
| KPI version business approval (`approval` type `kpi_version_activation`) | D (assigned) | request | D (assigned; default assignee) | V | D (assigned) | V | request | V | V | V | — |
| RAG thresholds (`kpi_rag_threshold`) | V | C | V | V | V | V | C | V | V | V | — |
| Reporting periods (`reporting_period`) | V | V | V | V | V | C, open, close | V | V | V | V | — |
| Target trajectories (`target_trajectory`, `target_trajectory_point`) | D (not the creator) | C, withdraw | D (not the creator) | V | V | V | C, withdraw | V | V | V | — |
| KPI actuals (`kpi_actual`, values, reviews, evidence) | accept/reject (reviewer) | accept/reject (reviewer) | C submit (owner/steward/assignee); accept/reject (reviewer) | V | V | V | C submit (owner/steward/assignee) | V | V | V | — |
| Calculation runs, evaluations (`calculation_run`, `kpi_evaluation`) | V | V | V | V | V | V | V | V | V | V | — |
| KPI status panel (read model) | V | V | V | V | V | V | V | V | V | V | — |
| RAG overrides (`rag_override`) | V | C, revoke | C, revoke | V | V | V | V | V | V | V | — |
| Data-quality findings (`data_quality_finding`) | V | resolve/dismiss | V | V | V | V | resolve/dismiss | V | V | V | — |

**Rules (binding for the slice A implementers):**

- **AUD (read-only auditor):** every mutating slice A operation returns **403** for AUD and writes nothing; every read returns 200 within AUD's scope. KBE-B and KBE-C test this on each of their operations (p4-work-split S-4).
- **Technical admins (REQ-S10-003):** no technical-admin role holds a slice A permission; an ADM-only user gets 403 on every slice A mutation, including `approveTargetTrajectory` (a business approval).
- **Record-level rules:** submitting needs the KPI's owner or steward, or the assignee of its open `kpi_update_due` work item (403 `kpi_actual.not_owner`); accepting or rejecting needs `kpi_actual.accept`, resolution to the version's `reviewer_party_code` through the role mapping, and not being the submitter (403 `kpi_actual.not_reviewer`, `kpi_actual.sod_submitter`; database `kpi_actual_review_sod`); approving a trajectory needs `kpi_target.approve` and not being its creator (403 `target_trajectory.approver_is_author`).
- **RAG override (REQ-S07-009):** only `rag.override` holders (TL, BO); anyone else gets 403. Reason, evidence and expiry are required; the calculated RAG is preserved and shown again after expiry.
- **Changes against sections 1–6, flagged as assumptions:** BO submits actuals (REQ-S07-003 "submit:KDS,BO (assigned)"); SP, TL and BO may act as the configured reviewer (REQ-S07-012 "accept:configured reviewer"); TL and KDS configure thresholds (REQ-S07-007); TO manages the organization's reporting periods.

## 12. P4 implementation, slice B (DG4): benefits and Finance validation permission codes and per-entity rights

- **Added by:** T-DG4-ARCH-03 (solution-architect), 2026-10-09.
- **Implements:** sections 1–6 for the benefits engine: the T14 register, lifecycle, enablers, allocations, shared-benefit groups, overlap warnings, scenarios, valuation methods, planned/forecast values, measurements, the Finance validation queue and decisions, amendments and reversals, and totals (ADR-0029, ADR-0030). The seed is migration `0040_p4_benefit_permissions.sql`, equal to `P4_BENEFIT_PERMISSIONS` / `P4_BENEFIT_ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` (`packages/db/src/seed.test.ts`).
- **Status:** configurable defaults and implementation assumptions. Mobily's business owners and Finance must confirm them before production. A Finance validation is a named Finance user's decision; no engineering agent, seed or job grants a real business, Finance or IT approval.

### 12.1 P4 permission catalogue (slice B)

| Code | Category | Meaning | Default roles |
|---|---|---|---|
| `benefit.edit` | write | Create, edit and archive benefits; enablers; planned and forecast values; propose valuation methods; raise overlap warnings | TL, BO |
| `benefit.advance` | write | Move a benefit through the six lifecycle steps | BO |
| `benefit.allocate` | write | Replace a benefit's contribution allocations | TL, BO |
| `benefit.measure` | write | Record measurements with evidence and submit them for Finance validation | BO, WL, KDS |
| `benefit_scenario.edit` | write | Create and edit base, upside and downside scenarios and their values | TL, FIN |
| `benefit_group.manage` | write | Create and edit shared-benefit groups; name the counted member | TL, BO |
| `finance.validate` (P1, reused) | finance_validation | Decide Finance validations (six items), amend and reverse validated values, validate baselines, decide valuation methods, resolve overlaps | FIN |

None of the six new codes is `business_approval` or `finance_validation`, so the creator-derived assignment (F-DG1-106) and the team view (ADR-0020 §3) are unchanged. AUD and the technical-admin roles (ADM_TECH, ADM_ACCESS, ADM_METHOD) hold none of them, and no technical-admin role can hold `finance.validate` (trigger `role_permission_no_admin_approver`; REQ-S10-003).

### 12.2 Per-entity rights in P4 (slice B)

Legend as in 8.3. **D** = decide/validate. Every cell is checked server-side by the one policy function and re-authorised at commit, plus the record-level rule named.

| Entity (table) | SP | TL | BO | WL | FIN | TO | KDS | TD | CM/SEC | AUD | ADM_* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Benefit register (`benefit`, `benefit_enabler`, `benefit_lifecycle_event`) | V | C E, archive | C E, archive, advance | V | V | V | V | V | V | V | — |
| Benefit baseline validation (`benefit` baseline columns) | V | V | V | V | D (not the owner) | V | V | V | V | V | — |
| Planned / forecast values (`benefit_plan_value`) | V | C E | C E | V | V | V | V | V | V | V | — |
| Allocations (`benefit_allocation`) | V | replace | replace | V | V | V | V | V | V | V | — |
| Shared-benefit groups (`benefit_group`) | V | C E | C E | V | V | V | V | V | V | V | — |
| Overlap warnings (`benefit_overlap`) | V | raise | raise | V | D resolve (not an owner of either benefit) | V | V | V | V | V | — |
| Scenarios (`benefit_scenario`, `benefit_scenario_value`) | V | C E | V | V | C E | V | V | V | V | V | — |
| Valuation methods (`benefit_valuation_method`) | V | propose | propose | V | D (not the proposer) | V | V | V | V | V | — |
| Measurements (`benefit_measurement`, inputs, evidence) | V | V | C E submit | C E submit | amend, reverse (as Finance corrections) | V | C E submit | V | V | V | — |
| Finance validation queue and decisions (`finance_validation`) | V | V | V | V | D (not the submitter) | V | V | V | V | V | — |
| Value series and totals (`benefit_value_line`, `benefit_counting`; read models) | V | V | V | V | V | V | V | V | V | V | — |

**Rules (binding for the slice B implementers):**

- **AUD (read-only auditor):** every mutating slice B operation returns **403** for AUD and writes nothing; every read returns 200 within AUD's scope. KBE-D, KBE-D2 and KBE-E test this on each of their operations (p4-work-split S-4).
- **Finance only (REQ-PB-013, REQ-S08-014, REQ-S08-015, REQ-S08-017):** `decideFinanceValidation`, `amendFinanceValidation`, `reverseFinanceValidation`, `decideBenefitBaseline`, `decideBenefitValuationMethod` and `resolveBenefitOverlap` need `finance.validate`. A Business Owner gets **403** (the REQ-PB-013 acceptance), and so do AUD and an ADM-only user (REQ-S10-003). The audit event of each decision records the deciding Finance user.
- **Record-level rules:** the Finance decider is never the submitter (403 `finance_validation.sod_submitter`; database `finance_validation_sod`); a baseline is never validated by the benefit's owner (403 `benefit.baseline_validator_is_owner`); a valuation method is never decided by its proposer (403 `benefit_valuation_method.decider_is_proposer`); an overlap is never resolved by the owner of either benefit (403 `benefit_overlap.resolver_is_owner`).
- **Changes against sections 1–6, flagged as assumptions:** REQ-PB-013 lists submitters BO, WL and KDS (`benefit.measure`); REQ-PB-074 "advance:BO" (`benefit.advance`); REQ-S08-013 "allocate:BO,TL"; REQ-S08-018 "edit:TL,FIN" (`benefit_scenario.edit`); REQ-S08-003 "create/edit:BO,TL"; shared-benefit groups (no source role) are given to TL and BO, the benefit editors.
