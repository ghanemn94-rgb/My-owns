# Product Requirements Document — Mobily Transformation & Transactions Hub

| Item | Value |
|---|---|
| Status | Draft v0.1 for P0 review (domain + architecture/QA). Not yet reviewed. |
| Date | 2026-09-29 |
| Owner | delivery-orchestrator |
| Specification | `docs/MASTER_PROMPT.md` v1.0 (verbatim; authoritative) |
| Requirement register | `docs/requirements/requirements.yaml` (394 requirements, all `Planned`) |
| Backlog | `docs/requirements/backlog.md` (phase → epic → story, with owners and reviewers) |

> **Read this first.** This PRD states no Mobily facts. The committee chair, members, partners, amounts, dates,
> ownership percentages, incorporation status and hosting environment are unknown and appear as `TBD` or
> `Role — To be confirmed` (REQ-PLT-004, REQ-GOV-006). The reference tracker image and the Excel workbook were not
> available in the build environment, so image extraction was not performed; the section 2 summary of the master prompt is
> used only as preliminary, unverified requirements (REQ-SRC-001, REQ-SRC-003, REQ-SRC-004). "Working name" and
> every template, gate, cadence and threshold below is a **proposal** for approval by authorized Mobily owners.

---

## 1. Vision and scope

### 1.1 Problem

Mobily's corporate transformation function is running a Data Center carve-out: separating the business, setting up an
independent company (NewCo), and later moving to a Joint Venture (JV), under a dedicated steering committee. The only
reference available in the build environment is a partial reading of a tracker image for initiative
*N4 — Unlock delayering potential (e.g., DCs)*. Its historical statuses (e.g., "Completed", "On Track") cannot be
treated as current. The program needs one system of record that:

- keeps separate the facts that are often blurred together: a registered company versus transferred assets, signing
  versus closing, approval versus execution, and activity versus verified evidence
- enforces delegated authority, quorum and segregation of duties on the server, not by convention
- protects partner, clean-team, legal and finance information from inference as well as from direct access
- can be reused for other programs and projects without code changes

### 1.2 Vision

A secure, bilingual (Arabic RTL / English LTR) enterprise platform. It is the integrated source of truth for program,
committee and transaction management. The team can manage the carve-out, the committee, the NewCo transition and the JV, add
further projects from templates, run controlled proactive AI monitoring, and deploy inside Mobily's own
environment, with AI switched off if required (REQ-PLT-003, master prompt section 23).

### 1.3 Scope

- **First template: DC Carve-out → Standalone NewCo → JV** (REQ-ENT-001). It includes business gates G0–G7
  (REQ-LCY-002..004), 12 editable workstreams with their minimum scope (REQ-WS-001..002), and a proposed WBS of at least 80
  activities that is initially Draft/Unverified (REQ-WS-004..007).
- **Multi-project enterprise structure:** Organization → Portfolio → Program → Project → Workstream →
  Milestone/Task/Deliverable (REQ-ENT-002). Legal entities are modelled separately from projects (REQ-ENT-003). Additional
  templates are provided for general transformation, strategy, technology and other transactions (REQ-ENT-005). Projects
  are created through administration without code changes (REQ-ENT-006). Templates are versioned, and a template change
  only reaches a project after preview and approval (REQ-ENT-007..009).
- **Capabilities covered:**
  - committee and decision lifecycle
  - integrated planning, RAID and change control
  - gates, waivers and status dimensions
  - perimeter, transfers, agreements and consents
  - NewCo and regulatory readiness
  - Day-1, cutover and TSA
  - finance, value and benefits
  - partner process, diligence, signing, closing and post-close
  - documents, evidence and source register
  - reporting and exports
  - imports and integrations
  - notifications
  - Runtime AI Project Manager
  - audit
  - private deployment

### 1.4 Product principles (derived from the mandatory rules)

1. **Evidence over activity.** Task completion never unlocks a gate or closes a transaction. Evidence, approvals and
   mandatory criteria are validated on the server (REQ-LCY-011, REQ-JV-017, REQ-JV-018, REQ-PLN-011).
2. **Independent dimensions.** Incorporation, legal/economic transfer, operational readiness and JV signing/closing are
   tracked separately (REQ-LCY-006, REQ-LCY-007).
3. **Approval is not execution.** An approved decision moves to Implementation Pending. It reaches Implemented-Verified only
   with evidence (REQ-GOV-020, REQ-GOV-018).
4. **Never invent. Label what is unknown.** Verification status is recorded on every fact (REQ-SRC-008). Demo data is
   badged and excluded from actual reporting (REQ-UX-028, REQ-SET-005).
5. **Deny by default and do not leak.** Restricted resources return 404, not 403. Counts, search and AI retrieval are
   filtered inside SQL (REQ-SEC-003, REQ-SEC-006, REQ-ENT-013, REQ-AI-006).
6. **Honest status.** Status labels are Implemented / Tested / Simulated / Not configured / Blocked. A mock is never shown as
   "Connected" (REQ-PLT-006, REQ-INT-013).
7. **AI assists; authorized people decide.** The AI cannot approve, verify, waive, grant access, contact partners, pay or
   close (REQ-AI-025).
