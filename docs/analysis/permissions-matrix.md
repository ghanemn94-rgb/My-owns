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
