# User journeys per role

- **Task:** T-DG0-AN-02 (transformation-analyst). **Stage:** P0 / DG0.
- **Status:** specification only. These journeys describe required behaviour; none is implemented yet.
- **Conventions:**
  - Every step names its **screen** (primary navigation area > view, per REQ-S03-007), the **record** it creates or changes, and its **guard condition**. The guard is enforced on the server (REQ-S02-006).
  - Role codes are those in `permissions-matrix.md`.
  - "Audit" means that every mutation writes an audit event with actor, action, timestamp, record ID, prior/new version and reason (§16, AN-03).
  - Every mutation also uses optimistic concurrency. A conflicting save shows a recoverable conflict (A14).

Revision T-DG0-AN-05:
- J2.5 has the initiative-level T11 "Go-live / scale" step and the configurable G5 approver (finding F-DG0-002).
- J2.4 step 4 names the weight-set versions (REQ-PB-049/093, finding F-DG0-001).
- Two stale IDs were corrected: REQ-S05-004 was consolidated into REQ-PB-042, and the filename-evidence rule is REQ-S13-012.

Screen and API names are planned names, pending the P1 ADRs. Demo walk-throughs run only in the separate demo environment, on synthetic data (REQ-S18-001, REQ-PB-088/089). A demo Sponsor approval approves nothing real.

---

## J1. My Work (all roles)

Requirements: REQ-S03-008, REQ-S12-005, REQ-S12-023, REQ-S12-025, REQ-S07-017 and REQ-S10-010.

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | any | Sign in. The system loads work items across the user's scoped assignments. | My Work | ScopedAssignment (read) | Authenticated session. Only items within the user's scopes are returned. |
| 2 | any | Review the six lists: assigned actions, drafts, reviews, approvals, missing updates, upcoming deadlines. Overdue items are flagged by the Asia/Riyadh business calendar. | My Work | Action, draft records, Approval, KPI due items | Deadlines computed in working days where the SLA is in working days (REQ-S10-006). |
| 3 | any | Open an item through its deep link. | Target record screen | Target record | Access is re-checked on open. An unauthorized link returns 403 without the title (REQ-S12-024). |
| 4 | approver | Decide an approval: approve, reject, request changes or defer, with rationale. | My Work > Approvals | Approval | Assignee or valid delegate; requester ≠ approver (SoD); the request version equals the current version (stale check); rationale is required. |
| 5 | any | Read in-app inbox notifications. Digest and quiet-hours preferences apply. | My Work > Inbox | Notification | The inbox always works. Email and messaging adapters are optional (REQ-S12-023). |
| 6 | any | Set a delegation for an absence. | My Work > Delegations | Delegation | Effective dates are required; no circular chain; delegated rights don't exceed the delegator's rights. |

---

## J2. Phase journeys with their gates (End-to-End mode)

Common gate mechanics (REQ-S04-002, REQ-S04-009…014, REQ-S12-009…010; REQ-S04-012 absorbs the former starter automation REQ-S12-008):

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| G-a | TL | Open the gate readiness view. The system lists mandatory evidence and what is missing. | Governance > Stage gates > Gx | GateInstance (Draft) | none (read) |
| G-b | TL | Submit the gate. The evidence snapshot is frozen. | Same | GateInstance → Submitted; evidence snapshot | All mandatory evidence is present, or an authorized, unexpired waiver covers each gap (reason, scope, approver, expiry, compensating action). Evidence that is only a filename or an inaccessible link doesn't count (REQ-S13-012). |
| G-c | system | Route the exact snapshot to the required approvers. Status → Under Review. | Same; approvers' My Work | Approval tasks | Exactly one task per approver (idempotent). |
| G-d | reviewers | Record per criterion: completeness, finding, open condition, risk. | Gate review table | GateCriterionReview | Reviewer role on the gate. |
| G-e | approver (default SP) | Decide: Approved, Rejected, Changes Requested or Deferred, with rationale. Conditional approval is allowed only if enabled, and records scope, conditions, owners and deadlines. | Gate decision | GateDecision | Not the submitter; not ADM; the request version is current; rationale is required; a conditional approval must name a limited scope. |
| G-f | system | On Approved, enable the authorized next phase or scope and create its tasks. | Transformation workspace | Phase tasks | Only the scope authorized by the decision. |
| G-g | any owner | Later material change to approved scope, baseline, target, TOM, cost or benefit logic. | Governance > Change requests | ChangeRequest with impact assessment | The original approval and snapshot stay immutable; the change needs reapproval (REQ-S04-014). |