8. **Works without AI and without the internet.** Core functions run with AI Off and egress blocked (REQ-AI-019,
   REQ-DEP-003, REQ-DEP-014).

---

## 2. Users and personas

Roles are the proposed role catalogue (REQ-SEC-001), applied at organization, portfolio, project, workstream and
document/partner-room levels (REQ-ENT-011). The table describes functional personas, not named people.

| Persona | Platform role(s) | Primary needs | Main screens | Key restrictions |
|---|---|---|---|---|
| PMO / CPMO | Secretary/CPMO, Project Manager | Set up the project, run the plan and RAID, prepare committee packs, chase updates | Portfolio Home, Integrated Plan, Committee Hub, RAID & Change Control, Reports & Administration | Cannot approve their own requests (REQ-SEC-004); baseline changes go through change control (REQ-PLN-013) |
| Committee chair | Committee Chair (`Role — To be confirmed`; never defaulted to CEO or any chief, REQ-GOV-006) | Decide within mandate; see asks, blockers and evidence | DC Executive Cockpit, Committee Hub, My Work / Inbox | Authority limited to the approved authority matrix (REQ-GOV-010, REQ-GOV-022); out-of-mandate decisions become recommendations (REQ-GOV-023) |
| Committee members (voting/advisory) and guests | Committee membership seats | Review frozen packs, declare conflicts, vote or resolve by circulation | Committee Hub, My Work / Inbox | Recused members are excluded from quorum and voting (REQ-GOV-015, REQ-SEC-005) |
| Secretary | Secretary/CPMO | Screen agenda requests, compile agendas and minutes, track actions | Committee Hub | Minutes approval by the chair or designated authority (REQ-GOV-017) |
| Sponsor | Sponsor | Portfolio and program health, value, escalations | Portfolio Home, DC Executive Cockpit | Read access within scope |
| Workstream lead | Workstream Lead | Manage tasks, deliverables, updates, risks and readiness for one workstream | Workstream Workspace, Day-1 & TSA Center | Edits limited to own workstream (REQ-ENT-011) |
| Contributor | Contributor | Update assigned tasks, upload evidence | My Work / Inbox, Workstream Workspace | No approvals |
| Functional approver | Functional Approver | Accept deliverables, sign off readiness, verify transfers and exits | My Work / Inbox, Perimeter & Transfers, Day-1 & TSA Center | Must differ from submitter where policy requires |
| Finance (restricted) | Finance Restricted | Baseline/forecast/actual, costs, reconciliations, valuation references, benefits | Finance & Value | Human validation required before approval (REQ-FIN-010) |
| Legal / regulatory (restricted) | Legal Restricted | Agreements, consents, regulatory register, CPs, applicability determinations | NewCo & Regulatory Readiness, JV & Diligence | The platform makes no legal determinations; specialists decide (REQ-LCY-005, REQ-AGR-007) |
| Clean team | Clean Team | Competition-sensitive diligence material | JV & Diligence | Separate room ACL; no leakage through search, AI or counts (REQ-ENT-012) |
| Auditor | Auditor/Read-only | Audit trail, evidence, frozen reports | Document & Evidence Center, Reports & Administration | Read-only |
| External partner (limited) | External Partner Limited | Answer or receive DD requests within an explicitly granted room | JV & Diligence (restricted room) | NDA alone grants nothing; access is explicit and revocable (REQ-JV-005, REQ-JV-009) |
| Platform admin | Platform Admin, Portfolio Admin | Users, roles, templates, integrations, deployment settings | Reports & Administration | Infrastructure administration does not include transaction-content access (REQ-SEC-002) |
| Service identities | Worker / AI / BI / integration accounts | Background processing | — | Least privilege; authorization re-checked at execution (REQ-SEC-010, REQ-AI-027) |

---

## 3. Key user journeys

Each journey is a primary action. Per REQ-PLT-005, a journey is complete only when every step has backend logic,
server-side authorization, persistence and automated tests.

