# Handback: T-DG0-AN-02, master prompt §1–§13 into requirements (transformation-analyst)

- **Stage:** P0 / DG0 (BUILDING).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG0-T-DG0-AN-02-transformation-analyst-20260928T120258Z","session_id":"6490d7fe-275d-49f3-9156-bbb438c3ec2d"}`
- **Assignment:** `docs/delivery/assignments/DG0/T-DG0-AN-02.md`, sha256 `3f91fd252d25254e17e727aacc6d0588b2d0588f667e217ceee2f4f7b25c14eb`. I verified this hash at start and at end.

## 0. Revision and workspace

- **HEAD:** `git rev-parse HEAD` = `df28e87ac6c8bfac00f19c777eb89c023d535d6a`. This is ahead of the base `ab80507725f434916e5a9cb1e52bfe2c7b32d04a`.
- **Diff from the base:** `git diff --stat ab80507..HEAD` touches only `docs/delivery/assignments/DG0/T-DG0-AN-02.md` and `T-DG0-AN-03.md` (2 files, +2/−2). That is metadata-only, as the assignment allows.
- **Files I wrote:** only the six permitted files listed in §1.
- **Other files in `git status` are not mine:**
  - the modified `progress.md` and the AN-02/AN-03 assignments;
  - AN-03's `req-dlv-s14-s21.csv`, `mp-coverage-p0-s14-s21.csv`, `ref-additions-an03.csv`, `acceptance-map.md`, `stage-plan.md` and its handback;
  - `T-DG0-AN-04.md`;
  - the `runs/` directories.
- **Scratchpad only:** the generator (`gen.py`) and the checker (`check.py`) are in my session scratchpad and are not part of the candidate. The CSVs are the deliverable.

## 1. Changed files

| File | Purpose | sha256 |
|---|---|---|
| `docs/analysis/parts/req-s01-s13.csv` | 168 register rows, `REQ-S01-001`…`REQ-S13-013`. Register header and columns; all `SPECIFIED`; `evidence` empty; `template_id` empty. | `5ad9ca3b1a41d15c327ec38996f5ec5f17918950d87f8e31dde7f1f62c6c7a01` |
| `docs/analysis/parts/mp-coverage-s01-s13.csv` | Exactly 181 rows, M0075–M0255 (`block_id,disposition,req_ids,rationale`). | `a61b00818f326e97c1cd8017f38b399174f9253daa2d8545d330f21a88080c53` |
| `docs/analysis/parts/ref-additions-an02.csv` | 69 `REQ-PB` rows receive 131 M anchors in total (`req_id,add_refs`). | `f0814d00a7a53f2e2d2a946a3c56ccec05c9265ff29ce0e31c7bd15b17f5321f` |
| `docs/analysis/permissions-matrix.md` | Role × record/action matrix for the 11 roles. Covers scope rules, SoD, delegation, "technical admins are not business approvers", and flagged assumptions. | `d03d24db414108ffdc686300820ce370d5233299e8178634b076173c682fb9b7` |
| `docs/analysis/user-journeys.md` | Journeys J1–J8: My Work; the six phases with their gates plus common gate mechanics; modular entry; KPI update; Finance validation; committee workflow; BAU handover; admin publishing. Each step names its screen, record and guard condition. Ends with a role → journeys summary. | `355c85a29806823f9d7acae6eb414979ab77ade702c9caba68f230be419c650f` |
| `docs/delivery/handbacks/DG0/T-DG0-AN-02-transformation-analyst.md` | This handback. | n/a |

## 2. Behaviour delivered (specification only: nothing is implemented)

Every row is a requirement specification with status `SPECIFIED`. **No platform behaviour exists yet.**

### Counts

- **Rows:** 168.
- **By class:** USER 143 · ENGINEERING 25 · SOURCE 0 (see §4.1).
- **By area:**

| S01 | S02 | S03 | S04 | S05 | S06 | S07 | S08 | S09 | S10 | S11 | S12 | S13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 7 | 11 | 14 | 6 | 10 | 17 | 19 | 11 | 19 | 9 | 26 | 13 |

- **By final_gate:** DG2 7 · DG3 9 · DG4 82 · DG5 54 · DG6 11 · DG7 5. There are no DG0 or DG1 rows.
  - A DG0 row would have to be IMPLEMENTED now.
  - P1 foundation work appears as increments in rows such as REQ-S01-002, S02-006, S03-001/007/008/011, S06-010 and S10-001–004.
  - `final_gate` always equals the highest increment.
- **By area and gate:**
  - S01: DG5 3, DG6 1, DG7 2
  - S02: DG5 3, DG6 1, DG7 3
  - S03: DG4 9, DG5 2
  - S04: DG2 3, DG3 1, DG4 9, DG5 1
  - S05: DG2 2, DG3 1, DG5 3
  - S06: DG5 10
  - S07: DG4 16, DG5 1
  - S08: DG3 1, DG4 16, DG5 2
  - S09: DG3 6, DG4 3, DG5 2
  - S10: DG2 1, DG4 14, DG5 2, DG6 2
  - S11: DG4 9
  - S12: DG4 3, DG5 18, DG6 5
  - S13: DG2 1, DG4 3, DG5 7, DG6 2
- **Coverage (181 blocks):** REQUIREMENT 156 · CONTEXT 25 · NON-REQUIREMENT 0.
  - The 25 CONTEXT blocks are section headings, table header rows and lead-in sentences ("Primary navigation:", "Required starter automations:", …). Each rationale names the covering requirement IDs.
  - 50 REQUIREMENT blocks map only to existing `REQ-PB` rows, through ref-additions. These blocks restate playbook content, for example the T01–T16 table rows, the wave, cadence, T11 and RACI data rows, and the six T10 dashboard-area rows.
- **ENGINEERING rows (25):** S01-005, S02-002, S02-005, S02-006, S06-006, S07-002, S07-004, S07-005, S07-006, S07-010, S07-011, S08-004, S08-006, S08-007, S08-008, S09-008, S09-009, S10-004, S12-003, S12-020, S12-021, S12-024, S13-006, S13-011, S13-013.
- **Acceptance scenarios referenced by my rows:** A01–A18, A20, A21, A22, A24 and A28.
  - A19, A23, A25, A26 and A27 are not referenced by my rows. They are backup/restore and delivery-protocol scenarios in AN-03's areas.
  - In the combined merge (check D), every A01–A28 scenario is referenced.