### J2.1 Diagnose → G1 Case for Change (REQ-S04-003, REQ-PB-016/022/023/026/027/028/029)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | TL | Create the transformation: name, mode End-to-End, sponsor, business unit. | Transformations > New | Transformation; Charter v0.1 | Role TL/TO in scope; mode ∈ {End-to-End, Modular}. |
| 2 | system | Instantiate the pinned methodology, phase checklists, role-assignment tasks and an optional 90-day plan. | Workspace | Phase, tasks, LaunchPlan | Runs once per transformation (idempotency key) (REQ-S12-004). |
| 3 | TL/TO | Assign named people to SP, TL, BO, WL, FIN and TO. | Transformations > Team | ScopedAssignment | Assignment within the assigner's scope. |
| 4 | TL, WL | Complete the six diagnostic workstreams and the T01 rows (Financial, Customer, Process, People / Org, Technology, Data). Mark symptoms vs root causes. | Transformations > Diagnose | DiagnosticFinding (T01) | Confidence ∈ H/M/L; the dimension is required. |
| 5 | KDS, TL | Record baselines with source and baseline date. | Strategy and KPIs > Baselines | Baseline | Value, unit, source and date are required; otherwise the baseline shows "not measurable" or Unknown. |
| 6 | FIN | Validate the baselines (J5). | Benefits and Finance > Validation queue | FinanceValidation | FIN only. |
| 7 | TL | Record value pools by driver with upside/downside, or mark them explicitly unquantified. | Diagnose > Value pools | ValuePool | An unquantified pool shows "unquantified", never 0. |
| 8 | TL | Draft the charter, case for change and scope sanity checks. | Transformations > Charter | Charter version | none for a draft. |
| 9 | TL → SP | Gate G1 (G-a…G-f). Decision: "agree on the problem/opportunity and value at stake". | Stage gates > G1 | GateInstance G1 | Evidence: diagnostic, baseline, root causes, value pools and initial charter. Leadership agreement on problem, baseline and material value pools is recorded. Before G1 is approved, initiatives stay Draft. |

### J2.2 Define → G2 Direction (REQ-S04-004, REQ-PB-017/032–037, REQ-S07-001)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | TL | Refine the North Star as one sentence. | Strategy and KPIs > Outcome tree | NorthStar | Exactly one active per transformation. |
| 2 | TL, BO | Define 3–5 business outcomes with owners and apply the good outcome test. | Outcome tree | Outcome | An owner is required; there is a warning outside 3–5; activity-only wording is flagged. |
| 3 | KDS | Create KPI dictionary entries (all §7 fields) and phased target trajectories. | Strategy and KPIs > KPI dictionary | KPIDefinition, TargetTrajectory | Polarity, unit and aggregation rule are required; trajectory dates fall within the target date. |
| 4 | TL | Record strategic guardrails. | Charter > Guardrails | StrategicGuardrail | none. |
| 5 | TL → SP | Gate G2. Decision: "outcomes are specific enough to steer choices". | Stage gates > G2 | GateInstance G2 | Evidence: North Star, outcome/KPI tree, KPI dictionary, target trajectory and guardrails. |