| # | Journey | Steps (condensed) | System guarantees | Requirements | Acceptance |
|---|---|---|---|---|---|
| J1 | Create a project from a template | Portfolio Admin selects a template version → defines program, objective, parties and sites (wizard step 1) → workstreams, WBS, gates and registers are created → owners assigned | No code change or database duplication; project pinned to template version; demo vs production separation | REQ-ENT-001, -005, -006, -008; REQ-WS-001..007; REQ-SET-009; REQ-UX-004 | AT-02, AT-26, AT-30 |
| J2 | Define the separation perimeter | Record perimeter items across all categories → classify Included/Excluded/Shared/Pending → set transfer mechanism, consent and transferability (by specialist) → reconcile gaps → approve perimeter (wizard step 4) | Physical assets alone are not the perimeter; items without a plan or evidence are listed; changes after baseline create a change request with impact and keep the previous version | REQ-PER-001..007; REQ-AGR-006, -008; REQ-SET-012; REQ-UX-010 | AT-07, AT-08 |
| J3 | Approve the plan and baseline | Build WBS and dependencies (FS + lag on the Riyadh calendar) → critical path, or "Incomplete schedule" → submit baseline → authorized approval → later change requests and rebaselining | Acyclic graph; baseline immutable; optimistic concurrency (409 on conflict); schedule-based forecasts only | REQ-PLN-004..010, -013, -023, -024; REQ-DAT-005; REQ-SET-014 | AT-15, AT-16 |
| J4 | Committee decision lifecycle | Agenda request → secretariat screening → decision paper → numbered agenda → quorum/conflict checks → vote or circulation → minutes approval → actions with owners/dates → implementation tracking → verified closure | Authority enforced from the approved matrix only; out-of-mandate → Recommendation/Pending external authority with gate still blocked; no self-approval; historical votes immutable; frozen packs | REQ-GOV-001..027; REQ-SEC-004, -005; REQ-UX-007 | AT-04, AT-05, AT-30 |
| J5 | Assess a gate | Criteria applicability set by specialists → evidence linked → assessGate on the server → waiver request (if waivable) → approval by waiver authority → reopen if evidence proves defective | Tasks at 100% never unlock a gate; non-waivable criteria cannot be waived; reassessment keeps prior decisions | REQ-LCY-001, -005, -010..015; REQ-DAT-014 | AT-12, AT-13, AT-14 |
| J6 | NewCo, Day-1 readiness and TSA | Record NewCo status with evidence (wizard step 2) → readiness checklists with mandatory blockers and specialist sign-offs → cutover plan → go/no-go → post-transition acceptance → TSA lifecycle to exit acceptance | Incorporation is shown separately from transfer and operations; a failed blocker blocks go-live; an expired TSA is Expired-unresolved, never "exited"; no automatic extension | REQ-LCY-006, -007, -014; REQ-RDY-001..006; REQ-TSA-001..006; REQ-SET-010 | AT-06, AT-09, AT-10 |
| J7 | Partner, diligence and closing | Longlist/shortlist → outreach approval → NDA → explicit room access grants → DD Q&A with release approval → findings → negotiation issues → signing checklist → closing(s) with CPs → authorized closing confirmation → post-close obligations | Partner preparation may run in parallel with separation where authorized; missing blocking CP rejects closing even if everything is green; funds flows tracked, never executed | REQ-JV-001..019; REQ-LCY-008, -009; REQ-ENT-012 | AT-11, AT-12, AT-13 |
| J8 | Finance and value | Baseline/forecast/actual with currency, unit, period and source → cost categories → committed vs spent → imported model outputs → proposed vs approved valuation → human validation → benefits | Mixed-currency/unit aggregation rejected without an explicit basis; EV vs equity confusion flagged; no automated valuation claims | REQ-FIN-001..010; REQ-DAT-003, -004 | AT-29 |
| J9 | Reports and committee pack | Generate an executive summary, committee pack or specialist report → immutable snapshot → export XLSX/PDF/PPTX/DOCX | Generated from real data; metadata (as-of date, scope, baseline, unverified data, classification, sources); permissions re-checked on every access | REQ-RPT-001..017; REQ-GOV-021, -026 | AT-24 |
| J10 | Import sources and review claims | Upload workbook/minutes/PDF/image → safe pipeline → mapping, preview and duplicates → claims with confidence and location → review → compare-before-merge → approve | Historical values stay Historical-unverified; unclear OCR never fills official fields; governed records are never overwritten outside change control | REQ-SRC-002..009; REQ-INT-001..005, -015; REQ-SET-011 | AT-01, AT-14, AT-25 |
| J11 | Runtime AI PM | Enable per project (Advisory by default) → scheduled briefings (Asia/Riyadh) → findings and proposals → assisted execution with bound approval → kill switch | Knowledge limited to authorized sources, with ACL applied before retrieval; citations; injection-resistant; no autonomous authority; platform unaffected when AI is off or over budget | REQ-AI-001..039; REQ-SEC-018; REQ-DEP-021 | AT-17..AT-21, AT-28 |

---

## 4. Functional requirements by module

The register is the source of detail. This table maps modules (as in `CLAUDE.md`) to requirement IDs.