### How the required detail maps to requirements

| Assignment item | Requirements |
|---|---|
| §4 gate submission fields | S04-009 |
| §4 statuses (Draft … Deferred) | S04-010 |
| §4 conditional approval (extension) | S04-011 |
| §4 missing-evidence block and exception | S04-012 |
| §4 waivers (reason, scope, approver, expiry, compensating action) | S04-013 |
| §4 material-change reapproval | S04-014 |
| §4 phase/gate table rows | S04-003…008, plus ref-adds to PB-016…021 |
| §7 KPI dictionary fields | S07-001 |
| §7 polarity types | S07-002 |
| §7 actuals by KPI, scope and period | S07-003 |
| §7 period vs cumulative, pp vs % | S07-004 |
| §7 edge cases | S07-005 |
| §7 Unknown/Stale | S07-006 |
| §7 RAG from trajectory | S07-007 |
| §7 display elements | S07-008 |
| §7 override rules | S07-009 |
| §7 aggregation | S07-010 |
| §7 circular refs and units | S07-011 |
| §7 submission routes | S07-012 |
| §7 propagation | S07-013 |
| §7 Finance pending | S07-014 |
| §7 change request | S07-015 |
| §7 prospective vs retrospective restatement | S07-016 |
| §7 quick update | S07-017 |
| §8 value states | S08-001 |
| §8 enabler rule | S08-002 |
| §8 benefit fields | S08-003 |
| §8 safe formula builder | S08-004 |
| §8 preview | S08-005 |
| §8 lineage | S08-006 |
| §8 seeded examples | S08-007 and S08-008, plus ref-add to PB-057 |
| §8 separations | S08-009…011 |
| §8 double counting, allocation ≤100% and overlaps | S08-012…014 |
| §8 Finance validation contents | S08-015 |
| §8 measure-only, amendments, scenarios | S08-016…018 |
| §8 NPV/ROI/payback extension | S08-019 |
| §9 scorecard maths | ref-add to PB-048/049, plus S09-001 (0–100 labelling) and S09-002 (versioned rubrics) |
| §9 waves table | ref-add to PB-050 (M0178, M0180–M0183) |
| §9 execution | S09-003…011 |
| §10 cadence table | ref-add to PB-060/061, plus S10-005 and S10-006 (calendar) |
| §10 T11 table | ref-add to PB-065/066 |
| §10 RACI table | ref-add to PB-067, plus S10-007 |
| §10 roles and scopes | S10-001…004 |
| §10 mapping, accountability, delegation | S10-008…010 |
| §10 committee workflow | S10-011…013 |
| §10 approvals | S10-014 (record), S10-015 (sequential/parallel), S10-016 (SoD), S10-017 (stale), S10-018 (outcomes), S10-019 (timer never approves) |
| §12 every starter automation row | S12-004…019 (one row per M0224…M0239); engine S12-001…003; durability S12-020…022; notifications S12-023…025; human boundary S12-026 |
| §13 dashboard areas | S13-001…003, plus ref-add to PB-062/063/064 for the six area rows |
| §13 exports | S13-004 and S13-005 |
| §13 formula-injection neutralization | S13-006 |
| §13 snapshots | S13-007…009 |
| §13 evidence repository | S13-010…013 |

### Requirement list