### J2.3 Design → G3 Target State (REQ-S04-005, REQ-S05-003, REQ-PB-038–043; REQ-PB-042 absorbs former REQ-S05-004)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | TL (facilitator) | Run the 90–120-minute TOM workshop: agenda, contributions per dimension. | Target Operating Model > Workshop | TOMWorkshop | Participants are in scope. |
| 2 | TL | Convert unresolved items into T04 decisions or actions with owners. | Workshop > Convert | Decision (design), Action | An owner is required; the workshop can't close while unconverted items remain. |
| 3 | BO, TL | Complete the canvas and T03 gap rows for the ten dimensions. | TOM > Canvas / Gap matrix | TOMCanvas, Gap | The dimension is required; ten dimensions are fixed. |
| 4 | BO, WL | Update capability heatmaps and future journeys/processes. | TOM > Capabilities / Journeys | Capability, Journey, Process | none. |
| 5 | Decision owner | Decide T04 design decisions. | TOM > Design decisions | Decision | Decision owner or delegate only. |
| 6 | TL → BO/SP | Gate G3. Decision: "the required operating changes are clear". | Stage gates > G3 | GateInstance G3 | Evidence: TOM canvas, gap matrix, capability gaps, future journeys and design decisions. Initiatives are not accepted as TOM evidence (REQ-PB-040). |

### J2.4 Mobilize → G4 Mobilization (REQ-S04-006, REQ-S05-005, REQ-S08-*, REQ-S09-*)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | WL | Create T05 initiative cards from gaps. | Initiatives and Roadmaps > Initiative card | Initiative | At least one gap link and one outcome/KPI link before submit. |
| 2 | TL, FIN | Build the transformation business case and linked initiative cases, with classified investment and benefits. | Initiatives and Roadmaps > Business case | BusinessCase, Scenario | Each line has one class; scenarios are kept apart from actuals. |
| 3 | WL, FIN | Define T09 benefit formulas in the safe builder and preview examples. | Benefits and Finance > Formula builder | BenefitFormulaVersion | Grammar whitelist; no circular references; units align. |
| 4 | TL, WL, FIN | Score T06 (1–5). The weighted score is calculated. Optionally, TL proposes an adjusted weight set for the transformation (for example, adding risk/compliance), and SP approves it as a new weight-set version (REQ-PB-049). | Initiatives and Roadmaps > Prioritization | Score, WeightSetVersion | Scores ∈ 1–5; a missing score means incomplete; weights total 100%; each score records the weight-set version used. The defaults come from Playbook Studio (REQ-PB-093, J8). |
| 5 | TL → SP | Propose the ranking, then approve the portfolio selection. | Prioritization > Portfolio | Ranking, PortfolioSelection | Selection is separate from ranking; overrides need a reason and an approver. |
| 6 | TL, FIN → SteerCo | Funding decision. | Initiatives and Roadmaps > Funding | FundingDecision | Per T11 "Funding reallocation"; unfunded initiatives can't launch. |
| 7 | TL | Assign waves (T07), dependencies (T08) and capacity. | Roadmap / Dependencies / Resources | RoadmapWave, Dependency, ResourceDemand | Cycles are rejected; schedule and capacity conflicts are flagged. |
| 8 | TL → SP | Gate G4. Decision: "portfolio is executable and value-backed". | Stage gates > G4 | GateInstance G4 | Evidence: cards, cases, prioritization, roadmap, benefit plan, owners and capacity. Finance has validated baseline and benefit logic. |