| Module | Summary | Requirements | Phase(s) |
|---|---|---|---|
| Identity and access | Role catalogue, RBAC+ABAC deny-by-default, multi-level scopes, sessions, service accounts, dev identity, SSO/MFA | REQ-SEC-001..003, -008..010, -024; REQ-ENT-011; REQ-ARC-006; REQ-SET-008 | P1, P7 |
| Portfolio and enterprise structure | Hierarchy, legal entities and sites, portfolio/program/project/workstream views, project creation | REQ-ENT-002..004, -006 | P1–P2 |
| Project configuration (templates) | DC template, other template types, versioning, upgrade preview, configurable gates/fields/forms/workflows/KPIs, 12 workstreams, WBS, setup wizard | REQ-ENT-001, -005, -007..009; REQ-WS-001, -002, -004..006; REQ-SRC-002; REQ-PLN-019; REQ-SET-007, -009, -015, -016 | P1, P6 |
| Governance (committee) | Workspace, multiple committees, charter, membership, authority matrix, agenda→decision→minutes→actions, state machine, packs, votes, escalations, SoD, quorum | REQ-GOV-001..025, -027; REQ-SEC-004, -005; REQ-SET-013 | P2 |
| Planning | Connected WBS, views, RACI, baselines, dependencies, CPM, calendar, task states, RAID, change requests, periodic updates, measurement rules, what-if | REQ-PLN-001, -003..017, -023, -024; REQ-WS-003, -007; REQ-ENT-010; REQ-LCY-008; REQ-SET-014 | P1–P2, P4 |
| Gates and status dimensions | G0–G7 templates, criteria/applicability, assessments, waivers, reassessment, four status dimensions, program closure | REQ-LCY-001..006, -010..013, -015; REQ-JV-019 | P2–P4 |
| Carve-out | Perimeter register, classification, impact, reconciliation, transfers, agreements, approvals, transferability, consents | REQ-PER-001..007; REQ-AGR-001..003, -005, -006, -008; REQ-SET-012 | P3 |
| NewCo and regulatory | Incorporation status with evidence, regulatory register, no legal assertions | REQ-LCY-007; REQ-AGR-004, -007; REQ-SET-010 | P3 |
| Readiness and TSA | Readiness checklists, domains, cutover plans, go/no-go, acceptance, TSA register and lifecycle, exit approval, independence definition, no device control | REQ-RDY-001..006; REQ-TSA-001..006; REQ-LCY-014 | P3 |
| Finance | Baseline/forecast/actual, cost categories, commitments, reconciliations, business plan versions, proposed vs approved values, checks, model imports, benefits, human validation, money rules | REQ-FIN-001..010; REQ-DAT-003, -004 | P1, P4 |
| JV / DD | Partner workspace and rooms, longlist, stages, outreach, NDA vs access, scenarios, negotiation, VDR, Q&A, findings, signing/closing, CPs, funds flow, post-close | REQ-JV-001..018; REQ-LCY-009; REQ-ENT-012; REQ-SET-002 | P4 |
| Documents and evidence | Source register and claims, evidence, versions, file validation, legal hold, disposal, no public links, no inference | REQ-SRC-001, -003..008; REQ-ENT-013; REQ-DAT-010..012; REQ-SEC-013 | P0–P2, P7 |
| Reporting | Reports, packs, KPI catalogue/definitions, snapshots, exports, BI, RAG/health rules, committee export classification, demo exclusion | REQ-RPT-001..017; REQ-GOV-026; REQ-PLN-018, -020..022; REQ-SEC-017; REQ-INT-011; REQ-SET-005 | P1–P2, P6 |
| Imports | Excel/CSV wizard, approvals and history, rollback, safe document pipeline, OCR uncertainty, compare-before-merge, governed-record protection | REQ-INT-001..005, -015; REQ-SRC-009; REQ-SEC-015; REQ-SET-011 | P6 |
| Integrations | Honest status, M365 adapters (optional), read vs write connectors, future integrations, signed webhooks, reliability, connectivity validation | REQ-PLT-006; REQ-INT-006..010, -013, -014 | P1, P6 |
| Notifications | In-app via outbox; external channels disabled until authorized; re-check at every send | REQ-PLT-008; REQ-AI-035; REQ-INT-012 | P2, P5–P6 |
| AI runtime | Knowledge, retrieval, capabilities, modes, permission matrix, action engine, security, evaluations, model provider | REQ-AI-001..039; REQ-SEC-018; REQ-DEP-021 | P5 |
| Audit | Append-only, hash-chained (tamper-evident) audit, sensitive-access logs, export | REQ-DAT-006..008; REQ-SEC-019 | P1–P2, P7 |
| Platform and architecture | Stack, PostgreSQL, ORM/RLS, worker, storage adapters, OpenAPI, modular monolith, mutation flow, domain commands, concurrency, API conventions, isolation | REQ-PLT-001, -002, -004, -007; REQ-ARC-001..005, -007, -010..014; REQ-DAT-001, -002, -005, -009, -013..017; REQ-SEC-006, -007, -014, -016 | P0–P2, P6–P7 |
| Web experience | 16 screens, bilingual, i18n, theme, cross-cutting screen standards, responsive, accessibility, RTL tests | REQ-UX-001..028; REQ-PLN-002; REQ-PLT-005; REQ-ARC-015 | P1–P7 |
| Deployment | Deployment modes, containers, Helm/OpenShift, network, config validation, adapters, supply chain, runbooks, egress control, environments, sizing, performance, backup/restore, CI | REQ-DEP-001..020, -022; REQ-SEC-011, -012, -020 | P1, P7–P8 |
| Delivery process | Agent setup and rules, phase gates, documentation artifacts, UAT, handover | REQ-AGT-001..012; REQ-PHS-001..029; REQ-SRC-010 | P0–P8 |

**Screens (section 10):** each of the 16 screens has its own requirement, REQ-UX-004..020 (screen 16 is split into
administration, P1, and reporting/integrations/deployment settings, P6). Every screen must meet REQ-UX-021..024: search and
filtering, loading/empty/error/restricted states, activity history and source links, and metric drill-down.

---

## 5. Non-functional requirements

### 5.1 Security and privacy