| req_id | class | title | source_ref | increments | final_gate |
|---|---|---|---|---|---|
| REQ-S01-001 | USER | Deliver a complete working enterprise transformation platform with source code, persistent database, documentation and a tested self-hosting package | M0076 | P1, P2, P3, P4, P5, P6, P7 | DG7 |
| REQ-S01-002 | USER | Make the working product name configurable with default 'Mobily Transformation Hub' | M0077 | P1, P5 | DG5 |
| REQ-S01-003 | USER | Convert the playbook operating system into connected executable workflows from input through procedure, validation, approval, output, monitoring and correction to sustainment | M0078 | P2, P3, P4, P5 | DG5 |
| REQ-S01-004 | USER | Perform the complete transformation management lifecycle natively without depending on spreadsheets, slide decks or external approval emails | M0079 | P2, P3, P4, P5 | DG5 |
| REQ-S01-005 | ENGINEERING | Never imply an external operational change happened because a task was marked complete; require verified evidence or a confirmed integration result | M0080 | P3, P4, P6 | DG6 |
| REQ-S01-006 | USER | Deliver a clean source repository and deployment package that Mobily IT can host on its own infrastructure without the original AI builder, a personal account or a mandatory external SaaS backend | M0081 | P1, P6, P7 | DG7 |
| REQ-S02-001 | USER | Keep every source element set complete and checkable: two modes, six phases, six gates, sixteen templates, ten TOM dimensions, governance cadence, benefits lifecycle, 90-day plan, roaming example and 25-question health check | M0083 | P2, P5 | DG5 |
| REQ-S02-002 | ENGINEERING | Maintain a requirements traceability register with source heading/template, requirement ID, input fields, procedure, output, owner, permissions, automation, screen/API, acceptance test and SOURCE/USER/ENGINEERING class | M0084, M0085, M0086, M0087 | P0, P7 | DG7 |
| REQ-S02-003 | USER | Publish the requirement register read-only in the Administration area and include it in the IT handover | M0088 | P5, P7 | DG7 |
| REQ-S02-004 | USER | Link source playbook text to the operational forms and procedures that implement it | M0088 | P2, P5 | DG5 |
| REQ-S02-005 | ENGINEERING | Report completion honestly: every incomplete or externally blocked item names the exact missing dependency and no planned feature is labelled delivered | M0088 | P0, P7 | DG7 |
| REQ-S02-006 | ENGINEERING | Enforce every required control against persisted server-side data; a navigation shell, static dashboard, clickable mockup or browser-local store never satisfies completion | M0090 | P1, P2, P3, P4, P5, P6 | DG6 |
| REQ-S02-007 | USER | Mark demonstration data explicitly and isolate it from production | M0090 | P1, P5 | DG5 |
| REQ-S03-001 | USER | Support multiple transformations, business units, portfolios, workstreams, initiatives and ongoing business performance areas | M0092 | P1, P2, P3, P4 | DG4 |
| REQ-S03-002 | USER | Let performance areas and BAU ownership continue indefinitely while transformations remain time-bounded | M0092 | P4 | DG4 |
| REQ-S03-003 | USER | Keep initiative delivery, business adoption, validated value and transformation closure as separate statuses | M0092 | P3, P4 | DG4 |
| REQ-S03-004 | USER | Guide End-to-End progression through the six phases, allowing drafts at any time but enforcing required gate approvals before authorized execution or scaling | M0094 | P2, P3, P4 | DG4 |
| REQ-S03-005 | USER | In Modular entry, record inherited evidence, baseline and prior approvals as labelled inherited records and never fabricate approvals | M0095 | P2, P3, P4 | DG4 |
| REQ-S03-006 | USER | Support many-to-many traceability links with explicit contribution and allocation rules, clickable nodes and downstream impact | M0098 | P2, P3, P4 | DG4 |
| REQ-S03-007 | USER | Provide the fourteen primary navigation areas: My Work, Executive Overview, Transformations, Playbook and Procedures, Strategy and KPIs, Target Operating Model, Initiatives and Roadmaps, Governance, Risks and Actions, Benefits and Finance, Change and Adoption, Evidence and Reports, BAU and Improvement, Administration | M0100, M0101, M0102, M0103, M0104, M0105, M0106, M0107, M0108, M0109, M0110, M0111, M0112, M0113 | P1, P2, P3, P4, P5 | DG5 |
| REQ-S03-008 | USER | Provide My Work with assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines | M0100 | P1, P2, P4 | DG4 |
| REQ-S03-009 | USER | Provide Executive Overview with outcomes, value, critical initiatives, adoption, blockers and decisions | M0101 | P4 | DG4 |
| REQ-S03-010 | USER | Provide a searchable playbook reader with guidance and launchable executable procedures | M0103 | P2, P5 | DG5 |
| REQ-S03-011 | USER | Show a transformation workspace header with phase, gate readiness, North Star, owners, outcome health, benefits, key decisions and next required actions, with contextual navigation that never requires re-entering the transformation ID | M0114 | P1, P2, P4 | DG4 |
| REQ-S04-001 | USER | Give every phase guided inputs, procedural steps, required evidence, named owners, completion rules, outputs and a review queue | M0116 | P2, P3, P4 | DG4 |
| REQ-S04-002 | USER | Make gates explicit approval records tied to a versioned, immutable evidence snapshot, never inferred from task completion | M0116 | P2, P3, P4 | DG4 |
| REQ-S04-003 | USER | Run the Diagnose phase procedure and G1 Case for Change decision | M0118 | P2 | DG2 |
| REQ-S04-004 | USER | Run the Define phase procedure and G2 Direction decision | M0119 | P2 | DG2 |
| REQ-S04-005 | USER | Run the Design phase procedure and G3 Target State decision | M0120 | P2 | DG2 |
| REQ-S04-006 | USER | Run the Mobilize phase procedure and G4 Mobilization decision | M0121 | P3 | DG3 |
| REQ-S04-007 | USER | Run the Transform phase procedure and G5 Scale decision recording the approved scale scope | M0122 | P4 | DG4 |
| REQ-S04-008 | USER | Run the Realize phase procedure and G6 Sustain decision | M0123 | P4 | DG4 |
| REQ-S04-009 | USER | Show on every gate submission, per criterion: criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision and rationale | M0124 | P2, P3, P4 | DG4 |
| REQ-S04-010 | USER | Support gate statuses Draft, Submitted, Under Review, Changes Requested, Approved, Rejected and Deferred with enforced transitions | M0124 | P2, P3, P4 | DG4 |
| REQ-S04-011 | USER | Offer conditional approval as a configurable extension recording permitted scope, conditions, owners and deadlines, never authorizing unrestricted scaling | M0124 | P4, P5 | DG5 |
| REQ-S04-012 | USER | Block gate submission when mandatory evidence is missing unless a specifically authorized exception is recorded | M0125 | P2, P3, P4 | DG4 |
| REQ-S04-013 | USER | Require waivers to record reason, scope, approver, expiry and compensating action | M0125 | P2, P3, P4 | DG4 |
| REQ-S04-014 | USER | Trigger impact assessment and reapproval for material changes to approved scope, baseline, target, TOM, cost or benefit logic while preserving the original approval and snapshot | M0125 | P2, P3, P4 | DG4 |
| REQ-S05-001 | USER | Give every native template form inline help, validation, draft saving, version history, comments, attachments, permissions, bulk editing where suitable and export | M0127 | P2, P3, P4, P5 | DG5 |
| REQ-S05-002 | USER | Allow extension fields on templates without deleting or changing the meaning of any source column | M0127 | P5 | DG5 |
| REQ-S05-003 | USER | Provide per TOM dimension the current/target design, linked gaps, owner, evidence, dependencies and decisions | M0147 | P2 | DG2 |
| REQ-S05-004 | USER | Run the facilitated 90-120-minute TOM workshop mode with agenda, captured contributions and conversion of unresolved items into decisions or actions | M0147 | P2 | DG2 |
| REQ-S05-005 | USER | Classify business-case investment (capex, opex, internal FTE, vendor cost, opportunity cost) and benefits (revenue, cost reduction, cost avoidance, working capital, strategic/non-financial) so no item is treated twice | M0148 | P3 | DG3 |
| REQ-S05-006 | USER | Provide the native operating records added for execution, labelled as extensions where the source gives no full template | M0149 | P2, P3, P4, P5 | DG5 |
| REQ-S06-001 | USER | Define procedures with purpose, trigger, scope, prerequisites, inputs and input schema, ordered/conditional/parallel steps, responsible roles, SLA, validation rules, approval path, escalation path, expected outputs, completion conditions, exceptions and version/effective date | M0152 | P2, P5 | DG5 |
| REQ-S06-002 | USER | Create a persistent procedure instance on launch showing current step, assignee, due date, missing inputs, completed evidence and next action, whose outputs are real linked records | M0153 | P2, P3, P4, P5 | DG5 |
| REQ-S06-003 | USER | Seed configurable procedures for new transformation intake, baseline validation, KPI submission, TOM approval, initiative prioritization, gate review, scope/target change, benefit validation, executive escalation and BAU handover | M0153 | P2, P3, P4, P5 | DG5 |
| REQ-S06-004 | USER | Provide an administrator Playbook Studio to edit methodology text, phases, gates, mandatory artifacts, checklists, templates, fields, labels, help text, validation, formulas, routing, approvers, reminders, escalation rules, dashboards and reporting layouts through the UI | M0154 | P5 | DG5 |
| REQ-S06-005 | USER | Support Studio field types text, rich text, number, currency, percentage, date, reference, attachment, lookup, choice and calculated value | M0154 | P5 | DG5 |
| REQ-S06-006 | ENGINEERING | Protect stable system identifiers and core data invariants from configuration changes | M0154 | P5 | DG5 |
| REQ-S06-007 | USER | Publish configuration through Draft, Preview/Test, Review where configured and Publish, with side-by-side diff, affected records, compatibility checks and immutable published versions | M0155 | P5 | DG5 |
| REQ-S06-008 | USER | Pin existing transformations to their methodology and form versions until a deliberate, approved migration explains mappings, new required fields, invalidated calculations and reapprovals, never silently rewriting history | M0155 | P5 | DG5 |
| REQ-S06-009 | USER | Roll back configuration by restoring a prior version through an audited change that does not erase later business transactions | M0155 | P5 | DG5 |
| REQ-S06-010 | USER | Separate administrator configuration from operational editing: owners update assigned data, methodology admins publish shared rules and only authorized business approvers approve policy or financial changes | M0156 | P1, P5 | DG5 |
| REQ-S07-001 | USER | Provide a KPI dictionary with name, description, business purpose, owner, steward, unit, frequency, polarity, numerator/denominator, calculation, baseline and baseline date, target and target date, phased trajectory, source, aggregation rule, data-quality rule, reporting period, approval policy and leading/lagging classification | M0158 | P2, P4 | DG4 |
| REQ-S07-002 | ENGINEERING | Support higher-is-better, lower-is-better, acceptable-band and binary milestone measures | M0159 | P4 | DG4 |
| REQ-S07-003 | USER | Store actuals by KPI, scope and reporting period | M0159 | P4 | DG4 |
| REQ-S07-004 | ENGINEERING | Distinguish period from cumulative values and percentage changes from percentage-point changes | M0159 | P4 | DG4 |
| REQ-S07-005 | ENGINEERING | Handle missing values, zero denominators, negative baselines and incomparable periods explicitly | M0159 | P4 | DG4 |
| REQ-S07-006 | ENGINEERING | Show Unknown or Stale for missing or stale data, never green or zero | M0159 | P4 | DG4 |
| REQ-S07-007 | USER | Compute RAG from the approved expected trajectory with configurable thresholds and never from project task completion | M0160 | P4 | DG4 |
| REQ-S07-008 | USER | Always show actual, expected-to-date, final target, variance, trend, data freshness and the rule explanation alongside RAG | M0160 | P4 | DG4 |
| REQ-S07-009 | USER | Allow manual RAG override only by an authorized user with reason, evidence, expiry and audit, preserving the calculated status | M0160 | P4 | DG4 |
| REQ-S07-010 | ENGINEERING | Define aggregations explicitly: sum eligible flows, last value for stocks, weighted ratios where appropriate or an approved custom formula; never average percentages or mix units by default; preserve currency and period | M0161 | P4 | DG4 |
| REQ-S07-011 | ENGINEERING | Reject circular references and invalid units in formula dependencies | M0161 | P3, P4 | DG4 |
| REQ-S07-012 | USER | Route KPI submissions through configurable draft/review/accept or direct-accept routes | M0162 | P4 | DG4 |
| REQ-S07-013 | USER | On an accepted actual run server-side validation, recalculation of dependent metrics and benefits, dashboard refresh, deviation evaluation and an audit event | M0162 | P4 | DG4 |
| REQ-S07-014 | USER | Keep new benefit values pending, not validated realized value, when Finance validation is required | M0162 | P4 | DG4 |
| REQ-S07-015 | USER | Handle changes to a KPI definition, baseline or target through a versioned change request with reason, impact preview and list of affected outcomes, benefits, gates, reports and formulas | M0163 | P4 | DG4 |
| REQ-S07-016 | USER | Apply approved KPI changes prospectively by default; allow retrospective restatement only with explicit period selection, authority and a retained reconciliation; keep issued reports unchanged and reissuable as new versions | M0163 | P4, P5 | DG5 |
| REQ-S07-017 | USER | Make the routine KPI update quick: open KPI, select period, enter or import actual and evidence, submit; then show which downstream views changed and whether review is pending | M0164 | P4 | DG4 |
| REQ-S08-001 | USER | Track planned, forecast, measured, submitted-for-validation, validated, rejected and sustained benefit values separately | M0166 | P4 | DG4 |
| REQ-S08-002 | USER | Treat a delivered capability as an enabler, not proof of realized value | M0166 | P4 | DG4 |
| REQ-S08-003 | USER | Record for each benefit a unique ID, type, accountable business owner, Finance validator where applicable, baseline/counterfactual, formula, driver units, target, timing, one-off/recurring classification, currency, measurement source, evidence, confidence, assumptions, contribution links and financial-statement mapping or agreed non-financial KPI | M0167 | P3, P4 | DG4 |
| REQ-S08-004 | ENGINEERING | Provide a safe formula builder with a restricted expression language and typed variables that never evaluates arbitrary user-supplied code | M0168 | P3, P4 | DG4 |
| REQ-S08-005 | USER | Preview formula examples, units and edge cases before publication | M0168 | P3, P5 | DG5 |
| REQ-S08-006 | ENGINEERING | Version formulas and preserve calculation lineage: input actuals, source versions, assumptions, rates, period and formula version | M0168 | P3, P4 | DG4 |
| REQ-S08-007 | ENGINEERING | Validate the revenue uplift example: attach rate stored as a fraction (10% to 12% is 0.02, 2 percentage points) with aligned ARPU, customer population and ramp periods | M0170 | P3 | DG3 |
| REQ-S08-008 | ENGINEERING | Require the same period and a validated comparison basis for the cost reduction example | M0171 | P3, P4 | DG4 |
| REQ-S08-009 | USER | Keep revenue uplift separate from profit or margin benefit and avoided cost separate from cash savings | M0172 | P4 | DG4 |
| REQ-S08-010 | USER | Do not monetize CX or other non-financial benefits without an approved valuation method | M0172 | P4 | DG4 |
| REQ-S08-011 | USER | Show gross benefits, implementation cost and net value separately without subtracting the same cost at both initiative and transformation level | M0172 | P3, P4 | DG4 |
| REQ-S08-012 | USER | Prevent double counting through a canonical benefit register, parent/child relationships, shared-benefit groups and contribution allocations so portfolio aggregation counts a shared benefit once | M0173 | P4 | DG4 |
| REQ-S08-013 | USER | Reject allocations over 100% and show any share below 100% as unallocated | M0173 | P4 | DG4 |
| REQ-S08-014 | USER | Warn about overlapping populations, periods and drivers and require Finance to resolve economic overlaps rules cannot determine | M0173 | P4 | DG4 |
| REQ-S08-015 | USER | Include baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions in Finance validation | M0174 | P4 | DG4 |
| REQ-S08-016 | USER | Keep measure-only submissions out of the validated total until approved | M0174 | P4 | DG4 |
| REQ-S08-017 | USER | Record corrections as amendments or reversals linked to the original record | M0174 | P4 | DG4 |
| REQ-S08-018 | USER | Support base, upside and downside scenarios without mixing scenarios into reported actuals | M0174 | P3, P4 | DG4 |
| REQ-S08-019 | USER | Offer NPV, ROI or payback only as an optional extension with explicitly defined methodology, timing and discount-rate assumptions | M0174 | P5 | DG5 |
| REQ-S09-001 | USER | Label and document any 0-100 view of the 1-5 weighted score conversion | M0176 | P3 | DG3 |
| REQ-S09-002 | USER | Make scoring rubrics and approved weights configurable and versioned | M0176 | P3, P5 | DG5 |
| REQ-S09-003 | USER | Separate proposed rankings, approved portfolio selection and funding approval | M0177 | P3 | DG3 |
| REQ-S09-004 | USER | Provide value/feasibility comparison, filters, ranked tables, dependency-aware sequencing and capacity conflict indicators | M0177 | P3 | DG3 |
| REQ-S09-005 | USER | Explain ranking changes and overrides | M0177 | P3 | DG3 |
| REQ-S09-006 | USER | Provide roadmap timeline, initiative table and work board using the same data | M0184 | P3 | DG3 |
| REQ-S09-007 | USER | Track approved vs forecast milestone dates, deliverable acceptance, budget/actual/forecast, role-based capacity, FTE demand, dependencies and decisions | M0184 | P3, P4 | DG4 |
| REQ-S09-008 | ENGINEERING | Detect dependency cycles and schedule conflicts | M0184 | P3 | DG3 |
| REQ-S09-009 | ENGINEERING | Derive critical-path claims from defined scheduling logic, not cosmetic highlighting | M0184, M0250 | P3, P4 | DG4 |
| REQ-S09-010 | USER | Record material rebaselines through change control | M0184 | P3, P4 | DG4 |
| REQ-S09-011 | USER | Collect concise structured owner updates and generate executive views directly from them and canonical metrics | M0185 | P4, P5 | DG5 |
| REQ-S10-001 | USER | Implement role and record-level access for the source roles and the implementation roles KPI/Data Steward, Tech/Data contributor, committee member/secretary, read-only auditor and system administrator | M0187 | P1, P2 | DG2 |
| REQ-S10-002 | USER | Scope access by organization, business unit, transformation and sensitive record so that job title alone never grants access across all transformations | M0188 | P1, P6 | DG6 |
| REQ-S10-003 | USER | Never make technical administrators business approvers automatically | M0188 | P1, P4 | DG4 |
| REQ-S10-004 | ENGINEERING | Enforce permissions on the server for records, files, APIs, exports, search and AI retrieval | M0188 | P1, P5, P6 | DG6 |
| REQ-S10-005 | USER | Make forum recurrence, participants, cut-off dates and agenda rules configurable | M0196 | P4 | DG4 |
| REQ-S10-006 | USER | Use an Asia/Riyadh default business calendar with configurable workweek, holidays and working-day SLAs, never hardcoding public holidays or using elapsed days where working days are specified | M0196 | P4 | DG4 |
| REQ-S10-007 | USER | Preserve the source RACI as a configurable starting point per transformation | M0203 | P4 | DG4 |
| REQ-S10-008 | USER | Map roles to named people or governed groups | M0211 | P2, P4 | DG4 |
| REQ-S10-009 | USER | Require one accountable assignment per deliverable unless a documented governance rule permits otherwise | M0211 | P4 | DG4 |
| REQ-S10-010 | USER | Support authorized delegation with effective dates, absence handling and preserved audit identity, never creating approval loops | M0211 | P4 | DG4 |
| REQ-S10-011 | USER | Provide the in-app committee workflow: draft agenda, gather linked decision briefs, review materials, record attendance/quorum where configured, record decisions, approve/publish minutes, assign actions and monitor closure | M0212 | P4 | DG4 |
| REQ-S10-012 | USER | Require executive asks to state decision, why now, options, recommendation, delay impact, decision owner and required date | M0212 | P4 | DG4 |
| REQ-S10-013 | USER | Generate read-only presentation mode and printable packs from the same underlying records | M0212 | P4, P5 | DG5 |
| REQ-S10-014 | USER | Record for every approval the assignee, request version, due date, rationale, comments and decision timestamp | M0213 | P2, P4 | DG4 |
| REQ-S10-015 | USER | Support sequential or parallel approval rules | M0213 | P4, P5 | DG5 |
| REQ-S10-016 | USER | Enforce separation of duties so a requester cannot approve their own request when policy prohibits it | M0213 | P2, P4 | DG4 |
| REQ-S10-017 | USER | Reject stale approvals when the submitted record version has changed | M0213 | P2, P4 | DG4 |
| REQ-S10-018 | USER | Distinguish approval, rejection, request changes and deferral as separate outcomes | M0213 | P2, P4 | DG4 |
| REQ-S10-019 | USER | Let timers escalate overdue approvals but never approve automatically | M0213 | P4 | DG4 |
| REQ-S11-001 | USER | Implement stakeholder groups with influence/impact, stance, required behavior, intervention plans, champions, communication/training actions and evidence of proficiency | M0215 | P4 | DG4 |
| REQ-S11-002 | USER | Provide short native feedback and assessment forms so observations are collected and reviewed in the platform | M0215 | P4 | DG4 |
| REQ-S11-003 | USER | Track adoption actuals against adoption trajectories and create corrective interventions when gaps appear | M0216 | P4 | DG4 |
| REQ-S11-004 | USER | Support continuous performance management after project delivery and after transformation closure | M0217 | P4 | DG4 |
| REQ-S11-005 | USER | Require the BAU handover to include accepted business owner and KPI owner, operating procedures, controls, evidence, capability readiness, unresolved accepted risks, benefit monitoring cadence, data access and improvement backlog, and capture receiving-owner acceptance | M0217 | P4 | DG4 |
| REQ-S11-006 | USER | Show delivery complete, value validation pending and BAU accepted as separate states so success is never inferred from initiative completion | M0218 | P4 | DG4 |
| REQ-S11-007 | USER | Allow a documented transition decision for long-realization benefits with residual benefit ownership and scheduled monitoring, never labelling forecast future value as sustained | M0218 | P4 | DG4 |
| REQ-S11-008 | USER | Create periodic control checks, review tasks, lessons and continuous-improvement items | M0219 | P4 | DG4 |
| REQ-S11-009 | USER | Preserve earlier closure and handover history when reopening a deteriorating performance area | M0219 | P4 | DG4 |
| REQ-S12-001 | USER | Implement server-side event and schedule-driven automation rules with trigger, conditions, actions, scope, owner, effective version and execution history | M0221 | P4, P5 | DG5 |
| REQ-S12-002 | USER | Give administrators a readable rule builder with dry-run preview, enable/disable, retry and a failure queue | M0221 | P5 | DG5 |
| REQ-S12-003 | ENGINEERING | Execute automation actions under the initiating or system service identity and the applicable permissions | M0221 | P4, P5 | DG5 |
| REQ-S12-004 | USER | Starter automation: when a new transformation is created, instantiate the selected methodology, forms, phase checklist, role-assignment tasks and optional 90-day plan | M0224 | P1, P2, P5 | DG5 |
| REQ-S12-005 | USER | Starter automation: when a reporting period opens or an update is due, create owner tasks and in-app reminders with direct links | M0225 | P4 | DG4 |
| REQ-S12-006 | USER | Starter automation: when an accepted KPI actual changes, recalculate dependent values and RAG, refresh live views and flag benefit validation where needed | M0226 | P4 | DG4 |
| REQ-S12-007 | USER | Starter automation: when a KPI deviates from trajectory, create or update a corrective-action case using the configured severity and persistence rule | M0227 | P4 | DG4 |
| REQ-S12-008 | USER | Starter automation: when mandatory gate evidence is missing, display the missing requirements and block unauthorized submission | M0228 | P2, P5 | DG5 |
| REQ-S12-009 | USER | Starter automation: on a valid gate submission, route the exact evidence snapshot to the required approvers | M0229 | P2, P5 | DG5 |
| REQ-S12-010 | USER | Starter automation: when a gate is approved, enable the authorized next phase or scope and create its tasks | M0230 | P2, P5 | DG5 |
| REQ-S12-011 | USER | Starter automation: when a decision SLA expires, escalate to the next configured authority and show the delay impact | M0231 | P4, P5 | DG5 |
| REQ-S12-012 | USER | Starter automation: when a critical dependency slips, notify affected owners and recompute forecast impacts using defined scheduling logic | M0232 | P4, P5 | DG5 |
| REQ-S12-013 | USER | Starter automation: when a blocker remains red across configured cycles, require a named executive decision, owner and deadline without duplicating an existing open ask | M0233 | P4, P5 | DG5 |
| REQ-S12-014 | USER | Starter automation: when benefit evidence is submitted, route it to the Finance/value validation queue | M0234 | P4, P5 | DG5 |
| REQ-S12-015 | USER | Starter automation: when a meeting cut-off is reached, generate a draft agenda and pack from current data with a review step before publication | M0235 | P4, P5 | DG5 |
| REQ-S12-016 | USER | Starter automation: when an adoption or control check fails, create a recovery action and assign owner and follow-up date | M0236 | P4, P5 | DG5 |
| REQ-S12-017 | USER | Starter automation: when a BAU handover is accepted, transfer routine ownership and activate recurring performance and control reviews | M0237 | P4, P5 | DG5 |
| REQ-S12-018 | USER | Starter automation: when a methodology or formula revision is proposed, show impact, run validation and route the change for the configured review | M0238 | P5 | DG5 |
| REQ-S12-019 | USER | Starter automation: when a connector or job fails or data becomes stale, create a visible operational exception and retain last known values with freshness labels | M0239 | P5, P6 | DG6 |
| REQ-S12-020 | ENGINEERING | Use durable background jobs, idempotency keys, bounded retries with backoff, transaction-safe event/outbox handling and an operational failure queue | M0240 | P4, P5, P6 | DG6 |
| REQ-S12-021 | ENGINEERING | Prevent duplicate reminders, actions and approvals after retries or restarts | M0240 | P4, P5, P6 | DG6 |
| REQ-S12-022 | USER | Store scheduled runs and execution outcomes in the database and expose last success, next run, failures and repair actions to authorized administrators | M0240 | P4, P5 | DG5 |
| REQ-S12-023 | USER | Always provide an in-app inbox; treat email and enterprise messaging as optional IT-configured adapters whose absence never breaks workflows | M0241 | P4, P6 | DG6 |
| REQ-S12-024 | ENGINEERING | Enforce access on notification deep links | M0241 | P4, P6 | DG6 |
| REQ-S12-025 | USER | Separate business-day timing, quiet hours, digest preferences and urgent escalation policy | M0241 | P4, P5 | DG5 |
| REQ-S12-026 | USER | Keep human business judgment, investment decisions, gate approvals and Finance attestations as accountable human actions while preparation, routing, calculation and reminders are automatic | M0242 | P4, P5 | DG5 |
| REQ-S13-001 | USER | Provide executive, transformation, workstream, Finance, adoption and personal work dashboards | M0244 | P4 | DG4 |
| REQ-S13-002 | USER | Filter dashboards by organization, transformation, owner, period, phase and status | M0244 | P4 | DG4 |
| REQ-S13-003 | USER | Let every headline number drill into its contributing records, period, calculation and evidence, distinguishing zero, unknown and not applicable | M0244 | P4 | DG4 |
| REQ-S13-004 | USER | Generate charter, diagnostic, TOM, business cases, roadmap, registers, meeting minutes, gate packs, executive dashboard and handover outputs inside the application | M0253 | P5 | DG5 |
| REQ-S13-005 | USER | Provide native reading/presentation views and actual PDF, DOCX, XLSX, PPTX and CSV exports containing the selected records, not generic placeholders | M0253 | P5 | DG5 |
| REQ-S13-006 | ENGINEERING | Neutralize formula injection in spreadsheet exports while preserving deliberately authored numeric formulas | M0253 | P5 | DG5 |
| REQ-S13-007 | USER | Retain in reporting snapshots the as-of time, reporting period, source record revisions, methodology version, calculation versions and approval state; issued snapshots are immutable while live reports refresh | M0254 | P5 | DG5 |
| REQ-S13-008 | USER | Label provisional or unvalidated values clearly in reports and exports | M0254 | P5 | DG5 |
| REQ-S13-009 | USER | Preserve bilingual Arabic RTL and English LTR layout in exports | M0254 | P5 | DG5 |
| REQ-S13-010 | USER | Provide a secure evidence repository with record linkage, evidence type, source, owner, observation period, upload date, version, checksum and review status | M0255 | P2, P5 | DG5 |
| REQ-S13-011 | ENGINEERING | Support native evidence notes and common documents/images with file-type and size controls and safe preview/download | M0255 | P2, P6 | DG6 |
| REQ-S13-012 | USER | Treat a filename or inaccessible external link as unverified evidence | M0255 | P2 | DG2 |
| REQ-S13-013 | ENGINEERING | Preserve evidence access after ownership transfer and apply the parent record's authorization to downloads and previews | M0255 | P2, P6 | DG6 |