### J2.5 Transform → G5 Scale (REQ-S04-007, REQ-S07-*, REQ-S10-011–013, REQ-S11-*)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | TL | Launch authorized Wave 1 pilots. | Initiative > Launch | Initiative transition | G4 approved (or a conditional scope); End-to-End requires G2 and G3 as well. |
| 2 | WL | Submit structured period updates. | Initiatives and Roadmaps > Updates | Update | Owner of the initiative. |
| 3 | KDS/BO | Update KPI and adoption actuals (J4). | KPI / Change and Adoption | KPIActual | See J4. |
| 4 | WL, TL | Manage RAID, dependencies and corrective actions. | Risks and Actions | Risk, Issue, Assumption, Dependency, Action | Probability only for Risk. |
| 5 | forums | Run the committee workflow (J6). | Governance > Meetings | Meeting, Decision | See J6. |
| 5a | WL (initiative owner) → BO | Per initiative, the T11 "Go-live / scale" decision: the initiative owner recommends, Risk/Tech/CX are consulted, the BO approves, and the SteerCo is informed. The SLA is "Per release plan". | Governance > Decisions | Decision (T11 decision type "Go-live / scale") | BO approves (B0099); not the recommender. The decision is recorded in the decision log and becomes G5 evidence. It doesn't approve G5. |
| 6 | TL → SP (default) or BO (where configured per T11 "Go-live / scale") | Gate G5 with the proposed scale scope. Decision: "results justify the proposed scope of scale". | Stage gates > G5 | GateInstance G5 | Evidence: performance/pilot evidence, adoption results, material risks resolved or dispositioned, and the decision log (including the initiative-level go-live decisions from step 5a). Scaling outside the approved scope is blocked. |

### J2.6 Realize → G6 Sustain (REQ-S04-008, REQ-S08-*, REQ-S11-*)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | KDS/BO | Submit benefit measurements with evidence. | Benefits and Finance > Benefit | BenefitMeasurement | Evidence is accessible and reviewed. |
| 2 | FIN | Validate (J5). | Validation queue | FinanceValidation | FIN only. |
| 3 | BO, TL | Correct gaps through recovery plans. | Risks and Actions > Corrective actions | Action | One open case per deviation. |
| 4 | WL → BO | BAU handover (J7). | BAU and Improvement > Handovers | BAUHandover | See J7. |
| 5 | TL → SP | Gate G6. Decision: "value is embedded in BAU". | Stage gates > G6 | GateInstance G6 | Evidence: benefit evidence, accepted handover, ownership, controls and the CI backlog. The success state stays separate from delivery completion. Product G6 never implies engineering DG7. |

---

## J3. Modular entry (TL, TO; REQ-PB-005, REQ-S03-005, A03)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | TL | Choose Modular. Select an entry phase (for example Design) or a standalone module (TOM, business case, benefits register). | Transformations > Enter at phase | Transformation (mode = Modular, entry phase) | An entry phase or module type is required. |
| 2 | TL | Record inherited evidence and baseline with source and date. | Enter at phase > Inherited items | Evidence, Baseline (provenance = inherited) | Source and date are required; the baseline still needs Finance validation to count as trusted. |
| 3 | TL | Record prior approvals: approver, date, forum, document. | Inherited approvals | InheritedApproval | Stored as "inherited – recorded, not granted in platform". It never sets a platform gate to Approved. |
| 4 | TL | Complete the minimum mandatory fields of the entry phase's templates. | Phase workspace | T03/T04 etc. | Studio-configured minimum set. |
| 5 | system | List missing upstream links: outcomes, KPIs, benefits, baseline. | Transformations > Traceability / Orphan report | Missing-link report | none (read). |
| 6 | TL | Reconnect the module to outcomes and benefits. | Traceability | Links | Allocation ≤ 100%. |
| 7 | TL | Submit the next gate (for example G3). | Stage gates | GateInstance | Rejected while a baseline or outcome link is missing, unless an authorized waiver exists. There is no silent pass. |

---