- Every mutation follows Authentication → Authorization → Validation → Business rules → one database transaction with
  audit and outbox → worker (REQ-ARC-014). Status changes only through domain commands; generic CRUD cannot bypass
  business rules (REQ-DAT-013).
- RBAC plus ABAC (scope, classification, counterparty, action), deny by default (REQ-SEC-003). Segregation of duties,
  no prohibited self-approval, and server-computed quorum (REQ-SEC-004, REQ-SEC-005).
- CSRF/XSS/injection/IDOR protection (REQ-SEC-016). File validation and malware quarantine (REQ-SEC-013). SSRF and path
  traversal prevention (REQ-SEC-014). Sandboxed conversion (REQ-SEC-015). Formula-injection neutralization (REQ-SEC-017).
- Sessions expire and can be revoked. Service accounts are separate with least privilege. The development identity is
  isolated, with no default passwords (REQ-SEC-009, -010, -024; REQ-SET-008).
- TLS and encryption under the approved architecture. Secrets are managed externally and never appear in source control,
  frontend bundles or test reports (REQ-SEC-011, -012).
- AI egress is gated by classification, DLP and approved destinations (REQ-SEC-018). Hosting, AI processing, backups and
  support access are treated as separate data flows (REQ-SEC-023).
- A compliance applicability matrix (NCA, PDPL, sector) is maintained as reference for assessment. It is **not** a
  declaration of compliance (REQ-SEC-022).

### 5.2 Isolation

- **Structural and database isolation:** every project-scoped row carries organization and project IDs. Composite foreign
  keys stop cross-project links (REQ-DAT-002). PostgreSQL row-level security acts as defense in depth, and out-of-scope
  resources return 404 (REQ-SEC-006).
- **Isolation across other channels:** the same rules apply to reports, search, AI (retrieval, caches, embeddings,
  memory), files, notifications and background jobs (REQ-SEC-007, REQ-AI-006, REQ-AI-007).
- **Inference:** users cannot learn about restricted items from titles, snippets or counts (REQ-ENT-013).
- **Verification:** the two-project isolation suite (AT-03) runs at P1 and is re-run at every later gate.

### 5.3 Data integrity and audit

- Money: decimal amounts with currency, unit and period, never floating point (REQ-DAT-003). Aggregation across currencies
  or units requires an explicit conversion basis (REQ-DAT-004).
- Optimistic concurrency: a conflicting write returns 409 and requires a reload (REQ-DAT-005).
- Audit: append-only, recording actor, time, reason, before/after values and correlation ID (REQ-DAT-006). It is
  hash-chained and described as tamper-evident, **not** tamper-proof (REQ-DAT-008). It can be exported to an independent
  repository (REQ-DAT-007).
- Deletion and retention: soft deletion (REQ-DAT-009); legal hold (REQ-DAT-010); authorized disposal (REQ-DAT-011).
- Files: no permanent public links (REQ-DAT-012).
- Reassessment: evidence, permission or perimeter changes trigger reassessment and cache invalidation (REQ-DAT-014).

### 5.4 Internationalization and RTL

- Arabic RTL and English LTR, switchable at any time, with a consistent glossary (REQ-UX-001).
- All interface text comes from i18n keys; code and technical field names stay in English (REQ-UX-002).
- RTL is tested with mixed-language text, dates and tables (REQ-UX-027).
- Arabic PDF, PPTX and DOCX output is checked visually (REQ-RPT-008..010, AT-24).
- Business dates are local Asia/Riyadh dates; timestamps are stored in UTC (REQ-PLN-010).

### 5.5 Accessibility and devices

- **Accessibility:** contrast, keyboard access and screen-reader labels. Proposed target: WCAG 2.1 AA, verified with automated axe
  checks and manual keyboard passes (REQ-UX-026).
- **Devices:** responsive desktop, tablet and mobile browsers; no native app (REQ-UX-025).

### 5.6 Performance — proposals to be measured

All figures below are **proposed goals**, not commitments. They will be measured on a stated dataset and workload
(REQ-DEP-016, REQ-DEP-017). A passing result on a small machine does not establish enterprise capacity.

| Aspect | Proposed goal (to be measured and confirmed) |
|---|---|
| Reference dataset | 3 portfolios, 15 projects, 20,000 tasks, 50,000 document versions, 300 named users, 50 concurrently active users (synthetic) |
| Ordinary reads (list or detail, `pageSize` ≤ 100) | p95 ≤ 800 ms at the API |
| Ordinary mutations (including audit and outbox in one transaction) | p95 ≤ 1,500 ms |
| Schedule recalculation (CPM) for a 5,000-task project | ≤ 10 s in the worker, with "Incomplete schedule" returned when data is missing |
| Committee pack generation (snapshot plus PDF/PPTX) | ≤ 2 min in the worker |
| Upload size limit | 200 MB per file (configurable) |
| XLSX export limit | 100,000 rows per export (configurable); larger exports rejected with guidance |
| API rate limits | Per identity and per endpoint class (REQ-DAT-016); values set during P7 load testing |

### 5.7 Availability, backup and recovery — proposals pending Mobily infrastructure approval