## 3. Checks actually run

**Environment:** Linux 6.18, Python 3.11.15, Node v22.22.2, working tree `/home/user/My-owns` at HEAD `df28e87`.

### Check A: assignment self-check 1 and 2, plus register format

- **Command:** `python3 <scratchpad>/check.py`, run from the repo root.
- **What it checks:**
  1. Parses all three CSVs with Python `csv`, and checks the headers.
  2. Coverage is exactly M0075..M0255, in order, with no duplicates, and every block exists in `master-prompt.blocks.json`.
  3. Every REQUIREMENT `req_id` exists (in my file or `req-pb.csv`) and cites the block, directly or through `ref-additions-an02.csv`.
  4. Reverse direction: every M anchor my rows or additions cite is listed on that block's coverage row.
  5. CONTEXT rows have a rationale and empty `req_ids`, and any REQ ID named in a rationale exists.
  6. Register format: ID pattern S01–S13; class USER or ENGINEERING; required columns non-empty; SPECIFIED; evidence empty; increments within P0–P7; final_gate ≥ last increment and never DG0; acceptance names A01–A28 plus a pass condition; no newlines inside fields.
  7. The row's area equals the section of its first cited block.
  8. A PMI/official-claim phrase scan.
- **Result:** exit 0.

```
coverage rows: 181 unique: 181 expected: 181
section check done; sample section value: 3
phrase REQ-S01-002.notes: ...Working name only; no claim of official Mobily branding....
rows: 168
by area: {'S01': 6, 'S02': 7, 'S03': 11, 'S04': 14, 'S05': 6, 'S06': 10, 'S07': 17, 'S08': 19, 'S09': 11, 'S10': 19, 'S11': 9, 'S12': 26, 'S13': 13}
by class: {'USER': 143, 'ENGINEERING': 25}
by final_gate: {'DG2': 7, 'DG3': 9, 'DG4': 82, 'DG5': 54, 'DG6': 11, 'DG7': 5}
area x class: {('S01', 'ENGINEERING'): 1, ('S01', 'USER'): 5, ('S02', 'ENGINEERING'): 3, ('S02', 'USER'): 4, ('S03', 'USER'): 11, ('S04', 'USER'): 14, ('S05', 'USER'): 6, ('S06', 'ENGINEERING'): 1, ('S06', 'USER'): 9, ('S07', 'ENGINEERING'): 6, ('S07', 'USER'): 11, ('S08', 'ENGINEERING'): 4, ('S08', 'USER'): 15, ('S09', 'ENGINEERING'): 2, ('S09', 'USER'): 9, ('S10', 'ENGINEERING'): 1, ('S10', 'USER'): 18, ('S11', 'USER'): 9, ('S12', 'ENGINEERING'): 4, ('S12', 'USER'): 22, ('S13', 'ENGINEERING'): 3, ('S13', 'USER'): 10}
dispositions: {'CONTEXT': 25, 'REQUIREMENT': 156}
REQUIREMENT blocks mapped only to REQ-PB: 50
ref-additions: rows 69 anchors 131
acceptance ids used by my rows: ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A20', 'A21', 'A22', 'A24', 'A28']
A01-A28 not referenced by PB+S01-S13: ['A19', 'A23', 'A25', 'A26', 'A27']
ERRORS: 0
```