## J4. KPI update: open KPI → select period → enter/import actual and evidence → submit (KDS, BO; REQ-S07-003…017, A04)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | KDS | Open the KPI from My Work (missing update) or the dictionary. | Strategy and KPIs > KPI (mobile-friendly) | KPIDefinition (read) | Assigned owner or steward for that KPI and scope. |
| 2 | KDS | Select the reporting period. | Same | Reporting period | The period is open and belongs to the KPI's frequency. |
| 3 | KDS | Enter the actual, or import a row, and attach evidence. | Same (import staging for files) | KPIActual (draft), Evidence | Unit matches; the value is decimal; a duplicate for the same KPI, scope and period becomes a new version. Import rows are validated before commit (§17, AN-03). |
| 4 | KDS | Submit. | Same | KPIActual → Submitted | Optimistic-concurrency version matches. |
| 5 | reviewer (if the route is draft/review/accept) | Accept or return. | My Work > Reviews | KPIActual → Accepted | Configured reviewer; SoD where configured. With direct-accept, this step is skipped. |
| 6 | system | Server validation, a single recalculation run of dependents and benefits, RAG against the trajectory, dashboard refresh, deviation evaluation and audit. | (background) | CalculationRun, AuditEvent | Idempotent: exactly one run per acceptance. Missing or stale inputs yield Unknown/Stale. |
| 7 | system | Linked benefit values become pending Finance validation where required. | Benefits and Finance | BenefitMeasurement (pending) | The validated total is unchanged until J5. |
| 8 | system | If the deviation persists per rule, create or update one corrective-action case. | Risks and Actions | Action | No duplicate open case. |
| 9 | KDS | See the confirmation listing changed views and "review pending". | KPI > Submitted summary | none | none. |

---

## J5. Finance validation (FIN; REQ-PB-013, REQ-S08-015…017, A10)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | system | Route submitted benefit evidence, baselines or formulas to the queue. | Benefits and Finance > Validation queue | ValidationRequest | One item per submission. |
| 2 | FIN | Open the item. Review the baseline, attribution/counterfactual, calculation (with lineage), evidence, measurement period and assumptions. | Validation detail | Benefit, CalculationRun (read) | FIN role in scope. |
| 3 | FIN | Check overlap warnings on population, period and driver, and resolve economic overlaps. | Overlaps | OverlapResolution | Only FIN can resolve. |
| 4 | FIN | Decide: validate or reject, with rationale. | Validation detail | FinanceValidation | All six items addressed; request version current; FIN only; not the submitter. |
| 5 | system | On validation, the validated total increases by exactly the approved amount; dashboards refresh. | Benefits and Finance, Executive Overview | Aggregates | Shared benefits count once; allocations ≤ 100%. |
| 6 | FIN | Later corrections go through an amendment or reversal linked to the original. | Benefit > History | Amendment/Reversal | In-place edits of validated values are refused. |

---

## J6. Committee workflow (SEC, CM, chair; REQ-S10-011…013, REQ-PB-060/061/068, A09)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | system | At the cut-off, generate a draft agenda and pack from current data. | Governance > Meetings | Meeting, AgendaItem (Draft) | One draft per meeting (idempotent). |
| 2 | SEC | Gather linked decision briefs (executive asks). | Meeting > Agenda | AgendaItem ↔ Decision | An executive ask needs: decision, why now, options, recommendation, delay impact, decision owner and required date. |
| 3 | SEC, chair | Review materials, then publish the agenda. | Meeting > Agenda | AgendaItem (Published) | Review step completed. |
| 4 | CM | Review materials in read-only presentation mode. | Meeting > Present | Same records | Attendee in scope. |
| 5 | SEC | Record attendance and quorum. | Meeting > Attendance | Attendance | Where quorum is configured, decisions can't be recorded below it. |
| 6 | decision owner / SEC | Record decisions. | Meeting > Decisions | Decision (T16), linked | Decision owner (or delegate) decides; SEC records. |
| 7 | chair | Approve and publish the minutes. | Meeting > Minutes | Minutes (immutable once published) | Chair only. |
| 8 | SEC | Assign actions. | Meeting > Actions | Action, MeetingActionLink | An owner and a due date are required. |
| 9 | system | Monitor closure, send reminders and escalate on SLA expiry. | My Work; Governance | Action, Escalation | Working-day SLA; escalate exactly once; never auto-decide. |