| Aspect | Proposal (pending approval) |
|---|---|
| Availability | 99.5% monthly during business hours (Sun–Thu, Asia/Riyadh), depending on the approved hosting topology |
| RPO | ≤ 1 hour (PostgreSQL WAL archiving plus object-store versioning) |
| RTO | ≤ 8 hours for full restore of database, files, permissions, history, audit and indexes |
| Evidence | Restore drill with measured recovery time; no mass redelivery of jobs after restore (REQ-DEP-018, REQ-DEP-019; AT-23) |

Docker Compose is for development and evaluation only and does not by itself provide high availability (REQ-DEP-007).

### 5.8 Private hosting and AI modes

- **Deployment modes:** four are supported — Local Development, Mobily Private with AI Off, Mobily Private with Local AI, and Mobily
  Private with an Approved AI Gateway (REQ-DEP-002..005).
- **Private mode:** unapproved outbound traffic, public telemetry, fonts and CDNs are blocked (REQ-DEP-014; AT-22).
- **Models:** the Model Provider interface does not assume Claude weights are available on-premises, and platform operation does not
  depend on AI (REQ-DEP-021; AT-21).
- **Deliverables:** non-root images with probes, Helm charts with OpenShift support, ingress/TLS/custom CA/proxy settings, configuration validation
  that rejects unsafe production settings, adapters, SBOM and scans, and runbooks (REQ-DEP-006..013).

### 5.9 Reliability of background processing

- **Durable processing:** outbox and job queue with idempotency keys, retry with backoff, dead-letter handling,
  deduplication, cooldown and quiet hours (REQ-AI-026, REQ-AI-028, REQ-INT-010).
- **Re-authorization:** authorization is checked again at execution time (REQ-AI-027).
- **Uncertain deliveries:** reconciled rather than resent blindly (AT-20).

### 5.10 Observability and operability

- OpenTelemetry to an internal collector only, with no content in telemetry (REQ-ARC-009).
- Health and readiness probes (REQ-DEP-006).
- Runbooks for install, upgrade, migration, rollback, backup/restore, monitoring, incident response and provisioning
  (REQ-DEP-013, REQ-SEC-020).

---

## 6. Out of scope and non-goals

| Non-goal | Reason / rule | Requirements |
|---|---|---|
| No control of data center devices, networks or power | The platform documents work. Operational changes happen in approved operational systems and evidence is recorded here | REQ-RDY-006 |
| No payment execution | Closing funds flows are tracked only | REQ-JV-015, REQ-AI-025 |
| No legal or regulatory determinations | Applicability, waivability, transferability and CP satisfaction are decided by authorized specialists | REQ-LCY-005, REQ-AGR-006, REQ-AGR-007, REQ-AI-018 |
| No legally certified e-signature | Internal approvals are labelled as internal unless an approved signature solution is integrated and verified | REQ-GOV-027 |
| No automated professional valuation | Import model outputs and run consistency checks only; a full valuation engine is not built | REQ-FIN-007, REQ-FIN-008 |
| No LLM-generated delay probabilities | Only schedule-based forecasts, unless a documented, calibrated model exists | REQ-PLN-023 |
| No advanced resource optimization | Responsibility matrix and owner-conflict flags only | REQ-PLN-014 |
| No prevention of screenshots or copying after download | Disclosure history and revocation only | REQ-JV-009 |
| No recall of externally delivered messages | Compensation only for reversible internal changes | REQ-AI-032 |
| No native mobile app | Responsive web only | REQ-UX-025 |
| No microservices or external SaaS for core services | Modular monolith plus worker; self-hostable | REQ-ARC-011, REQ-ARC-012 |
| No compliance declarations | Applicability matrix only | REQ-SEC-022 |
| In the build environment: no real Mobily data, real messages, production deployment, or enterprise identity/infrastructure changes | Mandatory rule 9; source boundaries | REQ-PLT-007, REQ-SRC-010 |
| No claim that a local model is equivalent to Claude, and no assumption that Claude weights are deployable in Mobily data centers | Model Provider interface; measured quality only | REQ-DEP-004, REQ-DEP-021 |

---

## 7. Constraints and assumptions

### 7.1 Constraints

1. **No real data.** The build environment contains synthetic data only. Demo records are flagged, badged and excluded
   from actual reporting (REQ-SRC-010, REQ-SET-005).
2. **Sources unavailable.** The reference image and Excel workbook were not available and image extraction was not
   performed. The section 2 headings are preliminary and Historical-unverified (REQ-SRC-001..004).
3. **Committee chair unknown.** The chair seat stays `Role — To be confirmed`. Production approval authority stays inactive
   until an authority matrix is approved; a clearly labelled Demo policy is allowed in the sandbox (REQ-GOV-006,
   REQ-GOV-010, REQ-GOV-011).
4. **Hosting unknown.** Deployment is prepared for a Mobily-specified environment without assuming a provider or access
   (REQ-DEP-002..005, REQ-DEP-020).
5. **No enterprise identity, SIEM, VDR, M365, ERP or HR access.** These are built as adapters and reported as Not configured or
   Simulated (REQ-PLT-006, REQ-INT-008, REQ-INT-014).