- **Phrase scan:** the only match is a prohibition ("no claim of official Mobily branding"), not a claim.
- **First run:** it failed with 1 error, `M0243 rationale names missing REQ-S13-014`, because S13 has 13 rows. I fixed the rationale, regenerated the files and re-ran the check, which produced the output above.

### Check B: merge plus real validator, AN-01 and AN-02 parts only, in a disposable copy

- **Commands** (in `<scratchpad>/vcopy`, a copy of `tools/`, `docs/` and `.claude/` taken before AN-03's parts existed):
  - `python3 tools/source/merge_register.py`, which gave `merged 260 requirements {...}; 181 master-prompt coverage rows` (exit 0);
  - then `node tools/gates/validate.mjs --register DG0`.
- **Result:** exit 1, `FAIL register rules at DG0 (247 problems)`. The failure is expected at that point:
  - 242 × `block M#### has no disposition`. A script check confirmed that 0 of these fall within M0075–M0255; they are AN-03's blocks.
  - 5 × acceptance A19/A23/A25/A26/A27 not referenced.
  - `grep -E "REQ-S|REQ-PB|source-coverage"` over the output returned 0 lines, so there were no problems in my rows, the REQ-PB rows or the playbook coverage.

### Check C: combined merge with AN-03's parts (informational), in a disposable copy

- **Commands:** the same two commands in `<scratchpad>/vcopy2`, taken after AN-03's parts appeared.
- **Merge:** `merged 421 requirements {'PB': 92, 'DLV': 41, 'S01': 6, … 'S13': 13, 'S14': 4, … 'S21': 4}; 423 master-prompt coverage rows`. Exit 0: no duplicate IDs or blocks, and the two ref-addition files merge cleanly.
- **Validator:** exit 1, `FAIL register rules at DG0 (7 problems)`. All 7 are in AN-03 rows:
  - REQ-DLV-020 and REQ-DLV-032 have final gate DG0 but are not IMPLEMENTED;
  - REQ-DLV-023, REQ-DLV-029 and REQ-S20-024 cite the missing `.github/workflows/delivery-gates.yml`.
- **My rows:** none of the 7 problems concerns my rows or coverage, and every A01–A28 scenario is referenced in the combined register.
- **Status:** not claimed as passed. The combined DG0 register check still depends on AN-03 and orchestrator work.

The candidate tree was not modified by any check. `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv` were produced only in the disposable copies.

## 4. Known gaps, uncertainties and not done

1. **No SOURCE rows in S01–S13 (deliberate).**
   - The master prompt §4/§5/§9/§10/§13 tables restate playbook content, so I mapped those blocks to the existing `REQ-PB` rows through ref-additions.
   - New S rows cite only M anchors and are USER or ENGINEERING. Where a row elaborates a playbook item, its `notes` name the related REQ-PB ID.
   - This also avoids touching `source-coverage.csv`, which AN-01 owns: a new row citing a B block would need that file edited.
   - The domain reviewer may decide that some rows should be SOURCE instead, for example S04-003…008 (phase procedures) or S11-005 (handover content). That change needs coordinated edits to `source-coverage.csv`.
2. **Master-prompt wording vs playbook verbatim.**
   - Several master-prompt table rows paraphrase the playbook. Examples: wave entry "Sponsor and charter" vs the playbook's "Sponsor + charter"; T11 "Business Owners and Finance".
   - Where they differ, the REQ-PB rows keep the **playbook** wording, which is authoritative.
   - The M anchors are appended to show that the master-prompt row is covered, not that its paraphrase replaces the source text.
3. **Implementation assumptions** (all labelled in `notes` or in the permissions matrix):
   - the exact gate transition table (S04-010);
   - RAG threshold defaults (S07-007);
   - the 0–100 conversion `(score−1)/4×100` (S09-001; the master prompt only requires labelling and documentation);
   - the default gate approver SP, and the per-cell defaults in the permissions matrix;
   - the ADM sub-profiles (technical, access, methodology);
   - sensitive-record categories.

   Mobily's business owners must confirm the permission defaults.
4. **Arithmetic in the acceptance examples.** Reviewers may wish to recheck:
   - S08-007: 0.02 × 100000 × 50 = 100000 SAR;
   - S09-001: (3.30−1)/4×100 = 57.5;
   - S07-010: (1+9)/(10+10) = 0.50;
   - S08-019: the NPV check names a "fixture cash-flow set" without numbers. The QA verifier must define the fixture.
5. **Conditional approval (S04-011) and NPV/ROI/payback (S08-019)** are marked as extensions and default to disabled.
6. **English only.** The journeys and the permissions matrix are in English. The Arabic terminology is in AN-01's `glossary.md`, and its terms are still proposals needing native-speaker review.
7. **Out of scope.** I did not create DLV or S14–S21 rows, and I did not edit `req-pb.csv`, `source-coverage.csv`, the glossary or the field inventory.
8. **DG0 is not approved.** This task produces analysis inputs only. I do not review or approve my own deliverables.

## 5. Merge instructions

- No migrations are needed. I own `REQ-S01-*`…`REQ-S13-*` exclusively; the highest numbers per area are listed in §2.
- Run `python3 tools/source/merge_register.py` from the repo root. It reads `req-*.csv`, `ref-additions-*.csv` and `mp-coverage-*.csv`.
  - Check C shows it merges cleanly with AN-01 and AN-03 (421 requirements, 423 coverage rows).
  - Ref-additions from AN-02 and AN-03 on the same REQ-PB row are appended and de-duplicated by the script.
- **Row-number dependencies:**
  - Coverage rationales for M0075, M0082, M0091, M0115, M0126, M0151, M0157, M0165, M0175, M0186, M0214, M0220, M0222, M0223 and M0243 name ID ranges.
  - `permissions-matrix.md` and `user-journeys.md` also cite specific IDs.
  - Renumbering would require regenerating these files.