---

## J7. BAU handover (WL, TL → BO; REQ-PB-083 (absorbs former REQ-S12-017), REQ-S11-005, A11)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | WL/TL | Prepare the handover: business owner, KPI owner, operating procedures, controls, evidence, capability readiness, unresolved accepted risks, benefit monitoring cadence, data access and improvement backlog. | BAU and Improvement > Handovers | BAUHandover (Draft) | All items are required before submit. |
| 2 | WL/TL | Submit to the receiving owner. | Same | BAUHandover → Submitted | Receiving BO named. |
| 3 | BO (receiving) | Accept, or return with reasons. | My Work > Approvals | BAUHandover → Accepted | Only the named receiving owner (A/R per RACI). |
| 4 | system | Transfer routine ownership of KPIs, controls and benefits, and activate recurring performance and control reviews. | BAU and Improvement | ScopedAssignment, Control, review schedule | Runs once; evidence access carries over to the new owner. |
| 5 | BO | Carry out the recurring reviews and control checks. A failed check creates a recovery action. | BAU and Improvement | ControlCheck, Action | none. |
| 6 | BO | Reopen a deteriorating performance area. | Performance area | New cycle | Earlier closure and handover history is preserved. |

---

## J8. Administrator publishing: Draft → Preview/Test → Review → Publish (ADM; REQ-S06-004…009, A06/A07)

| # | Actor | Step | Screen | Record | Guard condition |
|---|---|---|---|---|---|
| 1 | ADM (methodology admin) | Create a draft configuration version from the current published version. | Administration > Playbook Studio | MethodologyVersion (Draft) | Methodology-admin profile. |
| 2 | ADM | Edit fields, rules, workflows, formulas, labels and help. | Studio editors | FormSchemaVersion, AutomationRuleVersion, etc. | Protected source columns and stable IDs can't be deleted or changed; no rule may auto-approve. |
| 3 | ADM | Preview/Test: sandbox rendering, dry-run automation, formula previews and source-completeness check. | Studio > Preview | Test results | No side effects on production records. |
| 4 | ADM | View the side-by-side diff, the affected records and the compatibility checks. | Studio > Diff | Diff report | Compatibility checks must pass. |
| 5 | reviewer (TO/FIN/TL, where configured) | Review. | My Work > Reviews | Review approval | Not the author (SoD). |
| 6 | ADM | Publish. | Studio > Publish | MethodologyVersion (Published, immutable) | Review completed where configured. |
| 7 | ADM → TL (approver) | Optional migration of a pinned transformation. The plan explains mappings, new required fields, invalidated calculations and reapprovals. | Administration > Migrations | MethodologyMigration | Approved by the business approver. Historical records aren't rewritten. |
| 8 | ADM | Roll back if needed: restore a prior version as a new audited version. | Studio > Versions | MethodologyVersion | Later business transactions are retained. |

---

## Role summary: which journeys each role runs

| Role | Journeys |
|---|---|
| SP | J1 (approvals), J2 gate decisions G1–G6, J6 (chair or decision owner) |
| TL | J1, J2 (all phases, gate submissions), J3, J6 (asks), J7 (prepare) |
| BO | J1, J2.2/J2.3 (outcomes, TOM), J2.5 (T11 "Go-live / scale" per initiative; G3/G5 gate decisions where configured per T11), J4 (own KPIs), J7 (accept), recurring BAU |
| WL | J1, J2.1/J2.4/J2.5 (content), J7 (prepare) |
| FIN | J1, J5, J2.4 (business case, formulas) |
| TO | J1, J2 (review), J3, J8 (review where configured) |
| KDS | J1, J4 |
| TD | J1, J2.3 (TOM technology/data), dependencies |
| CM/SEC | J1, J6 |
| AUD | Read-only across all journeys in scope; no mutations |
| ADM | J8, operations (jobs, failure queue), access administration; never a business approval |