6. **No outbound messaging.** Email, Teams and SMS stay disabled until authorized destinations and sending authority are
   configured (REQ-AI-035).
7. **AI cost is separate.** The Claude Code subscription used for development does not cover production inference or its licensing and cost
   (REQ-DEP-001, REQ-DEP-021).
8. **Independent review depends on the environment.** If separate-context reviewers cannot run, the gate is Blocked rather
   than self-approved (REQ-AGT-012).

### 7.2 Working assumptions (reversible)

These will be recorded with owners in `docs/assumptions-and-open-questions.md` (REQ-AGT-003):

- Default timezone is Asia/Riyadh, with a proposed Sunday–Thursday working week and editable holidays (REQ-PLN-010).
- Currency is always explicit on every amount. No default currency value is assumed (REQ-DAT-003).
- Gate evidence lists, committee cadence, functional membership, RAG thresholds, KPI targets and WBS durations are
  **proposals** (REQ-LCY-005, REQ-GOV-009, REQ-PLN-019, REQ-RPT-014, REQ-WS-006).
- The proposed stack (TypeScript monorepo, Next.js/React, NestJS, PostgreSQL, a separate worker, an S3-compatible
  adapter, OIDC) is a portable baseline. It says nothing about Mobily's current infrastructure (REQ-ARC-001..013).
- "Secretary" and "CPMO" are one charter role (Secretary/CPMO) unless the approved charter separates them.

---

## 8. Release phases (P0–P8)

Phase outputs and exit criteria follow master prompt section 19. Each phase needs at least two independent reviews in
separate contexts: QA, plus a domain, security or architecture reviewer. No phase passes with open Critical/High findings or with
unexecuted verification (REQ-PHS-011..014).

| Phase | Goal | Exit criteria (summary) | Key acceptance scenarios | REQs |
|---|---|---|---|---:|
| P0 Discovery & Blueprint | Source review, facts/assumptions, PRD, backlog, WBS, draft charter, ERD, ADRs, threat model, agent setup | Complete traceability; source/design separation; domain + architecture/QA review (REQ-PHS-002) | — | 21 |
| P1 Secure Foundation | Running application, migrations, dev identity, portfolio UI, template-based project creation, RBAC/ABAC, audit, CI | Persistence after restart; two isolated projects; unauthorized access denied; security + QA review (REQ-PHS-003) | AT-02, AT-03, AT-26 | 82 |
| P2 Governance & Delivery | Committee, meetings, decisions, actions; WBS, RAID, change, baselines, gates; initial dashboard | Decision request → authorized approval → action → closure evidence; out-of-authority decisions blocked; domain + QA review (REQ-PHS-004) | AT-04, AT-05, AT-13, AT-15, AT-16, AT-27 | 85 |
| P3 Carve-out & NewCo | Perimeter, transfers, consents, agreements, incorporation, TSAs, Day-1/cutover readiness | Incorporation recorded while transfer/operations are incomplete; blockers prevent go-live; perimeter-change impact; domain + security/QA review (REQ-PHS-005) | AT-06..AT-10 | 37 |
| P4 JV & Finance | Business plan/valuation references, costs/benefits, partner/DD/Q&A, signing/closing/CPs/post-close | Missing CP blocks closing; partner isolation; NDA alone insufficient; financial reconciliation; domain/security/QA review (REQ-PHS-006) | AT-11, AT-12, AT-13, AT-29 | 39 |
| P5 Proactive AI PM | Ingestion/RAG, constrained tools, modes, proposals/approvals, scheduler, kill switch, evaluations | Scheduled briefing after the browser closes; valid citations and permissions; no duplicate actions; injection resistance; security + QA review (REQ-PHS-007) | AT-17..AT-21, AT-28 | 45 |
| P6 Reporting & Interoperability | Excel import; PDF/PPTX/DOCX/XLSX; committee packs; adapters; integration docs | Reviewed sample import; reports reconcile to sources; correct RTL; honest connection status; QA + architecture/domain review (REQ-PHS-008) | AT-01, AT-14, AT-24, AT-25 | 45 |
| P7 Enterprise Readiness | Hardening, load tests, SSO adapter, Helm/containers, private/offline modes, backup/restore, runbooks | Fresh install and restore; two-project isolation with AI Off and egress blocked; DevOps/security + independent QA review (REQ-PHS-009) | AT-21, AT-22, AT-23 | 30 |
| P8 Pilot & Handover | UAT, guides, walkthrough, deployment pack, limitations register, transition plan | Critical journeys pass; independent review evidence; no open critical defects; Mobily production approvals documented as still required (REQ-PHS-010) | AT-30 | 10 |

"Engineering verification complete" is separate from Mobily production approval. Production approval requires Mobily's
actual infrastructure, security and business owners (REQ-PHS-027).

---

## 9. Success metrics

### 9.1 Delivery (engineering verification) — measured by the delivery team

| Metric | Target |
|---|---|
| Requirement coverage | 100% of `must` requirements are Tested, or explicitly Blocked/Deferred with owner and reason. None silently removed (REQ-PHS-013) |
| Acceptance scenarios | 30/30 executed, each with a linked requirement, independent fixture and recorded actual result (REQ-PHS-016) |
| Gate quality | 0 open Critical/High findings at every PASS gate, with ≥ 2 independent review reports per phase (REQ-AGT-008) |
| Isolation | 0 cross-project disclosures in the AT-03 suite across API, search, reports, files, notifications, jobs and AI |
| AI safety (acceptance set only; not a guarantee for future cases) | 0 authorization bypasses; 0 unauthorized closing/approval actions; 100% valid citations for factual claims (REQ-AI-039) |
| Recoverability | Restore drill passed with measured RPO/RTO recorded against the proposals in section 5.7 |

### 9.2 Product outcomes — measured during pilot/UAT; baselines unknown (TBD)

No baselines exist in the build environment. Values will come from pilot measurement, not estimates.

| Outcome | Metric (definition) |
|---|---|
| Faster project onboarding | Elapsed time from template selection to "monitoring launched" with an explicit gap list (REQ-SET-016) |
| Better decision quality | % of decisions submitted with a complete decision paper; % of out-of-mandate items correctly routed |
| Decision follow-through | Action closure time; % of approved decisions reaching Implemented-Verified with evidence |
| Data freshness | % of workstreams with an accepted update within the configured cadence (REQ-PLN-020) |
| Separation control | % of perimeter items with a transfer plan and acceptance evidence; contracts awaiting consent; Day-1 readiness by site |
| Transaction control | % of CPs verified with evidence before the closing request; zero closings confirmed with unmet blocking CPs |
| Reporting effort | Committee pack produced from the system without manual re-keying; reconciliation differences to source = 0 |
| AI usefulness (if enabled) | Briefings delivered on schedule; share of AI proposals accepted after review; citation validity in production sampling |

---

## 10. Open questions (summary)

These are to be consolidated with owners in `docs/assumptions-and-open-questions.md` (REQ-AGT-004). None of them
blocks P0–P6 engineering. Each affects the integration or production step named.

1. Committee chair, members and the approved delegation/authority matrix, including quorum, thresholds and spending
   limits. Needed for production approval authority (REQ-GOV-010).
2. Hosting environment: Kubernetes or OpenShift, identity provider (OIDC/SAML), object storage, secrets manager, SIEM
   and backup targets. Needed at P7 (REQ-DEP-020).
3. Approved AI route (Off, local model, or approved gateway), data-flow approval and budget. Needed before enabling AI
   outside the sandbox (REQ-DEP-003..005).
4. Authoritative sources: the tracker image, the Excel workbook and approved minutes, and the approved route for handling them
   (REQ-SRC-009, REQ-SRC-010).
5. Meaning of unclear abbreviations in the source (CST, ATA and others). Expansions will not be assumed (REQ-AGR-002).
6. VDR approach: internal minimal data room or integration with an approved VDR (REQ-JV-009).
7. Retention periods, classification scheme and legal-hold authority (REQ-GOV-008, REQ-DAT-010).
8. Confirmation or replacement of the proposed performance, availability and RPO/RTO targets (sections 5.6 and 5.7).

---

## Appendix A — Requirement areas

| Area | Meaning | IDs | Count |
|---|---|---|---:|
| PLT | Platform and execution rules | REQ-PLT-001..008 | 8 |
| SRC | Sources and source register | REQ-SRC-001..010 | 10 |
| LCY | Lifecycle, gates, status dimensions | REQ-LCY-001..015 | 15 |
| GOV | Committee and decisions | REQ-GOV-001..027 | 27 |
| ENT | Enterprise structure, templates, multi-project | REQ-ENT-001..013 | 13 |
| WS | Workstreams and WBS | REQ-WS-001..007 | 7 |
| PER | Perimeter and transfers | REQ-PER-001..007 | 7 |
| AGR | Agreements, consents, approvals | REQ-AGR-001..008 | 8 |
| TSA | Transitional services | REQ-TSA-001..006 | 6 |
| RDY | Day-1 and cutover readiness | REQ-RDY-001..006 | 6 |
| FIN | Finance, business plan, benefits | REQ-FIN-001..010 | 10 |
| JV | Partner, diligence, closing | REQ-JV-001..019 | 19 |
| PLN | Planning, schedule, RAID, change, measurement | REQ-PLN-001..024 | 24 |
| UX | Screens, i18n, accessibility | REQ-UX-001..028 | 28 |
| RPT | Reporting, KPIs, snapshots | REQ-RPT-001..017 | 17 |
| AI | Runtime AI Project Manager | REQ-AI-001..039 | 39 |
| ARC | Architecture and technology | REQ-ARC-001..015 | 15 |
| DAT | Data model, integrity, API | REQ-DAT-001..017 | 17 |
| SEC | Authorization and security | REQ-SEC-001..024 | 24 |
| DEP | Hosting and deployment | REQ-DEP-001..022 | 22 |
| INT | Imports and integrations | REQ-INT-001..015 | 15 |
| AGT | Claude Code agents and process | REQ-AGT-001..012 | 12 |
| PHS | Phases, gates, delivery artifacts | REQ-PHS-001..029 | 29 |
| SET | Initial data and setup wizard | REQ-SET-001..016 | 16 |
| **Total** | | | **394** |
